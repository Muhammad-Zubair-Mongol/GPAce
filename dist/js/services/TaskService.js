/**
 * TaskService.js
 * Centralized service for managing tasks, handling data consistency,
 * offline persistence, and real-time synchronization.
 */

import { storageService } from './StorageService.js';
import {
    saveTasksToFirestore,
    loadTasksFromFirestore,
    saveCompletedTaskToFirestore,
    waitForAuth
} from '../firestore.js';
import TaskRepository from '../core/TaskRepository.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { firebaseConfig } from '../firebaseConfig.js';

class TaskService {
    constructor({ repository = TaskRepository, storage = storageService } = {}) {
        this.repository = repository;
        this.storage = storage;
        this._repositoryReadyPromise = null;
        this.subscriptions = new Map(); // projectId -> unsubscribe()
        this.projectCache = new Map();  // projectId -> { tasks: [], timestamp: number }

        // Metrics for monitoring (Step 12 of fix plan)
        this.metrics = {
            operations: { create: 0, update: 0, delete: 0, complete: 0 },
            errors: { sync: 0, save: 0, load: 0 },
            lastError: null,
            sessionStart: Date.now(),
            firestoreReads: 0,
            firestoreWrites: 0
        };

        // The canonical repository owns local task durability. Firebase is
        // retained only for the legacy adapter path used by older callers.
        if (!this._usesCanonicalRepository()) this._initFirebase();

        // Run one-time cleanup of completed tasks from localStorage
        if (!this._usesCanonicalRepository()) this._cleanupCompletedTasks();

        // Register cleanup on page unload to prevent memory leaks
        this._registerCleanupHandlers();
    }

