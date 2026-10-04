/**
 * SecureStorage.js
 * Encrypted storage for sensitive data like API keys and tokens.
 * Part of Step 40: Storage Layer Abstraction & Boundary Enforcement.
 * 
 * Features:
 * - Browser-native AES-GCM encryption using SubtleCrypto API
 * - Verified UID-derived key separation and in-memory cache clearing
 * - Hardened failure boundary: PREVENTS silent plaintext fallbacks when encryption fails
 * - Exposes typed CryptoError when crypto is unavailable or fails
 * - Default BYOK to session-only with explicit persistence opt-in
 * - Never clears unrelated origin data
 * 
 * Threat Model:
 * Client-side encryption protects keys from casual inspection and cross-user disk leakage.
 * Any script executing in the same origin has access to browser memory and APIs.
 * Sensitive long-lived credentials should be managed via server-side session authentication.
 */

import storageService from './StorageService.js';

const CRYPTO_SALT = 'GPAce_Secure_2024';
const SECURE_PREFIX = 'secure_';

/**
 * Typed error thrown when cryptographic operations fail or are unavailable.
 */
export class CryptoError extends Error {
    constructor(message, code = 'CRYPTO_FAILED', details = {}) {
        super(message);
        this.name = 'CryptoError';
        this.code = code;
        this.status = details.status || 'crypto_failed';
        this.claimedProtection = false;
        this.details = details;
    }
}

class SecureStorage {
    constructor(options = {}) {
        this.customCrypto = options.crypto || null;
        this.currentUserId = null;
        this.keyCache = new Map();
        this.sessionKeys = new Map(); // In-memory BYOK session store
    }

