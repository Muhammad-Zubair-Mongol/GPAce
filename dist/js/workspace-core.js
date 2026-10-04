/**
 * workspace-core.js
 *
 * Owns the Workspace editor readiness boundary. Quill is created once, saved
 * content is restored only after that instance is ready, and every UI action
 * is guarded while the dependency is loading or unavailable.
 */

const runtimeWindow = typeof window !== 'undefined' ? window : globalThis;
const runtimeDocument = typeof document !== 'undefined' ? document : runtimeWindow?.document;

const editorState = {
    zoom: 100,
    lastSaved: null,
    dirtyRevision: 0,
    savedRevision: 0,
    dirty: false,
    saveStatus: 'idle',
    syncStatus: 'idle',
    saveError: null,
    wordCount: 0,
    charCount: 0
};

const workspaceState = {
    status: 'idle',
    error: null,
    initialized: false,
    editorCount: 0,
    document: null,
    options: null
};

let quill = null;
let initPromise = null;
let autoSaveTimer = null;
let autoSaveInFlight = null;
let autoSaveWindow = null;
let autoSavePagehideHandler = null;
let workspaceController = null;
let boundDocument = null;
let documentListeners = [];

function getDocument(options = {}) {
    return options.documentRef || runtimeDocument || runtimeWindow?.document || null;
}

function getWindow(options = {}) {
    return options.windowRef || runtimeWindow;
}

function getElement(id, documentRef = getDocument()) {
    return documentRef?.getElementById?.(id) || null;
}

function getStorage(options = {}) {
    if (options.storage) return options.storage;
    if (getWindow(options)?.StorageAdapter?.getStorage) {
        try { return getWindow(options).StorageAdapter.getStorage(); } catch {}
    }
    if (getWindow(options)?.StorageService) return getWindow(options).StorageService;
    if (typeof getWindow(options)?.getStorage === 'function') {
        try { return getWindow(options).getStorage(); } catch {}
    }
    const backend = getWindow(options)?.localStorage;
    if (!backend) return null;
    return {
        get(key, fallback) {
            const raw = backend.getItem(key);
            if (raw === null) return fallback;
            try { return JSON.parse(raw); } catch { return raw; }
        },
        set(key, value) {
            backend.setItem(key, JSON.stringify(value));
            return { success: true, status: 'success', value };
        }
    };
}

function unwrapStorageValue(value, fallback) {
    if (value && typeof value === 'object' && 'success' in value && 'value' in value) {
        return value.success ? value.value : fallback;
    }
    return value === undefined ? fallback : value;
}

function showStatus(message, type = 'info', documentRef = getDocument()) {
    const status = getElement('editorReadinessStatus', documentRef);
    if (status) {
        status.textContent = message;
        status.dataset.state = type;
    }
    const toast = getWindow()?.showToast;
    if (typeof toast === 'function' && type !== 'loading') toast(message, type === 'error' ? 'error' : type);
}

function setRetryVisible(visible, documentRef = getDocument()) {
    const retry = getElement('editorRetryBtn', documentRef);
    if (retry) {
        retry.hidden = !visible;
        retry.disabled = !visible;
    }
}

function setEditorControlsEnabled(enabled, documentRef = getDocument()) {
    if (!documentRef?.querySelectorAll) return;
    const selectors = [
        '.toolbar-container button',
        '.floating-toolbar button',
        '.editor-statusbar button'
    ];
    documentRef.querySelectorAll(selectors.join(',')).forEach(control => {
        if (control.id !== 'editorRetryBtn') control.disabled = !enabled;
    });
    const editor = getElement('editor', documentRef);
    if (editor) {
        editor.setAttribute('aria-busy', enabled ? 'false' : 'true');
        if (enabled) editor.removeAttribute('aria-disabled');
        else editor.setAttribute('aria-disabled', 'true');
    }
}

function bindRetryControl(documentRef, options) {
    const retry = getElement('editorRetryBtn', documentRef);
    if (!retry || retry.dataset.workspaceRetryBound) return;
    retry.addEventListener?.('click', () => void retryWorkspace({
        ...(workspaceState.options || options),
        force: true,
        skipDomReady: true
    }));
    retry.dataset.workspaceRetryBound = 'true';
}

function isEditorReady() {
    return workspaceState.status === 'ready' && Boolean(quill);
}

function getGlobalFunction(name, fallback = null) {
    const candidate = getWindow()?.[name];
    return typeof candidate === 'function' ? candidate : fallback;
}

