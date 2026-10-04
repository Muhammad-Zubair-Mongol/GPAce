import { getApiClient } from './services/ApiClient.js';

// priority-list-utils.js - Utility functions for the priority list page

// This page may be imported by the deterministic harness before a browser
// global exists, so keep the auxiliary settings adapter lazy and guarded.
const initialWindow = typeof window !== 'undefined' ? window : globalThis;
if (typeof initialWindow.getStorage !== 'function') {
    initialWindow.getStorage = () => initialWindow.StorageService || {
        get: (key, fallback) => {
            try {
                const raw = initialWindow.localStorage?.getItem(key);
                return raw == null ? fallback : JSON.parse(raw);
            } catch {
                return fallback;
            }
        },
        set: (key, value) => {
            try {
                return initialWindow.localStorage?.setItem(key, JSON.stringify(value));
            } catch {
                return false;
            }
        }
    };
}

const getStorage = () => {
    const runtimeWindow = typeof window !== 'undefined' ? window : initialWindow;
    return typeof runtimeWindow.getStorage === 'function'
        ? runtimeWindow.getStorage()
        : initialWindow.getStorage();
};

const PRIORITY_CHANGE_EVENTS = new Set([
    'PRIORITY_UPDATED',
    'TASK_ADDED',
    'TASK_UPDATED',
    'TASK_COMPLETED',
    'TASK_DELETED',
    'TASKS_REPLACED',
    'TASKS_INVALIDATED'
]);

const priorityListState = {
    status: 'idle',
    tasks: [],
    repository: null,
    error: null,
    renderCount: 0,
    initialized: false,
    initialization: null,
    unsubscribe: null,
    storageWindow: null,
    storageHandler: null,
    document: null,
    sort: {
        field: 'priorityScore',
        direction: 'desc'
    }
};

function getRuntimeWindow(windowRef) {
    return windowRef || (typeof window !== 'undefined' ? window : initialWindow);
}

function getRuntimeDocument(documentRef) {
    return documentRef || (typeof document !== 'undefined' ? document : null);
}

function resolveRepository(windowRef, explicitRepository) {
    const runtimeWindow = getRuntimeWindow(windowRef);
    return explicitRepository
        || runtimeWindow.TaskService
        || runtimeWindow.gpac
        || runtimeWindow.TaskRepository
        || null;
}

function getPriorityReader(repository) {
    if (!repository) return null;
    if (typeof repository.getPriorityTasks === 'function') {
        return repository.getPriorityTasks.bind(repository);
    }
    if (typeof repository.getPriorityCache === 'function') {
        return repository.getPriorityCache.bind(repository);
    }
    if (typeof repository.getAllPriorityTasks === 'function') {
        return repository.getAllPriorityTasks.bind(repository);
    }
    return null;
}

function normalizePriorityTasks(tasks) {
    if (!Array.isArray(tasks)) {
        throw new Error('Canonical priority repository returned an invalid task list');
    }

    return tasks
        .filter(task => task && typeof task === 'object')
        .filter(task => task.completed !== true && task.deleted !== true)
        .map(task => ({ ...task }));
}

function readCanonicalPriorityTasks(repository = priorityListState.repository) {
    const reader = getPriorityReader(repository);
    if (!reader) {
        throw new Error('Canonical priority repository is unavailable');
    }

    const tasks = reader();
    if (tasks && typeof tasks.then === 'function') {
        throw new Error('Canonical priority repository requires asynchronous initialization');
    }
    return normalizePriorityTasks(tasks);
}

async function readCanonicalPriorityTasksAsync(repository = priorityListState.repository) {
    const reader = getPriorityReader(repository);
    if (!reader) {
        throw new Error('Canonical priority repository is unavailable');
    }
    return normalizePriorityTasks(await reader());
}

function getPriorityCommandFacade(windowRef = priorityListState.storageWindow) {
    const runtimeWindow = getRuntimeWindow(windowRef);
    const candidates = [
        runtimeWindow.TaskService,
        runtimeWindow.gpac,
        priorityListState.repository
    ];
    return candidates.find(candidate => candidate && (
        typeof candidate.completeTask === 'function'
        || typeof candidate.skipTask === 'function'
        || typeof candidate.reorderPriorityTasks === 'function'
        || typeof candidate.savePriorityCache === 'function'
    )) || null;
}

