// firestore-global.js - Ensures Firestore functions are available globally

import {
    saveSubjectsToFirestore,
    loadSubjectsFromFirestore,
    saveSubjectMarksToFirestore,
    loadSubjectMarksFromFirestore,
    saveSubjectWeightagesToFirestore,
    loadSubjectWeightagesFromFirestore
} from './firestore.js';

/**
 * Exposes Firestore functions to the global window object
 */
export function exposeFirestoreFunctions() {
    // Make sure these functions are available globally
    window.saveSubjectsToFirestore = saveSubjectsToFirestore;
    window.loadSubjectsFromFirestore = loadSubjectsFromFirestore;
    window.saveSubjectMarksToFirestore = saveSubjectMarksToFirestore;
    window.loadSubjectMarksFromFirestore = loadSubjectMarksFromFirestore;
    window.saveSubjectWeightagesToFirestore = saveSubjectWeightagesToFirestore;
    window.loadSubjectWeightagesFromFirestore = loadSubjectWeightagesFromFirestore;
    
    console.log('Firestore functions exposed to window object');
}

// Initialize when the script is loaded
exposeFirestoreFunctions();

// Create a promise that resolves when Firestore functions are exposed
window.firestoreFunctionsExposed = Promise.resolve(true);

// Also initialize on DOMContentLoaded for safety
document.addEventListener('DOMContentLoaded', () => {
    // If not already initialized, initialize Firestore functions
    if (!window.loadSubjectsFromFirestore) {
        exposeFirestoreFunctions();
    }
});