async function waitForQuill(options = {}) {
    const windowRef = getWindow(options);
    const directQuill = options.Quill || windowRef?.Quill;
    if (typeof directQuill === 'function') return directQuill;

    const dependency = windowRef?.__gpaceQuillDependency;
    if (dependency?.promise) {
        await dependency.promise;
    } else if (dependency && typeof dependency.then === 'function') {
        await dependency;
    }

    const loadedQuill = options.Quill || windowRef?.Quill;
    if (typeof loadedQuill !== 'function') {
        throw new Error('Quill editor dependency is unavailable');
    }
    return loadedQuill;
}

function createQuill(QuillConstructor, documentRef, windowRef) {
    const existing = windowRef?.__gpaceQuillInstance;
    if (existing && windowRef?.__gpaceQuillDocument === documentRef) {
        quill = existing;
        windowRef.quill = existing;
        return existing;
    }

    const editor = getElement('editor', documentRef);
    if (!editor) throw new Error('Workspace editor container is missing');

    const instance = new QuillConstructor(editor, {
        theme: 'snow',
        modules: {
            toolbar: false,
            history: { delay: 2000, maxStack: 500, userOnly: true }
        },
        placeholder: 'Start typing or paste your content here...',
        formats: [
            'bold', 'italic', 'underline', 'strike', 'align', 'list', 'bullet',
            'indent', 'link', 'image', 'video', 'color', 'background', 'font',
            'size', 'header', 'blockquote', 'code-block', 'table'
        ]
    });

    quill = instance;
    windowRef.quill = instance;
    windowRef.__gpaceQuillInstance = instance;
    windowRef.__gpaceQuillDocument = documentRef;
    workspaceState.editorCount += 1;
    return instance;
}

function readSavedContent(storage) {
    if (!storage || typeof storage.get !== 'function') return null;
    const value = storage.get('workspaceContent', null);
    return unwrapStorageValue(value, null);
}

function loadSavedContent(storage, documentRef) {
    if (!isEditorReady()) return false;
    let savedContent = null;
    try {
        savedContent = readSavedContent(storage);
    } catch (error) {
        showStatus(`Saved content unavailable: ${error.message}`, 'warning', documentRef);
        return false;
    }

    if (savedContent !== null && savedContent !== undefined) {
        quill.setContents?.(savedContent);
        editorState.dirty = false;
        editorState.savedRevision = editorState.dirtyRevision;
        editorState.saveStatus = 'saved';
        editorState.syncStatus = 'idle';
        editorState.saveError = null;
        updateCounts(documentRef);
        getGlobalFunction('showToast')?.('Document loaded', 'success');
        return true;
    }
    return false;
}

function bind(target, type, handler, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, options);
    documentListeners.push({ target, type, handler, options });
}

