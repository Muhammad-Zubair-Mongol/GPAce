/**
 * Firestore Service Module
 * Handles all Firestore operations for the application
 * 
 * Uses centralized FirebaseConfig and StorageAdapter
 */

// Import necessary Firestore functions
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Import centralized Firebase config
import { firebaseConfig, getOrCreateFirebaseApp } from './firebaseConfig.js';
import {
  SyncOutbox,
  mergeRevisionedTaskLists,
  deriveTaskTombstones,
  selectChangedTaskMutations
} from './services/SyncOutbox.js';

// Initialize Firebase using the centralized config (prevents duplicate app errors)
const app = getOrCreateFirebaseApp(initializeApp, getApps);
const db = getFirestore(app);
const auth = getAuth(app);

// Expose Firebase instances globally for other modules (with guards)
if (!window.auth) window.auth = auth;
if (!window.db) window.db = db;

// Promise that resolves when auth state is determined (user or null)
let authStateResolved = false;
let authStatePromise = null;

/**
 * Wait for Firebase Auth to determine the current user's auth state.
 * This is useful for functions that need to check auth.currentUser on page load,
 * as Firebase Auth asynchronously restores the user session from persistence.
 * 
 * @param {number} timeoutMs - Maximum time to wait (default: 5000ms)
 * @returns {Promise<User|null>} - Resolves with the user (if signed in) or null
 */
function waitForAuth(timeoutMs = 5000) {
  // If auth state is already resolved, return current state immediately
  if (authStateResolved) {
    return Promise.resolve(auth.currentUser);
  }

  // If we're already waiting, return the existing promise
  if (authStatePromise) {
    return authStatePromise;
  }

  // Create a new promise that resolves on auth state change
  authStatePromise = new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.debug('[Auth] waitForAuth timed out, using current state');
      authStateResolved = true;
      resolve(auth.currentUser);
    }, timeoutMs);

    const unsubscribe = auth.onAuthStateChanged((user) => {
      clearTimeout(timeoutId);
      unsubscribe();
      authStateResolved = true;
      authStatePromise = null;
      resolve(user);
    });
  });

  return authStatePromise;
}

// Export waitForAuth for other modules
export { waitForAuth };

// Also expose globally for non-module scripts
window.waitForAuth = waitForAuth;

// Use globally exposed StorageAdapter with fallback
const getStorage = () => window.StorageAdapter?.getStorage?.() || window.StorageService || {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  remove: (k) => localStorage.removeItem(k)
};

const taskSyncOutbox = new SyncOutbox({
  storage: getStorage(),
  namespace: 'gpace.task.sync.outbox'
});
if (typeof window !== 'undefined') window.taskSyncOutbox = taskSyncOutbox;

function taskMetadataKey(userId, projectId, suffix) {
  return `gpac_sync_${encodeURIComponent(String(userId))}_${encodeURIComponent(String(projectId))}_${suffix}`;
}

function asTaskArray(value) {
  return Array.isArray(value) ? value : [];
}

function cloneTaskData(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function nextTaskRevision(storage, userId, projectId) {
  const key = taskMetadataKey(userId, projectId, 'revision');
  const previous = Number(storage.get(key, 0));
  const revision = Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0);
  const outcome = storage.set(key, revision);
  if (outcome === false || (outcome && typeof outcome === 'object' && outcome.success === false)) {
    throw outcome?.error || new Error('Unable to persist task mutation revision');
  }
  return revision;
}

function persistTaskAcknowledgement(storage, userId, projectId, payload) {
  const writes = [
    [`tasks-${projectId}`, payload.tasks],
    [`tasks-${projectId}-version`, payload.version],
    [taskMetadataKey(userId, projectId, 'ack-base'), payload.tasks],
    [taskMetadataKey(userId, projectId, 'ack-tombstones'), payload.tombstones || {}]
  ];
  for (const [key, value] of writes) {
    const outcome = storage.set(key, value);
    if (outcome === false || (outcome && typeof outcome === 'object' && outcome.success === false)) {
      throw outcome?.error || new Error(`Unable to persist acknowledged task state: ${key}`);
    }
  }
}

// Get STORAGE_KEYS from StorageAdapter if available
const getStorageKeys = () => window.StorageAdapter?.STORAGE_KEYS || {
  CURRENT_SEMESTER: 'currentAcademicSemester',
  SEMESTERS: 'academicSemesters'
};

