/**
 * Durable, user-scoped synchronization outbox.
 *
 * The outbox stores intent until an adapter acknowledges the mutation. It has
 * no background retry timer: callers explicitly flush it, so a failed promise
 * cannot be mistaken for a committed write and stale detached callbacks cannot
 * overwrite a newer intent.
 */

function clone(value) {
    if (value === undefined) return undefined;
    try {
        return structuredClone(value);
    } catch {
        return JSON.parse(JSON.stringify(value));
    }
}

function finiteRevision(value, fallback = 0) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function defaultStorage() {
    return {
        get(key, fallback) {
            try {
                const value = localStorage.getItem(key);
                return value === null ? fallback : JSON.parse(value);
            } catch {
                return fallback;
            }
        },
        set(key, value) {
            return localStorage.setItem(key, JSON.stringify(value));
        },
        remove(key) {
            return localStorage.removeItem(key);
        }
    };
}

function storageGet(storage, key, fallback) {
    if (storage && typeof storage.get === 'function') return storage.get(key, fallback);
    if (storage && typeof storage.getItem === 'function') {
        try {
            const value = storage.getItem(key);
            return value === null ? fallback : JSON.parse(value);
        } catch {
            return fallback;
        }
    }
    return fallback;
}

function storageSet(storage, key, value) {
    const result = storage && typeof storage.set === 'function'
        ? storage.set(key, value)
        : storage?.setItem?.(key, JSON.stringify(value));
    if (result === false || (result && typeof result === 'object' && result.success === false)) {
        throw result?.error || new Error(`Unable to persist outbox key ${key}`);
    }
    return result;
}

function storageRemove(storage, key) {
    if (typeof storage?.remove === 'function') return storage.remove(key);
    return storage?.removeItem?.(key);
}

function encodeScope(value) {
    return encodeURIComponent(String(value));
}

function taskId(task) {
    if (!task || task.id === undefined || task.id === null) return '';
    return String(task.id);
}

/**
 * Merge one local mutation with a transaction snapshot.
 *
 * Each task and tombstone carries a monotonic mutation revision. A newer local
 * task wins over an older server copy; a newer tombstone removes an older task.
 * A server task with a higher revision wins, which makes replay and transaction
 * retries deterministic. The returned task order is stable.
 */
export function mergeRevisionedTaskLists({
    serverTasks = [],
    serverTaskRevisions = {},
    serverTombstones = {},
    localTasks = [],
    localRevision = 0,
    localTombstones = {}
} = {}) {
    const tasksById = new Map();
    const revisions = {};
    const tombstones = {};

    for (const [id, revision] of Object.entries(serverTombstones || {})) {
        tombstones[String(id)] = finiteRevision(revision);
    }

    for (const task of Array.isArray(serverTasks) ? serverTasks : []) {
        const id = taskId(task);
        if (!id) continue;
        const revision = finiteRevision(serverTaskRevisions?.[id], 0);
        if (tombstones[id] >= revision) continue;
        tasksById.set(id, clone(task));
        revisions[id] = revision;
    }

    const localMutationRevision = finiteRevision(localRevision, 0);
    for (const task of Array.isArray(localTasks) ? localTasks : []) {
        const id = taskId(task);
        if (!id || task.deleted === true) continue;
        const remoteTombstone = finiteRevision(tombstones[id], -1);
        if (remoteTombstone >= localMutationRevision) continue;

        const serverRevision = finiteRevision(revisions[id], -1);
        if (!tasksById.has(id) || localMutationRevision >= serverRevision) {
            tasksById.set(id, clone(task));
            revisions[id] = localMutationRevision;
            if (remoteTombstone >= 0 && localMutationRevision > remoteTombstone) {
                delete tombstones[id];
            }
        }
    }

    for (const [rawId, rawRevision] of Object.entries(localTombstones || {})) {
        const id = String(rawId);
        const revision = finiteRevision(rawRevision, localMutationRevision);
        const existingRevision = finiteRevision(revisions[id], -1);
        tombstones[id] = Math.max(finiteRevision(tombstones[id], -1), revision);
        if (existingRevision <= tombstones[id]) {
            tasksById.delete(id);
            delete revisions[id];
        }
    }

    for (const id of Object.keys(tombstones)) {
        if (finiteRevision(revisions[id], -1) > tombstones[id]) delete tombstones[id];
    }

    return {
        tasks: Array.from(tasksById.values()),
        taskRevisions: revisions,
        tombstones
    };
}

/** Derive deletion tombstones from the last acknowledged and current lists. */
export function deriveTaskTombstones(baseTasks = [], currentTasks = [], revision = 0) {
    const currentIds = new Set((Array.isArray(currentTasks) ? currentTasks : []).map(taskId).filter(Boolean));
    const tombstones = {};
    for (const task of Array.isArray(baseTasks) ? baseTasks : []) {
        const id = taskId(task);
        if (id && !currentIds.has(id)) tombstones[id] = finiteRevision(revision);
    }
    for (const task of Array.isArray(currentTasks) ? currentTasks : []) {
        const id = taskId(task);
        if (id && task.deleted === true) tombstones[id] = finiteRevision(revision);
    }
    return tombstones;
}

/** Select only task records whose local value differs from the acknowledged base. */
export function selectChangedTaskMutations(baseTasks = [], currentTasks = []) {
    const baseById = new Map(
        (Array.isArray(baseTasks) ? baseTasks : [])
            .map(task => [taskId(task), task])
            .filter(([id]) => id)
    );
    const changed = [];
    for (const task of Array.isArray(currentTasks) ? currentTasks : []) {
        const id = taskId(task);
        if (!id) continue;
        const previous = baseById.get(id);
        if (!previous || JSON.stringify(previous) !== JSON.stringify(task) || task.deleted === true) {
            changed.push(clone(task));
        }
    }
    return changed;
}

