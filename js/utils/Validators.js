/**
 * Validators - Input validation and sanitization utilities
 * Prevents NaN, Infinity, and invalid computed values
 */
class Validators {
    /**
     * Validate and calculate time utilization safely
     * @param {Number} totalWorkTime - Total work time in seconds
     * @param {String|Number} wakeTime - Wake time (ISO string or timestamp)
     * @param {Number} currentTime - Current timestamp (default: Date.now())
     * @returns {Number} Valid percentage (0-100)
     */
    static validateTimeUtilization(totalWorkTime, wakeTime, currentTime = Date.now()) {
        // Validate inputs
        const workTime = parseFloat(totalWorkTime);
        if (isNaN(workTime) || workTime < 0) {
            return 0;
        }

        if (!wakeTime) {
            return 0; // Wake time not set yet
        }

        // Parse wake time
        let wakeTimestamp;
        if (typeof wakeTime === 'string') {
            wakeTimestamp = new Date(wakeTime).getTime();
        } else {
            wakeTimestamp = parseFloat(wakeTime);
        }

        if (isNaN(wakeTimestamp)) {
            return 0; // Invalid wake time
        }

        // Check if day has started
        if (currentTime <= wakeTimestamp) {
            return 0; // Haven't started day yet
        }

        // Calculate time available (in seconds)
        const timeAvailable = (currentTime - wakeTimestamp) / 1000;

        if (timeAvailable <= 0) {
            return 0;
        }

        // Calculate utilization
        const utilization = (workTime / timeAvailable) * 100;

        // Clamp to valid range (0-100%)
        return Math.max(0, Math.min(100, utilization));
    }

    /**
     * Validate numeric input with bounds
     * @param {*} value - Value to validate
     * @param {Number} min - Minimum allowed value
     * @param {Number} max - Maximum allowed value
     * @param {Number} defaultValue - Default if invalid
     * @returns {Number} Valid number within bounds
     */
    static validateNumeric(value, min, max, defaultValue = 0) {
        const num = parseFloat(value);

        if (isNaN(num) || !isFinite(num)) {
            return defaultValue;
        }

        return Math.max(min, Math.min(max, num));
    }

    /**
     * Validate integer with bounds
     * @param {*} value - Value to validate
     * @param {Number} min - Minimum allowed value
     * @param {Number} max - Maximum allowed value
     * @param {Number} defaultValue - Default if invalid
     * @returns {Number} Valid integer within bounds
     */
    static validateInteger(value, min, max, defaultValue = 0) {
        const num = parseInt(value, 10);

        if (isNaN(num)) {
            return defaultValue;
        }

        return Math.max(min, Math.min(max, num));
    }

    /**
     * Safely format time duration
     * @param {Number} seconds - Duration in seconds
     * @returns {String} Formatted time (HH:MM:SS or MM:SS)
     */
    static formatDuration(seconds) {
        const s = this.validateInteger(seconds, 0, Infinity, 0);

        const hours = Math.floor(s / 3600);
        const minutes = Math.floor((s % 3600) / 60);
        const secs = s % 60;

        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }

        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Validate percentage value
     * @param {*} value - Value to validate
     * @param {Number} decimals - Decimal places (default: 1)
     * @returns {String} Formatted percentage (e.g., "45.3%")
     */
    static formatPercentage(value, decimals = 1) {
        const num = this.validateNumeric(value, 0, 100, 0);
        return num.toFixed(decimals) + '%';
    }

    /**
     * Validate task priority score
     * @param {Object} task - Task object
     * @returns {Number} Valid priority score
     */
    static validatePriorityScore(task) {
        if (!task || typeof task !== 'object') {
            return 0;
        }

        const score = parseFloat(task.priorityScore);

        if (isNaN(score) || !isFinite(score)) {
            return 0;
        }

        return Math.max(0, score);
    }

    /**
     * Validate timer state
     * @param {Object} state - Timer state object
     * @returns {Object} Validated state
     */
    static validateTimerState(state) {
        if (!state || typeof state !== 'object') {
            return {
                timeLeft: 1500,
                currentState: 'focus',
                pomodoroCount: 0,
                isRunning: false
            };
        }

        return {
            timeLeft: this.validateInteger(state.timeLeft, 0, 7200, 1500),
            currentState: ['focus', 'break', 'paused'].includes(state.currentState) ? state.currentState : 'focus',
            pomodoroCount: this.validateInteger(state.pomodoroCount, 0, 1000, 0),
            isRunning: Boolean(state.isRunning)
        };
    }

    /**
     * Validate energy level (1-7 Karolinska scale)
     * @param {*} level - Energy level
     * @returns {Number} Valid level (1-7)
     */
    static validateEnergyLevel(level) {
        return this.validateInteger(level, 1, 7, 3);
    }

    /**
     * Sanitize task title
     * @param {String} title - Task title
     * @param {Number} maxLength - Maximum length
     * @returns {String} Sanitized title
     */
    static sanitizeTaskTitle(title, maxLength = 200) {
        if (typeof title !== 'string') {
            return '';
        }

        return title
            .trim()
            .substring(0, maxLength)
            .replace(/[<>]/g, ''); // Remove potential HTML tags
    }

    /**
     * Validate ISO timestamp
     * @param {String} timestamp - ISO timestamp string
     * @returns {String|null} Valid timestamp or null
     */
    static validateTimestamp(timestamp) {
        if (!timestamp) return null;

        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) {
                return null;
            }
            return date.toISOString();
        } catch {
            return null;
        }
    }

    /**
     * Validate localStorage data
     * @param {String} key - localStorage key
     * @param {*} defaultValue - Default value if invalid
     * @returns {*} Parsed and validated data
     */
    static getValidatedStorageItem(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            if (!item) return defaultValue;

            const parsed = JSON.parse(item);
            return parsed;
        } catch (err) {
            console.warn(`Invalid localStorage data for key "${key}":`, err);
            return defaultValue;
        }
    }

    /**
     * Safely set localStorage item
     * @param {String} key - localStorage key
     * @param {*} value - Value to store
     * @returns {Boolean} Success status
     */
    static setValidatedStorageItem(key, value) {
        try {
            const serialized = JSON.stringify(value);
            localStorage.setItem(key, serialized);
            return true;
        } catch (err) {
            console.error(`Failed to save to localStorage key "${key}":`, err);

            // Show quota error to user
            if (err.name === 'QuotaExceededError') {
                if (typeof window.showNotification === 'function') {
                    window.showNotification('Storage Full', 'Local storage quota exceeded. Some data may not be saved.', 'error');
                }
            }

            return false;
        }
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.Validators = Validators;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Validators;
}
