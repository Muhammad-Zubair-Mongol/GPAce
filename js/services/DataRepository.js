/**
 * DataRepository.js
 * Central Single Source of Truth for Application State
 * Implements Repository Pattern and Command Pattern support
 */

import { auth, saveTasksToFirestore, loadSubjectsFromFirestore, saveSubjectsToFirestore } from '../firestore.js';

class DataRepository {
    constructor() {
        if (DataRepository.instance) {
            return DataRepository.instance;
        }
        DataRepository.instance = this;

        this._subjectCache = null;
        this._taskCache = new Map(); // projectId -> tasks[]
    }

    /**
     * Get all subjects, fetching from server if cache is empty
     * Fixes the "Missing subjects" issue by ensuring a fetch happens.
     * Returns cached data immediately for performance, fetches fresh data in background.
     */
    async getSubjects(forceRefresh = false) {
        // Return cache immediately if available
        if (this._subjectCache && !forceRefresh) {
            return this._subjectCache;
        }

        // Try local storage first for instant loading
        const local = JSON.parse(localStorage.getItem('academicSubjects') || '[]');
        if (local.length > 0 && !forceRefresh) {
            this._subjectCache = local;

            // Fetch fresh data in background (don't await)
            this._refreshSubjectsInBackground();

            return local;
        }

        // If no local data, fetch from server (blocking)
        try {
            const subjects = await loadSubjectsFromFirestore('current');

            if (subjects && subjects.length > 0) {
                this._subjectCache = subjects;
                localStorage.setItem('academicSubjects', JSON.stringify(subjects));
                return subjects;
            }

            return local; // Fallback
        } catch (error) {
            console.error('[DataRepo] Error fetching subjects:', error);
            return local;
        }
    }

    /**
     * Background refresh helper
     */
    _refreshSubjectsInBackground() {
        loadSubjectsFromFirestore('current').then(subjects => {
            if (subjects && subjects.length > 0) {
                this._subjectCache = subjects;
                localStorage.setItem('academicSubjects', JSON.stringify(subjects));
                console.log('[DataRepo] Subjects refreshed in background');
            }
        }).catch(err => {
            console.debug('[DataRepo] Background refresh failed:', err);
        });
    }

    /**
     * Get tasks for a project
     */
    async getTasks(projectId) {
        // Implementation for centralized task fetching
        // For now, relies on the hybrid firestore/local approach in firestore.js
        // Ideally, we move that logic here eventually.
        return JSON.parse(localStorage.getItem(`tasks-${projectId}`) || '[]');
    }

    /**
     * Save tasks for a project
     */
    async saveTasks(projectId, tasks) {
        // Delegate to firestore (which now handles OCC)
        return await saveTasksToFirestore(projectId, tasks);
    }

    /**
     * Save subjects
     */
    async saveSubjects(subjects, semester = 'current') {
        return await saveSubjectsToFirestore(subjects, semester);
    }

    /**
     * Undo functionality placeholder
     */
    async executeCommand(command) {
        // Future Command Pattern implementation
        // command.execute();
        // this.undoStack.push(command);
    }
}

const dataRepository = new DataRepository();
export default dataRepository;

// Expose global for legacy support
window.DataRepository = dataRepository;
