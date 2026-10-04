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
    
}

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeSleepSaboteurs);
