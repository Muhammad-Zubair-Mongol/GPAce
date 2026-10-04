/**
 * TaskDisplayController - safe priority-task rendering and navigation.
 *
 * User-controlled task data is created with DOM APIs and textContent. Actions
 * are delegated from the task box and resolved through validated data IDs, so
 * task fields can never become markup or executable event-handler source.
 */

const runtimeWindow = typeof window !== 'undefined' ? window : globalThis;

function resolveDocument(documentRef) {
    return documentRef || runtimeWindow?.document || (typeof document !== 'undefined' ? document : null);
}

function unwrapStorageValue(value, fallback) {
    if (value && typeof value === 'object' && 'success' in value && 'value' in value) {
        return value.success ? value.value : fallback;
    }
    return value === undefined ? fallback : value;
}

function makeText(documentRef, tag, className, value) {
    const element = documentRef.createElement(tag);
    if (className) element.className = className;
    element.textContent = String(value ?? '');
    return element;
}

class TaskDisplayController {
    constructor(options = {}) {
        this.document = options.document || null;
        this.window = options.window || runtimeWindow;
        this.storage = options.storage || null;
        this.repository = options.repository
            || this.window?.TaskService
            || this.window?.taskService
            || this.window?.TaskRepository
            || null;
        this.displayTimeout = null;
        this.lastTasksHash = null;
        this._isDisplaying = false;
        this._storageListener = null;
        this._delegatedBoxes = new WeakSet();

        this.displayPriorityTask = this.displayPriorityTask.bind(this);
        this.navigateTask = this.navigateTask.bind(this);
    }

    init(options = {}) {
        this.document = options.document || this.document || resolveDocument();
        this.window = options.window || this.window || runtimeWindow;
        this.storage = options.storage || this.storage || this._resolveStorage();
        this.repository = options.repository
            || this.repository
            || this.window?.TaskService
            || this.window?.taskService
            || this.window?.TaskRepository
            || null;
        this._setupStorageListener();
        this._loadPriorityListSorter();
        return this;
    }

    setRepository(repository) {
        this.repository = repository || null;
        this.lastTasksHash = null;
        return this;
    }

    displayPriorityTask(force = false) {
        if (this.displayTimeout) clearTimeout(this.displayTimeout);
        this.displayTimeout = setTimeout(async () => {
            try {
                await this._displayPriorityTaskImpl(force);
            } finally {
                this.displayTimeout = null;
            }
        }, 50);
    }

    navigateTask(direction) {
        const priorityTasks = this._readPriorityTasks();
        if (priorityTasks.length < 2) return;

        const groupedTasks = this.groupTasksByInterleaveDate(priorityTasks);
        const orderedTasks = this._flattenGroupedTasks(groupedTasks);
        const currentIndex = this._findCurrentTaskIndex(orderedTasks);
        if (currentIndex < 0) return;

        const nextIndex = direction === 'next'
            ? (currentIndex + 1) % orderedTasks.length
            : (currentIndex - 1 + orderedTasks.length) % orderedTasks.length;
        this._renderTask(orderedTasks[nextIndex]);
    }

    groupTasksByInterleaveDate(tasks) {
        const groups = {};
        (Array.isArray(tasks) ? tasks : []).forEach((task, index) => {
            const copy = { ...task, index };
            let groupKey = 'not-interleaved';
            if (task?.lastInterleaved) {
                const date = new Date(task.lastInterleaved);
                if (!Number.isNaN(date.getTime())) groupKey = date.toISOString().split('T')[0];
            }
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(copy);
        });

        return Object.fromEntries(Object.entries(groups).sort(([left], [right]) => {
            if (left === 'not-interleaved') return -1;
            if (right === 'not-interleaved') return 1;
            return new Date(left) - new Date(right);
        }));
    }

    hashString(value) {
        const str = String(value ?? '');
        let hash = 0;
        for (let index = 0; index < str.length; index += 1) {
            hash = ((hash << 5) - hash) + str.charCodeAt(index);
            hash |= 0;
        }
        return hash;
    }

