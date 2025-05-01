// Cross-Tab Synchronization Module

class CrossTabSync {
    constructor(namespace = 'gpace') {
        this.namespace = namespace;
        this.channel = new BroadcastChannel(this.namespace);
        this.listeners = new Map();

        // Debugging: Log when the CrossTabSync is initialized
        console.log(`🔗 CrossTabSync initialized for namespace: ${this.namespace}`);

        // Listen for messages from other tabs
        this.channel.onmessage = (event) => {
            const { type, data } = event.data;
            console.log(`📡 Received cross-tab message: ${type}`, data);
            this.handleMessage(type, data);
        };

        // Setup global reload trigger
        this.setupReloadTrigger();


        this.on('priority-update', (data) => {
            console.log('🔄 Priority tasks updated in another tab:', data);

            // If we're on a page that displays priority tasks, reload them
            if (typeof window.displayPriorityTask === 'function') {
                console.log('Reloading priority tasks display...');
                window.displayPriorityTask();
            }
        });

        // Set up task update listener for priority calculator page
        this.setupTaskUpdateListener();
    }

    /**
     * Set up listener for task updates to reload the page when necessary
     * This was previously in an inline script in priority-calculator.html
     */
    setupTaskUpdateListener() {
        // Only set up if we're on the priority calculator page
        if (window.location.pathname.includes('priority-calculator.html')) {
            console.log('Setting up task update listener for priority calculator');

            // Add cross-tab synchronization for page reload
            this.onUserAction('task-update', (data) => {
                console.log('🔄 Task update received for project:', data.projectId);
                console.log('🔄 Reloading page due to task update');
                location.reload();
            });
        }
    }

    // New method to setup reload trigger
    setupReloadTrigger() {
        // Check for reload requests on page load
        this.checkReloadRequest();

        // Listen for storage events that might indicate a reload request
        window.addEventListener('storage', (event) => {
            if (event.key === `${this.namespace}-reload-request`) {
                this.checkReloadRequest();
            }
        });



    }

    // Check if there's a pending reload request
    checkReloadRequest() {
        const reloadRequest = localStorage.getItem(`${this.namespace}-reload-request`);
        if (reloadRequest) {
            try {
                const requestData = JSON.parse(reloadRequest);
                const currentPath = window.location.pathname;

                // Check if this page should reload
                if (requestData.paths.some(path => currentPath.includes(path))) {
                    console.log('🔄 Reload requested for this page:', requestData);

                    // Prevent infinite reload loops by checking the timestamp
                    const lastReload = localStorage.getItem(`${this.namespace}-last-reload-time`);
                    const now = Date.now();

                    if (!lastReload || (now - parseInt(lastReload)) > 10000) { // 10 second cooldown
                        // Store the reload time
                        localStorage.setItem(`${this.namespace}-last-reload-time`, now.toString());

                        // Remove the reload request
                        localStorage.removeItem(`${this.namespace}-reload-request`);

                        // DISABLED: Reload the page (commenting out to troubleshoot navigation issues)
                        // location.reload();
                        console.log('🛑 Reload was requested but has been disabled for troubleshooting');
                    } else {
                        console.warn('🛑 Reload prevented - too frequent. Last reload was less than 10 seconds ago.');
                        localStorage.removeItem(`${this.namespace}-reload-request`);
                    }
                }
            } catch (error) {
                console.error('Error processing reload request:', error);
                localStorage.removeItem(`${this.namespace}-reload-request`);
            }
        }
    }

    // Method to request page reloads across all tabs
    requestPageReload(paths) {
        // DISABLED FOR TROUBLESHOOTING
        console.log('🛑 Page reload request DISABLED for troubleshooting. Would have reloaded:', paths);

        // The code below is commented out to prevent reload cycles
        /*
        // Store reload request in localStorage
        localStorage.setItem(`${this.namespace}-reload-request`, JSON.stringify({
            timestamp: Date.now(),
            paths: Array.isArray(paths) ? paths : [paths]
        }));

        // Broadcast to trigger storage event in other tabs
        this.channel.postMessage({
            type: 'reload-request',
            data: { paths: Array.isArray(paths) ? paths : [paths] }
        });

        console.log('🔄 Requesting page reload for paths:', paths);
        */
    }