////////////////////////////SAVING/////////////////////////////////////////

// Function to save subjects to Firestore
export async function saveSubjectsToFirestore(subjects, semesterName = 'default') {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return;
    }

    const timestamp = new Date().getTime(); // Use timestamp as version
    console.log(`Saving subjects for semester: ${semesterName}`);

    // Save the subjects to the specific semester document
    const semesterRef = doc(db, 'users', user.uid, 'semesters', semesterName);
    await setDoc(semesterRef, {
      subjects: subjects,
      lastUpdated: new Date(),
      version: timestamp
    });

    // Also save to current for backwards compatibility
    const storage = getStorage();
    const STORAGE_KEYS = getStorageKeys();
    if (semesterName === storage.get(STORAGE_KEYS.CURRENT_SEMESTER)) {
      const userSubjectsRef = doc(db, 'users', user.uid, 'subjects', 'current');
      await setDoc(userSubjectsRef, {
        subjects: subjects,
        lastUpdated: new Date(),
        version: timestamp,
        activeSemester: semesterName
      });
    }

    // Store version to local storage
    storage.set('academicSubjectsVersion', timestamp);

    console.log('Subjects successfully saved to Firestore for semester:', semesterName);
  } catch (error) {
    console.error('Error saving subjects to Firestore:', error);
    throw error;
  }
}

// Expose saveSubjectsToFirestore globally for other modules (ui-utilities.js, semester-management.js)
window.saveSubjectsToFirestore = saveSubjectsToFirestore;

// Task versioning and sync functions. Every cloud write is a revisioned
// mutation acknowledged by a transaction before local success is published.
async function commitTaskMutation(user, entry) {
  const taskRef = doc(db, 'users', user.uid, 'tasks', entry.projectId);

  return runTransaction(db, async transaction => {
    const serverSnapshot = await transaction.get(taskRef);
    const serverData = serverSnapshot.exists() ? serverSnapshot.data() : {};
    const appliedMutations = Array.isArray(serverData.appliedMutations)
      ? serverData.appliedMutations.map(String)
      : [];

    // A lost response can replay the same mutation. Treat a recorded mutation
    // as committed without writing a second revision.
    if (appliedMutations.includes(entry.mutationId)) {
      return {
        status: 'committed',
        committed: true,
        idempotent: true,
        mutationId: entry.mutationId,
        revision: Number(serverData.version) || entry.revision,
        tasks: asTaskArray(serverData.tasks),
        taskRevisions: serverData.taskRevisions || {},
        tombstones: serverData.tombstones || {}
      };
    }

    const merged = mergeRevisionedTaskLists({
      serverTasks: asTaskArray(serverData.tasks),
      serverTaskRevisions: serverData.taskRevisions || {},
      serverTombstones: serverData.tombstones || {},
      localTasks: entry.changedTasks,
      localRevision: entry.revision,
      localTombstones: entry.tombstones
    });
    const serverVersion = Number(serverData.version) || 0;
    const revision = Math.max(serverVersion + 1, entry.revision);
    const nextAppliedMutations = [...appliedMutations, entry.mutationId].slice(-32);

    transaction.set(taskRef, {
      tasks: merged.tasks,
      taskRevisions: merged.taskRevisions,
      tombstones: merged.tombstones,
      appliedMutations: nextAppliedMutations,
      lastUpdated: new Date(),
      version: revision
    });

    return {
      status: 'committed',
      committed: true,
      idempotent: false,
      mutationId: entry.mutationId,
      revision,
      tasks: merged.tasks,
      taskRevisions: merged.taskRevisions,
      tombstones: merged.tombstones
    };
  });
}

function makeTaskMutation(user, projectId, tasks, storage) {
  const normalizedTasks = cloneTaskData(asTaskArray(tasks));
  const baseKey = taskMetadataKey(user.uid, projectId, 'ack-base');
  const baseTasks = asTaskArray(storage.get(baseKey, storage.get(`tasks-${projectId}`, [])));
  const revision = nextTaskRevision(storage, user.uid, projectId);
  const changedTasks = selectChangedTaskMutations(baseTasks, normalizedTasks);
  const tombstones = deriveTaskTombstones(baseTasks, normalizedTasks, revision);

  return {
    userId: user.uid,
    projectId: String(projectId),
    mutationId: `${user.uid}:${projectId}:${revision}`,
    revision,
    baseVersion: Number(storage.get(`tasks-${projectId}-version`, 0)) || 0,
    baseTasks,
    tasks: normalizedTasks,
    changedTasks,
    tombstones
  };
}

