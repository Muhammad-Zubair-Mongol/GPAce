/**
 * subject-marks-ui.js - Handles UI interactions for the subject marks page
 * 
 * This module provides:
 * - Proper XSS protection via sanitization
 * - Event delegation for dynamic content
 * - Promise-based initialization
 * - Memory-safe event listener management
 */

import sanitizer from './utils/Sanitizer.js';
import { getStorage } from './utils/StorageAdapter.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { computeObjectHash } from './utils/HashUtils.js';

// ============================================
// Constants
// ============================================
const FIRESTORE_RETRY_DELAY_MS = 1000;
const FIRESTORE_MAX_RETRIES = 3;

// Default weightages for categories
const DEFAULT_WEIGHTAGES = {
    assignment: 15,
    quiz: 10,
    midterm: 30,
    final: 40,
    revision: 5
};

// ============================================
// State Management Class
// ============================================
class SubjectMarksState {
    constructor() {
        this.currentSubjectTag = null;
        this.subjects = [];
        this.marks = {};
        this.weightages = {};
        this.marksHash = '0';
        this.weightagesHash = '0';
        this.authUnsubscribe = null;
        this.marksUnsubscribe = null;
        this.weightagesUnsubscribe = null;
        this.abortController = null;
    }

    reset() {
        this.currentSubjectTag = null;
        this.subjects = [];
        this.marks = {};
        this.weightages = {};
    }

    cleanup() {
        if (this.authUnsubscribe) {
            this.authUnsubscribe();
            this.authUnsubscribe = null;
        }
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        if (this.marksUnsubscribe) {
            this.marksUnsubscribe();
            this.marksUnsubscribe = null;
        }
        if (this.weightagesUnsubscribe) {
            this.weightagesUnsubscribe();
            this.weightagesUnsubscribe = null;
        }
    }
}

// Create singleton state instance
const state = new SubjectMarksState();

// ============================================
// Sanitization Helper
// ============================================
function escapeHtml(text) {
    if (!text) return '';
    // Use Sanitizer if available, otherwise fallback
    if (sanitizer && typeof sanitizer.attr === 'function') {
        return sanitizer.attr(String(text));
    }
    // Fallback sanitization
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Auth Initialization
// ============================================

/**
 * Wait for Firebase auth to be ready using Promise pattern
 * @returns {Promise<Object|null>} User object or null
 */
/**
 * Wait for Firebase auth to be ready using Promise pattern
 * @returns {Promise<Object|null>} User object or null
 */
function waitForAuth() {
    return new Promise((resolve) => {
        if (window.auth && window.auth.currentUser) {
            resolve(window.auth.currentUser);
            return;
        }

        if (!window.auth) {
            // Wait a tiny bit for auth to init
            setTimeout(() => {
                if (window.auth) {
                    const unsub = window.auth.onAuthStateChanged(user => {
                        unsub();
                        resolve(user);
                    });
                } else {
                    resolve(null);
                }
            }, 500);
            return;
        }

        const unsub = window.auth.onAuthStateChanged(user => {
            unsub();
            resolve(user);
        });
    });
}

/**
 * Wait for Firestore functions to be available/imported
 * @returns {Promise<boolean>}
 */
async function ensureFirestoreFunctions() {
    // Basic checks if we need specific utils, but we are using direct SDK mostly now.
    // Keeping for compatibility with other modules if they rely on globals.
    if (window.loadSubjectsFromFirestore) {
        return true;
    }

    try {
        const firestore = await import('./firestore.js');
        window.loadSubjectsFromFirestore = firestore.loadSubjectsFromFirestore;
        window.loadSubjectMarksFromFirestore = firestore.loadSubjectMarksFromFirestore;
        window.loadSubjectWeightagesFromFirestore = firestore.loadSubjectWeightagesFromFirestore;
        window.saveSubjectMarksToFirestore = firestore.saveSubjectMarksToFirestore;
        window.saveSubjectWeightagesToFirestore = firestore.saveSubjectWeightagesToFirestore;
        return true;
    } catch (e) {
        console.warn('Could not load firestore utils, will use direct SDK', e);
        return false;
    }
}

// ============================================
// Initialization
// ============================================

/**
 * Initialize the UI when the DOM is loaded
 */
async function init() {
    try {
        // Wait for auth
        await waitForAuth();

        // Ensure Firestore is ready
        await ensureFirestoreFunctions();

        // Load initial data
        await loadSubjects();

        // Set up event delegation
        setupEventDelegation();

        // Set up auth state listener
        setupAuthStateListener();

        // If there's a subject selected, load it
        const selector = document.getElementById('subjectSelector');
        if (selector && selector.value) {
            await handleSubjectChange();
        }

        console.log('[SubjectMarks] Initialization complete');
    } catch (error) {
        console.error('[SubjectMarks] Initialization error:', error);
    }
}

/**
 * Set up event delegation for all interactive elements
 */
function setupEventDelegation() {
    // Create abort controller for cleanup
    state.abortController = new AbortController();
    const { signal } = state.abortController;

    // Subject List Click Delegation
    const subjectListContainer = document.getElementById('subjectList') || document.getElementById('subjectsList');
    subjectListContainer?.addEventListener('click', (e) => {
        const card = e.target.closest('.subject-card');
        if (card && card.dataset.tag) {
            handleSubjectSelect(card.dataset.tag);
        }
    }, { signal });

    // Save weightages button
    document.getElementById('saveWeightagesBtn')?.addEventListener('click', saveWeightages, { signal });

    // Add Assessment Type button (Dynamic List)
    document.getElementById('addAssessmentTypeBtn')?.addEventListener('click', () => {
        addAssessmentTypeRow('New Assessment', 10);
        updateTotalWeightage();
    }, { signal });

    // Dynamic assessment types list delegation (for input changes and delete buttons)
    const assessmentListEl = document.getElementById('assessmentTypesList');
    if (assessmentListEl) {
        assessmentListEl.addEventListener('input', (e) => {
            if (e.target.classList.contains('assessment-type-weight') || e.target.classList.contains('assessment-type-name')) {
                updateTotalWeightage();
            }
        }, { signal });

        assessmentListEl.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-assessment-btn');
            if (deleteBtn) {
                const row = deleteBtn.closest('.assessment-type-row');
                if (row) {
                    row.remove();
                    updateTotalWeightage();
                }
            }
        }, { signal });
    }

    // Add mark button
    document.getElementById('addMarkBtn')?.addEventListener('click', addMark, { signal });

    // Theme toggle button (replaces inline onclick)
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn && !themeBtn.dataset?.themeManagerBound && themeBtn.getAttribute?.('data-theme-manager-bound') !== 'true') {
        themeBtn.addEventListener('click', toggleTheme, { signal });
        themeBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleTheme();
            }
        }, { signal });
    }

    // Event delegation for existing marks container (handles delete buttons)
    document.getElementById('existingMarks')?.addEventListener('click', handleExistingMarksClick, { signal });
}

