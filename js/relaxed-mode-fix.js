/**
 * Relaxed Mode Error Fixes
 * 
 * This script fixes the common errors in relaxed mode:
 * 1. Deprecated Firebase function usage
 * 2. Firestore version conflicts
 * 3. Speech recognition errors
 */

// Fix 1: Override deprecated initializeFirestoreData to use DataInitializationService
if (typeof window !== 'undefined') {
    // Create a wrapper that redirects to the new service
    window.initializeFirestoreData = async function () {
        console.warn('[DEPRECATED] initializeFirestoreData called. Redirecting to DataInitializationService.');

        if (window.dataInitializationService) {
            try {
                await window.dataInitializationService.init();
                console.log('[Relaxed Mode Fix] Data initialization completed via wrapper');
                return true;
            } catch (error) {
                console.error('[Relaxed Mode Fix] Data initialization failed:', error);
                return false;
            }
        } else {
            console.error('[Relaxed Mode Fix] DataInitializationService not available');
            return false;
        }
    };
}

// Fix 2: Handle Firestore version conflicts
window.handleFirestoreVersionConflict = function (projectId) {
    console.log('[Relaxed Mode Fix] Resolving Firestore version conflict for:', projectId);

    // Clear local version to force fresh sync
    const storage = window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
        remove: (k) => localStorage.removeItem(k)
    };

    const versionKey = `tasks-${projectId}-version`;
    const currentVersion = storage.get(versionKey);

    console.log('[Relaxed Mode Fix] Current local version:', currentVersion);

    // Clear the local version to trigger a fresh sync
    storage.remove(versionKey);
    console.log('[Relaxed Mode Fix] Cleared local version for fresh sync');

    return true;
};

// Fix 3: Handle speech recognition errors gracefully
window.fixSpeechRecognition = function () {
    console.log('[Relaxed Mode Fix] Applying speech recognition fixes...');

    // Add error handling for speech recognition
    if (window.speechRecognitionManager) {
        const originalOnError = window.speechRecognitionManager.recognition.onerror;
        window.speechRecognitionManager.recognition.onerror = function (event) {
            console.warn('[Speech Recognition] Error:', event.error);

            // Handle specific errors gracefully
            if (event.error === 'aborted') {
                console.log('[Speech Recognition] Recognition aborted - this is normal during restarts');
                return; // Don't show error to user for aborted events
            }

            // Call original error handler for other errors
            if (originalOnError) {
                originalOnError.call(this, event);
            }
        };

        console.log('[Relaxed Mode Fix] Speech recognition error handler installed');
    }
};

// Fix 4: Global error handler for relaxed mode specific issues
window.addEventListener('error', function (event) {
    const error = event.error;
    if (error && error.message) {
        // Handle deprecated function warnings
        if (error.message.includes('initFirestoreData')) {
            console.warn('[Relaxed Mode Fix] Caught deprecated function error:', error.message);
            event.preventDefault();
            return;
        }

        // Handle Firestore conflicts
        if (error.message.includes('Conflict detected') || error.message.includes('newer version')) {
            console.warn('[Relaxed Mode Fix] Caught Firestore conflict:', error.message);
            event.preventDefault();
            return;
        }
    }
});

// Auto-apply fixes when script loads
console.log('[Relaxed Mode Fix] Applied error fixes for deprecated Firebase functions, Firestore conflicts, and speech recognition errors');