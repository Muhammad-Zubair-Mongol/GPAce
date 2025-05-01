/**
 * Main Application Script for Academic Details
 * Initializes Firebase and sets up event listeners
 */

import { initializeFirebase, setupFirebaseAuth } from './firebase-config.js';

// Initialize the application
async function initializeApp() {
    try {
        // Initialize Firebase
        await initializeFirebase();

        // Setup Firebase auth functions
        await setupFirebaseAuth();

        // Initialize theme
        if (localStorage.getItem('theme') === 'light') {
            document.body.classList.add('light-theme');
            const themeIcon = document.querySelector('.theme-icon');
            if (themeIcon) themeIcon.textContent = '🌚';
        }

        // Log version information
        console.log('GPAce Academic Details - Semester System v1.0');

        // Debug logging for initial state
        logSemesterDebugInfo();

        console.log('Academic Details application initialized');
    } catch (error) {
        console.error('Error initializing application:', error);
    }
}

/**
 * Debug function to log semester system information
 */
function logSemesterDebugInfo() {
    try {
        console.group('Semester System Debug Info');
        console.log('Current Semester:', localStorage.getItem('currentAcademicSemester') || 'Not set');
        console.log('Migration Done:', localStorage.getItem('semesterMigrationDone') || 'Not done');

        const allSemesters = JSON.parse(localStorage.getItem('academicSemesters') || '{}');
        console.log('Available Semesters:', Object.keys(allSemesters));

        if (Object.keys(allSemesters).length > 0) {
            console.log('Semester Data Sample:', allSemesters[Object.keys(allSemesters)[0]]);
        }

        const legacySubjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');
        console.log('Legacy Subjects Count:', legacySubjects.length);

        console.groupEnd();
    } catch (error) {
        console.error('Error in debug logging:', error);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);
