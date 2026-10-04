/**
 * workspace-media.js
 * Handles image insertion, Google Drive integration, and file uploads
 */

// Google Drive API Configuration
const GOOGLE_API_KEY = 'YOUR_API_KEY';
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID';
const GOOGLE_APP_ID = 'YOUR_APP_ID';
const GOOGLE_SCOPE = ['https://www.googleapis.com/auth/drive.file'];

// Image handling state
let googleApiInitialized = false;
let googlePickerInitialized = false;
let selectedImage = null;

/**
 * Show image options dropdown
 */
function showImageOptions() {
    const dropdown = document.getElementById('imageOptionsDropdown');
    dropdown.classList.toggle('show');
    event.stopPropagation();
}

/**
 * Upload image from computer
 */
function uploadImage() {
    document.getElementById('imageUpload').click();
}

/**
 * Handle image upload from file input
 */
async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            insertImage(e.target.result);
        };
        reader.readAsDataURL(file);
    }
}

/**
 * Initialize Google API
 */
function initializeGoogleApi() {
    gapi.load('picker', () => {
        google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: GOOGLE_SCOPE.join(' '),
            callback: (response) => {
                if (response.access_token) {
                    createPicker(response.access_token);
                }
            },
        });
        googleApiInitialized = true;
    });
}

/**
 * Open Google Picker
 */
function openGooglePicker() {
    if (!googleApiInitialized) {
        initializeGoogleApi();
        return;
    }

    const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPE.join(' '),
        callback: (response) => {
            if (response.access_token) {
                createPicker(response.access_token);
            }
        },
    });

    tokenClient.requestAccessToken();
}

/**
 * Create Google Picker
 */
function createPicker(oauthToken) {
    const view = new google.picker.View(google.picker.ViewId.DOCS);
    view.setMimeTypes('image/png,image/jpeg,image/jpg,image/gif');

    const picker = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setAppId(GOOGLE_APP_ID)
        .setOAuthToken(oauthToken)
        .addView(view)
        .setDeveloperKey(GOOGLE_API_KEY)
        .setCallback(pickerCallback)
        .build();

    picker.setVisible(true);
}

/**
 * Handle Google Picker callback
 */
function pickerCallback(data) {
    if (data.action === google.picker.Action.PICKED) {
        const file = data.docs[0];
        insertImage(file.url);
    }
}

/**
 * Show image URL dialog
 */
function insertImageUrl() {
    document.getElementById('imageUrlModal').classList.add('show');
    document.getElementById('imageUrlModal').style.display = 'block';
}

/**
 * Close image URL dialog
 */
function closeImageUrlDialog() {
    document.getElementById('imageUrlModal').classList.remove('show');
    document.getElementById('imageUrlModal').style.display = 'none';
    document.getElementById('imageUrl').value = '';
}

/**
 * Insert image from URL dialog
 */
function insertImageFromUrl() {
    const url = document.getElementById('imageUrl').value;
    if (url) {
        insertImage(url);
        closeImageUrlDialog();
    } else {
        showToast('Please enter an image URL', 'error');
    }
}

/**
 * Insert image into editor
 */
function insertImage(url) {
    // Create an image element to check if the URL is valid
    const img = new Image();

    // Show loading toast
    const toastId = showToast('Loading image...', 'info', 0);

    img.onload = function () {
        // Image loaded successfully
        hideToast(toastId);

        const range = quill.getSelection(true) || { index: quill.getLength() - 1 };

        // Insert a line break before the image if not at the beginning of a line
        const currentPosition = range.index;
        const currentLine = quill.getLine(currentPosition)[0];
        const indexAtLineStart = currentLine ? quill.getIndex(currentLine) : 0;

        if (currentPosition > 0 && currentPosition !== indexAtLineStart) {
            quill.insertText(currentPosition, '\n');
            quill.setSelection(currentPosition + 1, 0);
            quill.insertEmbed(currentPosition + 1, 'image', url);
            quill.insertText(currentPosition + 2, '\n');
            quill.setSelection(currentPosition + 3, 0);
        } else {
            quill.insertEmbed(currentPosition, 'image', url);
            quill.insertText(currentPosition + 1, '\n');
            quill.setSelection(currentPosition + 2, 0);
        }

        showToast('Image inserted successfully', 'success');
    };

    img.onerror = function () {
        // Image failed to load
        hideToast(toastId);
        showToast('Failed to load image. Please check the URL.', 'error');
    };

    // Start loading the image
    img.src = url;
}

/**
 * Handle drag over event
 */
function handleDragOver(event) {
    event.preventDefault();
    document.getElementById('dropZone').classList.add('active');
}

/**
 * Handle drag leave event
 */