function renderPriorityState(state, message, documentRef = priorityListState.document) {
    const taskList = documentRef?.getElementById?.('taskList');
    if (!taskList) return false;
    if (!taskList.dataset) taskList.dataset = {};
    taskList.dataset.state = state;
    taskList.innerHTML = `<div class="priority-list-state ${state}" role="${state === 'empty' ? 'status' : 'alert'}">${message}</div>`;
    priorityListState.renderCount += 1;
    return true;
}

function renderEmptyPriorityList(documentRef = priorityListState.document) {
    return renderPriorityState('empty', 'No priority tasks found.', documentRef);
}

function renderUnavailablePriorityList(documentRef = priorityListState.document, state = 'unavailable') {
    const message = state === 'corrupt'
        ? 'Priority tasks could not be read from the repository.'
        : 'Priority tasks are temporarily unavailable.';
    return renderPriorityState(state, message, documentRef);
}

function isPriorityRepositoryEvent(eventName, data) {
    if (data && data.affected === false) return false;
    if (data && data.affectsPriorityList === false) return false;
    return PRIORITY_CHANGE_EVENTS.has(String(eventName || '').toUpperCase());
}

function subscribeToPriorityChanges(windowRef, repository) {
    if (priorityListState.unsubscribe) return;

    const subscriptionSource = repository?.subscribe || repository?.onRemoteChange
        ? repository
        : repository?.repository;

    const refresh = (eventName, data) => {
        if (!isPriorityRepositoryEvent(eventName, data)) return;
        void refreshPriorityList(priorityListState.document);
    };

    if (typeof subscriptionSource?.subscribe === 'function') {
        const unsubscribe = subscriptionSource.subscribe(refresh);
        priorityListState.unsubscribe = typeof unsubscribe === 'function' ? unsubscribe : () => {};
        return;
    }
    if (typeof subscriptionSource?.onRemoteChange === 'function') {
        const unsubscribe = subscriptionSource.onRemoteChange(refresh);
        priorityListState.unsubscribe = typeof unsubscribe === 'function' ? unsubscribe : () => {};
        return;
    }

    // The canonical repository normally supplies the subscription above. This
    // narrow bridge handles its cross-tab invalidation messages without making
    // arbitrary storage keys redraw the page.
    if (typeof windowRef?.addEventListener === 'function') {
        const storageHandler = event => {
            if (event?.key !== 'gpac_last_change' && event?.key !== 'gpac_tasks_invalidated') return;
            let data = event?.data || null;
            if (!data && typeof event?.newValue === 'string') {
                try { data = JSON.parse(event.newValue); } catch { data = null; }
            }
            const eventName = data?.type || data?.event || 'TASKS_INVALIDATED';
            refresh(eventName, data);
        };
        windowRef.addEventListener('storage', storageHandler);
        priorityListState.storageWindow = windowRef;
        priorityListState.storageHandler = storageHandler;
        priorityListState.unsubscribe = () => windowRef.removeEventListener?.('storage', storageHandler);
    }
}

async function initializePriorityRepository(options = {}) {
    if (priorityListState.initialization) return priorityListState.initialization;

    const runtimeWindow = getRuntimeWindow(options.windowRef);
    const runtimeDocument = getRuntimeDocument(options.documentRef);
    priorityListState.storageWindow = runtimeWindow;
    priorityListState.document = runtimeDocument;

    priorityListState.initialization = (async () => {
        let readyResult = null;
        const loader = options.loader || runtimeWindow.TaskSystemLoader;
        const repository = resolveRepository(runtimeWindow, options.repository);

        if (typeof loader?.ready === 'function') {
            readyResult = await loader.ready();
        } else if (typeof repository?.ready === 'function') {
            readyResult = await repository.ready();
        } else if (typeof runtimeWindow.gpac?.ready === 'function') {
            readyResult = await runtimeWindow.gpac.ready();
        }

        const canonicalRepository = options.repository
            || runtimeWindow.TaskService
            || readyResult?.repository
            || resolveRepository(runtimeWindow);
        if (!canonicalRepository) {
            throw new Error('Canonical priority repository is unavailable');
        }
        if (!getPriorityReader(canonicalRepository)) {
            throw new Error('Canonical priority repository has no priority reader');
        }

        priorityListState.repository = canonicalRepository;
        priorityListState.initialized = true;
        priorityListState.status = 'ready';
        priorityListState.error = null;
        subscribeToPriorityChanges(runtimeWindow, canonicalRepository);
        return canonicalRepository;
    })().catch(error => {
        priorityListState.status = 'unavailable';
        priorityListState.error = error;
        priorityListState.initialized = false;
        return null;
    });

    return priorityListState.initialization;
}

