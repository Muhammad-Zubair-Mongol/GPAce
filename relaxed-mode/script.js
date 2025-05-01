// Store tasks in localStorage with a unique key for relaxed mode
const STORAGE_KEY = 'relaxed_mode_tasks';
const PROJECT_ID = 'relaxed_mode'; // Project ID for Firestore

// Initialize tasks from localStorage initially
let tasks = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

// Load tasks from Firestore if available
async function loadTasksFromFirestore() {
    // Check if Firestore functions are available
    if (typeof window.loadTasksFromFirestore === 'function') {
        try {
            const firestoreTasks = await window.loadTasksFromFirestore(PROJECT_ID);
            if (firestoreTasks && firestoreTasks.length > 0) {
                console.log('Loaded relaxed mode tasks from Firestore:', firestoreTasks.length);
                tasks = firestoreTasks;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
                renderTasks();
                return true;
            }
        } catch (error) {
            console.error('Error loading relaxed mode tasks from Firestore:', error);
        }
    }
    return false;
}

// Show the add task form
function showAddTaskForm() {
    document.getElementById('taskForm').style.display = 'block';
}

// Hide the add task form
function hideAddTaskForm() {
    document.getElementById('taskForm').style.display = 'none';
    // Clear form fields
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDescription').value = '';
    document.getElementById('dueDate').value = '';
    document.getElementById('priority').value = 'low';
}

// Save a new task
async function saveTask() {
    const title = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const dueDate = document.getElementById('dueDate').value;
    const priority = document.getElementById('priority').value;

    if (!title) {
        alert('Please enter an activity title');
        return;
    }

    const task = {
        id: Date.now(),
        title,
        description,
        dueDate,
        priority,
        createdAt: new Date().toISOString(),
        completed: false
    };

    tasks.push(task);
    await saveTasks();
    hideAddTaskForm();
    renderTasks();
}

// Save tasks to localStorage and Firestore
async function saveTasks() {
    // Always save to localStorage for offline access
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    
    // Save to Firestore if available
    if (typeof window.saveTasksToFirestore === 'function') {
        try {
            await window.saveTasksToFirestore(PROJECT_ID, tasks);
            console.log('Saved relaxed mode tasks to Firestore');
        } catch (error) {
            console.error('Error saving relaxed mode tasks to Firestore:', error);
        }
    }
}

// Delete a task
async function deleteTask(taskId) {
    tasks = tasks.filter(task => task.id !== taskId);
    await saveTasks();
    renderTasks();
}

// Edit a task
async function editTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    // Populate the form with task data
    document.getElementById('taskTitle').value = task.title;
    document.getElementById('taskDescription').value = task.description || '';
    document.getElementById('dueDate').value = task.dueDate || '';
    document.getElementById('priority').value = task.priority;
    
    // Show the form
    showAddTaskForm();
    
    // Change the save button to update
    const saveBtn = document.querySelector('.save-btn');
    saveBtn.innerHTML = '<i class="bi bi-check-circle"></i> Update Activity';
    saveBtn.onclick = async function() {
        // Update task with new values
        task.title = document.getElementById('taskTitle').value.trim();
        task.description = document.getElementById('taskDescription').value.trim();
        task.dueDate = document.getElementById('dueDate').value;
        task.priority = document.getElementById('priority').value;
        
        await saveTasks();
        renderTasks();
        hideAddTaskForm();
        
        // Reset the save button
        saveBtn.innerHTML = '<i class="bi bi-check-circle"></i> Save Activity';
        saveBtn.onclick = saveTask;
    };
}

// Toggle task completion
async function toggleTaskCompletion(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        task.completed = !task.completed;
        await saveTasks();
        renderTasks();
        
        // If task is completed, also save to completed tasks in Firestore
        if (task.completed && typeof window.saveCompletedTaskToFirestore === 'function') {
            try {
                const completedTask = { ...task, completedAt: new Date().toISOString() };
                await window.saveCompletedTaskToFirestore(PROJECT_ID, completedTask);
                console.log('Saved completed relaxed mode task to Firestore');
            } catch (error) {
                console.error('Error saving completed relaxed mode task to Firestore:', error);
            }
        }
    }
}

// Format date for display
function formatDate(dateString) {
    if (!dateString) return 'No due date';
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateString).toLocaleDateString(undefined, options);
}

