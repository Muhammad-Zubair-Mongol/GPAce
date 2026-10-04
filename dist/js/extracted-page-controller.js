/**
 * extracted-page-controller.js
 * Main controller module for the Hustle Hub (extracted.html) page.
 * 
 * This module extracts all inline JavaScript into a proper ES module with:
 * - Centralized Firebase configuration
 * - Proper sanitization of user content
 * - Event delegation instead of inline handlers
 * - Clean state management
 * - Memory-safe event listener management
 */

// ============================================
// Imports
// ============================================
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, onSnapshot, doc, collection, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { saveWeightagesToFirestore, loadWeightagesFromFirestore, saveCompletedTaskToFirestore } from './firestore.js'; // Removed direct task save/load
import { firebaseConfig, getOrCreateFirebaseApp } from './firebaseConfig.js';
import crossTabSync from './cross-tab-sync.js';
import googleDriveAPI from './googleDriveApi.js';
import taskAttachments from './taskAttachments.js';
import sanitizer from './utils/Sanitizer.js';
import { SemesterService } from './services/SemesterService.js';
import taskService from './services/TaskService.js';
import CameraCapture from './camera-capture.js';

// ============================================
// Constants
// ============================================
const SUBSECTIONS = ['Revision', 'Assignment', 'Quizzes', 'Mid Term / OHT', 'Finals'];
const CACHE_TTL_MS = 30000;
const ATTACHMENT_REFRESH_DELAY_MS = 1000;
const UPLOAD_STATUS_DISPLAY_MS = 5000;
const TASK_INIT_DELAY_MS = 100;

// Section icon mapping
const SECTION_ICONS = {
    'Revision': 'book',
    'Assignment': 'file-text',
    'Quizzes': 'question-circle',
    'Mid Term / OHT': 'clipboard-data',
    'Finals': 'trophy'
};

// ============================================
// State Management
// ============================================
class ExtractedPageState {
    constructor() {
        this.currentProject = null;
        this.currentSection = null;
        this.currentInputMode = 'single';
        this.auth = null;
        this.db = null;
        this.provider = null;
        this.initialized = false;
        this.abortController = null; // For cleanup
        this.unsubscribeProject = null; // Real-time listener unsubscriber
        this.listeningProjectId = null; // ID of the project currently being listened to

        // Unified project cache
        this.projectCache = {
            tasks: {},
            weightages: null,
            lastFetch: {},
            isFetching: {},

            isValid(projectId) {
                // With real-time sync, if we have tasks and are listening, it's valid.
                // Fallback to basic check.
                return !!this.tasks[projectId];
            },

            setTasks(projectId, tasks) {
                this.tasks[projectId] = tasks;
                this.lastFetch[projectId] = Date.now();
                this.isFetching[projectId] = false;
            },

            setWeightages(weightages) {
                this.weightages = weightages;
            },

            clearProject(projectId) {
                delete this.tasks[projectId];
                delete this.lastFetch[projectId];
            },

            // Legacy refresh kept for compatibility, but displayTasks will prefer real-time
            async refreshProject(projectId) {
                if (this.isFetching[projectId]) return this.tasks[projectId];

                this.isFetching[projectId] = true;

                try {
                    const tasks = await loadTasksFromFirestore(projectId) || [];
                    this.setTasks(projectId, tasks);

                    if (!this.weightages) {
                        this.setWeightages(await loadWeightagesFromFirestore() || {});
                    }

                    return tasks;
                } catch (error) {
                    console.error('Error refreshing project data:', error);
                    this.isFetching[projectId] = false;
                    throw error;
                }
            }
        };
    }

    reset() {
        this.currentProject = null;
        this.currentSection = null;
        this.currentInputMode = 'single';
        if (this.unsubscribeProject) {
            this.unsubscribeProject();
            this.unsubscribeProject = null;
            this.listeningProjectId = null;
        }
    }
}

// Create singleton state instance
const state = new ExtractedPageState();

