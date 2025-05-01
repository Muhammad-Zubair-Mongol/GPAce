// Clock Display Module for Sleep Saboteurs
let is24HourFormat = false;

/**
 * Initialize the clock display functionality
 */
function initializeClockDisplay() {
    // Start the clock update interval
    setInterval(updateClock, 1000);
    updateClock();
}

/**
 * Update the clock display with current time
 */
function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    let ampm = hours >= 12 ? 'PM' : 'AM';

    // Convert hours for display
    if (!is24HourFormat) {
        hours = hours % 12;
        hours = hours ? hours : 12;
    }

    // Update display
    document.querySelector('.hour').textContent = hours.toString().padStart(2, '0');
    document.querySelector('.minute').textContent = minutes.toString().padStart(2, '0');
    document.querySelector('.second').textContent = seconds.toString().padStart(2, '0');
    document.querySelector('.am-pm').textContent = is24HourFormat ? '' : ampm;

    // Update date
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    document.querySelector('.month').textContent = months[now.getMonth()];
    document.querySelector('.day').textContent = days[now.getDay()];
    document.querySelector('.date').textContent = now.getDate().toString().padStart(2, '0');
}

/**
 * Initialize the time format toggle functionality
 */
function initializeTimeFormatToggle() {
    const timeFormatToggle = document.querySelector('.time-format-toggle');
    
    timeFormatToggle.addEventListener('click', () => {
        is24HourFormat = !is24HourFormat;
        timeFormatToggle.querySelector('.format-text').textContent = is24HourFormat ? '12hr' : '24hr';
        updateClock();
    });
}

// Export functions for use in other modules
window.clockDisplay = {
    initializeClockDisplay,
    initializeTimeFormatToggle,
    updateClock
};
