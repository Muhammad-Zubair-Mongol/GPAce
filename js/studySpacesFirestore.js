// Study Spaces Firestore Integration Module
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getStorage, ref, uploadString, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCdxGGpfoWD_M_6BwWFqWZ-6MAOKTUjIrI",
  authDomain: "mzm-gpace.firebaseapp.com",
  projectId: "mzm-gpace",
  storageBucket: "mzm-gpace.firebasestorage.app",
  messagingSenderId: "949014366726",
  appId: "1:949014366726:web:3aa05a6e133e2066c45187",
};

// Initialize Firebase
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (e) {
  // App might already be initialized
  app = firebase.apps[0];
}

const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

/**
 * Save study spaces to Firestore
 * @param {Array} studySpaces - Array of study space objects
 * @returns {Promise<boolean>} - Success status
 */
export async function saveStudySpacesToFirestore(studySpaces) {
  try {
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
          const storageRef = ref(storage, `users/${user.uid}/study-spaces/${imageId}`);
          
          // Upload the image
          await uploadString(storageRef, space.image, 'data_url');
          
          // Get the download URL
          const downloadURL = await getDownloadURL(storageRef);
          
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
    const studySpacesRef = doc(db, 'users', user.uid, 'study-spaces', 'all');
    
    await setDoc(studySpacesRef, {
      spaces: processedSpaces,
      lastUpdated: new Date(),
      version: timestamp
    });
    
    // Update local storage with processed spaces
    localStorage.setItem('studySpaces', JSON.stringify(processedSpaces));
    localStorage.setItem('studySpaces-version', timestamp.toString());
    
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
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return null;
    }

    const studySpacesRef = doc(db, 'users', user.uid, 'study-spaces', 'all');
    const docSnap = await getDoc(studySpacesRef);

    // Get local study spaces and version
    const localSpacesJson = localStorage.getItem('studySpaces');
    const localVersion = localStorage.getItem('studySpaces-version');
    let localSpaces = localSpacesJson ? JSON.parse(localSpacesJson) : [];
    
    // Check if this is a new device session (no local version stored)
    const isNewDeviceSession = !localVersion;

    if (docSnap.exists()) {
      const data = docSnap.data();
      const firestoreVersion = data.version || 0;
      const localVersionNum = parseInt(localVersion) || 0;

      console.log(`Comparing versions - Firestore: ${firestoreVersion}, Local: ${localVersionNum}`);
      console.log(`Is new device session: ${isNewDeviceSession}`);

      // If Firestore version is newer OR this is a new device session, use Firestore data
      if (firestoreVersion > localVersionNum || isNewDeviceSession) {
        console.log('Using Firestore data (newer version or new device)');
        localStorage.setItem('studySpaces', JSON.stringify(data.spaces));
        localStorage.setItem('studySpaces-version', firestoreVersion.toString());
        return data.spaces;
      }

      // If local version is newer or same, sync it to Firestore and keep using local
      console.log('Using local data and syncing to Firestore');
      const timestamp = new Date().getTime();
      await setDoc(studySpacesRef, {
        spaces: localSpaces,
        lastUpdated: new Date(),
        version: timestamp
      });
      localStorage.setItem('studySpaces-version', timestamp.toString());
      return localSpaces;
    } else {
      // No Firestore data exists yet, sync local data if it exists
      if (localSpaces.length > 0) {
        console.log('No Firestore data. Syncing local study spaces to Firestore.');
        const timestamp = new Date().getTime();
        await setDoc(studySpacesRef, {
          spaces: localSpaces,
          lastUpdated: new Date(),
          version: timestamp
        });
        localStorage.setItem('studySpaces-version', timestamp.toString());
        return localSpaces;
      }
      
      console.log('No study spaces found in Firestore or local storage');
      return [];
    }
  } catch (error) {
    console.error('Error loading study spaces from Firestore:', error);
    // Fallback to local storage on error
    const localData = localStorage.getItem('studySpaces');
    return localData ? JSON.parse(localData) : [];
  }
}

/**
 * Delete a study space from Firestore
 * @param {number} spaceId - ID of the study space to delete
 * @returns {Promise<boolean>} - Success status
 */
export async function deleteStudySpaceFromFirestore(spaceId) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return false;
    }

    // Get current spaces
    const studySpacesRef = doc(db, 'users', user.uid, 'study-spaces', 'all');
    const docSnap = await getDoc(studySpacesRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      const spaces = data.spaces || [];
      
      // Find the space to delete
      const spaceToDelete = spaces.find(space => space.id === spaceId);
      
      // If the space has an image in Firebase Storage, delete it
      if (spaceToDelete && spaceToDelete.imageStoragePath) {
        try {
          const imageRef = ref(storage, spaceToDelete.imageStoragePath);
          await deleteObject(imageRef);
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
      await setDoc(studySpacesRef, {
        spaces: updatedSpaces,
        lastUpdated: new Date(),
        version: timestamp
      });
      
      localStorage.setItem('studySpaces-version', timestamp.toString());
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
  return !!auth.currentUser;
}

/**
 * Get current user ID
 * @returns {string|null} - User ID or null if not authenticated
 */
export function getCurrentUserId() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

/**
 * Force sync study spaces to Firestore
 * @returns {Promise<boolean>} - Success status
 */
export async function forceSyncStudySpaces() {
  try {
    const localSpacesJson = localStorage.getItem('studySpaces');
    if (!localSpacesJson) {
      console.log('No local study spaces to sync');
      return false;
    }
    
    const localSpaces = JSON.parse(localSpacesJson);
    const success = await saveStudySpacesToFirestore(localSpaces);
    
    return success;
  } catch (error) {
    console.error('Error force syncing study spaces:', error);
    return false;
  }
}