// ============================================
// Firebase Initialization
// ============================================
async function initializeFirebase() {
    try {
        // Check if Firebase app already exists
        const existingApps = getApps();
        let app;

        if (existingApps.length > 0) {
            app = existingApps[0];
            console.log('[ExtractedPage] Using existing Firebase app');
        } else {
            app = initializeApp(firebaseConfig);
            console.log('[ExtractedPage] Firebase app initialized');
        }

        state.auth = getAuth(app);
        state.provider = new GoogleAuthProvider();
        state.db = getFirestore(app);

        // Set up global auth references for compatibility
        window.auth = state.auth;

        // Set up global Firestore functions (TaskService handles main task operations)
        window.saveCompletedTaskToFirestore = saveCompletedTaskToFirestore;
        window.saveWeightagesToFirestore = saveWeightagesToFirestore;
        window.loadWeightagesFromFirestore = loadWeightagesFromFirestore;

        return app;
    } catch (error) {
        console.error('[ExtractedPage] Firebase initialization error:', error);
        throw error;
    }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Escape HTML for safe insertion into templates
 */
function escapeHtml(text) {
    if (!text) return '';
    return sanitizer.attr(String(text));
}

/**
 * Format date for display
 */
function formatDate(dateString) {
    if (!dateString) return 'No date';
    const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    try {
        return new Date(dateString).toLocaleDateString(undefined, options);
    } catch {
        return 'Invalid date';
    }
}

/**
 * Get priority color class
 */
function getPriorityColor(priority) {
    switch (priority) {
        case 'high': return 'danger';
        case 'medium': return 'warning';
        case 'low': return 'success';
        default: return 'secondary';
    }
}

/**
 * Get section icon name
 */
function getSectionIcon(section) {
    return SECTION_ICONS[section] || 'folder';
}

/**
 * Normalize title for comparison
 */
function normalizeTitle(title) {
    if (!title) return '';
    return title.toString().toLowerCase().trim()
        .replace(/[^\w\s]/gi, '')
        .replace(/\s+/g, ' ');
}

// ============================================
// Audio Management
// ============================================
let popSound = null;

function getPopSound() {
    if (!popSound) {
        popSound = new Audio('sounds/pop.mp3');
        popSound.volume = 0.5;
    }
    return popSound;
}

async function playPopSound() {
    try {
        const sound = getPopSound();
        sound.currentTime = 0;
        await sound.play();
    } catch (error) {
        console.debug('[ExtractedPage] Sound playback failed:', error.message);
    }
}

// ============================================
// Project Loading
// ============================================
async function loadProjects() {
    const isAuthenticated = state.auth && state.auth.currentUser;
    const sidebar = document.getElementById('projectsSidebar');

    if (!sidebar) return;

    if (!isAuthenticated) {
        sidebar.innerHTML = `
            <div class="auth-required-message">
                <i class="bi bi-lock"></i>
                <h5>Sign In Required</h5>
                <p>Sign in to access your projects</p>
                <button class="btn btn-primary btn-sm" data-action="sign-in">
                    <i class="bi bi-box-arrow-in-right me-1"></i>
                    Sign In
                </button>
            </div>
        `;
        return;
    }

    // Use SemesterService to get subjects for the ACTIVE semester
    await SemesterService.initialize();
    const subjects = SemesterService.getCurrentSubjects();
    const currentSemesterName = SemesterService.getCurrentSemester();

    sidebar.innerHTML = `
        <h5 class="d-flex align-items-center justify-content-between">
            <div><i class="bi bi-collection me-1"></i> Projects</div>
             <div class="d-flex align-items-center">
                <small class="text-muted me-2" style="font-size: 0.7em;">${escapeHtml(currentSemesterName === 'default' ? '' : currentSemesterName)}</small>
                <i class="bi bi-plus-circle" style="font-size: 0.85rem; cursor: pointer;" title="Add Project" data-action="add-project"></i>
            </div>
        </h5>
        <div class="sidebar-divider"></div>
    `;

    if (subjects.length === 0) {
        sidebar.innerHTML += `
            <div class="text-center text-muted p-2" style="font-size: 0.9em;">
                <p>No subjects in current semester.</p>
                <a href="academic-details.html" class="text-decoration-none">Manage Semesters</a>
            </div>
       `;
    }

    // Add subject projects
    subjects.forEach(subject => {
        const projectDiv = document.createElement('div');
        projectDiv.className = 'project-item';
        projectDiv.setAttribute('data-project', subject.tag);
        projectDiv.innerHTML = `
            <div class="d-flex align-items-center justify-content-between w-100">
                <div class="d-flex align-items-center">
                    <i class="bi bi-book"></i>
                    <div>
                        <div class="project-title">${escapeHtml(subject.name)}</div>
                        <small class="text-muted project-subtitle">${escapeHtml(subject.tag)}</small>
                    </div>
                </div>
                <i class="bi bi-chevron-down expand-icon"></i>
            </div>
        `;
        sidebar.appendChild(projectDiv);

        // Add subsections
        const subsectionsDiv = document.createElement('div');
        subsectionsDiv.className = 'subsection';
        subsectionsDiv.id = `subsections-${subject.tag}`;

        SUBSECTIONS.forEach(section => {
            const sectionDiv = document.createElement('div');
            sectionDiv.className = 'project-item';
            sectionDiv.setAttribute('data-project', `${subject.tag}-${section.replace(/\s+/g, '')}`);
            sectionDiv.setAttribute('data-parent', subject.tag);
            sectionDiv.setAttribute('data-section', section);
            sectionDiv.innerHTML = `
                <div class="d-flex align-items-center">
                    <i class="bi bi-chevron-right"></i>
                    <span>${escapeHtml(section)}</span>
                </div>
            `;
            subsectionsDiv.appendChild(sectionDiv);
        });
        sidebar.appendChild(subsectionsDiv);
    });

    // Add Extra Curricular project
    const extraDiv = document.createElement('div');
    extraDiv.className = 'project-item mt-3';
    extraDiv.setAttribute('data-project', 'EXTRA');
    extraDiv.innerHTML = `
        <div class="d-flex align-items-center">
            <i class="bi bi-star"></i>
            <span>Extra Curricular</span>
        </div>
    `;
    sidebar.appendChild(extraDiv);
}

// ============================================
// Project Selection
// ============================================
async function selectProject(projectId, section = null) {
    if (!state.auth || !state.auth.currentUser) {
        showSignInPrompt();
        return;
    }

    // Handle subsection identifiers
    if (projectId.indexOf('-') !== -1 && !projectId.startsWith('EXTRA')) {
        const parts = projectId.split('-');
        const parentProject = parts[0];
        const extractedSection = parts[1];
        projectId = parentProject;
        section = SUBSECTIONS.find(s => s.replace(/\s+/g, '') === extractedSection) || section;
    }

    // Update active states
    const projectElements = document.querySelectorAll('.project-item');
    projectElements.forEach(el => el.classList.remove('active', 'parent-active'));

    const selectedProject = document.querySelector(`.project-item[data-project="${projectId}"]`);
    if (selectedProject) {
        selectedProject.classList.add('active');

        if (section) {
            const sectionId = `${projectId}-${section.replace(/\s+/g, '')}`;
            const sectionItem = document.querySelector(`.project-item[data-project="${sectionId}"]`);
            if (sectionItem) {
                sectionItem.classList.add('active');
                selectedProject.classList.add('parent-active');
            }
        }

        // Handle subsections expand/collapse
        if (!projectId.startsWith('EXTRA')) {
            const subsectionsDiv = document.getElementById(`subsections-${projectId}`);
            if (subsectionsDiv) {
                document.querySelectorAll('.subsection').forEach(s => {
                    if (s.id !== `subsections-${projectId}`) {
                        s.classList.remove('expanded');
                    }
                });

                if (section || projectId.indexOf('-') === -1) {
                    subsectionsDiv.classList.add('expanded');
                } else {
                    subsectionsDiv.classList.toggle('expanded');
                }
            }
        }
    }

    // Store current project and section
    state.currentProject = projectId;
    state.currentSection = section;

    // Display tasks
    if (state.projectCache.isValid(projectId)) {
        await displayTasks(projectId, section);

        // Background refresh if cache is getting stale
        if (Date.now() - state.projectCache.lastFetch[projectId] > state.projectCache.cacheTTL / 2) {
            state.projectCache.refreshProject(projectId).then(() => {
                if (state.currentProject === projectId) {
                    displayTasks(projectId, section);
                }
            }).catch(console.error);
        }
    } else {
        // Cache invalid or empty.
        // We do NOT need to manually fetch here because displayTasks() sets up 
        // a real-time onSnapshot listener, which will immediately fire with the latest data.
        // This prevents double-fetching (once via getDocs, once via onSnapshot).

        // Show loading header/spinner briefly if needed, but displayTasks handles that too.
        await displayTasks(projectId, section);
    }
}

// ============================================
// Task Display
// ============================================
async function displayTasks(projectId, section = null) {
    const container = document.getElementById('taskContainer');
    if (!container) return;

    console.log('[ExtractedPage] displayTasks called for:', projectId, 'section:', section);
    console.log('[ExtractedPage] Auth state:', state.auth ? 'initialized' : 'not initialized');
    console.log('[ExtractedPage] Current user:', state.auth?.currentUser?.uid || 'none');

    if (!state.auth || !state.auth.currentUser) {
        container.innerHTML = `
            <div class="auth-required-message">
                <i class="bi bi-lock"></i>
                <h5>Sign In Required</h5>
                <p class="text-secondary">Please sign in to view your tasks.</p>
                <button class="btn btn-primary" data-action="sign-in">
                    <i class="bi bi-box-arrow-in-right"></i>
                    Sign In
                </button>
            </div>
        `;
        return;
    }

    // Setup Real-time Listener if needed
    if (state.listeningProjectId !== projectId) {
        // Unsubscribe from previous
        if (state.unsubscribeProject) {
            console.log(`[ExtractedPage] Unsubscribing from project: ${state.listeningProjectId}`);
            state.unsubscribeProject();
            state.unsubscribeProject = null;
        }

        // Subscribe to new
        try {
            console.log(`[ExtractedPage] Setting up onSnapshot for project: ${projectId}`);
            const user = state.auth.currentUser;

            if (!user) {
                console.error('[ExtractedPage] No current user - cannot subscribe');
                state.projectCache.setTasks(projectId, []);
                renderTasksUI(container, projectId, section);
                return;
            }

            if (!state.db) {
                console.error('[ExtractedPage] Firestore not initialized');
                state.projectCache.setTasks(projectId, []);
                renderTasksUI(container, projectId, section);
                return;
            }

            // Subscribe via TaskService
            console.log(`[ExtractedPage] Subscribing via TaskService for project: ${projectId}`);
            state.unsubscribeProject = taskService.subscribeToProject(projectId, (tasks) => {
                console.log(`[ExtractedPage] TaskService update: ${tasks.length} tasks`);

                // Skip re-renders if we're in optimistic cooldown period
                if (optimisticCooldown) {
                    console.log('[ExtractedPage] Skipping render (optimistic cooldown active)');
                    // Still update cache but don't re-render
                    state.projectCache.setTasks(projectId, tasks);
                    return;
                }

                // Skip re-renders if we're in batch processing mode
                if (isBatchProcessing) {
                    console.log('[ExtractedPage] Skipping render (batch processing in progress)');
                    state.projectCache.setTasks(projectId, tasks);
                    return;
                }

                state.projectCache.setTasks(projectId, tasks);

                // Debounce renders to prevent flicker during rapid updates
                if (renderDebounceTimer) {
                    clearTimeout(renderDebounceTimer);
                }

                renderDebounceTimer = setTimeout(() => {
                    // Double-check cooldown hasn't been set during debounce
                    if (optimisticCooldown) return;

                    // Re-render only if this is still the active project
                    if (state.currentProject === projectId) {
                        renderTasksUI(container, projectId, state.currentSection || section);
                    }
                    renderDebounceTimer = null;
                }, RENDER_DEBOUNCE_MS);
            });

            state.listeningProjectId = projectId;
        } catch (error) {
            console.error('[ExtractedPage] Error setting up real-time listener:', error);
        }


    }

    // Initial Render (Optimistic / Cached)
    // If we have data in cache, render immediately
    // If not, we might wait for the first snapshot or show loading.
    // For better UX, we try to load from cache/storage sync first if available.

    let tasks = state.projectCache.tasks[projectId];

    if (!tasks) {
        // Show loading state initially
        container.innerHTML = `
            <div class="text-center p-5">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-3">Syncing tasks...</p>
            </div>
        `;

    } else {
        renderTasksUI(container, projectId, section);
    }
}

async function renderTasksUI(container, projectId, section) {
    if (!state.projectCache.isValid(projectId)) return;

    const tasks = state.projectCache.tasks[projectId] || [];

    // Ensure weightages are loaded
    if (!state.projectCache.weightages) {
        state.projectCache.weightages = await loadWeightagesFromFirestore() || {};
    }
    const weightages = state.projectCache.weightages || {};

    const escapedProjectId = escapeHtml(projectId);

    container.innerHTML = `
        <div class="project-header">
            <div class="d-flex justify-content-between align-items-center">
                <div class="project-title">
                    <i class="bi bi-collection"></i>
                    ${escapedProjectId}
                    ${section ? `<span class="badge bg-secondary">${escapeHtml(section)}</span>` : ''}
                </div>
                <div class="d-flex gap-3">
                    <button class="history-btn" data-action="show-history" data-project="${escapedProjectId}">
                        <i class="bi bi-clock-history"></i>
                        History
                    </button>
                </div>
            </div>
        </div>
        <div class="section-nav">
            <div class="d-flex gap-2 flex-wrap">
                <button class="btn ${!section ? 'btn-primary' : 'btn-outline-secondary'}"
                        data-action="select-project" data-project="${escapedProjectId}">
                    <i class="bi bi-grid"></i>
                    All Sections
                </button>
                ${SUBSECTIONS.map(s => `
                    <button class="btn ${section === s ? 'btn-primary' : 'btn-outline-secondary'}"
                            data-action="select-project" data-project="${escapedProjectId}" data-section="${escapeHtml(s)}">
                        <i class="bi bi-${getSectionIcon(s)}"></i>
                        ${escapeHtml(s)}
                    </button>
                `).join('')}
            </div>
        </div>
        <button class="add-task-btn mb-4" data-action="show-task-form">
            <i class="bi bi-plus-circle me-2"></i>Add new task
        </button>
        <div id="taskList" class="fade-in">
            ${SUBSECTIONS.filter(s => !section || s === section).map(s => {
        const sectionWeightage = weightages[s] || { min: 0, max: 0, avg: 0 };
        // Filter out completed tasks - they should NOT appear in the task list
        const sectionTasks = tasks.filter(task => task.section === s && !task.completed);

        return `
                    <div class="mb-4">
                        <div class="section-header">
                            <div class="d-flex justify-content-between align-items-center">
                                <div class="section-title">
                                    <i class="bi bi-${getSectionIcon(s)}"></i>
                                    ${escapeHtml(s)}
                                </div>
                                <span class="weightage-badge">
                                    ${sectionWeightage.min}-${sectionWeightage.max}% (avg: ${((sectionWeightage.min + sectionWeightage.max) / 2).toFixed(1)}%)
                                </span>
                            </div>
                        </div>
                        ${sectionTasks.length === 0 ? `
                            <div class="empty-section">
                                <div class="d-flex flex-column align-items-center">
                                    <i class="bi bi-inbox"></i>
                                    <div>No tasks in this section</div>
                                </div>
                            </div>
                        ` : sectionTasks.map((task, index) => `
                            <div class="task-item" data-task-id="${escapeHtml(task.id || '')}">
                                <div class="d-flex justify-content-between align-items-start">
                                    <div class="d-flex align-items-start">
                                        <div class="completion-circle"
                                             data-action="complete-task"
                                             data-index="${index}"
                                             data-project="${escapedProjectId}"
                                             data-section="${escapeHtml(s)}"
                                             title="Mark as complete"></div>
                                        <div>
                                            <h5 class="mb-2">${escapeHtml(task.title)}</h5>
                                            <p class="mb-2 text-secondary">${escapeHtml(task.description) || 'No description'}</p>
                                            <div class="d-flex align-items-center gap-3">
                                                <span class="due-date">
                                                    <i class="bi bi-calendar-event"></i>
                                                    ${formatDate(task.dueDate)}
                                                </span>
                                                <span class="priority-badge" style="background-color: ${getPriorityColor(task.priority)}">
                                                    ${escapeHtml(task.priority)}
                                                </span>
                                            </div>
                                            <div class="task-attachments-container mt-3"
                                                 id="task-attachments-${escapeHtml(task.id || `${index}-${s.replace(/\s+/g, '')}`)}"
                                                 data-task-id="${escapeHtml(task.id || '')}"
                                                 data-task-title="${escapeHtml(task.title || '')}"
                                                 data-task-section="${escapeHtml(s)}"
                                                 data-project-id="${escapedProjectId}">
                                                 <button class="btn btn-sm btn-outline-secondary me-2"
                                                         data-action="scan-document"
                                                         data-task-id="${escapeHtml(task.id || '')}"
                                                         data-project="${escapedProjectId}"
                                                         data-section="${escapeHtml(s)}">
                                                     <i class="bi bi-camera"></i> Scan
                                                 </button>
                                                 <button class="btn btn-sm btn-outline-secondary upload-btn"
                                                         data-action="upload-attachment"
                                                         data-task-id="${escapeHtml(task.id || `${index}-${s.replace(/\s+/g, '')}`)}"
                                                         data-project="${escapedProjectId}"
                                                         data-section="${escapeHtml(s)}">
                                                     <i class="bi bi-paperclip"></i> Attach file
                                                 </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="task-actions">
                                        <button class="btn btn-sm btn-outline-primary"
                                                data-action="edit-task"
                                                data-index="${index}"
                                                data-section="${escapeHtml(s)}">
                                            <i class="bi bi-pencil"></i>
                                        </button>
                                        <button class="btn btn-sm btn-outline-danger"
                                                data-action="delete-task"
                                                data-index="${index}"
                                                data-section="${escapeHtml(s)}">
                                            <i class="bi bi-trash"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
    }).join('')}
        </div>
    `;

    // Initialize task attachments
    setTimeout(() => initializeTaskAttachments(tasks, projectId, section), TASK_INIT_DELAY_MS);
}

// ============================================
// Task Attachments Initialization
// ============================================
function initializeTaskAttachments(tasks, projectId, section) {
    tasks.forEach((task, index) => {
        SUBSECTIONS.forEach(s => {
            if (!section || section === s) {
                if (task.section === s) {
                    const taskId = task.id || `${index}-${s.replace(/\s+/g, '')}`;
                    const container = document.getElementById(`task-attachments-${taskId}`);

                    if (container && taskAttachments && typeof taskAttachments.init === 'function') {
                        container.dataset.taskId = taskId;
                        container.dataset.taskTitle = task.title || '';
                        container.dataset.taskSection = s || '';
                        container.dataset.projectId = projectId || '';
                        taskAttachments.init(taskId, container);
                    }
                }
            }
        });
    });
}

// ============================================
// Task CRUD Operations
// ============================================
async function addTask() {
    const projectId = state.currentProject;
    if (!projectId) return;

    if (state.currentInputMode === 'bulk') {
        const bulkText = document.getElementById('bulkTasks')?.value || '';
        const newTasks = parseBulkTasks(bulkText);
        if (newTasks.length === 0) return;

        // Loop create
        for (const task of newTasks) {
            await taskService.createTask(projectId, {
                ...task,
                section: state.currentSection || SUBSECTIONS[0], // Ensure section
                id: task.id // preserve parsed ID if any, or let service gen
            });
        }
    } else {
        const title = document.getElementById('taskTitle')?.value;
        if (!title) return;

        const description = document.getElementById('taskDescription')?.value || '';
        const dueDate = document.getElementById('taskDueDate')?.value || '';
        const priority = document.getElementById('taskPriority')?.value || 'medium';

        await taskService.createTask(projectId, {
            title,
            description,
            dueDate,
            priority,
            section: state.currentSection || SUBSECTIONS[0]
        });
    }

    hideAddTaskForm();
    await displayTasks(projectId, state.currentSection);
}

function parseBulkTasks(bulkText) {
    const lines = bulkText.trim().split('\n');
    const tasks = [];

    for (const line of lines) {
        if (!line.trim()) continue;

        let [title, dueDate, priority, description = ''] = line.split('|').map(item => item.trim());

        if (!dueDate) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            dueDate = tomorrow.toISOString().split('T')[0];
        }

        if (!priority) {
            priority = 'medium';
        }

        if (title) {
            tasks.push({
                id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                title,
                description,
                dueDate,
                priority: priority.toLowerCase(),
                section: state.currentSection || SUBSECTIONS[0],
                completed: false,
                createdAt: new Date().toISOString()
            });
        }
    }

    return tasks;
}

async function deleteTask(index, section) {
    if (!confirm('Are you sure you want to delete this task?')) return;

    const projectId = state.currentProject;

    // Get the task ID from the section-filtered view
    const tasks = state.projectCache.tasks[projectId] || [];
    const sectionTasks = tasks.filter(t => t.section === section);

    if (index >= 0 && index < sectionTasks.length) {
        const task = sectionTasks[index];
        if (task && task.id) {
            // ACTIVATE COOLDOWN: Prevent subscription-triggered re-renders
            optimisticCooldown = true;
            setTimeout(() => { optimisticCooldown = false; }, OPTIMISTIC_COOLDOWN_MS);

            // OPTIMISTIC UI: Immediately animate and remove from DOM
            const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
            if (taskElement) {
                taskElement.classList.add('task-removing');
                // Wait for animation then remove from DOM
                setTimeout(() => taskElement.remove(), 250);
            }

            // Update local cache immediately (optimistic)
            const remainingTasks = tasks.filter(t => t.id !== task.id);
            state.projectCache.setTasks(projectId, remainingTasks);

            // Background save to Firestore (no await, no re-render)
            // WE RELY ENTIRELY ON TASKSERVICE FOR PERSISTENCE TO AVOID CONFLICTS
            taskService.deleteTask(projectId, task.id).catch(e => {
                console.error('Delete task failed:', e);
                // On error, restore the task (pessimistic rollback)
                state.projectCache.setTasks(projectId, tasks);
                displayTasks(projectId, section);
                alert('Failed to delete task. Please try again.');
            });
        }
    }
}

// ============================================
// Debounce State for Task Completion (Fix for transaction race conditions)
// ============================================
let completeTaskDebounceTimer = null;
const pendingCompletions = new Map();
const COMPLETE_TASK_DEBOUNCE_MS = 300;

// Rendering debounce to prevent flicker
let renderDebounceTimer = null;
const RENDER_DEBOUNCE_MS = 150;
let isBatchProcessing = false; // Flag to skip renders during batch operations
let optimisticCooldown = false; // Flag to skip subscription renders after optimistic updates
const OPTIMISTIC_COOLDOWN_MS = 2000; // Skip renders for 2 seconds after optimistic update

/**
 * Todoist-style instant task completion with smooth animation.
 * Updates DOM immediately, saves to Firestore in background.
 */
async function completeTask(index, projectId, section) {
    const tasks = state.projectCache.tasks[projectId] || [];
    const sectionTasks = tasks.filter(t => t.section === section);

    if (index < 0 || index >= sectionTasks.length) return;

    const task = sectionTasks[index];
    if (!task || !task.id) return;

    // Play sound immediately for feedback
    playPopSound().catch(() => { });

    // ACTIVATE COOLDOWN: Prevent subscription-triggered re-renders
    optimisticCooldown = true;
    setTimeout(() => { optimisticCooldown = false; }, OPTIMISTIC_COOLDOWN_MS);

    // OPTIMISTIC UI: Immediately animate and remove from DOM
    const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
    if (taskElement) {
        // Add completion animation class
        taskElement.classList.add('task-completing');
        const checkbox = taskElement.querySelector('.task-checkbox');
        if (checkbox) checkbox.classList.add('checked');

        // Animate out after a brief pause to show the check
        setTimeout(() => {
            taskElement.classList.add('task-removing');
            setTimeout(() => taskElement.remove(), 250);
        }, 150);
    }

    // Update local cache immediately (optimistic)
    const remainingTasks = tasks.filter(t => t.id !== task.id);
    state.projectCache.setTasks(projectId, remainingTasks);



    // Background save to Firestore (awaited to ensure persistence)
    await taskService.completeTask(projectId, task.id).catch(e => {
        console.error('Complete task failed:', e);
        // On error, restore the task (pessimistic rollback)
        optimisticCooldown = false;
        state.projectCache.setTasks(projectId, tasks);
        // Display tasks again to revert UI
        displayTasks(projectId, section);
    });
}

/**
 * Process all pending task completions in a single batch.
 * This prevents transaction conflicts from rapid consecutive saves.
 */
async function processPendingCompletions() {
    if (pendingCompletions.size === 0) return;

    // Set batch processing flag to prevent intermediate re-renders
    isBatchProcessing = true;

    // Group completions by projectId
    const completionsByProject = new Map();
    for (const [key, completion] of pendingCompletions) {
        const { projectId } = completion;
        if (!completionsByProject.has(projectId)) {
            completionsByProject.set(projectId, []);
        }
        completionsByProject.get(projectId).push(completion);
    }

    pendingCompletions.clear();
    completeTaskDebounceTimer = null;

    for (const [projectId, completions] of completionsByProject) {
        try {
            // Get current state to resolve indices to IDs
            // Note: We  use the existing cache state because indices refer to what user CLICKED
            const tasks = state.projectCache.tasks[projectId] || await taskService.getTasks(projectId);

            // Process sequentially to avoid race conditions
            for (const { index, section } of completions) {
                const sectionTasks = tasks.filter(t => t.section === section);
                if (index >= 0 && index < sectionTasks.length) {
                    const task = sectionTasks[index];
                    if (task && task.id) {
                        await taskService.completeTask(projectId, task.id);
                    }
                }
            }

            console.log(`[ExtractedPage] Batch processed completions for ${projectId}`);

            // Wait a bit for Firestore to commit
            await new Promise(resolve => setTimeout(resolve, 100));

            // Re-enable renders and trigger ONE final render
            isBatchProcessing = false;

            // Refresh UI - but only ONCE after all completions
            if (state.currentProject === projectId) {
                const updatedTasks = await taskService.getTasks(projectId);
                state.projectCache.setTasks(projectId, updatedTasks);
                await displayTasks(projectId, state.currentSection);
            }

        } catch (error) {
            console.error('[ExtractedPage] Error in batch task completion:', error);
            isBatchProcessing = false; // Reset flag on error
        }
    }
}

async function saveEditedTask() {
    const taskIndex = parseInt(document.getElementById('editTaskIndex')?.value);
    const section = document.getElementById('editTaskSection')?.value;
    const projectId = state.currentProject;

    try {
        const tasks = state.projectCache.tasks[projectId] || [];
        const sectionTasks = tasks.filter(t => t.section === section);
        const task = sectionTasks[taskIndex];

        if (task && task.id) {
            const updates = {
                title: document.getElementById('editTaskTitle')?.value || task.title,
                description: document.getElementById('editTaskDescription')?.value || '',
                dueDate: document.getElementById('editTaskDueDate')?.value || '',
                priority: document.getElementById('editTaskPriority')?.value || 'medium'
            };

            // ACTIVATE COOLDOWN: Prevent subscription-triggered re-renders
            optimisticCooldown = true;
            setTimeout(() => { optimisticCooldown = false; }, OPTIMISTIC_COOLDOWN_MS);

            // OPTIMISTIC UI: Update DOM immediately
            const taskElement = document.querySelector(`[data-task-id="${task.id}"]`);
            if (taskElement) {
                const titleEl = taskElement.querySelector('h5');
                const descEl = taskElement.querySelector('p.text-secondary');
                const dueDateEl = taskElement.querySelector('.due-date');
                const priorityEl = taskElement.querySelector('.priority-badge');

                if (titleEl) titleEl.textContent = updates.title;
                if (descEl) descEl.textContent = updates.description || 'No description';
                if (dueDateEl) dueDateEl.innerHTML = `<i class="bi bi-calendar-event"></i> ${formatDate(updates.dueDate)}`;
                if (priorityEl) {
                    priorityEl.textContent = updates.priority;
                    priorityEl.style.backgroundColor = getPriorityColor(updates.priority);
                }

                // Flash animation to show update succeeded
                taskElement.style.transition = 'background-color 0.3s ease';
                taskElement.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
                setTimeout(() => {
                    taskElement.style.backgroundColor = '';
                }, 300);
            }

            // Update local cache immediately
            const updatedTask = { ...task, ...updates, updatedAt: new Date().toISOString() };
            // FIXED: Use String() for ID normalization
            const updatedTasks = tasks.map(t => String(t.id) === String(task.id) ? updatedTask : t);
            state.projectCache.setTasks(projectId, updatedTasks);

            // Close modal immediately (don't wait for Firestore)
            closeEditTaskModal();

            // Background save to Firestore (no await)
            taskService.updateTask(projectId, task.id, updates).catch(error => {
                console.error('[ExtractedPage] Error saving edited task:', error);
                // On error, restore and re-render
                optimisticCooldown = false;
                state.projectCache.setTasks(projectId, tasks);
                displayTasks(projectId, section);
            });
        }
    } catch (error) {
        console.error('[ExtractedPage] Error saving edited task:', error);
    }
}

// ============================================
// Modal Functions
// ============================================
function showAddTaskForm() {
    const form = document.getElementById('addTaskForm');
    if (form) form.style.display = 'block';
}

function hideAddTaskForm() {
    const form = document.getElementById('addTaskForm');
    if (form) form.style.display = 'none';

    // Clear form fields
    const titleField = document.getElementById('taskTitle');
    const descField = document.getElementById('taskDescription');
    const bulkField = document.getElementById('bulkTasks');
    if (titleField) titleField.value = '';
    if (descField) descField.value = '';
    if (bulkField) bulkField.value = '';
}

function toggleInputMode(mode) {
    state.currentInputMode = mode;
    const singleInput = document.getElementById('singleTaskInput');
    const bulkInput = document.getElementById('bulkTaskInput');
    if (singleInput) singleInput.style.display = mode === 'single' ? 'block' : 'none';
    if (bulkInput) bulkInput.style.display = mode === 'bulk' ? 'block' : 'none';
}

function showEditTaskModal(index, section) {
    const projectId = state.currentProject;
    // Phase 2: Use TaskRepository if available
    const tasks = window.TaskRepository ?
        window.TaskRepository.getAllTasks(projectId) :
        JSON.parse(localStorage.getItem(`tasks-${projectId}`)) || [];
    const sectionTasks = tasks.filter(t => t.section === section);
    const task = sectionTasks[index];

    if (task) {
        document.getElementById('editTaskIndex').value = index;
        document.getElementById('editTaskSection').value = section;
        document.getElementById('editTaskTitle').value = task.title;
        document.getElementById('editTaskDescription').value = task.description || '';
        document.getElementById('editTaskDueDate').value = task.dueDate || '';
        document.getElementById('editTaskPriority').value = task.priority;
        document.getElementById('editTaskModal').style.display = 'flex';
    }
}

function closeEditTaskModal() {
    const modal = document.getElementById('editTaskModal');
    if (modal) modal.style.display = 'none';
}

async function showWeightageModal(projectId) {
    const modal = document.getElementById('weightageModal');
    const inputsContainer = document.getElementById('weightageInputs');

    if (!modal || !inputsContainer) return;

    modal.dataset.projectId = projectId;

    const projectWeightages = JSON.parse(localStorage.getItem('projectWeightages') || '{}');
    const subjectWeightages = JSON.parse(localStorage.getItem('subjectWeightages') || '{}');

    let sectionWeightages = {};
    SUBSECTIONS.forEach(section => {
        sectionWeightages[section] = { min: 0, max: 0 };
    });

    // Map from subject marks system
    if (subjectWeightages[projectId]) {
        const categoryToSection = {
            assignment: 'Assignment',
            quiz: 'Quizzes',
            midterm: 'Mid Term / OHT',
            final: 'Finals',
            revision: 'Revision'
        };

        for (const category in subjectWeightages[projectId]) {
            const sectionName = categoryToSection[category] || category;
            const weight = subjectWeightages[projectId][category];

            if (SUBSECTIONS.includes(sectionName)) {
                sectionWeightages[sectionName] = {
                    min: Math.max(0, weight - 5),
                    max: Math.min(100, weight + 5)
                };
            }
        }
    }

    if (projectWeightages[projectId]) {
        sectionWeightages = { ...sectionWeightages, ...projectWeightages[projectId] };
    }

    inputsContainer.innerHTML = SUBSECTIONS.map(section => {
        const sectionData = sectionWeightages[section] || { min: 0, max: 0 };
        return `
            <div class="mb-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <label>${escapeHtml(section)}</label>
                    <span class="weightage-avg" data-section="${escapeHtml(section)}">
                        ${((sectionData.min + sectionData.max) / 2).toFixed(1)}%
                    </span>
                </div>
                <div class="weightage-input-group" data-section="${escapeHtml(section)}">
                    <input type="number"
                           class="weightage-input"
                           data-section="${escapeHtml(section)}"
                           data-type="min"
                           value="${sectionData.min}"
                           min="0"
                           max="100">
                    <span>to</span>
                    <input type="number"
                           class="weightage-input"
                           data-section="${escapeHtml(section)}"
                           data-type="max"
                           value="${sectionData.max}"
                           min="0"
                           max="100">
                </div>
            </div>
        `;
    }).join('');

    updateWeightageAverage();
    modal.style.display = 'block';
}

function updateWeightageAverage() {
    let totalAverage = 0;

    SUBSECTIONS.forEach(section => {
        const minInput = document.querySelector(`input[data-section="${section}"][data-type="min"]`);
        const maxInput = document.querySelector(`input[data-section="${section}"][data-type="max"]`);
        const avgSpan = document.querySelector(`span.weightage-avg[data-section="${section}"]`);

        const min = parseInt(minInput?.value) || 0;
        const max = parseInt(maxInput?.value) || 0;
        const avg = (min + max) / 2;

        totalAverage += avg;

        if (avgSpan) {
            avgSpan.textContent = `${avg.toFixed(1)}%`;
        }
    });

    const totalAverageSpan = document.getElementById('totalAverage');
    if (totalAverageSpan) {
        totalAverageSpan.textContent = `${totalAverage.toFixed(1)}%`;
        totalAverageSpan.style.color = Math.abs(totalAverage - 100) < 0.1 ? 'var(--secondary-color)' : 'var(--primary-color)';
    }
}

async function saveWeightages() {
    const modal = document.getElementById('weightageModal');
    const projectId = modal?.dataset.projectId;
    if (!projectId) return;

    const weightages = {};
    const allSections = Array.from(document.querySelectorAll('.weightage-input-group')).map(group => group.dataset.section);

    allSections.forEach(section => {
        const minInput = document.querySelector(`input[data-section="${section}"][data-type="min"]`);
        const maxInput = document.querySelector(`input[data-section="${section}"][data-type="max"]`);

        const min = parseInt(minInput?.value) || 0;
        const max = parseInt(maxInput?.value) || 0;
        const avg = Math.round((min + max) / 2);

        weightages[section] = { min, max, avg };
    });

    const totalAverage = allSections.reduce((sum, section) => sum + weightages[section].avg, 0);
    if (Math.abs(totalAverage - 100) > 5) {
        alert('The average of all weightages must sum to 100%');
        return;
    }

    const allWeightages = JSON.parse(localStorage.getItem('projectWeightages') || '{}');
    allWeightages[projectId] = weightages;
    localStorage.setItem('projectWeightages', JSON.stringify(allWeightages));
    await saveWeightagesToFirestore(allWeightages);

    if (window.syncProjectToSubjectWeightages) {
        window.syncProjectToSubjectWeightages(projectId, weightages);
    }

    closeWeightageModal();
    await displayTasks(projectId, state.currentSection);
}

function closeWeightageModal() {
    const modal = document.getElementById('weightageModal');
    if (modal) modal.style.display = 'none';
}

async function showHistoryModal(projectId) {
    // Phase 2: Use TaskRepository if available
    const completedTasks = window.TaskRepository ?
        window.TaskRepository.getCompletedTasks(projectId) :
        JSON.parse(localStorage.getItem(`completed-tasks-${projectId}`) || '[]');
    const historyList = document.getElementById('historyList');

    if (!historyList) return;

    if (completedTasks.length === 0) {
        historyList.innerHTML = `
            <div class="no-history">
                <i class="bi bi-clock-history mb-2" style="font-size: 2rem;"></i>
                <p>No completed tasks yet</p>
            </div>
        `;
    } else {
        historyList.innerHTML = completedTasks.map(task => `
            <div class="completed-task">
                <div class="task-details">
                    <h6 class="mb-1">${escapeHtml(task.title)}</h6>
                    <p class="mb-1 text-secondary">${escapeHtml(task.description) || 'No description'}</p>
                    <div class="d-flex align-items-center gap-3">
                        <span class="badge bg-secondary">${escapeHtml(task.section)}</span>
                        <span class="priority-badge" style="background-color: ${getPriorityColor(task.priority)}">
                            ${escapeHtml(task.priority)}
                        </span>
                        <span class="due-date">
                            <i class="bi bi-calendar-event"></i>
                            ${formatDate(task.dueDate)}
                        </span>
                    </div>
                </div>
                <div class="completion-date">
                    Completed ${formatDate(task.completedAt)}
                </div>
            </div>
        `).join('');
    }

    document.getElementById('historyModal').style.display = 'flex';
}

function closeHistoryModal() {
    const modal = document.getElementById('historyModal');
    if (modal) modal.style.display = 'none';
}

// ============================================
// File Upload
// ============================================
function uploadAttachment(taskId, projectId, section) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileInput.addEventListener('change', async (event) => {
        if (event.target.files && event.target.files.length > 0) {
            const files = Array.from(event.target.files);
            const container = document.getElementById(`task-attachments-${taskId}`);

            if (!container) {
                alert('Error: Cannot find task container');
                document.body.removeChild(fileInput);
                return;
            }

            const uploadStatus = document.createElement('div');
            uploadStatus.className = 'upload-status';
            uploadStatus.innerHTML = `<i class="bi bi-arrow-repeat"></i> Uploading ${files.length} file(s)...`;
            container.appendChild(uploadStatus);

            try {
                for (const file of files) {
                    if (googleDriveAPI && typeof googleDriveAPI.uploadFile === 'function') {
                        await googleDriveAPI.uploadFile(file, taskId);
                    } else {
                        throw new Error('Google Drive API not available');
                    }
                }

                uploadStatus.innerHTML = `<i class="bi bi-check-circle"></i> Upload complete!`;
                uploadStatus.style.color = 'var(--secondary-color)';

                if (taskAttachments && typeof taskAttachments.init === 'function') {
                    setTimeout(() => {
                        taskAttachments.init(taskId, container);
                        setTimeout(() => uploadStatus.remove(), 2000);
                    }, ATTACHMENT_REFRESH_DELAY_MS);
                }
            } catch (error) {
                console.error('[ExtractedPage] Upload error:', error);
                uploadStatus.innerHTML = `<i class="bi bi-exclamation-circle"></i> Upload failed: ${error.message}`;
                uploadStatus.style.color = 'var(--primary-color)';
                setTimeout(() => uploadStatus.remove(), UPLOAD_STATUS_DISPLAY_MS);
            }
        }

        document.body.removeChild(fileInput);
    });

    fileInput.click();
}

// ============================================
// Sign In
// ============================================
async function signInWithGoogle() {
    try {
        await signInWithPopup(state.auth, state.provider);
    } catch (error) {
        console.error('[ExtractedPage] Sign in error:', error);
    }
}

async function signOutUser() {
    try {
        await state.auth.signOut();
    } catch (error) {
        console.error('[ExtractedPage] Sign out error:', error);
    }
}

function showSignInPrompt() {
    if (typeof window.showWelcomeSignInDialog === 'function') {
        window.showWelcomeSignInDialog();
    } else if (window.userGuidance?.showSignInPrompt) {
        window.userGuidance.showSignInPrompt();
    } else {
        signInWithGoogle();
    }
}

// ============================================
// Sidebar Toggle
// ============================================
function setupSidebarToggle() {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('projectsSidebar');
    const mainContent = document.querySelector('.main-content');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    if (!sidebarToggle || !sidebar) return;

    function toggleSidebar() {
        const isCollapsed = sidebar.classList.contains('closing');

        if (isCollapsed) {
            sidebar.classList.remove('closing');
            mainContent?.classList.remove('full-width');
            sidebarToggle.classList.remove('collapsed');
            const icon = sidebarToggle.querySelector('i');
            if (icon) icon.className = 'bi bi-chevron-left';
        } else {
            sidebar.classList.add('closing');
            mainContent?.classList.add('full-width');
            sidebarToggle.classList.add('collapsed');
            const icon = sidebarToggle.querySelector('i');
            if (icon) icon.className = 'bi bi-chevron-right';
        }

        // Mobile overlay
        if (window.innerWidth <= 992 && sidebarOverlay) {
            sidebarOverlay.style.display = isCollapsed ? 'block' : 'none';
        }
    }

    sidebarToggle.addEventListener('click', toggleSidebar);

    sidebarOverlay?.addEventListener('click', () => {
        if (sidebar.classList.contains('active')) {
            toggleSidebar();
        }
    });

    // Auto-collapse on mobile
    if (window.innerWidth <= 992) {
        sidebar.classList.add('closing');
        mainContent?.classList.add('full-width');
        sidebarToggle.classList.add('collapsed');
    }

    // Handle window resize
    window.addEventListener('resize', () => {
        if (window.innerWidth <= 992) {
            if (!sidebar.classList.contains('closing') && sidebarOverlay) {
                sidebarOverlay.style.display = 'block';
            }
        } else if (sidebarOverlay) {
            sidebarOverlay.style.display = 'none';
        }
    });
}

// ============================================
// Event Delegation
// ============================================
function setupEventDelegation() {
    // Create abort controller for cleanup
    state.abortController = new AbortController();
    const { signal } = state.abortController;

    // Main container event delegation
    document.addEventListener('click', async (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;

        switch (action) {
            case 'sign-in':
                showSignInPrompt();
                break;
            case 'show-task-form':
                showAddTaskForm();
                break;
            case 'hide-task-form':
                hideAddTaskForm();
                break;
            case 'toggle-input-mode':
                toggleInputMode(target.dataset.mode);
                break;
            case 'add-task':
                await addTask();
                break;
            case 'select-project':
                await selectProject(target.dataset.project, target.dataset.section || null);
                break;
            case 'complete-task':
                await completeTask(
                    parseInt(target.dataset.index),
                    target.dataset.project,
                    target.dataset.section
                );
                break;
            case 'edit-task':
                showEditTaskModal(parseInt(target.dataset.index), target.dataset.section);
                break;
            case 'delete-task':
                await deleteTask(parseInt(target.dataset.index), target.dataset.section);
                break;
            case 'show-history':
                await showHistoryModal(target.dataset.project);
                break;
            case 'close-history':
                closeHistoryModal();
                break;
            case 'show-weightage':
                await showWeightageModal(target.dataset.project);
                break;
            case 'save-weightages':
                await saveWeightages();
                break;
            case 'close-weightage':
                closeWeightageModal();
                break;
            case 'save-edited-task':
                await saveEditedTask();
                break;
            case 'close-edit-modal':
                closeEditTaskModal();
                break;
            case 'upload-attachment':
                uploadAttachment(target.dataset.taskId, target.dataset.project, target.dataset.section);
                break;
            case 'scan-document':
                scanDocument(target.dataset.taskId, target.dataset.project, target.dataset.section);
                break;
        }
    }, { signal });

    // Sidebar project clicks
    document.getElementById('projectsSidebar')?.addEventListener('click', async (e) => {
        const projectItem = e.target.closest('.project-item');
        if (projectItem) {
            const projectId = projectItem.dataset.project;
            const section = projectItem.dataset.section || null;
            await selectProject(projectId, section);
        }
    }, { signal });

    // Modal click-outside-to-close
    ['editTaskModal', 'weightageModal', 'historyModal'].forEach(modalId => {
        const modal = document.getElementById(modalId);
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        }, { signal });
    });

    // Weightage input change handler
    document.getElementById('weightageInputs')?.addEventListener('input', (e) => {
        if (e.target.classList.contains('weightage-input')) {
            updateWeightageAverage();
        }
    }, { signal });
}

