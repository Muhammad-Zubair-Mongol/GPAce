class TasksManager {
    constructor() {
        this.tasks = [];
        this.currentFilter = 'all';
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadTasks();
    }

    setupEventListeners() {
        // Search functionality
        const searchInput = document.getElementById('taskSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.filterTasks(e.target.value));
        }

        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentFilter = btn.dataset.filter;
                this.filterTasks(document.getElementById('taskSearch')?.value || '');
            });
        });
    }

    async loadTasks() {
        console.group('Load Tasks');
        console.log('Attempting to load tasks');

        if (!window.todoistIntegration) {
            console.error('❌ Todoist integration not found');
            console.groupEnd();
            return;
        }

        try {
            // First, check if authenticated
            const isAuthenticated = window.todoistIntegration.isAuthenticated();
            console.log('Authentication Status:', isAuthenticated ? '✅ Authenticated' : '❌ Not Authenticated');

            if (!isAuthenticated) {
                console.warn('🔒 User not authenticated. Redirecting to login.');
                
                // Optional: Show a modal or toast notification
                this.showAuthenticationPrompt();
                
                console.groupEnd();
                return;
            }

            // Fetch tasks
            this.tasks = await window.todoistIntegration.getTasks();
            console.log('Tasks Retrieved:', this.tasks.length);
            
            // Display tasks
            this.displayTasks(this.tasks);
            
            // Play sound effect
            if (window.soundManager) {
                window.soundManager.playSound('transition', 'default');
            }

            console.groupEnd();
        } catch (error) {
            console.error('❌ Error loading tasks:', error);
            
            // Detailed error handling
            if (error.message === 'Not authenticated') {
                console.warn('🔒 Authentication required');
                this.showAuthenticationPrompt();
            } else {
                // Handle other types of errors
                this.showErrorNotification(error);
            }

            console.groupEnd();
        }
    }

    showAuthenticationPrompt() {
        // Create a modal or toast to prompt authentication
        const modal = document.createElement('div');
        modal.className = 'auth-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Authentication Required</h2>
                <p>Please connect your Todoist account to view tasks.</p>
                <button id="connectTodoistBtn">Connect Todoist</button>
            </div>
        `;

        document.body.appendChild(modal);

        const connectBtn = modal.querySelector('#connectTodoistBtn');
        connectBtn.addEventListener('click', () => {
            // Redirect to Todoist login or show login modal
            if (window.todoistIntegration) {
                window.todoistIntegration.initiateLogin();
            }
        });
    }

    showErrorNotification(error) {
        const notification = document.createElement('div');
        notification.className = 'error-notification';
        notification.textContent = `Error: ${error.message}`;
        document.body.appendChild(notification);

        // Remove notification after 5 seconds
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 5000);
    }

    filterTasks(searchTerm = '') {
        let filteredTasks = this.tasks;

        // Apply date filter
        switch (this.currentFilter) {
            case 'today':
                const today = new Date().toISOString().split('T')[0];
                filteredTasks = filteredTasks.filter(task => 
                    task.due && task.due.date === today
                );
                break;
            case 'upcoming':
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                filteredTasks = filteredTasks.filter(task => 
                    task.due && new Date(task.due.date) >= tomorrow
                );
                break;
        }

        // Apply search filter
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filteredTasks = filteredTasks.filter(task =>
                task.content.toLowerCase().includes(term)
            );
        }

        this.displayTasks(filteredTasks);
    }

    displayTasks(tasks) {
        const tasksList = document.getElementById('tasksList');
        if (!tasksList) return;

        // Clear existing tasks
        tasksList.innerHTML = '';

        if (!tasks || tasks.length === 0) {
            tasksList.innerHTML = `
                <div class="task-placeholder">
                    <i class="bi bi-list-check"></i>
                    <p>No tasks found</p>
                </div>
            `;
            return;
        }

        // Sort tasks
        tasks.sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            if (!a.due && !b.due) return 0;
            if (!a.due) return 1;
            if (!b.due) return -1;
            return new Date(a.due.date) - new Date(b.due.date);
        });

        // Create task elements
        tasks.forEach((task, index) => {
            const taskElement = document.createElement('div');
            taskElement.className = 'task-item fade-in';
            taskElement.style.animationDelay = `${index * 0.05}s`;
            
            const priorityClass = task.priority >= 3 ? 'high-priority' : 
                                task.priority === 2 ? 'medium-priority' : 'low-priority';
            
            taskElement.innerHTML = `
                <div class="task-checkbox ${task.completed ? 'checked' : ''}" 
                     data-task-id="${task.id}">
                    ${task.completed ? '<i class="bi bi-check2"></i>' : ''}
                </div>
                <div class="task-content ${task.completed ? 'completed' : ''}">
                    <div class="task-header">
                        <div class="priority-indicator priority-${task.priority}"></div>
                        <span class="task-title">${task.content}</span>
                    </div>
                    ${task.due ? `
                        <div class="task-details">
                            <i class="bi bi-calendar"></i>
                            ${this.formatDate(task.due.date)}
                        </div>
                    ` : ''}
                    ${task.project_id ? `
                        <div class="task-project">
                            <i class="bi bi-folder"></i>
                            ${task.project_name || 'Project'}
                        </div>
                    ` : ''}
                </div>
            `;

            // Add click handler for checkbox
            const checkbox = taskElement.querySelector('.task-checkbox');
            checkbox.addEventListener('click', async () => {
                checkbox.classList.add('checking');
                await window.todoistIntegration.toggleTaskCompletion(task.id, !task.completed);
                // Refresh tasks after toggling
                await this.loadTasks();
                // Play sound effect
                if (window.soundManager) {
                    window.soundManager.playSound('click', 'confirm');
                }
            });

            tasksList.appendChild(taskElement);
        });
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        if (dateString === today.toISOString().split('T')[0]) {
            return 'Today';
        } else if (dateString === tomorrow.toISOString().split('T')[0]) {
            return 'Tomorrow';
        }

        return date.toLocaleDateString();
    }
}

// Initialize Tasks Manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const tasksManager = new TasksManager();
});
