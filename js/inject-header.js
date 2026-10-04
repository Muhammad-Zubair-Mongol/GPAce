/**
 * Inject Header - Common header/navigation injection and app initialization
 * 
 * This script runs on every page and handles:
 * - Navigation bar injection (via NavigationComponent)
 * - Alarm audio element creation
 * - Firebase import map setup
 * - Service worker registration
 * - Notification permission request
 * 
 * Refactored to use centralized StorageAdapter.
 */

// Import StorageAdapter (non-module fallback included)
// Note: Since this file needs to work as both module and non-module,
// we use dynamic import with fallback
const getStorageAdapter = async () => {
    try {
        const { getStorage, STORAGE_KEYS } = await import('./utils/StorageAdapter.js');
        return { getStorage, STORAGE_KEYS };
    } catch {
        // Fallback for non-module contexts
        return {
            getStorage: () => window.StorageService || {
                get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
                set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
            },
            STORAGE_KEYS: {
                ALARMS: 'alarms'
            }
        };
    }
};

/**
 * Initialize common components on page load
 */
async function initializeCommonComponents() {
    const { getStorage, STORAGE_KEYS } = await getStorageAdapter();

    // Create audio element for alarm sound
    createAlarmAudioElement();

    // Add Firebase import map
    addFirebaseImportMap();

    // Load alarm handler module
    loadAlarmHandler();

    // Initialize service worker for alarms
    await initializeAlarmServiceWorker(getStorage, STORAGE_KEYS);

    // Request notification permission
    requestNotificationPermission();

    // Initialize theme across all pages
    await initializeThemeIfAvailable();

    // Inject navigation if NavigationComponent is available
    await injectNavigationIfAvailable();
}

/**
 * Creates the alarm audio element
 */
function createAlarmAudioElement() {
    if (document.getElementById('alarm-sound')) return; // Already exists

    const alarmAudio = document.createElement('audio');
    alarmAudio.id = 'alarm-sound';
    alarmAudio.src = '/alarm-sounds/alarm1.mp3';
    alarmAudio.preload = 'auto';
    document.body.appendChild(alarmAudio);
}

/**
 * Adds Firebase import map for ES modules
 */
function addFirebaseImportMap() {
    // Check if import map already exists
    if (document.querySelector('script[type="importmap"]')) return;

    const moduleScript = document.createElement('script');
    moduleScript.type = 'importmap';
    moduleScript.textContent = JSON.stringify({
        imports: {
            'firebase/app': 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js',
            'firebase/firestore': 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js',
            'firebase/auth': 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
        }
    });
    document.head.appendChild(moduleScript);
}

/**
 * Loads the alarm handler module
 */
function loadAlarmHandler() {
    if (document.querySelector('script[src="/js/alarm-handler.js"]')) return;

    const alarmHandler = document.createElement('script');
    alarmHandler.type = 'module';
    alarmHandler.src = '/js/alarm-handler.js';
    document.body.appendChild(alarmHandler);
}

/**
 * Initializes the alarm service worker
 */
async function initializeAlarmServiceWorker(getStorage, STORAGE_KEYS) {
    if (!('serviceWorker' in navigator)) {
        console.log('[InjectHeader] Service workers not supported');
        return;
    }

    try {
        const registration = await navigator.serviceWorker.register('/js/alarm-service-worker.js');
        console.log('[InjectHeader] Alarm Service Worker registered');

        // Load alarms from storage and schedule active ones
        const storage = getStorage();
        const alarms = storage.get(STORAGE_KEYS.ALARMS || 'alarms', []);

        // Wait for the service worker to be active
        const activeWorker = registration.active || registration.waiting || registration.installing;

        if (activeWorker && activeWorker.state === 'activated') {
            scheduleAlarms(activeWorker, alarms);
        } else if (activeWorker) {
            activeWorker.addEventListener('statechange', (e) => {
                if (e.target.state === 'activated') {
                    scheduleAlarms(registration.active, alarms);
                }
            });
        }
    } catch (error) {
        console.error('[InjectHeader] Alarm Service Worker registration failed:', error);
    }
}