// ============================================
// Cross-Tab Sync
// ============================================
function setupCrossTabSync() {
    if (crossTabSync && typeof crossTabSync.onUserAction === 'function') {
        crossTabSync.onUserAction('task-update', (data) => {
            console.log('[ExtractedPage] Task update received for project:', data.projectId);

            // Only refresh if we are currently viewing this project
            if (state.currentProject === data.projectId) {
                // Invalidate cache to force re-render from the latest data
                state.projectCache.clearProject(data.projectId);

                // Re-display tasks (this will re-fetch or use snapshot)
                displayTasks(data.projectId, state.currentSection);
            } else {
                // Just clear the cache so next time we visit it loads fresh
                state.projectCache.clearProject(data.projectId);
            }
        });
    }
}

// ============================================
// Page Manager
// ============================================
function setupPageManager() {
    window.pageManager = {
        currentPage: window.location.pathname,
        pageCache: new Map(),

        preloadPage(url) {
            if (this.pageCache.has(url)) return;

            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = url;
            document.head.appendChild(link);
            this.pageCache.set(url, true);
        },

        navigateTo(url) {
            const scrollPos = { x: window.scrollX, y: window.scrollY };
            sessionStorage.setItem('scrollPos-' + this.currentPage, JSON.stringify(scrollPos));
            window.location.href = url;
        }
    };

    // Preload linked pages
    document.querySelectorAll('a').forEach(link => {
        const url = link.getAttribute('href');
        if (url && !url.startsWith('#') && !url.startsWith('javascript:')) {
            window.pageManager.preloadPage(url);
        }
    });

    // Restore scroll position
    const scrollPos = sessionStorage.getItem('scrollPos-' + window.location.pathname);
    if (scrollPos) {
        try {
            const { x, y } = JSON.parse(scrollPos);
            window.scrollTo(x, y);
        } catch (e) {
            // Ignore parse errors
        }
    }
}

