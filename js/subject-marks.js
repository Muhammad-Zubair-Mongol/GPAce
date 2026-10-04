// subject-marks.js - Handles tracking and calculation of subject marks based on weightages
import { syncSubjectToProjectWeightages, updateAndSyncPerformance } from './weightage-connector.js';
import { getStorage } from './utils/StorageAdapter.js';


/**
 * Subject mark categories
 */
const MARK_CATEGORIES = {
    ASSIGNMENT: 'assignment',
    QUIZ: 'quiz',
    MIDTERM: 'midterm', // Now represents both Midterm and OHT
    FINAL: 'final',
    REVISION: 'revision',
    PERFORMANCE: '_performance',
    MANUAL_PERFORMANCE: '_manualPerformance'
};

const CATEGORY_ALIASES = Object.freeze({
    assignment: MARK_CATEGORIES.ASSIGNMENT,
    assignments: MARK_CATEGORIES.ASSIGNMENT,
    quiz: MARK_CATEGORIES.QUIZ,
    quizzes: MARK_CATEGORIES.QUIZ,
    midterm: MARK_CATEGORIES.MIDTERM,
    'mid term': MARK_CATEGORIES.MIDTERM,
    'mid term / oht': MARK_CATEGORIES.MIDTERM,
    oht: MARK_CATEGORIES.MIDTERM,
    final: MARK_CATEGORIES.FINAL,
    finals: MARK_CATEGORIES.FINAL,
    revision: MARK_CATEGORIES.REVISION
});

// These keys are metadata written by the performance calculator. Keep them
// stable when older records or callers use their human-readable aliases; they
// must never be used as fallbacks for a real assessment category such as quiz.
const PERFORMANCE_ALIASES = Object.freeze({
    performance: MARK_CATEGORIES.PERFORMANCE,
    '_performance': MARK_CATEGORIES.PERFORMANCE,
    'academic performance': MARK_CATEGORIES.PERFORMANCE,
    academicperformance: MARK_CATEGORIES.PERFORMANCE,
    'manual performance': MARK_CATEGORIES.MANUAL_PERFORMANCE,
    manualperformance: MARK_CATEGORIES.MANUAL_PERFORMANCE,
    '_manualperformance': MARK_CATEGORIES.MANUAL_PERFORMANCE
});

/** Normalize category spelling before any object lookup or display fallback. */
export function normalizeMarkCategory(category) {
    if (typeof category !== 'string') return '';
    const normalized = category.trim().toLowerCase().replace(/\s+/g, ' ');
    return CATEGORY_ALIASES[normalized] || PERFORMANCE_ALIASES[normalized] || normalized;
}

function parseFiniteMark(value, fieldName) {
    if (value === null || value === undefined) {
        return { ok: false, error: `${fieldName} is required` };
    }
    if (typeof value === 'string' && value.trim() === '') {
        return { ok: false, error: `${fieldName} is required` };
    }

    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) {
        return { ok: false, error: `${fieldName} must be a finite number` };
    }
    return { ok: true, value: number };
}

/**
 * Validate and normalize a mark without touching storage. Keeping this pure
 * makes UI and persistence paths agree on blank, finite, and range rules.
 */
export function validateMarkEntry(category, obtainedMarks, totalMarks, title = '') {
    const cleanCategory = normalizeMarkCategory(category);
    if (!cleanCategory) return { ok: false, field: 'category', error: 'Category is required' };

    const obtained = parseFiniteMark(obtainedMarks, 'Obtained marks');
    if (!obtained.ok) return { ...obtained, field: 'obtainedMarks' };

    const total = parseFiniteMark(totalMarks, 'Total marks');
    if (!total.ok) return { ...total, field: 'totalMarks' };
    if (total.value <= 0) {
        return { ok: false, field: 'totalMarks', error: 'Total marks must be greater than zero' };
    }
    if (obtained.value < 0) {
        return { ok: false, field: 'obtainedMarks', error: 'Obtained marks cannot be negative' };
    }
    if (obtained.value > total.value) {
        return { ok: false, field: 'obtainedMarks', error: 'Obtained marks cannot exceed total marks' };
    }

    return {
        ok: true,
        category: cleanCategory,
        obtained: obtained.value,
        total: total.value,
        title: typeof title === 'string' ? title.trim() : ''
    };
}

