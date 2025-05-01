/**
 * UI Utilities Module
 * Contains utility functions for UI-related functionality
 */

/**
 * Toggles between light and dark theme
 * Updates the theme icon, text, and saves the preference to localStorage
 */
export function toggleTheme() {
    const body = document.body;
    const themeIcon = document.querySelector('.theme-icon');
    const themeText = document.querySelector('.theme-text');

    body.classList.toggle('light-theme');

    if (body.classList.contains('light-theme')) {
        themeIcon.textContent = '🌚';
        themeText.textContent = 'Dark Mode';
        localStorage.setItem('theme', 'light');
    } else {
        themeIcon.textContent = '🌞';
        themeText.textContent = 'Light Mode';
        localStorage.setItem('theme', 'dark');
    }
}

/**
 * Initializes the theme based on localStorage preference
 * Should be called on page load
 */
export function initializeTheme() {
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-theme');
        const themeIcon = document.querySelector('.theme-icon');
        const themeText = document.querySelector('.theme-text');
        
        if (themeIcon) themeIcon.textContent = '🌚';
        if (themeText) themeText.textContent = 'Dark Mode';
    }
}

/**
 * Sets up periodic sync of data
 * Syncs data every 5 minutes if user is active and authenticated
 */
export function setupPeriodicSync() {
    // Sync every 5 minutes if user is active and authenticated
    const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

    // Initial sync timer
    let syncTimer = null;

    // Track user activity
    let userIsActive = true;
    let lastActivity = Date.now();

    // User activity detection
    function updateUserActivity() {
        userIsActive = true;
        lastActivity = Date.now();
    }

    // Add activity listeners
    ['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(event => {
        document.addEventListener(event, updateUserActivity, { passive: true });
    });

    // The sync function
    async function syncCurrentSemester() {
        try {
            // Only sync if user is authenticated and active in last 10 minutes
            if (!window.auth?.currentUser || !userIsActive && (Date.now() - lastActivity > 10 * 60 * 1000)) {
                return;
            }

            // Get current semester from localStorage
            const currentSemester = localStorage.getItem('currentAcademicSemester') || 'default';

            // Get current semester data
            const allSemesters = JSON.parse(localStorage.getItem('academicSemesters') || '{}');
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
            await window.saveSubjectsToFirestore(semesterData.subjects, currentSemester);

            // Update storage status
            allSemesters[currentSemester].storageStatus = 'both';
            allSemesters[currentSemester].lastSynced = new Date().toISOString();
            localStorage.setItem('academicSemesters', JSON.stringify(allSemesters));

            // Update UI if updateSyncStatus function exists
            if (typeof window.updateSyncStatus === 'function') {
                window.updateSyncStatus();
            }

            console.log(`[Auto-sync] Successfully synced semester ${currentSemester}`);
        } catch (error) {
            console.error('[Auto-sync] Error syncing semester:', error);
        }
    }

    // Start periodic sync
    function startSyncTimer() {
        if (syncTimer) clearInterval(syncTimer);
        syncTimer = setInterval(syncCurrentSemester, SYNC_INTERVAL);

        // Initial sync after a short delay
        setTimeout(syncCurrentSemester, 10000);
    }

    // Restart timer when auth state changes
    window.auth?.onAuthStateChanged(() => {
        startSyncTimer();
    });

    // Start initial timer
    startSyncTimer();

    // Sync when tab becomes visible
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            syncCurrentSemester();
        }
    });
}

/**
 * Initialize UI utilities
 * Sets up theme and event listeners
 */
export function initUIUtilities() {
    // Initialize theme
    initializeTheme();
    
    // Add event listener to theme toggle buttons
    document.addEventListener('DOMContentLoaded', () => {
        const themeToggleButtons = document.querySelectorAll('.theme-toggle');
        themeToggleButtons.forEach(button => {
            button.addEventListener('click', toggleTheme);
        });
        
        console.log('UI utilities initialized');
    });
}

// Auto-initialize when script is loaded
document.addEventListener('DOMContentLoaded', initUIUtilities);