function handleDragLeave(event) {
    event.preventDefault();
    document.getElementById('dropZone').classList.remove('active');
}

/**
 * Handle drop event
 */
async function handleDrop(event) {
    event.preventDefault();
    document.getElementById('dropZone').classList.remove('active');

    const files = event.dataTransfer.files;
    if (files && files[0]) {
        const file = files[0];
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                insertImage(e.target.result);
            };
            reader.readAsDataURL(file);
        }
    }
}

/**
 * Add resize handle to selected image
 */
function addResizeHandle(image) {
    removeResizeHandle();
    const handle = document.createElement('div');
    handle.className = 'image-resize-handle';
    handle.style.bottom = '0';
    handle.style.right = '0';

    let startX, startY, startWidth, startHeight;

    handle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;
        startWidth = image.width;
        startHeight = image.height;

        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);
    });

    function resize(e) {
        const width = startWidth + (e.clientX - startX);
        const height = startHeight + (e.clientY - startY);
        image.style.width = width + 'px';
        image.style.height = height + 'px';
    }

    function stopResize() {
        document.removeEventListener('mousemove', resize);
        document.removeEventListener('mouseup', stopResize);
    }

    image.parentNode.style.position = 'relative';
    image.parentNode.appendChild(handle);
}

/**
 * Remove resize handle
 */
function removeResizeHandle() {
    const handles = document.querySelectorAll('.image-resize-handle');
    handles.forEach(handle => handle.remove());
}

/**
 * Setup image selection and resizing
 */
function setupImageHandling() {
    // Check if quill is available (it's initialized in workspace-core.js)
    if (typeof window.quill === 'undefined' || !window.quill) {
        console.warn('[workspace-media] Quill not available yet, will retry in 100ms');
        setTimeout(setupImageHandling, 100);
        return;
    }

    const quill = window.quill;

    quill.on('selection-change', function (range, oldRange, source) {
        if (range) {
            const [leaf] = quill.getLeaf(range.index);
            if (leaf.domNode && leaf.domNode.tagName === 'IMG') {
                selectedImage = leaf.domNode;
                selectedImage.classList.add('selected');
                addResizeHandle(selectedImage);
            } else if (selectedImage) {
                selectedImage.classList.remove('selected');
                removeResizeHandle();
                selectedImage = null;
            }
        }
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', function (event) {
        if (!event.target.closest('.toolbar-button')) {
            document.getElementById('imageOptionsDropdown').classList.remove('show');
        }
    });

    // Initialize Google API when the page loads
    window.onload = function () {
        gapi.load('picker', () => {
            googlePickerInitialized = true;
        });
    };

    // Setup file input change handler
    document.getElementById('imageUpload').addEventListener('change', handleImageUpload);

    console.log('[workspace-media] Image handling setup complete');
}

/**
 * Initialize image dialogs
 */
function initImageDialogs() {
    // Set up image URL dialog buttons
    document.getElementById('closeImageUrlBtn').addEventListener('click', closeImageUrlDialog);
    document.getElementById('insertImageFromUrlBtn').addEventListener('click', insertImageFromUrl);

    // Set up dropdown item handlers
    document.getElementById('uploadImageBtn').addEventListener('click', uploadImage);
    document.getElementById('openGooglePickerBtn').addEventListener('click', openGooglePicker);
    document.getElementById('insertImageUrlBtn').addEventListener('click', insertImageUrl);
}

// Initialize image handling
document.addEventListener('DOMContentLoaded', () => {
    setupImageHandling();
    initImageDialogs();
});

// ============================================
// Module Exports (ES Modules - preferred)
// ============================================
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
};

// ============================================
// Global Registration (for HTML onclick compatibility)
// ============================================
const registerGlobal = (name, value, module) => {
    window[name] = value;
    if (window.DEBUG_GLOBALS) {
        console.log(`[workspace-media] Registered global: ${name}`);
    }
};

// Register functions that need to be called from HTML
registerGlobal('showImageOptions', showImageOptions, 'workspace-media');
registerGlobal('uploadImage', uploadImage, 'workspace-media');
registerGlobal('handleImageUpload', handleImageUpload, 'workspace-media');
registerGlobal('openGooglePicker', openGooglePicker, 'workspace-media');
registerGlobal('insertImageUrl', insertImageUrl, 'workspace-media');
registerGlobal('closeImageUrlDialog', closeImageUrlDialog, 'workspace-media');
registerGlobal('insertImageFromUrl', insertImageFromUrl, 'workspace-media');
registerGlobal('insertImage', insertImage, 'workspace-media');
registerGlobal('handleDragOver', handleDragOver, 'workspace-media');
registerGlobal('handleDragLeave', handleDragLeave, 'workspace-media');
registerGlobal('handleDrop', handleDrop, 'workspace-media');