export async function saveTasksToFirestore(projectId, tasks, options = {}) {
  if (!projectId || projectId === 'undefined' || projectId === 'null') {
    return { status: 'error', committed: false, code: 'invalid-project', message: 'A project id is required' };
  }

  const user = auth.currentUser;
  if (!user) {
    return { status: 'error', committed: false, code: 'unauthenticated', message: 'User is not authenticated' };
  }
  if (!Array.isArray(tasks)) {
    return { status: 'error', committed: false, code: 'invalid-tasks', message: 'Tasks must be an array' };
  }

  const storage = getStorage();
  let entry;
  try {
    entry = makeTaskMutation(user, projectId, tasks, storage);
    taskSyncOutbox.enqueue(entry);
  } catch (error) {
    return { status: 'error', committed: false, code: 'outbox-persist-failed', error };
  }

  const result = await taskSyncOutbox.flush(
    user.uid,
    async pendingEntry => {
      const committed = await commitTaskMutation(user, pendingEntry);
      persistTaskAcknowledgement(storage, user.uid, projectId, committed);
      return committed;
    },
    { projectId: String(projectId) }
  );

  if (result.status === 'committed' && result.committed) {
    window.dispatchEvent(new CustomEvent('dataSyncComplete', {
      detail: { type: 'save', projectId: String(projectId), revision: result.revision }
    }));
    return result;
  }

  return {
    ...result,
    status: result.status || 'pending',
    committed: false,
    mutationId: entry.mutationId
  };
}

export async function flushTaskSyncOutbox(projectId = null) {
  const user = auth.currentUser;
  if (!user) return { status: 'error', committed: false, code: 'unauthenticated' };
  const storage = getStorage();
  return taskSyncOutbox.flush(
    user.uid,
    async entry => {
      const committed = await commitTaskMutation(user, entry);
      persistTaskAcknowledgement(storage, user.uid, entry.projectId, committed);
      return committed;
    },
    { projectId: projectId === null ? null : String(projectId) }
  );
}

export function cancelTaskSyncIntent(projectId, beforeRevision = Infinity) {
  const user = auth.currentUser;
  if (!user) return 0;
  return taskSyncOutbox.cancel(user.uid, {
    projectId: String(projectId),
    beforeRevision
  });
}


// Function to save completed tasks to Firestore
export async function saveCompletedTaskToFirestore(projectId, completedTask) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return;
    }

    // Get existing completed tasks
    const completedRef = doc(db, 'users', user.uid, 'completed-tasks', projectId);
    const docSnap = await getDoc(completedRef);
    const existingTasks = docSnap.exists() ? docSnap.data().tasks : [];

    // Add new completed task
    const updatedTasks = [...existingTasks, completedTask];

    // Save to Firestore
    await setDoc(completedRef, {
      tasks: updatedTasks,
      lastUpdated: new Date()
    });

    // Update local storage
    const storage = getStorage();
    storage.set(`completed-tasks-${projectId}`, updatedTasks);

    console.log('Completed task saved successfully');
  } catch (error) {
    console.error('Error saving completed task:', error);
    throw error;
  }
}

// Function to save project weightages to Firestore
export async function saveWeightagesToFirestore(weightages) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return;
    }

    const weightagesRef = doc(db, 'users', user.uid, 'settings', 'weightages');
    await setDoc(weightagesRef, {
      projectWeightages: weightages,
      lastUpdated: new Date()
    });

    // Update local storage
    const storage = getStorage();
    storage.set('projectWeightages', weightages);
    console.log('Weightages saved successfully');
  } catch (error) {
    console.error('Error saving weightages:', error);
    throw error;
  }
}

