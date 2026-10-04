// Cross-Tab Synchronization Module

class CrossTabSync {
    constructor(namespace = 'gpace', options = {}) {
        if (namespace && typeof namespace === 'object') {
            options = namespace;
            namespace = options.namespace || 'gpace';
        }

        this.namespace = namespace;
        this._window = options.window || (typeof window !== 'undefined' ? window : null);
        this._storage = options.storage || this._window?.localStorage ||
            (typeof localStorage !== 'undefined' ? localStorage : null);
        this._BroadcastChannel = options.BroadcastChannel || this._window?.BroadcastChannel ||
            (typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null);
        this.channel = null;
        this.listeners = new Map();
        this._subscriptions = [];
        this._storageListener = null;
        this._reloadStorageListener = null;
        this._storagePatches = [];
        this._destroyed = false;

        if (typeof this._BroadcastChannel === 'function') {
            try {
                this.channel = new this._BroadcastChannel(this.namespace);
                if (typeof this.channel.unref === 'function') this.channel.unref();
            } catch (error) {
                console.warn('[CrossTabSync] BroadcastChannel unavailable:', error);
            }
        }

        this._channelMessageHandler = (event) => {
            const message = event?.data || {};
            const { type, data } = message;
            if (!type) return;
            console.log(`📡 Received cross-tab message: ${type}`, data);
            this.handleMessage(type, data);
        };

        if (this.channel) {
            this.channel.onmessage = this._channelMessageHandler;
        }

        console.log(`🔗 CrossTabSync initialized for namespace: ${this.namespace}`);

        this.setupReloadTrigger();

        this._subscriptions.push(this.on('priority-update', (data) => {
            console.log('🔄 Priority tasks updated in another tab:', data);
            if (typeof this._window?.displayPriorityTask === 'function') {
                this._window.displayPriorityTask();
            }
        }));

        this._subscriptions.push(this.on('task-links-update', (data) => {
            console.log('🔄 Task links updated in another tab:', data);
            if (!data?.taskId || !this._window?.document) return;

            const container = this._window.document.getElementById(`links-${data.taskId}`);
            if (container && container.classList?.contains('expanded') &&
                this._window.taskLinksManager &&
                typeof this._window.taskLinksManager.renderLinks === 'function') {
                this._window.taskLinksManager.renderLinks(data.taskId, container);
            }
        }));

        this.setupTaskUpdateListener();
    }

    /**
     * Deliver task changes as an incremental browser event. Consumers can update
     * task UI while retaining local editor state; receiving a task update never
     * navigates or reloads the page.
     */
    setupTaskUpdateListener() {
        this._subscriptions.push(this.onUserAction('task-update', (data) => {
            console.log('🔄 Task update received for project:', data?.projectId);
            this._dispatch('gpace:task-update', data);

            if (typeof this._window?.handleCrossTabTaskUpdate === 'function') {
                this._window.handleCrossTabTaskUpdate(data);
            }
        }));
    }

    setupReloadTrigger() {
        if (this._reloadStorageListener || !this._window ||
            typeof this._window.addEventListener !== 'function') {
            return;
        }

        this.checkReloadRequest();
        this._reloadStorageListener = (event) => {
            if (event?.key === `${this.namespace}-reload-request`) {
                this.checkReloadRequest();
            }
        };
        this._window.addEventListener('storage', this._reloadStorageListener);
    }

