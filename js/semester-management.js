/**
 * Semester Management Module
 * Handles semester creation, switching, archiving, and deletion
 * 
 * Refactored to use centralized utilities:
 * - StorageAdapter for storage operations
 * - SemesterService for semester state management
 * - ToastService for notifications
 */

import { getStorage, STORAGE_KEYS } from './utils/StorageAdapter.js';
import { SemesterService } from './services/SemesterService.js';
import { ToastService } from './services/ToastService.js';

// Use SemesterService for current semester (getter for backward compatibility)
const getCurrentSemester = () => SemesterService.getCurrentSemester();
const setCurrentSemester = (semester) => SemesterService.setCurrentSemester(semester);

// Make updateSemesterSelector available globally
window.updateSemesterSelector = updateSemesterSelector;

async function updateSemesterSelector() {
    const storage = getStorage();
    try {
        // Get existing semesters from storage
        const allSemesters = storage.get('academicSemesters', {});
        const semesterSelector = document.getElementById('semesterSelector');
        const showArchived = document.getElementById('showArchivedSemesters')?.checked || false;

        if (!semesterSelector) return;

        // Save current value
        const currentValue = semesterSelector.value;

        // Clear options
        semesterSelector.innerHTML = '';

        // Try to get semesters from Firestore if user is authenticated
        if (window.auth?.currentUser) {
            try {
                const { listUserSemesters } = await import('./firestore.js');
                const firestoreSemesters = await listUserSemesters();

                // Add any Firestore semesters that don't exist locally
                firestoreSemesters.forEach(fsemester => {
                    if (!allSemesters[fsemester.id]) {
                        allSemesters[fsemester.id] = {
                            subjects: [], // Will be loaded when selected
                            lastUpdated: new Date().toISOString(),
                            fromFirestore: true,
                            storageStatus: 'cloud',
                            lastSynced: new Date().toISOString()
                        };
                    } else if (allSemesters[fsemester.id].storageStatus === 'local') {
                        // Update status if it exists locally but was marked as local-only
                        allSemesters[fsemester.id].storageStatus = 'both';
                    }
                });

                // Update storage with any new semesters
                storage.set('academicSemesters', allSemesters);

                console.log('Merged Firestore semesters with local semesters');
            } catch (error) {
                console.warn('Error loading semesters from Firestore:', error);
                // Continue with local semesters
            }
        }

        // Sort semesters by priority first, then by last updated date
        const sortedSemesters = Object.entries(allSemesters)
            .filter(([_, data]) => showArchived || !data.isArchived) // Filter archived semesters unless showArchived is true
            .sort((a, b) => {
                // Sort by priority first
                if (a[1].isPriority && !b[1].isPriority) return -1;
                if (!a[1].isPriority && b[1].isPriority) return 1;

                // Then by archived status (non-archived first)
                if (!a[1].isArchived && b[1].isArchived) return -1;
                if (a[1].isArchived && !b[1].isArchived) return 1;

                // Then by last updated date (most recent first)
                const dateA = new Date(a[1].lastUpdated || 0);
                const dateB = new Date(b[1].lastUpdated || 0);
                return dateB - dateA;
            });

        // Group semesters by type for better organization
        const currentSemesters = [];
        const archivedSemesters = [];

        sortedSemesters.forEach(([semester, data]) => {
            if (data.isArchived) {
                archivedSemesters.push([semester, data]);
            } else {
                currentSemesters.push([semester, data]);
            }
        });

        // Add current semesters
        if (currentSemesters.length > 0) {
            // Create a group label if we have any current semesters
            const currentGroup = document.createElement('optgroup');
            currentGroup.label = 'Current Semesters';
            semesterSelector.appendChild(currentGroup);

            // Add all current semesters
            currentSemesters.forEach(([semester, data]) => {
                const option = document.createElement('option');
                option.value = semester;

                // Create a rich display for the semester
                let optionText = semester;

                // Add status indicators
                if (data.isPriority) {
                    optionText += ' ⭐'; // Star for priority
                }

                // Add storage status
                if (data.storageStatus === 'both') {
                    optionText += ' ☁️'; // Cloud for synced
                }

                // Add subject count if available
                if (data.subjects && data.subjects.length > 0) {
                    optionText += ` (${data.subjects.length})`;
                }

                option.textContent = optionText;

                // Add color if specified
                if (data.colorTag) {
                    option.style.color = `var(--bs-${data.colorTag})`;
                    option.style.fontWeight = 'bold';
                }

                // Add data attributes for additional information
                option.dataset.priority = data.isPriority ? 'true' : 'false';
                option.dataset.status = data.storageStatus || 'local';
                option.dataset.count = data.subjects ? data.subjects.length : 0;

                currentGroup.appendChild(option);
            });
        }

        // Add archived semesters if showing archived is enabled
        if (archivedSemesters.length > 0 && showArchived) {
            // Create a group label for archived semesters
            const archivedGroup = document.createElement('optgroup');
            archivedGroup.label = 'Archived Semesters';
            semesterSelector.appendChild(archivedGroup);

            // Add all archived semesters
            archivedSemesters.forEach(([semester, data]) => {
                const option = document.createElement('option');
                option.value = semester;

                // Create a rich display for the semester
                let optionText = semester;

                // Add archived indicator
                optionText += ' 🗄️'; // Archive icon

                // Add subject count if available
                if (data.subjects && data.subjects.length > 0) {
                    optionText += ` (${data.subjects.length})`;
                }

                option.textContent = optionText;
                option.style.color = '#6c757d'; // Muted color for archived
                option.style.fontStyle = 'italic';

                // Add data attributes
                option.dataset.archived = 'true';
                option.dataset.status = data.storageStatus || 'local';
                option.dataset.count = data.subjects ? data.subjects.length : 0;

                archivedGroup.appendChild(option);
            });
        }

        // Add a separator
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '──────────';
        semesterSelector.appendChild(separator);

        // Add a "New Semester" option
        const newOption = document.createElement('option');
        newOption.value = '';
        newOption.textContent = '+ New Semester';
        newOption.className = 'text-primary fw-bold';
        semesterSelector.appendChild(newOption);

        // Restore current selection if it exists and isn't archived (unless showing archived)
        const currentSemesterValue = getCurrentSemester();
        if (currentValue && Object.keys(allSemesters).includes(currentValue) &&
            (showArchived || !allSemesters[currentValue]?.isArchived)) {
            semesterSelector.value = currentValue;
        } else {
            // Otherwise set to current semester if it's not archived or to the first non-archived semester
            if (showArchived || !allSemesters[currentSemesterValue]?.isArchived) {
                semesterSelector.value = currentSemesterValue;
            } else {
                // Find first non-archived semester
                const firstNonArchived = sortedSemesters.find(([_, data]) => !data.isArchived);
                if (firstNonArchived) {
                    setCurrentSemester(firstNonArchived[0]);
                    semesterSelector.value = firstNonArchived[0];
                } else {
                    // If all are archived, just use the first one
                    if (sortedSemesters.length > 0) {
                        setCurrentSemester(sortedSemesters[0][0]);
                        semesterSelector.value = sortedSemesters[0][0];
                    }
                }
            }
        }

        // Update the current semester title and description
        const currentSem = getCurrentSemester();
        const semesterData = allSemesters[currentSem];
        if (semesterData) {
            const semesterTitle = document.getElementById('currentSemesterTitle');
            const semesterDescription = document.getElementById('currentSemesterDescription');

            if (semesterTitle) {
                // Apply color if specified
                if (semesterData.colorTag) {
                    semesterTitle.style.color = `var(--bs-${semesterData.colorTag})`;
                } else {
                    semesterTitle.style.color = ''; // Reset to default
                }

                // Set title text with appropriate badges
                semesterTitle.innerHTML = currentSem;

                // Add badges for status
                let badges = '';

                if (semesterData.isArchived) {
                    badges += ' <span class="badge bg-secondary">Archived</span>';
                }

                if (semesterData.isPriority) {
                    badges += ' <span class="badge bg-warning text-dark">Priority</span>';
                }

                if (semesterData.storageStatus === 'both' || semesterData.storageStatus === 'cloud') {
                    badges += ' <span class="badge bg-info text-dark">Cloud Synced</span>';
                }

                semesterTitle.innerHTML += badges;
            }

            if (semesterDescription) {
                semesterDescription.textContent = semesterData.description || '';
            }
        }

        // Update sync status indicators
        updateSyncStatus();

        // Update storage usage display
        updateStorageUsage();

    } catch (error) {
        console.error('Error updating semester selector:', error);
    }
}

