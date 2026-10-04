/**
 * ModalFactory - Centralized modal generation utility
 * 
 * Creates Bootstrap modals from configuration objects, eliminating
 * the need for repeated modal HTML boilerplate.
 * 
 * @module ModalFactory
 */

import { ToastService } from '../services/ToastService.js';

/**
 * Default modal configuration
 */
const MODAL_DEFAULTS = {
    size: '', // '', 'modal-sm', 'modal-lg', 'modal-xl'
    centered: false,
    scrollable: false,
    backdrop: true,
    keyboard: true,
    headerClass: '',
    footerClass: ''
};

/**
 * Semester template buttons configuration
 * Reused across multiple semester-related modals
 */
export const SEMESTER_TEMPLATES = [
    { template: 'Fall {year}', label: 'Fall' },
    { template: 'Spring {year}', label: 'Spring' },
    { template: 'Summer {year}', label: 'Summer' },
    { template: 'Winter {year}', label: 'Winter' },
    { template: '1st Year', label: '1st Year' },
    { template: '2nd Year', label: '2nd Year' },
    { template: '3rd Year', label: '3rd Year' },
    { template: '4th Year', label: '4th Year' }
];

/**
 * Generates semester template buttons HTML
 * @param {string} targetInputId - ID of the input to populate on click
 * @returns {string} HTML string for template buttons
 */