    async _displayPriorityTaskImpl(force = false) {
        if (this._isDisplaying) return false;
        this._isDisplaying = true;
        const taskBox = this.document?.getElementById?.('priorityTaskBox') || resolveDocument()?.getElementById?.('priorityTaskBox');

        try {
            if (!taskBox) throw new Error('Task display container is unavailable');
            const priorityTasks = await this._getPriorityTasks();
            if (!Array.isArray(priorityTasks)) throw new Error('Priority task data is invalid');

            const tasksHash = this.hashString(JSON.stringify(priorityTasks));
            if (!force && tasksHash === this.lastTasksHash) return false;

            if (priorityTasks.length === 0) {
                this._renderEmptyState(taskBox);
            } else {
                const groupedTasks = this.groupTasksByInterleaveDate(priorityTasks);
                const firstGroup = Object.values(groupedTasks)[0];
                if (!firstGroup?.length) this._renderEmptyState(taskBox);
                else this._renderTask(firstGroup[0], taskBox);
            }

            // Commit the hash only after the complete render path succeeded.
            this.lastTasksHash = tasksHash;
            return true;
        } catch (error) {
            this._renderError(taskBox, error);
            return false;
        } finally {
            this._isDisplaying = false;
        }
    }

    _renderEmptyState(taskBox) {
        const documentRef = taskBox.ownerDocument || this.document || resolveDocument();
        const wrapper = documentRef.createElement('div');
        wrapper.className = 'empty-priority-task';
        const icon = documentRef.createElement('div');
        icon.className = 'empty-task-icon';
        icon.appendChild(this._createIcon(documentRef, 'bi-clipboard2-check'));
        wrapper.appendChild(icon);
        const info = documentRef.createElement('div');
        info.className = 'empty-task-info';
        info.appendChild(makeText(documentRef, 'span', 'empty-task-title', 'No General Tasks'));
        info.appendChild(makeText(documentRef, 'span', 'empty-task-sub', 'All caught up! Create a new task anytime.'));
        wrapper.appendChild(info);
        const addButton = makeText(documentRef, 'button', 'btn btn-sm btn-outline-primary', 'Add Task');
        addButton.type = 'button';
        addButton.dataset.taskAction = 'add-task';
        wrapper.appendChild(addButton);
        this._replaceChildren(taskBox, wrapper);
        this._ensureTaskActionDelegation(taskBox);
    }

    _renderError(taskBox, error) {
        if (!taskBox) return;
        const documentRef = taskBox.ownerDocument || this.document || resolveDocument();
        const message = makeText(documentRef, 'div', 'task-info task-error', `Error displaying tasks: ${error.message}`);
        this._replaceChildren(taskBox, message);
        this._ensureTaskActionDelegation(taskBox);
    }

    _renderTask(task, taskBox = null) {
        const documentRef = taskBox?.ownerDocument || this.document || resolveDocument();
        const container = taskBox || documentRef?.getElementById?.('priorityTaskBox');
        if (!container) throw new Error('Task display container is unavailable');
        if (!task || typeof task !== 'object') throw new Error('Task data is invalid');

        const subjects = this._readSubjects();
        const subject = subjects.find(candidate => String(candidate?.tag) === String(task.projectId));
        const newContent = documentRef.createElement('div');
        newContent.className = 'task-render';
        newContent.style.opacity = '0';
        newContent.style.transition = 'opacity 0.3s ease';
        newContent.appendChild(this._generateTaskTemplate(task, subject, documentRef));
        this._replaceChildren(container, newContent);
        this._ensureTaskActionDelegation(container);

        setTimeout(() => {
            newContent.style.opacity = '1';
        }, 50);
        this._initializeTaskExtras(task, subject, documentRef);
        return newContent;
    }

