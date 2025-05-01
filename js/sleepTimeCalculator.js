function calculateSleepTime() {
    const savedSchedule = localStorage.getItem('dailySchedule');
    if (!savedSchedule) {
        return 'Not Set';
    }

    const scheduleData = JSON.parse(savedSchedule);
    if (!scheduleData.wakeTime || !scheduleData.sleepTime) {
        return 'Not Set';
    }

    // Get current time
    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentSeconds = now.getSeconds();

    // Convert wake and sleep times to minutes
    const [wakeHours, wakeMinutes] = scheduleData.wakeTime.split(':').map(Number);
    const [sleepHours, sleepMinutes] = scheduleData.sleepTime.split(':').map(Number);

    // Convert all times to seconds since midnight
    const currentTimeInSeconds = (currentHours * 3600) + (currentMinutes * 60) + currentSeconds;
    const wakeTimeInSeconds = (wakeHours * 3600) + (wakeMinutes * 60);
    let sleepTimeInSeconds = (sleepHours * 3600) + (sleepMinutes * 60);

    // If sleep time is before midnight and current time is after, add 24 hours to sleep time
    if (sleepTimeInSeconds < wakeTimeInSeconds) {
        sleepTimeInSeconds += 24 * 3600;
    }

    // Calculate time until sleep
    let secondsRemaining = sleepTimeInSeconds - currentTimeInSeconds;
    
    // If current time is before wake time, subtract 24 hours
    if (currentTimeInSeconds < wakeTimeInSeconds) {
        secondsRemaining = sleepTimeInSeconds - (currentTimeInSeconds + (24 * 3600));
    }
    
    // If time is negative, add 24 hours
    if (secondsRemaining < 0) {
        secondsRemaining += 24 * 3600;
    }

    // Convert to hours, minutes, seconds
    const hours = Math.floor(secondsRemaining / 3600);
    const minutes = Math.floor((secondsRemaining % 3600) / 60);
    const seconds = Math.floor(secondsRemaining % 60);

    return `${hours}h ${minutes}m ${seconds}s`;
}

// Update the display when the page loads and every second
document.addEventListener('DOMContentLoaded', function() {
    function updateDisplay() {
        const sleepTimeElement = document.getElementById('sleepTimeDisplay');
        if (sleepTimeElement) {
            sleepTimeElement.textContent = calculateSleepTime();
        }
    }

    // Update immediately and then every second
    updateDisplay();
    setInterval(updateDisplay, 1000);
});
