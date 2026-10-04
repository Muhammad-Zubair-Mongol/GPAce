/**
 * RecoveryModal.js
 *
 * Presents verified task backups when the active task store is empty or
 * corrupted. Recovery is deliberately asynchronous: a backup remains
 * available until the repository confirms a successful restore.
 */

class RecoveryModal {
    static _instance = null;
    static _container = null;
    static _backups = [];
    static _reason = null;
    static _resolveCallback = null;
    static _previousFocus = null;
    static _inertedElements = new Map();
    static _listenersBound = false;
    static _restoreInFlight = false;

    static init() {
        if (this._instance) return;
        this._createStyles();
        this._createDOM();
        this._setupEventListeners();
        this._instance = true;
    }

    static _createStyles() {
        if (document.getElementById('gpac-recovery-modal-styles')) return;

        const style = document.createElement('style');
        style.id = 'gpac-recovery-modal-styles';
        style.textContent = `
            .gpac-recovery-overlay {
                display: none;
                position: fixed;
                inset: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.92);
                z-index: 99999;
                justify-content: center;
                align-items: center;
                font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
            }
            .gpac-recovery-overlay.active { display: flex; }
            .gpac-recovery-modal {
                background: linear-gradient(180deg, #1a1f2e 0%, #0f1419 100%);
                border: 2px solid #9b59b6;
                border-radius: 20px;
                padding: 40px;
                max-width: 550px;
                width: min(90%, 550px);
                max-height: 90vh;
                overflow: auto;
                text-align: center;
                box-shadow: 0 30px 80px rgba(155, 89, 182, 0.3);
            }
            .gpac-recovery-icon {
                font-size: 18px;
                margin-bottom: 20px;
                display: block;
                color: #c98de4;
            }
            .gpac-recovery-title {
                font-size: 28px;
                font-weight: 700;
                color: #e8e8e8;
                margin: 0 0 12px;
            }
            .gpac-recovery-subtitle {
                font-size: 16px;
                color: #c98de4;
                margin: 0 0 24px;
            }
            .gpac-recovery-message {
                color: #c4c4c4;
                line-height: 1.6;
                margin-bottom: 24px;
            }
            .gpac-recovery-backups {
                background: rgba(0, 0, 0, 0.3);
                border-radius: 12px;
                padding: 20px;
                margin-bottom: 24px;
                text-align: left;
            }
            .gpac-recovery-backup-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 12px 16px;
                background: rgba(155, 89, 182, 0.1);
                border: 1px solid rgba(155, 89, 182, 0.2);
                border-radius: 8px;
                margin-bottom: 8px;
                cursor: pointer;
                width: 100%;
                font: inherit;
                color: inherit;
                text-align: left;
            }
            .gpac-recovery-backup-item:last-child { margin-bottom: 0; }
            .gpac-recovery-backup-item:hover,
            .gpac-recovery-backup-item.selected {
                background: rgba(155, 89, 182, 0.3);
                border-color: #9b59b6;
            }
            .gpac-recovery-backup-item[aria-disabled="true"] {
                opacity: 0.6;
                cursor: not-allowed;
            }
            .gpac-recovery-backup-info {
                display: flex;
                flex-direction: column;
                gap: 4px;
                min-width: 0;
            }
            .gpac-recovery-backup-slot {
                font-weight: 600;
                color: #e8e8e8;
                font-size: 14px;
            }
            .gpac-recovery-backup-date {
                font-size: 12px;
                color: #b8b8b8;
            }
            .gpac-recovery-backup-count {
                flex: 0 0 auto;
                background: #9b59b6;
                color: white;
                padding: 4px 12px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 600;
            }
            .gpac-recovery-actions {
                display: flex;
                gap: 16px;
                justify-content: center;
                flex-wrap: wrap;
            }
            .gpac-recovery-btn {
                min-height: 48px;
                padding: 12px 24px;
                border-radius: 12px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                border: none;
            }
            .gpac-recovery-btn-restore {
                background: linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%);
                color: white;
            }
            .gpac-recovery-btn-restore:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .gpac-recovery-btn-skip {
                background: rgba(255, 255, 255, 0.1);
                color: #c4c4c4;
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            .gpac-recovery-status {
                min-height: 1.5rem;
                margin: 16px 0 0;
                color: #e8e8e8;
            }
            .gpac-recovery-status.error { color: #ff8a80; }
            .gpac-recovery-status.success { color: #8be28b; }
            .gpac-recovery-warning {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 12px;
                background: rgba(231, 76, 60, 0.1);
                border-radius: 8px;
                margin-top: 24px;
                font-size: 12px;
                color: #ff8a80;
            }
            .gpac-recovery-btn:focus-visible,
            .gpac-recovery-backup-item:focus-visible {
                outline: 3px solid #25f4ee;
                outline-offset: 3px;
            }
            @media (prefers-reduced-motion: reduce) {
                .gpac-recovery-btn,
                .gpac-recovery-backup-item { transition: none; }
            }
        `;
        document.head.appendChild(style);
    }

