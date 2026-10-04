/**
 * Subject Management Module
 * Handles subject creation, display, and management functionality
 * 
 * Refactored to use centralized utilities:
 * - StorageAdapter for storage operations
 * - SemesterService for semester state management
 * 
 * NOTE: Initialization is handled by academic-details.js (the main entry point)
 */

console.log('[SubjectManagement] Module loaded');

import { saveSubjectsToFirestore, loadSubjectsFromFirestore } from './firestore.js';
import { getStorage, STORAGE_KEYS } from './utils/StorageAdapter.js';
import { SemesterService } from './services/SemesterService.js';
import { ToastService } from './services/ToastService.js';
import { getFirestore, onSnapshot, doc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Internal state for real-time listener
let unsubscribeSubjectListener = null;
let currentListeningSemester = null;

// Use SemesterService for current semester (getter for backward compatibility)
const getCurrentSemester = () => SemesterService.getCurrentSemester();

/**
 * Generates a tag for a subject based on its name
 * @param {string} name - The subject name
 * @returns {string} A generated tag
 */
export function generateTag(name) {
    // Convert to uppercase and remove spaces and special characters
    return name.toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 4) + Math.floor(Math.random() * 100);
}

/**
 * Processes bulk input of subjects
 */
export function parseBulkInput() {
    const bulkInput = document.getElementById('bulkInput').value.trim();
    if (!bulkInput) {
        ToastService.warning('Please enter subject data in the bulk input field');
        return;
    }

    const lines = bulkInput.split('\n');
    const subjects = [];

    for (const line of lines) {
        // Robust parsing: split by last comma to separate name and credit hours
        // This allows subject names to contain commas (e.g., "Physics, Advanced, 4")
        const lastCommaIndex = line.lastIndexOf(',');

        if (lastCommaIndex !== -1) {
            const name = line.substring(0, lastCommaIndex).trim();
            const hoursStr = line.substring(lastCommaIndex + 1).trim();
            const hours = parseInt(hoursStr);

            if (name && !isNaN(hours)) {
                subjects.push({ name, hours });
            }
        }
    }

    if (subjects.length === 0) {
        ToastService.warning('No valid subject data found. Please use the format: Subject Name, Credit Hours');
        return;
    }

    // Set the subject count and create forms
    document.getElementById('subjectCount').value = subjects.length;
    createSubjectForms();

    // Fill in the created forms with bulk data
    const subjectNames = document.querySelectorAll('.subject-name');
    const creditHours = document.querySelectorAll('.credit-hours');

    subjects.forEach((subject, index) => {
        if (subjectNames[index] && creditHours[index]) {
            subjectNames[index].value = subject.name;
            creditHours[index].value = subject.hours;
            // Trigger the subject tag update
            updateSubjectTag(subjectNames[index]);
        }
    });

    // Update relative scores
    updateRelativeScores();

    // Clear the bulk input field
    document.getElementById('bulkInput').value = '';
}

/**
 * Gathers subject suggestions from timetable data and standard university curriculum
 */
export function getSubjectSuggestions() {
    const suggestions = new Set([
        'Calculus I', 'Calculus II', 'Linear Algebra', 'Discrete Mathematics', 'Differential Equations',
        'Numerical Analysis', 'Data Structures & Algorithms', 'Operating Systems', 'Database Systems',
        'Computer Networks', 'Software Engineering', 'Software Testing and Quality Assurance',
        'Artificial Intelligence', 'Machine Learning', 'Deep Learning', 'Computer Architecture',
        'Digital Logic Design', 'Object Oriented Programming', 'Object Oriented Programming Lab',
        'Web Engineering', 'Cybersecurity', 'Cloud Computing', 'Computer Graphics',
        'Applied Physics', 'Applied Physics Lab', 'Technical Report Writing', 'Professional Ethics'
    ]);

    // Add subjects from uploaded timetable if available
    try {
        const timetableEvents = JSON.parse(localStorage.getItem('gpace_timetable_events') || '[]');
        if (Array.isArray(timetableEvents)) {
            timetableEvents.forEach(evt => {
                const name = evt.subject || evt.title;
                if (name && typeof name === 'string' && name.trim()) {
                    suggestions.add(name.trim());
                }
            });
        }

        const timetableAnalysis = JSON.parse(localStorage.getItem('gpace_timetable_analysis') || '{}');
        if (timetableAnalysis && timetableAnalysis.schedule) {
            Object.values(timetableAnalysis.schedule).forEach(dayList => {
                if (Array.isArray(dayList)) {
                    dayList.forEach(slot => {
                        if (slot.subject) suggestions.add(slot.subject.trim());
                    });
                }
            });
        }
    } catch (e) {
        console.error('Error fetching timetable subject suggestions:', e);
    }

    return Array.from(suggestions).sort();
}

