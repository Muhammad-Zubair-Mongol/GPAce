/**
 * GeminiKeyManagerUI.js
 * UI components for the GeminiKeyManager
 * 
 * Provides:
 * - Key status badge (shows active key indicator)
 * - Key management modal
 * - Toast notifications for key events
 * 
 * @author GPAce Team
 * @version 1.0.0
 */

class GeminiKeyManagerUI {
    constructor(manager) {
        this.manager = manager || window.geminiKeyManager;
        this.modalId = 'geminiKeyManagerModal';
        this.badgeId = 'geminiKeyStatusBadge';

        // Inject styles
        this.injectStyles();
    }

    /**
     * Inject CSS styles for the UI components
     */
    injectStyles() {
        if (document.getElementById('gemini-key-manager-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'gemini-key-manager-styles';
        styles.textContent = `
            /* Key Status Badge */
            .gemini-key-badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 4px 10px;
                background: linear-gradient(135deg, rgba(66, 133, 244, 0.15), rgba(52, 168, 83, 0.15));
                border: 1px solid rgba(66, 133, 244, 0.3);
                border-radius: 20px;
                font-size: 11px;
                font-weight: 500;
                color: var(--text-primary, #e0e0e0);
                cursor: pointer;
                transition: all 0.2s ease;
            }
            
            .gemini-key-badge:hover {
                background: linear-gradient(135deg, rgba(66, 133, 244, 0.25), rgba(52, 168, 83, 0.25));
                transform: translateY(-1px);
            }
            
            .gemini-key-badge .key-indicator {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #34a853;
                animation: pulse-green 2s infinite;
            }
            
            .gemini-key-badge.warning .key-indicator {
                background: #fbbc04;
                animation: pulse-yellow 2s infinite;
            }
            
            .gemini-key-badge.error .key-indicator {
                background: #ea4335;
                animation: pulse-red 1s infinite;
            }
            
            @keyframes pulse-green {
                0%, 100% { box-shadow: 0 0 0 0 rgba(52, 168, 83, 0.4); }
                50% { box-shadow: 0 0 0 4px rgba(52, 168, 83, 0); }
            }
            
            @keyframes pulse-yellow {
                0%, 100% { box-shadow: 0 0 0 0 rgba(251, 188, 4, 0.4); }
                50% { box-shadow: 0 0 0 4px rgba(251, 188, 4, 0); }
            }
            
            @keyframes pulse-red {
                0%, 100% { box-shadow: 0 0 0 0 rgba(234, 67, 53, 0.4); }
                50% { box-shadow: 0 0 0 4px rgba(234, 67, 53, 0); }
            }
            
            /* Key Manager Modal */
            .gemini-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(4px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10001;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease;
            }
            
            .gemini-modal-overlay.active {
                opacity: 1;
                visibility: visible;
            }
            
            .gemini-modal {
                background: var(--bg-primary, #1a1a2e);
                border: 1px solid var(--border-color, #333);
                border-radius: 16px;
                width: 90%;
                max-width: 600px;
                max-height: 90vh;
                overflow: hidden;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                transform: translateY(20px);
                transition: transform 0.3s ease;
            }
            
            .gemini-modal-overlay.active .gemini-modal {
                transform: translateY(0);
            }
            
            .gemini-modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px 24px;
                border-bottom: 1px solid var(--border-color, #333);
                background: linear-gradient(135deg, rgba(66, 133, 244, 0.1), rgba(52, 168, 83, 0.05));
            }
            
            .gemini-modal-header h3 {
                margin: 0;
                font-size: 18px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .gemini-modal-header h3 i {
                color: #4285f4;
            }
            
            .gemini-modal-close {
                background: none;
                border: none;
                font-size: 20px;
                color: var(--text-secondary, #888);
                cursor: pointer;
                padding: 4px 8px;
                border-radius: 8px;
                transition: all 0.2s;
            }
            
            .gemini-modal-close:hover {
                background: rgba(255, 255, 255, 0.1);
                color: var(--text-primary, #fff);
            }
            
            .gemini-modal-body {
                padding: 24px;
                overflow-y: auto;
                max-height: 60vh;
            }
            
            /* Status Summary */
            .gemini-status-summary {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                gap: 12px;
                margin-bottom: 24px;
                padding: 16px;
                background: var(--bg-secondary, #252538);
                border-radius: 12px;
            }
            
            .status-item {
                text-align: center;
            }
            
            .status-item .value {
                font-size: 24px;
                font-weight: 700;
                color: var(--accent-color, #4285f4);
            }
            
            .status-item .label {
                font-size: 11px;
                color: var(--text-secondary, #888);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            /* Key List */
            .gemini-key-list {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            
            .gemini-key-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                background: var(--bg-secondary, #252538);
                border: 1px solid var(--border-color, #333);
                border-radius: 10px;
                transition: all 0.2s;
            }
            
            .gemini-key-item:hover {
                border-color: rgba(66, 133, 244, 0.5);
            }
            
            .gemini-key-item.unhealthy {
                border-color: rgba(234, 67, 53, 0.5);
                opacity: 0.7;
            }
            
            .gemini-key-item.active {
                border-color: #34a853;
                box-shadow: 0 0 0 1px rgba(52, 168, 83, 0.3);
            }
            
            .key-health-indicator {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                flex-shrink: 0;
            }
            
            .key-health-indicator.healthy { background: #34a853; }
            .key-health-indicator.unhealthy { background: #ea4335; }
            
            .key-info {
                flex: 1;
                min-width: 0;
            }
            
            .key-name {
                font-weight: 500;
                font-size: 14px;
                color: var(--text-primary, #e0e0e0);
            }
            
            .key-meta {
                font-size: 11px;
                color: var(--text-secondary, #888);
                display: flex;
                gap: 12px;
                margin-top: 2px;
            }
            
            .key-actions {
                display: flex;
                gap: 8px;
            }
            
            .key-action-btn {
                background: none;
                border: 1px solid var(--border-color, #444);
                color: var(--text-secondary, #888);
                padding: 6px 10px;
                border-radius: 6px;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .key-action-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: var(--text-primary, #fff);
            }
            
            .key-action-btn.danger:hover {
                border-color: #ea4335;
                color: #ea4335;
            }
            
            /* Add Key Form */
            .add-key-section {
                margin-top: 24px;
                padding-top: 24px;
                border-top: 1px solid var(--border-color, #333);
            }
            
            .add-key-form {
                display: flex;
                gap: 12px;
            }
            
            .add-key-form input {
                flex: 1;
                padding: 10px 14px;
                background: var(--bg-secondary, #252538);
                border: 1px solid var(--border-color, #444);
                border-radius: 8px;
                color: var(--text-primary, #e0e0e0);
                font-size: 14px;
            }
            
            .add-key-form input:focus {
                outline: none;
                border-color: #4285f4;
            }
            
            .add-key-form button {
                padding: 10px 20px;
                background: linear-gradient(135deg, #4285f4, #34a853);
                border: none;
                border-radius: 8px;
                color: white;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .add-key-form button:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(66, 133, 244, 0.4);
            }
            
            /* Modal Footer */
            .gemini-modal-footer {
                display: flex;
                justify-content: space-between;
                padding: 16px 24px;
                border-top: 1px solid var(--border-color, #333);
                background: var(--bg-secondary, #252538);
            }
            
            .footer-left {
                display: flex;
                gap: 8px;
            }
            
            .footer-btn {
                padding: 8px 16px;
                border: 1px solid var(--border-color, #444);
                background: none;
                border-radius: 8px;
                color: var(--text-secondary, #888);
                font-size: 13px;
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .footer-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: var(--text-primary, #fff);
            }
            
            .footer-btn.primary {
                background: linear-gradient(135deg, #4285f4, #34a853);
                border: none;
                color: white;
            }
        `;

        document.head.appendChild(styles);
    }

    /**
     * Create and render the status badge
     * @param {HTMLElement} container - Container to append badge to
     */
    renderBadge(container) {
        if (!container) return null;

        let badge = document.getElementById(this.badgeId);
        if (!badge) {
            badge = document.createElement('div');
            badge.id = this.badgeId;
            badge.className = 'gemini-key-badge';
            badge.onclick = () => this.showModal();
            container.appendChild(badge);
        }

        this.updateBadge();
        return badge;
    }

    /**
     * Update the badge with current status
     */
    updateBadge() {
        const badge = document.getElementById(this.badgeId);
        if (!badge) return;

        const status = this.manager.getStatus();

        let className = 'gemini-key-badge';
        if (status.allExhausted) {
            className += ' error';
        } else if (status.isLowQuota) {
            className += ' warning';
        }

        badge.className = className;
        badge.innerHTML = `
            <span class="key-indicator"></span>
            <span>Gemini (Key ${status.currentKeyIndex}/${status.totalKeys})</span>
        `;
    }

    /**
     * Show the key management modal
     */
    showModal() {
        let overlay = document.getElementById(this.modalId);

        if (!overlay) {
            overlay = this.createModal();
            document.body.appendChild(overlay);
        }

        this.updateModalContent();

        // Show with animation
        requestAnimationFrame(() => {
            overlay.classList.add('active');
        });
    }

    /**
     * Hide the modal
     */
    hideModal() {
        const overlay = document.getElementById(this.modalId);
        if (overlay) {
            overlay.classList.remove('active');
        }
    }

    /**
     * Create the modal structure
     */
    createModal() {
        const overlay = document.createElement('div');
        overlay.id = this.modalId;
        overlay.className = 'gemini-modal-overlay';
        overlay.onclick = (e) => {
            if (e.target === overlay) this.hideModal();
        };

        overlay.innerHTML = `
            <div class="gemini-modal">
                <div class="gemini-modal-header">
                    <h3><i class="fas fa-key"></i> Gemini API Key Manager</h3>
                    <button class="gemini-modal-close" onclick="window.geminiKeyManagerUI?.hideModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="gemini-modal-body">
                    <div class="gemini-status-summary" id="geminiStatusSummary">
                        <!-- Status items populated dynamically -->
                    </div>
                    
                    <div class="gemini-key-list" id="geminiKeyList">
                        <!-- Key items populated dynamically -->
                    </div>
                    
                    <div class="add-key-section">
                        <div class="add-key-form">
                            <input type="password" id="newGeminiKeyInput" placeholder="Enter new API key (AIzaSy...)">
                            <input type="text" id="newGeminiKeyName" placeholder="Key name" style="max-width: 150px;">
                            <button onclick="window.geminiKeyManagerUI?.handleAddKey()">
                                <i class="fas fa-plus"></i> Add
                            </button>
                        </div>
                    </div>
                </div>
                
                <div class="gemini-modal-footer">
                    <div class="footer-left">
                        <button class="footer-btn" onclick="window.geminiKeyManagerUI?.handleExport()">
                            <i class="fas fa-download"></i> Export
                        </button>
                        <button class="footer-btn" onclick="window.geminiKeyManagerUI?.handleImport()">
                            <i class="fas fa-upload"></i> Import
                        </button>
                        <button class="footer-btn" onclick="window.geminiKeyManagerUI?.handleReset()">
                            <i class="fas fa-redo"></i> Reset All
                        </button>
                    </div>
                    <button class="footer-btn primary" onclick="window.geminiKeyManagerUI?.hideModal()">
                        Done
                    </button>
                </div>
            </div>
        `;

        return overlay;
    }

    /**
     * Update modal content with current data
     */
    updateModalContent() {
        const status = this.manager.getStatus();

        // Update status summary
        const summaryEl = document.getElementById('geminiStatusSummary');
        if (summaryEl) {
            summaryEl.innerHTML = `
                <div class="status-item">
                    <div class="value">${status.healthyKeys}/${status.totalKeys}</div>
                    <div class="label">Healthy Keys</div>
                </div>
                <div class="status-item">
                    <div class="value">${status.currentKeyName}</div>
                    <div class="label">Active Key</div>
                </div>
                <div class="status-item">
                    <div class="value">${status.usedQuota}</div>
                    <div class="label">Used Today</div>
                </div>
                <div class="status-item">
                    <div class="value" style="color: ${status.isLowQuota ? '#fbbc04' : '#34a853'}">${status.percentRemaining}%</div>
                    <div class="label">Quota Left</div>
                </div>
            `;
        }

        // Update key list
        const listEl = document.getElementById('geminiKeyList');
        if (listEl) {
            const currentKey = this.manager.getCurrentKey();

            listEl.innerHTML = this.manager.keys.map(key => {
                const isActive = currentKey && currentKey.id === key.id;
                const maskedKey = key.key.substring(0, 10) + '...' + key.key.substring(key.key.length - 4);

                return `
                    <div class="gemini-key-item ${key.healthy ? '' : 'unhealthy'} ${isActive ? 'active' : ''}">
                        <div class="key-health-indicator ${key.healthy ? 'healthy' : 'unhealthy'}"></div>
                        <div class="key-info">
                            <div class="key-name">${key.name} ${isActive ? '(Active)' : ''}</div>
                            <div class="key-meta">
                                <span>${maskedKey}</span>
                                <span>Used: ${key.usageToday}</span>
                                ${key.lastError ? `<span style="color: #ea4335">Error: ${key.lastError.substring(0, 30)}...</span>` : ''}
                            </div>
                        </div>
                        <div class="key-actions">
                            <button class="key-action-btn" onclick="window.geminiKeyManagerUI?.testKey('${key.id}')" title="Test key">
                                <i class="fas fa-vial"></i>
                            </button>
                            <button class="key-action-btn danger" onclick="window.geminiKeyManagerUI?.removeKey('${key.id}')" title="Remove key">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('') || '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No API keys configured. Add your first key below.</div>';
        }
    }

    /**
     * Handle adding a new key
     */
    handleAddKey() {
        const keyInput = document.getElementById('newGeminiKeyInput');
        const nameInput = document.getElementById('newGeminiKeyName');

        const key = keyInput?.value?.trim();
        const name = nameInput?.value?.trim() || `Key ${this.manager.keys.length + 1}`;

        if (!key) {
            this.showToast('Please enter an API key', 'error');
            return;
        }

        if (!key.startsWith('AIza')) {
            this.showToast('Invalid API key format. Should start with AIza...', 'error');
            return;
        }

        try {
            this.manager.addKey({ key, name });
            this.showToast(`Added key: ${name}`, 'success');
            this.updateModalContent();
            this.updateBadge();

            // Clear inputs
            if (keyInput) keyInput.value = '';
            if (nameInput) nameInput.value = '';
        } catch (e) {
            this.showToast(e.message, 'error');
        }
    }

    /**
     * Remove a key
     */
    removeKey(keyId) {
        if (!confirm('Are you sure you want to remove this key?')) return;

        const removed = this.manager.removeKey(keyId);
        if (removed) {
            this.showToast(`Removed key: ${removed.name}`, 'success');
            this.updateModalContent();
            this.updateBadge();
        }
    }

    /**
     * Test a specific key
     */
    async testKey(keyId) {
        const key = this.manager.keys.find(k => k.id === keyId);
        if (!key) return;

        this.showToast(`Testing ${key.name}...`, 'info');

        const result = await this.manager.testKey(key.key);

        if (result.success) {
            key.healthy = true;
            key.failCount = 0;
            key.lastError = null;
            this.manager.saveToStorage();
            this.showToast(`${key.name} is working!`, 'success');
        } else {
            this.showToast(`${key.name} failed: ${result.message}`, 'error');
        }

        this.updateModalContent();
        this.updateBadge();
    }

    /**
     * Export keys
     */
    handleExport() {
        const json = this.manager.exportKeys();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'gemini-api-keys.json';
        a.click();

        URL.revokeObjectURL(url);
        this.showToast('Keys exported successfully', 'success');
    }

    /**
     * Import keys
     */
    handleImport() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const count = this.manager.importKeys(text);
                this.showToast(`Imported ${count} keys`, 'success');
                this.updateModalContent();
                this.updateBadge();
            } catch (err) {
                this.showToast(err.message, 'error');
            }
        };

        input.click();
    }

    /**
     * Reset all keys
     */
    handleReset() {
        if (!confirm('Reset all keys? This will clear error states and restore health.')) return;

        this.manager.resetAllKeys();
        this.showToast('All keys reset', 'success');
        this.updateModalContent();
        this.updateBadge();
    }

    /**
     * Show a toast notification
     */
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `alert alert-${type === 'error' ? 'danger' : type === 'success' ? 'success' : 'info'}`;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 10002;
            animation: slideIn 0.3s ease;
            max-width: 400px;
        `;
        toast.textContent = message;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// Create singleton instance
const geminiKeyManagerUI = new GeminiKeyManagerUI();

// Expose globally
window.GeminiKeyManagerUI = GeminiKeyManagerUI;
window.geminiKeyManagerUI = geminiKeyManagerUI;

// Export for ES modules
export { GeminiKeyManagerUI, geminiKeyManagerUI };
export default geminiKeyManagerUI;
