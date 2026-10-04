/**
 * OperationQueue - Sequential operation processing to prevent race conditions
 * Ensures task mutations are executed one at a time in FIFO order
 */
class OperationQueue {
    constructor(name = 'default') {
        this.name = name;
        this.queue = [];
        this.processing = false;
        this.timeout = 30000; // 30 second timeout per operation
    }

    /**
     * Add operation to queue
     * @param {Function} operation - Async function to execute
     * @param {String} description - Operation description for logging
     * @returns {Promise} Resolves with operation result
     */
    enqueue(operation, description = 'Unknown operation') {
        return new Promise((resolve, reject) => {
            this.queue.push({
                operation,
                description,
                resolve,
                reject,
                enqueuedAt: Date.now()
            });

            console.log(`[OperationQueue:${this.name}] Enqueued: ${description} (queue length: ${this.queue.length})`);

            // Start processing if not already running
            if (!this.processing) {
                this.process();
            }
        });
    }

    /**
     * Process queue sequentially
     */
    async process() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const item = this.queue[0];
            const startTime = Date.now();

            console.log(`[OperationQueue:${this.name}] Processing: ${item.description}`);

            try {
                // Execute with timeout
                const result = await this.executeWithTimeout(item.operation, this.timeout);

                const duration = Date.now() - startTime;
                console.log(`[OperationQueue:${this.name}] Completed: ${item.description} (${duration}ms)`);

                item.resolve(result);

            } catch (error) {
                const duration = Date.now() - startTime;
                console.error(`[OperationQueue:${this.name}] Failed: ${item.description} (${duration}ms)`, error);

                item.reject(error);
            }

            // Remove completed operation
            this.queue.shift();
        }

        this.processing = false;
    }

    /**
     * Execute operation with timeout
     * @param {Function} operation - Async operation
     * @param {Number} timeout - Timeout in milliseconds
     * @returns {Promise} Operation result or timeout error
     */
    executeWithTimeout(operation, timeout) {
        return Promise.race([
            operation(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Operation timeout')), timeout)
            )
        ]);
    }

    /**
     * Get current queue status
     * @returns {Object} Queue status
     */
    getStatus() {
        return {
            name: this.name,
            queueLength: this.queue.length,
            processing: this.processing,
            operations: this.queue.map(item => ({
                description: item.description,
                waitTime: Date.now() - item.enqueuedAt
            }))
        };
    }

    /**
     * Clear the queue (use with caution)
     * @param {Boolean} rejectPending - Reject all pending operations
     */
    clear(rejectPending = false) {
        if (rejectPending) {
            this.queue.forEach(item => {
                item.reject(new Error('Queue cleared'));
            });
        }

        this.queue = [];
        console.log(`[OperationQueue:${this.name}] Queue cleared`);
    }
}

// Create global queues
if (typeof window !== 'undefined') {
    // Queue for task operations (complete, interleave, skip, create)
    window.taskOperationQueue = new OperationQueue('tasks');

    // Queue for sync operations
    window.syncOperationQueue = new OperationQueue('sync');

    // Add debug helper
    window.debugQueues = function () {
        console.log('Task Queue:', window.taskOperationQueue.getStatus());
        console.log('Sync Queue:', window.syncOperationQueue.getStatus());
    };
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OperationQueue;
}
