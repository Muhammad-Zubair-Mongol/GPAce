/**
 * data-sync-manager.js
 * Manages data synchronization between localStorage and Firestore
 * 
 * Provides:
 * - Automatic background sync
 * - Conflict resolution
 * - Offline support with queue
 * - Cross-tab synchronization
 */

import { getStorage } from './utils/StorageAdapter.js';
import DataRepository from './services/DataRepository.js';

// ============================================
// Constants
// ============================================
const SYNC_INTERVAL = 30000; // 30 seconds
const SYNC_QUEUE_KEY = 'dataSyncQueue';
const LAST_SYNC_KEY = 'lastSyncTimestamp';
const LAST_ATTEMPT_KEY = 'lastSyncAttemptTimestamp';

// ============================================
// DataSyncManager Class
// ============================================
class DataSyncManager {
    constructor(options = {}) {
        this.syncInterval = null;
        this.isSyncing = false;
        this.syncQueue = [];
        this._eventTarget = options.eventTarget || (typeof window !== 'undefined' ? window : null);
        this._navigator = options.navigator || (typeof navigator !== 'undefined' ? navigator : null);
        this._now = options.now || (() => Date.now());
        this._setInterval = options.setInterval || ((...args) => setInterval(...args));
        this._clearInterval = options.clearInterval || ((...args) => clearInterval(...args));
        this._listeners = null;
        this._initialized = false;
        this._destroyed = false;
        this._lastError = null;
        this.isOnline = options.isOnline !== undefined
            ? Boolean(options.isOnline)
            : (this._navigator ? this._navigator.onLine !== false : true);

        this.init();
    }

    /**
     * Initialize the sync manager
     */
    init() {
        if (this._initialized && !this._destroyed) return this;
        this._destroyed = false;

        // Load pending sync queue
        this.loadSyncQueue();

        // Listen for online/offline events
        if (this._eventTarget && typeof this._eventTarget.addEventListener === 'function') {
            this._listeners = {
                online: () => this.handleOnline(),
                offline: () => this.handleOffline(),
                storage: (event) => this.handleStorageChange(event)
            };
            this._eventTarget.addEventListener('online', this._listeners.online);
            this._eventTarget.addEventListener('offline', this._listeners.offline);
            this._eventTarget.addEventListener('storage', this._listeners.storage);
        }

        this._initialized = true;

        // Start background sync if online
        if (this.isOnline) {
            this.startBackgroundSync();
        }

        console.log('[DataSyncManager] Initialized');
        return this;
    }

    /**
     * Handle coming online
     */
    handleOnline() {
        if (this._destroyed) return;
        console.log('[DataSyncManager] Online - starting sync');
        this.isOnline = true;
        void this.processSyncQueue();
        this.startBackgroundSync();
    }

    /**
     * Handle going offline
     */
    handleOffline() {
        if (this._destroyed) return;
        console.log('[DataSyncManager] Offline - queuing changes');
        this.isOnline = false;
        this.stopBackgroundSync();
    }

    /**
     * Handle storage changes from other tabs
     * @param {StorageEvent} event 
     */
    handleStorageChange(event) {
        if (!event.key) return;

        // Ignore sync-related keys
        if (event.key === SYNC_QUEUE_KEY || event.key === LAST_SYNC_KEY || event.key === LAST_ATTEMPT_KEY) return;

        console.log('[DataSyncManager] Storage changed in another tab:', event.key);

        // Emit custom event for components to react
        if (this._eventTarget && typeof this._eventTarget.dispatchEvent === 'function' &&
            typeof CustomEvent !== 'undefined') {
            this._eventTarget.dispatchEvent(new CustomEvent('dataSyncUpdate', {
                detail: { key: event.key, newValue: event.newValue, oldValue: event.oldValue }
            }));
        }
    }

    /**
     * Load sync queue from storage
     */
    loadSyncQueue() {
        try {
            const storage = getStorage();
            const queue = storage.get(SYNC_QUEUE_KEY, []);
            this.syncQueue = Array.isArray(queue) ? queue : [];
            return true;
        } catch (error) {
            this._lastError = error;
            this.syncQueue = [];
            console.error('[DataSyncManager] Failed to load sync queue:', error);
            return false;
        }
    }

