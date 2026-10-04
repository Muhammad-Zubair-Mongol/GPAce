/**
 * Step 28: priority-list reads use the canonical repository boundary.
 *
 * The fixtures exercise the three failure modes that made the old page
 * ambiguous: legacy cache ghosts, unrelated cross-tab messages, and an empty
 * repository versus a repository that cannot be read.
 */

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach(value => this.values.add(value));
  }

  remove(...values) {
    values.forEach(value => this.values.delete(value));
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.dataset = {};
    this.className = '';
    this.classList = new FakeClassList();
    this.innerHTML = '';
    this.children = [];
    this.listeners = new Map();
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  querySelector() {
    return null;
  }

  insertBefore(element) {
    this.children.push(element);
    return element;
  }

  remove() {}
}

class FakeDocument {
  constructor() {
    this.taskList = new FakeElement('taskList');
    this.container = new FakeElement('container');
    this.listHeader = new FakeElement('list-header');
    this.body = new FakeElement('body');
    this.body.classList = new FakeClassList();
    this.listeners = new Map();
    this.documentElement = { scrollTop: 0 };
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  getElementById(id) {
    if (id === 'taskList') return this.taskList;
    return null;
  }

  querySelector(selector) {
    if (selector === '.container') return this.container;
    if (selector === '.list-header') return this.listHeader;
    return null;
  }

  querySelectorAll() {
    return [];
  }

  createElement() {
    return new FakeElement();
  }
}

class FakeWindow {
  constructor() {
    this.listeners = new Map();
    this.reloadCalls = 0;
    this.storageReads = [];
    this.storageWrites = [];
    this.location = { reload: () => { this.reloadCalls += 1; } };
    this.pageYOffset = 0;
    this.getStorage = () => ({
      get: (key, fallback) => {
        this.storageReads.push(key);
        if (key === 'calculatedPriorityTasks') {
          return [{ id: 'legacy-ghost', title: 'Legacy cache ghost', completed: false }];
        }
        return fallback;
      },
      set: (key, value) => {
        this.storageWrites.push([key, value]);
        return { success: true };
      }
    });
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }

  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }

  dispatchStorage(event) {
    for (const callback of this.listeners.get('storage') || []) callback(event);
  }
}

class FakeRepository {
  constructor(tasks, { failReady = false } = {}) {
    this.tasks = tasks;
    this.failReady = failReady;
    this.readyCalls = 0;
    this.priorityReads = 0;
    this.listeners = new Set();
  }

  async ready() {
    this.readyCalls += 1;
    if (this.failReady) throw new Error('repository unavailable');
    return { ok: true, version: 5 };
  }

