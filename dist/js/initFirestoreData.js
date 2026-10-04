/**
 * @deprecated
 * This file is deprecated and its logic has been fully migrated to DataInitializationService.js and TaskService.js.
 * 
 * IF YOU SEE THIS FILE BEING LOADED, IT MEANS SOME OLD HTML REFERENCES IT.
 * PLEASE REMOVE THE SCRIPT TAG FROM YOUR HTML.
 */

console.warn('[DEPRECATED] initFirestoreData.js loaded. Logic disabled to prevent data corruption. Use DataInitializationService instead.');

export async function initFirestoreData() {
    console.error('[DEPRECATED] initFirestoreData() called. Ignoring. Please use DataInitializationService.');
    return Promise.resolve();
}

// Export dummy functions to prevent import crash if other modules import them
export const initializeData = initFirestoreData;
export const initializeFirestoreData = initFirestoreData; // Alias for index.html compatibility
export const syncPriorityTasks = async () => { };
export const calculatePriorityScores = async () => { };