    /**
     * Save sync queue to storage
     */
    saveSyncQueue() {
        const storage = getStorage();
        const result = storage.set(SYNC_QUEUE_KEY, this.syncQueue);
        if (result === false || (result && typeof result === 'object' && result.success === false)) {
            throw new Error(result.error || 'Sync queue persistence failed');
        }
        return true;
    }

    /**
     * Add item to sync queue
     * @param {Object} item - Item to sync
     */
    queueSync(item) {
        const queueItem = {
            ...item,
            status: 'pending',
            timestamp: this._now(),
            id: item?.id || `${this._now()}-${Math.random().toString(36).substr(2, 9)}`
        };

        this.syncQueue.push(queueItem);
        try {
            this.saveSyncQueue();
        } catch (error) {
            this.syncQueue.pop();
            this._lastError = error;
            throw error;
        }

        // Try to sync immediately if online
        if (this.isOnline && !this.isSyncing) {
            void this.processSyncQueue();
        }

        return queueItem;
    }

    /**
     * Process pending sync queue
     */
    async processSyncQueue() {
        if (this._destroyed) {
            return { status: 'destroyed', committed: false, failedItems: this.syncQueue.slice() };
        }
        if (this.isSyncing) {
            return { status: 'busy', committed: false, failedItems: this.syncQueue.slice() };
        }
        if (this.syncQueue.length === 0) {
            return { status: 'idle', committed: true, failedItems: [] };
        }

        this.isSyncing = true;
        const attemptAt = this._now();
        const originalQueue = this.syncQueue.slice();
        const failedItems = [];
        let processed = 0;

        try {
            console.log(`[DataSyncManager] Processing ${originalQueue.length} queued items`);

            // An attempt timestamp is deliberately separate from the last successful sync.
            try {
                getStorage().set(LAST_ATTEMPT_KEY, attemptAt);
            } catch (error) {
                this._lastError = error;
                console.warn('[DataSyncManager] Failed to persist sync attempt time:', error);
            }

            for (const item of originalQueue) {
                if (this._destroyed) {
                    failedItems.push(this._markFailedItem(item, new Error('Sync manager destroyed'), attemptAt));
                    continue;
                }

                try {
                    await this.syncItem(item);
                    processed += 1;
                } catch (error) {
                    console.error('[DataSyncManager] Failed to sync item:', error);
                    failedItems.push(this._markFailedItem(item, error, attemptAt));
                }
            }

            // Keep every failed/unsupported item inspectable in both memory and storage.
            this.syncQueue = failedItems;
            try {
                this.saveSyncQueue();
            } catch (error) {
                // The old durable queue is safer than claiming that the new state was saved.
                this._lastError = error;
                return {
                    status: 'error',
                    committed: false,
                    error,
                    processed,
                    failedItems: failedItems.slice(),
                    persisted: false
                };
            }

            if (failedItems.length > 0) {
                return {
                    status: 'pending',
                    committed: false,
                    processed,
                    failedItems: failedItems.slice(),
                    persisted: true
                };
            }

            try {
                getStorage().set(LAST_SYNC_KEY, this._now());
            } catch (error) {
                // The queue is empty, but there is no trustworthy success marker.
                this._lastError = error;
                return {
                    status: 'error',
                    committed: false,
                    error,
                    processed,
                    failedItems: [],
                    persisted: true
                };
            }

            this._lastError = null;
            return { status: 'committed', committed: true, processed, failedItems: [], persisted: true };
        } catch (error) {
            this._lastError = error;
            this.syncQueue = originalQueue.map(item => this._markFailedItem(item, error, attemptAt));
            return {
                status: 'error',
                committed: false,
                error,
                processed,
                failedItems: this.syncQueue.slice(),
                persisted: false
            };
        } finally {
            // Persistence and sync failures must never leave the manager latched busy.
            this.isSyncing = false;
        }
    }

    _markFailedItem(item, error, attemptAt) {
        const attempts = Number(item?.attempts || 0) + 1;
        return {
            ...item,
            status: 'failed',
            attempts,
            lastAttemptAt: attemptAt,
            updatedAt: attemptAt,
            lastError: error?.message || String(error || 'Unknown sync error')
        };
    }