    _generateTaskTemplate(task, subject, documentRef = this.document || resolveDocument()) {
        if (!documentRef?.createDocumentFragment) throw new Error('A DOM document is required to render tasks');
        const fragment = documentRef.createDocumentFragment();
        const taskId = this._validatedIdentifier(task.id);
        const projectId = this._validatedIdentifier(task.projectId);
        const token = this._safeDomToken(taskId || `task-${Date.now()}`);

        const navigation = documentRef.createElement('div');
        navigation.className = 'task-navigation';
        navigation.appendChild(this._actionButton(documentRef, 'prev-task', 'Previous task', '‹'));
        navigation.appendChild(this._actionButton(documentRef, 'next-task', 'Next task', '›'));
        fragment.appendChild(navigation);

        const content = documentRef.createElement('div');
        content.className = 'priority-task-content';
        const info = documentRef.createElement('div');
        info.className = 'task-info';
        if (taskId) info.dataset.taskId = taskId;
        if (projectId) info.dataset.projectId = projectId;
        info.appendChild(makeText(documentRef, 'div', 'task-title', task.title));
        const details = makeText(documentRef, 'div', 'task-details', `${task.section || ''} • ${subject?.name || task.projectName || ''}`);
        info.appendChild(details);
        content.appendChild(info);

        const actions = documentRef.createElement('div');
        actions.className = 'task-actions';
        actions.appendChild(this._actionButton(documentRef, 'complete-task', 'Complete', 'Complete', taskId, projectId));
        const interleave = this._actionButton(documentRef, 'interleave-task', 'Interleave', 'Interleave', taskId, projectId);
        if (task.lastInterleaved) interleave.classList.add('interleaved');
        if (task.lastInterleaved) interleave.appendChild(makeText(documentRef, 'span', 'interleave-timestamp', `Last interleaved: ${new Date(task.lastInterleaved).toLocaleString()}`));
        actions.appendChild(interleave);
        actions.appendChild(this._actionButton(documentRef, 'skip-task', 'Skip', 'Skip', taskId, projectId));
        actions.appendChild(this._actionButton(documentRef, 'toggle-subtasks', 'Show subtasks', 'Subtasks', taskId, projectId));
        const linksButton = this._actionButton(documentRef, 'toggle-links', 'Show task links', 'Links', taskId, projectId);
        linksButton.appendChild(makeText(documentRef, 'span', 'links-count', String(Array.isArray(task.links) ? task.links.length : 0)));
        actions.appendChild(linksButton);
        content.appendChild(actions);
        fragment.appendChild(content);

        const linksContainer = documentRef.createElement('div');
        linksContainer.id = `links-${token}`;
        linksContainer.className = 'links-container';
        if (taskId) linksContainer.dataset.taskId = taskId;
        const addLink = this._actionButton(documentRef, 'add-link', 'Add a link to this task', 'Add New Link', taskId, projectId);
        addLink.classList.add('add-link-btn');
        linksContainer.appendChild(addLink);
        const linksList = documentRef.createElement('div');
        linksList.className = 'links-list';
        linksContainer.appendChild(linksList);
        fragment.appendChild(linksContainer);

        const subtasksContainer = documentRef.createElement('div');
        subtasksContainer.id = `subtasks-${token}`;
        subtasksContainer.className = 'subtasks-container';
        if (taskId) subtasksContainer.dataset.taskId = taskId;
        subtasksContainer.appendChild(makeText(documentRef, 'div', 'loading-spinner d-none', ''));
        subtasksContainer.appendChild(makeText(documentRef, 'div', 'subtasks-list', ''));
        fragment.appendChild(subtasksContainer);

        const attachments = documentRef.createElement('div');
        attachments.id = `task-attachments-${token}`;
        attachments.className = 'task-attachments-container mt-3';
        if (taskId) attachments.dataset.taskId = taskId;
        attachments.appendChild(makeText(documentRef, 'h5', '', 'Task Attachments'));
        attachments.appendChild(makeText(documentRef, 'div', 'attachment-list', ''));
        const addAttachment = makeText(documentRef, 'button', 'btn btn-sm btn-outline-primary add-attachment-btn', 'Add Attachment');
        addAttachment.type = 'button';
        addAttachment.dataset.taskAction = 'add-attachment';
        addAttachment.dataset.taskId = taskId || '';
        attachments.appendChild(addAttachment);
        fragment.appendChild(attachments);

        if (subject) {
            const materials = documentRef.createElement('div');
            materials.className = 'subject-materials mt-3';
            materials.appendChild(makeText(documentRef, 'h5', '', `${subject.name} Materials`));
            materials.appendChild(makeText(documentRef, 'div', 'subject-materials-list', ''));
            const addMaterial = makeText(documentRef, 'button', 'btn btn-sm btn-outline-success add-subject-material-btn', 'Add Subject Material');
            addMaterial.type = 'button';
            addMaterial.dataset.taskAction = 'add-subject-material';
            addMaterial.dataset.subjectTag = this._validatedIdentifier(subject.tag) || '';
            materials.appendChild(addMaterial);
            fragment.appendChild(materials);
        }
        return fragment;
    }

