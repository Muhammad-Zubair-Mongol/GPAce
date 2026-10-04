/**
 * workspace-document.js
 * Handles document operations (new, open, save, export)
 */

// Storage helper with fallback (use existing or create new)
const workspaceWindow = typeof window !== 'undefined' ? window : globalThis;
if (typeof workspaceWindow.getStorage === 'undefined') {
    workspaceWindow.getStorage = () => workspaceWindow.StorageService || {
        get: (k, d) => {
            try {
                const raw = workspaceWindow.localStorage?.getItem(k);
                return raw === null || raw === undefined ? d : JSON.parse(raw);
            } catch { return d; }
        },
        set: (k, v) => workspaceWindow.localStorage?.setItem(k, JSON.stringify(v))
    };
}
const getStorage = workspaceWindow.getStorage;

function getEditor() {
    return typeof quill !== 'undefined' ? quill : workspaceWindow.quill;
}

function getEditorState() {
    if (typeof editorState !== 'undefined') return editorState;
    workspaceWindow.editorState ||= {};
    return workspaceWindow.editorState;
}

function getDocumentRef() {
    return workspaceWindow.document || (typeof document !== 'undefined' ? document : null);
}

function setSaveStatus(message, type = 'info') {
    const documentRef = getDocumentRef();
    const status = documentRef?.getElementById?.('editorReadinessStatus');
    if (status) {
        status.textContent = message;
        if (status.dataset) status.dataset.state = type;
    }
    if (typeof workspaceWindow.showToast === 'function') {
        workspaceWindow.showToast(message, type === 'error' ? 'error' : type);
    }
}

function isDurableSuccess(result) {
    return result !== false && !(result && typeof result === 'object' && (
        result.success === false ||
        result.committed === false ||
        result.status === 'error' ||
        result.status === 'quota_exceeded' ||
        result.status === 'security_denied'
    ));
}

function durableError(result, fallback = 'Local document storage failed') {
    if (result?.error instanceof Error) return result.error;
    if (result?.error) return new Error(String(result.error));
    return new Error(fallback);
}

/**
 * Save content locally first, then await the optional remote acknowledgement.
 * Local durability and remote synchronization are reported separately so a
 * server failure cannot turn a durable local draft into a false error or a
 * local failure into a false success.
 */
async function saveContent(options = {}) {
    const storage = getStorage();
    const editor = getEditor();
    const state = getEditorState();
    const revision = Number.isFinite(options.revision)
        ? options.revision
        : Number(state.dirtyRevision || 0);

    if (!editor || typeof editor.getContents !== 'function') {
        const error = new Error('Editor is unavailable');
        state.saveStatus = 'error';
        state.saveError = error;
        setSaveStatus(error.message, 'error');
        return { status: 'error', committed: false, local: { status: 'error', committed: false }, remote: { status: 'not-attempted' }, error };
    }

    let content;
    try {
        content = editor.getContents();
    } catch (error) {
        state.saveStatus = 'error';
        state.saveError = error;
        setSaveStatus(`Unable to read draft: ${error.message}`, 'error');
        return { status: 'error', committed: false, local: { status: 'error', committed: false }, remote: { status: 'not-attempted' }, error };
    }

    const contentStr = JSON.stringify(content);
    let localResult;
    try {
        if (!storage || typeof storage.set !== 'function') {
            throw new Error('Local document storage is unavailable');
        }
        localResult = await Promise.resolve(storage.set('workspaceContent', content));
        if (!isDurableSuccess(localResult)) throw durableError(localResult);
    } catch (error) {
        state.saveStatus = 'error';
        state.syncStatus = 'idle';
        state.saveError = error;
        // Keep dirtyRevision/dirty and the editor contents untouched so retry
        // can persist the same draft after the storage boundary recovers.
        state.dirty = true;
        setSaveStatus(`Draft not saved: ${error.message}`, 'error');
        return {
            status: 'error',
            committed: false,
            local: { status: 'error', committed: false, error },
            remote: { status: 'not-attempted' },
            error
        };
    }

    state.saveError = null;
    state.saveStatus = 'local-saved';
    state.syncStatus = 'idle';
    if (Number(state.dirtyRevision || 0) === revision) {
        state.savedRevision = revision;
        state.dirty = false;
    }
    state.lastSaved = new Date();
    if (typeof updateLastSaved === 'function') updateLastSaved();

    const parent = workspaceWindow.parent;
    const remoteSaver = parent && typeof parent.saveDocumentToServer === 'function'
        ? parent.saveDocumentToServer.bind(parent)
        : null;

    if (!remoteSaver) {
        state.saveStatus = 'saved-local-only';
        setSaveStatus('Document saved locally.', 'success');
        return {
            status: 'committed',
            committed: true,
            local: { status: 'committed', committed: true, result: localResult },
            remote: { status: 'not-configured', committed: false }
        };
    }

    try {
        const remoteResult = await Promise.resolve(remoteSaver(contentStr, 'workspace_document'));
        state.saveStatus = 'saved';
        state.syncStatus = 'synced';
        setSaveStatus('Document saved.', 'success');
        console.log('Document saved to server');
        return {
            status: 'committed',
            committed: true,
            local: { status: 'committed', committed: true, result: localResult },
            remote: { status: 'committed', committed: true, result: remoteResult }
        };
    } catch (error) {
        state.saveStatus = 'local-saved-sync-pending';
        state.syncStatus = 'pending';
        state.saveError = error;
        setSaveStatus('Document saved locally; sync pending.', 'warning');
        console.warn('Could not save to server; local draft is retained for retry:', error);
        return {
            status: 'pending',
            committed: false,
            local: { status: 'committed', committed: true, result: localResult },
            remote: { status: 'pending', committed: false, error },
            error
        };
    }
}