/**
 * Creates/refreshes the datalist for subject name autocomplete
 */
export function ensureSubjectSuggestionsDataList() {
    let datalist = document.getElementById('subjectSuggestionsList');
    if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = 'subjectSuggestionsList';
        document.body.appendChild(datalist);
    }

    const suggestions = getSubjectSuggestions();
    datalist.innerHTML = suggestions.map(s => `<option value="${s}">`).join('');
}

/**
 * Suggests default credit hours based on course type
 */
export function suggestCreditHours(subjectName) {
    if (!subjectName) return 3;
    const lower = subjectName.toLowerCase();
    if (lower.includes('lab') || lower.includes('laboratory') || lower.includes('practicum')) {
        return 1;
    }
    if (lower.includes('calculus') || lower.includes('physics') || lower.includes('final year project') || lower.includes('capstone')) {
        return 4;
    }
    return 3;
}

/**
 * Creates form elements for subjects with autocomplete and suggested credit hours
 */
export function createSubjectForms() {
    const count = parseInt(document.getElementById('subjectCount').value);
    if (!count || count < 1) {
        ToastService.warning('Please enter a valid number of subjects');
        return;
    }

    ensureSubjectSuggestionsDataList();

    const formsContainer = document.getElementById('subjectForms');
    formsContainer.innerHTML = '';

    const fragment = document.createDocumentFragment();

    for (let i = 1; i <= count; i++) {
        const formDiv = document.createElement('div');
        formDiv.className = 'subject-form';
        formDiv.innerHTML = `
            <h4>Subject ${i}</h4>
            <div class="form-group">
                <label class="form-label">Subject Name (Autocomplete)</label>
                <input type="text" class="form-control subject-name" list="subjectSuggestionsList" placeholder="e.g. Machine Learning, Calculus..." required>
                <small class="text-muted subject-tag"></small>
            </div>
            <div class="form-group">
                <label class="form-label">Credit Hours (Suggested)</label>
                <input type="number" class="form-control credit-hours" min="1" max="6" value="3" data-auto-filled="true" required>
                <div class="relative-score mt-2 text-primary"></div>
            </div>
            <div class="form-group">
                <label class="form-label">Cognitive Difficulty Level (1-100)</label>
                <div class="d-flex align-items-center">
                    <input type="range" class="form-range cognitive-difficulty" min="1" max="100" value="50"
                           style="flex: 1;">
                    <span class="ms-2 cognitive-value">50</span>
                </div>
                <small class="text-muted">1 = Very Easy, 50 = Moderate, 100 = Very Challenging</small>
            </div>
        `;
        fragment.appendChild(formDiv);

        const cognitiveSlider = formDiv.querySelector('.cognitive-difficulty');
        const cognitiveDisplay = formDiv.querySelector('.cognitive-value');
        if (cognitiveSlider && cognitiveDisplay) {
            cognitiveSlider.addEventListener('input', function () {
                cognitiveDisplay.textContent = this.value;
            });
        }

        const subjectNameInput = formDiv.querySelector('.subject-name');
        const creditHoursInput = formDiv.querySelector('.credit-hours');

        if (subjectNameInput) {
            subjectNameInput.addEventListener('input', function () {
                updateSubjectTag(this);

                // Auto-suggest credit hours if not manually overridden
                if (creditHoursInput && creditHoursInput.dataset.autoFilled === 'true') {
                    creditHoursInput.value = suggestCreditHours(this.value);
                    updateRelativeScores();
                }
            });

            subjectNameInput.addEventListener('change', function () {
                updateSubjectTag(this);
                if (creditHoursInput && creditHoursInput.dataset.autoFilled === 'true') {
                    creditHoursInput.value = suggestCreditHours(this.value);
                    updateRelativeScores();
                }
            });
        }

        if (creditHoursInput) {
            creditHoursInput.addEventListener('input', function () {
                this.dataset.autoFilled = 'false';
            });
        }
    }

    formsContainer.appendChild(fragment);

    const creditHoursInputs = formsContainer.querySelectorAll('.credit-hours');
    creditHoursInputs.forEach(input => {
        input.addEventListener('change', updateRelativeScores);
    });

    updateRelativeScores();
    document.getElementById('saveButton').classList.remove('d-none');
}

