/**
 * Text Expansion Module for GPAce
 * A mini version of Text Blaze functionality for the search bar
 * With Firestore integration for cross-device synchronization
 */

class TextExpansionManager {
    constructor(options = {}) {
        // Default options
        this.options = {
            triggerChar: '/',           // Character that triggers snippet expansion
            expandOnSpace: true,        // Whether to expand snippets when space is pressed
            expandOnEnter: true,        // Whether to expand snippets when enter is pressed
            targetSelector: '#searchQuery', // Selector for the target input element
            enableFirestoreSync: true,  // Whether to sync with Firestore
            ...options
        };

        // Reference to the target input element
        this.targetElement = null;

        // Flag to track if we're currently in the process of expanding a snippet
        this.isExpanding = false;

        // Flag to track if we're currently syncing with Firestore
        this.isSyncing = false;

        // Unsubscribe function for real-time updates
        this.unsubscribeFromFirestore = null;

        // Initialize snippets from localStorage as a temporary measure
        const savedSnippets = localStorage.getItem('gpace-snippets');
        if (savedSnippets) {
            try {
                this.snippets = JSON.parse(savedSnippets);
            } catch (e) {
                console.error('Error parsing saved snippets:', e);
                this.snippets = this.getDefaultSnippets();
            }
        } else {
            // Use default snippets
            this.snippets = this.getDefaultSnippets();
            // Save the default snippets to localStorage
            this.saveSnippets();
        }

        // Initialize the manager
        this.init();
    }

    /**
     * Initialize the text expansion manager
     */
    async init() {
        // Find the target element
        this.targetElement = document.querySelector(this.options.targetSelector);

        if (!this.targetElement) {
            console.error('Text expansion target element not found:', this.options.targetSelector);
            return;
        }

        // Set up event listeners
        this.setupEventListeners();

        // Set up authentication state listener
        this.setupAuthListener();

        // Try to load snippets from Firestore if enabled
        if (this.options.enableFirestoreSync) {
            await this.syncWithFirestore();
        }

        console.log('Text Expansion Manager initialized with', this.snippets.length, 'snippets');
    }

    /**
     * Set up event listeners for the target element
     */
    setupEventListeners() {
        // Listen for input events to detect when shortcuts are typed
        this.targetElement.addEventListener('input', this.handleInput.bind(this));

        // Listen for keydown events to handle expansion triggers (space, enter)
        this.targetElement.addEventListener('keydown', this.handleKeyDown.bind(this));
    }

    /**
     * Handle input events on the target element
     * @param {Event} event - The input event
     */
    handleInput(event) {
        // Skip if we're currently expanding a snippet to avoid recursion
        if (this.isExpanding) return;

        const input = event.target;
        const text = input.value;

        // Check if there's a potential shortcut in the text
        this.checkForShortcut(text, input);
    }

    /**
     * Handle keydown events on the target element
     * @param {KeyboardEvent} event - The keydown event
     */
    handleKeyDown(event) {
        // Skip if we're currently expanding a snippet
        if (this.isExpanding) return;

        const input = event.target;
        const text = input.value;

        // Check for expansion triggers
        if ((event.key === ' ' && this.options.expandOnSpace) ||
            (event.key === 'Enter' && this.options.expandOnEnter)) {
            // Try to expand any shortcuts
            if (this.expandShortcut(text, input)) {
                // If a shortcut was expanded, prevent the default action
                event.preventDefault();
            }
        }
    }

    /**
     * Check if there's a shortcut in the text that should be expanded
     * @param {string} text - The current text in the input
     * @param {HTMLElement} input - The input element
     */
    checkForShortcut(text, input) {
        // Get the current cursor position
        const cursorPos = input.selectionStart;

        // Get the text before the cursor
        const textBeforeCursor = text.substring(0, cursorPos);

        // Look for the last potential shortcut in the text
        const lastTriggerIndex = textBeforeCursor.lastIndexOf(this.options.triggerChar);

        if (lastTriggerIndex === -1) return;

        // Extract the potential shortcut
        const potentialShortcut = textBeforeCursor.substring(lastTriggerIndex);

        // Check if this matches any of our snippets
        const matchingSnippet = this.findMatchingSnippet(potentialShortcut);

        if (matchingSnippet) {
            // If we have a match and it's an exact match (not just a prefix),
            // expand it immediately
            if (potentialShortcut === this.options.triggerChar + matchingSnippet.shortcut) {
                this.expandShortcutAtPosition(input, lastTriggerIndex, potentialShortcut.length, matchingSnippet.text);
            }
        }
    }