/**
 * Handle semester change from selector
 */
function handleSemesterChange() {
    const semesterSelector = document.getElementById('semesterSelector');
    const selectedSemester = semesterSelector.value;

    if (!selectedSemester) {
        // "New Semester" option selected, show the new semester modal
        showNewSemesterModal();

        // Revert to previous selection
        semesterSelector.value = getCurrentSemester();
        return;
    }

    // User selected an existing semester
    // Add visual feedback for semester change
    const oldSemester = getCurrentSemester();
    setCurrentSemester(selectedSemester);

    // Show a subtle toast notification for semester change
    const message = selectedSemester === 'default'
        ? 'Switched to Default Semester'
        : `Switched to "${selectedSemester}"`;
    ToastService.info(message);

    // Load and display the selected semester's subjects immediately (using cache first)
    if (typeof window.displaySavedSubjects === 'function') {
        window.displaySavedSubjects();
    } else {
        console.warn('displaySavedSubjects not yet available');
    }
}

/**
 * Initialize semester management module
 * Called by the main entry point (academic-details.js) to avoid duplicate initialization
 */
export async function initSemesterManagement() {
    const storage = getStorage();
    try {
        // Log version information
        console.log('[SemesterManagement] Initializing v2.0');

        // Debug logging for initial state
        logSemesterDebugInfo();

        // Wait for auth to be ready using a Promise-based approach
        await waitForAuth();

        // Set up semester selector listener
        const semesterSelector = document.getElementById('semesterSelector');
        if (semesterSelector) {
            semesterSelector.addEventListener('change', handleSemesterChange);
        }

        // Set up archived semesters toggle
        const showArchivedCheckbox = document.getElementById('showArchivedSemesters');
        if (showArchivedCheckbox) {
            // Initialize with saved preference
            showArchivedCheckbox.checked = storage.get('showArchivedSemesters', false) === true;

            // Add change listener
            showArchivedCheckbox.addEventListener('change', function () {
                storage.set('showArchivedSemesters', this.checked);
                updateSemesterSelector();
            });
        }

        // Setup template buttons in modals
        setupSemesterTemplateButtons('newSemesterName');
        setupSemesterTemplateButtons('createSemesterName');

        // Migrate old data format if needed
        await migrateToSemesterSystem();

        // Initialize storage usage display
        updateStorageUsage();

        console.log('[SemesterManagement] Initialization complete');

    } catch (error) {
        console.error('[SemesterManagement] Error during initialization:', error);
        throw error; // Re-throw to let parent handler deal with it
    }
}

