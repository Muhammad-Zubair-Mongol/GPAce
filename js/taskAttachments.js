/**
 * Task Attachments Component
 * Handles file uploads, list display, and previews for task attachments
 */

import googleDriveAPI from './googleDriveApi.js';
import fileViewer from './fileViewer.js';

class TaskAttachments {
    constructor() {
        this.currentTaskId = null;
        this.attachmentsList = [];
        this.uploadQueue = new Map(); // Changed to Map to track files by taskId
        this.isUploading = false;
        this.uploadProgress = 0;
        this.activePreviewFileId = null;

        // Add global styles once
        this.addGlobalStyles();
    }

    /**
     * Add global styles for attachments component
     */
    addGlobalStyles() {
        if (document.getElementById('task-attachments-styles')) return;

        const style = document.createElement('style');
        style.id = 'task-attachments-styles';
        style.textContent = `
            .attachments-container {
                margin-top: 10px;
                border-top: 1px solid var(--border-color);
                padding-top: 8px;
            }

            .attachments-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 6px;
            }

            .attachments-header h6 {
                font-size: 0.9rem;
                margin: 0;
            }

            .file-upload-area {
                border: 1px dashed var(--border-color);
                border-radius: 6px;
                padding: 8px 12px;
                margin-bottom: 10px;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .file-upload-area.drag-over {
                background-color: rgba(0, 123, 255, 0.1);
                border-color: #007bff;
            }

            .file-upload-area i {
                font-size: 1.2rem;
                color: var(--text-color);
                flex-shrink: 0;
            }

            .file-upload-area .upload-text-container {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                text-align: left;
                flex: 1;
            }

            .file-upload-area .upload-text {
                font-size: 0.85rem;
                margin: 0;
            }

            .file-upload-hint {
                font-size: 0.75rem;
                color: #6c757d;
                margin: 0;
            }

            .attachments-list {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
                gap: 8px;
                margin-top: 10px;
            }

            .attachment-item {
                border: 1px solid var(--border-color);
                border-radius: 4px;
                padding: 6px;
                position: relative;
                transition: all 0.2s ease;
                cursor: pointer;
            }

            .attachment-item:hover {
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
            }

            .attachment-icon {
                text-align: center;
                font-size: 1.5rem;
                margin-bottom: 3px;
            }

            .attachment-icon i {
                color: var(--text-color);
            }

            .attachment-name {
                font-size: 0.75rem;
                text-align: center;
                word-break: break-word;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
            }

            .attachment-remove {
                position: absolute;
                top: 5px;
                right: 5px;
                background: rgba(0, 0, 0, 0.5);
                color: white;
                border-radius: 50%;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                opacity: 0;
                transition: opacity 0.2s ease;
            }

            .attachment-item:hover .attachment-remove {
                opacity: 1;
            }

            .upload-progress-container {
                margin-top: 5px;
                margin-bottom: 5px;
                display: none;
            }

            .upload-progress-bar {
                height: 3px;
                background-color: #e9ecef;
                border-radius: 3px;
                overflow: hidden;
            }

            .upload-progress-fill {
                height: 100%;
                background-color: #007bff;
                transition: width 0.3s ease;
            }

            .upload-progress-text {
                font-size: 0.75rem;
                text-align: right;
                margin-top: 2px;
            }

            .file-preview-modal {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(0, 0, 0, 0.85);
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                pointer-events: none;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                backdrop-filter: blur(5px);
            }

            .file-preview-modal.show {
                opacity: 1;
                pointer-events: auto;
            }

            .file-preview-content {
                background-color: var(--card-bg);
                border-radius: 12px;
                width: 95%;
                max-width: 1200px;
                max-height: 95vh;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                transform: scale(0.95);
                opacity: 0;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .file-preview-modal.show .file-preview-content {
                transform: scale(1);
                opacity: 1;
            }

            .file-preview-header {
                padding: 20px;
                border-bottom: 1px solid var(--border-color);
                display: flex;
                justify-content: space-between;
                align-items: center;
                background-color: rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(10px);
            }

            .file-preview-title {
                font-size: 1.25rem;
                font-weight: 500;
                margin: 0;
                color: var(--text-color);
                max-width: 80%;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .file-preview-close {
                background: none;
                border: none;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                color: var(--text-color);
                transition: all 0.2s ease;
                font-size: 1.5rem;
                padding: 0;
            }

            .file-preview-close:hover {
                background-color: rgba(0, 0, 0, 0.1);
            }

            .file-preview-body {
                padding: 30px;
                flex: 1;
                overflow: auto;
                position: relative;
            }

            .file-preview-toolbar {
                position: absolute;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background-color: rgba(0, 0, 0, 0.75);
                backdrop-filter: blur(10px);
                border-radius: 50px;
                padding: 8px 16px;
                display: flex;
                gap: 15px;
                align-items: center;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                z-index: 1;
            }

            .preview-tool-button {
                background: none;
                border: none;
                color: white;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 1.2rem;
            }

            .preview-tool-button:hover {
                background-color: rgba(255, 255, 255, 0.1);
            }

            .preview-zoom-level {
                color: white;
                font-size: 0.9rem;
                margin: 0 10px;
            }

            .image-preview {
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100%;
                position: relative;
                overflow: hidden;
            }

            .image-preview img {
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                transition: transform 0.3s ease;
            }

            .image-preview.zoomed {
                cursor: grab;
            }

            .image-preview.zoomed:active {
                cursor: grabbing;
            }

            .pdf-preview {
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100%;
            }

            .pdf-preview canvas {
                max-width: 100%;
                max-height: 100%;
                transition: transform 0.3s ease;
            }

            .document-preview,
            .spreadsheet-preview,
            .presentation-preview {
                height: calc(100vh - 200px);
            }

            .document-preview iframe,
            .spreadsheet-preview iframe,
            .presentation-preview iframe {
                width: 100%;
                height: 100%;
                border: none;
                border-radius: 8px;
            }

            .file-error {
                text-align: center;
                padding: 20px;
            }

            .file-error-icon {
                font-size: 3rem;
                margin-bottom: 10px;
            }

            .generic-file-preview {
                display: flex;
                align-items: center;
                gap: 15px;
                padding: 20px;
                border: 1px solid var(--border-color);
                border-radius: 8px;
            }

            .file-icon {
                font-size: 3rem;
            }

            .file-info {
                flex: 1;
            }

            .file-name {
                font-size: 1.2rem;
                font-weight: 500;
                margin-bottom: 5px;
            }

            .file-type {
                color: #6c757d;
            }

            .file-actions {
                display: flex;
                gap: 10px;
                justify-content: flex-end;
            }

            @media (max-width: 768px) {
                .attachments-list {
                    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
                }

                .file-preview-content {
                    width: 95%;
                    max-height: 95vh;
                }
            }
        `;

        document.head.appendChild(style);
    }