    /**
     * Try to expand a shortcut in the text
     * @param {string} text - The current text in the input
     * @param {HTMLElement} input - The input element
     * @returns {boolean} - Whether a shortcut was expanded
     */
    expandShortcut(text, input) {
        // Get the current cursor position
        const cursorPos = input.selectionStart;

        // Get the text before the cursor
        const textBeforeCursor = text.substring(0, cursorPos);

        // Look for the last potential shortcut in the text
        const lastTriggerIndex = textBeforeCursor.lastIndexOf(this.options.triggerChar);

        if (lastTriggerIndex === -1) return false;

        // Extract the potential shortcut
        const potentialShortcut = textBeforeCursor.substring(lastTriggerIndex);

        // Check if this matches any of our snippets
        const matchingSnippet = this.findMatchingSnippet(potentialShortcut);

        if (matchingSnippet) {
            // Expand the shortcut
            this.expandShortcutAtPosition(input, lastTriggerIndex, potentialShortcut.length, matchingSnippet.text);
            return true;
        }

        return false;
    }

    /**
     * Find a snippet that matches the given shortcut
     * @param {string} shortcut - The shortcut to match
     * @returns {Object|null} - The matching snippet or null if none found
     */
    findMatchingSnippet(shortcut) {
        // Remove the trigger character from the beginning of the shortcut
        const shortcutWithoutTrigger = shortcut.startsWith(this.options.triggerChar)
            ? shortcut.substring(this.options.triggerChar.length)
            : shortcut;

        // Find a snippet with a matching shortcut
        return this.snippets.find(snippet => snippet.shortcut === shortcutWithoutTrigger);
    }