export class SyncOutbox {
    constructor({ storage = null, namespace = 'gpace.sync.outbox' } = {}) {
        this.storage = storage || (typeof localStorage !== 'undefined' ? defaultStorage() : null);
        this.namespace = namespace;
        this._flushLocks = new Map();
    }

    _key(userId) {
        if (!userId) throw new Error('A user id is required for outbox scope');
        return `${this.namespace}.${encodeScope(userId)}`;
    }

    _read(userId) {
        if (!this.storage) return [];
        const entries = storageGet(this.storage, this._key(userId), []);
        return Array.isArray(entries) ? entries : [];
    }

    _write(userId, entries) {
        if (!this.storage) throw new Error('Outbox storage is unavailable');
        const clean = entries.map(entry => clone(entry));
        if (clean.length === 0) {
            storageRemove(this.storage, this._key(userId));
            return;
        }
        storageSet(this.storage, this._key(userId), clean);
    }

    list(userId, { projectId = null } = {}) {
        const entries = this._read(userId);
        return clone(projectId === null ? entries : entries.filter(entry => entry.projectId === projectId));
    }

    enqueue(entry) {
        const userId = String(entry?.userId || '');
        const projectId = String(entry?.projectId || '');
        const mutationId = String(entry?.mutationId || '');
        if (!userId || !projectId || !mutationId) {
            throw new TypeError('Outbox entries require userId, projectId, and mutationId');
        }

        const item = {
            ...clone(entry),
            userId,
            projectId,
            mutationId,
            revision: finiteRevision(entry.revision, Date.now()),
            status: 'pending',
            attempts: finiteRevision(entry.attempts, 0),
            enqueuedAt: finiteRevision(entry.enqueuedAt, Date.now()),
            lastError: null
        };

        const entries = this._read(userId).filter(existing => {
            if (existing.mutationId === mutationId) return false;
            // A newer intent for the same project supersedes an older pending
            // snapshot. Other projects remain independently durable.
            if (existing.projectId === projectId && finiteRevision(existing.revision) <= item.revision) return false;
            return true;
        });
        entries.push(item);
        entries.sort((left, right) => (
            String(left.projectId).localeCompare(String(right.projectId)) ||
            finiteRevision(left.revision) - finiteRevision(right.revision) ||
            finiteRevision(left.enqueuedAt) - finiteRevision(right.enqueuedAt)
        ));
        this._write(userId, entries);
        return clone(item);
    }

    acknowledge(userId, mutationId) {
        const entries = this._read(userId);
        const remaining = entries.filter(entry => entry.mutationId !== mutationId);
        this._write(userId, remaining);
        return entries.length !== remaining.length;
    }

    recordFailure(userId, mutationId, error) {
        const entries = this._read(userId);
        let updated = false;
        const next = entries.map(entry => {
            if (entry.mutationId !== mutationId) return entry;
            updated = true;
            return {
                ...entry,
                status: 'pending',
                attempts: finiteRevision(entry.attempts) + 1,
                lastError: String(error?.message || error || 'sync failed')
            };
        });
        this._write(userId, next);
        return updated;
    }

    cancel(userId, { projectId = null, beforeRevision = Infinity } = {}) {
        const entries = this._read(userId);
        const remaining = entries.filter(entry => {
            if (projectId !== null && entry.projectId !== projectId) return true;
            return finiteRevision(entry.revision) >= beforeRevision;
        });
        this._write(userId, remaining);
        return entries.length - remaining.length;
    }

    async flush(userId, handler, { projectId = null } = {}) {
        if (typeof handler !== 'function') throw new TypeError('An outbox flush handler is required');
        const scopeKey = `${userId}:${projectId ?? '*'}`;
        const previous = this._flushLocks.get(scopeKey) || Promise.resolve();
        const run = previous.then(async () => {
            const acknowledged = [];
            let lastResult = null;
            while (true) {
                const entries = this.list(userId, { projectId });
                const entry = entries[0];
                if (!entry) {
                    return lastResult
                        ? { ...lastResult, acknowledged }
                        : { status: 'idle', committed: true, acknowledged };
                }

                try {
                    const result = await handler(clone(entry));
                    if (result?.status === 'error' || result?.committed === false && result?.status !== 'committed') {
                        this.recordFailure(userId, entry.mutationId, result.error || result.message || 'sync rejected');
                        return { ...result, committed: false, acknowledged };
                    }
                    if (result?.status !== 'committed' && result?.committed !== true) {
                        this.recordFailure(userId, entry.mutationId, 'adapter did not acknowledge commit');
                        return { status: 'pending', committed: false, acknowledged };
                    }

                    this.acknowledge(userId, entry.mutationId);
                    acknowledged.push(entry.mutationId);
                    lastResult = result;
                } catch (error) {
                    this.recordFailure(userId, entry.mutationId, error);
                    return {
                        status: 'pending',
                        committed: false,
                        mutationId: entry.mutationId,
                        error,
                        acknowledged
                    };
                }
            }
        });
        this._flushLocks.set(scopeKey, run);
        try {
            return await run;
        } finally {
            if (this._flushLocks.get(scopeKey) === run) this._flushLocks.delete(scopeKey);
        }
    }
}

if (typeof window !== 'undefined') window.SyncOutbox = SyncOutbox;
