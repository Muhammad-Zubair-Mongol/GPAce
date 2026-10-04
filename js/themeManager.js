/**
 * Canonical GPAce theme API.
 *
 * `theme-manager.js` is a classic-script compatibility facade for pages that
 * still load the historical filename. All state and preference handling lives
 * here so pages cannot accidentally create competing theme implementations.
 */

const runtimeWindow = typeof window !== 'undefined' ? window : globalThis;

function resolveDocument(documentRef) {
    return documentRef || runtimeWindow?.document || (typeof document !== 'undefined' ? document : null);
}

function resolveStorage(storage) {
    if (storage) return storage;
    if (runtimeWindow?.StorageAdapter?.getStorage) {
        try {
            return runtimeWindow.StorageAdapter.getStorage();
        } catch {}
    }
    if (runtimeWindow?.StorageService) return runtimeWindow.StorageService;
    if (runtimeWindow?.localStorage) {
        return {
            get(key, fallback) {
                const raw = runtimeWindow.localStorage.getItem(key);
                if (raw === null || raw === undefined) return fallback;
                if (raw === 'light' || raw === 'dark') return raw;
                try { return JSON.parse(raw); } catch { return raw; }
            },
            set(key, value) {
                runtimeWindow.localStorage.setItem(key, value);
                return { success: true, status: 'success', value };
            }
        };
    }
    return null;
}

function unwrapStorageValue(value, fallback = null) {
    if (value && typeof value === 'object' && 'success' in value && 'value' in value) {
        return value.success ? value.value : fallback;
    }
    return value === undefined ? fallback : value;
}