/**
 * Create a new document
 */
function newDocument() {
    if (confirm('Create new document? Any unsaved changes will be lost.')) {
        quill.setContents([]);
        updateCounts();
        showToast('New document created', 'success');
    }
}

/**
 * Save the current document
 */
async function saveDocument(options = {}) {
    try {
        return await saveContent(options);
    } catch (error) {
        console.error('Error saving document:', error);
        setSaveStatus('Error saving document', 'error');
        return { status: 'error', committed: false, error };
    }
}

/**
 * Open a document from file
 */
function openDocument() {
    // Create a file input element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,.txt,.html';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // Handle file selection
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    // Try to parse as JSON (Quill Delta format)
                    const content = JSON.parse(e.target.result);
                    quill.setContents(content);
                    showToast(`Document '${file.name}' opened successfully`, 'success');
                } catch (error) {
                    // If not valid JSON, try to insert as plain text or HTML
                    try {
                        if (file.name.endsWith('.html')) {
                            quill.clipboard.dangerouslyPasteHTML(e.target.result);
                        } else {
                            quill.setText(e.target.result);
                        }
                        showToast(`Document '${file.name}' opened as text`, 'success');
                    } catch (err) {
                        console.error('Error opening document:', err);
                        showToast('Error opening document', 'error');
                    }
                }
                updateCounts();
            };

            reader.onerror = () => {
                showToast('Error reading file', 'error');
            };

            if (file.name.endsWith('.json')) {
                reader.readAsText(file);
            } else {
                reader.readAsText(file);
            }
        }

        // Clean up
        document.body.removeChild(fileInput);
    });

    // Trigger file selection dialog
    fileInput.click();
}

/**
 * Export document as JSON file
 */
