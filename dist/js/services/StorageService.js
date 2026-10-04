/**
 * StorageService.js
 * Centralized localStorage abstraction with validation, versioning, typed error outcomes,
 * and verified UID-derived tenancy.
 * Part of Step 40: Storage Layer Abstraction & Boundary Enforcement.
 * 
 * Features:
 * - Verified UID-derived tenancy: keys isolated by user UID (e.g. gpace_u_<uid>_)
 * - Distinct anonymous namespace (gpace_anon_) for offline uncommitted drafts
 * - Explicit typed outcomes: 'success', 'quota_exceeded', 'security_denied', 'corrupt', 'error'
 * - Account switch / sign-out resets in-memory caches without destroying drafts
 * - Failed migration retains recoverable source data
 * - Safe clearing: never touches unrelated origin data
 */

const STORAGE_PREFIX = 'gpace_';
const SCHEMA_VERSION_KEY = 'gpace_schema_version';
const CURRENT_SCHEMA_VERSION = 1;

/**
 * StorageOutcome represents the explicit typed outcome of a storage operation.
 */
export class StorageOutcome {
    constructor(success, status, error = null, value = undefined) {
        this.success = Boolean(success);
        this.status = status; // 'success' | 'quota_exceeded' | 'security_denied' | 'corrupt' | 'missing' | 'error'
        this.error = error;
        if (value !== undefined) {
            this.value = value;
        }
    }

    get ok() {
        return this.success;
    }

    valueOf() {
        return this.success;
    }

    toString() {
        return this.status;
    }

    [Symbol.toPrimitive](hint) {
        if (hint === 'number') return this.success ? 1 : 0;
        if (hint === 'string') return this.status;
        return this.success;
    }
}

class StorageService {
    constructor(options = {}) {
        this.basePrefix = STORAGE_PREFIX;
        this.schemaVersion = CURRENT_SCHEMA_VERSION;
        this.currentUserId = null;
        this.listeners = new Map();
        this.userCaches = new Map();
        this.lastOutcome = null;
        this._storageBackend = options.storage || null;

        // Check and run migrations if storage backend is available
        try {
            if (this._getStorage()) {
                this._checkMigrations();
            }
        } catch {
            // Storage may not be ready during earliest initialization
        }
    }

