/**
 * workspace-core.js
 * Core functionality for the workspace editor
 * Handles editor initialization, setup, and basic functionality
 */

// Global variables and state
let quill;
let editorState = {
    zoom: 100,
    lastSaved: null,
    wordCount: 0,
    charCount: 0
};

/**
 * Initialize the editor and set up event listeners
 */
function initWorkspace() {
    document.addEventListener('DOMContentLoaded', async () => {
        initQuillEditor();
        loadSavedContent();
        setupEventListeners();
        startAutoSave();
        updateToolbarState();

        // Initialize task attachments
        const workspaceAttachments = new WorkspaceAttachments();
        try {
            await workspaceAttachments.initialize();

            // Initialize flashcard integration
            if (typeof workspaceFlashcardIntegration !== 'undefined') {
                window.workspaceFlashcardIntegration = workspaceFlashcardIntegration;
                await workspaceFlashcardIntegration.init(workspaceAttachments);
            }
        } catch (error) {
            console.error('Error initializing workspace attachments:', error);
            showToast('Error loading task attachments', 'error');
        }
    });
}

/**
 * Initialize the Quill editor
 */
function initQuillEditor() {
    // Initialize Quill editor (make it globally accessible for speech recognition)
    window.quill = new Quill('#editor', {
        theme: 'snow',
        modules: {
            toolbar: false, // We're using our custom toolbar
            history: {
                delay: 2000,
                maxStack: 500,
                userOnly: true
            }
        },
        placeholder: 'Start typing or paste your content here...',
        formats: [
            'bold', 'italic', 'underline', 'strike',
            'align', 'list', 'bullet', 'indent',
            'link', 'image', 'video',
            'color', 'background',
            'font', 'size', 'header',
            'blockquote', 'code-block',
            'table'
        ]
    });

    // Make quill accessible to other modules
    quill = window.quill;
}

/**
 * Load saved content from localStorage
 */
function loadSavedContent() {
    const savedContent = localStorage.getItem('workspaceContent');
    if (savedContent) {
        quill.setContents(JSON.parse(savedContent));
        updateCounts();
        showToast('Document loaded', 'success');
    }
}

/**
 * Set up event listeners for the editor
 */
function setupEventListeners() {
    // Text change listener
    quill.on('text-change', () => {
        updateCounts();
        editorState.lastSaved = null;
        document.getElementById('editorLastSaved').textContent = 'Last saved: Not saved';
        updateToolbarState();
    });

    // Selection change listener
    quill.on('selection-change', (range) => {
        if (range) {
            updateToolbarState();

            // Show floating toolbar if text is selected
            if (range.length > 0) {
                showFloatingToolbar(range);
            } else {
                hideFloatingToolbar();
            }
        } else {
            hideFloatingToolbar();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.editor-dropdown')) {
            closeAllDropdowns();
            // Also close text-to-speech dropdown if it exists
            if (typeof closeTextToSpeechDropdown === 'function') {
                closeTextToSpeechDropdown();
            }
        }
    });

    // Add event listeners for toolbar buttons
    setupToolbarEventListeners();
}

/**
 * Set up event listeners for toolbar buttons
 */
function setupToolbarEventListeners() {
    // Document operations
    document.querySelector('button[data-tooltip="New Document (Ctrl+N)"]').addEventListener('click', newDocument);
    document.querySelector('button[data-tooltip="Open (Ctrl+O)"]').addEventListener('click', openDocument);
    document.querySelector('button[data-tooltip="Save (Ctrl+S)"]').addEventListener('click', saveDocument);
    document.querySelector('button[data-tooltip="Undo (Ctrl+Z)"]').addEventListener('click', () => performEdit('undo'));
    document.querySelector('button[data-tooltip="Redo (Ctrl+Y)"]').addEventListener('click', () => performEdit('redo'));

    // Export buttons
    document.querySelector('button[data-tooltip="Export as PDF"]').addEventListener('click', exportAsPDF);
    document.querySelector('button[data-tooltip="Export as Word"]').addEventListener('click', exportAsWord);

    // Speech recognition buttons
    document.getElementById('speechRecognitionBtn').addEventListener('click', toggleSpeechRecognition);
    document.getElementById('pauseResumeBtn').addEventListener('click', pauseResumeSpeechRecognition);
    document.getElementById('summarizeBtn').addEventListener('click', summarizeTranscription);
    document.getElementById('speechLangSettingsBtn').addEventListener('click', showSpeechLanguageSettings);

    // Text-to-speech buttons
    document.getElementById('textToSpeechBtn').addEventListener('click', showTextToSpeechOptions);
    document.getElementById('pauseResumeTextToSpeechBtn').addEventListener('click', pauseResumeSpeaking);
    document.getElementById('stopTextToSpeechBtn').addEventListener('click', stopSpeaking);

    // Text-to-speech dropdown items
    document.getElementById('speakSelectedTextBtn').addEventListener('click', speakSelectedText);
    document.getElementById('speakAllTextBtn').addEventListener('click', speakAllText);
    document.getElementById('showTextToSpeechSettingsBtn').addEventListener('click', showTextToSpeechSettings);

    // Formatting buttons
    document.querySelectorAll('button[data-format]').forEach(button => {
        const format = button.getAttribute('data-format');
        button.addEventListener('click', () => toggleFormat(format));
    });

    // Font family and size selects
    document.getElementById('fontFamily').addEventListener('change', () => updateFormat('fontFamily'));
    document.getElementById('fontSize').addEventListener('change', () => updateFormat('fontSize'));

    // Color pickers
    document.getElementById('textColor').addEventListener('change', () => updateFormat('color'));
    document.getElementById('backgroundColor').addEventListener('change', () => updateFormat('background'));

    // Image and link buttons
    document.querySelector('button[data-tooltip="Insert Image"]').addEventListener('click', showImageOptions);
    document.querySelector('button[data-tooltip="Insert Link"]').addEventListener('click', insertLink);
    document.querySelector('button[data-tooltip="Insert Table"]').addEventListener('click', insertTable);

    // Zoom controls
    document.querySelector('button[data-tooltip="Zoom Out"]').addEventListener('click', () => adjustZoom('out'));
    document.querySelector('button[data-tooltip="Zoom In"]').addEventListener('click', () => adjustZoom('in'));

    // Theme toggle
    document.querySelector('.theme-toggle').addEventListener('click', toggleTheme);

    // Drag and drop handlers
    const editorContainer = document.getElementById('editorContainer');
    editorContainer.addEventListener('drop', handleDrop);
    editorContainer.addEventListener('dragover', handleDragOver);
    editorContainer.addEventListener('dragleave', handleDragLeave);
}

