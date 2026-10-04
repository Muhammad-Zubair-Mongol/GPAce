/**
 * Shared navigation component.
 *
 * The component owns one landmark, one disclosure state, and one set of
 * listeners. Re-injecting it updates the existing landmark instead of stacking
 * another navigation bar on the page.
 */

const NAV_LINKS = Object.freeze([
    { href: 'grind.html', label: 'Grind Mode', icon: 'bi-lightning-charge' },
    { href: 'study-spaces.html', label: 'Grind Station', icon: 'bi-building' },
    { href: 'daily-calendar.html', label: 'Daily Drip', icon: 'bi-calendar3' },
    { href: 'academic-details.html', label: 'Brain Juice', icon: 'bi-mortarboard' },
    { href: 'extracted.html', label: 'Hustle Hub', icon: 'bi-collection' },
    { href: 'subject-marks.html', label: 'Subject Marks', icon: 'bi-graph-up' },
    { href: 'flashcards.html', label: 'Flashcards', icon: 'bi-card-text' },
    { href: 'markdown-converter.html', label: 'MD Converter', icon: 'bi-markdown' },
    { href: 'sleep-saboteurs.html', label: 'Alarms', icon: 'bi-alarm' },
    { href: 'settings.html', label: 'Settings', icon: 'bi-gear' }
]);

const NAV_ID = 'mainNavigation';
const LINKS_ID = 'mainNavigationLinks';
const TOGGLE_ID = 'navToggleBtn';

function getCurrentPage(locationRef) {
    const pathname = locationRef?.pathname || (typeof window !== 'undefined' ? window.location.pathname : '');
    const page = String(pathname).split('/').pop();
    return page || 'index.html';
}

function setText(element, value) {
    if (element) element.textContent = String(value ?? '');
}