// Function to save subject marks to Firestore
export async function saveSubjectMarksToFirestore(marks) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return false;
    }

    const marksRef = doc(db, 'users', user.uid, 'academic', 'marks');
    await setDoc(marksRef, { marks: marks });

    console.log('Subject marks saved to Firestore');
    return true;
  } catch (error) {
    console.error('Error saving subject marks to Firestore:', error);
    throw error;
  }
}

// Function to save subject weightages to Firestore
export async function saveSubjectWeightagesToFirestore(weightages) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return false;
    }

    const weightagesRef = doc(db, 'users', user.uid, 'academic', 'weightages');
    await setDoc(weightagesRef, { subjectWeightages: weightages });

    console.log('Subject weightages saved to Firestore');
    return true;
  } catch (error) {
    console.error('Error saving subject weightages to Firestore:', error);
    throw error;
  }
}

////////////////////////////////////////LOADING//////////////////////////////////////////////////

// Function to load subjects from Firestore
export async function loadSubjectsFromFirestore(semesterName = 'default') {
  try {
    console.log(`Loading subjects for semester: ${semesterName}`);

    // Wait for auth state to be determined before checking user
    const user = await waitForAuth();
    if (!user) {
      console.debug('loadSubjectsFromFirestore: No user signed in, falling back to local storage');
      const storage = getStorage();
      const allSemesters = storage.get('academicSemesters', {});
      const subjects = allSemesters[semesterName]?.subjects || [];
      return subjects.length > 0 ? subjects : storage.get('academicSubjects', []);
    }

    // Try to load the specific semester first
    const semesterRef = doc(db, 'users', user.uid, 'semesters', semesterName);
    const semesterDoc = await getDoc(semesterRef);

    if (semesterDoc.exists()) {
      console.log(`Loaded semester data: ${semesterName}`);
      const subjectData = semesterDoc.data().subjects || [];

      // Store in storage for future use
      const storage = getStorage();
      const allSemesters = storage.get('academicSemesters', {});
      allSemesters[semesterName] = {
        subjects: subjectData,
        lastUpdated: new Date().toISOString()
      };
      storage.set('academicSemesters', allSemesters);

      // For current semester, also save to academicSubjects for compatibility
      if (semesterName === storage.get('currentAcademicSemester')) {
        storage.set('academicSubjects', subjectData);
      }

      return subjectData;
    }

    // Fallback to current subjects if the specific semester doesn't exist
    const userSubjectsRef = doc(db, 'users', user.uid, 'subjects', 'current');
    const docSnap = await getDoc(userSubjectsRef);

    if (docSnap.exists()) {
      console.log('Loaded current subjects as fallback');
      const subjectData = docSnap.data().subjects || [];

      // Save to storage
      const storage = getStorage();
      storage.set('academicSubjects', subjectData);

      // If this is the first load for this semester, save the current subjects to the semester
      if (semesterName !== 'default') {
        await saveSubjectsToFirestore(subjectData, semesterName);
      }

      return subjectData;
    } else {
      console.log('No subject data found in Firestore');
      return [];
    }
  } catch (error) {
    console.error('Error loading subjects from Firestore:', error);
    // Fall back to local storage in case of error
    const storage = getStorage();
    const allSemesters = storage.get('academicSemesters', {});
    const subjects = allSemesters[semesterName]?.subjects || [];

    if (subjects.length === 0) {
      return storage.get('academicSubjects', []);
    }
    return subjects;
  }
}


//Load tasks
// Function to load tasks from Firestore (Pure Data Access)
export async function loadTasksFromFirestore(projectId) {
  try {
    // OPTIMIZATION: Check if TaskService has cached data - return it immediately
    // This maintains the existing check but strictly for returning what's already known
    // to avoid unnecessary network calls if the service already has valid data.
    if (window.TaskService?.getCachedTasks) {
      const cached = window.TaskService.getCachedTasks(projectId);
      if (cached !== null && cached !== undefined) {
        console.debug(`[Firestore] Returning cached data for ${projectId} (${cached.length} tasks)`);
        return cached;
      }
    }

    console.debug(`[Firestore] loadTasksFromFirestore() called for: ${projectId}`);

    // Guard against undefined/null projectId
    if (!projectId || projectId === 'undefined' || projectId === 'null') {
      console.warn('[Firestore] loadTasksFromFirestore: Invalid projectId, skipping load');
      return [];
    }

    // Wait for auth state to be determined before checking user
    const user = await waitForAuth();
    if (!user) {
      console.debug('loadTasksFromFirestore: No user signed in, returning empty array (Service should handle local fallback)');
      return [];
    }

    const taskRef = doc(db, 'users', user.uid, 'tasks', projectId);
    const docSnap = await getDoc(taskRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      console.log(`[Firestore] Fetched ${data.tasks?.length || 0} tasks for ${projectId}`);
      return data.tasks || [];
    } else {
      console.log('[Firestore] No remote data found for', projectId);
      return [];
    }
  } catch (error) {
    console.error('Error loading tasks from Firestore:', error);
    return []; // Return empty on error, let caller handle fallback
  }
}





