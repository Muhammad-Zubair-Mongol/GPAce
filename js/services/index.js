/**
 * Services Index
 * Re-exports all service modules for convenient importing.
 * 
 * Usage:
 *   import { StorageService, SecureStorage } from './services/index.js';
 *   
 *   // Or import specific service
 *   import StorageService from './services/StorageService.js';
 */

export { default as StorageService, storageService } from './StorageService.js';
export { default as SecureStorage, secureStorage } from './SecureStorage.js';

// Convenience object for all services
const Services = {
    get storage() { return window.StorageService; },
    get secure() { return window.SecureStorage; }
};

export default Services;