    /**
     * Sync a single item to Firestore
     * @param {Object} item - Item to sync
     */
    async syncItem(item) {
        if (!item || typeof item !== 'object' || !item.type) {
            throw new Error('Unsupported sync item: type is required');
        }

        // Check if save function is available via DataRepository
        if (item.type === 'tasks') {
            // We expect item to have projectId. If not, we can't save.
            if (!item.projectId) {
                throw new Error('Unsupported tasks sync item: projectId is required');
            }
            const result = await DataRepository.saveTasks(item.projectId, item.data);
            this._assertAcknowledged(result, item.type);
            return result;
        }

        if (item.type === 'subjects') {
            const result = await DataRepository.saveSubjects(item.data);
            this._assertAcknowledged(result, item.type);
            return result;
        }

        // Fallback to old dynamic lookup for other types
        const saveFunc = this.getSaveFunction(item.type);
        if (!saveFunc) {
            throw new Error(`Unsupported sync type: ${item.type}`);
        }

        const result = await saveFunc(item.data);
        this._assertAcknowledged(result, item.type);
        return result;
    }

    _assertAcknowledged(result, type) {
        if (result === false || (result && typeof result === 'object' && (
            result.success === false ||
            result.committed === false ||
            result.status === 'error' ||
            result.status === 'pending'
        ))) {
            throw new Error(`Sync was not acknowledged for ${type}`);
        }
    }

    /**
     * Get appropriate save function for item type
     * @param {string} type - Type of data
     * @returns {Function|null}
     */
    getSaveFunction(type) {
        const target = this._eventTarget || (typeof window !== 'undefined' ? window : {});
        const saveFunctions = {
            'flashcards': target.saveFlashcardsToFirestore,
            'settings': target.saveSettingsToFirestore,
            'subjectMarks': target.saveSubjectMarksToFirestore,
            'subjectWeightages': target.saveSubjectWeightagesToFirestore
        };

        return saveFunctions[type] || null;
    }

    /**
     * Start background sync interval
     */
    startBackgroundSync() {
        if (this.syncInterval) return;

        this.syncInterval = this._setInterval(() => {
            if (this.isOnline && !this.isSyncing) {
                void this.processSyncQueue();
            }
        }, SYNC_INTERVAL);

        console.log('[DataSyncManager] Background sync started');
    }

    /**
     * Stop background sync interval
     */
    stopBackgroundSync() {
        if (this.syncInterval) {
            this._clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('[DataSyncManager] Background sync stopped');
        }
    }

    /**
     * Force immediate sync
     */
    async forceSync() {
        if (!this.isOnline) {
            console.warn('[DataSyncManager] Cannot force sync - offline');
            return false;
        }

        const result = await this.processSyncQueue();
        return result.committed === true;
    }

    /**
     * Get last sync timestamp
     * @returns {number|null}
     */
    getLastSyncTime() {
        const storage = getStorage();
        return storage.get(LAST_SYNC_KEY, null);
    }

    /**
     * Get the most recent attempt timestamp, including failed attempts.
     */
    getLastAttemptTime() {
        const storage = getStorage();
        return storage.get(LAST_ATTEMPT_KEY, null);
    }

    /**
     * Clear sync queue
     */
    clearQueue() {
        this.syncQueue = [];
        this.saveSyncQueue();
        console.log('[DataSyncManager] Sync queue cleared');
    }

    /**
     * Get current sync status
     * @returns {Object}
     */
    getStatus() {
        return {
            isOnline: this.isOnline,
            isSyncing: this.isSyncing,
            queueLength: this.syncQueue.length,
            lastSync: this.getLastSyncTime(),
            lastAttempt: this.getLastAttemptTime(),
            lastError: this._lastError ? this._lastError.message : null
        };
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.stopBackgroundSync();
        if (this._eventTarget && typeof this._eventTarget.removeEventListener === 'function' && this._listeners) {
            this._eventTarget.removeEventListener('online', this._listeners.online);
            this._eventTarget.removeEventListener('offline', this._listeners.offline);
            this._eventTarget.removeEventListener('storage', this._listeners.storage);
        }
        this._listeners = null;
        this._initialized = false;
        this._destroyed = true;
        console.log('[DataSyncManager] Destroyed');
        return true;
    }

    // ============================================
    // API methods expected by data-sync-integration.js
    // ============================================

