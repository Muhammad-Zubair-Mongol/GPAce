/**
 * Firebase Authentication Module
 * Handles Firebase initialization and authentication functionality
 */

// Import Firebase modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Firebase configuration for modern SDK
const firebaseConfig = {
    apiKey: "AIzaSyCdxGGpfoWD_M_6BwWFqWZ-6MAOKTUjIrI",
    authDomain: "mzm-gpace.firebaseapp.com",
    projectId: "mzm-gpace",
    storageBucket: "mzm-gpace.firebasestorage.app",
    messagingSenderId: "949014366726",
    appId: "1:949014366726:web:3aa05a6e133e2066c45187"
};

// Firebase configuration for legacy SDK
const legacyFirebaseConfig = {
    apiKey: "AIzaSyCdxGGpfoWD_M_6BwWFqWZ-6MAOKTUjIrI",
    authDomain: "mzm-gpace.firebaseapp.com",
    databaseURL: "https://mzm-gpace-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "mzm-gpace",
    storageBucket: "mzm-gpace.appspot.com",
    messagingSenderId: "949014366726",
    appId: "1:949014366726:web:3aa05a6e133e2066c45187",
    measurementId: "G-5KDN1WTCQ1"
};

/**
 * Initialize Firebase and set up authentication
 */
function initializeFirebase() {
    // Initialize Firebase with modern SDK
    const app = initializeApp(firebaseConfig);

    // Set up auth
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    // Make available globally
    window.auth = auth;
    window.signInWithGoogle = () => signInWithPopup(auth, provider);
    window.signOutUser = () => signOut(auth);

    // Initialize legacy Firebase if available
    initializeLegacyFirebase();
}

/**
 * Initialize legacy Firebase SDK if available
 */
function initializeLegacyFirebase() {
    if (typeof window.firebase !== 'undefined' && window.firebase.initializeApp) {
        // Check if Firebase is already initialized
        if (!window.firebase.apps || !window.firebase.apps.length) {
            window.firebase.initializeApp(legacyFirebaseConfig);
            console.log('Legacy Firebase SDK initialized');
        }
    } else {
        console.warn('Legacy Firebase SDK not available');
    }
}

// Initialize Firebase when this module is imported
initializeFirebase();

export { initializeFirebase };
