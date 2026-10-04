'use strict';

/**
 * Tasks page controller.
 *
 * The page can be opened before Todoist is connected, while the integration
 * is still loading, or with a valid empty account. Keep those states separate
 * so a missing integration is not presented as a successful empty result.
 */
class TasksManager {
    constructor({ documentRef = document, windowRef = window, integration = null } = {}) {
        this.document = documentRef;
        this.window = windowRef;
        this.integration = integration || this.window.todoistIntegration || null;
        this.tasks = [];
        this.status = 'idle';
        this.error = null;
        this.filters = {
            project: '',
            section: '',
            sort: 'dateAddedDesc',
            search: ''
        };
        this._listenersBound = false;
        this._loadSequence = 0;
        this._retryInFlight = false;
        this.ready = this.init();
    }

    init() {
        this.setupEventListeners();
        this.captureFilterValues();
        return this.loadTasks();
    }

    setupEventListeners() {
        if (this._listenersBound) return;
        this._listenersBound = true;

        const searchInput = this.document.getElementById('taskSearch');
        searchInput?.addEventListener('input', (event) => {
            this.filters.search = event.target.value || '';
            this.renderCurrentTasks();
        });

        ['projectFilter', 'sectionFilter', 'sortFilter'].forEach(id => {
            this.document.getElementById(id)?.addEventListener('change', (event) => {
                if (id === 'projectFilter') {
                    this.filters.project = event.target.value;
                    this.filters.section = '';
                    const section = this.document.getElementById('sectionFilter');
                    if (section) section.value = '';
                    this.populateSectionOptions();
                } else if (id === 'sectionFilter') {
                    this.filters.section = event.target.value;
                } else {
                    this.filters.sort = event.target.value || 'dateAddedDesc';
                }
                this.renderCurrentTasks();
            });
        });

        this.document.addEventListener('click', (event) => {
            const retryButton = event.target.closest?.('#tasksRetry');
            if (retryButton) {
                event.preventDefault();
                this.retry();
                return;
            }

            const connectButton = event.target.closest?.('#connectTodoistBtn');
            if (connectButton) {
                event.preventDefault();
                const integration = this.getIntegration();
                integration?.initiateLogin?.();
            }
        });
    }

    getIntegration() {
        return this.integration || this.window.todoistIntegration || null;
    }

    captureFilterValues() {
        const project = this.document.getElementById('projectFilter');
        const section = this.document.getElementById('sectionFilter');
        const sort = this.document.getElementById('sortFilter');
        const search = this.document.getElementById('taskSearch');

        if (project) this.filters.project = project.value || this.filters.project;
        if (section) this.filters.section = section.value || this.filters.section;
        if (sort) this.filters.sort = sort.value || this.filters.sort;
        if (search) this.filters.search = search.value || this.filters.search;
    }

    async loadTasks({ preserveRetry = false } = {}) {
        const sequence = ++this._loadSequence;
        this.error = null;
        this.status = 'loading';
        if (preserveRetry) {
            const tasksList = this.document.getElementById('tasksList');
            if (tasksList) {
                tasksList.dataset.state = 'loading';
                tasksList.classList.add('empty');
            }
        } else {
            this.renderStatus('loading', 'Loading tasks…');
        }

        const integration = this.getIntegration();
        if (!integration) {
            this.status = 'disconnected';
            this.renderStatus('disconnected', 'Connect Todoist to view your tasks.');
            return { status: this.status, tasks: [] };
        }

        try {
            const authenticated = typeof integration.isAuthenticated === 'function'
                ? await integration.isAuthenticated()
                : true;

            if (!authenticated) {
                this.status = 'disconnected';
                this.renderStatus('disconnected', 'Connect Todoist to view your tasks.');
                return { status: this.status, tasks: [] };
            }

            if (typeof integration.getTasks !== 'function') {
                throw new Error('Task service is unavailable');
            }

            const tasks = await integration.getTasks();
            if (sequence !== this._loadSequence) return { status: 'superseded', tasks: [] };

            this.tasks = Array.isArray(tasks) ? tasks.slice() : [];
            this.captureFilterValues();
            this.populateFilterOptions();
            this.status = this.tasks.length > 0 ? 'ready' : 'empty';
            this.renderCurrentTasks();
            return { status: this.status, tasks: this.tasks.slice() };
        } catch (error) {
            if (sequence !== this._loadSequence) return { status: 'superseded', tasks: [] };
            this.error = error instanceof Error ? error : new Error(String(error));
            this.status = 'error';
            this.renderStatus('error', this.error.message || 'Unable to load tasks.');
            return { status: this.status, error: this.error };
        }
    }

