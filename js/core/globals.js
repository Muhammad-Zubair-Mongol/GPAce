/**
 * Globals Registry Module
 * Provides controlled access to global variables instead of direct window pollution.
 * Part of the codebase remediation plan - Batch 2.
 * 
 * Usage:
 *   import globals from './core/globals.js';
 *   
 *   // Register a global (for HTML onclick compatibility)
 *   globals.register('showToast', showToast);
 *   
 *   // Get a registered global
 *   const fn = globals.get('showToast');
 *   
 *   // Check if registered
 *   if (globals.has('showToast')) { ... }
 */

const DEBUG_MODE = false;

class GlobalsRegistry {
    constructor() {
        this._registry = new Map();
        this._accessLog = [];
    }

    /**
     * Register a value as a global, making it accessible on window
     * @param {string} name - The global name
     * @param {*} value - The value to register
     * @param {object} options - Optional settings
     * @param {boolean} options.readonly - If true, prevent overwriting
     * @param {string} options.module - Source module name for debugging
     * @returns {boolean} Success status
     */
    register(name, value, options = {}) {
        if (typeof name !== 'string' || !name) {
            console.error('[Globals] Invalid name provided');
            return false;
        }

        const existingEntry = this._registry.get(name);
        if (existingEntry && existingEntry.readonly) {
            console.warn(`[Globals] Cannot overwrite readonly global: ${name}`);
            return false;
        }

        // Store in registry
        this._registry.set(name, {
            value,
            readonly: options.readonly || false,
            module: options.module || 'unknown',
            registeredAt: new Date().toISOString()
        });

        // Also set on window for HTML onclick compatibility
        window[name] = value;

        if (DEBUG_MODE) {
            console.log(`[Globals] Registered: ${name} from ${options.module || 'unknown'}`);
        }

        return true;
    }

    /**
     * Get a registered global value
     * @param {string} name - The global name
     * @returns {*} The registered value or undefined
     */
    get(name) {
        const entry = this._registry.get(name);
        if (entry) {
            if (DEBUG_MODE) {
                this._accessLog.push({ name, timestamp: Date.now() });
            }
            return entry.value;
        }
        // Fall back to window for legacy compatibility
        return window[name];
    }

    /**
     * Check if a global is registered
     * @param {string} name - The global name
     * @returns {boolean}
     */
    has(name) {
        return this._registry.has(name) || typeof window[name] !== 'undefined';
    }

    /**
     * Remove a registered global
     * @param {string} name - The global name
     * @returns {boolean} Success status
     */
    unregister(name) {
        const entry = this._registry.get(name);
        if (entry && entry.readonly) {
            console.warn(`[Globals] Cannot unregister readonly global: ${name}`);
            return false;
        }

        this._registry.delete(name);
        delete window[name];

        if (DEBUG_MODE) {
            console.log(`[Globals] Unregistered: ${name}`);
        }

        return true;
    }

    /**
     * Get all registered globals
     * @returns {Object} Map of name -> metadata
     */
    getAll() {
        const result = {};
        this._registry.forEach((entry, name) => {
            result[name] = {
                module: entry.module,
                registeredAt: entry.registeredAt,
                readonly: entry.readonly,
                type: typeof entry.value
            };
        });
        return result;
    }

    /**
     * Get registration statistics
     * @returns {Object} Statistics about registered globals
     */
    getStats() {
        const stats = {
            total: this._registry.size,
            byModule: {},
            byType: {}
        };

        this._registry.forEach((entry, name) => {
            // Count by module
            stats.byModule[entry.module] = (stats.byModule[entry.module] || 0) + 1;

            // Count by type
            const type = typeof entry.value;
            stats.byType[type] = (stats.byType[type] || 0) + 1;
        });

        return stats;
    }

    /**
     * Enable or disable debug mode
     * @param {boolean} enabled 
     */
    setDebugMode(enabled) {
        DEBUG_MODE = enabled;
    }
}

// Singleton instance
const globals = new GlobalsRegistry();

// Freeze the API to prevent modifications
Object.freeze(globals);

export default globals;

// Named exports for convenience
export const registerGlobal = (name, value, options) => globals.register(name, value, options);
export const getGlobal = (name) => globals.get(name);
export const hasGlobal = (name) => globals.has(name);
