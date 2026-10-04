/**
 * Workspace Module Facade
 * Provides a single import point for all workspace functionality.
 * 
 * Usage:
 *   import * as Workspace from './workspace/index.js';
 *   Workspace.showToast('Hello', 'success');
 *   Workspace.insertTable();
 * 
 * Or import specific functions:
 *   import { showToast, insertTable } from './workspace/index.js';
 */

// Re-export from core modules
export {
    editorState,
    updateCounts,
    updateLastSaved,
    toggleDropdown,
    closeAllDropdowns,
    performEdit,
    initWorkspace,
    showFloatingToolbar,
    hideFloatingToolbar
} from '../workspace-core.js';

// Re-export from UI module
export {
    showToast,
    hideToast,
    toggleTheme,
    initTheme,
    setupThemeListener
} from '../workspace-ui.js';

// Re-export from document module
export {
    saveContent,
    newDocument,
    saveDocument,
    openDocument,
    exportAsJson,
    exportAsPDF,
    exportAsWord
} from '../workspace-document.js';

// Re-export from formatting module
export {
    toggleFormat,
    updateFormat,
    updateToolbarState,
    adjustZoom,
    updateButtonState
} from '../workspace-formatting.js';

// Re-export from tables and links module
export {
    insertTable,
    closeTableDialog,
    insertTableFromDialog,
    insertLink,
    closeLinkDialog,
    insertLinkFromDialog,
    copyToClipboard,
    editLinkAtIndex,
    createLinkTooltip,
    setupLinkPreview,
    setupClipboardMatchers,
    initTablesAndLinks
} from '../workspace-tables-links.js';

// Re-export from media module
export {
    showImageOptions,
    uploadImage,
    handleImageUpload,
    openGooglePicker,
    insertImageUrl,
    closeImageUrlDialog,
    insertImageFromUrl,
    insertImage,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    addResizeHandle,
    removeResizeHandle,
    setupImageHandling,
    initImageDialogs
} from '../workspace-media.js';

/**
 * Workspace API object for convenient access
 */
const Workspace = {
    // State
    get editorState() { return window.editorState; },

    // Core
    updateCounts: () => window.updateCounts?.(),
    updateLastSaved: () => window.updateLastSaved?.(),
    toggleDropdown: (id) => window.toggleDropdown?.(id),
    closeAllDropdowns: () => window.closeAllDropdowns?.(),
    performEdit: (action) => window.performEdit?.(action),

    // UI
    showToast: (msg, type, duration) => window.showToast?.(msg, type, duration),
    hideToast: (id) => window.hideToast?.(id),
    toggleTheme: () => window.toggleTheme?.(),

    // Document
    saveContent: () => window.saveContent?.(),
    newDocument: () => window.newDocument?.(),
    saveDocument: () => window.saveDocument?.(),
    openDocument: () => window.openDocument?.(),
    exportAsJson: () => window.exportAsJson?.(),
    exportAsPDF: () => window.exportAsPDF?.(),
    exportAsWord: () => window.exportAsWord?.(),

    // Formatting
    toggleFormat: (format) => window.toggleFormat?.(format),
    updateFormat: (type) => window.updateFormat?.(type),
    adjustZoom: (direction) => window.adjustZoom?.(direction),

    // Tables & Links
    insertTable: () => window.insertTable?.(),
    insertLink: () => window.insertLink?.(),
    copyToClipboard: (text) => window.copyToClipboard?.(text),

    // Media
    showImageOptions: () => window.showImageOptions?.(),
    insertImage: (url) => window.insertImage?.(url)
};

export default Workspace;