function createIcon(documentRef, className, withMargin = false) {
    if (!className || !documentRef?.createElement) return null;
    const icon = documentRef.createElement('i');
    icon.className = withMargin ? `bi ${className} me-1` : `bi ${className}`;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function createLink(documentRef, link, currentPage, showIcons, basePath = '') {
    const anchor = documentRef.createElement('a');
    anchor.href = `${basePath}${link.href}`;
    anchor.className = link.href === currentPage ? 'active' : '';
    anchor.dataset.navLink = 'true';
    anchor.setAttribute('data-page', link.href);
    if (link.href === currentPage) anchor.setAttribute('aria-current', 'page');
    if (showIcons) {
        const icon = createIcon(documentRef, link.icon, true);
        if (icon) anchor.appendChild(icon);
    }
    const label = documentRef.createElement('span');
    setText(label, link.label);
    anchor.appendChild(label);
    return anchor;
}

function createNavigationElement(documentRef, options = {}) {
    const currentPage = getCurrentPage(options.location);
    const showIcons = options.showIcons !== false;
    let basePath = options.basePath;
    if (basePath === undefined) {
        const pathname = options.location?.pathname || (typeof window !== 'undefined' ? window.location?.pathname : '');
        const segments = String(pathname || '').replace(/^\/+/, '').split('/').filter(Boolean);
        if (segments.length > 1) {
            basePath = '../'.repeat(segments.length - 1);
        } else {
            basePath = '';
        }
    }

    const nav = documentRef.createElement('nav');
    nav.className = 'top-nav';
    nav.id = NAV_ID;
    nav.setAttribute('aria-label', 'Primary navigation');

    const brand = documentRef.createElement('div');
    brand.className = 'nav-brand';
    const brandLink = documentRef.createElement('a');
    brandLink.href = `${basePath}grind.html`;
    brandLink.className = 'link-inherit';
    const logo = documentRef.createElement('img');
    logo.src = options.logoSrc || `${basePath}assets/images/gpace-logo-white.png`;
    logo.alt = 'GPAce Logo';
    logo.className = 'logo-brand';
    logo.setAttribute('width', '60');
    logo.setAttribute('height', '60');
    brandLink.appendChild(logo);
    const brandText = documentRef.createElement('span');
    brandText.className = 'brand-text';
    setText(brandText, 'GPAce');
    brandLink.appendChild(brandText);
    brand.appendChild(brandLink);
    nav.appendChild(brand);

    const links = documentRef.createElement('div');
    links.className = 'nav-links';
    links.id = LINKS_ID;
    links.setAttribute('data-navigation-links', 'true');
    NAV_LINKS.forEach(link => links.appendChild(createLink(documentRef, link, currentPage, showIcons, basePath)));

    // Theme Toggle Control
    const themeToggle = documentRef.createElement('button');
    themeToggle.type = 'button';
    themeToggle.className = 'theme-toggle';
    themeToggle.id = 'themeToggleBtn';
    themeToggle.setAttribute('aria-label', 'Toggle theme');
    themeToggle.title = 'Toggle theme';
    const themeIcon = documentRef.createElement('i');
    themeIcon.className = 'bi bi-moon-stars theme-icon';
    themeIcon.setAttribute('aria-hidden', 'true');
    themeToggle.appendChild(themeIcon);
    const themeText = documentRef.createElement('span');
    themeText.className = 'theme-text visually-hidden';
    setText(themeText, 'Toggle theme');
    themeToggle.appendChild(themeText);
    themeToggle.addEventListener?.('click', async (event) => {
        event?.preventDefault?.();
        if (themeToggle.dataset?.themeManagerBound === 'true') return;
        if (typeof window !== 'undefined') {
            if (typeof window.toggleTheme === 'function') {
                window.toggleTheme();
            } else if (typeof window.themeManager?.toggleTheme === 'function') {
                window.themeManager.toggleTheme();
            } else {
                try {
                    const { toggleTheme } = await import('../themeManager.js');
                    toggleTheme();
                } catch {}
            }
        }
    });
    links.appendChild(themeToggle);

    // Settings Drawer Toggle Control
    const drawerToggle = documentRef.createElement('button');
    drawerToggle.type = 'button';
    drawerToggle.className = 'drawer-toggle';
    drawerToggle.setAttribute('aria-label', 'Open settings drawer');
    drawerToggle.title = 'Settings';
    const drawerIcon = createIcon(documentRef, 'bi-gear', false);
    if (drawerIcon) drawerToggle.appendChild(drawerIcon);
    drawerToggle.addEventListener?.('click', () => {
        if (drawerToggle.hasAttribute?.('data-drawer-bound')) return;
        if (typeof window !== 'undefined' && window.sideDrawer?.toggleDrawer) {
            window.sideDrawer.toggleDrawer();
        }
    });
    links.appendChild(drawerToggle);
    nav.appendChild(links);

    // Mobile Hamburger Toggle
    const toggle = documentRef.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nav-toggle';
    toggle.id = TOGGLE_ID;
    toggle.setAttribute('aria-label', 'Toggle navigation');
    toggle.setAttribute('aria-controls', LINKS_ID);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-haspopup', 'true');
    const toggleIcon = createIcon(documentRef, 'bi-list', false);
    if (toggleIcon) toggle.appendChild(toggleIcon);
    nav.appendChild(toggle);
    return nav;
}

function removeNavigationListeners(nav) {
    if (typeof nav?.__gpaceMobileToggleCleanup === 'function') {
        nav.__gpaceMobileToggleCleanup();
        nav.__gpaceMobileToggleCleanup = null;
    }
    if (typeof nav?.__gpaceScrollHideCleanup === 'function') {
        nav.__gpaceScrollHideCleanup();
        nav.__gpaceScrollHideCleanup = null;
    }
    if (typeof nav?.__gpaceNavigationCleanup === 'function') {
        const cleanup = nav.__gpaceNavigationCleanup;
        nav.__gpaceNavigationCleanup = null;
        cleanup();
    }
}

function setupMobileToggle(nav, documentRef, windowRef) {
    const toggle = nav?.querySelector?.(`#${TOGGLE_ID}`);
    const links = nav?.querySelector?.(`#${LINKS_ID}`);
    if (!toggle || !links) return;

    if (typeof nav.__gpaceMobileToggleCleanup === 'function') {
        nav.__gpaceMobileToggleCleanup();
        nav.__gpaceMobileToggleCleanup = null;
    }

    const setExpanded = (expanded, focusToggle = false) => {
        const next = Boolean(expanded);
        links.classList.toggle('show', next);
        toggle.setAttribute('aria-expanded', String(next));
        nav.dataset.expanded = String(next);
        if (focusToggle && typeof toggle.focus === 'function') toggle.focus();
        const CustomEventCtor = windowRef?.CustomEvent || globalThis.CustomEvent;
        if (CustomEventCtor) {
            nav.dispatchEvent?.(new CustomEventCtor('gpace_navigation_toggle', {
                detail: { expanded: next }
            }));
        }
    };

    const onToggle = (event) => {
        event.preventDefault();
        setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
    };
    const onToggleKeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') onToggle(event);
    };
    const onDocumentClick = (event) => {
        if (!nav.contains(event.target) && toggle.getAttribute('aria-expanded') === 'true') setExpanded(false);
    };
    const onKeydown = (event) => {
        if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
            setExpanded(false, true);
        }
    };

    toggle.addEventListener('click', onToggle);
    toggle.addEventListener('keydown', onToggleKeydown);
    documentRef.addEventListener?.('click', onDocumentClick);
    documentRef.addEventListener?.('keydown', onKeydown);
    setExpanded(false);

    nav.__gpaceMobileToggleCleanup = () => {
        toggle.removeEventListener?.('click', onToggle);
        toggle.removeEventListener?.('keydown', onToggleKeydown);
        documentRef.removeEventListener?.('click', onDocumentClick);
        documentRef.removeEventListener?.('keydown', onKeydown);
    };
    nav.__gpaceNavigationState = {
        isExpanded: () => toggle.getAttribute('aria-expanded') === 'true',
        setExpanded,
        toggle: () => setExpanded(!nav.__gpaceNavigationState.isExpanded()),
        close: () => setExpanded(false, true)
    };
}

