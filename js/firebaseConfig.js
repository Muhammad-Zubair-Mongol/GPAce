/**
 * Firebase Configuration Module
 * Centralizes Firebase config to prevent duplicate initialization errors.
 * 
 * Usage:
 *   import { firebaseConfig, getOrCreateFirebaseApp } from './firebaseConfig.js';
 *   import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
 *   
 *   const app = getOrCreateFirebaseApp(initializeApp, getApps);
 */

export const firebaseConfig = {
  apiKey: "AIzaSyCdxGGpfoWD_M_6BwWFqWZ-6MAOKTUjIrI",
  authDomain: "mzm-gpace.firebaseapp.com",
  projectId: "mzm-gpace",
  storageBucket: "mzm-gpace.firebasestorage.app",
  messagingSenderId: "949014366726",
  appId: "1:949014366726:web:3aa05a6e133e2066c45187"
};

/**
 * Get existing Firebase app or create a new one
 * Prevents duplicate initialization errors
 * 
 * @param {Function} initializeApp - Firebase initializeApp function
 * @param {Function} getApps - Firebase getApps function (optional, for v9+)
 * @returns {Object|null} Firebase app instance
 */
export function getOrCreateFirebaseApp(initializeApp, getApps = null) {
  try {
    // For Firebase SDK v9+ (module-based) with getApps
    if (typeof getApps === 'function') {
      const existingApps = getApps();
      if (existingApps.length > 0) {
        console.log("[FirebaseConfig] Using existing Firebase app.");
        return existingApps[0];
      }
    }

    // For Firebase SDK v9 (module-based)
    if (typeof initializeApp === 'function') {
      try {
        const app = initializeApp(firebaseConfig);
        console.log("[FirebaseConfig] Firebase app initialized.");
        return app;
      } catch (e) {
        // If app already exists, Firebase throws 'app/duplicate-app' error
        if (e.code === 'app/duplicate-app') {
          console.log("[FirebaseConfig] Firebase app already exists, using existing.");
          // Return the existing app
          return initializeApp();
        }
        throw e;
      }
    }

    // For Firebase SDK v8 (global namespace)
    else if (typeof window !== 'undefined' && window.firebase) {
      if (!window.firebase.apps.length) {
        const app = window.firebase.initializeApp(firebaseConfig);
        console.log("[FirebaseConfig] Firebase app initialized (v8).");
        return app;
      }
      console.log("[FirebaseConfig] Using existing Firebase app (v8).");
      return window.firebase.apps[0];
    }

    console.warn("[FirebaseConfig] No Firebase SDK found.");
    return null;
  } catch (e) {
    console.error("[FirebaseConfig] Error with Firebase app initialization:", e);
    return null;
  }
}

// Default export for convenience
export default {
  config: firebaseConfig,
  getOrCreateApp: getOrCreateFirebaseApp
};
