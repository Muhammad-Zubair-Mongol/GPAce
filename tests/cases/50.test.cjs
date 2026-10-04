/**
 * Step 50: recoverable atomic task completion.
 * The fixtures use isolated canonical envelopes, injected storage failures, and
 * in-memory broadcast channels. No production account or endpoint is touched.
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

function makeStorage() {
  const values = new Map();
  const controller = { writes: [], failAt: null, failOnce: true };
  const storage = {
    controller,
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
      controller.writes.push(normalizedKey);
      if (controller.failAt !== null && controller.writes.length === controller.failAt && controller.failOnce) {
        controller.failOnce = false;
        throw new Error(`fixture durability failure at ${normalizedKey}`);
      }
      values.set(normalizedKey, String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    resetFailureCounter() {
      controller.writes = [];
      controller.failOnce = true;
    },
    dump() {
      return new Map(values);
    }
  };
  return storage;
}

class SharedBroadcastChannel {
  static peers = new Map();

  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
    if (!SharedBroadcastChannel.peers.has(name)) SharedBroadcastChannel.peers.set(name, new Set());
    SharedBroadcastChannel.peers.get(name).add(this);
  }

  postMessage(message) {
    if (this.closed) return;
    for (const peer of SharedBroadcastChannel.peers.get(this.name) || []) {
      if (peer !== this && !peer.closed && typeof peer.onmessage === 'function') {
        peer.onmessage({ data: clone(message) });
      }
    }
  }

  close() {
    this.closed = true;
    SharedBroadcastChannel.peers.get(this.name)?.delete(this);
  }
}

function makeEventTarget() {
  const listeners = new Map();
  return {
    localStorage: null,
    location: { reload() {} },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    dispatchEvent(event) {
      for (const callback of Array.from(listeners.get(event.type) || [])) callback(event);
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
  const sessionStorage = makeStorage();
  const documentRef = makeEventTarget();
  documentRef.visibilityState = 'hidden';
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
    BroadcastChannel: SharedBroadcastChannel,
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
  TaskRepository.setUser('step50-user');
  return { TaskRepository, windowRef, sessionStorage };
}

function seedProject(TaskRepository, storage, projectId = 'project-1') {
  const task = {
    id: 'task-1',
    projectId,
    title: 'Recoverable task',
    completed: false,
    deleted: false
  };
  const envelope = {
    version: 5,
    schema: 'gpac_v5',
    generatedAt: new Date().toISOString(),
    deviceId: 'writer-device',
    checksum: TaskRepository._calculateChecksum([task]),
    data: [task]
  };
  storage.setItem(TaskRepository._getScopedKey(`tasks_v5.${projectId}`), JSON.stringify(envelope));
  storage.setItem(TaskRepository._getScopedKey('migration_done_v5'), 'true');
  storage.setItem(TaskRepository._getScopedKey('schema_version'), '5');
  storage.resetFailureCounter();
  return task;
}

function taskPresence(TaskRepository, projectId = 'project-1') {
  const active = TaskRepository.getAllTasks(projectId).filter(task => task.id === 'task-1');
  const completed = TaskRepository.getCompletedTasks(projectId).filter(task => task.id === 'task-1');
  return { active, completed };
}

describe('Step 50: recoverable atomic task completion', () => {
  it('keeps a task visible in one durable view across every injected write boundary and retries idempotently', () => {
    // The first several writes cover the journal, active snapshot, phase marker,
    // completed snapshot, commit marker, and cache/sync side effects. Each run
    // fails once at a distinct boundary and then retries with storage healthy.
    for (let failureAt = 1; failureAt <= 10; failureAt += 1) {
      const storage = makeStorage();
      const { TaskRepository } = loadTaskRepository(storage);
      seedProject(TaskRepository, storage);
      storage.controller.failAt = failureAt;

      let thrown = false;
      try {
        TaskRepository.completeTask('project-1', 'task-1');
      } catch (error) {
        thrown = true;
        assert.match(error.message, /durability failure|Completion transition/);
      }

      const afterFailure = taskPresence(TaskRepository);
      assert.equal(
        afterFailure.active.length + afterFailure.completed.length,
        1,
        `failure boundary ${failureAt} must leave the task recoverable${thrown ? '' : ' when the boundary was after commit'}`
      );

      storage.controller.failAt = null;
      storage.resetFailureCounter();
      const retry = TaskRepository.completeTask('project-1', 'task-1');
      assert.equal(retry.id, 'task-1');
      const afterRetry = taskPresence(TaskRepository);
      assert.equal(afterRetry.active.length, 0, `retry ${failureAt} must remove active task`);
      assert.equal(afterRetry.completed.length, 1, `retry ${failureAt} must create one history item`);

      const idempotentRetry = TaskRepository.completeTask('project-1', 'task-1');
      assert.equal(idempotentRetry.id, 'task-1');
      assert.equal(TaskRepository.getCompletedTasks('project-1').filter(task => task.id === 'task-1').length, 1);
      TaskRepository.destroy();
    }
  });

  it('restores migrated legacy data from an acknowledged backup', async () => {
    const storage = makeStorage();
    const { TaskRepository } = loadTaskRepository(storage);
    TaskRepository.setUser(null);
    storage.setItem('tasks-history-project', JSON.stringify([
      { id: 'legacy-1', title: 'Migrated history task', completed: false }
    ]));
    storage.resetFailureCounter();

    const migration = await TaskRepository.migrateOldData();
    assert.equal(migration.success, true);
    assert.equal(TaskRepository.getAllTasks('history-project')[0].id, 'legacy-1');
    const canonicalKey = TaskRepository._getScopedKey('tasks_v5.history-project');
    assert.ok(storage.getItem(canonicalKey));
    assert.ok(TaskRepository.listBackups().some(backup => backup.slot === 'manual'));

    storage.removeItem(canonicalKey);
    assert.equal(TaskRepository.getAllTasks('history-project').length, 0);
    assert.equal(TaskRepository.forceRecoveryFromBackup('manual'), true);
    assert.equal(TaskRepository.getAllTasks('history-project')[0].id, 'legacy-1');
    TaskRepository.destroy();
  });

  it('publishes one committed transition to a cross-tab observer', () => {
    const storage = makeStorage();
    const writer = loadTaskRepository(storage).TaskRepository;
    seedProject(writer, storage);

    const observerContext = loadTaskRepository(storage);
    const observer = observerContext.TaskRepository;
    observer._getDeviceId = () => 'observer-device';
    observer._setupBroadcastListener();
    const transitions = [];
    observer.onRemoteChange((event, detail) => {
      if (event === 'TASK_COMPLETED') transitions.push(detail);
    });

    writer.completeTask('project-1', 'task-1');

    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].taskId, 'task-1');
    assert.equal(transitions[0].operationId, writer._readCompletionTransaction('project-1').operationId);
    assert.equal(observer.getAllTasks('project-1').length, 0);
    assert.equal(observer.getCompletedTasks('project-1').filter(task => task.id === 'task-1').length, 1);

    writer.destroy();
    observer.destroy();
  });
});
