/**
 * Schedule Manager Module
 * Handles daily schedule management and related UI interactions
 * Uses StorageService for persistence
 */

// Get storage service with fallback (use existing or create new)
if (typeof window.getStorage === 'undefined') {
    window.getStorage = () => window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };
}
const getStorage = window.getStorage;

// Function to save daily schedule to storage
function saveDailySchedule() {
    const storage = getStorage();
    const wakeTime = document.getElementById('wakeTime').value;
    const sleepTime = document.getElementById('sleepTime').value;
    const wakeBuffer = document.getElementById('wakeBuffer').value;
    const sleepBuffer = document.getElementById('sleepBuffer').value;

    const scheduleData = {
        wakeTime,
        sleepTime,
        wakeBuffer,
        sleepBuffer
    };

    console.log('Saving schedule:', scheduleData);
    storage.set('dailySchedule', scheduleData);
}

// Function to load daily schedule from storage
function loadDailySchedule() {
    const storage = getStorage();
    const scheduleData = storage.get('dailySchedule', null);
    console.log('Loading saved schedule:', scheduleData);

    if (scheduleData) {
        const wakeTimeInput = document.getElementById('wakeTime');
        const sleepTimeInput = document.getElementById('sleepTime');
        const wakeBufferSelect = document.getElementById('wakeBuffer');
        const sleepBufferSelect = document.getElementById('sleepBuffer');

        if (wakeTimeInput && sleepTimeInput && wakeBufferSelect && sleepBufferSelect) {
            wakeTimeInput.value = scheduleData.wakeTime || '';
            sleepTimeInput.value = scheduleData.sleepTime || '';
            wakeBufferSelect.value = scheduleData.wakeBuffer || '0';
            sleepBufferSelect.value = scheduleData.sleepBuffer || '0';
            console.log('Schedule loaded successfully');
        } else {
            console.error('Some elements not found:', {
                wakeTimeInput: !!wakeTimeInput,
                sleepTimeInput: !!sleepTimeInput,
                wakeBufferSelect: !!wakeBufferSelect,
                sleepBufferSelect: !!sleepBufferSelect
            });
        }
    }
}

// Load saved wake and sleep times from storage
function loadSavedTimes() {
    const storage = getStorage();
    const savedWakeTime = storage.get('wakeTime', null);
    const savedSleepTime = storage.get('sleepTime', null);

    if (savedWakeTime) {
        document.getElementById('wakeTime').value = savedWakeTime;
    }
    if (savedSleepTime) {
        document.getElementById('sleepTime').value = savedSleepTime;
    }
}

// Set up event listeners for time inputs
function setupTimeInputListeners() {
    const storage = getStorage();

    // Add event listeners for time changes
    const wakeTimeInput = document.getElementById('wakeTime');
    const sleepTimeInput = document.getElementById('sleepTime');

    if (wakeTimeInput) {
        wakeTimeInput.addEventListener('change', function () {
            storage.set('wakeTime', this.value);
        });
    }

    if (sleepTimeInput) {
        sleepTimeInput.addEventListener('change', function () {
            storage.set('sleepTime', this.value);
        });
    }
}

// Save schedule settings
function saveScheduleSettings() {
    const storage = getStorage();
    const wakeTime = document.getElementById('wakeTime').value;
    const sleepTime = document.getElementById('sleepTime').value;

    if (wakeTime && sleepTime) {
        storage.set('wakeTime', wakeTime);
        storage.set('sleepTime', sleepTime);
        alert('Settings saved successfully!');
    } else {
        alert('Please set both wake up and sleep times.');
    }
}

// Initialize schedule settings
function initializeScheduleSettings() {
    // Load saved times
    loadSavedTimes();

    // Set up event listeners
    setupTimeInputListeners();

    // Set up save button
    const saveSettingsBtn = document.getElementById('saveSettings');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', saveScheduleSettings);
    }
}

// Initialize when the DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
    console.log('DOM Content Loaded - Schedule Manager');

    const wakeTime = document.getElementById('wakeTime');
    const sleepTime = document.getElementById('sleepTime');
    const wakeBuffer = document.getElementById('wakeBuffer');
    const sleepBuffer = document.getElementById('sleepBuffer');

    if (wakeTime) wakeTime.addEventListener('change', saveDailySchedule);
    if (sleepTime) sleepTime.addEventListener('change', saveDailySchedule);
    if (wakeBuffer) wakeBuffer.addEventListener('change', saveDailySchedule);
    if (sleepBuffer) sleepBuffer.addEventListener('change', saveDailySchedule);

    // Also save when the save button is clicked
    const saveButton = document.getElementById('saveSettings');
    if (saveButton) {
        saveButton.addEventListener('click', function () {
            saveDailySchedule();
            alert('Settings saved successfully!');
        });
    }

    // Load the saved schedule
    loadDailySchedule();

    // Initialize schedule settings
    initializeScheduleSettings();
});
