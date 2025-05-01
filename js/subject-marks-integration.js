// subject-marks-integration.js - Makes subject marks functions available globally

import {
    addSubjectMark,
    getSubjectMarks,
    updateSubjectPerformance,
    setSubjectWeightages,
    getSubjectWeightages,
    initializeAllSubjectWeightages
} from './subject-marks.js';

/**
 * Initializes the subject marks module by making functions available globally
 */
export function initializeSubjectMarksModule() {
    // Make subject marks functions available globally
    window.addSubjectMark = addSubjectMark;
    window.getSubjectMarks = getSubjectMarks;
    window.updateSubjectPerformance = updateSubjectPerformance;
    window.setSubjectWeightages = setSubjectWeightages;
    window.getSubjectWeightages = getSubjectWeightages;
    window.initializeAllSubjectWeightages = initializeAllSubjectWeightages;
}

// Initialize when the script is loaded
initializeSubjectMarksModule();

// Create a promise that resolves when subject marks module is initialized
window.subjectMarksInitialized = Promise.resolve(true);

// Also initialize on DOMContentLoaded for safety
document.addEventListener('DOMContentLoaded', () => {
    // If not already initialized, initialize subject marks module
    if (!window.addSubjectMark) {
        initializeSubjectMarksModule();
    }
});