/**
 * Handle clicks within the existing marks container using event delegation
 * @param {Event} event 
 */
async function handleExistingMarksClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const category = target.dataset.category;
    const index = parseInt(target.dataset.index, 10);

    switch (action) {
        case 'delete-mark':
            await deleteMark(category, index);
            break;
        case 'delete-all-marks':
            await deleteAllMarks();
            break;
    }
}

/**
 * Set up auth state change listener
 */
function setupAuthStateListener() {
    if (!window.auth) return;

    // Store unsubscribe function for cleanup
    state.authUnsubscribe = window.auth.onAuthStateChanged(async (user) => {
        if (user) {
            console.log('[SubjectMarks] User signed in, reloading data');
            // Do not aggressively clear storage here, let loadSubjects handle updates
            // const storage = getStorage();
            // storage.remove('academicSubjects');
            // storage.remove('subjectMarks');
            // storage.remove('subjectWeightages');

            await loadSubjects();
            if (state.currentSubjectTag) {
                await handleSubjectChange();
            }
        } else {
            console.log('[SubjectMarks] User signed out');
            clearUI();
        }
    });
}

/**
 * Clear UI elements when user signs out
 */
function clearUI() {
    // Hide details, show placeholder
    document.getElementById('activeContent')?.classList.add('d-none');
    document.getElementById('emptyState')?.classList.remove('d-none');

    // Clear Active Card Styling
    document.querySelectorAll('.subject-card').forEach(c => c.classList.remove('active'));

    state.reset();
}

// ============================================
// Theme Management
// ============================================

/**
 * Toggle theme between light and dark
 */
function toggleTheme() {
    if (typeof window !== 'undefined' && window.themeManager?.toggleTheme) {
        return window.themeManager.toggleTheme();
    }
    const storage = getStorage();
    const body = document.body;
    const isLight = body.classList.toggle('light-theme');
    const nextTheme = isLight ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    storage.set('theme', nextTheme);
    try { localStorage.setItem('theme', nextTheme); } catch {}
    return nextTheme;
}

