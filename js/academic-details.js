/**
 * Main Application Script for Academic Details
 * This is the SINGLE entry point for the academic-details page.
 * 
 * Initializes Firebase, components, and sets up event listeners.
 * All other modules should export initialization functions called from here.
 * 
 * Refactored to use centralized utilities:
 * - StorageAdapter for storage operations
 * - SemesterService for semester state
 * - ModalFactory for modal generation
 */

import { auth, initializeAuth } from './auth.js';
import { getStorage, STORAGE_KEYS } from './utils/StorageAdapter.js';
import { SemesterService } from './services/SemesterService.js';
import { ToastService } from './services/ToastService.js';
import ModalFactory from './components/ModalFactory.js';
import { initSemesterManagement } from './semester-management.js';
import { displaySavedSubjects, initSubjectManagement } from './subject-management.js';
import { setupPeriodicSync, initializeTheme as initThemeFromUtilities, initUIUtilities } from './ui-utilities.js';

// Store cleanup functions for memory management
let cleanupFunctions = [];

/**
 * Wait for Firebase auth to be initialized
 * Returns a Promise that resolves when auth state is determined
 */
function waitForAuthReady() {
    return new Promise((resolve) => {
        // If auth is not available yet, resolve immediately
        if (!window.auth) {
            console.debug('[App] Auth not available, continuing without auth');
            resolve(null);
            return;
        }

        // Wait for auth state change
        const unsubscribe = window.auth.onAuthStateChanged((user) => {
            unsubscribe(); // Stop listening after first call
            console.debug('[App] Auth state resolved:', user ? 'logged in' : 'logged out');
            resolve(user);
        });

        // Timeout after 5 seconds to prevent hanging
        setTimeout(() => {
            console.debug('[App] Auth timeout, continuing');
            resolve(null);
        }, 5000);
    });
}

/**
 * Initialize the application
 */
async function initializeApp() {
    const startTime = performance.now();

    try {
        console.log('[App] GPAce Academic Details - Initializing...');

        // Step 1: Initialize Firebase auth first
        initializeAuth();

        // Step 2: Wait for auth state to be resolved
        const user = await waitForAuthReady();
        console.log('[App] User:', user ? user.email : 'not logged in');

        // Step 3: Initialize SemesterService (loads state from storage)
        await SemesterService.initialize();

        // Step 4: Inject modals from ModalFactory (replaces hardcoded modal HTML)
        ModalFactory.injectModals();

        // Step 5: Initialize theme
        initializeTheme();

        // Step 5b: Initialize UI utilities (theme toggle buttons, etc.)
        initUIUtilities();

        // Step 6: Setup event delegation for data-action attributes
        setupEventDelegation();

        // Step 7: Initialize semester management module
        await initSemesterManagement();

        // Step 8: Initialize subject management module
        initSubjectManagement();

        // Step 9: Display saved subjects
        await displaySavedSubjects();

        // Step 10: Update semester selector
        if (typeof window.updateSemesterSelector === 'function') {
            await window.updateSemesterSelector();
        }

        // Step 11: Set up periodic sync (returns cleanup function)
        const syncCleanup = setupPeriodicSync();
        if (syncCleanup) {
            cleanupFunctions.push(syncCleanup);
        }

        // Step 12: Setup global error handler
        setupGlobalErrorHandler();

        const endTime = performance.now();
        console.log(`[App] GPAce Academic Details v2.0 initialized in ${(endTime - startTime).toFixed(0)}ms`);

        // Debug logging using SemesterService
        SemesterService.logDebugInfo();

    } catch (error) {
        console.error('[App] Error initializing application:', error);
        ToastService.error('Failed to initialize application. Please refresh the page.');

        // Attempt fallback initialization
        await fallbackInitialization();
    }
}

/**
 * Fallback initialization when main init fails
 */
async function fallbackInitialization() {
    console.log('[App] Attempting fallback initialization...');
    const storage = getStorage();

    try {
        // At least try to display local data
        const subjects = storage.get(STORAGE_KEYS.SEMESTERS, {});
        const currentSemester = storage.get(STORAGE_KEYS.CURRENT_SEMESTER, 'default');

        if (subjects[currentSemester]?.subjects?.length > 0) {
            console.log('[App] Found local subjects, attempting to display');
            // Basic display without full initialization
            await displaySavedSubjects?.();
        }
    } catch (fallbackError) {
        console.error('[App] Fallback initialization also failed:', fallbackError);
    }
}

