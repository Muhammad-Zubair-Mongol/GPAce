/**
 * Schedule Manager Module
 * Handles daily schedule management and related UI interactions
 */

// Function to save daily schedule to localStorage
function saveDailySchedule() {
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
    localStorage.setItem('dailySchedule', JSON.stringify(scheduleData));
}

// Function to load daily schedule from localStorage
function loadDailySchedule() {
    const savedSchedule = localStorage.getItem('dailySchedule');
    console.log('Loading saved schedule:', savedSchedule);

    if (savedSchedule) {
        const scheduleData = JSON.parse(savedSchedule);
        console.log('Parsed schedule data:', scheduleData);

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

// Load saved wake and sleep times from localStorage
function loadSavedTimes() {
    const savedWakeTime = localStorage.getItem('wakeTime');
    const savedSleepTime = localStorage.getItem('sleepTime');

    if (savedWakeTime) {
        document.getElementById('wakeTime').value = savedWakeTime;
    }
    if (savedSleepTime) {
        document.getElementById('sleepTime').value = savedSleepTime;
    }
}

// Set up event listeners for time inputs
function setupTimeInputListeners() {
    // Add event listeners for time changes
    const wakeTimeInput = document.getElementById('wakeTime');
    const sleepTimeInput = document.getElementById('sleepTime');

    if (wakeTimeInput) {
        wakeTimeInput.addEventListener('change', function() {
            localStorage.setItem('wakeTime', this.value);
        });
    }

    if (sleepTimeInput) {
        sleepTimeInput.addEventListener('change', function() {
            localStorage.setItem('sleepTime', this.value);
        });
    }
}

// Save schedule settings
function saveScheduleSettings() {
    const wakeTime = document.getElementById('wakeTime').value;
    const sleepTime = document.getElementById('sleepTime').value;

    if (wakeTime && sleepTime) {
        localStorage.setItem('wakeTime', wakeTime);
        localStorage.setItem('sleepTime', sleepTime);
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
document.addEventListener('DOMContentLoaded', function() {
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
        saveButton.addEventListener('click', function() {
            saveDailySchedule();
            alert('Settings saved successfully!');
        });
    }

    // Load the saved schedule
    loadDailySchedule();

    // Initialize schedule settings
    initializeScheduleSettings();
});
