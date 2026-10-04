// Get storage service with fallback (use existing or create new)
// Use global StorageService if available, fallback to simple object if not
// NOTE: Named getStorageService to avoid conflict with global getStorage from storageManager.js
const getStorageService = () => window.StorageService || {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};

class CurrentTaskManager {
    constructor() {
        this.currentTask = null;
        this.taskTitle = document.getElementById('taskTitle');
        this.debugMode = false; // Set to true to enable debug logs

        // Track data sources - MUST be defined before startPeriodicUpdate()
        this.dataSources = {
            calendar: true,   // Check calendar events
            priority: true    // Check priority tasks
        };

        this.setupStorageListener();
        this.startPeriodicUpdate();
    }

    setupStorageListener() {
        window.addEventListener('storage', (e) => {
            if (e.key === 'currentTask' || e.key === 'calendarEvents' || e.key === 'gpace_timetable_events' || e.key === 'gpace_timetable_analysis') {
                this.checkCurrentTask();
            }
        });

        // Listen for in-window custom events from timetable uploads
        window.addEventListener('timetableAnalyzed', () => {
            this.log('Timetable analyzed event received, syncing current task');
            this.checkCurrentTask();
        });
    }

    startPeriodicUpdate() {
        // Check every 10 seconds for real-time responsiveness
        setInterval(() => {
            this.checkCurrentTask();
        }, 10000);

        this.checkCurrentTask();

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

        let currentClassTask = null;
        const storage = getStorageService();

        // 1. Check all possible timetable / calendar event storage sources
        if (this.dataSources.calendar) {
            try {
                // Collect events from calendarEvents, gpace_timetable_events, and analysis schedule
                let allEvents = [];

                const calendarEvents = storage.get('calendarEvents', null);
                if (Array.isArray(calendarEvents)) allEvents.push(...calendarEvents);

                const timetableEvents = storage.get('gpace_timetable_events', null);
                if (Array.isArray(timetableEvents)) allEvents.push(...timetableEvents);

                // Also check gpace_timetable_analysis structure if available
                const timetableAnalysis = storage.get('gpace_timetable_analysis', null);
                if (timetableAnalysis && timetableAnalysis.schedule) {
                    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                    const currentDay = dayNames[now.getDay()];
                    const daySlots = timetableAnalysis.schedule[currentDay];
                    if (Array.isArray(daySlots)) {
                        daySlots.forEach(slot => {
                            if (slot.type === 'class') {
                                allEvents.push({
                                    subject: slot.subject || slot.name,
                                    title: slot.subject || slot.name,
                                    startTime: slot.start,
                                    endTime: slot.end,
                                    day: currentDay,
                                    isClass: true
                                });
                            }
                        });
                    }
                }

                if (allEvents.length > 0) {
                    currentClassTask = this.findCurrentTask(allEvents, now);
                }
            } catch (e) {
                console.error('Error parsing calendar/timetable events:', e);
            }
        }

        // Set and render the current active class or "No Current Task"
        this.setCurrentTask(currentClassTask);
    }

    findCurrentTask(tasks, currentTime) {
        if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
            return null;
        }

        if (!(currentTime instanceof Date)) {
            currentTime = new Date(currentTime);
        }

        const currentDateStr = currentTime.toISOString().split('T')[0];
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const currentDayName = dayNames[currentTime.getDay()];

        // Filter events relevant to today (by date, recurring day, or day property)
        const todayTasks = tasks.filter(task => {
            if (task.date && task.date === currentDateStr) return true;
            if (task.recurring && task.recurring.dayOfWeek && task.recurring.dayOfWeek.toLowerCase() === currentDayName) return true;
            if (task.day && task.day.toLowerCase() === currentDayName) return true;
            if (!task.date && !task.recurring && !task.day) return true;
            return false;
        });

        if (todayTasks.length === 0) {
            return null;
        }