/**
 * Initialize theme from saved preference
 */
function initTheme() {
    if (typeof window !== 'undefined' && window.themeManager?.initializeTheme) {
        return window.themeManager.initializeTheme();
    }
    const storage = getStorage();
    if (storage.get('theme', null) === 'light') {
        document.body.classList.add('light-theme');
        document.documentElement.setAttribute('data-theme', 'light');
    }
}

// ============================================
// Subject Loading
// ============================================

/**
 * Load subjects from Firestore or localStorage
 * @returns {Promise<Array>}
 */
async function loadSubjects() {
    const storage = getStorage();

    try {
        let loadedSubjects = storage.get('academicSubjects', []);

        // Fallback: If no academic subjects exist yet, extract unique subjects from timetable
        if (!loadedSubjects || loadedSubjects.length === 0) {
            try {
                const timetableEvents = storage.get('gpace_timetable_events', []);
                if (Array.isArray(timetableEvents) && timetableEvents.length > 0) {
                    const uniqueNames = new Set();
                    timetableEvents.forEach(evt => {
                        const name = evt.subject || evt.title;
                        if (name && typeof name === 'string' && name.trim()) {
                            uniqueNames.add(name.trim());
                        }
                    });

                    if (uniqueNames.size > 0) {
                        loadedSubjects = Array.from(uniqueNames).map(name => ({
                            name,
                            tag: name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
                            creditHours: name.toLowerCase().includes('lab') ? 1 : 3,
                            academicPerformance: 0
                        }));
                        storage.set('academicSubjects', loadedSubjects);
                    }
                }
            } catch (e) {
                console.warn('[SubjectMarks] Timetable subject fallback error:', e);
            }
        }

        // If user is authenticated, attempt Firestore sync
        if (window.auth?.currentUser) {
            try {
                const firestoreSubjects = await window.loadSubjectsFromFirestore?.();
                if (firestoreSubjects && firestoreSubjects.length > 0) {
                    loadedSubjects = firestoreSubjects;
                    storage.set('academicSubjects', loadedSubjects);
                }
            } catch (err) {
                console.warn('[SubjectMarks] Firestore load failed, using local subjects:', err);
            }
        }

        state.subjects = loadedSubjects || [];
        renderSubjectList();

        // Automatically select the first subject if none selected
        if (state.subjects.length > 0 && !state.currentSubjectTag) {
            handleSubjectSelect(state.subjects[0].tag);
        }

        return state.subjects;
    } catch (error) {
        console.error('[SubjectMarks] Error loading subjects:', error);
        return [];
    }
}

/**
 * Render the list of subject cards in the sidebar
 */