function setupToolbarEventListeners(documentRef, windowRef) {
    const bindSelector = (selector, name) => {
        const element = documentRef.querySelector?.(selector);
        const handler = getGlobalFunction(name);
        if (element && handler && !element.dataset.workspaceBound) {
            bind(element, 'click', handler);
            element.dataset.workspaceBound = 'true';
        }
    };

    [
        ['button[data-tooltip="New Document (Ctrl+N)"]', 'newDocument'],
        ['button[data-tooltip="Open (Ctrl+O)"]', 'openDocument'],
        ['button[data-tooltip="Save (Ctrl+S)"]', 'saveDocument'],
        ['button[data-tooltip="Export as PDF"]', 'exportAsPDF'],
        ['button[data-tooltip="Export as Word"]', 'exportAsWord'],
        ['button[data-tooltip="Insert Image"]', 'showImageOptions'],
        ['button[data-tooltip="Insert Link"]', 'insertLink'],
        ['button[data-tooltip="Insert Table"]', 'insertTable'],
    ].forEach(([selector, name]) => bindSelector(selector, name));

    [
        ['button[data-tooltip="Undo (Ctrl+Z)"]', () => performEdit('undo')],
        ['button[data-tooltip="Redo (Ctrl+Y)"]', () => performEdit('redo')],
        ['button[data-tooltip="Zoom Out"]', () => getGlobalFunction('adjustZoom')?.('out')],
        ['button[data-tooltip="Zoom In"]', () => getGlobalFunction('adjustZoom')?.('in')],
        ['.theme-toggle', (event) => {
            event?.preventDefault?.();
            if (event?.currentTarget?.dataset?.themeManagerBound === 'true' || event?.currentTarget?.getAttribute?.('data-theme-manager-bound') === 'true') {
                return;
            }
            if (typeof window !== 'undefined' && window.themeManager?.toggleTheme) {
                window.themeManager.toggleTheme();
            } else {
                getGlobalFunction('toggleTheme')?.();
            }
        }]
    ].forEach(([selector, handler]) => {
        const element = documentRef.querySelector?.(selector);
        if (element && !element.dataset.workspaceBound) {
            bind(element, 'click', handler);
            element.dataset.workspaceBound = 'true';
        }
    });

    const eventBindings = [
        ['#speechRecognitionBtn', 'click', 'toggleSpeechRecognition'],
        ['#pauseResumeBtn', 'click', 'pauseResumeSpeechRecognition'],
        ['#summarizeBtn', 'click', 'summarizeTranscription'],
        ['#speechLangSettingsBtn', 'click', 'showSpeechLanguageSettings'],
        ['#textToSpeechBtn', 'click', 'showTextToSpeechOptions'],
        ['#pauseResumeTextToSpeechBtn', 'click', 'pauseResumeSpeaking'],
        ['#stopTextToSpeechBtn', 'click', 'stopSpeaking'],
        ['#speakSelectedTextBtn', 'click', 'speakSelectedText'],
        ['#speakAllTextBtn', 'click', 'speakAllText'],
        ['#showTextToSpeechSettingsBtn', 'click', 'showTextToSpeechSettings']
    ];
    eventBindings.forEach(([selector, type, name]) => {
        const element = documentRef.querySelector?.(selector);
        const handler = getGlobalFunction(name);
        if (element && handler && !element.dataset.workspaceBound) {
            bind(element, type, handler);
            element.dataset.workspaceBound = 'true';
        }
    });

    documentRef.querySelectorAll?.('button[data-format]').forEach(button => {
        if (button.dataset.workspaceBound) return;
        const format = button.getAttribute('data-format');
        bind(button, 'click', () => getGlobalFunction('toggleFormat')?.(format));
        button.dataset.workspaceBound = 'true';
    });

    [
        ['#fontFamily', 'change', () => getGlobalFunction('updateFormat')?.('fontFamily')],
        ['#fontSize', 'change', () => getGlobalFunction('updateFormat')?.('fontSize')],
        ['#textColor', 'change', () => getGlobalFunction('updateFormat')?.('color')],
        ['#backgroundColor', 'change', () => getGlobalFunction('updateFormat')?.('background')]
    ].forEach(([selector, type, handler]) => {
        const element = documentRef.querySelector?.(selector);
        if (element && !element.dataset.workspaceBound) {
            bind(element, type, handler);
            element.dataset.workspaceBound = 'true';
        }
    });

    const editorContainer = getElement('editorContainer', documentRef);
    if (editorContainer && !editorContainer.dataset.workspaceBound) {
        bind(editorContainer, 'drop', event => getGlobalFunction('handleDrop')?.(event));
        bind(editorContainer, 'dragover', event => getGlobalFunction('handleDragOver')?.(event));
        bind(editorContainer, 'dragleave', event => getGlobalFunction('handleDragLeave')?.(event));
        editorContainer.dataset.workspaceBound = 'true';
    }

    return windowRef;
}

function setupEventListeners(documentRef, windowRef) {
    if (!quill || !documentRef) return;
    if (!quill.__gpaceCoreListeners) {
        quill.on?.('text-change', () => {
            updateCounts(documentRef);
            editorState.dirtyRevision += 1;
            editorState.dirty = true;
            editorState.saveStatus = 'dirty';
            editorState.syncStatus = 'idle';
            editorState.saveError = null;
            editorState.lastSaved = null;
            const saved = getElement('editorLastSaved', documentRef);
            if (saved) saved.textContent = 'Last saved: Not saved';
            getGlobalFunction('updateToolbarState')?.();
        });
        quill.on?.('selection-change', range => {
            getGlobalFunction('updateToolbarState')?.();
            if (range?.length > 0) showFloatingToolbar(range, documentRef);
            else hideFloatingToolbar(documentRef);
        });
        quill.__gpaceCoreListeners = true;
    }

    if (boundDocument !== documentRef) {
        bind(documentRef, 'keydown', handleKeyboardShortcuts);
        bind(documentRef, 'click', event => {
            if (!event.target?.closest?.('.editor-dropdown')) {
                closeAllDropdowns(documentRef);
                getGlobalFunction('closeTextToSpeechDropdown')?.();
            }
        });
        boundDocument = documentRef;
    }
    setupToolbarEventListeners(documentRef, windowRef);
}

