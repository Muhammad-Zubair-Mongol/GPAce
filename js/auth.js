/**
 * auth.js - Firebase Authentication & User Tenancy Integration
 * 
 * Manages user authentication, Google Sign-in/Sign-out, and coordinates
 * user boundary isolation across StorageService and SecureStorage.
 * 
 * Part of Step 40: Storage Layer Abstraction & Boundary Enforcement.
 */

import storageService from './services/StorageService.js';
import secureStorage from './services/SecureStorage.js';

const isNode = typeof process !== 'undefined' && Boolean(process.versions && process.versions.node);

let app = null;
let auth = null;
let provider = null;
let signOutFn = null;
let signInWithPopupFn = null;
let onAuthStateChangedFn = null;
let authUnsubscribe = null;

// Initialize Firebase in browser environments
if (!isNode && typeof window !== 'undefined') {
    try {
        const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");
        const firebaseAuth = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        const { firebaseConfig, getOrCreateFirebaseApp } = await import("./firebaseConfig.js");

        app = getOrCreateFirebaseApp(initializeApp);
        if (app) {
            auth = firebaseAuth.getAuth(app);
            provider = new firebaseAuth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });

            signOutFn = firebaseAuth.signOut;
            signInWithPopupFn = firebaseAuth.signInWithPopup;
            onAuthStateChangedFn = firebaseAuth.onAuthStateChanged;
        }
    } catch (err) {
        console.warn("[Auth] Firebase dynamic initialization bypassed:", err.message);
    }
}

// Fallback to window.auth if set externally
if (!auth && typeof window !== 'undefined' && window.auth) {
    auth = window.auth;
}

export { auth };

/**
 * Handle user state transitions and enforce storage boundaries.
 * Resets in-memory caches and switches key-space without destroying offline drafts.
 * 
 * @param {Object|null} user - Firebase user object or null
 */
export function handleAuthStateChange(user) {
    if (user && user.uid) {
        console.log('🔐 User authenticated via Firebase:', user.email || user.uid);

        // Switch key-space to verified user UID and reset caches
        storageService.setUser(user.uid);
        secureStorage.setUser(user.uid);

        if (typeof updateUIForUser === 'function') {
            updateUIForUser(user);
        }

        // Drive API sync
        if (typeof window !== 'undefined' && window.googleDriveAPI && typeof window.googleDriveAPI.handleFirebaseSignIn === 'function') {
            try {
                window.googleDriveAPI.handleFirebaseSignIn();
            } catch (driveErr) {
                console.warn("[Auth] Drive API sync error:", driveErr);
            }
        }
    } else {
        console.log('🔒 User signed out from Firebase');

        // Reset in-memory caches and switch key-space to anonymous without destroying drafts
        storageService.setUser(null);
        secureStorage.setUser(null);

        if (typeof updateUIForSignedOut === 'function') {
            updateUIForSignedOut();
        }

        if (typeof window !== 'undefined' && window.googleDriveAPI && typeof window.googleDriveAPI.handleFirebaseSignOut === 'function') {
            try {
                window.googleDriveAPI.handleFirebaseSignOut();
            } catch (driveErr) {
                console.warn("[Auth] Drive API sign-out error:", driveErr);
            }
        }
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        const EventCtor = typeof CustomEvent !== 'undefined' ? CustomEvent : (window.CustomEvent || null);
        if (EventCtor) {
            window.dispatchEvent(new EventCtor('gpace-auth-state', { detail: { user: user || null } }));
        }
    }
}

/**
 * Handle Google Sign In
 */
export async function signInWithGoogle() {
    try {
        if (!auth && typeof window !== 'undefined' && window.auth) {
            auth = window.auth;
        }
        if (!auth || !signInWithPopupFn) {
            throw new Error("Firebase Auth is not available for popup sign-in");
        }

        const result = await signInWithPopupFn(auth, provider);
        const user = result.user;
        handleAuthStateChange(user);

        // Safe firestore subjects load
        if (typeof window !== 'undefined') {
            try {
                if (window.loadSubjectsFromFirestore) {
                    await window.loadSubjectsFromFirestore();
                } else if (!isNode) {
                    const firestoreMod = await import('./firestore.js');
                    if (firestoreMod && firestoreMod.loadSubjectsFromFirestore) {
                        await firestoreMod.loadSubjectsFromFirestore();
                    }
                }
            } catch (err) {
                console.warn('[Auth] Non-fatal firestore load notice:', err.message);
            }
        }

        return user;
    } catch (error) {
        console.error("Error signing in with Google:", error);
        throw error;
    }
}

/**
 * Handle Sign Out.
 * Enforces key-space switch to anonymous and resets in-memory user caches,
 * ensuring User A's data cannot be read by User B while offline uncommitted drafts survive.
 */
export async function signOutUser() {
    try {
        if (auth && signOutFn) {
            await signOutFn(auth);
        }
        // Always enforce local boundary reset regardless of remote sign-out outcome
        handleAuthStateChange(null);
    } catch (error) {
        console.error("Error signing out:", error);
        // Ensure boundaries are reset even if network signOut throws
        handleAuthStateChange(null);
        throw error;
    }
}

/**
 * Listen for auth state changes and wire boundary isolation
 */
export function initializeAuth(customAuth = null) {
    const activeAuth = customAuth || auth || (typeof window !== 'undefined' ? window.auth : null);

    if (activeAuth && !authUnsubscribe && onAuthStateChangedFn) {
        authUnsubscribe = onAuthStateChangedFn(activeAuth, (user) => {
            handleAuthStateChange(user);
        });
    } else if (activeAuth && !authUnsubscribe && typeof activeAuth.onAuthStateChanged === 'function') {
        authUnsubscribe = activeAuth.onAuthStateChanged((user) => {
            handleAuthStateChange(user);
        });
    }

    if (typeof window !== 'undefined') {
        window.auth = activeAuth;
    }
}

/**
 * Update UI for signed-in user
 */
export function updateUIForUser(user) {
    if (typeof document === 'undefined') return;
    const userProfile = document.getElementById('userProfile');
    if (userProfile) {
        userProfile.style.display = 'flex';
    }
}

/**
 * Update UI for signed-out state
 */
export function updateUIForSignedOut() {
    if (typeof document === 'undefined') return;
    const userProfile = document.getElementById('userProfile');
    if (userProfile) {
        userProfile.style.display = 'none';
    }
}

// Automatically initialize auth when DOM is loaded in browser
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('🔒 Initializing Firebase authentication...');
        initializeAuth();
    });
}

// Modules loaded after DOMContentLoaded still need the shared auth listener.
if (typeof document !== 'undefined' && document.readyState !== 'loading') {
    initializeAuth();
}

// Export global bindings for browser backward compatibility
if (typeof window !== 'undefined') {
    window.auth = auth;
    window.signInWithGoogle = signInWithGoogle;
    window.signOutUser = signOutUser;
    window.handleAuthStateChange = handleAuthStateChange;
}
