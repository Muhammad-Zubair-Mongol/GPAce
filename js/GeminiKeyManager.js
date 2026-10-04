/**
 * GeminiKeyManager.js
 * Centralized Multi-API-Key Management, Round-Robin Rotation & Failover System for Google Gemini API
 * 
 * Features:
 * - Multi-key bulk parsing (newline/comma separated, whitespace trimming, regex format validation, deduplication)
 * - True round-robin load distribution across outbound AI requests
 * - Immediate zero-delay failover on HTTP 429 / RESOURCE_EXHAUSTED / Quota limits
 * - 60-second cooldown tracking per rate-limited key with automatic recovery
 * - Cryptographic persistence via SecureStorage ('geminiApiKeyPool' / 'geminiApiKey') with localStorage fallbacks
 * - Real-time cross-tab and cross-view synchronization via BroadcastChannel('gpace_gemini_keys') and DOM CustomEvent ('geminiKeysUpdated')
 * - 100% Vanilla JS, strict GEMINI.md compliance (zero inline styles, no external frameworks)
 * 
 * @author GPAce Team
 * @version 2.0.0
 */

// Storage keys
const STORAGE_KEY = 'grind_gemini_keys_v2';
const DAILY_RESET_KEY = 'grind_gemini_daily_reset';
const SECURE_POOL_KEY = 'geminiApiKeyPool';
const SECURE_SINGLE_KEY = 'geminiApiKey';

// Google Gemini API Key format regex (starts with AIza, URL-safe base64 characters, typically 39 chars)
const GEMINI_KEY_REGEX = /^AIza[0-9A-Za-z-_]{30,45}$/;

/**
 * Key object structure:
 * {
 *   id: string,              // Unique identifier (e.g., 'key_1')
 *   key: string,             // The actual API key
 *   name: string,            // Display name
 *   dailyQuota: number,      // Max requests per day (estimate, default 1500)
 *   usageToday: number,      // Requests used today
 *   healthy: boolean,        // Is key currently healthy?
 *   cooldownUntil: number,   // Timestamp in ms until rate-limit cooldown ends (0 if none)
 *   lastError: string|null,  // Last error message
 *   lastUsed: number|null,   // Timestamp of last use
 *   failCount: number        // Consecutive failures
 * }
 */

class GeminiKeyManager {
    constructor() {
        // Singleton pattern
        if (GeminiKeyManager.instance) {
            return GeminiKeyManager.instance;
        }
        GeminiKeyManager.instance = this;

        this.keys = [];
        this.currentIndex = 0;
        this.isInitialized = false;
        this.maxRetriesPerKey = 3;
        this.cooldownDurationMs = 60000; // 60 seconds rate-limit cooldown

        // Error patterns to trigger failover/rotation
        this.rateLimitTriggers = [
            '429',
            'quota',
            'QUOTA_EXCEEDED',
            'RESOURCE_EXHAUSTED',
            'rate limit',
            'rate-limit'
        ];

        this.invalidKeyTriggers = [
            '400',
            '401',
            '403',
            'invalid api key',
            'API_KEY_INVALID',
            'api key not valid'
        ];

        this.networkErrorTriggers = [
            '500',
            '503',
            'timeout',
            'network error',
            'Failed to fetch',
            'fetch failed'
        ];

        // Setup cross-tab sync channel
        this.initSyncChannel();

        // Initialize state
        this.init();
    }

    /**
     * Setup BroadcastChannel and storage listeners for multi-tab synchronization
     */
    initSyncChannel() {
        if (typeof window === 'undefined') return;

        try {
            if (typeof BroadcastChannel !== 'undefined') {
                this.channel = new BroadcastChannel('gpace_gemini_keys');
                this.channel.onmessage = async (event) => {
                    if (event?.data?.type === 'geminiKeysUpdated') {
                        console.log('[GeminiKeyManager] Cross-tab update received, reloading keys...');
                        await this.loadFromStorage();
                        this.dispatchLocalUpdate();
                    }
                };
            }
        } catch (e) {
            console.warn('[GeminiKeyManager] BroadcastChannel setup skipped:', e);
        }

        // Window storage event fallback for older browsers
        try {
            window.addEventListener('storage', async (e) => {
                if (e.key === STORAGE_KEY || e.key === 'gpace_keys_sync_ping') {
                    await this.loadFromStorage();
                    this.dispatchLocalUpdate();
                }
            });
        } catch (e) { /* ignore */ }
    }

