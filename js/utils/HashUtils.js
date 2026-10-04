/**
 * HashUtils.js
 * Provides fast hashing functions for change detection in large data objects.
 * Reduces main-thread blocking by avoiding repetitive full-object comparisons.
 */

/**
 * Generates a fast 32-bit hash from a string.
 * Uses the FNV-1a algorithm (simplified).
 * @param {string} str 
 * @returns {string} Hex representation of the hash
 */
export function generateHash(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
}

/**
 * Computes a hash for a JSON-serializable object.
 * Uses JSON.stringify to serialize first.
 * @param {any} obj 
 * @returns {string}
 */
export function computeObjectHash(obj) {
    if (obj === undefined || obj === null) return '0';
    return generateHash(JSON.stringify(obj));
}

/**
 * Determines if an object has changed by comparing its new hash with a stored hash.
 * @param {any} newObj 
 * @param {string} oldHash 
 * @returns {{changed: boolean, newHash: string}}
 */
export function hasChanged(newObj, oldHash) {
    const newHash = computeObjectHash(newObj);
    return {
        changed: newHash !== oldHash,
        newHash: newHash
    };
}
