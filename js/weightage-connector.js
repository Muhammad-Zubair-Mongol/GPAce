/**
 * Weightage Connector - Connects the weightage systems between extracted.html and subject-marks.html
 * This module serves as a bridge between different weightage systems in the application.
 */

/**
 * Synchronizes weightages from subject marks to the project system
 * @param {string} subjectTag - The tag of the subject
 * @param {Object} categoryWeightages - The category weightages
 */
export function syncSubjectToProjectWeightages(subjectTag, categoryWeightages) {
    try {
        // Get project weightages
        const projectWeightagesJson = localStorage.getItem('projectWeightages') || '{}';
        const projectWeightages = JSON.parse(projectWeightagesJson);
        
        // Create or update the entry for this subject
        if (!projectWeightages[subjectTag]) {
            projectWeightages[subjectTag] = {};
        }
        
        // Add a mapping for standard categories to sections in extracted.html
        const categoryToSection = {
            assignment: 'Assignment',
            quiz: 'Quizzes',
            midterm: 'Mid Term / OHT',
            final: 'Finals',
            revision: 'Revision',
            oht: 'Mid Term / OHT'  // Map OHT to the same section as midterm
        };
        
        // Update each section
        for (const category in categoryWeightages) {
            const sectionName = categoryToSection[category] || category;
            const weight = categoryWeightages[category];
            
            projectWeightages[subjectTag][sectionName] = {
                min: Math.max(0, weight - 5),  // Ensure values stay between 0-100
                max: Math.min(100, weight + 5),
                avg: weight
            };
        }
        
        // Save back to localStorage
        localStorage.setItem('projectWeightages', JSON.stringify(projectWeightages));
        
        // Dispatch an event to notify other tabs
        dispatchWeightageChangeEvent(subjectTag);
        
        return true;
    } catch (error) {
        console.error('Error syncing with project weightages:', error);
        return false;
    }
}

/**
 * Synchronizes weightages from project system to subject marks
 * @param {string} projectId - The project ID (subject tag)
 * @param {Object} sectionWeightages - The section weightages
 */
export function syncProjectToSubjectWeightages(projectId, sectionWeightages) {
    try {
        // Get subject weightages
        const weightagesJson = localStorage.getItem('subjectWeightages') || '{}';
        const allWeightages = JSON.parse(weightagesJson);
        
        // Create or update entry for this subject
        if (!allWeightages[projectId]) {
            allWeightages[projectId] = {};
        }
        
        // Add a mapping for sections to standard categories
        const sectionToCategory = {
            'Assignment': 'assignment',
            'Quizzes': 'quiz',
            'Mid Term / OHT': 'midterm',  // Default to midterm for combined category
            'Finals': 'final',
            'Revision': 'revision'
        };
        
        // Update each category
        for (const section in sectionWeightages) {
            const category = sectionToCategory[section] || section.toLowerCase();
            const weightData = sectionWeightages[section];
            
            // Use the average value
            if (weightData && typeof weightData.avg === 'number') {
                allWeightages[projectId][category] = weightData.avg;
            }
        }
        
        // Save back to localStorage
        localStorage.setItem('subjectWeightages', JSON.stringify(allWeightages));
        
        // Dispatch an event to notify other tabs
        dispatchWeightageChangeEvent(projectId);
        
        return true;
    } catch (error) {
        console.error('Error syncing with subject weightages:', error);
        return false;
    }
}

/**
 * Updates the academic performance based on marks and also syncs with project system
 * @param {string} subjectTag - The tag of the subject
 * @param {number} performanceValue - The performance value (optional)
 * @returns {number} - The calculated performance
 */
