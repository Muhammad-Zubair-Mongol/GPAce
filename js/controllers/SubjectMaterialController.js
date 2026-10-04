/**
 * SubjectMaterialController.js - Handles subject materials display, upload, and deletion
 */

import googleDriveAPI from '../googleDriveApi.js';

class SubjectMaterialController {
    constructor() {
        this.loadSubjectMaterials = this.loadSubjectMaterials.bind(this);
        this.deleteSubjectMaterial = this.deleteSubjectMaterial.bind(this);
        this.handleUpload = this.handleUpload.bind(this);
    }

    init() {
        // Expose global functions expected by inline handlers
        window.loadSubjectMaterials = this.loadSubjectMaterials;
        window.deleteSubjectMaterial = this.deleteSubjectMaterial;

        // Setup upload listener
        const uploadBtn = document.getElementById('uploadSubjectMaterial');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', this.handleUpload);
        }

        console.log('SubjectMaterialController initialized');
        return this;
    }

    // Helper to get current task (simulated from generic global or finding in DOM)
    getCurrentTask() {
        if (typeof window.getCurrentTask === 'function') return window.getCurrentTask();
        // Fallback: try to find task-info
        const taskInfo = document.querySelector('.task-info');
        if (taskInfo) {
            return {
                id: taskInfo.dataset.taskId,
                projectId: taskInfo.dataset.projectId
            };
        }
        return null;
    }

    async loadSubjectMaterials(subjectTag) {
        try {
            const materialsList = document.querySelector('.subject-materials-list');
            if (!materialsList) {
                console.warn('Subject materials list element not found');
                return;
            }

            materialsList.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"></div>';

            // Check if Google Drive API is initialized with improved readiness detection
            const isDriveReady = window.googleDriveAPI &&
                typeof window.googleDriveAPI.getSubjectFiles === 'function' &&
                (window.googleDriveAPI.isInitialized || (typeof gapi !== 'undefined' && gapi.client));

            if (!isDriveReady) {
                console.debug('[SubjectMaterialController] Drive API not ready, deferring load');
                // Defer until Drive API is ready instead of showing error
                const waitForDriveAPI = () => {
                    return new Promise((resolve, reject) => {
                        // Check if already ready (checking both import and global)
                        if (googleDriveAPI?.isInitialized || window.googleDriveAPI?.isInitialized || (typeof gapi !== 'undefined' && gapi.client)) {
                            resolve();
                            return;
                        }

                        // Trigger init if possible
                        if (googleDriveAPI && typeof googleDriveAPI.initialize === 'function') {
                            console.debug('[SubjectMaterialController] Triggering Drive API init...');
                            googleDriveAPI.initialize().catch(err => {
                                console.warn('[SubjectMaterialController] Drive API init check failed:', err);
                            });
                        }

                        const onReady = () => {
                            clearTimeout(timeoutId);
                            resolve();
                        };

                        window.addEventListener('google-drive-initialized', onReady, { once: true });

                        // Timeout after 10 seconds
                        const timeoutId = setTimeout(() => {
                            window.removeEventListener('google-drive-initialized', onReady);
                            // Verify one last time
                            if (googleDriveAPI?.isInitialized || window.googleDriveAPI?.isInitialized || (typeof gapi !== 'undefined' && gapi.client)) {
                                resolve();
                            } else {
                                reject(new Error('Drive API initialization timeout'));
                            }
                        }, 10000);
                    });
                };

                try {
                    await waitForDriveAPI();
                } catch (waitError) {
                    materialsList.innerHTML = '<p class="text-muted">Drive not connected. Sign in to access materials.</p>';
                    return;
                }
            }

            const files = await window.googleDriveAPI.getSubjectFiles(subjectTag);
            if (files.length === 0) {
                materialsList.innerHTML = '<p class="text-muted">No materials uploaded yet</p>';
                return;
            }

            materialsList.innerHTML = '';
            files.forEach(file => {
                const materialType = file.appProperties?.materialType || 'general';
                const div = document.createElement('div');
                div.className = 'subject-material-item';
                div.innerHTML = `
                    <div class="material-info">
                        <i class="bi bi-file-earmark-text"></i>
                        <span>${file.name}</span>
                        <span class="material-type-badge">${materialType}</span>
                    </div>
                    <div class="material-actions">
                        <button onclick="window.googleDriveAPI.showPreview('${file.id}')" title="Preview">
                            <i class="bi bi-eye"></i>
                        </button>
                        <a href="${file.webViewLink}" target="_blank" title="Open">
                            <button><i class="bi bi-box-arrow-up-right"></i></button>
                        </a>
                        <button onclick="deleteSubjectMaterial('${file.id}', '${subjectTag}')" title="Delete" class="text-danger">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                `;
                materialsList.appendChild(div);
            });
        } catch (error) {
            console.error('Error loading subject materials:', error);
            const materialsList = document.querySelector('.subject-materials-list');
            if (materialsList) {
                materialsList.innerHTML = '<p class="text-danger">Error loading materials</p>';
            }
        }
    }

    async deleteSubjectMaterial(fileId, subjectTag) {
        if (!confirm('Are you sure you want to delete this material? This action cannot be undone.')) {
            return;
        }
        try {
            if (window.googleDriveAPI && typeof window.googleDriveAPI.deleteFile === 'function') {
                await window.googleDriveAPI.deleteFile(fileId);
            }

            // Update local storage
            const subjectMaterialsJson = localStorage.getItem('subjectMaterials') || '{}';
            const subjectMaterials = JSON.parse(subjectMaterialsJson);
            if (subjectMaterials[subjectTag]) {
                subjectMaterials[subjectTag] = subjectMaterials[subjectTag].filter(
                    material => material.fileId !== fileId
                );
                localStorage.setItem('subjectMaterials', JSON.stringify(subjectMaterials));
            }

            // Reload the materials list
            await this.loadSubjectMaterials(subjectTag);

            if (typeof window.showToast === 'function') window.showToast('Success', 'Material deleted successfully', 'success');
        } catch (error) {
            console.error('Error deleting subject material:', error);
            if (typeof window.showToast === 'function') window.showToast('Error', 'Failed to delete material', 'error');
        }
    }

    async handleUpload() {
        const fileInput = document.getElementById('subjectMaterialFile');
        const materialType = document.getElementById('materialType').value;
        const file = fileInput.files[0];

        if (!file) {
            alert('Please select a file to upload');
            return;
        }

        try {
            const currentTask = this.getCurrentTask();
            if (!currentTask || !currentTask.projectId) {
                throw new Error('No active task or project');
            }

            if (!window.googleDriveAPI || typeof window.googleDriveAPI.uploadSubjectFile !== 'function') {
                throw new Error('Google Drive API is not initialized. Please refresh the page and try again.');
            }

            const uploadButton = document.getElementById('uploadSubjectMaterial');
            const originalText = uploadButton.innerHTML;
            uploadButton.disabled = true;
            uploadButton.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Uploading...';

            await window.googleDriveAPI.uploadSubjectFile(file, currentTask.projectId, materialType);

            // Close modal
            if (typeof bootstrap !== 'undefined') {
                const modal = bootstrap.Modal.getInstance(document.getElementById('addSubjectMaterialModal'));
                if (modal) modal.hide();
            } else {
                // Fallback if bootstrap object not available (though grint.html assumes it)
                const modalEl = document.getElementById('addSubjectMaterialModal');
                if (modalEl) modalEl.classList.remove('show');
            }

            await this.loadSubjectMaterials(currentTask.projectId);

            if (typeof window.showToast === 'function') window.showToast('Success', 'Material uploaded successfully', 'success');

            // Reset button
            uploadButton.disabled = false;
            uploadButton.innerHTML = originalText;
            fileInput.value = ''; // clear input

        } catch (error) {
            console.error('Error uploading material:', error);
            if (typeof window.showToast === 'function') window.showToast('Error', error.message || 'Failed to upload material', 'error');
            const uploadButton = document.getElementById('uploadSubjectMaterial');
            if (uploadButton) {
                uploadButton.disabled = false;
                uploadButton.innerHTML = 'Upload'; // Simplified fallback
            }
        }
    }
}

const subjectMaterialController = new SubjectMaterialController();
export default subjectMaterialController;

if (typeof window !== 'undefined') {
    window.subjectMaterialController = subjectMaterialController;
}
