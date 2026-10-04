/**
 * StudySpaceController - Handles study space CRUD, image upload, and Firestore sync
 */

class StudySpaceController {
    constructor() {
        this.studySpaces = [];
        this.currentImage = null;
        this.userId = 'default';
        this.syncStatus = {
            lastSynced: null,
            isSyncing: false,
            error: null
        };
    }

    /**
     * Initialize the controller
     */
    init() {
        this.setupUploadArea();
        this.setupFormHandlers();
        this.setupViewToggle();
        this.loadStudySpaces();
    }

    /**
     * Set user ID
     */
    setUserId(userId) {
        this.userId = userId;
    }

    /**
     * Setup the upload area with drag and drop
     */
    setupUploadArea() {
        const uploadArea = document.getElementById('studySpaceUpload');
        const spaceImageInput = document.getElementById('spaceImageInput');

        if (!uploadArea || !spaceImageInput) {
            console.warn('StudySpaceController: Upload elements not found');
            return;
        }

        // Drag and drop handlers
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                this.handleImageUpload(file);
            }
        });

        // Click upload
        uploadArea.addEventListener('click', () => {
            spaceImageInput.click();
        });

        spaceImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleImageUpload(file);
            }
        });
    }

    /**
     * Setup form submission and cancel handlers
     */
    setupFormHandlers() {
        const saveBtn = document.getElementById('saveStudySpace');
        const cancelBtn = document.getElementById('cancelStudySpace');

        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveStudySpace());
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.resetForm());
        }
    }

    /**
     * Setup grid/list view toggle
     */
    setupViewToggle() {
        const gridBtn = document.getElementById('gridViewBtn');
        const listBtn = document.getElementById('listViewBtn');
        const container = document.getElementById('studySpacesContainer');

        if (gridBtn && listBtn && container) {
            gridBtn.addEventListener('click', () => {
                container.classList.remove('list-view');
                gridBtn.classList.add('active');
                listBtn.classList.remove('active');
            });

            listBtn.addEventListener('click', () => {
                container.classList.add('list-view');
                listBtn.classList.add('active');
                gridBtn.classList.remove('active');
            });
        }
    }

    /**
     * Handle image upload - read as base64
     */
    handleImageUpload(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.currentImage = e.target.result;

            // Show the form
            const form = document.querySelector('.study-space-form');
            if (form) {
                form.style.display = 'block';
            }

            // Show image preview in upload area
            const uploadArea = document.getElementById('studySpaceUpload');
            if (uploadArea) {
                uploadArea.innerHTML = `
                    <img src="${this.currentImage}" alt="Preview" 
                         style="max-width: 100%; height: 150px; object-fit: cover; border-radius: 8px;">
                    <p class="mt-2 text-muted small">Click to change image</p>
                `;
            }
        };
        reader.readAsDataURL(file);
    }

    /**
     * Save a new study space
     */
    async saveStudySpace() {
        const spaceName = document.getElementById('spaceName')?.value;
        const spaceLocation = document.getElementById('spaceLocation')?.value;
        const spaceDescription = document.getElementById('spaceDescription')?.value || '';
        const amenities = Array.from(document.querySelectorAll('.amenities input:checked'))
            .map(cb => cb.value);

        if (!spaceName || !spaceLocation) {
            this.showToast('Please fill in the name and location fields.', 'warning');
            return;
        }

        if (!this.currentImage) {
            this.showToast('Please upload an image of the study space.', 'warning');
            return;
        }

        const studySpace = {
            id: Date.now(),
            name: spaceName,
            location: spaceLocation,
            description: spaceDescription,
            amenities: amenities,
            image: this.currentImage,
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            userId: this.userId
        };

        // Add to local array
        this.studySpaces.push(studySpace);

        // Save to localStorage
        this.saveToLocalStorage();

        // Sync to Firestore
        await this.syncToFirestore();

        // Reset form
        this.resetForm();

        // Refresh display
        this.displayStudySpaces();

        // Show success
        this.showToast('Study space saved successfully!', 'success');
    }

    /**
     * Reset the form
     */
    resetForm() {
        const spaceName = document.getElementById('spaceName');
        const spaceLocation = document.getElementById('spaceLocation');
        const spaceDescription = document.getElementById('spaceDescription');
        const form = document.querySelector('.study-space-form');
        const uploadArea = document.getElementById('studySpaceUpload');

        if (spaceName) spaceName.value = '';
        if (spaceLocation) spaceLocation.value = '';
        if (spaceDescription) spaceDescription.value = '';

        document.querySelectorAll('.amenities input').forEach(cb => cb.checked = false);

        if (form) form.style.display = 'none';

        if (uploadArea) {
            uploadArea.innerHTML = `
                <input type="file" id="spaceImageInput" accept="image/*" style="display: none;">
                <i class="bi bi-cloud-upload upload-icon"></i>
                <h3>Add New Study Space</h3>
                <p class="upload-hint">Click or drag and drop to upload an image</p>
            `;
            // Re-setup upload handlers
            this.setupUploadArea();
        }

        this.currentImage = null;
    }

    /**
     * Load study spaces from Firestore or localStorage
     * Waits for auth state to be ready before attempting Firestore operations
     */
    async loadStudySpaces() {
        try {
            // Wait for auth to be ready (either Firebase compat or modular)
            const waitForAuth = () => {
                return new Promise((resolve) => {
                    // Check if firebase.auth exists (compat SDK from HTML)
                    if (typeof firebase !== 'undefined' && firebase.auth) {
                        // Already have a user
                        if (firebase.auth().currentUser) {
                            resolve(firebase.auth().currentUser);
                            return;
                        }
                        // Wait for auth state change
                        const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
                            unsubscribe();
                            resolve(user);
                        });
                        // Timeout after 3 seconds
                        setTimeout(() => resolve(null), 3000);
                    } else if (window.auth && window.auth.currentUser) {
                        resolve(window.auth.currentUser);
                    } else {
                        // No auth available, resolve with null
                        setTimeout(() => resolve(null), 500);
                    }
                });
            };

            const user = await waitForAuth();

            if (!user) {
                console.log('StudySpaceController: No user signed in, loading from local storage only');
                // Fallback to localStorage
                const storage = window.getStorage ? window.getStorage() : {
                    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
                };
                this.studySpaces = storage.get('studySpaces', []);
                this.displayStudySpaces();
                return;
            }

            // Try Firestore
            if (typeof window.loadStudySpacesFromFirestore === 'function') {
                this.setSyncStatus(true, null);
                const firestoreSpaces = await window.loadStudySpacesFromFirestore();

                if (firestoreSpaces && Array.isArray(firestoreSpaces)) {
                    this.studySpaces = firestoreSpaces;
                    this.setSyncStatus(false, null);
                    this.syncStatus.lastSynced = new Date();
                    this.updateSyncStatusUI();
                    this.displayStudySpaces();
                    return;
                }
            }

            // Fallback to localStorage
            const storage = window.getStorage ? window.getStorage() : {
                get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
            };
            this.studySpaces = storage.get('studySpaces', []);
            this.displayStudySpaces();

        } catch (error) {
            console.error('Error loading study spaces:', error);
            this.setSyncStatus(false, error.message);
            this.studySpaces = [];
            this.displayStudySpaces();
        }
    }

    /**
     * Display study spaces in the container
     */
    displayStudySpaces() {
        const container = document.getElementById('studySpacesContainer');
        const noSpacesMessage = document.getElementById('noSpacesMessage');

        if (!container) return;

        container.innerHTML = '';

        if (this.studySpaces.length === 0) {
            if (noSpacesMessage) {
                noSpacesMessage.classList.remove('d-none');
                container.appendChild(noSpacesMessage);
            }
            return;
        }

        if (noSpacesMessage) {
            noSpacesMessage.classList.add('d-none');
        }

        this.studySpaces.forEach(space => {
            const card = document.createElement('div');
            card.className = 'col-md-6 col-lg-6 mb-4';
            card.innerHTML = `
                <div class="study-space-card h-100">
                    <img src="${space.image}" alt="${space.name}" 
                         class="img-fluid mb-3" 
                         style="border-radius: 8px; height: 180px; object-fit: cover; width: 100%;">
                    <h5 class="fw-bold">${space.name}</h5>
                    <p class="location text-muted small mb-2">
                        <i class="bi bi-geo-alt me-1"></i>${space.location}
                    </p>
                    ${space.description ? `<p class="description small mb-2">${space.description}</p>` : ''}
                    <div class="amenities-tags mb-3">
                        ${space.amenities?.map(amenity =>
                `<span class="badge bg-secondary me-1 mb-1">${amenity}</span>`
            ).join('') || ''}
                    </div>
                    <div class="d-flex justify-content-between align-items-center">
                        <small class="text-muted">${this.formatDate(space.createdAt)}</small>
                        <button class="btn btn-sm btn-outline-danger delete-btn" data-id="${space.id}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            `;

            // Add delete handler
            const deleteBtn = card.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', () => this.deleteSpace(space.id));

            container.appendChild(card);
        });
    }

    /**
     * Delete a study space
     */
    async deleteSpace(id) {
        if (!confirm('Are you sure you want to delete this study space?')) {
            return;
        }

        // Remove from array
        this.studySpaces = this.studySpaces.filter(space => space.id !== id);

        // Update localStorage
        this.saveToLocalStorage();

        // Delete from Firestore
        if (typeof window.deleteStudySpaceFromFirestore === 'function') {
            try {
                this.setSyncStatus(true, null);
                await window.deleteStudySpaceFromFirestore(id);
                this.setSyncStatus(false, null);
                this.syncStatus.lastSynced = new Date();
            } catch (error) {
                console.error('Error deleting from Firestore:', error);
                this.setSyncStatus(false, error.message);
            }
        }

        // Update UI
        this.displayStudySpaces();
        this.updateSyncStatusUI();
        this.showToast('Study space deleted', 'success');
    }

    /**
     * Save to localStorage
     */
    saveToLocalStorage() {
        const storage = window.getStorage ? window.getStorage() : {
            set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
        };
        storage.set('studySpaces', this.studySpaces);
    }

    /**
     * Sync to Firestore
     */
    async syncToFirestore() {
        if (typeof window.saveStudySpacesToFirestore !== 'function') {
            console.warn('Firestore integration not available');
            return false;
        }

        try {
            this.setSyncStatus(true, null);
            const success = await window.saveStudySpacesToFirestore(this.studySpaces);

            if (success) {
                this.syncStatus.lastSynced = new Date();
                this.setSyncStatus(false, null);
                return true;
            } else {
                this.setSyncStatus(false, 'Failed to sync with Firestore');
                return false;
            }
        } catch (error) {
            console.error('Error syncing to Firestore:', error);
            this.setSyncStatus(false, error.message);
            return false;
        }
    }

    /**
     * Force sync now
     */
    async forceSync() {
        const success = await this.syncToFirestore();
        if (success) {
            this.showToast('Study spaces synced successfully!', 'success');
        } else {
            this.showToast('Failed to sync. Please try again.', 'danger');
        }
        this.updateSyncStatusUI();
        return success;
    }

    /**
     * Set sync status
     */
    setSyncStatus(isSyncing, error) {
        this.syncStatus.isSyncing = isSyncing;
        this.syncStatus.error = error;
        this.updateSyncStatusUI();
    }

    /**
     * Update sync status UI
     */
    updateSyncStatusUI() {
        const syncStatusEl = document.getElementById('syncStatus');
        const syncIndicator = document.getElementById('syncStatusIndicator');
        const syncText = document.getElementById('syncStatusText');

        if (syncIndicator && syncText) {
            if (this.syncStatus.isSyncing) {
                syncIndicator.innerHTML = '<i class="bi bi-arrow-repeat text-warning"></i>';
                syncText.textContent = 'Syncing...';
            } else if (this.syncStatus.error) {
                syncIndicator.innerHTML = '<i class="bi bi-exclamation-triangle-fill text-danger"></i>';
                syncText.textContent = 'Sync error';
            } else if (this.syncStatus.lastSynced) {
                syncIndicator.innerHTML = '<i class="bi bi-check-circle-fill text-success"></i>';
                syncText.textContent = `Synced ${this.getTimeAgo(this.syncStatus.lastSynced)}`;
            } else {
                syncIndicator.innerHTML = '<i class="bi bi-cloud text-muted"></i>';
                syncText.textContent = 'Not synced';
            }
        }

        if (syncStatusEl) {
            if (this.syncStatus.isSyncing) {
                syncStatusEl.innerHTML = '<span class="badge bg-warning"><i class="bi bi-arrow-repeat"></i> Syncing...</span>';
                syncStatusEl.classList.remove('d-none');
            } else if (this.syncStatus.lastSynced) {
                syncStatusEl.innerHTML = '<span class="badge bg-success"><i class="bi bi-cloud-check"></i> Synced</span>';
                syncStatusEl.classList.remove('d-none');
            }
        }
    }

    /**
     * Format date for display
     */
    formatDate(dateString) {
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString();
        } catch {
            return 'Unknown';
        }
    }

    /**
     * Get time ago string
     */
    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - new Date(date)) / 1000);

        if (seconds < 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    /**
     * Show toast message
     */
    showToast(message, type = 'success') {
        const toastEl = document.getElementById('syncToast');
        if (!toastEl) {
            console.log(`[${type.toUpperCase()}] ${message}`);
            return;
        }

        const toastHeader = toastEl.querySelector('.toast-header');
        const toastBody = toastEl.querySelector('.toast-body');

        if (toastHeader) {
            toastHeader.className = `toast-header bg-${type} text-white`;
        }

        if (toastBody) {
            toastBody.textContent = message;
        }

        try {
            const toast = new bootstrap.Toast(toastEl);
            toast.show();
        } catch (e) {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.StudySpaceController = StudySpaceController;
}
