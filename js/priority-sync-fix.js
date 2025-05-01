// priority-sync-fix.js - Fixes priority task synchronization issues

// Import Firestore functions
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Function to force load priority tasks from Firestore
// Function to force load priority tasks from Firestore
async function forceSyncPriorityTasks() {
    console.group('🔄 Force Syncing Priority Tasks');
    
    try {
        // Get auth and db
        const auth = window.auth || getAuth();
        const db = getFirestore();
        
        // Check if user is authenticated
        const user = auth.currentUser;
        if (!user) {
            console.error('No user is signed in');
            console.groupEnd();
            return { success: false, error: 'Not authenticated' };
        }
        
        // Get priority tasks from Firestore
        const priorityRef = doc(db, 'users', user.uid, 'settings', 'priorityTasks');
        const docSnap = await getDoc(priorityRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            console.log('Found priority tasks in Firestore:', data.tasks.length);
            
            // Get the local version timestamp if any
            const localVersion = localStorage.getItem('priorityTasksVersion') || '0';
            
            // Compare versions to determine which is newer
            if (!localVersion || parseInt(data.version) > parseInt(localVersion)) {
                console.log('Firestore data is newer, using it');
                localStorage.setItem('calculatedPriorityTasks', JSON.stringify(data.tasks));
                localStorage.setItem('priorityTasksVersion', data.version.toString());
                localStorage.setItem('priorityTasksSource', 'firestore');
            } else {
                console.log('Local data is newer, keeping it');
            }
            
            // Trigger display update if function exists
            if (typeof window.displayPriorityTask === 'function') {
                window.displayPriorityTask();
            }
            
            console.groupEnd();
            return { 
                success: true, 
                message: `Successfully processed ${data.tasks.length} tasks from Firestore`,
                tasks: data.tasks
            };
        } else {
            console.log('No priority tasks found in Firestore');
            console.groupEnd();
            return { success: false, error: 'No tasks found in Firestore' };
        }
    } catch (error) {
        console.error('Error force syncing priority tasks:', error);
        console.groupEnd();
        return { success: false, error: error.message };
    }
}

// Function to detect incognito mode
async function isIncognitoMode() {
    // Method 1: Try to use localStorage
    try {
        const testKey = '_test_incognito_' + Math.random();
        localStorage.setItem(testKey, '1');
        const testValue = localStorage.getItem(testKey);
        localStorage.removeItem(testKey);
        
        // If we can't read what we just wrote, we might be in incognito mode
        if (testValue !== '1') {
            return true;
        }
    } catch (e) {
        // If there's an error accessing localStorage, we might be in incognito mode
        return true;
    }
    
    // Method 2: Check available storage quota (works in some browsers)
    try {
        const quota = await navigator.storage.estimate();
        // In incognito mode, the quota is typically much lower
        if (quota && quota.quota && quota.quota < 120000000) { // Less than ~120MB
            return true;
        }
    } catch (e) {
        // Ignore errors from this method
    }
    
    // If all tests pass, probably not in incognito mode
    return false;
}

// Auto-run in incognito mode
async function autoFixInIncognito() {
    const incognito = await isIncognitoMode();
    if (incognito) {
        console.log('📱 Incognito mode detected, automatically fixing priority tasks');
        return await forceSyncPriorityTasks();
    }
    return { success: false, message: 'Not in incognito mode' };
}

// Export functions
window.prioritySyncFix = {
    forceSyncPriorityTasks,
    isIncognitoMode,
    autoFixInIncognito
};

// Auto-run when loaded
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🔄 Priority Sync Fix loaded');
    
    // Wait for auth to be initialized
    setTimeout(async () => {
        await autoFixInIncognito();
    }, 2000);
});

export { forceSyncPriorityTasks, isIncognitoMode, autoFixInIncognito }; 