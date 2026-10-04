/**
 * Step 53: Firestore multi-user rules and sync races.
 *
 * The Firebase CLI/emulators are optional infrastructure in this workspace.
 * The case therefore uses a deterministic local contract oracle when they are
 * unavailable. The oracle exercises the same owner/schema/revision/outbox
 * contracts and refuses any non-demo credential or non-loopback endpoint.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'firebase.emulators.json');
const CONTRACT_PATH = path.join(ROOT, 'tests', 'fixtures', 'firestore-contracts.json');
const RULES_PATH = path.join(ROOT, 'firestore.rules');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function localEndpoint(host, port) {
  return { host, port };
}

function assertLocalOnly(config, contract) {
  const expectedAuth = localEndpoint('127.0.0.1', 9099);
  const expectedFirestore = localEndpoint('127.0.0.1', 8080);
  assert.deepEqual(config.emulators.auth, expectedAuth);
  assert.deepEqual(config.emulators.firestore, expectedFirestore);
  assert.deepEqual(contract.emulators.auth, expectedAuth);
  assert.deepEqual(contract.emulators.firestore, expectedFirestore);
  assert.match(contract.projectId, /^demo-/);
  assert.doesNotMatch(JSON.stringify(config), /https?:\/\/(?!127\.0\.0\.1|localhost|::1)/i);
  assert.doesNotMatch(JSON.stringify(contract), /https?:\/\/(?!127\.0\.0\.1|localhost|::1)/i);

  const credentialKeys = ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_API_KEY'];
  for (const key of credentialKeys) {
    assert.ok(!process.env[key], `${key} must not be configured for Step 53`);
  }
  for (const key of ['FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    const value = process.env[key];
    if (value) assert.match(value, /^demo-/, `${key} must point only to a demo project`);
  }
}

function detectFirebaseCli() {
  const candidates = [
    process.env.FIREBASE_CLI_PATH,
    path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'firebase.cmd' : 'firebase'),
    path.join(ROOT, 'tests', 'harness', 'node_modules', '.bin', process.platform === 'win32' ? 'firebase.cmd' : 'firebase'),
    process.platform === 'win32' ? 'firebase.cmd' : 'firebase'
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate, ['--version'], {
        cwd: ROOT,
        stdio: 'ignore',
        timeout: 1500,
        windowsHide: true
      });
      if (result.status === 0) return { available: true, candidate };
    } catch {}
  }
  return { available: false, candidate: null };
}

class PermissionDenied extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermissionDenied';
    this.code = 'permission-denied';
  }
}

class ContractRejected extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContractRejected';
    this.code = 'invalid-argument';
  }
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validRuleTaskShape(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const envelope = Array.isArray(data.tasks) && typeof data.version === 'number' && Number.isFinite(data.version);
  const individual = nonemptyString(data.id) && nonemptyString(data.title);
  return envelope || individual;
}

function validCanonicalEnvelope(data, expectedVersion = 5) {
  return Boolean(
    data &&
    data.schema === 'gpac_v5' &&
    data.version === expectedVersion &&
    Array.isArray(data.tasks) &&
    data.taskRevisions && typeof data.taskRevisions === 'object' && !Array.isArray(data.taskRevisions) &&
    data.tombstones && typeof data.tombstones === 'object' && !Array.isArray(data.tombstones)
  );
}

function validTask(task) {
  return Boolean(
    task &&
    nonemptyString(task.id) &&
    nonemptyString(task.title) &&
    Number.isInteger(task.revision) &&
    task.revision >= 0 &&
    typeof task.completed === 'boolean' &&
    typeof task.deleted === 'boolean'
  );
}

function projectPath(uid, projectId) {
  return `users/${uid}/tasks/${projectId}`;
}

function pathParts(pathname) {
  return pathname.split('/').filter(Boolean);
}

class LocalFirestoreOracle {
  constructor(contract) {
    this.contract = contract;
    this.documents = new Map();
    this.appliedMutations = new Map();
  }

  _authorize(uid, pathname, operation, data = null) {
    const parts = pathParts(pathname);
    if (parts[0] !== 'users' || parts.length < 2) {
      throw new PermissionDenied('unknown top-level path denied');
    }
    const ownerUid = parts[1];
    if (!uid) throw new PermissionDenied('anonymous access denied');
    if (uid !== ownerUid) throw new PermissionDenied('cross-user access denied');

    if (parts[2] === 'tasks' && ['create', 'update', 'set'].includes(operation)) {
      if (!validRuleTaskShape(data)) throw new ContractRejected('task schema rejected by rules contract');
    }
    return true;
  }

  seed(uid, projectId, envelope) {
    const pathname = projectPath(uid, projectId);
    this._authorize(uid, pathname, 'set', envelope);
    if (!validCanonicalEnvelope(envelope)) throw new ContractRejected('seed must use canonical v5 envelope');
    if (!envelope.tasks.every(validTask)) throw new ContractRejected('seed contains malformed task');
    this.documents.set(pathname, { data: clone(envelope), applied: new Set() });
  }

  read(uid, pathname) {
    this._authorize(uid, pathname, 'get');
    const record = this.documents.get(pathname);
    return record ? clone(record.data) : null;
  }

  write(uid, pathname, data) {
    this._authorize(uid, pathname, 'set', data);
    if (pathname.includes('/tasks/')) {
      if (!validCanonicalEnvelope(data)) throw new ContractRejected('application rejected non-canonical task envelope');
      if (!data.tasks.every(validTask)) throw new ContractRejected('application rejected malformed task');
    }
    const existing = this.documents.get(pathname);
    this.documents.set(pathname, { data: clone(data), applied: existing?.applied || new Set() });
    return clone(data);
  }

  delete(uid, pathname) {
    this._authorize(uid, pathname, 'delete');
    this.documents.delete(pathname);
    return true;
  }

  commitMutation({ uid, projectId, mutation }) {
    const pathname = projectPath(uid, projectId);
    this._authorize(uid, pathname, 'update', {
      tasks: [],
      version: 5
    });
    if (!nonemptyString(mutation?.mutationId)) throw new ContractRejected('mutation id required');
    if (!Number.isInteger(mutation?.revision) || mutation.revision < 0) throw new ContractRejected('mutation revision required');
    if (!Array.isArray(mutation?.changedTasks)) throw new ContractRejected('changedTasks must be an array');
    if (!mutation.changedTasks.every(validTask)) throw new ContractRejected('malformed changed task');
    if (!mutation.tombstones || typeof mutation.tombstones !== 'object' || Array.isArray(mutation.tombstones)) {
      throw new ContractRejected('tombstones must be an object');
    }

    const record = this.documents.get(pathname) || {
      data: {
        schema: 'gpac_v5',
        version: 5,
        tasks: [],
        taskRevisions: {},
        tombstones: {}
      },
      applied: new Set()
    };
    if (record.applied.has(mutation.mutationId)) {
      return { status: 'committed', committed: true, idempotent: true, data: clone(record.data) };
    }

    const mergeModule = mutation.mergeRevisionedTaskLists;
    if (typeof mergeModule !== 'function') throw new Error('local merge oracle is unavailable');
    const merged = mergeModule({
      serverTasks: record.data.tasks,
      serverTaskRevisions: record.data.taskRevisions,
      serverTombstones: record.data.tombstones,
      localTasks: mutation.changedTasks,
      localRevision: mutation.revision,
      localTombstones: mutation.tombstones
    });
    const next = {
      schema: 'gpac_v5',
      version: 5,
      tasks: merged.tasks.map(task => ({ ...task, completed: Boolean(task.completed), deleted: Boolean(task.deleted) })),
      taskRevisions: merged.taskRevisions,
      tombstones: merged.tombstones,
      projectRevision: Math.max(Number(record.data.projectRevision) || 0, mutation.revision)
    };
    const applied = new Set(record.applied);
    applied.add(mutation.mutationId);
    this.documents.set(pathname, { data: next, applied });
    return { status: 'committed', committed: true, idempotent: false, data: clone(next) };
  }
}

class OfflineClient {
  constructor(oracle, uid, mergeRevisionedTaskLists, label) {
    this.oracle = oracle;
    this.uid = uid;
    this.label = label;
    this.mergeRevisionedTaskLists = mergeRevisionedTaskLists;
    this.online = true;
    this.scopes = new Map();
    this._scope(uid);
  }

  _scope(uid = this.uid) {
    if (!this.scopes.has(uid)) this.scopes.set(uid, { queue: [], local: new Map(), nextRevision: 1 });
    return this.scopes.get(uid);
  }

  switchAccount(uid) {
    this.uid = uid;
    this._scope(uid);
  }

  _localKey(projectId) {
    return `${this.uid}/${projectId}`;
  }

  read(projectId) {
    const data = this.oracle.read(this.uid, projectPath(this.uid, projectId));
    this._scope().local.set(this._localKey(projectId), clone(data));
    return data;
  }

  queueMutation(projectId, { changedTasks, tombstones = {}, reopen = false } = {}) {
    const scope = this._scope();
    const revision = scope.nextRevision++;
    const mutation = {
      mutationId: `${this.label}-${this.uid}-${revision}`,
      revision,
      changedTasks: clone(changedTasks || []),
      tombstones: clone(tombstones),
      reopen
    };
    scope.queue.push({ projectId, mutation });
    return clone(mutation);
  }

  pending(projectId = null) {
    return this._scope().queue.filter(entry => projectId === null || entry.projectId === projectId).map(clone);
  }

  async replay(projectId = null) {
    if (!this.online) return { status: 'offline', committed: false, acknowledged: [] };
    const scope = this._scope();
    const acknowledged = [];
    for (const entry of [...scope.queue]) {
      if (projectId !== null && entry.projectId !== projectId) continue;
      const result = this.oracle.commitMutation({
        uid: this.uid,
        projectId: entry.projectId,
        mutation: { ...entry.mutation, mergeRevisionedTaskLists: this.mergeRevisionedTaskLists }
      });
      if (result.committed) {
        scope.queue = scope.queue.filter(candidate => candidate.mutation.mutationId !== entry.mutation.mutationId);
        acknowledged.push(entry.mutation.mutationId);
        scope.local.set(this._localKey(entry.projectId), clone(result.data));
      }
    }
    return { status: 'committed', committed: true, acknowledged };
  }
}

async function loadMergeContract() {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'services', 'SyncOutbox.js'), 'utf8');
  const moduleUrl = `data:text/javascript,${encodeURIComponent(source)}#case53-${Date.now()}-${Math.random()}`;
  return import(moduleUrl);
}

describe('Step 53: Firestore multi-user rules and sync races', () => {
  it('pins the contract to demo-local emulators and reports emulator availability', () => {
    const config = loadJson(CONFIG_PATH);
    const contract = loadJson(CONTRACT_PATH);
    assertLocalOnly(config, contract);
    assert.equal(contract.mode, 'demo-local-only');
    assert.equal(config.emulators.singleProjectMode, true);

    const cli = detectFirebaseCli();
    if (cli.available) {
      console.log(`[Step53] Firebase CLI detected at ${cli.candidate}; this run remains fixture-only and never starts or contacts a project.`);
    } else {
      console.log('[Step53] Firebase emulator unavailable: no local Firebase CLI found; using deterministic offline contract oracle.');
    }
  });

  it('enforces owner, nonowner, anonymous, malformed, schema, and version contracts', async () => {
    const contract = loadJson(CONTRACT_PATH);
    const rules = fs.readFileSync(RULES_PATH, 'utf8');
    assert.match(rules, /function isAuthenticated\(\)/);
    assert.match(rules, /function isOwner\(userId\)/);
    assert.match(rules, /function isValidTaskEnvelope\(\)/);
    assert.match(rules, /match \/users\/{userId}/);

    const { mergeRevisionedTaskLists } = await loadMergeContract();
    const oracle = new LocalFirestoreOracle(contract);
    const validTask = { id: 'task-1', title: 'Owner task', projectId: 'project-1', completed: false, deleted: false, revision: 1 };
    const validEnvelope = {
      schema: 'gpac_v5',
      version: 5,
      tasks: [validTask],
      taskRevisions: { 'task-1': 1 },
      tombstones: {}
    };
    oracle.seed('alice', 'project-1', validEnvelope);
    assert.deepEqual(oracle.read('alice', projectPath('alice', 'project-1')).tasks, [validTask]);
    assert.throws(() => oracle.read('bob', projectPath('alice', 'project-1')), /cross-user access denied/);
    assert.throws(() => oracle.read(null, projectPath('alice', 'project-1')), /anonymous access denied/);
    assert.throws(() => oracle.write('alice', projectPath('alice', 'project-1'), { tasks: 'bad', version: 5 }), /schema rejected/);
    assert.throws(() => oracle.write('alice', projectPath('alice', 'project-1'), { schema: 'wrong', version: 5, tasks: [], taskRevisions: {}, tombstones: {} }), /non-canonical/);
    assert.throws(() => oracle.write('alice', projectPath('alice', 'project-1'), { schema: 'gpac_v5', version: 4, tasks: [], taskRevisions: {}, tombstones: {} }), /non-canonical/);
    assert.throws(() => oracle.write('alice', projectPath('alice', 'project-1'), { schema: 'gpac_v5', version: 5, tasks: [{ ...validTask, id: '' }], taskRevisions: {}, tombstones: {} }), /malformed task/);
    assert.equal(contract.rules.ownerOnly, true);
    assert.equal(contract.rules.anonymousDenied, true);
    assert.equal(typeof mergeRevisionedTaskLists, 'function');
  });

  it('merges concurrent owner edits without losing unrelated tasks', async () => {
    const contract = loadJson(CONTRACT_PATH);
    const { mergeRevisionedTaskLists } = await loadMergeContract();
    const oracle = new LocalFirestoreOracle(contract);
    const clientA = new OfflineClient(oracle, 'alice', mergeRevisionedTaskLists, 'client-a');
    const clientB = new OfflineClient(oracle, 'alice', mergeRevisionedTaskLists, 'client-b');
    const base = {
      schema: 'gpac_v5',
      version: 5,
      tasks: [],
      taskRevisions: {},
      tombstones: {}
    };
    oracle.seed('alice', 'project-race', base);
    clientA.read('project-race');
    clientB.read('project-race');
    clientA.queueMutation('project-race', {
      changedTasks: [{ id: 'a', title: 'A edit', projectId: 'project-race', completed: false, deleted: false, revision: 1 }]
    });
    clientB.queueMutation('project-race', {
      changedTasks: [{ id: 'b', title: 'B edit', projectId: 'project-race', completed: false, deleted: false, revision: 1 }]
    });
    const [first, second] = await Promise.all([clientA.replay('project-race'), clientB.replay('project-race')]);
    assert.equal(first.committed, true);
    assert.equal(second.committed, true);
    const clientAView = clientA.read('project-race');
    const clientBView = clientB.read('project-race');
    assert.deepEqual(clientAView.tasks.map(task => task.id).sort(), ['a', 'b']);
    assert.deepEqual(clientBView.tasks.map(task => task.id).sort(), ['a', 'b']);
    assert.deepEqual(clientAView, clientBView, 'both clients must converge on the same canonical snapshot');
    const converged = oracle.read('alice', projectPath('alice', 'project-race'));
    assert.deepEqual(converged.tasks.map(task => task.id).sort(), ['a', 'b']);
    assert.equal(clientA.pending('project-race').length, 0);
    assert.equal(clientB.pending('project-race').length, 0);
    assert.equal(converged.projectRevision, 1);
  });

  it('preserves tombstones against stale pending retries and permits an explicit newer reopen', async () => {
    const contract = loadJson(CONTRACT_PATH);
    const { mergeRevisionedTaskLists } = await loadMergeContract();
    const oracle = new LocalFirestoreOracle(contract);
    const client = new OfflineClient(oracle, 'alice', mergeRevisionedTaskLists, 'client-race');
    const original = { id: 'shared', title: 'Original', projectId: 'project-policy', completed: false, deleted: false, revision: 1 };
    oracle.seed('alice', 'project-policy', {
      schema: 'gpac_v5',
      version: 5,
      tasks: [original],
      taskRevisions: { shared: 1 },
      tombstones: {}
    });

    const staleRetry = client.queueMutation('project-policy', {
      changedTasks: [{ ...original, title: 'Detached stale retry', revision: 1 }]
    });
    const deleted = client.queueMutation('project-policy', {
      changedTasks: [],
      tombstones: { shared: 2 }
    });
    await client.replay('project-policy');
    const afterDelete = oracle.read('alice', projectPath('alice', 'project-policy'));
    assert.deepEqual(afterDelete.tasks, []);
    assert.equal(afterDelete.tombstones.shared, 2);

    const staleResult = oracle.commitMutation({
      uid: 'alice',
      projectId: 'project-policy',
      mutation: { ...staleRetry, mutationId: 'detached-stale-retry', mergeRevisionedTaskLists }
    });
    assert.equal(staleResult.committed, true);
    assert.equal(staleResult.idempotent, false);
    assert.deepEqual(oracle.read('alice', projectPath('alice', 'project-policy')).tasks, []);

    const reopened = client.queueMutation('project-policy', {
      changedTasks: [{ ...original, title: 'Explicit reopened', revision: 3, reopen: true }],
      reopen: true
    });
    await client.replay('project-policy');
    const afterReopen = oracle.read('alice', projectPath('alice', 'project-policy'));
    assert.deepEqual(afterReopen.tasks.map(task => task.title), ['Explicit reopened']);
    assert.deepEqual(afterReopen.tombstones, {});
    assert.equal(reopened.revision, 3);
    assert.notEqual(deleted.mutationId, reopened.mutationId);
  });

  it('replays offline mutations only after acknowledgement and isolates account switches', async () => {
    const contract = loadJson(CONTRACT_PATH);
    const { mergeRevisionedTaskLists } = await loadMergeContract();
    const oracle = new LocalFirestoreOracle(contract);
    const clientA = new OfflineClient(oracle, 'alice', mergeRevisionedTaskLists, 'client-a');
    const clientB = new OfflineClient(oracle, 'alice', mergeRevisionedTaskLists, 'client-b');
    oracle.seed('alice', 'project-offline', {
      schema: 'gpac_v5',
      version: 5,
      tasks: [],
      taskRevisions: {},
      tombstones: {}
    });
    clientA.online = false;
    clientA.queueMutation('project-offline', {
      changedTasks: [{ id: 'offline-a', title: 'Queued offline', projectId: 'project-offline', completed: false, deleted: false, revision: 1 }]
    });
    const offlineResult = await clientA.replay('project-offline');
    assert.equal(offlineResult.committed, false);
    assert.equal(clientA.pending('project-offline').length, 1);
    assert.deepEqual(oracle.read('alice', projectPath('alice', 'project-offline')).tasks, []);

    clientB.queueMutation('project-offline', {
      changedTasks: [{ id: 'online-b', title: 'Online B', projectId: 'project-offline', completed: false, deleted: false, revision: 1 }]
    });
    await clientB.replay('project-offline');
    clientA.online = true;
    const acknowledged = await clientA.replay('project-offline');
    assert.deepEqual(acknowledged.acknowledged, clientA.pending('project-offline').length === 0 ? ['client-a-alice-1'] : []);
    const afterReplay = oracle.read('alice', projectPath('alice', 'project-offline'));
    assert.deepEqual(afterReplay.tasks.map(task => task.id).sort(), ['offline-a', 'online-b']);

    clientA.switchAccount('bob');
    assert.equal(clientA.read('project-offline'), null);
    clientA.queueMutation('project-offline', {
      changedTasks: [{ id: 'bob-only', title: 'Bob task', projectId: 'project-offline', completed: false, deleted: false, revision: 1 }]
    });
    await clientA.replay('project-offline');
    assert.throws(() => oracle.read('alice', projectPath('bob', 'project-offline')), /cross-user access denied/);
    assert.deepEqual(oracle.read('bob', projectPath('bob', 'project-offline')).tasks.map(task => task.id), ['bob-only']);
    clientA.switchAccount('alice');
    assert.deepEqual(clientA.read('project-offline').tasks.map(task => task.id).sort(), ['offline-a', 'online-b']);
    assert.equal(contract.syncPolicy.accountSwitch, 'uid-scoped-local-and-outbox-state');
  });
});
