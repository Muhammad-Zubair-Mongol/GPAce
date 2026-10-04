/**
 * Step 43: TaskService uses one validated repository facade and the priority
 * display reads that facade exactly once per render.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function makeStorage(initial = {}, { failKey = null } = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
  return {
    values,
    get(key, fallback) {
      return values.has(key) ? clone(values.get(key)) : fallback;
    },
    set(key, value) {
      if (key === failKey) return false;
      values.set(key, clone(value));
      return { success: true, status: 'success' };
    },
    remove(key) {
      values.delete(key);
      return { success: true, status: 'success' };
    }
  };
}

class FakeRepository {
  constructor() {
    this.added = [];
    this.priority = [];
    this.priorityReads = 0;
    this.readyReads = 0;
  }

  async ready() {
    this.readyReads += 1;
    return { ok: true, version: 5 };
  }

  addTask(projectId, task) {
    const committed = { ...task, projectId };
    this.added.push(committed);
    return committed;
  }

  getPriorityCache() {
    this.priorityReads += 1;
    return this.priority.map(task => ({ ...task }));
  }
}

function loadTaskServiceClass() {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'services', 'TaskService.js'), 'utf8');
  const classStart = source.indexOf('class TaskService');
  assert.ok(classStart > -1, 'TaskService class must remain present');

  let executable = source.slice(classStart);
  executable = executable.replace(/\/\/ Singleton export[\s\S]*$/, 'globalThis.__TaskServiceClass = TaskService;');

  const noop = () => {};
  const windowRef = {
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    location: { href: 'http://gpace.test/' }
  };
  const documentRef = { addEventListener: noop };
  const context = {
    console,
    Date,
    Error,
    Math,
    Map,
    Number,
    Object,
    Promise,
    Set,
    String,
    JSON,
    window: windowRef,
    document: documentRef,
    localStorage: {
      length: 0,
      getItem: () => null,
      setItem: noop,
      removeItem: noop,
      key: () => null
    },
    storageService: makeStorage(),
    TaskRepository: {},
    saveTasksToFirestore: async () => {},
    loadTasksFromFirestore: async () => [],
    saveCompletedTaskToFirestore: async () => {},
    waitForAuth: async () => {},
    getFirestore: noop,
    doc: noop,
    onSnapshot: noop,
    getAuth: noop,
    getApps: () => [],
    getApp: noop,
    initializeApp: noop,
    firebaseConfig: {}
  };

  vm.runInNewContext(executable, context, { filename: 'TaskService.js' });
  return context.__TaskServiceClass;
}

describe('Step 43: validated TaskService and canonical display bridge', () => {
  it('rejects malformed IDs and repository-owned default overrides before commit', async () => {
    const TaskService = loadTaskServiceClass();
    const repository = new FakeRepository();
    const service = new TaskService({ repository, storage: makeStorage() });

    await assert.rejects(
      () => service.createTask('project-1', { id: 'bad\u0000id', title: 'Invalid' }),
      /Task ID is malformed/
    );
    await assert.rejects(
      () => service.createTask('project-1', { id: 'task-1', updatedAt: 'forged' }),
      /updatedAt is assigned by the repository/
    );
    await assert.rejects(
      () => service.createTask('project-1', { id: 'task-2', completed: true }),
      /completed is assigned by the repository/
    );

    const created = await service.createTask(' project-1 ', {
      id: 'task-3',
      title: 'Validated task',
      completed: false,
      ignoredField: 'dropped'
    });

    assert.equal(repository.added.length, 1);
    assert.equal(created.projectId, 'project-1');
    assert.equal(created.completed, false);
    assert.equal(created.deleted, false);
    assert.equal(created.revision, 0);
    assert.equal(Object.hasOwn(created, 'ignoredField'), false);
    assert.equal(service.metrics.operations.create, 1);
  });

  it('rolls back a failed local commit without publishing new cache or version state', async () => {
    const TaskService = loadTaskServiceClass();
    const oldTask = { id: 'task-1', projectId: 'project-1', title: 'Old', completed: false, deleted: false };
    const storage = makeStorage({
      'tasks-project-1': [oldTask],
      'tasks-project-1-version': 41
    }, { failKey: 'tasks-project-1-version' });
    const service = new TaskService({ repository: new FakeRepository(), storage });
    service._updateCache('project-1', [oldTask]);

    await assert.rejects(
      () => service._saveLocal('project-1', [{ ...oldTask, title: 'Uncommitted' }]),
      /Unable to persist tasks-project-1-version/
    );

    assert.deepEqual(storage.get('tasks-project-1', []), [oldTask]);
    assert.equal(storage.get('tasks-project-1-version', null), 41);
    assert.deepEqual(service.getCachedTasks('project-1'), [oldTask]);
  });

  it('keeps stale pending data from reviving a tombstone but accepts a newer explicit reopen', () => {
    const TaskService = loadTaskServiceClass();
    const service = new TaskService({ repository: new FakeRepository(), storage: makeStorage() });
    const deleted = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Deleted task',
      deleted: true,
      completed: false,
      revision: 5,
      updatedAt: '2026-09-29T10:00:00.000Z'
    };
    const stalePending = {
      ...deleted,
      deleted: false,
      pending: true,
      revision: 6,
      updatedAt: '2026-09-29T11:00:00.000Z'
    };

    const staleMerge = service._mergeTasks([deleted], [stalePending]);
    assert.equal(staleMerge.length, 1);
    assert.equal(staleMerge[0].deleted, true);
    assert.equal(staleMerge[0].pending, undefined);

    const reopened = {
      ...stalePending,
      revision: 7,
      updatedAt: '2026-09-29T12:00:00.000Z',
      reopen: true
    };
    const reopenMerge = service._mergeTasks([deleted], [reopened]);
    assert.equal(reopenMerge.length, 1);
    assert.equal(reopenMerge[0].deleted, false);
    assert.equal(reopenMerge[0].completed, false);
    assert.equal(reopenMerge[0].reopen, true);
  });

  it('uses the canonical TaskService facade for exactly one display read', async () => {
    const TaskService = loadTaskServiceClass();
    const repository = new FakeRepository();
    repository.priority = [{
      id: 'task-1',
      projectId: 'project-1',
      title: 'Canonical task',
      section: 'General',
      completed: false,
      deleted: false
    }];
    const service = new TaskService({ repository, storage: makeStorage() });

    const moduleUrl = new URL(`file:///${path.join(ROOT, 'js', 'controllers', 'TaskDisplayController.js').replace(/\\/g, '/')}`).href;
    const { TaskDisplayController } = await import(moduleUrl);
    const priorityStorageReads = [];
    const storage = {
      get(key, fallback) {
        priorityStorageReads.push(key);
        if (key === 'calculatedPriorityTasks') throw new Error('legacy priority storage must not be read');
        return fallback;
      }
    };
    const windowRef = {
      TaskService: service,
      addEventListener() {},
      removeEventListener() {},
      PriorityListSorter: { applySavedSort() {} }
    };
    const documentRef = { getElementById: id => id === 'priorityTaskBox' ? {} : null };
    const controller = new TaskDisplayController({ document: documentRef, window: windowRef, storage });
    controller.init({ document: documentRef, window: windowRef, storage });
    const rendered = [];
    controller._renderTask = task => rendered.push(task);

    assert.equal(await controller._displayPriorityTaskImpl(true), true);
    assert.equal(repository.priorityReads, 1);
    assert.deepEqual(priorityStorageReads, []);
    assert.equal(rendered[0].id, 'task-1');
  });
});