    async retry() {
        if (this._retryInFlight) return this.ready;
        this._retryInFlight = true;
        try {
            this.ready = this.loadTasks({ preserveRetry: true });
            return await this.ready;
        } finally {
            this._retryInFlight = false;
        }
    }

    populateFilterOptions() {
        const projectSelect = this.document.getElementById('projectFilter');
        if (projectSelect) {
            const selected = this.filters.project;
            const projects = new Map();
            this.tasks.forEach(task => {
                if (task.project_id !== undefined && task.project_id !== null) {
                    projects.set(String(task.project_id), task.project_name || `Project ${task.project_id}`);
                }
            });
            projectSelect.replaceChildren(this.createOption('', 'All Projects'));
            for (const [id, name] of projects) projectSelect.appendChild(this.createOption(id, name));
            projectSelect.value = projects.has(selected) ? selected : '';
            this.filters.project = projectSelect.value;
        }
        this.populateSectionOptions();

        const sortSelect = this.document.getElementById('sortFilter');
        if (sortSelect) {
            sortSelect.value = Array.from(sortSelect.options).some(option => option.value === this.filters.sort)
                ? this.filters.sort
                : 'dateAddedDesc';
            this.filters.sort = sortSelect.value;
        }
    }

    populateSectionOptions() {
        const sectionSelect = this.document.getElementById('sectionFilter');
        if (!sectionSelect) return;

        const selected = this.filters.section;
        const sections = new Map();
        this.tasks
            .filter(task => !this.filters.project || String(task.project_id) === String(this.filters.project))
            .forEach(task => {
                if (task.section_id !== undefined && task.section_id !== null) {
                    sections.set(String(task.section_id), task.section_name || `Section ${task.section_id}`);
                }
            });

        sectionSelect.replaceChildren(this.createOption('', 'All Sections'));
        for (const [id, name] of sections) sectionSelect.appendChild(this.createOption(id, name));
        sectionSelect.value = sections.has(selected) ? selected : '';
        this.filters.section = sectionSelect.value;
    }

    createOption(value, label) {
        const option = this.document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
    }

    getFilteredTasks() {
        const term = this.filters.search.trim().toLowerCase();
        const filtered = this.tasks.filter(task => {
            if (this.filters.project && String(task.project_id) !== String(this.filters.project)) return false;
            if (this.filters.section && String(task.section_id) !== String(this.filters.section)) return false;
            if (term && !String(task.content || '').toLowerCase().includes(term)) return false;
            return true;
        });

        const sort = this.filters.sort;
        return filtered.slice().sort((a, b) => {
            if (sort === 'priorityAsc') return (a.priority || 4) - (b.priority || 4);
            if (sort === 'priorityDesc') return (b.priority || 4) - (a.priority || 4);
            if (sort === 'dueDateAsc' || sort === 'dueDateDesc') {
                if (!a.due && !b.due) return 0;
                if (!a.due) return 1;
                if (!b.due) return -1;
                const delta = new Date(a.due.date) - new Date(b.due.date);
                return sort === 'dueDateDesc' ? -delta : delta;
            }
            const aDate = new Date(a.created_at || 0).getTime();
            const bDate = new Date(b.created_at || 0).getTime();
            return sort === 'dateAddedAsc' ? aDate - bDate : bDate - aDate;
        });
    }

    renderCurrentTasks() {
        if (this.status === 'loading' || this.status === 'disconnected' || this.status === 'error') return;
        const filtered = this.getFilteredTasks();
        if (filtered.length === 0) {
            this.status = this.tasks.length === 0 ? 'empty' : 'filtered-empty';
            this.renderStatus(this.status, this.tasks.length === 0
                ? 'No tasks found. Create a task in Todoist to get started.'
                : 'No tasks match the selected filters.');
            return;
        }
        this.status = 'ready';
        this.displayTasks(filtered);
    }