    /**
     * Expand a shortcut at the given position in the input
     * @param {HTMLElement} input - The input element
     * @param {number} start - The start position of the shortcut
     * @param {number} length - The length of the shortcut
     * @param {string} expandedText - The text to replace the shortcut with
     */
    expandShortcutAtPosition(input, start, length, expandedText) {
        // Set the flag to prevent recursion
        this.isExpanding = true;

        // Get the current text
        const text = input.value;

        // Replace the shortcut with the expanded text
        const newText = text.substring(0, start) + expandedText + text.substring(start + length);

        // Update the input value
        input.value = newText;

        // Set the cursor position after the expanded text
        const newCursorPos = start + expandedText.length;
        input.setSelectionRange(newCursorPos, newCursorPos);

        // Reset the flag
        this.isExpanding = false;

        // Trigger an input event to ensure any listeners know the value has changed
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /**
     * Add a new snippet
     * @param {Object} snippet - The snippet to add
     * @param {string} snippet.shortcut - The shortcut for the snippet
     * @param {string} snippet.text - The expanded text for the snippet
     * @param {string} snippet.description - A description of the snippet
     * @returns {boolean} - Whether the snippet was added successfully
     */
    addSnippet(snippet) {
        // Validate the snippet
        if (!snippet.shortcut || !snippet.text) {
            console.error('Invalid snippet:', snippet);
            return false;
        }

        // Check if a snippet with this shortcut already exists
        const existingIndex = this.snippets.findIndex(s => s.shortcut === snippet.shortcut);

        if (existingIndex !== -1) {
            // Replace the existing snippet
            this.snippets[existingIndex] = snippet;
        } else {
            // Add the new snippet
            this.snippets.push(snippet);
        }

        // Save the snippets to localStorage
        this.saveSnippets();

        return true;
    }

    /**
     * Remove a snippet
     * @param {string} shortcut - The shortcut of the snippet to remove
     * @returns {boolean} - Whether the snippet was removed successfully
     */
    removeSnippet(shortcut) {
        // Find the index of the snippet with the given shortcut
        const index = this.snippets.findIndex(s => s.shortcut === shortcut);

        if (index === -1) {
            console.error('Snippet not found:', shortcut);
            return false;
        }

        // Remove the snippet
        this.snippets.splice(index, 1);

        // Save the snippets to localStorage
        this.saveSnippets();

        return true;
    }

    /**
     * Get all snippets
     * @returns {Array} - All snippets
     */
    getSnippets() {
        return [...this.snippets];
    }

    /**
     * Save snippets to localStorage and optionally to Firestore
     * @param {boolean} syncToFirestore - Whether to also sync to Firestore
     */
    async saveSnippets(syncToFirestore = true) {
        // Generate a new version timestamp
        const timestamp = new Date().getTime();

        // Save to localStorage with version
        localStorage.setItem('gpace-snippets', JSON.stringify(this.snippets));
        localStorage.setItem('gpace-snippets-version', timestamp.toString());

        // Sync to Firestore if enabled and user is authenticated
        if (syncToFirestore && this.options.enableFirestoreSync && !this.isSyncing) {
            try {
                // Check if Firestore functions are available
                if (typeof window.saveSnippetsToFirestore === 'function') {
                    this.isSyncing = true;
                    await window.saveSnippetsToFirestore(this.snippets);
                    this.isSyncing = false;
                }
            } catch (error) {
                console.error('Error syncing snippets to Firestore:', error);
                this.isSyncing = false;
            }
        }
    }

    /**
     * Set up authentication state listener
     */
    setupAuthListener() {
        // Check if Firebase Auth is available
        if (typeof window.auth === 'object') {
            window.auth.onAuthStateChanged(user => {
                if (user) {
                    console.log('User authenticated, syncing snippets with Firestore');
                    this.syncWithFirestore();
                    this.setupRealtimeSync();
                } else {
                    console.log('User signed out, using local snippets only');
                    if (this.unsubscribeFromFirestore) {
                        this.unsubscribeFromFirestore();
                        this.unsubscribeFromFirestore = null;
                    }
                }
            });
        }
    }

    /**
     * Sync snippets with Firestore
     */
    async syncWithFirestore() {
        if (!this.options.enableFirestoreSync || this.isSyncing) {
            return;
        }

        try {
            this.isSyncing = true;

            // Check if Firestore functions are available
            if (typeof window.loadSnippetsFromFirestore === 'function') {
                // Determine if this is a new device session
                const isNewDeviceSession = !localStorage.getItem('gpace-snippets-version');

                // Load snippets from Firestore
                const firestoreSnippets = await window.loadSnippetsFromFirestore(isNewDeviceSession);

                // Update snippets if we got data from Firestore
                if (firestoreSnippets) {
                    this.snippets = firestoreSnippets;
                    // No need to save to Firestore again as loadSnippetsFromFirestore handles versioning
                }
            }
        } catch (error) {
            console.error('Error syncing with Firestore:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Set up real-time sync with Firestore
     */
    setupRealtimeSync() {
        // Clean up any existing subscription
        if (this.unsubscribeFromFirestore) {
            this.unsubscribeFromFirestore();
            this.unsubscribeFromFirestore = null;
        }

        // Set up real-time sync if Firestore functions are available
        if (this.options.enableFirestoreSync && typeof window.setupSnippetsRealtimeSync === 'function') {
            this.unsubscribeFromFirestore = window.setupSnippetsRealtimeSync((updatedSnippets) => {
                console.log('Real-time update: Received updated snippets from Firestore');
                this.snippets = updatedSnippets;

                // Update UI if snippet manager is open
                const snippetManagerModal = document.getElementById('snippetManagerModal');
                if (snippetManagerModal && snippetManagerModal.style.display === 'block') {
                    this.populateSnippetList();
                }
            });
        }
    }

    /**
     * Show the snippet manager UI
     */
    showSnippetManager() {
        // Create the modal if it doesn't exist
        if (!document.getElementById('snippetManagerModal')) {
            this.createSnippetManagerUI();
        }

        // Show the modal
        document.getElementById('snippetManagerModal').style.display = 'block';

        // Populate the snippet list
        this.populateSnippetList();
    }

    /**
     * Get the default snippets
     * @returns {Array} - The default snippets
     */
    getDefaultSnippets() {
        return [
            {
                shortcut: 'hello',
                text: 'Hello, how can you help me with my homework today?',
                description: 'Basic greeting'
            },
            {
                shortcut: 'math',
                text: 'I need help solving this math problem: ',
                description: 'Math problem prefix'
            },
            {
                shortcut: 'physics',
                text: 'Can you explain this physics concept: ',
                description: 'Physics question prefix'
            },
            {
                shortcut: 'explain',
                text: 'Please explain this topic in simple terms: ',
                description: 'Request simple explanation'
            },
            {
                shortcut: 'compare',
                text: 'Compare and contrast the following: ',
                description: 'Comparison request'
            },
            {
                shortcut: 'history',
                text: 'What is the historical significance of ',
                description: 'History question'
            },
            {
                shortcut: 'code',
                text: 'Write a code example in [language] that demonstrates: ',
                description: 'Code example request'
            },
            {
                shortcut: 'steps',
                text: 'What are the step-by-step instructions to solve this problem: ',
                description: 'Step-by-step solution request'
            },
            {
                shortcut: 'summary',
                text: 'Please provide a concise summary of: ',
                description: 'Summary request'
            },
            {
                shortcut: 'eli5',
                text: 'Explain like I\'m 5 years old: ',
                description: 'Simple explanation for complex topics'
            }
        ];
    }

    /**
     * Reset to default snippets
     */
    resetToDefaultSnippets() {
        if (confirm('Are you sure you want to reset to default snippets? This will delete all your custom snippets.')) {
            this.snippets = this.getDefaultSnippets();
            this.saveSnippets();
            this.populateSnippetList();
            this.showNotification('Reset to default snippets successfully', 'success');
        }
    }

    /**
     * Create the snippet manager UI
     */
    createSnippetManagerUI() {
        // Create the modal element
        const modal = document.createElement('div');
        modal.id = 'snippetManagerModal';
        modal.className = 'modal';
        modal.style.display = 'none';

        // Create the modal content
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Text Expansion Snippets</h2>
                    <span class="close">&times;</span>
                </div>
                <div class="modal-body">
                    <div class="snippet-form">
                        <h3>Add New Snippet</h3>
                        <div class="form-group">
                            <label for="snippetShortcut">Shortcut (without ${this.options.triggerChar})</label>
                            <input type="text" id="snippetShortcut" placeholder="e.g. ty">
                        </div>
                        <div class="form-group">
                            <label for="snippetText">Expanded Text</label>
                            <textarea id="snippetText" placeholder="e.g. Thank you for your help!"></textarea>
                        </div>
                        <div class="form-group">
                            <label for="snippetDescription">Description (optional)</label>
                            <input type="text" id="snippetDescription" placeholder="e.g. Thank you message">
                        </div>
                        <button id="saveSnippetBtn" class="btn btn-primary">Save Snippet</button>
                    </div>
                    <div class="snippet-list">
                        <h3>Your Snippets</h3>
                        <div class="snippet-actions">
                            <button id="resetToDefaultBtn" class="btn btn-sm btn-warning">Reset to Defaults</button>
                        </div>
                        <div id="snippetList" class="list-group">
                            <!-- Snippets will be populated here -->
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add the modal to the document
        document.body.appendChild(modal);

        // Add event listeners
        document.querySelector('#snippetManagerModal .close').addEventListener('click', () => {
            document.getElementById('snippetManagerModal').style.display = 'none';
        });

        document.getElementById('saveSnippetBtn').addEventListener('click', () => {
            this.saveSnippetFromForm();
        });

        document.getElementById('resetToDefaultBtn').addEventListener('click', () => {
            this.resetToDefaultSnippets();
        });

        // Close the modal when clicking outside of it
        window.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });

        // Add keyboard shortcuts for the form
        const snippetText = document.getElementById('snippetText');
        snippetText.addEventListener('keydown', (e) => {
            // Ctrl+Enter to save the snippet
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                this.saveSnippetFromForm();
            }
        });
    }

    /**
     * Populate the snippet list in the UI
     */
    populateSnippetList() {
        const snippetList = document.getElementById('snippetList');

        if (!snippetList) return;

        // Clear the current list
        snippetList.innerHTML = '';

        // Add each snippet to the list
        this.snippets.forEach(snippet => {
            const snippetItem = document.createElement('div');
            snippetItem.className = 'list-group-item';

            snippetItem.innerHTML = `
                <div class="snippet-item">
                    <div class="snippet-info">
                        <div class="snippet-shortcut">${this.options.triggerChar}${snippet.shortcut}</div>
                        <div class="snippet-description">${snippet.description || 'No description'}</div>
                    </div>
                    <div class="snippet-text">${this.escapeHtml(snippet.text)}</div>
                    <div class="snippet-actions">
                        <button class="btn btn-sm btn-edit" data-shortcut="${snippet.shortcut}">Edit</button>
                        <button class="btn btn-sm btn-delete" data-shortcut="${snippet.shortcut}">Delete</button>
                    </div>
                </div>
            `;

            snippetList.appendChild(snippetItem);
        });

        // Add event listeners for edit and delete buttons
        document.querySelectorAll('#snippetList .btn-edit').forEach(button => {
            button.addEventListener('click', (event) => {
                const shortcut = event.target.dataset.shortcut;
                this.editSnippet(shortcut);
            });
        });

        document.querySelectorAll('#snippetList .btn-delete').forEach(button => {
            button.addEventListener('click', (event) => {
                const shortcut = event.target.dataset.shortcut;
                this.deleteSnippet(shortcut);
            });
        });
    }

    /**
     * Save a snippet from the form
     */
    saveSnippetFromForm() {
        // Get the form values
        const shortcut = document.getElementById('snippetShortcut').value.trim();
        const text = document.getElementById('snippetText').value;
        const description = document.getElementById('snippetDescription').value.trim();

        // Validate the input
        if (!shortcut || !text) {
            alert('Shortcut and expanded text are required');
            return;
        }

        // Add the snippet
        const success = this.addSnippet({
            shortcut,
            text,
            description
        });

        if (success) {
            // Clear the form
            document.getElementById('snippetShortcut').value = '';
            document.getElementById('snippetText').value = '';
            document.getElementById('snippetDescription').value = '';

            // Update the snippet list
            this.populateSnippetList();

            // Show a success message
            this.showNotification('Snippet saved successfully', 'success');
        } else {
            // Show an error message
            this.showNotification('Failed to save snippet', 'error');
        }
    }

    /**
     * Edit a snippet
     * @param {string} shortcut - The shortcut of the snippet to edit
     */
    editSnippet(shortcut) {
        // Find the snippet
        const snippet = this.snippets.find(s => s.shortcut === shortcut);

        if (!snippet) {
            console.error('Snippet not found:', shortcut);
            return;
        }

        // Populate the form with the snippet data
        document.getElementById('snippetShortcut').value = snippet.shortcut;
        document.getElementById('snippetText').value = snippet.text;
        document.getElementById('snippetDescription').value = snippet.description || '';

        // Focus on the text field
        document.getElementById('snippetText').focus();
    }

    /**
     * Delete a snippet
     * @param {string} shortcut - The shortcut of the snippet to delete
     */
    deleteSnippet(shortcut) {
        // Confirm deletion
        if (!confirm(`Are you sure you want to delete the snippet "${shortcut}"?`)) {
            return;
        }

        // Remove the snippet
        const success = this.removeSnippet(shortcut);

        if (success) {
            // Update the snippet list
            this.populateSnippetList();

            // Show a success message
            this.showNotification('Snippet deleted successfully', 'success');
        } else {
            // Show an error message
            this.showNotification('Failed to delete snippet', 'error');
        }
    }

    /**
     * Show a notification
     * @param {string} message - The message to show
     * @param {string} type - The type of notification (success, error, info, warning)
     */
    showNotification(message, type = 'info') {
        // Check if the showNotification function exists in the global scope
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
        } else {
            // Fallback to alert
            alert(message);
        }
    }

    /**
     * Escape HTML special characters
     * @param {string} unsafe - The unsafe string
     * @returns {string} - The escaped string
     */
    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}

// Export the TextExpansionManager class
window.TextExpansionManager = TextExpansionManager;
