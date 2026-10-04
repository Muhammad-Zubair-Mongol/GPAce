/**
 * SyncQueue - Handles Firebase synchronization with retry logic
 * Implements exponential backoff for failed operations
 * Provides user-visible sync status updates
 */
class SyncQueue {
    constructor() {
        this.queue = [];
        this.deadLetterQueue = [];
        this.processing = false;
        this.maxRetries = 5;
        this.syncListeners = new Set();

        // Restore queue from localStorage on init
        this.restoreQueue();

        // Start processing
        this.process();
    }

    /**
     * Add an operation to the sync queue
     * @param {Function} operation - Async function to execute
     * @param {Object} metadata - Operation metadata for tracking
     * @returns {Promise} Resolves when operation completes
     */
    enqueue(operation, metadata = {}) {
        const item = {
            operation,
            metadata,
            retryCount: 0,
            createdAt: Date.now(),
            id: `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        };

        this.queue.push(item);
        this.persistQueue();
        this.notifyListeners('queued', item);

        // Start processing if not already running
        if (!this.processing) {
            this.process();
        }

        return new Promise((resolve, reject) => {
            item.resolve = resolve;
            item.reject = reject;
        });
    }

    /**
     * Process the sync queue sequentially
     */
    async process() {
        if (this.processing || this.queue.length === 0) {
            if (this.queue.length === 0) {
                this.notifyListeners('idle');
            }
            return;
        }

        this.processing = true;
        const item = this.queue[0];

        try {
            this.notifyListeners('processing', item);

            // Execute the operation
            const result = await item.operation();

            // Success - remove from queue
            this.queue.shift();
            this.persistQueue();

            if (item.resolve) item.resolve(result);
            this.notifyListeners('success', item);

        } catch (error) {
            item.retryCount++;

            if (item.retryCount >= this.maxRetries) {
                // Max retries exceeded - move to dead letter queue
                this.queue.shift();
                this.deadLetterQueue.push({
                    ...item,
                    error: error.message,
                    failedAt: Date.now()
                });
                this.persistQueue();

                if (item.reject) item.reject(error);
                this.notifyListeners('failed', item, error);

                // Show user notification
                this.showSyncError(item);
            } else {
                // Retry with exponential backoff
                const delay = Math.pow(2, item.retryCount) * 1000; // 2s, 4s, 8s, 16s, 32s

                this.notifyListeners('retrying', item, delay);

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        this.processing = false;

        // Continue processing queue
        this.process();
    }

    /**
     * Add event listener for sync status changes
     * @param {Function} listener - Callback function
     */
    addListener(listener) {
        this.syncListeners.add(listener);
    }

    /**
     * Remove event listener
     * @param {Function} listener - Callback function
     */
    removeListener(listener) {
        this.syncListeners.delete(listener);
    }

    /**
     * Notify all listeners of status change
     * @param {String} event - Event type
     * @param {Object} item - Queue item
     * @param {*} data - Additional data
     */
    notifyListeners(event, item, data) {
        this.syncListeners.forEach(listener => {
            try {
                listener({ event, item, data });
            } catch (err) {
                console.error('Sync listener error:', err);
            }
        });
    }

    /**
     * Show error notification to user
     * @param {Object} item - Failed queue item
     */
    showSyncError(item) {
        const message = `Failed to sync: ${item.metadata.description || 'Unknown operation'}. Please check your connection.`;

        if (typeof window.showNotification === 'function') {
            window.showNotification('Sync Error', message, 'error');
        } else {
            console.error('Sync Error:', message);
        }
    }

    /**
     * Persist queue to localStorage
     */
    persistQueue() {
        try {
            const queueData = {
                queue: this.queue.map(item => ({
                    metadata: item.metadata,
                    retryCount: item.retryCount,
                    createdAt: item.createdAt,
                    id: item.id
                })),
                deadLetterQueue: this.deadLetterQueue
            };

            localStorage.setItem('syncQueue', JSON.stringify(queueData));
        } catch (err) {
            console.error('Failed to persist sync queue:', err);
        }
    }

    /**
     * Restore queue from localStorage
     */
    restoreQueue() {
        try {
            const stored = localStorage.getItem('syncQueue');
            if (stored) {
                const queueData = JSON.parse(stored);
                this.deadLetterQueue = queueData.deadLetterQueue || [];

                // Note: We don't restore operation functions (not serializable)
                // Operations will be re-queued on next user action
                console.log('Restored sync queue with', this.deadLetterQueue.length, 'failed items');
            }
        } catch (err) {
            console.error('Failed to restore sync queue:', err);
        }
    }

    /**
     * Get current sync status
     * @returns {Object} Status object
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            processing: this.processing,
            failedCount: this.deadLetterQueue.length,
            currentOperation: this.queue[0]?.metadata || null
        };
    }

    /**
     * Retry all failed operations in dead letter queue
     */
    retryFailed() {
        const failedItems = [...this.deadLetterQueue];
        this.deadLetterQueue = [];

        failedItems.forEach(item => {
            // Reset retry count and re-queue
            item.retryCount = 0;
            this.queue.push(item);
        });

        this.persistQueue();
        this.process();

        return failedItems.length;
    }

    /**
     * Clear dead letter queue
     */
    clearFailed() {
        const count = this.deadLetterQueue.length;
        this.deadLetterQueue = [];
        this.persistQueue();
        return count;
    }
}

// Create global instance
if (typeof window !== 'undefined') {
    window.syncQueue = new SyncQueue();

    // Add visual sync status indicator
    window.addEventListener('DOMContentLoaded', () => {
        setupSyncStatusUI();
    });
}

/**
 * Setup sync status indicator in UI
 */
function setupSyncStatusUI() {
    // Check if status element already exists
    if (document.getElementById('syncStatus')) return;

    // Create sync status element
    const statusEl = document.createElement('div');
    statusEl.id = 'syncStatus';
    statusEl.className = 'sync-status';
    statusEl.innerHTML = `
    <i class="bi bi-cloud-check" id="syncIcon"></i>
    <span id="syncText">All changes saved</span>
  `;

    // Add CSS
    const style = document.createElement('style');
    style.textContent = `
    .sync-status {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: var(--card-bg, #1e1e1e);
      color: var(--text-color, #fff);
      padding: 8px 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 9999;
      transition: all 0.3s ease;
      opacity: 0;
      pointer-events: none;
    }
    
    .sync-status.visible {
      opacity: 1;
      pointer-events: auto;
    }
    
    .sync-status i {
      font-size: 1.1rem;
    }
    
    .sync-status .bi-cloud-check {
      color: #4caf50;
    }
    
    .sync-status .bi-cloud-arrow-up {
      color: #2196f3;
      animation: pulse 1.5s infinite;
    }
    
    .sync-status .bi-exclamation-triangle {
      color: #ff9800;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `;

    document.head.appendChild(style);
    document.body.appendChild(statusEl);

    // Listen to sync events
    let hideTimeout;

    window.syncQueue.addListener(({ event, item, data }) => {
        const icon = document.getElementById('syncIcon');
        const text = document.getElementById('syncText');
        const status = document.getElementById('syncStatus');

        clearTimeout(hideTimeout);
        status.classList.add('visible');

        switch (event) {
            case 'processing':
                icon.className = 'bi bi-cloud-arrow-up';
                text.textContent = 'Syncing changes...';
                break;

            case 'success':
                icon.className = 'bi bi-cloud-check';
                text.textContent = 'All changes saved';
                hideTimeout = setTimeout(() => {
                    status.classList.remove('visible');
                }, 3000);
                break;

            case 'retrying':
                icon.className = 'bi bi-cloud-arrow-up';
                text.textContent = `Retrying sync (attempt ${item.retryCount + 1}/${window.syncQueue.maxRetries})...`;
                break;

            case 'failed':
                icon.className = 'bi bi-exclamation-triangle';
                text.textContent = 'Sync failed - changes saved locally';
                hideTimeout = setTimeout(() => {
                    status.classList.remove('visible');
                }, 5000);
                break;

            case 'idle':
                hideTimeout = setTimeout(() => {
                    status.classList.remove('visible');
                }, 2000);
                break;
        }
    });
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SyncQueue;
}