    _actionButton(documentRef, action, label, visibleText, taskId = null, projectId = null) {
        const button = makeText(documentRef, 'button', 'task-btn', visibleText);
        button.type = 'button';
        button.dataset.taskAction = action;
        button.setAttribute('aria-label', label);
        if (taskId) button.dataset.taskId = taskId;
        if (projectId) button.dataset.projectId = projectId;
        return button;
    }

    _createIcon(documentRef, className) {
        const icon = documentRef.createElement('i');
        icon.className = `bi ${className}`;
        icon.setAttribute('aria-hidden', 'true');
        return icon;
    }

    _ensureTaskActionDelegation(taskBox) {
        if (!taskBox?.addEventListener || this._delegatedBoxes.has(taskBox)) return;
        taskBox.addEventListener('click', event => {
            const button = event.target?.closest?.('[data-task-action]');
            if (!button || !taskBox.contains(button)) return;
            const action = button.dataset.taskAction;
            const taskId = this._validatedIdentifier(button.dataset.taskId);
            const projectId = this._validatedIdentifier(button.dataset.projectId);
            const handlers = this.window || runtimeWindow;
            switch (action) {
                case 'prev-task': this.navigateTask('prev'); break;
                case 'next-task': this.navigateTask('next'); break;
                case 'add-task': handlers.showTaskModal?.(); break;
                case 'complete-task': if (taskId && projectId) handlers.completeTask?.(projectId, taskId); break;
                case 'interleave-task': if (taskId) handlers.interleaveTask?.(taskId); break;
                case 'skip-task': if (taskId) handlers.skipTask?.(taskId); break;
                case 'toggle-subtasks': if (taskId) handlers.toggleSubtasks?.(button, taskId); break;
                case 'toggle-links': if (taskId) handlers.toggleTaskLinks?.(taskId); break;
                case 'add-link': if (taskId) handlers.addNewLink?.(taskId); break;
                case 'add-attachment': if (taskId) handlers.addTaskAttachment?.(taskId); break;
                case 'add-subject-material': if (button.dataset.subjectTag) handlers.openSubjectMaterialModal?.(button.dataset.subjectTag); break;
                default: break;
            }
        });
        this._delegatedBoxes.add(taskBox);
    }

    _initializeTaskExtras(task, subject, documentRef = this.document || resolveDocument()) {
        setTimeout(() => {
            const taskId = this._validatedIdentifier(task.id);
            const token = this._safeDomToken(taskId || 'unknown');
            const container = documentRef?.getElementById?.(`task-attachments-${token}`);
            if (container && this.window?.taskAttachments?.init && taskId) this.window.taskAttachments.init(taskId, container);
            if (subject && typeof this.window?.loadSubjectMaterials === 'function') this.window.loadSubjectMaterials(subject.tag);
        }, 100);
    }

    _flattenGroupedTasks(groupedTasks) {
        return Object.values(groupedTasks || {}).flatMap(tasks => tasks);
    }

    _findCurrentTaskIndex(orderedTasks) {
        const documentRef = this.document || resolveDocument();
        const taskInfo = documentRef?.querySelector?.('.task-info');
        const currentId = this._validatedIdentifier(taskInfo?.dataset?.taskId);
        if (currentId) return orderedTasks.findIndex(task => this._validatedIdentifier(task.id) === currentId);

        const currentTitle = taskInfo?.querySelector?.('.task-title')?.textContent?.trim() || '';
        return orderedTasks.findIndex(task => String(task.title || '').replace(/\s+/g, ' ').trim() === currentTitle.replace(/\s+/g, ' ').trim());
    }