// Render tasks to the DOM
function renderTasks() {
    const tasksList = document.getElementById('tasksList');
    tasksList.innerHTML = '';
    
    if (tasks.length === 0) {
        tasksList.innerHTML = '<p class="no-tasks"><i class="bi bi-clipboard"></i> No activities yet. Add some to get started!</p>';
        return;
    }
    
    // Sort tasks by creation date (newest first)
    const sortedTasks = [...tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    sortedTasks.forEach(task => {
        const taskElement = document.createElement('div');
        taskElement.className = `task-item ${task.completed ? 'completed' : ''}`;
        taskElement.dataset.id = task.id;
        
        const taskHeader = document.createElement('div');
        taskHeader.className = 'task-header';
        
        const taskTitle = document.createElement('h3');
        taskTitle.className = 'task-title';
        taskTitle.textContent = task.title;
        
        const taskActions = document.createElement('div');
        taskActions.className = 'task-actions';
        
        const completeBtn = document.createElement('button');
        completeBtn.className = 'action-btn complete';
        completeBtn.innerHTML = task.completed ? '<i class="bi bi-arrow-counterclockwise"></i> Uncomplete' : '<i class="bi bi-check2-circle"></i> Complete';
        completeBtn.onclick = () => toggleTaskCompletion(task.id);
        
        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn edit';
        editBtn.innerHTML = '<i class="bi bi-pencil"></i> Edit';
        editBtn.onclick = () => editTask(task.id);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-btn delete';
        deleteBtn.innerHTML = '<i class="bi bi-trash"></i> Delete';
        deleteBtn.onclick = () => deleteTask(task.id);
        
        taskActions.appendChild(completeBtn);
        taskActions.appendChild(editBtn);
        taskActions.appendChild(deleteBtn);
        
        taskHeader.appendChild(taskTitle);
        taskHeader.appendChild(taskActions);
        
        const taskDescription = document.createElement('p');
        taskDescription.className = 'task-description';
        taskDescription.textContent = task.description || 'No description provided';
        
        const taskMeta = document.createElement('div');
        taskMeta.className = 'task-meta';
        
        const taskDate = document.createElement('span');
        taskDate.className = 'task-date';
        taskDate.innerHTML = task.dueDate ? `<i class="bi bi-calendar-event"></i> Due: ${formatDate(task.dueDate)}` : '<i class="bi bi-calendar"></i> No due date';
        
        const priorityBadge = document.createElement('span');
        priorityBadge.className = `priority-badge priority-${task.priority}`;
        
        // Set priority text with icon based on priority level
        let priorityIcon = '';
        if (task.priority === 'high') {
            priorityIcon = '<i class="bi bi-exclamation-circle"></i>';
        } else if (task.priority === 'medium') {
            priorityIcon = '<i class="bi bi-dash-circle"></i>';
        } else {
            priorityIcon = '<i class="bi bi-arrow-down-circle"></i>';
        }
        
        priorityBadge.innerHTML = `${priorityIcon} ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}`;
        
        taskMeta.appendChild(taskDate);
        taskMeta.appendChild(priorityBadge);
        
        taskElement.appendChild(taskHeader);
        taskElement.appendChild(taskDescription);
        taskElement.appendChild(taskMeta);
        
        tasksList.appendChild(taskElement);
    });
}

// Quick Add Task Functions
function openQuickAddModal() {
    document.getElementById('quickAddModal').classList.add('active');
    document.getElementById('quickTaskTitle').focus();
}

function closeQuickAddModal() {
    document.getElementById('quickAddModal').classList.remove('active');
    document.getElementById('quickTaskTitle').value = '';
    document.getElementById('quickPriority').value = 'low';
}

async function quickSaveTask() {
    const title = document.getElementById('quickTaskTitle').value.trim();
    const priority = document.getElementById('quickPriority').value;
    
    if (!title) {
        alert('Please enter an activity title');
        return;
    }
    
    const task = {
        id: Date.now(),
        title,
        description: '',  // Empty description for quick tasks
        dueDate: '',      // No due date for quick tasks
        priority,
        createdAt: new Date().toISOString(),
        completed: false
    };
    
    tasks.push(task);
    await saveTasks();
    closeQuickAddModal();
    renderTasks();
}

// Initialize the page
document.addEventListener('DOMContentLoaded', async () => {
    // Try to load tasks from Firestore first
    const loaded = await loadTasksFromFirestore();
    if (!loaded) {
        // Fall back to localStorage if Firestore loading failed
        renderTasks();
    }
    
    // Quick Add Task Event Listeners
    document.getElementById('quickAddBtn').addEventListener('click', openQuickAddModal);
    document.getElementById('quickAddClose').addEventListener('click', closeQuickAddModal);
    document.getElementById('quickCancelBtn').addEventListener('click', closeQuickAddModal);
    document.getElementById('quickSaveBtn').addEventListener('click', quickSaveTask);
    
    // Close modal when clicking outside the form
    document.getElementById('quickAddModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('quickAddModal')) {
            closeQuickAddModal();
        }
    });
    
    // Allow pressing Enter to save the quick task
    document.getElementById('quickTaskTitle').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            quickSaveTask();
        }
    });
});