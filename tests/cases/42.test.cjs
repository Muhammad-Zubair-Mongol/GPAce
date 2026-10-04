/**
 * Step 42: revisioned task mutations and acknowledged sync outbox.
 *
 * The application Firestore module imports browser CDN modules, so this case
 * exercises the shared revision protocol and durable outbox directly with an
 * in-memory local store and a transactional fixture. No production endpoint
 * or Firebase credential is used.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStorage() {
  const values = new Map();
  return {
    get(key, fallback) {
      return values.has(key) ? clone(values.get(key)) : clone(fallback);
    },
    set(key, value) {
      values.set(key, clone(value));
      return { success: true, status: 'success' };
    },
    remove(key) {
      values.delete(key);
      return { success: true, status: 'success' };
    },
    dump() {
      return Object.fromEntries([...values.entries()].map(([key, value]) => [key, clone(value)]));
    }
  };
}

async function loadSyncOutbox() {
  const sourcePath = path.resolve(__dirname, '../../js/services/SyncOutbox.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const moduleUrl = `data:text/javascript,${encodeURIComponent(source)}#case42-${Date.now()}-${Math.random()}`;
  return import(moduleUrl);
}

function task(id, title, extra = {}) {
  return { id, title, completed: false, ...extra };
}

class RevisionedTaskFixture {
  constructor(mergeRevisionedTaskLists) {
    this.mergeRevisionedTaskLists = mergeRevisionedTaskLists;
    this.document = {
      tasks: [],
      taskRevisions: {},
      tombstones: {},
      appliedMutations: [],
      version: 0
    };
  }

  commit(entry) {
    if (this.document.appliedMutations.includes(entry.mutationId)) {
      return {
        status: 'committed',
        committed: true,
        idempotent: true,
        mutationId: entry.mutationId,
        revision: this.document.version,
        tasks: clone(this.document.tasks),
        taskRevisions: clone(this.document.taskRevisions),
        tombstones: clone(this.document.tombstones)
      };
    }

    const merged = this.mergeRevisionedTaskLists({
      serverTasks: this.document.tasks,
      serverTaskRevisions: this.document.taskRevisions,
      serverTombstones: this.document.tombstones,
      localTasks: entry.changedTasks,
      localRevision: entry.revision,
      localTombstones: entry.tombstones
    });
    const revision = Math.max(this.document.version + 1, entry.revision);
    this.document = {
      tasks: merged.tasks,
      taskRevisions: merged.taskRevisions,
      tombstones: merged.tombstones,
      appliedMutations: [...this.document.appliedMutations, entry.mutationId].slice(-32),
      version: revision
    };
    return {
      status: 'committed',
      committed: true,
      idempotent: false,
      mutationId: entry.mutationId,
      revision,
      tasks: clone(this.document.tasks),
      taskRevisions: clone(this.document.taskRevisions),
      tombstones: clone(this.document.tombstones)
    };
  }
}

describe('Step 42: Revisioned task sync and durable outbox', () => {
  let sync;

  it('preserves disjoint edits from clients sharing one stale snapshot', async () => {
    sync = await loadSyncOutbox();
    const initial = [task('a', 'A0'), task('b', 'B0')];
    const first = sync.mergeRevisionedTaskLists({
      serverTasks: initial,
      serverTaskRevisions: { a: 1, b: 1 },
      localTasks: [task('a', 'A1')],
      localRevision: 2
    });
    const second = sync.mergeRevisionedTaskLists({
      serverTasks: first.tasks,
      serverTaskRevisions: first.taskRevisions,
      serverTombstones: first.tombstones,
      localTasks: [task('b', 'B1')],
      localRevision: 3
    });

    assert.deepEqual(second.tasks, [task('a', 'A1'), task('b', 'B1')]);
    assert.deepEqual(second.taskRevisions, { a: 2, b: 3 });
    assert.deepEqual(second.tombstones, {});
  });

  it('uses newer tombstones and allows an explicitly newer reopen', async () => {
    sync = sync || await loadSyncOutbox();
    const deleted = sync.mergeRevisionedTaskLists({
      serverTasks: [task('a', 'A0')],
      serverTaskRevisions: { a: 4 },
      localRevision: 5,
      localTombstones: { a: 5 }
    });
    assert.deepEqual(deleted.tasks, []);
    assert.deepEqual(deleted.tombstones, { a: 5 });

    const reopened = sync.mergeRevisionedTaskLists({
      serverTasks: deleted.tasks,
      serverTaskRevisions: deleted.taskRevisions,
      serverTombstones: deleted.tombstones,
      localTasks: [task('a', 'A reopened')],
      localRevision: 6
    });
    assert.deepEqual(reopened.tasks, [task('a', 'A reopened')]);
    assert.equal(reopened.taskRevisions.a, 6);
    assert.deepEqual(reopened.tombstones, {});

    const stale = sync.mergeRevisionedTaskLists({
      serverTasks: [task('a', 'A0')],
      serverTaskRevisions: { a: 4 },
      serverTombstones: { a: 3 },
      localTasks: [task('a', 'stale')],
      localRevision: 2
    });
    assert.deepEqual(stale.tasks, [task('a', 'A0')]);
    assert.equal(stale.taskRevisions.a, 4);
  });

  it('persists per-user queues and coalesces only newer intents in one project', async () => {
    sync = sync || await loadSyncOutbox();
    const storage = createStorage();
    const firstOutbox = new sync.SyncOutbox({ storage, namespace: 'case42.outbox' });
    firstOutbox.enqueue({ userId: 'user-a', projectId: 'project-a', mutationId: 'a-1', revision: 1, changedTasks: [] });
    firstOutbox.enqueue({ userId: 'user-a', projectId: 'project-b', mutationId: 'b-1', revision: 1, changedTasks: [] });
    firstOutbox.enqueue({ userId: 'user-a', projectId: 'project-a', mutationId: 'a-2', revision: 2, changedTasks: [{ id: 'a' }] });

    const restoredOutbox = new sync.SyncOutbox({ storage, namespace: 'case42.outbox' });
    assert.deepEqual(restoredOutbox.list('user-a', { projectId: 'project-a' }).map(entry => entry.mutationId), ['a-2']);
    assert.deepEqual(restoredOutbox.list('user-a', { projectId: 'project-b' }).map(entry => entry.mutationId), ['b-1']);
    assert.deepEqual(restoredOutbox.list('user-b'), []);
  });

  it('retains failed work as pending and dequeues only an explicit acknowledgement', async () => {
    sync = sync || await loadSyncOutbox();
    const storage = createStorage();
    const outbox = new sync.SyncOutbox({ storage, namespace: 'case42.flush' });
    outbox.enqueue({ userId: 'user-a', projectId: 'project-a', mutationId: 'm-1', revision: 7, changedTasks: [] });

    const failed = await outbox.flush('user-a', async () => {
      throw new Error('local fixture write rejected');
    }, { projectId: 'project-a' });
    assert.equal(failed.status, 'pending');
    assert.equal(failed.committed, false);
    assert.equal(outbox.list('user-a', { projectId: 'project-a' })[0].status, 'pending');
    assert.equal(outbox.list('user-a', { projectId: 'project-a' })[0].attempts, 1);

    const committed = await outbox.flush('user-a', async entry => ({
      status: 'committed',
      committed: true,
      mutationId: entry.mutationId,
      revision: entry.revision
    }), { projectId: 'project-a' });
    assert.equal(committed.status, 'committed');
    assert.equal(committed.committed, true);
    assert.deepEqual(committed.acknowledged, ['m-1']);
    assert.deepEqual(outbox.list('user-a', { projectId: 'project-a' }), []);
  });

  it('keeps an old retry from overwriting a newer revision and replays idempotently', async () => {
    sync = sync || await loadSyncOutbox();
    const server = new RevisionedTaskFixture(sync.mergeRevisionedTaskLists);
    const clientA = {
      userId: 'user-a',
      projectId: 'project-a',
      mutationId: 'client-a-1',
      revision: 2,
      changedTasks: [task('a', 'A1')],
      tombstones: {}
    };
    const clientB = {
      userId: 'user-a',
      projectId: 'project-a',
      mutationId: 'client-b-1',
      revision: 3,
      changedTasks: [task('b', 'B1')],
      tombstones: {}
    };

    const [committedA, committedB] = await Promise.all([
      Promise.resolve().then(() => server.commit(clientA)),
      Promise.resolve().then(() => server.commit(clientB))
    ]);
    assert.equal(committedA.committed, true);
    assert.equal(committedB.committed, true);
    assert.deepEqual(server.document.tasks, [task('a', 'A1'), task('b', 'B1')]);

    const newer = server.commit({
      userId: 'user-a',
      projectId: 'project-a',
      mutationId: 'client-a-2',
      revision: 5,
      changedTasks: [task('a', 'A2')],
      tombstones: {}
    });
    assert.equal(newer.committed, true);
    const versionAfterNewer = server.document.version;

    const oldRetry = server.commit({ ...clientA, mutationId: 'client-a-old-retry' });
    assert.equal(oldRetry.committed, true);
    assert.equal(server.document.version, versionAfterNewer + 1);
    assert.deepEqual(server.document.tasks, [task('a', 'A2'), task('b', 'B1')]);

    const replay = server.commit({ ...clientA, mutationId: 'client-a-1' });
    assert.equal(replay.idempotent, true);
    assert.equal(server.document.version, versionAfterNewer + 1);
  });

  it('exposes explicit Firestore transaction and status contracts without network access', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../js/firestore.js'), 'utf8');
    assert.match(source, /new SyncOutbox\(/);
    assert.match(source, /runTransaction\(db/);
    assert.match(source, /status: 'error', committed: false, code: 'unauthenticated'/);
    assert.match(source, /status: result\.status \|\| 'pending'/);
    assert.match(source, /persistTaskAcknowledgement/);
    assert.doesNotMatch(source, /setTimeout\(\s*\(\)\s*=>\s*saveTasksToFirestore/);
  });
});
