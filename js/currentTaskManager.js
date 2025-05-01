class CurrentTaskManager {
    constructor() {
        this.currentTask = null;
        this.taskTitle = document.getElementById('taskTitle');
        this.debugMode = false; // Set to true to enable debug logs
        this.setupStorageListener();
        this.startPeriodicUpdate();

        // Track data sources
        this.dataSources = {
            calendar: true,   // Check calendar events
            priority: true    // Check priority tasks
        };
    }

    setupStorageListener() {
        window.addEventListener('storage', (e) => {
            if (e.key === 'currentTask') {
                this.updateTaskDisplay(JSON.parse(e.newValue));
            }
        });
    }

    startPeriodicUpdate() {
        // Update more frequently (every 15 seconds) for better responsiveness
        setInterval(() => {
            this.checkCurrentTask();
        }, 15000);

        // Initial check
        this.checkCurrentTask();

        // Also check when the window regains focus
        window.addEventListener('focus', () => {
            this.log('Window focused, checking current task');
            this.checkCurrentTask();
        });
    }

    // Utility method for conditional logging
    log(...args) {
        if (this.debugMode) {
            console.log('[CurrentTaskManager]', ...args);
        }
    }

    checkCurrentTask() {
        const now = new Date();
        const currentTimeStr = this.formatTime(now.getHours(), now.getMinutes());
        const currentDateStr = now.toISOString().split('T')[0];

        this.log('Checking current task at', currentTimeStr);

        let currentTask = null;

        // Check calendar events if enabled
        if (this.dataSources.calendar) {
            try {
                const calendarEventsStr = localStorage.getItem('calendarEvents');
                if (calendarEventsStr) {
                    const calendarEvents = JSON.parse(calendarEventsStr);
                    this.log('Calendar events found:', calendarEvents.length);

                    const calendarTask = this.findCurrentTask(calendarEvents, now);
                    if (calendarTask) {
                        this.log('Found current calendar task:', calendarTask.title || calendarTask.subject);
                        currentTask = calendarTask;
                    }
                }
            } catch (e) {
                console.error('Error parsing calendar events:', e);
            }
        }

        // Check priority tasks if enabled and no calendar task was found
        if (this.dataSources.priority && !currentTask) {
            try {
                const priorityTasksStr = localStorage.getItem('calculatedPriorityTasks');
                if (priorityTasksStr) {
                    const priorityTasks = JSON.parse(priorityTasksStr);
                    this.log('Priority tasks found:', priorityTasks.length);

                    // If there are priority tasks, use the first one as current
                    if (priorityTasks.length > 0) {
                        const topPriorityTask = priorityTasks[0];
                        this.log('Using top priority task:', topPriorityTask.title);

                        // Add time information to the priority task if missing
                        if (!topPriorityTask.startTime || !topPriorityTask.endTime) {
                            // Get wake and sleep times from schedule
                            const scheduleStr = localStorage.getItem('dailySchedule');
                            let wakeTime = '08:00';
                            let sleepTime = '22:00';

                            if (scheduleStr) {
                                const schedule = JSON.parse(scheduleStr);
                                wakeTime = schedule.wakeTime || wakeTime;
                                sleepTime = schedule.sleepTime || sleepTime;
                            }

                            // Set default time range for the priority task
                            topPriorityTask.startTime = wakeTime;
                            topPriorityTask.endTime = sleepTime;
                            topPriorityTask.date = currentDateStr;
                        }

                        currentTask = topPriorityTask;
                    }
                }
            } catch (e) {
                console.error('Error parsing priority tasks:', e);
            }
        }

        // Set the current task
        this.setCurrentTask(currentTask);
    }

    findCurrentTask(tasks, currentTime) {
        if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
            this.log('No tasks to check');
            return null;
        }

        // Ensure currentTime is a Date object
        if (!(currentTime instanceof Date)) {
            currentTime = new Date(currentTime);
        }

        const currentDateStr = currentTime.toISOString().split('T')[0];
        this.log('Finding task for date:', currentDateStr);

        // Filter tasks for today
        const todayTasks = tasks.filter(task => {
            // Handle tasks without date (assume today)
            if (!task.date) {
                task.date = currentDateStr;
                return true;
            }
            return task.date === currentDateStr;
        });

        this.log('Today\'s tasks:', todayTasks.length);

        if (todayTasks.length === 0) {
            return null;
        }

        // Find task that encompasses current time
        const currentTask = todayTasks.find(task => {
            // Skip tasks without time information
            if (!task.startTime || !task.endTime) {
                return false;
            }

            try {
                // Parse time strings safely
                const startParts = task.startTime.split(':').map(part => parseInt(part, 10));
                const endParts = task.endTime.split(':').map(part => parseInt(part, 10));

                // Validate time parts
                if (startParts.length < 2 || endParts.length < 2 ||
                    isNaN(startParts[0]) || isNaN(startParts[1]) ||
                    isNaN(endParts[0]) || isNaN(endParts[1])) {
                    this.log('Invalid time format for task:', task.title || task.subject);
                    return false;
                }

                // Create new date objects for comparison
                const taskStart = new Date(currentTime);
                const taskEnd = new Date(currentTime);

                taskStart.setHours(startParts[0], startParts[1], 0, 0);
                taskEnd.setHours(endParts[0], endParts[1], 0, 0);

                // Handle overnight tasks (end time earlier than start time)
                if (taskEnd < taskStart) {
                    taskEnd.setDate(taskEnd.getDate() + 1);
                }

                // Check if current time is within task time range
                const isCurrentTask = currentTime >= taskStart && currentTime <= taskEnd;

                if (isCurrentTask) {
                    this.log('Found current task:', task.title || task.subject,
                             'Time range:', task.startTime, '-', task.endTime);
                }

                return isCurrentTask;
            } catch (e) {
                console.error('Error comparing task times:', e);
                return false;
            }
        });

        return currentTask || null;
    }

    formatTime(hours, minutes) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    updateTaskDisplay(task) {
        this.currentTask = task;
        if (this.taskTitle) {
            if (task) {
                // Extract task name from various possible properties
                let taskName = '';

                // Try different properties where the task name might be stored
                if (task.subject) taskName = task.subject;
                else if (task.title) taskName = task.title;
                else if (task.name) taskName = task.name;

                // If we still don't have a name, try to create one from other properties
                if (!taskName && task.projectName) {
                    taskName = `${task.projectName} task`;
                    if (task.section) taskName = `${task.section} - ${taskName}`;
                }

                // Fallback
                if (!taskName) taskName = 'Untitled Task';

                // Update the display
                this.taskTitle.textContent = taskName;

                // Add task details if available
                let taskDetails = '';
                if (task.startTime && task.endTime) {
                    taskDetails = ` (${task.startTime}-${task.endTime})`;
                }

                // Update the page title for better visibility
                document.title = `${taskName}${taskDetails} - GPAce`;

                // Add visual indicator for the task source
                const taskSource = task.date ? 'calendar' : 'priority';
                this.taskTitle.dataset.source = taskSource;

                this.log('Updated task display:', taskName);
            } else {
                this.taskTitle.textContent = 'No Current Task';
                document.title = 'GPAce';
                delete this.taskTitle.dataset.source;
                this.log('Cleared task display');
            }
        }
    }

    setCurrentTask(task) {
        if (JSON.stringify(this.currentTask) !== JSON.stringify(task)) {
            this.currentTask = task;
            localStorage.setItem('currentTask', JSON.stringify(task));
            this.updateTaskDisplay(task);
        }
    }

    getCurrentTask() {
        return this.currentTask;
    }
}

