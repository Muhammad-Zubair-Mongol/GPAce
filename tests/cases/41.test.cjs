/**
 * Case 41: Validate canonical task envelopes and one-way migration
 * 
 * Verifies the contract for Step 41:
 * - Valid empty v5 plus nonempty legacy returns [] (committed empty is authoritative)
 * - Malformed/unknown/checksum-invalid fixtures cause controlled recovery without overwrite
 * - Repeated migration is idempotent
 * - Two-user repository CRUD and account-switch tests cannot reveal prior-user state
 * - Loader readiness never announces healthy state after failed initialization
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createIsolatedStorage } = require('../harness/helpers.cjs');

describe('Step 41: Canonical Task Envelopes & One-Way Migration', () => {
  let isolatedStorage;
  let TaskRepository;
  let TaskSystemLoader;
  let CURRENT_VERSION;
  let SCHEMA_NAME;
  let ENVELOPE_STATUS;

  beforeEach(async () => {
    isolatedStorage = createIsolatedStorage();
    globalThis.localStorage = isolatedStorage;
    globalThis.window = globalThis;

    const repoMod = await import('../../js/core/TaskRepository.js');
    TaskRepository = repoMod.default;
    CURRENT_VERSION = repoMod.CURRENT_VERSION;
    SCHEMA_NAME = repoMod.SCHEMA_NAME;
    ENVELOPE_STATUS = repoMod.ENVELOPE_STATUS;

    TaskRepository.setStorageBackend(isolatedStorage);
    TaskRepository.setUser(null); // start anonymous

    const loaderMod = await import('../../js/core/TaskSystemLoader.js');
    TaskSystemLoader = loaderMod.default;
  });

  describe('1. Canonical Envelopes & Authoritative Empty Data (ST01/ST03 fix)', () => {
    it('valid empty v5 plus nonempty legacy returns [] without reviving legacy data', () => {
      TaskRepository.setUser('user_empty_v5');

      // 1. Seed legacy key with old tasks
      isolatedStorage.setItem('tasks-default', JSON.stringify([
        { id: 'leg-1', title: 'Ghost of Legacy Past', completed: false }
      ]));

      // 2. Seed valid v5 envelope with empty data array
      const emptyChecksum = TaskRepository._calculateChecksum([]);
      const v5Key = TaskRepository._getScopedKey('tasks_v5.default');
      const emptyEnvelope = {
        version: CURRENT_VERSION,
        schema: SCHEMA_NAME,
        generatedAt: new Date().toISOString(),
        deviceId: 'dev-test-1',
        checksum: emptyChecksum,
        data: []
      };
      isolatedStorage.setItem(v5Key, JSON.stringify(emptyEnvelope));

      // 3. Query repository
      const tasks = TaskRepository.getAllTasks('default');

      // CRITICAL ACCEPTANCE ASSERTION:
      // Valid empty v5 is authoritative. Must return [], NEVER the legacy task!
      assert.deepStrictEqual(tasks, [], 'Valid empty v5 envelope must return [] and NOT revive legacy tasks');
    });

    it('committed migration marker without v5 key returns [] and never revives legacy', () => {
      TaskRepository.setUser('user_migrated_empty');

      // Seed legacy tasks
      isolatedStorage.setItem('tasks-semester1', JSON.stringify([
        { id: 'leg-2', title: 'Old Chem Task' }
      ]));

      // Mark migration as committed for this user
      TaskRepository._markMigrationDone();

      // No v5 key exists yet for 'semester1', but migration is committed
      const tasks = TaskRepository.getAllTasks('semester1');
      assert.deepStrictEqual(tasks, [], 'Committed migration marker must be authoritative and not revive legacy');
    });

    it('returns filtered active tasks for non-empty valid v5 envelope', () => {
      TaskRepository.setUser('user_active');
      TaskRepository.addTask('projectA', { id: 't1', title: 'Active Task', completed: false });
      TaskRepository.addTask('projectA', { id: 't2', title: 'Deleted Task', deleted: true });

      const active = TaskRepository.getAllTasks('projectA');
      assert.strictEqual(active.length, 1);
      assert.strictEqual(active[0].id, 't1');
    });
  });

  describe('2. Strict Envelope Validation & Corrupt Source Retention', () => {
    it('reports corrupt on malformed JSON and retains raw source without overwriting', () => {
      TaskRepository.setUser('user_corrupt_test');
      const scopedKey = TaskRepository._getScopedKey('tasks_v5.projectCorrupt');
      const malformedRaw = '{"version": 5, "schema": "gpac_v5", "data": [INVALID_JSON';

      isolatedStorage.setItem(scopedKey, malformedRaw);

      const envelope = TaskRepository.readEnvelope(scopedKey);
      assert.strictEqual(envelope.status, ENVELOPE_STATUS.CORRUPT);
      assert.ok(envelope.error);

      // getAllTasks returns empty list rather than throwing
      const tasks = TaskRepository.getAllTasks('projectCorrupt');
      assert.deepStrictEqual(tasks, []);

      // CRITICAL ASSERTION: The malformed raw string MUST survive in storage untouched!
      assert.strictEqual(isolatedStorage.getItem(scopedKey), malformedRaw, 'Corrupt source data must NOT be overwritten');
    });

    it('reports corrupt on unknown schema name and retains source', () => {
      TaskRepository.setUser('user_unknown_schema');
      const scopedKey = TaskRepository._getScopedKey('tasks_v5.projectSchema');
      const invalidSchema = {
        version: CURRENT_VERSION,
        schema: 'unrecognized_legacy_format_v9',
        checksum: TaskRepository._calculateChecksum([]),
        data: []
      };
      isolatedStorage.setItem(scopedKey, JSON.stringify(invalidSchema));

      const envelope = TaskRepository.readEnvelope(scopedKey);
      assert.strictEqual(envelope.status, ENVELOPE_STATUS.CORRUPT);
      assert.match(envelope.error, /Unknown schema/i);
      assert.ok(isolatedStorage.getItem(scopedKey).includes('unrecognized_legacy_format_v9'));
    });

    it('reports corrupt on unknown schema version and retains source', () => {
      TaskRepository.setUser('user_unknown_version');
      const scopedKey = TaskRepository._getScopedKey('tasks_v5.projectVer');
      const invalidVer = {
        version: 99,
        schema: SCHEMA_NAME,
        checksum: TaskRepository._calculateChecksum([]),
        data: []
      };
      isolatedStorage.setItem(scopedKey, JSON.stringify(invalidVer));

      const envelope = TaskRepository.readEnvelope(scopedKey);
      assert.strictEqual(envelope.status, ENVELOPE_STATUS.CORRUPT);
      assert.match(envelope.error, /Unknown version/i);
    });

    it('reports corrupt on checksum mismatch and retains source', () => {
      TaskRepository.setUser('user_checksum_mismatch');
      const scopedKey = TaskRepository._getScopedKey('tasks_v5.projectChecksum');
      const fakeChecksumObj = {
        version: CURRENT_VERSION,
        schema: SCHEMA_NAME,
        checksum: 'deadbeef', // Incorrect checksum!
        data: [{ id: 'task-1', title: 'Tampered task' }]
      };
      isolatedStorage.setItem(scopedKey, JSON.stringify(fakeChecksumObj));

      const envelope = TaskRepository.readEnvelope(scopedKey);
      assert.strictEqual(envelope.status, ENVELOPE_STATUS.CORRUPT);
      assert.match(envelope.error, /Checksum mismatch/i);

      // Raw data preserved
      assert.ok(isolatedStorage.getItem(scopedKey).includes('deadbeef'));
    });

    it('reports corrupt when task identity is missing or malformed', () => {
      TaskRepository.setUser('user_invalid_task');
      const scopedKey = TaskRepository._getScopedKey('tasks_v5.projectTasks');
      const tasksWithoutId = [
        { title: 'Task without ID' } // Invalid: missing id
      ];
      const envelopeObj = {
        version: CURRENT_VERSION,
        schema: SCHEMA_NAME,
        checksum: TaskRepository._calculateChecksum(tasksWithoutId),
        data: tasksWithoutId
      };
      isolatedStorage.setItem(scopedKey, JSON.stringify(envelopeObj));

      const envelope = TaskRepository.readEnvelope(scopedKey);
      assert.strictEqual(envelope.status, ENVELOPE_STATUS.CORRUPT);
      assert.match(envelope.error, /Invalid task/i);
    });
  });

  describe('3. One-Way Idempotent Migration', () => {
    it('migrates legacy keys once, creates backup, and is idempotent on repeat runs', async () => {
      // Setup legacy keys in anonymous scope
      TaskRepository.setUser(null);

      isolatedStorage.setItem('tasks-physics', JSON.stringify([
        { id: 'p1', title: 'Physics HW 1' },
        { id: 'p2', title: 'Physics HW 2' }
      ]));
      isolatedStorage.setItem('relaxed-tasks', JSON.stringify([
        { id: 'r1', title: 'Meditate 10 mins' }
      ]));
      isolatedStorage.setItem('completed-tasks-physics', JSON.stringify([
        { id: 'p0', title: 'Physics Syllabus Read', completed: true }
      ]));

      // Run migration first time
      const result1 = await TaskRepository.migrateOldData();
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result1.migrated, 3);

      // Verify v5 data was written with valid checksums
      const tasks = TaskRepository.getAllTasks('physics');
      assert.strictEqual(tasks.length, 2);
      assert.strictEqual(tasks[0].title, 'Physics HW 1');

      const relaxed = TaskRepository.getRelaxedTasks();
      assert.strictEqual(relaxed.length, 1);

      const completed = TaskRepository.getCompletedTasks('physics');
      assert.strictEqual(completed.length, 1);

      // Verify legacy keys were moved to backup
      assert.strictEqual(isolatedStorage.getItem('tasks-physics'), null);
      const allKeys = Object.keys(isolatedStorage.dump());
      assert.ok(allKeys.some(k => k.startsWith('gpac_legacy_bak_')));

      // CRITICAL ASSERTION: Run migration a second time (must be idempotent)
      const result2 = await TaskRepository.migrateOldData();
      assert.strictEqual(result2.success, true);
      assert.strictEqual(result2.migrated, 0);
      assert.strictEqual(result2.alreadyCommitted, true);

      // Tasks remain exactly as before
      assert.strictEqual(TaskRepository.getAllTasks('physics').length, 2);
    });

    it('authenticated user never silently steals unowned legacy data', async () => {
      // Place unowned legacy key in storage
      isolatedStorage.setItem('tasks-unowned', JSON.stringify([{ id: 'un-1', title: 'Unowned' }]));

      // User B logs in fresh
      TaskRepository.setUser('user_fresh_b');
      const res = await TaskRepository.migrateOldData();
      assert.strictEqual(res.authenticatedFreshStart, true);

      // User B must NOT have unowned legacy data
      assert.deepStrictEqual(TaskRepository.getAllTasks('unowned'), []);
    });
  });

  describe('4. Two-User Repository CRUD & Account-Switch Isolation', () => {
    it('isolates CRUD state so userB cannot read userA tasks or state', () => {
      // 1. User Alpha performs CRUD
      TaskRepository.setUser('user_alpha');
      TaskRepository.addTask('default', { id: 'alpha-1', title: 'Alpha Secret Mission' });
      TaskRepository.addTask('default', { id: 'alpha-2', title: 'Alpha Normal Task' });

      // Update task
      TaskRepository.updateTask('default', 'alpha-2', { title: 'Alpha Updated Task' });

      // Complete task
      TaskRepository.completeTask('default', 'alpha-1');

      const alphaActive = TaskRepository.getAllTasks('default');
      assert.strictEqual(alphaActive.length, 1);
      assert.strictEqual(alphaActive[0].title, 'Alpha Updated Task');

      const alphaCompleted = TaskRepository.getCompletedTasks('default');
      assert.strictEqual(alphaCompleted.length, 1);
      assert.strictEqual(alphaCompleted[0].id, 'alpha-1');

      // 2. Switch to User Beta
      TaskRepository.setUser('user_beta');

      // User Beta must see EMPTY state
      assert.deepStrictEqual(TaskRepository.getAllTasks('default'), [], 'User B must not see User A active tasks');
      assert.deepStrictEqual(TaskRepository.getCompletedTasks('default'), [], 'User B must not see User A completed tasks');

      // User Beta adds their own task
      TaskRepository.addTask('default', { id: 'beta-1', title: 'Beta Clean Task' });
      assert.strictEqual(TaskRepository.getAllTasks('default').length, 1);
      assert.strictEqual(TaskRepository.getAllTasks('default')[0].title, 'Beta Clean Task');

      // 3. Switch back to User Alpha
      TaskRepository.setUser('user_alpha');
      const alphaRestored = TaskRepository.getAllTasks('default');
      assert.strictEqual(alphaRestored.length, 1);
      assert.strictEqual(alphaRestored[0].title, 'Alpha Updated Task');
      assert.strictEqual(TaskRepository.getCompletedTasks('default').length, 1);

      // 4. Switch back to User Beta
      TaskRepository.setUser('user_beta');
      assert.strictEqual(TaskRepository.getAllTasks('default').length, 1);
      assert.strictEqual(TaskRepository.getAllTasks('default')[0].title, 'Beta Clean Task');
    });
  });

  describe('5. Loader Readiness Contract & Failure Boundary', () => {
    it('announces healthy readiness when repository initializes cleanly', async () => {
      TaskRepository.setUser(null);
      const readyResult = await TaskSystemLoader.ready();
      assert.strictEqual(readyResult.ok, true);
      assert.strictEqual(readyResult.healthy, true);
      assert.strictEqual(TaskSystemLoader.isHealthy(), true);
    });

    it('loader readiness never announces healthy state after failed initialization', async () => {
      // Seed corrupted key in the active user scope
      TaskRepository.setUser('user_broken');
      const corruptKey = TaskRepository._getScopedKey('tasks_v5.default');
      isolatedStorage.setItem(corruptKey, '{"corruptData: true'); // Invalid JSON

      // Create a fresh loader instance or reset loader state
      TaskSystemLoader._isInitialized = false;
      TaskSystemLoader._isHealthy = false;
      TaskSystemLoader._initPromise = null;

      // Attempt initialization
      const initSuccess = await TaskSystemLoader.initTaskSystem();
      assert.strictEqual(initSuccess, false, 'initTaskSystem must return false on failed integrity');

      // CRITICAL ACCEPTANCE ASSERTION:
      // isHealthy() must be false!
      assert.strictEqual(TaskSystemLoader.isHealthy(), false, 'isHealthy must be false after failed init');

      // ready() contract MUST reject rather than announcing healthy state
      await assert.rejects(
        async () => {
          await TaskSystemLoader.ready();
        },
        (err) => {
          assert.ok(err.message.includes('failed') || err.message.includes('unhealthy'));
          return true;
        },
        'ready() promise must reject after failed initialization'
      );
    });
  });
});
