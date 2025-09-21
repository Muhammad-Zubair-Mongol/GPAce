/**
 * Task Notes Module
 * Handles adding, editing, and displaying notes for tasks
 * Supports cross-device and cross-tab synchronization
 */

class TaskNotesManager {
  constructor() {
    this.currentTaskId = null;
    this.currentProjectId = null;
    this.notes = {};
    this.firestoreUnsubscribe = null;
    this.lastSyncTimestamp = 0;
    this.init();
  }

  /**
   * Initialize the notes manager
   */
  init() {
    // Load notes from localStorage
    this.loadNotesFromLocalStorage();

    // Create modal if it doesn't exist
    this.createNotesModal();

    // Set up event listeners
    this.setupEventListeners();

    // Set up auth state listener
    this.setupAuthStateListener();

    // Set up cross-tab sync
    this.setupCrossTabSync();

    console.log('Task Notes Manager initialized');
  }

  /**
   * Set up authentication state listener
   */
  setupAuthStateListener() {
    // Check if auth is available
    if (window.auth) {
      window.auth.onAuthStateChanged(user => {
        if (user) {
          console.log('User authenticated, syncing notes with Firestore');
          this.loadNotesFromFirebase();
          this.setupRealtimeSync();
        } else {
          console.log('User signed out, using local notes only');
          if (this.firestoreUnsubscribe) {
            this.firestoreUnsubscribe();
            this.firestoreUnsubscribe = null;
          }
        }
      });
    } else {
      console.log('Auth not available, will try again when Firebase is ready');
      // Try again when Firebase is initialized
      window.addEventListener('firebaseReady', () => {
        if (window.auth) {
          this.setupAuthStateListener();
        }
      }, { once: true });
    }
  }

  /**
   * Set up cross-tab synchronization
   */
  setupCrossTabSync() {
    // Use the app's cross-tab sync if available
    if (window.crossTabSync) {
      // Register for task notes updates
      window.crossTabSync.on('taskNotes', (newNotes) => {
        console.log('Received task notes update from another tab');
        this.notes = newNotes;
        this.updateTaskDisplay();

        // If notes modal is open, refresh the display
        if (this.currentTaskId && this.currentProjectId) {
          this.displayNotes();
        }
      });

      // Also listen for user actions related to notes
      window.crossTabSync.onUserAction('task-notes-update', (data) => {
        console.log('Task notes update action received from another tab/device');
        // Reload from localStorage since the data is already there
        this.loadNotesFromLocalStorage();

        // If notes modal is open, refresh the display
        if (this.currentTaskId && this.currentProjectId) {
          this.displayNotes();
        }
      });
    } else {
      // Fallback to basic storage event
      window.addEventListener('storage', (e) => {
        if (e.key === 'taskNotes' || e.key === 'taskNotesVersion') {
          console.log('Storage event: task notes updated');
          this.loadNotesFromLocalStorage();

          // If notes modal is open, refresh the display
          if (this.currentTaskId && this.currentProjectId) {
            this.displayNotes();
          }
        }
      });
    }
  }

  /**
   * Create the notes modal if it doesn't exist
   */
  createNotesModal() {
    // Check if modal already exists
    if (document.getElementById('notesModal')) {
      return;
    }

    // Create modal HTML
    const modalHTML = `
      <div id="notesModal" class="notes-modal">
        <div class="notes-modal-content">
          <div class="notes-modal-header">
            <h3>Task Notes</h3>
            <button class="notes-modal-close" id="closeNotesModal">&times;</button>
          </div>
          <div class="notes-form">
            <textarea id="noteContent" placeholder="Add a note about this task..."></textarea>
            <div class="notes-form-actions">
              <button id="cancelNote" class="notes-cancel-btn">Cancel</button>
              <button id="saveNote" class="notes-save-btn">Save Note</button>
            </div>
          </div>
          <div id="notesList" class="notes-list"></div>
        </div>
      </div>
    `;

    // Append modal to body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }

  /**
   * Set up event listeners for the notes functionality
   */
  setupEventListeners() {
    // Global event delegation for notes buttons
    document.addEventListener('click', (e) => {
      // Check if the clicked element is a notes button or its child
      const notesBtn = e.target.closest('.notes-btn');
      if (notesBtn) {
        const taskInfo = notesBtn.closest('.task-info');
        if (taskInfo) {
          const taskId = taskInfo.dataset.taskId;
          const projectId = taskInfo.dataset.projectId;
          this.openNotesModal(taskId, projectId);
        }
      }
    });

    // Modal close button
    document.addEventListener('click', (e) => {
      if (e.target.id === 'closeNotesModal' || e.target.id === 'cancelNote') {
        this.closeNotesModal();
      }
    });

    // Save note button
    document.addEventListener('click', (e) => {
      if (e.target.id === 'saveNote') {
        this.saveNote();
      }
    });

    // Note edit and delete buttons (using event delegation)
    document.addEventListener('click', (e) => {
      if (e.target.closest('.note-edit-btn')) {
        const noteItem = e.target.closest('.note-item');
        if (noteItem) {
          const noteId = noteItem.dataset.noteId;
          this.editNote(noteId);
        }
      }

      if (e.target.closest('.note-delete-btn')) {
        const noteItem = e.target.closest('.note-item');
        if (noteItem) {
          const noteId = noteItem.dataset.noteId;
          this.deleteNote(noteId);
        }
      }
    });

    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
      const modal = document.getElementById('notesModal');
      if (e.target === modal) {
        this.closeNotesModal();
      }
    });