export function updateAndSyncPerformance(subjectTag, performanceValue = null) {
    try {
        // Get subject data
        const subjectsJson = localStorage.getItem('academicSubjects') || '[]';
        const subjects = JSON.parse(subjectsJson);
        const subject = subjects.find(s => s.tag === subjectTag);
        
        if (!subject) {
            console.error(`Subject with tag ${subjectTag} not found`);
            return 0;
        }
        
        // If performance value is provided, use it directly
        if (performanceValue !== null) {
            // Ensure value is between 0-100
            const boundedValue = Math.min(100, Math.max(0, performanceValue));
            subject.academicPerformance = boundedValue;
            
            // Save updated subject data
            localStorage.setItem('academicSubjects', JSON.stringify(subjects));
            
            // Sync with project weightages
            syncPerformanceToProject(subjectTag, boundedValue);
            
            return boundedValue;
        }
        
        // Otherwise calculate based on marks
        // Get subject marks
        const marksJson = localStorage.getItem('subjectMarks') || '{}';
        const allMarks = JSON.parse(marksJson);
        const marks = allMarks[subjectTag] || {};
        
        // Get weightages
        const weightagesJson = localStorage.getItem('subjectWeightages') || '{}';
        const allWeightages = JSON.parse(weightagesJson);
        const weightages = allWeightages[subjectTag] || {
            assignment: 15,
            quiz: 10,
            midterm: 30,
            final: 40,
            revision: 5
        };
        
        // Calculate performance
        let totalPerformance = 0;
        
        // Calculate performance for each category
        for (const category in weightages) {
            const categoryWeight = weightages[category];
            let categoryPerformance = 0;
            
            if (marks[category] && marks[category].length > 0) {
                let totalObtained = 0;
                let totalPossible = 0;
                
                marks[category].forEach(mark => {
                    totalObtained += mark.obtained;
                    totalPossible += mark.total;
                });
                
                categoryPerformance = (totalObtained / totalPossible) * 100;
            }
            
            // Add weighted category performance to total
            totalPerformance += (categoryPerformance * categoryWeight) / 100;
        }
        
        // Round the final performance
        let calculatedPerformance = Math.round(totalPerformance);
        calculatedPerformance = Math.min(100, Math.max(0, calculatedPerformance));
        
        // Update subject data
        subject.academicPerformance = calculatedPerformance;
        localStorage.setItem('academicSubjects', JSON.stringify(subjects));
        
        // Store the performance in the marks data structure
        if (!allMarks[subjectTag]) {
            allMarks[subjectTag] = {};
        }
        allMarks[subjectTag]._performance = calculatedPerformance;
        localStorage.setItem('subjectMarks', JSON.stringify(allMarks));
        
        // Sync with project weightages
        syncPerformanceToProject(subjectTag, calculatedPerformance);
        
        return calculatedPerformance;
    } catch (error) {
        console.error('Error updating and syncing performance:', error);
        return null;
    }
}

/**
 * Syncs performance to the project weightages system
 * @param {string} subjectTag - The tag of the subject
 * @param {number} performance - The performance value
 */
function syncPerformanceToProject(subjectTag, performance) {
    try {
        const projectWeightagesJson = localStorage.getItem('projectWeightages') || '{}';
        const projectWeightages = JSON.parse(projectWeightagesJson);
        
        if (!projectWeightages[subjectTag]) {
            projectWeightages[subjectTag] = {};
        }
        
        projectWeightages[subjectTag]._academicPerformance = performance;
        localStorage.setItem('projectWeightages', JSON.stringify(projectWeightages));
        
        // Dispatch an event to notify other tabs
        dispatchWeightageChangeEvent(subjectTag);
    } catch (error) {
        console.error('Error syncing performance to project:', error);
    }
}

/**
 * Dispatches a custom event for cross-tab synchronization
 * @param {string} subjectTag - The tag of the subject that was updated
 */
function dispatchWeightageChangeEvent(subjectTag) {
    try {
        // Create and dispatch a custom event
        const event = new CustomEvent('weightage-change', {
            detail: { subjectTag }
        });
        window.dispatchEvent(event);
        
        // Also try to use the cross-tab sync if available
        if (window.crossTabSync && typeof window.crossTabSync.broadcastUserAction === 'function') {
            window.crossTabSync.broadcastUserAction('weightage-update', { subjectTag });
        }
    } catch (error) {
        console.error('Error dispatching weightage change event:', error);
    }
}

// Add event listener for storage changes
window.addEventListener('storage', function(e) {
    // React to changes in storage from other tabs
    if (e.key === 'subjectWeightages' || e.key === 'projectWeightages' || e.key === 'subjectMarks') {
        // Dispatch event to notify components
        const event = new CustomEvent('weightage-storage-change', {
            detail: { key: e.key, newValue: e.newValue }
        });
        window.dispatchEvent(event);
    }
}); 