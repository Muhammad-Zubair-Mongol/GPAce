/**
 * GPAce Durable & Tenant-Scoped Local JSON Repositories
 * 
 * Implements:
 * - Explicit UID-derived tenancy (all repositories & caches isolated per UID)
 * - Cold start directory creation with ready() contract
 * - Serialized writes per logical store per tenant (preventing lost updates during concurrent writes)
 * - Atomic write via temp-file write plus atomic rename (preventing half-written/corrupt files)
 * - Durability on failure (injected write/rename errors preserve previous valid JSON and reject)
 * - Retention of corrupt originals for recovery with typed failures
 * - Protected legacy singleton data requiring explicit owner migration
 * - Standardized error shape: { error: { code, message, requestId } }
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class StorageError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'StorageError';
        this.code = code;
        this.requestId = details.requestId || null;
        this.details = details;
        this.error = {
            code,
            message,
            requestId: this.requestId,
            ...details
        };
    }

    toJSON() {
        return {
            error: this.error
        };
    }
}

class MutexQueue {
    constructor() {
        this.tails = new Map();
    }

    async runExclusive(key, fn) {
        const prev = this.tails.get(key) || Promise.resolve();
        let release;
        const current = new Promise(resolve => { release = resolve; });
        this.tails.set(key, current);

        try {
            await prev;
        } catch {
            // Ignore failure of earlier operation so subsequent operations still execute
        }

        try {
            return await fn();
        } finally {
            if (this.tails.get(key) === current) {
                this.tails.delete(key);
            }
            release();
        }
    }
}

class DataStorage {
    constructor(options = {}) {
        this.dataPath = options.dataDir || path.join(__dirname, '..', 'data');
        this.usersDir = path.join(this.dataPath, 'users');
        this.CACHE_TTL = options.cacheTTL !== undefined ? options.cacheTTL : (5 * 60 * 1000);
        this.tenantCaches = new Map();
        this.mutex = new MutexQueue();
        this._fs = options.fs || fs;
        this.defaultUid = options.defaultUid || null;

        this._initPromise = this._init();
    }

    async _init() {
        try {
            await this._fs.mkdir(this.dataPath, { recursive: true });
            await this._fs.mkdir(this.usersDir, { recursive: true });
            return true;
        } catch (err) {
            throw new StorageError(
                'INITIALIZATION_ERROR',
                `Failed to initialize data storage directory: ${err.message}`,
                { originalError: err.message, dataPath: this.dataPath }
            );
        }
    }

    async ready() {
        await this._initPromise;
        return this;
    }

    async init() {
        return this.ready();
    }

    _validateUid(uid) {
        if (uid === undefined || uid === null) {
            throw new StorageError('TENANT_REQUIRED', 'Tenant UID is required for storage operations');
        }
        if (typeof uid !== 'string') {
            throw new StorageError('INVALID_UID', 'Tenant UID must be a string');
        }
        const trimmed = uid.trim();
        if (!trimmed) {
            throw new StorageError('INVALID_UID', 'Tenant UID cannot be empty');
        }
        if (trimmed === '.' || trimmed === '..') {
            throw new StorageError('INVALID_UID', `Invalid tenant UID: ${uid}`);
        }
        if (
            trimmed.includes('..') ||
            trimmed.includes('/') ||
            trimmed.includes('\\') ||
            trimmed.includes('\0') ||
            trimmed.includes(':')
        ) {
            throw new StorageError('INVALID_UID', `Tenant UID contains illegal characters: ${uid}`);
        }
        if (!/^[a-zA-Z0-9_\-\.@]+$/.test(trimmed)) {
            throw new StorageError('INVALID_UID', `Tenant UID contains unsupported characters: ${uid}`);
        }

        const resolvedDir = path.resolve(this.usersDir, trimmed);
        const resolvedUsersDir = path.resolve(this.usersDir);
        if (!resolvedDir.startsWith(resolvedUsersDir) || resolvedDir === resolvedUsersDir) {
            throw new StorageError('INVALID_UID', `Tenant UID path escapes root storage: ${uid}`);
        }

        return trimmed;
    }

    getTenantDir(uid) {
        const validatedUid = this._validateUid(uid);
        return path.join(this.usersDir, validatedUid);
    }

    getRepositoryPath(uid, storeName) {
        const tenantDir = this.getTenantDir(uid);
        return path.join(tenantDir, `${storeName}.json`);
    }

    async _ensureTenantDir(uid) {
        const tenantDir = this.getTenantDir(uid);
        await this._fs.mkdir(tenantDir, { recursive: true });
        return tenantDir;
    }

    _getTenantCache(uid) {
        let cache = this.tenantCaches.get(uid);
        if (!cache) {
            cache = {
                timetable: null,
                locations: null,
                schedule: null,
                cacheTimestamp: {}
            };
            this.tenantCaches.set(uid, cache);
        }
        return cache;
    }

    _isCacheValid(uid, cacheKey) {
        if (!this.CACHE_TTL || this.CACHE_TTL <= 0) return false;
        const cache = this.tenantCaches.get(uid);
        if (!cache || !cache[cacheKey] || !cache.cacheTimestamp[cacheKey]) {
            return false;
        }
        return (Date.now() - cache.cacheTimestamp[cacheKey] < this.CACHE_TTL);
    }

    _getCache(uid, cacheKey) {
        const cache = this._getTenantCache(uid);
        return cache[cacheKey];
    }

    _updateCache(uid, cacheKey, data) {
        const cache = this._getTenantCache(uid);
        cache[cacheKey] = data;
        cache.cacheTimestamp[cacheKey] = Date.now();
    }

    clearCache(uid, cacheKey) {
        if (uid) {
            const cache = this.tenantCaches.get(uid);
            if (cache) {
                if (cacheKey) {
                    cache[cacheKey] = null;
                    delete cache.cacheTimestamp[cacheKey];
                } else {
                    this.tenantCaches.delete(uid);
                }
            }
        } else {
            this.tenantCaches.clear();
        }
    }

    _resolveArgs(arg1, arg2, storeName) {
        let uid, data;

        if (arg1 !== undefined && arg2 !== undefined) {
            if (typeof arg1 === 'string' && (Array.isArray(arg2) || (typeof arg2 === 'object' && arg2 !== null))) {
                uid = arg1;
                data = arg2;
            } else if ((Array.isArray(arg1) || (typeof arg1 === 'object' && arg1 !== null)) && typeof arg2 === 'string') {
                data = arg1;
                uid = arg2;
            } else if (typeof arg1 === 'string' && typeof arg2 === 'string') {
                uid = arg2;
                data = arg1;
            } else {
                data = arg1;
                uid = arg2;
            }
        } else if (arg1 !== undefined && arg2 === undefined) {
            if (typeof arg1 === 'string') {
                uid = arg1;
            } else {
                data = arg1;
                uid = this.defaultUid || undefined;
            }
        } else {
            uid = this.defaultUid || undefined;
        }

        if (!uid && this.defaultUid) {
            uid = this.defaultUid;
        }

        return { uid, data };
    }

    async _writeStoreAtomic(uid, storeName, data) {
        const tenantDir = await this._ensureTenantDir(uid);
        const targetFile = path.join(tenantDir, `${storeName}.json`);
        const randomSuffix = crypto.randomBytes(6).toString('hex');
        const tempFile = path.join(tenantDir, `${storeName}.${Date.now()}.${randomSuffix}.tmp`);

        const jsonString = JSON.stringify(data, null, 2);

        // Before overwriting an existing file, check if it was corrupt; if so, retain it!
        try {
            const existingRaw = await this._fs.readFile(targetFile, 'utf8');
            try {
                JSON.parse(existingRaw);
            } catch {
                const corruptBackup = `${targetFile}.corrupt.${Date.now()}`;
                const corruptStatic = `${targetFile}.corrupt`;
                try {
                    await this._fs.copyFile(targetFile, corruptBackup);
                    await this._fs.copyFile(targetFile, corruptStatic);
                } catch {}
            }
        } catch {
            // File doesn't exist yet, proceed
        }

        try {
            await this._fs.writeFile(tempFile, jsonString, 'utf8');
            await this._fs.rename(tempFile, targetFile);
        } catch (err) {
            try {
                await this._fs.unlink(tempFile);
            } catch {}

            throw new StorageError(
                'WRITE_FAILED',
                `Failed to write atomic store '${storeName}' for tenant '${uid}': ${err.message}`,
                { originalError: err.message, storeName, uid }
            );
        }
    }

    async _readStoreFile(uid, storeName, defaultContent) {
        const tenantDir = await this._ensureTenantDir(uid);
        const targetFile = path.join(tenantDir, `${storeName}.json`);

        let raw;
        try {
            raw = await this._fs.readFile(targetFile, 'utf8');
        } catch (err) {
            if (err.code === 'ENOENT') {
                await this._writeStoreAtomic(uid, storeName, defaultContent);
                return defaultContent;
            }
            throw new StorageError(
                'READ_FAILED',
                `Failed to read store '${storeName}' for tenant '${uid}': ${err.message}`,
                { originalError: err.message, storeName, uid }
            );
        }

        try {
            return JSON.parse(raw);
        } catch (parseErr) {
            const corruptBackupPath = `${targetFile}.corrupt.${Date.now()}`;
            const corruptStaticPath = `${targetFile}.corrupt`;
            try {
                await this._fs.copyFile(targetFile, corruptBackupPath);
                await this._fs.copyFile(targetFile, corruptStaticPath);
            } catch {}

            throw new StorageError(
                'CORRUPT_DATA',
                `Corrupted JSON in store '${storeName}' for tenant '${uid}': ${parseErr.message}`,
                {
                    storeName,
                    uid,
                    targetFile,
                    corruptBackupPath,
                    originalError: parseErr.message
                }
            );
        }
    }

    // --- Timetable API ---

    async saveTimetable(arg1, arg2) {
        await this.ready();
        const { uid, data: timetableData } = this._resolveArgs(arg1, arg2, 'timetable');
        const validatedUid = this._validateUid(uid);

        if (!Array.isArray(timetableData)) {
            throw new StorageError('INVALID_INPUT', 'timetableData must be an array of events');
        }

        return await this.mutex.runExclusive(`${validatedUid}:timetable`, async () => {
            const payload = { events: timetableData };
            await this._writeStoreAtomic(validatedUid, 'timetable', payload);
            this._updateCache(validatedUid, 'timetable', timetableData);
            return true;
        });
    }

    async getTimetable(uid) {
        await this.ready();
        const validatedUid = this._validateUid(uid);

        if (this._isCacheValid(validatedUid, 'timetable')) {
            return this._getCache(validatedUid, 'timetable');
        }

        const data = await this._readStoreFile(validatedUid, 'timetable', { events: [] });
        const events = Array.isArray(data.events) ? data.events : [];
        this._updateCache(validatedUid, 'timetable', events);
        return events;
    }

    async clearTimetable(uid) {
        await this.ready();
        const validatedUid = this._validateUid(uid);

        return await this.mutex.runExclusive(`${validatedUid}:timetable`, async () => {
            const payload = { events: [] };
            await this._writeStoreAtomic(validatedUid, 'timetable', payload);
            this._updateCache(validatedUid, 'timetable', []);
            return true;
        });
    }

    // --- Locations API ---

    async saveLocation(arg1, arg2) {
        await this.ready();
        const { uid, data: locationData } = this._resolveArgs(arg1, arg2, 'locations');
        const validatedUid = this._validateUid(uid);

        if (!locationData || typeof locationData !== 'object') {
            throw new StorageError('INVALID_INPUT', 'locationData must be an object');
        }

        return await this.mutex.runExclusive(`${validatedUid}:locations`, async () => {
            const existingData = await this._getLocationsInternal(validatedUid);
            const spaces = Array.isArray(existingData.spaces) ? [...existingData.spaces] : [];

            if (Array.isArray(locationData.spaces)) {
                spaces.push(...locationData.spaces);
            } else {
                spaces.push(locationData);
            }

            const payload = { spaces };
            await this._writeStoreAtomic(validatedUid, 'locations', payload);
            this._updateCache(validatedUid, 'locations', payload);
            return true;
        });
    }

    async _getLocationsInternal(uid) {
        if (this._isCacheValid(uid, 'locations')) {
            return this._getCache(uid, 'locations');
        }

        const data = await this._readStoreFile(uid, 'locations', { spaces: [] });
        const result = { spaces: Array.isArray(data.spaces) ? data.spaces : [] };
        this._updateCache(uid, 'locations', result);
        return result;
    }

    async getLocations(uid) {
        await this.ready();
        const validatedUid = this._validateUid(uid);
        return await this._getLocationsInternal(validatedUid);
    }

    // --- Schedule API ---

    async saveSchedule(arg1, arg2) {
        await this.ready();
        const { uid, data: scheduleData } = this._resolveArgs(arg1, arg2, 'schedule');
        const validatedUid = this._validateUid(uid);

        if (!Array.isArray(scheduleData)) {
            throw new StorageError('INVALID_INPUT', 'scheduleData must be an array of tasks');
        }

        return await this.mutex.runExclusive(`${validatedUid}:schedule`, async () => {
            const payload = { tasks: scheduleData };
            await this._writeStoreAtomic(validatedUid, 'schedule', payload);
            this._updateCache(validatedUid, 'schedule', scheduleData);
            return true;
        });
    }

    async getSchedule(uid) {
        await this.ready();
        const validatedUid = this._validateUid(uid);

        if (this._isCacheValid(validatedUid, 'schedule')) {
            return this._getCache(validatedUid, 'schedule');
        }

        const data = await this._readStoreFile(validatedUid, 'schedule', { tasks: [] });
        const tasks = Array.isArray(data.tasks) ? data.tasks : [];
        this._updateCache(validatedUid, 'schedule', tasks);
        return tasks;
    }

    // --- Scoped Tenant Accessor ---

    forTenant(uid) {
        const validatedUid = this._validateUid(uid);
        const self = this;
        return {
            get uid() { return validatedUid; },
            ready: () => self.ready(),
            getTimetable: () => self.getTimetable(validatedUid),
            saveTimetable: (data) => self.saveTimetable(data, validatedUid),
            clearTimetable: () => self.clearTimetable(validatedUid),
            getLocations: () => self.getLocations(validatedUid),
            saveLocation: (data) => self.saveLocation(data, validatedUid),
            getSchedule: () => self.getSchedule(validatedUid),
            saveSchedule: (data) => self.saveSchedule(data, validatedUid),
            clearCache: (key) => self.clearCache(validatedUid, key)
        };
    }

    forUser(uid) {
        return this.forTenant(uid);
    }

    // --- Explicit Legacy Migration ---

    async migrateLegacyData(targetUid, options = {}) {
        await this.ready();
        const validatedUid = this._validateUid(targetUid);

        const legacyFiles = [
            { name: 'timetable.json', store: 'timetable', key: 'events' },
            { name: 'locations.json', store: 'locations', key: 'spaces' },
            { name: 'schedule.json', store: 'schedule', key: 'tasks' }
        ];

        const results = {
            success: true,
            migrated: false,
            targetUid: validatedUid,
            migratedStores: [],
            archivedFiles: []
        };

        for (const item of legacyFiles) {
            const legacyPath = path.join(this.dataPath, item.name);
            let exists = false;
            try {
                await this._fs.access(legacyPath);
                exists = true;
            } catch {
                exists = false;
            }

            if (!exists) continue;

            const raw = await this._fs.readFile(legacyPath, 'utf8');
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (parseErr) {
                const corruptBackup = `${legacyPath}.corrupt.${Date.now()}`;
                const corruptStatic = `${legacyPath}.corrupt`;
                try {
                    await this._fs.copyFile(legacyPath, corruptBackup);
                    await this._fs.copyFile(legacyPath, corruptStatic);
                } catch {}
                throw new StorageError(
                    'CORRUPT_DATA',
                    `Corrupt legacy file ${item.name} encountered during migration: ${parseErr.message}`,
                    { legacyPath, corruptBackup, originalError: parseErr.message }
                );
            }

            await this._writeStoreAtomic(validatedUid, item.store, parsed);

            if (item.store === 'locations') {
                this._updateCache(validatedUid, item.store, parsed);
            } else {
                this._updateCache(validatedUid, item.store, parsed[item.key] || []);
            }

            const archivedPath = `${legacyPath}.migrated.${Date.now()}`;
            try {
                await this._fs.rename(legacyPath, archivedPath);
                results.archivedFiles.push(archivedPath);
            } catch (renameErr) {
                try {
                    await this._fs.unlink(legacyPath);
                } catch {}
            }

            results.migratedStores.push(item.store);
            results.migrated = true;
        }

        return results;
    }
}

const defaultInstance = new DataStorage();
defaultInstance.DataStorage = DataStorage;
defaultInstance.StorageError = StorageError;
defaultInstance.MutexQueue = MutexQueue;

module.exports = defaultInstance;