    /**
     * Initialize data synchronization
     * @param {boolean} fullSync - Whether to perform a full sync
     * @returns {Promise<boolean>}
     */
    async initializeDataSync(fullSync = false) {
        console.log('[DataSyncManager] Initializing data sync, fullSync:', fullSync);
        console.log('[DataSyncManager] NOTE: Read operations now delegated to DataInitializationService');

        if (!this.isOnline) {
            console.warn('[DataSyncManager] Offline - skipping initial sync');
            return false;
        }

        try {
            if (fullSync) {
                // Delegate to DataInitializationService for read operations
                if (window.DataInitializationService) {
                    console.log('[DataSyncManager] Delegating data load to DataInitializationService...');
                    await window.DataInitializationService.init();
                } else {
                    console.error('[DataSyncManager] DataInitializationService not available, falling back to legacy loadFromFirestore');
                    // Fallback to old method if new service not available
                    await this.loadFromFirestore();
                }
            }

            // DataSyncManager's primary role: Process write queue
            await this.processSyncQueue();

            // Dispatch sync complete event
            window.dispatchEvent(new CustomEvent('dataSyncComplete', {
                detail: { timestamp: Date.now(), type: fullSync ? 'full' : 'incremental' }
            }));

            return true;
        } catch (error) {
            console.error('[DataSyncManager] Error during initializeDataSync:', error);
            return false;
        }
    }

    /**
     * Start periodic synchronization
     * Alias for startBackgroundSync() for API compatibility
     */
    startPeriodicSync() {
        this.startBackgroundSync();
    }

    /**
     * Stop periodic synchronization
     * Alias for stopBackgroundSync() for API compatibility
     */
    stopPeriodicSync() {
        this.stopBackgroundSync();
    }

    /**
     * Load data from Firestore to localStorage
     * NOTE: This method is now primarily for backward compatibility.
     * New code should use DataInitializationService instead.
     * @returns {Promise<void>}
     */
    async loadFromFirestore() {
        console.log('[DataSyncManager] Loading data from Firestore...');
        console.warn('[DataSyncManager LEGACY] loadFromFirestore is legacy. New code should use DataInitializationService.');

        try {
            // Load subjects if function available
            if (typeof window.loadSubjectsFromFirestore === 'function') {
                await window.loadSubjectsFromFirestore();
            }

            // Load subject marks if function available
            if (typeof window.loadSubjectMarksFromFirestore === 'function') {
                await window.loadSubjectMarksFromFirestore();
            }

            // Load subject weightages if function available
            if (typeof window.loadSubjectWeightagesFromFirestore === 'function') {
                await window.loadSubjectWeightagesFromFirestore();
            }

            // Load tasks for each subject (loadTasksFromFirestore requires a valid projectId)
            if (typeof window.loadTasksFromFirestore === 'function') {
                const storage = getStorage();
                const subjects = storage.get('academicSubjects', []);

                // Load tasks only for subjects with valid tags
                for (const subject of subjects) {
                    const projectId = subject?.tag;
                    if (projectId && projectId !== 'undefined' && projectId !== 'null') {
                        try {
                            await window.loadTasksFromFirestore(projectId);
                        } catch (taskError) {
                            console.debug(`[DataSyncManager] Failed to load tasks for ${projectId}:`, taskError.message);
                        }
                    }
                }
            }

            console.log('[DataSyncManager] Data loaded from Firestore');
        } catch (error) {
            console.error('[DataSyncManager] Error loading from Firestore:', error);
            throw error;
        }
    }

    /**
     * Save data to Firestore from localStorage
     * @returns {Promise<void>}
     */
    async saveToFirestore() {
        console.log('[DataSyncManager] Saving data to Firestore...');

        try {
            // Save subjects if function available
            if (typeof window.saveSubjectsToFirestore === 'function') {
                await window.saveSubjectsToFirestore();
            }

            // Save subject marks if function available
            if (typeof window.saveSubjectMarksToFirestore === 'function') {
                await window.saveSubjectMarksToFirestore();
            }

            // Save subject weightages if function available
            if (typeof window.saveSubjectWeightagesToFirestore === 'function') {
                await window.saveSubjectWeightagesToFirestore();
            }

            // Save tasks if function available
            if (typeof window.saveTasksToFirestore === 'function') {
                await window.saveTasksToFirestore();
            }

            console.log('[DataSyncManager] Data saved to Firestore');
        } catch (error) {
            console.error('[DataSyncManager] Error saving to Firestore:', error);
            throw error;
        }
    }
}

// Create and export singleton instance
const dataSyncManager = new DataSyncManager();
export default dataSyncManager;

// Make available globally for non-module scripts
if (typeof window !== 'undefined') {
    window.dataSyncManager = dataSyncManager;
}
