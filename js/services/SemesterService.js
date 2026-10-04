/**
 * SemesterService - Centralized semester state management
 * 
 * Single source of truth for semester-related state and operations.
 * Eliminates duplicate currentSemester declarations across files.
 * 
 * @module SemesterService
 */

import { getStorage, STORAGE_KEYS } from '../utils/StorageAdapter.js';

/**
 * Private state - not accessible directly from outside
 */
let _currentSemester = 'default';
let _initialized = false;

/**
 * Event listeners for state changes
 */
const _listeners = new Set();

/**
 * SemesterService API
 */
export const SemesterService = {
    /**
     * Initialize the service, loading state from storage
     * @returns {Promise<void>}
     */
    async initialize() {
        if (_initialized) return;

        const storage = getStorage();
        _currentSemester = storage.get(STORAGE_KEYS.CURRENT_SEMESTER, 'default');
        _initialized = true;

        console.log('[SemesterService] Initialized with semester:', _currentSemester);

        // Check for migration
        await this.checkMigration();
    },

    /**
     * Get the current semester
     * @returns {string} Current semester ID
     */
    getCurrentSemester() {
        return _currentSemester;
    },

    /**
     * Set the current semester
     * @param {string} semesterId - Semester ID to set as current
     * @param {boolean} persist - Whether to persist to storage (default: true)
     */
    setCurrentSemester(semesterId, persist = true) {
        const previousSemester = _currentSemester;
        _currentSemester = semesterId;

        if (persist) {
            const storage = getStorage();
            storage.set(STORAGE_KEYS.CURRENT_SEMESTER, semesterId);
        }

        // Notify listeners
        this._notifyListeners({
            type: 'semester-change',
            previousSemester,
            currentSemester: semesterId
        });

        console.log('[SemesterService] Semester changed:', previousSemester, '->', semesterId);
    },

    /**
     * Get all semesters
     * @returns {Object} All semesters object
     */
    getAllSemesters() {
        const storage = getStorage();
        return storage.get(STORAGE_KEYS.SEMESTERS, {});
    },

    /**
     * Get a specific semester by ID
     * @param {string} semesterId - Semester ID
     * @returns {Object|null} Semester data or null
     */
    getSemester(semesterId) {
        const semesters = this.getAllSemesters();
        return semesters[semesterId] || null;
    },

    /**
     * Get current semester data
     * @returns {Object|null} Current semester data
     */
    getCurrentSemesterData() {
        return this.getSemester(_currentSemester);
    },

    /**
     * Create a new semester
     * @param {Object} semesterData - Semester data
     * @returns {string} Created semester ID
     */
    createSemester(semesterData) {
        const storage = getStorage();
        const semesters = this.getAllSemesters();

        // Generate unique ID
        const semesterId = semesterData.id || this._generateSemesterId(semesterData.name);

        // Ensure no duplicate
        if (semesters[semesterId]) {
            throw new Error(`Semester with ID "${semesterId}" already exists`);
        }

        // Create semester entry
        semesters[semesterId] = {
            id: semesterId,
            name: semesterData.name,
            description: semesterData.description || '',
            isPriority: semesterData.isPriority || false,
            color: semesterData.color || '',
            archived: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            subjects: semesterData.subjects || []
        };

        storage.set(STORAGE_KEYS.SEMESTERS, semesters);

        this._notifyListeners({
            type: 'semester-created',
            semesterId,
            semester: semesters[semesterId]
        });

        console.log('[SemesterService] Created semester:', semesterId);
        return semesterId;
    },

    /**
     * Update a semester
     * @param {string} semesterId - Semester ID
     * @param {Object} updates - Updates to apply
     * @returns {boolean} Success status
     */
    updateSemester(semesterId, updates) {
        const storage = getStorage();
        const semesters = this.getAllSemesters();

        if (!semesters[semesterId]) {
            console.error('[SemesterService] Semester not found:', semesterId);
            return false;
        }

        // Apply updates
        semesters[semesterId] = {
            ...semesters[semesterId],
            ...updates,
            updatedAt: new Date().toISOString()
        };

        // Handle ID change (rename)
        if (updates.id && updates.id !== semesterId) {
            semesters[updates.id] = semesters[semesterId];
            semesters[updates.id].id = updates.id;
            delete semesters[semesterId];

            // Update current semester reference if needed
            if (_currentSemester === semesterId) {
                _currentSemester = updates.id;
                storage.set(STORAGE_KEYS.CURRENT_SEMESTER, updates.id);
            }
        }

        storage.set(STORAGE_KEYS.SEMESTERS, semesters);

        this._notifyListeners({
            type: 'semester-updated',
            semesterId: updates.id || semesterId,
            updates
        });

        return true;
    },

    /**
     * Delete a semester
     * @param {string} semesterId - Semester ID to delete
     * @returns {boolean} Success status
     */
    deleteSemester(semesterId) {
        if (semesterId === 'default') {
            console.error('[SemesterService] Cannot delete default semester');
            return false;
        }

        const storage = getStorage();
        const semesters = this.getAllSemesters();

        if (!semesters[semesterId]) {
            console.error('[SemesterService] Semester not found:', semesterId);
            return false;
        }

        delete semesters[semesterId];
        storage.set(STORAGE_KEYS.SEMESTERS, semesters);

        // Switch to default if deleted current
        if (_currentSemester === semesterId) {
            this.setCurrentSemester('default');
        }

        this._notifyListeners({
            type: 'semester-deleted',
            semesterId
        });

        console.log('[SemesterService] Deleted semester:', semesterId);
        return true;
    },

    /**
     * Archive a semester
     * @param {string} semesterId - Semester ID to archive
     * @returns {boolean} Success status
     */
    archiveSemester(semesterId) {
        return this.updateSemester(semesterId, { archived: true });
    },

    /**
     * Unarchive a semester
     * @param {string} semesterId - Semester ID to unarchive
     * @returns {boolean} Success status
     */
    unarchiveSemester(semesterId) {
        return this.updateSemester(semesterId, { archived: false });
    },

    /**
     * Get subjects for current semester
     * @returns {Array} Subjects array
     */
    getCurrentSubjects() {
        const semester = this.getCurrentSemesterData();
        return semester?.subjects || [];
    },

    /**
     * Set subjects for current semester
     * @param {Array} subjects - Subjects array
     * @returns {boolean} Success status
     */
    setCurrentSubjects(subjects) {
        return this.updateSemester(_currentSemester, { subjects });
    },

    /**
     * Subscribe to semester state changes
     * @param {Function} callback - Callback function
     * @returns {Function} Unsubscribe function
     */
    subscribe(callback) {
        _listeners.add(callback);
        return () => _listeners.delete(callback);
    },

    /**
     * Check and perform migration from legacy storage
     */
    async checkMigration() {
        const storage = getStorage();
        const migrationDone = storage.get(STORAGE_KEYS.SEMESTER_MIGRATION_DONE, false);

        if (migrationDone) return;

        console.log('[SemesterService] Checking for legacy data migration...');

        // Check for legacy subjects
        const legacySubjects = storage.get(STORAGE_KEYS.LEGACY_SUBJECTS, []);
        if (legacySubjects.length > 0) {
            console.log('[SemesterService] Migrating', legacySubjects.length, 'legacy subjects');

            // Ensure default semester exists
            const semesters = this.getAllSemesters();
            if (!semesters['default']) {
                semesters['default'] = {
                    id: 'default',
                    name: 'Default',
                    description: 'Migrated from legacy storage',
                    isPriority: true,
                    color: '',
                    archived: false,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    subjects: legacySubjects
                };
                storage.set(STORAGE_KEYS.SEMESTERS, semesters);
            }
        }

        storage.set(STORAGE_KEYS.SEMESTER_MIGRATION_DONE, true);
        console.log('[SemesterService] Migration complete');
    },

    /**
     * Log debug info
     */
    logDebugInfo() {
        console.group('SemesterService Debug Info');
        console.log('Initialized:', _initialized);
        console.log('Current Semester:', _currentSemester);
        console.log('All Semesters:', Object.keys(this.getAllSemesters()));
        console.log('Current Semester Data:', this.getCurrentSemesterData());
        console.log('Listeners Count:', _listeners.size);
        console.groupEnd();
    },

    /**
     * Generate a semester ID from name
     * @private
     */
    _generateSemesterId(name) {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') ||
            `semester-${Date.now()}`;
    },

    /**
     * Notify all listeners of state change
     * @private
     */
    _notifyListeners(event) {
        _listeners.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                console.error('[SemesterService] Listener error:', error);
            }
        });
    }
};

// Auto-initialize on module load
if (typeof window !== 'undefined') {
    // Expose globally
    window.SemesterService = SemesterService;

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => SemesterService.initialize());
    } else {
        SemesterService.initialize();
    }
}

export default SemesterService;
