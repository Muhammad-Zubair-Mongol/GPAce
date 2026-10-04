/**
 * Logger.js
 * Secure logging utility that filters sensitive data.
 * Part of Batch 5: Security Hardening.
 * 
 * Features:
 * - Automatic filtering of sensitive data (API keys, tokens, passwords)
 * - Log level control
 * - Structured logging with timestamps
 * - Production mode toggle
 * 
 * Usage:
 *   import Logger from './Logger.js';
 *   
 *   Logger.info('User logged in', { userId: 123 });
 *   Logger.error('API failed', error);
 *   Logger.debug('Debug data', sensitiveObj); // Auto-filtered
 */

// Sensitive patterns to filter
const SENSITIVE_PATTERNS = [
    /api[_-]?key/i,
    /access[_-]?token/i,
    /auth[_-]?token/i,
    /bearer/i,
    /password/i,
    /secret/i,
    /credential/i,
    /private[_-]?key/i,
    /client[_-]?secret/i,
    /todoist/i,
    /gemini/i,
    /wolfram/i,
    /tavily/i
];

// Sensitive value patterns (to detect actual secrets in values)
const SENSITIVE_VALUE_PATTERNS = [
    /^sk-[a-zA-Z0-9]{20,}/,  // OpenAI-style keys
    /^AIza[a-zA-Z0-9_-]{35}/,  // Google API keys
    /^[a-f0-9]{32,64}$/i,  // Generic hex tokens
    /^ey[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/  // JWT tokens
];

const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4
};

class Logger {
    constructor() {
        this.level = LOG_LEVELS.DEBUG;
        this.isProduction = window.location.hostname !== 'localhost' &&
            window.location.hostname !== '127.0.0.1';
        this.prefix = '[GPAce]';
        this.enableTimestamps = true;

        // In production, only show warnings and errors
        if (this.isProduction) {
            this.level = LOG_LEVELS.WARN;
        }
    }

    /**
     * Set minimum log level
     * @param {string} level - 'debug', 'info', 'warn', 'error', 'none'
     */
    setLevel(level) {
        const upperLevel = level.toUpperCase();
        if (LOG_LEVELS[upperLevel] !== undefined) {
            this.level = LOG_LEVELS[upperLevel];
        }
    }

    /**
     * Debug level logging
     * @param {string} message - Log message
     * @param {...any} args - Additional arguments
     */
    debug(message, ...args) {
        if (this.level <= LOG_LEVELS.DEBUG) {
            this._log('debug', message, args);
        }
    }

    /**
     * Info level logging
     * @param {string} message - Log message
     * @param {...any} args - Additional arguments
     */
    info(message, ...args) {
        if (this.level <= LOG_LEVELS.INFO) {
            this._log('info', message, args);
        }
    }

    /**
     * Warning level logging
     * @param {string} message - Log message
     * @param {...any} args - Additional arguments
     */
    warn(message, ...args) {
        if (this.level <= LOG_LEVELS.WARN) {
            this._log('warn', message, args);
        }
    }

    /**
     * Error level logging
     * @param {string} message - Log message
     * @param {...any} args - Additional arguments
     */
    error(message, ...args) {
        if (this.level <= LOG_LEVELS.ERROR) {
            this._log('error', message, args);
        }
    }

    /**
     * Group related logs
     * @param {string} label - Group label
     */
    group(label) {
        if (this.level <= LOG_LEVELS.DEBUG && console.group) {
            console.group(this._formatMessage(label));
        }
    }

    /**
     * End log group
     */
    groupEnd() {
        if (this.level <= LOG_LEVELS.DEBUG && console.groupEnd) {
            console.groupEnd();
        }
    }

    /**
     * Log with timing
     * @param {string} label - Timer label
     */
    time(label) {
        if (this.level <= LOG_LEVELS.DEBUG && console.time) {
            console.time(`${this.prefix} ${label}`);
        }
    }

