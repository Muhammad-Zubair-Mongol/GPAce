// data-sync-integration.js - Initializes data synchronization

import dataSyncManager from './data-sync-manager.js';

/**
 * Initializes data synchronization after Firebase authentication is ready
 */
export async function initializeDataSync() {
    // Wait for Firebase to be initialized
    if (window.firebaseInitialized) {
        await window.firebaseInitialized;
    }

    // Wait for subject marks module to be initialized
    if (window.subjectMarksInitialized) {
        await window.subjectMarksInitialized;
    }

    // Initialize data sync after Firebase initialization
    const initializeSync = async () => {
        // Wait for auth to be ready
        await new Promise(resolve => {
            const checkAuth = setInterval(() => {
                if (window.auth) {
                    window.auth.onAuthStateChanged((user) => {
                        clearInterval(checkAuth);
                        resolve(user);
                    });
                }
            }, 100);
        });

        // Initialize data sync
        await dataSyncManager.initializeDataSync(true);

        // Initialize all subject weightages
        if (window.initializeAllSubjectWeightages) {
            await window.initializeAllSubjectWeightages();
        } else {
            console.warn('initializeAllSubjectWeightages not available');
        }

        // Start periodic sync
        dataSyncManager.startPeriodicSync();
    };

    // Run initialization immediately
    initializeSync();

    // Also run on DOMContentLoaded for safety
    document.addEventListener('DOMContentLoaded', initializeSync);

    // Listen for sync completion
    window.addEventListener('dataSyncComplete', (event) => {
        console.log('🔄 Data sync completed at:', new Date(event.detail.timestamp).toLocaleString());
        // Refresh UI if needed
        if (typeof updateSubjectsList === 'function') {
            updateSubjectsList();
        }
    });
}

// Initialize when the script is loaded
initializeDataSync();