function setupScrollHide(nav, windowRef) {
    if (!nav || !windowRef?.addEventListener) return;
    if (typeof nav.__gpaceScrollHideCleanup === 'function') {
        nav.__gpaceScrollHideCleanup();
        nav.__gpaceScrollHideCleanup = null;
    }
    let lastScrollY = Number(windowRef.scrollY || 0);
    let ticking = false;

    const handleScroll = () => {
        const current = Number(windowRef.scrollY || 0);
        const delta = current - lastScrollY;
        if (Math.abs(delta) >= 10) {
            if (current <= 0 || delta < 0) nav.classList.remove('nav-hidden');
            else if (current > 80) nav.classList.add('nav-hidden');
            lastScrollY = current;
        }
        ticking = false;
    };
    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        const frame = windowRef.requestAnimationFrame || (callback => setTimeout(callback, 0));
        frame(handleScroll);
    };
    windowRef.addEventListener('scroll', onScroll, { passive: true });
    nav.__gpaceScrollHideCleanup = () => {
        windowRef.removeEventListener?.('scroll', onScroll);
    };
}

function findNavigationElements(documentRef, selector = '.top-nav') {
    const nodes = typeof documentRef?.querySelectorAll === 'function'
        ? Array.from(documentRef.querySelectorAll(selector))
        : [];
    if (nodes.length) return nodes;
    const first = documentRef?.querySelector?.(selector);
    return first ? [first] : [];
}

export function injectNavigation(options = {}) {
    const documentRef = options.document || (typeof document !== 'undefined' ? document : null);
    const windowRef = options.window || (typeof window !== 'undefined' ? window : globalThis);
    if (!documentRef?.createElement) throw new Error('Navigation requires a document');

    const target = documentRef.querySelector?.(options.targetSelector || 'body');
    if (!target) return null;

    if (target.dataset?.noNavigation === 'true' ||
        target.getAttribute?.('data-no-navigation') === 'true' ||
        documentRef.body?.dataset?.noNavigation === 'true' ||
        documentRef.body?.getAttribute?.('data-no-navigation') === 'true' ||
        options.skipNavigation) {
        return null;
    }

    let basePath = options.basePath;
    if (basePath === undefined) {
        const pathname = options.location?.pathname || (typeof window !== 'undefined' ? window.location?.pathname : '');
        const segments = String(pathname || '').replace(/^\/+/, '').split('/').filter(Boolean);
        if (segments.length > 1) {
            basePath = '../'.repeat(segments.length - 1);
        } else {
            basePath = '';
        }
    }

    const existingElements = findNavigationElements(documentRef, options.existingNavSelector || '.top-nav');
    const existing = existingElements[0] || null;

    // Enhance existing static landmark instead of destroying it
    if (existing && !existing.dataset?.injected && !existing.getAttribute?.('data-injected') && !options.forceReplace) {
        if (existingElements.length > 1) {
            existingElements.slice(1).forEach(removeNavigationListeners);
            existingElements.slice(1).forEach(nav => nav.remove?.());
        }

        removeNavigationListeners(existing);
        setupMobileToggle(existing, documentRef, windowRef);
        setupScrollHide(existing, windowRef);

        const drawerToggle = existing.querySelector?.('.drawer-toggle');
        if (drawerToggle && !drawerToggle.hasAttribute?.('data-drawer-bound')) {
            drawerToggle.setAttribute?.('data-drawer-bound', 'true');
            drawerToggle.addEventListener?.('click', () => {
                if (typeof window !== 'undefined' && window.sideDrawer?.toggleDrawer) {
                    window.sideDrawer.toggleDrawer();
                }
            });
        }

        const themeToggle = existing.querySelector?.('.theme-toggle, #themeToggleBtn');
        if (themeToggle && themeToggle.dataset?.themeManagerBound !== 'true') {
            if (themeToggle.dataset) themeToggle.dataset.themeManagerBound = 'true';
            themeToggle.setAttribute?.('data-theme-manager-bound', 'true');
            themeToggle.addEventListener?.('click', async (event) => {
                event?.preventDefault?.();
                if (typeof window !== 'undefined') {
                    if (typeof window.toggleTheme === 'function') {
                        window.toggleTheme();
                    } else if (typeof window.themeManager?.toggleTheme === 'function') {
                        window.themeManager.toggleTheme();
                    } else {
                        try {
                            const { toggleTheme } = await import('../themeManager.js');
                            toggleTheme();
                        } catch {}
                    }
                }
            });
        }

        updateActiveLink(documentRef, basePath);
        return existing;
    }

    existingElements.forEach(removeNavigationListeners);
    existingElements.forEach(nav => nav.remove?.());

    const nav = createNavigationElement(documentRef, { ...options, basePath, window: windowRef });
    nav.dataset.injected = 'true';
    nav.setAttribute('data-injected', 'true');

    if (options.position === 'append') target.appendChild(nav);
    else target.insertBefore(nav, target.firstChild || null);

    setupMobileToggle(nav, documentRef, windowRef);
    setupScrollHide(nav, windowRef);
    return nav;
}

