/**
 * Side Drawer Component
 * Provides navigation and settings drawer functionality.
 *
 * The drawer is a modal disclosure on small screens and a non-modal
 * complementary panel on desktop. The same component owns the full focus
 * lifecycle in both modes so navigation replacement cannot strand focus.
 */

const getStorage = () => window.StorageAdapter?.getStorage?.() || window.StorageService || {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

class SideDrawer {
    constructor({ documentRef = document, windowRef = window } = {}) {
        this.document = documentRef;
        this.window = windowRef;
        this.isOpen = false;
        this._previousFocus = null;
        this._inertedElements = new Map();
        this._eventListenersBound = false;
        this._navigationObserver = null;
        this._authModule = null;
        this._authReady = false;
        this._boundAuthState = (event) => {
            if (event.detail?.user) this.updateUIForUser(event.detail.user);
            else this.updateUIForSignedOut();
        };
        this._boundKeydown = (event) => this.handleKeydown(event);
        this._boundDocumentClick = (event) => this.handleDocumentClick(event);
        this.init();
        this.initializeAuth();
    }

    get drawer() {
        return this.document.querySelector('.side-drawer');
    }

    isModalDrawer() {
        if (typeof this.window.matchMedia === 'function') {
            return this.window.matchMedia('(max-width: 768px)').matches;
        }
        return (this.window.innerWidth || 1024) <= 768;
    }

    init() {
        let drawer = this.document.querySelector('.side-drawer');
        if (!drawer) {
            drawer = this.document.createElement('aside');
            drawer.className = 'side-drawer';
            drawer.innerHTML = `
                <div class="drawer-content">
                    <button type="button" class="drawer-close" aria-label="Close settings drawer">&times;</button>
                    <div class="drawer-header">
                        <h3 id="settingsDrawerTitle">Settings</h3>
                    </div>
                    <div class="drawer-body">
                        <div id="userProfile" class="user-profile">
                            <!-- Profile content will be dynamically updated -->
                        </div>
                        <button type="button" id="authButton" class="auth-button" aria-label="Sign in with Google" title="Sign in with Google">
                            <i class="bi bi-box-arrow-in-right" aria-hidden="true"></i>
                            <span>Sign In</span>
                        </button>
                        <p id="authStatus" class="auth-status" role="status" aria-live="polite"></p>
                        <div class="theme-section">
                            <h4>Theme</h4>
                            <div class="theme-buttons">
                                <button type="button" class="theme-btn light-theme" data-theme="light">
                                    <i class="bi bi-sun-fill" aria-hidden="true"></i>
                                    Light
                                </button>
                                <button type="button" class="theme-btn dark-theme" data-theme="dark">
                                    <i class="bi bi-moon-fill" aria-hidden="true"></i>
                                    Dark
                                </button>
                            </div>
                        </div>
                        <nav class="drawer-links" aria-label="Settings links">
                            <a href="settings.html" class="drawer-link">
                                <i class="bi bi-gear" aria-hidden="true"></i>
                                Settings
                            </a>
                            <a href="sleep-saboteurs.html" class="drawer-link">
                                <i class="bi bi-clock" aria-hidden="true"></i>
                                Sleep Saboteurs
                            </a>
                            <a href="priority-calculator.html" class="drawer-link">
                                <i class="bi bi-calculator" aria-hidden="true"></i>
                                Priority Calculator
                            </a>
                        </nav>
                    </div>
                </div>
            `;
            this.document.body.appendChild(drawer);
        }

        drawer.id = drawer.id || 'settingsDrawer';
        drawer.setAttribute('aria-labelledby', 'settingsDrawerTitle');
        drawer.setAttribute('aria-hidden', 'true');
        this.updateDrawerSemantics();

        this.ensureToggleButton();
        this.setupEventListeners();
        this.updateThemeButtons();
        this.watchForNavigationChanges();
    }

    /**
     * Ensures the drawer toggle button exists in the DOM
     * Creates one if missing, or just binds events if it exists
     */
    ensureToggleButton() {
        const existingToggle = this.document.querySelector('.drawer-toggle');
        if (existingToggle) {
            this.configureToggleButton(existingToggle);
            return;
        }

        const toggleButton = this.document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'drawer-toggle';
        toggleButton.innerHTML = '<i class="bi bi-gear" aria-hidden="true"></i>';
        this.configureToggleButton(toggleButton);
        toggleButton.setAttribute('title', 'Settings');

        const navLinks = this.document.querySelector('.nav-links');
        if (navLinks) {
            navLinks.appendChild(toggleButton);
        } else {
            // Fallback: append to body as fixed button if .nav-links doesn't exist
            console.warn('[SideDrawer] .nav-links element not found, creating fixed toggle button');
            toggleButton.style.cssText = 'position: fixed; top: 1rem; right: 1rem; z-index: 1001;';
            this.document.body.appendChild(toggleButton);
        }
    }

    configureToggleButton(toggleButton) {
        toggleButton.type = 'button';
        toggleButton.setAttribute('aria-label', 'Open settings drawer');
        toggleButton.setAttribute('aria-controls', 'settingsDrawer');
        toggleButton.setAttribute('aria-expanded', String(this.isOpen));
    }

    /**
     * Watches for navigation DOM changes and re-binds events
     * This handles the case where inject-header.js replaces the navigation
     */
    watchForNavigationChanges() {
        if (this._navigationObserver || typeof this.window.MutationObserver !== 'function') return;

        const observer = new this.window.MutationObserver((mutations) => {
            for (const mutation of mutations) {
                // Check if a new navigation was added
                if (mutation.type === 'childList') {
                    const addedNodes = Array.from(mutation.addedNodes);
                    const hasNewNav = addedNodes.some(node =>
                        node.nodeType === 1 && (
                            node.classList?.contains('top-nav') ||
                            node.querySelector?.('.top-nav')
                        )
                    );

                    if (hasNewNav) {
                        console.log('[SideDrawer] New navigation detected, re-binding events');
                        // Small delay to ensure DOM is fully updated
                            this.window.setTimeout(() => {
                                this.ensureToggleButton();
                                this.setupEventListeners();
                            }, 50);
                    }
                }
            }
        });

        // Observe body for navigation changes
        observer.observe(this.document.body, { childList: true, subtree: true });

        // Store observer for potential cleanup
        this._navigationObserver = observer;
    }

    setupEventListeners() {
        const drawerToggle = this.document.querySelector('.drawer-toggle');
        const drawerClose = this.document.querySelector('.drawer-close');
        const authButton = this.document.getElementById('authButton');

        if (drawerToggle && !drawerToggle.hasAttribute('data-drawer-bound')) {
            drawerToggle.setAttribute('data-drawer-bound', 'true');
            drawerToggle.addEventListener('click', () => this.toggleDrawer());
        }

        if (drawerClose && !drawerClose.hasAttribute('data-drawer-bound')) {
            drawerClose.setAttribute('data-drawer-bound', 'true');
            drawerClose.addEventListener('click', () => this.closeDrawer());
        }

        if (authButton && !authButton.hasAttribute('data-drawer-bound')) {
            authButton.setAttribute('data-drawer-bound', 'true');
            authButton.addEventListener('click', () => this.handleAuth());
        }

        // Theme buttons
        const themeButtons = this.document.querySelectorAll('.theme-btn');
        themeButtons.forEach(button => {
            if (!button.hasAttribute('data-drawer-bound')) {
                button.setAttribute('data-drawer-bound', 'true');
                button.addEventListener('click', () => this.handleThemeChange(button.dataset.theme));
            }
        });

        if (!this._themeListenerBound && typeof this.window?.addEventListener === 'function') {
            this.window.addEventListener('gpace_theme_changed', (event) => {
                const newTheme = event?.detail?.theme;
                if (newTheme) this.updateThemeButtons(newTheme);
            });
            this._themeListenerBound = true;
        }

        if (!this._eventListenersBound) {
            this.document.addEventListener('keydown', this._boundKeydown);
            this.document.addEventListener('click', this._boundDocumentClick);
            this._eventListenersBound = true;
        }
    }

    async handleAuth() {
        let auth = this.window.auth;
        let signInFn = this.window.signInWithGoogle;
        let signOutFn = this.window.signOutUser;

        if (!auth || typeof signInFn !== 'function') {
            try {
                const authModule = await import('./auth.js');
                if (authModule) {
                    if (typeof authModule.initializeAuth === 'function') {
                        authModule.initializeAuth();
                    }
                    auth = authModule.auth || this.window.auth;
                    signInFn = authModule.signInWithGoogle || this.window.signInWithGoogle;
                    signOutFn = authModule.signOutUser || this.window.signOutUser;
                }
            } catch (err) {
                console.warn('[SideDrawer] Dynamic auth module import error:', err);
            }
        }

        if (auth?.currentUser) {
            try {
                if (typeof signOutFn === 'function') {
                    await signOutFn();
                    console.log('User signed out successfully');
                    this.updateUIForSignedOut();
                    this.window.location?.reload?.();
                }
            } catch (error) {
                console.error('Error signing out:', error);
            }
        } else {
            try {
                if (typeof signInFn === 'function') {
                    await signInFn();
                    console.log('User signed in successfully');
                    this.window.setTimeout(() => {
                        this.window.location?.reload?.();
                    }, 1000);
                } else {
                    console.warn('[SideDrawer] Sign in function unavailable');
                }
            } catch (error) {
                console.error('Error signing in:', error);
            }
        }
    }

    updateUIForUser(user) {
        const authButton = this.document.getElementById('authButton');
        const userProfile = this.document.getElementById('userProfile');

        if (authButton) {
            const displayName = (user && (user.displayName || user.email)) || 'User';
            const avatarUrl = (user && user.photoURL) || 'assets/images/gpace-logo-white.png';
            authButton.innerHTML = `
                <img src="${avatarUrl}" alt="" class="user-avatar" aria-hidden="true">
                <span class="user-name">${displayName}</span>
                <span class="logout-btn" role="button" tabindex="0" aria-label="Sign out">Sign Out</span>
            `;
            authButton.setAttribute('aria-label', `Signed in as ${displayName}. Sign out`);
            authButton.title = `Signed in as ${displayName}. Click to sign out`;
        }

        if (userProfile) {
            userProfile.style.display = 'flex';
        }
    }

    updateUIForSignedOut() {
        const authButton = this.document.getElementById('authButton');
        const userProfile = this.document.getElementById('userProfile');

        if (authButton) {
            authButton.innerHTML = `
                <i class="bi bi-box-arrow-in-right" aria-hidden="true"></i>
                <span>Sign In</span>
            `;
            authButton.setAttribute('aria-label', 'Sign in with Google');
            authButton.title = 'Sign in with Google';
        }

        if (userProfile) {
            userProfile.style.display = 'none';
        }
    }

    initializeAuth() {
        if (typeof this.window.addEventListener === 'function') {
            this.window.addEventListener('gpace-auth-state', this._boundAuthState);
        }

        const maxRetries = 20;
        let retryCount = 0;

        const setupAuthListener = () => {
            const auth = this.window.auth;
            if (auth && typeof auth.onAuthStateChanged === 'function') {
                try {
                    auth.onAuthStateChanged(user => {
                        if (user) {
                            this.updateUIForUser(user);
                        } else {
                            this.updateUIForSignedOut();
                        }
                    });
                    return;
                } catch (err) {
                    console.warn('[SideDrawer] Error listening to auth state:', err);
                }
            }

            if (retryCount < maxRetries) {
                retryCount++;
                this.window.setTimeout(setupAuthListener, 100);
            } else {
                this.updateUIForSignedOut();
            }
        };

        setupAuthListener();
    }

    toggleDrawer() {
        if (this.isOpen) this.closeDrawer();
        else this.openDrawer();
    }

    openDrawer() {
        const drawer = this.drawer;
        if (!drawer || this.isOpen) return;

        this._previousFocus = this.document.activeElement;
        this.isOpen = true;
        drawer.classList.add('open');
        this.updateDrawerSemantics();
        this.updateThemeButtons();
        this.setBackgroundInert(true);

        const firstFocusable = this.getFocusableElements()[0] || drawer;
        firstFocusable.focus();
    }

    closeDrawer({ restoreFocus = true } = {}) {
        const drawer = this.drawer;
        if (!drawer) return;

        this.isOpen = false;
        drawer.classList.remove('open');
        this.setBackgroundInert(false);
        this.updateDrawerSemantics();

        if (restoreFocus) {
            const focusTarget = this._previousFocus?.isConnected
                ? this._previousFocus
                : this.document.querySelector('.drawer-toggle');
            focusTarget?.focus?.();
        }
        this._previousFocus = null;
    }

    updateDrawerSemantics() {
        const drawer = this.drawer;
        const toggle = this.document.querySelector('.drawer-toggle');
        if (!drawer) return;

        const modal = this.isModalDrawer();
        drawer.setAttribute('role', modal ? 'dialog' : 'complementary');
        if (modal) drawer.setAttribute('aria-modal', 'true');
        else drawer.removeAttribute('aria-modal');
        drawer.setAttribute('aria-hidden', String(!this.isOpen));
        toggle?.setAttribute('aria-expanded', String(this.isOpen));
    }

    setBackgroundInert(shouldInert) {
        if (!this.isModalDrawer()) return;

        const drawer = this.drawer;
        if (shouldInert) {
            this._inertedElements.clear();
            Array.from(this.document.body.children).forEach(element => {
                if (element === drawer) return;
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

    getFocusableElements() {
        const drawer = this.drawer;
        return drawer ? Array.from(drawer.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => {
            const style = this.window.getComputedStyle?.(el);
            return !style || style.visibility !== 'hidden' && style.display !== 'none';
        }) : [];
    }

    handleKeydown(event) {
        if (!this.isOpen) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            this.closeDrawer();
            return;
        }

        if (!this.isModalDrawer() || event.key !== 'Tab') return;

        const focusable = this.getFocusableElements();
        if (focusable.length === 0) {
            event.preventDefault();
            this.drawer?.focus();
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && this.document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && this.document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    handleDocumentClick(event) {
        if (!this.isOpen || !this.isModalDrawer()) return;
        const drawer = this.drawer;
        const toggle = this.document.querySelector('.drawer-toggle');
        if (drawer && !drawer.contains(event.target) && event.target !== toggle) {
            this.closeDrawer();
        }
    }

    updateThemeButtons(currentTheme) {
        const theme = currentTheme ||
            (typeof this.window?.getTheme === 'function' ? this.window.getTheme() :
            (typeof this.window?.themeManager?.getTheme === 'function' ? this.window.themeManager.getTheme() :
            (this.document?.documentElement?.getAttribute?.('data-theme') || (this.document?.body?.classList?.contains?.('light-theme') ? 'light' : 'dark'))));
        const themeButtons = this.document?.querySelectorAll?.('.theme-btn') || [];
        themeButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.theme === theme);
        });
    }

    handleThemeChange(theme) {
        if (typeof this.window?.themeManager?.setTheme === 'function') {
            this.window.themeManager.setTheme(theme);
        } else if (typeof this.window?.setTheme === 'function') {
            this.window.setTheme(theme);
        } else {
            const storage = getStorage();
            const body = this.document.body;
            if (theme === 'light') {
                body.classList.add('light-theme');
                this.document.documentElement?.setAttribute?.('data-theme', 'light');
                storage.set('theme', 'light');
            } else {
                body.classList.remove('light-theme');
                this.document.documentElement?.setAttribute?.('data-theme', 'dark');
                storage.set('theme', 'dark');
            }
        }
        this.updateThemeButtons(theme);
    }
}

// Initialize drawer
if (typeof document !== 'undefined') {
    const initializeSideDrawer = () => {
        if (!window.sideDrawer) window.sideDrawer = new SideDrawer();
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSideDrawer, { once: true });
    } else {
        initializeSideDrawer();
    }
}

export { SideDrawer };
export default SideDrawer;