/**
 * Updates the tag display for a subject
 * @param {HTMLElement} input - The subject name input element
 */
export function updateSubjectTag(input) {
    const tag = generateTag(input.value);
    input.parentElement.querySelector('.subject-tag').textContent = `Tag: ${tag}`;
}

/**
 * Updates relative scores based on credit hours
 */
export function updateRelativeScores() {
    const creditHours = document.querySelectorAll('.credit-hours');
    let maxCreditHour = 0;

    // Find maximum credit hours
    creditHours.forEach(credit => {
        const hours = parseInt(credit.value) || 0;
        if (hours > maxCreditHour) {
            maxCreditHour = hours;
        }
    });

    // Update relative scores
    creditHours.forEach(credit => {
        const hours = parseInt(credit.value) || 0;
        const relativeScore = maxCreditHour > 0 ? (hours / maxCreditHour) * 100 : 0;
        const scoreDisplay = credit.parentElement.querySelector('.relative-score');
        if (hours > 0) {
            scoreDisplay.textContent = `Relative Weight: ${relativeScore.toFixed(2)}%`;
        } else {
            scoreDisplay.textContent = '';
        }
    });
}

/**
 * Saves subject data to localStorage and Firestore
 */
export async function saveSubjects() {
    try {
        // Check if user is signed in
        if (!window.auth?.currentUser) {
            // Not signed in, trigger Google sign-in
            const user = await window.signInWithGoogle();
            if (!user) {
                return; // User cancelled sign-in
            }
        }

        // Get semester name
        const semesterName = document.getElementById('semesterSelector').value;
        if (!semesterName.trim()) {
            ToastService.warning('Please enter a valid semester name');
            return;
        }

        // Proceed with saving subjects
        const subjects = [];
        const subjectNames = document.querySelectorAll('.subject-name');
        const creditHours = document.querySelectorAll('.credit-hours');
        const cognitiveDifficulties = document.querySelectorAll('.cognitive-difficulty');
        const academicPerformances = document.querySelectorAll('.academic-performance');

        // Find the highest credit hour
        let maxCreditHour = 0;
        creditHours.forEach(credit => {
            const hours = parseInt(credit.value);
            if (hours > maxCreditHour) {
                maxCreditHour = hours;
            }
        });

        // Calculate relative scores and store subject data
        for (let i = 0; i < subjectNames.length; i++) {
            const name = subjectNames[i].value.trim();
            const tag = generateTag(name);
            const hours = parseInt(creditHours[i].value);
            const difficulty = parseInt(cognitiveDifficulties[i].value);
            const performance = parseInt(academicPerformances[i]?.value) || 50;

            if (!name || !hours) {
                ToastService.warning('Please fill in all required fields (Subject Name and Credit Hours)');
                return;
            }

            // Calculate relative score (as percentage)
            const relativeScore = (hours / maxCreditHour) * 100;

            subjects.push({
                name: name,
                tag: tag,
                creditHours: hours,
                relativeScore: relativeScore,
                cognitiveDifficulty: difficulty,
                academicPerformance: performance
            });

            // Sync with subject marks system
            syncAcademicPerformanceWithMarks(tag, performance);
        }

        // Get existing semesters data
        const storage = getStorage();
        const allSemesters = storage.get('academicSemesters', {});

        // Add/update current semester data
        allSemesters[semesterName] = {
            subjects: subjects,
            lastUpdated: new Date().toISOString()
        };

        // Store in storage with error handling
        const localSaveSuccess = storage.set('academicSemesters', allSemesters);

        if (!localSaveSuccess) {
            console.warn('[SubjectManagement] Local storage save failed (quota exceeded). Attempting cloud save only.');
            ToastService.warning('Local storage full! Attempting to save to cloud only.');
        }

        // Also store current semester subjects in the old format for backward compatibility
        // We attempt this but don't fail the whole operation if it fails (it's legacy backup)
        storage.set('academicSubjects', subjects);

        // Set current semester using SemesterService
        SemesterService.setCurrentSemester(semesterName);

        // Trigger an event to notify other components (like flashcards) about subject changes
        const subjectsChangedEvent = new CustomEvent('subjectsChanged', {
            detail: { subjects: subjects }
        });
        window.dispatchEvent(subjectsChangedEvent);

        try {
            // Sync to Firestore - We modify this to store by semester
            await window.saveSubjectsToFirestore(subjects, semesterName);
            console.log(`Subjects for semester ${semesterName} saved successfully`);
            ToastService.success(`Subjects for semester "${semesterName}" saved successfully!`);
        } catch (error) {
            console.error('Error saving to Firestore:', error);
            ToastService.warning('Subjects saved locally, but there was an error saving to cloud.');
        }

        // Display the saved subjects
        displaySavedSubjects();

        // Update semester selector
        if (window.updateSemesterSelector) {
            window.updateSemesterSelector();
        }
    } catch (error) {
        console.error('Sign-in failed:', error);
        ToastService.error('Please sign in to save your subjects to the cloud');
    }
}

