/*
 * Classic-script compatibility facade for the canonical themeManager module.
 * Pages with legacy script tags get an immediate safe fallback while the
 * module loads, then all globals are replaced by the shared API instance.
 */
(function installThemeFacade(global) {
    if (!global) return;

    const readTheme = () => {
        try {
            const raw = global.localStorage?.getItem('theme');
            if (raw === 'light' || raw === '"light"') return 'light';
            if (raw === 'dark' || raw === '"dark"') return 'dark';

            // Check StorageService prefix keys if raw theme was not set directly
            const anon = global.localStorage?.getItem('gpace_anon_theme');
            if (anon === 'light' || anon === '"light"') return 'light';
            if (anon === 'dark' || anon === '"dark"') return 'dark';

            for (let i = 0; i < (global.localStorage?.length || 0); i++) {
                const k = global.localStorage.key(i);
                if (k && k.endsWith('_theme')) {
                    const val = global.localStorage.getItem(k);
                    if (val === 'light' || val === '"light"') return 'light';
                    if (val === 'dark' || val === '"dark"') return 'dark';
                }
            }

            return null;
        } catch {
            return null;
        }
    };

    const applyFallback = (theme) => {
        const normalized = theme === 'light' ? 'light' : 'dark';
        const doc = global.document;
        if (doc?.documentElement) {
            doc.documentElement.setAttribute('data-theme', normalized);
        }
        if (doc?.body) {
            doc.body.setAttribute?.('data-theme', normalized);
            doc.body.classList?.toggle?.('light-theme', normalized === 'light');
        }
        doc?.querySelectorAll?.('.theme-toggle, #themeToggleBtn')?.forEach?.(control => {
            const icon = control.querySelector?.('.theme-icon, i.bi');
            const label = control.querySelector?.('.theme-text');
            const nextAction = normalized === 'light' ? 'Dark Mode' : 'Light Mode';
            if (icon) {
                const isBi = icon.classList?.contains?.('bi') || icon.tagName === 'I';
                if (icon.classList) {
                    if (normalized === 'light') {
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
                    icon.textContent = normalized === 'light' ? '🌞' : '🌙';
                }
                icon.setAttribute?.('aria-hidden', 'true');
            }
            if (label) label.textContent = nextAction;
            control.setAttribute?.('aria-label', `Switch to ${nextAction.toLowerCase()}`);
            control.setAttribute?.('aria-pressed', normalized === 'light' ? 'true' : 'false');
        });
        doc?.querySelectorAll?.('.theme-btn[data-theme], .theme-btn')?.forEach?.(btn => {
            const targetTheme = btn.dataset?.theme || btn.getAttribute?.('data-theme');
            if (targetTheme && btn.classList?.toggle) {
                btn.classList.toggle('active', targetTheme === normalized);
            }
        });
        return normalized;
    };

    // Immediate execution: anti-flicker pre-application to documentElement
    const initialTheme = readTheme() || (global.matchMedia?.('(prefers-color-scheme: dark)')?.matches === false ? 'light' : 'dark');
    applyFallback(initialTheme);

    const doc = global.document;
    const syncBodyTheme = () => {
        const t = doc?.documentElement?.getAttribute?.('data-theme') || initialTheme;
        if (doc?.body) {
            doc.body.setAttribute?.('data-theme', t);
            doc.body.classList?.toggle?.('light-theme', t === 'light');
        }
    };
    if (doc?.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', syncBodyTheme, { once: true });
    } else {
        syncBodyTheme();
    }

    const fallback = global.themeManager || {
        initializeTheme() {
            const saved = readTheme();
            return Promise.resolve(applyFallback(saved || (global.matchMedia?.('(prefers-color-scheme: dark)')?.matches === false ? 'light' : 'dark')));
        },
        toggleTheme() {
            const current = global.document?.documentElement?.getAttribute?.('data-theme') || readTheme() || 'dark';
            const next = current === 'light' ? 'dark' : 'light';
            applyFallback(next);
            try { global.localStorage?.setItem('theme', next); } catch {}
            try {
                global.dispatchEvent?.(new CustomEvent('gpace_theme_changed', { detail: { theme: next } }));
            } catch {}
            return next;
        },
        setTheme(theme) {
            const next = theme === 'light' || theme === 'dark' ? theme : 'dark';
            applyFallback(next);
            try { global.localStorage?.setItem('theme', next); } catch {}
            try {
                global.dispatchEvent?.(new CustomEvent('gpace_theme_changed', { detail: { theme: next } }));
            } catch {}
            return next;
        },
        getTheme() {
            return global.document?.documentElement?.getAttribute?.('data-theme') || readTheme() || 'dark';
        }
    };

    global.themeManager = fallback;
    global.initializeTheme = (...args) => global.themeManager.initializeTheme(...args);
    global.toggleTheme = (...args) => global.themeManager.toggleTheme(...args);
    global.setTheme = (...args) => global.themeManager.setTheme(...args);
    global.getTheme = (...args) => global.themeManager.getTheme(...args);

    // Dynamic import is available inside classic scripts in modern browsers.
    // In classic scripts, dynamic import() is document-relative; resolve to canonical js/themeManager.js.
    const moduleSpecifier = (() => {
        try {
            if (global.document?.currentScript?.src) {
                return new URL('./themeManager.js', global.document.currentScript.src).href;
            }
        } catch {}
        const isSubdir = typeof global.location !== 'undefined' && (
            global.location.pathname.includes('/relaxed-mode/') ||
            global.location.pathname.includes('/scripts/')
        );
        return isSubdir ? '../js/themeManager.js' : '/js/themeManager.js';
    })();

    const loadModule = () => (typeof moduleSpecifier === 'string' && moduleSpecifier !== './themeManager.js'
        ? import(moduleSpecifier)
        : import('./themeManager.js'));

    global.GpaceThemeReady = global.GpaceThemeReady || loadModule()
        .then(module => {
            global.themeManager = module.themeManager;
            global.initializeTheme = module.initializeTheme;
            global.toggleTheme = module.toggleTheme;
            global.setTheme = module.setTheme;
            global.getTheme = module.getTheme;
            return module.themeManager.initializeTheme();
        })
        .catch(() => global.themeManager);
})(typeof window !== 'undefined' ? window : null);