function exportAsJson() {
    const content = quill.getContents();
    const contentStr = JSON.stringify(content, null, 2);

    // Create a blob and download link
    const blob = new Blob([contentStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'GPAce_Document.json';
    document.body.appendChild(link);

    // Trigger download
    link.click();

    // Clean up
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('Document exported as JSON', 'success');
}

/**
 * Export document as PDF
 */
function exportAsPDF() {
    showToast('Preparing PDF export...', 'info');

    // Create a hidden iframe to print from
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    // Get the editor content
    const content = quill.root.innerHTML;

    // Write the content to the iframe
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>GPAce Document</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    line-height: 1.5;
                    margin: 1cm;
                }
                img {
                    max-width: 100%;
                }
                table {
                    border-collapse: collapse;
                    width: 100%;
                }
                table, th, td {
                    border: 1px solid #ddd;
                }
                th, td {
                    padding: 8px;
                    text-align: left;
                }
            </style>
        </head>
        <body>
            ${content}
        </body>
        </html>
    `);
    doc.close();

    // Wait for content to load then print
    iframe.onload = () => {
        try {
            iframe.contentWindow.print();
            showToast('PDF export ready', 'success');
        } catch (error) {
            console.error('Error printing document:', error);
            showToast('Error exporting to PDF', 'error');
        }

        // Clean up after printing dialog is closed
        setTimeout(() => {
            document.body.removeChild(iframe);
        }, 1000);
    };
}

/**
 * Export document as Word
 */
function exportAsWord() {
    const toastId = showToast('Preparing Word export...', 'info', 0);

    try {
        // Create a new document with proper styling
        const doc = new docx.Document({
            styles: {
                paragraphStyles: [
                    {
                        id: 'Normal',
                        name: 'Normal',
                        run: {
                            font: 'Arial',
                            size: 24, // 12pt
                        },
                        paragraph: {
                            spacing: {
                                line: 276, // 1.15 line spacing
                            },
                        },
                    },
                ],
            },
            sections: [{
                properties: {
                    page: {
                        margin: {
                            top: 1440, // 1 inch in twips
                            right: 1440,
                            bottom: 1440,
                            left: 1440,
                        },
                    },
                },
                children: []
            }]
        });

        // Get the editor content as HTML
        const html = quill.root.innerHTML;

        // Create a temporary div to parse the HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        // Process the HTML content and add paragraphs to the document
        const children = [];

        // Process each element in the HTML
        tempDiv.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                // Handle text nodes
                if (node.textContent.trim()) {
                    children.push(new docx.Paragraph({
                        children: [new docx.TextRun(node.textContent)]
                    }));
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // Handle element nodes
                switch (node.tagName.toLowerCase()) {
                    case 'p':
                        const paragraph = new docx.Paragraph({
                            children: Array.from(node.childNodes).map(childNode => {
                                if (childNode.nodeType === Node.TEXT_NODE) {
                                    return new docx.TextRun(childNode.textContent);
                                } else if (childNode.nodeType === Node.ELEMENT_NODE) {
                                    // Handle formatting
                                    const options = { text: childNode.textContent };

                                    if (childNode.tagName.toLowerCase() === 'strong' || childNode.tagName.toLowerCase() === 'b') {
                                        options.bold = true;
                                    }
                                    if (childNode.tagName.toLowerCase() === 'em' || childNode.tagName.toLowerCase() === 'i') {
                                        options.italic = true;
                                    }
                                    if (childNode.tagName.toLowerCase() === 'u') {
                                        options.underline = {};
                                    }
                                    if (childNode.tagName.toLowerCase() === 's') {
                                        options.strike = true;
                                    }
                                    if (childNode.tagName.toLowerCase() === 'a') {
                                        options.color = '0000FF';
                                        options.underline = {};
                                    }
                                    if (childNode.style && childNode.style.color) {
                                        options.color = childNode.style.color.replace('#', '');
                                    }
                                    if (childNode.style && childNode.style.backgroundColor) {
                                        options.highlight = childNode.style.backgroundColor.replace('#', '');
                                    }

                                    return new docx.TextRun(options);
                                }
                                return new docx.TextRun('');
                            })
                        });
                        children.push(paragraph);
                        break;

                    case 'h1':
                    case 'h2':
                    case 'h3':
                    case 'h4':
                    case 'h5':
                    case 'h6':
                        const level = parseInt(node.tagName.charAt(1));
                        const headingLevel = level <= 6 ? level : 6;
                        children.push(new docx.Paragraph({
                            heading: docx.HeadingLevel[`HEADING_${headingLevel}`],
                            children: [new docx.TextRun(node.textContent)]
                        }));
                        break;

                    case 'ul':
                    case 'ol':
                        Array.from(node.querySelectorAll('li')).forEach(li => {
                            children.push(new docx.Paragraph({
                                bullet: { level: 0 },
                                children: [new docx.TextRun(li.textContent)]
                            }));
                        });
                        break;

                    case 'img':
                        // Skip images for now as they require more complex handling
                        children.push(new docx.Paragraph({
                            children: [new docx.TextRun('[Image]')]
                        }));
                        break;

                    case 'table':
                        // Skip tables for now as they require more complex handling
                        children.push(new docx.Paragraph({
                            children: [new docx.TextRun('[Table]')]
                        }));
                        break;

                    default:
                        // For other elements, just add their text content
                        if (node.textContent.trim()) {
                            children.push(new docx.Paragraph({
                                children: [new docx.TextRun(node.textContent)]
                            }));
                        }
                }
            }
        });

        // Add content to the document
        doc.addSection({
            children: children
        });

        // Generate the document
        docx.Packer.toBlob(doc).then(blob => {
            // Hide the loading toast
            hideToast(toastId);

            // Create a download link
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'GPAce_Document.docx';
            document.body.appendChild(link);

            // Trigger download
            link.click();

            // Clean up
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            showToast('Word document exported successfully', 'success');
        }).catch(error => {
            hideToast(toastId);
            console.error('Error generating Word document:', error);
            showToast('Error generating Word document', 'error');
        });
    } catch (error) {
        hideToast(toastId);
        console.error('Error exporting to Word:', error);
        showToast('Error exporting to Word', 'error');
    }
}

// ============================================
// Module Exports (ES Modules - preferred)
// ============================================
export {
    saveContent,
    newDocument,
    saveDocument,
    openDocument,
    exportAsJson,
    exportAsPDF,
    exportAsWord
};

// ============================================
// Global Registration (for HTML onclick compatibility)
// ============================================
const registerGlobal = (name, value, module) => {
    workspaceWindow[name] = value;
    if (workspaceWindow.DEBUG_GLOBALS) {
        console.log(`[workspace-document] Registered global: ${name}`);
    }
};

// Register functions that need to be called from HTML
registerGlobal('saveContent', saveContent, 'workspace-document');
registerGlobal('newDocument', newDocument, 'workspace-document');
registerGlobal('saveDocument', saveDocument, 'workspace-document');
registerGlobal('openDocument', openDocument, 'workspace-document');
registerGlobal('exportAsJson', exportAsJson, 'workspace-document');
registerGlobal('exportAsPDF', exportAsPDF, 'workspace-document');
registerGlobal('exportAsWord', exportAsWord, 'workspace-document');