/**
 * Displays saved subjects in the UI
 * Now handles real-time synchronization setup
 */
export async function displaySavedSubjects() {
    const container = document.getElementById('savedSubjects');
    if (!container) return;

    // Get current semester
    await SemesterService.initialize();
    const currentSemester = getCurrentSemester();
    const storage = getStorage();
    const allSemesters = storage.get('academicSemesters', {});
    const semesterData = allSemesters[currentSemester];

    // Check if we need to switch listener
    if (currentListeningSemester !== currentSemester) {
        setupRealTimeSync(currentSemester);
    }

    // Determine data source for INITIAL render (Optimistic / Local First)
    let subjects = [];
    if (semesterData && semesterData.subjects) {
        subjects = semesterData.subjects;
    } else if (currentSemester === 'default') {
        const legacySubjects = storage.get('academicSubjects', []);
        if (legacySubjects.length > 0) subjects = legacySubjects;
    }

    // Render immediately with local data
    renderSubjects(container, subjects, currentSemester, semesterData);
}

/**
 * Sets up real-time listener for the given semester
 */
async function setupRealTimeSync(semesterName) {
    // Cleanup previous listener
    if (unsubscribeSubjectListener) {
        console.log(`[SubjectManagement] Unsubscribing from semester: ${currentListeningSemester}`);
        unsubscribeSubjectListener();
        unsubscribeSubjectListener = null;
    }

    currentListeningSemester = semesterName;

    // Wait for auth to be sufficiently ready
    if (!window.auth) {
        // Retry a few times if auth isn't initialized yet
        let attempts = 0;
        while (!window.auth && attempts < 5) {
            await new Promise(r => setTimeout(r, 200));
            attempts++;
        }
    }

    if (!window.auth || !window.auth.currentUser) {
        console.log('[SubjectManagement] No user signed in, skipping real-time sync.');
        return;
    }

    try {
        console.log(`[SubjectManagement] Setting up listener for semester: ${semesterName}`);
        const user = window.auth.currentUser;
        const db = getFirestore();
        const semesterRef = doc(db, 'users', user.uid, 'semesters', semesterName);

        unsubscribeSubjectListener = onSnapshot(semesterRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                const subjects = data.subjects || [];

                // OPTIMIZATION: Check if data is actually different before updating
                // This prevents "refreshing again and again" loops and UI flickers
                const storage = getStorage();
                const allSemesters = storage.get('academicSemesters', {});
                const currentLocalData = allSemesters[semesterName] || {};
                const localSubjects = currentLocalData.subjects || [];

                // Simple deep equality check
                const isDifferent = JSON.stringify(subjects) !== JSON.stringify(localSubjects);

                if (!isDifferent) {
                    console.log(`[SubjectManagement] Data for ${semesterName} is identical. Skipping update.`);
                    // Ensure we mark it as synced though, just in case
                    if (currentLocalData.storageStatus !== 'both') {
                        allSemesters[semesterName].storageStatus = 'both';
                        storage.set('academicSemesters', allSemesters);
                    }
                    return;
                }

                console.log(`[SubjectManagement] Real-time update for ${semesterName}: ${subjects.length} subjects (Content Changed)`);

                // Update Local Storage for consistency
                allSemesters[semesterName] = {
                    ...allSemesters[semesterName],
                    subjects: subjects,
                    lastUpdated: new Date().toISOString(),
                    storageStatus: 'both' // Confirmed cloud data
                };
                storage.set('academicSemesters', allSemesters);

                // If this is the current semester, update legacy key too
                if (semesterName === getCurrentSemester()) {
                    storage.set('academicSubjects', subjects);

                    // Trigger UI update
                    const container = document.getElementById('savedSubjects');
                    if (container) {
                        renderSubjects(container, subjects, semesterName, allSemesters[semesterName]);
                    }

                    // Also populate forms with this data
                    populateFormsWithSubjects(subjects);
                }
            } else {
                console.log(`[SubjectManagement] No cloud data for ${semesterName}`);
            }
        }, (error) => {
            console.warn('[SubjectManagement] Real-time sync error:', error);
        });

    } catch (e) {
        console.error('[SubjectManagement] Error setting up listener:', e);
    }
}