function installWriteGuards(windowRef, documentRef) {
    if (!windowRef || windowRef.__gpaceWorkspaceWriteGuards) return;
    const rawSaveContent = windowRef.saveContent;
    const rawSaveDocument = windowRef.saveDocument;
    windowRef.__gpaceWorkspaceWriteGuards = true;
    windowRef.__gpaceWorkspaceRawSaveContent = rawSaveContent;
    windowRef.__gpaceWorkspaceRawSaveDocument = rawSaveDocument;

    if (typeof rawSaveContent === 'function') {
        windowRef.saveContent = (...args) => {
            if (!isEditorReady()) {
                showStatus('Editor is still loading; save is unavailable.', 'warning', documentRef);
                return false;
            }
            return rawSaveContent(...args);
        };
    }
    if (typeof rawSaveDocument === 'function') {
        windowRef.saveDocument = (...args) => {
            if (!isEditorReady()) {
                showStatus('Editor is still loading; save is unavailable.', 'warning', documentRef);
                return false;
            }
            return rawSaveDocument(...args);
        };
    }
}

function startAutoSave(documentRef, windowRef) {
    if (autoSaveTimer || typeof windowRef?.setInterval !== 'function') return false;
    autoSaveWindow = windowRef;
    autoSaveTimer = windowRef.setInterval(() => {
        if (!isEditorReady() || !hasUnsavedChanges() || autoSaveInFlight) return;
        const revision = editorState.dirtyRevision;
        let result;
        try {
            result = windowRef.saveContent?.({ source: 'autosave', revision });
        } catch (error) {
            result = Promise.reject(error);
        }
        autoSaveInFlight = Promise.resolve(result)
            .then(value => {
                if ((value?.local?.committed === true || value?.committed === true) &&
                    editorState.dirtyRevision === revision) {
                    editorState.savedRevision = revision;
                    editorState.dirty = false;
                    editorState.saveStatus = value.status === 'pending'
                        ? 'local-saved-sync-pending'
                        : 'saved';
                    editorState.syncStatus = value.status === 'pending' ? 'pending' : 'synced';
                }
                return value;
            })
            .catch(error => {
                editorState.saveStatus = 'error';
                editorState.saveError = error;
                showStatus(`Unable to save draft: ${error.message}`, 'error', documentRef);
                return { status: 'error', committed: false, error };
            })
            .finally(() => {
                autoSaveInFlight = null;
            });
    }, 30000);

    if (typeof windowRef.addEventListener === 'function') {
        autoSavePagehideHandler = () => {
            if (!isEditorReady() || !hasUnsavedChanges() || autoSaveInFlight) return;
            const revision = editorState.dirtyRevision;
            try {
                autoSaveInFlight = Promise.resolve(windowRef.saveContent?.({
                    source: 'pagehide',
                    revision
                })).then(value => {
                    if ((value?.local?.committed === true || value?.committed === true) &&
                        editorState.dirtyRevision === revision) {
                        editorState.savedRevision = revision;
                        editorState.dirty = false;
                        editorState.saveStatus = value.status === 'pending'
                            ? 'local-saved-sync-pending'
                            : 'saved';
                        editorState.syncStatus = value.status === 'pending' ? 'pending' : 'synced';
                    }
                    return value;
                }).catch(error => {
                    editorState.saveStatus = 'error';
                    editorState.saveError = error;
                    return { status: 'error', committed: false, error };
                }).finally(() => {
                    autoSaveInFlight = null;
                });
            } catch (error) {
                editorState.saveStatus = 'error';
                editorState.saveError = error;
            }
        };
        windowRef.addEventListener('pagehide', autoSavePagehideHandler);
    }
    return true;
}

function stopAutoSave() {
    if (autoSaveWindow && autoSavePagehideHandler &&
        typeof autoSaveWindow.removeEventListener === 'function') {
        autoSaveWindow.removeEventListener('pagehide', autoSavePagehideHandler);
    }
    if (autoSaveTimer && autoSaveWindow && typeof autoSaveWindow.clearInterval === 'function') {
        autoSaveWindow.clearInterval(autoSaveTimer);
    }
    autoSaveTimer = null;
    autoSaveWindow = null;
    autoSavePagehideHandler = null;
    autoSaveInFlight = null;
}

function hasUnsavedChanges() {
    return Boolean(editorState.dirty || editorState.dirtyRevision !== editorState.savedRevision);
}