    /**
     * Resolves the active underlying Web Storage backend
     * @private
     */
    _getStorage() {
        if (this._storageBackend) {
            return this._storageBackend;
        }
        if (typeof localStorage !== 'undefined') {
            return localStorage;
        }
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage;
        }
        if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
            return globalThis.localStorage;
        }
        return null;
    }

    /**
     * Inject a custom storage backend (e.g. for isolated test harnesses)
     * @param {Object} storage - Storage object implementing Web Storage API
     */
    setStorageBackend(storage) {
        this._storageBackend = storage;
        try {
            if (storage) {
                this._checkMigrations();
            }
        } catch {}
    }

    /**
     * Set the current verified user UID.
     * Switches the active key-space and resets in-memory user caches.
     * Does NOT destroy offline uncommitted drafts or other users' data.
     * @param {string|null} uid - Verified Firebase user UID or null for anonymous
     * @returns {string} The active scope prefix
     */
    setUser(uid) {
        const normalizedUid = (uid && typeof uid === 'string' && uid.trim().length > 0)
            ? uid.trim()
            : null;

        if (this.currentUserId !== normalizedUid) {
            this.clearUserCache();
            this.currentUserId = normalizedUid;
        }

        return this.getScopePrefix();
    }

    /**
     * Get the current user UID (or null if anonymous)
     * @returns {string|null}
     */
    getUser() {
        return this.currentUserId;
    }

    /**
     * Reset in-memory user caches on sign-out or account switch
     */
    clearUserCache() {
        this.userCaches.clear();
    }

    /**
     * Get the prefix for the active scope.
     * Authenticated users: gpace_u_<uid>_
     * Anonymous users: gpace_anon_
     * @returns {string}
     */
    getScopePrefix() {
        if (this.currentUserId) {
            return `${this.basePrefix}u_${this.currentUserId}_`;
        }
        return `${this.basePrefix}anon_`;
    }

    /**
     * Classifies an error into an explicit typed outcome status
     * @private
     */
    _classifyError(error) {
        if (!error) return 'error';

        const name = error.name || '';
        const code = error.code;
        const msg = (error.message || '').toLowerCase();

        // Quota errors
        if (
            name === 'QuotaExceededError' ||
            name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
            code === 22 ||
            code === 1014 ||
            msg.includes('quota')
        ) {
            return 'quota_exceeded';
        }

        // Security / Permission errors
        if (
            name === 'SecurityError' ||
            code === 18 ||
            msg.includes('security') ||
            msg.includes('access is denied') ||
            msg.includes('denied')
        ) {
            return 'security_denied';
        }

        // Corrupt / serialization errors
        if (
            error instanceof SyntaxError ||
            msg.includes('json') ||
            msg.includes('circular') ||
            msg.includes('corrupt')
        ) {
            return 'corrupt';
        }

        return 'error';
    }

    /**
     * Record and return an operation outcome
     * @private
     */
    _recordOutcome(success, status, error = null, value = undefined) {
        const outcome = new StorageOutcome(success, status, error, value);
        this.lastOutcome = outcome;
        return outcome;
    }

    /**
     * Get the outcome of the most recent storage operation
     * @returns {StorageOutcome|null}
     */
    getLastOutcome() {
        return this.lastOutcome;
    }

    /**
     * Get a value from storage
     * @param {string} key - The storage key (without prefix)
     * @param {*} defaultValue - Default value if key doesn't exist or parse fails
     * @param {Object} options - Optional settings
     * @param {boolean} options.raw - If true, return raw string without JSON parsing
     * @param {Function} options.validate - Validation function, returns boolean
     * @param {boolean} options.outcome - If true, return StorageOutcome object
     * @param {boolean} options.global - If true, use global scope (e.g. device settings)
     * @returns {*} The stored value or defaultValue (or StorageOutcome if options.outcome)
     */
    get(key, defaultValue = null, options = {}) {
        const storage = this._getStorage();
        if (!storage) {
            const outcome = this._recordOutcome(false, 'security_denied', new Error('Storage backend not accessible'));
            return options.outcome ? outcome : defaultValue;
        }

        const fullKey = this._prefixKey(key, options);

        try {
            const raw = storage.getItem(fullKey);

            if (raw === null) {
                const outcome = this._recordOutcome(true, 'missing', null, defaultValue);
                return options.outcome ? outcome : defaultValue;
            }

            // Return raw string if requested
            if (options.raw) {
                const outcome = this._recordOutcome(true, 'success', null, raw);
                return options.outcome ? outcome : raw;
            }

            // Parse JSON with corrupt protection
            try {
                const parsed = JSON.parse(raw);

                // Validate if validator provided
                if (options.validate && typeof options.validate === 'function') {
                    if (!options.validate(parsed)) {
                        console.warn(`[StorageService] Validation failed for key: ${key}`);
                        const outcome = this._recordOutcome(false, 'corrupt', new Error(`Validation failed for key: ${key}`), defaultValue);
                        return options.outcome ? outcome : defaultValue;
                    }
                }

                const outcome = this._recordOutcome(true, 'success', null, parsed);
                return options.outcome ? outcome : parsed;
            } catch (parseError) {
                // Check if it's a legacy plain string (like 'dark' or 'light')
                if (typeof raw === 'string' && raw.length > 0) {
                    const trimmed = raw.trim();
                    if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !options.strictJson) {
                        const outcome = this._recordOutcome(true, 'success', null, raw);
                        return options.outcome ? outcome : raw;
                    }
                }

                // Broken JSON: retain original raw data in storage, return defaultValue and mark as corrupt
                console.warn(`[StorageService] Corrupted data encountered for key "${key}". Retaining raw data.`);
                const outcome = this._recordOutcome(false, 'corrupt', parseError, defaultValue);
                return options.outcome ? outcome : defaultValue;
            }
        } catch (error) {
            const status = this._classifyError(error);
            console.warn(`[StorageService] Error reading key "${key}":`, error.message);
            const outcome = this._recordOutcome(false, status, error, defaultValue);
            return options.outcome ? outcome : defaultValue;
        }
    }

    /**
     * Get a value with explicit StorageOutcome metadata
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default value
     * @param {Object} options - Options
     * @returns {StorageOutcome}
     */
    getWithOutcome(key, defaultValue = null, options = {}) {
        return this.get(key, defaultValue, { ...options, outcome: true });
    }

    /**
     * Set a value in storage
     * @param {string} key - The storage key (without prefix)
     * @param {*} value - The value to store
     * @param {Object} options - Optional settings
     * @param {boolean} options.raw - If true, store raw string without JSON.stringify
     * @param {boolean} options.global - If true, store in global device space
     * @returns {StorageOutcome} Outcome with success status, status string, and error if any
     */
    set(key, value, options = {}) {
        const storage = this._getStorage();
        if (!storage) {
            return this._recordOutcome(false, 'security_denied', new Error('Storage backend not accessible'));
        }

        const fullKey = this._prefixKey(key, options);

        let toStore;
        try {
            if (options.raw) {
                toStore = String(value);
            } else {
                toStore = JSON.stringify(value);
            }
        } catch (serializeError) {
            return this._recordOutcome(false, 'corrupt', serializeError);
        }

        try {
            storage.setItem(fullKey, toStore);

            // Notify listeners
            this._notifyListeners(key, value);

            return this._recordOutcome(true, 'success', null, value);
        } catch (error) {
            const status = this._classifyError(error);
            console.error(`[StorageService] Error writing key "${key}" (${status}):`, error.message);

            if (status === 'quota_exceeded') {
                this._handleQuotaExceeded();
            }

            return this._recordOutcome(false, status, error);
        }
    }

    /**
     * Remove a key from storage
     * @param {string} key - The storage key (without prefix)
     * @param {Object} options - Options
     * @returns {StorageOutcome}
     */
    remove(key, options = {}) {
        const storage = this._getStorage();
        if (!storage) {
            return this._recordOutcome(false, 'security_denied', new Error('Storage backend not accessible'));
        }

        const fullKey = this._prefixKey(key, options);

        try {
            storage.removeItem(fullKey);
            this._notifyListeners(key, undefined);
            return this._recordOutcome(true, 'success');
        } catch (error) {
            const status = this._classifyError(error);
            console.error(`[StorageService] Error removing key "${key}":`, error.message);
            return this._recordOutcome(false, status, error);
        }
    }

    /**
     * Check if a key exists in storage
     * @param {string} key - The storage key (without prefix)
     * @param {Object} options - Options
     * @returns {boolean} Whether the key exists
     */
    has(key, options = {}) {
        const storage = this._getStorage();
        if (!storage) return false;

        const fullKey = this._prefixKey(key, options);
        try {
            return storage.getItem(fullKey) !== null;
        } catch {
            return false;
        }
    }

    /**
     * Clear keys from storage.
     * By default, ONLY clears keys belonging to the current user's scope.
     * Never removes unrelated origin keys or drafts from other users.
     * @param {Object} options - Options
     * @param {boolean} options.allUsers - If true, clears all GPAce prefixed keys across users
     * @returns {number} Number of keys removed
     */
    clear(options = {}) {
        const storage = this._getStorage();
        if (!storage) return 0;

        const targetPrefix = options.allUsers ? this.basePrefix : this.getScopePrefix();
        const keysToRemove = [];

        try {
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (key && key.startsWith(targetPrefix)) {
                    keysToRemove.push(key);
                }
            }

            keysToRemove.forEach(key => storage.removeItem(key));
            console.log(`[StorageService] Cleared ${keysToRemove.length} keys matching prefix "${targetPrefix}"`);
            return keysToRemove.length;
        } catch (err) {
            console.error('[StorageService] Error during clear:', err);
            return 0;
        }
    }

    /**
     * Get all keys in the current user scope (without prefix)
     * @param {Object} options - Options
     * @returns {string[]} Array of keys
     */
    keys(options = {}) {
        const storage = this._getStorage();
        if (!storage) return [];

        const targetPrefix = options.allUsers ? this.basePrefix : this.getScopePrefix();
        const result = [];

        try {
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (key && key.startsWith(targetPrefix)) {
                    result.push(key.slice(targetPrefix.length));
                }
            }
        } catch {}

        return result;
    }

    /**
     * Get storage usage statistics
     * @returns {Object} Usage statistics
     */
    getStats() {
        const storage = this._getStorage();
        if (!storage) {
            return { totalKeys: 0, gpaceKeys: 0, totalSizeBytes: 0, gpaceSizeBytes: 0 };
        }

        let totalSize = 0;
        let gpaceSize = 0;
        let gpaceCount = 0;
        const currentPrefix = this.getScopePrefix();

        try {
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (key) {
                    const value = storage.getItem(key);
                    const size = (key.length + (value ? value.length : 0)) * 2;
                    totalSize += size;

                    if (key.startsWith(currentPrefix)) {
                        gpaceSize += size;
                        gpaceCount++;
                    }
                }
            }
        } catch {}

        return {
            totalKeys: storage.length,
            gpaceKeys: gpaceCount,
            totalSizeBytes: totalSize,
            gpaceSizeBytes: gpaceSize,
            totalSizeKB: (totalSize / 1024).toFixed(2),
            gpaceSizeKB: (gpaceSize / 1024).toFixed(2)
        };
    }

    /**
     * Subscribe to changes on a specific key
     * @param {string} key - The storage key to watch
     * @param {Function} callback - Function to call on change
     * @returns {Function} Unsubscribe function
     */
    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }

        this.listeners.get(key).add(callback);

        return () => {
            const callbacks = this.listeners.get(key);
            if (callbacks) {
                callbacks.delete(callback);
            }
        };
    }

    /**
     * Migrate storage from legacy keys to new user/scoped format.
     * GUARANTEE: If write fails, the source key is NEVER deleted, preserving recoverable data.
     * @param {Object} keyMappings - Map of oldKey -> newKey
     * @param {Object} options - Migration options
     * @param {boolean} options.deleteSourceOnSuccess - Default true; only deletes source if write succeeded
     * @returns {Object} Migration report with status, counts, and per-key outcomes
     */
    migrateLegacyKeys(keyMappings, options = {}) {
        const storage = this._getStorage();
        if (!storage) {
            return {
                success: false,
                migrated: 0,
                failed: Object.keys(keyMappings).length,
                results: [],
                valueOf() { return 0; }
            };
        }

        let migrated = 0;
        let failed = 0;
        const results = [];

        for (const [oldKey, newKey] of Object.entries(keyMappings)) {
            try {
                const oldValue = storage.getItem(oldKey);

                if (oldValue !== null) {
                    // Attempt write to destination
                    const writeOutcome = this.set(newKey, oldValue, { raw: true });

                    if (writeOutcome.success) {
                        // Only remove source on verified success if configured
                        if (options.deleteSourceOnSuccess !== false) {
                            storage.removeItem(oldKey);
                        }
                        migrated++;
                        results.push({
                            oldKey,
                            newKey,
                            success: true,
                            status: 'success'
                        });
                        console.log(`[StorageService] Migrated: ${oldKey} -> ${newKey}`);
                    } else {
                        // FAILED MIGRATION: RETAIN RECOVERABLE SOURCE
                        failed++;
                        console.warn(`[StorageService] Migration failed for ${oldKey} -> ${newKey} (${writeOutcome.status}). Retaining recoverable source.`);
                        results.push({
                            oldKey,
                            newKey,
                            success: false,
                            status: writeOutcome.status,
                            error: writeOutcome.error,
                            retainedSource: true
                        });
                    }
                }
            } catch (err) {
                failed++;
                const status = this._classifyError(err);
                console.error(`[StorageService] Migration error on ${oldKey}:`, err);
                results.push({
                    oldKey,
                    newKey,
                    success: false,
                    status,
                    error: err,
                    retainedSource: true
                });
            }
        }

        return {
            success: failed === 0,
            migrated,
            failed,
            results,
            valueOf() { return migrated; }
        };
    }

    // ============================================
    // Private Methods
    // ============================================

    /**
     * Add scope prefix to key
     * @private
     */
    _prefixKey(key, options = {}) {
        if (options.rawKey) {
            return key;
        }

        if (options.global) {
            return `${this.basePrefix}global_${key}`;
        }

        const prefix = this.getScopePrefix();
        // Prevent double prefixing if caller already passed a fully prefixed key
        if (key.startsWith(prefix)) {
            return key;
        }
        return `${prefix}${key}`;
    }

    /**
     * Notify listeners of a change
     * @private
     */
    _notifyListeners(key, value) {
        const callbacks = this.listeners.get(key);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(value, key);
                } catch (error) {
                    console.error(`[StorageService] Listener error for key "${key}":`, error);
                }
            });
        }
    }

    /**
     * Check and run schema migrations
     * @private
     */
    _checkMigrations() {
        const storage = this._getStorage();
        if (!storage) return;

        try {
            const storedVersion = parseInt(storage.getItem(SCHEMA_VERSION_KEY) || '0', 10);

            if (storedVersion < this.schemaVersion) {
                console.log(`[StorageService] Running migrations from v${storedVersion} to v${this.schemaVersion}`);
                const report = this._runMigrations(storedVersion);
                if (!report || report.success !== false) {
                    storage.setItem(SCHEMA_VERSION_KEY, String(this.schemaVersion));
                }
            }
        } catch (err) {
            console.warn('[StorageService] Could not complete schema migration check:', err);
        }
    }

    /**
     * Run migrations between versions
     * @private
     */
    _runMigrations(fromVersion) {
        if (fromVersion < 1) {
            const legacyMappings = {
                'theme': 'theme',
                'calculatedPriorityTasks': 'priorityTasks',
                'workspaceContent': 'workspace.content',
                'flashcardDecks': 'flashcards.decks',
                'snippets': 'snippets',
                'geminiApiKey': 'api.gemini',
                'todoistAccessToken': 'api.todoist',
                'todoistState': 'todoist.state',
                'todoistProjects': 'todoist.projects'
            };

            return this.migrateLegacyKeys(legacyMappings);
        }
        return { success: true, migrated: 0, failed: 0 };
    }

    /**
     * Handle quota exceeded error
     * @private
     */
    _handleQuotaExceeded() {
        try {
            const tempKeys = this.keys().filter(k =>
                k.startsWith('temp_') ||
                k.startsWith('cache_') ||
                k.includes('.backup')
            );

            tempKeys.forEach(key => this.remove(key));
            console.log(`[StorageService] Cleaned up ${tempKeys.length} temporary keys in quota recovery`);
        } catch {}
    }
}

// Create singleton instance
const storageService = new StorageService();

// Export for ES modules
export { storageService, StorageService };
export default storageService;

// Register globally for backward compatibility in browser
if (typeof window !== 'undefined') {
    window.StorageService = storageService;
}
