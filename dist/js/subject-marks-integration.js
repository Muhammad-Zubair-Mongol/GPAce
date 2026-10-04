/**
 * subject-marks-integration.js
 * Bridge module that makes subject marks functions available globally.
 * 
 * This provides backward compatibility for non-module scripts while
 * the codebase transitions to full ES modules.
 */

import {
    addSubjectMark,
    getSubjectMarks,
    updateSubjectPerformance,
    setSubjectWeightages,
    getSubjectWeightages,
    initializeAllSubjectWeightages
} from './subject-marks.js';

// Use namespaced global to avoid polluting window with multiple properties
const SubjectMarksAPI = {
    addMark: addSubjectMark,
    getMarks: getSubjectMarks,
    updatePerformance: updateSubjectPerformance,
    setWeightages: setSubjectWeightages,
    getWeightages: getSubjectWeightages,
    initializeAll: initializeAllSubjectWeightages
};

// Expose namespace globally
window.SubjectMarksAPI = SubjectMarksAPI;

// Also expose individual functions for backward compatibility
// (will be deprecated in future versions)
window.addSubjectMark = addSubjectMark;
window.getSubjectMarks = getSubjectMarks;
window.updateSubjectPerformance = updateSubjectPerformance;
window.setSubjectWeightages = setSubjectWeightages;
window.getSubjectWeightages = getSubjectWeightages;
window.initializeAllSubjectWeightages = initializeAllSubjectWeightages;

// Signal that module is ready
window.subjectMarksInitialized = Promise.resolve(true);

// Export for ES module usage
export {
    SubjectMarksAPI,
    addSubjectMark,
    getSubjectMarks,
    updateSubjectPerformance,
    setSubjectWeightages,
    getSubjectWeightages,
    initializeAllSubjectWeightages
};
