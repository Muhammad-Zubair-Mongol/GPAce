/**
 * TaskSystemLoader.js
 * 
 * Unified loader for the Task Sync System.
 * Coordinates TaskRepository, SyncStatusIndicator, ConflictModal, and RecoveryModal.
 * 
 * Part of Step 41: Canonical Task Envelopes, Strict Validation, and One-Way Migration.
 * 
 * RULES:
 * - Expose ready() and stable contract to page consumers.
 * - Avoid global localStorage monkeypatches.
 * - Loader readiness NEVER announces healthy state after failed initialization.
 * 
 * @version 2.0.0
 */

import TaskRepository from './TaskRepository.js';

// Dynamically import optional UI components if in browser
let SyncStatusIndicator = null;
let ConflictModal = null;
let RecoveryModal = null;

if (typeof window !== 'undefined') {
    try {
        const syncMod = await import('../components/SyncStatusIndicator.js');
        SyncStatusIndicator = syncMod.default || syncMod.SyncStatusIndicator;
    } catch {}

    try {
        const conflictMod = await import('../components/ConflictModal.js');
        ConflictModal = conflictMod.default || conflictMod.ConflictModal;
    } catch {}

    try {
        const recoveryMod = await import('../components/RecoveryModal.js');
        RecoveryModal = recoveryMod.default || recoveryMod.RecoveryModal;
    } catch {}
}

class TaskSystemLoader {
    static _isInitialized = false;
    static _isHealthy = false;
    static _initPromise = null;
    static _lastError = null;

    /**
     * Initialize the complete task sync system.
     * HARDENED: Never announces healthy state if repository initialization fails.
     * 
     * @returns {Promise<boolean>}
     */
    static async initTaskSystem() {
        console.log('[TaskSystem] Initializing Task System...');

        try {
            // 1. Initialize TaskRepository
            const repoOk = await TaskRepository.init();
            if (!repoOk) {
                this._isHealthy = false;
                this._lastError = new Error('TaskRepository initialization returned false (integrity failed or recovery required)');
                console.warn('[TaskSystem] TaskRepository initialization failed - recovery required');

                if (typeof window !== 'undefined' && SyncStatusIndicator && typeof SyncStatusIndicator.setState === 'function') {
                    SyncStatusIndicator.setState('offline', 'Repository init failed / recovery needed');
                }

                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(new CustomEvent('gpac_init_failed', {
                        detail: { reason: 'Repository initialization failed' }
                    }));
                }

                return false;
            }

            // 2. Initialize UI components if in a browser DOM environment
            if (typeof document !== 'undefined') {
                if (SyncStatusIndicator && typeof SyncStatusIndicator.init === 'function') {
                    SyncStatusIndicator.init();
                }
                if (ConflictModal && typeof ConflictModal.init === 'function') {
                    ConflictModal.init();
                }
                if (RecoveryModal && typeof RecoveryModal.init === 'function') {
                    RecoveryModal.init();
                }
            }

            // 3. Mark healthy state ONLY after verified success
            this._isHealthy = true;
            this._isInitialized = true;
            this._lastError = null;

            if (typeof document !== 'undefined' && SyncStatusIndicator && typeof SyncStatusIndicator.synced === 'function') {
                SyncStatusIndicator.synced();
            }

            // 4. Expose global handles
            if (typeof window !== 'undefined') {
                window.TaskRepository = TaskRepository;
                window.SyncStatusIndicator = SyncStatusIndicator;
                window.ConflictModal = ConflictModal;
                window.RecoveryModal = RecoveryModal;

                window.gpac = {
                    ready: () => TaskSystemLoader.ready(),
                    isHealthy: () => TaskSystemLoader.isHealthy(),
                    getTasks: (projectId) => TaskRepository.getAllTasks(projectId),
                    getRelaxedTasks: () => TaskRepository.getRelaxedTasks(),
                    getPriorityTasks: () => TaskRepository.getPriorityCache(),
                    addTask: (projectId, task) => TaskRepository.addTask(projectId, task),
                    updateTask: (projectId, taskId, updates) => TaskRepository.updateTask(projectId, taskId, updates),
                    completeTask: (projectId, taskId) => TaskRepository.completeTask(projectId, taskId),
                    deleteTask: (projectId, taskId) => TaskRepository.deleteTask(projectId, taskId),
                    savePriorityCache: (tasks) => TaskRepository.savePriorityCache(tasks),
                    exportData: () => TaskRepository.exportData(),
                    importData: (json) => TaskRepository.importData(json),
                    createBackup: (slot) => TaskRepository.createBackup(slot || 'manual'),
                    restoreBackup: (slot) => TaskRepository.forceRecoveryFromBackup(slot || 'latest'),
                    listBackups: () => TaskRepository.listBackups()
                };

                // Dispatch ready event
                if (typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(new CustomEvent('gpac_ready'));
                }
            }

            console.log('[TaskSystem] ✅ Task System initialized successfully (healthy)');
            return true;

        } catch (error) {
            this._isHealthy = false;
            this._lastError = error;
            console.error('[TaskSystem] Critical initialization exception:', error);

            if (typeof window !== 'undefined' && SyncStatusIndicator && typeof SyncStatusIndicator.setState === 'function') {
                SyncStatusIndicator.setState('offline', 'Sync error');
            }

            return false;
        }
    }

    /**
     * Check if system initialized in a healthy state
     * @returns {boolean}
     */
    static isHealthy() {
        return this._isHealthy;
    }

    /**
     * Check if system initialization has finished
     * @returns {boolean}
     */
    static isInitialized() {
        return this._isInitialized;
    }

    /**
     * Stable readiness contract for page consumers.
     * Resolves only when initialized healthy; rejects if initialization failed.
     * @returns {Promise<Object>}
     */
    static async ready() {
        if (!this._initPromise) {
            this._initPromise = this.initTaskSystem();
        }
        const ok = await this._initPromise;
        if (!ok || !this._isHealthy) {
            const err = this._lastError || new Error('TaskSystem initialization failed: unhealthy state');
            throw err;
        }
        return {
            ok: true,
            healthy: true,
            repository: TaskRepository
        };
    }

    /**
     * Diagnostics helper without monkeypatching global storage
     * @param {string} key - Accessed storage key
     * @param {string} operation - Operation name
     * @returns {boolean}
     */
    static checkTaskStorageAccess(key, operation) {
        const forbiddenPatterns = [
            /^tasks-/,
            /^completed-tasks-/,
            /^relaxed-tasks$/,
            /^calculatedPriorityTasks$/
        ];

        for (const pattern of forbiddenPatterns) {
            if (pattern.test(key)) {
                console.warn(`[TaskSystem] ⚠️ Direct access to legacy task key detected: '${key}' in ${operation}. Use TaskRepository instead.`);
                return true;
            }
        }
        return false;
    }
}

// Auto-initialize when running in browser DOM
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            TaskSystemLoader.initTaskSystem();
        });
    } else {
        TaskSystemLoader.initTaskSystem();
    }
}

// Global hook for browser diagnostic inspection
if (typeof window !== 'undefined') {
    window.__checkTaskStorageAccess = (key, op) => TaskSystemLoader.checkTaskStorageAccess(key, op);
    window.TaskSystemLoader = TaskSystemLoader;
}

export {
    TaskRepository,
    SyncStatusIndicator,
    ConflictModal,
    RecoveryModal,
    TaskSystemLoader
};

export const initTaskSystem = () => TaskSystemLoader.initTaskSystem();
export default TaskSystemLoader;