    /**
     * Resolves the crypto provider
     * @private
     */
    _getCrypto() {
        if (this.customCrypto) return this.customCrypto;
        if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
            return window.crypto;
        }
        if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
            return globalThis.crypto;
        }
        return null;
    }

    /**
     * Check if SubtleCrypto is available in the current environment
     * @returns {boolean}
     */
    isCryptoAvailable() {
        const c = this._getCrypto();
        return Boolean(c && c.subtle);
    }

    /**
     * Set the current verified user UID.
     * Resets in-memory key caches to ensure user A keys are never used for user B.
     * @param {string|null} uid - Verified Firebase user UID or null for anonymous
     */
    setUser(uid) {
        const normalizedUid = (uid && typeof uid === 'string' && uid.trim().length > 0)
            ? uid.trim()
            : null;

        if (this.currentUserId !== normalizedUid) {
            this.clearCache();
            this.currentUserId = normalizedUid;
        }
    }

    /**
     * Reset in-memory key derivation caches
     */
    clearCache() {
        this.keyCache.clear();
        this.sessionKeys.clear();
    }

    /**
     * Store a value securely (encrypted with AES-GCM).
     * 
     * HARDENED BOUNDARY: If encryption fails or is unavailable, this method will NEVER
     * silently fall back to plaintext or obfuscation claiming encrypted protection.
     * 
     * @param {string} key - Storage key
     * @param {string} value - Value to encrypt and store
     * @param {Object} options - Options
     * @param {boolean} options.allowUnencrypted - If explicitly true, permits storing unencrypted status
     * @param {boolean} options.throwOnError - Default true; throw CryptoError on failure
     * @returns {Promise<Object>} Status outcome object
     */
    async setSecure(key, value, options = {}) {
        if (!value) {
            const remOutcome = storageService.remove(SECURE_PREFIX + key);
            return {
                success: remOutcome.success,
                status: remOutcome.status,
                encrypted: false,
                claimedProtection: false,
                valueOf() { return remOutcome.success; }
            };
        }

        const stringValue = String(value);

        if (!this.isCryptoAvailable()) {
            if (options.allowUnencrypted === true) {
                console.warn(`[SecureStorage] SubtleCrypto unavailable. Storing "${key}" explicitly unencrypted per allowUnencrypted option.`);
                const storeOutcome = storageService.set(SECURE_PREFIX + key, 'PLAIN:' + stringValue, { raw: true });
                return {
                    success: storeOutcome.success,
                    status: 'unencrypted',
                    encrypted: false,
                    claimedProtection: false,
                    valueOf() { return storeOutcome.success; }
                };
            }

            const error = new CryptoError(
                'SubtleCrypto is not available in this environment. Plaintext fallback prevented.',
                'CRYPTO_UNAVAILABLE',
                { key, status: 'crypto_failed' }
            );

            if (options.throwOnError === false) {
                return {
                    success: false,
                    status: 'crypto_failed',
                    encrypted: false,
                    claimedProtection: false,
                    error,
                    valueOf() { return false; }
                };
            }
            throw error;
        }

        try {
            const encrypted = await this._encrypt(stringValue);
            const storeOutcome = storageService.set(SECURE_PREFIX + key, encrypted, { raw: true });

            return {
                success: storeOutcome.success,
                status: storeOutcome.status,
                encrypted: true,
                claimedProtection: true,
                valueOf() { return storeOutcome.success; }
            };
        } catch (error) {
            console.error(`[SecureStorage] Encryption failed for key "${key}":`, error);

            if (options.allowUnencrypted === true) {
                console.warn(`[SecureStorage] Encryption failed. Storing "${key}" explicitly unencrypted per allowUnencrypted option.`);
                const storeOutcome = storageService.set(SECURE_PREFIX + key, 'PLAIN:' + stringValue, { raw: true });
                return {
                    success: storeOutcome.success,
                    status: 'unencrypted',
                    encrypted: false,
                    claimedProtection: false,
                    valueOf() { return storeOutcome.success; }
                };
            }

            const cryptoError = new CryptoError(
                `Encryption failed for key "${key}": ${error.message}. Plaintext fallback prevented.`,
                'CRYPTO_FAILED',
                { key, status: 'crypto_failed', cause: error }
            );

            if (options.throwOnError === false) {
                return {
                    success: false,
                    status: 'crypto_failed',
                    encrypted: false,
                    claimedProtection: false,
                    error: cryptoError,
                    valueOf() { return false; }
                };
            }
            throw cryptoError;
        }
    }

    /**
     * Retrieve and decrypt a securely stored value
     * @param {string} key - Storage key
     * @param {string} defaultValue - Default if key doesn't exist
     * @param {Object} options - Options
     * @param {boolean} options.throwOnError - Throw CryptoError on decryption failure
     * @param {boolean} options.detailed - Return detailed metadata object
     * @returns {Promise<string|Object|null>} Decrypted value (or metadata if detailed)
     */
    async getSecure(key, defaultValue = null, options = {}) {
        try {
            const rawStored = storageService.get(SECURE_PREFIX + key, null, { raw: true });

            if (rawStored === null || rawStored === undefined) {
                if (options.detailed) {
                    return { value: defaultValue, encrypted: false, status: 'missing' };
                }
                return defaultValue;
            }

            // Explicitly unencrypted value
            if (rawStored.startsWith('PLAIN:')) {
                const plainValue = rawStored.slice(6);
                if (options.detailed) {
                    return { value: plainValue, encrypted: false, status: 'unencrypted' };
                }
                return plainValue;
            }

            // Obfuscated legacy value (for migration recovery)
            if (rawStored.startsWith('OBF:')) {
                const deobfuscated = this._deobfuscate(rawStored);
                if (options.detailed) {
                    return { value: deobfuscated, encrypted: false, status: 'legacy_obfuscated' };
                }
                return deobfuscated;
            }

            // Encrypted ciphertext
            if (rawStored.startsWith('ENC:')) {
                if (!this.isCryptoAvailable()) {
                    const err = new CryptoError(
                        'SubtleCrypto is not available to decrypt encrypted data',
                        'CRYPTO_UNAVAILABLE',
                        { key }
                    );
                    if (options.throwOnError) throw err;
                    return defaultValue;
                }

                const decrypted = await this._decrypt(rawStored);
                if (decrypted === null) {
                    if (options.throwOnError) {
                        throw new CryptoError(`Decryption failed for key "${key}"`, 'DECRYPT_FAILED', { key });
                    }
                    return defaultValue;
                }

                if (options.detailed) {
                    return { value: decrypted, encrypted: true, status: 'success' };
                }
                return decrypted;
            }

            // Legacy plain text value without prefix
            if (options.detailed) {
                return { value: rawStored, encrypted: false, status: 'legacy_plain' };
            }
            return rawStored;
        } catch (error) {
            console.error(`[SecureStorage] Retrieval error for key "${key}":`, error);
            if (options.throwOnError && error instanceof CryptoError) {
                throw error;
            }
            return defaultValue;
        }
    }

    /**
     * Store Bring-Your-Own-Key (BYOK) credential.
     * Default BYOK to session-only with explicit persistence opt-in and honest threat model.
     * 
     * @param {string} provider - Key identifier (e.g. 'gemini', 'todoist')
     * @param {string} apiKey - API credential
     * @param {Object} options - Options
     * @param {boolean} options.persist - If true, explicitly persists to encrypted storage. Default false (session-only).
     * @returns {Promise<Object>}
     */
    async setApiKey(provider, apiKey, options = {}) {
        const persist = Boolean(options.persist);

        if (!apiKey) {
            this.sessionKeys.delete(provider);
            return this.removeSecure(`api_${provider}`);
        }

        if (!persist) {
            // Session-only: store in memory or sessionStorage
            this.sessionKeys.set(provider, apiKey);
            try {
                if (typeof sessionStorage !== 'undefined') {
                    sessionStorage.setItem(`gpace_session_key_${provider}`, apiKey);
                }
            } catch {}

            return {
                success: true,
                status: 'session_only',
                persisted: false,
                encrypted: false
            };
        }

        // Explicit persistence opt-in
        const result = await this.setSecure(`api_${provider}`, apiKey, options);
        return {
            ...result,
            persisted: true
        };
    }

    /**
     * Retrieve BYOK credential, checking session first, then encrypted persistent storage.
     * @param {string} provider - Key identifier
     * @returns {Promise<string|null>}
     */
    async getApiKey(provider) {
        // Check in-memory session keys
        if (this.sessionKeys.has(provider)) {
            return this.sessionKeys.get(provider);
        }

        // Check sessionStorage
        try {
            if (typeof sessionStorage !== 'undefined') {
                const sessionKey = sessionStorage.getItem(`gpace_session_key_${provider}`);
                if (sessionKey) {
                    this.sessionKeys.set(provider, sessionKey);
                    return sessionKey;
                }
            }
        } catch {}

        // Check encrypted storage
        return this.getSecure(`api_${provider}`);
    }

    /**
     * Remove a securely stored value
     * @param {string} key - Storage key
     * @returns {StorageOutcome}
     */
    removeSecure(key) {
        return storageService.remove(SECURE_PREFIX + key);
    }

    /**
     * Check if a secure key exists
     * @param {string} key - Storage key
     * @returns {boolean}
     */
    hasSecure(key) {
        return storageService.has(SECURE_PREFIX + key);
    }

    /**
     * List all secure storage keys for the active user scope
     * @returns {string[]}
     */
    secureKeys() {
        return storageService.keys()
            .filter(k => k.startsWith(SECURE_PREFIX))
            .map(k => k.slice(SECURE_PREFIX.length));
    }

    /**
     * Clear all secure keys in the active user scope.
     * Never removes unrelated origin data or keys from other users.
     * @returns {number}
     */
    clearSecure() {
        const keys = this.secureKeys();
        let cleared = 0;
        for (const k of keys) {
            if (this.removeSecure(k).success) {
                cleared++;
            }
        }
        return cleared;
    }

    /**
     * Migrate a legacy plain-text key to secure storage.
     * Retains source key if write or encryption fails.
     * @param {string} legacyKey - Original storage key
     * @param {string} newKey - New secure key
     * @param {Object} options - Options
     * @returns {Promise<Object>} Migration outcome
     */
    async migrateLegacyKey(legacyKey, newKey, options = {}) {
        let plainValue = null;
        try {
            if (typeof localStorage !== 'undefined') {
                plainValue = localStorage.getItem(legacyKey);
            }
        } catch {}

        if (!plainValue) {
            plainValue = storageService.get(legacyKey, null, { raw: true });
        }

        if (plainValue) {
            try {
                const outcome = await this.setSecure(newKey, plainValue, options);
                if (outcome && outcome.success) {
                    try {
                        if (typeof localStorage !== 'undefined') {
                            localStorage.removeItem(legacyKey);
                        }
                    } catch {}
                    storageService.remove(legacyKey);
                    console.log(`[SecureStorage] Migrated legacy key "${legacyKey}" to secure key "${newKey}"`);
                    return { success: true, migrated: true };
                }
            } catch (err) {
                console.warn(`[SecureStorage] Migration failed for "${legacyKey}". Retaining source.`, err);
                return { success: false, migrated: false, error: err, retainedSource: true };
            }
        }

        return { success: false, migrated: false, retainedSource: true };
    }

    // ============================================
    // Private Encryption & Key Derivation Methods
    // ============================================

    /**
     * Get or derive AES-GCM encryption key scoped to the active user
     * @private
     */
    async _getEncryptionKey() {
        const cacheKey = this.currentUserId || 'anon';
        if (this.keyCache.has(cacheKey)) {
            return this.keyCache.get(cacheKey);
        }

        const cryptoObj = this._getCrypto();
        if (!cryptoObj || !cryptoObj.subtle) {
            return null;
        }

        try {
            const seed = this._generateSeed(this.currentUserId);
            const keyMaterial = await cryptoObj.subtle.importKey(
                'raw',
                new TextEncoder().encode(seed),
                'PBKDF2',
                false,
                ['deriveKey']
            );

            const key = await cryptoObj.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: new TextEncoder().encode(CRYPTO_SALT),
                    iterations: 100000,
                    hash: 'SHA-256'
                },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt']
            );

            this.keyCache.set(cacheKey, key);
            return key;
        } catch (error) {
            console.error('[SecureStorage] Key derivation failed:', error);
            return null;
        }
    }

    /**
     * Generate seed incorporating active user UID for mathematical key separation
     * @private
     */
    _generateSeed(uid) {
        const userScope = uid ? `u:${uid}` : 'anon';
        const userAgent = typeof navigator !== 'undefined' ? (navigator.userAgent || 'agent') : 'node';
        const screenDim = typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : 'headless';
        const tz = new Date().getTimezoneOffset().toString();

        return [
            userScope,
            userAgent,
            screenDim,
            tz,
            CRYPTO_SALT
        ].join('|');
    }

    /**
     * Encrypt a string value with AES-GCM
     * @private
     */
    async _encrypt(value) {
        const cryptoObj = this._getCrypto();
        if (!cryptoObj || !cryptoObj.subtle) {
            throw new CryptoError('SubtleCrypto unavailable', 'CRYPTO_UNAVAILABLE');
        }

        const key = await this._getEncryptionKey();
        if (!key) {
            throw new CryptoError('Key derivation failed', 'KEY_DERIVATION_FAILED');
        }

        const iv = cryptoObj.getRandomValues(new Uint8Array(12));
        const encodedValue = new TextEncoder().encode(value);

        const encrypted = await cryptoObj.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encodedValue
        );

        // Combine IV and encrypted data, encode as base64
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);

        let binary = '';
        for (let i = 0; i < combined.length; i++) {
            binary += String.fromCharCode(combined[i]);
        }

        return 'ENC:' + btoa(binary);
    }

    /**
     * Decrypt a string value with AES-GCM
     * @private
     */
    async _decrypt(encrypted) {
        const cryptoObj = this._getCrypto();
        if (!cryptoObj || !cryptoObj.subtle) {
            return null;
        }

        const key = await this._getEncryptionKey();
        if (!key) {
            return null;
        }

        try {
            const rawBase64 = encrypted.slice(4);
            const binary = atob(rawBase64);
            const combined = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                combined[i] = binary.charCodeAt(i);
            }

            if (combined.length < 13) {
                return null;
            }

            const iv = combined.slice(0, 12);
            const data = combined.slice(12);

            const decrypted = await cryptoObj.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                data
            );

            return new TextDecoder().decode(decrypted);
        } catch (error) {
            console.error('[SecureStorage] Decryption error:', error);
            return null;
        }
    }

    /**
     * Deobfuscate legacy XOR values (for recovery purposes)
     * @private
     */
    _deobfuscate(obfuscated) {
        try {
            const encrypted = atob(obfuscated.slice(4));
            const key = CRYPTO_SALT;
            let result = '';

            for (let i = 0; i < encrypted.length; i++) {
                result += String.fromCharCode(
                    encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length)
                );
            }

            return result;
        } catch (error) {
            console.error('[SecureStorage] Deobfuscation error:', error);
            return null;
        }
    }
}

// Create singleton instance
const secureStorage = new SecureStorage();

// Export for ES modules
export { secureStorage, SecureStorage };
export default secureStorage;

// Register globally for backward compatibility in browser
if (typeof window !== 'undefined') {
    window.SecureStorage = secureStorage;
}