export function getNavigationState(documentRef) {
    const nav = documentRef?.querySelector?.(`#${NAV_ID}`) ||
        (typeof document !== 'undefined' ? document.getElementById(NAV_ID) : null);
    return nav?.__gpaceNavigationState || null;
}

export function setNavigationExpanded(expanded, documentRef) {
    const state = getNavigationState(documentRef);
    state?.setExpanded(Boolean(expanded));
    return Boolean(expanded);
}

export function toggleNavigation(documentRef) {
    const state = getNavigationState(documentRef);
    if (!state) return false;
    state.toggle();
    return state.isExpanded();
}

export function updateActiveLink(documentRef, basePath = '') {
    const documentRefResolved = documentRef || (typeof document !== 'undefined' ? document : null);
    const currentPage = getCurrentPage(typeof window !== 'undefined' ? window.location : null);
    const links = documentRefResolved?.querySelectorAll?.(`#${LINKS_ID} a[data-nav-link]`) || [];
    let currentCount = 0;
    Array.from(links).forEach(link => {
        const pageAttr = link.getAttribute('data-page');
        const hrefAttr = link.getAttribute('href');
        const cleanHref = hrefAttr ? hrefAttr.replace(/^\.\.\//, '') : '';
        const active = pageAttr === currentPage || cleanHref === currentPage || hrefAttr === `${basePath}${currentPage}` || hrefAttr === currentPage;
        link.classList.toggle('active', active);
        if (active) {
            link.setAttribute('aria-current', 'page');
            currentCount += 1;
        } else {
            link.removeAttribute('aria-current');
        }
    });
    return currentCount;
}

export function addNavLink(linkConfig, position = -1, documentRef, basePath = '') {
    if (!linkConfig || !linkConfig.href || !linkConfig.label) throw new Error('Navigation link requires href and label');
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    const container = doc?.getElementById?.(LINKS_ID);
    if (!container) return null;
    const currentPage = getCurrentPage(typeof window !== 'undefined' ? window.location : null);
    const link = createLink(doc, linkConfig, currentPage, true, basePath);
    const controls = Array.from(container.children || []);
    const insertAt = position >= 0 && position < controls.length ? controls[position] : null;
    if (insertAt) container.insertBefore(link, insertAt);
    else container.insertBefore(link, container.querySelector?.('.theme-toggle') || container.querySelector?.('.drawer-toggle') || null);
    return link;
}

export function getNavLinks() {
    return NAV_LINKS.map(link => ({ ...link }));
}

const api = {
    injectNavigation,
    getNavigationState,
    setNavigationExpanded,
    toggleNavigation,
    updateActiveLink,
    addNavLink,
    getNavLinks,
    NAV_LINKS
};

if (typeof window !== 'undefined') window.NavigationComponent = api;

export { NAV_LINKS };
export default api;