/**
 * Wait for Firebase auth to be initialized
 * Returns a Promise that resolves when auth state is determined
 */
function waitForAuth() {
    return new Promise((resolve) => {
        // If auth is not available yet, resolve immediately
        if (!window.auth) {
            console.debug('[SemesterManagement] Auth not available, continuing without auth');
            resolve(null);
            return;
        }

        // Wait for auth state change
        const unsubscribe = window.auth.onAuthStateChanged((user) => {
            unsubscribe(); // Stop listening after first call
            console.debug('[SemesterManagement] Auth state resolved:', user ? 'logged in' : 'logged out');
            resolve(user);
        });

        // Timeout after 5 seconds to prevent hanging
        setTimeout(() => {
            console.debug('[SemesterManagement] Auth timeout, continuing');
            resolve(null);
        }, 5000);
    });
}



/**
 * Debug function to log semester system information
 */
function logSemesterDebugInfo() {
    const storage = getStorage();
    try {
        console.group('Semester System Debug Info');
        console.log('Current Semester:', storage.get('currentAcademicSemester', 'Not set'));
        console.log('Migration Done:', storage.get('semesterMigrationDone', 'Not done'));

        const allSemesters = storage.get('academicSemesters', {});
        console.log('Available Semesters:', Object.keys(allSemesters));

        if (Object.keys(allSemesters).length > 0) {
            console.log('Semester Data Sample:', allSemesters[Object.keys(allSemesters)[0]]);
        }

        const legacySubjects = storage.get('academicSubjects', []);
        console.log('Legacy Subjects Count:', legacySubjects.length);

        console.groupEnd();
    } catch (error) {
        console.error('Error in debug logging:', error);
    }
}

// Migrate existing data to the new semester system
async function migrateToSemesterSystem() {
    const storage = getStorage();
    try {
        // Check if migration has already been done
        if (storage.get('semesterMigrationDone', null)) {
            return;
        }

        // Get existing subjects
        const existingSubjects = storage.get('academicSubjects', []);

        if (existingSubjects.length > 0) {
            // Create default semester with existing subjects
            const allSemesters = {};
            allSemesters['default'] = {
                subjects: existingSubjects,
                lastUpdated: new Date().toISOString()
            };

            // Store in storage
            storage.set('academicSemesters', allSemesters);
            storage.set('currentAcademicSemester', 'default');

            // Mark migration as done
            storage.set('semesterMigrationDone', true);

            console.log('Successfully migrated existing data to semester system');
        }
    } catch (error) {
        console.error('Error migrating to semester system:', error);
    }
}







/**
 * Shows the copy semester modal and populates the source selector
 */
function showCopySemesterModal() {
    const storage = getStorage();
    try {
        // Get existing semesters
        const allSemesters = storage.get('academicSemesters', {});
        const sourceSelector = document.getElementById('sourceSelector');

        // Clear existing options
        sourceSelector.innerHTML = '';

        // Add all existing semesters as options
        Object.keys(allSemesters).forEach(semester => {
            const option = document.createElement('option');
            option.value = semester;
            option.textContent = semester;
            sourceSelector.appendChild(option);
        });

        // Set current semester as default selection
        sourceSelector.value = getCurrentSemester();

        // Clear the new semester name field
        document.getElementById('newSemesterName').value = '';

        // Show the modal
        const modal = new bootstrap.Modal(document.getElementById('copySemesterModal'));
        modal.show();
    } catch (error) {
        console.error('Error showing copy semester modal:', error);
        ToastService.error('Error preparing the copy semester dialog. Please try again.');
    }
}

/**
 * Copies subjects from the selected source semester to a new semester
 */
