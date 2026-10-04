/**
 * Utils Index
 * Re-exports all utility modules for convenient importing.
 * 
 * Usage:
 *   import { Sanitizer, Logger } from './index.js';
 */

export { default as Sanitizer, sanitizer } from './Sanitizer.js';
export { default as Logger, logger, LOG_LEVELS } from './Logger.js';

// Convenience object for all utilities
const Utils = {
    get sanitizer() { return window.Sanitizer; },
    get logger() { return window.Logger; }
};

export default Utils;