        // Find task that encompasses current time
        const currentTask = todayTasks.find(task => {
            const startStr = task.startTime || task.start;
            const endStr = task.endTime || task.end;

            if (!startStr || !endStr) return false;

            try {
                const startParts = startStr.split(':').map(part => parseInt(part, 10));
                const endParts = endStr.split(':').map(part => parseInt(part, 10));

                if (startParts.length < 2 || endParts.length < 2 ||
                    isNaN(startParts[0]) || isNaN(startParts[1]) ||
                    isNaN(endParts[0]) || isNaN(endParts[1])) {
                    return false;
                }

                const taskStart = new Date(currentTime);
                const taskEnd = new Date(currentTime);

                taskStart.setHours(startParts[0], startParts[1], 0, 0);
                taskEnd.setHours(endParts[0], endParts[1], 0, 0);

                if (taskEnd < taskStart) {
                    taskEnd.setDate(taskEnd.getDate() + 1);
                }

                return currentTime >= taskStart && currentTime <= taskEnd;
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
        const taskTitleEl = document.getElementById('taskTitle');
        const currentTaskDisplay = document.getElementById('currentTaskDisplay');

        if (taskTitleEl) {
            if (task) {
                let taskName = task.subject || task.title || task.name || 'Current Class';
                const startTime = task.startTime || task.start || '';
                const endTime = task.endTime || task.end || '';
                const timeRange = (startTime && endTime) ? ` (${startTime} - ${endTime})` : '';

                taskTitleEl.innerHTML = `
                    <span class="live-pulse-badge"><i class="bi bi-circle-fill"></i> Live Class</span>
                    <span class="class-title-text">${taskName}</span>
                    <span class="class-time-badge">${timeRange}</span>
                `;

                if (currentTaskDisplay) {
                    currentTaskDisplay.classList.add('has-active-class');
                }
                document.title = `[LIVE] ${taskName} - GPAce`;
            } else {
                taskTitleEl.innerHTML = `
                    <span class="free-period-badge"><i class="bi bi-check2-circle"></i> Free Period</span>
                    <span class="class-title-text">No Current Task</span>
                `;

                if (currentTaskDisplay) {
                    currentTaskDisplay.classList.remove('has-active-class');
                }
                document.title = 'GPAce';
            }
        }
    }

    setCurrentTask(task) {
        this.currentTask = task;
        this.updateTaskDisplay(task);
        const storage = getStorageService();
        storage.set('currentTask', task);
    }

    getCurrentTask() {
        return this.currentTask;
    }
}

// Initialize the current task manager
document.addEventListener('DOMContentLoaded', () => {
    const storage = getStorageService();
    window.currentTaskManager = new CurrentTaskManager();

    // Enable debug mode if URL has debug parameter
    if (window.location.search.includes('debug=task') || storage.get('debugTaskManager', false) === true) {
        window.currentTaskManager.debugMode = true;
        console.log('[CurrentTaskManager] Debug mode enabled');
    }

    // Load any existing task
    const taskData = storage.get('currentTask', null);
    if (taskData) {
        try {
            window.currentTaskManager.updateTaskDisplay(taskData);
            window.currentTaskManager.log('Loaded saved task:', taskData.title || taskData.subject);
        } catch (e) {
            console.error('Error loading saved task:', e);
        }
    }

    // Expose debug toggle function
    window.toggleTaskManagerDebug = function () {
        const manager = window.currentTaskManager;
        if (!manager) return false;

        manager.debugMode = !manager.debugMode;
        storage.set('debugTaskManager', manager.debugMode);
        console.log(`[CurrentTaskManager] Debug mode ${manager.debugMode ? 'enabled' : 'disabled'}`);

        // Force a check to see debug output
        if (manager.debugMode) {
            manager.checkCurrentTask();
        }

        return manager.debugMode;
    };

    // Set up keyboard shortcut for debug mode toggle
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            if (typeof window.toggleTaskManagerDebug === 'function') {
                const debugEnabled = window.toggleTaskManagerDebug();
                document.body.classList.toggle('task-debug-mode', debugEnabled);
            }
        }
    });

    // Check if debug mode is enabled on load
    if (storage.get('debugTaskManager', false) === true && window.currentTaskManager) {
        document.body.classList.add('task-debug-mode');
    }
});