async function copySubjectsToNewSemester() {
    const storage = getStorage();
    try {
        const sourceSemester = document.getElementById('sourceSelector').value;
        const newSemesterName = document.getElementById('newSemesterName').value.trim();
        const description = document.getElementById('semesterDescription').value.trim();
        const isPriority = document.getElementById('setPrioritySemester').checked;

        if (!newSemesterName) {
            ToastService.warning('Please enter a name for the new semester');
            return;
        }

        // Get existing semesters
        const allSemesters = storage.get('academicSemesters', {});

        // Check if the new semester name already exists
        if (allSemesters[newSemesterName]) {
            if (!confirm(`A semester named "${newSemesterName}" already exists. Do you want to overwrite it?`)) {
                return;
            }
        }

        // Get source semester data
        const sourceData = allSemesters[sourceSemester];
        if (!sourceData || !sourceData.subjects || sourceData.subjects.length === 0) {
            ToastService.warning('The source semester has no subjects to copy');
            return;
        }

        // Create new semester with source subjects
        allSemesters[newSemesterName] = {
            subjects: [...sourceData.subjects], // Create a copy of the subjects array
            lastUpdated: new Date().toISOString(),
            copiedFrom: sourceSemester,
            description: description,
            isPriority: isPriority,
            created: new Date().toISOString(),
            isArchived: false,
            storageStatus: 'local' // Will be updated if sync is successful
        };

        // Save to storage
        storage.set('academicSemesters', allSemesters);

        // Set the new semester as current
        setCurrentSemester(newSemesterName);

        // Try to save to Firestore if user is signed in
        if (window.auth?.currentUser) {
            try {
                await window.saveSubjectsToFirestore(sourceData.subjects, newSemesterName);
                // Update storage status
                allSemesters[newSemesterName].storageStatus = 'both';
                allSemesters[newSemesterName].lastSynced = new Date().toISOString();
                storage.set('academicSemesters', allSemesters);

                console.log(`Copied subjects from ${sourceSemester} to ${newSemesterName} in Firestore`);
            } catch (error) {
                console.error('Error saving copied subjects to Firestore:', error);
                // Continue anyway since we've saved locally
            }
        }

        // Close the modal
        bootstrap.Modal.getInstance(document.getElementById('copySemesterModal')).hide();

        // Update UI
        updateSemesterSelector();
        window.displaySavedSubjects?.();

        // Show success message
        ToastService.success(`Successfully copied subjects from "${sourceSemester}" to "${newSemesterName}"`);
    } catch (error) {
        console.error('Error copying subjects to new semester:', error);
        ToastService.error('An error occurred while copying subjects. Please try again.');
    }
}

/**
 * Shows the semester template modal
 */
function showNewSemesterModal() {
    try {
        // Clear previous values
        document.getElementById('createSemesterName').value = '';
        document.getElementById('createSemesterDescription').value = '';
        document.getElementById('createPrioritySemester').checked = true;

        // Show the modal
        const modal = new bootstrap.Modal(document.getElementById('newSemesterModal'));
        modal.show();

        // Setup template buttons
        setupSemesterTemplateButtons('createSemesterName');
    } catch (error) {
        console.error('Error showing new semester modal:', error);
        ToastService.error('Error preparing the new semester dialog. Please try again.');
    }
}

/**
 * Creates a new semester from the modal
 */
async function createNewSemester() {
    const storage = getStorage();
    try {
        // Get form values
        const semesterNameInput = document.getElementById('createSemesterName');
        const semesterName = semesterNameInput.value.trim();
        const description = document.getElementById('createSemesterDescription').value.trim();
        const isPriority = document.getElementById('createPrioritySemester').checked;

        // Validate semester name with visual feedback
        if (!semesterName) {
            semesterNameInput.classList.add('is-invalid');
            // Add validation message if not already there
            if (!document.getElementById('createSemesterNameFeedback')) {
                const feedbackDiv = document.createElement('div');
                feedbackDiv.id = 'createSemesterNameFeedback';
                feedbackDiv.className = 'invalid-feedback';
                feedbackDiv.textContent = 'Please enter a name for the new semester';
                semesterNameInput.parentNode.appendChild(feedbackDiv);
            }
            return;
        } else {
            semesterNameInput.classList.remove('is-invalid');
        }

        // Get existing semesters
        const allSemesters = storage.get('academicSemesters', {});

        // Check if the semester name already exists
        if (allSemesters[semesterName]) {
            // Show confirmation modal with Bootstrap
            if (!window.confirm(`A semester named "${semesterName}" already exists. Overwriting will replace its data. Continue?`)) {
                return;
            }
        }

        // Show loading spinner on the create button
        const createButton = document.querySelector('#newSemesterModal .modal-footer .btn-primary');
        const originalButtonText = createButton.innerHTML;
        createButton.disabled = true;
        createButton.innerHTML = `
                <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                Creating...
            `;

        // Create new semester with empty subjects
        allSemesters[semesterName] = {
            subjects: [],
            lastUpdated: new Date().toISOString(),
            description: description,
            isPriority: isPriority,
            created: new Date().toISOString(),
            isArchived: false,
            storageStatus: 'local' // 'local', 'cloud', 'both'
        };

        // Save to storage
        storage.set('academicSemesters', allSemesters);

        // Set the new semester as current
        setCurrentSemester(semesterName);

        // Try to create in Firestore if user is signed in
        if (window.auth?.currentUser) {
            try {
                await window.saveSubjectsToFirestore([], semesterName);
                allSemesters[semesterName].storageStatus = 'both';
                storage.set('academicSemesters', allSemesters);
                console.log(`Created new semester ${semesterName} in Firestore`);
            } catch (error) {
                console.error('Error creating new semester in Firestore:', error);
                // Continue anyway since we've saved locally
            }
        }

        // Close the modal
        bootstrap.Modal.getInstance(document.getElementById('newSemesterModal')).hide();

        // Reset form for next use
        document.getElementById('createSemesterName').value = '';
        document.getElementById('createSemesterDescription').value = '';

        // Update UI with a brief delay for better visual effect
        setTimeout(() => {
            // Restore button state
            createButton.disabled = false;
            createButton.innerHTML = originalButtonText;

            // Update UI
            updateSemesterSelector();
            window.displaySavedSubjects?.();

            // Show success toast using ToastService
            ToastService.success(`Semester "${semesterName}" created successfully!`);
        }, 500);

    } catch (error) {
        console.error('Error creating new semester:', error);
        ToastService.error('An error occurred while creating the semester. Please try again.');

        // Reset button state in case of error
        const createButton = document.querySelector('#newSemesterModal .modal-footer .btn-primary');
        createButton.disabled = false;
        createButton.innerHTML = 'Create Semester';
    }
}