/////Weightage load
// Function to load project weightages from Firestore
export async function loadWeightagesFromFirestore() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return null;
    }

    const weightagesRef = doc(db, 'users', user.uid, 'settings', 'weightages');
    const docSnap = await getDoc(weightagesRef);

    if (docSnap.exists()) {
      const data = docSnap.data().projectWeightages;
      const storage = getStorage();
      storage.set('projectWeightages', data);
      return data;
    } else {
      const storage = getStorage();
      const localData = storage.get('projectWeightages', {});
      if (Object.keys(localData).length > 0) {
        await saveWeightagesToFirestore(localData);
      }
      return localData;
    }
  } catch (error) {
    console.error('Error loading weightages:', error);
    const storage = getStorage();
    return storage.get('projectWeightages', {});
  }
}

// Function to load subject marks from Firestore
export async function loadSubjectMarksFromFirestore() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return null;
    }

    const marksRef = doc(db, 'users', user.uid, 'academic', 'marks');
    const docSnap = await getDoc(marksRef);

    if (docSnap.exists()) {
      const marksData = docSnap.data().marks;
      const storage = getStorage();
      storage.set('subjectMarks', marksData);
      return marksData;
    } else {
      const storage = getStorage();
      const localMarks = storage.get('subjectMarks', {});
      await saveSubjectMarksToFirestore(localMarks);
      return localMarks;
    }
  } catch (error) {
    console.error('Error loading subject marks from Firestore:', error);
    const storage = getStorage();
    return storage.get('subjectMarks', {});
  }
}

// Function to load subject weightages from Firestore
export async function loadSubjectWeightagesFromFirestore() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return null;
    }

    const weightagesRef = doc(db, 'users', user.uid, 'academic', 'weightages');
    const docSnap = await getDoc(weightagesRef);

    if (docSnap.exists()) {
      const weightagesData = docSnap.data().subjectWeightages;
      const storage = getStorage();
      storage.set('subjectWeightages', weightagesData);
      return weightagesData;
    } else {
      const storage = getStorage();
      const localWeightages = storage.get('subjectWeightages', {});
      await saveSubjectWeightagesToFirestore(localWeightages);
      return localWeightages;
    }
  } catch (error) {
    console.error('Error loading subject weightages from Firestore:', error);
    const storage = getStorage();
    return storage.get('subjectWeightages', {});
  }
}

// Function to list all semesters for a user
export async function listUserSemesters() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      throw new Error('User not authenticated');
    }

    const semestersCollection = collection(db, 'users', user.uid, 'semesters');
    const semestersSnapshot = await getDocs(semestersCollection);

    const semesters = [];
    semestersSnapshot.forEach(doc => {
      semesters.push({
        id: doc.id,
        lastUpdated: doc.data().lastUpdated?.toDate() || new Date(),
        subjectCount: (doc.data().subjects || []).length
      });
    });

    console.log(`Found ${semesters.length} semesters for user in Firestore`);
    return semesters;
  } catch (error) {
    console.error('Error listing semesters from Firestore:', error);
    throw error;
  }
}

// Function to delete a semester from Firestore
export async function deleteSemesterFromFirestore(semesterName) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      throw new Error('User not authenticated');
    }

    // Delete the semester document
    const semesterRef = doc(db, 'users', user.uid, 'semesters', semesterName);
    await deleteDoc(semesterRef);

    console.log(`Semester "${semesterName}" successfully deleted from Firestore`);
    return true;
  } catch (error) {
    console.error(`Error deleting semester "${semesterName}" from Firestore:`, error);
    throw error;
  }
}

