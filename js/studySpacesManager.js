/**
 * StudySpacesManager - Main orchestrator for study spaces page
 * 
 * This is a refactored, modular version that delegates to focused controllers:
 * - ScheduleController: Wake/sleep times, timetable upload
 * - TimetableController: Timeline visualization, analysis display
 * - StudySpaceController: Study space CRUD, image handling, sync
 */

function getGpaceApiClient() {
    if (window.gpaceApiClient) return Promise.resolve(window.gpaceApiClient);
    if (!window.__gpaceApiClientPromise) {
        const moduleUrl = new URL('/js/services/ApiClient.js', window.location.origin).href;
        window.__gpaceApiClientPromise = import(moduleUrl).then(({ getApiClient }) => getApiClient());
    }
    return window.__gpaceApiClientPromise;
}

class StudySpacesManager {
    constructor() {
        this.scheduleController = null;
        this.timetableController = null;
        this.studySpaceController = null;
        this.userId = 'default';
        this.initialized = false;
    }

    /**
     * Initialize the manager and all controllers
     */
    async init() {
        if (this.initialized) {
            console.warn('StudySpacesManager already initialized');
            return;
        }

        try {
            // Get user ID from Firebase Auth if available
            await this.initializeUserId();

            // Initialize controllers
            this.scheduleController = new ScheduleController();
            this.timetableController = new TimetableController();
            this.studySpaceController = new StudySpaceController();

            // Set user ID on controllers
            this.scheduleController.setUserId(this.userId);
            this.studySpaceController.setUserId(this.userId);

            // Initialize controllers
            this.scheduleController.init();
            this.timetableController.init();
            this.studySpaceController.init();

            // Setup additional event listeners
            this.setupGlobalListeners();

            // Load saved settings
            await this.loadSavedSettings();

            this.initialized = true;
            console.log('StudySpacesManager initialized successfully');

        } catch (error) {
            console.error('Error initializing StudySpacesManager:', error);
        }
    }

    /**
     * Initialize user ID from Firebase Auth
     */
    async initializeUserId() {
        // Wait a bit for auth to be ready
        await new Promise(resolve => setTimeout(resolve, 500));

        if (typeof firebase !== 'undefined' && firebase.auth) {
            const user = firebase.auth().currentUser;
            if (user) {
                this.userId = user.uid;
                console.log('Using authenticated user ID:', this.userId);
            }
        } else if (window.auth && window.auth.currentUser) {
            this.userId = window.auth.currentUser.uid;
        }
    }

    /**
     * Setup global event listeners
     */
    setupGlobalListeners() {
        // Save settings button
        const saveSettingsBtn = document.getElementById('saveSettings');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', () => this.saveSettings());
        }

        // Sync now button
        const syncNowBtn = document.getElementById('syncNowBtn');
        if (syncNowBtn) {
            syncNowBtn.addEventListener('click', async () => {
                await this.studySpaceController.forceSync();
            });
        }

        // Listen for schedule changes to save
        window.addEventListener('scheduleChanged', () => {
            this.saveSettings();
        });
    }

    /**
     * Load saved settings from server
     */
    async loadSavedSettings() {
        try {
            const client = await getGpaceApiClient();
            const settings = await client.get(`/api/settings/${encodeURIComponent(this.userId)}`);

            // Schedule data is a browser draft; the settings API intentionally
            // accepts only user preferences and never arbitrary schedule data.
            const savedSchedule = localStorage.getItem('dailySchedule');
            if (savedSchedule && this.scheduleController) {
                this.scheduleController.setSchedule(JSON.parse(savedSchedule));
            }

            this.applyPreferenceSettings(settings);

            console.log('Settings loaded successfully');
        } catch (error) {
            if (error && error.authFailure) {
                console.warn('Settings draft retained until authentication is restored.');
            }
            console.log('Could not load settings from server:', error.message);
        }
    }

    /**
     * Save all settings
     */
    async saveSettings() {
        try {
            const schedule = this.scheduleController ? this.scheduleController.getSchedule() : {};
            localStorage.setItem('dailySchedule', JSON.stringify(schedule));
            const client = await getGpaceApiClient();
            const settings = this.collectPreferenceSettings();
            const result = await client.post(`/api/settings/${encodeURIComponent(this.userId)}`, settings);

            if (result && result.success !== false) {
                console.log('Settings saved successfully');
                if (window.soundManager) {
                    window.soundManager.playSound('transition', 'success');
                }
            } else {
                console.warn('Failed to save settings');
            }
        } catch (error) {
            if (error && error.authFailure) {
                console.warn('Schedule draft retained locally until authentication is restored.');
            }
            console.error('Error saving settings:', error);
        }
    }

    collectPreferenceSettings() {
        const root = document.documentElement;
        const pomodoro = document.getElementById('pomodoroDuration');
        return {
            theme: root && root.dataset && root.dataset.theme ? root.dataset.theme : 'dark',
            notifications: true,
            pomodoroDuration: pomodoro && Number(pomodoro.value) ? Number(pomodoro.value) : 25
        };
    }

    applyPreferenceSettings(settings = {}) {
        if (settings.theme && document.documentElement && document.documentElement.dataset) {
            document.documentElement.dataset.theme = settings.theme;
        }
        const pomodoro = document.getElementById('pomodoroDuration');
        if (pomodoro && settings.pomodoroDuration) pomodoro.value = settings.pomodoroDuration;
    }

    /**
     * Get study space controller for external access
     */
    getStudySpaceController() {
        return this.studySpaceController;
    }

    /**
     * Get schedule controller for external access
     */
    getScheduleController() {
        return this.scheduleController;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Wait for Firestore functions to be ready
    const initManager = () => {
        window.studySpacesManager = new StudySpacesManager();
        window.studySpacesManager.init();
    };

    // Check if Firestore functions are already available
    if (typeof window.loadStudySpacesFromFirestore === 'function') {
        initManager();
    } else {
        // Wait for the firestoreFunctionsReady event
        window.addEventListener('firestoreFunctionsReady', initManager, { once: true });

        // Fallback timeout in case event doesn't fire
        setTimeout(() => {
            if (!window.studySpacesManager) {
                console.log('Initializing StudySpacesManager without Firestore');
                initManager();
            }
        }, 2000);
    }
});

// Export for browser
if (typeof window !== 'undefined') {
    window.StudySpacesManager = StudySpacesManager;
}