function renderSubjectList() {
    const container = document.getElementById('subjectList') || document.getElementById('subjectsList');
    if (!container) return;

    if (!state.subjects || state.subjects.length === 0) {
        container.innerHTML = `
            <div class="empty-subjects-sidebar p-3 text-center">
                <i class="bi bi-journal-plus text-muted mb-2 d-block" style="font-size: 2rem;"></i>
                <div class="text-white small fw-bold mb-1">No Subjects Yet</div>
                <p class="text-muted" style="font-size: 0.75rem;">Add your subjects in Brain Juice to track marks.</p>
                <a href="academic-details.html" class="btn btn-sm btn-outline-primary mt-1 w-100" style="font-size: 0.78rem;">
                    <i class="bi bi-plus-lg"></i> Add in Brain Juice
                </a>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    state.subjects.forEach(subject => {
        const isActive = subject.tag === state.currentSubjectTag;
        const perfo = subject.academicPerformance || 0;

        const card = document.createElement('button');
        card.className = `subject-card ${isActive ? 'active' : ''}`;
        card.dataset.tag = subject.tag;
        card.innerHTML = `
            <div class="subject-card-header">
                <span class="subject-name" title="${escapeHtml(subject.name)}">${escapeHtml(subject.name)}</span>
                <span class="subject-credits">${subject.creditHours || 3} CH</span>
            </div>
            <div class="mini-progress-track">
                <div class="mini-progress-fill" style="width: ${perfo}%"></div>
            </div>
            <div class="subject-stats">
                <span>View Details</span>
                <span>${perfo}%</span>
            </div>
        `;
        container.appendChild(card);
    });
}
const updateSubjectSelector = renderSubjectList;

// ============================================
// Subject Change Handler
// ============================================

/**
 * Handle subject change in the selector
 */
/**
 * Handle subject selection from sidebar
 * @param {string} subjectTag 
 */
async function handleSubjectSelect(subjectTag) {
    if (!subjectTag) return;

    state.currentSubjectTag = subjectTag;

    const subject = state.subjects.find(s => s.tag === subjectTag);
    if (!subject) return;

    // Update UI State
    document.getElementById('emptyState')?.classList.add('d-none');
    document.getElementById('activeContent')?.classList.remove('d-none');

    // Update Performance Header UI immediately
    const subjectNameEl = document.getElementById('subjectName');
    const creditHoursEl = document.getElementById('creditHours');
    const performanceEl = document.getElementById('academicPerformance');
    const performanceBar = document.getElementById('performanceBar');

    if (subjectNameEl) subjectNameEl.textContent = subject.name;
    if (creditHoursEl) creditHoursEl.textContent = subject.creditHours || 3;
    if (performanceEl) performanceEl.textContent = subject.academicPerformance || 0;
    if (performanceBar) {
        performanceBar.style.width = `${subject.academicPerformance || 0}%`;
        performanceBar.setAttribute('aria-valuenow', subject.academicPerformance || 0);
    }

    // Highlight active card
    document.querySelectorAll('.subject-card').forEach(c => {
        if (c.dataset.tag === subjectTag) c.classList.add('active');
        else c.classList.remove('active');
    });

    // Populate weightages list & category dropdown
    updateWeightagesUI();

    // Load data
    setupWeightagesListener();
    setupMarksListener();

    // Recalculate performance
    try {
        const recalculatedPerformance = await window.updateSubjectPerformance?.(subjectTag) || 0;
        if (performanceEl) performanceEl.textContent = recalculatedPerformance;
        if (performanceBar) {
            performanceBar.style.width = `${recalculatedPerformance}%`;
            performanceBar.setAttribute('aria-valuenow', recalculatedPerformance);
        }
    } catch (e) {
        console.warn('Error recalculating performance:', e);
    }

    // Update sub-components
    displayCategoryContributions(subjectTag);
    displayExistingMarks(subjectTag);
}

// Redirect old handler to new one for backward compat
const handleSubjectChange = () => {
    // This function originally pulled from the selector value.
    // We can ignore it or map it if needed, but UI is driver now.
    if (state.currentSubjectTag) handleSubjectSelect(state.currentSubjectTag);
};

// ============================================
// Weightages Management
// ============================================

/**
 * Sets up real-time listener for weightages
 */
function setupWeightagesListener() {
    if (state.weightagesUnsubscribe) {
        state.weightagesUnsubscribe();
        state.weightagesUnsubscribe = null;
    }

    const storage = getStorage();
    // Load local first
    state.weightages = storage.get('projectWeightages', {});

    // Also try to get subject weightages from local
    const localSubWeightages = storage.get('subjectWeightages', {});
    state.weightages = { ...state.weightages, ...localSubWeightages };

    if (!state.currentSubjectTag) return;

    // Load UI from local state first
    updateWeightagesUI();

    if (!window.auth || !window.auth.currentUser) return;

    try {
        const user = window.auth.currentUser;
        const db = getFirestore();
        const weightagesRef = doc(db, 'users', user.uid, 'academic', 'weightages');

        state.weightagesUnsubscribe = onSnapshot(weightagesRef, (docSnap) => {
            if (docSnap.exists()) {
                const weightagesData = docSnap.data().subjectWeightages || {};

                // Optimization: Hash Check
                const newHash = computeObjectHash(weightagesData);

                if (newHash === state.weightagesHash) {
                    return; // No change
                }

                console.log('[SubjectMarks] Real-time weightages update (Content Changed)');
                state.weightages = { ...state.weightages, ...weightagesData };
                state.weightagesHash = newHash;
                storage.set('subjectWeightages', state.weightages);

                if (state.currentSubjectTag) {
                    updateWeightagesUI();
                    displayCategoryContributions(state.currentSubjectTag);
                }
            }
        });

    } catch (error) {
        console.error('Error setting up weightages listener', error);
    }
}

/**
 * Renders an assessment type row in the dynamic list
 */
function addAssessmentTypeRow(name = 'New Assessment', weight = 10, key = null) {
    const listContainer = document.getElementById('assessmentTypesList');
    if (!listContainer) return;

    const row = document.createElement('div');
    row.className = 'assessment-type-row';

    const cleanKey = key || name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    row.dataset.categoryKey = cleanKey;

    row.innerHTML = `
        <input type="text" class="form-control form-control-sm assessment-type-name" value="${escapeHtml(name)}" placeholder="Assessment Name (e.g. OHT 1)">
        <div class="input-group input-group-sm">
            <input type="number" class="form-control form-control-sm assessment-type-weight" value="${weight}" min="0" max="100" step="0.5">
            <span class="input-group-text">%</span>
        </div>
        <button type="button" class="btn btn-sm btn-outline-danger delete-assessment-btn" title="Delete this assessment type">
            <i class="bi bi-trash3"></i>
        </button>
    `;

    listContainer.appendChild(row);
}

/**
 * Updates the Category selector dropdown in the "Add New Mark" form
 */
function updateCategoryDropdown(weightages) {
    const select = document.getElementById('markCategory');
    if (!select) return;

    select.innerHTML = '';
    const entries = Object.entries(weightages);

    if (entries.length === 0) {
        select.innerHTML = '<option value="">No assessment types configured</option>';
        return;
    }

    entries.forEach(([key, weight]) => {
        const readableName = key
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());

        const option = document.createElement('option');
        option.value = key;
        option.textContent = `${readableName} (${weight}%)`;
        select.appendChild(option);
    });
}

function updateWeightagesUI() {
    if (!state.currentSubjectTag) return;

    const subjectTag = state.currentSubjectTag;
    let subjectWeightages = { ...DEFAULT_WEIGHTAGES };

    if (state.weightages[subjectTag]) {
        subjectWeightages = { ...state.weightages[subjectTag] };
    }

    const listContainer = document.getElementById('assessmentTypesList');
    if (listContainer) {
        listContainer.innerHTML = '';

        // Display name mapping for standard legacy categories
        const legacyNames = {
            assignment: 'Assignments',
            quiz: 'Quizzes',
            midterm: 'Mid Term / OHT',
            final: 'Finals',
            revision: 'Revisions'
        };

        Object.entries(subjectWeightages).forEach(([catKey, weight]) => {
            const displayName = legacyNames[catKey] || catKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            addAssessmentTypeRow(displayName, weight, catKey);
        });
    }

    updateTotalWeightage();
    updateCategoryDropdown(subjectWeightages);
}

/**
 * Update the total weightage display and validation
 */
function updateTotalWeightage() {
    const weightInputs = document.querySelectorAll('#assessmentTypesList .assessment-type-weight');
    let total = 0;
    let count = 0;

    weightInputs.forEach(input => {
        total += Number(input.value) || 0;
        count++;
    });

    const totalEl = document.getElementById('totalWeightage');
    const saveBtn = document.getElementById('saveWeightagesBtn');
    const countBadge = document.getElementById('assessmentTypesCount');

    if (countBadge) {
        countBadge.textContent = `${count} type${count !== 1 ? 's' : ''}`;
    }

    if (totalEl) {
        totalEl.textContent = total.toFixed(1);

        if (Math.abs(total - 100) < 0.1 && count > 0) {
            totalEl.className = 'text-success fw-bold';
            if (saveBtn) saveBtn.disabled = false;
        } else {
            totalEl.className = 'text-danger fw-bold';
            if (saveBtn) saveBtn.disabled = true;
        }
    }
}

/**
 * Save dynamic weightages for the current subject
 */
async function saveWeightages() {
    if (!state.currentSubjectTag) return;

    const rows = document.querySelectorAll('#assessmentTypesList .assessment-type-row');
    if (rows.length === 0) {
        showNotification('Please add at least one assessment type.', 'error');
        return;
    }

    const newWeightages = {};
    let total = 0;

    rows.forEach(row => {
        const nameInput = row.querySelector('.assessment-type-name');
        const weightInput = row.querySelector('.assessment-type-weight');

        const name = nameInput ? nameInput.value.trim() : 'Assessment';
        const weight = Number(weightInput?.value) || 0;
        const key = name.toLowerCase().replace(/[^a-z0-9]/g, '_');

        if (key && weight >= 0) {
            newWeightages[key] = weight;
            total += weight;
        }
    });

    if (Math.abs(total - 100) >= 0.1) {
        showNotification('The total weightage must equal exactly 100%', 'error');
        return;
    }

    try {
        state.weightages[state.currentSubjectTag] = newWeightages;

        let newPerformance = 0;
        if (window.setSubjectWeightages) {
            window.setSubjectWeightages(state.currentSubjectTag, newWeightages);
            newPerformance = await window.updateSubjectPerformance?.(state.currentSubjectTag) || 0;
        } else {
            const storage = getStorage();
            storage.set('subjectWeightages', state.weightages);
            newPerformance = await window.updateSubjectPerformance?.(state.currentSubjectTag) || 0;
        }

        await window.saveSubjectWeightagesToFirestore?.(state.weightages);

        const performanceEl = document.getElementById('academicPerformance');
        const performanceBar = document.getElementById('performanceBar');
        if (performanceEl) performanceEl.textContent = newPerformance;
        if (performanceBar) {
            performanceBar.style.width = `${newPerformance}%`;
            performanceBar.setAttribute('aria-valuenow', newPerformance);
        }

        updateCategoryDropdown(newWeightages);
        renderSubjectList();

        showNotification('Assessment weightages saved successfully!', 'success');
    } catch (error) {
        console.error('[SubjectMarks] Error saving weightages:', error);
        showNotification('Error saving weightages. Please try again.', 'error');
    }
}

// ============================================
// Marks Management
// ============================================

function setMarkFieldError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (!field) return;

    const errorId = `${fieldId}Error`;
    let error = document.getElementById(errorId);
    if (!error) {
        error = document.createElement('div');
        error.id = errorId;
        error.className = 'field-error text-danger small mt-1';
        field.insertAdjacentElement('afterend', error);
    }
    error.textContent = message;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', errorId);
}

function clearMarkFieldErrors() {
    ['markCategory', 'obtainedMarks', 'totalMarks'].forEach(fieldId => {
        const field = document.getElementById(fieldId);
        const error = document.getElementById(`${fieldId}Error`);
        if (field) {
            field.removeAttribute('aria-invalid');
            if (field.getAttribute('aria-describedby') === `${fieldId}Error`) {
                field.removeAttribute('aria-describedby');
            }
        }
        error?.remove();
    });
}

function validateMarkFormValues(category, obtainedMarks, totalMarks, title) {
    if (typeof window.validateMarkEntry === 'function') {
        return window.validateMarkEntry(category, obtainedMarks, totalMarks, title);
    }

    // The data module normally provides the validator. Keep a strict fallback
    // for a partially loaded page so blank inputs never become zero.
    const normalizedCategory = typeof category === 'string'
        ? category.trim().toLowerCase().replace(/\s+/g, ' ')
        : '';
    const categoryAliases = {
        assignment: 'assignment',
        assignments: 'assignment',
        quiz: 'quiz',
        quizzes: 'quiz',
        midterm: 'midterm',
        'mid term': 'midterm',
        'mid term / oht': 'midterm',
        oht: 'midterm',
        final: 'final',
        finals: 'final',
        revision: 'revision',
        performance: '_performance',
        '_performance': '_performance',
        'academic performance': '_performance',
        academicperformance: '_performance',
        'manual performance': '_manualPerformance',
        manualperformance: '_manualPerformance',
        '_manualperformance': '_manualPerformance'
    };
    const cleanCategory = categoryAliases[normalizedCategory] || normalizedCategory;
    if (!cleanCategory) return { ok: false, field: 'category', error: 'Category is required' };
    if (obtainedMarks === '' || obtainedMarks === null || obtainedMarks === undefined) {
        return { ok: false, field: 'obtainedMarks', error: 'Obtained marks are required' };
    }
    if (totalMarks === '' || totalMarks === null || totalMarks === undefined) {
        return { ok: false, field: 'totalMarks', error: 'Total marks are required' };
    }
    const obtained = Number(obtainedMarks);
    const total = Number(totalMarks);
    if (!Number.isFinite(obtained)) return { ok: false, field: 'obtainedMarks', error: 'Obtained marks must be finite' };
    if (!Number.isFinite(total) || total <= 0) return { ok: false, field: 'totalMarks', error: 'Total marks must be greater than zero' };
    if (obtained < 0) return { ok: false, field: 'obtainedMarks', error: 'Obtained marks cannot be negative' };
    if (obtained > total) return { ok: false, field: 'obtainedMarks', error: 'Obtained marks cannot exceed total marks' };
    return { ok: true, category: cleanCategory, obtained, total, title: typeof title === 'string' ? title.trim() : '' };
}

/**
 * Add a mark for the current subject
 */
async function addMark() {
    if (!state.currentSubjectTag) return;

    const category = document.getElementById('markCategory')?.value;
    const title = document.getElementById('markTitle')?.value || '';
    const obtainedMarks = document.getElementById('obtainedMarks')?.value ?? '';
    const totalMarks = document.getElementById('totalMarks')?.value ?? '';

    clearMarkFieldErrors();
    const validation = validateMarkFormValues(category, obtainedMarks, totalMarks, title);
    if (!validation.ok) {
        setMarkFieldError(
            validation.field === 'category' ? 'markCategory' : validation.field,
            validation.error
        );
        showNotification(validation.error, 'error');
        return;
    }

    const success = window.addSubjectMark?.(
        state.currentSubjectTag,
        validation.category,
        validation.obtained,
        validation.total,
        validation.title
    );

    if (success) {
        const storage = getStorage();
        const updatedMarks = storage.get('subjectMarks', {});

        try {
            await window.saveSubjectMarksToFirestore?.(updatedMarks);

            // Reset form
            document.getElementById('markTitle').value = '';
            document.getElementById('obtainedMarks').value = '';
            document.getElementById('totalMarks').value = '';

            // addSubjectMark recalculates performance once after durable local
            // persistence. Read its result instead of recalculating here.
            const subjectMarks = storage.get('subjectMarks', {});
            const newPerformance = Number(subjectMarks?.[state.currentSubjectTag]?._performance) || 0;

            // Update Performance UI components directly
            const performanceEl = document.getElementById('academicPerformance');
            const performanceBar = document.getElementById('performanceBar');
            if (performanceEl) performanceEl.textContent = newPerformance;
            if (performanceBar) {
                performanceBar.style.width = `${newPerformance}%`;
                performanceBar.setAttribute('aria-valuenow', newPerformance);
            }

            // Re-render sidebar to update mini-progress (optimized)
            renderSubjectList();

            showNotification('Mark added successfully!', 'success');
        } catch (error) {
            console.error('[SubjectMarks] Error saving mark:', error);
            showNotification('Mark saved locally, but could not be saved to the cloud.', 'warning');
        }
    } else {
        showNotification('Error adding mark. Please check your inputs.', 'error');
    }
}

/**
 * Delete a single mark
 * @param {string} category 
 * @param {number} index 
 */
async function deleteMark(category, index) {
    if (!confirm('Are you sure you want to delete this mark?')) return;

    try {
        if (!state.marks[state.currentSubjectTag]?.[category]) return;

        state.marks[state.currentSubjectTag][category].splice(index, 1);

        const storage = getStorage();
        storage.set('subjectMarks', state.marks);

        await window.saveSubjectMarksToFirestore?.(state.marks);
        await window.updateSubjectPerformance?.(state.currentSubjectTag);
        await loadMarks(state.currentSubjectTag);
        await handleSubjectChange();

        showNotification('Mark deleted successfully!', 'success');
    } catch (error) {
        console.error('[SubjectMarks] Error deleting mark:', error);
        showNotification('Error deleting mark. Please try again.', 'error');
        await loadMarks(state.currentSubjectTag);
        await handleSubjectChange();
    }
}

/**
 * Delete all marks for the current subject
 */
async function deleteAllMarks() {
    if (!confirm('Are you sure you want to delete ALL marks for this subject? This action cannot be undone.')) return;

    try {
        state.marks[state.currentSubjectTag] = {
            assignment: [],
            quiz: [],
            midterm: [],
            final: [],
            revision: []
        };

        const storage = getStorage();
        storage.set('subjectMarks', state.marks);

        await window.saveSubjectMarksToFirestore?.(state.marks);
        await window.updateSubjectPerformance?.(state.currentSubjectTag);
        await loadMarks(state.currentSubjectTag);
        await handleSubjectChange();

        showNotification('All marks deleted successfully!', 'success');
    } catch (error) {
        console.error('[SubjectMarks] Error deleting marks:', error);
        showNotification('Error deleting marks. Please try again.', 'error');
        await loadMarks(state.currentSubjectTag);
        await handleSubjectChange();
    }
}

// ============================================
// Display Functions
// ============================================

/**
 * Display category contributions for a subject
 * @param {string} subjectTag 
 */
function displayCategoryContributions(subjectTag) {
    const subject = state.subjects.find(s => s.tag === subjectTag);
    if (!subject) return;

    const subjectMarks = state.marks[subjectTag] || {};
    const subjectWeightages = state.weightages[subjectTag] || DEFAULT_WEIGHTAGES;

    const container = document.getElementById('categoryContributions');
    if (!container) return;

    container.innerHTML = '';

    for (const [category, weight] of Object.entries(subjectWeightages)) {
        const categoryMarks = subjectMarks[category] || [];
        const hasCategoryMarks = categoryMarks.length > 0;

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

        const categoryName = escapeHtml(category.charAt(0).toUpperCase() + category.slice(1));

        div.innerHTML = `
            <div class="d-flex justify-content-between">
                <span>${categoryName} (${weight}%)</span>
                <span>${hasCategoryMarks ? performance.toFixed(1) + '%' : 'No marks'}</span>
            </div>
            <div class="progress" role="progressbar" aria-label="${categoryName} performance">
                <div class="progress-bar ${hasCategoryMarks ? '' : 'bg-secondary'}"
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
 * @param {string} subjectTag 
 */
function displayExistingMarks(subjectTag) {
    const container = document.getElementById('existingMarks');
    if (!container) return;

    container.classList.remove('d-none');

    const subjectMarks = state.marks[subjectTag] || {};
    let hasAnyMarks = false;
    let marksHtml = '';

    for (const [category, marksList] of Object.entries(subjectMarks)) {
        if (category === '_manualPerformance' || category === '_performance') continue;

        if (Array.isArray(marksList) && marksList.length > 0) {
            hasAnyMarks = true;
            const categoryName = escapeHtml(category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

            marksHtml += `<div class="mb-3"><h5 class="small text-muted text-uppercase fw-bold mb-2">${categoryName}</h5><ul class="list-group">`;

            marksList.forEach((mark, index) => {
                const title = mark.title ? escapeHtml(mark.title) : `${categoryName} ${index + 1}`;
                const pct = mark.total > 0 ? ((mark.obtained / mark.total) * 100).toFixed(0) : 0;
                marksHtml += `
                    <li class="list-group-item d-flex justify-content-between align-items-center">
                        <div>
                            <span class="fw-semibold me-2">${title}</span>
                            <span class="badge bg-dark border text-muted">${escapeHtml(String(mark.obtained))} / ${escapeHtml(String(mark.total))} (${pct}%)</span>
                        </div>
                        <button class="btn btn-outline-danger btn-sm"
                                data-action="delete-mark"
                                data-category="${escapeHtml(category)}"
                                data-index="${index}"
                                aria-label="Delete mark" title="Delete mark">
                            <i class="bi bi-trash3"></i>
                        </button>
                    </li>
                `;
            });

            marksHtml += '</ul></div>';
        }
    }

    let headerHtml = `
        <div class="d-flex justify-content-between align-items-center mb-3">
            <h3 class="m-0">Marks History</h3>
            ${hasAnyMarks ? `
            <button class="btn btn-sm btn-outline-danger" data-action="delete-all-marks" id="deleteAllMarksBtn">
                <i class="bi bi-trash3"></i> Delete All Marks
            </button>` : ''}
        </div>
    `;

    if (!hasAnyMarks) {
        container.innerHTML = `
            ${headerHtml}
            <div class="empty-marks-state">
                <i class="bi bi-journal-check text-muted d-block mb-2" style="font-size: 2rem; opacity: 0.5;"></i>
                <div class="small fw-semibold text-white mb-1">No marks recorded yet</div>
                <div class="small text-muted">Use the "Add New Mark" form above to record assignments, quizzes, and exams.</div>
            </div>
        `;
    } else {
        container.innerHTML = headerHtml + marksHtml;
    }
}

// ============================================
// Notification System
// ============================================

/**
 * Show a notification to the user
 * @param {string} message 
 * @param {string} type - 'success', 'error', 'warning', 'info'
 */
function showNotification(message, type = 'info') {
    // Remove existing notifications
    document.querySelectorAll('.toast-notification').forEach(n => n.remove());

    const colors = {
        success: '#28a745',
        error: '#dc3545',
        warning: '#ffc107',
        info: '#17a2b8'
    };

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 20px;
        background: ${colors[type] || colors.info};
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 9999;
        animation: slideIn 0.3s ease;
        max-width: 300px;
    `;
    toast.textContent = message;

    // Add animation styles
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// Cleanup
// ============================================

/**
 * Cleanup function for SPA navigation
 */
function cleanup() {
    state.cleanup();
}

// ============================================
// Initialization on DOM Ready
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    init();

    // Make toggleTheme available globally for backwards compatibility
    window.toggleTheme = toggleTheme;
});

// ============================================
// Exports
// ============================================

export {
    toggleTheme,
    loadSubjects,
    handleSubjectChange,
    saveWeightages,
    addMark,
    validateMarkFormValues,
    cleanup,
    showNotification
};
