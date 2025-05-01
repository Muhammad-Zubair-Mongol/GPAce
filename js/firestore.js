// Import necessary Firestore functions
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

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
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

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
    if (semesterName === localStorage.getItem('currentAcademicSemester')) {
      const userSubjectsRef = doc(db, 'users', user.uid, 'subjects', 'current');
      await setDoc(userSubjectsRef, {
        subjects: subjects,
        lastUpdated: new Date(),
        version: timestamp,
        activeSemester: semesterName
      });
    }

    // Store version to local storage
    localStorage.setItem('academicSubjectsVersion', timestamp.toString());

    console.log('Subjects successfully saved to Firestore for semester:', semesterName);
  } catch (error) {
    console.error('Error saving subjects to Firestore:', error);
    throw error;
  }
}

// Task versioning and sync functions
export async function saveTasksToFirestore(projectId, tasks) {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.error('No user is signed in');
            return;
        }

        const timestamp = new Date().getTime();
        const taskRef = doc(db, 'users', user.uid, 'tasks', projectId);
        await setDoc(taskRef, {
            tasks: tasks,
            lastUpdated: new Date(),
            version: timestamp
        });

        localStorage.setItem(`tasks-${projectId}-version`, timestamp.toString());
        console.log('Tasks successfully saved to Firestore');
    } catch (error) {
        console.error('Error saving tasks to Firestore:', error);
        throw error;
    }
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
        localStorage.setItem(`completed-tasks-${projectId}`, JSON.stringify(updatedTasks));

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
        localStorage.setItem('projectWeightages', JSON.stringify(weightages));
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

    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      throw new Error('User not authenticated');
    }

    // Try to load the specific semester first
    const semesterRef = doc(db, 'users', user.uid, 'semesters', semesterName);
    const semesterDoc = await getDoc(semesterRef);

    if (semesterDoc.exists()) {
      console.log(`Loaded semester data: ${semesterName}`);
      const subjectData = semesterDoc.data().subjects || [];

      // Store in localStorage for future use
      const allSemesters = JSON.parse(localStorage.getItem('academicSemesters') || '{}');
      allSemesters[semesterName] = {
        subjects: subjectData,
        lastUpdated: new Date().toISOString()
      };
      localStorage.setItem('academicSemesters', JSON.stringify(allSemesters));

      // For current semester, also save to academicSubjects for compatibility
      if (semesterName === localStorage.getItem('currentAcademicSemester')) {
        localStorage.setItem('academicSubjects', JSON.stringify(subjectData));
      }

      return subjectData;
    }

    // Fallback to current subjects if the specific semester doesn't exist
    const userSubjectsRef = doc(db, 'users', user.uid, 'subjects', 'current');
    const docSnap = await getDoc(userSubjectsRef);

    if (docSnap.exists()) {
      console.log('Loaded current subjects as fallback');
      const subjectData = docSnap.data().subjects || [];

      // Save to localStorage
      localStorage.setItem('academicSubjects', JSON.stringify(subjectData));

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
    const allSemesters = JSON.parse(localStorage.getItem('academicSemesters') || '{}');
    const subjects = allSemesters[semesterName]?.subjects || [];

    if (subjects.length === 0) {
      return JSON.parse(localStorage.getItem('academicSubjects') || '[]');
    }
    return subjects;
  }
}