async function refreshPriorityList(documentRef = priorityListState.document) {
    const runtimeDocument = getRuntimeDocument(documentRef);
    priorityListState.document = runtimeDocument;
    const repository = priorityListState.repository;
    if (!repository) {
        priorityListState.status = 'unavailable';
        renderUnavailablePriorityList(runtimeDocument);
        return false;
    }

    try {
        priorityListState.tasks = await readCanonicalPriorityTasksAsync(repository);
        if (priorityListState.tasks.length === 0) {
            priorityListState.status = 'empty';
            renderEmptyPriorityList(runtimeDocument);
        } else {
            priorityListState.status = 'ready';
            displayTasks(priorityListState.tasks, runtimeDocument);
        }
        return true;
    } catch (error) {
        const state = priorityListState.repository ? 'corrupt' : 'unavailable';
        priorityListState.status = state;
        priorityListState.error = error;
        renderUnavailablePriorityList(runtimeDocument, state);
        return false;
    }
}

function getPriorityListState() {
    return {
        status: priorityListState.status,
        tasks: priorityListState.tasks.map(task => ({ ...task })),
        repository: priorityListState.repository,
        error: priorityListState.error,
        renderCount: priorityListState.renderCount
    };
}

function destroyPriorityList() {
    priorityListState.unsubscribe?.();
    priorityListState.unsubscribe = null;
    if (priorityListState.storageWindow && priorityListState.storageHandler) {
        priorityListState.storageWindow.removeEventListener?.('storage', priorityListState.storageHandler);
    }
    priorityListState.storageWindow = null;
    priorityListState.storageHandler = null;
    priorityListState.status = 'idle';
    priorityListState.tasks = [];
    priorityListState.repository = null;
    priorityListState.error = null;
    priorityListState.renderCount = 0;
    priorityListState.initialized = false;
    priorityListState.initialization = null;
    priorityListState.document = null;
}

/**
 * Task Data Functions
 */

// Read priority tasks only through the initialized canonical repository.
function getAllTasks() {
    const tasks = readCanonicalPriorityTasks();
    priorityListState.tasks = tasks;
    return tasks;
}

// Format a date string for display
function formatDate(dateString) {
    if (!dateString) return 'No due date';
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Check if date is valid
    if (isNaN(date.getTime())) return 'Invalid date';

    // Format the date
    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
        return 'Tomorrow';
    } else {
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
        });
    }
}

// Get CSS class for due date styling
function getDueDateClass(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const today = new Date();
    const diffTime = date - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'overdue';
    if (diffDays <= 2) return 'due-soon';
    return '';
}

// Helper function to format the group date in a readable format
function formatGroupDate(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Check if date is valid
    if (isNaN(date.getTime())) return dateString;

    // Format the date
    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
        });
    }
}

/**
 * Subtask Functions
 */

// Generate subtasks for a task using the API
async function generateSubtasks(taskId, taskData) {
    const prompt = `Break down this academic task into specific, actionable steps that require minimal decision-making:
Task: ${taskData.title}
Section: ${taskData.section}
Project: ${taskData.projectName}
Priority Score: ${taskData.priorityScore}

Generate a numbered list of specific steps to complete this task. Each step should:
1. Be concrete and actionable (start with verbs)
2. Focus on a single, clear action
3. Require minimal decision making
4. Include any necessary preparation
5. Build towards the final goal

Important: Do not include any time estimates or duration information.

Example format:
1. Gather textbook and class notes
2. Review chapter introduction
3. Create main topic outline
etc.`;

    try {
        console.log('Sending request with task data:', taskData);
        const data = await getApiClient().post('/api/generate-subtasks', { prompt });
        console.log('Received subtasks:', data);

        if (!data.subtasks || data.subtasks.length === 0) {
            throw new Error('No subtasks were generated');
        }

        return data.subtasks;
    } catch (error) {
        console.error('Error generating subtasks:', error);
        return [`Error: ${error.message}. Please try again.`];
    }
}

