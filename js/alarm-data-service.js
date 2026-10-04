// Firebase configuration and initialization using CDN imports
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot, writeBatch } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Import centralized Firebase config
import { firebaseConfig, getOrCreateFirebaseApp } from './firebaseConfig.js';

// Get storage service with fallback (use existing or create new)
if (typeof window.getStorage === 'undefined') {
    window.getStorage = () => window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };
}
const getStorage = window.getStorage;

// Initialize Firebase using centralized config (prevents duplicate app errors)
const app = getOrCreateFirebaseApp(initializeApp, getApps);
const db = getFirestore(app);
const auth = getAuth(app);

class AlarmDataService {
    constructor() {
        this.alarms = [];
        this.userId = null;
        this.listeners = new Set();
        this.lastSync = null;
        this.syncInterval = 5 * 60 * 1000; // Sync every 5 minutes
        this.saveTimeout = null;
        this.isOnline = navigator.onLine;

        // Initialize auth listener
        onAuthStateChanged(auth, (user) => {
            this.userId = user ? user.uid : null;
            if (user) {
                this.initializeFirestoreSync();
            }
        });

        // Setup online/offline detection
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.syncWithFirestore();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
        });

        // Start periodic sync
        this.startPeriodicSync();
    }

    // Start periodic sync with all storage methods
    startPeriodicSync() {
        setInterval(() => {
            this.periodicSync();
        }, this.syncInterval);
    }

    // Periodic sync function
    async periodicSync() {
        if (!this.hasChanges()) return;

        // Save to localStorage
        this.saveToLocalStorage();

        // Save to cache
        await this.saveToCache();

        // Sync with Firestore if online
        if (this.isOnline && this.userId) {
            await this.syncWithFirestore();
        }

        this.lastSync = new Date();
    }

    // Check if there are unsaved changes
    hasChanges() {
        if (!this.lastSync) return true;
        const storage = getStorage();
        const localAlarms = storage.get('alarms', []);
        return JSON.stringify(this.alarms) !== JSON.stringify(localAlarms);
    }

    // Debounced save function
    debouncedSave(alarm) {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }

        this.saveTimeout = setTimeout(() => {
            this.saveAlarm(alarm);
        }, 1000); // Debounce for 1 second
    }

    // Save to storage
    saveToLocalStorage() {
        const storage = getStorage();
        storage.set('alarms', this.alarms);
    }

    // Save to cache
    async saveToCache() {
        if ('caches' in window) {
            try {
                const cache = await caches.open('alarm-cache-v1');
                await cache.put(
                    '/alarms',
                    new Response(JSON.stringify(this.alarms))
                );
            } catch (error) {
                console.error('Error saving to cache:', error);
            }
        }
    }

    // Sync with Firestore
    async syncWithFirestore() {
        if (!this.userId) return;

        try {
            const batch = writeBatch(db);
            const alarmsRef = collection(db, `users/${this.userId}/alarms`);

            // Update or add alarms
            for (const alarm of this.alarms) {
                const alarmRef = doc(alarmsRef, alarm.id);
                batch.set(alarmRef, alarm);
            }

            // Get existing alarms from Firestore
            const snapshot = await getDocs(alarmsRef);
            const firestoreAlarmIds = new Set(snapshot.docs.map(doc => doc.id));

            // Delete alarms that exist in Firestore but not in local
            const localAlarmIds = new Set(this.alarms.map(alarm => alarm.id));
            firestoreAlarmIds.forEach(id => {
                if (!localAlarmIds.has(id)) {
                    const alarmRef = doc(alarmsRef, id);
                    batch.delete(alarmRef);
                }
            });

            await batch.commit();
        } catch (error) {
            console.error('Error syncing with Firestore:', error);
        }
    }

    // Add listener for alarm changes
    addListener(callback) {
        this.listeners.add(callback);
    }

    // Remove listener
    removeListener(callback) {
        this.listeners.delete(callback);
    }

    // Notify all listeners of changes
    notifyListeners() {
        this.listeners.forEach(callback => callback(this.alarms));
    }

    // Initialize Firestore sync
    async initializeFirestoreSync() {
        if (!this.userId) return;

        // Get initial data from Firestore
        const alarmsRef = collection(db, `users/${this.userId}/alarms`);

        // Set up real-time sync
        onSnapshot(alarmsRef, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added' || change.type === 'modified') {
                    this.updateAlarm(change.doc.id, change.doc.data());
                } else if (change.type === 'removed') {
                    this.deleteAlarm(change.doc.id);
                }
            });
        });
    }

    // Load alarms from all sources
    async loadAlarms() {
        // Load from storage first (fastest)
        const storage = getStorage();
        const localAlarms = storage.get('alarms', []);
        this.alarms = localAlarms;

        // Load from cache
        if ('caches' in window) {
            try {
                const cache = await caches.open('alarm-cache-v1');
                const response = await cache.match('/alarms');
                if (response) {
                    const cachedAlarms = await response.json();
                    this.mergeAlarms(cachedAlarms);
                }
            } catch (error) {
                console.error('Error loading from cache:', error);
            }
        }

        // Load from Firestore if authenticated
        if (this.userId) {
            try {
                const alarmsRef = collection(db, `users/${this.userId}/alarms`);
                const snapshot = await getDocs(alarmsRef);
                const firestoreAlarms = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                this.mergeAlarms(firestoreAlarms);
            } catch (error) {
                console.error('Error loading from Firestore:', error);
            }
        }

        this.notifyListeners();
        return this.alarms;
    }

    // Merge alarms from different sources
    mergeAlarms(newAlarms) {
        newAlarms.forEach(newAlarm => {
            const existingIndex = this.alarms.findIndex(a => a.id === newAlarm.id);
            if (existingIndex >= 0) {
                if (new Date(newAlarm.updatedAt) > new Date(this.alarms[existingIndex].updatedAt)) {
                    this.alarms[existingIndex] = newAlarm;
                }
            } else {
                this.alarms.push(newAlarm);
            }
        });
    }

    // Save alarm to all storage methods
    async saveAlarm(alarm) {
        alarm.updatedAt = new Date().toISOString();

        // Update local array
        const existingIndex = this.alarms.findIndex(a => a.id === alarm.id);
        if (existingIndex >= 0) {
            this.alarms[existingIndex] = alarm;
        } else {
            this.alarms.push(alarm);
        }

        // Save immediately to localStorage
        this.saveToLocalStorage();

        // Debounce other storage operations
        this.debouncedSave(alarm);

        this.notifyListeners();
        return alarm;
    }

    // Delete alarm from all storage methods
    async deleteAlarm(alarmId) {
        // Remove from local array
        this.alarms = this.alarms.filter(a => a.id !== alarmId);

        // Update storage
        const storage = getStorage();
        storage.set('alarms', this.alarms);

        // Update cache
        if ('caches' in window) {
            try {
                const cache = await caches.open('alarm-cache-v1');
                await cache.put(
                    '/alarms',
                    new Response(JSON.stringify(this.alarms))
                );
            } catch (error) {
                console.error('Error updating cache:', error);
            }
        }

        // Delete from Firestore if authenticated
        if (this.userId) {
            try {
                const alarmRef = doc(db, `users/${this.userId}/alarms/${alarmId}`);
                await deleteDoc(alarmRef);
            } catch (error) {
                console.error('Error deleting from Firestore:', error);
            }
        }

        this.notifyListeners();
    }

    // Update alarm active status
    async updateAlarmStatus(alarmId, active) {
        const alarm = this.alarms.find(a => a.id === alarmId);
        if (alarm) {
            alarm.active = active;
            await this.saveAlarm(alarm);
        }
    }

    // Add method to force immediate sync
    async forceSyncNow() {
        await this.periodicSync();
    }
}

// Create and export singleton instance
const alarmDataService = new AlarmDataService();
export default alarmDataService; 