async function initializeAttachments(windowRef, documentRef) {
    if (typeof windowRef?.WorkspaceAttachments !== 'function') return;
    try {
        const attachments = new windowRef.WorkspaceAttachments();
        await attachments.initialize?.();
        windowRef.workspaceAttachments = attachments;
        if (windowRef.workspaceFlashcardIntegration?.init) {
            await windowRef.workspaceFlashcardIntegration.init(attachments);
        }
    } catch (error) {
        console.warn('[workspace-core] Attachments unavailable:', error.message);
        showStatus('Editor ready; task attachments are temporarily unavailable.', 'warning', documentRef);
    }
}

async function startWorkspace(options = {}) {
    const documentRef = getDocument(options);
    const windowRef = getWindow(options);
    workspaceState.options = { ...options, documentRef, windowRef };
    workspaceState.document = documentRef;
    workspaceState.status = 'loading';
    workspaceState.error = null;
    bindRetryControl(documentRef, options);
    setEditorControlsEnabled(false, documentRef);
    setRetryVisible(false, documentRef);
    showStatus('Loading editor…', 'loading', documentRef);
    // Guard writes before awaiting the dependency so early toolbar or
    // autosave calls cannot write while the editor is still loading.
    installWriteGuards(windowRef, documentRef);

    try {
        const QuillConstructor = await waitForQuill(options);
        createQuill(QuillConstructor, documentRef, windowRef);
        workspaceState.status = 'ready';
        workspaceState.initialized = true;
        loadSavedContent(getStorage(options), documentRef);
        setupEventListeners(documentRef, windowRef);
        startAutoSave(documentRef, windowRef);
        getGlobalFunction('updateToolbarState')?.();
        setEditorControlsEnabled(true, documentRef);
        setRetryVisible(false, documentRef);
        showStatus('Editor ready.', 'ready', documentRef);
        await initializeAttachments(windowRef, documentRef);
    } catch (error) {
        workspaceState.status = 'error';
        workspaceState.initialized = false;
        workspaceState.error = error;
        setEditorControlsEnabled(false, documentRef);
        setRetryVisible(true, documentRef);
        showStatus(`Editor unavailable: ${error.message}. Retry when the dependency is available.`, 'error', documentRef);
    }

    return workspaceController;
}

function createController(options) {
    return {
        get quill() { return quill; },
        get state() { return getWorkspaceState(); },
        retry: () => retryWorkspace(options),
        destroy: destroyWorkspace
    };
}

export function initWorkspace(options = {}) {
    const documentRef = getDocument(options);
    if (!documentRef) {
        workspaceState.status = 'error';
        workspaceState.error = new Error('Workspace requires a document');
        workspaceController = createController(options);
        return Promise.resolve(workspaceController);
    }

    if (isEditorReady() && workspaceState.document === documentRef && !options.force) {
        return Promise.resolve(workspaceController);
    }
    if (initPromise && !options.force) return initPromise;
    if (options.force && workspaceState.status === 'error') {
        initPromise = null;
    }

    workspaceController = createController(options);
    const start = () => startWorkspace(options).then(() => workspaceController);
    if (documentRef.readyState === 'loading' && !options.skipDomReady) {
        initPromise = new Promise(resolve => {
            documentRef.addEventListener('DOMContentLoaded', () => resolve(start()), { once: true });
        });
    } else {
        initPromise = start();
    }
    return initPromise;
}

export function retryWorkspace(options = {}) {
    return initWorkspace({ ...(workspaceState.options || {}), ...options, force: true, skipDomReady: true });
}

export function destroyWorkspace() {
    stopAutoSave();
    documentListeners.forEach(({ target, type, handler, options }) => target.removeEventListener?.(type, handler, options));
    documentListeners = [];
    boundDocument = null;
    workspaceState.status = 'idle';
    workspaceState.initialized = false;
    initPromise = null;
    return true;
}

export function getWorkspaceState() {
    return {
        status: workspaceState.status,
        error: workspaceState.error,
        initialized: workspaceState.initialized,
        editorCount: workspaceState.editorCount,
        document: workspaceState.document,
        dirty: editorState.dirty,
        dirtyRevision: editorState.dirtyRevision,
        savedRevision: editorState.savedRevision,
        saveStatus: editorState.saveStatus,
        syncStatus: editorState.syncStatus,
        saveError: editorState.saveError
    };
}

