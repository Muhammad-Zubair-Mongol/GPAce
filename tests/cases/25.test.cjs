/** Step 25: normalized and validated academic marks. */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(clone(initial)));
  return {
    writes: [],
    failKey: null,
    get(key, fallback) {
      return values.has(key) ? clone(values.get(key)) : clone(fallback);
    },
    set(key, value) {
      this.writes.push({ key, value: clone(value) });
      if (this.failKey === key) return false;
      values.set(key, clone(value));
      return true;
    },
    remove(key) {
      values.delete(key);
      return true;
    },
    dump() {
      return Object.fromEntries([...values.entries()].map(([key, value]) => [key, clone(value)]));
    }
  };
}

describe('Step 25: Subject mark normalization and validation', () => {
  let storage;
  let marks;

  beforeEach(async () => {
    storage = createStorage({
      academicSubjects: [{ tag: 'math', name: 'Math' }],
      subjectWeightages: { math: { assignment: 15, quiz: 10, midterm: 30, final: 40, revision: 5 } },
      projectWeightages: {}
    });
    globalThis.window = globalThis;
    globalThis.window.StorageService = storage;
    globalThis.window.getStorage = () => storage;
    globalThis.window.dispatchEvent = () => {};
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    };
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    };

    const moduleUrl = new URL('../../js/subject-marks.js', `file://${__dirname}/`).href + `?case25=${Date.now()}-${Math.random()}`;
    marks = await import(moduleUrl);
    // StorageService.js registers its singleton on window during module
    // evaluation. Inject the isolated fixture after that registration so all
    // imported helpers use the same deterministic store.
    globalThis.window.StorageService = storage;
  });

  it('normalizes uppercase and spaced categories before lookup and save', () => {
    assert.equal(marks.addSubjectMark('math', '  QUIZ  ', 8, 10, 'Quiz 1'), true);
    const saved = storage.get('subjectMarks', {});
    assert.ok(Array.isArray(saved.math.quiz), `quiz category missing: ${JSON.stringify(saved)}`);
    assert.deepEqual(saved.math.quiz[0], {
        obtained: 8,
        total: 10,
        title: 'Quiz 1',
        date: saved.math.quiz[0].date
    });
    assert.equal(saved.math._performance, 8);
  });

  it('rejects blank, negative, infinite, zero-total, and out-of-range values', () => {
    const invalidEntries = [
      ['quiz', '', 10],
      ['quiz', -1, 10],
      ['quiz', Infinity, 10],
      ['quiz', 1, 0],
      ['quiz', 11, 10]
    ];
    for (const [category, obtained, total] of invalidEntries) {
      assert.equal(marks.addSubjectMark('math', category, obtained, total), false);
    }
    assert.deepEqual(storage.get('subjectMarks', {}), {});
  });

  it('updates weighted performance once after a valid durable mark', () => {
    assert.equal(marks.addSubjectMark('math', 'assignment', 8, 10), true);
    const savedMarks = storage.get('subjectMarks', {});
    assert.equal(savedMarks.math._performance, 12, '8/10 in a 15% category yields 12 weighted points');
    const academicWrites = storage.writes.filter(write => write.key === 'academicSubjects');
    assert.equal(academicWrites.length, 1, 'one mark insertion performs one weighted subject update');
  });

  it('retains the previous durable entry when mark persistence fails', () => {
    storage.failKey = 'subjectMarks';
    assert.equal(marks.addSubjectMark('math', 'quiz', 8, 10), false);
    assert.deepEqual(storage.get('subjectMarks', {}), {});
  });

  it('rejects blank UI input before conversion and retains entered values after cloud failure', async () => {
    const uiPath = path.resolve(__dirname, '../../js/subject-marks-ui.js');
    let source = fs.readFileSync(uiPath, 'utf8');
    source = source.replace(/^import[^\r\n]*\r?\n/gm, '');
    source = source.replace(
      /\/\/ ============================================\r?\n\/\/ Exports[\s\S]*$/,
      'globalThis.__subjectMarksUi = { addMark, validateMarkFormValues, state };'
    );

    const fields = new Map();
    const makeField = (id, value) => {
      const field = {
        id,
        value,
        attributes: {},
        setAttribute(name, val) { this.attributes[name] = val; },
        getAttribute(name) { return this.attributes[name]; },
        removeAttribute(name) { delete this.attributes[name]; },
        insertAdjacentElement() {}
      };
      fields.set(id, field);
      return field;
    };
    makeField('markCategory', ' QUIZ ');
    makeField('markTitle', 'Quiz 2');
    makeField('obtainedMarks', '');
    makeField('totalMarks', '10');

    const document = {
      getElementById: id => fields.get(id) || null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, remove() {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      addEventListener() {}
    };
    const uiStorage = createStorage({ subjectMarks: { math: { _performance: 0 } } });
    let addCalls = 0;
    let updateCalls = 0;
    const context = {
      console,
      document,
      setTimeout,
      clearTimeout,
      getStorage: () => uiStorage,
      renderSubjectList() {},
      showNotification() {},
      window: {
        validateMarkEntry: marks.validateMarkEntry,
        addSubjectMark() { addCalls++; return true; },
        async saveSubjectMarksToFirestore() { throw new Error('fixture cloud failure'); },
        async updateSubjectPerformance() { updateCalls++; return 80; }
      }
    };
    context.window.window = context.window;
    vm.runInNewContext(source, context, { filename: uiPath });
    context.__subjectMarksUi.state.currentSubjectTag = 'math';

    await context.__subjectMarksUi.addMark();
    assert.equal(addCalls, 0, 'blank input is rejected before addSubjectMark');
    assert.equal(fields.get('obtainedMarks').value, '', 'blank entered value remains visible');

    fields.get('obtainedMarks').value = '8';
    await context.__subjectMarksUi.addMark();
    assert.equal(addCalls, 1);
    assert.equal(updateCalls, 0, 'UI does not recalculate a second time after addSubjectMark');
    assert.equal(fields.get('obtainedMarks').value, '8');
    assert.equal(fields.get('totalMarks').value, '10');
  });
});