/**
 * Renders the subjects to the container
 */
function renderSubjects(container, subjects, semesterName, semesterData) {
    container.innerHTML = ''; // Clear

    if (subjects && subjects.length > 0) {
        // Create semester header with metadata
        const semesterHeader = document.createElement('div');
        semesterHeader.className = 'mb-4';
        const lastUpdated = semesterData?.lastUpdated ? new Date(semesterData.lastUpdated).toLocaleDateString() : 'Just now';

        semesterHeader.innerHTML = `
            <h3>Subjects for ${SemesterService.getCurrentSemester()}</h3>
            <div class="text-muted small">
                ${subjects.length} subject${subjects.length !== 1 ? 's' : ''} •
                Last updated: ${lastUpdated}
                ${semesterData?.isArchived ? ' • <span class="badge bg-secondary">Archived</span>' : ''}
                 ${semesterData?.storageStatus === 'both' ? ' • <span class="badge bg-success" title="Synced to Cloud">Synced</span>' : ''}
            </div>
        `;
        container.appendChild(semesterHeader);

        // Create subject cards
        subjects.forEach(subject => {
            const subjectCard = document.createElement('div');
            subjectCard.className = 'subject-card';

            // Calculate GPA if available
            let gpaDisplay = '';
            if (subject.academicPerformance) {
                const gpa = (subject.academicPerformance / 20); // 0-5 scale
                gpaDisplay = `<p>Estimated GPA: <strong>${gpa.toFixed(2)}/5.0</strong></p>`;
            }

            subjectCard.innerHTML = `
                <div class="subject-header">
                    <h3 class="subject-title">${subject.name}</h3>
                    <span class="subject-tag">${subject.tag}</span>
                </div>
                <p>Credit Hours: <strong>${subject.creditHours}</strong></p>
                <p>Relative Weight: <strong>${subject.relativeScore.toFixed(2)}%</strong></p>
                <p>Cognitive Difficulty: <strong>${subject.cognitiveDifficulty}</strong></p>
                <p>Academic Performance: <strong>${subject.academicPerformance || 'N/A'}</strong></p>
                ${gpaDisplay}
            `;
            container.appendChild(subjectCard);
        });
    } else {
        container.innerHTML = `
            <div class="alert alert-info">
                <h4>No subjects found for ${semesterName}</h4>
                <p>Create subjects using the form above to get started.</p>
            </div>
        `;
    }
}

/**
 * Populates the input forms with the provided subjects
 */