// Toggle subtasks visibility and load them if needed
async function toggleSubtasks(button, taskId) {
    console.group(`Toggle Subtasks for Task ID: ${taskId}`);
    console.log('Button:', button);
    console.log('Task ID:', taskId);

    // Find the specific container for this task
    const container = document.getElementById(`subtasks-${taskId}`);
    console.log('Container:', container);

    if (!container) {
        console.error(`No container found for task ID: ${taskId}`);
        console.groupEnd();
        return;
    }

    const spinner = container.querySelector('.loading-spinner');
    const subtasksList = container.querySelector('.subtasks-list');

    // Toggle classes on the specific button and container
    button.classList.toggle('expanded');
    container.classList.toggle('expanded');

    if (container.classList.contains('expanded')) {
        if (!subtasksList.children.length) {
            try {
                spinner.classList.remove('d-none');
                const tasks = getAllTasks();
                console.log('All Tasks:', tasks);

                // Find task by ID or index
                const taskData = tasks.find((t, index) => {
                    const matchById = t.id && String(t.id) === String(taskId);
                    const matchByIndex = String(index) === String(taskId);
                    const isMatch = matchById || matchByIndex;
                    console.log(`Checking task: ${t.id || index}, Match: ${isMatch}`);
                    return isMatch;
                });

                console.log('Found Task Data:', taskData);

                if (!taskData) {
                    throw new Error(`Task not found for ID: ${taskId}`);
                }

                const subtasks = await generateSubtasks(taskId, taskData);
                console.log('Generated Subtasks:', subtasks);

                subtasksList.innerHTML = subtasks.map((subtask, index) => `
                    <div class="subtask-item" data-subtask-id="${taskId}-${index}">
                        <input type="checkbox" class="subtask-checkbox" onchange="toggleSubtaskComplete(this)">
                        <div class="subtask-title">${subtask}</div>
                    </div>
                `).join('');

                // Load any previously saved completion status
                loadCompletionStatus();
            } catch (error) {
                console.error('Error in toggleSubtasks:', error);
                subtasksList.innerHTML = `
                    <div class="subtask-error">
                        <i class="bi bi-exclamation-triangle"></i>
                        ${error.message}
                    </div>
                `;
            } finally {
                spinner.classList.add('d-none');
            }
        }
    }
    console.groupEnd();
}

// Toggle subtask completion status
function toggleSubtaskComplete(checkbox) {
    const storage = getStorage();
    const subtaskItem = checkbox.closest('.subtask-item');
    subtaskItem.classList.toggle('completed', checkbox.checked);

    // Save completion status
    const subtaskId = subtaskItem.dataset.subtaskId;
    const completedSubtasks = storage.get('completedSubtasks', {});
    completedSubtasks[subtaskId] = checkbox.checked;
    storage.set('completedSubtasks', completedSubtasks);
}

// Load saved completion status for subtasks
function loadCompletionStatus() {
    const storage = getStorage();
    const completedSubtasks = storage.get('completedSubtasks', {});
    Object.entries(completedSubtasks).forEach(([subtaskId, completed]) => {
        const subtaskItem = document.querySelector(`[data-subtask-id="${subtaskId}"]`);
        if (subtaskItem) {
            const checkbox = subtaskItem.querySelector('.subtask-checkbox');
            checkbox.checked = completed;
            subtaskItem.classList.toggle('completed', completed);
        }
    });
}

/**
 * Task Display and Management Functions
 */