/**
 * Setup semester template buttons to insert template text
 * @param {string} targetInputId - The ID of the input field to update
 */
function setupSemesterTemplateButtons(targetInputId) {
    const buttons = document.querySelectorAll('.semester-template');
    const targetInput = document.getElementById(targetInputId);

    if (!targetInput) return;

    buttons.forEach(button => {
        button.addEventListener('click', function () {
            const template = this.getAttribute('data-template');
            let semesterName = template;

            // Replace {year} with current year
            if (template.includes('{year}')) {
                const currentYear = new Date().getFullYear();
                semesterName = template.replace('{year}', currentYear);
            }

            targetInput.value = semesterName;
        });
    });
}

/**
 * Updates the semester preview in the edit modal
 */
function updateSemesterPreview() {
    // Get values from form
    const name = document.getElementById('editSemesterName').value || 'Semester Name';
    const description = document.getElementById('editSemesterDescription').value || 'No description provided';
    const isPriority = document.getElementById('editPrioritySemester').checked;
    const colorTag = document.getElementById('editSemesterColor').value;

    // Update preview elements
    const previewName = document.getElementById('previewSemesterName');
    const previewDesc = document.getElementById('previewSemesterDescription');
    const previewBadges = document.getElementById('previewBadges');

    // Update text content
    previewName.textContent = name;
    previewDesc.textContent = description;

    // If we have a color tag, apply it to the preview name
    if (colorTag) {
        previewName.style.color = `var(--bs-${colorTag})`;
    } else {
        previewName.style.color = ''; // Reset to default
    }

    // Add badges
    let badgesHTML = '';

    if (isPriority) {
        badgesHTML += '<span class="badge bg-warning text-dark ms-1">Priority</span>';
    }

    // Set badges HTML
    previewBadges.innerHTML = badgesHTML;
}

/**
 * Selects a color tag and updates the preview
 */
function selectColorTag(buttonElement, colorValue) {
    // Remove active class from all buttons
    document.querySelectorAll('.color-tag-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Add active class to the clicked button
    buttonElement.classList.add('active');

    // Store the selected color value
    document.getElementById('editSemesterColor').value = colorValue;

    // Update preview
    updateSemesterPreview();
}

/**
 * Edit semester details (name, description, priority)
 */
function editSemesterDetails() {
    const storage = getStorage();
    if (!currentSemester) {
        alert('Please select a semester first');
        return;
    }

    try {
        // Get existing semesters
        const allSemesters = storage.get('academicSemesters', {});
        const semesterData = allSemesters[currentSemester];

        if (!semesterData) {
            alert('Selected semester not found');
            return;
        }

        // Populate the edit modal with current semester data
        document.getElementById('editSemesterName').value = currentSemester;
        document.getElementById('editSemesterDescription').value = semesterData.description || '';
        document.getElementById('editPrioritySemester').checked = semesterData.isPriority || false;

        // Reset validation state
        document.getElementById('editSemesterName').classList.remove('is-invalid');

        // Set the color tag if available
        const colorValue = semesterData.colorTag || '';
        document.getElementById('editSemesterColor').value = colorValue;

        // Highlight the selected color button
        document.querySelectorAll('.color-tag-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.color === colorValue) {
                btn.classList.add('active');
            }
        });

        // Setup semester template buttons
        setupSemesterTemplateButtons('editSemesterName');

        // Update the preview
        updateSemesterPreview();

        // Show the modal
        const editModal = new bootstrap.Modal(document.getElementById('editSemesterModal'));
        editModal.show();

    } catch (error) {
        console.error('Error editing semester details:', error);
        alert('An error occurred while preparing to edit the semester details. Please try again.');
    }
}

/**
 * Save edited semester details
 */