function normalizeTheme(theme) {
    if (theme === 'light' || theme === 'dark') return theme;
    if (typeof theme === 'string') {
        const clean = theme.replace(/^["']|["']$/g, '').trim().toLowerCase();
        if (clean === 'light' || clean === 'dark') return clean;
    }
    return null;
}

class ThemeManager {
    constructor(options = {}) {
        this.document = options.document || null;
        this.window = options.window || runtimeWindow;
        this.storage = options.storage || null;
        this.currentTheme = null;
        this.lastStorageError = null;
        this._syncListenersBound = false;
        this._broadcastChannel = null;
    }

    configure(options = {}) {
        if (options.document || options.documentRef) this.document = options.document || options.documentRef;
        if (options.window || options.windowRef) this.window = options.window || options.windowRef;
        if (options.storage) this.storage = options.storage;
        return this;
    }

    _getDocument() {
        return resolveDocument(this.document);
    }

    _getStorage() {
        if (!this.storage) this.storage = resolveStorage();
        return this.storage;
    }

    _readPreference() {
        const storage = this._getStorage();
        let value = null;
        if (storage && typeof storage.get === 'function') {
            try {
                value = normalizeTheme(unwrapStorageValue(storage.get('theme', null), null));
            } catch (error) {
                this.lastStorageError = error;
            }
        }
        if (!value) {
            try {
                const raw = this.window?.localStorage?.getItem('theme');
                if (raw !== null && raw !== undefined) {
                    value = normalizeTheme(raw);
                }
            } catch (error) {
                this.lastStorageError = error;
            }
        }
        if (!value && this.window?.localStorage) {
            try {
                const anon = this.window.localStorage.getItem('gpace_anon_theme');
                if (anon !== null && anon !== undefined) {
                    value = normalizeTheme(anon);
                }
            } catch (error) {
                this.lastStorageError = error;
            }
        }
        if (!value && this.window?.localStorage) {
            try {
                for (let i = 0; i < this.window.localStorage.length; i++) {
                    const key = this.window.localStorage.key(i);
                    if (key && key.endsWith('_theme')) {
                        const candidate = normalizeTheme(this.window.localStorage.getItem(key));
                        if (candidate) {
                            value = candidate;
                            break;
                        }
                    }
                }
            } catch (error) {
                this.lastStorageError = error;
            }
        }
        return value;
    }

    _systemPreference() {
        try {
            const media = this.window?.matchMedia?.('(prefers-color-scheme: dark)');
            if (media && typeof media.matches === 'boolean') return media.matches ? 'dark' : 'light';
        } catch (error) {
            this.lastStorageError = error;
        }
        return 'dark';
    }

    _bindControls() {
        const documentRef = this._getDocument();
        if (!documentRef) return;

        const controls = typeof documentRef.querySelectorAll === 'function'
            ? Array.from(documentRef.querySelectorAll('.theme-toggle, #themeToggleBtn'))
            : [];
        controls.forEach(control => {
            if (control.dataset?.themeManagerBound === 'true' ||
                control.getAttribute?.('data-theme-manager-bound') === 'true' ||
                control.dataset?.workspaceBound === 'true') return;
            control.addEventListener?.('click', (event) => {
                event?.preventDefault?.();
                this.toggleTheme();
            });
            if (control.dataset) control.dataset.themeManagerBound = 'true';
            control.setAttribute?.('data-theme-manager-bound', 'true');
        });
    }

    _updateControls(theme) {
        const documentRef = this._getDocument();
        if (!documentRef) return;
        const controls = typeof documentRef.querySelectorAll === 'function'
            ? Array.from(documentRef.querySelectorAll('.theme-toggle, #themeToggleBtn'))
            : [];

        controls.forEach(control => {
            const icon = control.querySelector?.('.theme-icon, i.bi');
            const label = control.querySelector?.('.theme-text');
            const nextAction = theme === 'light' ? 'Dark Mode' : 'Light Mode';
            if (icon) {
                const isBi = icon.classList?.contains?.('bi') || icon.tagName === 'I';
                if (icon.classList) {
                    if (theme === 'light') {
                        icon.classList.remove?.('bi-moon-stars', 'bi-moon');
                        icon.classList.add?.('bi-sun');
                    } else {
                        icon.classList.remove?.('bi-sun');
                        icon.classList.add?.('bi-moon-stars');
                    }
                }
                if (isBi) {
                    icon.textContent = '';
                } else {
                    icon.textContent = theme === 'light' ? '🌞' : '🌙';
                }
                icon.setAttribute?.('aria-hidden', 'true');
            }
            if (label) label.textContent = nextAction;
            control.setAttribute?.('aria-label', `Switch to ${nextAction.toLowerCase()}`);
            control.setAttribute?.('aria-pressed', theme === 'light' ? 'true' : 'false');
        });

        // Update settings side drawer theme buttons
        const themeBtns = typeof documentRef.querySelectorAll === 'function'
            ? Array.from(documentRef.querySelectorAll('.theme-btn[data-theme], .theme-btn'))
            : [];
        themeBtns.forEach(btn => {
            const targetTheme = btn.dataset?.theme || btn.getAttribute?.('data-theme');
            if (targetTheme && btn.classList?.toggle) {
                btn.classList.toggle('active', targetTheme === theme);
            }
        });
    }

    _getBroadcastChannel() {
        if (!this._broadcastChannel && typeof this.window?.BroadcastChannel !== 'undefined') {
            try {
                this._broadcastChannel = new this.window.BroadcastChannel('gpace_theme');
                this._broadcastChannel.onmessage = (event) => {
                    const theme = normalizeTheme(event?.data?.theme);
                    if (theme) {
                        this.applyTheme(theme);
                    }
                };
            } catch {}
        }
        return this._broadcastChannel;
    }

    _setupSyncListeners() {
        if (!this.window?.addEventListener || this._syncListenersBound) return;
        this._syncListenersBound = true;

        // 1. Cross-tab storage events
        this.window.addEventListener('storage', (event) => {
            if (event.key === 'theme' || event.key?.endsWith('_theme')) {
                const newTheme = normalizeTheme(event.newValue);
                if (newTheme && newTheme !== this.currentTheme) {
                    this.applyTheme(newTheme);
                }
            }
        });

        // 2. Cross-tab BroadcastChannel
        this._getBroadcastChannel();

        // 3. Window gpace_theme_changed event
        this.window.addEventListener('gpace_theme_changed', (event) => {
            const theme = normalizeTheme(event?.detail?.theme);
            if (theme && theme !== this.currentTheme) {
                this.applyTheme(theme);
            }
        });

        // 4. System color-scheme preference changes
        try {
            const media = this.window.matchMedia?.('(prefers-color-scheme: dark)');
            media?.addEventListener?.('change', (e) => {
                if (!this._readPreference()) {
                    this.applyTheme(e.matches ? 'dark' : 'light');
                }
            });
        } catch {}
    }

    applyTheme(theme) {
        const normalized = normalizeTheme(theme) || 'dark';
        const documentRef = this._getDocument();
        const root = documentRef?.documentElement;
        const body = documentRef?.body;

        if (root) {
            root.setAttribute?.('data-theme', normalized);
        }
        if (body) {
            body.setAttribute?.('data-theme', normalized);
            if (body.classList) body.classList.toggle('light-theme', normalized === 'light');
        }
        this.currentTheme = normalized;
        this._updateControls(normalized);
        return normalized;
    }

    setTheme(theme, options = {}) {
        const normalized = normalizeTheme(theme);
        if (!normalized) throw new Error(`Unsupported theme: ${String(theme)}`);

        const applied = this.applyTheme(normalized);
        if (options.persist !== false) {
            const storage = this._getStorage();
            if (storage && typeof storage.set === 'function') {
                try {
                    const outcome = storage.set('theme', applied);
                    if (outcome && typeof outcome === 'object' &&
                        ('success' in outcome || 'ok' in outcome) &&
                        outcome.success !== true && outcome.ok !== true) {
                        this.lastStorageError = outcome.error || new Error('Theme preference was not saved');
                    }
                } catch (error) {
                    this.lastStorageError = error;
                }
            }

            // Always ensure raw localStorage also has the theme for sync, early head scripts, and other tabs
            try {
                if (this.window?.localStorage && this.window.localStorage !== storage) {
                    this.window.localStorage.setItem('theme', applied);
                }
            } catch {}
        }

        const documentRef = this._getDocument();
        if (typeof this.window?.dispatchEvent === 'function' && typeof this.window?.CustomEvent === 'function') {
            this.window.dispatchEvent(new this.window.CustomEvent('gpace_theme_changed', {
                detail: { theme: applied }
            }));
        }
        if (documentRef?.dispatchEvent && typeof CustomEvent === 'function') {
            documentRef.dispatchEvent(new CustomEvent('gpace_theme_changed', { detail: { theme: applied } }));
        }

        // Multi-tab broadcast channel
        try {
            const channel = this._getBroadcastChannel();
            if (channel) {
                channel.postMessage({ type: 'gpace_theme_changed', theme: applied });
            }
        } catch {}

        return applied;
    }

    initializeTheme(options = {}) {
        this.configure(options);
        const savedTheme = this._readPreference();
        const selected = savedTheme || this._systemPreference();
        const applied = this.applyTheme(selected);
        this._bindControls();
        this._setupSyncListeners();
        return Promise.resolve(applied);
    }

    getTheme() {
        if (this.currentTheme) return this.currentTheme;
        const documentRef = this._getDocument();
        return normalizeTheme(documentRef?.documentElement?.getAttribute?.('data-theme')) || 'dark';
    }

    toggleTheme() {
        return this.setTheme(this.getTheme() === 'light' ? 'dark' : 'light');
    }
}

const themeManager = new ThemeManager();

function initializeTheme(options) {
    return themeManager.initializeTheme(options);
}

function setTheme(theme, options) {
    return themeManager.setTheme(theme, options);
}

function toggleTheme() {
    return themeManager.toggleTheme();
}

function getTheme() {
    return themeManager.getTheme();
}

if (typeof window !== 'undefined') {
    window.__gpaceThemeApi = themeManager;
    window.themeManager = themeManager;
    window.initializeTheme = initializeTheme;
    window.setTheme = setTheme;
    window.toggleTheme = toggleTheme;
    window.getTheme = getTheme;

    const start = () => void initializeTheme();
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
        else start();
    }
}

export {
    ThemeManager,
    themeManager,
    initializeTheme,
    setTheme,
    toggleTheme,
    getTheme
};

export default themeManager;
