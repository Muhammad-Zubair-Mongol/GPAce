/**
 * Case 40: Make local storage outcomes and user boundaries explicit
 * 
 * Verifies the contract for Step 40:
 * - Typed outcomes: 'success', 'quota_exceeded', 'security_denied', 'corrupt'
 * - Quota and security failures are distinguishable
 * - Verified UID-derived tenancy: userA -> signout -> userB cannot read A-scoped task/key state
 * - Failed migration retains recoverable source data
 * - Crypto failure never silently claims encrypted protection
 * - Offline uncommitted drafts and unrelated origin keys survive
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createIsolatedStorage } = require('../harness/helpers.cjs');

describe('Step 40: Local Storage Outcomes & User Boundaries', () => {
  let isolatedStorage;
  let storageService;
  let StorageAdapter;
  let secureStorage;
  let authModule;

  beforeEach(async () => {
    // Fresh isolated storage for each test
    isolatedStorage = createIsolatedStorage();
    globalThis.localStorage = isolatedStorage;
    globalThis.window = globalThis;

    // Load modules dynamically
    const storageServiceMod = await import('../../js/services/StorageService.js');
    storageService = storageServiceMod.default;
    storageService.setStorageBackend(isolatedStorage);
    storageService.setUser(null); // start as anonymous

    const storageAdapterMod = await import('../../js/utils/StorageAdapter.js');
    StorageAdapter = storageAdapterMod;

    const secureStorageMod = await import('../../js/services/SecureStorage.js');
    secureStorage = secureStorageMod.default;
    secureStorage.setUser(null);

    const authMod = await import('../../js/auth.js');
    authModule = authMod;
  });

  describe('1. Explicit Typed Outcomes & Failure Distinguishability', () => {
    it('returns typed outcome with status "success" and success: true on valid write', () => {
      const outcome = storageService.set('testKey', { data: 123 });
      assert.strictEqual(outcome.success, true);
      assert.strictEqual(outcome.status, 'success');
      assert.strictEqual(outcome.error, null);
      assert.strictEqual(outcome == true, true);
    });

    it('distinguishes quota_exceeded from other errors', () => {
      // Storage with a tiny quota (e.g. 50 bytes)
      const tinyStorage = createIsolatedStorage({ quotaLimit: 40 });
      storageService.setStorageBackend(tinyStorage);

      const largePayload = { text: 'a'.repeat(200) };
      const outcome = storageService.set('largeKey', largePayload);

      assert.strictEqual(outcome.success, false);
      assert.strictEqual(outcome.status, 'quota_exceeded');
      assert.strictEqual(outcome == false, true);
      assert.ok(outcome.error, 'Should contain underlying quota error');
    });

    it('distinguishes security_denied when storage access is denied', () => {
      // Storage backend that throws SecurityError on setItem
      const restrictedStorage = {
        getItem() { return null; },
        setItem() {
          const err = new Error('Access is denied for this origin');
          err.name = 'SecurityError';
          err.code = 18;
          throw err;
        },
        removeItem() {},
        clear() {},
        key() { return null; },
        length: 0
      };

      storageService.setStorageBackend(restrictedStorage);
      const outcome = storageService.set('restrictedKey', { val: 1 });

      assert.strictEqual(outcome.success, false);
      assert.strictEqual(outcome.status, 'security_denied');
      assert.ok(outcome.error);
      assert.strictEqual(outcome.error.name, 'SecurityError');
    });

    it('quota_exceeded and security_denied are strictly distinguishable', () => {
      const tinyStorage = createIsolatedStorage({ quotaLimit: 20 });
      storageService.setStorageBackend(tinyStorage);
      const quotaOutcome = storageService.set('quotaKey', 'x'.repeat(100));

      const restrictedStorage = {
        setItem() {
          const err = new Error('SecurityError: The operation is insecure');
          err.name = 'SecurityError';
          throw err;
        },
        getItem() { return null; },
        removeItem() {},
        clear() {},
        key() { return null; },
        length: 0
      };
      storageService.setStorageBackend(restrictedStorage);
      const securityOutcome = storageService.set('secKey', 'val');

      assert.notStrictEqual(quotaOutcome.status, securityOutcome.status);
      assert.strictEqual(quotaOutcome.status, 'quota_exceeded');
      assert.strictEqual(securityOutcome.status, 'security_denied');
    });

    it('reports status "corrupt" on malformed JSON without throwing or destroying raw data', () => {
      // Write corrupted JSON directly into the scoped key
      const scopedKey = storageService.getScopePrefix() + 'corruptKey';
      isolatedStorage.setItem(scopedKey, '{"incompleteJson: 123');

      // Normal get returns defaultValue and records corrupt outcome
      const val = storageService.get('corruptKey', 'myFallback');
      assert.strictEqual(val, 'myFallback');

      const outcome = storageService.getLastOutcome();
      assert.strictEqual(outcome.success, false);
      assert.strictEqual(outcome.status, 'corrupt');

      // getWithOutcome exposes the outcome directly
      const outcomeDirect = storageService.getWithOutcome('corruptKey', 'myFallback');
      assert.strictEqual(outcomeDirect.success, false);
      assert.strictEqual(outcomeDirect.status, 'corrupt');
      assert.strictEqual(outcomeDirect.value, 'myFallback');

      // CRITICAL: Raw corrupted data must still exist in storage so it is recoverable
      assert.strictEqual(isolatedStorage.getItem(scopedKey), '{"incompleteJson: 123');
    });

    it('reports status "missing" for non-existent keys', () => {
      const outcome = storageService.getWithOutcome('nonExistentKey', 'defaultVal');
      assert.strictEqual(outcome.success, true);
      assert.strictEqual(outcome.status, 'missing');
      assert.strictEqual(outcome.value, 'defaultVal');
    });
  });

  describe('2. User Boundary & Tenancy (userA -> signout -> userB)', () => {
    it('isolates state so userB cannot read userA tasks or keys through adapters', () => {
      const adapter = StorageAdapter.getStorage();

      // Step A: User A signs in
      authModule.handleAuthStateChange({ uid: 'user_alpha', email: 'alpha@example.com' });
      assert.strictEqual(storageService.getUser(), 'user_alpha');

      // User A creates tasks and preferences
      const tasksA = [
        { id: 'task-a1', title: 'User Alpha Secret Task', completed: false },
        { id: 'task-a2', title: 'User Alpha Math Study', completed: true }
      ];
      adapter.set('tasks', tasksA);
      adapter.set('userPreferences', { theme: 'dark', sound: true });

      // Verify User A can read them
      const readAlphaTasks = adapter.get('tasks');
      assert.deepStrictEqual(readAlphaTasks, tasksA);
      assert.deepStrictEqual(adapter.get('userPreferences'), { theme: 'dark', sound: true });

      // Step B: User A signs out
      authModule.signOutUser();
      assert.strictEqual(storageService.getUser(), null, 'Should switch to anonymous');

      // In anonymous mode, userA tasks must NOT be returned
      const anonTasks = adapter.get('tasks');
      assert.strictEqual(anonTasks, null, 'Anonymous user must not see User A tasks');
      assert.strictEqual(adapter.get('userPreferences'), null);

      // Step C: User B signs in
      authModule.handleAuthStateChange({ uid: 'user_beta', email: 'beta@example.com' });
      assert.strictEqual(storageService.getUser(), 'user_beta');

      // User B must NOT see User A's tasks or preferences through adapter
      const readBetaTasksBeforeWrite = adapter.get('tasks');
      assert.strictEqual(readBetaTasksBeforeWrite, null, 'User B must not read User A tasks');
      assert.strictEqual(adapter.get('userPreferences'), null, 'User B must not read User A preferences');

      // User B writes their own tasks
      const tasksB = [{ id: 'task-b1', title: 'User Beta Physics Exam', completed: false }];
      adapter.set('tasks', tasksB);
      assert.deepStrictEqual(adapter.get('tasks'), tasksB);

      // Step D: User B signs out and User A signs back in
      authModule.signOutUser();
      authModule.handleAuthStateChange({ uid: 'user_alpha', email: 'alpha@example.com' });

      // User A reads their original tasks intact
      assert.deepStrictEqual(adapter.get('tasks'), tasksA, 'User A data must be intact');

      // User B tasks still survive under user_beta namespace
      authModule.handleAuthStateChange({ uid: 'user_beta', email: 'beta@example.com' });
      assert.deepStrictEqual(adapter.get('tasks'), tasksB, 'User B data must be intact');
    });

    it('resets in-memory caches upon sign-out and account switch', () => {
      authModule.handleAuthStateChange({ uid: 'user_cached_1' });
      storageService.userCaches.set('memoized_calc', 999);
      secureStorage.keyCache.set('test_key', 'cached_crypto_key');

      // Sign out
      authModule.signOutUser();

      assert.strictEqual(storageService.userCaches.size, 0, 'User cache must be emptied on sign out');
      assert.strictEqual(secureStorage.keyCache.size, 0, 'SecureStorage keyCache must be emptied on sign out');
    });
  });

  describe('3. Failed Migration Retains Recoverable Source', () => {
    it('retains source key in storage if migration write fails', () => {
      // Setup legacy un-prefixed keys in localStorage
      isolatedStorage.setItem('academicSubjects', JSON.stringify([{ id: 1, name: 'Chemistry' }]));
      isolatedStorage.setItem('workspaceContent', 'Important unsaved notes');

      // Target storage with tight quota that permits first write but fails second write
      const mockStorage = {
        _data: new Map(Object.entries(isolatedStorage.dump())),
        getItem(k) { return this._data.get(k) || null; },
        setItem(k, v) {
          if (k.includes('workspace')) {
            const err = new Error('QuotaExceededError: storage full');
            err.name = 'QuotaExceededError';
            err.code = 22;
            throw err;
          }
          this._data.set(k, v);
        },
        removeItem(k) { this._data.delete(k); },
        get length() { return this._data.size; },
        key(i) { return Array.from(this._data.keys())[i] || null; }
      };

      storageService.setStorageBackend(mockStorage);

      const migrationMap = {
        'academicSubjects': 'subjects',
        'workspaceContent': 'workspace.document'
      };

      const report = storageService.migrateLegacyKeys(migrationMap);

      assert.strictEqual(report.success, false, 'Migration report should reflect partial failure');
      assert.strictEqual(report.migrated, 1, 'One key migrated successfully');
      assert.strictEqual(report.failed, 1, 'One key failed migration');

      // The successfully migrated key was removed from source
      assert.strictEqual(mockStorage.getItem('academicSubjects'), null);

      // CRITICAL ASSERTION: The failed key MUST RETAIN its recoverable source!
      const retainedSource = mockStorage.getItem('workspaceContent');
      assert.strictEqual(retainedSource, 'Important unsaved notes', 'Failed migration MUST retain recoverable source data');
    });

    it('cleanly removes source key on successful migration', () => {
      isolatedStorage.setItem('legacyTheme', 'dark');
      const report = storageService.migrateLegacyKeys({ 'legacyTheme': 'theme' });

      assert.strictEqual(report.success, true);
      assert.strictEqual(report.migrated, 1);
      assert.strictEqual(isolatedStorage.getItem('legacyTheme'), null, 'Source key removed after success');
      assert.strictEqual(storageService.get('theme'), 'dark', 'Destination key accessible');
    });
  });

  describe('4. Cryptographic Protections in SecureStorage', () => {
    it('encrypts with AES-GCM and round-trips correctly when crypto is available', async () => {
      secureStorage.setUser('user_crypto_1');
      storageService.setUser('user_crypto_1');

      const outcome = await secureStorage.setSecure('apiKey', 'sk-test-secret-12345');
      assert.strictEqual(outcome.success, true);
      assert.strictEqual(outcome.encrypted, true);
      assert.strictEqual(outcome.claimedProtection, true);

      // Verify stored representation starts with ENC:
      const rawStored = isolatedStorage.getItem(storageService.getScopePrefix() + 'secure_apiKey');
      assert.ok(rawStored.startsWith('ENC:'), 'Must store with ENC: prefix');

      // Decrypt
      const decrypted = await secureStorage.getSecure('apiKey');
      assert.strictEqual(decrypted, 'sk-test-secret-12345');
    });

    it('never silently claims encrypted protection when crypto fails', async () => {
      // Mock SecureStorage instance with broken/unavailable crypto
      const noCryptoSecureStorage = new (secureStorage.constructor)({
        crypto: { subtle: null }
      });

      // Default call: must throw CryptoError and NOT silently fall back to plaintext
      await assert.rejects(
        async () => {
          await noCryptoSecureStorage.setSecure('sensitiveKey', 'my-secret');
        },
        (err) => {
          assert.strictEqual(err.name, 'CryptoError');
          assert.strictEqual(err.claimedProtection, false);
          return true;
        },
        'Must reject with CryptoError when crypto is unavailable'
      );

      // With throwOnError: false, returns explicit failed status and claimedProtection: false
      const failedResult = await noCryptoSecureStorage.setSecure('sensitiveKey', 'my-secret', { throwOnError: false });
      assert.strictEqual(failedResult.success, false);
      assert.strictEqual(failedResult.encrypted, false);
      assert.strictEqual(failedResult.claimedProtection, false);
      assert.strictEqual(failedResult.status, 'crypto_failed');

      // With allowUnencrypted: true, explicitly stores as unencrypted and NEVER claims ENC:
      const unencryptedResult = await noCryptoSecureStorage.setSecure('optInKey', 'plain-secret', { allowUnencrypted: true });
      assert.strictEqual(unencryptedResult.success, true);
      assert.strictEqual(unencryptedResult.encrypted, false);
      assert.strictEqual(unencryptedResult.claimedProtection, false);
      assert.strictEqual(unencryptedResult.status, 'unencrypted');

      // Stored value must start with PLAIN: and NEVER with ENC:
      const rawStored = storageService.get('secure_optInKey', null, { raw: true });
      assert.ok(rawStored.startsWith('PLAIN:'), 'Must be stored with PLAIN: prefix');
      assert.ok(!rawStored.startsWith('ENC:'), 'Must never claim ENC: for unencrypted data');
    });

    it('isolates crypto keys so userB cannot decrypt userA ciphertext', async () => {
      // User A encrypts
      secureStorage.setUser('user_crypto_A');
      storageService.setUser('user_crypto_A');
      await secureStorage.setSecure('sharedKeyName', 'Alpha Secret Data');

      const userACiphertext = storageService.get('secure_sharedKeyName', null, { raw: true });
      assert.ok(userACiphertext.startsWith('ENC:'));

      // Switch to User B
      secureStorage.setUser('user_crypto_B');
      storageService.setUser('user_crypto_B');

      // In user B namespace, key does not exist
      assert.strictEqual(await secureStorage.getSecure('sharedKeyName'), null);

      // Even if user A ciphertext were somehow placed into user B namespace,
      // user B's derived key cannot decrypt it
      storageService.set('secure_sharedKeyName', userACiphertext, { raw: true });
      const decryptedByB = await secureStorage.getSecure('sharedKeyName');
      assert.strictEqual(decryptedByB, null, 'User B derived key must not decrypt User A data');
    });

    it('defaults BYOK to session-only storage with explicit persistence opt-in', async () => {
      // Default setApiKey is session-only
      const sessionResult = await secureStorage.setApiKey('gemini', 'gemini-key-1234');
      assert.strictEqual(sessionResult.success, true);
      assert.strictEqual(sessionResult.status, 'session_only');
      assert.strictEqual(sessionResult.persisted, false);

      // Accessible via getApiKey
      assert.strictEqual(await secureStorage.getApiKey('gemini'), 'gemini-key-1234');

      // NOT in persistent storageService
      assert.strictEqual(storageService.has('secure_api_gemini'), false);

      // With persist: true, it persists to encrypted storage
      const persistResult = await secureStorage.setApiKey('gemini', 'gemini-key-1234', { persist: true });
      assert.strictEqual(persistResult.success, true);
      assert.strictEqual(persistResult.persisted, true);
      assert.strictEqual(persistResult.encrypted, true);
      assert.strictEqual(storageService.has('secure_api_gemini'), true);
    });
  });

  describe('5. Unrelated Keys & Offline Uncommitted Drafts Survival', () => {
    it('preserves offline uncommitted drafts across sign-in and sign-out', () => {
      // 1. Anonymous user writes uncommitted draft
      storageService.setUser(null);
      storageService.set('workspaceDraft', { title: 'Offline Document Draft', body: 'Draft content' });

      // 2. User A signs in
      authModule.handleAuthStateChange({ uid: 'user_authenticated_1' });
      assert.strictEqual(storageService.get('workspaceDraft'), null, 'User A sees their own empty state');

      // 3. User A signs out
      authModule.signOutUser();

      // 4. Anonymous offline uncommitted draft must be intact!
      const draft = storageService.get('workspaceDraft');
      assert.deepStrictEqual(draft, { title: 'Offline Document Draft', body: 'Draft content' }, 'Offline draft must survive sign-out');
    });

    it('clear() only removes user-scoped keys and never touches unrelated origin data', () => {
      // Seed unrelated third-party keys in localStorage
      isolatedStorage.setItem('firebase:authUser:apiKey', 'fb-token-123');
      isolatedStorage.setItem('other_app_setting', 'preserve_me');

      // User A writes data
      storageService.setUser('user_alpha');
      storageService.set('task_1', { name: 'Alpha Task' });
      storageService.set('task_2', { name: 'Alpha Task 2' });

      // Anonymous also has data
      storageService.setUser(null);
      storageService.set('anon_draft', 'survive');

      // User A signs back in and calls clear()
      storageService.setUser('user_alpha');
      const removedCount = storageService.clear();

      assert.strictEqual(removedCount, 2, 'Should clear exactly User A keys');
      assert.strictEqual(storageService.get('task_1'), null);

      // CRITICAL: Unrelated origin data and anonymous drafts must SURVIVE!
      assert.strictEqual(isolatedStorage.getItem('firebase:authUser:apiKey'), 'fb-token-123');
      assert.strictEqual(isolatedStorage.getItem('other_app_setting'), 'preserve_me');

      storageService.setUser(null);
      assert.strictEqual(storageService.get('anon_draft'), 'survive');
    });
  });
});