    /**
     * Initialize attachments component for a task
     */
    async init(taskId, container) {
        // Store task ID in the container data attribute for reference
        container.dataset.taskAttachmentsId = taskId;
        this.currentTaskId = taskId;
        this.container = container;

        // Add attachments container to task element
        this.container.innerHTML = `
            <div class="attachments-container">
                <div class="attachments-header">
                    <h6><i class="bi bi-paperclip"></i> Attachments</h6>
                    <div class="google-drive-auth"></div>
                </div>
                <div class="file-upload-area" data-task-id="${taskId}">
                    <i class="bi bi-cloud-upload"></i>
                    <div class="upload-text-container">
                        <div class="upload-text">Drag and drop files here</div>
                        <div class="file-upload-hint">or click to select files</div>
                    </div>
                    <input type="file" id="file-upload-input-${taskId}" multiple style="display: none">
                </div>
                <div class="upload-progress-container">
                    <div class="upload-progress-bar">
                        <div class="upload-progress-fill" style="width: 0%"></div>
                    </div>
                    <div class="upload-progress-text">Uploading... 0%</div>
                </div>
                <div class="attachments-list"></div>
            </div>

            <div class="file-preview-modal">
                <div class="file-preview-content">
                    <div class="file-preview-header">
                        <h5 class="file-preview-title">File Preview</h5>
                        <button class="file-preview-close">&times;</button>
                    </div>
                    <div class="file-preview-body"></div>
                </div>
            </div>
        `;

        // Set up event listeners
        this.setupEventListeners();

        // Check Google Drive auth status
        const authButton = this.container.querySelector('.google-drive-auth');
        const isAuthorized = await googleDriveAPI.checkAuthStatus();

        if (isAuthorized) {
            authButton.innerHTML = `
                <div class="google-drive-status">
                    <i class="bi bi-google"></i>
                    <span>Google Drive connected</span>
                </div>
            `;
            // Load attachments for this task
            await this.loadAttachments();
        } else {
            authButton.innerHTML = `
                <button class="btn btn-sm btn-outline-primary authorize-drive-btn">
                    <i class="bi bi-google"></i> Connect Google Drive
                </button>
            `;

            // Add click handler for auth button
            authButton.querySelector('.authorize-drive-btn').addEventListener('click', async () => {
                await googleDriveAPI.authorize();
                // Reload attachments after authorization
                await this.loadAttachments();
                // Update button
                authButton.innerHTML = `
                    <div class="google-drive-status">
                        <i class="bi bi-google"></i>
                        <span>Google Drive connected</span>
                    </div>
                `;
            });
        }

        // Listen for successful authentication
        window.addEventListener('google-drive-authenticated', async () => {
            await this.loadAttachments();
            // Update button
            authButton.innerHTML = `
                <div class="google-drive-status">
                    <i class="bi bi-google"></i>
                    <span>Google Drive connected</span>
                </div>
            `;
        });
    }

