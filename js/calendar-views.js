// Calendar Views Manager
class CalendarViewManager {
    constructor() {
        this.currentDate = new Date();
        this.currentView = 'daily';
        this.tasks = [];
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        // Load initial tasks
        await this.refreshTasks();

        // Initial render
        await this.render();

        // Remove navigation button setup as it's handled by CalendarManager

        this.initialized = true;
    }

    async refreshTasks() {
        try {
            // Get all subjects from localStorage
            const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');
            let allTasks = [];

            // First try to get tasks from localStorage as fallback
            const loadTasksForProject = async (projectId) => {
                try {
                    // Try Firestore first
                    if (window.loadTasksFromFirestore) {
                        return await window.loadTasksFromFirestore(projectId);
                    }

                    // Fallback to localStorage if Firestore not available
                    const tasksJson = localStorage.getItem(`tasks-${projectId}`);
                    if (tasksJson) {
                        return JSON.parse(tasksJson);
                    }

                    return [];
                } catch (error) {
                    console.error(`Error loading tasks for ${projectId}:`, error);
                    return [];
                }
            };

            // Load tasks for each subject
            for (const subject of subjects) {
                const projectTasks = await loadTasksForProject(subject.tag);

                // Map tasks to include project info
                const mappedTasks = projectTasks.map(task => ({
                    ...task,
                    projectId: subject.tag,
                    projectName: subject.name
                }));

                allTasks = allTasks.concat(mappedTasks);
            }

            // Also load extra-curricular tasks
            const extraTasks = await loadTasksForProject('EXTRA');
            allTasks = allTasks.concat(extraTasks.map(task => ({
                ...task,
                projectId: 'EXTRA',
                projectName: 'Extra Curricular'
            })));

            // Process and filter tasks
            this.tasks = allTasks
                .filter(task => {
                    // Ensure task has a valid due date
                    if (!task.dueDate) {
                        console.log('Task without due date:', task);
                        return false;
                    }

                    // Convert task due date to Date object for comparison
                    const taskDate = new Date(task.dueDate);
                    if (isNaN(taskDate.getTime())) {
                        console.log('Invalid date for task:', task);
                        return false;
                    }

                    // Only include tasks from this year
                    const taskYear = taskDate.getFullYear();
                    const currentYear = this.currentDate.getFullYear();
                    return taskYear === currentYear;
                })
                .map(task => ({
                    ...task,
                    // Ensure dueDate is in ISO format
                    dueDate: new Date(task.dueDate).toISOString().split('T')[0]
                }));

            console.log('Loaded tasks:', this.tasks);

        } catch (error) {
            console.error('Error refreshing tasks:', error);
            this.tasks = [];
        }
    }