export function generateSemesterTemplateButtons(targetInputId) {
    const year = new Date().getFullYear();

    return `
        <div class="mt-2">
            <small class="text-muted">Suggested formats:</small>
            <div class="d-flex flex-wrap gap-1 mt-1">
                ${SEMESTER_TEMPLATES.map(t => `
                    <button type="button" 
                            class="btn btn-sm btn-outline-secondary semester-template"
                            data-template="${t.template}"
                            data-target="${targetInputId}">${t.label}</button>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * Generates priority semester checkbox HTML
 * @param {string} id - Checkbox ID
 * @param {boolean} checked - Default checked state
 * @returns {string} HTML string
 */
export function generatePriorityCheckbox(id, checked = true) {
    return `
        <div class="form-check mb-3">
            <input class="form-check-input" type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
            <label class="form-check-label" for="${id}">
                Set as priority semester (syncs first when storage is limited)
            </label>
        </div>
    `;
}

/**
 * Generates color tag buttons HTML
 * @returns {string} HTML string for color tag buttons
 */
export function generateColorTagButtons() {
    const colors = [
        { value: 'danger', label: 'Red', outline: 'danger' },
        { value: 'success', label: 'Green', outline: 'success' },
        { value: 'primary', label: 'Blue', outline: 'primary' },
        { value: 'warning', label: 'Yellow', outline: 'warning' },
        { value: 'info', label: 'Teal', outline: 'info' },
        { value: 'secondary', label: 'Gray', outline: 'secondary' },
        { value: 'dark', label: 'Black', outline: 'dark' },
        { value: '', label: 'None', outline: 'secondary' }
    ];

    return `
        <div class="mb-3">
            <label class="form-label">Color Tag:</label>
            <div class="color-tags-container d-flex flex-wrap gap-2">
                ${colors.map(c => `
                    <button type="button" 
                            class="btn btn-sm btn-outline-${c.outline} color-tag-btn"
                            data-color="${c.value}"
                            data-action="selectColorTag">${c.label}</button>
                `).join('')}
            </div>
        </div>
        <input type="hidden" id="editSemesterColor" value="">
    `;
}

/**
 * Creates a Bootstrap modal element from configuration
 * @param {Object} config - Modal configuration
 * @returns {HTMLElement} Modal element
 */
export function createModal(config) {
    const options = { ...MODAL_DEFAULTS, ...config };

    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.id = config.id;
    modal.tabIndex = -1;
    modal.setAttribute('aria-labelledby', `${config.id}Label`);
    modal.setAttribute('aria-hidden', 'true');

    if (options.backdrop === 'static') {
        modal.setAttribute('data-bs-backdrop', 'static');
    }
    if (!options.keyboard) {
        modal.setAttribute('data-bs-keyboard', 'false');
    }

    const dialogClasses = [
        'modal-dialog',
        options.size,
        options.centered ? 'modal-dialog-centered' : '',
        options.scrollable ? 'modal-dialog-scrollable' : ''
    ].filter(Boolean).join(' ');

    modal.innerHTML = `
        <div class="${dialogClasses}">
            <div class="modal-content">
                <div class="modal-header ${options.headerClass}">
                    <h5 class="modal-title" id="${config.id}Label">${config.title}</h5>
                    <button type="button" class="btn-close${options.headerClass.includes('text-white') ? ' btn-close-white' : ''}" 
                            data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    ${config.body}
                </div>
                ${config.footer ? `
                <div class="modal-footer ${options.footerClass}">
                    ${config.footer}
                </div>
                ` : ''}
            </div>
        </div>
    `;

    return modal;
}

/**
 * Modal configurations for academic-details page
 */
export const ACADEMIC_MODAL_CONFIGS = {
    copySemester: {
        id: 'copySemesterModal',
        title: 'Copy Subjects to New Semester',
        body: `
            <div class="mb-3">
                <label for="sourceSelector" class="form-label">Source Semester:</label>
                <select id="sourceSelector" class="form-select">
                    <!-- Options populated dynamically -->
                </select>
            </div>
            <div class="mb-3">
                <label for="newSemesterName" class="form-label">New Semester Name:</label>
                <input type="text" class="form-control" id="newSemesterName" placeholder="e.g., Spring 2023">
                ${generateSemesterTemplateButtons('newSemesterName')}
            </div>
            <div class="mb-3">
                <label for="semesterDescription" class="form-label">Semester Description (optional):</label>
                <textarea class="form-control" id="semesterDescription" rows="2" 
                          placeholder="Brief description of this semester"></textarea>
            </div>
            ${generatePriorityCheckbox('setPrioritySemester', true)}
        `,
        footer: `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" data-action="copySubjectsToNewSemester">Copy Subjects</button>
        `
    },

    newSemester: {
        id: 'newSemesterModal',
        title: 'Create New Semester',
        body: `
            <div class="mb-3">
                <label for="createSemesterName" class="form-label">Semester Name:</label>
                <input type="text" class="form-control" id="createSemesterName" placeholder="e.g., Spring 2023">
                ${generateSemesterTemplateButtons('createSemesterName')}
            </div>
            <div class="mb-3">
                <label for="createSemesterDescription" class="form-label">Semester Description (optional):</label>
                <textarea class="form-control" id="createSemesterDescription" rows="2" 
                          placeholder="Brief description of this semester"></textarea>
            </div>
            ${generatePriorityCheckbox('createPrioritySemester', true)}
        `,
        footer: `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" data-action="createNewSemester">Create Semester</button>
        `
    },

    editSemester: {
        id: 'editSemesterModal',
        title: 'Edit Semester Details',
        body: `
            <div class="alert alert-info">
                <i class="bi bi-info-circle"></i> Editing semester details will not affect your saved subjects.
            </div>
            
            <!-- Preview Card -->
            <div class="semester-preview-card mb-4">
                <h5>Preview</h5>
                <div class="card p-3">
                    <div class="d-flex align-items-center mb-2">
                        <h4 id="previewSemesterName" class="m-0">Semester Name</h4>
                        <div class="ms-2" id="previewBadges"></div>
                    </div>
                    <p id="previewSemesterDescription" class="text-muted mb-0 small">
                        Semester description will appear here
                    </p>
                </div>
            </div>
            
            <div class="mb-3">
                <label for="editSemesterName" class="form-label">Semester Name:</label>
                <input type="text" class="form-control" id="editSemesterName" data-action="updateSemesterPreview">
                <div class="invalid-feedback" id="editSemesterNameFeedback">
                    Please enter a valid semester name
                </div>
                ${generateSemesterTemplateButtons('editSemesterName')}
            </div>
            <div class="mb-3">
                <label for="editSemesterDescription" class="form-label">Semester Description:</label>
                <textarea class="form-control" id="editSemesterDescription" rows="2" 
                          data-action="updateSemesterPreview"></textarea>
            </div>
            ${generatePriorityCheckbox('editPrioritySemester', false)}
            ${generateColorTagButtons()}
        `,
        footer: `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" data-action="saveSemesterDetails">Save Changes</button>
        `
    },

    archiveSemester: {
        id: 'archiveSemesterModal',
        title: 'Archive Semester',
        headerClass: 'bg-warning text-dark',
        body: `
            <div class="alert alert-warning">
                <i class="bi bi-exclamation-triangle"></i>
                <strong>Are you sure you want to archive this semester?</strong>
            </div>
            <p>You are about to archive semester <strong id="archiveSemesterName"></strong>.</p>
            <ul>
                <li>Archived semesters will be hidden unless "Show Archived" is checked</li>
                <li>This action can be reversed by editing the semester details later</li>
                <li>All data will be preserved</li>
            </ul>
        `,
        footer: `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-warning" id="confirmArchiveBtn" data-action="confirmArchiveSemester">Archive Semester</button>
        `
    },

    deleteSemester: {
        id: 'deleteSemesterModal',
        title: 'Delete Semester',
        headerClass: 'bg-danger text-white',
        body: `
            <div class="alert alert-danger">
                <i class="bi bi-exclamation-triangle-fill"></i>
                <strong>Warning: This action cannot be undone!</strong>
            </div>
            <p>You are about to permanently delete semester <strong id="deleteSemesterName"></strong>.</p>
            <p>All subjects and associated data for this semester will be permanently lost.</p>
            
            <div class="mt-4">
                <label class="form-label">Confirmation:</label>
                <p class="text-muted small">To confirm deletion, type <strong id="deleteConfirmationCode"></strong> below:</p>
                <input type="text" class="form-control" id="deleteConfirmationInput" 
                       placeholder="Type confirmation text here" data-action="validateDeleteConfirmation">
                <div class="invalid-feedback">
                    Please type the confirmation text exactly as shown
                </div>
            </div>
        `,
        footer: `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-danger" id="confirmDeleteBtn" data-action="confirmDeleteSemester" disabled>Delete Permanently</button>
        `
    }
};

/**
 * Injects all modals into the page
 * @param {Object} configs - Modal configurations object
 * @param {HTMLElement} container - Container to append modals to (default: document.body)
 */
export function injectModals(configs = ACADEMIC_MODAL_CONFIGS, container = document.body) {
    Object.values(configs).forEach(config => {
        // Remove existing modal with same ID
        const existing = document.getElementById(config.id);
        if (existing) {
            existing.remove();
        }

        const modal = createModal(config);
        container.appendChild(modal);
    });

    // Set up semester template button handlers
    setupSemesterTemplateHandlers();
}

/**
 * Sets up event delegation for semester template buttons
 */
function setupSemesterTemplateHandlers() {
    document.addEventListener('click', (e) => {
        const templateBtn = e.target.closest('.semester-template');
        if (!templateBtn) return;

        const template = templateBtn.dataset.template;
        const targetId = templateBtn.dataset.target;
        const targetInput = document.getElementById(targetId);

        if (targetInput && template) {
            const year = new Date().getFullYear();
            targetInput.value = template.replace('{year}', year);
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
}

/**
 * Gets a Bootstrap modal instance
 * @param {string} id - Modal ID
 * @returns {bootstrap.Modal|null} Modal instance
 */
export function getModalInstance(id) {
    const element = document.getElementById(id);
    if (!element || !window.bootstrap) return null;
    return window.bootstrap.Modal.getOrCreateInstance(element);
}

/**
 * Shows a modal by ID
 * @param {string} id - Modal ID
 */
export function showModal(id) {
    const modal = getModalInstance(id);
    if (modal) modal.show();
}

/**
 * Hides a modal by ID
 * @param {string} id - Modal ID
 */
export function hideModal(id) {
    const modal = getModalInstance(id);
    if (modal) modal.hide();
}

// Export for global access
if (typeof window !== 'undefined') {
    window.ModalFactory = {
        createModal,
        injectModals,
        showModal,
        hideModal,
        getModalInstance,
        ACADEMIC_MODAL_CONFIGS,
        generateSemesterTemplateButtons,
        generatePriorityCheckbox,
        generateColorTagButtons,
        SEMESTER_TEMPLATES
    };
}

export default {
    createModal,
    injectModals,
    showModal,
    hideModal,
    getModalInstance,
    ACADEMIC_MODAL_CONFIGS,
    generateSemesterTemplateButtons,
    generatePriorityCheckbox,
    generateColorTagButtons,
    SEMESTER_TEMPLATES
};
