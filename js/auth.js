// Import necessary Firebase functions and the centralized config/init helper
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"; // Keep for getOrCreateFirebaseApp
import {
    getAuth,
    signInWithPopup,
    GoogleAuthProvider,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { loadSubjectsFromFirestore } from './firestore.js'; // Keep if needed elsewhere
import { firebaseConfig, getOrCreateFirebaseApp } from './firebaseConfig.js'; // Import shared config and init function

// Get or create the Firebase app instance safely
const app = getOrCreateFirebaseApp(initializeApp);

// Get Auth instance only if app was successfully initialized
export const auth = app ? getAuth(app) : null;

// Log error if auth couldn't be initialized
if (!auth) {
    console.error("Firebase Auth could not be initialized because the Firebase App instance is not available.");
}
const provider = new GoogleAuthProvider();

// --- MODIFICATION START ---
// Define the Google Drive scopes needed (should match googleDriveApi.js)
const DRIVE_SCOPES = [
    'https://www.googleapis.com/auth/drive.file',
    // 'https://www.googleapis.com/auth/drive.appdata' // Add if you still use appdata scope
];

// Add the Drive scopes to the Google Auth Provider
DRIVE_SCOPES.forEach(scope => {
    provider.addScope(scope);
});
// --- MODIFICATION END ---


// Configure Google Provider
provider.setCustomParameters({
    prompt: 'select_account'
});

// Handle Google Sign In
export async function signInWithGoogle() {
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        updateUIForUser(user);

        try {
            await loadSubjectsFromFirestore(); // Keep if needed
            console.log('Subjects loaded after login');
        } catch (error) {
            console.error('Error loading subjects after login:', error);
        }

        // --- ADDITION ---
        // After successful Firebase sign-in, ensure Drive API is ready
        if (window.googleDriveAPI && typeof window.googleDriveAPI.handleFirebaseSignIn === 'function') {
            console.log("signInWithGoogle: Triggering Drive API sign-in handling...");
             await window.googleDriveAPI.handleFirebaseSignIn();
        } else {
            console.warn("signInWithGoogle: googleDriveAPI not ready after sign in.");
        }
        // --- END ADDITION ---

        return user;
    } catch (error) {
        console.error("Error signing in with Google:", error);
        // Optional: Check for specific errors like 'popup_closed_by_user'
        // if (error.code !== 'auth/popup-closed-by-user') {
        //    throw error;
        //}
        throw error; // Re-throw by default
    }
}

// Handle Sign Out
export async function signOutUser() {
    try {
        await signOut(auth);
        // --- ADDITION ---
        // Also clear Drive API state on sign out
        if (window.googleDriveAPI && typeof window.googleDriveAPI.handleFirebaseSignOut === 'function') {
            window.googleDriveAPI.handleFirebaseSignOut();
        }
        // --- END ADDITION ---
        // updateUIForSignedOut(); // This will be called by onAuthStateChanged
    } catch (error) {
        console.error("Error signing out:", error);
        throw error;
    }
}

// Listen for auth state changes
export function initializeAuth() {
    onAuthStateChanged(auth, async (user) => { // Make async
        if (user) {
            console.log('🔐 User authenticated via Firebase:', user.email);
            updateUIForUser(user);

            // --- MODIFICATION: Ensure Drive API syncs with Firebase state ---
            if (window.googleDriveAPI && typeof window.googleDriveAPI.handleFirebaseSignIn === 'function') {
                try {
                     console.log("onAuthStateChanged(user): Triggering Drive API sign-in handling...");
                    await window.googleDriveAPI.handleFirebaseSignIn();
                } catch(driveError) {
                    console.warn("Drive API failed to sync with Firebase sign-in on initial load:", driveError);
                    // App can continue, Drive features might require manual auth later
                }
            } else {
                 console.warn("onAuthStateChanged(user): googleDriveAPI not available yet.");
                 // Maybe set a flag to try again later if googleDriveAPI loads after auth state check
                 window._pendingDriveAuthSync = true;
            }
            // --- END MODIFICATION ---


            // Keep device detection logic if needed
            const lastDevice = localStorage.getItem('lastAuthDevice');
            const currentDevice = generateDeviceId();
            if (lastDevice !== currentDevice) {
                console.log('📱 New device detected, forcing Firestore sync');
                localStorage.setItem('forceFirestoreSync', 'true');
                localStorage.setItem('lastAuthDevice', currentDevice);
            }

            // Keep Firestore data initialization logic
            if (window.initializeFirestoreData) {
                console.log('🔄 Auth state changed (user), initializing Firestore data...');
                window.initializeFirestoreData();
            } else {
                console.log('⚠️ initializeFirestoreData not available yet');
                window._pendingFirestoreInit = true;
            }

        } else {
            console.log('🔒 User signed out from Firebase');
            // --- MODIFICATION: Ensure Drive API syncs with Firebase state ---
             if (window.googleDriveAPI && typeof window.googleDriveAPI.handleFirebaseSignOut === 'function') {
                window.googleDriveAPI.handleFirebaseSignOut();
             } else {
                 console.warn("onAuthStateChanged(null): googleDriveAPI not available to handle sign out.");
             }
            // --- END MODIFICATION ---
            updateUIForSignedOut();
        }
    });

    // Expose the auth state globally (keep as is)
    window.auth = auth;
}

