/**
 * Step 44: queue acknowledgement and cross-tab lifecycle.
 *
 * These fixtures run the production classes in isolated VM contexts so every
 * assertion observes the real queue, browser listener, storage, and repository
 * behavior without connecting to Firestore or production data.
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

function makeAdapterStorage(initial = {}, { failMode = null } = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
  const storage = {
    values,
    failMode,
    get(key, fallback) {
      return values.has(key) ? clone(values.get(key)) : fallback;
    },
    set(key, value) {
      if (this.failMode && this.failMode(key, value)) return false;
      values.set(key, clone(value));
      return { success: true, status: 'success' };
    },
    remove(key) {
      values.delete(key);
      return { success: true, status: 'success' };
    }
  };
  return storage;
}

function makeWebStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    get length() {
      return values.size;
    },
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
    values
  };
}

function makeEventTarget(extra = {}) {
  const listeners = new Map();
  const adds = [];
  const removes = [];
  const target = {
    ...extra,
    adds,
    removes,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
      adds.push({ type, callback });
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
      removes.push({ type, callback });
    },
    dispatchEvent(event) {
      const callbacks = listeners.get(event.type) || [];
      for (const callback of Array.from(callbacks)) callback(event);
      return true;
    },
    listenerCount(type) {
      return (listeners.get(type) || new Set()).size;
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

function loadDataSyncManager({ storage, repository, eventTarget, isOnline = false, now = () => Date.now() }) {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'data-sync-manager.js'), 'utf8');
  const classStart = source.indexOf('const SYNC_INTERVAL');
  assert.ok(classStart > -1, 'DataSyncManager constants must remain present');
  let executable = source.slice(classStart);
  executable = executable.replace(/\/\/ Create and export singleton instance[\s\S]*$/, 'globalThis.__DataSyncManager = DataSyncManager;');

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
    window: eventTarget,
    navigator: { onLine: isOnline },
    getStorage: () => storage,
    DataRepository: repository,
    setInterval: () => ({ fixtureInterval: true }),
    clearInterval() {},
    now
  };
  vm.runInNewContext(executable, context, { filename: 'data-sync-manager.js' });
  return context.__DataSyncManager;
}

function loadCrossTabSync() {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'cross-tab-sync.js'), 'utf8');
  const singletonStart = source.indexOf('// Export a singleton instance');
  assert.ok(singletonStart > -1, 'CrossTabSync singleton boundary must remain present');
  let executable = source.slice(0, singletonStart);
  executable += '\nglobalThis.__CrossTabSync = CrossTabSync;';

  const context = {
    console,
    Date,
    Math,
    Map,
    Set,
    JSON,
    CustomEvent: FixtureCustomEvent
  };
  vm.runInNewContext(executable, context, { filename: 'cross-tab-sync.js' });
  return context.__CrossTabSync;
}

function loadTaskRepository({ storage, windowRef, sessionStorage, BroadcastChannel }) {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'core', 'TaskRepository.js'), 'utf8');
  let executable = source.replace('export const ENVELOPE_STATUS', 'const ENVELOPE_STATUS');
  executable = executable.replace(/\/\/ Export for ES modules[\s\S]*$/, 'globalThis.__TaskRepository = TaskRepository;');

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
    BroadcastChannel,
    window: windowRef,
    localStorage: storage,
    sessionStorage,
    document: makeEventTarget({ visibilityState: 'hidden' }),
    setInterval: () => ({ fixtureInterval: true }),
    clearInterval() {}
  };
  vm.runInNewContext(executable, context, { filename: 'TaskRepository.js' });
  return context.__TaskRepository;
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

describe('Step 44: sync queue acknowledgement and cross-tab lifecycle', () => {
  it('retains unsupported queue entries as inspectable failures', async () => {
    const storage = makeAdapterStorage();
    const target = makeEventTarget();
    const managerClass = loadDataSyncManager({
      storage,
      repository: {},
      eventTarget: target,
      isOnline: false,
      now: () => 1000
    });
    const manager = new managerClass({ eventTarget: target, isOnline: false, now: () => 1000 });

    manager.queueSync({ id: 'unsupported-1', type: 'future-operation', data: { value: 1 } });
    const result = await manager.processSyncQueue();

    assert.equal(result.status, 'pending');
    assert.equal(result.committed, false);
    assert.equal(manager.syncQueue.length, 1);
    assert.equal(manager.syncQueue[0].status, 'failed');
    assert.match(manager.syncQueue[0].lastError, /Unsupported sync type/);
    assert.deepEqual(storage.get('dataSyncQueue', []), JSON.parse(JSON.stringify(manager.syncQueue)));
    assert.equal(storage.get('lastSyncTimestamp', null), null);
    manager.destroy();
  });

  it('releases isSyncing when failed queue-state persistence rejects', async () => {
    let failQueuePersistence = true;
    const storage = makeAdapterStorage({}, {
      failMode: key => key === 'dataSyncQueue' && failQueuePersistence
    });
    const target = makeEventTarget();
    const managerClass = loadDataSyncManager({
      storage,
      repository: {},
      eventTarget: target,
      isOnline: false,
      now: () => 2000
    });
    const manager = new managerClass({ eventTarget: target, isOnline: false, now: () => 2000 });
    manager.syncQueue = [{ id: 'unsupported-2', type: 'not-supported', data: {} }];

    const failedSave = await manager.processSyncQueue();
    assert.equal(failedSave.status, 'error');
    assert.equal(failedSave.persisted, false);
    assert.equal(manager.isSyncing, false);

    failQueuePersistence = false;
    const retry = await manager.processSyncQueue();
    assert.equal(retry.status, 'pending');
    assert.equal(manager.isSyncing, false);
    assert.equal(manager.syncQueue[0].attempts, 2);
    manager.destroy();
  });

  it('does not advance the successful sync timestamp for a failed batch', async () => {
    const storage = makeAdapterStorage({ lastSyncTimestamp: 1234 });
    const target = makeEventTarget();
    const managerClass = loadDataSyncManager({
      storage,
      repository: {},
      eventTarget: target,
      isOnline: false,
      now: () => 5000
    });
    const manager = new managerClass({ eventTarget: target, isOnline: false, now: () => 5000 });
    manager.syncQueue = [{ id: 'failed-1', type: 'missing-save-handler', data: {} }];

    const result = await manager.processSyncQueue();

    assert.equal(result.status, 'pending');
    assert.equal(storage.get('lastSyncTimestamp', null), 1234);
    assert.equal(storage.get('lastSyncAttemptTimestamp', null), 5000);
    assert.equal(manager.getStatus().lastSync, 1234);
    assert.equal(manager.getStatus().lastAttempt, 5000);
    manager.destroy();
  });

  it('removes exact lifecycle handlers on destroy for the queue and cross-tab managers', () => {
    const storage = makeAdapterStorage();
    const target = makeEventTarget();
    const managerClass = loadDataSyncManager({
      storage,
      repository: {},
      eventTarget: target,
      isOnline: false
    });
    const manager = new managerClass({ eventTarget: target, isOnline: false });
    manager.init();
    assert.equal(target.adds.filter(entry => entry.type === 'online').length, 1);
    assert.equal(target.adds.filter(entry => entry.type === 'offline').length, 1);
    assert.equal(target.adds.filter(entry => entry.type === 'storage').length, 1);
    manager.destroy();
    assert.equal(target.removes.length, 3);
    assert.equal(target.listenerCount('online'), 0);
    assert.equal(target.listenerCount('offline'), 0);
    assert.equal(target.listenerCount('storage'), 0);

    const CrossTabSync = loadCrossTabSync();
    const browser = makeEventTarget({
      location: { pathname: '/priority-calculator.html' },
      CustomEvent: FixtureCustomEvent
    });
    const tab = new CrossTabSync('lifecycle', {
      window: browser,
      storage: makeWebStorage(),
      BroadcastChannel: SharedBroadcastChannel
    });
    tab.setupStorageListener();
    assert.equal(browser.listenerCount('storage'), 2);
    tab.destroy();
    assert.equal(browser.listenerCount('storage'), 0);
    assert.equal(tab.channel.closed, true);
  });

  it('updates task UI across tabs without navigation and preserves an unsaved editor draft', () => {
    const CrossTabSync = loadCrossTabSync();
    const sharedStorage = makeWebStorage();
    let reloads = 0;
    const tabAWindow = makeEventTarget({
      location: { pathname: '/priority-calculator.html' },
      CustomEvent: FixtureCustomEvent
    });
    const tabBWindow = makeEventTarget({
      location: { pathname: '/priority-calculator.html', reload: () => { reloads += 1; } },
      CustomEvent: FixtureCustomEvent
    });
    const tabA = new CrossTabSync('tasks', {
      window: tabAWindow,
      storage: sharedStorage,
      BroadcastChannel: SharedBroadcastChannel
    });
    const tabB = new CrossTabSync('tasks', {
      window: tabBWindow,
      storage: sharedStorage,
      BroadcastChannel: SharedBroadcastChannel
    });
    tabA.setupStorageListener();
    tabB.setupStorageListener();

    const editorDraft = { title: 'local unsaved draft', description: 'keep this text' };
    const taskUi = [];
    tabBWindow.addEventListener('gpace:task-update', event => taskUi.push(event.detail));
    tabA.broadcastAction('task-update', {
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Remote committed title'
    });

    assert.equal(reloads, 0);
    assert.deepEqual(editorDraft, { title: 'local unsaved draft', description: 'keep this text' });
    assert.equal(taskUi.length, 1);
    assert.equal(taskUi[0].title, 'Remote committed title');

    const repoStorage = makeWebStorage();
    const repoWindow = makeEventTarget({
      location: { pathname: '/priority-calculator.html', reload: () => { reloads += 1; } },
      CustomEvent: FixtureCustomEvent
    });
    const repoSessionStorage = makeWebStorage();
    const TaskRepository = loadTaskRepository({
      storage: repoStorage,
      windowRef: repoWindow,
      sessionStorage: repoSessionStorage,
      BroadcastChannel: SharedBroadcastChannel
    });
    TaskRepository.setStorageBackend(repoStorage);
    TaskRepository.setUser('draft-safe-user');
    TaskRepository._writeV5(
      TaskRepository._getScopedKey('tasks_v5.project-1'),
      [{ id: 'task-1', projectId: 'project-1', title: 'Remote committed title', completed: false }],
      true
    );

    const repositoryUi = [];
    const repositoryDraft = { title: 'editor has not been saved' };
    TaskRepository.onRemoteChange((event, detail) => {
      if (event === 'TASKS_INVALIDATED') repositoryUi.push(detail.tasks);
    });
    TaskRepository.handleRemoteChange({
      type: 'GPAC_SYNC',
      event: 'TASKS_REPLACED',
      version: 5,
      ts: Date.now(),
      deviceId: 'other-tab',
      scope: 'gpac_u_draft-safe-user_',
      data: { projectId: 'project-1' }
    });

    assert.equal(reloads, 0);
    assert.deepEqual(repositoryDraft, { title: 'editor has not been saved' });
    assert.equal(repositoryUi.length, 1);
    assert.equal(repositoryUi[0][0].id, 'task-1');
    assert.equal(repositoryUi[0][0].title, 'Remote committed title');

    TaskRepository.destroy();
    tabA.destroy();
    tabB.destroy();
  });
});
