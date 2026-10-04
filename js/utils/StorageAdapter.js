/**
 * StorageAdapter - Centralized storage access utility
 * 
 * Provides a unified interface for storage operations with verified UID-derived tenancy,
 * typed error outcomes, and user-isolated key-spacing.
 * 
 * Part of Step 40: Storage Layer Abstraction & Boundary Enforcement.
 * 
 * @module StorageAdapter
 */

import storageService, { StorageService, StorageOutcome } from '../services/StorageService.js';

/**
 * Gets the centralized storage service instance with user tenancy and typed error outcomes.
 * @returns {StorageService} Storage service instance
 */
export function getStorage() {
    if (typeof window !== 'undefined' && window.StorageService) {
        return window.StorageService;
    }
    return storageService;
}

/**
 * Singleton instance for convenience
 */
export const storage = getStorage();

/**
 * Storage keys used across the application
 * Centralized to prevent typos and enable easy refactoring
 */
export const STORAGE_KEYS = {
    // Theme
    THEME: 'theme',

    // Semester System
    CURRENT_SEMESTER: 'currentAcademicSemester',
    SEMESTERS: 'academicSemesters',
    SEMESTER_MIGRATION_DONE: 'semesterMigrationDone',

    // Legacy
    LEGACY_SUBJECTS: 'academicSubjects',

    // Alarms
    ALARMS: 'alarms',

    // User preferences
    USER_PREFERENCES: 'userPreferences',

    // Tasks & Workspace
    TASKS: 'tasks',
    CALCULATED_PRIORITY_TASKS: 'calculatedPriorityTasks',
    WORKSPACE_CONTENT: 'workspaceContent'
};

// Re-export core classes for consumers
export { StorageOutcome, StorageService, storageService };

// Make storage available globally for non-module scripts in browser
if (typeof window !== 'undefined') {
    window.StorageAdapter = {
        getStorage,
        storage,
        STORAGE_KEYS,
        StorageOutcome,
        StorageService,
        storageService
    };
}
