/**
 * SyncStatusIndicator.js
 * 
 * Global sync status widget for every GPAce page.
 * Shows real-time sync status in top-right corner.
 * 
 * @version 1.0.0
 * @created December 12, 2025
 */

class SyncStatusIndicator {
    static _instance = null;
    static _container = null;
    static _state = 'synced';
    static _lastSync = Date.now();
    static _updateInterval = null;

    /**
     * Initialize and inject the sync status indicator.
     */
    static init() {
        if (this._instance) return;

        this._createStyles();
        this._createDOM();
        this._startUpdates();
        this._setupEventListeners();

        this._instance = true;
        console.log('[SyncStatusIndicator] Initialized');
    }

    /**
     * Create component styles.
     */
    static _createStyles() {
        if (document.getElementById('gpac-sync-indicator-styles')) return;

        const style = document.createElement('style');
        style.id = 'gpac-sync-indicator-styles';
        style.textContent = `
            .gpac-sync-indicator {
                position: fixed;
                top: 55px;
                right: 12px;
                z-index: 999;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 12px;
                background: rgba(22, 22, 31, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 11px;
                color: #a0a0a0;
                backdrop-filter: blur(10px);
                transition: all 0.3s ease;
                cursor: pointer;
                user-select: none;
                pointer-events: auto;
            }
            
            .gpac-sync-indicator:hover {
                background: rgba(30, 30, 45, 0.98);
                border-color: rgba(255, 255, 255, 0.2);
            }
            
            .gpac-sync-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                transition: all 0.3s ease;
            }
            
            .gpac-sync-indicator[data-state="synced"] .gpac-sync-dot {
                background: #27AE60;
                box-shadow: 0 0 6px rgba(39, 174, 96, 0.5);
            }
            
            .gpac-sync-indicator[data-state="syncing"] .gpac-sync-dot {
                background: #F39C12;
                box-shadow: 0 0 6px rgba(243, 156, 18, 0.5);
                animation: gpac-pulse 1s ease-in-out infinite;
            }
            
            .gpac-sync-indicator[data-state="conflict"] .gpac-sync-dot {
                background: #E74C3C;
                box-shadow: 0 0 8px rgba(231, 76, 60, 0.7);
                animation: gpac-pulse-red 0.5s ease-in-out infinite;
            }
            
            .gpac-sync-indicator[data-state="recovering"] .gpac-sync-dot {
                background: #9B59B6;
                box-shadow: 0 0 6px rgba(155, 89, 182, 0.5);
                animation: gpac-pulse 1.5s ease-in-out infinite;
            }
            
            .gpac-sync-indicator[data-state="offline"] .gpac-sync-dot {
                background: #7f8c8d;
                box-shadow: none;
            }
            
            .gpac-sync-icon {
                font-size: 14px;
                transition: all 0.3s ease;
            }
            
            .gpac-sync-indicator[data-state="syncing"] .gpac-sync-icon {
                animation: gpac-spin 1s linear infinite;
            }
            
            .gpac-sync-text {
                white-space: nowrap;
            }
            
            .gpac-sync-indicator[data-state="conflict"] {
                background: rgba(231, 76, 60, 0.15);
                border-color: rgba(231, 76, 60, 0.5);
                color: #E74C3C;
            }
            
            .gpac-sync-indicator[data-state="offline"] {
                opacity: 0.7;
            }
            
            @keyframes gpac-pulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.5; transform: scale(1.2); }
            }
            
            @keyframes gpac-pulse-red {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.7; transform: scale(1.3); }
            }
            
            @keyframes gpac-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Create DOM elements.
     */
    static _createDOM() {
        if (document.getElementById('gpac-sync-indicator')) return;

        this._container = document.createElement('div');
        this._container.id = 'gpac-sync-indicator';
        this._container.className = 'gpac-sync-indicator';
        this._container.setAttribute('data-state', 'synced');
        this._container.setAttribute('title', 'Click for sync details');

        this._container.innerHTML = `
            <span class="gpac-sync-dot"></span>
            <span class="gpac-sync-icon">✓</span>
            <span class="gpac-sync-text">Synced just now</span>
        `;

        this._container.addEventListener('click', () => this._showDetails());

        document.body.appendChild(this._container);
    }

    /**
     * Set sync state.
     * @param {string} state - 'synced' | 'syncing' | 'conflict' | 'recovering' | 'offline'
     * @param {string} [message] - Optional custom message
     */
    static setState(state, message) {
        this._state = state;

        if (!this._container) return;

        this._container.setAttribute('data-state', state);

        const textEl = this._container.querySelector('.gpac-sync-text');
        const iconEl = this._container.querySelector('.gpac-sync-icon');

        if (message) {
            textEl.textContent = message;
        } else {
            switch (state) {
                case 'synced':
                    iconEl.textContent = '✓';
                    this._updateSyncedTime();
                    break;
                case 'syncing':
                    textEl.textContent = 'Syncing…';
                    iconEl.textContent = '↻';
                    break;
                case 'conflict':
                    textEl.textContent = 'Conflict – Resolve now';
                    iconEl.textContent = '⚠';
                    break;
                case 'recovering':
                    textEl.textContent = 'Recovering from backup…';
                    iconEl.textContent = '⟳';
                    break;
                case 'offline':
                    textEl.textContent = 'Offline';
                    iconEl.textContent = '○';
                    break;
            }
        }

        if (state === 'synced') {
            this._lastSync = Date.now();
        }
    }

    /**
     * Mark sync complete.
     */
    static synced() {
        this.setState('synced');
    }

    /**
     * Start updates for time display.
     */
    static _startUpdates() {
        this._updateInterval = setInterval(() => {
            if (this._state === 'synced') {
                this._updateSyncedTime();
            }
        }, 5000);
    }

    /**
     * Update synced time display.
     */
    static _updateSyncedTime() {
        if (!this._container) return;

        const textEl = this._container.querySelector('.gpac-sync-text');
        const seconds = Math.floor((Date.now() - this._lastSync) / 1000);

        if (seconds < 5) {
            textEl.textContent = 'Synced just now';
        } else if (seconds < 60) {
            textEl.textContent = `Synced ${seconds}s ago`;
        } else if (seconds < 3600) {
            const mins = Math.floor(seconds / 60);
            textEl.textContent = `Synced ${mins}m ago`;
        } else {
            const hours = Math.floor(seconds / 3600);
            textEl.textContent = `Synced ${hours}h ago`;
        }
    }

    /**
     * Show sync details popup.
     */
    static _showDetails() {
        // Get backup info if available
        let backupInfo = '';
        if (window.TaskRepository) {
            const backups = window.TaskRepository.listBackups();
            if (backups.length > 0) {
                backupInfo = `\n\nBackups available: ${backups.length}`;
                backups.forEach(b => {
                    backupInfo += `\n• ${b.slot}: ${b.taskCount} tasks (${new Date(b.createdAt).toLocaleString()})`;
                });
            }
        }

        alert(`Sync Status: ${this._state}\n\nDevice ID: ${localStorage.getItem('gpac_device_id') || 'Unknown'}\n\nLast Sync: ${new Date(this._lastSync).toLocaleString()}${backupInfo}`);
    }

    /**
     * Set up event listeners.
     */
    static _setupEventListeners() {
        // Online/offline status
        window.addEventListener('online', () => {
            if (this._state === 'offline') {
                this.setState('syncing');
                setTimeout(() => this.synced(), 1000);
            }
        });

        window.addEventListener('offline', () => {
            this.setState('offline');
        });

        // Initial offline check
        if (!navigator.onLine) {
            this.setState('offline');
        }

        // Listen for conflict events
        window.addEventListener('gpac_conflict', () => {
            this.setState('conflict');
        });

        // Listen for recovery events
        window.addEventListener('gpac_recovery_needed', () => {
            this.setState('recovering');
        });
    }

    /**
     * Destroy the indicator.
     */
    static destroy() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
        }
        if (this._container) {
            this._container.remove();
        }
        this._instance = null;
    }
}

// Auto-init when DOM is ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => SyncStatusIndicator.init());
    } else {
        SyncStatusIndicator.init();
    }
}

// Export
export default SyncStatusIndicator;
export { SyncStatusIndicator };

if (typeof window !== 'undefined') {
    window.SyncStatusIndicator = SyncStatusIndicator;
}
