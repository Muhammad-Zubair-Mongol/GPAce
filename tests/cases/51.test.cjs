/**
 * Step 51: awaited conflict coordination and revision-safe resolution.
 *
 * These fixtures load the production repository and modal source in isolated
 * VM contexts. Storage is an in-memory Web Storage implementation with
 * targeted durability failures; no Firebase, Firestore, or production data
 * is reachable from this case.
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

function makeStorage({ failWhen = null } = {}) {
  const values = new Map();
  let failureUsed = false;
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      const normalizedKey = String(key);
      if (!failureUsed && typeof failWhen === 'function' && failWhen(normalizedKey, value)) {
        failureUsed = true;
        throw new Error(`fixture durability failure at ${normalizedKey}`);
      }
      values.set(normalizedKey, String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    disableFailure() {
      failureUsed = true;
    },
    setFailureWhen(handler) {
      failWhen = handler;
      failureUsed = false;
    },
    dump() {
      return new Map(values);
    }
  };
}

function makeEventTarget() {
  const listeners = new Map();
  return {
    adds: [],
    removes: [],
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
      this.adds.push({ type, callback });
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
      this.removes.push({ type, callback });
    },
    dispatchEvent(event) {
      for (const callback of Array.from(listeners.get(event.type) || [])) callback(event);
      return true;
    },
    listenerCount(type) {
      return (listeners.get(type) || new Set()).size;
    }
  };
}

class FixtureCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

function loadTaskRepository(storage) {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'core', 'TaskRepository.js'), 'utf8');
  let executable = source.replace('export const ENVELOPE_STATUS', 'const ENVELOPE_STATUS');
  executable = executable.replace(/\/\/ Export for ES modules[\s\S]*$/, 'globalThis.__TaskRepository = TaskRepository;');

  const windowRef = makeEventTarget();
  windowRef.localStorage = storage;
  const documentRef = makeEventTarget();
  documentRef.visibilityState = 'hidden';
  const sessionStorage = makeStorage();
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
    CustomEvent: FixtureCustomEvent,
    BroadcastChannel: undefined,
    window: windowRef,
    localStorage: storage,
    sessionStorage,
    document: documentRef,
    setInterval: () => ({ fixtureInterval: true }),
    clearInterval() {}
  };
  vm.runInNewContext(executable, context, { filename: 'TaskRepository.js' });
  const TaskRepository = context.__TaskRepository;
  TaskRepository.setStorageBackend(storage);
  TaskRepository.setUser('step51-user');
  return { TaskRepository, windowRef };
}

function loadConflictModalListener(repository) {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'components', 'ConflictModal.js'), 'utf8');
  const classStart = source.indexOf('class ConflictModal');
  const autoInit = source.indexOf('// Auto-init when DOM is ready');
  assert.ok(classStart > -1 && autoInit > classStart, 'ConflictModal class boundary must remain present');

  const windowRef = makeEventTarget();
  windowRef.TaskRepository = repository;
  const documentRef = makeEventTarget();
  const context = {
    console,
    Date,
    Map,
    Set,
    JSON,
    Promise,
    window: windowRef,
    document: documentRef
  };
  const executable = `${source.slice(classStart, autoInit)}\nglobalThis.__ConflictModal = ConflictModal;`;
  vm.runInNewContext(executable, context, { filename: 'ConflictModal.js' });
  const ConflictModal = context.__ConflictModal;
  ConflictModal._listenersBound = false;
  ConflictModal._setupEventListeners();
  return { ConflictModal, windowRef, documentRef };
}

function seedProject(TaskRepository, storage, projectId, tasks, revision = 1, completed = []) {
  TaskRepository._writeV5(
    TaskRepository._getScopedKey(`tasks_v5.${projectId}`),
    tasks,
    true
  );
  TaskRepository._writeV5(
    TaskRepository._getScopedKey(`completed_v5.${projectId}`),
    completed,
    true
  );
  TaskRepository._writeProjectRevision(projectId, revision);
  return TaskRepository._snapshotProject(projectId);
}

function installModal(windowRef, choices, calls = []) {
  windowRef.ConflictModal = {
    show(localData, remoteData) {
      calls.push({ localData: clone(localData), remoteData: clone(remoteData) });
      const next = choices.shift();
      return typeof next === 'function' ? next(localData, remoteData) : Promise.resolve(next);
    }
  };
  return calls;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  assert.fail(message);
}

function task(id, title, extra = {}) {
  return { id, title, projectId: extra.projectId || 'project-1', completed: false, deleted: false, ...extra };
}

describe('Step 51: awaited conflict coordination and revision safety', () => {
  it('durably applies local, remote, and deterministic merge choices and acknowledges after persistence', async () => {
    for (const choice of ['local', 'remote', 'merge']) {
      const storage = makeStorage();
      const { TaskRepository, windowRef } = loadTaskRepository(storage);
      const projectId = `choice-${choice}`;
      const localTask = task('shared', `local-${choice}`, { projectId, revision: 1 });
      const remoteTask = task('shared', `remote-${choice}`, { projectId, revision: 2 });
      const uniqueRemote = task('remote-only', 'remote unique', { projectId, revision: 2 });
      const local = seedProject(TaskRepository, storage, projectId, [localTask], 1);
      const remote = {
        projectId,
        revision: 2,
        active: [remoteTask, uniqueRemote],
        completed: [],
        tasks: [remoteTask, uniqueRemote],
        ts: Date.now(),
        source: 'other-device'
      };
      const calls = [];
      installModal(windowRef, [choice], calls);
      const synced = [];
      TaskRepository.onRemoteChange((event, detail) => {
        if (event === 'SYNCED') synced.push(detail);
      });

      const result = await TaskRepository.enqueueConflict(local, remote);
      assert.equal(result.status, 'resolved');
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].localData.active.map(item => item.title), [`local-${choice}`]);
      assert.equal(calls[0].remoteData.revision, 2);
      assert.equal(TaskRepository.getProjectRevision(projectId), 3);
      assert.equal(synced.length, 1, `${choice} must publish one synced acknowledgement`);
      assert.equal(synced[0].acknowledged, true);

      const current = TaskRepository.getAllTasks(projectId);
      if (choice === 'local') {
        assert.deepEqual(current.map(item => item.title), [`local-${choice}`]);
      } else if (choice === 'remote') {
        assert.deepEqual(current.map(item => item.title), [`remote-${choice}`, 'remote unique']);
      } else {
        assert.deepEqual(current.map(item => item.id), ['remote-only', 'shared']);
        assert.deepEqual(current.map(item => item.title), ['remote unique', `remote-${choice}`]);
      }

      const record = TaskRepository.getConflictRecord(result.conflictId);
      assert.equal(record.status, 'resolved');
      assert.deepEqual(record.local.active, local.active);
      assert.deepEqual(record.remote.active, [remoteTask, uniqueRemote]);
      TaskRepository.destroy();
    }
  });

  it('keeps cancel/defer recoverable and resumes without a false synced acknowledgement', async () => {
    const storage = makeStorage();
    const { TaskRepository, windowRef } = loadTaskRepository(storage);
    const projectId = 'deferred-project';
    const local = seedProject(TaskRepository, storage, projectId, [task('local', 'keep local', { projectId })], 4);
    const remote = {
      projectId,
      revision: 5,
      active: [task('remote', 'keep remote', { projectId, revision: 5 })],
      completed: [],
      tasks: [task('remote', 'keep remote', { projectId, revision: 5 })]
    };
    const choices = [{ action: 'cancel' }, 'remote'];
    installModal(windowRef, choices);
    const synced = [];
    TaskRepository.onRemoteChange((event, detail) => {
      if (event === 'SYNCED') synced.push(detail);
    });

    const deferred = await TaskRepository.enqueueConflict(local, remote);
    assert.equal(deferred.status, 'deferred');
    assert.equal(deferred.recoverable, true);
    assert.equal(synced.length, 0);
    assert.equal(TaskRepository.getConflictState().deferredIds.length, 1);
    assert.equal(TaskRepository.getConflictRecord(deferred.id).status, 'deferred');
    assert.equal(TaskRepository.getAllTasks(projectId)[0].title, 'keep local');

    const resumed = await TaskRepository.resumeConflict(deferred.id);
    assert.equal(resumed.status, 'resolved');
    assert.equal(synced.length, 1);
    assert.equal(TaskRepository.getAllTasks(projectId)[0].title, 'keep remote');
    TaskRepository.destroy();
  });

  it('leaves rejected persistence actionable and retries the same preserved revisions', async () => {
    const projectId = 'failure-project';
    const taskKey = `gpac_u_step51-user_tasks_v5.${projectId}`;
    const storage = makeStorage();
    const { TaskRepository, windowRef } = loadTaskRepository(storage);
    const localTask = task('failure-local', 'local survives', { projectId });
    const local = seedProject(TaskRepository, storage, projectId, [localTask], 1);
    storage.setFailureWhen(key => key === taskKey);
    const remote = {
      projectId,
      revision: 2,
      active: [task('failure-remote', 'remote candidate', { projectId })],
      completed: [],
      tasks: [task('failure-remote', 'remote candidate', { projectId })]
    };
    const calls = [];
    installModal(windowRef, ['remote', 'remote'], calls);
    const synced = [];
    const failures = [];
    TaskRepository.onRemoteChange((event, detail) => {
      if (event === 'SYNCED') synced.push(detail);
      if (event === 'CONFLICT_FAILED') failures.push(detail);
    });

    const failed = await TaskRepository.enqueueConflict(local, remote);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.recoverable, true);
    assert.equal(failures.length, 1);
    assert.equal(synced.length, 0);
    assert.equal(TaskRepository.getConflictState().showing, true);
    assert.equal(TaskRepository.getConflictRecord(failed.id).status, 'failed');
    assert.deepEqual(TaskRepository.getAllTasks(projectId).map(item => item.id), [localTask.id]);

    storage.disableFailure();
    const retried = await TaskRepository.retryConflict(failed.id);
    assert.equal(retried.status, 'resolved');
    assert.equal(calls.length, 2);
    assert.equal(synced.length, 1);
    assert.deepEqual(TaskRepository.getAllTasks(projectId).map(item => item.id), ['failure-remote']);
    const record = TaskRepository.getConflictRecord(failed.id);
    assert.equal(record.status, 'resolved');
    assert.deepEqual(record.local.active.map(item => item.id), [localTask.id]);
    assert.equal(record.remote.active[0].id, 'failure-remote');
    TaskRepository.destroy();
  });

  it('awaits one modal resolver and processes a later conflict in order', async () => {
    const storage = makeStorage();
    const { TaskRepository, windowRef } = loadTaskRepository(storage);
    const firstProject = 'ordered-first';
    const secondProject = 'ordered-second';
    const firstLocal = seedProject(TaskRepository, storage, firstProject, [task('first-local', 'first local', { projectId: firstProject })], 1);
    const secondLocal = seedProject(TaskRepository, storage, secondProject, [task('second-local', 'second local', { projectId: secondProject })], 1);
    const remoteForFirst = {
      projectId: firstProject,
      revision: 2,
      active: [task('first-remote', 'first remote', { projectId: firstProject })],
      completed: []
    };
    const remoteForSecond = {
      projectId: secondProject,
      revision: 2,
      active: [task('second-remote', 'second remote', { projectId: secondProject })],
      completed: []
    };
    const resolvers = [];
    const calls = [];
    installModal(windowRef, [
      () => new Promise(resolve => resolvers.push(resolve)),
      () => new Promise(resolve => resolvers.push(resolve))
    ], calls);

    const firstPromise = TaskRepository.enqueueConflict(firstLocal, remoteForFirst);
    await flush();
    assert.equal(calls.length, 1);
    const secondPromise = TaskRepository.enqueueConflict(secondLocal, remoteForSecond);
    await flush();
    assert.equal(calls.length, 1, 'second conflict must wait for the first resolver');
    resolvers[0]('remote');
    const firstResult = await firstPromise;
    assert.equal(firstResult.status, 'resolved');
    await waitFor(() => calls.length === 2, 'queued second conflict was not presented after first acknowledgement');
    resolvers[1]('local');
    const secondResult = await secondPromise;
    assert.equal(secondResult.status, 'resolved');
    assert.deepEqual(TaskRepository.getAllTasks(firstProject).map(item => item.id), ['first-remote']);
    assert.deepEqual(TaskRepository.getAllTasks(secondProject).map(item => item.id), ['second-local']);
    assert.equal(TaskRepository.getConflictRecord(firstResult.conflictId).status, 'resolved');
    assert.equal(TaskRepository.getConflictRecord(secondResult.conflictId).status, 'resolved');
    TaskRepository.destroy();
  });

  it('reopens reconciliation when an unseen revision arrives while the modal is open', async () => {
    const storage = makeStorage();
    const { TaskRepository, windowRef } = loadTaskRepository(storage);
    const projectId = 'concurrent-project';
    const local = seedProject(TaskRepository, storage, projectId, [task('base', 'base local', { projectId })], 1);
    const remote = {
      projectId,
      revision: 2,
      active: [task('remote', 'remote choice', { projectId, revision: 2 })],
      completed: []
    };
    const calls = [];
    installModal(windowRef, ['local', 'remote'], calls);
    const synced = [];
    TaskRepository.onRemoteChange((event, detail) => {
      if (event === 'SYNCED') synced.push(detail);
    });

    const original = TaskRepository.enqueueConflict(local, remote);
    await flush();
    assert.equal(calls.length, 1);

    // Simulate a newer local edit that was not included in the modal's local
    // revision. The first local choice must be rejected and reopened.
    const unseen = task('unseen', 'unseen local revision', { projectId, revision: 3 });
    TaskRepository._writeV5(TaskRepository._getScopedKey(`tasks_v5.${projectId}`), [unseen], true);
    TaskRepository._writeProjectRevision(projectId, 2);
    const firstResult = await original;
    assert.equal(firstResult.status, 'reopened');
    assert.equal(firstResult.recoverable, true);
    await waitFor(() => calls.length === 2, 'concurrent revision did not reopen the conflict');
    await waitFor(() => TaskRepository.getConflictState().showing === false, 'reopened conflict did not finish');

    assert.equal(synced.length, 1);
    assert.deepEqual(TaskRepository.getAllTasks(projectId).map(item => item.id), ['remote']);
    const originalRecord = TaskRepository.getConflictRecord(firstResult.id);
    assert.equal(originalRecord.status, 'reopened');
    const reopenedRecord = TaskRepository.getConflictRecord(firstResult.nextId);
    assert.equal(reopenedRecord.status, 'resolved');
    assert.equal(reopenedRecord.before.revision, 2);
    TaskRepository.destroy();
  });

  it('delegates browser conflict events to the repository coordinator instead of creating a competing resolver', () => {
    const calls = [];
    const repository = {
      enqueueConflict(localData, remoteData, options) {
        calls.push({ localData, remoteData, options });
        return Promise.resolve({ status: 'queued' });
      }
    };
    const { ConflictModal, windowRef } = loadConflictModalListener(repository);
    windowRef.dispatchEvent(new FixtureCustomEvent('gpac_conflict', {
      detail: {
        conflictId: 'modal-event-1',
        localData: { projectId: 'modal-project', revision: 1 },
        remoteChange: { projectId: 'modal-project', revision: 2 }
      }
    }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.id, 'modal-event-1');
    assert.equal(calls[0].localData.revision, 1);
    assert.equal(calls[0].remoteData.revision, 2);
    assert.equal(ConflictModal._currentRequest, null);
  });
});
