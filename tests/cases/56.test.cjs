/**
 * Step 56: deterministic end-to-end student journeys.
 *
 * The journey is deliberately assembled from isolated local fixtures.  The
 * browser path serves only a loopback page and the provider path goes through
 * a loopback ApiClient route backed by createProviderMock().
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { ApiClient, ApiClientError } = require('../../js/services/ApiClient.js');
const {
  createDisposableBrowserProfile,
  createProviderMock,
  createTestServer
} = require('../harness/helpers.cjs');
const { chromium } = require('../harness/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const fixture = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests', 'fixtures', 'student-journeys.json'),
  'utf8'
));

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function assertFixtureShape() {
  assert.equal(fixture.contract, 'gpace-student-journeys');
  assert.equal(fixture.mode, 'local-fixture-only');
  assert.ok(fixture.student.uid);
  assert.ok(fixture.semester.id);
  assert.ok(fixture.subject.tag);
  assert.ok(fixture.mark.category);
  assert.ok(fixture.task.id);
  assert.equal(fixture.policy.identityMustRemain, fixture.task.id);
  assert.equal(fixture.policy.localOnly, true);

  const urls = [...JSON.stringify(fixture).matchAll(/https?:\/\/[^/\s"']+/g)]
    .map(match => new URL(match[0]).hostname);
  assert.deepEqual(urls, [], 'the journey fixture must not contain a remote endpoint');
}

function createJourneyStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [
    String(key),
    typeof value === 'string' ? value : clone(value)
  ]));
  const writes = [];

  function shouldFail(key) {
    return this.failKey === String(key);
  }

  function decode(value, fallback) {
    if (value === undefined || value === null) return clone(fallback);
    if (typeof value !== 'string') return clone(value);
    try {
      return clone(JSON.parse(value));
    } catch {
      return value;
    }
  }

  const storage = {
    values,
    writes,
    failKey: null,

    getItem(key) {
      const normalized = String(key);
      if (!values.has(normalized)) return null;
      const value = values.get(normalized);
      return typeof value === 'string' ? value : JSON.stringify(value);
    },

    setItem(key, value) {
      const normalized = String(key);
      if (shouldFail.call(this, normalized)) {
        writes.push({ key: normalized, accepted: false });
        throw new Error(`fixture storage failure for ${normalized}`);
      }
      const stringValue = String(value);
      writes.push({ key: normalized, accepted: true, value: stringValue });
      values.set(normalized, stringValue);
    },

    removeItem(key) {
      const normalized = String(key);
      if (shouldFail.call(this, normalized)) {
        writes.push({ key: normalized, accepted: false });
        throw new Error(`fixture storage failure for ${normalized}`);
      }
      values.delete(normalized);
    },

    get(key, fallback) {
      return decode(values.get(String(key)), fallback);
    },

    set(key, value) {
      const normalized = String(key);
      if (shouldFail.call(this, normalized)) {
        writes.push({ key: normalized, accepted: false, value: clone(value) });
        return false;
      }
      values.set(normalized, clone(value));
      writes.push({ key: normalized, accepted: true, value: clone(value) });
      return { success: true, status: 'success', value: clone(value) };
    },

    remove(key) {
      const normalized = String(key);
      if (shouldFail.call(this, normalized)) return false;
      values.delete(normalized);
      return { success: true, status: 'success' };
    },

    clear() {
      values.clear();
    },

    key(index) {
      return [...values.keys()][index] ?? null;
    },

    get length() {
      return values.size;
    },

    dump() {
      return Object.fromEntries([...values.entries()].map(([key, value]) => [key, clone(value)]));
    }
  };

  return storage;
}

function makeEventTarget() {
  const listeners = new Map();
  const target = {
    location: { href: 'http://127.0.0.1/fixture.html', reload() {} },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    dispatchEvent(event) {
      for (const callback of [...(listeners.get(event?.type) || [])]) callback(event);
      return true;
    },
    fire(type, event = {}) {
      return this.dispatchEvent({ type, ...event });
    }
  };
  return target;
}

class FixtureCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

class FixtureStorageEvent extends FixtureCustomEvent {
  constructor(type, init = {}) {
    super(type, init);
    Object.assign(this, init);
  }
}

function makeFixtureDocument() {
  const documentRef = makeEventTarget();
  documentRef.visibilityState = 'hidden';
  return documentRef;
}

function loadTaskRepository(storage, uid) {
  const sourcePath = path.join(ROOT, 'js', 'core', 'TaskRepository.js');
  let executable = fs.readFileSync(sourcePath, 'utf8');
  executable = executable.replace('export const ENVELOPE_STATUS', 'const ENVELOPE_STATUS');
  executable = executable.replace(
    /\/\/ Export for ES modules[\s\S]*$/,
    'globalThis.__TaskRepository = TaskRepository;'
  );

  const windowRef = makeEventTarget();
  const documentRef = makeFixtureDocument();
  const sessionStorage = createJourneyStorage();
  windowRef.localStorage = storage;
  windowRef.sessionStorage = sessionStorage;
  windowRef.document = documentRef;

  const context = {
    console,
    Date,
    Error,
    JSON,
    Math,
    Map,
    Number,
    Object,
    Promise,
    Set,
    String,
    Array,
    Boolean,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
    CustomEvent: FixtureCustomEvent,
    BroadcastChannel: undefined,
    window: windowRef,
    localStorage: storage,
    sessionStorage,
    document: documentRef,
    setInterval: () => ({ fixtureInterval: true }),
    clearInterval() {},
    setTimeout: () => ({ fixtureTimeout: true }),
    clearTimeout() {}
  };

  vm.runInNewContext(executable, context, { filename: 'TaskRepository.js' });
  const TaskRepository = context.__TaskRepository;
  assert.ok(TaskRepository, 'TaskRepository fixture export was not created');
  TaskRepository.setStorageBackend(storage);
  TaskRepository.setUser(uid);
  return { TaskRepository, windowRef, documentRef };
}

function loadTaskService(repository, storage) {
  const sourcePath = path.join(ROOT, 'js', 'services', 'TaskService.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const classStart = source.indexOf('class TaskService');
  const singletonStart = source.indexOf('// Singleton export');
  assert.ok(classStart >= 0 && singletonStart > classStart, 'TaskService class boundary changed');

  const executable = `${source.slice(classStart, singletonStart)}\n` +
    'globalThis.__TaskServiceClass = TaskService;';
  const documentRef = makeFixtureDocument();
  documentRef.visibilityState = 'visible';
  const windowRef = makeEventTarget();
  windowRef.document = documentRef;
  windowRef.localStorage = storage;

  const context = {
    console,
    Date,
    Error,
    JSON,
    Math,
    Map,
    Number,
    Object,
    Promise,
    Set,
    String,
    Array,
    Boolean,
    window: windowRef,
    document: documentRef,
    localStorage: storage,
    StorageEvent: FixtureStorageEvent
  };
  vm.runInNewContext(executable, context, { filename: 'TaskService.js' });
  const TaskService = context.__TaskServiceClass;
  assert.ok(TaskService, 'TaskService fixture export was not created');
  return {
    service: new TaskService({ repository, storage }),
    windowRef,
    documentRef
  };
}

function canonicalEnvelope(TaskRepository, data, deviceId = 'journey-fixture-device') {
  return {
    version: 5,
    schema: 'gpac_v5',
    generatedAt: '2026-09-29T00:00:00.000Z',
    deviceId,
    checksum: TaskRepository._calculateChecksum(data),
    data: clone(data)
  };
}

function seedCanonicalStore(TaskRepository, storage, projectId, active, completed = []) {
  const activeKey = TaskRepository._getScopedKey(`tasks_v5.${projectId}`);
  const completedKey = TaskRepository._getScopedKey(`completed_v5.${projectId}`);
  const priorityKey = TaskRepository._getScopedKey('priority_cache_v5');
  storage.setItem(activeKey, JSON.stringify(canonicalEnvelope(TaskRepository, active)));
  storage.setItem(completedKey, JSON.stringify(canonicalEnvelope(TaskRepository, completed)));
  storage.setItem(priorityKey, JSON.stringify(canonicalEnvelope(TaskRepository, active)));
  storage.setItem(TaskRepository._getScopedKey('migration_done_v5'), 'true');
  storage.setItem(TaskRepository._getScopedKey('schema_version'), '5');
  storage.setItem(TaskRepository._getScopedKey('device_id'), 'journey-fixture-device');
}

async function loadAcademicModules(storage) {
  const previous = {
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    document: globalThis.document,
    CustomEvent: globalThis.CustomEvent,
    StorageEvent: globalThis.StorageEvent
  };
  const windowRef = makeEventTarget();
  const documentRef = makeFixtureDocument();
  windowRef.window = windowRef;
  windowRef.document = documentRef;
  windowRef.localStorage = storage;
  windowRef.StorageService = storage;
  windowRef.getStorage = () => storage;

  globalThis.window = windowRef;
  globalThis.localStorage = storage;
  globalThis.document = documentRef;
  globalThis.CustomEvent = FixtureCustomEvent;
  globalThis.StorageEvent = FixtureStorageEvent;

  const suffix = `?case56=${Date.now()}-${Math.random()}`;
  const semesterUrl = `${new URL('../../js/services/SemesterService.js', `file://${__dirname}/`).href}${suffix}`;
  const marksUrl = `${new URL('../../js/subject-marks.js', `file://${__dirname}/`).href}${suffix}`;
  const [{ SemesterService }, marks] = await Promise.all([
    import(semesterUrl),
    import(marksUrl)
  ]);

  // StorageAdapter resolves window.StorageService on every operation. Keep
  // the injected fixture installed until the caller has finished its journey.
  windowRef.StorageService = storage;
  return {
    SemesterService,
    marks,
    restore() {
      globalThis.window = previous.window;
      globalThis.localStorage = previous.localStorage;
      globalThis.document = previous.document;
      globalThis.CustomEvent = previous.CustomEvent;
      globalThis.StorageEvent = previous.StorageEvent;
    }
  };
}

function makeEditorDocument() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        dataset: {},
        hidden: false,
        disabled: false,
        textContent: '',
        classList: {
          add() {},
          remove() {},
          toggle() {},
          contains() { return false; }
        },
        setAttribute() {},
        removeAttribute() {},
        addEventListener() {}
      });
    }
    return elements.get(id);
  }
  return {
    readyState: 'complete',
    body: { appendChild() {}, removeChild() {} },
    getElementById: id => id === 'missing' ? null : element(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    elements
  };
}

function makeEditorWindow(documentRef, storage) {
  const intervals = new Map();
  const events = new Map();
  let nextTimer = 1;
  const windowRef = makeEventTarget();
  windowRef.document = documentRef;
  windowRef.localStorage = storage;
  windowRef.parent = {};
  windowRef.toasts = [];
  windowRef.addEventListener = (type, callback) => {
    if (!events.has(type)) events.set(type, new Set());
    events.get(type).add(callback);
  };
  windowRef.removeEventListener = (type, callback) => events.get(type)?.delete(callback);
  windowRef.setInterval = (callback, delay) => {
    const id = nextTimer++;
    intervals.set(id, { callback, delay });
    return id;
  };
  windowRef.clearInterval = id => intervals.delete(id);
  windowRef.showToast = (message, type) => windowRef.toasts.push({ message, type });
  windowRef.updateToolbarState = () => {};
  windowRef.intervalCount = () => intervals.size;
  windowRef.fire = (type, event = {}) => {
    for (const callback of [...(events.get(type) || [])]) callback({ type, ...event });
  };
  return windowRef;
}

class FakeQuill {
  constructor(content = { ops: [{ insert: 'initial\n' }] }) {
    this.content = clone(content);
    this.handlers = new Map();
    this.history = { undo() {}, redo() {} };
    this.root = { innerHTML: '<p>initial</p>' };
  }

  on(type, callback) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(callback);
  }

  emit(type, value = {}) {
    for (const callback of this.handlers.get(type) || []) callback(value);
  }

  getContents() {
    return clone(this.content);
  }

  setContents(content) {
    this.content = clone(content);
  }

  getText() {
    return (this.content.ops || [])
      .map(op => typeof op.insert === 'string' ? op.insert : '')
      .join('');
  }
}

function loadWorkspaceDocument({ windowRef, storage, editor, state }) {
  const sourcePath = path.join(ROOT, 'js', 'workspace-document.js');
  let executable = fs.readFileSync(sourcePath, 'utf8');
  executable = executable.replace(/export\s*\{[\s\S]*?\};/, '');
  executable += '\nglobalThis.__workspaceDocument = { saveContent, saveDocument };';
  const context = {
    console,
    Date,
    Error,
    JSON,
    Promise,
    String,
    Number,
    Object,
    window: windowRef,
    localStorage: null,
    quill: editor,
    editorState: state,
    updateLastSaved: () => { state.lastSavedRendered = true; },
    document: windowRef.document
  };
  windowRef.getStorage = () => storage;
  windowRef.editorState = state;
  vm.runInNewContext(executable, context, { filename: 'workspace-document.js' });
  return context.__workspaceDocument;
}

function loadWorkspaceCore(windowRef) {
  const sourcePath = path.join(ROOT, 'js', 'workspace-core.js');
  let executable = fs.readFileSync(sourcePath, 'utf8');
  executable = executable.replace(/export function /g, 'function ');
  executable += '\nglobalThis.__workspaceCore = { initWorkspace, destroyWorkspace, getWorkspaceState, startAutoSave, stopAutoSave, hasUnsavedChanges };';
  const context = {
    console,
    Date,
    Error,
    JSON,
    Math,
    Map,
    Number,
    Object,
    Promise,
    Set,
    String,
    window: windowRef,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(executable, context, { filename: 'workspace-core.js' });
  return context.__workspaceCore;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(raw ? JSON.parse(raw) : null); }
      catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function runPriorityBrowserJourney(task) {
  const browserRequests = [];
  const pageRequests = [];
  const failedRequests = [];
  const pageErrors = [];
  const consoleErrors = [];
  const displaySource = fs.readFileSync(
    path.join(ROOT, 'js', 'controllers', 'TaskDisplayController.js'),
    'utf8'
  );
  const taskLiteral = JSON.stringify(task).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>GPAce Journey Fixture</title></head>
<body><main><div id="priorityTaskBox"></div></main>
<script>
window.__records = { active: [${taskLiteral}], completed: [] };
window.PriorityListSorter = { applySavedSort() {} };
window.TaskService = {
  async getPriorityTasks() {
    return window.__records.active.filter(task => !task.completed && !task.deleted);
  }
};
window.completeTask = async (projectId, taskId) => {
  const index = window.__records.active.findIndex(task => String(task.id) === String(taskId) && String(task.projectId) === String(projectId));
  if (index < 0) throw new Error('fixture task was not found');
  const [completed] = window.__records.active.splice(index, 1);
  window.__records.completed.push({ ...completed, completed: true });
  await window.__controller._displayPriorityTaskImpl(true);
  window.__lastAction = 'complete';
};
window.reopenTask = async () => {
  const historical = window.__records.completed[window.__records.completed.length - 1];
  window.__records.active = [{ ...historical, completed: false, deleted: false, reopen: true }];
  await window.__controller._displayPriorityTaskImpl(true);
  window.__lastAction = 'reopen';
};
</script>
<script type="module">
import { TaskDisplayController } from '/js/controllers/TaskDisplayController.js';
const controller = new TaskDisplayController({ document, window });
controller.init({ document, window, repository: window.TaskService });
window.__controller = controller;
await controller._displayPriorityTaskImpl(true);
window.__uiReady = true;
</script></body></html>`;

  const server = await createTestServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    browserRequests.push({ method: request.method, pathname: url.pathname });
    if (url.pathname === '/journey.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    if (url.pathname === '/js/controllers/TaskDisplayController.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(displaySource);
      return;
    }
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const profile = createDisposableBrowserProfile();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: ['--no-sandbox']
    });
    const page = await browser.newPage();
    page.on('request', request => pageRequests.push(request.url()));
    page.on('requestfailed', request => failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText || 'request failed'
    }));
    page.on('pageerror', error => pageErrors.push(String(error)));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto(`${server.url}/journey.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__uiReady === true);
    assert.equal(await page.title(), 'GPAce Journey Fixture');
    assert.equal(await page.locator('.task-info').getAttribute('data-task-id'), fixture.task.id);
    assert.equal(await page.locator('.task-title').textContent(), fixture.task.title);

    await page.locator('[data-task-action="complete-task"]').click();
    await page.waitForFunction(() => (
      window.__lastAction === 'complete' &&
      Boolean(document.querySelector('.empty-priority-task'))
    ));
    assert.equal(await page.locator('.empty-priority-task').count(), 1);

    await page.evaluate(() => window.reopenTask());
    await page.waitForFunction(() => (
      window.__lastAction === 'reopen' &&
      document.querySelector('.task-info')?.dataset.taskId === 'journey-task-1'
    ));
    assert.equal(await page.locator('.task-title').textContent(), fixture.task.title);
    assert.equal(
      await page.locator('.task-info').getAttribute('data-task-id'),
      fixture.policy.identityMustRemain
    );

    for (const rawUrl of pageRequests) {
      const url = new URL(rawUrl);
      if (url.protocol === 'about:' || url.protocol === 'data:') continue;
      assert.equal(url.origin, server.url, `unexpected browser request: ${rawUrl}`);
    }
    assert.deepEqual(failedRequests, [], 'priority journey had a failed browser request');
    assert.deepEqual(pageErrors, [], 'priority journey produced a pageerror');
    assert.deepEqual(consoleErrors, [], 'priority journey produced a console error');
    for (const request of browserRequests) {
      assert.match(request.pathname, /^(\/journey\.html|\/js\/controllers\/TaskDisplayController\.js|\/favicon\.ico)$/);
    }
    return { browserRequests, pageErrors, consoleErrors };
  } finally {
    await browser?.close();
    await server.close();
    profile.cleanup();
  }
}

describe('Step 56: deterministic student journeys', () => {
  it('runs onboarding through marks, task priority, Grind complete/reopen, and the rendered priority journey', async () => {
    assertFixtureShape();
    const storage = createJourneyStorage();
    let academicModules;
    let repositoryContext;
    try {
      const subject = clone(fixture.subject);
      storage.set('academicSubjects', [subject]);
      storage.set('subjectWeightages', clone(fixture.weightages));
      storage.set('projectWeightages', {});

      academicModules = await loadAcademicModules(storage);
      const { SemesterService, marks } = academicModules;
      await SemesterService.initialize();
      const semesterId = SemesterService.createSemester({
        ...fixture.semester,
        subjects: [subject]
      });
      SemesterService.setCurrentSemester(semesterId);
      assert.equal(SemesterService.getCurrentSemester(), fixture.semester.id);
      assert.equal(
        storage.get('academicSemesters', {})[fixture.semester.id].subjects[0].tag,
        fixture.subject.tag
      );

      const markInput = {
        subjectTag: fixture.subject.tag,
        category: `  ${fixture.mark.category.toUpperCase()}  `,
        obtained: fixture.mark.obtained,
        total: fixture.mark.total,
        title: fixture.mark.title
      };
      assert.equal(
        marks.addSubjectMark(
          markInput.subjectTag,
          markInput.category,
          markInput.obtained,
          markInput.total,
          markInput.title
        ),
        true
      );
      const durableMarks = storage.get('subjectMarks', {});
      assert.deepEqual(durableMarks[fixture.subject.tag].quiz[0].title, fixture.mark.title);
      assert.equal(durableMarks[fixture.subject.tag].quiz[0].obtained, fixture.mark.obtained);
      assert.equal(storage.get('academicSubjects', [])[0].tag, fixture.subject.tag);
      assert.equal(storage.get('academicSubjects', [])[0].academicPerformance, 8);

      const marksBeforeFailure = clone(storage.get('subjectMarks', {}));
      const failedMarkInput = clone(markInput);
      storage.failKey = 'subjectMarks';
      assert.equal(
        marks.addSubjectMark(
          failedMarkInput.subjectTag,
          failedMarkInput.category,
          failedMarkInput.obtained,
          failedMarkInput.total,
          failedMarkInput.title
        ),
        false
      );
      storage.failKey = null;
      assert.deepEqual(storage.get('subjectMarks', {}), marksBeforeFailure);
      assert.deepEqual(failedMarkInput, markInput, 'failed mark input was mutated');

      repositoryContext = loadTaskRepository(storage, fixture.student.uid);
      const { TaskRepository } = repositoryContext;
      const { service } = loadTaskService(TaskRepository, storage);
      await TaskRepository.ready();
      assert.equal(
        storage.getItem(TaskRepository._getScopedKey('migration_done_v5')),
        'true',
        'clean local store did not commit its canonical migration marker'
      );

      const projectId = fixture.subject.tag;
      const taskInput = {
        ...clone(fixture.task),
        projectName: fixture.subject.name
      };
      const created = await service.createTask(projectId, taskInput);
      assert.equal(created.id, fixture.policy.identityMustRemain);
      assert.equal(created.projectId, projectId);
      assert.equal(TaskRepository.getAllTasks(projectId).length, 1);
      assert.equal(TaskRepository.getPriorityCache()[0].id, fixture.policy.identityMustRemain);

      const failedTaskInput = {
        id: 'journey-task-storage-failure',
        title: 'Retain this task input',
        priority: 'medium'
      };
      const failedTaskInputBefore = clone(failedTaskInput);
      storage.failKey = TaskRepository._getScopedKey(`tasks_v5.${projectId}`);
      await assert.rejects(
        service.createTask(projectId, failedTaskInput),
        /fixture storage failure/
      );
      storage.failKey = null;
      assert.deepEqual(failedTaskInput, failedTaskInputBefore);
      assert.equal(
        TaskRepository.getAllTasks(projectId).some(task => task.id === failedTaskInput.id),
        false,
        'failed task storage unexpectedly changed the active record'
      );
      assert.equal(TaskRepository.getAllTasks(projectId)[0].id, fixture.policy.identityMustRemain);

      const completed = await service.completeTask(projectId, fixture.task.id);
      assert.equal(completed.id, fixture.policy.identityMustRemain);
      assert.equal(completed.completed, true);
      assert.deepEqual(clone(TaskRepository.getAllTasks(projectId)), []);
      assert.deepEqual(
        clone(TaskRepository.getCompletedTasks(projectId).map(task => task.id)),
        [fixture.policy.identityMustRemain]
      );
      assert.deepEqual(clone(TaskRepository.getPriorityCache()), []);

      const reopened = await service.createTask(projectId, {
        ...clone(fixture.task),
        projectName: fixture.subject.name,
        id: fixture.policy.identityMustRemain
      });
      assert.equal(reopened.id, fixture.policy.identityMustRemain);
      assert.equal(reopened.completed, false);
      assert.deepEqual(
        clone(TaskRepository.getAllTasks(projectId).map(task => task.id)),
        [fixture.policy.identityMustRemain]
      );
      assert.deepEqual(
        clone(TaskRepository.getCompletedTasks(projectId).map(task => task.id)),
        [fixture.policy.identityMustRemain],
        'reopen must preserve the historical identity'
      );
      assert.deepEqual(
        clone(TaskRepository.getPriorityCache().map(task => task.id)),
        [fixture.policy.identityMustRemain]
      );

      const browserEvidence = await runPriorityBrowserJourney(reopened);
      assert.ok(browserEvidence.browserRequests.length >= 2);
      assert.deepEqual(browserEvidence.pageErrors, []);
      assert.deepEqual(browserEvidence.consoleErrors, []);
    } finally {
      repositoryContext?.TaskRepository.destroy();
      academicModules?.restore();
    }
  });

  it('reads a migrated canonical fixture after reload and ignores stale legacy data', async () => {
    assertFixtureShape();
    const storage = createJourneyStorage();
    const migratedTask = {
      id: fixture.policy.identityMustRemain,
      projectId: fixture.subject.tag,
      title: fixture.task.title,
      description: fixture.task.description,
      completed: false,
      deleted: false,
      priority: fixture.task.priority,
      section: fixture.task.section,
      createdAt: '2026-09-29T00:00:00.000Z',
      updatedAt: '2026-09-29T00:00:00.000Z'
    };
    const first = loadTaskRepository(storage, fixture.student.uid);
    try {
      seedCanonicalStore(first.TaskRepository, storage, fixture.subject.tag, [migratedTask]);
      storage.setItem(`tasks-${fixture.subject.tag}`, JSON.stringify([
        { id: 'legacy-stale-task', title: 'Stale legacy task', completed: false }
      ]));
      await first.TaskRepository.ready();
      assert.deepEqual(
        clone(first.TaskRepository.getAllTasks(fixture.subject.tag).map(task => task.id)),
        [fixture.policy.identityMustRemain]
      );
      first.TaskRepository.destroy();

      const second = loadTaskRepository(storage, fixture.student.uid);
      try {
        await second.TaskRepository.ready();
        const afterReload = second.TaskRepository.getAllTasks(fixture.subject.tag);
        assert.equal(afterReload.length, 1);
        assert.equal(afterReload[0].id, fixture.policy.identityMustRemain);
        assert.equal(afterReload[0].title, fixture.task.title);
        assert.equal(
          afterReload.some(task => task.id === 'legacy-stale-task'),
          false,
          'committed migration must keep the stale legacy record out of the view'
        );
        assert.equal(fixture.stores.migrated.schema, 'gpac_v5');
        assert.equal(fixture.stores.migrated.version, 5);
      } finally {
        second.TaskRepository.destroy();
      }
    } finally {
      first.TaskRepository.destroy();
    }
  });

  it('retains workspace input across local and backend failures and restores the durable draft', async () => {
    const storage = createJourneyStorage();
    const documentRef = makeEditorDocument();
    const windowRef = makeEditorWindow(documentRef, storage);
    const editor = new FakeQuill(fixture.workspace.content);
    const state = {
      dirtyRevision: 1,
      savedRevision: 0,
      dirty: true,
      lastSaved: null
    };
    const documentApi = loadWorkspaceDocument({ windowRef, storage, editor, state });
    const originalContent = editor.getContents();
    windowRef.parent.saveDocumentToServer = () => {
      throw new Error('fixture backend unavailable');
    };

    const pending = await documentApi.saveContent({ revision: 1 });
    assert.equal(pending.status, 'pending');
    assert.equal(pending.committed, false);
    assert.equal(pending.local.committed, true);
    assert.equal(pending.remote.committed, false);
    assert.deepEqual(storage.get('workspaceContent', null), originalContent);
    assert.deepEqual(editor.getContents(), originalContent);
    assert.equal(state.syncStatus, 'pending');

    state.dirtyRevision = 2;
    state.dirty = true;
    storage.failKey = 'workspaceContent';
    const localFailure = await documentApi.saveContent({ revision: 2 });
    assert.equal(localFailure.status, 'error');
    assert.equal(localFailure.committed, false);
    assert.equal(state.dirty, true);
    assert.deepEqual(editor.getContents(), originalContent, 'local failure changed editor input');
    storage.failKey = null;

    windowRef.parent.saveDocumentToServer = content => ({
      ok: true,
      content
    });
    const resumed = await documentApi.saveContent({ revision: 2 });
    assert.equal(resumed.status, 'committed');
    assert.equal(resumed.local.committed, true);
    assert.equal(resumed.remote.committed, true);
    assert.equal(state.dirty, false);
    assert.equal(state.savedRevision, 2);

    const reloadDocument = makeEditorDocument();
    const reloadWindow = makeEditorWindow(reloadDocument, storage);
    const reloadedEditor = new FakeQuill();
    reloadWindow.Quill = function FixtureQuill() {
      return reloadedEditor;
    };
    const core = loadWorkspaceCore(reloadWindow);
    try {
      await core.initWorkspace({
        documentRef: reloadDocument,
        windowRef: reloadWindow,
        storage,
        Quill: reloadWindow.Quill,
        skipDomReady: true
      });
      assert.equal(core.getWorkspaceState().status, 'ready');
      assert.deepEqual(
        reloadedEditor.getContents(),
        fixture.workspace.content,
        'reload did not restore the durable local draft'
      );
    } finally {
      core.destroyWorkspace();
    }
  });

  it('uses a deterministic fake provider behind a loopback backend and resumes the retained request', async () => {
    assertFixtureShape();
    const provider = createProviderMock({ defaultResponse: clone(fixture.provider.success) });
    const requests = [];
    const server = await createTestServer((request, response) => {
      void (async () => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const body = await readRequestBody(request);
        requests.push({
          method: request.method,
          pathname: url.pathname,
          host: url.hostname,
          authorization: request.headers.authorization,
          body
        });
        if (request.method !== 'POST' || url.pathname !== '/api/research') {
          sendJson(response, 404, { error: 'fixture route not found' });
          return;
        }
        try {
          const providerResponse = await provider.generateContent(body);
          sendJson(response, 200, { answer: providerResponse });
        } catch (error) {
          sendJson(response, fixture.provider.failure.status, fixture.provider.failure);
        }
      })().catch(error => sendJson(response, 500, { error: error.message }));
    });

    try {
      const client = new ApiClient({
        baseUrl: server.url,
        getIdToken: async () => 'journey-fixture-token'
      });
      const requestInput = clone(fixture.provider.input);
      const success = await client.post('/api/research', requestInput);
      assert.deepEqual(success, { answer: fixture.provider.success });
      assert.equal(requests[0].host, '127.0.0.1');
      assert.equal(requests[0].authorization, 'Bearer journey-fixture-token');
      assert.deepEqual(requests[0].body, requestInput);

      provider.setStatus(503);
      const retainedInput = clone(fixture.provider.input);
      await assert.rejects(
        client.post('/api/research', retainedInput),
        error => error instanceof ApiClientError &&
          error.status === fixture.provider.failure.status &&
          error.code === fixture.provider.failure.code
      );
      assert.deepEqual(retainedInput, fixture.provider.input);

      provider.setStatus(200);
      const resumed = await client.post('/api/research', retainedInput);
      assert.deepEqual(resumed, { answer: fixture.provider.success });
      assert.deepEqual(retainedInput, fixture.provider.input);
      assert.equal(provider.getCalls().length, 3);
      assert.equal(requests.length, 3);
      assert.ok(requests.every(request => request.host === '127.0.0.1'));

      await assert.rejects(
        client.post('https://generativelanguage.googleapis.com/v1beta/models', requestInput),
        error => error instanceof ApiClientError && error.code === 'DIRECT_PROVIDER_BLOCKED'
      );
      assert.equal(requests.length, 3, 'direct provider rejection reached the backend');
    } finally {
      await server.close();
    }
  });
});
