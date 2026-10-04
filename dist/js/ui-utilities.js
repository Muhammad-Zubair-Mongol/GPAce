/**
 * UI Utilities Module
 * Contains utility functions for UI-related functionality
 * 
 * Refactored to use centralized StorageAdapter
 */

import { getStorage, STORAGE_KEYS } from './utils/StorageAdapter.js';

/**
 * Toggles between light and dark theme
 * Updates the theme icon, text, and saves the preference to storage
 */
export function toggleTheme() {
    if (typeof window !== 'undefined' && window.themeManager?.toggleTheme) {
        return window.themeManager.toggleTheme();
    }
    const storage = getStorage();
    const body = document.body;
    const isLight = body.classList.toggle('light-theme');
    const nextTheme = isLight ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    storage.set(STORAGE_KEYS.THEME, nextTheme);
    try { localStorage.setItem('theme', nextTheme); } catch {}
    return nextTheme;
}

/**
 * Initializes the theme based on storage preference
 * Should be called on page load
 */
export function initializeTheme() {
    if (typeof window !== 'undefined' && window.themeManager?.initializeTheme) {
        return window.themeManager.initializeTheme();
    }
    const storage = getStorage();
    if (storage.get(STORAGE_KEYS.THEME, null) === 'light') {
        document.body.classList.add('light-theme');
        document.documentElement.setAttribute('data-theme', 'light');
    }
}

/**
 * Sets up periodic sync of data
 * Syncs data every 5 minutes if user is active and authenticated
 * @returns {Function} Cleanup function to remove listeners and timers
 */
export function setupPeriodicSync() {
    // Sync every 5 minutes if user is active and authenticated
    const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

    // Initial sync timer
    let syncTimer = null;
    let initialSyncTimeout = null;

    // Track user activity
    let userIsActive = true;
    let lastActivity = Date.now();

    // Store listener references for cleanup
    const activityListeners = [];
    let visibilityListener = null;
    let authUnsubscribe = null;

    // User activity detection
    function updateUserActivity() {
        userIsActive = true;
        lastActivity = Date.now();
    }

    // Add activity listeners with cleanup tracking
    ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(event => {
        document.addEventListener(event, updateUserActivity, { passive: true });
        activityListeners.push({ event, handler: updateUserActivity });
    });

    // The sync function
    async function syncCurrentSemester() {
        const storage = getStorage();
        try {
            // Only sync if user is authenticated and active in last 10 minutes
            if (!window.auth?.currentUser || (!userIsActive && (Date.now() - lastActivity > 10 * 60 * 1000))) {
                return;
            }

            // Get current semester from storage
            const currentSemester = storage.get(STORAGE_KEYS.CURRENT_SEMESTER, 'default');

            // Get current semester data
            const allSemesters = storage.get(STORAGE_KEYS.SEMESTERS, {});
            const semesterData = allSemesters[currentSemester];

            if (!semesterData || !semesterData.subjects || semesterData.subjects.length === 0) {
                return;
            }

            // Skip if synced in the last minute (prevents unnecessary syncs)
            const lastSynced = semesterData.lastSynced ? new Date(semesterData.lastSynced) : null;
            if (lastSynced && (Date.now() - lastSynced.getTime() < 60 * 1000)) {
                return;
            }

            // Silent sync to Firestore
            console.log(`[Auto-sync] Syncing semester ${currentSemester} to Firestore...`);

            if (typeof window.saveSubjectsToFirestore === 'function') {
                await window.saveSubjectsToFirestore(semesterData.subjects, currentSemester);

                // Update storage status
                allSemesters[currentSemester].storageStatus = 'both';
                allSemesters[currentSemester].lastSynced = new Date().toISOString();
                storage.set(STORAGE_KEYS.SEMESTERS, allSemesters);

                // Update UI if updateSyncStatus function exists
                if (typeof window.updateSyncStatus === 'function') {
                    window.updateSyncStatus();
                }

                console.log(`[Auto-sync] Successfully synced semester ${currentSemester}`);
            } else {
                console.debug('[Auto-sync] saveSubjectsToFirestore not available yet');
            }
        } catch (error) {
            console.error('[Auto-sync] Error syncing semester:', error);
        }
    }

    // Start periodic sync
    function startSyncTimer() {
        if (syncTimer) clearInterval(syncTimer);
        if (initialSyncTimeout) clearTimeout(initialSyncTimeout);

        syncTimer = setInterval(syncCurrentSemester, SYNC_INTERVAL);

        // Initial sync after a short delay
        initialSyncTimeout = setTimeout(syncCurrentSemester, 10000);
    }

    // Restart timer when auth state changes
    if (window.auth?.onAuthStateChanged) {
        authUnsubscribe = window.auth.onAuthStateChanged(() => {
            startSyncTimer();
        });
    }

    // Start initial timer
    startSyncTimer();

    // Sync when tab becomes visible
    visibilityListener = () => {
        if (document.visibilityState === 'visible') {
            syncCurrentSemester();
        }
    };
    document.addEventListener('visibilitychange', visibilityListener);

    // Cleanup function
    function cleanup() {
        console.log('[Auto-sync] Cleaning up periodic sync');

        // Clear timers
        if (syncTimer) clearInterval(syncTimer);
        if (initialSyncTimeout) clearTimeout(initialSyncTimeout);

        // Remove activity listeners
        activityListeners.forEach(({ event, handler }) => {
            document.removeEventListener(event, handler);
        });

        // Remove visibility listener
        if (visibilityListener) {
            document.removeEventListener('visibilitychange', visibilityListener);
        }

        // Unsubscribe from auth
        if (authUnsubscribe) {
            authUnsubscribe();
        }
    }

    // Register cleanup on page unload
    window.addEventListener('beforeunload', cleanup);

    // Return cleanup function for manual cleanup if needed
    return cleanup;
}

/**
 * Initialize UI utilities
 * Sets up theme and theme toggle button event listeners
 * Called by academic-details.js (the main entry point)
 */
export function initUIUtilities() {
    // Initialize theme
    initializeTheme();

    // Add event listener to theme toggle buttons
    const themeToggleButtons = document.querySelectorAll('.theme-toggle');
    themeToggleButtons.forEach(button => {
        button.addEventListener('click', toggleTheme);
    });

    console.log('[UIUtilities] Initialized');
}
