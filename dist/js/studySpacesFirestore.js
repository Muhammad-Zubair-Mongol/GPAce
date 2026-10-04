/**
 * Study Spaces Firestore Integration Module
 * 
 * Uses Firebase compat layer (loaded via HTML) for Firestore operations.
 * This approach avoids version conflicts between ESM and compat Firebase SDKs.
 */

// Storage helper using shared utility or fallback
const getStorageHelper = () => {
  if (typeof window !== 'undefined' && window.getStorage) {
    return window.getStorage();
  }
  // Fallback
  return window.StorageService || {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
  };
};

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCdxGGpfoWD_M_6BwWFqWZ-6MAOKTUjIrI",
  authDomain: "mzm-gpace.firebaseapp.com",
  projectId: "mzm-gpace",
  storageBucket: "mzm-gpace.firebasestorage.app",
  messagingSenderId: "949014366726",
  appId: "1:949014366726:web:3aa05a6e133e2066c45187",
};

// Wait for Firebase to be available (loaded via HTML script tags)
let db, auth, storage;

function initializeFirebase() {
  if (typeof firebase === 'undefined') {
    console.warn('Firebase not loaded yet, retrying in 100ms...');
    setTimeout(initializeFirebase, 100);
    return;
  }

  try {
    // Initialize app if not already done
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    db = firebase.firestore();
    auth = firebase.auth();
    storage = firebase.storage();

    console.log('StudySpacesFirestore: Firebase initialized');
  } catch (e) {
    console.error('Error initializing Firebase:', e);
  }
}

// Initialize on load
initializeFirebase();

/**
 * Save study spaces to Firestore
 * @param {Array} studySpaces - Array of study space objects
 * @returns {Promise<boolean>} - Success status
 */
export async function saveStudySpacesToFirestore(studySpaces) {
  try {
    if (!db || !auth) {
      console.error('Firebase not initialized');
      return false;
    }

    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return false;
    }

    // Process images first - upload base64 images to Firebase Storage
    const processedSpaces = await Promise.all(studySpaces.map(async (space) => {
      // If the image is a base64 string, upload it to Firebase Storage
      if (space.image && space.image.startsWith('data:image')) {
        try {
          const imageId = `${space.id}-${Date.now()}`;
          const storageRef = storage.ref(`users/${user.uid}/study-spaces/${imageId}`);

          // Upload the image
          await storageRef.putString(space.image, 'data_url');

          // Get the download URL
          const downloadURL = await storageRef.getDownloadURL();

          // Return updated space with Firebase Storage URL
          return {
            ...space,
            image: downloadURL,
            imageStoragePath: `users/${user.uid}/study-spaces/${imageId}`
          };
        } catch (error) {
          console.error('Error uploading image to Firebase Storage:', error);
          return space; // Return original space if upload fails
        }
      }
      return space; // Return original space if image is already a URL
    }));

    const timestamp = new Date().getTime();
    const studySpacesRef = db.collection('users').doc(user.uid).collection('study-spaces').doc('all');

    await studySpacesRef.set({
      spaces: processedSpaces,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
      version: timestamp
    });

    // Update local storage with processed spaces
    const storageHelper = getStorageHelper();
    storageHelper.set('studySpaces', processedSpaces);
    storageHelper.set('studySpaces-version', timestamp);

    console.log('Study spaces successfully saved to Firestore');
    return true;
  } catch (error) {
    console.error('Error saving study spaces to Firestore:', error);
    return false;
  }
}

/**
 * Load study spaces from Firestore
 * @returns {Promise<Array>} - Array of study space objects
 */
