/**
 * Sleep Schedule Manager Module
 * Handles loading and displaying sleep schedule information
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

/**
 * Load and display sleep schedule from storage
 */
function loadSleepSchedule() {
    const storage = getStorage();
    const scheduleData = storage.get('dailySchedule', null);

    if (scheduleData) {
        // Update wake time display
        const wakeTimeDisplay = document.getElementById('wakeTimeDisplay');
        const wakeBufferDisplay = document.getElementById('wakeBufferDisplay');
        const sleepTimeDisplay = document.getElementById('sleepTimeDisplay');
        const sleepBufferDisplay = document.getElementById('sleepBufferDisplay');
        const totalTimeDisplay = document.getElementById('totalTimeDisplay');

        if (wakeTimeDisplay) {
            wakeTimeDisplay.textContent = `Wake: ${scheduleData.wakeTime || '--:--'}`;
        }
        if (wakeBufferDisplay) {
            wakeBufferDisplay.textContent = `Buffer: ${scheduleData.wakeBuffer || '--'} min`;
        }
        if (sleepTimeDisplay) {
            sleepTimeDisplay.textContent = `Sleep: ${scheduleData.sleepTime || '--:--'}`;
        }
        if (sleepBufferDisplay) {
            sleepBufferDisplay.textContent = `Buffer: ${scheduleData.sleepBuffer || '--'} min`;
        }

        // Calculate total available time
        if (scheduleData.wakeTime && scheduleData.sleepTime && totalTimeDisplay) {
            const [wakeHours, wakeMinutes] = scheduleData.wakeTime.split(':').map(Number);
            const [sleepHours, sleepMinutes] = scheduleData.sleepTime.split(':').map(Number);

            // Convert both times to minutes since midnight
            const wakeTimeInMinutes = wakeHours * 60 + wakeMinutes;
            const sleepTimeInMinutes = sleepHours * 60 + sleepMinutes;

            // Calculate the difference
            let totalMinutes = sleepTimeInMinutes - wakeTimeInMinutes;
            if (totalMinutes < 0) {
                totalMinutes += 24 * 60; // Add 24 hours if sleep time is next day
            }

            // Convert to hours and minutes
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;

            // Update total time display
            totalTimeDisplay.textContent = `Available: ${hours} hours ${minutes} minutes`;
        }
    }
}

/**
 * Initialize sleep schedule event listeners
 */
function initializeSleepScheduleListeners() {
    // Load sleep schedule when page loads
    document.addEventListener('DOMContentLoaded', loadSleepSchedule);

    // Update sleep schedule when storage changes
    // Listen for both legacy and prefixed keys
    window.addEventListener('storage', function (e) {
        if (e.key === 'dailySchedule' || e.key === 'gpace_dailySchedule') {
            loadSleepSchedule();
        }
    });
}

// Initialize listeners when this module is imported
initializeSleepScheduleListeners();

export { loadSleepSchedule, initializeSleepScheduleListeners };