/**
 * Handle floating toolbar positioning
 */
function showFloatingToolbar(range) {
    const toolbar = document.getElementById('floatingToolbar');
    const bounds = quill.getBounds(range.index, range.length);
    const editorContainer = document.getElementById('editorContainer');
    const editorRect = editorContainer.getBoundingClientRect();

    // Position the toolbar above the selection
    toolbar.style.top = `${bounds.top - 50}px`;
    toolbar.style.left = `${bounds.left + (bounds.width / 2) - (toolbar.offsetWidth / 2)}px`;

    // Make sure toolbar doesn't go off-screen
    const toolbarRect = toolbar.getBoundingClientRect();
    if (toolbarRect.left < editorRect.left) {
        toolbar.style.left = '0px';
    } else if (toolbarRect.right > editorRect.right) {
        toolbar.style.left = `${editorRect.width - toolbar.offsetWidth}px`;
    }

    // If toolbar would go above the editor, position it below the selection
    if (parseInt(toolbar.style.top) < 0) {
        toolbar.style.top = `${bounds.bottom + 10}px`;
    }

    // Show the toolbar
    toolbar.classList.add('visible');
}

/**
 * Hide the floating toolbar
 */
function hideFloatingToolbar() {
    const toolbar = document.getElementById('floatingToolbar');
    toolbar.classList.remove('visible');
}

/**
 * Start auto-save functionality
 */
function startAutoSave() {
    setInterval(() => {
        saveContent();
    }, 30000); // Auto-save every 30 seconds
}

/**
 * Update word and character counts
 */
function updateCounts() {
    const text = quill.getText();
    editorState.wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    editorState.charCount = text.length;

    // Update editor status bar
    document.getElementById('editorWordCount').textContent = `${editorState.wordCount} words`;
    document.getElementById('editorCharCount').textContent = `${editorState.charCount} characters`;

    // Update task status bar
    document.getElementById('wordCount').textContent = `${editorState.wordCount} words`;
    document.getElementById('charCount').textContent = `${editorState.charCount} characters`;
}

/**
 * Update last saved status for both bars
 */
function updateLastSaved() {
    const timeString = editorState.lastSaved ? editorState.lastSaved.toLocaleTimeString() : 'Never';
    document.getElementById('editorLastSaved').textContent = `${timeString}`;
    document.getElementById('lastSaved').textContent = `Last saved: ${timeString}`;
}

/**
 * Handle keyboard shortcuts
 */
function handleKeyboardShortcuts(e) {
    if (e.ctrlKey) {
        switch(e.key.toLowerCase()) {
            case 's':
                e.preventDefault();
                saveDocument();
                break;
            case 'n':
                e.preventDefault();
                newDocument();
                break;
            case 'o':
                e.preventDefault();
                openDocument();
                break;
            case 'b':
                e.preventDefault();
                toggleFormat('bold');
                break;
            case 'i':
                e.preventDefault();
                toggleFormat('italic');
                break;
            case 'u':
                e.preventDefault();
                toggleFormat('underline');
                break;
            case 'z':
                e.preventDefault();
                performEdit('undo');
                break;
            case 'y':
                e.preventDefault();
                performEdit('redo');
                break;
        }
    }
}

/**
 * Dropdown handling
 */
function toggleDropdown(id) {
    closeAllDropdowns();
    document.getElementById(id).classList.toggle('show');
}

/**
 * Close all dropdowns
 */
function closeAllDropdowns() {
    document.querySelectorAll('.dropdown-content').forEach(dropdown => {
        dropdown.classList.remove('show');
    });
}

/**
 * Perform edit operations (undo, redo, etc.)
 */
function performEdit(action) {
    switch(action) {
        case 'undo':
            quill.history.undo();
            break;
        case 'redo':
            quill.history.redo();
            break;
        case 'cut':
            // Implementation for cut
            break;
        case 'copy':
            // Implementation for copy
            break;
        case 'paste':
            // Implementation for paste
            break;
    }
}

// Initialize the workspace
initWorkspace();

// Export functions and variables for other modules
window.editorState = editorState;
window.updateCounts = updateCounts;
window.updateLastSaved = updateLastSaved;
window.toggleDropdown = toggleDropdown;
window.closeAllDropdowns = closeAllDropdowns;
window.performEdit = performEdit;
