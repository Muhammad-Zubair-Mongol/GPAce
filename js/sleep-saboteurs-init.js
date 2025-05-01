// Initialization Module for Sleep Saboteurs

/**
 * Initialize all components of the Sleep Saboteurs page
 */
function initializeSleepSaboteurs() {
    // Initialize clock display
    if (window.clockDisplay) {
        window.clockDisplay.initializeClockDisplay();
        window.clockDisplay.initializeTimeFormatToggle();
    }
    
    // Initialize theme
    if (window.themeManager) {
        window.themeManager.initializeTheme();
    }
    
    // Initialize alarm UI components
    if (window.alarmUI) {
        window.alarmUI.initializeAlarmFormToggle();
        window.alarmUI.initializeAmPmToggle();
        window.alarmUI.initializeAlarmForm();
    }
}

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeSleepSaboteurs);