    static _createDOM() {
        const existing = document.getElementById('gpac-recovery-overlay');
        if (existing) {
            this._container = existing;
            this._ensureSemantics();
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'gpac-recovery-overlay';
        overlay.className = 'gpac-recovery-overlay';
        overlay.setAttribute('aria-hidden', 'true');

        const modal = document.createElement('div');
        modal.className = 'gpac-recovery-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'gpac-recovery-title');
        modal.setAttribute('aria-describedby', 'gpac-recovery-message');
        modal.tabIndex = -1;

        const icon = document.createElement('span');
        icon.className = 'gpac-recovery-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = 'Recovery';

        const title = document.createElement('h2');
        title.id = 'gpac-recovery-title';
        title.className = 'gpac-recovery-title';
        title.textContent = 'We found your tasks';

        const reason = document.createElement('p');
        reason.id = 'gpac-recovery-reason';
        reason.className = 'gpac-recovery-subtitle';
        reason.textContent = 'A verified backup is available';

        const message = document.createElement('p');
        message.id = 'gpac-recovery-message';
        message.className = 'gpac-recovery-message';
        message.textContent = 'Your task data is empty or corrupted, but a verified backup is available. Select a backup to restore your tasks.';

        const backups = document.createElement('div');
        backups.id = 'gpac-recovery-backups';
        backups.className = 'gpac-recovery-backups';

        const actions = document.createElement('div');
        actions.className = 'gpac-recovery-actions';

        const restore = document.createElement('button');
        restore.type = 'button';
        restore.id = 'gpac-recovery-restore';
        restore.className = 'gpac-recovery-btn gpac-recovery-btn-restore';
        restore.disabled = true;
        restore.textContent = 'Restore selected';

        const skip = document.createElement('button');
        skip.type = 'button';
        skip.id = 'gpac-recovery-skip';
        skip.className = 'gpac-recovery-btn gpac-recovery-btn-skip';
        skip.textContent = 'Start fresh';
        actions.append(restore, skip);

        const status = document.createElement('p');
        status.id = 'gpac-recovery-status';
        status.className = 'gpac-recovery-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        const warning = document.createElement('div');
        warning.className = 'gpac-recovery-warning';
        warning.textContent = 'Starting fresh will leave the verified backup available for later recovery.';

        modal.append(icon, title, reason, message, backups, actions, status, warning);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        this._container = overlay;
        this._ensureSemantics();
    }

    static _ensureSemantics() {
        if (!this._container) return;
        this._container.setAttribute('aria-hidden', this._container.classList.contains('active') ? 'false' : 'true');
        const modal = this._container.querySelector('.gpac-recovery-modal');
        modal?.setAttribute('role', 'dialog');
        modal?.setAttribute('aria-modal', 'true');
        modal?.setAttribute('aria-labelledby', 'gpac-recovery-title');
        modal?.setAttribute('aria-describedby', 'gpac-recovery-message');
        if (modal) modal.tabIndex = -1;
    }

    static _normalizeBackups(backups) {
        if (!Array.isArray(backups)) return [];
        return backups.map(backup => {
            if (!backup || !String(backup.slot || '').trim()) return null;
            const taskCount = Number(backup.taskCount);
            const createdAt = new Date(backup.createdAt);
            if (!Number.isFinite(taskCount) || taskCount < 0 || Number.isNaN(createdAt.getTime())) return null;
            return {
                ...backup,
                slot: String(backup.slot),
                taskCount: Math.floor(taskCount),
                createdAt: createdAt.toISOString(),
                recoverable: taskCount > 0
            };
        }).filter(Boolean);
    }

    static show(backups, reason = 'empty') {
        this.init();
        const normalized = this._normalizeBackups(backups);
        const recoverable = normalized.filter(backup => backup.recoverable);

        if (recoverable.length === 0) {
            this._backups = normalized;
            this._reason = reason;
            if (this._container.classList.contains('active')) {
                this._finish({ action: 'defer', reason: 'no-recoverable-backup' });
            } else {
                this.hide();
            }
            return Promise.resolve({
                action: 'fresh',
                reason: 'no-recoverable-backup',
                backups: normalized
            });
        }

        if (this._container.classList.contains('active') && this._resolveCallback) {
            this._finish({ action: 'defer', reason: 'replaced' });
        }

        this._backups = normalized;
        this._reason = reason;
        this._restoreInFlight = false;
        this._previousFocus = this._capturePreviousFocus();

        const reasonElement = document.getElementById('gpac-recovery-reason');
        if (reasonElement) {
            reasonElement.textContent = reason === 'corruption'
                ? 'Data corruption detected; a verified backup is available'
                : 'A verified backup is available';
        }
        const status = document.getElementById('gpac-recovery-status');
        if (status) {
            status.className = 'gpac-recovery-status';
            status.textContent = '';
        }

        this._renderBackups();
        this._container.classList.add('active');
        this._container.setAttribute('aria-hidden', 'false');
        this._setBackgroundInert(true);
        const first = this._getFocusableElements()[0] || this._container.querySelector('.gpac-recovery-modal');
        first?.focus();
        if (window.SyncStatusIndicator?.setState) window.SyncStatusIndicator.setState('recovering');

        return new Promise(resolve => {
            this._resolveCallback = resolve;
        });
    }

    static hide({ resolveAction } = {}) {
        if (this._container) {
            this._container.classList.remove('active');
            this._container.setAttribute('aria-hidden', 'true');
        }
        this._setBackgroundInert(false);
        this._restoreInFlight = false;

        if (resolveAction !== undefined && this._resolveCallback) {
            const resolve = this._resolveCallback;
            this._resolveCallback = null;
            resolve(resolveAction);
        }

        const focusTarget = this._previousFocus?.isConnected ? this._previousFocus : null;
        focusTarget?.focus?.();
        this._previousFocus = null;
    }

    static _capturePreviousFocus() {
        const active = document.activeElement;
        if (active && active !== document.body && active !== document.documentElement && active.isConnected) {
            return active;
        }

        return Array.from(document.querySelectorAll(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).find(element => !this._container?.contains(element)) || null;
    }

    static _finish(result) {
        const resolve = this._resolveCallback;
        this._resolveCallback = null;
        this.hide();
        resolve?.(result);
    }

    static _setBackgroundInert(shouldInert) {
        if (shouldInert) {
            this._inertedElements.clear();
            Array.from(document.body.children).forEach(element => {
                if (element === this._container) return;
                this._inertedElements.set(element, {
                    property: Boolean(element.inert),
                    attribute: element.hasAttribute('inert')
                });
                element.inert = true;
                element.setAttribute('inert', '');
            });
            return;
        }

        for (const [element, previous] of this._inertedElements) {
            if (!element.isConnected) continue;
            element.inert = previous.property;
            if (previous.attribute) element.setAttribute('inert', '');
            else element.removeAttribute('inert');
        }
        this._inertedElements.clear();
    }

    static _getFocusableElements() {
        return Array.from(this._container?.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []);
    }

    static _renderBackups() {
        const container = document.getElementById('gpac-recovery-backups');
        if (!container) return;

        const slotLabels = {
            latest: 'Latest backup',
            '1h': '1 hour ago',
            '6h': '6 hours ago',
            '24h': '24 hours ago',
            manual: 'Manual backup'
        };

        container.replaceChildren();
        let selected = false;
        this._backups.forEach(backup => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'gpac-recovery-backup-item';
            item.dataset.slot = backup.slot;
            item.disabled = !backup.recoverable;
            item.setAttribute('aria-disabled', String(!backup.recoverable));
            item.setAttribute('aria-pressed', 'false');

            if (backup.recoverable && !selected) {
                selected = true;
                item.classList.add('selected');
                item.setAttribute('aria-pressed', 'true');
            }

            const info = document.createElement('span');
            info.className = 'gpac-recovery-backup-info';
            const slot = document.createElement('span');
            slot.className = 'gpac-recovery-backup-slot';
            slot.textContent = slotLabels[backup.slot] || backup.slot;
            const date = document.createElement('span');
            date.className = 'gpac-recovery-backup-date';
            date.textContent = new Date(backup.createdAt).toLocaleString();
            info.append(slot, date);

            const count = document.createElement('span');
            count.className = 'gpac-recovery-backup-count';
            count.textContent = backup.recoverable ? `${backup.taskCount} tasks` : 'Empty backup';
            item.append(info, count);
            container.appendChild(item);
        });

        const restore = document.getElementById('gpac-recovery-restore');
        if (restore) {
            restore.disabled = !selected;
            restore.removeAttribute('data-completed');
            restore.textContent = 'Restore selected';
        }
    }

    static _getSelectedSlot() {
        return this._container?.querySelector('.gpac-recovery-backup-item.selected')?.dataset.slot || null;
    }

    static _setupEventListeners() {
        if (this._listenersBound) return;
        this._listenersBound = true;

        window.addEventListener('gpac_recovery_needed', event => {
            this.show(event.detail?.backups || [], event.detail?.reason || 'empty');
        });

        document.addEventListener('click', event => {
            if (!this._container?.classList.contains('active')) return;
            const target = event.target;
            const item = target.closest?.('.gpac-recovery-backup-item');
            if (item && !item.disabled && item.getAttribute('aria-disabled') !== 'true') {
                this._container.querySelectorAll('.gpac-recovery-backup-item').forEach(candidate => {
                    candidate.classList.remove('selected');
                    candidate.setAttribute('aria-pressed', 'false');
                });
                item.classList.add('selected');
                item.setAttribute('aria-pressed', 'true');
                const restore = document.getElementById('gpac-recovery-restore');
                if (restore) restore.disabled = false;
                return;
            }

            if (target.id === 'gpac-recovery-restore') {
                if (target.dataset.completed === 'true') this.hide();
                else this._restoreSelected();
                return;
            }

            if (target.id === 'gpac-recovery-skip') {
                const confirmed = typeof window.confirm === 'function'
                    ? window.confirm('Start fresh? Your verified backups will remain available for later recovery.')
                    : true;
                if (confirmed) this._finish({ action: 'skip' });
            }
        });

        document.addEventListener('keydown', event => {
            if (!this._container?.classList.contains('active')) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this._finish({ action: 'defer', reason: 'dismissed' });
                return;
            }

            if (event.key !== 'Tab') return;
            const focusable = this._getFocusableElements();
            if (focusable.length === 0) {
                event.preventDefault();
                this._container.querySelector('.gpac-recovery-modal')?.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
    }

    static _restoreSelected() {
        if (this._restoreInFlight) return;
        const slot = this._getSelectedSlot();
        if (!slot) return;

        const restore = document.getElementById('gpac-recovery-restore');
        const status = document.getElementById('gpac-recovery-status');
        const repository = window.TaskRepository;
        this._restoreInFlight = true;
        if (restore) {
            restore.disabled = true;
            restore.textContent = 'Restoring...';
        }
        if (status) {
            status.className = 'gpac-recovery-status';
            status.textContent = 'Restoring your verified backup...';
        }

        Promise.resolve()
            .then(() => {
                if (!repository || typeof repository.forceRecoveryFromBackup !== 'function') {
                    throw new Error('Recovery service is unavailable');
                }
                return repository.forceRecoveryFromBackup(slot);
            })
            .then(result => {
                if (result !== true && result?.success !== true) {
                    throw new Error('The backup could not be restored.');
                }
                this._restoreInFlight = false;
                if (status) {
                    status.className = 'gpac-recovery-status success';
                    status.textContent = 'Backup restored successfully.';
                }
                if (restore) {
                    restore.disabled = false;
                    restore.dataset.completed = 'true';
                    restore.textContent = 'Done';
                }
                const resolve = this._resolveCallback;
                this._resolveCallback = null;
                resolve?.({ action: 'restore', slot, result });
                if (window.SyncStatusIndicator?.synced) window.SyncStatusIndicator.synced();
            })
            .catch(error => {
                this._restoreInFlight = false;
                if (restore) {
                    restore.disabled = false;
                    restore.textContent = 'Retry restore';
                }
                if (status) {
                    status.className = 'gpac-recovery-status error';
                    status.textContent = error?.message || 'Restore failed. The backup is still available; retry when ready.';
                }
            });
    }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => RecoveryModal.init(), { once: true });
    } else {
        RecoveryModal.init();
    }
}

export default RecoveryModal;
export { RecoveryModal };

if (typeof window !== 'undefined') window.RecoveryModal = RecoveryModal;