    /**
     * Register handlers to cleanup listeners on page navigation.
     * This prevents memory leaks from orphaned Firestore listeners.
     */
    _registerCleanupHandlers() {
        // Use both beforeunload and pagehide for maximum compatibility
        const cleanup = () => {
            console.log('[TaskService] Page unloading, cleaning up subscriptions...');
            this.unsubscribeAll();
        };

        // beforeunload fires on refresh/close
        window.addEventListener('beforeunload', cleanup);

        // pagehide fires on navigation (more reliable in some browsers)
        window.addEventListener('pagehide', cleanup);

        // Also cleanup on visibility hidden for mobile
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                // Don't fully unsubscribe on tab hide, just log
                console.log('[TaskService] Page hidden, subscriptions active:', this.subscriptions.size);
            }
        });
    }

    /**
     * Unsubscribe from all active project listeners.
     * Call this when navigating away or cleaning up.
     */
    unsubscribeAll() {
        const count = this.subscriptions.size;
        if (count === 0) return;

        console.log(`[TaskService] Unsubscribing from ${count} projects...`);

        for (const [projectId, unsubscribe] of this.subscriptions) {
            try {
                unsubscribe();
                console.log(`[TaskService] Unsubscribed from: ${projectId}`);
            } catch (e) {
                console.warn(`[TaskService] Error unsubscribing from ${projectId}:`, e);
            }
        }

        this.subscriptions.clear();
        console.log('[TaskService] All subscriptions cleared');
    }


    _initFirebase() {
        try {
            const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
            this.db = getFirestore(app);
            this.auth = getAuth(app);
        } catch (e) {
            console.error('[TaskService] Firebase init error:', e);
        }
    }

    /**
     * One-time cleanup: Remove completed tasks from localStorage.
     * This fixes legacy data where completed tasks were stored with completed: true
     * instead of being removed from the active list.
     */
    _cleanupCompletedTasks() {
        try {
            // Check if cleanup has already been done
            const cleanupDone = localStorage.getItem('taskService_cleanupDone_v1');
            if (cleanupDone) return;

            console.log('[TaskService] Running one-time completed tasks cleanup...');

            // Get all localStorage keys that are task lists
            const taskKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('tasks-') && !key.includes('-version') && !key.includes('-completed')) {
                    taskKeys.push(key);
                }
            }

            let totalCleaned = 0;
            taskKeys.forEach(key => {
                try {
                    const tasks = JSON.parse(localStorage.getItem(key) || '[]');
                    if (!Array.isArray(tasks)) return;

                    const activeTasks = tasks.filter(t => !t.completed);
                    const cleanedCount = tasks.length - activeTasks.length;

                    if (cleanedCount > 0) {
                        localStorage.setItem(key, JSON.stringify(activeTasks));
                        // Update version to trigger sync
                        localStorage.setItem(`${key}-version`, Date.now().toString());
                        console.log(`[TaskService] Cleaned ${cleanedCount} completed tasks from ${key}`);
                        totalCleaned += cleanedCount;
                    }
                } catch (e) {
                    console.warn(`[TaskService] Error cleaning ${key}:`, e);
                }
            });

            // Also clean calculatedPriorityTasks
            try {
                const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
                const activePriority = priorityTasks.filter(t => !t.completed);
                if (activePriority.length !== priorityTasks.length) {
                    localStorage.setItem('calculatedPriorityTasks', JSON.stringify(activePriority));
                    console.log(`[TaskService] Cleaned ${priorityTasks.length - activePriority.length} completed tasks from calculatedPriorityTasks`);
                    totalCleaned += priorityTasks.length - activePriority.length;
                }
            } catch (e) {
                console.warn('[TaskService] Error cleaning calculatedPriorityTasks:', e);
            }

            // Mark cleanup as done
            localStorage.setItem('taskService_cleanupDone_v1', 'true');
            console.log(`[TaskService] Cleanup complete. Removed ${totalCleaned} completed tasks total.`);
        } catch (error) {
            console.error('[TaskService] Cleanup error:', error);
        }
    }

    /**
     * Create a new task and save to both local and remote storage.
     * @param {string} projectId 
     * @param {Object} taskData - Partial task object
     * @returns {Promise<Object>} The created task object
     */
    async createTask(projectId, taskData) {
        const normalizedProjectId = this._requireIdentifier(projectId, 'Project ID');
        const newTask = this._buildCreationTask(normalizedProjectId, taskData);

        if (this._usesCanonicalRepository()) {
            await this._ensureRepositoryReady();
            const committed = await this.repository.addTask(normalizedProjectId, newTask);
            if (!committed || typeof committed !== 'object') {
                throw new Error('Task repository did not acknowledge creation');
            }
            this.projectCache.delete(normalizedProjectId);
            this.metrics.operations.create++;
            return { ...committed };
        }

        const currentTasks = await this._getLocalTasks(normalizedProjectId);
        const updatedTasks = [...currentTasks, newTask];
        await this._saveLocal(normalizedProjectId, updatedTasks);
        await this._saveRemote(normalizedProjectId, updatedTasks).catch(err => {
            console.warn('[TaskService] Remote save failed (offline?):', err);
        });
        this.metrics.operations.create++;
        this.metrics.firestoreWrites++;
        return newTask;
    }

    /**
     * Update an existing task.
     * @param {string} projectId 
     * @param {string} taskId 
     * @param {Object} updates - Fields to update
     * @returns {Promise<Object>} The updated task
     */
    async updateTask(projectId, taskId, updates) {
        const normalizedProjectId = this._requireIdentifier(projectId, 'Project ID');
        const normalizedId = this._requireIdentifier(taskId, 'Task ID');

        if (this._usesCanonicalRepository()) {
            await this._ensureRepositoryReady();
            const committed = await this.repository.updateTask(normalizedProjectId, normalizedId, this._sanitizeUpdates(updates));
            if (!committed) return null;
            this.projectCache.delete(normalizedProjectId);
            this.metrics.operations.update++;
            return { ...committed };
        }

        const tasks = await this._getLocalTasks(normalizedProjectId);
        const taskIndex = tasks.findIndex(t => String(t.id) === normalizedId);

        if (taskIndex === -1) {
            console.warn(`[TaskService] Task ${normalizedId} not found in project ${normalizedProjectId}`);
            return null;
        }

        const updatedTask = {
            ...tasks[taskIndex],
            ...this._sanitizeUpdates(updates),
            id: normalizedId,
            updatedAt: new Date().toISOString()
        };

        tasks[taskIndex] = updatedTask;

        // Save
        await this._saveLocal(normalizedProjectId, tasks);
        await this._saveRemote(normalizedProjectId, tasks).catch(console.warn);

        // Track metrics
        this.metrics.operations.update++;
        this.metrics.firestoreWrites++;

        return updatedTask;
    }

    /**
     * Delete a task.
     * @param {string} projectId 
     * @param {string} taskId 
     */
    /**
     * Delete a task (Soft Delete).
     * Marks task as deleted instead of removing it, preserving sync history.
     * @param {string} projectId 
     * @param {string} taskId 
     */
    async deleteTask(projectId, taskId) {
        const normalizedProjectId = this._requireIdentifier(projectId, 'Project ID');
        const normalizedId = this._requireIdentifier(taskId, 'Task ID');

        if (this._usesCanonicalRepository()) {
            await this._ensureRepositoryReady();
            const committed = await this.repository.deleteTask(normalizedProjectId, normalizedId);
            if (!committed) return false;
            this.projectCache.delete(normalizedProjectId);
            this.metrics.operations.delete++;
            return true;
        }

        const tasks = await this._getLocalTasks(normalizedProjectId);
        const taskIndex = tasks.findIndex(t => String(t.id) === normalizedId);

        if (taskIndex === -1) return false;

        // SOFT DELETE: Update flag and timestamp
        const updatedTask = {
            ...tasks[taskIndex],
            deleted: true,
            updatedAt: new Date().toISOString()
        };

        tasks[taskIndex] = updatedTask;

        await this._saveLocal(normalizedProjectId, tasks);
        // Attempt remote save, but _saveRemote usually just overwrites.
        // With merge logic on read, this is accepted.
        await this._saveRemote(normalizedProjectId, tasks).catch(console.warn);

        // Track metrics
        this.metrics.operations.delete++;
        this.metrics.firestoreWrites++;
        return true;
    }

    /**
     * Mark a task as complete and move to history.
     * @param {string} projectId 
     * @param {string} taskId 
     */
    async completeTask(projectId, taskId) {
        const normalizedProjectId = this._requireIdentifier(projectId, 'Project ID');
        const normalizedId = this._requireIdentifier(taskId, 'Task ID');

        if (this._usesCanonicalRepository()) {
            await this._ensureRepositoryReady();
            const committed = await this.repository.completeTask(normalizedProjectId, normalizedId);
            if (!committed) return null;
            this.projectCache.delete(normalizedProjectId);
            this.metrics.operations.complete++;
            return { ...committed };
        }

        const tasks = await this._getLocalTasks(normalizedProjectId);
        const task = tasks.find(t => String(t.id) === normalizedId);

        if (!task) return null;

        // 1. Remove from active list
        const remainingTasks = tasks.filter(t => String(t.id) !== normalizedId);
        console.log(`[TaskService] Completing task ${taskId}. Original: ${tasks.length}, Remaining: ${remainingTasks.length}`);

        // 2. Prepare completed instance
        const completedTask = {
            ...task,
            completed: true,
            completedAt: new Date().toISOString()
        };

        // 3. Save active list locally & remote
        await this._saveLocal(normalizedProjectId, remainingTasks);
        await this._saveRemote(normalizedProjectId, remainingTasks);

        // 4. Save to history (Remote & Local)
        try {
            await saveCompletedTaskToFirestore(normalizedProjectId, completedTask);
        } catch (e) {
            console.warn('[TaskService] Failed to save completion history:', e);
        }

        // 5. Remove from priority list (syncs calculatedPriorityTasks)
        this.removeTaskFromPriority(normalizedId);

        // Track metrics
        this.metrics.operations.complete++;
        this.metrics.firestoreWrites += 2; // Active list + completed history
        return completedTask;
    }

    /**
     * CENTRALIZED FILTER: Filter out completed tasks.
     * This is the SINGLE source of truth for task filtering.
     * All consumers receive only active (non-completed) tasks.
     * @param {Array} tasks - Raw tasks array
     * @returns {Array} Only active (non-completed) tasks
     */
    /**
     * CENTRALIZED FILTER: Filter out completed AND deleted tasks.
     * This is the SINGLE source of truth for task filtering.
     * All consumers receive only active (non-completed, non-deleted) tasks.
     * @param {Array} tasks - Raw tasks array
     * @returns {Array} Only active tasks
     */
    _filterActiveTasks(tasks) {
        if (!Array.isArray(tasks)) return [];
        // Filter out completed OR deleted
        const activeTasks = tasks.filter(task => !task.completed && !task.deleted);
        return activeTasks;
    }

    /**
     * Get tasks for a project. 
     * Tries Memory -> LocalStorage -> Remote.
     * IMPORTANT: Returns ONLY active (non-completed) tasks.
     * @param {string} projectId 
     * @returns {Promise<Array>} Active tasks only
     */
    /**
     * Get tasks for a project. 
     * Tries Memory -> LocalStorage -> Remote.
     * Merges remote data with local data to preserve offline changes.
     * @param {string} projectId 
     * @returns {Promise<Array>} Active tasks only
     */
    async getTasks(projectId) {
        const normalizedProjectId = this._requireIdentifier(projectId, 'Project ID');

        if (this._usesCanonicalRepository()) {
            await this._ensureRepositoryReady();
            const tasks = await this.repository.getAllTasks(normalizedProjectId);
            if (!Array.isArray(tasks)) throw new Error('Task repository returned invalid task data');
            const canonicalTasks = tasks.map(task => ({ ...task }));
            this._updateCache(normalizedProjectId, canonicalTasks);
            return this._filterActiveTasks(canonicalTasks);
        }

        // 1. Check Memory Cache
        if (this.projectCache.has(normalizedProjectId)) {
            return this._filterActiveTasks(this.projectCache.get(normalizedProjectId).tasks);
        }

        // 2. Check StorageService (Local)
        const localTasks = await this._getLocalTasks(normalizedProjectId);

        // Populate cache immediately with local data
        this._updateCache(normalizedProjectId, localTasks);

        // 3. Fetch Remote & Merge (Background-ish but awaited for first load consistency)
        try {
            const remoteTasks = await loadTasksFromFirestore(normalizedProjectId);
            if (remoteTasks && remoteTasks.length > 0) {
                // MERGE: Don't just overwrite, merge!
                const mergedTasks = this._mergeTasks(localTasks, remoteTasks);

                // If merged state is different or newer, update everything
                const mergedJson = JSON.stringify(mergedTasks);
                const localJson = JSON.stringify(localTasks);

                if (mergedJson !== localJson) {
                    console.log(`[TaskService] Merged remote data for ${projectId}. Local: ${localTasks.length}, Remote: ${remoteTasks.length}, Merged: ${mergedTasks.length}`);
                    this._updateCache(normalizedProjectId, mergedTasks);
                    this._saveLocal(normalizedProjectId, mergedTasks);

                    // If remote was missing updates, sync back
                    // (Simple check: if we have more/newer data than what we just got)
                    // We can't easily know EXACTLY without deep diff, but guarding against overwrites is key.
                    // For now, let's trust _saveLocal + the eventual background sync or next action to handle push.
                }

                return this._filterActiveTasks(mergedTasks);
            }
        } catch (e) {
            console.warn('[TaskService] Remote fetch failed:', e);
        }

        return this._filterActiveTasks(localTasks);
    }

    /**
     * Get ALL tasks including completed (for history views).
     * Use this ONLY when you need to see completed tasks.
     * @param {string} projectId 
     * @returns {Promise<Array>} All tasks including completed
     */
    async getAllTasksIncludingCompleted(projectId) {
        const normalizedProjectId = this._requireIdentifier(projectId, 'Project ID');
        if (this._usesCanonicalRepository()) {
            await this._ensureRepositoryReady();
            if (typeof this.repository.getCompletedTasks === 'function') {
                const active = await this.repository.getAllTasks(normalizedProjectId);
                const completed = await this.repository.getCompletedTasks(normalizedProjectId);
                return [...(Array.isArray(active) ? active : []), ...(Array.isArray(completed) ? completed : [])];
            }
            return await this.repository.getAllTasks(normalizedProjectId);
        }
        return await this._getLocalTasks(normalizedProjectId);
    }

    /**
     * Subscribe to real-time updates for a project.
     * @param {string} projectId 
     * @param {Function} onUpdate - Callback(tasks)
     * @returns {Function} unsubscribe
     */
    subscribeToProject(projectId, onUpdate) {
        const normalizedProjectId = this._requireIdentifier(projectId, 'Project ID');
        if (typeof onUpdate !== 'function') throw new Error('Task subscription callback is required');

        if (this._usesCanonicalRepository()) {
            this.unsubscribeFromProject(normalizedProjectId);
            let active = true;
            const notify = async () => {
                if (!active) return;
                try {
                    const tasks = await this.getTasks(normalizedProjectId);
                    if (active) onUpdate(tasks);
                } catch (error) {
                    this.metrics.errors.load++;
                    this.metrics.lastError = error;
                }
            };

            notify();
            const offRemote = typeof this.repository.onRemoteChange === 'function'
                ? this.repository.onRemoteChange((_type, data = {}) => {
                    if (data.projectId && String(data.projectId) !== normalizedProjectId) return;
                    notify();
                })
                : null;
            const unsubscribe = () => {
                active = false;
                offRemote?.();
                this.subscriptions.delete(normalizedProjectId);
            };
            this.subscriptions.set(normalizedProjectId, unsubscribe);
            return unsubscribe;
        }

        // Clear existing subscription for this project if any (to be safe)
        this.unsubscribeFromProject(normalizedProjectId);

        // 1. FAST: Serve local data immediately
        this._getLocalTasks(normalizedProjectId).then(localTasks => {
            if (localTasks.length > 0) {
                this._updateCache(normalizedProjectId, localTasks);
                onUpdate(this._filterActiveTasks(localTasks));
            }

            // 2. SLOW: Fetch Remote & Merge (via getTasks logic)
            // We call getTasks here which puts the merged result into cache and returns it
            return this.getTasks(normalizedProjectId);
        }).then(mergedTasks => {
            // Only update if different? onUpdate usually handles diffing or UI repaints cheaply
            // But getTasks already returns filtered active tasks
            onUpdate(mergedTasks);
        });

        if (!this.auth.currentUser) {
            return () => { };
        }

        try {
            const user = this.auth.currentUser;
            if (!user) return () => { };

             const taskRef = doc(this.db, 'users', user.uid, 'tasks', normalizedProjectId);

            const unsubscribe = onSnapshot(taskRef, (snapshot) => {
                if (snapshot.exists()) {
                    const data = snapshot.data();
                    const remoteTasks = data.tasks || [];

                    // Equality check to avoid unnecessary updates
                    const currentLocal = JSON.stringify(this.projectCache.get(projectId)?.tasks || []);
                    const newRemote = JSON.stringify(remoteTasks);

                    if (currentLocal !== newRemote) {
                        console.debug(`[TaskService] Remote update detected for ${projectId}`);

                        // MERGE STRATEGY: Combine Local and Remote based on timestamps
                        const localTasks = this.projectCache.get(projectId)?.tasks || [];
                        const mergedTasks = this._mergeTasks(localTasks, remoteTasks);

                        // Check if merge resulted in changes
                        const mergedJson = JSON.stringify(mergedTasks);
                        // We check against both because currentLocal might be stale if we just merged
                        if (mergedJson !== currentLocal) {
                            console.log(`[TaskService] Applying merged update for ${projectId}`);
                            this._updateCache(projectId, mergedTasks);
                            this._saveLocal(projectId, mergedTasks);

                            onUpdate(this._filterActiveTasks(mergedTasks));
                        }
                    } else {
                        // Data identical, just update version timestamp silently
                        if (data.version) {
                            const versionKey = `tasks-${projectId}-version`;
                            storageService.set(versionKey, data.version);
                        }
                    }
                }
            }, (error) => {
                console.error('[TaskService] Real-time error:', error);
            });

            this.subscriptions.set(normalizedProjectId, unsubscribe);
            return () => this.unsubscribeFromProject(normalizedProjectId);

        } catch (e) {
            console.error('[TaskService] Subscribe failed:', e);
            return () => { };
        }
    }

    unsubscribeFromProject(projectId) {
        if (this.subscriptions.has(projectId)) {
            const unsub = this.subscriptions.get(projectId);
            unsub();
            this.subscriptions.delete(projectId);
        }
    }

    // =========================================
    // Private Helpers
    // =========================================

    _usesCanonicalRepository() {
        return Boolean(this.repository && (
            typeof this.repository.getAllTasks === 'function' ||
            typeof this.repository.addTask === 'function'
        ));
    }

    _requireIdentifier(value, label) {
        if (typeof value !== 'string' && typeof value !== 'number') {
            throw new TypeError(`${label} must be a non-empty string or number`);
        }
        const normalized = String(value).trim();
        if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
            throw new TypeError(`${label} is malformed`);
        }
        return normalized;
    }

    _buildCreationTask(projectId, taskData = {}) {
        if (!taskData || typeof taskData !== 'object' || Array.isArray(taskData)) {
            throw new TypeError('Task data must be an object');
        }

        const forbidden = ['deleted', 'updatedAt', 'createdAt', 'version', 'revision', 'type'];
        const forbiddenOverride = forbidden.find(field => Object.prototype.hasOwnProperty.call(taskData, field));
        if (forbiddenOverride) throw new TypeError(`${forbiddenOverride} is assigned by the repository`);
        if (Object.prototype.hasOwnProperty.call(taskData, 'completed') && taskData.completed !== false) {
            throw new TypeError('completed is assigned by the repository');
        }

        const allowed = new Set([
            'id', 'title', 'description', 'dueDate', 'priority', 'section',
            'projectName', 'links', 'subtasks', 'attachments', 'lastInterleaved'
        ]);
        const supplied = Object.keys(taskData).filter(key => allowed.has(key));
        const fields = {};
        supplied.forEach(key => { fields[key] = taskData[key]; });

        const id = Object.prototype.hasOwnProperty.call(fields, 'id')
            ? this._requireIdentifier(fields.id, 'Task ID')
            : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const now = new Date().toISOString();
        const title = fields.title === undefined || fields.title === null || fields.title === ''
            ? 'Untitled Task'
            : String(fields.title);

        return {
            ...fields,
            id,
            projectId,
            title,
            description: fields.description === undefined ? '' : String(fields.description),
            dueDate: fields.dueDate === undefined ? '' : fields.dueDate,
            priority: fields.priority || 'medium',
            section: fields.section || 'General',
            completed: false,
            deleted: false,
            createdAt: now,
            updatedAt: now,
            revision: 0
        };
    }

    _sanitizeUpdates(updates = {}) {
        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
            throw new TypeError('Task updates must be an object');
        }
        const allowed = new Set(['title', 'description', 'dueDate', 'priority', 'section', 'projectName', 'links', 'subtasks', 'attachments', 'lastInterleaved', 'reopen', 'reopenedAt']);
        const sanitized = {};
        for (const [key, value] of Object.entries(updates)) {
            if (key === 'id' || key === 'projectId' || key === 'createdAt' || key === 'version' || key === 'revision') {
                throw new TypeError(`${key} cannot be changed through task updates`);
            }
            if (key === 'completed' || key === 'deleted') {
                throw new TypeError(`${key} must use its dedicated repository operation`);
            }
            if (allowed.has(key)) sanitized[key] = value;
        }
        return sanitized;
    }

    async _ensureRepositoryReady() {
        if (!this._usesCanonicalRepository() || typeof this.repository.ready !== 'function') return true;
        if (!this._repositoryReadyPromise) {
            this._repositoryReadyPromise = Promise.resolve()
                .then(() => this.repository.ready())
                .then(result => {
                    if (result === false || result?.ok === false) throw new Error('Task repository is not ready');
                    return result;
                });
        }
        return this._repositoryReadyPromise;
    }

    async _getLocalTasks(projectId) {
        const key = `tasks-${projectId}`;
        return this.storage.get(key, []);
    }

    async _saveLocal(projectId, tasks) {
        const key = `tasks-${projectId}`;
        const timestamp = Date.now();

        const previousTasks = this.storage.get(key, []);
        const previousVersion = this.storage.get(`${key}-version`, null);
        try {
            this._assertStorageWrite(this.storage.set(key, tasks), key);
            this._assertStorageWrite(this.storage.set(`${key}-version`, timestamp), `${key}-version`);
        } catch (error) {
            try { this._assertStorageWrite(this.storage.set(key, previousTasks), key); } catch {}
            if (previousVersion === null || previousVersion === undefined) {
                try { this.storage.remove?.(`${key}-version`); } catch {}
            } else {
                try { this._assertStorageWrite(this.storage.set(`${key}-version`, previousVersion), `${key}-version`); } catch {}
            }
            throw error;
        }

        this._updateCache(projectId, tasks.map(task => ({ ...task })));

        // CRITICAL: Also sync calculatedPriorityTasks so grind.html stays in sync
        this._syncCalculatedPriorityTasks(projectId, tasks);
    }

    _assertStorageWrite(outcome, key) {
        if (outcome === false || (outcome && typeof outcome === 'object' && outcome.success === false)) {
            throw outcome?.error || new Error(`Unable to persist ${key}`);
        }
        return outcome;
    }

    /**
     * Sync calculatedPriorityTasks with current project tasks.
     * This ensures grind.html/priority-list.html show the same data as extracted.html.
     * FIXED: Uses String() for ID comparisons and filters deleted tasks.
     */
    _syncCalculatedPriorityTasks(projectId, tasks) {
        try {
            const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');

            // Get IDs of current ACTIVE tasks for this project (normalized as strings)
            const activeTasks = tasks.filter(t => !t.completed && !t.deleted);
            const currentTaskIds = new Set(activeTasks.map(t => String(t.id)));

            // Remove tasks from calculatedPriorityTasks that are:
            // 1. From this project but no longer in active tasks
            // 2. Marked as completed or deleted
            let updated = priorityTasks.filter(pt => {
                const ptId = String(pt.id);

                // If from this project, must still exist in active tasks
                if (pt.projectId === projectId) {
                    return currentTaskIds.has(ptId) && !pt.completed && !pt.deleted;
                }

                // Keep tasks from other projects (but still filter completed/deleted)
                return !pt.completed && !pt.deleted;
            });

            // Add new tasks from this project that aren't in calculatedPriorityTasks
            const existingIds = new Set(updated.map(t => String(t.id)));
            const newTasks = activeTasks.filter(t => !existingIds.has(String(t.id)));

            // Add projectId to new tasks if not present
            newTasks.forEach(t => {
                if (!t.projectId) t.projectId = projectId;
            });

            updated = [...updated, ...newTasks];

            localStorage.setItem('calculatedPriorityTasks', JSON.stringify(updated));

            // Dispatch event for cross-tab sync
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'calculatedPriorityTasks',
                newValue: JSON.stringify(updated),
                url: window.location.href
            }));

            console.log(`[TaskService] Synced calculatedPriorityTasks: ${updated.length} total (${newTasks.length} new from ${projectId})`);
        } catch (e) {
            console.warn('[TaskService] Error syncing calculatedPriorityTasks:', e);
        }
    }

    // =========================================
    // Priority Task Mediator Methods
    // All external writes to calculatedPriorityTasks should go through these
    // =========================================

    /**
     * Get priority tasks (read-only).
     * @returns {Array} Current priority tasks
     */
    getPriorityTasks() {
        if (this._usesCanonicalRepository()) {
            const reader = this.repository.getPriorityTasks || this.repository.getPriorityCache || this.repository.getAllPriorityTasks;
            if (typeof reader !== 'function') return [];
            const result = reader.call(this.repository);
            if (result && typeof result.then === 'function') return result;
            return Array.isArray(result) ? result.map(task => ({ ...task })) : [];
        }
        try {
            const value = this.storage?.get
                ? this.storage.get('calculatedPriorityTasks', [])
                : JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
            return Array.isArray(value) ? value : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * Reorder priority tasks (for sorting).
     * @param {Array} sortedTasks - Tasks in new order
     */
    reorderPriorityTasks(sortedTasks) {
        if (!Array.isArray(sortedTasks)) return;

        this._savePriorityTasks(sortedTasks, 'reorder');
        console.log(`[TaskService] Reordered ${sortedTasks.length} priority tasks`);
    }

    /**
     * Skip a task (move to end of list).
     * @param {string} taskId - Task to skip
     */
    skipTask(taskId) {
        const tasks = this.getPriorityTasks();
        const normalizedId = String(taskId);
        const taskIndex = tasks.findIndex(t => String(t.id) === normalizedId);

        if (taskIndex === -1 || tasks.length <= 1) return;

        // Move task to end
        const [task] = tasks.splice(taskIndex, 1);
        tasks.push(task);

        this._savePriorityTasks(tasks, 'skip');
        console.log(`[TaskService] Skipped task ${taskId}`);
    }

    /**
     * Update a specific task in priority list (for links, etc).
     * @param {string} taskId - Task to update
     * @param {Object} updates - Fields to update
     */
    updateTaskInPriority(taskId, updates) {
        const tasks = this.getPriorityTasks();
        const normalizedId = String(taskId);
        const taskIndex = tasks.findIndex(t => String(t.id) === normalizedId);

        if (taskIndex === -1) return false;

        tasks[taskIndex] = { ...tasks[taskIndex], ...updates };

        this._savePriorityTasks(tasks, 'update');
        console.log(`[TaskService] Updated task ${taskId} in priority list`);
        return true;
    }

    /**
     * Add a new task to priority list.
     * @param {Object} task - Task to add
     */
    addTaskToPriority(task) {
        if (!task || !task.id) return;

        const tasks = this.getPriorityTasks();
        const normalizedId = String(task.id);

        // Check if already exists
        if (tasks.some(t => String(t.id) === normalizedId)) {
            console.log(`[TaskService] Task ${task.id} already in priority list`);
            return;
        }

        tasks.push(task);

        this._savePriorityTasks(tasks, 'add');
        console.log(`[TaskService] Added task ${task.id} to priority list`);
    }

    /**
     * Remove a task from priority list.
     * @param {string} taskId - Task ID to remove
     */
    removeTaskFromPriority(taskId) {
        const tasks = this.getPriorityTasks();
        const normalizedId = String(taskId);
        const filtered = tasks.filter(t => String(t.id) !== normalizedId);

        if (filtered.length === tasks.length) return; // Not found

        this._savePriorityTasks(filtered, 'remove');
        console.log(`[TaskService] Removed task ${taskId} from priority list`);
    }

    /**
     * Internal: Save priority tasks with versioning and cross-tab sync.
     * @param {Array} tasks - Tasks to save
     * @param {string} operation - Operation name for logging
     */
    _savePriorityTasks(tasks, operation) {
        if (this._usesCanonicalRepository() && typeof this.repository.savePriorityCache === 'function') {
            const result = this.repository.savePriorityCache(tasks);
            this.metrics.operations[operation] = (this.metrics.operations[operation] || 0) + 1;
            return result;
        }
        const version = Date.now();

        this.storage.set('calculatedPriorityTasks', tasks);
        this.storage.set('calculatedPriorityTasks-version', String(version));

        // Dispatch event for cross-tab sync
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof StorageEvent !== 'undefined') {
            window.dispatchEvent(new StorageEvent('storage', {
            key: 'calculatedPriorityTasks',
            newValue: JSON.stringify(tasks),
            url: window.location.href
            }));
        }

        // Track in metrics
        this.metrics.operations[operation] = (this.metrics.operations[operation] || 0) + 1;
    }

    async _saveRemote(projectId, tasks) {
        await saveTasksToFirestore(projectId, tasks);
    }

    /**
     * Compare Firestore version vs Local version
     * SMART LOGIC: Use newest by timestamp, but also check task count to prevent data loss
     * @param {Object} firestoreData - Data from Firestore snapshot
     * @param {string} projectId - Project identifier
     * @returns {boolean} True if should update from Firestore
     */
    _compareVersions(firestoreData, projectId) {
        try {
            const key = `tasks-${projectId}-version`;
            const localVersion = parseInt(storageService.get(key, 0));
            const firestoreVersion = firestoreData.version || 0;

            // Get task counts for smart comparison
            const localTasks = storageService.get(`tasks-${projectId}`, []);
            const remoteTasks = firestoreData.tasks || [];
            const localCount = localTasks.length;
            const remoteCount = remoteTasks.length;

            console.log(`[TaskService] Version comparison for ${projectId}:`);
            console.log(`  Firestore: v${firestoreVersion}, ${remoteCount} tasks`);
            console.log(`  Local: v${localVersion}, ${localCount} tasks`);

            // DEFENSIVE: If local has tasks but Firestore is empty, keep local
            // This prevents data loss from Firestore sync failures
            if (localCount > 0 && remoteCount === 0) {
                console.log(`  Decision: Keep Local (Firestore empty, local has ${localCount} tasks)`);
                // Push local to Firestore to fix the sync
                this._saveRemote(projectId, localTasks).catch(e =>
                    console.warn('[TaskService] Failed to push local to Firestore:', e)
                );
                return false;
            }

            // Check if this is a new device session (no local version)
            const isNewDevice = localVersion === 0;

            if (isNewDevice) {
                console.log(`  Decision: Use Firestore (new device session)`);
                return true;
            }

            // If versions are close (within 5 seconds) but local has more tasks, prefer local
            const versionDiff = Math.abs(firestoreVersion - localVersion);
            if (versionDiff < 5000 && localCount > remoteCount) {
                console.log(`  Decision: Keep Local (more tasks, versions close)`);
                return false;
            }

            // Use Firestore if it's strictly newer
            if (firestoreVersion > localVersion) {
                console.log(`  Decision: Use Firestore (newer version)`);
                return true;
            }

            // Local is newer or equal, keep it
            console.log(`  Decision: Keep Local (local is newer or equal)`);
            return false;

        } catch (error) {
            console.warn('[TaskService] Version comparison error:', error);
            // On error, prefer to keep local data (safer)
            return false;
        }
    }

    _updateCache(projectId, tasks) {
        this.projectCache.set(projectId, {
            tasks: tasks,
            timestamp: Date.now()
        });
    }

    /**
     * Get cached tasks for a project (used by firestore.js).
     * Returns ONLY active (non-completed) tasks.
     * @param {string} projectId 
     * @returns {Array|null} Cached active tasks or null if not cached
     */
    getCachedTasks(projectId) {
        if (this.projectCache.has(projectId)) {
            return this._filterActiveTasks(this.projectCache.get(projectId).tasks);
        }
        return null;
    }

    /**
     * Merge two task lists based on ID and updatedAt timestamp.
     * FIXED: Uses String(id) for consistent comparison to prevent duplicates.
     * CRITICAL FIX: Respects deleted/completed flags - never resurrects deleted tasks.
     * @param {Array} localTasks 
     * @param {Array} remoteTasks 
     * @returns {Array} Merged task list
     */
    _mergeTasks(localTasks, remoteTasks) {
        const taskMap = new Map();

        const normalizeId = (id) => {
            if (id === null || id === undefined) return '';
            const normalized = String(id).trim();
            return normalized && normalized.length <= 256 && !/[\u0000-\u001f\u007f]/.test(normalized)
                ? normalized
                : '';
        };
        const timestamp = task => {
            const value = new Date(task?.updatedAt || task?.createdAt || 0).getTime();
            return Number.isFinite(value) ? value : 0;
        };
        const revision = task => Number.isFinite(Number(task?.revision)) ? Number(task.revision) : 0;
        const newer = (left, right) => revision(left) > revision(right)
            || revision(left) === revision(right) && timestamp(left) > timestamp(right);
        const explicitReopen = task => task?.reopen === true
            || task?.reopened === true
            || Boolean(task?.reopenedAt)
            || task?.intent === 'reopen'
            || task?.mutationType === 'reopen';

        for (const task of Array.isArray(localTasks) ? localTasks : []) {
            const id = normalizeId(task?.id);
            if (id) taskMap.set(id, { ...task, id });
        }

        for (const candidate of Array.isArray(remoteTasks) ? remoteTasks : []) {
            const id = normalizeId(candidate?.id);
            if (!id) continue;
            const remoteTask = { ...candidate, id };
            const localTask = taskMap.get(id);
            if (!localTask) {
                if (!remoteTask.deleted && !remoteTask.completed) taskMap.set(id, remoteTask);
                continue;
            }

            const localTerminal = localTask.deleted === true || localTask.completed === true;
            if (localTerminal) {
                const newerRemote = newer(remoteTask, localTask) || timestamp(remoteTask) > timestamp(localTask);
                if (newerRemote && explicitReopen(remoteTask) && !remoteTask.deleted && !remoteTask.completed) {
                    taskMap.set(id, { ...remoteTask, deleted: false, completed: false });
                }
                // A stale pending copy, or a newer copy without an explicit
                // reopen intent, cannot revive a terminal local record.
                continue;
            }

            if (newer(remoteTask, localTask) || timestamp(remoteTask) > timestamp(localTask)) {
                taskMap.set(id, remoteTask);
            }
        }

        // Log merge statistics for debugging
        const finalTasks = Array.from(taskMap.values());
        const activeCount = finalTasks.filter(t => !t.deleted && !t.completed).length;
        const deletedCount = finalTasks.filter(t => t.deleted).length;
        const completedCount = finalTasks.filter(t => t.completed).length;
        console.log(`[TaskService] Merge complete: ${finalTasks.length} total (${activeCount} active, ${deletedCount} deleted, ${completedCount} completed)`);

        return finalTasks;
    }

    /**
     * Get metrics for monitoring and debugging.
     * @returns {Object} Current session metrics
     */
    getMetrics() {
        const sessionDuration = (Date.now() - this.metrics.sessionStart) / 1000;
        return {
            ...this.metrics,
            sessionDurationSeconds: Math.round(sessionDuration),
            activeSubscriptions: this.subscriptions.size,
            cachedProjects: this.projectCache.size,
            operationsPerMinute: sessionDuration > 60
                ? Math.round(Object.values(this.metrics.operations).reduce((a, b) => a + b, 0) / (sessionDuration / 60))
                : 'N/A (session < 1min)'
        };
    }

    /**
     * Log an error for monitoring.
     * @param {string} category - Error category (sync, save, load)
     * @param {Error} error - The error object
     */
    _logError(category, error) {
        this.metrics.errors[category] = (this.metrics.errors[category] || 0) + 1;
        this.metrics.lastError = {
            category,
            message: error.message,
            timestamp: new Date().toISOString()
        };
        console.error(`[TaskService] ${category} error:`, error);
    }

    // =========================================
    // Manual Sync Failsafe Methods
    // =========================================

    /**
     * Force push local state to Firestore for all cached projects.
     * Use this when you suspect Firestore has stale data.
     * @returns {Promise<Object>} Results of sync operation
     */
    async forceSync() {
        console.log('[TaskService] Starting force sync - pushing local to Firestore...');
        const results = { success: [], failed: [], totalPushed: 0 };

        // Get all task keys from localStorage
        const taskKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('tasks-') && !key.includes('-version') && !key.includes('-completed')) {
                taskKeys.push(key);
            }
        }

        for (const key of taskKeys) {
            const projectId = key.replace('tasks-', '');
            try {
                const tasks = JSON.parse(localStorage.getItem(key) || '[]');
                // Filter to only active tasks for Firestore
                const activeTasks = tasks.filter(t => !t.completed && !t.deleted);

                await saveTasksToFirestore(projectId, activeTasks);
                results.success.push(projectId);
                results.totalPushed += activeTasks.length;
                console.log(`[TaskService] Force synced ${projectId}: ${activeTasks.length} active tasks`);
            } catch (err) {
                results.failed.push({ projectId, error: err.message });
                console.error(`[TaskService] Force sync failed for ${projectId}:`, err);
            }
        }

        // Also sync calculatedPriorityTasks
        try {
            const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
            const activePriority = priorityTasks.filter(t => !t.completed && !t.deleted);
            localStorage.setItem('calculatedPriorityTasks', JSON.stringify(activePriority));
            console.log(`[TaskService] Cleaned priority tasks: ${priorityTasks.length} → ${activePriority.length}`);
        } catch (e) {
            console.warn('[TaskService] Error cleaning priority tasks:', e);
        }

        console.log(`[TaskService] Force sync complete:`, results);
        return results;
    }

    /**
     * Purge all ghost tasks (deleted/completed) from local storage.
     * This removes them completely, not just hides them.
     * @returns {Object} Count of purged tasks per project
     */
    purgeGhostTasks() {
        console.log('[TaskService] Purging ghost tasks from local storage...');
        const results = {};

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('tasks-') && !key.includes('-version') && !key.includes('-completed')) {
                try {
                    const tasks = JSON.parse(localStorage.getItem(key) || '[]');
                    const activeTasks = tasks.filter(t => !t.completed && !t.deleted);
                    const purgedCount = tasks.length - activeTasks.length;

                    if (purgedCount > 0) {
                        localStorage.setItem(key, JSON.stringify(activeTasks));
                        localStorage.setItem(`${key}-version`, String(Date.now()));
                        results[key] = { before: tasks.length, after: activeTasks.length, purged: purgedCount };
                        console.log(`[TaskService] Purged ${purgedCount} ghost tasks from ${key}`);
                    }
                } catch (e) {
                    console.warn(`[TaskService] Error purging ${key}:`, e);
                }
            }
        }

        // Also purge from calculatedPriorityTasks
        try {
            const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
            const activePriority = priorityTasks.filter(t => !t.completed && !t.deleted);
            const purged = priorityTasks.length - activePriority.length;
            if (purged > 0) {
                localStorage.setItem('calculatedPriorityTasks', JSON.stringify(activePriority));
                results['calculatedPriorityTasks'] = { before: priorityTasks.length, after: activePriority.length, purged };
            }
        } catch (e) {
            console.warn('[TaskService] Error purging priority tasks:', e);
        }

        // Clear memory cache to force reload
        this.projectCache.clear();

        console.log('[TaskService] Ghost task purge complete:', results);
        return results;
    }

    /**
     * Full reset: Clear ALL local task data and reload fresh from Firestore.
     * Use as last resort when data is corrupted.
     * @param {Array<string>} projectIds - List of project IDs to reset, or null for all
     * @returns {Promise<Object>} Results of reset operation
     */
    async fullReset(projectIds = null) {
        console.log('[TaskService] Starting FULL RESET...');
        const results = { cleared: [], reloaded: [], errors: [] };

        // 1. Clear local storage
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('tasks-')) {
                if (!projectIds || projectIds.some(pid => key.includes(pid))) {
                    keysToRemove.push(key);
                }
            }
        }

        keysToRemove.forEach(key => {
            localStorage.removeItem(key);
            results.cleared.push(key);
        });

        // Also clear priority tasks
        localStorage.removeItem('calculatedPriorityTasks');
        localStorage.removeItem('calculatedPriorityTasks-version');

        // 2. Clear memory cache
        if (projectIds) {
            projectIds.forEach(pid => this.projectCache.delete(pid));
        } else {
            this.projectCache.clear();
        }

        // 3. Reload from Firestore (if logged in)
        if (this.auth.currentUser) {
            const idsToReload = projectIds || keysToRemove.map(k => k.replace('tasks-', '').replace('-version', ''));
            const uniqueIds = [...new Set(idsToReload.filter(id => !id.includes('-')))];

            for (const projectId of uniqueIds) {
                try {
                    const tasks = await loadTasksFromFirestore(projectId);
                    if (tasks && tasks.length > 0) {
                        // Only keep active tasks
                        const activeTasks = tasks.filter(t => !t.completed && !t.deleted);
                        await this._saveLocal(projectId, activeTasks);
                        results.reloaded.push({ projectId, count: activeTasks.length });
                    }
                } catch (e) {
                    results.errors.push({ projectId, error: e.message });
                }
            }
        }

        console.log('[TaskService] FULL RESET complete:', results);
        return results;
    }
}

// Singleton export
export { TaskService };
export const taskService = new TaskService();
export default taskService;

// Expose globally for non-module scripts (firestore.js, etc.)
window.TaskService = taskService;
window.taskService = taskService;
