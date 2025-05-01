// priority-list-utils.js - Utility functions for the priority list page

/**
 * Task Data Functions
 */

// Get all priority tasks from localStorage
function getAllTasks() {
    // Get pre-calculated priority tasks from localStorage
    return JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
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
        const response = await fetch('/api/generate-subtasks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.details || 'Failed to generate subtasks');
        }

        const data = await response.json();
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
    const subtaskItem = checkbox.closest('.subtask-item');
    subtaskItem.classList.toggle('completed', checkbox.checked);

    // Save completion status
    const subtaskId = subtaskItem.dataset.subtaskId;
    const completedSubtasks = JSON.parse(localStorage.getItem('completedSubtasks') || '{}');
    completedSubtasks[subtaskId] = checkbox.checked;
    localStorage.setItem('completedSubtasks', JSON.stringify(completedSubtasks));
}

// Load saved completion status for subtasks
function loadCompletionStatus() {
    const completedSubtasks = JSON.parse(localStorage.getItem('completedSubtasks') || '{}');
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

// Display all tasks in the UI
function displayTasks() {
    const taskList = document.getElementById('taskList');
    const tasks = getAllTasks();

    if (tasks.length === 0) {
        taskList.innerHTML = '<div class="no-tasks">No tasks found</div>';
        return;
    }

    // Group tasks by interleave date
    const groupedTasks = groupTasksByInterleaveDate(tasks);
    
    // Create HTML for all groups and tasks
    let html = '';
    
    // Add each group to the HTML
    Object.entries(groupedTasks).forEach(([dateGroup, tasksInGroup]) => {
        // Add a group header
        html += `
            <div class="interleave-group-header">
                <div class="interleave-date">
                    <i class="bi bi-calendar-check"></i>
                    ${dateGroup === 'not-interleaved' ? 'Never Interleaved' : `Interleaved on ${formatGroupDate(dateGroup)}`}
                </div>
                <div class="group-count">${tasksInGroup.length} task${tasksInGroup.length > 1 ? 's' : ''}</div>
            </div>
        `;
        
        // Add tasks in this group
        tasksInGroup.forEach(task => {
            html += `
                <div class="task-card" data-task-id="${task.id || task.index}">
                    <div class="main-task">
                        <div class="priority-score">${task.priorityScore.toFixed(1)}</div>
                        <div class="task-title">${task.title}</div>
                        <div class="task-section">${task.section}</div>
                        <div class="project-name">${task.projectName}</div>
                        <div class="due-date ${getDueDateClass(task.dueDate)}">
                            <i class="bi bi-calendar2-event"></i>
                            ${formatDate(task.dueDate)}
                        </div>
                        <div class="task-actions">
                            <button onclick="completeTask('${task.projectId}', '${task.id || task.index}')" class="task-btn complete-btn" title="Complete Task">
                                <i class="bi bi-check-circle"></i>
                            </button>
                            <button onclick="interleaveTask()" class="task-btn interleave-btn ${task.lastInterleaved ? 'interleaved' : ''}" title="Interleave Task">
                                <i class="bi bi-arrow-repeat"></i>
                            </button>
                            <button onclick="skipTask()" class="task-btn skip-btn" title="Skip Task">
                                <i class="bi bi-skip-forward"></i>
                            </button>
                        </div>
                        <button class="expand-btn" onclick="toggleSubtasks(this, '${task.id || task.index}')">
                            <i class="bi bi-chevron-down"></i>
                        </button>
                    </div>
                    <div class="subtasks-container" id="subtasks-${task.id || task.index}">
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
    loadCompletionStatus();
}

// Helper function to group tasks by interleave date
function groupTasksByInterleaveDate(tasks) {
    // Group tasks by interleave date (yyyy-mm-dd format or 'not-interleaved')
    const groups = {};
    
    tasks.forEach((task, index) => {
        // Store original index for reference
        task.index = index;
        
        let groupKey = 'not-interleaved';
        
        if (task.lastInterleaved) {
            const date = new Date(task.lastInterleaved);
            groupKey = date.toISOString().split('T')[0]; // Get yyyy-mm-dd format
        }
        
        // Create group if it doesn't exist
        if (!groups[groupKey]) {
            groups[groupKey] = [];
        }
        
        // Add task to its group
        groups[groupKey].push(task);
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
        const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
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

// Mark a task as complete
function completeTask(projectId, taskId) {
    try {
        // Get the priority tasks list
        const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
        
        // Find and remove the completed task
        const taskIndex = priorityTasks.findIndex(task => 
            (task.id === taskId || task.id === String(taskId)) && 
            (task.projectId === projectId || task.projectId === String(projectId))
        );
        
        if (taskIndex === -1) {
            console.error('Task not found:', taskId, projectId);
            alert('Task not found. Please try again or refresh the page.');
            return;
        }
        
        const completedTask = priorityTasks.splice(taskIndex, 1)[0];
        
        // Save updated priority tasks list
        localStorage.setItem('calculatedPriorityTasks', JSON.stringify(priorityTasks));
        
        // Optional: Add to completed tasks list
        const completedTasks = JSON.parse(localStorage.getItem('completedTasks') || '[]');
        completedTask.completedDate = new Date().toISOString();
        completedTasks.push(completedTask);
        localStorage.setItem('completedTasks', JSON.stringify(completedTasks));
        
        // Remove the original task from its project's task list
        if (projectId) {
            const projectTasks = JSON.parse(localStorage.getItem(`tasks-${projectId}`) || '[]');
            const projTaskIndex = projectTasks.findIndex(t => t.id === taskId);
            
            if (projTaskIndex !== -1) {
                projectTasks.splice(projTaskIndex, 1);
                localStorage.setItem(`tasks-${projectId}`, JSON.stringify(projectTasks));
            }
        }
        
        // Update the display
        displayTasks();
        
        // Show completion message
        const notification = document.createElement('div');
        notification.className = 'completion-notification';
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <i class="bi bi-check-circle-fill" style="font-size: 1.5rem; color: var(--secondary-color);"></i>
                <div>
                    <strong>Task Completed!</strong>
                    <div>${completedTask.title}</div>
                </div>
            </div>
        `;
        notification.style.position = 'fixed';
        notification.style.bottom = '80px';
        notification.style.right = '20px';
        notification.style.backgroundColor = 'var(--card-bg)';
        notification.style.color = 'var(--text-color)';
        notification.style.padding = '15px';
        notification.style.borderRadius = '5px';
        notification.style.boxShadow = '0 3px 15px rgba(0,0,0,0.3)';
        notification.style.border = '1px solid var(--secondary-color)';
        notification.style.zIndex = '1000';
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        notification.style.transform = 'translateY(20px)';
        
        document.body.appendChild(notification);
        
        // Animate in and out
        setTimeout(() => { 
            notification.style.opacity = '1'; 
            notification.style.transform = 'translateY(0)';
        }, 10);
        setTimeout(() => { 
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(20px)';
        }, 3000);
        setTimeout(() => { document.body.removeChild(notification); }, 3500);
        
    } catch (error) {
        console.error('Error completing task:', error);
        alert('Error completing task: ' + error.message);
    }
}

// Skip a task (move to end of list)
function skipTask() {
    try {
        // Same implementation as interleaveTask, but with a different message
        const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
        if (priorityTasks.length <= 1) return;
        
        // Move first task to the end (without marking as interleaved)
        const firstTask = priorityTasks.shift();
        priorityTasks.push(firstTask);
        
        // Save to localStorage
        localStorage.setItem('calculatedPriorityTasks', JSON.stringify(priorityTasks));
        
        // Update the display
        displayTasks();
        
        // Show skip message
        const notification = document.createElement('div');
        notification.className = 'skip-notification';
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <i class="bi bi-skip-forward-fill" style="font-size: 1.2rem;"></i>
                <div>
                    <strong>Task Skipped</strong>
                    <div>${firstTask.title}</div>
                </div>
            </div>
        `;
        notification.style.position = 'fixed';
        notification.style.bottom = '80px';
        notification.style.right = '20px';
        notification.style.backgroundColor = 'var(--card-bg)';
        notification.style.color = 'var(--text-color)';
        notification.style.padding = '12px 15px';
        notification.style.borderRadius = '5px';
        notification.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
        notification.style.zIndex = '1000';
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s ease';
        
        document.body.appendChild(notification);
        
        // Fade in and out
        setTimeout(() => { notification.style.opacity = '1'; }, 10);
        setTimeout(() => { notification.style.opacity = '0'; }, 2000);
        setTimeout(() => { document.body.removeChild(notification); }, 2500);
        
    } catch (error) {
        console.error('Error in skipTask:', error);
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

// Add a button to manually force sync
function setupSyncButton() {
    // Create a button to force sync
    const syncButton = document.createElement('button');
    syncButton.className = 'sync-button';
    syncButton.innerHTML = '🔄 Force Sync';
    syncButton.style.position = 'fixed';
    syncButton.style.bottom = '20px';
    syncButton.style.right = '20px';
    syncButton.style.padding = '10px 15px';
    syncButton.style.backgroundColor = '#ff4081';
    syncButton.style.color = 'white';
    syncButton.style.border = 'none';
    syncButton.style.borderRadius = '5px';
    syncButton.style.cursor = 'pointer';
    syncButton.style.zIndex = '1000';
    syncButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    
    // Add click handler
    syncButton.addEventListener('click', async () => {
        if (window.prioritySyncFix) {
            syncButton.innerHTML = '⏳ Syncing...';
            syncButton.disabled = true;
            
            const result = await window.prioritySyncFix.forceSyncPriorityTasks();
            
            if (result.success) {
                syncButton.innerHTML = '✅ Synced!';
                setTimeout(() => {
                    syncButton.innerHTML = '🔄 Force Sync';
                    syncButton.disabled = false;
                    // Reload the page to show updated tasks
                    location.reload();
                }, 1500);
            } else {
                syncButton.innerHTML = '❌ Failed!';
                setTimeout(() => {
                    syncButton.innerHTML = '🔄 Force Sync';
                    syncButton.disabled = false;
                }, 1500);
            }
        } else {
            alert('Priority Sync Fix not loaded yet. Please try again in a moment.');
        }
    });
    
    // Add to page
    document.body.appendChild(syncButton);
}

// Setup profile icon scroll behavior
function setupProfileIconBehavior() {
    let lastScrollTop = 0;
    const profileIcon = document.querySelector('.profile-icon');
    
    if (!profileIcon) return;

    window.addEventListener('scroll', () => {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

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
    if (window.pageYOffset < 100) {
        profileIcon.classList.add('visible');
    }
}

// Initialize the page
function initializePage() {
    // Check theme preference
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-theme');
    }
    
    // Initial display of tasks
    displayTasks();
    
    // Setup profile icon behavior
    setupProfileIconBehavior();
    
    // Setup sync button
    setupSyncButton();
    
    // Update when storage changes
    window.addEventListener('storage', function(e) {
        if (e.key === 'calculatedPriorityTasks') {
            displayTasks();
        }
    });
}

// Export functions to make them available globally
window.getAllTasks = getAllTasks;
window.formatDate = formatDate;
window.getDueDateClass = getDueDateClass;
window.formatGroupDate = formatGroupDate;
window.generateSubtasks = generateSubtasks;
window.toggleSubtasks = toggleSubtasks;
window.toggleSubtaskComplete = toggleSubtaskComplete;
window.loadCompletionStatus = loadCompletionStatus;
window.displayTasks = displayTasks;
window.groupTasksByInterleaveDate = groupTasksByInterleaveDate;
window.navigateTask = navigateTask;
window.completeTask = completeTask;
window.skipTask = skipTask;
window.interleaveTask = interleaveTask;

// Initialize when the document is ready
document.addEventListener('DOMContentLoaded', initializePage);

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
    initializePage
};