    /**
     * End timing log
     * @param {string} label - Timer label
     */
    timeEnd(label) {
        if (this.level <= LOG_LEVELS.DEBUG && console.timeEnd) {
            console.timeEnd(`${this.prefix} ${label}`);
        }
    }

    /**
     * Create a child logger with a specific context
     * @param {string} context - Context name
     * @returns {Object} Scoped logger
     */
    scope(context) {
        const scopedPrefix = `${this.prefix}[${context}]`;
        return {
            debug: (msg, ...args) => this.level <= LOG_LEVELS.DEBUG &&
                this._log('debug', msg, args, scopedPrefix),
            info: (msg, ...args) => this.level <= LOG_LEVELS.INFO &&
                this._log('info', msg, args, scopedPrefix),
            warn: (msg, ...args) => this.level <= LOG_LEVELS.WARN &&
                this._log('warn', msg, args, scopedPrefix),
            error: (msg, ...args) => this.level <= LOG_LEVELS.ERROR &&
                this._log('error', msg, args, scopedPrefix)
        };
    }

    // ============================================
    // Private Methods
    // ============================================

    /**
     * Internal log method
     * @private
     */
    _log(level, message, args, prefix = this.prefix) {
        const formattedMessage = this._formatMessage(message, prefix);
        const sanitizedArgs = args.map(arg => this._sanitize(arg));

        switch (level) {
            case 'debug':
                console.log(formattedMessage, ...sanitizedArgs);
                break;
            case 'info':
                console.info(formattedMessage, ...sanitizedArgs);
                break;
            case 'warn':
                console.warn(formattedMessage, ...sanitizedArgs);
                break;
            case 'error':
                console.error(formattedMessage, ...sanitizedArgs);
                break;
        }
    }

    /**
     * Format log message with prefix and timestamp
     * @private
     */
    _formatMessage(message, prefix = this.prefix) {
        if (this.enableTimestamps) {
            const now = new Date();
            const time = now.toLocaleTimeString('en-US', { hour12: false });
            return `${prefix} [${time}] ${message}`;
        }
        return `${prefix} ${message}`;
    }

    /**
     * Sanitize value to remove sensitive data
     * @private
     */
    _sanitize(value) {
        if (value === null || value === undefined) {
            return value;
        }

        // Handle Error objects
        if (value instanceof Error) {
            return {
                name: value.name,
                message: this._sanitizeString(value.message),
                stack: this.isProduction ? '[hidden]' : value.stack
            };
        }

        // Handle strings
        if (typeof value === 'string') {
            return this._sanitizeString(value);
        }

        // Handle arrays
        if (Array.isArray(value)) {
            return value.map(item => this._sanitize(item));
        }

        // Handle objects
        if (typeof value === 'object') {
            return this._sanitizeObject(value);
        }

        return value;
    }

    /**
     * Sanitize string value
     * @private
     */
    _sanitizeString(str) {
        // Check if the value looks like a secret
        for (const pattern of SENSITIVE_VALUE_PATTERNS) {
            if (pattern.test(str)) {
                return '[REDACTED]';
            }
        }

        // Mask long alphanumeric strings that might be tokens
        if (str.length > 20 && /^[a-zA-Z0-9_-]+$/.test(str)) {
            return str.substring(0, 4) + '...' + str.substring(str.length - 4);
        }

        return str;
    }

    /**
     * Sanitize object by filtering sensitive keys
     * @private
     */
    _sanitizeObject(obj) {
        const sanitized = {};

        for (const [key, value] of Object.entries(obj)) {
            // Check if key matches sensitive patterns
            const isSensitiveKey = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));

            if (isSensitiveKey) {
                sanitized[key] = '[REDACTED]';
            } else {
                sanitized[key] = this._sanitize(value);
            }
        }

        return sanitized;
    }
}

// Create singleton instance
const logger = new Logger();

// Export for ES modules
export { logger, Logger, LOG_LEVELS };
export default logger;

// Register globally
window.Logger = logger;