    // Listen for escape key to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeNotesModal();
      }
    });
  }

  /**
   * Open the notes modal for a specific task
   * @param {string} taskId - The ID of the task or task index
   * @param {string} projectId - The ID of the project
   */
  openNotesModal(taskId, projectId) {
    console.log('Opening notes modal for task:', taskId, 'project:', projectId);

    // If taskId is a task index, get the actual task ID from the priority tasks
    if (taskId && !isNaN(taskId) && !taskId.includes('-')) {
      console.log('Task ID appears to be an index, attempting to find actual task ID');
      try {
        const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
        const taskIndex = parseInt(taskId);
        if (priorityTasks.length > taskIndex) {
          const actualTask = priorityTasks[taskIndex];
          if (actualTask && actualTask.id) {
            console.log('Found actual task ID:', actualTask.id);
            taskId = actualTask.id;
          }
        }
      } catch (error) {
        console.error('Error finding actual task ID:', error);
      }
    }

    this.currentTaskId = taskId;
    this.currentProjectId = projectId;

    // Reset form
    const noteContent = document.getElementById('noteContent');
    if (noteContent) {
      noteContent.value = '';
    }

    // Display existing notes
    this.displayNotes();

    // Show modal
    const modal = document.getElementById('notesModal');
    if (modal) {
      modal.style.display = 'flex';
      console.log('Modal displayed');
    } else {
      console.error('Notes modal element not found');
      // Create modal if it doesn't exist
      this.createNotesModal();
      // Try again
      const newModal = document.getElementById('notesModal');
      if (newModal) {
        newModal.style.display = 'flex';
        console.log('Modal created and displayed');
      }
    }
  }

  /**
   * Close the notes modal
   */
  closeNotesModal() {
    const modal = document.getElementById('notesModal');
    if (modal) {
      modal.style.display = 'none';
    }

    // Reset current task
    this.currentTaskId = null;
    this.currentProjectId = null;
  }

  /**
   * Save a new note for the current task
   */
  saveNote() {
    if (!this.currentTaskId || !this.currentProjectId) {
      console.error('No task selected');
      return;
    }

    const noteContent = document.getElementById('noteContent');
    if (!noteContent || !noteContent.value.trim()) {
      alert('Please enter a note');
      return;
    }

    // Create note object
    const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const note = {
      id: noteId,
      content: noteContent.value.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deviceId: this.getDeviceId() // Add device identifier
    };

    // Add note to the task
    const taskKey = `${this.currentProjectId}_${this.currentTaskId}`;
    if (!this.notes[taskKey]) {
      this.notes[taskKey] = [];
    }

    this.notes[taskKey].push(note);

    // Save to localStorage
    this.saveNotesToLocalStorage();

    // Save to Firebase if available
    this.saveNotesToFirebase();

    // Reset form
    noteContent.value = '';

    // Update display
    this.displayNotes();

    // Update task display to show note indicator
    this.updateTaskDisplay();
  }

  /**
   * Get a unique device identifier
   * @returns {string} A device identifier
   */
  getDeviceId() {
    let deviceId = localStorage.getItem('deviceId');

    if (!deviceId) {
      // Generate a new device ID
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('deviceId', deviceId);
    }

    return deviceId;
  }

  /**
   * Edit an existing note
   * @param {string} noteId - The ID of the note to edit
   */
  editNote(noteId) {
    if (!this.currentTaskId || !this.currentProjectId) {
      console.error('No task selected');
      return;
    }

    const taskKey = `${this.currentProjectId}_${this.currentTaskId}`;
    const taskNotes = this.notes[taskKey] || [];

    // Find the note
    const note = taskNotes.find(n => n.id === noteId);
    if (!note) {
      console.error('Note not found');
      return;
    }

    // Set the note content in the form
    const noteContent = document.getElementById('noteContent');
    if (noteContent) {
      noteContent.value = note.content;
      noteContent.focus();
    }

    // Remove the note (will be re-added when saved)
    this.deleteNote(noteId, true); // true = don't confirm
  }

  /**
   * Delete a note
   * @param {string} noteId - The ID of the note to delete
   * @param {boolean} skipConfirm - Whether to skip confirmation
   */
  deleteNote(noteId, skipConfirm = false) {
    if (!this.currentTaskId || !this.currentProjectId) {
      console.error('No task selected');
      return;
    }

    // Confirm deletion
    if (!skipConfirm && !confirm('Are you sure you want to delete this note?')) {
      return;
    }

    const taskKey = `${this.currentProjectId}_${this.currentTaskId}`;
    if (!this.notes[taskKey]) {
      return;
    }

    // Filter out the note
    this.notes[taskKey] = this.notes[taskKey].filter(note => note.id !== noteId);

    // Save to localStorage
    this.saveNotesToLocalStorage();

    // Save to Firebase if available
    this.saveNotesToFirebase();

    // Update display
    this.displayNotes();

    // Update task display to show/hide note indicator
    this.updateTaskDisplay();
  }

  /**
   * Display notes for the current task
   */
  displayNotes() {
    const notesList = document.getElementById('notesList');
    if (!notesList) {
      return;
    }

    // Clear existing notes
    notesList.innerHTML = '';

    // Get notes for current task
    const taskKey = `${this.currentProjectId}_${this.currentTaskId}`;
    const taskNotes = this.notes[taskKey] || [];

    // Sort notes by creation date (newest first)
    taskNotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Display notes or empty state
    if (taskNotes.length === 0) {
      notesList.innerHTML = '<div class="notes-empty">No notes yet. Add one above!</div>';
      return;
    }

    // Get current device ID
    const currentDeviceId = this.getDeviceId();

    // Create HTML for each note
    taskNotes.forEach(note => {
      const noteDate = new Date(note.createdAt).toLocaleString();

      // Check if this note was created on this device
      const isCurrentDevice = note.deviceId === currentDeviceId;
      const deviceLabel = isCurrentDevice
        ? '<span class="note-device note-current-device">This device</span>'
        : '<span class="note-device note-other-device">Other device</span>';

      const noteHTML = `
        <div class="note-item${isCurrentDevice ? ' note-current-device' : ''}" data-note-id="${note.id}">
          <div class="note-content">${this.escapeHTML(note.content)}</div>
          <div class="note-meta">
            <div class="note-info">
              <div class="note-date">${noteDate}</div>
              ${deviceLabel}
            </div>
            <div class="note-actions">
              <button class="note-edit-btn" title="Edit note">
                <i class="fas fa-edit"></i>
              </button>
              <button class="note-delete-btn" title="Delete note">
                <i class="fas fa-trash-alt"></i>
              </button>
            </div>
          </div>
        </div>
      `;

      notesList.insertAdjacentHTML('beforeend', noteHTML);
    });
  }

  /**
   * Update the task display to show note indicators
   */
  updateTaskDisplay() {
    // Find all task info elements
    const taskInfoElements = document.querySelectorAll('.task-info');

    taskInfoElements.forEach(taskInfo => {
      const taskId = taskInfo.dataset.taskId;
      const taskIndex = taskInfo.dataset.taskIndex;
      const projectId = taskInfo.dataset.projectId;

      if ((!taskId && !taskIndex) || !projectId) {
        return;
      }

      // Try to find notes using task ID first
      let taskKey = `${projectId}_${taskId}`;
      let hasNotes = this.notes[taskKey] && this.notes[taskKey].length > 0;

      // If no notes found and we have a task index, try to get the actual task ID
      if (!hasNotes && taskIndex) {
        try {
          const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
          const index = parseInt(taskIndex);
          if (priorityTasks.length > index) {
            const actualTask = priorityTasks[index];
            if (actualTask && actualTask.id) {
              const actualTaskKey = `${projectId}_${actualTask.id}`;
              hasNotes = this.notes[actualTaskKey] && this.notes[actualTaskKey].length > 0;
            }
          }
        } catch (error) {
          console.error('Error checking notes for task index:', error);
        }
      }

      // Find or create notes indicator
      let notesIndicator = taskInfo.querySelector('.notes-indicator');

      if (hasNotes) {
        // Add indicator if it doesn't exist
        if (!notesIndicator) {
          const taskTitle = taskInfo.querySelector('.task-title');
          if (taskTitle) {
            taskTitle.insertAdjacentHTML('beforeend', '<span class="notes-indicator" title="This task has notes"></span>');
          }
        }
      } else {
        // Remove indicator if it exists
        if (notesIndicator) {
          notesIndicator.remove();
        }
      }
    });
  }

  /**
   * Load notes from localStorage
   */
  loadNotesFromLocalStorage() {
    const notesJson = localStorage.getItem('taskNotes');
    const versionStr = localStorage.getItem('taskNotesVersion');

    if (notesJson) {
      try {
        this.notes = JSON.parse(notesJson);
        this.lastSyncTimestamp = versionStr ? parseInt(versionStr, 10) : 0;
        console.log(`Loaded notes from localStorage with version: ${this.lastSyncTimestamp}`);
      } catch (error) {
        console.error('Error parsing notes from localStorage:', error);
        this.notes = {};
        this.lastSyncTimestamp = 0;
      }
    }

    // Update task display to show note indicators
    this.updateTaskDisplay();
  }

  /**
   * Save notes to localStorage with version tracking
   */
  saveNotesToLocalStorage() {
    // Update the version timestamp
    this.lastSyncTimestamp = Date.now();

    // Save notes and version
    localStorage.setItem('taskNotes', JSON.stringify(this.notes));
    localStorage.setItem('taskNotesVersion', this.lastSyncTimestamp.toString());

    // Broadcast to other tabs if cross-tab sync is available
    if (window.crossTabSync) {
      window.crossTabSync.send('taskNotes', this.notes);

      // Also broadcast as a user action for better integration with the app
      window.crossTabSync.broadcastAction('task-notes-update', {
        timestamp: this.lastSyncTimestamp,
        deviceId: this.getDeviceId()
      });
    }
  }

  /**
   * Set up real-time sync with Firestore
   */
  setupRealtimeSync() {
    // Clean up any existing subscription
    if (this.firestoreUnsubscribe) {
      this.firestoreUnsubscribe();
      this.firestoreUnsubscribe = null;
    }

    // Check if Firebase and auth are available
    if (!window.auth || !window.auth.currentUser || !window.db) {
      console.log('Firebase, auth, or db not available, skipping real-time sync');
      return;
    }

    try {
      const user = window.auth.currentUser;

      // Set up real-time listener
      const notesRef = window.db.collection('users').doc(user.uid).collection('settings').doc('task-notes');

      this.firestoreUnsubscribe = notesRef.onSnapshot((doc) => {
        if (doc.exists) {
          const data = doc.data();
          const firestoreVersion = data.version || 0;

          console.log(`Real-time update - Firestore version: ${firestoreVersion}, Local version: ${this.lastSyncTimestamp}`);

          // Only update if Firestore version is newer
          if (firestoreVersion > this.lastSyncTimestamp) {
            console.log('Updating notes from Firestore (real-time)');
            this.notes = data.notes || {};
            this.lastSyncTimestamp = firestoreVersion;

            // Update localStorage without triggering Firebase save
            localStorage.setItem('taskNotes', JSON.stringify(this.notes));
            localStorage.setItem('taskNotesVersion', firestoreVersion.toString());

            // Update UI
            this.updateTaskDisplay();

            // If notes modal is open, refresh the display
            if (this.currentTaskId && this.currentProjectId) {
              this.displayNotes();
            }
          }
        }
      }, (error) => {
        console.error('Error in Firestore real-time sync:', error);
      });

      console.log('Real-time sync with Firestore set up');
    } catch (error) {
      console.error('Error setting up real-time sync:', error);
    }
  }

  /**
   * Save notes to Firebase if available
   */
  async saveNotesToFirebase() {
    // Check if Firebase and auth are available
    if (!window.auth || !window.auth.currentUser || !window.db) {
      console.log('Firebase, auth, or db not available, skipping Firebase sync');
      return;
    }

    try {
      const user = window.auth.currentUser;

      // Update the version timestamp
      const timestamp = Date.now();
      this.lastSyncTimestamp = timestamp;

      // Save to localStorage first
      localStorage.setItem('taskNotesVersion', timestamp.toString());

      // Save notes to Firestore
      const notesRef = window.db.collection('users').doc(user.uid).collection('settings').doc('task-notes');

      await notesRef.set({
        notes: this.notes,
        lastUpdated: new Date(),
        version: timestamp
      });

      console.log(`Notes saved to Firebase with version: ${timestamp}`);
    } catch (error) {
      console.error('Error saving notes to Firebase:', error);
    }
  }

  /**
   * Load notes from Firebase if available
   */
  async loadNotesFromFirebase() {
    // Check if Firebase and auth are available
    if (!window.auth || !window.auth.currentUser || !window.db) {
      console.log('Firebase, auth, or db not available, skipping Firebase sync');
      return;
    }

    try {
      const user = window.auth.currentUser;

      // Get notes from Firestore
      const notesRef = window.db.collection('users').doc(user.uid).collection('settings').doc('task-notes');
      const doc = await notesRef.get();

      if (doc.exists) {
        const data = doc.data();

        // Compare versions
        const firestoreVersion = data.version || 0;
        const localVersion = this.getLocalVersion();

        console.log(`Comparing versions - Firestore: ${firestoreVersion}, Local: ${localVersion}`);

        // If Firestore version is newer, use Firestore data
        if (firestoreVersion > localVersion) {
          console.log('Using Firestore notes (newer version)');
          this.notes = data.notes || {};
          this.lastSyncTimestamp = firestoreVersion;

          // Save to localStorage
          localStorage.setItem('taskNotes', JSON.stringify(this.notes));
          localStorage.setItem('taskNotesVersion', firestoreVersion.toString());

          this.updateTaskDisplay();
        } else if (localVersion > 0) {
          // If local version is newer, sync it to Firestore
          console.log('Using local notes and syncing to Firestore');
          this.saveNotesToFirebase();
        } else {
          // If local version is 0 (no notes), use Firestore data
          console.log('No local notes, using Firestore data');
          this.notes = data.notes || {};
          this.lastSyncTimestamp = firestoreVersion;

          // Save to localStorage
          localStorage.setItem('taskNotes', JSON.stringify(this.notes));
          localStorage.setItem('taskNotesVersion', firestoreVersion.toString());

          this.updateTaskDisplay();
        }
      } else {
        // No Firestore data exists yet, sync local data if we have any
        console.log('No Firestore notes data found.');
        if (Object.keys(this.notes).length > 0) {
          console.log('Syncing local notes to Firestore.');
          this.saveNotesToFirebase();
        }
      }
    } catch (error) {
      console.error('Error loading notes from Firebase:', error);
    }
  }

  /**
   * Get the local version timestamp
   * @returns {number} The local version timestamp
   */
  getLocalVersion() {
    const versionStr = localStorage.getItem('taskNotesVersion');
    if (!versionStr) {
      return 0;
    }

    try {
      return parseInt(versionStr, 10);
    } catch (error) {
      console.error('Error parsing local version:', error);
      return 0;
    }
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} html - The HTML to escape
   * @returns {string} The escaped HTML
   */
  escapeHTML(html) {
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
  }

  /**
   * Add a notes button to a task element
   * @param {HTMLElement} taskElement - The task element to add the button to
   */
  static addNotesButton(taskElement) {
    // Check if task element exists and doesn't already have a notes button
    if (!taskElement || taskElement.querySelector('.notes-btn')) {
      return;
    }

    // Find the task actions container
    const taskActions = taskElement.querySelector('.task-actions');
    if (!taskActions) {
      return;
    }

    // Create notes button
    const notesButton = document.createElement('button');
    notesButton.className = 'task-btn notes-btn';
    notesButton.title = 'Add or view notes';
    notesButton.innerHTML = '<i class="fas fa-sticky-note"></i>';

    // Add button to task actions
    taskActions.appendChild(notesButton);
  }
}

// Initialize the task notes manager when the document is ready
document.addEventListener('DOMContentLoaded', () => {
  // Create global instance
  window.taskNotesManager = new TaskNotesManager();
});

// The task-notes-injector.js script now handles the template modifications
// This file now only needs to focus on the TaskNotesManager functionality

// Make sure the openTaskNotes function is defined globally
if (!window.openTaskNotes) {
  window.openTaskNotes = function(taskId, projectId) {
    console.log('Notes button clicked for task:', taskId, 'project:', projectId);
    if (window.taskNotesManager) {
      window.taskNotesManager.openNotesModal(taskId, projectId);
    } else {
      console.error('Task notes manager not available');
    }
  };
}

// Set up a MutationObserver to update note indicators whenever the task display changes
document.addEventListener('DOMContentLoaded', function() {
  // Create an observer to watch for changes to the task display
  const taskObserver = new MutationObserver(function(mutations) {
    // Update task display to show note indicators
    if (window.taskNotesManager) {
      window.taskNotesManager.updateTaskDisplay();
    }
  });

  // Start observing the task box
  const taskBox = document.getElementById('priorityTaskBox');
  if (taskBox) {
    taskObserver.observe(taskBox, { childList: true, subtree: true });
  }
});
