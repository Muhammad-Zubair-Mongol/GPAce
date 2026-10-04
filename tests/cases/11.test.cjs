/**
 * Step 11: Make local JSON repositories durable and tenant-scoped.
 * 
 * Behavioral assertions:
 * 1. Cold start waits for directory creation and ready() contract.
 * 2. UID-scoped repository paths and disjoint tenant caches (User A / User B separation).
 * 3. UID validation prevents directory traversal and enforces standardized error shapes.
 * 4. Serialized writes per logical store ensure concurrent appends retain all items.
 * 5. Temp-plus-rename replacement ensures injected write/rename failures preserve last valid JSON and reject.
 * 6. Corrupt originals are retained for recovery and throw typed failures rather than returning empty results.
 * 7. Legacy singleton files are never silently assigned and require explicit owner migration.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs').promises;
const fsSync = require('node:fs');

const { createTempDir } = require('../harness/helpers.cjs');
const { DataStorage, StorageError } = require('../../server/dataStorage.js');

describe('Step 11: Durable and Tenant-Scoped Local JSON Repositories', () => {
  let temp;
  let storage;

  beforeEach(async () => {
    temp = createTempDir('storage-step11-');
    storage = new DataStorage({ dataDir: temp.path });
    await storage.ready();
  });

  afterEach(async () => {
    if (temp) {
      temp.cleanup();
    }
  });

  describe('1. Cold Start & Initialization', () => {
    it('waits for directories to be created during cold start operations', async () => {
      const coldDir = path.join(temp.path, 'uncreated-cold-dir');
      assert.strictEqual(fsSync.existsSync(coldDir), false, 'Cold dir should not exist before storage start');

      const coldStorage = new DataStorage({ dataDir: coldDir });

      // Immediate operation before awaiting ready() must not fail with ENOENT
      const saveResult = await coldStorage.saveTimetable([{ id: 'init-1', subject: 'Math' }], 'userInit');
      assert.strictEqual(saveResult, true);

      // Verify directory structure exists
      assert.strictEqual(fsSync.existsSync(coldDir), true);
      assert.strictEqual(fsSync.existsSync(path.join(coldDir, 'users')), true);
      assert.strictEqual(fsSync.existsSync(path.join(coldDir, 'users', 'userInit', 'timetable.json')), true);

      // Explicit ready() call resolves cleanly
      const readyInstance = await coldStorage.ready();
      assert.strictEqual(readyInstance, coldStorage);
    });
  });

  describe('2. Tenant Isolation & Disjoint Caches', () => {
    it('isolates repository paths and caches completely between user A and user B', async () => {
      const userAEvents = [{ id: 'evt-A', subject: 'Physics' }];
      const userBEvents = [{ id: 'evt-B', subject: 'Chemistry' }];

      await storage.saveTimetable(userAEvents, 'userA');
      await storage.saveTimetable(userBEvents, 'userB');

      // Verify returned data is disjoint
      const fetchedA = await storage.getTimetable('userA');
      const fetchedB = await storage.getTimetable('userB');
      assert.deepStrictEqual(fetchedA, userAEvents);
      assert.deepStrictEqual(fetchedB, userBEvents);

      // Verify physical paths are disjoint
      const pathA = storage.getRepositoryPath('userA', 'timetable');
      const pathB = storage.getRepositoryPath('userB', 'timetable');
      assert.notStrictEqual(pathA, pathB);
      assert.ok(pathA.includes(path.join('users', 'userA')));
      assert.ok(pathB.includes(path.join('users', 'userB')));

      // Clearing user A does not affect user B
      await storage.clearTimetable('userA');
      assert.deepStrictEqual(await storage.getTimetable('userA'), []);
      assert.deepStrictEqual(await storage.getTimetable('userB'), userBEvents);

      // In-memory cache is disjoint: modifying user A's cache doesn't affect user B
      storage.clearCache('userA');
      assert.deepStrictEqual(await storage.getTimetable('userB'), userBEvents);
    });

    it('provides scoped accessor via forTenant() that preserves isolation', async () => {
      const tenantA = storage.forTenant('tenantA');
      const tenantB = storage.forTenant('tenantB');

      await tenantA.saveSchedule([{ id: 'task-A', title: 'Complete Lab' }]);
      await tenantB.saveSchedule([{ id: 'task-B', title: 'Study Quiz' }]);

      assert.deepStrictEqual(await tenantA.getSchedule(), [{ id: 'task-A', title: 'Complete Lab' }]);
      assert.deepStrictEqual(await tenantB.getSchedule(), [{ id: 'task-B', title: 'Study Quiz' }]);
    });
  });

  describe('3. Strict UID Validation & Security', () => {
    it('rejects missing or empty tenant UIDs with typed StorageError', async () => {
      await assert.rejects(
        async () => {
          await storage.getTimetable();
        },
        (err) => {
          assert.strictEqual(err.name, 'StorageError');
          assert.strictEqual(err.code, 'TENANT_REQUIRED');
          assert.ok(err.error && err.error.code === 'TENANT_REQUIRED');
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await storage.getLocations('');
        },
        (err) => {
          assert.strictEqual(err.name, 'StorageError');
          assert.strictEqual(err.code, 'INVALID_UID');
          return true;
        }
      );
    });

    it('rejects path traversal and illegal character UIDs', async () => {
      const maliciousUids = [
        '../victim',
        '..\\victim',
        '../../root',
        'sub/dir',
        'sub\\dir',
        'user:admin',
        'user\0null',
        '.',
        '..'
      ];

      for (const badUid of maliciousUids) {
        await assert.rejects(
          async () => {
            await storage.getTimetable(badUid);
          },
          (err) => {
            assert.strictEqual(err.name, 'StorageError');
            assert.strictEqual(err.code, 'INVALID_UID');
            return true;
          },
          `Should reject malicious UID: ${badUid}`
        );
      }
    });
  });

  describe('4. Serialized Writes & Concurrent Appends', () => {
    it('concurrent appends retain both items without lost updates', async () => {
      const loc1 = { id: 'loc-1', name: 'Desk 1' };
      const loc2 = { id: 'loc-2', name: 'Desk 2' };

      // Launch both appends simultaneously
      const [res1, res2] = await Promise.all([
        storage.saveLocation(loc1, 'concurrencyUser'),
        storage.saveLocation(loc2, 'concurrencyUser')
      ]);

      assert.strictEqual(res1, true);
      assert.strictEqual(res2, true);

      const locations = await storage.getLocations('concurrencyUser');
      assert.strictEqual(locations.spaces.length, 2, 'Both spaces must be retained');
      const ids = locations.spaces.map(s => s.id);
      assert.ok(ids.includes('loc-1'), 'loc-1 must be present');
      assert.ok(ids.includes('loc-2'), 'loc-2 must be present');
    });

    it('burst of concurrent appends retains every item', async () => {
      const count = 10;
      const promises = [];
      for (let i = 0; i < count; i++) {
        promises.push(storage.saveLocation({ id: `burst-${i}`, index: i }, 'burstUser'));
      }

      const results = await Promise.all(promises);
      assert.ok(results.every(r => r === true));

      const locations = await storage.getLocations('burstUser');
      assert.strictEqual(locations.spaces.length, count, `All ${count} items must be retained`);

      const ids = new Set(locations.spaces.map(s => s.id));
      for (let i = 0; i < count; i++) {
        assert.ok(ids.has(`burst-${i}`), `Item burst-${i} must be retained`);
      }
    });
  });

  describe('5. Temp-plus-Rename Durability on Injected Failures', () => {
    it('injected writeFile failure preserves last valid JSON and rejects', async () => {
      const validInitial = [{ id: 'evt-init', subject: 'Calculus' }];
      await storage.saveTimetable(validInitial, 'failTestUser');

      const originalWriteFile = storage._fs.writeFile;
      storage._fs.writeFile = async () => {
        throw new Error('Injected disk full error during writeFile');
      };

      try {
        await assert.rejects(
          async () => {
            await storage.saveTimetable(
              [{ id: 'evt-init', subject: 'Calculus' }, { id: 'evt-corrupt', subject: 'Lost' }],
              'failTestUser'
            );
          },
          (err) => {
            assert.strictEqual(err.name, 'StorageError');
            assert.strictEqual(err.code, 'WRITE_FAILED');
            assert.match(err.message, /Injected disk full error/);
            return true;
          }
        );
      } finally {
        storage._fs.writeFile = originalWriteFile;
      }

      // Verify that the file on disk still contains the last valid JSON
      const preservedData = await storage.getTimetable('failTestUser');
      assert.deepStrictEqual(preservedData, validInitial, 'Last valid JSON must be preserved on write failure');

      const diskRaw = await fs.readFile(storage.getRepositoryPath('failTestUser', 'timetable'), 'utf8');
      assert.deepStrictEqual(JSON.parse(diskRaw).events, validInitial);
    });

    it('injected rename failure preserves last valid JSON, rejects, and cleans temp files', async () => {
      const validInitial = [{ id: 'evt-init-rename', subject: 'Biology' }];
      await storage.saveTimetable(validInitial, 'failRenameUser');

      const originalRename = storage._fs.rename;
      storage._fs.rename = async () => {
        throw new Error('Injected rename lock failure');
      };

      try {
        await assert.rejects(
          async () => {
            await storage.saveTimetable(
              [{ id: 'evt-init-rename', subject: 'Biology' }, { id: 'evt-lost', subject: 'ShouldFail' }],
              'failRenameUser'
            );
          },
          (err) => {
            assert.strictEqual(err.name, 'StorageError');
            assert.strictEqual(err.code, 'WRITE_FAILED');
            assert.match(err.message, /Injected rename lock failure/);
            return true;
          }
        );
      } finally {
        storage._fs.rename = originalRename;
      }

      // Verify that the file on disk still contains the last valid JSON
      const preservedData = await storage.getTimetable('failRenameUser');
      assert.deepStrictEqual(preservedData, validInitial);

      // Verify temp files were cleaned up
      const tenantDir = storage.getTenantDir('failRenameUser');
      const remainingFiles = await fs.readdir(tenantDir);
      const tempFiles = remainingFiles.filter(f => f.endsWith('.tmp'));
      assert.strictEqual(tempFiles.length, 0, 'No dangling temp files should remain');
    });
  });

  describe('6. Corrupt Originals Retention for Recovery', () => {
    it('retains corrupt file originals for recovery and rejects with typed CORRUPT_DATA', async () => {
      const user = 'corruptUser';
      // Initialize valid file first
      await storage.saveLocation({ id: 'loc-pre', name: 'Before Corrupt' }, user);

      // Invalidate cache and inject corrupted JSON content directly onto disk
      storage.clearCache(user);
      const locPath = storage.getRepositoryPath(user, 'locations');
      const corruptedBytes = '{"spaces": [ { corrupt-json-without-end ';
      await fs.writeFile(locPath, corruptedBytes, 'utf8');

      // Attempting to read must reject with typed CORRUPT_DATA (never return empty spaces)
      await assert.rejects(
        async () => {
          await storage.getLocations(user);
        },
        (err) => {
          assert.strictEqual(err.name, 'StorageError');
          assert.strictEqual(err.code, 'CORRUPT_DATA');
          assert.strictEqual(err.details.storeName, 'locations');
          assert.strictEqual(err.details.uid, user);
          return true;
        }
      );

      // Verify that corrupt file was preserved on disk
      const tenantFiles = await fs.readdir(storage.getTenantDir(user));
      const corruptBackups = tenantFiles.filter(f => f.includes('locations.json.corrupt'));
      assert.ok(corruptBackups.length > 0, 'Corrupt backup file must exist on disk for recovery');

      const backupContent = await fs.readFile(path.join(storage.getTenantDir(user), corruptBackups[0]), 'utf8');
      assert.strictEqual(backupContent, corruptedBytes, 'Corrupt original content must match preserved backup');
    });
  });

  describe('7. Legacy Singleton Isolation & Explicit Migration', () => {
    it('never silently assigns legacy data to users, and requires explicit owner migration', async () => {
      const legacyDir = path.join(temp.path, 'legacy-root-test');
      await fs.mkdir(legacyDir, { recursive: true });

      // Seed legacy singleton files in root
      const legacyEvents = [{ id: 'legacy-evt-1', title: 'Old Singleton Event' }];
      const legacySpaces = [{ id: 'legacy-loc-1', name: 'Old Library Space' }];
      await fs.writeFile(path.join(legacyDir, 'timetable.json'), JSON.stringify({ events: legacyEvents }), 'utf8');
      await fs.writeFile(path.join(legacyDir, 'locations.json'), JSON.stringify({ spaces: legacySpaces }), 'utf8');

      const legacyStorage = new DataStorage({ dataDir: legacyDir });
      await legacyStorage.ready();

      // 1. Calling without UID rejects and never silently accesses legacy files
      await assert.rejects(
        async () => {
          await legacyStorage.getTimetable();
        },
        (err) => {
          assert.strictEqual(err.code, 'TENANT_REQUIRED');
          return true;
        }
      );

      // 2. A new user querying storage does NOT silently receive legacy data
      const newbieTimetable = await legacyStorage.getTimetable('newbieUser');
      assert.deepStrictEqual(newbieTimetable, [], 'Newbie must not be silently assigned legacy timetable');

      const newbieLocations = await legacyStorage.getLocations('newbieUser');
      assert.deepStrictEqual(newbieLocations, { spaces: [] }, 'Newbie must not be silently assigned legacy locations');

      // 3. Explicit owner migration migrates data specifically to designated owner
      const migrationResult = await legacyStorage.migrateLegacyData('designatedOwner');
      assert.strictEqual(migrationResult.success, true);
      assert.strictEqual(migrationResult.migrated, true);
      assert.strictEqual(migrationResult.targetUid, 'designatedOwner');
      assert.ok(migrationResult.migratedStores.includes('timetable'));
      assert.ok(migrationResult.migratedStores.includes('locations'));

      // 4. Designated owner now has the migrated data
      const ownerTimetable = await legacyStorage.getTimetable('designatedOwner');
      assert.deepStrictEqual(ownerTimetable, legacyEvents);

      const ownerLocations = await legacyStorage.getLocations('designatedOwner');
      assert.deepStrictEqual(ownerLocations, { spaces: legacySpaces });

      // 5. Other users still remain completely isolated
      const otherUserTimetable = await legacyStorage.getTimetable('otherUser');
      assert.deepStrictEqual(otherUserTimetable, []);

      // 6. Legacy root files are archived and cannot be silently assigned
      assert.strictEqual(fsSync.existsSync(path.join(legacyDir, 'timetable.json')), false);
      assert.strictEqual(fsSync.existsSync(path.join(legacyDir, 'locations.json')), false);
    });

    it('rejects migration with typed failure if legacy file is corrupt and retains original', async () => {
      const corruptLegacyDir = path.join(temp.path, 'corrupt-legacy-root');
      await fs.mkdir(corruptLegacyDir, { recursive: true });

      const corruptContent = '{ "events": [ corrupt-legacy-bytes ';
      await fs.writeFile(path.join(corruptLegacyDir, 'timetable.json'), corruptContent, 'utf8');

      const storageWithCorruptLegacy = new DataStorage({ dataDir: corruptLegacyDir });
      await storageWithCorruptLegacy.ready();

      await assert.rejects(
        async () => {
          await storageWithCorruptLegacy.migrateLegacyData('recoveryUser');
        },
        (err) => {
          assert.strictEqual(err.name, 'StorageError');
          assert.strictEqual(err.code, 'CORRUPT_DATA');
          return true;
        }
      );

      // Verify that corrupt legacy original is retained
      const rootFiles = await fs.readdir(corruptLegacyDir);
      const corruptBackups = rootFiles.filter(f => f.includes('timetable.json.corrupt'));
      assert.ok(corruptBackups.length > 0, 'Corrupt legacy file must be backed up for recovery');
    });
  });
});