    renderStatus(status, message, { preserveRetry = false } = {}) {
        const tasksList = this.document.getElementById('tasksList');
        if (!tasksList) return;

        const existingRetry = preserveRetry ? tasksList.querySelector('#tasksRetry') : null;
        tasksList.replaceChildren();
        tasksList.dataset.state = status;
        tasksList.classList.toggle('empty', status !== 'ready');

        const state = this.document.createElement('div');
        state.className = `task-placeholder task-state task-state-${status}`;
        state.dataset.state = status;
        state.setAttribute('role', status === 'error' ? 'alert' : 'status');

        const paragraph = this.document.createElement('p');
        paragraph.textContent = message;
        state.appendChild(paragraph);

        if (preserveRetry && existingRetry) {
            state.appendChild(existingRetry);
        } else if (status === 'disconnected') {
            const connect = this.document.createElement('button');
            connect.type = 'button';
            connect.id = 'connectTodoistBtn';
            connect.className = 'login-btn';
            connect.textContent = 'Connect Todoist';
            state.appendChild(connect);
        } else if (status === 'error') {
            const retry = this.document.createElement('button');
            retry.type = 'button';
            retry.id = 'tasksRetry';
            retry.className = 'login-btn';
            retry.textContent = 'Retry';
            state.appendChild(retry);
        }

        tasksList.appendChild(state);
    }

    displayTasks(tasks) {
        const tasksList = this.document.getElementById('tasksList');
        if (!tasksList) return;

        tasksList.replaceChildren();
        tasksList.dataset.state = 'ready';
        tasksList.classList.remove('empty');

        tasks.forEach(task => tasksList.appendChild(this.createTaskElement(task)));
    }

    createTaskElement(task) {
        const taskElement = this.document.createElement('article');
        taskElement.className = 'task-item fade-in';
        taskElement.dataset.taskId = String(task.id ?? '');

        const checkbox = this.document.createElement('button');
        checkbox.type = 'button';
        checkbox.className = `task-checkbox ${task.completed ? 'checked' : ''}`;
        checkbox.dataset.taskId = String(task.id ?? '');
        checkbox.setAttribute('aria-label', `${task.completed ? 'Mark' : 'Complete'} ${task.content || 'task'}`);
        checkbox.textContent = task.completed ? '✓' : '';
        checkbox.addEventListener('click', () => this.toggleTaskCompletion(task, checkbox));

        const content = this.document.createElement('div');
        content.className = `task-content ${task.completed ? 'completed' : ''}`;

        const header = this.document.createElement('div');
        header.className = 'task-header';
        const priority = this.document.createElement('span');
        priority.className = `priority-indicator priority-${task.priority || 4}`;
        priority.setAttribute('aria-hidden', 'true');
        const title = this.document.createElement('span');
        title.className = 'task-title';
        title.textContent = task.content || 'Untitled task';
        header.append(priority, title);
        content.appendChild(header);

        if (task.due?.date) {
            const due = this.document.createElement('div');
            due.className = 'task-details';
            due.textContent = `Due: ${this.formatDate(task.due.date)}`;
            content.appendChild(due);
        }

        if (task.project_id !== undefined && task.project_id !== null) {
            const project = this.document.createElement('div');
            project.className = 'task-project';
            project.textContent = `Project: ${task.project_name || task.project_id}`;
            content.appendChild(project);
        }

        taskElement.append(checkbox, content);
        return taskElement;
    }

    async toggleTaskCompletion(task, checkbox) {
        const integration = this.getIntegration();
        if (!integration?.toggleTaskCompletion) return;
        checkbox.disabled = true;
        try {
            await integration.toggleTaskCompletion(task.id, !task.completed);
            await this.loadTasks();
        } catch (error) {
            this.error = error instanceof Error ? error : new Error(String(error));
            this.status = 'error';
            this.renderStatus('error', this.error.message || 'Unable to update this task.');
        } finally {
            checkbox.disabled = false;
        }
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return String(dateString);
        return date.toLocaleDateString();
    }
}

function initializeTasksManager() {
    if (!window.tasksManager) window.tasksManager = new TasksManager();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeTasksManager, { once: true });
    } else {
        initializeTasksManager();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TasksManager };
}
