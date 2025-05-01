// subject-marks.js - Handles tracking and calculation of subject marks based on weightages
import { syncSubjectToProjectWeightages, updateAndSyncPerformance } from './weightage-connector.js';

/**
 * Subject mark categories
 */
const MARK_CATEGORIES = {
    ASSIGNMENT: 'assignment',
    QUIZ: 'quiz',
    MIDTERM: 'midterm', // Now represents both Midterm and OHT
    FINAL: 'final',
    REVISION: 'revision'
};

/**
 * Saves a new mark entry for a subject
 * @param {string} subjectTag - The tag of the subject
 * @param {string} category - The category of the mark (assignment, quiz, etc.)
 * @param {number} obtainedMarks - The marks obtained by the student
 * @param {number} totalMarks - The total marks possible
 * @param {string} title - Optional title for the entry (e.g., "Quiz 1")
 * @returns {boolean} - Success status
 */
export function addSubjectMark(subjectTag, category, obtainedMarks, totalMarks, title = '') {
    if (!subjectTag || !category || isNaN(obtainedMarks) || isNaN(totalMarks) || totalMarks <= 0) {
        console.error('Invalid mark entry parameters');
        return false;
    }

    // Validate category
    if (!Object.values(MARK_CATEGORIES).includes(category.toLowerCase())) {
        console.error('Invalid mark category');
        return false;
    }

    // Get existing marks for this subject
    const subjectMarksJson = localStorage.getItem('subjectMarks') || '{}';
    const allSubjectMarks = JSON.parse(subjectMarksJson);
    
    // Initialize subject if it doesn't exist
    if (!allSubjectMarks[subjectTag]) {
        allSubjectMarks[subjectTag] = {};
    }
    
    // Initialize category if it doesn't exist
    if (!allSubjectMarks[subjectTag][category]) {
        allSubjectMarks[subjectTag][category] = [];
    }
    
    // Add the new mark
    allSubjectMarks[subjectTag][category].push({
        obtained: Number(obtainedMarks),
        total: Number(totalMarks),
        title: title || `${category.charAt(0).toUpperCase() + category.slice(1)} ${allSubjectMarks[subjectTag][category].length + 1}`,
        date: new Date().toISOString()
    });
    
    // Save back to localStorage
    localStorage.setItem('subjectMarks', JSON.stringify(allSubjectMarks));
    
    // Update the academic performance for the subject
    updateSubjectPerformance(subjectTag);
    
    return true;
}

/**
 * Gets all marks for a subject
 * @param {string} subjectTag - The tag of the subject
 * @returns {Object} - The marks for the subject
 */
export function getSubjectMarks(subjectTag) {
    const subjectMarksJson = localStorage.getItem('subjectMarks') || '{}';
    const allSubjectMarks = JSON.parse(subjectMarksJson);
    return allSubjectMarks[subjectTag] || {};
}

/**
 * Calculates the weighted performance for a subject
 * @param {string} subjectTag - The tag of the subject
 * @returns {number} - The updated academic performance value (0-100)
 */
export function updateSubjectPerformance(subjectTag) {
    // Use the unified update and sync function
    return updateAndSyncPerformance(subjectTag);
}

/**
 * Sets the weightages for a specific subject
 * @param {string} subjectTag - The tag of the subject
 * @param {Object} categoryWeightages - Object containing weightages for each category
 * @returns {boolean} - Success status
 */
export function setSubjectWeightages(subjectTag, categoryWeightages) {
    if (!subjectTag) {
        console.error('Subject tag is required');
        return false;
    }
    
    // Validate weightages - they should sum to 100
    let totalWeight = 0;
    for (const category in categoryWeightages) {
        totalWeight += categoryWeightages[category];
    }
    
    if (Math.abs(totalWeight - 100) > 0.1) {
        console.error('Weightages must sum to 100%');
        return false;
    }
    
    // Get existing weightages
    const weightagesJson = localStorage.getItem('subjectWeightages') || '{}';
    const allWeightages = JSON.parse(weightagesJson);
    
    // Update weightages for this subject
    allWeightages[subjectTag] = categoryWeightages;
    
    // Save back to localStorage
    localStorage.setItem('subjectWeightages', JSON.stringify(allWeightages));
    
    // Sync with project weightages system
    syncSubjectToProjectWeightages(subjectTag, categoryWeightages);
    
    // Update the subject's performance with new weightages
    updateSubjectPerformance(subjectTag);
    
    return true;
}

/**
 * Gets the weightages for a specific subject
 * @param {string} subjectTag - The tag of the subject
 * @returns {Object} - The weightages for the subject
 */
export function getSubjectWeightages(subjectTag) {
    const weightagesJson = localStorage.getItem('subjectWeightages') || '{}';
    const allWeightages = JSON.parse(weightagesJson);
    
    // Return default weightages if none are set
    return allWeightages[subjectTag] || {
        assignment: 15,
        quiz: 10,
        midterm: 30,
        final: 40,
        revision: 5
    };
}

/**
 * Saves subject marks to Firestore
 * @param {Object} auth - Firebase auth instance
 * @param {Object} db - Firestore database instance
 * @returns {Promise<boolean>} - Success status
 */