//Load tasks
export async function loadTasksFromFirestore(projectId) {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.error('No user is signed in');
            return null;
        }

        const taskRef = doc(db, 'users', user.uid, 'tasks', projectId);
        const docSnap = await getDoc(taskRef);

        // Get local tasks and version
        const localTasksJson = localStorage.getItem(`tasks-${projectId}`);
        const localVersion = localStorage.getItem(`tasks-${projectId}-version`);
        let localTasks = localTasksJson ? JSON.parse(localTasksJson) : [];

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
                localStorage.setItem(`tasks-${projectId}`, JSON.stringify(data.tasks));
                localStorage.setItem(`tasks-${projectId}-version`, firestoreVersion.toString());
                return data.tasks;
            }

            // If local version is newer or same, sync it to Firestore and keep using local
            console.log('Using local data and syncing to Firestore');
            const timestamp = new Date().getTime();
            await setDoc(taskRef, {
                tasks: localTasks,
                lastUpdated: new Date(),
                version: timestamp
            });
            localStorage.setItem(`tasks-${projectId}-version`, timestamp.toString());
            return localTasks;
        } else {
            // No Firestore data exists yet, sync local data if it exists
            if (localTasks.length > 0) {
                console.log('No Firestore data. Syncing local tasks to Firestore.');
                const timestamp = new Date().getTime();
                await setDoc(taskRef, {
                    tasks: localTasks,
                    lastUpdated: new Date(),
                    version: timestamp
                });
                localStorage.setItem(`tasks-${projectId}-version`, timestamp.toString());
                return localTasks;
            }

            console.log('No tasks found in Firestore or local storage');
            return [];
        }
    } catch (error) {
        console.error('Error loading tasks from Firestore:', error);
        // Fallback to local storage on error
        const localData = localStorage.getItem(`tasks-${projectId}`);
        return localData ? JSON.parse(localData) : [];
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
            localStorage.setItem('projectWeightages', JSON.stringify(data));
            return data;
        } else {
            const localData = JSON.parse(localStorage.getItem('projectWeightages') || '{}');
            if (Object.keys(localData).length > 0) {
                await saveWeightagesToFirestore(localData);
            }
            return localData;
        }
    } catch (error) {
        console.error('Error loading weightages:', error);
        return JSON.parse(localStorage.getItem('projectWeightages') || '{}');
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
      localStorage.setItem('subjectMarks', JSON.stringify(marksData));
      return marksData;
    } else {
      const localMarks = JSON.parse(localStorage.getItem('subjectMarks') || '{}');
      await saveSubjectMarksToFirestore(localMarks);
      return localMarks;
    }
  } catch (error) {
    console.error('Error loading subject marks from Firestore:', error);
    return JSON.parse(localStorage.getItem('subjectMarks') || '{}');
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
      localStorage.setItem('subjectWeightages', JSON.stringify(weightagesData));
      return weightagesData;
    } else {
      const localWeightages = JSON.parse(localStorage.getItem('subjectWeightages') || '{}');
      await saveSubjectWeightagesToFirestore(localWeightages);
      return localWeightages;
    }
  } catch (error) {
    console.error('Error loading subject weightages from Firestore:', error);
    return JSON.parse(localStorage.getItem('subjectWeightages') || '{}');
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
    localStorage.setItem('gpace-snippets-version', timestamp.toString());

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
    const user = auth.currentUser;
    if (!user) {
      console.error('No user is signed in');
      return null;
    }

    console.log('Loading text expansion snippets from Firestore');

    // Get local data and version
    const localSnippetsJson = localStorage.getItem('gpace-snippets');
    const localVersion = localStorage.getItem('gpace-snippets-version');
    let localSnippets = [];

    if (localSnippetsJson) {
      try {
        localSnippets = JSON.parse(localSnippetsJson);
      } catch (e) {
        console.error('Error parsing local snippets:', e);
      }
    }

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
        localStorage.setItem('gpace-snippets', JSON.stringify(data.snippets));
        localStorage.setItem('gpace-snippets-version', firestoreVersion.toString());
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
      localStorage.setItem('gpace-snippets-version', timestamp.toString());
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
        localStorage.setItem('gpace-snippets-version', timestamp.toString());
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
    return () => {}; // Return empty function as unsubscribe
  }

  const snippetsRef = doc(db, 'users', user.uid, 'settings', 'text-expansion');

  // Set up real-time listener
  return onSnapshot(snippetsRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      const firestoreVersion = data.version || 0;
      const localVersion = localStorage.getItem('gpace-snippets-version');
      const localVersionNum = parseInt(localVersion) || 0;

      // Only update if Firestore version is newer
      if (firestoreVersion > localVersionNum) {
        console.log('Real-time update: New snippets version detected in Firestore');
        localStorage.setItem('gpace-snippets', JSON.stringify(data.snippets));
        localStorage.setItem('gpace-snippets-version', firestoreVersion.toString());

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