// Function to save text expansion snippets to Firestore
export async function saveSnippetsToFirestore(snippets) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return false;
    }

    const timestamp = new Date().getTime(); // Use timestamp as version
    console.log('Saving text expansion snippets to Firestore');

    // Save the snippets to Firestore
    const snippetsRef = doc(db, 'users', user.uid, 'settings', 'text-expansion');
    await setDoc(snippetsRef, {
      snippets: snippets,
      lastUpdated: new Date(),
      version: timestamp
    });

    // Store version to local storage
    const storage = getStorage();
    storage.set('gpace-snippets-version', timestamp);

    console.log('Text expansion snippets successfully saved to Firestore');
    return true;
  } catch (error) {
    console.error('Error saving text expansion snippets to Firestore:', error);
    return false;
  }
}

// Function to load text expansion snippets from Firestore
export async function loadSnippetsFromFirestore(isNewDeviceSession = false) {
  try {
    // Wait for auth state to be determined before checking user
    const user = await waitForAuth();
    if (!user) {
      console.debug('loadSnippetsFromFirestore: No user signed in, using local snippets');
      return null;
    }

    console.log('Loading text expansion snippets from Firestore');

    // Get local data and version
    const storage = getStorage();
    let localSnippets = storage.get('gpace-snippets', []);
    const localVersion = storage.get('gpace-snippets-version');

    // Get Firestore data
    const snippetsRef = doc(db, 'users', user.uid, 'settings', 'text-expansion');
    const docSnap = await getDoc(snippetsRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      const firestoreVersion = data.version || 0;
      const localVersionNum = parseInt(localVersion) || 0;

      console.log(`Comparing versions - Firestore: ${firestoreVersion}, Local: ${localVersionNum}`);
      console.log(`Is new device session: ${isNewDeviceSession}`);

      // If Firestore version is newer OR this is a new device session, use Firestore data
      if (firestoreVersion > localVersionNum || isNewDeviceSession) {
        console.log('Using Firestore data (newer version or new device)');
        storage.set('gpace-snippets', data.snippets);
        storage.set('gpace-snippets-version', firestoreVersion);
        return data.snippets;
      }

      // If local version is newer or same, sync it to Firestore and keep using local
      console.log('Using local data and syncing to Firestore');
      const timestamp = new Date().getTime();
      await setDoc(snippetsRef, {
        snippets: localSnippets,
        lastUpdated: new Date(),
        version: timestamp
      });
      storage.set('gpace-snippets-version', timestamp);
      return localSnippets;
    } else {
      // No Firestore data exists yet, sync local data if it exists
      if (localSnippets.length > 0) {
        console.log('No Firestore data. Syncing local snippets to Firestore.');
        const timestamp = new Date().getTime();
        await setDoc(snippetsRef, {
          snippets: localSnippets,
          lastUpdated: new Date(),
          version: timestamp
        });
        storage.set('gpace-snippets-version', timestamp);
        return localSnippets;
      }

      console.log('No text expansion snippets found in Firestore or local storage');
      return null;
    }
  } catch (error) {
    console.error('Error loading text expansion snippets from Firestore:', error);
    return null;
  }
}

// Function to set up real-time sync for text expansion snippets
export function setupSnippetsRealtimeSync(callback) {
  const user = auth.currentUser;
  if (!user) {
    console.error('No user is signed in');
    return () => { }; // Return empty function as unsubscribe
  }

  const snippetsRef = doc(db, 'users', user.uid, 'settings', 'text-expansion');

  // Set up real-time listener
  return onSnapshot(snippetsRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      const firestoreVersion = data.version || 0;
      const storage = getStorage();
      const localVersion = storage.get('gpace-snippets-version');
      const localVersionNum = parseInt(localVersion) || 0;

      // Only update if Firestore version is newer
      if (firestoreVersion > localVersionNum) {
        console.log('Real-time update: New snippets version detected in Firestore');
        const storage = getStorage();
        storage.set('gpace-snippets', data.snippets);
        storage.set('gpace-snippets-version', firestoreVersion);

        // Call the callback with the updated snippets
        if (typeof callback === 'function') {
          callback(data.snippets);
        }
      }
    }
  }, (error) => {
    console.error('Error in real-time snippets sync:', error);
  });
}

