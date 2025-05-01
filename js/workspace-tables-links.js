/**
 * workspace-tables-links.js
 * Handles table and link insertion and management
 */

/**
 * Show table insertion dialog
 */
function insertTable() {
    document.getElementById('tableModal').style.display = 'block';
}

/**
 * Close table dialog
 */
function closeTableDialog() {
    document.getElementById('tableModal').style.display = 'none';
}

/**
 * Insert table from dialog
 */
function insertTableFromDialog() {
    const rows = parseInt(document.getElementById('tableRows').value) || 2;
    const cols = parseInt(document.getElementById('tableColumns').value) || 2;

    if (rows > 0 && cols > 0) {
        // Create a table with proper styling
        let tableHTML = '<table style="width: 100%; border-collapse: collapse; margin: 10px 0;">';
        tableHTML += '<tbody>';

        for (let i = 0; i < rows; i++) {
            tableHTML += '<tr>';
            for (let j = 0; j < cols; j++) {
                tableHTML += '<td style="border: 1px solid #ccc; padding: 8px; min-width: 50px;">Cell</td>';
            }
            tableHTML += '</tr>';
        }

        tableHTML += '</tbody></table><p><br></p>';

        // Insert the table at current selection
        const range = quill.getSelection(true);
        if (range) {
            // Insert a line break before the table if not at the beginning of a line
            const currentPosition = range.index;
            const currentLine = quill.getLine(currentPosition)[0];
            const indexAtLineStart = currentLine ? quill.getIndex(currentLine) : 0;

            if (currentPosition > 0 && currentPosition !== indexAtLineStart) {
                quill.insertText(currentPosition, '\n');
                quill.setSelection(currentPosition + 1, 0);
                quill.clipboard.dangerouslyPasteHTML(currentPosition + 1, tableHTML);
            } else {
                quill.clipboard.dangerouslyPasteHTML(currentPosition, tableHTML);
            }
        } else {
            // If no selection, insert at the end
            const length = quill.getLength();
            quill.clipboard.dangerouslyPasteHTML(length, tableHTML);
        }

        // Close the dialog
        closeTableDialog();

        // Show success message
        showToast(`Table with ${rows} rows and ${cols} columns inserted`, 'success');
    } else {
        showToast('Please enter valid numbers for rows and columns', 'error');
    }
}

/**
 * Show link insertion dialog
 */
function insertLink() {
    document.getElementById('linkUrlModal').style.display = 'block';
    document.getElementById('linkUrl').value = '';
    document.getElementById('linkText').value = '';

    // If text is selected, pre-fill the link text field
    const range = quill.getSelection();
    if (range && range.length > 0) {
        const text = quill.getText(range.index, range.length);
        document.getElementById('linkText').value = text;
    }
}

/**
 * Close link dialog
 */
function closeLinkDialog() {
    document.getElementById('linkUrlModal').style.display = 'none';
}

/**
 * Insert link from dialog
 */
function insertLinkFromDialog() {
    let url = document.getElementById('linkUrl').value;
    const text = document.getElementById('linkText').value || url;

    if (url) {
        // Add http:// if no protocol is specified
        if (!/^https?:\/\//i.test(url)) {
            url = 'http://' + url;
        }

        // Get current selection
        const range = quill.getSelection(true);

        if (range) {
            // If there's a selection, delete it first
            if (range.length > 0) {
                quill.deleteText(range.index, range.length);
            }

            // Insert the link
            quill.insertText(range.index, text, 'link', url);

            // Move cursor after the link
            quill.setSelection(range.index + text.length);
        } else {
            // If no selection, insert at the end
            const length = quill.getLength();
            quill.insertText(length - 1, text, 'link', url);
            quill.setSelection(length - 1 + text.length);
        }

        // Close the dialog
        closeLinkDialog();

        // Show success message
        showToast('Link inserted', 'success');
    } else {
        showToast('Please enter a URL', 'error');
    }
}

/**
 * Copy text to clipboard
 */
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Link copied to clipboard', 'success');
    }).catch(err => {
        showToast('Failed to copy link', 'error');
    });
}

/**
 * Edit link at index
 */
function editLinkAtIndex(url, index, text) {
    document.getElementById('linkUrl').value = url;
    document.getElementById('linkText').value = text;
    document.getElementById('linkUrlModal').style.display = 'block';
    createLinkTooltip().style.display = 'none';

    // Store the current index for updating the link later
    quill.setSelection(index, text.length);
}

/**
 * Create link tooltip
 */