    /**
     * Consume an explicit reload request without forcing navigation. A page can
     * opt into a reload by subscribing to the `reload-request` message; ordinary
     * task updates remain incremental and draft-safe.
     */
    checkReloadRequest() {
        const storage = this._storage;
        if (!storage || typeof storage.getItem !== 'function') return;

        const reloadRequest = storage.getItem(`${this.namespace}-reload-request`);
        if (!reloadRequest) return;

        try {
            const requestData = JSON.parse(reloadRequest);
            const currentPath = this._window?.location?.pathname || '';
            const paths = Array.isArray(requestData.paths) ? requestData.paths : [];
            if (!paths.some(path => currentPath.includes(path))) return;

            const lastReload = storage.getItem(`${this.namespace}-last-reload-time`);
            const now = Date.now();
            if (!lastReload || (now - parseInt(lastReload, 10)) > 10000) {
                storage.setItem(`${this.namespace}-last-reload-time`, String(now));
                storage.removeItem(`${this.namespace}-reload-request`);
                this.handleMessage('reload-request', { ...requestData, path: currentPath });
            } else {
                storage.removeItem(`${this.namespace}-reload-request`);
            }
        } catch (error) {
            console.error('[CrossTabSync] Error processing reload request:', error);
            try {
                storage.removeItem(`${this.namespace}-reload-request`);
            } catch {}
        }
    }

    requestPageReload(paths) {
        const normalizedPaths = Array.isArray(paths) ? paths : [paths];
        this._setStorage(`${this.namespace}-reload-request`, JSON.stringify({
            timestamp: Date.now(),
            paths: normalizedPaths
        }));

        this._post({
            type: 'reload-request',
            data: { paths: normalizedPaths }
        });
        console.log('🔄 Requesting page reload for paths:', paths);
    }

    // Send a message to all tabs (including the current tab through fallback events).
    send(type, data) {
        if (this._destroyed) return false;
        this._post({ type, data });
        this._setStorage(`${this.namespace}-${type}`, JSON.stringify({
            data,
            timestamp: Date.now()
        }));
        return true;
    }

    _post(message) {
        if (!this.channel || typeof this.channel.postMessage !== 'function') return;
        try {
            this.channel.postMessage(message);
        } catch (error) {
            console.warn('[CrossTabSync] Failed to broadcast message:', error);
        }
    }

    _setStorage(key, value) {
        if (!this._storage || typeof this._storage.setItem !== 'function') return;
        try {
            this._storage.setItem(key, value);
        } catch (error) {
            console.warn('[CrossTabSync] Failed to persist fallback message:', error);
        }
    }

