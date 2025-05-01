/**
 * Firebase Initialization Module
 * Handles Firebase setup, authentication, and data initialization
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { initializeAllSubjectWeightages } from './subject-marks.js';
import {
    saveSubjectsToFirestore,
    loadSubjectsFromFirestore,
    saveSubjectMarksToFirestore,
    loadSubjectMarksFromFirestore,
    saveSubjectWeightagesToFirestore,
    loadSubjectWeightagesFromFirestore
} from './firestore.js';

/**
 * Initialize Firebase application and authentication
 */
export function initializeFirebase() {
    // Initialize Firebase with config
    const app = initializeApp({
        apiKey: "AIzaSyCdxGGpfoWD_M_6BwWFqWZ-6MAOKTUjIrI",
        authDomain: "mzm-gpace.firebaseapp.com",
        projectId: "mzm-gpace",
        storageBucket: "mzm-gpace.firebasestorage.app",
        messagingSenderId: "949014366726",
        appId: "1:949014366726:web:3aa05a6e133e2066c45187"
    });

    // Set up auth
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    // Make available globally
    window.auth = auth;
    window.signInWithGoogle = () => signInWithPopup(auth, provider);

    // Make Firestore functions available globally
    window.saveSubjectsToFirestore = saveSubjectsToFirestore;
    window.loadSubjectsFromFirestore = loadSubjectsFromFirestore;
    window.saveSubjectMarksToFirestore = saveSubjectMarksToFirestore;
    window.loadSubjectMarksFromFirestore = loadSubjectMarksFromFirestore;
    window.saveSubjectWeightagesToFirestore = saveSubjectWeightagesToFirestore;
    window.loadSubjectWeightagesFromFirestore = loadSubjectWeightagesFromFirestore;

    // Initialize data when auth is ready
    setupAuthStateListener(auth);

    return { app, auth };
}

/**
 * Set up authentication state change listener
 * @param {Object} auth - Firebase auth instance
 */
function setupAuthStateListener(auth) {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // Initialize all subject weightages
            await initializeAllSubjectWeightages();
            // Trigger priority score recalculation
            if (typeof updatePriorityScores === 'function') {
                updatePriorityScores();
            }
        }
    });
}

// Initialize Firebase immediately when this module is loaded
const firebaseApp = initializeFirebase();

// Create a promise that resolves when Firebase is initialized
window.firebaseInitialized = Promise.resolve(firebaseApp);

// Also initialize on DOMContentLoaded for safety
document.addEventListener('DOMContentLoaded', () => {
    // If not already initialized, initialize Firebase
    if (!window.auth) {
        initializeFirebase();
    }
});
