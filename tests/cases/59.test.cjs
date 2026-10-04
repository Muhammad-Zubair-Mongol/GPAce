/**
 * Step 59: schema migration and rollback rehearsal.
 *
 * The corpus and every storage backend in this case are synthetic and
 * disposable. The production repository is exercised through its real v5
 * reader, migration, backup, and recovery methods without reading data/ or a
 * browser profile and without contacting a backend.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createIsolatedStorage } = require('../harness/helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const CORPUS = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests', 'fixtures', 'migration-corpus.json'),
  'utf8'
));

let TaskRepository;
let CURRENT_VERSION;
let SCHEMA_NAME;
let ENVELOPE_STATUS;

function json(value) {
  return JSON.stringify(value);
}

function scoped(key) {
  return TaskRepository._getScopedKey(key);
}

function marker(name) {
  return scoped(name);
}

function seedLegacy(storage, { includeDraft = true } = {}) {
  for (const [key, value] of Object.entries(CORPUS.legacy)) {
    if (!includeDraft && key === 'workspaceDraft') continue;
    storage.setItem(key, typeof value === 'string' ? value : json(value));
  }
}

function normalizedEnvelope(tasks) {
  const data = tasks.map(task => TaskRepository._normalizeTask(task));
  return {
    version: CURRENT_VERSION,
    schema: SCHEMA_NAME,
    generatedAt: '2026-09-29T00:00:00.000Z',
    deviceId: 'step59-fixture-device',
    checksum: TaskRepository._calculateChecksum(data),
    data
  };
}

function seedV5(projectId, active, completed, storage) {
  storage.setItem(scoped(`tasks_v5.${projectId}`), json(normalizedEnvelope(active)));
  storage.setItem(scoped(`completed_v5.${projectId}`), json(normalizedEnvelope(completed)));
}

function makeFailureStorage() {
  const base = createIsolatedStorage();
  let predicate = null;
  let armed = false;
  let used = false;
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'arm') {
        return nextPredicate => {
          predicate = nextPredicate;
          armed = typeof nextPredicate === 'function';
          used = false;
        };
      }
      if (property === 'failureUsed') return used;
      if (property === 'setItem') {
        return (key, value) => {
          const normalizedKey = String(key);
          if (armed && !used && predicate(normalizedKey, value)) {
            used = true;
            throw new Error(`step59 injected interruption at ${normalizedKey}`);
          }
          return target.setItem(normalizedKey, value);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function resetRepository(storage, userId = null) {
  TaskRepository.destroy();
  globalThis.localStorage = storage;
  globalThis.window = {};
  TaskRepository.setStorageBackend(storage);
  // Force a tenancy transition so caches and lifecycle state cannot leak
  // between disposable fixture copies.
  TaskRepository.setUser('__step59_reset__');
  TaskRepository.setUser(userId);
}

function ids(tasks) {
  return tasks.map(task => task.id);
}

function getManualBackup(storage) {
  const raw = storage.getItem(marker(CORPUS.commitMarkers.manualBackup));
  assert.ok(raw, 'manual backup must be present before verification');
  return { raw, backup: JSON.parse(raw) };
}

function assertBackupVerified(backup) {
  assert.equal(
    TaskRepository._calculateChecksum(backup.data),
    backup.checksum,
    'backup checksum must verify before rollback'
  );
  assert.equal(backup.version, CURRENT_VERSION);
  assert.equal(backup.schema, SCHEMA_NAME);
}

beforeEach(async () => {
  const repoMod = await import('../../js/core/TaskRepository.js');
  TaskRepository = repoMod.default;
  CURRENT_VERSION = repoMod.CURRENT_VERSION;
  SCHEMA_NAME = repoMod.SCHEMA_NAME;
  ENVELOPE_STATUS = repoMod.ENVELOPE_STATUS;
});

describe('Step 59: migration corpus, resumability, ownership, and rollback', () => {
  it('contains only a sanitized corpus with legacy, v5, corrupt, empty, and tombstoned cases', () => {
    assert.equal(CORPUS.corpusVersion, 1);
    assert.equal(CORPUS.ownership.automaticMigrationScope, 'anonymous-only');
    assert.ok(CORPUS.legacy['tasks-physics']);
    assert.ok(CORPUS.v5.active);
    assert.ok(CORPUS.v5.history);
    assert.ok(CORPUS.v5.tombstoned);
    assert.deepEqual(CORPUS.empty.canonicalActive, []);
    assert.ok(CORPUS.corrupt.some(entry => entry.name === 'malformed-json'));
    assert.ok(JSON.stringify(CORPUS).includes('legacy-draft-1'));
    assert.doesNotMatch(JSON.stringify(CORPUS), /sk-[A-Za-z0-9]{10,}/, 'fixture must not contain an API key');
  });

  it('round-trips legacy IDs, history, tombstones, and drafts with verified markers and backup', async () => {
    const storage = createIsolatedStorage();
    resetRepository(storage, null);
    storage.setItem('unrelated-step59-sentinel', 'preserve-me');
    seedLegacy(storage);

    const first = await TaskRepository.migrateOldData();
    assert.equal(first.success, true);
    assert.equal(first.migrated, 4);
    assert.equal(first.failed, 0);

    assert.equal(storage.getItem(marker(CORPUS.commitMarkers.migrationDone)), 'true');
    assert.equal(storage.getItem(marker(CORPUS.commitMarkers.schemaVersion)), '5');
    assert.equal(storage.getItem('tasks-physics'), null);
    assert.equal(storage.getItem('completed-tasks-physics'), null);
    assert.equal(storage.getItem('relaxed-tasks'), null);
    assert.equal(storage.getItem('calculatedPriorityTasks'), null);
    assert.equal(storage.getItem('tasks-physics-version'), null);
    assert.equal(storage.getItem('workspaceDraft'), json(CORPUS.legacy.workspaceDraft));
    assert.equal(storage.getItem('unrelated-step59-sentinel'), 'preserve-me');

    const physicsEnvelope = TaskRepository.readEnvelope(scoped('tasks_v5.physics'));
    const historyEnvelope = TaskRepository.readEnvelope(scoped('completed_v5.physics'));
    assert.equal(physicsEnvelope.status, ENVELOPE_STATUS.VALID);
    assert.equal(historyEnvelope.status, ENVELOPE_STATUS.VALID);
    assert.deepEqual(ids(TaskRepository.getAllTasks('physics')), ['legacy-physics-active']);
    assert.deepEqual(ids(physicsEnvelope.data), [
      'legacy-physics-active',
      'legacy-physics-tombstone'
    ]);
    assert.deepEqual(ids(TaskRepository.getCompletedTasks('physics')), ['legacy-physics-history']);
    assert.deepEqual(ids(TaskRepository.getRelaxedTasks()), ['legacy-relaxed-break']);

    const { raw: backupRaw, backup } = getManualBackup(storage);
    assertBackupVerified(backup);
    assert.deepEqual(ids(backup.data.tasks.physics), ids(physicsEnvelope.data));
    assert.deepEqual(ids(backup.data.completed.physics), ids(historyEnvelope.data));
    assert.ok(Object.keys(storage.dump()).some(key => key.startsWith('gpac_legacy_bak_')));

    const firstStorageImage = storage.dump();
    const second = await TaskRepository.migrateOldData();
    assert.equal(second.success, true);
    assert.equal(second.alreadyCommitted, true);
    assert.equal(second.migrated, 0);
    assert.deepEqual(storage.dump(), firstStorageImage, 'repeated migration must be a byte-stable no-op');
    assert.equal(storage.getItem(marker(CORPUS.commitMarkers.manualBackup)), backupRaw);
  });

  it('treats valid empty and tombstoned v5 envelopes as authoritative and preserves corrupt sources', () => {
    const storage = createIsolatedStorage();
    resetRepository(storage, null);

    seedV5(CORPUS.empty.projectId, CORPUS.empty.canonicalActive, [], storage);
    storage.setItem(CORPUS.empty.staleLegacyKey, json(CORPUS.empty.staleLegacy));
    assert.deepEqual(TaskRepository.getAllTasks(CORPUS.empty.projectId), []);

    seedV5(CORPUS.v5.projectId, [
      ...CORPUS.v5.active,
      ...CORPUS.v5.tombstoned
    ], CORPUS.v5.history, storage);
    assert.deepEqual(ids(TaskRepository.getAllTasks(CORPUS.v5.projectId)), ['v5-active-1']);
    assert.deepEqual(ids(TaskRepository.getCompletedTasks(CORPUS.v5.projectId)), ['v5-history-1']);
    assert.deepEqual(
      ids(TaskRepository.readEnvelope(scoped(`tasks_v5.${CORPUS.v5.projectId}`)).data),
      ['v5-active-1', 'v5-tombstone-1']
    );

    const unknownSchema = CORPUS.corrupt.find(entry => entry.name === 'unknown-v5-schema');
    const corruptKey = scoped(unknownSchema.scopedSuffix);
    const corruptRaw = json(unknownSchema.envelope);
    storage.setItem(corruptKey, corruptRaw);
    const corruptRead = TaskRepository.readEnvelope(corruptKey);
    assert.equal(corruptRead.status, ENVELOPE_STATUS.CORRUPT);
    assert.equal(storage.getItem(corruptKey), corruptRaw);

    const checksumCase = CORPUS.corrupt.find(entry => entry.name === 'checksum-mismatch');
    const checksumKey = scoped(checksumCase.scopedSuffix);
    const checksumRaw = json(checksumCase.envelope);
    storage.setItem(checksumKey, checksumRaw);
    assert.equal(TaskRepository.readEnvelope(checksumKey).status, ENVELOPE_STATUS.CORRUPT);
    assert.equal(storage.getItem(checksumKey), checksumRaw);
  });

  it('retains a malformed legacy source and reports the failed migration boundary', async () => {
    const storage = createIsolatedStorage();
    resetRepository(storage, null);
    const malformed = CORPUS.corrupt.find(entry => entry.name === 'malformed-json');
    storage.setItem(malformed.legacyKey, malformed.raw);

    const result = await TaskRepository.migrateOldData();
    assert.equal(result.success, false);
    assert.equal(result.failed, 1);
    assert.equal(storage.getItem(malformed.legacyKey), malformed.raw);
    assert.equal(storage.getItem(scoped('tasks_v5.corrupt-json')), null);
    assert.equal(storage.getItem(marker(CORPUS.commitMarkers.migrationDone)), 'true');
    assert.deepEqual(TaskRepository.getAllTasks('corrupt-json'), []);
  });

  it('rehearses interruption at each durable commit boundary and resumes in a disposable copy', async () => {
    const boundaries = [
      {
        name: 'v5 target',
        match: key => key === scoped('tasks_v5.physics')
      },
      {
        name: 'legacy source backup',
        match: key => key.startsWith(CORPUS.commitMarkers.legacyBackupPrefix)
      },
      {
        name: 'migration marker',
        match: key => key === marker(CORPUS.commitMarkers.migrationDone)
      },
      {
        name: 'schema marker',
        match: key => key === marker(CORPUS.commitMarkers.schemaVersion)
      }
    ];

    for (const boundary of boundaries) {
      const storage = makeFailureStorage();
      resetRepository(storage, null);
      seedLegacy(storage, { includeDraft: false });
      storage.arm(boundary.match);

      const interrupted = await TaskRepository.migrateOldData();
      assert.equal(interrupted.success, false, `${boundary.name} must be reported as failed`);
      assert.ok(interrupted.failed >= 1, `${boundary.name} must expose a failed count`);
      assert.ok(storage.getItem('tasks-physics'), `${boundary.name} must retain the source before acknowledgement`);

      // Resetting markers is intentionally limited to this disposable copy.
      // It models an operator restoring the pre-commit state before retrying.
      storage.arm(null);
      storage.removeItem(marker(CORPUS.commitMarkers.migrationDone));
      storage.removeItem(marker(CORPUS.commitMarkers.schemaVersion));
      const resumed = await TaskRepository.migrateOldData();
      assert.equal(resumed.success, true, `${boundary.name} must resume cleanly`);
      assert.equal(storage.getItem(marker(CORPUS.commitMarkers.migrationDone)), 'true');
      assert.equal(storage.getItem(marker(CORPUS.commitMarkers.schemaVersion)), '5');
      assert.equal(storage.getItem('tasks-physics'), null);
      assert.deepEqual(ids(TaskRepository.getAllTasks('physics')), ['legacy-physics-active']);
      assert.deepEqual(ids(TaskRepository.getCompletedTasks('physics')), ['legacy-physics-history']);
      assert.equal(new Set(ids(TaskRepository.getCompletedTasks('physics'))).size, 1);
      TaskRepository.destroy();
    }
  });

  it('restores a verified manual backup in a disposable rollback copy and enforces ownership', async () => {
    const sourceStorage = createIsolatedStorage();
    resetRepository(sourceStorage, null);
    sourceStorage.setItem('unrelated-step59-sentinel', 'preserve-me');
    seedLegacy(sourceStorage);
    const migrated = await TaskRepository.migrateOldData();
    assert.equal(migrated.success, true);
    const { raw: backupRaw, backup } = getManualBackup(sourceStorage);
    assertBackupVerified(backup);

    const rollbackStorage = createIsolatedStorage();
    rollbackStorage.load(sourceStorage.dump());
    resetRepository(rollbackStorage, null);
    const mutated = normalizedEnvelope([{ id: 'rollback-mutated', title: 'Synthetic mutation' }]);
    rollbackStorage.setItem(scoped('tasks_v5.physics'), json(mutated));
    rollbackStorage.removeItem(scoped('completed_v5.physics'));
    assert.deepEqual(ids(TaskRepository.getAllTasks('physics')), ['rollback-mutated']);

    assert.equal(TaskRepository.forceRecoveryFromBackup('manual'), true);
    assert.deepEqual(ids(TaskRepository.getAllTasks('physics')), ['legacy-physics-active']);
    assert.deepEqual(ids(TaskRepository.getCompletedTasks('physics')), ['legacy-physics-history']);
    assert.equal(
      rollbackStorage.getItem('workspaceDraft'),
      json(CORPUS.legacy.workspaceDraft),
      'rollback must not discard the unrelated synthetic draft'
    );
    assert.equal(rollbackStorage.getItem('unrelated-step59-sentinel'), 'preserve-me');
    const restoredEnvelope = TaskRepository.readEnvelope(scoped('tasks_v5.physics'));
    assert.equal(restoredEnvelope.status, ENVELOPE_STATUS.VALID);
    assert.equal(restoredEnvelope.wrapper.version, CURRENT_VERSION);
    assert.equal(restoredEnvelope.wrapper.schema, SCHEMA_NAME);
    assert.equal(rollbackStorage.getItem(marker(CORPUS.commitMarkers.manualBackup)), backupRaw);

    const ownershipStorage = createIsolatedStorage();
    resetRepository(ownershipStorage, 'fixture-authenticated-user');
    ownershipStorage.setItem('tasks-physics', json(CORPUS.legacy['tasks-physics']));
    const authenticated = await TaskRepository.migrateOldData();
    assert.equal(authenticated.authenticatedFreshStart, true);
    assert.deepEqual(TaskRepository.getAllTasks('physics'), []);
    assert.equal(ownershipStorage.getItem('tasks-physics'), json(CORPUS.legacy['tasks-physics']));
    TaskRepository.destroy();

    resetRepository(ownershipStorage, null);
    const anonymous = await TaskRepository.migrateOldData();
    assert.equal(anonymous.success, true);
    assert.deepEqual(ids(TaskRepository.getAllTasks('physics')), ['legacy-physics-active']);
  });
});