function createLinkTooltip() {
    if (!window.linkTooltip) {
        window.linkTooltip = document.createElement('div');
        window.linkTooltip.className = 'link-tooltip';
        window.linkTooltip.style.cssText = `
            position: absolute;
            z-index: 999;
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 8px;
            font-size: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            display: none;
            max-width: 300px;
            word-break: break-all;
        `;
        document.body.appendChild(window.linkTooltip);
    }
    return window.linkTooltip;
}

/**
 * Setup link preview functionality
 */
function setupLinkPreview() {
    const tooltip = createLinkTooltip();
    let tooltipTimeout;

    quill.root.addEventListener('mouseover', (e) => {
        const anchor = e.target.closest('a');
        if (anchor) {
            clearTimeout(tooltipTimeout);
            const rect = anchor.getBoundingClientRect();
            const url = anchor.getAttribute('href');

            tooltipTimeout = setTimeout(() => {
                // Get the Quill index by finding the closest text node
                let node = anchor;
                let index = 0;

                // Walk through all previous nodes to calculate the index
                while (node.previousSibling) {
                    node = node.previousSibling;
                    if (node.textContent) {
                        index += node.textContent.length;
                    }
                }

                // Get parent nodes until we reach the editor root
                let parent = anchor.parentNode;
                while (parent && parent !== quill.root) {
                    node = parent;
                    while (node.previousSibling) {
                        node = node.previousSibling;
                        if (node.textContent) {
                            index += node.textContent.length;
                        }
                    }
                    parent = parent.parentNode;
                }

                tooltip.innerHTML = `
                    <div>${url}</div>
                    <div class="link-preview-buttons">
                        <button class="link-preview-button" onclick="window.open('${url}', '_blank')">
                            <i class="bi bi-box-arrow-up-right"></i>
                            Open
                        </button>
                        <button class="link-preview-button" onclick="copyToClipboard('${url}')">
                            <i class="bi bi-clipboard"></i>
                            Copy
                        </button>
                        <button class="link-preview-button" onclick="editLinkAtIndex('${url}', ${index}, '${anchor.textContent}')">
                            <i class="bi bi-pencil"></i>
                            Edit
                        </button>
                    </div>
                `;
                tooltip.style.display = 'block';
                tooltip.style.left = `${rect.left}px`;
                tooltip.style.top = `${rect.bottom + 5}px`;
            }, 300);
        }
    });

    quill.root.addEventListener('mouseout', (e) => {
        if (!e.target.closest('a')) {
            clearTimeout(tooltipTimeout);
            tooltip.style.display = 'none';
        }
    });

    // Hide tooltip when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('a') && !e.target.closest('.link-tooltip')) {
            tooltip.style.display = 'none';
        }
    });
}

/**
 * Setup Quill clipboard matchers for links and tables
 */
function setupClipboardMatchers() {
    // Add a format button handler for links
    quill.clipboard.addMatcher('A', function(node, delta) {
        const href = node.getAttribute('href');
        if (href) {
            delta.ops.forEach(op => {
                if (op.insert && typeof op.insert === 'string') {
                    op.attributes = op.attributes || {};
                    op.attributes.link = href;
                }
            });
        }
        return delta;
    });

    // Update Quill configuration to allow tables
    quill.clipboard.addMatcher('TABLE', function(node, delta) {
        return delta;
    });
}

/**
 * Initialize tables and links functionality
 */
function initTablesAndLinks() {
    document.addEventListener('DOMContentLoaded', () => {
        setupLinkPreview();
        setupClipboardMatchers();

        // Add event listeners for table and link dialogs
        document.querySelector('button[data-tooltip="Insert Table"]').addEventListener('click', insertTable);
        document.querySelector('button[data-tooltip="Insert Link"]').addEventListener('click', insertLink);

        // Table dialog buttons
        document.getElementById('closeTableDialogBtn').addEventListener('click', closeTableDialog);
        document.getElementById('insertTableFromDialogBtn').addEventListener('click', insertTableFromDialog);

        // Link dialog buttons
        document.getElementById('closeLinkDialogBtn').addEventListener('click', closeLinkDialog);
        document.getElementById('insertLinkFromDialogBtn').addEventListener('click', insertLinkFromDialog);

        // Floating toolbar link button
        document.getElementById('floatingInsertLinkBtn').addEventListener('click', insertLink);
    });
}

// Initialize tables and links
initTablesAndLinks();

// Export functions for other modules
window.insertTable = insertTable;
window.closeTableDialog = closeTableDialog;
window.insertTableFromDialog = insertTableFromDialog;
window.insertLink = insertLink;
window.closeLinkDialog = closeLinkDialog;
window.insertLinkFromDialog = insertLinkFromDialog;
window.copyToClipboard = copyToClipboard;
window.editLinkAtIndex = editLinkAtIndex;
window.createLinkTooltip = createLinkTooltip;