// Initialize the current task manager
document.addEventListener('DOMContentLoaded', () => {
    window.currentTaskManager = new CurrentTaskManager();

    // Enable debug mode if URL has debug parameter
    if (window.location.search.includes('debug=task') || localStorage.getItem('debugTaskManager') === 'true') {
        window.currentTaskManager.debugMode = true;
        console.log('[CurrentTaskManager] Debug mode enabled');
    }

    // Load any existing task
    const savedTask = localStorage.getItem('currentTask');
    if (savedTask) {
        try {
            const taskData = JSON.parse(savedTask);
            window.currentTaskManager.updateTaskDisplay(taskData);
            window.currentTaskManager.log('Loaded saved task:', taskData.title || taskData.subject);
        } catch (e) {
            console.error('Error loading saved task:', e);
        }
    }

    // Expose debug toggle function
    window.toggleTaskManagerDebug = function() {
        const manager = window.currentTaskManager;
        if (!manager) return false;

        manager.debugMode = !manager.debugMode;
        localStorage.setItem('debugTaskManager', manager.debugMode ? 'true' : 'false');
        console.log(`[CurrentTaskManager] Debug mode ${manager.debugMode ? 'enabled' : 'disabled'}`);

        // Force a check to see debug output
        if (manager.debugMode) {
            manager.checkCurrentTask();
        }

        return manager.debugMode;
    };

    // Set up keyboard shortcut for debug mode toggle
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            if (typeof window.toggleTaskManagerDebug === 'function') {
                const debugEnabled = window.toggleTaskManagerDebug();
                document.body.classList.toggle('task-debug-mode', debugEnabled);
            }
        }
    });

    // Check if debug mode is enabled on load
    if (localStorage.getItem('debugTaskManager') === 'true' && window.currentTaskManager) {
        document.body.classList.add('task-debug-mode');
    }
});
