/**
 * Storage Manager
 * Handles local storage operations with improved error handling
 * Fixes the 404 error for storageManager.js
 */

class StorageManager {
  constructor(namespace = 'gpace') {
    this.namespace = namespace;
    console.log(`StorageManager initialized for namespace: ${namespace}`);
  }
  
  setItem(key, value) {
    try {
      const fullKey = `${this.namespace}_${key}`;
      const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
      localStorage.setItem(fullKey, serialized);
      return true;
    } catch (error) {
      console.error('StorageManager: Error saving to localStorage', error);
      return false;
    }
  }
  
  getItem(key, defaultValue = null) {
    try {
      const fullKey = `${this.namespace}_${key}`;
      const value = localStorage.getItem(fullKey);
      
      if (value === null) return defaultValue;
      
      // Try to parse as JSON, return as is if it fails
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      console.error('StorageManager: Error reading from localStorage', error);
      return defaultValue;
    }
  }
  
  removeItem(key) {
    try {
      const fullKey = `${this.namespace}_${key}`;
      localStorage.removeItem(fullKey);
      return true;
    } catch (error) {
      console.error('StorageManager: Error removing from localStorage', error);
      return false;
    }
  }
  
  clear() {
    try {
      // Only clear keys with our namespace
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(`${this.namespace}_`)) {
          localStorage.removeItem(key);
        }
      });
      return true;
    } catch (error) {
      console.error('StorageManager: Error clearing localStorage', error);
      return false;
    }
  }
}

// Export a singleton instance
const storageManager = new StorageManager();
export default storageManager;