    // Send a message to all tabs (including the current one)
    send(type, data) {
        this.channel.postMessage({ type, data });
        // Also store in localStorage as a fallback
        localStorage.setItem(`${this.namespace}-${type}`, JSON.stringify({
            data,
            timestamp: Date.now()
        }));
    }

    // Register a listener for a specific message type
    on(type, callback) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(callback);
    }

    // Handle incoming messages
    handleMessage(type, data) {
        const typeListeners = this.listeners.get(type) || [];
        typeListeners.forEach(listener => listener(data));
    }

    // Fallback storage event listener for cross-tab communication
    setupStorageListener() {
        window.addEventListener('storage', (event) => {
            if (event.key && event.key.startsWith(`${this.namespace}-`)) {
                try {
                    const storedData = JSON.parse(event.newValue);
                    const messageType = event.key.replace(`${this.namespace}-`, '');
                    this.handleMessage(messageType, storedData.data);
                } catch (error) {
                    console.error('Error parsing storage event:', error);
                }
            }
        });
    }

    // Synchronize state across tabs
    syncState(key, initialState = null) {
        // Initialize state if not exists
        if (initialState !== null && !localStorage.getItem(key)) {
            localStorage.setItem(key, JSON.stringify(initialState));
        }

        // Broadcast state changes
        const originalSetItem = localStorage.setItem;
        localStorage.setItem = (storageKey, value) => {
            if (storageKey === key) {
                this.send(key, JSON.parse(value));
            }
            originalSetItem.call(localStorage, storageKey, value);
        };

        // Listen for state changes
        this.on(key, (newState) => {
            // Update local storage without triggering another broadcast
            localStorage.setItem = originalSetItem;
            localStorage.setItem(key, JSON.stringify(newState));
            localStorage.setItem = this.overriddenSetItem;
        });

        // Return current state
        return JSON.parse(localStorage.getItem(key) || 'null');
    }

    // Method to synchronize specific app states
    syncAppState(stateKey, updateCallback) {
        // Listen for changes in this specific state
        this.on(stateKey, (newState) => {
            updateCallback(newState);
        });

        // Return current state
        return JSON.parse(localStorage.getItem(stateKey) || 'null');
    }

    // Broadcast user actions across tabs
    broadcastAction(actionType, actionData) {
        this.send('user-action', { type: actionType, data: actionData });
    }

    // Listen for specific user actions
    onUserAction(actionType, callback) {
        this.on('user-action', (action) => {
            if (action.type === actionType) {
                callback(action.data);
            }
        });
    }

    // Method to test cross-tab communication
    testCommunication() {
        const testMessage = {
            timestamp: Date.now(),
            tabId: this.generateTabId()
        };

        console.log('🧪 Sending test communication across tabs', testMessage);

        this.send('cross-tab-test', testMessage);
    }

    // Generate a unique tab identifier
    generateTabId() {
        return Math.random().toString(36).substr(2, 9);
    }

    // Add a method to check Broadcast Channel and localStorage support
    checkBrowserSupport() {
        const support = {
            broadcastChannel: !!window.BroadcastChannel,
            localStorage: this.isLocalStorageAvailable()
        };

        console.log('🌐 Browser Support:', support);
        return support;
    }

    // Check if localStorage is available
    isLocalStorageAvailable() {
        try {
            localStorage.setItem('test', 'test');
            localStorage.removeItem('test');
            return true;
        } catch(e) {
            return false;
        }
    }

    // Initialize debugging and support checks
    initDebug() {
        // Test communication on initialization
        this.testCommunication();

        // Check browser support
        this.checkBrowserSupport();

        // Listen for test messages
        this.on('cross-tab-test', (testData) => {
            console.log('✅ Cross-Tab Test Received:', testData);
        });
    }
}

// Export a singleton instance
window.crossTabSync = new CrossTabSync();
window.crossTabSync.setupStorageListener();
window.crossTabSync.initDebug();  // Initialize debugging

export default window.crossTabSync;