    /**
     * Initialize the key manager
     */
    async init() {
        console.log('[GeminiKeyManager] Initializing...');

        // Check for daily reset
        this.checkDailyReset();

        // Load keys from SecureStorage / localStorage
        await this.loadFromStorage();

        // Check legacy keys from Settings if none found
        if (this.keys.length === 0) {
            await this.migrateLegacyKeys();
        }

        this.isInitialized = true;

        console.log(`[GeminiKeyManager] Ready with ${this.keys.length} keys (${this.getHealthyKeys().length} healthy)`);
    }

    /**
     * Check if it's a new day and reset daily usage counters
     */
    checkDailyReset() {
        if (typeof localStorage === 'undefined') return;

        const today = new Date().toDateString();
        const lastReset = localStorage.getItem(DAILY_RESET_KEY);

        if (lastReset !== today) {
            console.log('[GeminiKeyManager] New day detected, resetting daily counters');
            this.keys.forEach(key => {
                key.usageToday = 0;
                key.failCount = 0;
                key.cooldownUntil = 0;
                if (key.lastError && (key.lastError.includes('quota') || key.lastError.includes('429'))) {
                    key.healthy = true;
                    key.lastError = null;
                }
            });
            try {
                localStorage.setItem(DAILY_RESET_KEY, today);
            } catch (e) { /* ignore */ }
            this.saveToStorage();
        }
    }

    /**
     * Parse raw multi-key string (newline or comma separated) with trimming,
     * regex validation, and deduplication
     * @param {string} rawText - Multi-line or comma-separated string of API keys
     * @returns {Object} Parse summary
     */
    parseKeysInput(rawText) {
        if (!rawText || typeof rawText !== 'string') {
            return {
                keys: [],
                validCount: 0,
                invalidCount: 0,
                duplicatesRemoved: 0,
                invalidKeys: []
            };
        }

        const rawLines = rawText.split(/[\r\n,]+/);
        const seen = new Set();
        const validKeys = [];
        const invalidKeys = [];
        let duplicatesRemoved = 0;

        for (const rawLine of rawLines) {
            const trimmed = rawLine.trim();
            if (!trimmed) continue; // Ignore empty lines

            if (seen.has(trimmed)) {
                duplicatesRemoved++;
                continue;
            }
            seen.add(trimmed);

            if (GEMINI_KEY_REGEX.test(trimmed)) {
                validKeys.push(trimmed);
            } else {
                invalidKeys.push(trimmed);
            }
        }

        return {
            keys: validKeys,
            validCount: validKeys.length,
            invalidCount: invalidKeys.length,
            duplicatesRemoved,
            invalidKeys
        };
    }

    /**
     * Bulk parse and configure API key pool
     * @param {string} rawText - Multi-line or comma-separated keys
     * @returns {Promise<Object>} Parse outcome
     */
    async parseAndSetKeys(rawText) {
        const parseResult = this.parseKeysInput(rawText);
        const existingMap = new Map(this.keys.map(k => [k.key, k]));

        // Reconstruct key objects preserving usage history of existing keys
        this.keys = parseResult.keys.map((keyStr, idx) => {
            const existing = existingMap.get(keyStr);
            if (existing) {
                return {
                    ...existing,
                    id: existing.id || `key_${idx + 1}`,
                    name: `Key ${idx + 1}`,
                    key: keyStr
                };
            }
            return {
                id: `key_${Date.now()}_${idx + 1}`,
                key: keyStr,
                name: `Key ${idx + 1}`,
                dailyQuota: 1500,
                usageToday: 0,
                healthy: true,
                cooldownUntil: 0,
                failCount: 0,
                lastError: null,
                lastUsed: null
            };
        });

        if (this.currentIndex >= this.keys.length) {
            this.currentIndex = 0;
        }

        await this.saveToStorage();
        this.notifyListeners();
        return parseResult;
    }