export function updateCounts(documentRef = getDocument()) {
    if (!quill?.getText) return editorState;
    const text = String(quill.getText() || '');
    editorState.wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    editorState.charCount = text.length;
    const editorWordCount = getElement('editorWordCount', documentRef);
    const editorCharCount = getElement('editorCharCount', documentRef);
    const wordCount = getElement('wordCount', documentRef);
    const charCount = getElement('charCount', documentRef);
    if (editorWordCount) editorWordCount.textContent = `${editorState.wordCount} words`;
    if (editorCharCount) editorCharCount.textContent = `${editorState.charCount} characters`;
    if (wordCount) wordCount.textContent = `${editorState.wordCount} words`;
    if (charCount) charCount.textContent = `${editorState.charCount} characters`;
    return editorState;
}

export function updateLastSaved(documentRef = getDocument()) {
    const timeString = editorState.lastSaved ? editorState.lastSaved.toLocaleTimeString() : 'Never';
    const editorLastSaved = getElement('editorLastSaved', documentRef);
    const lastSaved = getElement('lastSaved', documentRef);
    if (editorLastSaved) editorLastSaved.textContent = timeString;
    if (lastSaved) lastSaved.textContent = `Last saved: ${timeString}`;
    return timeString;
}

export function handleKeyboardShortcuts(event) {
    if (!isEditorReady() || !event?.ctrlKey) return;
    const actionMap = {
        s: 'saveDocument', n: 'newDocument', o: 'openDocument',
        b: 'toggleFormat', i: 'toggleFormat', u: 'toggleFormat',
        z: 'performEdit', y: 'performEdit'
    };
    const key = String(event.key || '').toLowerCase();
    if (!actionMap[key]) return;
    event.preventDefault?.();
    if (key === 'b' || key === 'i' || key === 'u') getGlobalFunction('toggleFormat')?.(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
    else if (key === 'z' || key === 'y') performEdit(key === 'z' ? 'undo' : 'redo');
    else getGlobalFunction(actionMap[key])?.();
}

export function toggleDropdown(id, documentRef = getDocument()) {
    const dropdown = getElement(id, documentRef);
    if (!dropdown) return false;
    closeAllDropdowns(documentRef);
    dropdown.classList.toggle('show');
    return dropdown.classList.contains('show');
}

export function closeAllDropdowns(documentRef = getDocument()) {
    documentRef?.querySelectorAll?.('.dropdown-content').forEach(dropdown => dropdown.classList.remove('show'));
}

export function performEdit(action) {
    if (!isEditorReady()) return false;
    if (action === 'undo') quill.history?.undo?.();
    if (action === 'redo') quill.history?.redo?.();
    return action === 'undo' || action === 'redo';
}

export function showFloatingToolbar(range, documentRef = getDocument()) {
    if (!isEditorReady() || !range) return;
    const toolbar = getElement('floatingToolbar', documentRef);
    const editorContainer = getElement('editorContainer', documentRef);
    if (!toolbar || !editorContainer || !quill.getBounds) return;
    const bounds = quill.getBounds(range.index, range.length);
    const editorRect = editorContainer.getBoundingClientRect?.() || { left: 0, width: 0 };
    toolbar.style.top = `${bounds.top - 50}px`;
    toolbar.style.left = `${bounds.left + (bounds.width / 2) - (toolbar.offsetWidth / 2)}px`;
    const toolbarRect = toolbar.getBoundingClientRect?.() || { left: 0, right: 0 };
    if (toolbarRect.left < editorRect.left) toolbar.style.left = '0px';
    else if (toolbarRect.right > editorRect.right) toolbar.style.left = `${editorRect.width - toolbar.offsetWidth}px`;
    if (parseInt(toolbar.style.top, 10) < 0) toolbar.style.top = `${bounds.bottom + 10}px`;
    toolbar.classList.add('visible');
}

export function hideFloatingToolbar(documentRef = getDocument()) {
    getElement('floatingToolbar', documentRef)?.classList.remove('visible');
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    const start = () => void initWorkspace();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}

if (typeof window !== 'undefined') {
    window.editorState = editorState;
    window.initWorkspace = initWorkspace;
    window.retryWorkspace = retryWorkspace;
    window.destroyWorkspace = destroyWorkspace;
    window.getWorkspaceState = getWorkspaceState;
    window.updateCounts = updateCounts;
    window.updateLastSaved = updateLastSaved;
    window.toggleDropdown = toggleDropdown;
    window.closeAllDropdowns = closeAllDropdowns;
    window.performEdit = performEdit;
}