// Display all tasks in the UI. The optional arguments keep direct callers
// synchronous while refreshPriorityList can render the awaited repository read.
function displayTasks(tasksOverride, documentRef = priorityListState.document) {
    const runtimeDocument = getRuntimeDocument(documentRef);
    const taskList = runtimeDocument?.getElementById?.('taskList');
    if (!taskList) return false;

    let tasks;
    try {
        tasks = Array.isArray(tasksOverride) ? normalizePriorityTasks(tasksOverride) : getAllTasks();
    } catch (error) {
        const state = priorityListState.repository ? 'corrupt' : 'unavailable';
        priorityListState.status = state;
        priorityListState.error = error;
        renderUnavailablePriorityList(runtimeDocument, state);
        return false;
    }

    priorityListState.tasks = tasks;
    if (!taskList.dataset) taskList.dataset = {};
    taskList.dataset.state = tasks.length ? 'ready' : 'empty';

    if (tasks.length === 0) {
        priorityListState.status = 'empty';
        return renderEmptyPriorityList(runtimeDocument);
    }

    // Group tasks by interleave date.
    const groupedTasks = groupTasksByInterleaveDate(tasks);

    // Create HTML for all groups and tasks.
    let html = '';
    Object.entries(groupedTasks).forEach(([dateGroup, tasksInGroup]) => {
        html += `
            <div class="interleave-group-header">
                <div class="interleave-date">
                    <i class="bi bi-calendar-check"></i>
                    ${dateGroup === 'not-interleaved' ? 'Never Interleaved' : `Interleaved on ${formatGroupDate(dateGroup)}`}
                </div>
                <div class="group-count">${tasksInGroup.length} task${tasksInGroup.length > 1 ? 's' : ''}</div>
            </div>
        `;

        tasksInGroup.forEach(task => {
            const taskId = task.id || task.index;
            const score = Number.isFinite(Number(task.priorityScore)) ? Number(task.priorityScore).toFixed(1) : '0.0';
            html += `
                <div class="task-card" data-task-id="${taskId}">
                    <div class="main-task">
                        <div class="priority-score">${score}</div>
                        <div class="task-title">${task.title || ''}</div>
                        <div class="task-section">${task.section || ''}</div>
                        <div class="project-name">${task.projectName || ''}</div>
                        <div class="due-date ${getDueDateClass(task.dueDate)}">
                            <i class="bi bi-calendar2-event"></i>
                            ${formatDate(task.dueDate)}
                        </div>
                        <div class="task-actions">
                            <button onclick="completeTask('${task.projectId || ''}', '${taskId}')" class="task-btn complete-btn" title="Complete Task">
                                <i class="bi bi-check-circle"></i>
                            </button>
                            <button onclick="interleaveTask()" class="task-btn interleave-btn ${task.lastInterleaved ? 'interleaved' : ''}" title="Interleave Task">
                                <i class="bi bi-arrow-repeat"></i>
                            </button>
                            <button onclick="skipTask()" class="task-btn skip-btn" title="Skip Task">
                                <i class="bi bi-skip-forward"></i>
                            </button>
                        </div>
                        <button class="expand-btn" onclick="toggleSubtasks(this, '${taskId}')">
                            <i class="bi bi-chevron-down"></i>
                        </button>
                    </div>
                    <div class="subtasks-container" id="subtasks-${taskId}">
                        <div class="loading-spinner d-none">
                            <div class="spinner-border text-primary" role="status">
                                <span class="visually-hidden">Loading...</span>
                            </div>
                        </div>
                        <div class="subtasks-list"></div>
                    </div>
                </div>
            `;
        });
    });

    taskList.innerHTML = html;
    priorityListState.status = 'ready';
    priorityListState.renderCount += 1;
    loadCompletionStatus();
    return true;
}

// Helper function to group tasks by interleave date
function groupTasksByInterleaveDate(tasks) {
    // Group tasks by interleave date (yyyy-mm-dd format or 'not-interleaved')
    const groups = {};

    tasks.forEach((task, index) => {
        // Keep the canonical snapshot immutable while retaining the original
        // order for legacy index-based links.
        const taskWithIndex = { ...task, index };

        let groupKey = 'not-interleaved';

        if (taskWithIndex.lastInterleaved) {
            const date = new Date(taskWithIndex.lastInterleaved);
            if (!Number.isNaN(date.getTime())) {
                groupKey = date.toISOString().split('T')[0]; // Get yyyy-mm-dd format
            }
        }

        // Create group if it doesn't exist
        if (!groups[groupKey]) {
            groups[groupKey] = [];
        }

        // Add task to its group
        groups[groupKey].push(taskWithIndex);
    });

    // IMPORTANT: Don't sort tasks within groups - they're already sorted by the sorter
    // This ensures we respect the order from the sorter

    // Convert groups object to array of [key, tasks] and sort by date
    const sortedGroups = Object.entries(groups).sort((a, b) => {
        // 'not-interleaved' should come first
        if (a[0] === 'not-interleaved') return -1;
        if (b[0] === 'not-interleaved') return 1;

        // Then sort interleaved tasks by date (oldest first)
        return new Date(a[0]) - new Date(b[0]);
    });

    // Convert back to object
    const result = {};
    sortedGroups.forEach(([key, value]) => {
        result[key] = value;
    });

    return result;
}