  getPriorityCache() {
    this.priorityReads += 1;
    return this.tasks.map(task => ({ ...task }));
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(type, data = {}) {
    for (const callback of this.listeners) callback(type, data);
  }
}

function activeTask(id, title, extra = {}) {
  return {
    id,
    projectId: 'project-1',
    title,
    section: 'General',
    projectName: 'Demo project',
    priorityScore: 8,
    completed: false,
    deleted: false,
    ...extra
  };
}

function flushAsyncWork() {
  return new Promise(resolve => setImmediate(resolve));
}

describe('Step 28: canonical priority-list reads', () => {
  let moduleUnderTest;
  let runtimeWindow;
  let runtimeDocument;

  before(async () => {
    runtimeWindow = new FakeWindow();
    runtimeDocument = new FakeDocument();
    globalThis.window = runtimeWindow;
    globalThis.document = runtimeDocument;
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    const moduleUrl = new URL(`file:///${path.join(ROOT, 'js', 'priority-list-utils.js').replace(/\\/g, '/')}`).href;
    moduleUnderTest = await import(`${moduleUrl}?step28`);
  });

  beforeEach(() => {
    moduleUnderTest.destroyPriorityList();
    runtimeWindow.reloadCalls = 0;
    runtimeWindow.storageReads = [];
    runtimeWindow.storageWrites = [];
    runtimeDocument = new FakeDocument();
  });

  it('filters completed and deleted canonical records without consulting the legacy cache', async () => {
    const repository = new FakeRepository([
      activeTask('active-1', 'Active canonical task'),
      activeTask('done-1', 'Completed task', { completed: true }),
      activeTask('deleted-1', 'Deleted task', { deleted: true })
    ]);

    assert.equal(await moduleUnderTest.initializePage({
      repository,
      windowRef: runtimeWindow,
      documentRef: runtimeDocument
    }), true);

    assert.match(runtimeDocument.taskList.innerHTML, /Active canonical task/);
    assert.doesNotMatch(runtimeDocument.taskList.innerHTML, /Completed task|Deleted task|Legacy cache ghost/);
    assert.equal(repository.readyCalls, 1);
    assert.equal(repository.priorityReads, 1);
    assert.equal(runtimeWindow.storageReads.includes('calculatedPriorityTasks'), false);
  });

  it('refreshes only for affected canonical task events', async () => {
    const repository = new FakeRepository([activeTask('task-1', 'Affected task')]);
    await moduleUnderTest.initializePage({
      repository,
      windowRef: runtimeWindow,
      documentRef: runtimeDocument
    });
    const initialRenderCount = moduleUnderTest.getPriorityListState().renderCount;

    repository.emit('SETTINGS_UPDATED', { affected: false });
    repository.emit('TASK_UPDATED', { affectsPriorityList: false });
    runtimeWindow.dispatchStorage({ key: 'unrelated-settings', newValue: '{}' });
    await flushAsyncWork();
    assert.equal(moduleUnderTest.getPriorityListState().renderCount, initialRenderCount);

    repository.emit('TASK_UPDATED', { projectId: 'project-1', affectsPriorityList: true });
    await flushAsyncWork();
    assert.ok(moduleUnderTest.getPriorityListState().renderCount > initialRenderCount);
    assert.equal(repository.priorityReads, 2);
  });

  it('renders a legitimate empty repository without recovery controls or reloads', async () => {
    const repository = new FakeRepository([]);
    assert.equal(await moduleUnderTest.initializePage({
      repository,
      windowRef: runtimeWindow,
      documentRef: runtimeDocument
    }), true);

    const state = moduleUnderTest.getPriorityListState();
    assert.equal(state.status, 'empty');
    assert.equal(runtimeDocument.taskList.dataset.state, 'empty');
    assert.match(runtimeDocument.taskList.innerHTML, /No priority tasks found/);
    assert.doesNotMatch(runtimeDocument.taskList.innerHTML, /Force Sync|reload|recover/i);
    assert.equal(runtimeDocument.body.children.some(child => child.className === 'sync-button'), false);
    assert.equal(runtimeWindow.reloadCalls, 0);
  });

  it('separates repository unavailability from an empty result', async () => {
    const repository = new FakeRepository([], { failReady: true });
    assert.equal(await moduleUnderTest.initializePage({
      repository,
      windowRef: runtimeWindow,
      documentRef: runtimeDocument
    }), false);

    const state = moduleUnderTest.getPriorityListState();
    assert.equal(state.status, 'unavailable');
    assert.equal(runtimeDocument.taskList.dataset.state, 'unavailable');
    assert.match(runtimeDocument.taskList.innerHTML, /temporarily unavailable/i);
    assert.doesNotMatch(runtimeDocument.taskList.innerHTML, /No priority tasks found/);
    assert.equal(runtimeWindow.reloadCalls, 0);
  });

  it('keeps the page topology on the canonical loader and removes legacy priority consumers', () => {
    const html = fs.readFileSync(path.join(ROOT, 'priority-list.html'), 'utf8');
    const utils = fs.readFileSync(path.join(ROOT, 'js', 'priority-list-utils.js'), 'utf8');
    assert.match(html, /js\/core\/TaskSystemLoader\.js/);
    assert.match(html, /js\/services\/TaskService\.js/);
    assert.doesNotMatch(html, /js\/(?:common|priority-sync-fix|priority-list-sorting)\.js/);
    assert.doesNotMatch(utils, /calculatedPriorityTasks/);
    assert.doesNotMatch(utils, /location\.reload/);
  });
});