    /**
     * Get all keys formatted as a newline-separated string
     * @returns {string} One key per line
     */
    getKeysAsText() {
        return this.keys.map(k => k.key).join('\n');
    }

    /**
     * Load keys from SecureStorage (primary) and localStorage (fallback)
     */
    async loadFromStorage() {
        let loaded = false;

        // 1. Try SecureStorage (encrypted)
        try {
            const secStorage = typeof window !== 'undefined' ? window.SecureStorage : null;
            if (secStorage && typeof secStorage.getSecure === 'function') {
                const secData = await secStorage.getSecure(SECURE_POOL_KEY, null);
                if (secData) {
                    const parsed = typeof secData === 'string' ? JSON.parse(secData) : secData;
                    if (parsed && Array.isArray(parsed.keys)) {
                        this.keys = parsed.keys;
                        this.currentIndex = Number.isInteger(parsed.currentIndex) ? parsed.currentIndex : 0;
                        loaded = true;
                        console.log(`[GeminiKeyManager] Loaded ${this.keys.length} keys from SecureStorage`);
                    }
                }
            }
        } catch (e) {
            console.warn('[GeminiKeyManager] SecureStorage read error:', e);
        }

        // 2. Try raw localStorage fallback
        if (!loaded && typeof localStorage !== 'undefined') {
            try {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    const data = JSON.parse(saved);
                    if (data && Array.isArray(data.keys)) {
                        this.keys = data.keys;
                        this.currentIndex = Number.isInteger(data.currentIndex) ? data.currentIndex : 0;
                        loaded = true;
                        console.log(`[GeminiKeyManager] Loaded ${this.keys.length} keys from localStorage`);
                    }
                }
            } catch (e) {
                console.warn('[GeminiKeyManager] localStorage read error:', e);
            }
        }