function populateFormsWithSubjects(subjects) {
    if (!subjects || subjects.length === 0) {
        document.getElementById('subjectCount').value = '';
        document.getElementById('subjectForms').innerHTML = '';
        document.getElementById('saveButton').classList.add('d-none');
        return;
    }

    document.getElementById('subjectCount').value = subjects.length;
    createSubjectForms(); // Re-create forms safely

    const subjectNames = document.querySelectorAll('.subject-name');
    const creditHours = document.querySelectorAll('.credit-hours');
    const cognitiveDifficulties = document.querySelectorAll('.cognitive-difficulty');
    const academicPerformances = document.querySelectorAll('.academic-performance');

    subjects.forEach((subject, index) => {
        if (index < subjectNames.length) {
            subjectNames[index].value = subject.name;
            creditHours[index].value = subject.creditHours;
            if (cognitiveDifficulties[index]) {
                cognitiveDifficulties[index].value = subject.cognitiveDifficulty;
                cognitiveDifficulties[index].nextElementSibling.textContent = subject.cognitiveDifficulty;
            }
            if (academicPerformances[index]) {
                academicPerformances[index].value = subject.academicPerformance;
                academicPerformances[index].nextElementSibling.textContent = subject.academicPerformance;
            }
            // Update tag display
            const tagElem = subjectNames[index].parentElement.querySelector('.subject-tag');
            if (tagElem) tagElem.textContent = `Tag: ${subject.tag}`;
        }
    });
    updateRelativeScores();
}

/**
 * Syncs the academic performance from the sliders with the subject marks system
 * @param {string} subjectTag - The tag of the subject
 * @param {number} performance - The academic performance value
 */
export function syncAcademicPerformanceWithMarks(subjectTag, performance) {
    const storage = getStorage();
    try {
        // Get existing subject marks
        const allSubjectMarks = storage.get('subjectMarks', {});

        // If no marks exist for this subject, create a placeholder
        if (!allSubjectMarks[subjectTag]) {
            allSubjectMarks[subjectTag] = {};
        }

        // Store the manually set performance value for reference
        allSubjectMarks[subjectTag]._manualPerformance = performance;

        // Save back to storage
        storage.set('subjectMarks', allSubjectMarks);

        // Sync with subject marks system if available
        if (window.updateSubjectPerformance) {
            console.log(`Syncing academic performance for ${subjectTag} to ${performance}`);
            window.updateSubjectPerformance(subjectTag);
        }
    } catch (error) {
        console.error('Error syncing academic performance with marks:', error);
    }
}

/**
 * Loads subjects from storage
 */
export function loadFromLocalStorage() {
    const storage = getStorage();
    const subjects = storage.get('academicSubjects', null);
    if (subjects && subjects.length > 0) {
        document.getElementById('subjectCount').value = subjects.length;
        createSubjectForms();

        const subjectNames = document.querySelectorAll('.subject-name');
        const creditHours = document.querySelectorAll('.credit-hours');
        const cognitiveDifficulties = document.querySelectorAll('.cognitive-difficulty');
        const academicPerformances = document.querySelectorAll('.academic-performance');

        subjects.forEach((subject, index) => {
            subjectNames[index].value = subject.name;
            creditHours[index].value = subject.creditHours;
            cognitiveDifficulties[index].value = subject.cognitiveDifficulty;
            academicPerformances[index].value = subject.academicPerformance;
            cognitiveDifficulties[index].nextElementSibling.textContent = subject.cognitiveDifficulty;
            academicPerformances[index].nextElementSibling.textContent = subject.academicPerformance;
            subjectNames[index].parentElement.querySelector('.subject-tag').textContent = `Tag: ${subject.tag}`;
        });
        updateRelativeScores();
        displaySavedSubjects();
    }
}

/**
 * Initializes subject management event listeners
 */
export function initSubjectManagement() {
    // Ensure subject suggestions datalist is prepared on page load
    ensureSubjectSuggestionsDataList();

    // Add event listeners to replace inline onclick handlers
    document.getElementById('parseBulkBtn')?.addEventListener('click', parseBulkInput);
    document.getElementById('generateFormsBtn')?.addEventListener('click', createSubjectForms);
    document.getElementById('saveButton')?.addEventListener('click', saveSubjects);

    // Make displaySavedSubjects available globally for other modules
    window.displaySavedSubjects = displaySavedSubjects;

    // Listen for semester changes using SemesterService
    SemesterService.subscribe((event) => {
        if (event.type === 'semester-change') {
            console.log(`[SubjectManagement] Semester changed to ${event.currentSemester}, updating view...`);
            displaySavedSubjects();
        }
    });

    // Initialize SemesterService (it auto-initializes, but ensure it's ready)
    SemesterService.initialize().then(() => {
        console.log('SemesterService ready, current semester:', getCurrentSemester());
    });

    console.log('Subject management module initialized');
}
