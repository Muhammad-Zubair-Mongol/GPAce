/**
 * TaskCreationController.js - Handles task creation, modal management, and file uploads
 */
import DataRepository from '../services/DataRepository.js';

class TaskCreationController {
    constructor() {
        this.subsections = ['Revision', 'Assignment', 'Quizzes', 'Mid Term / OHT', 'Finals'];
        this.modalFilesToUpload = [];

        // Progress tracking state
        this.uploadStartTime = null;
        this.lastLoaded = 0;
        this.speedUpdateInterval = null;
        this.relevantLinks = []; // Store links temporarily

        // Bind methods
        this.showTaskModal = this.showTaskModal.bind(this);
        this.loadProjects = this.loadProjects.bind(this);
        this.loadSubcategories = this.loadSubcategories.bind(this);
        this.createTask = this.createTask.bind(this);
        this.addRelevantLinkToTask = this.addRelevantLinkToTask.bind(this);
        this.renderRelevantLinks = this.renderRelevantLinks.bind(this);
        this.removeRelevantLink = this.removeRelevantLink.bind(this);
        this.updatePriorityTasks = this.updatePriorityTasks.bind(this);
        this.hideTaskModal = this.hideTaskModal.bind(this);
        this.handleFileSelect = this.handleFileSelect.bind(this);
        this.addFilesToUploadPreview = this.addFilesToUploadPreview.bind(this);
        this.uploadFilesForTask = this.uploadFilesForTask.bind(this);
        this.handleUploadProgress = this.handleUploadProgress.bind(this);
        this.updateSpeed = this.updateSpeed.bind(this);
    }

    init() {
        this._setupEventListeners();
        console.log('TaskCreationController initialized');
        return this;
    }

    _setupEventListeners() {
        // Dropdown change listener
        const projectSelect = document.getElementById('projectSelect');
        if (projectSelect) {
            projectSelect.addEventListener('change', this.loadSubcategories);
        }

        // Close modal listeners
        const modal = document.getElementById('taskModal');
        const closeBtn = document.querySelector('.close-modal');
        if (closeBtn && modal) {
            closeBtn.addEventListener('click', () => this.hideTaskModal());
        }

        // File Upload Listeners
        this._setupFileUploadListeners();

        // Progress Listener
        window.addEventListener('file-upload-progress', this.handleUploadProgress);

        // Expose global functions expected by HTML
        window.showTaskModal = this.showTaskModal;
        window.createTask = this.createTask;
        window.loadProjects = this.loadProjects;
        window.loadSubcategories = this.loadSubcategories;
        window.updatePriorityTasks = this.updatePriorityTasks;
        window.hideTaskModal = this.hideTaskModal;
        window.addRelevantLinkToTask = this.addRelevantLinkToTask;
        window.removeRelevantLink = this.removeRelevantLink;

        // Expose upload globals if needed by legacy
        window.modalFilesToUpload = this.modalFilesToUpload;
        window.uploadFilesForTask = this.uploadFilesForTask;
    }

    _setupFileUploadListeners() {
        const uploadArea = document.getElementById('modalFileUploadArea');
        const fileInput = document.getElementById('modalFileUploadInput');

        if (uploadArea && fileInput) {
            uploadArea.addEventListener('click', () => fileInput.click());

            fileInput.addEventListener('change', (e) => {
                const files = fileInput.files;
                if (files.length > 0) this.handleFileSelect(files);
            });

            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('drag-over');
            });