    _dispatch(type, detail) {
        if (!this._window || typeof this._window.dispatchEvent !== 'function') return;
        const EventCtor = this._window.CustomEvent ||
            (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
        if (typeof EventCtor !== 'function') return;
        this._window.dispatchEvent(new EventCtor(type, { detail }));
    }

    // Register a listener for a specific message type and return its cleanup function.
    on(type, callback) {
        if (typeof callback !== 'function') return () => {};
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        const callbacks = this.listeners.get(type);
        callbacks.add(callback);

        return () => this.off(type, callback);
    }

    off(type, callback) {
        const callbacks = this.listeners.get(type);
        if (!callbacks) return false;
        const removed = callbacks.delete(callback);
        if (callbacks.size === 0) this.listeners.delete(type);
        return removed;
    }

    handleMessage(type, data) {
        const callbacks = this.listeners.get(type);
        if (!callbacks) return;
        for (const listener of Array.from(callbacks)) {
            try {
                listener(data);
            } catch (error) {
                console.error(`[CrossTabSync] Listener error for ${type}:`, error);
            }
        }
    }

    setupStorageListener() {
        if (this._storageListener || !this._window ||
            typeof this._window.addEventListener !== 'function') {
            return;
        }

        this._storageListener = (event) => {
            if (!event?.key || !event.key.startsWith(`${this.namespace}-`)) return;
            if (event.key === `${this.namespace}-reload-request`) {
                this.checkReloadRequest();
                return;
            }

            try {
                const storedData = JSON.parse(event.newValue);
                const messageType = event.key.replace(`${this.namespace}-`, '');
                this.handleMessage(messageType, storedData.data);
            } catch (error) {
                console.error('[CrossTabSync] Error parsing storage event:', error);
            }
        };
        this._window.addEventListener('storage', this._storageListener);
    }

    syncState(key, initialState = null) {
        const storage = this._storage;
        if (!storage) return null;

        if (initialState !== null && !storage.getItem(key)) {
            storage.setItem(key, JSON.stringify(initialState));
        }

        const originalSetItem = storage.setItem;
        if (typeof originalSetItem === 'function') {
            const wrappedSetItem = (storageKey, value) => {
                const result = originalSetItem.call(storage, storageKey, value);
                if (storageKey === key && !this._destroyed) {
                    try {
                        this.send(key, JSON.parse(value));
                    } catch {}
                }
                return result;
            };

            try {
                storage.setItem = wrappedSetItem;
                this._storagePatches.push({ storage, originalSetItem, wrappedSetItem });
            } catch {}

            this._subscriptions.push(this.on(key, (newState) => {
                try {
                    storage.setItem = originalSetItem;
                    originalSetItem.call(storage, key, JSON.stringify(newState));
                    storage.setItem = wrappedSetItem;
                } catch {}
            }));
        }

        try {
            return JSON.parse(storage.getItem(key) || 'null');
        } catch {
            return null;
        }
    }

    syncAppState(stateKey, updateCallback) {
        this._subscriptions.push(this.on(stateKey, updateCallback));
        try {
            return JSON.parse(this._storage?.getItem(stateKey) || 'null');
        } catch {
            return null;
        }
    }

    broadcastAction(actionType, actionData) {
        this.send('user-action', { type: actionType, data: actionData });
    }

    onUserAction(actionType, callback) {
        return this.on('user-action', (action) => {
            if (action?.type === actionType) callback(action.data);
        });
    }

    testCommunication() {
        const testMessage = {
            timestamp: Date.now(),
            tabId: this.generateTabId()
        };
        console.log('🧪 Sending test communication across tabs', testMessage);
        this.send('cross-tab-test', testMessage);
    }

    generateTabId() {
        return Math.random().toString(36).substr(2, 9);
    }

    checkBrowserSupport() {
        const support = {
            broadcastChannel: typeof this._BroadcastChannel === 'function',
            localStorage: this.isLocalStorageAvailable()
        };
        console.log('🌐 Browser Support:', support);
        return support;
    }

    isLocalStorageAvailable() {
        try {
            if (!this._storage) return false;
            this._storage.setItem('test', 'test');
            this._storage.removeItem('test');
            return true;
        } catch (e) {
            return false;
        }
    }

    initDebug() {
        this.testCommunication();
        this.checkBrowserSupport();
        this._subscriptions.push(this.on('cross-tab-test', (testData) => {
            console.log('✅ Cross-Tab Test Received:', testData);
        }));
    }

    /**
     * Remove every browser handler and close the channel. Calling destroy more
     * than once is safe and does not leave a storage fallback listener behind.
     */
    destroy() {
        if (this._destroyed) return true;

        if (this._window && typeof this._window.removeEventListener === 'function') {
            if (this._storageListener) {
                this._window.removeEventListener('storage', this._storageListener);
            }
            if (this._reloadStorageListener) {
                this._window.removeEventListener('storage', this._reloadStorageListener);
            }
        }

        for (const patch of this._storagePatches) {
            try {
                if (patch.storage.setItem === patch.wrappedSetItem) {
                    patch.storage.setItem = patch.originalSetItem;
                }
            } catch {}
        }
        this._storagePatches = [];

        if (this.channel) {
            if (this.channel.onmessage === this._channelMessageHandler) {
                this.channel.onmessage = null;
            }
            if (typeof this.channel.close === 'function') {
                try { this.channel.close(); } catch {}
            }
        }

        this._storageListener = null;
        this._reloadStorageListener = null;
        this._subscriptions = [];
        this.listeners.clear();
        this._destroyed = true;
        return true;
    }

    dispose() {
        return this.destroy();
    }
}

// Export a singleton instance for the browser, while remaining import-safe in
// isolated Node fixtures that intentionally have no window object.
const crossTabSync = typeof window !== 'undefined'
    ? new CrossTabSync()
    : null;

if (crossTabSync && typeof window !== 'undefined') {
    window.crossTabSync = crossTabSync;
    crossTabSync.setupStorageListener();
    crossTabSync.initDebug();
}

export { CrossTabSync };
export default crossTabSync;