// Expose additional functions globally for other modules
window.deleteSemesterFromFirestore = deleteSemesterFromFirestore;
window.listUserSemesters = listUserSemesters;

// Export auth and db for modules that need to import them
export { auth, db, app };

// Function to save calculated priority tasks to Firestore
export async function savePriorityTasksToFirestore(tasks) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.warn('No user logged in, skipping Firestore save');
      return;
    }

    const priorityRef = doc(db, 'users', user.uid, 'settings', 'priorityTasks');
    await setDoc(priorityRef, {
      tasks: tasks,
      version: Date.now(),
      updatedAt: new Date().toISOString()
    });

    console.log('📤 Saved calculated priority tasks to Firestore:', tasks.length);
  } catch (error) {
    console.error('Error saving priority tasks to Firestore:', error);
    throw error;
  }
}

// Expose for non-module scripts
window.savePriorityTasksToFirestore = savePriorityTasksToFirestore;

// =========================================
// Nuclear Ghost Task Fixes
// =========================================

/**
 * NUCLEAR: Delete ALL tasks for a project from Firestore.
 * Use this when ghost tasks keep coming back.
 * @param {string} projectId - The project to clear
 * @returns {Promise<boolean>} True if successful
 */
export async function deleteAllTasksFromFirestore(projectId) {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('[Firestore] No user signed in');
      return false;
    }

    console.log(`[Firestore] 🔥 DELETING all tasks for project: ${projectId}`);

    // Delete the tasks document completely
    const taskRef = doc(db, 'users', user.uid, 'tasks', projectId);
    await deleteDoc(taskRef);

    // Also delete completed tasks
    const completedRef = doc(db, 'users', user.uid, 'completed-tasks', projectId);
    await deleteDoc(completedRef);

    // Clear local storage for this project
    const storage = getStorage();
    storage.remove(`tasks-${projectId}`);
    storage.remove(`tasks-${projectId}-version`);
    storage.remove(`completed-tasks-${projectId}`);

    console.log(`[Firestore] ✅ Deleted all tasks for ${projectId} from Firestore and localStorage`);
    return true;
  } catch (error) {
    console.error(`[Firestore] Error deleting tasks for ${projectId}:`, error);
    return false;
  }
}

/**
 * NUCLEAR: List and delete ALL task projects for current user.
 * This completely wipes all task data.
 * @returns {Promise<Object>} Results with deleted projects
 */
export async function nukeAllTasks() {
  try {
    const user = auth.currentUser;
    if (!user) {
      console.error('[Firestore] No user signed in');
      return { success: false, message: 'Not logged in' };
    }

    console.log('[Firestore] 🔥🔥🔥 NUKING ALL TASKS 🔥🔥🔥');

    // Get all task documents
    const tasksCollection = collection(db, 'users', user.uid, 'tasks');
    const tasksSnapshot = await getDocs(tasksCollection);

    const results = { deleted: [], failed: [] };

    // Delete each task document
    for (const taskDoc of tasksSnapshot.docs) {
      try {
        await deleteDoc(taskDoc.ref);
        results.deleted.push(taskDoc.id);
        console.log(`[Firestore] Deleted: ${taskDoc.id}`);
      } catch (e) {
        results.failed.push({ id: taskDoc.id, error: e.message });
      }
    }

    // Also get completed tasks
    const completedCollection = collection(db, 'users', user.uid, 'completed-tasks');
    const completedSnapshot = await getDocs(completedCollection);

    for (const completedDoc of completedSnapshot.docs) {
      try {
        await deleteDoc(completedDoc.ref);
        results.deleted.push(`completed-${completedDoc.id}`);
      } catch (e) {
        results.failed.push({ id: `completed-${completedDoc.id}`, error: e.message });
      }
    }

    // Clear ALL task-related localStorage
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('tasks-') || key.startsWith('completed-tasks-') || key === 'calculatedPriorityTasks')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    console.log('[Firestore] ✅ NUKE COMPLETE:', results);
    return { success: true, results };
  } catch (error) {
    console.error('[Firestore] NUKE FAILED:', error);
    return { success: false, error: error.message };
  }
}

// Expose globally
window.deleteAllTasksFromFirestore = deleteAllTasksFromFirestore;
window.nukeAllTasks = nukeAllTasks;
