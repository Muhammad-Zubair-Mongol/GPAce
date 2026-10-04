// Store tasks in localStorage with a unique key for relaxed mode
const STORAGE_KEY = 'relaxed_mode_tasks';
const PROJECT_ID = 'relaxed_mode'; // Project ID for Firestore

// Current filter
let currentCategoryFilter = 'all';

// Category display names and icons
const CATEGORY_INFO = {
    sports: { icon: '🏃', label: 'Sports' },
    music: { icon: '🎵', label: 'Music' },
    arts: { icon: '🎨', label: 'Arts' },
    clubs: { icon: '📚', label: 'Clubs' },
    volunteering: { icon: '🤝', label: 'Volunteering' },
    other: { icon: '✨', label: 'Other' }
};

// Initialize tasks from localStorage initially
let tasks = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

// ============================================
// API KEY LOADING FROM SECURE STORAGE
// ============================================
// Load API keys from SecureStorage (shared with grind.html)
async function loadApiKeysFromSecureStorage() {
    try {
        // Wait for SecureStorage to be available
        const maxWait = 3000;
        const startTime = Date.now();
        while (!window.getSecureStorage && Date.now() - startTime < maxWait) {
            await new Promise(r => setTimeout(r, 100));
        }

        const secureStorage = window.getSecureStorage?.();
        if (!secureStorage) {
            // This is fine - the HTML module script handles key loading anyway
            console.debug('[Relaxed Mode] SecureStorage not yet available in script.js (keys loaded via HTML module)');
            return;
        }

        // Initialize global apiKeys object
        window.apiKeys = window.apiKeys || {};

        // Load Gemini key(s)
        const geminiKey = await secureStorage.getSecure('geminiApiKey');
        if (geminiKey) {
            window.apiKeys.gemini = geminiKey;
            console.log('[Relaxed Mode] Gemini API key loaded from SecureStorage');
        }

        // Load backup keys
        const geminiKey2 = await secureStorage.getSecure('geminiApiKey2');
        const geminiKey3 = await secureStorage.getSecure('geminiApiKey3');
        if (geminiKey2) window.apiKeys.gemini2 = geminiKey2;
        if (geminiKey3) window.apiKeys.gemini3 = geminiKey3;

    } catch (error) {
        console.error('[Relaxed Mode] Error loading API keys:', error);
    }
}

// Load API keys on script init
loadApiKeysFromSecureStorage();

// Load tasks from Firestore if available
async function loadTasksFromFirestoreInternal() {
    console.log('[Auto-Sync] loadTasksFromFirestoreInternal called');

    // Check if Firestore global function is available (set by module in index.html)
    const firestoreLoadFn = window._firestoreLoadTasksFn;

    if (typeof firestoreLoadFn !== 'function') {
        console.log('[Auto-Sync] ❌ window._firestoreLoadTasksFn is not available yet');
        console.log('[Auto-Sync] Available functions:', {
            saveTasksToFirestore: typeof window.saveTasksToFirestore,
            _firestoreLoadTasksFn: typeof window._firestoreLoadTasksFn
        });
        return false;
    }

    console.log('[Auto-Sync] ✓ Firestore function available, calling...');

    try {
        const firestoreTasks = await firestoreLoadFn(PROJECT_ID);
        console.log('[Auto-Sync] Firestore returned:', firestoreTasks);

        if (firestoreTasks && firestoreTasks.length > 0) {
            console.log('[Auto-Sync] ✅ Loaded', firestoreTasks.length, 'tasks from Firestore');
            tasks = firestoreTasks;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
            renderTasks();
            showSyncIndicator('synced');
            return true;
        } else {
            console.log('[Auto-Sync] Firestore returned empty or null:', firestoreTasks);
        }
    } catch (error) {
        console.error('[Auto-Sync] ❌ Error loading from Firestore:', error);
        showSyncIndicator('error');
    }

    return false;
}

// Automatic sync on auth state change
function setupAutoSync() {
    // Wait for Firebase auth to be available
    const checkAuth = setInterval(() => {
        if (window.auth) {
            clearInterval(checkAuth);
            console.log('[Auto-Sync] Firebase auth available, setting up listeners...');

            // Listen for auth state changes
            window.auth.onAuthStateChanged(async (user) => {
                if (user) {
                    console.log('[Auto-Sync] User signed in:', user.email);
                    showSyncIndicator('syncing');

                    // Wait a moment for Firestore functions to be ready
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Auto-pull from Firestore on sign in
                    const loaded = await loadTasksFromFirestoreInternal();

                    if (loaded) {
                        console.log('[Auto-Sync] ✅ Tasks loaded from cloud');
                        // Force re-render to make sure UI updates
                        setTimeout(() => {
                            renderTasks();
                            console.log('[Auto-Sync] UI refreshed with', tasks.length, 'tasks');
                        }, 100);
                    } else {
                        // No cloud data, push local to cloud
                        const localTasks = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
                        if (localTasks.length > 0 && typeof window.saveTasksToFirestore === 'function') {
                            console.log('[Auto-Sync] Pushing local tasks to cloud...');
                            await window.saveTasksToFirestore(PROJECT_ID, localTasks);
                        }
                    }
                    showSyncIndicator('synced');

                    // Setup real-time listener for cross-device sync
                    setupRealtimeListener(user.uid);
                } else {
                    console.log('[Auto-Sync] User signed out, using local storage only');
                    showSyncIndicator('offline');
                }
            });
        }
    }, 100);

    // Timeout after 5 seconds
    setTimeout(() => clearInterval(checkAuth), 5000);
}

// Real-time listener for cross-device sync
function setupRealtimeListener(userId) {
    if (!window.db) return;

    try {
        // Use Firestore's onSnapshot for real-time updates
        const { doc, onSnapshot } = window.firestoreImports || {};
        if (!doc || !onSnapshot) {
            console.log('[Auto-Sync] Firestore real-time imports not available');
            return;
        }

        const taskRef = doc(window.db, 'users', userId, 'tasks', PROJECT_ID);

        onSnapshot(taskRef, (docSnapshot) => {
            if (docSnapshot.exists()) {
                const data = docSnapshot.data();
                const cloudTasks = data.tasks || [];
                const cloudVersion = data.version || 0;
                const localVersion = parseInt(localStorage.getItem(`tasks-${PROJECT_ID}-version`) || '0');

                // Only update if cloud is newer
                if (cloudVersion > localVersion) {
                    console.log('[Auto-Sync] Cloud has newer data, updating local...', cloudVersion, '>', localVersion);
                    tasks = cloudTasks;
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
                    localStorage.setItem(`tasks-${PROJECT_ID}-version`, cloudVersion);
                    renderTasks();
                    showSyncIndicator('synced');
                }
            }
        }, (error) => {
            console.error('[Auto-Sync] Real-time listener error:', error);
        });

        console.log('[Auto-Sync] Real-time listener active');
    } catch (error) {
        console.error('[Auto-Sync] Failed to setup real-time listener:', error);
    }
}

// Show sync status indicator
function showSyncIndicator(status) {
    const syncIcon = document.getElementById('syncIcon');
    const syncBtn = document.getElementById('syncTasksBtn');
    if (!syncIcon || !syncBtn) return;

    syncIcon.classList.remove('sync-spinning');

    switch (status) {
        case 'syncing':
            syncIcon.classList.add('sync-spinning');
            syncBtn.title = 'Syncing...';
            break;
        case 'synced':
            syncBtn.title = 'Synced ✓';
            syncIcon.style.color = '#22c55e';
            setTimeout(() => syncIcon.style.color = '', 2000);
            break;
        case 'offline':
            syncBtn.title = 'Offline (not signed in)';
            break;
        case 'error':
            syncBtn.title = 'Sync error';
            syncIcon.style.color = '#ef4444';
            break;
    }
}