export async function saveSubjectMarksToFirestore(auth, db) {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.error('No user is signed in');
            return false;
        }
        
        const subjectMarksJson = localStorage.getItem('subjectMarks') || '{}';
        const marksData = JSON.parse(subjectMarksJson);
        
        const weightagesJson = localStorage.getItem('subjectWeightages') || '{}';
        const weightagesData = JSON.parse(weightagesJson);
        
        // Save data to Firestore using imported functions (need to define these in firestore.js)
        const { doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        
        // Save marks
        const marksRef = doc(db, 'users', user.uid, 'academic', 'marks');
        await setDoc(marksRef, { marks: marksData });
        
        // Save weightages
        const weightagesRef = doc(db, 'users', user.uid, 'academic', 'weightages');
        await setDoc(weightagesRef, { subjectWeightages: weightagesData });
        
        console.log('Subject marks and weightages saved to Firestore');
        return true;
    } catch (error) {
        console.error('Error saving subject marks to Firestore:', error);
        return false;
    }
}

/**
 * Loads subject marks from Firestore
 * @param {Object} auth - Firebase auth instance
 * @param {Object} db - Firestore database instance
 * @returns {Promise<Object>} - The loaded marks
 */
export async function loadSubjectMarksFromFirestore(auth, db) {
    try {
        const user = auth.currentUser;
        if (!user) {
            console.error('No user is signed in');
            return null;
        }
        
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        
        // Load marks
        const marksRef = doc(db, 'users', user.uid, 'academic', 'marks');
        const marksSnap = await getDoc(marksRef);
        
        if (marksSnap.exists()) {
            const marksData = marksSnap.data().marks;
            localStorage.setItem('subjectMarks', JSON.stringify(marksData));
            
            // Load weightages
            const weightagesRef = doc(db, 'users', user.uid, 'academic', 'weightages');
            const weightagesSnap = await getDoc(weightagesRef);
            
            if (weightagesSnap.exists()) {
                const weightagesData = weightagesSnap.data().subjectWeightages;
                localStorage.setItem('subjectWeightages', JSON.stringify(weightagesData));
            }
            
            // Update performance for all subjects
            const subjectsJson = localStorage.getItem('academicSubjects') || '[]';
            const subjects = JSON.parse(subjectsJson);
            
            for (const subject of subjects) {
                updateSubjectPerformance(subject.tag);
            }
            
            return marksData;
        }
        
        return {};
    } catch (error) {
        console.error('Error loading subject marks from Firestore:', error);
        return {};
    }
}

/**
 * Initializes weightages for all subjects at once
 * This ensures all subjects have their weightages loaded without manual interaction
 * @returns {Promise<boolean>} Success status
 */
export async function initializeAllSubjectWeightages() {
    try {
        // Get all subjects
        const subjectsJson = localStorage.getItem('academicSubjects') || '[]';
        const subjects = JSON.parse(subjectsJson);

        // Get project weightages
        const projectWeightagesJson = localStorage.getItem('projectWeightages') || '{}';
        const projectWeightages = JSON.parse(projectWeightagesJson);

        // Try to load from Firestore
        const allWeightages = await window.loadSubjectWeightagesFromFirestore();
        let weightages = allWeightages || {};

        // Load subject marks to ensure we have performance data
        const marksData = await window.loadSubjectMarksFromFirestore();
        const marks = marksData || {};

        // Default weightages
        const defaultWeightages = {
            assignment: 15,
            quiz: 10,
            midterm: 30,
            final: 40,
            revision: 5
        };

        // Process each subject
        for (const subject of subjects) {
            const subjectTag = subject.tag;

            // Initialize marks structure if it doesn't exist
            if (!marks[subjectTag]) {
                marks[subjectTag] = {};
            }

            // Skip if weightages already exist
            if (weightages[subjectTag] && Object.keys(weightages[subjectTag]).length > 0) {
                // Even if weightages exist, ensure performance is calculated
                await updateSubjectPerformance(subjectTag);
                continue;
            }

            // Check for project weightages first
            let subjectWeightages;
            if (projectWeightages[subjectTag]) {
                // Map project sections to subject categories
                const sectionToCategory = {
                    'Assignment': 'assignment',
                    'Quizzes': 'quiz',
                    'Mid Term / OHT': 'midterm',
                    'Finals': 'final',
                    'Revision': 'revision'
                };

                // Create weightages from project data
                subjectWeightages = {...defaultWeightages};
                for (const section in projectWeightages[subjectTag]) {
                    const category = sectionToCategory[section] || section.toLowerCase();
                    if (category in defaultWeightages) {
                        const weightData = projectWeightages[subjectTag][section];
                        if (weightData && typeof weightData.avg === 'number') {
                            subjectWeightages[category] = weightData.avg;
                        }
                    }
                }
            } else {
                // Use defaults
                subjectWeightages = {...defaultWeightages};
            }

            // Update weightages
            weightages[subjectTag] = subjectWeightages;
        }

        // Save to localStorage and Firestore
        localStorage.setItem('subjectWeightages', JSON.stringify(weightages));
        localStorage.setItem('subjectMarks', JSON.stringify(marks));
        await window.saveSubjectWeightagesToFirestore(weightages);
        await window.saveSubjectMarksToFirestore(marks);

        // Update performance for all subjects
        for (const subject of subjects) {
            // Force performance calculation and sync
            const performance = await updateSubjectPerformance(subject.tag);
            
            // Ensure the performance is stored in marks data
            if (!marks[subject.tag]) {
                marks[subject.tag] = {};
            }
            marks[subject.tag]._manualPerformance = performance;
            
            // Update subject's academicPerformance
            subject.academicPerformance = performance;
        }

        // Save updated subjects and marks
        localStorage.setItem('academicSubjects', JSON.stringify(subjects));
        localStorage.setItem('subjectMarks', JSON.stringify(marks));

        return true;
    } catch (error) {
        console.error('Error initializing all subject weightages:', error);
        return false;
    }
} 