        // Clean expired cooldowns on load
        this.cleanExpiredCooldowns();
    }

    /**
     * Save keys to SecureStorage (primary) and localStorage (fallback)
     */
    async saveToStorage() {
        const payload = {
            keys: this.keys,
            currentIndex: this.currentIndex,
            lastUpdated: Date.now()
        };
        const jsonStr = JSON.stringify(payload);
        const primaryKey = this.keys.length > 0 ? this.keys[0].key : '';

        // 1. Save to localStorage
        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem(STORAGE_KEY, jsonStr);
                if (primaryKey) {
                    localStorage.setItem('geminiApiKey', primaryKey);
                } else {
                    localStorage.removeItem('geminiApiKey');
                }
            } catch (e) {
                console.warn('[GeminiKeyManager] localStorage write error:', e);
            }
        }

        // 2. Save to SecureStorage
        try {
            const secStorage = typeof window !== 'undefined' ? window.SecureStorage : null;
            if (secStorage && typeof secStorage.setSecure === 'function') {
                await secStorage.setSecure(SECURE_POOL_KEY, jsonStr);
                if (primaryKey) {
                    await secStorage.setSecure(SECURE_SINGLE_KEY, primaryKey);
                } else {
                    await secStorage.setSecure(SECURE_SINGLE_KEY, '');
                }
            }
        } catch (e) {
            console.warn('[GeminiKeyManager] SecureStorage write error:', e);
        }
    }

    /**
     * Sync legacy keys from Settings storage (geminiApiKey, geminiApiKey2, etc.)
     */
    async migrateLegacyKeys() {
        console.log('[GeminiKeyManager] Checking legacy keys...');
        const keyDefs = [
            { id: 'primary', storageKey: 'geminiApiKey', name: 'Key 1' },
            { id: 'backup_1', storageKey: 'geminiApiKey2', name: 'Key 2' },
            { id: 'backup_2', storageKey: 'geminiApiKey3', name: 'Key 3' }
        ];

        const foundKeys = [];

        for (const keyDef of keyDefs) {
            try {
                let keyValue = null;

                // Check SecureStorage
                if (typeof window !== 'undefined' && window.SecureStorage && typeof window.SecureStorage.getSecure === 'function') {
                    try {
                        keyValue = await window.SecureStorage.getSecure(keyDef.storageKey, null);
                    } catch (e) { /* ignore */ }
                }

                // Check localStorage
                if (!keyValue && typeof localStorage !== 'undefined') {
                    keyValue = localStorage.getItem(keyDef.storageKey);
                    if (!keyValue) {
                        const gpaceKey = `gpace_${keyDef.storageKey}`;
                        keyValue = localStorage.getItem(gpaceKey);
                        if (keyValue) {
                            try { keyValue = JSON.parse(keyValue); } catch (e) { /* not JSON */ }
                        }
                    }
                }

                if (keyValue && typeof keyValue === 'string') {
                    const trimmed = keyValue.trim();
                    if (GEMINI_KEY_REGEX.test(trimmed)) {
                        foundKeys.push(trimmed);
                    }
                }
            } catch (e) {
                console.warn(`[GeminiKeyManager] Legacy key check error for ${keyDef.storageKey}:`, e);
            }
        }

        if (foundKeys.length > 0) {
            await this.parseAndSetKeys(foundKeys.join('\n'));
            console.log(`[GeminiKeyManager] Migrated ${foundKeys.length} legacy keys`);
        }
    }

    /**
     * Check and reset expired rate-limit cooldowns
     */
    cleanExpiredCooldowns() {
        const now = Date.now();
        let changed = false;

        this.keys.forEach(key => {
            if (key.cooldownUntil && key.cooldownUntil > 0 && now >= key.cooldownUntil) {
                key.cooldownUntil = 0;
                key.healthy = true;
                key.failCount = 0;
                key.lastError = null;
                changed = true;
            }
        });

        if (changed) {
            this.saveToStorage();
        }
    }

    /**
     * Get all healthy keys eligible for outbound requests
     * @returns {Array<Object>}
     */
    getHealthyKeys() {
        this.cleanExpiredCooldowns();
        const now = Date.now();
        return this.keys.filter(k => k.healthy !== false && (!k.cooldownUntil || k.cooldownUntil <= now));
    }

    /**
     * Get the current active key object without advancing pointer
     * @returns {Object|null}
     */
    getCurrentKey() {
        const healthyKeys = this.getHealthyKeys();
        if (healthyKeys.length === 0) {
            return this.keys.find(k => k.failCount < this.maxRetriesPerKey) || null;
        }
        return healthyKeys[this.currentIndex % healthyKeys.length];
    }

    /**
     * Get current key string
     * @returns {string|null}
     */
    getKey() {
        const current = this.getCurrentKey();
        return current ? current.key : null;
    }

    /**
     * True round-robin: advance pointer to next healthy key and return the key string
     * @returns {string|null} The next API key to use
     */
    getNextKey() {
        const healthyKeys = this.getHealthyKeys();
        if (healthyKeys.length === 0) {
            return null;
        }

        const selectedKey = healthyKeys[this.currentIndex % healthyKeys.length];
        this.currentIndex = (this.currentIndex + 1) % healthyKeys.length;
        this.saveToStorage();
        return selectedKey.key;
    }

    /**
     * Manual rotation to next key
     * @returns {boolean} True if rotated
     */
    rotate() {
        const healthyKeys = this.getHealthyKeys();
        if (healthyKeys.length <= 1) return false;

        this.currentIndex = (this.currentIndex + 1) % healthyKeys.length;
        this.saveToStorage();
        return true;
    }

    /**
     * Adjust currentIndex after a failing key is deactivated so immediate
     * failover targets key N+1 without skipping
     */
    adjustIndexAfterFailure() {
        const healthyKeys = this.getHealthyKeys();
        if (healthyKeys.length === 0) {
            this.currentIndex = 0;
            return;
        }
        if (this.currentIndex > 0) {
            this.currentIndex = (this.currentIndex - 1) % healthyKeys.length;
        } else {
            this.currentIndex = 0;
        }
    }

    /**
     * Mark key as rate limited (HTTP 429 / RESOURCE_EXHAUSTED) with a 60-second cooldown
     * @param {string} apiKey - Failing API key
     * @param {Error|string} error - Error object or message
     */
    markRateLimited(apiKey, error) {
        const keyObj = this.keys.find(k => k.key === apiKey);
        if (!keyObj) return;

        const errorMsg = error?.message || String(error);
        keyObj.failCount++;
        keyObj.lastError = `Rate Limited (429/Quota): ${errorMsg}`;
        keyObj.cooldownUntil = Date.now() + this.cooldownDurationMs;
        keyObj.healthy = false;

        this.adjustIndexAfterFailure();

        console.warn(`[GeminiKeyManager] Key ${keyObj.name} marked with 60s cooldown due to rate limit.`);
        this.saveToStorage();
        this.notifyListeners();
    }

    /**
     * Mark key as permanently invalid (HTTP 400 / 401 / 403 / API_KEY_INVALID)
     * @param {string} apiKey - Invalid API key
     * @param {Error|string} error - Error object or message
     */
    markInvalid(apiKey, error) {
        const keyObj = this.keys.find(k => k.key === apiKey);
        if (!keyObj) return;

        const errorMsg = error?.message || String(error);
        keyObj.failCount = this.maxRetriesPerKey;
        keyObj.lastError = `Invalid Key: ${errorMsg}`;
        keyObj.healthy = false;
        keyObj.cooldownUntil = 0;

        this.adjustIndexAfterFailure();

        console.warn(`[GeminiKeyManager] Key ${keyObj.name} marked as invalid.`);
        this.saveToStorage();
        this.notifyListeners();
    }

    /**
     * Mark key as having encountered a transient error (e.g. 500 / network)
     * @param {string} apiKey - Failing API key
     * @param {Error|string} error - Error object or message
     */
    markError(apiKey, error) {
        const keyObj = this.keys.find(k => k.key === apiKey);
        if (!keyObj) return;

        const errorMsg = error?.message || String(error);
        keyObj.failCount++;
        keyObj.lastError = errorMsg;

        if (keyObj.failCount >= this.maxRetriesPerKey) {
            keyObj.healthy = false;
            console.warn(`[GeminiKeyManager] Key ${keyObj.name} exceeded max retries, marked unhealthy.`);
        }

        this.saveToStorage();
        this.notifyListeners();
    }

    /**
     * Mark key request as successful
     * @param {string} apiKey - Succeeded API key
     */
    markSuccess(apiKey) {
        const keyObj = this.keys.find(k => k.key === apiKey);
        if (!keyObj) return;

        keyObj.usageToday = (keyObj.usageToday || 0) + 1;
        keyObj.failCount = 0;
        keyObj.healthy = true;
        keyObj.cooldownUntil = 0;
        keyObj.lastUsed = Date.now();
        keyObj.lastError = null;

        this.saveToStorage();
    }

    /**
     * Execute a function with automatic round-robin key rotation and immediate failover
     * - On HTTP 429 / RESOURCE_EXHAUSTED: immediate retry with key N+1, zero backoff sleep, 60s cooldown
     * - On HTTP 400 / 401 / 403: immediate retry with key N+1, zero backoff sleep
     * - On transient network errors: short delay (300ms) before retry
     * 
     * @param {Function} fn - Async callback receiving `(apiKey) => Promise<any>`
     * @param {Object} options - Options
     * @param {number} options.maxAttempts - Maximum retry attempts across pool
     * @param {string} options.label - Operation label for logging
     * @returns {Promise<any>}
     */
    async withKeyRotation(fn, options = {}) {
        const { label = 'Gemini API call', maxAttempts } = options;

        const initialHealthy = this.getHealthyKeys();
        if (initialHealthy.length === 0) {
            throw new Error('No healthy Gemini API keys configured. Please add valid keys in Settings.');
        }

        const allowedAttempts = maxAttempts || Math.max(initialHealthy.length * 2, 3);
        let attempts = 0;
        let lastError = null;

        while (attempts < allowedAttempts) {
            const healthyKeys = this.getHealthyKeys();
            if (healthyKeys.length === 0) {
                break;
            }

            // Get next key in round-robin sequence
            const key = this.getNextKey();
            if (!key) break;
            attempts++;

            const keyObj = this.keys.find(k => k.key === key);
            const keyLabel = keyObj?.name || `Key ${this.currentIndex}`;

            try {
                console.log(`[GeminiKeyManager] ${label} attempt ${attempts} with ${keyLabel}`);
                const result = await fn(key);

                // Success!
                this.markSuccess(key);
                return result;

            } catch (error) {
                lastError = error;
                const errorMsg = String(error?.message || error || '').toLowerCase();
                const status = error?.status || error?.statusCode;

                const isRateLimit = status === 429 ||
                    this.rateLimitTriggers.some(t => errorMsg.includes(t.toLowerCase()));

                const isInvalid = status === 400 || status === 401 || status === 403 ||
                    this.invalidKeyTriggers.some(t => errorMsg.includes(t.toLowerCase()));

                if (isRateLimit) {
                    console.warn(`[GeminiKeyManager] ${keyLabel} rate limited (429/quota). Immediate failover with zero backoff.`);
                    this.markRateLimited(key, error);
                    // ZERO backoff sleep: immediately retry with key N+1
                    continue;
                } else if (isInvalid) {
                    console.warn(`[GeminiKeyManager] ${keyLabel} invalid credentials. Disabling key and failing over immediately.`);
                    this.markInvalid(key, error);
                    // ZERO backoff sleep: immediately retry with key N+1
                    continue;
                } else {
                    console.warn(`[GeminiKeyManager] ${keyLabel} transient error: ${errorMsg}`);
                    this.markError(key, error);
                    // Short sleep for transient network issues
                    await this.sleep(300);
                }
            }
        }

        throw lastError || new Error(`All available Gemini API keys failed (${attempts} attempts tried). Please verify your keys in Settings.`);
    }

    /**
     * Helper sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Notify listeners across DOM and cross-tab BroadcastChannel
     */
    notifyListeners() {
        this.dispatchLocalUpdate();

        if (this.channel) {
            try {
                this.channel.postMessage({
                    type: 'geminiKeysUpdated',
                    timestamp: Date.now(),
                    status: this.getStatus()
                });
            } catch (e) { /* ignore */ }
        }

        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem('gpace_keys_sync_ping', String(Date.now()));
            } catch (e) { /* ignore */ }
        }
    }

    /**
     * Dispatch DOM CustomEvent 'geminiKeysUpdated' for same-tab subscribers
     */
    dispatchLocalUpdate() {
        if (typeof window === 'undefined') return;
        try {
            window.dispatchEvent(new CustomEvent('geminiKeysUpdated', {
                detail: this.getStatus()
            }));
        } catch (e) { /* ignore */ }
    }

    /**
     * Get status summary for UI displays
     * @returns {Object} Status summary
     */
    getStatus() {
        this.cleanExpiredCooldowns();
        const now = Date.now();
        const healthyKeys = this.getHealthyKeys();
        const rateLimitedKeys = this.keys.filter(k => k.cooldownUntil && k.cooldownUntil > now);
        const invalidKeys = this.keys.filter(k => !k.healthy && (!k.cooldownUntil || k.cooldownUntil <= now));

        const totalQuota = this.keys.reduce((sum, k) => sum + (k.dailyQuota || 1500), 0);
        const usedQuota = this.keys.reduce((sum, k) => sum + (k.usageToday || 0), 0);
        const remainingQuota = Math.max(0, totalQuota - usedQuota);
        const percentRemaining = totalQuota > 0 ? (remainingQuota / totalQuota) * 100 : 0;

        return {
            totalKeys: this.keys.length,
            healthyKeys: healthyKeys.length,
            rateLimitedCount: rateLimitedKeys.length,
            invalidCount: invalidKeys.length,
            currentKeyIndex: this.keys.length > 0 ? (this.currentIndex % this.keys.length) + 1 : 0,
            currentKeyName: this.getCurrentKey()?.name || 'None',
            totalQuota,
            usedQuota,
            remainingQuota,
            percentRemaining: Math.round(percentRemaining),
            isLowQuota: percentRemaining < 20,
            allExhausted: this.keys.length > 0 && healthyKeys.length === 0,
            hasKeys: this.keys.length > 0
        };
    }

    /**
     * Add a single key
     * @param {Object} keyData 
     */
    async addKey(keyData) {
        if (!keyData?.key || !keyData.key.trim()) {
            throw new Error('API key is required');
        }
        const trimmed = keyData.key.trim();
        if (!GEMINI_KEY_REGEX.test(trimmed)) {
            throw new Error('Invalid Gemini API key format (must start with AIza)');
        }

        const exists = this.keys.find(k => k.key === trimmed);
        if (exists) {
            Object.assign(exists, keyData);
            await this.saveToStorage();
            this.notifyListeners();
            return exists;
        }

        const newKey = {
            id: keyData.id || `key_${Date.now()}`,
            key: trimmed,
            name: keyData.name || `Key ${this.keys.length + 1}`,
            dailyQuota: keyData.dailyQuota || 1500,
            usageToday: 0,
            healthy: true,
            cooldownUntil: 0,
            lastError: null,
            lastUsed: null,
            failCount: 0
        };

        this.keys.push(newKey);
        await this.saveToStorage();
        this.notifyListeners();
        return newKey;
    }

    /**
     * Remove a key by ID
     * @param {string} keyId 
     */
    async removeKey(keyId) {
        const index = this.keys.findIndex(k => k.id === keyId);
        if (index > -1) {
            const removed = this.keys.splice(index, 1)[0];
            if (this.currentIndex >= this.keys.length) {
                this.currentIndex = 0;
            }
            await this.saveToStorage();
            this.notifyListeners();
            return removed;
        }
        return null;
    }

    /**
     * Reset all keys to healthy state
     */
    async resetAllKeys() {
        this.keys.forEach(key => {
            key.healthy = true;
            key.cooldownUntil = 0;
            key.failCount = 0;
            key.lastError = null;
        });
        this.currentIndex = 0;
        await this.saveToStorage();
        this.notifyListeners();
        console.log('[GeminiKeyManager] All keys reset to healthy');
    }

    /**
     * Export keys as JSON
     */
    exportKeys() {
        return JSON.stringify(this.keys, null, 2);
    }

    /**
     * Import keys from JSON or text
     * @param {string} input - JSON string or plain text
     */
    async importKeys(input) {
        if (!input) return 0;

        // Try JSON parse first
        if (typeof input === 'string' && (input.trim().startsWith('[') || input.trim().startsWith('{'))) {
            try {
                const parsed = JSON.parse(input);
                if (Array.isArray(parsed)) {
                    const keysText = parsed.map(item => (typeof item === 'string' ? item : item?.key || '')).filter(Boolean).join('\n');
                    const res = await this.parseAndSetKeys(keysText);
                    return res.validCount;
                }
            } catch (e) {
                // Fall back to plain text
            }
        }

        const res = await this.parseAndSetKeys(String(input));
        return res.validCount;
    }

    /**
     * Test a specific API key
     * @param {string} apiKey 
     */
    async testKey(apiKey) {
        try {
            let GoogleGenerativeAI = typeof window !== 'undefined' ? window.GoogleGenerativeAI : null;
            if (!GoogleGenerativeAI) {
                const mod = await import('https://esm.run/@google/generative-ai@0.24.0');
                GoogleGenerativeAI = mod.GoogleGenerativeAI;
                if (typeof window !== 'undefined') {
                    window.GoogleGenerativeAI = GoogleGenerativeAI;
                }
            }

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
            const result = await model.generateContent('Say "OK" if you can read this.');
            const response = await result.response;
            const text = response.text();

            return {
                success: true,
                message: 'Key is valid and active',
                response: text.substring(0, 50)
            };
        } catch (error) {
            return {
                success: false,
                message: error?.message || 'Key test failed',
                error
            };
        }
    }

    /**
     * Sync from settings
     */
    async syncFromSettings() {
        await this.migrateLegacyKeys();
        return this.getStatus();
    }
}

// Singleton instance
const geminiKeyManager = new GeminiKeyManager();

// Global registration for browser scripts
if (typeof window !== 'undefined') {
    window.GeminiKeyManager = GeminiKeyManager;
    window.geminiKeyManager = geminiKeyManager;
    window.syncGeminiKeys = async () => {
        await geminiKeyManager.syncFromSettings();
        console.log('[GeminiKeyManager] Manual sync complete:', geminiKeyManager.getStatus());
    };
}

export { GeminiKeyManager, geminiKeyManager };
export default geminiKeyManager;
