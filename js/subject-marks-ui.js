// subject-marks-ui.js - Handles UI interactions for the subject marks page

/**
 * Global variables
 */
let currentSubjectTag = null;
let subjects = [];
let marks = {};
let weightages = {};

/**
 * Initialize the UI when the DOM is loaded
 */
async function init() {
    // Wait for Firebase to be initialized
    if (window.firebaseInitialized) {
        await window.firebaseInitialized;
    }

    // Wait for subject marks module to be initialized
    if (window.subjectMarksInitialized) {
        await window.subjectMarksInitialized;
    }

    // Wait for Firebase and auth to be ready
    await new Promise(resolve => {
        const checkAuth = setInterval(() => {
            if (window.auth) {
                window.auth.onAuthStateChanged((user) => {
                    clearInterval(checkAuth);
                    resolve(user);
                });
            }
        }, 100);
    });

    // Check if Firestore functions are available
    if (!window.loadSubjectsFromFirestore) {
        console.error('Firestore functions not available. Waiting for initialization...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // If still not available, try to import them directly
        if (!window.loadSubjectsFromFirestore) {
            try {
                const firestore = await import('./firestore.js');
                window.loadSubjectsFromFirestore = firestore.loadSubjectsFromFirestore;
                window.loadSubjectMarksFromFirestore = firestore.loadSubjectMarksFromFirestore;
                window.loadSubjectWeightagesFromFirestore = firestore.loadSubjectWeightagesFromFirestore;
                window.saveSubjectMarksToFirestore = firestore.saveSubjectMarksToFirestore;
                window.saveSubjectWeightagesToFirestore = firestore.saveSubjectWeightagesToFirestore;
                console.log('Firestore functions imported directly');
            } catch (error) {
                console.error('Failed to import Firestore functions:', error);
            }
        }
    }

    // Now proceed with loading data
    await loadSubjects();

    // Set up event listeners
    document.getElementById('subjectSelector').addEventListener('change', handleSubjectChange);
    document.getElementById('saveWeightagesBtn').addEventListener('click', saveWeightages);
    document.getElementById('addMarkBtn').addEventListener('click', addMark);

    // Listen for weightage changes
    document.querySelectorAll('.weightage-input').forEach(input => {
        input.addEventListener('input', updateTotalWeightage);
    });

    // If there's a subject selected, force recalculation
    const currentSubject = document.getElementById('subjectSelector').value;
    if (currentSubject) {
        await handleSubjectChange();
    }
}

/**
 * Add auth state change listener
 */
function setupAuthStateListener() {
    window.auth?.onAuthStateChanged(async (user) => {
        if (user) {
            console.log('User signed in, reloading data from Firestore');
            // Clear local storage to prevent using old user's data
            localStorage.removeItem('academicSubjects');
            localStorage.removeItem('subjectMarks');
            localStorage.removeItem('subjectWeightages');

            // Reload everything
            await loadSubjects();
            if (currentSubjectTag) {
                await handleSubjectChange();
            }
        } else {
            console.log('User signed out');
            // Clear UI
            document.getElementById('subjectSelector').innerHTML = '<option value="">-- Select a Subject --</option>';
            document.getElementById('subjectPerformance').classList.add('d-none');
            document.getElementById('categoryWeightages').classList.add('d-none');
            document.getElementById('addMarks').classList.add('d-none');
            document.getElementById('existingMarks').classList.add('d-none');
        }
    });
}

/**
 * Toggle theme between light and dark
 */
function toggleTheme() {
    const body = document.body;
    const themeIcon = document.querySelector('.theme-icon');
    const themeText = document.querySelector('.theme-text');

    body.classList.toggle('light-theme');

    if (body.classList.contains('light-theme')) {
        themeIcon.textContent = '🌚';
        themeText.textContent = 'Dark Mode';
        localStorage.setItem('theme', 'light');
    } else {
        themeIcon.textContent = '🌞';
        themeText.textContent = 'Light Mode';
        localStorage.setItem('theme', 'dark');
    }
}

/**
 * Load subjects from Firestore or localStorage
 */
async function loadSubjects() {
    try {
        // Check auth state first
        if (!window.auth?.currentUser) {
            console.log('User not signed in, cannot load subjects from Firestore');
            return [];
        }

        // Try to load from Firestore with retry logic
        let retries = 3;
        let loadedSubjects = null;

        while (retries > 0 && !loadedSubjects) {
            try {
                loadedSubjects = await window.loadSubjectsFromFirestore();
                if (loadedSubjects && loadedSubjects.length > 0) {
                    // Successfully loaded from Firestore, save to localStorage as backup
                    localStorage.setItem('academicSubjects', JSON.stringify(loadedSubjects));
                    break;
                }
            } catch (error) {
                console.warn(`Firestore load attempt failed, ${retries - 1} retries left`);
                retries--;
                if (retries === 0) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between retries
            }
        }

        // Only fall back to localStorage if Firestore completely failed
        if (!loadedSubjects || loadedSubjects.length === 0) {
            console.warn('Falling back to localStorage');
            const subjectsJson = localStorage.getItem('academicSubjects');
            loadedSubjects = subjectsJson ? JSON.parse(subjectsJson) : [];
        }

        subjects = loadedSubjects;

        // Update UI
        const selector = document.getElementById('subjectSelector');
        selector.innerHTML = '<option value="">-- Select a Subject --</option>';

        subjects.forEach(subject => {
            const option = document.createElement('option');
            option.value = subject.tag;
            option.textContent = subject.name;
            selector.appendChild(option);
        });

        return subjects;
    } catch (error) {
        console.error('Error loading subjects:', error);
        return [];
    }
}

/**
 * Handle subject change in the selector
 */
async function handleSubjectChange() {
    const subjectTag = document.getElementById('subjectSelector').value;

    if (!subjectTag) {
        // Hide all sections if no subject is selected
        document.getElementById('subjectPerformance').classList.add('d-none');
        document.getElementById('categoryWeightages').classList.add('d-none');
        document.getElementById('addMarks').classList.add('d-none');
        document.getElementById('existingMarks').classList.add('d-none');
        currentSubjectTag = null;
        return;
    }

    currentSubjectTag = subjectTag;

    // Show all sections
    document.getElementById('subjectPerformance').classList.remove('d-none');
    document.getElementById('categoryWeightages').classList.remove('d-none');
    document.getElementById('addMarks').classList.remove('d-none');

    // Load the subject details
    const subject = subjects.find(s => s.tag === subjectTag);

    if (!subject) {
        console.error('Subject not found:', subjectTag);
        return;
    }

    // Load weightages and marks first
    await loadWeightages(subjectTag);
    await loadMarks(subjectTag);

    // Force recalculation of performance
    const recalculatedPerformance = await window.updateSubjectPerformance(subjectTag);

    // Reload subjects to get updated performance
    await loadSubjects();

    // Get fresh subject data after recalculation
    const updatedSubject = subjects.find(s => s.tag === subjectTag);

    // Display subject info with recalculated performance
    document.getElementById('subjectName').textContent = updatedSubject.name;
    document.getElementById('creditHours').textContent = updatedSubject.creditHours;
    document.getElementById('academicPerformance').textContent = recalculatedPerformance;
    document.getElementById('performanceBar').style.width = `${recalculatedPerformance}%`;
    document.getElementById('performanceBar').setAttribute('aria-valuenow', recalculatedPerformance);

    // Update UI
    displayCategoryContributions(subjectTag);
    displayExistingMarks(subjectTag);
}

/**
 * Load weightages for a subject
 */
async function loadWeightages(subjectTag) {
    try {
        // First check if project weightages exist for this subject
        const projectWeightagesJson = localStorage.getItem('projectWeightages') || '{}';
        const projectWeightages = JSON.parse(projectWeightagesJson);

        // Try to load from Firestore
        const allWeightages = await window.loadSubjectWeightagesFromFirestore();
        weightages = allWeightages || {};

        // Default weightages if nothing exists
        const defaultWeightages = {
            assignment: 15,
            quiz: 10,
            midterm: 30,
            final: 40,
            revision: 5
        };

        // Check for project weightages first
        let subjectWeightages;
        if (projectWeightages[subjectTag]) {
            // Map project sections to subject categories
            const sectionToCategory = {
                'Assignment': 'assignment',
                'Quizzes': 'quiz',
                'Mid Term / OHT': 'midterm', // Combined category maps to midterm
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
        } else if (weightages[subjectTag]) {
            // Use existing subject weightages
            subjectWeightages = weightages[subjectTag];
        } else {
            // Use defaults
            subjectWeightages = defaultWeightages;
        }

        // Ensure we have the complete set of weightages
        for (const category in defaultWeightages) {
            if (!(category in subjectWeightages)) {
                subjectWeightages[category] = defaultWeightages[category];
            }
        }

        // Update in-memory weightages
        weightages[subjectTag] = subjectWeightages;
        localStorage.setItem('subjectWeightages', JSON.stringify(weightages));

        // Update UI with weightages
        document.getElementById('assignmentWeightage').value = subjectWeightages.assignment;
        document.getElementById('quizWeightage').value = subjectWeightages.quiz;
        document.getElementById('midtermWeightage').value = subjectWeightages.midterm;
        document.getElementById('finalWeightage').value = subjectWeightages.final;
        document.getElementById('revisionWeightage').value = subjectWeightages.revision;

        // Sync with project system (if the weightages came from subject marks)
        if (window.setSubjectWeightages && !projectWeightages[subjectTag]) {
            window.setSubjectWeightages(subjectTag, subjectWeightages);
        }

        return subjectWeightages;
    } catch (error) {
        console.error('Error loading weightages:', error);
        return {
            assignment: 15,
            quiz: 10,
            midterm: 30,
            final: 40,
            revision: 5
        };
    }
}

/**
 * Load marks for a subject
 */
async function loadMarks(subjectTag) {
    try {
        // Try to load from Firestore
        const allMarks = await window.loadSubjectMarksFromFirestore();
        marks = allMarks || {};
    } catch (error) {
        console.error('Error loading marks:', error);
        // Fallback to localStorage
        const marksJson = localStorage.getItem('subjectMarks') || '{}';
        marks = JSON.parse(marksJson);
    }
}

/**
 * Update the total weightage display and validation
 */
function updateTotalWeightage() {
    const assignment = Number(document.getElementById('assignmentWeightage').value) || 0;
    const quiz = Number(document.getElementById('quizWeightage').value) || 0;
    const midterm = Number(document.getElementById('midtermWeightage').value) || 0;
    const final = Number(document.getElementById('finalWeightage').value) || 0;
    const revision = Number(document.getElementById('revisionWeightage').value) || 0;

    const total = assignment + quiz + midterm + final + revision;
    document.getElementById('totalWeightage').textContent = total.toFixed(1);

    if (Math.abs(total - 100) < 0.1) {
        document.getElementById('totalWeightage').classList.remove('text-danger');
        document.getElementById('totalWeightage').classList.add('text-success');
        document.getElementById('saveWeightagesBtn').disabled = false;
    } else {
        document.getElementById('totalWeightage').classList.remove('text-success');
        document.getElementById('totalWeightage').classList.add('text-danger');
        document.getElementById('saveWeightagesBtn').disabled = true;
    }
}

/**
 * Save weightages for the current subject
 */
async function saveWeightages() {
    if (!currentSubjectTag) return;

    const assignment = Number(document.getElementById('assignmentWeightage').value) || 0;
    const quiz = Number(document.getElementById('quizWeightage').value) || 0;
    const midterm = Number(document.getElementById('midtermWeightage').value) || 0;
    const final = Number(document.getElementById('finalWeightage').value) || 0;
    const revision = Number(document.getElementById('revisionWeightage').value) || 0;

    const total = assignment + quiz + midterm + final + revision;

    if (Math.abs(total - 100) >= 0.1) {
        alert('The total weightage must be 100%');
        return;
    }

    // Create weightages object
    const newWeightages = {
        assignment,
        quiz,
        midterm,
        final,
        revision
    };

    try {
        // Use the setSubjectWeightages function to ensure proper synchronization
        if (window.setSubjectWeightages) {
            window.setSubjectWeightages(currentSubjectTag, newWeightages);
        } else {
            // Fallback to direct storage if function not available
            if (!weightages[currentSubjectTag]) {
                weightages[currentSubjectTag] = {};
            }
            weightages[currentSubjectTag] = newWeightages;
            localStorage.setItem('subjectWeightages', JSON.stringify(weightages));
        }

        // Save to Firestore
        await window.saveSubjectWeightagesToFirestore(weightages);

        // Update subject performance
        window.updateSubjectPerformance(currentSubjectTag);

        // Reload subject to show updated performance
        await loadSubjects();
        handleSubjectChange();

        alert('Weightages saved successfully!');
    } catch (error) {
        console.error('Error saving weightages:', error);
        alert('Error saving weightages. Please try again.');
    }
}

/**
 * Add a mark for the current subject
 */
async function addMark() {
    if (!currentSubjectTag) return;

    const category = document.getElementById('markCategory').value;
    const title = document.getElementById('markTitle').value.trim();
    const obtainedMarks = Number(document.getElementById('obtainedMarks').value);
    const totalMarks = Number(document.getElementById('totalMarks').value);

    if (isNaN(obtainedMarks) || isNaN(totalMarks) || totalMarks <= 0) {
        alert('Please enter valid marks');
        return;
    }

    if (obtainedMarks > totalMarks) {
        alert('Obtained marks cannot be greater than total marks');
        return;
    }

    // Add mark using the subject-marks.js function
    const success = window.addSubjectMark(currentSubjectTag, category, obtainedMarks, totalMarks, title);

    if (success) {
        // Save to Firestore
        const marksJson = localStorage.getItem('subjectMarks') || '{}';
        const updatedMarks = JSON.parse(marksJson);

        try {
            await window.saveSubjectMarksToFirestore(updatedMarks);

            // Reset form
            document.getElementById('markTitle').value = '';
            document.getElementById('obtainedMarks').value = '';
            document.getElementById('totalMarks').value = '';

            // Reload marks
            await loadMarks(currentSubjectTag);

            // Reload subject to show updated performance
            await loadSubjects();
            handleSubjectChange();

            alert('Mark added successfully!');
        } catch (error) {
            console.error('Error saving mark to Firestore:', error);
            alert('Mark saved locally, but could not be saved to the cloud.');
        }
    } else {
        alert('Error adding mark. Please check your inputs and try again.');
    }
}

/**
 * Display category contributions for a subject
 */
function displayCategoryContributions(subjectTag) {
    const subject = subjects.find(s => s.tag === subjectTag);
    if (!subject) return;

    const subjectMarks = marks[subjectTag] || {};
    const subjectWeightages = weightages[subjectTag] || {
        assignment: 15,
        quiz: 10,
        midterm: 30,
        final: 40,
        revision: 5
    };

    const container = document.getElementById('categoryContributions');
    container.innerHTML = '';

    for (const [category, weight] of Object.entries(subjectWeightages)) {
        const categoryMarks = subjectMarks[category] || [];
        const hasCategoryMarks = categoryMarks.length > 0;

        // Calculate performance for this category
        let performance = 0;
        if (hasCategoryMarks) {
            let totalObtained = 0;
            let totalPossible = 0;

            categoryMarks.forEach(mark => {
                totalObtained += mark.obtained;
                totalPossible += mark.total;
            });

            performance = (totalObtained / totalPossible) * 100;
        }

        const div = document.createElement('div');
        div.className = 'mb-3';

        const categoryName = category.charAt(0).toUpperCase() + category.slice(1);

        div.innerHTML = `
            <div class="d-flex justify-content-between">
                <span>${categoryName} (${weight}%)</span>
                <span>${hasCategoryMarks ? performance.toFixed(1) + '%' : 'No marks'}</span>
            </div>
            <div class="progress">
                <div class="progress-bar ${hasCategoryMarks ? '' : 'bg-secondary'}"
                     role="progressbar"
                     style="width: ${hasCategoryMarks ? performance + '%' : '100%'}"
                     aria-valuenow="${hasCategoryMarks ? performance : 0}"
                     aria-valuemin="0"
                     aria-valuemax="100"></div>
            </div>
        `;

        container.appendChild(div);
    }
}

/**
 * Display existing marks for a subject
 */
function displayExistingMarks(subjectTag) {
    const container = document.getElementById('existingMarks');
    container.classList.remove('d-none');
    container.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h4>Existing Marks</h4>
            <button class="btn btn-danger" id="deleteAllMarks">
                <i class="bi bi-trash"></i> Delete All Marks
            </button>
        </div>`;

    const subjectMarks = marks[subjectTag] || {};
    let hasAnyMarks = false;

    Object.entries(subjectMarks).forEach(([category, marksList]) => {
        if (category === '_manualPerformance') return; // Skip manual performance entry

        if (Array.isArray(marksList) && marksList.length > 0) {
            hasAnyMarks = true;
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'mb-3';
            categoryDiv.innerHTML = `<h5>${category.charAt(0).toUpperCase() + category.slice(1)}</h5>`;

            const marksList = document.createElement('ul');
            marksList.className = 'list-group';

            subjectMarks[category].forEach((mark, index) => {
                const markItem = document.createElement('li');
                markItem.className = 'list-group-item d-flex justify-content-between align-items-center';
                markItem.innerHTML = `
                    <span>Obtained: ${mark.obtained} / Total: ${mark.total}</span>
                    <button class="btn btn-danger btn-sm delete-mark"
                            data-category="${category}"
                            data-index="${index}">
                        <i class="bi bi-trash"></i>
                    </button>
                `;
                marksList.appendChild(markItem);
            });

            categoryDiv.appendChild(marksList);
            container.appendChild(categoryDiv);
        }
    });

    // Hide delete all button if no marks exist
    const deleteAllBtn = document.getElementById('deleteAllMarks');
    if (!hasAnyMarks) {
        deleteAllBtn.style.display = 'none';
    }

    // Add event listener for delete all button
    deleteAllBtn.addEventListener('click', async function() {
        if (confirm('Are you sure you want to delete ALL marks for this subject? This action cannot be undone.')) {
            try {
                // Remove all marks for this subject
                marks[subjectTag] = {
                    assignment: [],
                    quiz: [],
                    midterm: [],
                    final: [],
                    revision: []
                };

                // Save updated marks to localStorage
                localStorage.setItem('subjectMarks', JSON.stringify(marks));

                // Save to Firestore
                await window.saveSubjectMarksToFirestore(marks);

                // Recalculate performance
                await window.updateSubjectPerformance(subjectTag);

                // Reload marks from storage to ensure sync
                await loadMarks(subjectTag);

                // Refresh display
                await handleSubjectChange();

                // Show success message
                alert('All marks deleted successfully!');
            } catch (error) {
                console.error('Error deleting all marks:', error);
                alert('Error deleting marks. Please try again.');
                // Reload marks to ensure consistent state
                await loadMarks(subjectTag);
                await handleSubjectChange();
            }
        }
    });

    // Add event listeners for individual delete buttons
    document.querySelectorAll('.delete-mark').forEach(button => {
        button.addEventListener('click', async function() {
            const category = this.dataset.category;
            const index = parseInt(this.dataset.index);

            if (confirm('Are you sure you want to delete this mark?')) {
                try {
                    // Remove the mark from the array
                    marks[subjectTag][category].splice(index, 1);

                    // Save updated marks to localStorage
                    localStorage.setItem('subjectMarks', JSON.stringify(marks));

                    // Save to Firestore
                    await window.saveSubjectMarksToFirestore(marks);

                    // Recalculate performance
                    await window.updateSubjectPerformance(subjectTag);

                    // Reload marks from storage to ensure sync
                    await loadMarks(subjectTag);

                    // Refresh display
                    await handleSubjectChange();

                    // Show success message
                    alert('Mark deleted successfully!');
                } catch (error) {
                    console.error('Error deleting mark:', error);
                    alert('Error deleting mark. Please try again.');
                    // Reload marks to ensure consistent state
                    await loadMarks(subjectTag);
                    await handleSubjectChange();
                }
            }
        });
    });
}

/**
 * Check for saved theme preference
 */
function initTheme() {
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-theme');
        document.querySelector('.theme-icon').textContent = '🌚';
        document.querySelector('.theme-text').textContent = 'Dark Mode';
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    setupAuthStateListener();
    initTheme();
    init();

    // Make toggleTheme available globally for the theme toggle button
    window.toggleTheme = toggleTheme;
});

// Export functions for potential use in other modules
export {
    toggleTheme,
    loadSubjects,
    handleSubjectChange,
    saveWeightages,
    addMark
};