// ============================================
// Initialization
// ============================================
async function initialize() {
    if (state.initialized) return;

    try {
        // Initialize Firebase
        await initializeFirebase();

        // Initialize Google Drive API (non-blocking)
        googleDriveAPI.initialize().catch(error => {
            console.warn('[ExtractedPage] Google Drive API init failed:', error.message);
        });

        // Set up UI components
        setupSidebarToggle();
        setupEventDelegation();
        setupCrossTabSync();
        setupPageManager();

        // Make task attachments available globally
        window.taskAttachments = taskAttachments;

        // Set up auth state listener
        onAuthStateChanged(state.auth, (user) => {
            if (user) {
                console.log('[ExtractedPage] User signed in, loading projects');
                loadProjects();
            } else {
                console.log('[ExtractedPage] User signed out');
                loadProjects(); // Will show sign-in prompt
            }
        });

        // Set up reactive sidebar listener using SemesterService
        SemesterService.subscribe((event) => {
            if (event.type === 'semester-change' || event.type === 'semester-updated' || event.type === 'semester-created') {
                console.log('[ExtractedPage] Semester update detected, refreshing sidebar');
                loadProjects();
            }
        });

        // Initial load
        await loadProjects();

        // Page fade-in
        document.body.style.opacity = '0';
        requestAnimationFrame(() => {
            document.body.style.opacity = '1';
            document.body.style.transition = 'opacity 0.3s ease';
        });

        state.initialized = true;
        console.log('[ExtractedPage] Initialization complete');
    } catch (error) {
        console.error('[ExtractedPage] Initialization failed:', error);
    }
}

