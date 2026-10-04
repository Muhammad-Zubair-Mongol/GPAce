/**
 * TaskRepository.js
 * 
 * SINGLE SOURCE OF TRUTH for all task storage operations.
 * Part of Step 41: Canonical Task Envelopes, Strict Validation, and One-Way Migration.
 * 
 * RULES:
 * 1. Return typed missing/valid/corrupt reads; validate schema/version/array/task identity/checksum.
 * 2. Scope direct localStorage keys and migration markers by verified UID (separate anonymous namespace).
 * 3. Make a committed migration marker authoritative even for empty data (valid empty v5 plus nonempty legacy returns []).
 * 4. Preserve corrupt source for explicit recovery rather than overwriting.
 * 5. Expose ready() and stable contract to page consumers; avoid global localStorage monkeypatches.
 * 
 * @version 5.1.0
 */

// ============================================
// STORAGE KEY CONSTANTS & ENUMS
// ============================================
const STORAGE_KEYS = {
    // V5 Format Base Keys
    TASKS_PREFIX: 'tasks_v5.',
    RELAXED: 'relaxed_v5',
    COMPLETED_PREFIX: 'completed_v5.',
    PRIORITY_CACHE: 'priority_cache_v5',
    COMPLETION_TX_PREFIX: 'completion_tx_v1.',
    PROJECT_REVISION_PREFIX: 'project_revision_v1.',
    CONFLICT_PREFIX: 'conflict_v1.',

    // System & Tenancy Keys
    DEVICE_ID: 'device_id',
    LAST_SYNC: 'last_sync',
    SCHEMA_VERSION: 'schema_version',
    MIGRATION_MARKER: 'migration_done_v5',

    // Backup Slots
    BACKUP_PREFIX: 'backup_',

    // Legacy Keys (for one-way transition)
    LEGACY_TASKS_PREFIX: 'tasks-',
    LEGACY_RELAXED: 'relaxed-tasks',
    LEGACY_COMPLETED_PREFIX: 'completed-tasks-',
    LEGACY_PRIORITY: 'calculatedPriorityTasks'
};

const CURRENT_VERSION = 5;
const SCHEMA_NAME = 'gpac_v5';
const CONFLICT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const POLL_INTERVAL_MS = 5000; // 5 seconds

// Read outcome statuses
export const ENVELOPE_STATUS = {
    VALID: 'valid',
    MISSING: 'missing',
    CORRUPT: 'corrupt'
};

// ============================================
// BROADCAST CHANNEL (SAFELY UNREF'D IN NODE)
// ============================================
let broadcastChannel = null;
try {
    if (typeof BroadcastChannel !== 'undefined') {
        broadcastChannel = new BroadcastChannel('gpac_sync');
        if (typeof broadcastChannel.unref === 'function') {
            broadcastChannel.unref();
        }
    }
} catch (e) {
    console.warn('[TaskRepository] BroadcastChannel not available:', e);
}

// ============================================
// TASK REPOSITORY CLASS
// ============================================
class TaskRepository {
    static _initialized = false;
    static _initPromise = null;
    static _currentUserId = null;
    static _storageBackend = null;
    static _pollInterval = null;
    static _backupInterval = null;
    static _storageListener = null;
    static _broadcastMessageHandler = null;
    static _backupVisibilityListener = null;
    static _crossTabUnsubscribe = null;
    static _changeListeners = [];
    static _lastKnownVersions = new Map();
    static _conflictModalShowing = false;
    static _conflictQueue = [];
    static _deferredConflicts = new Map();
    static _conflictActive = null;
    static _conflictDrainPromise = null;
    static _conflictSequence = 0;
    static _conflictGeneration = 0;
    static _lastLocalWriteAt = 0;
    static _corruptedKeys = new Map();

    // ========================================
    // TENANCY & STORAGE BACKEND
    // ========================================

    /**
     * Resolves the active underlying Web Storage backend
     * @private
     */
    static _getStorage() {
        if (this._storageBackend) return this._storageBackend;
        if (typeof localStorage !== 'undefined') return localStorage;
        if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
        if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
        return null;
    }

    /**
     * Inject custom storage backend (e.g. for isolated test harness)
     * @param {Object} storage - Storage object implementing Web Storage API
     */
    static setStorageBackend(storage) {
        this._storageBackend = storage;
    }

    /**
     * Set verified user UID.
     * Switches key-space and flushes in-memory version/corrupt caches.
     * @param {string|null} uid - User UID or null for anonymous
     * @returns {string} The active user prefix
     */
    static setUser(uid) {
        const normalizedUid = (uid && typeof uid === 'string' && uid.trim().length > 0)
            ? uid.trim()
            : null;

        if (this._currentUserId !== normalizedUid) {
            this._teardownLifecycle();
            this._resetConflictCoordinator();
            this._currentUserId = normalizedUid;
            this._lastKnownVersions.clear();
            this._corruptedKeys.clear();
            this._initialized = false;
            this._initPromise = null;
        }

        return this._getUserPrefix();
    }

    /**
     * Get current user UID (or null for anonymous)
     * @returns {string|null}
     */
    static getUser() {
        return this._currentUserId;
    }

    /**
     * Get prefix for active user scope.
     * Verified users: gpac_u_<uid>_
     * Anonymous: gpac_anon_
     * @private
     */
    static _getUserPrefix() {
        if (this._currentUserId) {
            return `gpac_u_${this._currentUserId}_`;
        }
        return 'gpac_anon_';
    }

    /**
     * Generate scoped storage key
     * @private
     */
    static _getScopedKey(key) {
        return `${this._getUserPrefix()}${key}`;
    }

    static _getCompletionTransactionKey(projectId) {
        return this._getScopedKey(
            `${STORAGE_KEYS.COMPLETION_TX_PREFIX}${encodeURIComponent(String(projectId))}`
        );
    }

    static _getProjectRevisionKey(projectId) {
        return this._getScopedKey(
            `${STORAGE_KEYS.PROJECT_REVISION_PREFIX}${encodeURIComponent(String(projectId))}`
        );
    }

    static _getConflictRecordKey(conflictId) {
        return this._getScopedKey(
            `${STORAGE_KEYS.CONFLICT_PREFIX}${encodeURIComponent(String(conflictId))}`
        );
    }

    static _getTaskStorageKeys(projectId) {
        const normalizedProjectId = projectId === 'relaxed' ? 'relaxed' : String(projectId);
        return {
            tasksKey: normalizedProjectId === 'relaxed'
                ? this._getScopedKey(STORAGE_KEYS.RELAXED)
                : this._getScopedKey(STORAGE_KEYS.TASKS_PREFIX + normalizedProjectId),
            completedKey: this._getScopedKey(STORAGE_KEYS.COMPLETED_PREFIX + normalizedProjectId)
        };
    }