    setupViewButtons() {
        const viewButtons = document.querySelectorAll('.view-btn');
        viewButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                // Remove active class from all buttons
                viewButtons.forEach(b => b.classList.remove('active'));
                // Add active class to clicked button
                btn.classList.add('active');
                // Switch view
                this.switchView(btn.dataset.view);
            });
        });
    }

    async switchView(view) {
        if (view === this.currentView) return;

        // Handle daily view switch separately to avoid render loop
        if (view === 'daily' && !window.location.pathname.includes('daily-calendar.html')) {
            // DISABLED: Redirect to daily-calendar.html (commenting out to troubleshoot navigation issues)
            // window.location.href = 'daily-calendar.html';
            console.log('🛑 Navigation to daily-calendar.html was prevented for troubleshooting');
            return;
        }

        // Store the old view for transition
        const oldView = this.currentView;
        this.currentView = view;

        // Reset date to start of current period when switching views
        const today = new Date();
        switch (view) {
            case 'daily':
                // Keep current date when switching to daily
                break;
            case 'weekly':
                // Move to the start of the current week
                this.currentDate = this.getWeekStart(this.currentDate);
                break;
            case 'monthly':
                // Move to the start of the current month
                this.currentDate.setDate(1);
                break;
            case 'yearly':
                // Move to the start of the current year
                this.currentDate = new Date(this.currentDate.getFullYear(), 0, 1);
                break;
        }

        await this.render();
    }

    getDayStatus(date) {
        // Normalize dates to compare only the date part (YYYY-MM-DD)
        const dateStr = new Date(date).toISOString().split('T')[0];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];

        // Get tasks for this date
        const dayTasks = this.tasks.filter(task => {
            const taskDateStr = task.dueDate.split('T')[0];
            const matches = taskDateStr === dateStr;

            if (matches) {
                console.log('Found task for date', dateStr, ':', task);
            }

            return matches;
        });

        // If no tasks, return success (green)
        if (dayTasks.length === 0) {
            return 'success';
        }

        // Check for incomplete tasks
        const hasIncompleteTasks = dayTasks.some(task => {
            // A task is incomplete if:
            // 1. It's not marked as completed AND
            // 2. It doesn't have a completedAt timestamp
            const isIncomplete = !task.completed && !task.completedAt;

            if (isIncomplete) {
                console.log('Found incomplete task:', task);
            }

            return isIncomplete;
        });

        // Compare dates as strings for accurate date comparison
        if (dateStr < todayStr && hasIncompleteTasks) {
            // Past date with incomplete tasks: red
            return 'danger';
        } else if (dateStr > todayStr) {
            // Future date with any tasks: yellow
            return 'warning';
        } else if (dateStr === todayStr) {
            // Today's tasks: yellow if incomplete, green if all complete
            return hasIncompleteTasks ? 'warning' : 'success';
        } else {
            // Past date with all tasks complete: green
            return 'success';
        }
    }

    generateMonthGrid(year, month) {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startingDay = firstDay.getDay();
        const totalDays = lastDay.getDate();

        let html = '<div class="month-grid">';
        html += `
            <div class="week-header">
                <div>Sun</div>
                <div>Mon</div>
                <div>Tue</div>
                <div>Wed</div>
                <div>Thu</div>
                <div>Fri</div>
                <div>Sat</div>
            </div>
            <div class="days-grid">`;

        // Add empty cells for days before the first day of the month
        for (let i = 0; i < startingDay; i++) {
            html += '<div class="day-cell empty"></div>';
        }

        // Add cells for each day of the month
        for (let day = 1; day <= totalDays; day++) {
            const date = new Date(year, month, day);
            const status = this.getDayStatus(date);
            const isToday = this.isToday(date);

            html += `
                <div class="day-cell ${status} ${isToday ? 'today' : ''}"
                     data-date="${date.toISOString().split('T')[0]}">
                    <span class="day-number">${day}</span>
                    ${this.generateDayTaskIndicators(date)}
                </div>
            `;
        }

        html += '</div></div>';
        return html;
    }

    generateWeekView() {
        const weekStart = this.getWeekStart(this.currentDate);
        let html = '<div class="week-view">';

        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
            const status = this.getDayStatus(date);

            html += `
                <div class="week-day ${status}">
                    <div class="day-header">
                        <span class="day-name">${date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                        <span class="day-number">${date.getDate()}</span>
                    </div>
                    ${this.generateDayTaskList(date)}
                </div>
            `;
        }

        html += '</div>';
        return html;
    }

    generateYearView() {
        const year = this.currentDate.getFullYear();
        let html = '<div class="year-view">';

        // Generate quarters
        for (let quarter = 0; quarter < 4; quarter++) {
            html += `
                <div class="year-quarter">
                    <div class="quarter-header">Q${quarter + 1} ${year}</div>
                    <div class="quarter-months">
            `;

            // Generate months for this quarter
            for (let i = 0; i < 3; i++) {
                const month = quarter * 3 + i;
                const monthDate = new Date(year, month, 1);
                const monthName = monthDate.toLocaleDateString('en-US', { month: 'long' });

                html += `
                    <div class="year-month">
                        <div class="month-header">
                            <span class="month-name">${monthName}</span>
                            <div class="month-summary">
                                <span class="month-stats">
                                    <i class="fas fa-calendar-check"></i> ${this.getMonthStats(year, month)}
                                </span>
                            </div>
                        </div>
                        ${this.generateMonthMiniGrid(year, month)}
                    </div>
                `;
            }

            html += '</div></div>';
        }

        html += '</div>';
        return html;
    }

    generateMonthMiniGrid(year, month) {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startingDay = firstDay.getDay();
        const totalDays = lastDay.getDate();

        let html = '<div class="month-grid">';

        // Add week header
        html += `
            <div class="week-header">
                <div>S</div>
                <div>M</div>
                <div>T</div>
                <div>W</div>
                <div>T</div>
                <div>F</div>
                <div>S</div>
            </div>
        `;

        // Add empty cells for days before the first day of the month
        for (let i = 0; i < startingDay; i++) {
            html += '<div class="day empty"></div>';
        }

        // Add cells for each day of the month
        for (let day = 1; day <= totalDays; day++) {
            const date = new Date(year, month, day);
            const isToday = this.isToday(date);
            const status = this.getDayStatus(date);
            const taskCount = this.getTaskCount(date);

            html += `
                <div class="day ${status} ${isToday ? 'today' : ''}"
                     data-date="${date.toISOString().split('T')[0]}">
                    ${day}
                    ${taskCount > 0 ? `<span class="task-count">${taskCount}</span>` : ''}
                </div>
            `;
        }

        // Add empty cells for remaining days to complete the grid
        const remainingDays = (7 - ((startingDay + totalDays) % 7)) % 7;
        for (let i = 0; i < remainingDays; i++) {
            html += '<div class="day empty"></div>';
        }

        html += '</div>';
        return html;
    }

    getTaskCount(date) {
        const dateStr = date.toISOString().split('T')[0];
        return this.tasks.filter(task => {
            const taskDateStr = task.dueDate.split('T')[0];
            return taskDateStr === dateStr;
        }).length;
    }

    getMonthStats(year, month) {
        let stats = {
            total: 0,
            completed: 0,
            pending: 0,
            overdue: 0
        };

        const lastDay = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let day = 1; day <= lastDay; day++) {
            const date = new Date(year, month, day);
            const dateStr = date.toISOString().split('T')[0];

            const dayTasks = this.tasks.filter(task => {
                const taskDateStr = task.dueDate.split('T')[0];
                return taskDateStr === dateStr;
            });

            stats.total += dayTasks.length;

            dayTasks.forEach(task => {
                if (task.completed || task.completedAt) {
                    stats.completed++;
                } else if (date < today) {
                    stats.overdue++;
                } else {
                    stats.pending++;
                }
            });
        }

        // Return formatted stats
        if (stats.total === 0) return '0';

        return `
            <div class="month-stat success">${stats.completed}</div>
            <div class="month-stat warning">${stats.pending}</div>
            <div class="month-stat danger">${stats.overdue}</div>
        `;
    }

    generateDayTaskIndicators(date) {
        // Convert input date to YYYY-MM-DD format
        const dateStr = new Date(date).toISOString().split('T')[0];

        // Get tasks for this date
        const dayTasks = this.tasks.filter(task => {
            const taskDateStr = task.dueDate.split('T')[0];
            return taskDateStr === dateStr;
        });

        if (dayTasks.length === 0) return '';

        // Count completed tasks
        const completedCount = dayTasks.filter(task => {
            return task.completed || task.completedAt;
        }).length;

        const totalCount = dayTasks.length;

        return `
            <div class="task-indicators">
                <span class="task-count ${completedCount === totalCount ? 'completed' : ''}">
                    ${completedCount}/${totalCount}
                </span>
            </div>
        `;
    }

    generateDayTaskList(date) {
        const dayTasks = this.tasks.filter(task =>
            task.dueDate === date.toISOString().split('T')[0]
        );

        if (dayTasks.length === 0) {
            return '<div class="no-tasks">No tasks</div>';
        }

        // Sort tasks by completion status and priority
        const sortedTasks = dayTasks.sort((a, b) => {
            // Check both completion indicators
            const aCompleted = a.completed || a.completedAt;
            const bCompleted = b.completed || b.completedAt;

            // Completed tasks go to the bottom
            if (aCompleted && !bCompleted) return 1;
            if (!aCompleted && bCompleted) return -1;

            // Sort by priority for incomplete tasks
            const priorityOrder = { high: 0, medium: 1, low: 2 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        });

        return `
            <div class="day-tasks">
                ${sortedTasks.map(task => {
                    const isCompleted = task.completed || task.completedAt;
                    return `
                        <div class="task-item ${isCompleted ? 'completed' : ''} ${task.priority}"
                             data-task-id="${task.id}"
                             data-project-id="${task.projectId}"
                             onclick="calendarManager.showTaskDetails(event, '${task.id}', '${task.projectId}')">
                            <div class="task-content">
                                <div class="task-project">${task.projectName}</div>
                                <div class="task-title">
                                    ${isCompleted ? '<i class="bi bi-check-circle-fill text-success me-1"></i>' : ''}
                                    ${task.title}
                                </div>
                                <div class="task-section">${task.section}</div>
                            </div>
                            <div class="task-actions">
                                ${!isCompleted ? `
                                    <button class="complete-btn" onclick="calendarManager.completeTask('${task.id}', '${task.projectId}')">
                                        <i class="bi bi-check-circle"></i>
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    isToday(date) {
        const today = new Date();
        return date.getDate() === today.getDate() &&
               date.getMonth() === today.getMonth() &&
               date.getFullYear() === today.getFullYear();
    }

    getWeekStart(date) {
        const start = new Date(date);
        start.setDate(date.getDate() - date.getDay());
        return start;
    }

    async render() {
        const container = document.querySelector('.calendar-container');
        if (!container) return;

        // Update navigation button text/icons based on view
        const prevButton = document.getElementById('prevDay');
        const nextButton = document.getElementById('nextDay');
        if (prevButton && nextButton) {
            switch (this.currentView) {
                case 'daily':
                    prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
                    nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
                    break;
                case 'weekly':
                    prevButton.innerHTML = '<i class="fas fa-chevron-left"></i> Week';
                    nextButton.innerHTML = 'Week <i class="fas fa-chevron-right"></i>';
                    break;
                case 'monthly':
                    prevButton.innerHTML = '<i class="fas fa-chevron-left"></i> Month';
                    nextButton.innerHTML = 'Month <i class="fas fa-chevron-right"></i>';
                    break;
                case 'yearly':
                    prevButton.innerHTML = '<i class="fas fa-chevron-left"></i> Year';
                    nextButton.innerHTML = 'Year <i class="fas fa-chevron-right"></i>';
                    break;
            }
        }

        // Update date display
        this.updateDateDisplay();

        // Ensure view navigation exists or create it
        let viewNav = container.querySelector('.view-controls');
        if (!viewNav) {
            viewNav = document.createElement('div');
            viewNav.className = 'calendar-header';
            viewNav.innerHTML = `
                <div class="view-controls">
                    <button class="view-btn" data-view="daily">
                        <i class="fas fa-calendar-day"></i> Daily
                    </button>
                    <button class="view-btn" data-view="weekly">
                        <i class="fas fa-calendar-week"></i> Weekly
                    </button>
                    <button class="view-btn" data-view="monthly">
                        <i class="fas fa-calendar-alt"></i> Monthly
                    </button>
                    <button class="view-btn" data-view="yearly">
                        <i class="fas fa-calendar"></i> Yearly
                    </button>
                </div>
            `;
            container.insertBefore(viewNav, container.firstChild);
            this.setupViewButtons();
        }

        // Update active state of view buttons
        const viewButtons = viewNav.querySelectorAll('.view-btn');
        viewButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === this.currentView);
        });

        // Store the original daily view elements if they exist
        const dailyGridContainer = document.querySelector('.calendar-grid-container');

        let content = '';
        switch (this.currentView) {
            case 'daily':
                if (!window.location.pathname.includes('daily-calendar.html')) {
                    // DISABLED: Redirect to daily-calendar.html (commenting out to troubleshoot navigation issues)
                    // window.location.href = 'daily-calendar.html';
                    console.log('🛑 Navigation to daily-calendar.html was prevented for troubleshooting');
                    return;
                }
                // Restore the daily view and show it
                if (dailyGridContainer) {
                    dailyGridContainer.style.display = 'flex';
                    // Hide any other view content
                    const otherViews = container.querySelector('.week-view, .month-grid, .year-view');
                    if (otherViews) {
                        otherViews.remove();
                    }
                }
                return;
            case 'weekly':
                if (dailyGridContainer) {
                    dailyGridContainer.style.display = 'none';
                }
                content = this.generateWeekView();
                break;
            case 'monthly':
                if (dailyGridContainer) {
                    dailyGridContainer.style.display = 'none';
                }
                content = this.generateMonthGrid(
                    this.currentDate.getFullYear(),
                    this.currentDate.getMonth()
                );
                break;
            case 'yearly':
                if (dailyGridContainer) {
                    dailyGridContainer.style.display = 'none';
                }
                content = this.generateYearView();
                break;
        }

        // Add transition class
        container.classList.add('transitioning');

        // Update content after a brief delay for animation
        setTimeout(() => {
            // For non-daily views, append the new content without destroying daily view
            const existingView = container.querySelector('.week-view, .month-grid, .year-view');
            if (existingView) {
                existingView.remove();
            }
            // Insert the new view content after the navigation
            viewNav.insertAdjacentHTML('afterend', content);
            container.classList.remove('transitioning');
        }, 150);
    }

    // Add method to handle task completion
    async completeTask(taskId, projectId) {
        try {
            // Find the task
            const task = this.tasks.find(t => t.id === taskId && t.projectId === projectId);
            if (!task) return;

            // Create completed task object
            const completedTask = {
                ...task,
                completedAt: new Date().toISOString()
            };

            // Save to completed tasks
            await window.saveCompletedTaskToFirestore(projectId, completedTask);

            // Remove from active tasks
            const projectTasks = await window.loadTasksFromFirestore(projectId) || [];
            const updatedTasks = projectTasks.filter(t => t.id !== taskId);
            await window.saveTasksToFirestore(projectId, updatedTasks);

            // Refresh tasks
            await this.refreshTasks();
            await this.render();

            // Play completion sound if available
            if (window.playPopSound) {
                window.playPopSound();
            }
        } catch (error) {
            console.error('Error completing task:', error);
        }
    }

    // Add method to handle date navigation
    navigateDate(direction) {
        const amount = {
            daily: { days: 1 },
            weekly: { days: 7 },
            monthly: { months: 1 },
            yearly: { years: 1 }
        }[this.currentView] || { days: 1 };

        if (direction === 'prev') {
            if (amount.days) {
                this.currentDate.setDate(this.currentDate.getDate() - amount.days);
            } else if (amount.months) {
                this.currentDate.setMonth(this.currentDate.getMonth() - amount.months);
            } else if (amount.years) {
                this.currentDate.setFullYear(this.currentDate.getFullYear() - amount.years);
            }
        } else {
            if (amount.days) {
                this.currentDate.setDate(this.currentDate.getDate() + amount.days);
            } else if (amount.months) {
                this.currentDate.setMonth(this.currentDate.getMonth() + amount.months);
            } else if (amount.years) {
                this.currentDate.setFullYear(this.currentDate.getFullYear() + amount.years);
            }
        }

        this.render();
        this.updateDateDisplay();
    }

    // Add method to update date display
    updateDateDisplay() {
        const dateElement = document.getElementById('currentDate');
        if (!dateElement) return;

        let displayText = '';
        switch (this.currentView) {
            case 'daily':
                displayText = this.currentDate.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                break;
            case 'weekly': {
                const weekStart = this.getWeekStart(this.currentDate);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 6);
                displayText = `${weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
                break;
            }
            case 'monthly':
                displayText = this.currentDate.toLocaleDateString('en-US', {
                    month: 'long',
                    year: 'numeric'
                });
                break;
            case 'yearly':
                displayText = this.currentDate.toLocaleDateString('en-US', {
                    year: 'numeric'
                });
                break;
        }

        dateElement.textContent = displayText;
    }

    // Add method to show task details
    showTaskDetails(event, taskId, projectId) {
        event.stopPropagation();
        const task = this.tasks.find(t => t.id === taskId && t.projectId === projectId);
        if (!task) return;

        const detailsElement = document.querySelector('.event-details');
        if (!detailsElement) return;

        detailsElement.innerHTML = `
            <div class="task-details">
                <h3>${task.title}</h3>
                <div class="project-info">
                    <span class="badge bg-primary">${task.projectName}</span>
                    <span class="badge bg-secondary">${task.section}</span>
                </div>
                <p class="description">${task.description || 'No description'}</p>
                <div class="meta-info">
                    <div class="due-date">
                        <i class="bi bi-calendar"></i>
                        Due: ${new Date(task.dueDate).toLocaleDateString()}
                    </div>
                    <div class="priority ${task.priority}">
                        <i class="bi bi-flag"></i>
                        Priority: ${task.priority}
                    </div>
                </div>
                <div class="action-buttons">
                    <button class="btn btn-success" onclick="calendarManager.completeTask('${task.id}', '${task.projectId}')">
                        Complete
                    </button>
                    <button class="btn btn-primary" onclick="calendarManager.editTask('${task.id}', '${task.projectId}')">
                        Edit
                    </button>
                </div>
            </div>
        `;

        detailsElement.style.display = 'block';
    }

    // Add method to edit task
    async editTask(taskId, projectId) {
        const task = this.tasks.find(t => t.id === taskId && t.projectId === projectId);
        if (!task) return;

        // Show edit modal
        const editModal = document.querySelector('.event-edit-modal');
        if (!editModal) return;

        // Populate form
        document.getElementById('editTaskTitle').value = task.title;
        document.getElementById('editTaskDescription').value = task.description || '';
        document.getElementById('editTaskDueDate').value = task.dueDate;
        document.getElementById('editTaskPriority').value = task.priority;

        // Store task info for saving
        editModal.dataset.taskId = taskId;
        editModal.dataset.projectId = projectId;

        // Show modal
        editModal.style.display = 'block';
        document.querySelector('.modal-backdrop').style.display = 'block';
    }

    // Add method to save edited task
    async saveEditedTask() {
        const editModal = document.querySelector('.event-edit-modal');
        const taskId = editModal.dataset.taskId;
        const projectId = editModal.dataset.projectId;

        try {
            // Get current tasks
            const projectTasks = await window.loadTasksFromFirestore(projectId) || [];
            const taskIndex = projectTasks.findIndex(t => t.id === taskId);

            if (taskIndex === -1) {
                console.error('Task not found:', taskId);
                return;
            }

            // Update task
            projectTasks[taskIndex] = {
                ...projectTasks[taskIndex],
                title: document.getElementById('editTaskTitle').value,
                description: document.getElementById('editTaskDescription').value,
                dueDate: document.getElementById('editTaskDueDate').value,
                priority: document.getElementById('editTaskPriority').value
            };

            // Save updated tasks
            await window.saveTasksToFirestore(projectId, projectTasks);

            // Close modal
            editModal.style.display = 'none';
            document.querySelector('.modal-backdrop').style.display = 'none';

            // Refresh calendar
            await this.refreshTasks();
            await this.render();
        } catch (error) {
            console.error('Error saving edited task:', error);
        }
    }

    // Add method to close edit modal
    closeEditModal() {
        const editModal = document.querySelector('.event-edit-modal');
        if (editModal) {
            editModal.style.display = 'none';
            document.querySelector('.modal-backdrop').style.display = 'none';
        }
    }
}

// Export the manager
export const calendarManager = new CalendarViewManager();

/**
 * Initialize calendar UI and set up event listeners
 */
export function initializeCalendarUI() {
    document.addEventListener('DOMContentLoaded', async () => {
        await calendarManager.initialize();

        // Handle view switching
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active state
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Switch view
                calendarManager.switchView(btn.dataset.view);
            });
        });

        // Handle date navigation
        document.getElementById('prevDay').addEventListener('click', () => {
            calendarManager.navigateDate('prev');
        });

        document.getElementById('nextDay').addEventListener('click', () => {
            calendarManager.navigateDate('next');
        });

        // Listen for task updates
        window.addEventListener('task-update', async () => {
            await calendarManager.refreshTasks();
            await calendarManager.render();
        });
    });
}