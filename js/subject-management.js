/**
 * Subject Management Module
 * Handles subject creation, display, and management functionality
 */

console.log('Subject Management Module loaded');

import { saveSubjectsToFirestore, loadSubjectsFromFirestore } from './firestore.js';

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initSubjectManagement();
    console.log('Subject management initialized');
});

// Current active semester
let currentSemester = 'default';

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
        alert('Please enter subject data in the bulk input field');
        return;
    }

    const lines = bulkInput.split('\n');
    const subjects = [];

    for (const line of lines) {
        const [name, hours] = line.split(',').map(item => item.trim());
        if (name && hours && !isNaN(hours)) {
            subjects.push({ name, hours: parseInt(hours) });
        }
    }

    if (subjects.length === 0) {
        alert('No valid subject data found. Please use the format: Subject Name, Credit Hours');
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
 * Creates form elements for subjects
 */
export function createSubjectForms() {
    const count = parseInt(document.getElementById('subjectCount').value);
    if (!count || count < 1) {
        alert('Please enter a valid number of subjects');
        return;
    }

    const formsContainer = document.getElementById('subjectForms');
    formsContainer.innerHTML = '';

    for (let i = 1; i <= count; i++) {
        const formDiv = document.createElement('div');
        formDiv.className = 'subject-form';
        formDiv.innerHTML = `
            <h4>Subject ${i}</h4>
            <div class="form-group">
                <label class="form-label">Subject Name</label>
                <input type="text" class="form-control subject-name" required>
                <small class="text-muted subject-tag"></small>
            </div>
            <div class="form-group">
                <label class="form-label">Credit Hours</label>
                <input type="number" class="form-control credit-hours" min="1" max="6" required>
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
        formsContainer.appendChild(formDiv);

        // Add event listeners for cognitive slider
        const cognitiveSlider = formDiv.querySelector('.cognitive-difficulty');
        const cognitiveDisplay = formDiv.querySelector('.cognitive-value');
        cognitiveSlider.addEventListener('input', function() {
            cognitiveDisplay.textContent = this.value;
        });

        // Add event listener for subject name change
        const subjectNameInput = formDiv.querySelector('.subject-name');
        subjectNameInput.addEventListener('change', function() {
            updateSubjectTag(this);
        });
    }

    // Add event listeners for credit hours change
    const creditHoursInputs = document.querySelectorAll('.credit-hours');
    creditHoursInputs.forEach(input => {
        input.addEventListener('change', updateRelativeScores);
    });

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
            alert('Please enter a valid semester name');
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
                alert('Please fill in all required fields (Subject Name and Credit Hours)');
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
        const allSemestersJson = localStorage.getItem('academicSemesters') || '{}';
        const allSemesters = JSON.parse(allSemestersJson);

        // Add/update current semester data
        allSemesters[semesterName] = {
            subjects: subjects,
            lastUpdated: new Date().toISOString()
        };

        // Store in localStorage
        localStorage.setItem('academicSemesters', JSON.stringify(allSemesters));

        // Also store current semester subjects in the old format for backward compatibility
        localStorage.setItem('academicSubjects', JSON.stringify(subjects));

        // Set current semester
        currentSemester = semesterName;
        localStorage.setItem('currentAcademicSemester', semesterName);

        // Trigger an event to notify other components (like flashcards) about subject changes
        const subjectsChangedEvent = new CustomEvent('subjectsChanged', {
            detail: { subjects: subjects }
        });
        window.dispatchEvent(subjectsChangedEvent);

        try {
            // Sync to Firestore - We modify this to store by semester
            await window.saveSubjectsToFirestore(subjects, semesterName);
            console.log(`Subjects for semester ${semesterName} saved successfully`);
            alert(`Subjects for semester "${semesterName}" saved successfully to both local storage and cloud!`);
        } catch (error) {
            console.error('Error saving to Firestore:', error);
            alert('Subjects saved locally, but there was an error saving to the cloud. Please try again later.');
        }

        // Display the saved subjects
        displaySavedSubjects();

        // Update semester selector
        if (window.updateSemesterSelector) {
            window.updateSemesterSelector();
        }
    } catch (error) {
        console.error('Sign-in failed:', error);
        alert('Please sign in to save your subjects to the cloud');
    }
}

/**
 * Displays saved subjects in the UI
 */
export async function displaySavedSubjects() {
    const container = document.getElementById('savedSubjects');
    container.innerHTML = ''; // Clear existing content

    try {
        // Ensure auth is initialized
        if (!window.auth) {
            console.warn('Authentication not initialized, attempting to initialize');
            const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
            const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

            const firebaseConfig = {
                apiKey: "AIzaSyCdxGGpfoWD_M_6BwWFqWZ-6MAOKTUjIrI",
                authDomain: "mzm-gpace.firebaseapp.com",
                projectId: "mzm-gpace",
                storageBucket: "mzm-gpace.firebasestorage.app",
                messagingSenderId: "949014366726",
                appId: "1:949014366726:web:3aa05a6e133e2066c45187"
            };

            const app = initializeApp(firebaseConfig);
            window.auth = getAuth(app);
            window.db = getFirestore(app);
        }

        // Dynamically import loadSubjectsFromFirestore
        const { loadSubjectsFromFirestore } = await import('./firestore.js');

        // Use a Promise to wait for the auth state
        const user = await new Promise((resolve) => {
            const unsubscribe = window.auth.onAuthStateChanged((user) => {
                unsubscribe(); // Stop listening after first call
                resolve(user);
            });
        });

        if (!user) {
            console.warn('No authenticated user found');
        }

        // Get the current semester from localStorage or use default
        currentSemester = localStorage.getItem('currentAcademicSemester') || 'default';

        // Get existing semesters data
        const allSemesters = JSON.parse(localStorage.getItem('academicSemesters') || '{}');
        let semesterData = allSemesters[currentSemester];

        // Try to get subjects from Firestore if authenticated
        let subjects = [];
        let loadSource = 'local';

        if (user) {
            try {
                // Attempt to load from Firestore first
                subjects = await loadSubjectsFromFirestore(currentSemester);
                loadSource = 'cloud';

                // Update the storage status
                if (semesterData) {
                    semesterData.storageStatus = 'both';
                    semesterData.lastSynced = new Date().toISOString();
                    allSemesters[currentSemester] = semesterData;
                    localStorage.setItem('academicSemesters', JSON.stringify(allSemesters));
                }

                console.log(`Loaded subjects for semester '${currentSemester}' from Firestore`);
            } catch (error) {
                console.warn('Error loading from Firestore:', error);
                // Fall back to local storage if Firestore fails
                loadSource = 'local';

                if (semesterData) {
                    subjects = semesterData.subjects || [];
                }
            }
        } else {
            // Use local storage if not authenticated
            if (semesterData) {
                subjects = semesterData.subjects || [];
            }
        }

        // Fallback to old format if needed
        if (subjects.length === 0 && currentSemester === 'default') {
            subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');

            // If we found subjects in the old format, migrate them
            if (subjects.length > 0) {
                // Store them in the new format
                allSemesters.default = allSemesters.default || {
                    subjects: subjects,
                    lastUpdated: new Date().toISOString(),
                    storageStatus: 'local'
                };
                localStorage.setItem('academicSemesters', JSON.stringify(allSemesters));
            }
        }

        // Create a semester data object if it doesn't exist
        if (!semesterData && subjects.length > 0) {
            semesterData = {
                subjects: subjects,
                lastUpdated: new Date().toISOString(),
                storageStatus: loadSource === 'cloud' ? 'cloud' : 'local',
                created: new Date().toISOString()
            };
            allSemesters[currentSemester] = semesterData;
            localStorage.setItem('academicSemesters', JSON.stringify(allSemesters));
        }

        // Update the form with loaded subjects
        if (subjects && subjects.length > 0) {
            document.getElementById('subjectCount').value = subjects.length;
            createSubjectForms();

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
                    subjectNames[index].parentElement.querySelector('.subject-tag').textContent = `Tag: ${subject.tag}`;
                }
            });
            updateRelativeScores();
        } else {
            // Clear the form if no subjects
            document.getElementById('subjectCount').value = '';
            document.getElementById('subjectForms').innerHTML = '';
            document.getElementById('saveButton').classList.add('d-none');
        }

        // Update the semester selector
        if (window.updateSemesterSelector) {
            await window.updateSemesterSelector();
        }

        // Display saved subjects in the container
        if (subjects.length > 0) {
            // Create semester header with metadata
            const semesterHeader = document.createElement('div');
            semesterHeader.className = 'mb-4';
            semesterHeader.innerHTML = `
                <h3>Subjects for ${currentSemester}</h3>
                <div class="text-muted small">
                    ${subjects.length} subject${subjects.length !== 1 ? 's' : ''} •
                    Last updated: ${new Date(semesterData?.lastUpdated || new Date()).toLocaleDateString()}
                    ${semesterData?.isArchived ? ' • <span class="badge bg-secondary">Archived</span>' : ''}
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
                    // Simple GPA calculation (can be enhanced)
                    const gpa = (subject.academicPerformance / 20); // Convert 0-100 to 0-5 scale
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
                    <h4>No subjects found for ${currentSemester}</h4>
                    <p>Create subjects using the form above to get started.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error in displaySavedSubjects:', error);
        container.innerHTML = `
            <div class="alert alert-danger">
                <h4>Error loading subjects</h4>
                <p>${error.message || 'An unknown error occurred'}</p>
                <button class="btn btn-outline-danger" id="tryAgainBtn">Try Again</button>
            </div>
        `;

        // Add event listener for the try again button
        document.getElementById('tryAgainBtn')?.addEventListener('click', displaySavedSubjects);
    }
}

/**
 * Syncs the academic performance from the sliders with the subject marks system
 * @param {string} subjectTag - The tag of the subject
 * @param {number} performance - The academic performance value
 */
export function syncAcademicPerformanceWithMarks(subjectTag, performance) {
    try {
        // Get existing subject marks
        const subjectMarksJson = localStorage.getItem('subjectMarks') || '{}';
        const allSubjectMarks = JSON.parse(subjectMarksJson);

        // If no marks exist for this subject, create a placeholder
        if (!allSubjectMarks[subjectTag]) {
            allSubjectMarks[subjectTag] = {};
        }

        // Store the manually set performance value for reference
        allSubjectMarks[subjectTag]._manualPerformance = performance;

        // Save back to localStorage
        localStorage.setItem('subjectMarks', JSON.stringify(allSubjectMarks));

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
 * Loads subjects from localStorage
 */
export function loadFromLocalStorage() {
    const savedSubjects = localStorage.getItem('academicSubjects');
    if (savedSubjects) {
        const subjects = JSON.parse(savedSubjects);
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
    // Add event listeners to replace inline onclick handlers
    document.getElementById('parseBulkBtn')?.addEventListener('click', parseBulkInput);
    document.getElementById('generateFormsBtn')?.addEventListener('click', createSubjectForms);
    document.getElementById('saveButton')?.addEventListener('click', saveSubjects);

    // Make displaySavedSubjects available globally for other modules
    window.displaySavedSubjects = displaySavedSubjects;

    // Set current semester from localStorage
    currentSemester = localStorage.getItem('currentAcademicSemester') || 'default';

    console.log('Subject management module initialized');
}