    static _cloneConflictValue(value, fallback = null) {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return fallback;
        }
    }

    static _getProjectRevision(projectId) {
        if (!projectId) return 0;
        const storage = this._getStorage();
        if (!storage) return 0;

        const raw = storage.getItem(this._getProjectRevisionKey(projectId));
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;

        // Older envelopes do not have a separate revision key. Accept an
        // envelope revision when present, then start at zero for legacy data.
        const keys = this._getTaskStorageKeys(projectId);
        for (const key of [keys.tasksKey, keys.completedKey]) {
            try {
                const envelope = this._readV5(key);
                const revision = Number(envelope?.wrapper?.revision);
                if (Number.isFinite(revision) && revision >= 0) return revision;
            } catch {}
        }
        return 0;
    }

    static getProjectRevision(projectId) {
        return this._getProjectRevision(projectId);
    }

    static _writeProjectRevision(projectId, revision) {
        const storage = this._getStorage();
        if (!storage) throw new Error('No storage backend available');
        const normalized = Number(revision);
        if (!Number.isFinite(normalized) || normalized < 0) {
            throw new Error(`Invalid project revision for ${projectId}`);
        }
        this._setStorageItem(storage, this._getProjectRevisionKey(projectId), String(normalized));
    }

    static _normalizeConflictSnapshot(input, fallbackProjectId = null) {
        const source = input && typeof input === 'object' ? input : {};
        const nested = source.data && typeof source.data === 'object' && !Array.isArray(source.data)
            ? source.data
            : {};
        const directArray = Array.isArray(source.data) ? source.data : null;
        const firstArray = (...values) => values.find(Array.isArray) || [];
        const projectId = source.projectId ?? nested.projectId ?? fallbackProjectId;
        const active = firstArray(
            source.active,
            source.tasks,
            source.activeTasks,
            directArray,
            nested.active,
            nested.tasks,
            nested.activeTasks,
            nested.localTasks,
            nested.remoteTasks
        );
        const completed = firstArray(
            source.completed,
            source.completedTasks,
            nested.completed,
            nested.completedTasks,
            nested.history
        );
        const revisionCandidate = source.revision ?? source.remoteRevision ?? source.localRevision ??
            nested.revision ?? nested.remoteRevision ?? nested.localRevision;
        const revision = Number(revisionCandidate);

        return {
            projectId: projectId === null || projectId === undefined ? null : String(projectId),
            revision: Number.isFinite(revision) && revision >= 0 ? revision : 0,
            active: this._cloneConflictValue(active, []),
            completed: this._cloneConflictValue(completed, []),
            tasks: this._cloneConflictValue(active, []),
            ts: Number(source.ts ?? nested.ts) || Date.now(),
            source: source.source || source.deviceId || null
        };
    }

    static _snapshotProject(projectId) {
        const keys = this._getTaskStorageKeys(projectId);
        const activeEnvelope = this._readV5(keys.tasksKey);
        const completedEnvelope = this._readV5(keys.completedKey);
        const active = activeEnvelope.status === ENVELOPE_STATUS.VALID
            ? activeEnvelope.data.slice()
            : (projectId === 'relaxed' ? this.getRelaxedTasks() : this.getAllTasks(projectId));
        const completed = completedEnvelope.status === ENVELOPE_STATUS.VALID
            ? completedEnvelope.data.slice()
            : this.getCompletedTasks(projectId);
        const revision = this._getProjectRevision(projectId);

        return {
            projectId: String(projectId),
            revision,
            active: this._cloneConflictValue(active, []),
            completed: this._cloneConflictValue(completed, []),
            tasks: this._cloneConflictValue(active, []),
            ts: Date.now(),
            source: 'local'
        };
    }

    static _conflictFingerprint(snapshot) {
        return JSON.stringify({
            active: snapshot?.active || [],
            completed: snapshot?.completed || []
        });
    }

    static _writeConflictRecord(request, status, extra = {}) {
        const storage = this._getStorage();
        if (!storage) throw new Error('No storage backend available');
        const record = {
            version: 1,
            schema: 'gpac_conflict_v1',
            id: request.id,
            projectId: request.projectId,
            status,
            choice: request.choice || null,
            local: this._cloneConflictValue(request.localSnapshot, {}),
            remote: this._cloneConflictValue(request.remoteSnapshot, {}),
            createdAt: request.createdAt,
            updatedAt: new Date().toISOString(),
            ...this._cloneConflictValue(extra, {})
        };
        this._setStorageItem(storage, this._getConflictRecordKey(request.id), JSON.stringify(record));
        request.lastRecord = record;
        return record;
    }

    static getConflictRecord(conflictId) {
        const storage = this._getStorage();
        if (!storage || !conflictId) return null;
        try {
            const raw = storage.getItem(this._getConflictRecordKey(conflictId));
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    static getConflictState() {
        return {
            showing: this._conflictModalShowing,
            activeId: this._conflictActive?.id || null,
            queuedIds: this._conflictQueue.map(request => request.id),
            deferredIds: [...this._deferredConflicts.keys()]
        };
    }

    static _setStorageItem(storage, key, value) {
        const result = storage.setItem(key, value);
        if (result === false) throw new Error(`Unable to persist storage key ${key}`);
        return result;
    }

    /**
     * Read the durable completion journal. The journal keeps the last valid
     * before/after snapshots until the commit marker is durable, allowing public
     * readers to choose one complete view across a multi-key Web Storage write.
     */
    static _readCompletionTransaction(projectId) {
        const storage = this._getStorage();
        if (!storage) return null;

        try {
            const raw = storage.getItem(this._getCompletionTransactionKey(projectId));
            if (!raw) return null;
            const transaction = JSON.parse(raw);
            const validPhases = new Set(['prepared', 'active-written', 'completed-written', 'committed', 'failed']);
            if (
                !transaction ||
                transaction.projectId !== String(projectId) ||
                !validPhases.has(transaction.phase) ||
                !Array.isArray(transaction.activeBefore) ||
                !Array.isArray(transaction.completedBefore) ||
                !Array.isArray(transaction.activeAfter) ||
                !Array.isArray(transaction.completedAfter) ||
                !transaction.completedTask
            ) {
                console.warn('[TaskRepository] Ignoring malformed completion journal:', projectId);
                return null;
            }
            return transaction;
        } catch (error) {
            console.warn('[TaskRepository] Completion journal is unreadable:', error.message);
            return null;
        }
    }

    static _writeCompletionTransaction(transaction) {
        const storage = this._getStorage();
        if (!storage) throw new Error('No storage backend available');
        const key = this._getCompletionTransactionKey(transaction.projectId);
        const result = storage.setItem(key, JSON.stringify({
            ...transaction,
            updatedAt: new Date().toISOString()
        }));
        if (result === false) throw new Error(`Unable to persist completion journal ${key}`);
    }

    static _clearCompletionTransaction(projectId) {
        const storage = this._getStorage();
        if (!storage) return;
        const result = storage.removeItem(this._getCompletionTransactionKey(projectId));
        if (result === false) throw new Error(`Unable to clear completion journal for ${projectId}`);
    }

    static _getCompletionView(projectId) {
        const transaction = this._readCompletionTransaction(projectId);
        if (!transaction) return null;

        const committed = transaction.phase === 'completed-written' || transaction.phase === 'committed';
        return {
            transaction,
            active: committed ? transaction.activeAfter : transaction.activeBefore,
            completed: committed ? transaction.completedAfter : transaction.completedBefore
        };
    }

    static _advanceCompletionTransaction(transaction) {
        const keys = this._getTaskStorageKeys(transaction.projectId);
        let current = { ...transaction };

        if (current.phase === 'prepared' || current.phase === 'failed') {
            this._writeV5(keys.tasksKey, current.activeAfter, true);
            current = { ...current, phase: 'active-written', lastError: null };
            this._writeCompletionTransaction(current);
        }

        if (current.phase === 'active-written') {
            this._writeV5(keys.completedKey, current.completedAfter, true);
            current = { ...current, phase: 'completed-written', lastError: null };
            this._writeCompletionTransaction(current);
        }

        if (current.phase === 'completed-written') {
            current = { ...current, phase: 'committed', lastError: null };
            this._writeCompletionTransaction(current);
        }

        return current;
    }

    static _recordCompletionFailure(transaction, error) {
        // Restore both old snapshots when the injected failure is transient.
        // If the storage failure persists, readers still use the journal's
        // before-view and the journal remains available for a later retry.
        const keys = this._getTaskStorageKeys(transaction.projectId);
        try { this._writeV5(keys.tasksKey, transaction.activeBefore, true); } catch {}
        try { this._writeV5(keys.completedKey, transaction.completedBefore, true); } catch {}
        try {
            this._writeCompletionTransaction({
                ...transaction,
                phase: 'failed',
                lastError: error?.message || String(error || 'completion failed')
            });
        } catch {}
    }

    static _prepareProjectMutation(projectId) {
        const transaction = this._readCompletionTransaction(projectId);
        if (!transaction) return;
        if (transaction.phase !== 'committed') {
            throw new Error(`Completion transition is pending for project ${projectId}`);
        }
        this._clearCompletionTransaction(projectId);
    }

    static _resetRequestPromise(request) {
        request.settled = false;
        request.promise = new Promise(resolve => {
            request.resolve = resolve;
        });
        return request.promise;
    }

    static _resetConflictCoordinator() {
        this._conflictGeneration += 1;
        const cancelled = [...this._conflictQueue, ...this._deferredConflicts.values()];
        if (this._conflictActive) cancelled.push(this._conflictActive);
        for (const request of cancelled) {
            if (request && !request.settled) {
                request.settled = true;
                request.resolve?.({ status: 'cancelled', id: request.id });
            }
        }
        this._conflictQueue = [];
        this._deferredConflicts.clear();
        this._conflictActive = null;
        this._conflictModalShowing = false;
        this._conflictDrainPromise = null;
    }

    static _makeConflictRequest(localData, remoteData, options = {}) {
        const projectCandidate = options.projectId ??
            localData?.projectId ?? localData?.data?.projectId ??
            remoteData?.projectId ?? remoteData?.data?.projectId ?? null;
        const localSnapshot = this._normalizeConflictSnapshot(localData, projectCandidate);
        const remoteSnapshot = this._normalizeConflictSnapshot(remoteData, projectCandidate);
        const projectId = String(
            options.projectId ?? localSnapshot.projectId ?? remoteSnapshot.projectId ?? 'unknown'
        );
        localSnapshot.projectId = projectId;
        remoteSnapshot.projectId = projectId;

        const request = {
            id: options.id || `conflict-${Date.now()}-${++this._conflictSequence}`,
            projectId,
            localSnapshot,
            remoteSnapshot,
            createdAt: options.createdAt || new Date().toISOString(),
            generation: this._conflictGeneration,
            status: 'pending',
            choice: null,
            settled: false,
            resolve: null,
            promise: null
        };
        this._resetRequestPromise(request);
        return request;
    }

    /**
     * Add a conflict to the single repository-owned coordinator. Only this
     * coordinator asks the modal for a choice, so a later conflict cannot
     * replace the resolver for the conflict currently on screen.
     */
    static enqueueConflict(localData, remoteData, options = {}) {
        const request = this._makeConflictRequest(localData, remoteData, options);
        this._conflictQueue.push(request);
        this._conflictModalShowing = true;

        try {
            this._writeConflictRecord(request, 'pending');
        } catch (error) {
            // Keep the in-memory request actionable when the audit record
            // itself cannot be written. Resolution still requires a later
            // durable acknowledgement before the latch is cleared.
            request.recordError = error?.message || String(error);
            console.warn('[TaskRepository] Conflict audit record unavailable:', request.recordError);
        }

        this._ensureConflictDrain();
        return request.promise;
    }

    static _ensureConflictDrain() {
        if (this._conflictDrainPromise) return this._conflictDrainPromise;
        const generation = this._conflictGeneration;
        this._conflictDrainPromise = this._drainConflictQueue(generation)
            .finally(() => {
                if (generation === this._conflictGeneration) {
                    this._conflictDrainPromise = null;
                }
            });
        return this._conflictDrainPromise;
    }

    static _getConflictModal() {
        if (typeof window !== 'undefined' && window.ConflictModal) {
            return window.ConflictModal;
        }
        if (typeof globalThis !== 'undefined' && globalThis.ConflictModal) {
            return globalThis.ConflictModal;
        }
        return null;
    }

    static async _requestConflictChoice(request) {
        const modal = this._getConflictModal();
        if (!modal || typeof modal.show !== 'function') {
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' &&
                typeof CustomEvent !== 'undefined') {
                window.dispatchEvent(new CustomEvent('gpac_conflict', {
                    detail: {
                        localData: request.localSnapshot,
                        remoteChange: request.remoteSnapshot,
                        conflictId: request.id
                    }
                }));
            }
            return null;
        }
        return await Promise.resolve(modal.show(request.localSnapshot, request.remoteSnapshot));
    }

    static _normalizeConflictChoice(choice) {
        const action = typeof choice === 'string' ? choice : choice?.action;
        if (action === 'local' || action === 'remote' || action === 'merge') return action;
        if (action === 'defer' || action === 'cancel') return 'defer';
        return null;
    }

    static _mergeConflictSnapshots(localSnapshot, remoteSnapshot) {
        const chooseRecord = (left, right) => {
            const leftRevision = Number(left?.revision ?? left?.version ?? 0);
            const rightRevision = Number(right?.revision ?? right?.version ?? 0);
            if (leftRevision !== rightRevision) return leftRevision > rightRevision ? left : right;

            const leftTime = Date.parse(left?.updatedAt || left?.completedAt || '') || 0;
            const rightTime = Date.parse(right?.updatedAt || right?.completedAt || '') || 0;
            if (leftTime !== rightTime) return leftTime > rightTime ? left : right;

            const leftJson = JSON.stringify(left ?? null);
            const rightJson = JSON.stringify(right ?? null);
            return leftJson <= rightJson ? left : right;
        };

        const mergeArray = (leftArray, rightArray) => {
            const values = new Map();
            for (const item of [...(Array.isArray(leftArray) ? leftArray : []), ...(Array.isArray(rightArray) ? rightArray : [])]) {
                const key = item && item.id !== undefined
                    ? `id:${String(item.id)}`
                    : `value:${JSON.stringify(item)}`;
                values.set(key, values.has(key) ? chooseRecord(values.get(key), item) : item);
            }
            return [...values.entries()]
                .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
                .map(([, value]) => this._cloneConflictValue(value, value));
        };

        const completed = mergeArray(localSnapshot?.completed, remoteSnapshot?.completed);
        const completedIds = new Set(completed.map(task => String(task?.id)).filter(Boolean));
        const active = mergeArray(localSnapshot?.active, remoteSnapshot?.active)
            .filter(task => !completedIds.has(String(task?.id)));

        return {
            projectId: localSnapshot?.projectId || remoteSnapshot?.projectId,
            revision: Math.max(
                Number(localSnapshot?.revision) || 0,
                Number(remoteSnapshot?.revision) || 0
            ),
            active,
            completed,
            tasks: active,
            ts: Date.now(),
            source: 'deterministic-merge'
        };
    }

    static _selectedConflictSnapshot(request, choice) {
        if (choice === 'local') return this._normalizeConflictSnapshot(request.localSnapshot, request.projectId);
        if (choice === 'remote') return this._normalizeConflictSnapshot(request.remoteSnapshot, request.projectId);
        return this._mergeConflictSnapshots(request.localSnapshot, request.remoteSnapshot);
    }

    static _rollbackConflict(projectId, before) {
        const keys = this._getTaskStorageKeys(projectId);
        try { this._writeV5(keys.tasksKey, before.active, true); } catch {}
        try { this._writeV5(keys.completedKey, before.completed, true); } catch {}
        try { this._writeProjectRevision(projectId, before.revision); } catch {}
    }

    static async _applyConflictResolution(request, choice) {
        const current = this._snapshotProject(request.projectId);
        const expectedLocal = this._normalizeConflictSnapshot(request.localSnapshot, request.projectId);
        if (
            current.revision !== expectedLocal.revision ||
            this._conflictFingerprint(current) !== this._conflictFingerprint(expectedLocal)
        ) {
            const error = new Error(`Conflict revision changed for project ${request.projectId}`);
            error.code = 'CONCURRENT_CONFLICT_REVISION';
            error.current = current;
            throw error;
        }

        const selected = this._selectedConflictSnapshot(request, choice);
        const nextRevision = Math.max(
            current.revision,
            Number(request.remoteSnapshot?.revision) || 0
        ) + 1;
        const keys = this._getTaskStorageKeys(request.projectId);

        request.choice = choice;
        try {
            this._writeConflictRecord(request, 'applying', {
                before: current,
                selected,
                nextRevision
            });

            this._writeV5(keys.tasksKey, selected.active, true);
            this._writeV5(keys.completedKey, selected.completed, true);
            this._writeProjectRevision(request.projectId, nextRevision);

            // Keep the full local and remote revisions in the durable audit
            // record before notifying any observers that the conflict is
            // complete.
            this._writeConflictRecord(request, 'resolved', {
                before: current,
                selected,
                nextRevision,
                acknowledgedAt: new Date().toISOString()
            });
        } catch (error) {
            this._rollbackConflict(request.projectId, current);
            try {
                this._writeConflictRecord(request, 'failed', {
                    before: current,
                    selected,
                    nextRevision,
                    error: error?.message || String(error)
                });
            } catch {}
            throw error;
        }

        try {
            this._updatePriorityCache(request.projectId);
        } catch (error) {
            console.warn('[TaskRepository] Priority cache update deferred after conflict:', error.message);
        }

        const detail = {
            projectId: request.projectId,
            conflictId: request.id,
            choice,
            revision: nextRevision,
            tasks: selected.active,
            completed: selected.completed,
            acknowledged: true
        };
        this.broadcastChange('CONFLICT_RESOLVED', detail);
        this._publishSynced(detail);
        return detail;
    }

    static _publishSynced(detail) {
        this._notifyListeners('SYNCED', detail);
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' &&
            typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gpac_synced', { detail }));
        }
        if (typeof window !== 'undefined' && window.SyncStatusIndicator?.setState) {
            window.SyncStatusIndicator.setState('synced');
        }
    }

    static async _drainConflictQueue(generation) {
        while (generation === this._conflictGeneration && this._conflictQueue.length > 0) {
            const request = this._conflictQueue.shift();
            this._conflictActive = request;
            this._conflictModalShowing = true;

            let rawChoice;
            try {
                rawChoice = await this._requestConflictChoice(request);
            } catch (error) {
                rawChoice = null;
                request.status = 'failed';
                request.error = error?.message || String(error);
                try { this._writeConflictRecord(request, 'failed', { error: request.error }); } catch {}
                this._notifyListeners('CONFLICT_FAILED', {
                    conflictId: request.id,
                    projectId: request.projectId,
                    error: request.error,
                    actionable: true
                });
            }

            if (generation !== this._conflictGeneration) {
                if (!request.settled) {
                    request.settled = true;
                    request.resolve?.({ status: 'cancelled', id: request.id });
                }
                this._conflictActive = null;
                return;
            }

            const choice = this._normalizeConflictChoice(rawChoice);
            if (!choice) {
                // A missing modal or a rejected choice leaves the request in
                // the queue. It remains recoverable and no synced signal is
                // published.
                request.status = 'pending';
                this._conflictQueue.unshift(request);
                this._conflictActive = null;
                this._conflictModalShowing = true;
                return;
            }

            if (choice === 'defer') {
                request.status = 'deferred';
                request.choice = 'defer';
                try { this._writeConflictRecord(request, 'deferred', { actionable: true }); } catch {}
                this._deferredConflicts.set(request.id, request);
                this._conflictActive = null;
                if (!request.settled) {
                    request.settled = true;
                    request.resolve?.({ status: 'deferred', id: request.id, recoverable: true });
                }
                continue;
            }

            try {
                const detail = await this._applyConflictResolution(request, choice);
                request.status = 'resolved';
                this._conflictActive = null;
                if (!request.settled) {
                    request.settled = true;
                    request.resolve?.({ status: 'resolved', ...detail });
                }
            } catch (error) {
                this._conflictActive = null;
                if (error?.code === 'CONCURRENT_CONFLICT_REVISION') {
                    request.status = 'reopened';
                    request.error = error.message;
                    try {
                        this._writeConflictRecord(request, 'reopened', {
                            current: error.current,
                            actionable: true,
                            error: error.message
                        });
                    } catch {}

                    const reopened = this._makeConflictRequest(
                        error.current,
                        request.remoteSnapshot,
                        { projectId: request.projectId, parentId: request.id }
                    );
                    try { this._writeConflictRecord(reopened, 'pending', { parentId: request.id }); } catch {}
                    this._conflictQueue.unshift(reopened);
                    if (!request.settled) {
                        request.settled = true;
                        request.resolve?.({ status: 'reopened', id: request.id, nextId: reopened.id, recoverable: true });
                    }
                    continue;
                }

                request.status = 'failed';
                request.error = error?.message || String(error);
                try {
                    this._writeConflictRecord(request, 'failed', {
                        error: request.error,
                        actionable: true
                    });
                } catch {}
                this._conflictQueue.unshift(request);
                this._conflictModalShowing = true;
                this._notifyListeners('CONFLICT_FAILED', {
                    conflictId: request.id,
                    projectId: request.projectId,
                    error: request.error,
                    actionable: true
                });
                if (!request.settled) {
                    request.settled = true;
                    request.resolve?.({ status: 'failed', id: request.id, error: request.error, recoverable: true });
                }
                return;
            }
        }

        this._conflictActive = null;
        this._conflictModalShowing = this._conflictQueue.length > 0 || this._deferredConflicts.size > 0;
    }

    static resumeConflict(conflictId) {
        const request = this._deferredConflicts.get(conflictId) ||
            this._conflictQueue.find(item => item.id === conflictId);
        if (!request) return Promise.resolve({ status: 'missing', id: conflictId });

        this._deferredConflicts.delete(conflictId);
        const index = this._conflictQueue.indexOf(request);
        if (index > -1) this._conflictQueue.splice(index, 1);
        request.status = 'pending';
        request.choice = null;
        this._resetRequestPromise(request);
        try { this._writeConflictRecord(request, 'pending', { resumedAt: new Date().toISOString() }); } catch {}
        this._conflictQueue.unshift(request);
        this._conflictModalShowing = true;
        const existingDrain = this._conflictDrainPromise;
        if (existingDrain && !this._conflictActive) {
            existingDrain.then(
                () => {
                    if (this._conflictQueue.includes(request)) this._ensureConflictDrain();
                },
                () => {
                    if (this._conflictQueue.includes(request)) this._ensureConflictDrain();
                }
            );
        } else {
            this._ensureConflictDrain();
        }
        return request.promise;
    }

    static retryConflict(conflictId) {
        const failedRequest = this._conflictQueue.find(request => request.id === conflictId) ||
            this._deferredConflicts.get(conflictId);
        if (failedRequest?.status === 'failed') {
            // A failed storage attempt is rolled back before it is requeued.
            // Refresh only this retry baseline from the durable rollback; a
            // later unseen revision still goes through the normal revision
            // check in _applyConflictResolution and reopens reconciliation.
            failedRequest.localSnapshot = this._snapshotProject(failedRequest.projectId);
        }
        return this.resumeConflict(conflictId);
    }

    /**
     * Check if migration is committed for the active scope
     * @private
     */
    static _isMigrationDone() {
        const storage = this._getStorage();
        if (!storage) return false;
        const key = this._getScopedKey(STORAGE_KEYS.MIGRATION_MARKER);
        return storage.getItem(key) === 'true';
    }

    /**
     * Mark migration as committed for active scope
     * @private
     */
    static _markMigrationDone() {
        const storage = this._getStorage();
        if (!storage) return;
        const key = this._getScopedKey(STORAGE_KEYS.MIGRATION_MARKER);
        this._setStorageItem(storage, key, 'true');
        this._setStorageItem(storage, this._getScopedKey(STORAGE_KEYS.SCHEMA_VERSION), String(CURRENT_VERSION));
    }

    // ========================================
    // INITIALIZATION & READINESS
    // ========================================

    /**
     * Initialize repository.
     * @returns {Promise<boolean>} True if initialized healthy
     */
    static async init() {
        if (this._initialized) {
            return true;
        }

        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = (async () => {
            console.log(`[TaskRepository] Initializing for scope: ${this._getUserPrefix()}...`);

            try {
                this._ensureDeviceId();

                // Check migration requirement
                if (!this._isMigrationDone()) {
                    await this.migrateOldData();
                }

                // Verify data integrity
                const integrityOk = await this._verifyIntegrity();
                if (!integrityOk) {
                    console.warn('[TaskRepository] Integrity check failed. Controlled recovery required.');
                    this._initialized = false;
                    return false;
                }

                this._setupBroadcastListener();
                this._setupStorageListener();
                this._setupCrossTabListener();
                this.startPolling();
                this._scheduleBackups();
                this.createBackup('latest');

                this._initialized = true;
                console.log('[TaskRepository] ✅ Initialization complete');
                return true;
            } catch (error) {
                console.error('[TaskRepository] Initialization failed:', error);
                this._initialized = false;
                return false;
            }
        })();

        return this._initPromise;
    }

    /**
     * Promise-returning readiness contract for page consumers.
     * Resolves when initialized healthy; rejects or returns ok: false if initialization failed.
     * @returns {Promise<Object>}
     */
    static async ready() {
        const ok = await this.init();
        if (!ok) {
            throw new Error(`[TaskRepository] Repository initialization failed for scope "${this._getUserPrefix()}". Recovery required.`);
        }
        return {
            ok: true,
            version: CURRENT_VERSION,
            scope: this._getUserPrefix(),
            userId: this._currentUserId
        };
    }

    // ========================================
    // ENVELOPE READ / WRITE / VALIDATION
    // ========================================

    /**
     * Read data in v5 format with strict validation.
     * Returns explicit typed outcomes: 'valid', 'missing', 'corrupt'.
     * NEVER overwrites corrupt data.
     * 
     * @param {string} scopedKey - Full scoped storage key
     * @returns {Object} { status: 'valid'|'missing'|'corrupt', data: Array, wrapper: Object|null, error?: string, raw?: string }
     */
    static _readV5(scopedKey) {
        const storage = this._getStorage();
        if (!storage) {
            return { status: ENVELOPE_STATUS.MISSING, data: [], wrapper: null, error: 'No storage backend' };
        }

        try {
            const raw = storage.getItem(scopedKey);
            if (raw === null || raw === undefined) {
                return { status: ENVELOPE_STATUS.MISSING, data: [], wrapper: null };
            }

            let wrapper;
            try {
                wrapper = JSON.parse(raw);
            } catch (jsonErr) {
                console.error(`[TaskRepository] Corrupted JSON at key "${scopedKey}":`, jsonErr.message);
                this._recordCorruptKey(scopedKey, 'JSON_PARSE_ERROR', raw);
                return { status: ENVELOPE_STATUS.CORRUPT, data: [], wrapper: null, error: jsonErr.message, raw };
            }

            // Verify wrapper is a plain object
            if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper)) {
                this._recordCorruptKey(scopedKey, 'INVALID_WRAPPER_STRUCTURE', raw);
                return { status: ENVELOPE_STATUS.CORRUPT, data: [], wrapper, error: 'Envelope must be an object', raw };
            }

            // Verify schema name
            if (wrapper.schema !== SCHEMA_NAME) {
                this._recordCorruptKey(scopedKey, 'UNKNOWN_SCHEMA', raw);
                return { status: ENVELOPE_STATUS.CORRUPT, data: [], wrapper, error: `Unknown schema: ${wrapper.schema}`, raw };
            }

            // Verify version
            if (wrapper.version !== CURRENT_VERSION) {
                this._recordCorruptKey(scopedKey, 'UNKNOWN_VERSION', raw);
                return { status: ENVELOPE_STATUS.CORRUPT, data: [], wrapper, error: `Unknown version: ${wrapper.version}`, raw };
            }

            // Verify data array
            if (!Array.isArray(wrapper.data)) {
                this._recordCorruptKey(scopedKey, 'DATA_NOT_ARRAY', raw);
                return { status: ENVELOPE_STATUS.CORRUPT, data: [], wrapper, error: 'Envelope data must be an array', raw };
            }

            // Verify checksum
            const computedChecksum = this._calculateChecksum(wrapper.data);
            if (!wrapper.checksum || wrapper.checksum !== computedChecksum) {
                console.error(`[TaskRepository] Checksum mismatch for "${scopedKey}". Expected ${computedChecksum}, got ${wrapper.checksum}`);
                this._recordCorruptKey(scopedKey, 'CHECKSUM_MISMATCH', raw);
                return { status: ENVELOPE_STATUS.CORRUPT, data: [], wrapper, error: 'Checksum mismatch', raw };
            }

            // Verify task identity: all tasks must have valid non-empty id
            for (let i = 0; i < wrapper.data.length; i++) {
                const item = wrapper.data[i];
                if (!item || typeof item !== 'object' || !item.id || String(item.id).trim() === '') {
                    this._recordCorruptKey(scopedKey, 'INVALID_TASK_IDENTITY', raw);
                    return { status: ENVELOPE_STATUS.CORRUPT, data: [], wrapper, error: `Invalid task at index ${i}: missing id`, raw };
                }
            }

            return { status: ENVELOPE_STATUS.VALID, data: wrapper.data, wrapper };

        } catch (e) {
            console.error(`[TaskRepository] Read exception for "${scopedKey}":`, e);
            return { status: ENVELOPE_STATUS.CORRUPT, data: [], wrapper: null, error: e.message };
        }
    }

    /**
     * Public envelope read inspector
     */
    static readEnvelope(scopedKey) {
        return this._readV5(scopedKey);
    }

    /**
     * Write data in canonical v5 format.
     * @param {string} scopedKey - Full scoped storage key
     * @param {Array} data - Task data array
     * @param {boolean} skipBackup - Skip automatic backup
     */
    static _writeV5(scopedKey, data, skipBackup = false) {
        const storage = this._getStorage();
        if (!storage) {
            throw new Error('No storage backend available');
        }

        // Before write: if existing envelope was corrupt, preserve corrupt source for recovery
        const existing = this._readV5(scopedKey);
        if (existing.status === ENVELOPE_STATUS.CORRUPT && existing.raw) {
            const preserveKey = this._getScopedKey(`corrupt_backup_${Date.now()}_${scopedKey.replace(/[^a-zA-Z0-9_.-]/g, '_')}`);
            try {
                storage.setItem(preserveKey, existing.raw);
                console.warn(`[TaskRepository] Preserved corrupt source at "${preserveKey}" before write.`);
            } catch {}
        }

        const normalizedData = Array.isArray(data)
            ? data.map(t => this._normalizeTask(t))
            : [];

        const wrapper = {
            version: CURRENT_VERSION,
            schema: SCHEMA_NAME,
            generatedAt: new Date().toISOString(),
            deviceId: this._getDeviceId(),
            checksum: this._calculateChecksum(normalizedData),
            data: normalizedData
        };

        try {
            this._setStorageItem(storage, scopedKey, JSON.stringify(wrapper));
            this._lastKnownVersions.set(scopedKey, wrapper.generatedAt);
            this._markMigrationDone();

            if (!skipBackup) {
                this.createBackup('latest');
            }
        } catch (e) {
            console.error(`[TaskRepository] Write failed for "${scopedKey}":`, e);
            throw e;
        }
    }

    /**
     * Record corrupted key to prevent accidental overwrites
     * @private
     */
    static _recordCorruptKey(key, reason, raw) {
        this._corruptedKeys.set(key, {
            reason,
            raw,
            recordedAt: new Date().toISOString()
        });
    }

    /**
     * Get details of any detected corrupt keys
     * @returns {Map<string, Object>}
     */
    static getCorruptedKeys() {
        return new Map(this._corruptedKeys);
    }

    // ========================================
    // CORE CRUD OPERATIONS
    // ========================================

    /**
     * Get all active tasks for a project.
     * AUTHORITATIVE CONTRACT:
     * - Valid v5 envelope (even with data: []) is strictly authoritative and returns []!
     * - Committed migration marker is strictly authoritative and returns []!
     * - Legacy fallback only happens if migration was never committed AND envelope is missing.
     * 
     * @param {string} projectId - Project identifier
     * @returns {Array} Array of active tasks
     */
    static getAllTasks(projectId) {
        if (!projectId) {
            console.error('[TaskRepository] getAllTasks: projectId required');
            return [];
        }

        const completionView = this._getCompletionView(projectId);
        if (completionView) {
            return completionView.active.filter(t => !t.completed && !t.deleted);
        }

        const scopedKey = this._getScopedKey(STORAGE_KEYS.TASKS_PREFIX + projectId);
        const envelope = this._readV5(scopedKey);

        // 1. Valid envelope: strictly authoritative
        if (envelope.status === ENVELOPE_STATUS.VALID) {
            if (!envelope.data || envelope.data.length === 0) {
                return [];
            }
            return envelope.data.filter(t => !t.completed && !t.deleted);
        }

        // 2. Corrupt envelope: controlled recovery, never overwrite or revive legacy
        if (envelope.status === ENVELOPE_STATUS.CORRUPT) {
            console.warn(`[TaskRepository] Corrupt envelope for "${projectId}". Recovery required.`);
            return [];
        }

        // 3. Missing envelope:
        // If migration has been committed for this scope, project is legitimately empty.
        if (this._isMigrationDone()) {
            return [];
        }

        // Only for un-migrated anonymous transitions: read legacy keys
        return this._readLegacyTasksFallback(projectId);
    }

    /**
     * Read legacy tasks fallback (only when migration was never committed)
     * @private
     */
    static _readLegacyTasksFallback(projectId) {
        const storage = this._getStorage();
        if (!storage) return [];

        const legacyKey = STORAGE_KEYS.LEGACY_TASKS_PREFIX + projectId;
        const legacyRaw = storage.getItem(legacyKey);

        if (legacyRaw) {
            try {
                const legacyData = JSON.parse(legacyRaw);
                if (Array.isArray(legacyData) && legacyData.length > 0) {
                    console.log(`[TaskRepository] Transition read from legacy for ${projectId}:`, legacyData.length, 'tasks');
                    return legacyData.filter(t => !t.completed && !t.deleted);
                }
            } catch {}
        }

        return [];
    }

    /**
     * Get all relaxed mode tasks
     * @returns {Array}
     */
    static getRelaxedTasks() {
        const completionView = this._getCompletionView('relaxed');
        if (completionView) {
            return completionView.active.filter(t => !t.completed && !t.deleted);
        }

        const scopedKey = this._getScopedKey(STORAGE_KEYS.RELAXED);
        const envelope = this._readV5(scopedKey);

        if (envelope.status === ENVELOPE_STATUS.VALID) {
            if (!envelope.data || envelope.data.length === 0) return [];
            return envelope.data.filter(t => !t.completed && !t.deleted);
        }

        if (envelope.status === ENVELOPE_STATUS.CORRUPT || this._isMigrationDone()) {
            return [];
        }

        // Legacy fallback
        const storage = this._getStorage();
        if (!storage) return [];
        const legacyRaw = storage.getItem(STORAGE_KEYS.LEGACY_RELAXED);
        if (legacyRaw) {
            try {
                const legacyData = JSON.parse(legacyRaw);
                if (Array.isArray(legacyData)) {
                    return legacyData.filter(t => !t.completed && !t.deleted);
                }
            } catch {}
        }

        return [];
    }

    /**
     * Get completed tasks for a project
     * @param {string} projectId - Project identifier
     * @returns {Array}
     */
    static getCompletedTasks(projectId) {
        if (!projectId) return [];

        const completionView = this._getCompletionView(projectId);
        if (completionView) return completionView.completed;

        const scopedKey = this._getScopedKey(STORAGE_KEYS.COMPLETED_PREFIX + projectId);
        const envelope = this._readV5(scopedKey);

        if (envelope.status === ENVELOPE_STATUS.VALID) {
            return envelope.data || [];
        }

        if (envelope.status === ENVELOPE_STATUS.CORRUPT || this._isMigrationDone()) {
            return [];
        }

        // Legacy fallback
        const storage = this._getStorage();
        if (!storage) return [];
        const legacyKey = STORAGE_KEYS.LEGACY_COMPLETED_PREFIX + projectId;
        const legacyRaw = storage.getItem(legacyKey);
        if (legacyRaw) {
            try {
                const legacyData = JSON.parse(legacyRaw);
                if (Array.isArray(legacyData)) return legacyData;
            } catch {}
        }

        return [];
    }

    /**
     * Get priority cache tasks
     * @returns {Array}
     */
    static getPriorityCache() {
        const scopedKey = this._getScopedKey(STORAGE_KEYS.PRIORITY_CACHE);
        const envelope = this._readV5(scopedKey);

        if (envelope.status === ENVELOPE_STATUS.VALID) {
            if (!envelope.data || envelope.data.length === 0) return [];
            return envelope.data.filter(t => !t.completed && !t.deleted);
        }

        if (envelope.status === ENVELOPE_STATUS.CORRUPT || this._isMigrationDone()) {
            return [];
        }

        // Legacy fallback
        const storage = this._getStorage();
        if (!storage) return [];
        const legacyRaw = storage.getItem(STORAGE_KEYS.LEGACY_PRIORITY);
        if (legacyRaw) {
            try {
                const legacyData = JSON.parse(legacyRaw);
                if (Array.isArray(legacyData)) {
                    return legacyData.filter(t => !t.completed && !t.deleted);
                }
            } catch {}
        }

        return [];
    }

    /**
     * Add a new task
     * @param {string} projectId - Project identifier
     * @param {Object} task - Task object
     * @returns {Object} Normalized added task
     */
    static addTask(projectId, task) {
        this._prepareProjectMutation(projectId);
        const normalizedTask = this._normalizeTask(task, projectId);
        let scopedKey;

        if (projectId === 'relaxed') {
            scopedKey = this._getScopedKey(STORAGE_KEYS.RELAXED);
            normalizedTask.type = 'relaxed';
        } else {
            scopedKey = this._getScopedKey(STORAGE_KEYS.TASKS_PREFIX + projectId);
            normalizedTask.type = 'academic';
            normalizedTask.projectId = projectId;
        }

        const envelope = this._readV5(scopedKey);
        const currentData = envelope.status === ENVELOPE_STATUS.VALID ? envelope.data : [];

        currentData.push(normalizedTask);
        this._writeV5(scopedKey, currentData);
        this._updatePriorityCache(projectId);
        this.broadcastChange('TASK_ADDED', { projectId, task: normalizedTask });

        return normalizedTask;
    }

    /**
     * Update an existing task
     * @param {string} projectId - Project identifier
     * @param {string} taskId - Task ID
     * @param {Object} updates - Updated fields
     * @returns {Object|null}
     */
    static updateTask(projectId, taskId, updates) {
        this._prepareProjectMutation(projectId);
        const normalizedId = String(taskId);
        const scopedKey = projectId === 'relaxed'
            ? this._getScopedKey(STORAGE_KEYS.RELAXED)
            : this._getScopedKey(STORAGE_KEYS.TASKS_PREFIX + projectId);

        const envelope = this._readV5(scopedKey);
        if (envelope.status !== ENVELOPE_STATUS.VALID) return null;

        const taskIndex = envelope.data.findIndex(t => String(t.id) === normalizedId);
        if (taskIndex === -1) return null;

        const updatedTask = {
            ...envelope.data[taskIndex],
            ...updates,
            id: normalizedId,
            updatedAt: new Date().toISOString()
        };

        envelope.data[taskIndex] = updatedTask;
        this._writeV5(scopedKey, envelope.data);
        this._updatePriorityCache(projectId);
        this.broadcastChange('TASK_UPDATED', { projectId, taskId: normalizedId, updates });

        return updatedTask;
    }

    /**
     * Complete a task
     * @param {string} projectId - Project identifier
     * @param {string} taskId - Task ID
     * @returns {Object|null}
     */
    static completeTask(projectId, taskId) {
        if (!projectId || taskId === undefined || taskId === null) return null;
        const normalizedId = String(taskId);
        const { tasksKey, completedKey } = this._getTaskStorageKeys(projectId);

        const existingTransaction = this._readCompletionTransaction(projectId);
        if (existingTransaction) {
            const existingTaskId = String(existingTransaction.completedTask.id);
            const rawActive = this._readV5(tasksKey);
            const activeStillContainsTask = rawActive.status === ENVELOPE_STATUS.VALID &&
                rawActive.data.some(task => String(task.id) === normalizedId);

            if (existingTransaction.phase === 'committed' &&
                existingTaskId === normalizedId && !activeStillContainsTask) {
                // A committed operation is its own idempotency record. Retrying
                // it returns the same history item without another observer event.
                return existingTransaction.completedTask;
            }

            if (existingTaskId !== normalizedId && existingTransaction.phase !== 'committed') {
                throw new Error(`Completion transition is pending for project ${projectId}`);
            }

            if (existingTaskId === normalizedId && !activeStillContainsTask) {
                let committed;
                try {
                    committed = this._advanceCompletionTransaction(existingTransaction);
                } catch (error) {
                    this._recordCompletionFailure(existingTransaction, error);
                    throw error;
                }
                if (committed.phase === 'committed') {
                    try {
                        this._updatePriorityCache(projectId);
                    } catch (error) {
                        console.warn('[TaskRepository] Priority cache update deferred after recovered completion:', error.message);
                    }
                    this.broadcastChange('TASK_COMPLETED', {
                        projectId,
                        taskId: normalizedId,
                        task: committed.completedTask,
                        operationId: committed.operationId,
                        recovered: true
                    });
                    return committed.completedTask;
                }
            } else {
                // An explicitly reopened task can start a new operation. The
                // old committed journal is no longer the active intent.
                this._clearCompletionTransaction(projectId);
            }
        }

        const envelope = this._readV5(tasksKey);
        if (envelope.status !== ENVELOPE_STATUS.VALID) return null;

        const taskIndex = envelope.data.findIndex(t => String(t.id) === normalizedId);
        if (taskIndex === -1) return null;

        const completedTask = {
            ...envelope.data[taskIndex],
            completed: true,
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const completedEnvelope = this._readV5(completedKey);
        const activeBefore = envelope.data.slice();
        const completedBefore = completedEnvelope.status === ENVELOPE_STATUS.VALID
            ? completedEnvelope.data.slice()
            : [];
        const completedAfter = [
            completedTask,
            ...completedBefore.filter(task => String(task.id) !== normalizedId)
        ];
        const transaction = {
            version: 1,
            schema: 'gpac_completion_tx_v1',
            operationId: `${this._getDeviceId()}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            projectId: String(projectId),
            phase: 'prepared',
            activeBefore,
            completedBefore,
            activeAfter: activeBefore.filter(task => String(task.id) !== normalizedId),
            completedAfter,
            completedTask,
            createdAt: new Date().toISOString(),
            lastError: null
        };

        // The journal is the first boundary. No task list is changed if it
        // cannot be persisted, and observers are notified only after commit.
        this._writeCompletionTransaction(transaction);
        let committedTransaction;
        try {
            committedTransaction = this._advanceCompletionTransaction(transaction);
        } catch (error) {
            this._recordCompletionFailure(transaction, error);
            throw error;
        }

        if (committedTransaction.phase !== 'committed') {
            throw new Error('Completion transition did not reach a committed state');
        }

        // The task/history envelope is authoritative. A stale priority cache
        // must not undo or duplicate an already committed completion.
        try {
            this._updatePriorityCache(projectId);
        } catch (error) {
            console.warn('[TaskRepository] Priority cache update deferred after completion:', error.message);
        }
        this.broadcastChange('TASK_COMPLETED', {
            projectId,
            taskId: normalizedId,
            task: completedTask,
            operationId: committedTransaction.operationId
        });

        return completedTask;
    }

    /**
     * Soft delete a task
     * @param {string} projectId - Project identifier
     * @param {string} taskId - Task ID
     * @returns {boolean}
     */
    static deleteTask(projectId, taskId) {
        this._prepareProjectMutation(projectId);
        const normalizedId = String(taskId);
        const scopedKey = projectId === 'relaxed'
            ? this._getScopedKey(STORAGE_KEYS.RELAXED)
            : this._getScopedKey(STORAGE_KEYS.TASKS_PREFIX + projectId);

        const envelope = this._readV5(scopedKey);
        if (envelope.status !== ENVELOPE_STATUS.VALID) return false;

        const taskIndex = envelope.data.findIndex(t => String(t.id) === normalizedId);
        if (taskIndex === -1) return false;

        envelope.data[taskIndex] = {
            ...envelope.data[taskIndex],
            deleted: true,
            updatedAt: new Date().toISOString()
        };

        this._writeV5(scopedKey, envelope.data);
        this._updatePriorityCache(projectId);
        this.broadcastChange('TASK_DELETED', { projectId, taskId: normalizedId });

        return true;
    }

    /**
     * Save priority cache
     * @param {Array} tasks - Task array
     */
    static savePriorityCache(tasks) {
        const scopedKey = this._getScopedKey(STORAGE_KEYS.PRIORITY_CACHE);
        this._writeV5(scopedKey, tasks, true);
        this.broadcastChange('PRIORITY_UPDATED', {});
    }

    /**
     * Bulk save tasks for a project
     * @param {string} projectId - Project identifier
     * @param {Array} tasks - Task array
     */
    static saveAllTasks(projectId, tasks) {
        this._prepareProjectMutation(projectId);
        const scopedKey = projectId === 'relaxed'
            ? this._getScopedKey(STORAGE_KEYS.RELAXED)
            : this._getScopedKey(STORAGE_KEYS.TASKS_PREFIX + projectId);

        this._writeV5(scopedKey, tasks);
        this._updatePriorityCache(projectId);
        this.broadcastChange('TASKS_REPLACED', { projectId });
    }

    // ========================================
    // BACKUPS & RECOVERY
    // ========================================

    /**
     * Create backup of task data in active scope
     * @param {string} slot - Slot name
     */
    static createBackup(slot = 'latest') {
        const storage = this._getStorage();
        if (!storage) return;

        const slotKey = this._getScopedKey(STORAGE_KEYS.BACKUP_PREFIX + slot);
        const prefix = this._getUserPrefix();

        const backup = {
            version: CURRENT_VERSION,
            schema: SCHEMA_NAME,
            createdAt: new Date().toISOString(),
            deviceId: this._getDeviceId(),
            scope: prefix,
            data: {
                tasks: {},
                relaxed: null,
                completed: {},
                priorityCache: null
            }
        };

        try {
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (!key || !key.startsWith(prefix)) continue;

                const unprefixed = key.slice(prefix.length);
                if (unprefixed.startsWith(STORAGE_KEYS.TASKS_PREFIX)) {
                    const projectId = unprefixed.replace(STORAGE_KEYS.TASKS_PREFIX, '');
                    backup.data.tasks[projectId] = this._readV5(key).data || [];
                } else if (unprefixed === STORAGE_KEYS.RELAXED) {
                    backup.data.relaxed = this._readV5(key).data || [];
                } else if (unprefixed.startsWith(STORAGE_KEYS.COMPLETED_PREFIX)) {
                    const projectId = unprefixed.replace(STORAGE_KEYS.COMPLETED_PREFIX, '');
                    backup.data.completed[projectId] = this._readV5(key).data || [];
                } else if (unprefixed === STORAGE_KEYS.PRIORITY_CACHE) {
                    backup.data.priorityCache = this._readV5(key).data || [];
                }
            }

            backup.checksum = this._calculateChecksum(backup.data);
            this._setStorageItem(storage, slotKey, JSON.stringify(backup));
        } catch (e) {
            console.error('[TaskRepository] Backup creation failed:', e);
        }
    }

    /**
     * Force recovery from backup slot
     * @param {string} slot - Slot name
     * @returns {boolean}
     */
    static forceRecoveryFromBackup(slot = 'latest') {
        const storage = this._getStorage();
        if (!storage) return false;

        const slotKey = this._getScopedKey(STORAGE_KEYS.BACKUP_PREFIX + slot);

        try {
            const raw = storage.getItem(slotKey);
            if (!raw) return false;

            const backup = JSON.parse(raw);
            const computedChecksum = this._calculateChecksum(backup.data);
            if (computedChecksum !== backup.checksum) {
                console.error('[TaskRepository] Backup checksum mismatch');
                return false;
            }

            for (const [projectId, tasks] of Object.entries(backup.data.tasks || {})) {
                this._writeV5(this._getScopedKey(STORAGE_KEYS.TASKS_PREFIX + projectId), tasks, true);
                try { this._clearCompletionTransaction(projectId); } catch {}
            }
            if (backup.data.relaxed) {
                this._writeV5(this._getScopedKey(STORAGE_KEYS.RELAXED), backup.data.relaxed, true);
                try { this._clearCompletionTransaction('relaxed'); } catch {}
            }
            for (const [projectId, tasks] of Object.entries(backup.data.completed || {})) {
                this._writeV5(this._getScopedKey(STORAGE_KEYS.COMPLETED_PREFIX + projectId), tasks, true);
                try { this._clearCompletionTransaction(projectId); } catch {}
            }
            if (backup.data.priorityCache) {
                this._writeV5(this._getScopedKey(STORAGE_KEYS.PRIORITY_CACHE), backup.data.priorityCache, true);
            }

            this.broadcastChange('RECOVERY_COMPLETE', { slot });
            return true;
        } catch (e) {
            console.error('[TaskRepository] Recovery failed:', e);
            return false;
        }
    }

    /**
     * List backups for current scope
     * @returns {Array}
     */
    static listBackups() {
        const storage = this._getStorage();
        if (!storage) return [];

        const backups = [];
        const slots = ['latest', '1h', '6h', '24h', 'manual'];

        for (const slot of slots) {
            const slotKey = this._getScopedKey(STORAGE_KEYS.BACKUP_PREFIX + slot);
            try {
                const raw = storage.getItem(slotKey);
                if (raw) {
                    const b = JSON.parse(raw);
                    backups.push({
                        slot,
                        createdAt: b.createdAt,
                        deviceId: b.deviceId,
                        taskCount: Object.values(b.data.tasks || {}).flat().length +
                            (b.data.relaxed?.length || 0)
                    });
                }
            } catch {}
        }

        return backups;
    }

    // ========================================
    // ONE-WAY IDEMPOTENT MIGRATION
    // ========================================

    /**
     * Migrate legacy data to canonical v5 format.
     * GUARANTEES:
     * - Idempotent: repeated runs are no-ops
     * - Never silently assigns legacy unowned data to arbitrary authenticated user
     * - Preserves source in backup if conversion succeeds; retains source if failed
     * 
     * @returns {Promise<Object>} Migration result
     */
    static async migrateOldData() {
        const storage = this._getStorage();
        if (!storage) return { success: false, migrated: 0 };

        // Idempotency check: if migration marker already committed for this scope, skip!
        if (this._isMigrationDone()) {
            return { success: true, migrated: 0, alreadyCommitted: true };
        }

        // Only anonymous scope migrates unowned legacy keys automatically
        // Authenticated scopes require explicit user import to prevent silent ownership theft
        if (this._currentUserId) {
            this._markMigrationDone();
            return { success: true, migrated: 0, authenticatedFreshStart: true };
        }

        const timestamp = Date.now();
        let migrated = 0;
        let failed = 0;

        try {
            const keysToMigrate = [];
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (!key || key.startsWith('gpac_')) continue;

                if (key.startsWith(STORAGE_KEYS.LEGACY_TASKS_PREFIX) && !key.includes('-version')) {
                    keysToMigrate.push({ key, type: 'tasks' });
                } else if (key === STORAGE_KEYS.LEGACY_RELAXED) {
                    keysToMigrate.push({ key, type: 'relaxed' });
                } else if (key.startsWith(STORAGE_KEYS.LEGACY_COMPLETED_PREFIX)) {
                    keysToMigrate.push({ key, type: 'completed' });
                } else if (key === STORAGE_KEYS.LEGACY_PRIORITY) {
                    keysToMigrate.push({ key, type: 'priority' });
                }
            }

            for (const { key, type } of keysToMigrate) {
                try {
                    const rawData = storage.getItem(key);
                    if (!rawData) continue;

                    const data = JSON.parse(rawData);
                    if (!Array.isArray(data)) continue;

                    const normalizedData = data.map(t => this._normalizeTask(t));

                    let newKey;
                    if (type === 'tasks') {
                        const projectId = key.replace(STORAGE_KEYS.LEGACY_TASKS_PREFIX, '');
                        newKey = this._getScopedKey(STORAGE_KEYS.TASKS_PREFIX + projectId);
                        normalizedData.forEach(t => t.projectId = projectId);
                    } else if (type === 'relaxed') {
                        newKey = this._getScopedKey(STORAGE_KEYS.RELAXED);
                        normalizedData.forEach(t => t.type = 'relaxed');
                    } else if (type === 'completed') {
                        const projectId = key.replace(STORAGE_KEYS.LEGACY_COMPLETED_PREFIX, '');
                        newKey = this._getScopedKey(STORAGE_KEYS.COMPLETED_PREFIX + projectId);
                    } else if (type === 'priority') {
                        newKey = this._getScopedKey(STORAGE_KEYS.PRIORITY_CACHE);
                    }

                    // Write to v5 format
                    this._writeV5(newKey, normalizedData, true);

                    // Move legacy key to backup
                    const backupKey = `gpac_legacy_bak_${timestamp}_${key}`;
                    storage.setItem(backupKey, rawData);
                    storage.removeItem(key);

                    // Clean version keys
                    const versionKey = key + '-version';
                    if (storage.getItem(versionKey)) {
                        storage.removeItem(versionKey);
                    }

                    migrated++;
                } catch (err) {
                    failed++;
                    console.warn(`[TaskRepository] Failed to migrate key "${key}". Retaining source.`, err);
                }
            }

            this._markMigrationDone();
            this.createBackup('manual');

            return { success: failed === 0, migrated, failed };
        } catch (e) {
            console.error('[TaskRepository] Migration process error:', e);
            return { success: false, migrated, failed: failed + 1, error: e };
        }
    }

    // ========================================
    // IMPORT / EXPORT
    // ========================================

    static exportData() {
        const storage = this._getStorage();
        if (!storage) return null;

        const prefix = this._getUserPrefix();
        const exportObj = {
            version: CURRENT_VERSION,
            schema: SCHEMA_NAME,
            exportedAt: new Date().toISOString(),
            deviceId: this._getDeviceId(),
            scope: prefix,
            data: {
                tasks: {},
                relaxed: [],
                completed: {},
                priorityCache: []
            }
        };

        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (!key || !key.startsWith(prefix)) continue;

            const unprefixed = key.slice(prefix.length);
            if (unprefixed.startsWith(STORAGE_KEYS.TASKS_PREFIX)) {
                const projectId = unprefixed.replace(STORAGE_KEYS.TASKS_PREFIX, '');
                exportObj.data.tasks[projectId] = this._readV5(key).data || [];
            } else if (unprefixed === STORAGE_KEYS.RELAXED) {
                exportObj.data.relaxed = this._readV5(key).data || [];
            } else if (unprefixed.startsWith(STORAGE_KEYS.COMPLETED_PREFIX)) {
                const projectId = unprefixed.replace(STORAGE_KEYS.COMPLETED_PREFIX, '');
                exportObj.data.completed[projectId] = this._readV5(key).data || [];
            } else if (unprefixed === STORAGE_KEYS.PRIORITY_CACHE) {
                exportObj.data.priorityCache = this._readV5(key).data || [];
            }
        }

        exportObj.checksum = this._calculateChecksum(exportObj.data);
        return exportObj;
    }

    static importData(json) {
        try {
            const importObj = typeof json === 'string' ? JSON.parse(json) : json;
            if (!importObj.data) throw new Error('Invalid import format');

            this.createBackup('manual');

            for (const [projectId, tasks] of Object.entries(importObj.data.tasks || {})) {
                this._writeV5(this._getScopedKey(STORAGE_KEYS.TASKS_PREFIX + projectId), tasks);
            }
            if (importObj.data.relaxed) {
                this._writeV5(this._getScopedKey(STORAGE_KEYS.RELAXED), importObj.data.relaxed);
            }
            for (const [projectId, tasks] of Object.entries(importObj.data.completed || {})) {
                this._writeV5(this._getScopedKey(STORAGE_KEYS.COMPLETED_PREFIX + projectId), tasks);
            }
            if (importObj.data.priorityCache) {
                this._writeV5(this._getScopedKey(STORAGE_KEYS.PRIORITY_CACHE), importObj.data.priorityCache);
            }

            this.broadcastChange('DATA_IMPORTED', {});
            return true;
        } catch (e) {
            console.error('[TaskRepository] Import failed:', e);
            return false;
        }
    }

    // ========================================
    // INTEGRITY & SYNC HELPERS
    // ========================================

    /**
     * Verify data integrity for active scope.
     * Returns false if any corruption is detected.
     */
    static async _verifyIntegrity() {
        const storage = this._getStorage();
        if (!storage) return false;

        let hasCorruption = false;
        const prefix = this._getUserPrefix();

        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (!key || !key.startsWith(prefix)) continue;

            const unprefixed = key.slice(prefix.length);
            if (
                unprefixed.startsWith(STORAGE_KEYS.TASKS_PREFIX) ||
                unprefixed === STORAGE_KEYS.RELAXED ||
                unprefixed.startsWith(STORAGE_KEYS.COMPLETED_PREFIX) ||
                unprefixed === STORAGE_KEYS.PRIORITY_CACHE
            ) {
                const envelope = this._readV5(key);
                if (envelope.status === ENVELOPE_STATUS.CORRUPT) {
                    hasCorruption = true;
                }
            }
        }

        if (hasCorruption) {
            console.warn('[TaskRepository] Corruption detected during integrity check.');
            return false;
        }

        return true;
    }

    static _calculateChecksum(data) {
        const str = JSON.stringify(data);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
    }

    static _normalizeTask(task, projectId = null) {
        const now = new Date().toISOString();

        return {
            id: String(task.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`),
            type: task.type || (projectId === 'relaxed' ? 'relaxed' : 'academic'),
            projectId: task.projectId || projectId || 'unknown',
            title: String(task.title || 'Untitled Task'),
            description: task.description || '',
            completed: Boolean(task.completed),
            completedAt: task.completedAt || null,
            deleted: Boolean(task.deleted),
            dueDate: task.dueDate || '',
            createdAt: task.createdAt || now,
            updatedAt: task.updatedAt || now,
            priority: task.priority || 'medium',
            section: task.section || task.category || 'General',
            category: task.category || task.section || '',
            attachments: Array.isArray(task.attachments) ? task.attachments : [],
            ...Object.fromEntries(
                Object.entries(task).filter(([k]) => ![
                    'id', 'type', 'projectId', 'title', 'description',
                    'completed', 'completedAt', 'deleted', 'dueDate',
                    'createdAt', 'updatedAt', 'priority', 'section',
                    'category', 'attachments'
                ].includes(k))
            )
        };
    }

    static _ensureDeviceId() {
        const storage = this._getStorage();
        if (!storage) return;

        if (!storage.getItem(STORAGE_KEYS.DEVICE_ID)) {
            const deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
            this._setStorageItem(storage, STORAGE_KEYS.DEVICE_ID, deviceId);
        }
    }

    static _getDeviceId() {
        const storage = this._getStorage();
        return storage ? (storage.getItem(STORAGE_KEYS.DEVICE_ID) || 'unknown') : 'unknown';
    }

    static _updatePriorityCache(projectId) {
        const cache = this.getPriorityCache();
        const filtered = cache.filter(t => t.projectId !== projectId);
        const activeTasks = projectId === 'relaxed'
            ? this.getRelaxedTasks()
            : this.getAllTasks(projectId);

        const updated = [...filtered, ...activeTasks];
        this._writeV5(this._getScopedKey(STORAGE_KEYS.PRIORITY_CACHE), updated, true);
    }

    static broadcastChange(changeType, data) {
        const sourceData = data && typeof data === 'object' && !Array.isArray(data)
            ? { ...data }
            : data;
        const projectId = sourceData?.projectId;
        let revision = null;
        if (projectId) {
            const requestedRevision = Number(sourceData?.revision);
            revision = Number.isFinite(requestedRevision) && requestedRevision >= 0
                ? requestedRevision
                : this._getProjectRevision(projectId) + 1;
            try {
                this._writeProjectRevision(projectId, revision);
            } catch (error) {
                console.warn('[TaskRepository] Project revision acknowledgement deferred:', error.message);
            }
            if (sourceData && typeof sourceData === 'object') {
                sourceData.revision = revision;
            }
        }

        const message = {
            type: 'GPAC_SYNC',
            event: changeType,
            version: CURRENT_VERSION,
            ts: Date.now(),
            deviceId: this._getDeviceId(),
            scope: this._getUserPrefix(),
            data: sourceData
        };
        this._lastLocalWriteAt = message.ts;

        if (broadcastChannel) {
            try {
                broadcastChannel.postMessage(message);
            } catch {}
        }

        const storage = this._getStorage();
        if (storage) {
            try {
                storage.setItem('gpac_last_change', JSON.stringify(message));
                storage.setItem(this._getScopedKey(STORAGE_KEYS.LAST_SYNC), String(Date.now()));
            } catch {}
        }

        this._notifyListeners(changeType, sourceData);
        return message;
    }

    static onRemoteChange(callback) {
        if (typeof callback !== 'function') return () => {};
        this._changeListeners.push(callback);
        return () => {
            const index = this._changeListeners.indexOf(callback);
            if (index > -1) this._changeListeners.splice(index, 1);
        };
    }

    static subscribe(callback) {
        return this.onRemoteChange(callback);
    }

    static startPolling() {
        if (this._pollInterval) return;
        this._pollInterval = setInterval(() => {
            this._checkForRemoteChanges();
        }, POLL_INTERVAL_MS);

        if (this._pollInterval && typeof this._pollInterval.unref === 'function') {
            this._pollInterval.unref();
        }
    }

    static stopPolling() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
    }

    static _setupBroadcastListener() {
        if (!broadcastChannel) return;
        if (this._broadcastMessageHandler) return;

        this._broadcastMessageHandler = (event) => {
            const msg = event.data;
            if (msg?.type !== 'GPAC_SYNC') return;
            if (msg.deviceId === this._getDeviceId()) return;
            if (msg.scope && msg.scope !== this._getUserPrefix()) return; // Tenancy boundary
            this._handleRemoteChange(msg);
        };
        broadcastChannel.onmessage = this._broadcastMessageHandler;
    }

    static _setupStorageListener() {
        if (this._storageListener) return;
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            this._storageListener = (event) => {
                if (event.key === 'gpac_last_change' && event.newValue) {
                    try {
                        const msg = JSON.parse(event.newValue);
                        if (msg.deviceId === this._getDeviceId()) return;
                        if (msg.scope && msg.scope !== this._getUserPrefix()) return;
                        this._handleRemoteChange(msg);
                    } catch {}
                }
            };
            window.addEventListener('storage', this._storageListener);
        }
    }

    static _setupCrossTabListener() {
        if (this._crossTabUnsubscribe || typeof window === 'undefined') return;
        const crossTab = window.crossTabSync;
        if (!crossTab || typeof crossTab.onUserAction !== 'function') return;

        this._crossTabUnsubscribe = crossTab.onUserAction('task-update', (data) => {
            this._handleRemoteChange({
                type: 'GPAC_SYNC',
                event: 'TASKS_INVALIDATED',
                version: CURRENT_VERSION,
                ts: Date.now(),
                deviceId: data?.deviceId || 'cross-tab',
                scope: this._getUserPrefix(),
                data: data || {}
            });
        });
    }

    static _handleRemoteChange(msg) {
        const now = Date.now();
        const sourceData = (msg && typeof msg.data === 'object' && msg.data !== null)
            ? msg.data
            : {};
        const projectId = sourceData.projectId || null;

        const incomingRevision = Number(sourceData.revision ?? msg?.revision);
        const localRevision = projectId ? this._getProjectRevision(projectId) : 0;
        const baseRevision = Number(sourceData.baseRevision ?? msg?.baseRevision);
        const hasExplicitConflict = Boolean(
            msg?.conflict === true ||
            sourceData.conflict === true ||
            msg?.event === 'CONFLICT' ||
            sourceData.event === 'CONFLICT'
        );
        const hasRevisionMismatch = projectId && (
            (Number.isFinite(baseRevision) && localRevision !== baseRevision) ||
            (Number.isFinite(incomingRevision) && localRevision > incomingRevision &&
                msg?.deviceId !== this._getDeviceId())
        );

        // A remote update carrying an older base/revision is a reconciliation
        // request. Do not read it into the task UI until the coordinator has
        // durably selected local, remote, or a merge.
        if (hasExplicitConflict || hasRevisionMismatch) {
            return this._showConflictModal({
                ...msg,
                data: {
                    ...sourceData,
                    projectId,
                    revision: Number.isFinite(incomingRevision) ? incomingRevision : sourceData.revision
                }
            });
        }

        let tasks = null;

        // Read the canonical snapshot and notify subscribers. Updating the
        // existing UI incrementally keeps an unsaved editor draft in place.
        try {
            if (projectId === 'relaxed') {
                tasks = this.getRelaxedTasks();
            } else if (projectId) {
                tasks = this.getAllTasks(projectId);
            }
        } catch (error) {
            console.warn('[TaskRepository] Failed to read remote task snapshot:', error);
        }

        const detail = {
            ...sourceData,
            projectId,
            tasks,
            event: msg?.event || 'REMOTE_CHANGE',
            version: msg?.version || CURRENT_VERSION,
            ts: msg?.ts || now,
            remote: true
        };

        if (msg?.event) {
            this._notifyListeners(msg.event, detail);
        }
        this._notifyListeners('TASKS_INVALIDATED', detail);

        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' &&
            typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gpac_tasks_invalidated', { detail }));
        }

        return detail;
    }

    static _showConflictModal(remoteChange) {
        const sourceData = remoteChange?.data && typeof remoteChange.data === 'object'
            ? remoteChange.data
            : {};
        const projectId = remoteChange?.projectId || sourceData.projectId ||
            remoteChange?.localSnapshot?.projectId || remoteChange?.remoteSnapshot?.projectId || null;
        const localData = remoteChange?.localSnapshot || sourceData.localSnapshot ||
            (projectId ? this._snapshotProject(projectId) : { projectId, revision: 0, active: [], completed: [] });
        const remoteData = remoteChange?.remoteSnapshot || sourceData.remoteSnapshot || {
            ...sourceData,
            projectId,
            revision: remoteChange?.revision ?? sourceData.revision,
            ts: remoteChange?.ts || Date.now(),
            source: remoteChange?.deviceId || 'remote'
        };

        return this.enqueueConflict(localData, remoteData, { projectId });
    }

    static _checkForRemoteChanges() {
        const storage = this._getStorage();
        if (!storage) return;

        try {
            const lastChange = storage.getItem('gpac_last_change');
            if (!lastChange) return;

            const msg = JSON.parse(lastChange);
            if (msg.deviceId === this._getDeviceId()) return;
            if (msg.scope && msg.scope !== this._getUserPrefix()) return;

            if (typeof sessionStorage !== 'undefined') {
                const lastProcessed = parseInt(sessionStorage.getItem('gpac_last_processed') || '0');
                if (msg.ts <= lastProcessed) return;
                sessionStorage.setItem('gpac_last_processed', String(msg.ts));
            }

            this._handleRemoteChange(msg);
        } catch {}
    }

    static _scheduleBackups() {
        if (this._backupInterval) return;
        this._backupInterval = setInterval(() => {
            this._rotateBackups();
        }, BACKUP_INTERVAL_MS);

        if (this._backupInterval && typeof this._backupInterval.unref === 'function') {
            this._backupInterval.unref();
        }

        if (this._backupVisibilityListener) return;
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            this._backupVisibilityListener = () => {
                if (document.visibilityState === 'visible') {
                    this.createBackup('latest');
                }
            };
            document.addEventListener('visibilitychange', this._backupVisibilityListener);
        }
    }

    static _teardownLifecycle() {
        this.stopPolling();

        if (this._backupInterval) {
            clearInterval(this._backupInterval);
            this._backupInterval = null;
        }

        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function' &&
            this._storageListener) {
            window.removeEventListener('storage', this._storageListener);
        }
        this._storageListener = null;

        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function' &&
            this._backupVisibilityListener) {
            document.removeEventListener('visibilitychange', this._backupVisibilityListener);
        }
        this._backupVisibilityListener = null;

        if (this._crossTabUnsubscribe) {
            try { this._crossTabUnsubscribe(); } catch {}
            this._crossTabUnsubscribe = null;
        }

        if (broadcastChannel && this._broadcastMessageHandler &&
            broadcastChannel.onmessage === this._broadcastMessageHandler) {
            broadcastChannel.onmessage = null;
        }
        this._broadcastMessageHandler = null;
    }

    static destroy() {
        this._teardownLifecycle();
        this._resetConflictCoordinator();
        this._initialized = false;
        this._initPromise = null;
        this._changeListeners = [];
        return true;
    }

    static handleRemoteChange(message) {
        return this._handleRemoteChange(message);
    }

    static _rotateBackups() {
        const storage = this._getStorage();
        if (!storage) return;

        const b6 = storage.getItem(this._getScopedKey(STORAGE_KEYS.BACKUP_PREFIX + '6h'));
        if (b6) storage.setItem(this._getScopedKey(STORAGE_KEYS.BACKUP_PREFIX + '24h'), b6);

        const b1 = storage.getItem(this._getScopedKey(STORAGE_KEYS.BACKUP_PREFIX + '1h'));
        if (b1) storage.setItem(this._getScopedKey(STORAGE_KEYS.BACKUP_PREFIX + '6h'), b1);

        const bl = storage.getItem(this._getScopedKey(STORAGE_KEYS.BACKUP_PREFIX + 'latest'));
        if (bl) storage.setItem(this._getScopedKey(STORAGE_KEYS.BACKUP_PREFIX + '1h'), bl);

        this.createBackup('latest');
    }

    static _notifyListeners(changeType, data) {
        for (const listener of [...this._changeListeners]) {
            try {
                listener(changeType, data);
            } catch (e) {
                console.error('[TaskRepository] Listener error:', e);
            }
        }
    }
}

// Export for ES modules
export default TaskRepository;
export { TaskRepository, STORAGE_KEYS, CURRENT_VERSION, SCHEMA_NAME };

// Expose globally for browser backward compatibility
if (typeof window !== 'undefined') {
    window.TaskRepository = TaskRepository;
}