export async function loadStudySpacesFromFirestore() {
  try {
    if (!db || !auth) {
      console.error('Firebase not initialized');
      return null;
    }

    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return null;
    }

    const studySpacesRef = db.collection('users').doc(user.uid).collection('study-spaces').doc('all');
    const docSnap = await studySpacesRef.get();

    // Get local study spaces and version
    const storageHelper = getStorageHelper();
    let localSpaces = storageHelper.get('studySpaces', []);
    const localVersion = storageHelper.get('studySpaces-version', null);

    // Check if this is a new device session (no local version stored)
    const isNewDeviceSession = !localVersion;

    if (docSnap.exists) {
      const data = docSnap.data();
      const firestoreVersion = data.version || 0;
      const localVersionNum = parseInt(localVersion) || 0;

      console.log(`Comparing versions - Firestore: ${firestoreVersion}, Local: ${localVersionNum}`);
      console.log(`Is new device session: ${isNewDeviceSession}`);

      // If Firestore version is newer OR this is a new device session, use Firestore data
      if (firestoreVersion > localVersionNum || isNewDeviceSession) {
        console.log('Using Firestore data (newer version or new device)');
        storageHelper.set('studySpaces', data.spaces);
        storageHelper.set('studySpaces-version', firestoreVersion);
        return data.spaces;
      }

      // If local version is newer or same, sync it to Firestore and keep using local
      console.log('Using local data and syncing to Firestore');
      const timestamp = new Date().getTime();
      await studySpacesRef.set({
        spaces: localSpaces,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        version: timestamp
      });
      storageHelper.set('studySpaces-version', timestamp);
      return localSpaces;
    } else {
      // No Firestore data exists yet, sync local data if it exists
      if (localSpaces.length > 0) {
        console.log('No Firestore data. Syncing local study spaces to Firestore.');
        const timestamp = new Date().getTime();
        await studySpacesRef.set({
          spaces: localSpaces,
          lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
          version: timestamp
        });
        storageHelper.set('studySpaces-version', timestamp);
        return localSpaces;
      }

      console.log('No study spaces found in Firestore or local storage');
      return [];
    }
  } catch (error) {
    console.error('Error loading study spaces from Firestore:', error);
    // Fallback to local storage on error
    const storageHelper = getStorageHelper();
    return storageHelper.get('studySpaces', []);
  }
}

/**
 * Delete a study space from Firestore
 * @param {number} spaceId - ID of the study space to delete
 * @returns {Promise<boolean>} - Success status
 */
export async function deleteStudySpaceFromFirestore(spaceId) {
  try {
    if (!db || !auth) {
      console.error('Firebase not initialized');
      return false;
    }

    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return false;
    }

    // Get current spaces
    const studySpacesRef = db.collection('users').doc(user.uid).collection('study-spaces').doc('all');
    const docSnap = await studySpacesRef.get();

    if (docSnap.exists) {
      const data = docSnap.data();
      const spaces = data.spaces || [];

      // Find the space to delete
      const spaceToDelete = spaces.find(space => space.id === spaceId);

      // If the space has an image in Firebase Storage, delete it
      if (spaceToDelete && spaceToDelete.imageStoragePath) {
        try {
          const imageRef = storage.ref(spaceToDelete.imageStoragePath);
          await imageRef.delete();
          console.log(`Deleted image from Firebase Storage: ${spaceToDelete.imageStoragePath}`);
        } catch (error) {
          console.error('Error deleting image from Firebase Storage:', error);
          // Continue with deletion even if image deletion fails
        }
      }

      // Filter out the space to delete
      const updatedSpaces = spaces.filter(space => space.id !== spaceId);

      // Save updated spaces
      const timestamp = new Date().getTime();
      await studySpacesRef.set({
        spaces: updatedSpaces,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        version: timestamp
      });

      const storageHelper = getStorageHelper();
      storageHelper.set('studySpaces-version', timestamp);
      console.log(`Study space ${spaceId} successfully deleted from Firestore`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error deleting study space ${spaceId} from Firestore:`, error);
    return false;
  }
}

/**
 * Check if user is authenticated
 * @returns {boolean} - Authentication status
 */
export function isUserAuthenticated() {
  return auth && !!auth.currentUser;
}

/**
 * Get current user ID
 * @returns {string|null} - User ID or null if not authenticated
 */
export function getCurrentUserId() {
  return auth && auth.currentUser ? auth.currentUser.uid : null;
}

/**
 * Force sync study spaces to Firestore
 * @returns {Promise<boolean>} - Success status
 */
export async function forceSyncStudySpaces() {
  try {
    const storageHelper = getStorageHelper();
    const localSpaces = storageHelper.get('studySpaces', null);
    if (!localSpaces) {
      console.log('No local study spaces to sync');
      return false;
    }

    const success = await saveStudySpacesToFirestore(localSpaces);
    return success;
  } catch (error) {
    console.error('Error force syncing study spaces:', error);
    return false;
  }
}
