/**
 * Sleep Schedule Manager Module
 * Handles loading and displaying sleep schedule information
 */

/**
 * Load and display sleep schedule from localStorage
 */
function loadSleepSchedule() {
    const savedSchedule = localStorage.getItem('dailySchedule');
    if (savedSchedule) {
        const scheduleData = JSON.parse(savedSchedule);

        // Update wake time display
        document.getElementById('wakeTimeDisplay').textContent =
            `Wake: ${scheduleData.wakeTime || '--:--'}`;
        document.getElementById('wakeBufferDisplay').textContent =
            `Buffer: ${scheduleData.wakeBuffer || '--'} min`;

        // Update sleep time display
        document.getElementById('sleepTimeDisplay').textContent =
            `Sleep: ${scheduleData.sleepTime || '--:--'}`;
        document.getElementById('sleepBufferDisplay').textContent =
            `Buffer: ${scheduleData.sleepBuffer || '--'} min`;

        // Calculate total available time
        if (scheduleData.wakeTime && scheduleData.sleepTime) {
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
            document.getElementById('totalTimeDisplay').textContent =
                `Available: ${hours} hours ${minutes} minutes`;
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
    window.addEventListener('storage', function(e) {
        if (e.key === 'dailySchedule') {
            loadSleepSchedule();
        }
    });
}

// Initialize listeners when this module is imported
initializeSleepScheduleListeners();

export { loadSleepSchedule, initializeSleepScheduleListeners };