// ============================================
// Cleanup (for SPA navigation if needed)
// ============================================
function cleanup() {
    if (state.abortController) {
        state.abortController.abort();
    }
    state.reset();
}

// ============================================
// Export Functions for Global Access
// ============================================
export {
    initialize,
    cleanup,
    state,
    loadProjects,
    selectProject,
    displayTasks,
    addTask,
    deleteTask,
    completeTask,
    saveEditedTask,
    showAddTaskForm,
    hideAddTaskForm,
    toggleInputMode,
    showEditTaskModal,
    closeEditTaskModal,
    showWeightageModal,
    closeWeightageModal,
    saveWeightages,
    updateWeightageAverage,
    showHistoryModal,
    closeHistoryModal,
    uploadAttachment,
    signInWithGoogle,
    signOutUser,
    showSignInPrompt,
    SUBSECTIONS
};

// ============================================
// Auto-initialize on DOM ready
// ============================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Make functions available globally for backwards compatibility
window.ExtractedPageController = {
    initialize,
    cleanup,
    state,
    loadProjects,
    selectProject,
    displayTasks,
    addTask,
    deleteTask,
    completeTask,
    saveEditedTask,
    showAddTaskForm,
    hideAddTaskForm,
    toggleInputMode,
    showEditTaskModal,
    closeEditTaskModal,
    showWeightageModal,
    closeWeightageModal,
    saveWeightages,
    updateWeightageAverage,
    showHistoryModal,
    closeHistoryModal,
    uploadAttachment,
    signInWithGoogle,
    signOutUser,
    showSignInPrompt
};