function saveSemesterDetails() {
    const storage = getStorage();
    try {
        const newName = document.getElementById('editSemesterName').value.trim();
        const newDescription = document.getElementById('editSemesterDescription').value.trim();
        const isPriority = document.getElementById('editPrioritySemester').checked;
        const colorTag = document.getElementById('editSemesterColor').value;

        if (!newName) {
            alert('Please enter a valid semester name');
            return;
        }

        // Get existing semesters
        const allSemesters = storage.get('academicSemesters', {});
        const semesterData = allSemesters[currentSemester];

        if (!semesterData) {
            alert('Selected semester not found');
            return;
        }

        // Check if name changed and if new name already exists
        if (newName !== currentSemester && allSemesters[newName]) {
            if (!confirm(`A semester named "${newName}" already exists. Do you want to overwrite it?`)) {
                return;
            }
        }

        // Update the semester data
        const updatedData = {
            ...semesterData,
            description: newDescription,
            isPriority: isPriority,
            colorTag: colorTag,
            lastUpdated: new Date().toISOString()
        };

        // If name changed, create new entry and delete the old one
        if (newName !== currentSemester) {
            // Create new entry
            allSemesters[newName] = updatedData;
            // Delete old entry
            delete allSemesters[currentSemester];
            // Update current semester
            currentSemester = newName;
            storage.set('currentAcademicSemester', newName);
        } else {
            // Update existing entry
            allSemesters[currentSemester] = updatedData;
        }

        // Save to storage
        storage.set('academicSemesters', allSemesters);

        // Update Firestore if user is signed in
        if (window.auth?.currentUser) {
            // This will handle the update, we don't need to wait for it
            window.saveSubjectsToFirestore(updatedData.subjects, newName)
                .then(() => {
                    // If name changed, delete the old semester from Firestore
                    if (newName !== currentSemester && window.deleteSemesterFromFirestore) {
                        return window.deleteSemesterFromFirestore(currentSemester);
                    }
                })
                .then(() => {
                    console.log('Semester updated in Firestore');
                    // Update UI to reflect changes
                    updateSemesterSelector();
                    displaySavedSubjects();
                })
                .catch(error => {
                    console.error('Error updating semester in Firestore:', error);
                });
        } else {
            // Just update UI if not signed in
            updateSemesterSelector();
            displaySavedSubjects();
        }

        // Close the modal
        bootstrap.Modal.getInstance(document.getElementById('editSemesterModal')).hide();

        // Show success message with the new name
        const toast = `
                <div class="position-fixed bottom-0 end-0 p-3" style="z-index: 1050">
                    <div class="toast show" role="alert" aria-live="assertive" aria-atomic="true">
                        <div class="toast-header">
                            <strong class="me-auto">Semester Updated</strong>
                            <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
                        </div>
                        <div class="toast-body">
                            <i class="bi bi-check-circle text-success"></i>
                            Semester "${newName}" has been updated successfully.
                        </div>
                    </div>
                </div>
            `;

        // Add toast to the document
        const toastContainer = document.createElement('div');
        toastContainer.innerHTML = toast;
        document.body.appendChild(toastContainer);

        // Remove toast after 3 seconds
        setTimeout(() => {
            document.body.removeChild(toastContainer);
        }, 3000);

    } catch (error) {
        console.error('Error saving semester details:', error);
        alert('An error occurred while saving the semester details. Please try again.');
    }
}

/**
 * Show archive semester confirmation modal
 */
function archiveSemester() {
    const currentSemesterName = getCurrentSemester();
    if (!currentSemesterName || currentSemesterName === 'default') {
        alert('Cannot archive the default semester');
        return;
    }

    // Set the semester name in the confirmation modal
    document.getElementById('archiveSemesterName').textContent = currentSemesterName;

    // Set up the confirmation button
    document.getElementById('confirmArchiveBtn').onclick = function () {
        confirmArchiveSemester();
    };

    // Show the modal
    const archiveModal = new bootstrap.Modal(document.getElementById('archiveSemesterModal'));
    archiveModal.show();
}

/**
 * Confirm and execute the archive semester action
 */
function confirmArchiveSemester() {
    const storage = getStorage();
    try {
        // Show loading state on button
        const confirmBtn = document.getElementById('confirmArchiveBtn');
        const originalBtnText = confirmBtn.innerHTML;
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Archiving...';

        // Get existing semesters
        const allSemesters = storage.get('academicSemesters', {});
        const currentSemesterName = getCurrentSemester();
        const semesterData = allSemesters[currentSemesterName];

        if (!semesterData) {
            alert('Selected semester not found');
            return;
        }

        // Update semester to archived
        allSemesters[currentSemesterName] = {
            ...semesterData,
            isArchived: true,
            archivedDate: new Date().toISOString()
        };

        // Save to storage
        storage.set('academicSemesters', allSemesters);

        // Update Firestore if needed
        if (window.auth?.currentUser && semesterData.storageStatus !== 'local') {
            window.saveSubjectsToFirestore?.(semesterData.subjects, currentSemesterName)
                ?.then(() => {
                    console.log(`Updated archive status for semester ${currentSemesterName} in Firestore`);
                })
                ?.catch(error => {
                    console.error('Error updating archive status in Firestore:', error);
                });
        }

        // Switch to default semester
        setCurrentSemester('default');

        // Close the modal
        bootstrap.Modal.getInstance(document.getElementById('archiveSemesterModal')).hide();

        // Update UI
        updateSemesterSelector();
        window.displaySavedSubjects?.();

        // Show success toast
        const toast = `
                <div class="position-fixed bottom-0 end-0 p-3" style="z-index: 1050">
                    <div class="toast show" role="alert" aria-live="assertive" aria-atomic="true">
                        <div class="toast-header">
                            <strong class="me-auto">Semester Archived</strong>
                            <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
                        </div>
                        <div class="toast-body">
                            <i class="bi bi-archive"></i>
                            The semester has been archived successfully. You can view it by checking "Show Archived".
                        </div>
                    </div>
                </div>
            `;

        // Add toast to the document
        const toastContainer = document.createElement('div');
        toastContainer.innerHTML = toast;
        document.body.appendChild(toastContainer);

        // Remove toast after 3 seconds
        setTimeout(() => {
            document.body.removeChild(toastContainer);
        }, 3000);

    } catch (error) {
        console.error('Error archiving semester:', error);
        alert('An error occurred while archiving the semester. Please try again.');

        // Reset button state
        const confirmBtn = document.getElementById('confirmArchiveBtn');
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = 'Archive Semester';
    }
}

/**
 * Show delete semester confirmation modal
 */