// Generate Device ID (keep as is)
function generateDeviceId() {
    const screenProps = `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;
    const browserProps = navigator.userAgent;
    let fingerprint = localStorage.getItem('browserFingerprint');
    if (!fingerprint) {
        // Simple hash function (not cryptographically secure, just for basic ID)
        const rawId = `${screenProps}-${browserProps}-${Date.now()}`;
        let hash = 0;
        for (let i = 0; i < rawId.length; i++) {
            const char = rawId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }
        fingerprint = String(hash);
        localStorage.setItem('browserFingerprint', fingerprint);
    }
    return fingerprint;
}

// Update UI for signed-in user (Keep your existing implementation)
function updateUIForUser(user) {
    const authButton = document.getElementById('authButton'); // Assuming you have this button
    const userProfile = document.getElementById('userProfile'); // Assuming you have this profile area

    if (authButton) {
        // Example: Replace sign-in with user info/logout
        authButton.innerHTML = `
            <img src="${user.photoURL || 'default-avatar.png'}" alt="${user.displayName}" class="user-avatar">
            <span class="user-name">${user.displayName || user.email}</span>
            <button id="signOutBtn" class="logout-btn">Sign Out</button>
        `;
        const signOutBtn = document.getElementById('signOutBtn');
        if (signOutBtn) {
            signOutBtn.onclick = signOutUser;
        }
        authButton.onclick = null; // Remove previous sign-in handler
    }
    if (userProfile) {
        userProfile.style.display = 'flex'; // Or 'block'
        // Populate profile details if needed
    }
    console.log("UI Updated for Signed In User");
}

// Update UI for signed-out state (Keep your existing implementation)
function updateUIForSignedOut() {
    const authButton = document.getElementById('authButton'); // Assuming you have this button
    const userProfile = document.getElementById('userProfile'); // Assuming you have this profile area

    if (authButton) {
        // Example: Show sign-in button
        authButton.innerHTML = '<button id="signInBtn"><i class="fas fa-sign-in-alt"></i> Sign In with Google</button>';
        const signInBtn = document.getElementById('signInBtn');
        if (signInBtn) {
            signInBtn.onclick = signInWithGoogle;
        }
        authButton.onclick = null; // Remove potential sign-out handler
    }
    if (userProfile) {
        userProfile.style.display = 'none';
        // Clear profile details if needed
    }
    console.log("UI Updated for Signed Out User");
}


// Automatically initialize auth when this script is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🔒 Initializing Firebase authentication...');
    initializeAuth();

    // Check every 500ms if initializeFirestoreData becomes available
    // when there's a pending initialization
    if (window._pendingFirestoreInit) {
        const checkInterval = setInterval(() => {
            if (window.initializeFirestoreData) {
                console.log('🔄 initializeFirestoreData now available, running pending initialization...');
                window.initializeFirestoreData();
                window._pendingFirestoreInit = false; // Clear flag
                clearInterval(checkInterval);
            }
        }, 500);

        // Stop checking after 10 seconds to avoid infinite loops
        setTimeout(() => {
            if(window._pendingFirestoreInit) {
                console.warn("Firestore init check timed out.");
            }
            clearInterval(checkInterval);
        }, 10000);
    }

    // Similar check for pending Drive auth sync
    if (window._pendingDriveAuthSync) {
         const driveCheckInterval = setInterval(async () => {
            if (window.googleDriveAPI && typeof window.googleDriveAPI.handleFirebaseSignIn === 'function') {
                if (auth.currentUser) { // Only run if user is actually signed in
                     console.log('🔄 googleDriveAPI now available, running pending auth sync...');
                     try {
                        await window.googleDriveAPI.handleFirebaseSignIn();
                     } catch(e){ console.error("Error during pending drive auth sync:", e);}
                     window._pendingDriveAuthSync = false; // Clear flag
                     clearInterval(driveCheckInterval);
                } else {
                    // User signed out before Drive API loaded, no sync needed
                     window._pendingDriveAuthSync = false;
                     clearInterval(driveCheckInterval);
                }
            }
        }, 500);
         setTimeout(() => {
              if(window._pendingDriveAuthSync) {
                console.warn("Drive auth sync check timed out.");
              }
              clearInterval(driveCheckInterval);
         }, 10000);
    }
});

// Export global auth instance (keep as is)
window.auth = auth;
window.signInWithGoogle = signInWithGoogle;
window.signOutUser = signOutUser;