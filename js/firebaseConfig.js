// Firebase configuration module - centralizes Firebase config to prevent duplicate initialization errors
export const firebaseConfig = {
  apiKey: "AIzaSyCdxGGpfoWD_M_6BwWFqWZ-6MAOKTUjIrI",
  authDomain: "mzm-gpace.firebaseapp.com",
  projectId: "mzm-gpace",
  storageBucket: "mzm-gpace.firebasestorage.app",
  messagingSenderId: "949014366726",
  appId: "1:949014366726:web:3aa05a6e133e2066c45187"
};

// This function checks if Firebase is already initialized to prevent duplicates
export function getOrCreateFirebaseApp(initializeApp) {
  try {
    // For Firebase SDK v9 (module-based)
    if (typeof initializeApp === 'function') {
      try {
        return initializeApp(firebaseConfig);
      } catch (e) {
        // If app already exists, Firebase throws 'app/duplicate-app' error
        if (e.code === 'app/duplicate-app') {
          console.log("Firebase app already exists, using existing app.");
          // Return the existing app
          return initializeApp();
        }
        throw e;
      }
    } 
    // For Firebase SDK v8 (global namespace)
    else if (window.firebase) {
      if (!firebase.apps.length) {
        return firebase.initializeApp(firebaseConfig);
      }
      return firebase.apps[0];
    }
    return null;
  } catch (e) {
    console.error("Error with Firebase app initialization:", e);
    return null;
  }
}