/**
 * Firebase Configuration and Initialization Module
 * Centralizes Firebase setup and prevents duplicate initialization
 */

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCdxGGpfoWD_M_6BwWFqWZ-6MAOKTUjIrI",
    authDomain: "mzm-gpace.firebaseapp.com",
    projectId: "mzm-gpace",
    storageBucket: "mzm-gpace.firebasestorage.app",
    messagingSenderId: "949014366726",
    appId: "1:949014366726:web:3aa05a6e133e2066c45187"
};

/**
 * Initializes Firebase and sets up authentication
 * Makes Firebase services available globally
 * @returns {Promise<Object>} Firebase auth and db instances
 */
export async function initializeFirebase() {
    try {
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth, signInWithPopup, GoogleAuthProvider } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        
        // Check if we already have Firebase initialized
        const existingApp = window.firebase?.apps?.[0];

        if (!existingApp) {
            // Initialize Firebase
            const app = initializeApp(firebaseConfig);
            
            // Set up auth
            const firebaseAuth = getAuth(app);
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            
            // Get Firestore instance
            const db = getFirestore(app);
            
            // Make available globally
            window.auth = firebaseAuth;
            window.db = db;
            window.signInWithGoogle = () => signInWithPopup(firebaseAuth, provider);
            
            console.log('Firebase initialized successfully');
            return { auth: firebaseAuth, db };
        } else {
            console.log('Using existing Firebase instance');
            return { auth: window.auth, db: window.db };
        }
    } catch (error) {
        console.error('Error initializing Firebase:', error);
        throw error;
    }
}

/**
 * Sets up Firebase authentication and makes related functions available globally
 * @returns {Promise<void>}
 */
export async function setupFirebaseAuth() {
    try {
        // Import required modules
        const { saveSubjectsToFirestore, loadSubjectsFromFirestore, listUserSemesters, deleteSemesterFromFirestore } = await import('./firestore.js');
        const { updateSubjectPerformance } = await import('./subject-marks.js');
        
        // Make functions available globally
        window.saveSubjectsToFirestore = saveSubjectsToFirestore;
        window.loadSubjectsFromFirestore = loadSubjectsFromFirestore;
        window.listUserSemesters = listUserSemesters;
        window.deleteSemesterFromFirestore = deleteSemesterFromFirestore;
        window.updateSubjectPerformance = updateSubjectPerformance;
        
        console.log('Firebase auth functions setup complete');
    } catch (error) {
        console.error('Error setting up Firebase auth functions:', error);
        throw error;
    }
}