    _setupStorageListener() {
        if (!this.window?.addEventListener || this._storageListener) return;
        this._storageListener = event => {
            if (event.key === 'calculatedPriorityTasks' || event.key?.endsWith?.('_calculatedPriorityTasks')) this.displayPriorityTask();
        };
        this.window.addEventListener('storage', this._storageListener);
    }

    _loadPriorityListSorter() {
        if (this.window?.PriorityListSorter?.applySavedSort) {
            try { this.window.PriorityListSorter.applySavedSort(); } catch { this.displayPriorityTask(true); }
            return;
        }
        const documentRef = this.document || resolveDocument();
        if (!documentRef?.createElement || !documentRef.body) return;
        const script = documentRef.createElement('script');
        script.src = 'js/priority-list-sorting.js';
        script.onload = () => this.window?.PriorityListSorter?.applySavedSort?.();
        script.onerror = () => this.displayPriorityTask();
        documentRef.body.appendChild(script);
    }

    async _getPriorityTasks() {
        const adapter = this.repository
            || this.window?.TaskService
            || this.window?.taskService
            || this.window?.TaskRepository
            || null;
        const methods = ['getPriorityTasks', 'getPriorityCache', 'getAllPriorityTasks'];
        for (const method of methods) {
            if (typeof adapter?.[method] === 'function') {
                const result = await adapter[method]();
                const value = unwrapStorageValue(result, []);
                if (Array.isArray(value)) return value;
            }
        }
        return [];
    }

    _readPriorityTasks() {
        const adapter = this.repository
            || this.window?.TaskService
            || this.window?.taskService
            || this.window?.TaskRepository
            || null;
        const methods = ['getPriorityTasks', 'getPriorityCache', 'getAllPriorityTasks'];
        for (const method of methods) {
            if (typeof adapter?.[method] === 'function') {
                try {
                    const result = adapter[method]();
                    if (result && typeof result.then === 'function') return [];
                    const value = unwrapStorageValue(result, []);
                    return Array.isArray(value) ? value : [];
                } catch {
                    return [];
                }
            }
        }
        return [];
    }

    _readSubjects() {
        const storage = this.storage || this._resolveStorage();
        if (!storage?.get) return [];
        try {
            const value = unwrapStorageValue(storage.get('academicSubjects', []), []);
            return Array.isArray(value) ? value : [];
        } catch {
            return [];
        }
    }

    _resolveStorage() {
        const windowRef = this.window || runtimeWindow;
        if (windowRef?.StorageAdapter?.getStorage) {
            try { return windowRef.StorageAdapter.getStorage(); } catch {}
        }
        if (windowRef?.StorageService) return windowRef.StorageService;
        if (typeof windowRef?.getStorage === 'function') {
            try { return windowRef.getStorage(); } catch {}
        }
        const backend = windowRef?.localStorage;
        if (!backend) return null;
        return {
            get(key, fallback) {
                const raw = backend.getItem(key);
                if (raw === null) return fallback;
                try { return JSON.parse(raw); } catch { return raw; }
            }
        };
    }

    _replaceChildren(container, ...children) {
        if (container.replaceChildren) container.replaceChildren(...children);
        else {
            while (container.firstChild) container.removeChild(container.firstChild);
            children.forEach(child => container.appendChild(child));
        }
    }

    _validatedIdentifier(value) {
        if (value === null || value === undefined) return null;
        const normalized = String(value);
        if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
        return normalized;
    }

    _safeDomToken(value) {
        const source = String(value || 'unknown');
        let hash = 2166136261;
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `t${(hash >>> 0).toString(36)}`;
    }

    _escapeHtml(value) {
        const documentRef = this.document || resolveDocument();
        if (!documentRef?.createElement) return String(value ?? '');
        const div = documentRef.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }
}

const taskDisplayController = new TaskDisplayController();

if (typeof window !== 'undefined') {
    window.taskDisplayController = taskDisplayController;
    window.displayPriorityTask = force => taskDisplayController.displayPriorityTask(force);
    window.navigateTask = direction => taskDisplayController.navigateTask(direction);
    window.groupTasksByInterleaveDate = tasks => taskDisplayController.groupTasksByInterleaveDate(tasks);
    window.hashString = value => taskDisplayController.hashString(value);
}

export { TaskDisplayController, taskDisplayController };
export default taskDisplayController;