function cloneMarks(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    try {
        return structuredClone(value);
    } catch {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return {};
        }
    }
}

function storageWriteSucceeded(result) {
    return result !== false && !(result && typeof result === 'object' && result.success === false);
}

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
    const storage = getStorage();
    if (typeof subjectTag !== 'string' || !subjectTag.trim()) {
        console.error('Invalid mark entry parameters: subject is required');
        return false;
    }

    const validation = validateMarkEntry(category, obtainedMarks, totalMarks, title);
    if (!validation.ok) {
        console.error(`Invalid mark entry parameters: ${validation.error}`);
        return false;
    }

    const cleanCategory = validation.category;

    // Get existing marks for this subject
    const allSubjectMarks = cloneMarks(storage.get('subjectMarks', {}));

    // Initialize subject if it doesn't exist
    if (!allSubjectMarks[subjectTag]) {
        allSubjectMarks[subjectTag] = {};
    }

    // Initialize category if it doesn't exist
    if (!allSubjectMarks[subjectTag][cleanCategory]) {
        allSubjectMarks[subjectTag][cleanCategory] = [];
    }

    // Add the new mark
    allSubjectMarks[subjectTag][cleanCategory].push({
        obtained: validation.obtained,
        total: validation.total,
        title: validation.title || `${cleanCategory.charAt(0).toUpperCase() + cleanCategory.slice(1)} ${allSubjectMarks[subjectTag][cleanCategory].length + 1}`,
        date: new Date().toISOString()
    });

    // Save back to storage
    try {
        const result = storage.set('subjectMarks', allSubjectMarks);
        if (!storageWriteSucceeded(result)) {
            console.error('Unable to persist subject mark');
            return false;
        }
    } catch (error) {
        console.error('Unable to persist subject mark:', error);
        return false;
    }

    // Update weighted performance exactly once after the mark is durable.
    updateSubjectPerformance(subjectTag);

    return true;
}

/**
 * Gets all marks for a subject
 * @param {string} subjectTag - The tag of the subject
 * @returns {Object} - The marks for the subject
 */
export function getSubjectMarks(subjectTag) {
    const storage = getStorage();
    const allSubjectMarks = storage.get('subjectMarks', {});
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
    const storage = getStorage();
    const allWeightages = storage.get('subjectWeightages', {});

    // Update weightages for this subject
    allWeightages[subjectTag] = categoryWeightages;

    // Save back to storage
    storage.set('subjectWeightages', allWeightages);

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
    const storage = getStorage();
    const allWeightages = storage.get('subjectWeightages', {});

    // Return default weightages if none are set
    return allWeightages[subjectTag] || {
        assignment: 15,
        quiz: 10,
        midterm: 30,
        final: 40,
        revision: 5
    };
}

// NOTE: saveSubjectMarksToFirestore and loadSubjectMarksFromFirestore functions
// have been removed as they duplicated functionality from firestore.js.
// Use window.saveSubjectMarksToFirestore and window.loadSubjectMarksFromFirestore instead.

/**
 * Initializes weightages for all subjects at once
 * This ensures all subjects have their weightages loaded without manual interaction
 * @returns {Promise<boolean>} Success status
 */
export async function initializeAllSubjectWeightages() {
    const storage = getStorage();
    try {
        // Get all subjects
        const subjects = storage.get('academicSubjects', []);

        // Get project weightages
        const projectWeightages = storage.get('projectWeightages', {});

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
                subjectWeightages = { ...defaultWeightages };
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
                subjectWeightages = { ...defaultWeightages };
            }

            // Update weightages
            weightages[subjectTag] = subjectWeightages;
        }

        // Save to storage and Firestore
        storage.set('subjectWeightages', weightages);
        storage.set('subjectMarks', marks);
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
        storage.set('academicSubjects', subjects);
        storage.set('subjectMarks', marks);

        return true;
    } catch (error) {
        console.error('Error initializing all subject weightages:', error);
        return false;
    }
}

// The UI module is loaded separately from this data module. Expose the pure
// validator without making the persistence API depend on DOM state.
if (typeof window !== 'undefined') {
    window.normalizeMarkCategory = normalizeMarkCategory;
    window.validateMarkEntry = validateMarkEntry;
}