/**
 * Task Action Functions
 */

// Navigate to previous or next task
function navigateTask(direction) {
    try {
        const priorityTasks = getAllTasks();
        if (priorityTasks.length < 2) return; // No need to navigate if there's only one task

        // Group tasks by interleave date
        const groupedTasks = groupTasksByInterleaveDate(priorityTasks);

        // Flatten grouped tasks into an array that respects the grouping order
        const orderedTasks = [];
        Object.values(groupedTasks).forEach(tasksInGroup => {
            orderedTasks.push(...tasksInGroup);
        });

        // Find the current top task (by checking the selected task-card if any)
        const selectedCard = document.querySelector('.task-card.selected');
        let currentIndex = -1;

        if (selectedCard) {
            const taskId = selectedCard.dataset.taskId;
            currentIndex = orderedTasks.findIndex(task =>
                (task.id || task.index) == taskId);
        } else {
            // If no task is selected, use the first one
            currentIndex = 0;
        }

        // Calculate new index
        let newIndex;
        if (direction === 'next') {
            newIndex = (currentIndex + 1) % orderedTasks.length;
        } else {
            newIndex = (currentIndex - 1 + orderedTasks.length) % orderedTasks.length;
        }

        // Get the task at the new index
        const newTask = orderedTasks[newIndex];

        // Find and highlight the corresponding task card
        const taskCards = document.querySelectorAll('.task-card');
        taskCards.forEach(card => {
            card.classList.remove('selected');
            if (card.dataset.taskId == (newTask.id || newTask.index)) {
                card.classList.add('selected');
                // Scroll to the selected card
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });

        // Show a notification about the selected task
        const notification = document.createElement('div');
        notification.className = 'navigation-notification';
        notification.innerHTML = `<strong>Selected:</strong> ${newTask.title}`;
        notification.style.position = 'fixed';
        notification.style.bottom = '80px';
        notification.style.right = '20px';
        notification.style.backgroundColor = 'var(--primary-color)';
        notification.style.color = 'white';
        notification.style.padding = '10px 15px';
        notification.style.borderRadius = '5px';
        notification.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
        notification.style.zIndex = '1000';
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s ease';

        document.body.appendChild(notification);

        // Fade in and out
        setTimeout(() => { notification.style.opacity = '1'; }, 10);
        setTimeout(() => { notification.style.opacity = '0'; }, 3000);
        setTimeout(() => { document.body.removeChild(notification); }, 3500);
    } catch (error) {
        console.error('Error in navigateTask:', error);
    }
}

function showActionNotification(className, title, detail = '') {
    const runtimeDocument = priorityListState.document || getRuntimeDocument();
    if (!runtimeDocument?.createElement || !runtimeDocument.body?.appendChild) return;
    const notification = runtimeDocument.createElement('div');
    notification.className = className;
    notification.setAttribute?.('role', 'status');
    notification.innerHTML = `<strong>${title}</strong>${detail ? `<div>${detail}</div>` : ''}`;
    runtimeDocument.body.appendChild(notification);
    setTimeout(() => notification.remove?.(), className === 'completion-notification' ? 3500 : 2500);
}

// Mark a task as complete through the canonical task facade.
async function completeTask(projectId, taskId) {
    try {
        const facade = getPriorityCommandFacade();
        if (typeof facade?.completeTask !== 'function') {
            throw new Error('Canonical task service is unavailable');
        }
        await facade.completeTask(projectId, taskId);
        await refreshPriorityList();
        showActionNotification('completion-notification', 'Task Completed!', 'Synced via the task repository.');
    } catch (error) {
        console.error('Error completing task:', error);
        getRuntimeWindow().alert?.(`Error completing task: ${error.message}`);
    }
}

// Skip the first task through the canonical task facade.
async function skipTask() {
    try {
        const tasks = priorityListState.tasks.length ? priorityListState.tasks : getAllTasks();
        if (tasks.length <= 1) return;
        const firstTask = tasks[0];
        const facade = getPriorityCommandFacade();
        if (typeof facade?.skipTask !== 'function') {
            throw new Error('Canonical task service is unavailable');
        }
        await facade.skipTask(firstTask.id || firstTask);
        await refreshPriorityList();
        showActionNotification('skip-notification', 'Task Skipped', firstTask.title || 'The first priority task was moved to the end.');
    } catch (error) {
        console.error('Error in skipTask:', error);
        getRuntimeWindow().alert?.(`Error skipping task: ${error.message}`);
    }
}

// Stub function for interleave task (redirects to grind.html)
function interleaveTask() {
    alert('Interleaving is only available in Grind Mode. Please switch to that page to use this feature.');
    // Option to redirect
    if (confirm('Would you like to go to Grind Mode to use interleaving?')) {
        window.location.href = 'grind.html';
    }
}

/**
 * UI Setup Functions
 */

// Setup profile icon scroll behavior
function setupProfileIconBehavior() {
    let lastScrollTop = 0;
    const runtimeWindow = getRuntimeWindow();
    const runtimeDocument = getRuntimeDocument();
    const profileIcon = runtimeDocument?.querySelector?.('.profile-icon');

    if (!profileIcon) return;

    runtimeWindow.addEventListener?.('scroll', () => {
        const scrollTop = runtimeWindow.pageYOffset || runtimeDocument?.documentElement?.scrollTop || 0;

        if (scrollTop < lastScrollTop || scrollTop < 100) {
            // Scrolling up or near top
            profileIcon.classList.add('visible');
        } else {
            // Scrolling down
            profileIcon.classList.remove('visible');
        }

        lastScrollTop = scrollTop;
    });

    // Show initially if at top of page
    if ((runtimeWindow.pageYOffset || 0) < 100) {
        profileIcon.classList.add('visible');
    }
}

function comparePriorityTasks(a, b, field, direction) {
    let comparison = 0;
    if (field === 'priorityScore') {
        comparison = (Number(b.priorityScore) || 0) - (Number(a.priorityScore) || 0);
    } else if (field === 'dueDate' || field === 'createdAt' || field === 'lastInterleaved') {
        if (!a[field] && !b[field]) comparison = 0;
        else if (!a[field]) comparison = field === 'lastInterleaved' ? -1 : 1;
        else if (!b[field]) comparison = field === 'lastInterleaved' ? 1 : -1;
        else comparison = new Date(a[field]) - new Date(b[field]);
    } else {
        comparison = String(a[field] || '').toLowerCase().localeCompare(String(b[field] || '').toLowerCase());
    }
    return field === 'priorityScore' || direction === 'asc' ? comparison : -comparison;
}

function persistPriorityOrder(tasks) {
    const facade = getPriorityCommandFacade();
    if (typeof facade?.reorderPriorityTasks === 'function') {
        return facade.reorderPriorityTasks(tasks.map(task => ({ ...task })));
    }
    if (typeof facade?.savePriorityCache === 'function') {
        return facade.savePriorityCache(tasks.map(task => ({ ...task })));
    }
    return undefined;
}

function setupSortControls(documentRef = priorityListState.document) {
    const runtimeDocument = getRuntimeDocument(documentRef);
    const container = runtimeDocument?.querySelector?.('.container');
    const listHeader = runtimeDocument?.querySelector?.('.list-header');
    if (!container || !listHeader || typeof runtimeDocument.createElement !== 'function') return;

    let controls = runtimeDocument.querySelector('.sorting-controls');
    if (!controls) {
        controls = runtimeDocument.createElement('div');
        controls.className = 'sorting-controls mb-3';
        controls.innerHTML = `
            <div class="d-flex align-items-center gap-3">
                <label for="sortField" class="form-label mb-0">Sort by:</label>
                <select id="sortField" class="form-select form-select-sm" style="width: auto;">
                    <option value="priorityScore" selected>Priority Score</option>
                    <option value="title">Task Name</option>
                    <option value="section">Section</option>
                    <option value="projectName">Project</option>
                    <option value="dueDate">Due Date</option>
                    <option value="createdAt">Created Date</option>
                    <option value="lastInterleaved">Last Interleaved</option>
                </select>
                <button id="sortDirection" class="btn btn-sm btn-outline-secondary" type="button" aria-label="Toggle sort direction">
                    <i class="bi bi-sort-down"></i>
                </button>
            </div>`;
        container.insertBefore?.(controls, listHeader);
    }

    const sortField = runtimeDocument.getElementById?.('sortField');
    const sortDirection = runtimeDocument.getElementById?.('sortDirection');
    if (!sortField || !sortDirection || sortField.dataset?.priorityBound === 'true') return;
    if (!sortField.dataset) sortField.dataset = {};
    sortField.dataset.priorityBound = 'true';

    const saved = getStorage().get('prioritySortSettings', null);
    if (saved?.field) priorityListState.sort.field = saved.field;
    if (saved?.direction === 'asc' || saved?.direction === 'desc') priorityListState.sort.direction = saved.direction;
    if (sortField.value !== undefined) sortField.value = priorityListState.sort.field;

    const applySort = () => {
        const tasks = priorityListState.tasks.map(task => ({ ...task }));
        tasks.sort((a, b) => comparePriorityTasks(a, b, priorityListState.sort.field, priorityListState.sort.direction));
        priorityListState.tasks = tasks;
        getStorage().set('prioritySortSettings', { ...priorityListState.sort });
        void Promise.resolve(persistPriorityOrder(tasks)).catch(error => console.error('Unable to persist priority order:', error));
        displayTasks(tasks, runtimeDocument);
    };

    sortField.addEventListener?.('change', () => {
        priorityListState.sort.field = sortField.value || 'priorityScore';
        if (priorityListState.sort.field === 'priorityScore') priorityListState.sort.direction = 'desc';
        applySort();
    });
    sortDirection.addEventListener?.('click', () => {
        priorityListState.sort.direction = priorityListState.sort.direction === 'asc' ? 'desc' : 'asc';
        applySort();
    });
}

// Initialize the repository once, then render its authoritative snapshot.
async function initializePage(options = {}) {
    const runtimeWindow = getRuntimeWindow(options.windowRef);
    const runtimeDocument = getRuntimeDocument(options.documentRef);
    priorityListState.document = runtimeDocument;

    const storage = getStorage();
    if (storage.get('theme', null) === 'light') {
        runtimeDocument?.body?.classList?.add('light-theme');
    }

    const repository = await initializePriorityRepository({
        ...options,
        windowRef: runtimeWindow,
        documentRef: runtimeDocument
    });
    if (!repository) {
        renderUnavailablePriorityList(runtimeDocument);
        return false;
    }

    setupSortControls(runtimeDocument);
    await refreshPriorityList(runtimeDocument);
    setupProfileIconBehavior();
    return true;
}

// Export functions to make them available globally.
const exportedWindow = getRuntimeWindow();
exportedWindow.getAllTasks = getAllTasks;
exportedWindow.formatDate = formatDate;
exportedWindow.getDueDateClass = getDueDateClass;
exportedWindow.formatGroupDate = formatGroupDate;
exportedWindow.generateSubtasks = generateSubtasks;
exportedWindow.toggleSubtasks = toggleSubtasks;
exportedWindow.toggleSubtaskComplete = toggleSubtaskComplete;
exportedWindow.loadCompletionStatus = loadCompletionStatus;
exportedWindow.displayTasks = displayTasks;
exportedWindow.groupTasksByInterleaveDate = groupTasksByInterleaveDate;
exportedWindow.navigateTask = navigateTask;
exportedWindow.completeTask = completeTask;
exportedWindow.skipTask = skipTask;
exportedWindow.interleaveTask = interleaveTask;
exportedWindow.initializePriorityList = initializePriorityRepository;
exportedWindow.getPriorityListState = getPriorityListState;
exportedWindow.destroyPriorityList = destroyPriorityList;

// Initialize when the document is ready.
const exportedDocument = getRuntimeDocument();
exportedDocument?.addEventListener?.('DOMContentLoaded', initializePage);

// Export the module
export {
    getAllTasks,
    formatDate,
    getDueDateClass,
    formatGroupDate,
    generateSubtasks,
    toggleSubtasks,
    toggleSubtaskComplete,
    loadCompletionStatus,
    displayTasks,
    groupTasksByInterleaveDate,
    navigateTask,
    completeTask,
    skipTask,
    interleaveTask,
    initializePage,
    initializePriorityRepository,
    refreshPriorityList,
    getPriorityListState,
    destroyPriorityList
};