            uploadArea.addEventListener('dragleave', () => {
                uploadArea.classList.remove('drag-over');
            });

            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('drag-over');
                const files = e.dataTransfer.files;
                if (files.length > 0) this.handleFileSelect(files);
            });
        }
    }

    handleUploadProgress(e) {
        const { fileName, loaded, total, percent, completed } = e.detail;

        const progressContainer = document.querySelector('.upload-progress');
        if (!progressContainer) return;

        const progressBar = progressContainer.querySelector('.progress-bar');
        const percentageEl = progressContainer.querySelector('.upload-percentage');

        // Show progress container
        progressContainer.classList.remove('d-none');

        // Update progress bar
        if (progressBar) {
            progressBar.style.width = percent + '%';
            progressBar.setAttribute('aria-valuenow', percent);
        }
        if (percentageEl) percentageEl.textContent = percent + '%';

        // Calculate speed and time remaining
        if (!this.uploadStartTime) {
            this.uploadStartTime = Date.now();
            this.lastLoaded = 0;
            // Start speed updates
            this.currentUploadDetails = { loaded, total }; // Store for updateSpeed
            if (this.speedUpdateInterval) clearInterval(this.speedUpdateInterval);
            this.speedUpdateInterval = setInterval(this.updateSpeed, 1000);
        } else {
            this.currentUploadDetails = { loaded, total };
        }

        // Handle completion
        if (completed) {
            if (this.speedUpdateInterval) {
                clearInterval(this.speedUpdateInterval);
                this.speedUpdateInterval = null;
            }
            if (progressBar) progressBar.classList.add('bg-success');

            const remainingEl = progressContainer.querySelector('.upload-remaining');
            if (remainingEl) remainingEl.textContent = 'Upload complete!';

            // Reset for next upload
            setTimeout(() => {
                progressContainer.classList.add('d-none');
                if (progressBar) {
                    progressBar.style.width = '0%';
                    progressBar.setAttribute('aria-valuenow', 0);
                    progressBar.classList.remove('bg-success');
                }
                this.uploadStartTime = null;
            }, 2000);
        }
    }

    updateSpeed() {
        if (!this.uploadStartTime || !this.currentUploadDetails) return;

        const { loaded, total } = this.currentUploadDetails;
        const progressContainer = document.querySelector('.upload-progress');
        const speedEl = progressContainer?.querySelector('.upload-speed');
        const remainingEl = progressContainer?.querySelector('.upload-remaining');

        const currentTime = Date.now();
        const timeElapsed = (currentTime - this.uploadStartTime) / 1000; // in seconds
        if (timeElapsed <= 0) return;

        const bytesPerSecond = loaded / timeElapsed;

        // Format speed
        let speed;
        if (bytesPerSecond >= 1048576) {
            speed = (bytesPerSecond / 1048576).toFixed(1) + ' MB/s';
        } else if (bytesPerSecond >= 1024) {
            speed = (bytesPerSecond / 1024).toFixed(1) + ' KB/s';
        } else {
            speed = bytesPerSecond.toFixed(1) + ' B/s';
        }

        // Calculate time remaining
        const remainingBytes = total - loaded;
        let timeString = 'Calculating...';

        if (bytesPerSecond > 0) {
            const remainingTime = remainingBytes / bytesPerSecond;
            if (remainingTime < 60) {
                timeString = Math.round(remainingTime) + ' seconds remaining';
            } else if (remainingTime < 3600) {
                timeString = Math.round(remainingTime / 60) + ' minutes remaining';
            } else {
                timeString = (remainingTime / 3600).toFixed(1) + ' hours remaining';
            }
        }

        if (speedEl) speedEl.textContent = speed;
        if (remainingEl) remainingEl.textContent = timeString;
    }

    handleFileSelect(files) {
        this.addFilesToUploadPreview(files);
    }

    addFilesToUploadPreview(files) {
        const previewContainer = document.getElementById('modalUploadPreview');
        if (!previewContainer) return;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            this.modalFilesToUpload.push(file);
            window.modalFilesToUpload = this.modalFilesToUpload; // Sync global

            const previewItem = document.createElement('div');
            previewItem.className = 'upload-preview-item';
            previewItem.dataset.index = this.modalFilesToUpload.length - 1;

            let iconClass = 'fas fa-file';
            if (file.type.startsWith('image/')) iconClass = 'fas fa-file-image';
            else if (file.type === 'application/pdf') iconClass = 'fas fa-file-pdf';
            else if (file.type.includes('spreadsheet') || file.type.includes('excel')) iconClass = 'fas fa-file-excel';
            else if (file.type.includes('document') || file.type.includes('word')) iconClass = 'fas fa-file-word';
            else if (file.type.includes('presentation') || file.type.includes('powerpoint')) iconClass = 'fas fa-file-powerpoint';

            previewItem.innerHTML = `
                <div class="upload-preview-icon"><i class="${iconClass}"></i></div>
                <div class="upload-preview-name" title="${file.name}">${file.name}</div>
                <div class="upload-preview-remove" data-index="${this.modalFilesToUpload.length - 1}">
                    <i class="fas fa-times"></i>
                </div>
            `;
            previewContainer.appendChild(previewItem);

            const removeButton = previewItem.querySelector('.upload-preview-remove');
            removeButton.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.index);
                this.modalFilesToUpload[index] = null;
                window.modalFilesToUpload = this.modalFilesToUpload;
                previewItem.remove();
            });
        }
    }

    showTaskModal() {
        const taskModal = document.getElementById('taskModal');
        if (taskModal) {
            taskModal.style.display = 'block';
            document.body.classList.add('modal-open');
            this.loadProjects();
        }
    }

    hideTaskModal() {
        const taskModal = document.getElementById('taskModal');
        if (taskModal) {
            taskModal.style.display = 'none';
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }

        // Clear upload previews and data
        const previewContainer = document.getElementById('modalUploadPreview');
        if (previewContainer) previewContainer.innerHTML = '';
        this.modalFilesToUpload = [];
        window.modalFilesToUpload = [];

        // Reset progress
        if (this.speedUpdateInterval) clearInterval(this.speedUpdateInterval);
        this.speedUpdateInterval = null;
        this.uploadStartTime = null;

        const progressContainer = document.querySelector('.upload-progress');
        if (progressContainer) progressContainer.classList.add('d-none');

        if (typeof window.resetFileUploader === 'function') window.resetFileUploader();

        // Clear links
        this.relevantLinks = [];
        this.renderRelevantLinks();
        document.getElementById('linkTitleInput').value = '';
        document.getElementById('linkUrlInput').value = '';
    }

    loadProjects() {
        // ... (standard loadProjects)
        const projectSelect = document.getElementById('projectSelect');
        if (!projectSelect) return;

        projectSelect.innerHTML = '<option value="">Loading...</option>'; // Show loading state

        // Use Repository to get subjects (fetches from server if needed)
        DataRepository.getSubjects().then(subjects => {
            projectSelect.innerHTML = '<option value="">Select a Project</option>';

            subjects.forEach(subject => {
                const option = document.createElement('option');
                option.value = subject.tag;
                option.textContent = subject.name;
                projectSelect.appendChild(option);
            });

            const extraOption = document.createElement('option');
            extraOption.value = 'EXTRA';
            extraOption.textContent = 'Extra Curricular';
            projectSelect.appendChild(extraOption);
        }).catch(err => {
            console.error('Failed to load subjects:', err);
            projectSelect.innerHTML = '<option value="">Error loading projects</option>';
        });
    }

    loadSubcategories() {
        // ... (standard loadSubcategories)
        const projectSelect = document.getElementById('projectSelect');
        const subcategorySelect = document.getElementById('subcategorySelect');
        if (!projectSelect || !subcategorySelect) return;

        subcategorySelect.innerHTML = '<option value="">Select a Subcategory</option>';
        const selectedProjectTag = projectSelect.value;
        if (!selectedProjectTag) return;

        if (selectedProjectTag !== 'EXTRA') {
            this.subsections.forEach(section => {
                const option = document.createElement('option');
                option.value = `${selectedProjectTag}-${section.replace(/\s+/g, '')}`;
                option.textContent = section;
                subcategorySelect.appendChild(option);
            });
        }
    }

    async createTask() {
        const projectSelect = document.getElementById('projectSelect');
        const subcategorySelect = document.getElementById('subcategorySelect');
        const taskTitleInput = document.getElementById('taskTitleInput');
        const taskDescription = document.getElementById('taskDescription');
        const taskDueDate = document.getElementById('taskDueDate');
        const taskPriority = document.getElementById('taskPriority');

        if (!projectSelect.value || !taskTitleInput.value) {
            alert('Please select a project and enter a task title');
            return;
        }

        const selectedSubcategory = subcategorySelect.value;
        const section = selectedSubcategory ?
            this.subsections.find(s => selectedSubcategory.includes(s.replace(/\s+/g, ''))) ||
            this.subsections[0] : this.subsections[0];

        const newTask = {
            id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
            projectId: projectSelect.value,
            subcategoryId: selectedSubcategory,
            title: taskTitleInput.value,
            description: taskDescription.value,
            dueDate: taskDueDate.value,
            priority: taskPriority.value,
            section: section,
            status: 'pending',
            completed: false,
            createdAt: new Date().toISOString(),
            relevantLinks: [...this.relevantLinks] // Use stored links
        };

        const projectId = newTask.projectId;

        // === TASK CREATION: Use TaskService for centralized logic ===
        try {
            if (window.TaskService) {
                // TaskService handles local + remote persistence
                await window.TaskService.createTask(projectId, newTask);
                console.log('[TaskCreationController] Task created via TaskService:', newTask.id);
            } else {
                // Fallback if TaskService not available - use TaskRepository
                console.warn('[TaskCreationController] TaskService not available, using TaskRepository fallback');
                if (window.TaskRepository) {
                    window.TaskRepository.addTask(projectId, newTask);
                } else {
                    let tasks = JSON.parse(localStorage.getItem(`tasks-${projectId}`) || '[]');
                    tasks.push(newTask);
                    localStorage.setItem(`tasks-${projectId}`, JSON.stringify(tasks));
                    localStorage.setItem(`tasks-${projectId}-version`, Date.now().toString());
                }
            }
        } catch (error) {
            console.error('[TaskCreationController] Error creating task:', error);
            // Still save locally as fallback via TaskRepository
            if (window.TaskRepository) {
                window.TaskRepository.addTask(projectId, newTask);
            } else {
                let tasks = JSON.parse(localStorage.getItem(`tasks-${projectId}`) || '[]');
                if (!tasks.find(t => t.id === newTask.id)) {
                    tasks.push(newTask);
                    localStorage.setItem(`tasks-${projectId}`, JSON.stringify(tasks));
                }
            }
        }

        // Reset UI immediately - user sees feedback fast
        taskTitleInput.value = '';
        taskDescription.value = '';
        taskDueDate.value = '';
        projectSelect.value = '';
        subcategorySelect.innerHTML = '<option value="">Select a Subcategory</option>';

        // Close modal - immediate feedback
        this.hideTaskModal();

        // Quick local priority update
        this.updatePriorityTasks();

        // Show task immediately from localStorage
        if (typeof window.displayPriorityTask === 'function') {
            window.displayPriorityTask(true);
        }

        // === DEFERRED BACKGROUND OPERATIONS ===
        const deferredOperations = async () => {
            try {
                // Cross-tab sync notification
                if (window.crossTabSync) {
                    window.crossTabSync.broadcastAction('task-update', {
                        projectId: projectId,
                        timestamp: Date.now()
                    });
                }

                // File uploads (can be very slow)
                if (this.modalFilesToUpload.length > 0) {
                    await this.uploadFilesForTask(newTask.id);
                }

                // Full priority recalculation (synchronous but deferred)
                if (typeof window.updatePriorityScores === 'function') {
                    window.updatePriorityScores();
                }

                console.log('[TaskCreationController] Background operations completed for task:', newTask.id);
            } catch (error) {
                console.error('[TaskCreationController] Background operations error:', error);
                if (typeof window.showToast === 'function') {
                    window.showToast('Sync Warning', 'Task saved. Some operations will retry.', 'warning');
                }
            }
        };

        // Schedule background work
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => deferredOperations(), { timeout: 5000 });
        } else {
            setTimeout(deferredOperations, 50);
        }
    }

    async uploadFilesForTask(taskId) {
        if (!this.modalFilesToUpload.length) return;
        const filesToUpload = this.modalFilesToUpload.filter(file => file !== null);
        if (!filesToUpload.length) return;
        try {
            if (typeof window.googleDriveAPI !== 'undefined' && window.googleDriveAPI.uploadFile) {
                for (const file of filesToUpload) {
                    await window.googleDriveAPI.uploadFile(file, taskId);
                }
                console.log('Files uploaded successfully for task:', taskId);
            } else {
                console.warn('googleDriveAPI not found, simulation upload');
            }
            return true;
        } catch (error) {
            console.error('Error uploading files for task:', error);
            return false;
        }
    }

    updatePriorityTasks() {
        // Phase 2: Use TaskRepository if available
        const existingPriorityTasks = window.TaskRepository ?
            window.TaskRepository.getPriorityCache() :
            JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
        const existingTaskIds = new Set(existingPriorityTasks.map(task => String(task.id)));
        const allProjects = JSON.parse(localStorage.getItem('projects') || '[]');

        const newPriorityTasks = [];
        allProjects.forEach(project => {
            // Phase 2: Use TaskRepository for task retrieval
            const tasks = window.TaskRepository ?
                window.TaskRepository.getAllTasks(project.id) :
                JSON.parse(localStorage.getItem(`tasks-${project.id}`) || '[]');

            const newTasks = tasks
                .filter(task => !task.completed && !task.deleted && !existingTaskIds.has(String(task.id)))
                .sort((a, b) => {
                    const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
                    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
                        return priorityOrder[b.priority] - priorityOrder[a.priority];
                    }
                    return new Date(a.dueDate) - new Date(b.dueDate);
                });
            newPriorityTasks.push(...newTasks);
        });

        const updatedExistingTasks = existingPriorityTasks.filter(task => {
            const project = allProjects.find(p => p.id === task.projectId);
            if (!project) return false;
            // Phase 2: Use TaskRepository
            const projectTasks = window.TaskRepository ?
                window.TaskRepository.getAllTasks(project.id) :
                JSON.parse(localStorage.getItem(`tasks-${project.id}`) || '[]');
            const currentTask = projectTasks.find(t => String(t.id) === String(task.id));
            return currentTask && !currentTask.completed && !currentTask.deleted;
        });

        // Use TaskService mediator for coordinated writes
        if (window.TaskService && typeof window.TaskService.addTaskToPriority === 'function') {
            // Add new tasks via TaskService
            newPriorityTasks.forEach(task => {
                window.TaskService.addTaskToPriority(task);
            });
            console.log(`[TaskCreationController] Added ${newPriorityTasks.length} new tasks via TaskService`);
        } else {
            // Phase 2: Use TaskRepository for fallback write
            const finalPriorityTasks = [...updatedExistingTasks, ...newPriorityTasks];
            if (window.TaskRepository) {
                window.TaskRepository.savePriorityCache(finalPriorityTasks);
            } else {
                localStorage.setItem('calculatedPriorityTasks', JSON.stringify(finalPriorityTasks));
            }
            console.warn('[TaskCreationController] TaskService not available, using TaskRepository fallback');
        }
    }

    addRelevantLinkToTask() {
        const titleInput = document.getElementById('linkTitleInput');
        const urlInput = document.getElementById('linkUrlInput');

        const title = titleInput.value.trim();
        const url = urlInput.value.trim();

        if (!title || !url) {
            alert('Please enter both a title and a valid URL.');
            return;
        }

        this.relevantLinks.push({ title, url, type: 'user' });
        this.renderRelevantLinks();

        // Reset inputs
        titleInput.value = '';
        urlInput.value = '';
    }

    removeRelevantLink(index) {
        this.relevantLinks.splice(index, 1);
        this.renderRelevantLinks();
    }

    renderRelevantLinks() {
        const container = document.getElementById('relevantLinksList');
        if (!container) return;

        container.innerHTML = this.relevantLinks.map((link, index) => `
            <div class="link-item p-2 mb-1 border rounded d-flex justify-content-between align-items-center">
                <a href="${link.url}" target="_blank" class="text-truncate" style="max-width: 80%;">${link.title}</a>
                <button type="button" class="btn btn-sm text-danger" onclick="removeRelevantLink(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
    }
}

const taskCreationController = new TaskCreationController();
export default taskCreationController;

if (typeof window !== 'undefined') {
    window.taskCreationController = taskCreationController;
}