function deleteSemester() {
    const currentSemesterName = getCurrentSemester();
    if (!currentSemesterName || currentSemesterName === 'default') {
        alert('Cannot delete the default semester');
        return;
    }

    // Set the semester name in the confirmation modal
    document.getElementById('deleteSemesterName').textContent = currentSemesterName;

    // Generate a confirmation code
    const confirmCode = `delete-${currentSemesterName}`;
    document.getElementById('deleteConfirmationCode').textContent = confirmCode;

    // Reset confirmation input
    const confirmInput = document.getElementById('deleteConfirmationInput');
    confirmInput.value = '';
    confirmInput.classList.remove('is-invalid');

    // Disable the delete button initially
    document.getElementById('confirmDeleteBtn').disabled = true;

    // Add input event listener to check confirmation code
    confirmInput.addEventListener('input', function () {
        const isValid = this.value === confirmCode;
        document.getElementById('confirmDeleteBtn').disabled = !isValid;

        if (!isValid && this.value.length > 0) {
            this.classList.add('is-invalid');
        } else {
            this.classList.remove('is-invalid');
        }
    });

    // Set up the confirmation button
    document.getElementById('confirmDeleteBtn').onclick = function () {
        if (confirmInput.value === confirmCode) {
            confirmDeleteSemester();
        }
    };

    // Show the modal
    const deleteModal = new bootstrap.Modal(document.getElementById('deleteSemesterModal'));
    deleteModal.show();
}

/**
 * Confirm and execute the delete semester action
 */
function confirmDeleteSemester() {
    const storage = getStorage();
    try {
        // Show loading state on button
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        const originalBtnText = confirmBtn.innerHTML;
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Deleting...';

        const currentSemesterName = getCurrentSemester();
        const semesterToDelete = currentSemesterName;

        // Get existing semesters
        const allSemesters = storage.get('academicSemesters', {});

        // Delete semester
        delete allSemesters[semesterToDelete];

        // Save to storage
        storage.set('academicSemesters', allSemesters);

        // Switch to default semester
        setCurrentSemester('default');

        // Close the modal
        bootstrap.Modal.getInstance(document.getElementById('deleteSemesterModal')).hide();

        // If user is signed in, delete from Firestore as well
        if (window.auth?.currentUser) {
            import('./firestore.js').then(module => {
                module.deleteSemesterFromFirestore(semesterToDelete).then(() => {
                    console.log(`Successfully deleted semester "${semesterToDelete}" from Firestore`);
                }).catch(error => {
                    console.error('Error deleting semester from Firestore:', error);
                });
            }).catch(error => {
                console.error('Error importing Firestore module:', error);
            });
        }

        // Update UI
        updateSemesterSelector();
        window.displaySavedSubjects?.();

        // Show success toast
        const toast = `
                <div class="position-fixed bottom-0 end-0 p-3" style="z-index: 1050">
                    <div class="toast show bg-danger text-white" role="alert" aria-live="assertive" aria-atomic="true">
                        <div class="toast-header bg-danger text-white">
                            <strong class="me-auto">Semester Deleted</strong>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
                        </div>
                        <div class="toast-body">
                            <i class="bi bi-trash"></i>
                            Semester "${semesterToDelete}" has been permanently deleted.
                        </div>
                    </div>
                </div>
            `;

        // Add toast to the document
        const toastContainer = document.createElement('div');
        toastContainer.innerHTML = toast;
        document.body.appendChild(toastContainer);

        // Remove toast after 3 seconds
        setTimeout(() => {
            document.body.removeChild(toastContainer);
        }, 3000);

    } catch (error) {
        console.error('Error deleting semester:', error);
        alert('An error occurred while deleting the semester. Please try again.');

        // Reset button state
        const confirmBtn = document.getElementById('confirmDeleteBtn');
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = 'Delete Permanently';
    }
}

/**
 * Force sync the current semester to Firestore
 */
function forceSyncSemester() {
    const storage = getStorage();
    if (!currentSemester) {
        alert('Please select a semester first');
        return;
    }

    if (!window.auth?.currentUser) {
        alert('Please sign in to sync with the cloud');
        return;
    }

    try {
        const allSemesters = storage.get('academicSemesters', {});
        const semesterData = allSemesters[currentSemester];

        if (!semesterData) {
            alert('Selected semester not found');
            return;
        }

        // Show syncing indicator
        const lastSyncTimeElem = document.getElementById('lastSyncTime');
        if (lastSyncTimeElem) {
            lastSyncTimeElem.textContent = 'Syncing...';
        }

        // Sync to Firestore
        window.saveSubjectsToFirestore(semesterData.subjects, currentSemester).then(() => {
            // Update storage status
            allSemesters[currentSemester].storageStatus = 'both';
            allSemesters[currentSemester].lastSynced = new Date().toISOString();
            storage.set('academicSemesters', allSemesters);

            // Update UI
            updateSyncStatus();

            alert(`Successfully synced semester "${currentSemester}" to cloud storage`);
        }).catch(error => {
            console.error('Error syncing semester to Firestore:', error);
            alert('An error occurred while syncing with the cloud. Please try again.');

            // Update sync status UI
            updateSyncStatus();
        });

    } catch (error) {
        console.error('Error initiating semester sync:', error);
        alert('An error occurred while preparing to sync. Please try again.');
    }
}

/**
 * Update the sync status indicators
 */