// Initialize auto-sync
setupAutoSync();

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
    document.getElementById('category').value = '';
}

// Save a new task
async function saveTask() {
    const title = document.getElementById('taskTitle').value.trim();
    const description = document.getElementById('taskDescription').value.trim();
    const dueDate = document.getElementById('dueDate').value;
    const priority = document.getElementById('priority').value;
    const category = document.getElementById('category').value;

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
        category,
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
    document.getElementById('category').value = task.category || '';

    // Show the form
    showAddTaskForm();

    // Change the save button to update
    const saveBtn = document.querySelector('.save-btn');
    saveBtn.innerHTML = '<i class="bi bi-check-circle"></i> Update Activity';
    saveBtn.onclick = async function () {
        // Update task with new values
        task.title = document.getElementById('taskTitle').value.trim();
        task.description = document.getElementById('taskDescription').value.trim();
        task.dueDate = document.getElementById('dueDate').value;
        task.priority = document.getElementById('priority').value;
        task.category = document.getElementById('category').value;

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

// ============================================
// HISTORY MODAL - Completed Tasks
// ============================================

let completedTasks = [];

// Open history modal
async function openHistoryModal() {
    const modal = document.getElementById('historyModal');
    modal.classList.add('active');
    await loadCompletedTasks();
}

// Close history modal
function closeHistoryModal() {
    const modal = document.getElementById('historyModal');
    modal.classList.remove('active');
}

// Load completed tasks from Firestore or localStorage
async function loadCompletedTasks() {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '<div class="history-loading"><i class="bi bi-arrow-repeat sync-spinning"></i><span>Loading history...</span></div>';

    try {
        // Try loading from Firestore first
        const user = window.auth?.currentUser;
        if (user && window.db) {
            const { doc, getDoc } = window.firestoreImports || {};
            if (doc && getDoc) {
                const completedRef = doc(window.db, 'users', user.uid, 'completed-tasks', PROJECT_ID);
                const docSnap = await getDoc(completedRef);
                if (docSnap.exists()) {
                    completedTasks = docSnap.data().tasks || [];
                    console.log('[History] Loaded', completedTasks.length, 'completed tasks from Firestore');
                }
            }
        }

        // Fallback to localStorage
        if (completedTasks.length === 0) {
            const stored = localStorage.getItem(`completed-tasks-${PROJECT_ID}`);
            if (stored) {
                completedTasks = JSON.parse(stored);
                console.log('[History] Loaded', completedTasks.length, 'completed tasks from localStorage');
            }
        }

        renderHistoryList();
        updateHistoryStats();
    } catch (error) {
        console.error('[History] Error loading completed tasks:', error);
        historyList.innerHTML = '<div class="history-empty"><i class="bi bi-exclamation-circle"></i><p>Error loading history</p></div>';
    }
}

// Render the history list
function renderHistoryList() {
    const historyList = document.getElementById('historyList');

    if (completedTasks.length === 0) {
        historyList.innerHTML = `
            <div class="history-empty">
                <i class="bi bi-check-circle"></i>
                <p>No completed activities yet</p>
                <span>Complete activities to see them here</span>
            </div>
        `;
        return;
    }

    // Sort by completion date (newest first)
    const sorted = [...completedTasks].sort((a, b) =>
        new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt)
    );

    // Group by date
    const grouped = {};
    sorted.forEach(task => {
        const date = new Date(task.completedAt || task.createdAt);
        const dateKey = date.toDateString();
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(task);
    });

    let html = '';
    for (const [dateKey, tasks] of Object.entries(grouped)) {
        const relativeDate = getRelativeDateLabel(new Date(dateKey));
        html += `
            <div class="history-date-group">
                <div class="history-date-label">${relativeDate}</div>
                ${tasks.map(task => `
                    <div class="history-item">
                        <div class="history-item-icon">
                            <i class="bi bi-check-circle-fill"></i>
                        </div>
                        <div class="history-item-content">
                            <div class="history-item-title">${task.title}</div>
                            <div class="history-item-meta">
                                ${task.category ? `<span class="history-category">${CATEGORY_INFO[task.category]?.icon || ''} ${CATEGORY_INFO[task.category]?.label || task.category}</span>` : ''}
                                <span class="history-time">${formatTime(task.completedAt || task.createdAt)}</span>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    historyList.innerHTML = html;
}

// Get relative date label
function getRelativeDateLabel(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    const diffDays = Math.floor((today - date) / (1000 * 60 * 60 * 24));
    if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format time
function formatTime(dateString) {
    if (!dateString) return '';
    return new Date(dateString).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Update history stats
function updateHistoryStats() {
    const total = completedTasks.length;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const thisWeek = completedTasks.filter(t => new Date(t.completedAt || t.createdAt) >= weekAgo).length;
    const thisMonth = completedTasks.filter(t => new Date(t.completedAt || t.createdAt) >= monthAgo).length;

    document.getElementById('totalCompletedCount').textContent = total;
    document.getElementById('thisWeekCount').textContent = thisWeek;
    document.getElementById('thisMonthCount').textContent = thisMonth;
}

// Clear history
async function clearHistory() {
    if (!confirm('Are you sure you want to clear all completed task history? This cannot be undone.')) return;

    try {
        // Clear from localStorage
        localStorage.removeItem(`completed-tasks-${PROJECT_ID}`);

        // Clear from Firestore if signed in
        const user = window.auth?.currentUser;
        if (user && window.db) {
            const { doc, deleteDoc } = window.firestoreImports || {};
            if (doc && deleteDoc) {
                const completedRef = doc(window.db, 'users', user.uid, 'completed-tasks', PROJECT_ID);
                await deleteDoc(completedRef);
            }
        }

        completedTasks = [];
        renderHistoryList();
        updateHistoryStats();
        showToast('History cleared', 'success');
    } catch (error) {
        console.error('[History] Error clearing history:', error);
        showToast('Failed to clear history', 'error');
    }
}

// Make functions globally available
window.openHistoryModal = openHistoryModal;
window.closeHistoryModal = closeHistoryModal;
window.clearHistory = clearHistory;


function renderTasks() {
    const tasksList = document.getElementById('tasksList');
    tasksList.innerHTML = '';

    // Filter tasks by category
    let filteredTasks = tasks; // Show all, let CSS handle completed state if needed, or filter here. User didn't say hide completed, but previous code did. Keeping previous behavior of hiding completed by default unless they want to see them? Previous code: "let filteredTasks = tasks.filter(t => !t.completed);"
    // Actually, user mentions "[Complete checkbox]" which implies we can complete it there. If it disappears immediately, that's standard.
    // User didn't explicitly say "show completed", so I'll stick to hiding them OR simpler: show them but styled differently. 
    // Given "Masonry grids are for Pinterest, not task management", a list view might be better, but they said "Make every card exactly the same height... OR switch to a proper list view". I'll stick to cards for now as requested.

    filteredTasks = tasks.filter(t => !t.completed); // Maintain existing behavior

    if (currentCategoryFilter !== 'all') {
        filteredTasks = filteredTasks.filter(t => t.category === currentCategoryFilter);
    }

    if (filteredTasks.length === 0) {
        const emptyMsg = currentCategoryFilter === 'all'
            ? 'No Activities Yet!'
            : `No ${CATEGORY_INFO[currentCategoryFilter]?.label || 'activities'} found`;

        // User requested Empty State: Big centered illustration + "No activities yet. Create your first one!"
        tasksList.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-clipboard-data" aria-hidden="true" style="font-size: 4rem; color: #00d4ff; margin-bottom: 1rem; opacity: 0.5;"></i>
                    <h3>${emptyMsg}</h3>
                    <p>Create your first one!</p>
                    <button class="add-task-btn" onclick="showAddTaskForm()" style="margin-top: 2rem;">
                        <i class="bi bi-plus-circle"></i> Add New Activity
                    </button>
                </div>`;
        return;
    }

    // Sort tasks by creation date (newest first)
    const sortedTasks = [...filteredTasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    sortedTasks.forEach(task => {
        const taskElement = document.createElement('div');
        taskElement.className = `task-item ${task.completed ? 'completed' : ''}`;
        taskElement.dataset.id = task.id;

        // Format Priority
        const priorityLabel = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);

        // Format Date
        const dateStr = task.dueDate ? formatDate(task.dueDate) : "No due date";

        // Description
        const description = task.description || "<em>No description provided</em>";

        // Category Label
        const categoryLabel = task.category && CATEGORY_INFO[task.category] ? CATEGORY_INFO[task.category].label : 'Other';

        taskElement.innerHTML = `
                <div class="task-content">
                    <h3 class="task-title">${task.title}</h3>
                    <p class="task-description">${description}</p>
                </div>
                <div class="task-footer">
                    <div class="footer-info">
                        <span class="category-pill">${categoryLabel}</span>
                        <span class="priority-text">${priorityLabel}</span>
                        <span class="task-date">${dateStr}</span>
                    </div>
                    <div class="footer-actions">
                        <button class="action-btn edit-btn" onclick="editTask(${task.id})" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="action-btn delete-btn" onclick="deleteTask(${task.id})" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                        <div class="checkbox-wrapper" title="Complete">
                            <input type="checkbox" onchange="toggleTaskCompletion(${task.id})" ${task.completed ? 'checked' : ''}>
                        </div>
                    </div>
                </div>
            `;

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
    document.getElementById('quickCategory').value = '';
}

async function quickSaveTask() {
    const title = document.getElementById('quickTaskTitle').value.trim();
    const priority = document.getElementById('quickPriority').value;
    const category = document.getElementById('quickCategory').value;

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
        category,
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
    // Render local tasks immediately for fast UI
    // Auto-sync will update from cloud if signed in
    renderTasks();
    console.log('[Init] Rendered', tasks.length, 'tasks from localStorage');

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

    // Category Filter Button Event Listeners
    document.querySelectorAll('.category-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            document.querySelectorAll('.category-filter-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');

            // Set filter and re-render
            currentCategoryFilter = btn.dataset.category;
            renderTasks();
        });
    });

    // ============================================
    // POP-OUT & SHORTCUT FEATURES
    // ============================================

    // Floating Panel
    const floatingPanel = document.getElementById('floatingPanel');
    const floatingPanelHeader = document.getElementById('floatingPanelHeader');
    const floatingPanelClose = document.getElementById('floatingPanelClose');
    const floatingPanelCollapse = document.getElementById('floatingPanelCollapse');
    const floatingDropZone = document.getElementById('floatingDropZone');

    function toggleFloatingPanel() {
        floatingPanel.classList.toggle('active');
        if (floatingPanel.classList.contains('active')) {
            renderFloatingPanelTasks();
        }
    }

    function renderFloatingPanelTasks() {
        const container = document.getElementById('floatingPanelTasks');
        const topTasks = tasks.filter(t => !t.completed).slice(0, 3);

        if (topTasks.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:var(--relaxed-text-light);padding:10px;">No pending activities</div>';
            return;
        }

        container.innerHTML = topTasks.map(task => `
            <div class="floating-task-item" data-id="${task.id}">
                <div>${task.title}</div>
                ${task.category ? `<div class="task-category">${CATEGORY_INFO[task.category]?.icon || ''} ${CATEGORY_INFO[task.category]?.label || ''}</div>` : ''}
            </div>
        `).join('');
    }

    floatingPanelClose?.addEventListener('click', () => floatingPanel.classList.remove('active'));
    floatingPanelCollapse?.addEventListener('click', () => floatingPanel.classList.toggle('collapsed'));

    // Make floating panel draggable
    let isDragging = false;
    let dragOffsetX, dragOffsetY;

    floatingPanelHeader?.addEventListener('mousedown', (e) => {
        isDragging = true;
        const rect = floatingPanel.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        floatingPanel.style.transition = 'none';
        floatingPanel.style.cursor = 'grabbing';
        e.preventDefault(); // Prevent text selection while dragging
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const newLeft = e.clientX - dragOffsetX;
        const newTop = e.clientY - dragOffsetY;

        // Keep panel within viewport bounds
        const maxX = window.innerWidth - floatingPanel.offsetWidth;
        const maxY = window.innerHeight - floatingPanel.offsetHeight;

        floatingPanel.style.left = Math.max(0, Math.min(newLeft, maxX)) + 'px';
        floatingPanel.style.top = Math.max(0, Math.min(newTop, maxY)) + 'px';
        floatingPanel.style.right = 'auto'; // Remove right positioning
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            floatingPanel.style.transition = '';
            floatingPanel.style.cursor = '';
        }
    });

    // Drop Zone for drag-drop text
    floatingDropZone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        floatingDropZone.classList.add('drag-over');
    });

    floatingDropZone?.addEventListener('dragleave', () => {
        floatingDropZone.classList.remove('drag-over');
    });

    floatingDropZone?.addEventListener('drop', async (e) => {
        e.preventDefault();
        floatingDropZone.classList.remove('drag-over');
        const text = e.dataTransfer.getData('text/plain');
        if (text) {
            const task = {
                id: Date.now(),
                title: text.substring(0, 100),
                description: text.length > 100 ? text : '',
                dueDate: '',
                priority: 'medium',
                category: '',
                createdAt: new Date().toISOString(),
                completed: false
            };
            tasks.push(task);
            await saveTasks();
            renderTasks();
            renderFloatingPanelTasks();
        }
    });

    // Shortcuts Modal
    const shortcutsModal = document.getElementById('shortcutsModal');
    const shortcutsHelpBtn = document.getElementById('shortcutsHelpBtn');
    const shortcutsModalClose = document.getElementById('shortcutsModalClose');

    function openShortcutsModal() {
        shortcutsModal.classList.add('active');
    }

    function closeShortcutsModal() {
        shortcutsModal.classList.remove('active');
    }

    shortcutsHelpBtn?.addEventListener('click', openShortcutsModal);
    shortcutsModalClose?.addEventListener('click', closeShortcutsModal);
    shortcutsModal?.addEventListener('click', (e) => {
        if (e.target === shortcutsModal) closeShortcutsModal();
    });

    // Search Modal
    const searchModal = document.getElementById('searchModal');
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');

    function openSearchModal() {
        searchModal.classList.add('active');
        searchInput.focus();
    }

    function closeSearchModal() {
        searchModal.classList.remove('active');
        searchInput.value = '';
        searchResults.innerHTML = '';
    }

    function performSearch(query) {
        if (!query.trim()) {
            searchResults.innerHTML = '';
            return;
        }

        const matches = tasks.filter(t =>
            t.title.toLowerCase().includes(query.toLowerCase()) ||
            (t.description && t.description.toLowerCase().includes(query.toLowerCase()))
        );

        if (matches.length === 0) {
            searchResults.innerHTML = '<div class="search-no-results">No activities found</div>';
            return;
        }

        searchResults.innerHTML = matches.map(task => `
            <div class="search-result-item" data-id="${task.id}">
                <strong>${task.title}</strong>
                ${task.category ? `<span style="margin-left:8px;opacity:0.7">${CATEGORY_INFO[task.category]?.icon || ''}</span>` : ''}
            </div>
        `).join('');
    }

    searchInput?.addEventListener('input', (e) => performSearch(e.target.value));
    searchModal?.addEventListener('click', (e) => {
        if (e.target === searchModal) closeSearchModal();
    });

    // Pop-Out Window
    const popOutBtn = document.getElementById('popOutBtn');
    popOutBtn?.addEventListener('click', () => {
        window.open(window.location.href, 'relaxed_popup', 'width=400,height=600,resizable=yes,scrollbars=yes');
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // Ignore if typing in input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            if (e.key === 'Escape') {
                closeQuickAddModal();
                closeSearchModal();
                closeShortcutsModal();
            }
            return;
        }

        // Ctrl+Shift+A - Quick Add
        if (e.ctrlKey && e.shiftKey && e.key === 'A') {
            e.preventDefault();
            openQuickAddModal();
        }

        // Ctrl+Shift+P - Toggle Floating Panel
        if (e.ctrlKey && e.shiftKey && e.key === 'P') {
            e.preventDefault();
            toggleFloatingPanel();
        }

        // Ctrl+Shift+W - Pop-out Window
        if (e.ctrlKey && e.shiftKey && e.key === 'W') {
            e.preventDefault();
            window.open(window.location.href, 'relaxed_popup', 'width=400,height=600,resizable=yes,scrollbars=yes');
        }

        // Ctrl+Shift+B - Brain Dump
        if (e.ctrlKey && e.shiftKey && e.key === 'B') {
            e.preventDefault();
            toggleFloatingPanel();
            document.getElementById('brainDumpInput')?.focus();
        }

        // Ctrl+/ - Search
        if (e.ctrlKey && e.key === '/') {
            e.preventDefault();
            openSearchModal();
        }

        // ? - Show shortcuts help
        if (e.key === '?') {
            e.preventDefault();
            openShortcutsModal();
        }

        // Escape - Close modals
        if (e.key === 'Escape') {
            closeQuickAddModal();
            closeSearchModal();
            closeShortcutsModal();
            closeBrainDumpModal();
            floatingPanel.classList.remove('active');
        }
    });

    // ============================================
    // BRAIN DUMP FEATURE
    // ============================================

    const brainDumpInput = document.getElementById('brainDumpInput');
    const brainDumpBtn = document.getElementById('brainDumpBtn');
    const brainDumpModal = document.getElementById('brainDumpModal');
    const brainDumpStatus = document.getElementById('brainDumpStatus');
    const brainDumpResults = document.getElementById('brainDumpResults');
    const brainDumpActions = document.getElementById('brainDumpActions');
    const brainDumpModalClose = document.getElementById('brainDumpModalClose');
    const brainDumpCancel = document.getElementById('brainDumpCancel');
    const brainDumpSave = document.getElementById('brainDumpSave');

    let brainDumpCandidates = [];

    // ============================================
    // SPEECH-TO-TEXT FOR BRAIN DUMP (WebSpeech API)
    // ============================================
    let speechRecognition = null;
    let isListening = false;

    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('[Speech] WebSpeech API not supported');
            return null;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true; // Keep listening
        recognition.interimResults = true; // Show interim results
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isListening = true;
            updateMicButton(true);
            console.log('[Speech] Listening started');
        };

        recognition.onend = () => {
            console.log('[Speech] Recognition ended');
            // Don't auto-restart - this causes 'aborted' errors
            // User can click mic again to restart
            isListening = false;
            updateMicButton(false);
            const interimDiv = document.getElementById('brainDumpInterim');
            if (interimDiv) interimDiv.style.display = 'none';
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                } else {
                    interimTranscript += transcript;
                }
            }

            // Show interim transcript in real-time display
            const interimDiv = document.getElementById('brainDumpInterim');
            const interimText = document.getElementById('brainDumpInterimText');
            if (interimTranscript && interimDiv && interimText) {
                interimDiv.style.display = 'flex';
                interimText.textContent = interimTranscript;
            }

            // Append final transcript to the input
            if (finalTranscript) {
                brainDumpInput.value += finalTranscript;
                // Clear interim after adding final
                if (interimDiv) interimDiv.style.display = 'none';
            }
        };

        recognition.onerror = (event) => {
            // Don't log 'aborted' errors - they happen normally when stopping/restarting recognition
            if (event.error !== 'aborted') {
                console.error('[Speech] Error:', event.error);
            }
            const interimDiv = document.getElementById('brainDumpInterim');
            const interimText = document.getElementById('brainDumpInterimText');

            switch (event.error) {
                case 'no-speech':
                    // User didn't say anything, keep listening
                    if (interimText) interimText.textContent = 'No speech detected, still listening...';
                    break;
                case 'audio-capture':
                    // Microphone not available
                    showToast('Microphone not available. Check your mic connection.', 'error');
                    isListening = false;
                    updateMicButton(false);
                    break;
                case 'not-allowed':
                    // Permission denied
                    showToast('Microphone permission denied. Please allow mic access.', 'error');
                    isListening = false;
                    updateMicButton(false);
                    break;
                case 'aborted':
                    // Recognition was aborted (usually by clicking too fast or restart)
                    // Just silently stop, don't show error
                    isListening = false;
                    updateMicButton(false);
                    break;
                case 'network':
                    showToast('Network error. Check your internet connection.', 'error');
                    isListening = false;
                    updateMicButton(false);
                    break;
                default:
                    showToast(`Speech error: ${event.error}`, 'error');
                    isListening = false;
                    updateMicButton(false);
            }
        };

        return recognition;
    }

    function updateMicButton(active) {
        const micBtn = document.getElementById('brainDumpMicBtn');
        const interimDiv = document.getElementById('brainDumpInterim');

        if (micBtn) {
            micBtn.classList.toggle('active', active);
            micBtn.innerHTML = active
                ? '<i class="bi bi-mic-fill" style="color: #e74c3c;"></i>'
                : '<i class="bi bi-mic"></i>';
            micBtn.title = active ? 'Stop listening' : 'Start voice input';
        }

        // Hide interim display when not listening
        if (!active && interimDiv) {
            interimDiv.style.display = 'none';
        }
    }

    function toggleSpeechRecognition() {
        const micBtn = document.getElementById('brainDumpMicBtn');

        // Prevent rapid clicks
        if (micBtn && micBtn.disabled) return;
        if (micBtn) micBtn.disabled = true;
        setTimeout(() => { if (micBtn) micBtn.disabled = false; }, 500);

        if (!speechRecognition) {
            speechRecognition = initSpeechRecognition();
            if (!speechRecognition) {
                showToast('Speech recognition not supported in this browser', 'error');
                return;
            }
        }

        const interimDiv = document.getElementById('brainDumpInterim');
        const interimText = document.getElementById('brainDumpInterimText');

        if (isListening) {
            // Stop
            isListening = false;
            try {
                speechRecognition.stop();
            } catch (e) {
                // Already stopped
            }
            updateMicButton(false);
            if (interimDiv) interimDiv.style.display = 'none';
        } else {
            // Start - First request microphone permission explicitly
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    // Permission granted, stop the stream (we just needed permission)
                    stream.getTracks().forEach(track => track.stop());

                    try {
                        isListening = true;
                        speechRecognition.start();
                        // Show "Listening..." indicator
                        if (interimDiv && interimText) {
                            interimText.textContent = 'Listening...';
                            interimDiv.style.display = 'flex';
                        }
                        updateMicButton(true);
                    } catch (e) {
                        console.error('[Speech] Start error:', e);
                        if (e.message && e.message.includes('already started')) {
                            // Already running, try to stop and restart
                            speechRecognition.stop();
                            setTimeout(() => {
                                try {
                                    speechRecognition.start();
                                    isListening = true;
                                    updateMicButton(true);
                                } catch (e2) {
                                    showToast('Could not start speech recognition', 'error');
                                    isListening = false;
                                }
                            }, 200);
                        } else {
                            showToast('Could not start speech recognition', 'error');
                            isListening = false;
                        }
                        if (interimDiv) interimDiv.style.display = 'none';
                    }
                })
                .catch(err => {
                    console.error('[Speech] Mic permission error:', err);
                    showToast('Microphone permission denied. Please allow mic access in browser settings.', 'error');
                    isListening = false;
                    updateMicButton(false);
                });
        }
    }

    // Wire up the mic button (HTML button exists, no injection needed)
    const micBtn = document.getElementById('brainDumpMicBtn');
    if (micBtn) {
        micBtn.addEventListener('click', toggleSpeechRecognition);
    }

    function openBrainDumpModal() {
        brainDumpModal.classList.add('active');
        brainDumpStatus.style.display = 'block';
        brainDumpResults.innerHTML = '';
        brainDumpActions.style.display = 'none';
    }

    function closeBrainDumpModal() {
        brainDumpModal.classList.remove('active');
        brainDumpCandidates = [];
    }

    async function processBrainDump() {
        const text = brainDumpInput.value.trim();
        if (!text) {
            alert('Please enter some text to process');
            return;
        }

        openBrainDumpModal();
        brainDumpStatus.innerHTML = '<i class="bi bi-hourglass-split spin"></i> Analyzing with AI...';

        try {
            // Try to use Gemini API if available
            let candidates = [];
            let apiKey = window.apiKeys?.gemini;
            const totalKeys = window.apiKeys?.geminiKeys?.length || 1;
            let attemptsLeft = totalKeys; // Try each key once

            if (apiKey && window.GoogleGenerativeAI) {
                while (attemptsLeft > 0) {
                    try {
                        candidates = await analyzeWithGemini(text, apiKey);
                        console.log('[Brain Dump] AI analysis complete:', candidates.length, 'tasks');
                        break; // Success - exit retry loop
                    } catch (aiError) {
                        // Check if it's a rate limit error (429)
                        if (aiError.message?.includes('429') || aiError.message?.includes('quota')) {
                            console.warn(`[Brain Dump] Rate limit hit, rotating API key...`);
                            attemptsLeft--;

                            if (attemptsLeft > 0 && window.apiKeys?.getNextKey) {
                                apiKey = window.apiKeys.getNextKey();
                                console.log(`[Brain Dump] Retrying with next key (${totalKeys - attemptsLeft + 1}/${totalKeys})`);
                            } else {
                                // All keys exhausted
                                console.warn('[Brain Dump] All API keys rate limited, using fallback parser');
                                candidates = parseTextToTasks(text);
                                showToast('All API keys rate limited. Using basic parser.', 'warning');
                                break;
                            }
                        } else {
                            // Non-rate-limit error, throw it
                            throw aiError;
                        }
                    }
                }
            } else {
                console.log('[Brain Dump] No Gemini API key, using fallback');
                candidates = parseTextToTasks(text);
            }

            brainDumpCandidates = candidates;
            displayBrainDumpResults(candidates);

            // Clear input on success
            brainDumpInput.value = '';
        } catch (error) {
            console.error('Brain dump processing error:', error);
            // Fallback to local processing
            const candidates = parseTextToTasks(text);
            brainDumpCandidates = candidates;
            displayBrainDumpResults(candidates);
        }
    }

    // AI-powered task analysis using Gemini
    async function analyzeWithGemini(text, apiKey) {
        const genAI = new window.GoogleGenerativeAI(apiKey);

        // Use the same model as AI Researcher (synced from settings)
        // StorageAdapter stores values as JSON strings, so we need to parse them
        let savedModel = 'gemini-3.6-flash'; // fallback
        const rawValue = localStorage.getItem('api.geminiModel');
        if (rawValue) {
            try {
                savedModel = JSON.parse(rawValue);
            } catch {
                savedModel = rawValue; // Already a plain string
            }
        }
        // Also check window.apiKeys if available (set by other modules)
        if (window.apiKeys?.geminiModel) {
            savedModel = window.apiKeys.geminiModel;
        }
        console.log(`[Brain Dump] Using Gemini model: ${savedModel}`);
        const model = genAI.getGenerativeModel({ model: savedModel });

        const prompt = `You are a task extraction AI. Analyze this brain dump text and extract structured tasks.

Brain dump text:
"""
${text}
"""

For EACH distinct task you find, provide:
- title: A concise task title (max 80 chars)
- category: One of [sports, music, arts, clubs, volunteering, other]
- priority: One of [high, medium, low] based on urgency words and context
- dueDate: ISO date string (YYYY-MM-DD) if a date is mentioned, otherwise empty string
- importance: Number 1-10 for smart sorting (10 = most important/urgent)

Rules:
- Extract ALL tasks, even implied ones
- Use "high" priority for words like urgent, ASAP, important, today, deadline
- Use "low" priority for words like sometime, maybe, eventually, later
- Parse natural dates: "tomorrow" = tomorrow's date, "next week" = 7 days from now, etc.
- Today's date is ${new Date().toISOString().split('T')[0]}

Return ONLY a valid JSON array, no explanation or markdown:
[{"title":"...","category":"...","priority":"...","dueDate":"","importance":8}, ...]`;

        const result = await model.generateContent(prompt);
        const response = result.response.text();

        // Extract JSON from response (handle potential markdown wrapping)
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            console.warn('[Brain Dump] Could not parse AI response, falling back');
            return parseTextToTasks(text);
        }

        const tasks = JSON.parse(jsonMatch[0]);

        // Sort by importance (AI-suggested)
        tasks.sort((a, b) => (b.importance || 5) - (a.importance || 5));

        return tasks.map((t, i) => ({
            id: `ai_${Date.now()}_${i}`,
            title: t.title || 'Untitled Task',
            description: '',
            category: t.category || 'other',
            priority: t.priority || 'medium',
            dueDate: t.dueDate || '',
            importance: t.importance || 5,
            confidence: 0.9,
            selected: true,
            aiGenerated: true
        }));
    }

    // Simple local task parsing (fallback when AI not available)
    function parseTextToTasks(text) {
        const lines = text.split(/[\n.!?]+/).filter(line => line.trim().length > 3);
        const candidates = [];

        // Expanded category keywords
        const categoryKeywords = {
            sports: ['practice', 'game', 'tryout', 'workout', 'training', 'match', 'basketball', 'soccer', 'football', 'swim', 'run', 'gym', 'fitness', 'exercise', 'competition', 'tournament', 'race', 'track', 'tennis', 'golf', 'volleyball', 'hockey', 'cricket'],
            music: ['piano', 'guitar', 'recital', 'practice', 'lesson', 'band', 'choir', 'concert', 'sing', 'music', 'instrument', 'rehearsal', 'performance', 'orchestra', 'solo', 'recording', 'compose', 'song', 'drum', 'violin'],
            arts: ['draw', 'paint', 'art', 'craft', 'design', 'photography', 'theater', 'drama', 'sculpture', 'creative', 'portfolio', 'exhibition', 'canvas', 'sketch', 'illustration', 'animation', 'film', 'video', 'edit'],
            clubs: ['meeting', 'club', 'debate', 'robotics', 'science', 'math', 'chess', 'committee', 'council', 'organization', 'society', 'group', 'team', 'session', 'workshop', 'seminar', 'conference'],
            volunteering: ['volunteer', 'community', 'help', 'donate', 'charity', 'service', 'nonprofit', 'fundraiser', 'outreach', 'campaign', 'support', 'assist', 'care', 'shelter']
        };

        // Date parsing function
        function parseDate(text) {
            const today = new Date();
            const lowerText = text.toLowerCase();

            if (/\btoday\b/.test(lowerText)) {
                return today.toISOString().split('T')[0];
            }
            if (/\btomorrow\b/.test(lowerText)) {
                const d = new Date(today);
                d.setDate(d.getDate() + 1);
                return d.toISOString().split('T')[0];
            }
            if (/\bnext week\b/.test(lowerText)) {
                const d = new Date(today);
                d.setDate(d.getDate() + 7);
                return d.toISOString().split('T')[0];
            }
            const inDaysMatch = lowerText.match(/\bin\s+(\d+)\s+days?\b/);
            if (inDaysMatch) {
                const d = new Date(today);
                d.setDate(d.getDate() + parseInt(inDaysMatch[1]));
                return d.toISOString().split('T')[0];
            }
            return '';
        }

        lines.forEach((line, index) => {
            const cleanLine = line.trim();
            if (cleanLine.length < 5) return;

            // Determine category
            let category = 'other';
            let maxMatch = 0;
            const lowerLine = cleanLine.toLowerCase();

            for (const [cat, keywords] of Object.entries(categoryKeywords)) {
                const matches = keywords.filter(kw => lowerLine.includes(kw)).length;
                if (matches > maxMatch) {
                    maxMatch = matches;
                    category = cat;
                }
            }

            // Determine priority based on urgency words
            let priority = 'medium';
            if (/urgent|asap|important|today|tomorrow|critical|deadline|must|need to|have to|required/i.test(cleanLine)) {
                priority = 'high';
            } else if (/sometime|maybe|eventually|later|when possible|if time|consider|could|might/i.test(cleanLine)) {
                priority = 'low';
            }

            // Parse due date
            const dueDate = parseDate(cleanLine);

            candidates.push({
                id: `candidate_${Date.now()}_${index}`,
                title: cleanLine.substring(0, 100),
                description: cleanLine.length > 100 ? cleanLine : '',
                category: category,
                priority: priority,
                dueDate: dueDate,
                confidence: Math.min(0.95, 0.6 + (maxMatch * 0.15) + (dueDate ? 0.1 : 0)),
                selected: true
            });
        });

        return candidates;
    }

    function displayBrainDumpResults(candidates) {
        brainDumpStatus.style.display = 'none';

        if (candidates.length === 0) {
            brainDumpResults.innerHTML = '<div class="brain-dump-no-results">No tasks could be extracted. Try adding more detail.</div>';
            brainDumpActions.style.display = 'none';
            return;
        }

        // Check if AI was used
        const isAiPowered = candidates.some(c => c.aiGenerated);
        const aiStatusHtml = isAiPowered
            ? '<div class="brain-dump-ai-status"><i class="bi bi-robot"></i> AI-Powered Analysis (Gemini)</div>'
            : '<div class="brain-dump-ai-status"><i class="bi bi-cpu"></i> Local Analysis (No API Key)</div>';

        // Sorting dropdown
        const sortingHtml = `
            <div class="brain-dump-sort">
                <label>Sort by:</label>
                <select id="brainDumpSort" onchange="sortBrainDumpResults(this.value)">
                    <option value="importance" ${isAiPowered ? 'selected' : ''}>Importance (AI)</option>
                    <option value="priority">Priority</option>
                    <option value="dueDate">Due Date</option>
                    <option value="category">Category</option>
                </select>
            </div>
        `;

        brainDumpResults.innerHTML = aiStatusHtml + sortingHtml + candidates.map(task => {
            const priorityColors = { high: '#e74c3c', medium: '#f39c12', low: '#27ae60' };
            const dueDateText = task.dueDate ? `<span class="brain-dump-due"><i class="bi bi-calendar"></i> ${task.dueDate}</span>` : '';
            const importanceText = task.importance ? `<span class="brain-dump-importance">⭐ ${task.importance}/10</span>` : '';

            return `
            <div class="brain-dump-task-item ${task.aiGenerated ? 'ai-generated' : ''}">
                <input type="checkbox" id="${task.id}" ${task.selected ? 'checked' : ''} 
                    onchange="toggleBrainDumpCandidate('${task.id}')">
                <div class="brain-dump-task-details">
                    <div class="brain-dump-task-title">${task.title}</div>
                    <div class="brain-dump-task-meta">
                        <span>${CATEGORY_INFO[task.category]?.icon || '✨'} ${CATEGORY_INFO[task.category]?.label || 'Other'}</span>
                        <span class="brain-dump-priority" style="background: ${priorityColors[task.priority] || '#888'}">${task.priority}</span>
                        ${dueDateText}
                        ${importanceText}
                    </div>
                </div>
            </div>
        `}).join('');

        brainDumpActions.style.display = 'flex';
    }

    // Smart sorting function
    window.sortBrainDumpResults = function (sortBy) {
        const priorityOrder = { high: 3, medium: 2, low: 1 };

        switch (sortBy) {
            case 'importance':
                brainDumpCandidates.sort((a, b) => (b.importance || 5) - (a.importance || 5));
                break;
            case 'priority':
                brainDumpCandidates.sort((a, b) => (priorityOrder[b.priority] || 2) - (priorityOrder[a.priority] || 2));
                break;
            case 'dueDate':
                brainDumpCandidates.sort((a, b) => {
                    if (!a.dueDate && !b.dueDate) return 0;
                    if (!a.dueDate) return 1;
                    if (!b.dueDate) return -1;
                    return new Date(a.dueDate) - new Date(b.dueDate);
                });
                break;
            case 'category':
                brainDumpCandidates.sort((a, b) => (a.category || '').localeCompare(b.category || ''));
                break;
        }

        displayBrainDumpResults(brainDumpCandidates);
        document.getElementById('brainDumpSort').value = sortBy;
    };

    // Toggle candidate selection
    window.toggleBrainDumpCandidate = function (id) {
        const candidate = brainDumpCandidates.find(c => c.id === id);
        if (candidate) {
            candidate.selected = !candidate.selected;
        }
    };

    // Create selected tasks
    async function createBrainDumpTasks() {
        const selectedTasks = brainDumpCandidates.filter(c => c.selected);

        for (const candidate of selectedTasks) {
            const task = {
                id: Date.now() + Math.random(),
                title: candidate.title,
                description: candidate.description || '',
                dueDate: '',
                priority: candidate.priority,
                category: candidate.category,
                createdAt: new Date().toISOString(),
                completed: false,
                source: 'brain_dump'
            };
            tasks.push(task);
        }

        await saveTasks();
        renderTasks();
        renderFloatingPanelTasks();
        closeBrainDumpModal();

        // Show toast
        showToast(`Created ${selectedTasks.length} task(s) from brain dump!`, 'success');
    }

    // Toast notification
    function showToast(message, type = 'success') {
        const existing = document.querySelector('.brain-dump-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `brain-dump-toast ${type}`;
        toast.innerHTML = `<i class="bi bi-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i> ${message}`;
        toast.style.cssText = `
            position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
            background: ${type === 'success' ? '#27ae60' : '#e74c3c'}; color: white;
            padding: 10px 20px; border-radius: 20px; z-index: 10000;
            display: flex; align-items: center; gap: 8px; font-size: 0.9rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    }

    // Event listeners
    brainDumpBtn?.addEventListener('click', processBrainDump);
    brainDumpModalClose?.addEventListener('click', closeBrainDumpModal);
    brainDumpCancel?.addEventListener('click', closeBrainDumpModal);
    brainDumpSave?.addEventListener('click', createBrainDumpTasks);
    brainDumpModal?.addEventListener('click', (e) => {
        if (e.target === brainDumpModal) closeBrainDumpModal();
    });

    // ============================================
    // SETTINGS & EDITABLE SHORTCUTS
    // ============================================

    const SHORTCUTS_STORAGE_KEY = 'relaxed_mode_shortcuts';
    const APPEARANCE_STORAGE_KEY = 'relaxed_mode_appearance';

    // Default shortcuts
    const DEFAULT_SHORTCUTS = {
        quickAdd: { ctrl: true, shift: true, key: 'A', display: 'Ctrl+Shift+A' },
        togglePanel: { ctrl: true, shift: true, key: 'P', display: 'Ctrl+Shift+P' },
        search: { ctrl: true, shift: false, key: '/', display: 'Ctrl+/' },
        brainDump: { ctrl: true, shift: true, key: 'B', display: 'Ctrl+Shift+B' },
        popOut: { ctrl: true, shift: true, key: 'W', display: 'Ctrl+Shift+W' }
    };

    // Load shortcuts from localStorage
    let customShortcuts = JSON.parse(localStorage.getItem(SHORTCUTS_STORAGE_KEY)) || { ...DEFAULT_SHORTCUTS };

    // Update shortcut display in UI
    function updateShortcutDisplay() {
        document.querySelectorAll('.shortcut-key-btn').forEach(btn => {
            const action = btn.dataset.action;
            if (customShortcuts[action]) {
                btn.querySelector('.shortcut-keys').textContent = customShortcuts[action].display;
            }
        });
    }

    // Settings Modal
    const settingsModal = document.getElementById('settingsModal');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModalClose = document.getElementById('settingsModalClose');

    function openSettingsModal() {
        settingsModal.classList.add('active');
        updateShortcutDisplay();
    }

    function closeSettingsModal() {
        settingsModal.classList.remove('active');
        // Stop any recording
        document.querySelectorAll('.shortcut-key-btn.recording').forEach(btn => {
            btn.classList.remove('recording');
        });
    }

    settingsBtn?.addEventListener('click', openSettingsModal);
    settingsModalClose?.addEventListener('click', closeSettingsModal);
    settingsModal?.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettingsModal();
    });

    // History Modal
    const historyBtn = document.getElementById('historyBtn');
    const historyModal = document.getElementById('historyModal');
    const historyModalClose = document.getElementById('historyModalClose');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');

    historyBtn?.addEventListener('click', openHistoryModal);
    historyModalClose?.addEventListener('click', closeHistoryModal);
    historyModal?.addEventListener('click', (e) => {
        if (e.target === historyModal) closeHistoryModal();
    });
    clearHistoryBtn?.addEventListener('click', clearHistory);

    // Settings Tabs
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`${tab.dataset.tab}-tab`)?.classList.add('active');
        });
    });

    // Shortcut Recording
    let recordingAction = null;

    document.querySelectorAll('.shortcut-key-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Stop previous recording
            document.querySelectorAll('.shortcut-key-btn.recording').forEach(b => {
                b.classList.remove('recording');
            });

            // Start recording this shortcut
            btn.classList.add('recording');
            btn.querySelector('.shortcut-keys').textContent = 'Press keys...';
            recordingAction = btn.dataset.action;
        });
    });

    // Capture new shortcut
    document.addEventListener('keydown', (e) => {
        if (recordingAction) {
            e.preventDefault();
            e.stopPropagation();

            // Build shortcut string
            const parts = [];
            if (e.ctrlKey) parts.push('Ctrl');
            if (e.shiftKey) parts.push('Shift');
            if (e.altKey) parts.push('Alt');

            // Get key name
            let keyName = e.key.toUpperCase();
            if (keyName === ' ') keyName = 'Space';
            if (keyName === '/') keyName = '/';
            if (!['CONTROL', 'SHIFT', 'ALT', 'META'].includes(keyName)) {
                parts.push(keyName);
            }

            if (parts.length > 1 || (parts.length === 1 && !['CTRL', 'SHIFT', 'ALT'].includes(parts[0]))) {
                const display = parts.join('+');

                // Save the new shortcut
                customShortcuts[recordingAction] = {
                    ctrl: e.ctrlKey,
                    shift: e.shiftKey,
                    alt: e.altKey,
                    key: e.key.toUpperCase(),
                    display: display
                };

                localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(customShortcuts));

                // Update display
                const btn = document.querySelector(`.shortcut-key-btn[data-action="${recordingAction}"]`);
                if (btn) {
                    btn.classList.remove('recording');
                    btn.querySelector('.shortcut-keys').textContent = display;
                }

                recordingAction = null;
                showToast('Shortcut saved!', 'success');
            }

            return false;
        }
    }, true);

    // Reset shortcuts
    document.getElementById('resetShortcuts')?.addEventListener('click', () => {
        customShortcuts = { ...DEFAULT_SHORTCUTS };
        localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(customShortcuts));
        updateShortcutDisplay();
        showToast('Shortcuts reset to defaults', 'success');
    });

    // Check if shortcut matches
    function matchesShortcut(e, shortcut) {
        return e.ctrlKey === (shortcut.ctrl || false) &&
            e.shiftKey === (shortcut.shift || false) &&
            e.altKey === (shortcut.alt || false) &&
            e.key.toUpperCase() === shortcut.key.toUpperCase();
    }

    // Global Quick Add Bar
    const globalQuickAdd = document.getElementById('globalQuickAdd');
    const globalQuickInput = document.getElementById('globalQuickInput');

    function openGlobalQuickAdd() {
        globalQuickAdd.classList.add('active');
        globalQuickInput.focus();
    }

    function closeGlobalQuickAdd() {
        globalQuickAdd.classList.remove('active');
        globalQuickInput.value = '';
    }

    globalQuickInput?.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && globalQuickInput.value.trim()) {
            const title = globalQuickInput.value.trim();
            const task = {
                id: Date.now(),
                title: title,
                description: '',
                dueDate: '',
                priority: 'medium',
                category: '',
                createdAt: new Date().toISOString(),
                completed: false
            };
            tasks.push(task);
            await saveTasks();
            renderTasks();
            closeGlobalQuickAdd();
            showToast('Activity added!', 'success');
        }
        if (e.key === 'Escape') {
            closeGlobalQuickAdd();
        }
    });

    // Appearance - Color Theme
    const colorThemes = {
        orange: { primary: '#F39C12', primaryLight: '#FDEBD0', primaryDark: '#D35400', rgb: '243, 156, 18' },
        red: { primary: '#E74C3C', primaryLight: '#FADBD8', primaryDark: '#C0392B', rgb: '231, 76, 60' },
        blue: { primary: '#3498DB', primaryLight: '#D4E6F1', primaryDark: '#2980B9', rgb: '52, 152, 219' },
        green: { primary: '#27AE60', primaryLight: '#D5F5E3', primaryDark: '#1E8449', rgb: '39, 174, 96' },
        purple: { primary: '#9B59B6', primaryLight: '#E8DAEF', primaryDark: '#7D3C98', rgb: '155, 89, 182' }
    };

    function applyColorTheme(color) {
        const theme = colorThemes[color];
        if (!theme) return;

        document.documentElement.style.setProperty('--relaxed-primary', theme.primary);
        document.documentElement.style.setProperty('--relaxed-primary-light', theme.primaryLight);
        document.documentElement.style.setProperty('--relaxed-primary-dark', theme.primaryDark);
        document.documentElement.style.setProperty('--primary-color-rgb', theme.rgb);

        localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ color }));
    }

    // Load saved appearance
    const savedAppearance = JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) || '{}');
    if (savedAppearance.color) {
        applyColorTheme(savedAppearance.color);
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.color === savedAppearance.color);
        });
    }

    // Color button clicks
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyColorTheme(btn.dataset.color);
        });
    });

    // Override keyboard shortcuts with custom ones
    document.removeEventListener('keydown', null); // Clear old listener

    // New unified keyboard handler
    function handleKeyboardShortcuts(e) {
        // Skip if recording or typing
        if (recordingAction) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            if (e.key === 'Escape') {
                closeQuickAddModal();
                closeSearchModal();
                closeShortcutsModal();
                closeBrainDumpModal();
                closeSettingsModal();
                closeGlobalQuickAdd();
            }
            return;
        }

        // Check custom shortcuts
        if (matchesShortcut(e, customShortcuts.quickAdd)) {
            e.preventDefault();
            openGlobalQuickAdd();
        }
        if (matchesShortcut(e, customShortcuts.togglePanel)) {
            e.preventDefault();
            toggleFloatingPanel();
        }
        if (matchesShortcut(e, customShortcuts.search)) {
            e.preventDefault();
            openSearchModal();
        }
        if (matchesShortcut(e, customShortcuts.brainDump)) {
            e.preventDefault();
            toggleFloatingPanel();
            setTimeout(() => document.getElementById('brainDumpInput')?.focus(), 100);
        }
        if (matchesShortcut(e, customShortcuts.popOut)) {
            e.preventDefault();
            window.open(window.location.href, 'relaxed_popup', 'width=400,height=600,resizable=yes,scrollbars=yes');
        }

        // Fixed shortcuts
        if (e.key === '?') {
            e.preventDefault();
            openShortcutsModal();
        }
        if (e.key === 'Escape') {
            closeQuickAddModal();
            closeSearchModal();
            closeShortcutsModal();
            closeBrainDumpModal();
            closeSettingsModal();
            closeGlobalQuickAdd();
            floatingPanel?.classList.remove('active');
        }
    }

    // Add the new handler
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Expose functions globally
    window.toggleFloatingPanel = toggleFloatingPanel;
    window.openSearchModal = openSearchModal;
    window.openShortcutsModal = openShortcutsModal;
    window.closeBrainDumpModal = closeBrainDumpModal;
    window.processBrainDump = processBrainDump;
    window.openSettingsModal = openSettingsModal;
    window.closeSettingsModal = closeSettingsModal;
    window.openGlobalQuickAdd = openGlobalQuickAdd;

    // ============================================
    // ONBOARDING & SMART INPUT SYSTEM
    // ============================================

    const ONBOARDING_STORAGE_KEY = 'relaxed_mode_onboarding_complete';
    const onboardingOverlay = document.getElementById('onboardingOverlay');
    const onboardingClose = document.getElementById('onboardingClose');
    const onboardingStart = document.getElementById('onboardingStart');
    const dontShowAgain = document.getElementById('dontShowAgain');

    // Show onboarding on first visit
    function checkOnboarding() {
        const onboardingComplete = localStorage.getItem(ONBOARDING_STORAGE_KEY);
        if (!onboardingComplete) {
            setTimeout(() => showOnboarding(), 500);
        }
    }

    function showOnboarding() {
        onboardingOverlay?.classList.add('active');
    }

    function hideOnboarding() {
        onboardingOverlay?.classList.remove('active');
        if (dontShowAgain?.checked) {
            localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
        }
    }

    onboardingClose?.addEventListener('click', hideOnboarding);
    onboardingStart?.addEventListener('click', hideOnboarding);
    onboardingOverlay?.addEventListener('click', (e) => {
        if (e.target === onboardingOverlay) hideOnboarding();
    });

    // Show onboarding on first load
    checkOnboarding();

    // Brain Dump FAB
    const brainDumpFab = document.getElementById('brainDumpFab');
    brainDumpFab?.addEventListener('click', () => {
        toggleFloatingPanel();
        setTimeout(() => {
            document.getElementById('brainDumpInput')?.focus();
        }, 100);
    });

    // ============================================
    // SMART INPUT PARSING
    // ============================================

    const smartInputTooltip = document.getElementById('smartInputTooltip');

    // Show smart input tooltip when focusing on quick add
    const quickTaskTitle = document.getElementById('quickTaskTitle');

    quickTaskTitle?.addEventListener('focus', () => {
        smartInputTooltip?.classList.add('active');
    });

    quickTaskTitle?.addEventListener('blur', () => {
        setTimeout(() => smartInputTooltip?.classList.remove('active'), 200);
    });

    // Parse smart syntax from input
    function parseSmartInput(text) {
        let category = '';
        let priority = 'medium';
        let dueDate = '';
        let cleanTitle = text;

        // Parse category tags: #sports, #music, #arts, #clubs, #volunteering
        const categoryMatch = text.match(/#(sports|music|arts|clubs|volunteering|other)/i);
        if (categoryMatch) {
            category = categoryMatch[1].toLowerCase();
            cleanTitle = cleanTitle.replace(categoryMatch[0], '').trim();
        }

        // Parse priority: !high, !medium, !low
        const priorityMatch = text.match(/!(high|medium|low)/i);
        if (priorityMatch) {
            priority = priorityMatch[1].toLowerCase();
            cleanTitle = cleanTitle.replace(priorityMatch[0], '').trim();
        }

        // Parse simple date keywords
        const today = new Date();
        const datePatterns = {
            'today': new Date(today),
            'tomorrow': new Date(today.setDate(today.getDate() + 1)),
            'monday': getNextDayOfWeek(1),
            'tuesday': getNextDayOfWeek(2),
            'wednesday': getNextDayOfWeek(3),
            'thursday': getNextDayOfWeek(4),
            'friday': getNextDayOfWeek(5),
            'saturday': getNextDayOfWeek(6),
            'sunday': getNextDayOfWeek(0)
        };

        for (const [keyword, date] of Object.entries(datePatterns)) {
            const regex = new RegExp(`\\b${keyword}\\b`, 'i');
            if (regex.test(text)) {
                dueDate = date.toISOString().split('T')[0];
                cleanTitle = cleanTitle.replace(regex, '').trim();
                break;
            }
        }

        return {
            title: cleanTitle.replace(/\s+/g, ' ').trim(),
            category,
            priority,
            dueDate
        };
    }

    function getNextDayOfWeek(dayOfWeek) {
        const today = new Date();
        const result = new Date(today);
        result.setDate(today.getDate() + (dayOfWeek + 7 - today.getDay()) % 7 || 7);
        return result;
    }

    // Override global quick add to use smart parsing
    const originalGlobalQuickInput = document.getElementById('globalQuickInput');

    originalGlobalQuickInput?.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && originalGlobalQuickInput.value.trim()) {
            e.preventDefault();
            const rawText = originalGlobalQuickInput.value.trim();
            const parsed = parseSmartInput(rawText);

            const task = {
                id: Date.now(),
                title: parsed.title,
                description: '',
                dueDate: parsed.dueDate,
                priority: parsed.priority,
                category: parsed.category,
                createdAt: new Date().toISOString(),
                completed: false
            };

            tasks.push(task);
            await saveTasks();
            renderTasks();
            renderFloatingPanelTasks();
            closeGlobalQuickAdd();

            // Show what was detected
            let detectedParts = [];
            if (parsed.category) detectedParts.push(`📁 ${parsed.category}`);
            if (parsed.priority !== 'medium') detectedParts.push(`⚡ ${parsed.priority}`);
            if (parsed.dueDate) detectedParts.push(`📅 ${parsed.dueDate}`);

            const detectedMessage = detectedParts.length > 0
                ? `Activity added! Detected: ${detectedParts.join(', ')}`
                : 'Activity added!';
            showToast(detectedMessage, 'success');
        }
    });

    // Also apply smart parsing to quick add modal
    const quickAddSaveBtn = document.getElementById('quickSaveTask');
    if (quickAddSaveBtn) {
        // We'll let the existing save function handle it, but apply parsing first
        const originalQuickSave = window.quickSaveTask;
        window.quickSaveTask = async function () {
            const titleInput = document.getElementById('quickTaskTitle');
            const categorySelect = document.getElementById('quickCategory');

            if (titleInput && titleInput.value.trim()) {
                const parsed = parseSmartInput(titleInput.value);
                titleInput.value = parsed.title;

                // Only set category/priority if not already selected
                if (!categorySelect?.value && parsed.category) {
                    categorySelect.value = parsed.category;
                }
            }

            // Call original function
            if (typeof originalQuickSave === 'function') {
                await originalQuickSave();
            }
        };
    }

    // Function to show onboarding again
    window.showOnboarding = showOnboarding;
    window.hideOnboarding = hideOnboarding;
});