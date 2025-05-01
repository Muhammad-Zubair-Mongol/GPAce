/**
 * Task Notes Module
 * Handles adding, editing, and displaying notes for tasks
 */

class TaskNotesManager {
  constructor() {
    this.currentTaskId = null;
    this.currentProjectId = null;
    this.notes = {};
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

    // Listen for cross-tab sync
    window.addEventListener('storage', (e) => {
      if (e.key === 'taskNotes') {
        this.loadNotesFromLocalStorage();
      }
    });

    console.log('Task Notes Manager initialized');
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
      updatedAt: new Date().toISOString()
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

    // Create HTML for each note
    taskNotes.forEach(note => {
      const noteDate = new Date(note.createdAt).toLocaleString();
      const noteHTML = `
        <div class="note-item" data-note-id="${note.id}">
          <div class="note-content">${this.escapeHTML(note.content)}</div>
          <div class="note-meta">
            <div class="note-date">${noteDate}</div>
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
    if (notesJson) {
      try {
        this.notes = JSON.parse(notesJson);
      } catch (error) {
        console.error('Error parsing notes from localStorage:', error);
        this.notes = {};
      }
    }

    // Update task display to show note indicators
    this.updateTaskDisplay();
  }

  /**
   * Save notes to localStorage
   */
  saveNotesToLocalStorage() {
    localStorage.setItem('taskNotes', JSON.stringify(this.notes));
  }

  /**
   * Save notes to Firebase if available
   */
  async saveNotesToFirebase() {
    // Check if Firebase and auth are available
    if (!window.firebase || !window.auth || !window.auth.currentUser) {
      console.log('Firebase or auth not available, skipping Firebase sync');
      return;
    }

    try {
      const user = window.auth.currentUser;
      if (!user) {
        console.log('User not signed in, skipping Firebase sync');
        return;
      }

      // Get Firestore instance
      const db = window.firebase.firestore();
      if (!db) {
        console.log('Firestore not available, skipping Firebase sync');
        return;
      }

      // Save notes to Firestore
      const notesRef = db.collection('users').doc(user.uid).collection('settings').doc('task-notes');

      await notesRef.set({
        notes: this.notes,
        lastUpdated: new Date(),
        version: Date.now()
      });

      console.log('Notes saved to Firebase');
    } catch (error) {
      console.error('Error saving notes to Firebase:', error);
    }
  }

  /**
   * Load notes from Firebase if available
   */
  async loadNotesFromFirebase() {
    // Check if Firebase and auth are available
    if (!window.firebase || !window.auth || !window.auth.currentUser) {
      console.log('Firebase or auth not available, skipping Firebase sync');
      return;
    }

    try {
      const user = window.auth.currentUser;
      if (!user) {
        console.log('User not signed in, skipping Firebase sync');
        return;
      }

      // Get Firestore instance
      const db = window.firebase.firestore();
      if (!db) {
        console.log('Firestore not available, skipping Firebase sync');
        return;
      }

      // Get notes from Firestore
      const notesRef = db.collection('users').doc(user.uid).collection('settings').doc('task-notes');
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
          this.saveNotesToLocalStorage();
          this.updateTaskDisplay();
        } else {
          // If local version is newer or same, sync it to Firestore
          console.log('Using local notes and syncing to Firestore');
          this.saveNotesToFirebase();
        }
      } else {
        // No Firestore data exists yet, sync local data
        console.log('No Firestore notes data. Syncing local notes to Firestore.');
        this.saveNotesToFirebase();
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
    const notesJson = localStorage.getItem('taskNotes');
    if (!notesJson) {
      return 0;
    }

    try {
      // Use the timestamp of the localStorage item as the version
      return Date.now();
    } catch (error) {
      console.error('Error getting local version:', error);
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

  // Load notes from Firebase after a short delay to ensure auth is ready
  setTimeout(() => {
    if (window.taskNotesManager) {
      window.taskNotesManager.loadNotesFromFirebase();
    }
  }, 2000);
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