function updateSyncStatus() {
    const storage = getStorage();
    try {
        const cloudSyncedBadge = document.getElementById('cloudSyncedBadge');
        const localOnlyBadge = document.getElementById('localOnlyBadge');
        const lastSyncTimeElem = document.getElementById('lastSyncTime');

        if (!cloudSyncedBadge || !localOnlyBadge || !lastSyncTimeElem) return;

        // Hide both badges initially
        cloudSyncedBadge.classList.add('d-none');
        localOnlyBadge.classList.add('d-none');
        lastSyncTimeElem.textContent = '';

        // Get current semester using the getter function (not the undefined variable)
        const currentSemesterValue = getCurrentSemester();
        if (!currentSemesterValue) return;

        const allSemesters = storage.get('academicSemesters', {});
        const semesterData = allSemesters[currentSemesterValue];

        if (!semesterData) return;

        if (semesterData.storageStatus === 'both') {
            // Show cloud synced badge
            cloudSyncedBadge.classList.remove('d-none');

            // Show last sync time if available
            if (semesterData.lastSynced) {
                const lastSync = new Date(semesterData.lastSynced);
                const now = new Date();
                const diffHours = Math.round((now - lastSync) / (1000 * 60 * 60));

                if (diffHours < 1) {
                    lastSyncTimeElem.textContent = 'Last synced: Just now';
                } else if (diffHours < 24) {
                    lastSyncTimeElem.textContent = `Last synced: ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                } else {
                    const diffDays = Math.round(diffHours / 24);
                    lastSyncTimeElem.textContent = `Last synced: ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
                }
            }
        } else {
            // Show local only badge
            localOnlyBadge.classList.remove('d-none');

            if (window.auth?.currentUser) {
                lastSyncTimeElem.textContent = 'Click "Force Sync" to upload to cloud';
            } else {
                lastSyncTimeElem.textContent = 'Sign in to enable cloud sync';
            }
        }

    } catch (error) {
        console.error('Error updating sync status:', error);
    }
}

/**
 * Calculate and update storage usage display
 */
function updateStorageUsage() {
    try {
        const storageUsageBar = document.getElementById('storageUsage');
        const storageUsageText = document.getElementById('storageUsageText');

        if (!storageUsageBar || !storageUsageText) return;

        // Calculate total localStorage usage
        let totalBytes = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);
            totalBytes += (key.length + value.length) * 2; // Each character is 2 bytes
        }

        // Convert to human-readable format
        let usageText = '';
        if (totalBytes < 1024) {
            usageText = `${totalBytes} bytes`;
        } else if (totalBytes < 1024 * 1024) {
            usageText = `${(totalBytes / 1024).toFixed(1)} KB`;
        } else {
            usageText = `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
        }

        // Update the storage usage bar
        // Typically browsers allow ~5-10MB of localStorage
        const maxStorage = 5 * 1024 * 1024; // 5MB
        const usagePercent = Math.min(100, (totalBytes / maxStorage) * 100);

        storageUsageBar.style.width = `${usagePercent}%`;
        storageUsageBar.setAttribute('aria-valuenow', usagePercent);

        // Set color based on usage
        if (usagePercent > 80) {
            storageUsageBar.classList.remove('bg-info');
            storageUsageBar.classList.add('bg-danger');
        } else if (usagePercent > 60) {
            storageUsageBar.classList.remove('bg-info');
            storageUsageBar.classList.add('bg-warning');
        } else {
            storageUsageBar.classList.remove('bg-warning', 'bg-danger');
            storageUsageBar.classList.add('bg-info');
        }

        // Update text
        storageUsageText.textContent = `Local Storage: ${usageText}${usagePercent > 70 ? ' (Consider archiving old semesters)' : ''}`;

    } catch (error) {
        console.error('Error updating storage usage:', error);
        const storageUsageText = document.getElementById('storageUsageText');
        if (storageUsageText) {
            storageUsageText.textContent = 'Error calculating storage usage';
        }
    }
}

/**
 * Show storage manager modal (to be implemented)
 */
function showStorageManager() {
    ToastService.info('Storage Manager: This feature will be implemented in a future update.');
}

// ============================================
// GLOBAL FUNCTION EXPORTS
// These functions are exposed globally for:
// 1. Backward compatibility with existing onclick handlers
// 2. Event delegation from data-action attributes
// ============================================

// Import displaySavedSubjects from subject-management.js
import('./subject-management.js').then(module => {
    // Ensure displaySavedSubjects is available globally from subject-management.js
    if (module.displaySavedSubjects && !window.displaySavedSubjects) {
        window.displaySavedSubjects = module.displaySavedSubjects;
    }
}).catch(err => console.warn('Could not import subject-management.js:', err));

window.showCopySemesterModal = showCopySemesterModal;
window.showNewSemesterModal = showNewSemesterModal;
window.copySubjectsToNewSemester = copySubjectsToNewSemester;
window.createNewSemester = createNewSemester;
window.editSemesterDetails = editSemesterDetails;
window.saveSemesterDetails = saveSemesterDetails;
window.updateSemesterPreview = updateSemesterPreview;
window.selectColorTag = selectColorTag;
window.archiveSemester = archiveSemester;
window.confirmArchiveSemester = confirmArchiveSemester;
window.deleteSemester = deleteSemester;
window.confirmDeleteSemester = confirmDeleteSemester;
window.forceSyncSemester = forceSyncSemester;
window.showStorageManager = showStorageManager;
window.updateSyncStatus = updateSyncStatus;