    /**
     * Set up event listeners for file uploading
     */
    setupEventListeners() {
        const uploadArea = this.container.querySelector('.file-upload-area');
        const taskId = uploadArea.dataset.taskId; // Get task ID from data attribute
        const fileInput = this.container.querySelector(`#file-upload-input-${taskId}`);
        const modal = this.container.querySelector('.file-preview-modal');
        const closeButton = this.container.querySelector('.file-preview-close');

        // File input change handler
        fileInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                // Get task ID from the containing upload area
                const targetTaskId = uploadArea.dataset.taskId;
                this.addFilesToUploadQueue(files, targetTaskId);
            }
        });

        // Drag and drop handlers
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');

            // Get task ID from the drop target
            const targetTaskId = uploadArea.dataset.taskId;
            console.log(`Dropping files on task: ${targetTaskId}`);

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.addFilesToUploadQueue(files, targetTaskId);
            }
        });

        // Click to select files
        uploadArea.addEventListener('click', () => {
            fileInput.click();
        });

        // Modal close handler
        closeButton.addEventListener('click', () => {
            modal.classList.remove('show');
        });

        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
    }

    /**
     * Load attachments for current task
     */
    async loadAttachments(taskId) {
        try {
            if (!taskId) return;

            const files = await googleDriveAPI.getTaskFiles(taskId);
            this.attachmentsList = files;
            this.renderAttachmentsList();
        } catch (error) {
            console.error('Error loading attachments:', error);
        }
    }

    /**
     * Render the attachments list
     */
    renderAttachmentsList() {
        const listContainer = this.container.querySelector('.attachments-list');

        if (this.attachmentsList.length === 0) {
            listContainer.innerHTML = '<div class="text-center text-muted py-3">No attachments yet</div>';
            return;
        }

        listContainer.innerHTML = this.attachmentsList.map(file => {
            // Determine icon based on mime type
            let icon = 'file-earmark';

            if (file.mimeType.startsWith('image/')) {
                icon = 'file-earmark-image';
            } else if (file.mimeType === 'application/pdf') {
                icon = 'file-earmark-pdf';
            } else if (file.mimeType.includes('spreadsheet') || file.mimeType.includes('sheet')) {
                icon = 'file-earmark-spreadsheet';
            } else if (file.mimeType.includes('document') || file.mimeType.includes('word')) {
                icon = 'file-earmark-word';
            } else if (file.mimeType.includes('presentation') || file.mimeType.includes('powerpoint')) {
                icon = 'file-earmark-slides';
            } else if (file.mimeType.includes('audio')) {
                icon = 'file-earmark-music';
            } else if (file.mimeType.includes('video')) {
                icon = 'file-earmark-play';
            } else if (file.mimeType.includes('zip') || file.mimeType.includes('archive')) {
                icon = 'file-earmark-zip';
            } else if (file.mimeType.includes('text')) {
                icon = 'file-earmark-text';
            }

            return `
                <div class="attachment-item" data-file-id="${file.id}">
                    <div class="attachment-icon">
                        <i class="bi bi-${icon}"></i>
                    </div>
                    <div class="attachment-name">${file.name}</div>
                    <div class="attachment-remove" data-file-id="${file.id}">
                        <i class="bi bi-x"></i>
                    </div>
                </div>
            `;
        }).join('');

        // Add click handlers to attachments
        listContainer.querySelectorAll('.attachment-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const fileId = item.dataset.fileId;
                const file = this.attachmentsList.find(f => f.id === fileId);

                if (file) {
                    this.showFilePreview(file);
                }
            });
        });

        // Add remove handlers
        listContainer.querySelectorAll('.attachment-remove').forEach(button => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent opening the preview
                const fileId = button.dataset.fileId;

                if (confirm('Are you sure you want to remove this attachment?')) {
                    await this.removeAttachment(fileId);
                }
            });
        });
    }

    /**
     * Add files to upload queue and start processing
     */
    addFilesToUploadQueue(files, targetTaskId) {
        // Use the specified task ID or fall back to current
        const taskId = targetTaskId || this.currentTaskId;

        console.log(`Adding ${files.length} files to upload queue for task: ${taskId}`);

        // Initialize the queue for this task if needed
        if (!this.uploadQueue.has(taskId)) {
            this.uploadQueue.set(taskId, []);
        }

        // Add files to the task's queue
        const taskQueue = this.uploadQueue.get(taskId);
        for (let i = 0; i < files.length; i++) {
            taskQueue.push(files[i]);
        }

        // Start processing if not already in progress
        if (!this.isUploading) {
            this.processUploadQueue(taskId);
        }
    }

    /**
     * Process files in upload queue
     */
    async processUploadQueue(taskId) {
        // Get the queue for this task
        const taskQueue = this.uploadQueue.get(taskId);

        if (!taskQueue || taskQueue.length === 0) {
            this.isUploading = false;
            // Find the container for this task
            const container = document.querySelector(`[data-task-attachments-id="${taskId}"]`);
            if (container) {
                const progressContainer = container.querySelector('.upload-progress-container');
                this.updateUploadProgress(progressContainer, 100, true);
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                }, 1000);
            }
            return;
        }

        this.isUploading = true;

        // Find the container for this task
        const container = document.querySelector(`[data-task-attachments-id="${taskId}"]`);
        if (!container) {
            console.error(`Task container not found for ID: ${taskId}`);
            return;
        }

        const progressContainer = container.querySelector('.upload-progress-container');
        progressContainer.style.display = 'block';

        const totalFiles = taskQueue.length;
        let completedFiles = 0;

        // Process each file in the queue
        while (taskQueue.length > 0) {
            const file = taskQueue.shift();

            try {
                // Ensure we're using the correct API reference
                await googleDriveAPI.uploadFile(file, taskId);
                completedFiles++;

                // Update progress
                const progress = Math.round((completedFiles / (totalFiles + completedFiles)) * 100);
                this.updateUploadProgress(progressContainer, progress);
            } catch (error) {
                console.error(`Error uploading file for task ${taskId}:`, error);
                completedFiles++;

                // Update progress even on error
                const progress = Math.round((completedFiles / (totalFiles + completedFiles)) * 100);
                this.updateUploadProgress(progressContainer, progress);
            }
        }

        // Reload attachments list after uploads
        await this.loadAttachments(taskId);

        // Reset upload state
        this.isUploading = false;
        this.updateUploadProgress(progressContainer, 100, true);

        // Hide progress bar after a delay
        setTimeout(() => {
            progressContainer.style.display = 'none';
        }, 1000);
    }

    /**
     * Update upload progress UI
     */
    updateUploadProgress(progressContainer, progress, completed = false) {
        const progressBar = progressContainer.querySelector('.upload-progress-fill');
        const progressText = progressContainer.querySelector('.upload-progress-text');

        progressBar.style.width = `${progress}%`;

        if (completed) {
            progressText.textContent = 'Upload complete!';
        } else {
            progressText.textContent = `Uploading... ${progress}%`;
        }
    }

    /**
     * Show file preview in modal
     */
    async showFilePreview(file) {
        const modal = this.container.querySelector('.file-preview-modal');
        const title = modal.querySelector('.file-preview-title');
        const body = modal.querySelector('.file-preview-body');

        // Set title and show loading
        title.textContent = file.name;
        body.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div><div class="mt-2">Loading preview...</div></div>';

        // Show modal
        modal.classList.add('show');

        // Store active file
        this.activePreviewFileId = file.id;

        // Render file
        await fileViewer.renderFile(file, body);
    }

    /**
     * Remove an attachment
     */
    async removeAttachment(fileId) {
        try {
            await googleDriveAPI.deleteFile(fileId);

            // Remove from list and re-render
            this.attachmentsList = this.attachmentsList.filter(file => file.id !== fileId);
            this.renderAttachmentsList();
        } catch (error) {
            console.error('Error removing attachment:', error);
            alert('Error removing attachment. Please try again.');
        }
    }
}

// Export as singleton
const taskAttachments = new TaskAttachments();
export default taskAttachments;