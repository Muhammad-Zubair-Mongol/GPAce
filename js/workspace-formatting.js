/**
 * workspace-formatting.js
 * Handles text formatting and toolbar state management
 */

/**
 * Toggle format (bold, italic, etc.)
 */
function toggleFormat(format) {
    const formats = quill.getFormat();

    // Handle alignment formats specially
    if (format === 'alignLeft') {
        quill.format('align', '');
    } else if (format === 'alignCenter' || format === 'alignRight' || format === 'justify') {
        quill.format('align', format.replace('align', '').toLowerCase());
    } else {
        quill.format(format, !formats[format]);
    }

    updateToolbarState();
}

/**
 * Update format (font, size, color, etc.)
 */
function updateFormat(type) {
    // Get current selection
    const range = quill.getSelection();
    if (!range) {
        showToast('Please select text to format', 'info');
        return;
    }

    switch(type) {
        case 'fontFamily':
            const font = document.getElementById('fontFamily').value;
            if (range.length > 0) {
                quill.format('font', font);
            } else {
                // If no text is selected, set as default for future typing
                quill.format('font', font);
            }
            showToast(`Font changed to ${font}`, 'success');
            break;

        case 'fontSize':
            const size = document.getElementById('fontSize').value;
            if (range.length > 0) {
                quill.format('size', size + 'px');
            } else {
                // If no text is selected, set as default for future typing
                quill.format('size', size + 'px');
            }
            showToast(`Font size changed to ${size}px`, 'success');
            break;

        case 'color':
            const color = document.getElementById('textColor').value;
            if (range.length > 0) {
                quill.format('color', color);
            } else {
                // If no text is selected, set as default for future typing
                quill.format('color', color);
            }
            break;

        case 'background':
            const bgColor = document.getElementById('backgroundColor').value;
            if (range.length > 0) {
                quill.format('background', bgColor);
            } else {
                // If no text is selected, set as default for future typing
                quill.format('background', bgColor);
            }
            break;
    }

    // Update toolbar state to reflect changes
    updateToolbarState();
}

/**
 * Update toolbar state based on current formatting
 */
function updateToolbarState() {
    const formats = quill.getFormat();

    // Update basic formatting buttons
    updateButtonState('bold', formats.bold);
    updateButtonState('italic', formats.italic);
    updateButtonState('underline', formats.underline);
    updateButtonState('strike', formats.strike);

    // Update alignment buttons
    updateButtonState('alignLeft', !formats.align);
    updateButtonState('alignCenter', formats.align === 'center');
    updateButtonState('alignRight', formats.align === 'right');
    updateButtonState('justify', formats.align === 'justify');

    // Update font family and size selectors
    if (formats.font) {
        document.getElementById('fontFamily').value = formats.font;
    }

    if (formats.size) {
        const size = formats.size.replace('px', '');
        const sizeSelect = document.getElementById('fontSize');
        if (Array.from(sizeSelect.options).some(option => option.value === size)) {
            sizeSelect.value = size;
        }
    }

    // Update color pickers
    if (formats.color) {
        document.getElementById('textColor').value = formats.color;
    }

    if (formats.background) {
        document.getElementById('backgroundColor').value = formats.background;
    }
}

/**
 * Helper function to update button state
 */
function updateButtonState(format, isActive) {
    const buttons = document.querySelectorAll(`[data-format="${format}"]`);
    buttons.forEach(button => {
        if (isActive) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });

    // Also update any remaining buttons with onclick attributes (for backward compatibility)
    const oldButtons = document.querySelectorAll(`[onclick*="toggleFormat('${format}')"]`);
    oldButtons.forEach(button => {
        if (isActive) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });
}

/**
 * Adjust zoom level
 */
function adjustZoom(direction) {
    const change = direction === 'in' ? 10 : -10;
    editorState.zoom = Math.max(50, Math.min(200, editorState.zoom + change));
    document.getElementById('zoomLevel').textContent = `${editorState.zoom}%`;
    document.querySelector('.editor-content').style.transform = `scale(${editorState.zoom / 100})`;
    document.querySelector('.editor-content').style.transformOrigin = 'top center';
}

// Export functions for other modules
window.toggleFormat = toggleFormat;
window.updateFormat = updateFormat;
window.updateToolbarState = updateToolbarState;
window.adjustZoom = adjustZoom;