/**
 * Setup global error handler for Firebase and other errors
 */
function setupGlobalErrorHandler() {
    window.addEventListener('error', function (e) {
        const error = e.error || { message: e.message };

        // Don't log the same error multiple times
        const errorKey = error.message || 'unknown';
        if (window._lastError === errorKey) return;
        window._lastError = errorKey;

        console.error('[App] Global error:', error);

        // If we detect a Firebase error, show a helpful message
        if (error.name === 'FirebaseError' || (error.message && error.message.includes('Firebase'))) {
            console.warn('[App] Firebase error detected. Using local data.');
            ToastService.warning('Cloud sync unavailable. Changes saved locally.');
        }
    });

    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', function (e) {
        console.error('[App] Unhandled promise rejection:', e.reason);
        e.preventDefault(); // Prevent default console error
    });
}

/**
 * Initialize theme from storage
 */
function initializeTheme() {
    if (typeof window !== 'undefined' && window.themeManager?.initializeTheme) {
        return window.themeManager.initializeTheme();
    }
    const storage = getStorage();
    const theme = storage.get(STORAGE_KEYS.THEME, 'dark');

    if (theme === 'light') {
        document.body.classList.add('light-theme');
        document.documentElement.setAttribute('data-theme', 'light');
    }
}

/**
 * Setup event delegation for data-action attributes
 * Replaces inline onclick handlers with centralized event handling
 */
function setupEventDelegation() {
    document.addEventListener('click', handleActionClick);
    document.addEventListener('input', handleActionInput);
    document.addEventListener('change', handleActionChange);
}

/**
 * Handle click events for data-action elements
 */
function handleActionClick(event) {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;

    const action = actionElement.dataset.action;

    // Map actions to handlers
    const actions = {
        'showCopySemesterModal': () => window.showCopySemesterModal?.(),
        'showNewSemesterModal': () => window.showNewSemesterModal?.(),
        'editSemesterDetails': () => window.editSemesterDetails?.(),
        'forceSyncSemester': () => window.forceSyncSemester?.(),
        'archiveSemester': () => window.archiveSemester?.(),
        'deleteSemester': () => window.deleteSemester?.(),
        'copySubjectsToNewSemester': () => window.copySubjectsToNewSemester?.(),
        'createNewSemester': () => window.createNewSemester?.(),
        'saveSemesterDetails': () => window.saveSemesterDetails?.(),
        'confirmArchiveSemester': () => window.confirmArchiveSemester?.(),
        'confirmDeleteSemester': () => window.confirmDeleteSemester?.(),
        'selectColorTag': () => {
            const color = actionElement.dataset.color;
            window.selectColorTag?.(actionElement, color);
        },
        'showStorageManager': () => window.showStorageManager?.()
    };

    if (actions[action]) {
        event.preventDefault();
        actions[action]();
    }
}

/**
 * Handle input events for data-action elements
 */
function handleActionInput(event) {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;

    const action = actionElement.dataset.action;

    if (action === 'updateSemesterPreview') {
        window.updateSemesterPreview?.();
    }
}

/**
 * Handle change events for data-action elements
 */
function handleActionChange(event) {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;

    const action = actionElement.dataset.action;

    if (action === 'updateSemesterPreview') {
        window.updateSemesterPreview?.();
    } else if (action === 'validateDeleteConfirmation') {
        // Enable/disable delete button based on confirmation input
        const input = actionElement;
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        const code = document.getElementById('deleteConfirmationCode')?.textContent;

        if (confirmBtn && code) {
            confirmBtn.disabled = input.value !== code;
        }
    }
}

/**
 * Cleanup when page is unloading
 */
function cleanup() {
    console.log('[App] Cleaning up...');
    cleanupFunctions.forEach(fn => {
        try {
            fn();
        } catch (e) {
            console.error('[App] Cleanup error:', e);
        }
    });
}

// Register cleanup handler
window.addEventListener('beforeunload', cleanup);

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);