/**
 * Schedules active alarms with the service worker
 */
function scheduleAlarms(worker, alarms) {
    if (!worker) return;

    alarms.forEach(alarm => {
        if (alarm.active) {
            worker.postMessage({
                type: 'SET_ALARM',
                time: alarm.time,
                label: alarm.label
            });
        }
    });
}

/**
 * Requests notification permission if needed
 */
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        // Only request on user interaction to avoid browser warnings
        document.addEventListener('click', function requestPermission() {
            Notification.requestPermission();
            document.removeEventListener('click', requestPermission);
        }, { once: true });
    }
}

/**
 * Initializes theme using canonical themeManager
 */
async function initializeThemeIfAvailable() {
    try {
        const isSubdir = typeof window !== 'undefined' && (
            window.location.pathname.includes('/relaxed-mode/') ||
            window.location.pathname.includes('/scripts/')
        );
        const basePath = isSubdir ? '../' : '';
        const { themeManager } = await import(`${basePath}js/themeManager.js`);
        if (themeManager) {
            await themeManager.initializeTheme();
            console.log('[InjectHeader] Theme initialized successfully');
        }
    } catch (error) {
        console.debug('[InjectHeader] ThemeManager not loaded via module:', error.message);
    }
}

/**
 * Injects navigation using NavigationComponent
 * Enhances existing static nav or injects if absent
 */
async function injectNavigationIfAvailable() {
    const isWorkspace = typeof window !== 'undefined' && (
        window.location.pathname.endsWith('workspace.html') ||
        window.location.pathname.endsWith('/workspace.html') ||
        document.body?.dataset?.noNavigation === 'true' ||
        document.body?.getAttribute?.('data-no-navigation') === 'true'
    );
    if (isWorkspace) {
        console.log('[InjectHeader] Navigation skipped for workspace');
        return;
    }

    try {
        const { injectNavigation } = await import('./components/NavigationComponent.js');

        // Determine relative base path for subfolder pages
        const isSubdir = typeof window !== 'undefined' && (
            window.location.pathname.includes('/relaxed-mode/') ||
            window.location.pathname.includes('/scripts/')
        );
        const basePath = isSubdir ? '../' : '';

        // Inject / enhance navigation component
        injectNavigation({ basePath });
        console.log('[InjectHeader] Navigation initialized successfully');
    } catch (error) {
        // NavigationComponent not available, keep static nav if present and attach fallback scroll-hide
        console.debug('[InjectHeader] NavigationComponent not loaded:', error.message);
        setupScrollHide();
    }
}

/**
 * Sets up scroll-to-hide behavior for navigation (fallback)
 * - Only shows when actively scrolling up or at the very top
 * - Hides when scrolling down past threshold (no timer-based auto-hide)
 */
function setupScrollHide() {
    const nav = document.querySelector('.top-nav');
    if (!nav || nav.dataset?.scrollHideBound === 'true') {
        return;
    }
    nav.dataset.scrollHideBound = 'true';

    let lastScrollY = window.scrollY;
    let ticking = false;
    const scrollThreshold = 10;

    function handleScroll() {
        const currentScrollY = window.scrollY;
        const scrollDelta = currentScrollY - lastScrollY;

        // At the very top - always show
        if (currentScrollY <= 0) {
            nav.classList.remove('nav-hidden');
            lastScrollY = currentScrollY;
            ticking = false;
            return;
        }

        // Trigger show/hide based on scroll direction
        if (Math.abs(scrollDelta) >= scrollThreshold) {
            if (scrollDelta < 0) {
                // Scrolling UP - show nav
                nav.classList.remove('nav-hidden');
            } else if (currentScrollY > 80) {
                // Scrolling DOWN - hide
                nav.classList.add('nav-hidden');
            }
            lastScrollY = currentScrollY;
        }

        ticking = false;
    }

    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(handleScroll);
            ticking = true;
        }
    }, { passive: true });

    console.log('[InjectHeader] Scroll-hide behavior initialized');
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCommonComponents);
} else {
    initializeCommonComponents();
}