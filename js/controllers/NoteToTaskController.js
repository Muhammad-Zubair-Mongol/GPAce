/**
 * NoteToTaskController.js
 * Handles the flow of converting image notes to tasks using AI
 * Now supports Batch Scanning, Cost Optimization (Lazy Execution),
 * and Smart Content Classification (Academic vs Relaxed)
 */

import { storageService } from '../services/StorageService.js';
import { SemesterService } from '../services/SemesterService.js';
import { ToastService } from '../services/ToastService.js';
import taskService from '../services/TaskService.js';
import { app, auth } from '../firestore.js';
import { contentClassifier } from '../ContentClassifier.js';
import { contentClassifierUI } from '../ContentClassifierUI.js';

class NoteToTaskController {
    constructor() {
        this.analyzedTasks = [];
        this.batchImages = []; // Array of File objects
        this.classificationResult = null; // Academic vs Relaxed classification
        this.init();
    }

    init() {
        console.log('[NoteToTask] Initializing Controller with Smart Batch Support');

        // Expose global handlers
        window.handleNoteScan = () => this.triggerScan();
        window.processNoteImage = (input) => this.handleImageUpload(input);

        // Expose instance for specific callbacks
        window.noteToTaskController = this;

        // Setup Modal Listeners once DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupModalListeners());
        } else {
            this.setupModalListeners();
        }

        // 🛡️ Smart Guard: Prevent accidental navigation if user has unscanned images
        window.addEventListener('beforeunload', (e) => {
            if (this.batchImages.length > 0) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    setupModalListeners() {
        const createBtn = document.getElementById('createScannedTasksBtn');
        if (createBtn) {
            createBtn.addEventListener('click', () => this.createSelectedTasks());
        }

        // Bind FAB scan button
        const scanBtn = document.getElementById('scanNotesBtn');
        if (scanBtn) {
            scanBtn.addEventListener('click', () => this.triggerScan());
        }

        // Setup drag-and-drop on the preview grid
        this.setupDragAndDrop();
    }

    /**
     * Setup drag-and-drop functionality for the scan preview grid
     */
    setupDragAndDrop() {
        const dropZone = document.getElementById('scanPreviewGrid');
        if (!dropZone) {
            console.warn('[NoteToTask] Drop zone not found, will retry later');
            setTimeout(() => this.setupDragAndDrop(), 1000);
            return;
        }

        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // Visual feedback for drag events
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.style.borderColor = 'rgba(52, 152, 219, 0.7)';
                dropZone.style.background = 'rgba(52, 152, 219, 0.15)';
                dropZone.style.transform = 'scale(1.01)';
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                dropZone.style.background = 'rgba(0, 0, 0, 0.15)';
                dropZone.style.transform = 'scale(1)';
            });
        });

        // Handle dropped files
        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                this.handleBatchFiles(files);
            }
        });

        console.log('[NoteToTask] Drag-and-drop setup complete');
    }

    /**
     * Open file picker for batch file selection
     */
    openFilePicker() {
        // Ensure modal is open
        this.showModal();

        const fileInput = document.getElementById('batchFileInput');
        if (fileInput) {
            fileInput.value = '';
            fileInput.click();
        } else {
            // Fallback to single file input
            const singleInput = document.getElementById('noteScanInput');
            if (singleInput) {
                singleInput.value = '';
                singleInput.click();
            }
        }
    }

    /**
     * Handle batch file selection (multiple files)
     */
    async handleBatchFiles(files) {
        if (!files || files.length === 0) return;

        const fileArray = Array.from(files);
        const imageFiles = fileArray.filter(f => f.type.startsWith('image/'));

        if (imageFiles.length === 0) {
            ToastService.warning('Please select image files only');
            return;
        }

        ToastService.info(`Processing ${imageFiles.length} image(s)...`);

        // Process each file
        for (const file of imageFiles) {
            try {
                const compressedFile = await this.compressImage(file);
                console.log(`[NoteToTask] Compression: ${(file.size / 1024).toFixed(0)}KB -> ${(compressedFile.size / 1024).toFixed(0)}KB`);
                this.batchImages.push(compressedFile);
            } catch (error) {
                console.warn('[NoteToTask] Compression failed for', file.name, ', using original');
                this.batchImages.push(file);
            }
        }

        // Update UI
        this.renderBatchUI();
        ToastService.success(`Added ${imageFiles.length} page(s) - Total: ${this.batchImages.length}`);
    }

    triggerScan() {
        // UX: Show the modal immediately so user can see a dialog box
        this.showModal();

        const fileInput = document.getElementById('noteScanInput');
        if (fileInput) {
            // Reset value to allow selecting same file again if needed
            fileInput.value = '';
            fileInput.click();
        } else {
            console.error('Note scan input not found');
            ToastService.error('Scanner not initialized');
        }
    }

    async handleImageUpload(input) {
        if (!input.files || !input.files[0]) return;

        const originalFile = input.files[0];

        // 🚀 Smart Optimization: Compress Image Client-Side
        // This saves bandwidth for both Gemini Analysis and Drive Upload
        ToastService.info('Processing image...');

        try {
            const compressedFile = await this.compressImage(originalFile);
            console.log(`[NoteToTask] Compression: ${(originalFile.size / 1024).toFixed(0)}KB -> ${(compressedFile.size / 1024).toFixed(0)}KB`);

            // Add to batch
            this.batchImages.push(compressedFile);

            // Show modal and update UI
            this.showModal();
            this.renderBatchUI();

        } catch (error) {
            console.error('[NoteToTask] Compression failed, using original:', error);
            this.batchImages.push(originalFile);
            this.showModal();
            this.renderBatchUI();
        }
    }

    /**
     * Resizes and compresses image to reasonable dimensions for text extraction and storage.
     * Target: Max 1920px width/height, 80% JPEG quality.
     */
    compressImage(file) {
        return new Promise((resolve, reject) => {
            const MAX_WIDTH = 1920;
            const MAX_HEIGHT = 1920;
            const reader = new FileReader();

            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    let width = img.width;
                    let height = img.height;

                    // Calculate new dimensions
                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Export as JPEG with 0.8 quality
                    ctx.canvas.toBlob((blob) => {
                        const newFile = new File([blob], file.name, {
                            type: 'image/jpeg',
                            lastModified: Date.now(),
                        });
                        resolve(newFile);
                    }, 'image/jpeg', 0.8);
                };
                img.onerror = (err) => reject(err);
            };
            reader.onerror = (err) => reject(err);
        });
    }

    showModal() {
        const modal = document.getElementById('noteScanModal');
        if (modal) {
            modal.style.display = 'flex';
            modal.classList.add('active'); // Required for opacity transition
            this.showBatchView();
        }
    }

    showBatchView() {
        document.getElementById('scanBatchSection').style.display = 'block';
        document.getElementById('scanResults').style.display = 'none';
        // document.getElementById('scanSpinner').style.display = 'none'; // OLD
        this.hideProcessingOverlay();
    }

    renderBatchUI() {
        const grid = document.getElementById('scanPreviewGrid');
        const processBtn = document.getElementById('processBatchBtn');
        const addPageText = document.getElementById('addPageBtnText');

        if (!grid) return;

        // Clean previous thumbnails
        grid.innerHTML = '';

        if (this.batchImages.length === 0) {
            // Recreate the empty message element
            const emptyMsg = document.createElement('div');
            emptyMsg.id = 'emptyBatchMsg';
            emptyMsg.className = 'd-flex flex-column align-items-center justify-content-center text-muted w-100';
            emptyMsg.style.cssText = 'height: 130px; cursor: pointer;';
            emptyMsg.onclick = () => this.openFilePicker();
            emptyMsg.innerHTML = `
                <i class="fas fa-cloud-upload-alt mb-2" style="font-size: 2.5rem; opacity: 0.6;"></i>
                <span style="font-size: 0.9rem;">Drag & drop images here</span>
                <small class="mt-1" style="opacity: 0.7;">or click to browse files</small>
            `;
            grid.appendChild(emptyMsg);

            if (processBtn) processBtn.disabled = true;
            if (addPageText) addPageText.textContent = "Take Photo";
        } else {
            if (processBtn) processBtn.disabled = false;
            if (addPageText) addPageText.textContent = "Add Page";

            this.batchImages.forEach((file, index) => {
                const thumb = document.createElement('div');
                thumb.className = 'position-relative';
                thumb.style.cssText = 'min-width: 100px; width: 100px; height: 120px; flex-shrink: 0;';

                const img = document.createElement('img');
                img.className = 'w-100 h-100 object-fit-cover rounded border';
                img.src = URL.createObjectURL(file);
                img.title = `Page ${index + 1}: ${file.name}`;

                // Page number badge
                const pageBadge = document.createElement('span');
                pageBadge.className = 'position-absolute bottom-0 start-0 badge bg-dark ms-1 mb-1';
                pageBadge.style.fontSize = '0.7rem';
                pageBadge.textContent = `${index + 1}`;

                const removeBtn = document.createElement('button');
                removeBtn.className = 'btn btn-danger btn-sm p-0 position-absolute top-0 end-0 rounded-circle d-flex align-items-center justify-content-center';
                removeBtn.style.cssText = 'width: 22px; height: 22px; transform: translate(30%, -30%); font-size: 14px; line-height: 1;';
                removeBtn.innerHTML = '&times;';
                removeBtn.title = 'Remove this page';
                removeBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.removeBatchImage(index);
                };

                thumb.appendChild(img);
                thumb.appendChild(pageBadge);
                thumb.appendChild(removeBtn);
                grid.appendChild(thumb);
            });

            // Add a "+" card to add more images
            const addCard = document.createElement('div');
            addCard.className = 'd-flex align-items-center justify-content-center';
            addCard.style.cssText = 'min-width: 80px; width: 80px; height: 120px; background: rgba(255,255,255,0.1); border: 2px dashed rgba(255,255,255,0.3); border-radius: 8px; cursor: pointer; transition: all 0.2s;';
            addCard.innerHTML = '<i class="fas fa-plus text-muted" style="font-size: 1.5rem;"></i>';
            addCard.title = 'Add more pages';
            addCard.onclick = () => this.openFilePicker();
            addCard.onmouseenter = () => addCard.style.background = 'rgba(255,255,255,0.2)';
            addCard.onmouseleave = () => addCard.style.background = 'rgba(255,255,255,0.1)';
            grid.appendChild(addCard);
        }
    }

    removeBatchImage(index) {
        this.batchImages.splice(index, 1);
        this.renderBatchUI();
    }

    async processBatch() {
        if (this.batchImages.length === 0) return;

        if (!navigator.onLine) {
            ToastService.error('You are offline. Please check your connection.');
            return;
        }

        // UI State: Processing Overlay with live results
        document.getElementById('scanBatchSection').style.display = 'none';

        const pageCount = this.batchImages.length;

        // Show the results section immediately for progressive updates
        const resultsEl = document.getElementById('scanResults');
        resultsEl.style.display = 'block';

        // Initialize empty results list with progress indicator
        const container = document.getElementById('scanResultsList');
        container.innerHTML = `
            <div class="progressive-analysis-status text-center py-4" id="progressiveStatus">
                <div class="spinner-border text-primary mb-3" role="status"></div>
                <h5>Analyzing Page 1 of ${pageCount}...</h5>
                <div class="progress mt-3" style="height: 8px; background: rgba(255,255,255,0.1);">
                    <div class="progress-bar bg-primary" role="progressbar" style="width: 0%;" id="pageProgressBar"></div>
                </div>
                <p class="text-muted small mt-2">Tasks will appear here as they're extracted</p>
            </div>
        `;

        // Disable create button until we have at least one task
        const createBtn = document.getElementById('createScannedTasksBtn');
        if (createBtn) createBtn.disabled = true;

        try {
            // STEP 1: Init AI
            const subjects = this.getAvailableSubjects();
            const analyzer = await this.getAnalyzer();

            // Get classifier for local classification (fast, no API call)
            const classifier = typeof contentClassifier !== 'undefined'
                ? contentClassifier
                : window.contentClassifier;

            // Array to accumulate all tasks
            this.analyzedTasks = [];
            this.classificationResult = { academic: [], relaxed: [] };

            // Process each page SEQUENTIALLY with progressive UI updates
            for (let i = 0; i < pageCount; i++) {
                const pageNum = i + 1;

                // Update progress indicator
                this.updateProgressiveStatus(pageNum, pageCount, this.analyzedTasks.length);

                try {
                    // Analyze this single page
                    console.log(`[NoteToTask] Processing page ${pageNum}/${pageCount}...`);
                    const pageTasks = await analyzer.analyzeSinglePage(
                        this.batchImages[i],
                        subjects,
                        pageNum,
                        pageCount
                    );

                    if (Array.isArray(pageTasks) && pageTasks.length > 0) {
                        console.log(`[NoteToTask] Page ${pageNum}: found ${pageTasks.length} tasks`);

                        // Classify each task locally (fast, no API call)
                        for (const task of pageTasks) {
                            const classification = classifier?.quickClassify?.(task.content || task.title) || { type: 'academic' };
                            task.isRelaxed = classification.type === 'relaxed';
                            task.relaxedCategory = task.isRelaxed ? (classifier?.determineRelaxedCategory?.(task.content) || 'other') : null;

                            // Add to appropriate list
                            if (task.isRelaxed) {
                                this.classificationResult.relaxed.push(task);
                            } else {
                                this.classificationResult.academic.push(task);
                            }

                            // Add to master list
                            this.analyzedTasks.push(task);
                        }

                        // Immediately render new tasks (progressive update)
                        this.appendTasksToReviewList(pageTasks, pageNum);

                        // Enable create button now that we have tasks
                        if (createBtn) createBtn.disabled = false;

                        ToastService.success(`Page ${pageNum}: Found ${pageTasks.length} tasks`);
                    } else {
                        console.log(`[NoteToTask] Page ${pageNum}: no tasks found`);
                        ToastService.info(`Page ${pageNum}: No tasks found`);
                    }

                    // Delay before next page to avoid rate limiting
                    if (i < pageCount - 1) {
                        await new Promise(r => setTimeout(r, 2000)); // 2 second delay
                    }

                } catch (pageError) {
                    console.error(`[NoteToTask] Error on page ${pageNum}:`, pageError);

                    const errMsg = pageError.message?.toLowerCase() || '';

                    // Check for ANY quota/rate/key exhaustion error - FAIL FAST
                    const isQuotaError = errMsg.includes('429') ||
                        errMsg.includes('quota') ||
                        errMsg.includes('exhausted') ||
                        errMsg.includes('rate limit') ||
                        errMsg.includes('too many requests');

                    if (isQuotaError) {
                        ToastService.error('API quota exceeded. Please wait or add backup API keys in Settings.');

                        // ALWAYS stop on quota errors - no point trying more pages
                        if (this.analyzedTasks.length > 0) {
                            ToastService.warning(`Stopped at page ${pageNum}. Using ${this.analyzedTasks.length} tasks extracted so far.`);
                        }

                        // Break out of the loop immediately
                        break;
                    } else {
                        ToastService.warning(`Page ${pageNum} failed - continuing with other pages`);
                    }
                }
            }

            // Remove progress indicator
            const statusEl = document.getElementById('progressiveStatus');
            if (statusEl) statusEl.remove();

            // Final summary
            if (this.analyzedTasks.length > 0) {
                const academicCount = this.classificationResult.academic.length;
                const relaxedCount = this.classificationResult.relaxed.length;

                // Update header with summary
                this.showAnalysisSummary(academicCount, relaxedCount, pageCount);

                ToastService.success(`Done! Found ${this.analyzedTasks.length} tasks (${academicCount} academic, ${relaxedCount} relaxed)`);
            } else {
                container.innerHTML = `
                    <div class="text-center p-4">
                        <i class="fas fa-search text-muted mb-2" style="font-size: 2rem;"></i>
                        <p class="text-muted">No tasks found in the scanned notes.</p>
                        <p class="small text-muted">Try taking clearer photos or check your API key.</p>
                    </div>
                `;
            }

        } catch (error) {
            console.error('[NoteToTask] Analysis error:', error);
            ToastService.error(error.message || 'Analysis failed. Check API key/Quota.');

            // If we have some tasks, show them
            if (this.analyzedTasks.length > 0) {
                const statusEl = document.getElementById('progressiveStatus');
                if (statusEl) statusEl.remove();
                ToastService.warning(`Partial results: ${this.analyzedTasks.length} tasks extracted before error`);
            } else {
                // Go back to batch view on complete failure
                resultsEl.style.display = 'none';
                this.showBatchView();
            }
        }
    }

    /**
     * Update the progressive status indicator
     */
    updateProgressiveStatus(currentPage, totalPages, tasksSoFar) {
        const statusEl = document.getElementById('progressiveStatus');
        if (!statusEl) return;

        const progressPercent = (currentPage / totalPages) * 100;

        statusEl.innerHTML = `
            <div class="spinner-border text-primary mb-3" role="status"></div>
            <h5>Analyzing Page ${currentPage} of ${totalPages}...</h5>
            <div class="progress mt-3" style="height: 8px; background: rgba(255,255,255,0.1);">
                <div class="progress-bar bg-primary" role="progressbar" style="width: ${progressPercent}%;"></div>
            </div>
            <p class="text-muted small mt-2">
                ${tasksSoFar > 0 ? `${tasksSoFar} tasks extracted so far` : 'Tasks will appear here as they\'re extracted'}
            </p>
        `;
    }

    /**
     * Append newly extracted tasks to the review list (progressive update)
     */
    appendTasksToReviewList(tasks, pageNum) {
        const container = document.getElementById('scanResultsList');
        if (!container) return;

        // Get available subjects for dropdown
        const subjects = this.getAvailableSubjects();
        const subjectOptions = subjects.map(s =>
            `<option value="${s.tag}">${s.name}</option>`
        ).join('');

        const sectionOptions = [
            { value: 'Assignment', label: 'Assignment' },
            { value: 'Quizzes', label: 'Quiz' },
            { value: 'Mid Term / OHT', label: 'Mid Term / OHT' },
            { value: 'Finals', label: 'Final Exam' },
            { value: 'Revision', label: 'Revision' }
        ];

        const priorityOptions = [
            { value: 'low', label: 'Low', num: 1 },
            { value: 'medium', label: 'Medium', num: 2 },
            { value: 'high', label: 'High', num: 3 },
            { value: 'urgent', label: 'Urgent', num: 4 }
        ];

        tasks.forEach((task, index) => {
            const taskContent = task.content || task.title || 'Untitled Task';
            const taskSubject = task.subject || 'General';
            const taskSection = task.section || 'Assignment';
            const taskDueDate = task.dueDate || '';
            const taskDueString = task.due_string || '';
            const taskPriority = task.priority || 2;
            const isRelaxed = task.isRelaxed || false;
            const relaxedCategory = task.relaxedCategory || '';

            // Map priority number to string
            const priorityMap = { 1: 'low', 2: 'medium', 3: 'high', 4: 'urgent' };
            const priorityValue = priorityMap[taskPriority] || 'medium';

            // Build section options with selection
            const sectionSelectHtml = sectionOptions.map(opt =>
                `<option value="${opt.value}" ${taskSection === opt.value ? 'selected' : ''}>${opt.label}</option>`
            ).join('');

            // Build priority options with selection
            const prioritySelectHtml = priorityOptions.map(opt =>
                `<option value="${opt.value}" ${priorityValue === opt.value ? 'selected' : ''}>${opt.label}</option>`
            ).join('');

            // Classification badge and styling
            const classificationBadge = isRelaxed
                ? `<span class="badge bg-purple ms-2" style="background: linear-gradient(135deg, #9b59b6, #8e44ad);">
                    <i class="fas fa-coffee me-1"></i>${relaxedCategory || 'Relaxed'}
                   </span>`
                : `<span class="badge bg-primary ms-2">
                    <i class="fas fa-graduation-cap me-1"></i>Academic
                   </span>`;

            // Border color based on classification
            const borderStyle = isRelaxed
                ? 'border-left: 4px solid #9b59b6;'
                : 'border-left: 4px solid #3498db;';

            const item = document.createElement('div');
            item.className = 'scan-result-item card mb-2';
            item.style.cssText = borderStyle;
            item.innerHTML = `
                <div class="card-body p-3">
                    <div class="d-flex align-items-start gap-2 mb-2">
                        <input type="checkbox" class="form-check-input task-select" checked style="margin-top: 4px;">
                        <div class="flex-grow-1">
                            <div class="d-flex align-items-center">
                                <input type="text" class="form-control form-control-sm task-title fw-bold" value="${this.escapeHtml(taskContent)}">
                                ${classificationBadge}
                                <span class="badge bg-secondary ms-1">Page ${pageNum}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="task-details" style="margin-left: 24px;">
                        <!-- Description -->
                        <textarea class="form-control form-control-sm task-description mb-2" rows="1" placeholder="Additional details...">${task.description || ''}</textarea>
                        
                        <!-- Subject and Section Row -->
                        <div class="row g-2 mb-2">
                            <div class="col-6">
                                <label class="form-label small text-muted mb-1">Subject</label>
                                <select class="form-select form-select-sm task-project">
                                    ${subjectOptions}
                                </select>
                            </div>
                            <div class="col-6">
                                <label class="form-label small text-muted mb-1">Section</label>
                                <select class="form-select form-select-sm task-section">
                                    ${sectionSelectHtml}
                                </select>
                            </div>
                        </div>

                        <!-- Due Date and Priority Row -->
                        <div class="row g-2">
                            <div class="col-6">
                                <label class="form-label small text-muted mb-1">Due Date & Time</label>
                                <input type="datetime-local" class="form-control form-control-sm task-due-date" value="${taskDueDate ? taskDueDate + 'T23:59' : ''}">
                            </div>
                            <div class="col-6">
                                <label class="form-label small text-muted mb-1">Priority</label>
                                <select class="form-select form-select-sm task-priority">
                                    ${prioritySelectHtml}
                                </select>
                            </div>
                        </div>

                        <!-- AI Detected Info Badge -->
                        ${taskDueString ? `
                            <div class="mt-2">
                                <span class="badge bg-info text-dark">
                                    <i class="fas fa-robot me-1"></i>
                                    AI detected: "${this.escapeHtml(taskDueString)}"
                                </span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;

            // Select the correct subject
            const projectSelect = item.querySelector('.task-project');
            if (projectSelect) {
                const matchingOption = Array.from(projectSelect.options).find(opt =>
                    opt.value === taskSubject || opt.textContent.toLowerCase().includes(taskSubject.toLowerCase())
                );
                if (matchingOption) projectSelect.value = matchingOption.value;
            }

            // Insert before the progress indicator (if it exists), otherwise append
            const statusEl = document.getElementById('progressiveStatus');
            if (statusEl) {
                container.insertBefore(item, statusEl);
            } else {
                container.appendChild(item);
            }
        });
    }

    /**
     * Show analysis summary header
     */
    showAnalysisSummary(academicCount, relaxedCount, pageCount) {
        const container = document.getElementById('scanResultsList');
        if (!container) return;

        // Check if summary already exists
        if (container.querySelector('.analysis-summary-banner')) return;

        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'analysis-summary-banner mb-3';
        summaryDiv.style.cssText = `
            background: linear-gradient(135deg, rgba(52, 152, 219, 0.1), rgba(155, 89, 182, 0.1));
            border: 1px solid rgba(52, 152, 219, 0.3);
            border-radius: 12px;
            padding: 16px;
        `;
        summaryDiv.innerHTML = `
            <div class="d-flex align-items-center gap-3">
                <span style="font-size: 28px;">✅</span>
                <div>
                    <h5 class="mb-1" style="color: var(--text-primary, #fff);">Analysis Complete!</h5>
                    <p class="mb-0 small" style="color: var(--text-secondary, #888);">
                        Scanned ${pageCount} page(s) • 
                        <span style="color: #3498db;"><i class="fas fa-graduation-cap"></i> ${academicCount} academic</span> • 
                        <span style="color: #9b59b6;"><i class="fas fa-coffee"></i> ${relaxedCount} relaxed</span>
                    </p>
                </div>
            </div>
        `;

        container.insertBefore(summaryDiv, container.firstChild);
    }

    // Hardened helper to upload to Google Drive with concurrency limit and error handling
    async uploadBatchToGoogleDrive(files, progressCallback) {
        if (!window.googleDriveAPI) {
            throw new Error('Google Drive API not initialized');
        }

        if (!navigator.onLine) {
            throw new Error('No internet connection.');
        }

        // Ensure Auth with interactive fallback if needed
        try {
            await window.googleDriveAPI.authorize(true);
        } catch (e) {
            console.warn('[NoteToTask] Silent auth failed, trying interactive...');
            await window.googleDriveAPI.authorize(false);
        }

        // Validate Token
        const token = gapi.client.getToken();
        if (!token?.access_token) {
            throw new Error('No valid Google Drive token available.');
        }

        // Create/Get a "Scanned Notes" folder structure in GPAce
        let folderId;
        try {
            folderId = await window.googleDriveAPI.createFolderStructure('Scanned Notes', 'Inbox');
        } catch (e) {
            console.error('[NoteToTask] Failed to create folder structure:', e);
            throw new Error('Could not create destination folder in Drive.');
        }

        const results = [];
        const errors = [];
        const CONCURRENCY_LIMIT = 3;
        const total = files.length;

        // Process files in chunks to avoid rate limiting
        for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
            const chunk = files.slice(i, i + CONCURRENCY_LIMIT);

            // 🚀 UX Update
            if (progressCallback) progressCallback(i + 1, total);

            const chunkPromises = chunk.map(async (file, chunkIndex) => {
                const originalIndex = i + chunkIndex;
                try {
                    const newFileName = `Scanned_Page_${originalIndex + 1}_${Date.now()}.jpg`;
                    const metadata = {
                        name: newFileName,
                        mimeType: file.type || 'image/jpeg',
                        parents: [folderId],
                        appProperties: {
                            appName: 'GPAce',
                            uploadDate: new Date().toISOString(),
                            type: 'scanned_note'
                        }
                    };

                    // Re-fetch token just in case it expired during long batch
                    const freshestToken = gapi.client.getToken();

                    const result = await window.googleDriveAPI.directUploadFileWithToken(
                        file,
                        metadata,
                        freshestToken.access_token
                    );

                    // Make public/Get Info
                    await window.googleDriveAPI.makeFilePublic(result.id);
                    const fileInfo = await window.googleDriveAPI.getFileInfo(result.id);

                    return {
                        status: 'fulfilled',
                        value: {
                            name: newFileName,
                            url: fileInfo.webViewLink,
                            iconLink: fileInfo.iconLink,
                            fileId: fileInfo.id,
                            mimeType: fileInfo.mimeType
                        }
                    };

                } catch (err) {
                    console.error(`[NoteToTask] Failed to upload image ${originalIndex + 1}:`, err);
                    return { status: 'rejected', reason: err, index: originalIndex };
                }
            });

            const chunkResults = await Promise.all(chunkPromises);

            // Sort results
            chunkResults.forEach(res => {
                if (res.status === 'fulfilled') {
                    results.push(res.value);
                } else {
                    errors.push(res.reason);
                }
            });
        }

        if (errors.length > 0) {
            console.warn(`[NoteToTask] ${errors.length} images failed to upload.`);
            ToastService.warn(`Warning: ${errors.length} image(s) failed to upload.`);
        }

        console.log('[NoteToTask] Batch upload completed.', { success: results.length, failed: errors.length });
        return results;
    }

    async getAnalyzer() {
        let apiKey = window.apiKeys?.gemini;
        if (!apiKey && window.SecureStorage) {
            apiKey = await window.SecureStorage.getSecure('geminiApiKey', '');
        }
        if (!apiKey) {
            apiKey = localStorage.getItem('geminiApiKey') || storageService.get('geminiApiKey');
        }

        const modelName = storageService.get('api.geminiModel') || 'gemini-3.6-flash';

        if (!apiKey) throw new Error('Please configure Gemini API Key first.');

        let analyzer;
        if (window.imageAnalyzer) {
            analyzer = window.imageAnalyzer;
        } else if (window.ImageAnalyzer) {
            analyzer = new window.ImageAnalyzer();
            window.imageAnalyzer = analyzer;
        } else {
            throw new Error('ImageAnalyzer module missing.');
        }

        await analyzer.initialize(apiKey, modelName);
        return analyzer;
    }

    renderReviewList(tasks, classification = null) {
        const container = document.getElementById('scanResultsList');
        if (!container) {
            console.error('[NoteToTask] scanResultsList container not found');
            return;
        }
        container.innerHTML = '';

        if (!tasks || tasks.length === 0) {
            container.innerHTML = `
                <div class="text-center p-4">
                    <i class="fas fa-search text-muted mb-2" style="font-size: 2rem;"></i>
                    <p class="text-muted">No tasks found in the scanned notes.</p>
                </div>`;
            return;
        }

        // Show classification summary if we have it
        if (classification && classification.relaxed && classification.relaxed.length > 0) {
            const summaryDiv = document.createElement('div');
            summaryDiv.className = 'classification-summary-banner';
            summaryDiv.style.cssText = `
                background: linear-gradient(135deg, rgba(155, 89, 182, 0.1), rgba(52, 152, 219, 0.05));
                border: 1px solid rgba(155, 89, 182, 0.3);
                border-radius: 12px;
                padding: 14px 18px;
                margin-bottom: 16px;
                display: flex;
                align-items: center;
                gap: 12px;
            `;
            summaryDiv.innerHTML = `
                <span style="font-size: 24px;">🎯</span>
                <div>
                    <strong style="color: var(--text-primary, #fff);">Smart Classification Active</strong>
                    <p style="margin: 4px 0 0; font-size: 13px; color: var(--text-secondary, #888);">
                        <span style="color: #3498db;">${classification.academic.length} academic</span> • 
                        <span style="color: #9b59b6;">${classification.relaxed.length} relaxed/extracurricular</span>
                    </p>
                </div>
            `;
            container.appendChild(summaryDiv);
        }

        // Get available subjects for dropdown
        const subjects = this.getAvailableSubjects();
        const subjectOptions = subjects.map(s =>
            `<option value="${s.tag}">${s.name}</option>`
        ).join('');

        // Predefined section types from subject-marks.js
        const sectionOptions = [
            { value: 'Assignment', label: 'Assignment' },
            { value: 'Quizzes', label: 'Quiz' },
            { value: 'Mid Term / OHT', label: 'Mid Term / OHT' },
            { value: 'Finals', label: 'Final Exam' },
            { value: 'Revision', label: 'Revision' }
        ];

        // Priority mapping
        const priorityOptions = [
            { value: 'low', label: 'Low', num: 1 },
            { value: 'medium', label: 'Medium', num: 2 },
            { value: 'high', label: 'High', num: 3 }
        ];

        tasks.forEach((task, index) => {
            const item = document.createElement('div');
            item.className = 'scan-result-item';

            // Safely get values with defaults
            const taskContent = (task.content || '').trim();
            const taskSubject = task.subject || '';
            const taskSection = task.section || 'Assignment';
            const taskDueDate = task.dueDate || '';
            const taskDueString = task.due_string || '';
            const taskPriority = task.priority || 2;
            const taskDescription = task.description || taskDueString || '';

            // Build section select options
            const sectionSelectHtml = sectionOptions.map(opt =>
                `<option value="${opt.value}" ${taskSection === opt.value ? 'selected' : ''}>${opt.label}</option>`
            ).join('');

            // Build subject select with matching
            const subjectSelectHtml = subjects.map(s => {
                const isMatch = s.tag === taskSubject || s.name.toLowerCase().includes(taskSubject.toLowerCase());
                return `<option value="${s.tag}" ${isMatch ? 'selected' : ''}>${s.name}</option>`;
            }).join('');

            // Build priority select
            const prioritySelectHtml = priorityOptions.map(opt =>
                `<option value="${opt.value}" ${taskPriority === opt.num ? 'selected' : ''}>${opt.label}</option>`
            ).join('');

            item.innerHTML = `
                <div class="scan-result-card p-3 mb-3 border rounded" style="background: var(--card-bg, #1e1e1e);">
                    <div class="d-flex align-items-start gap-3">
                        <div class="pt-1">
                            <input type="checkbox" checked class="form-check-input task-select" data-index="${index}" style="width: 1.2rem; height: 1.2rem;">
                        </div>
                        <div class="flex-grow-1">
                            <!-- Task Title -->
                            <div class="mb-3">
                                <label class="form-label small text-muted mb-1">Task Title</label>
                                <input type="text" class="form-control task-title" value="${this.escapeHtml(taskContent)}" placeholder="Enter task title">
                            </div>

                            <!-- Description -->
                            <div class="mb-3">
                                <label class="form-label small text-muted mb-1">Description</label>
                                <textarea class="form-control task-description" rows="2" placeholder="Additional details...">${this.escapeHtml(taskDescription)}</textarea>
                            </div>

                            <!-- Project and Section Row -->
                            <div class="row g-2 mb-3">
                                <div class="col-6">
                                    <label class="form-label small text-muted mb-1">Project/Subject</label>
                                    <select class="form-select form-select-sm task-project">
                                        <option value="">-- Select Subject --</option>
                                        ${subjectSelectHtml}
                                    </select>
                                </div>
                                <div class="col-6">
                                    <label class="form-label small text-muted mb-1">Category</label>
                                    <select class="form-select form-select-sm task-section">
                                        ${sectionSelectHtml}
                                    </select>
                                </div>
                            </div>

                            <!-- Due Date and Priority Row -->
                            <div class="row g-2">
                                <div class="col-6">
                                    <label class="form-label small text-muted mb-1">Due Date & Time</label>
                                    <input type="datetime-local" class="form-control form-control-sm task-due-date" value="${taskDueDate ? taskDueDate + 'T23:59' : ''}">
                                </div>
                                <div class="col-6">
                                    <label class="form-label small text-muted mb-1">Priority</label>
                                    <select class="form-select form-select-sm task-priority">
                                        ${prioritySelectHtml}
                                    </select>
                                </div>
                            </div>

                            <!-- AI Detected Info Badge -->
                            ${taskDueString ? `
                                <div class="mt-2">
                                    <span class="badge bg-info text-dark">
                                        <i class="fas fa-robot me-1"></i>
                                        AI detected: "${this.escapeHtml(taskDueString)}"
                                    </span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(item);
        });
    }

    // Helper to escape HTML special characters
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async createSelectedTasks() {
        const container = document.getElementById('scanResultsList');
        if (!container) {
            console.error('[NoteToTask] Container not found');
            ToastService.error('Error: Container not found');
            return;
        }

        const items = container.querySelectorAll('.scan-result-item');
        const tasksToCreate = [];

        items.forEach((item) => {
            const checkbox = item.querySelector('.task-select');
            if (checkbox && checkbox.checked) {
                const titleEl = item.querySelector('.task-title');
                const descEl = item.querySelector('.task-description');
                const projectEl = item.querySelector('.task-project');
                const sectionEl = item.querySelector('.task-section');
                const dueDateEl = item.querySelector('.task-due-date');
                const priorityEl = item.querySelector('.task-priority');

                // Validate required fields
                const title = titleEl?.value?.trim();
                if (!title) {
                    console.warn('[NoteToTask] Skipping task with empty title');
                    return; // Skip this item
                }

                tasksToCreate.push({
                    title: title,
                    content: title, // For classification matching
                    description: descEl?.value?.trim() || '',
                    project: projectEl?.value || 'General',
                    section: sectionEl?.value || 'Assignment',
                    dueDate: dueDateEl?.value || '',
                    priority: priorityEl?.value || 'medium'
                });
            }
        });

        if (tasksToCreate.length === 0) {
            ToastService.warning('No valid tasks to create. Please check task titles.');
            return;
        }

        // --- SMART CONTENT ROUTING ---
        // Check if we have classification results and relaxed items
        let academicTasks = tasksToCreate;
        let relaxedTasks = [];
        let relaxedTasksSaved = 0;

        // Get classifier modules (import or window global)
        const classifier = typeof contentClassifier !== 'undefined'
            ? contentClassifier
            : window.contentClassifier;
        const classifierUI = typeof contentClassifierUI !== 'undefined'
            ? contentClassifierUI
            : window.contentClassifierUI;

        if (this.classificationResult && this.classificationResult.relaxed.length > 0 && classifier) {
            // Match selected tasks against classification
            const relaxedContents = new Set(
                this.classificationResult.relaxed.map(t =>
                    (t.content || t.title || '').toLowerCase().trim()
                )
            );

            // Separate tasks
            academicTasks = [];
            relaxedTasks = [];

            const simFunc = classifier.calculateSimilarity?.bind(classifier) ||
                ((a, b) => a === b ? 1 : 0);

            tasksToCreate.forEach(task => {
                const taskContent = task.title.toLowerCase().trim();
                // Check if this task matches any relaxed content
                const isRelaxed = this.classificationResult.relaxed.some(rt => {
                    const rtContent = (rt.content || rt.title || '').toLowerCase().trim();
                    return taskContent.includes(rtContent) || rtContent.includes(taskContent) ||
                        simFunc(taskContent, rtContent) > 0.7;
                });

                if (isRelaxed) {
                    // Find the matching relaxed task to get category
                    const matchingRelaxed = this.classificationResult.relaxed.find(rt => {
                        const rtContent = (rt.content || rt.title || '').toLowerCase().trim();
                        return taskContent.includes(rtContent) || rtContent.includes(taskContent);
                    });
                    relaxedTasks.push({
                        ...task,
                        relaxedCategory: matchingRelaxed?.relaxedCategory || 'other'
                    });
                } else {
                    academicTasks.push(task);
                }
            });

            console.log('[NoteToTask] Routing:', {
                academic: academicTasks.length,
                relaxed: relaxedTasks.length
            });

            // Show confirmation modal if relaxed tasks detected
            if (relaxedTasks.length > 0 && classifierUI) {
                try {
                    const result = await classifierUI.showConfirmation(
                        relaxedTasks,
                        academicTasks.length
                    );

                    if (result.cancelled) {
                        // User cancelled - abort everything
                        return;
                    }

                    if (result.confirmed && result.selectedTasks.length > 0 && classifier.saveRelaxedTasks) {
                        // Save relaxed tasks
                        relaxedTasksSaved = classifier.saveRelaxedTasks(result.selectedTasks);
                    }
                } catch (modalErr) {
                    console.warn('[NoteToTask] Modal error, continuing with academic only:', modalErr);
                }
            }
        }

        // If no academic tasks left, just close
        if (academicTasks.length === 0 && relaxedTasksSaved > 0) {
            if (classifierUI?.showSuccessToast) {
                classifierUI.showSuccessToast(relaxedTasksSaved);
            }
            this.closeModal();
            return;
        }

        const btn = document.getElementById('createScannedTasksBtn');
        const originalText = btn?.innerHTML || 'Create';

        // Hide Results, Show Overlay again
        const resultsEl = document.getElementById('scanResults');
        if (resultsEl) resultsEl.style.display = 'none';
        this.showProcessingOverlay('Syncing to Cloud...', 'Uploading images and creating tasks.');

        try {
            // Upload Images First (to Google Drive)
            let uploadedAttachments = [];
            if (this.batchImages.length > 0) {
                try {
                    uploadedAttachments = await this.uploadBatchToGoogleDrive(this.batchImages, (current, total) => {
                        this.updateProcessingStatus('Uploading Images...', `Uploading page ${current} of ${total} to Google Drive.`);
                    });
                } catch (uploadErr) {
                    console.warn('[NoteToTask] Image upload failed, continuing without attachments:', uploadErr);
                    // Continue without attachments - don't fail the whole operation
                }
            }

            this.updateProcessingStatus('Finalizing...', 'Saving tasks to your list.');

            let createdCount = 0;
            let failedCount = 0;

            // Create only ACADEMIC tasks
            for (const task of academicTasks) {
                try {
                    // Build description with attachments
                    let fullDescription = task.description || 'Created from scanned notes.';

                    // Add attachment links to description for markdown compatibility
                    if (uploadedAttachments.length > 0) {
                        fullDescription += '\n\n**Attachments:**\n';
                        uploadedAttachments.forEach(att => {
                            fullDescription += `- [${att.name}](${att.url})\n`;
                        });
                    }

                    await taskService.createTask(task.project, {
                        title: task.title,
                        description: fullDescription,
                        dueDate: task.dueDate,
                        priority: task.priority,
                        section: task.section,
                        completed: false,
                        // Pass formatted attachments array for the Task object
                        attachments: uploadedAttachments.map(att => ({
                            id: att.fileId,
                            name: att.name,
                            url: att.url,
                            type: att.mimeType,
                            iconLink: att.iconLink
                        }))
                    });
                    createdCount++;
                } catch (taskErr) {
                    console.error('[NoteToTask] Failed to create task:', task.title, taskErr);
                    failedCount++;
                }
            }

            // Build success message
            let successMsg = `Created ${createdCount} academic tasks`;
            if (uploadedAttachments.length > 0) {
                successMsg += ' with Drive attachments';
            }
            if (relaxedTasksSaved > 0) {
                successMsg += ` + ${relaxedTasksSaved} relaxed mode tasks`;
            }
            successMsg += '!';

            if (createdCount > 0 || relaxedTasksSaved > 0) {
                ToastService.success(successMsg);
                this.closeModal();
                window.dispatchEvent(new CustomEvent('tasks-updated'));
            }

        } catch (e) {
            console.error('[NoteToTask] Failed to create tasks/upload:', e);
            ToastService.error('Failed to save. Check Drive connection.' + e.message);
            // On error, go back to results view so they can try again
            this.hideProcessingOverlay();
            document.getElementById('scanResults').style.display = 'block';
        }
    }

    // --- New UI Helpers ---

    showProcessingOverlay() {
        // Reset all steps first
        ['step-optimize', 'step-init', 'step-analyze', 'step-finalize'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.className = 'process-step pending';
                const icon = el.querySelector('.step-icon i');
                if (icon) icon.className = 'fas fa-circle-notch';
            }
        });

        const overlay = document.getElementById('scanProcessingOverlay');
        if (overlay) overlay.style.display = 'flex';
    }

    hideProcessingOverlay() {
        const overlay = document.getElementById('scanProcessingOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    // Updates the processing overlay status text dynamically
    updateProcessingStatus(title, subtitle) {
        const overlay = document.getElementById('scanProcessingOverlay');
        if (!overlay) return;

        // Update the title if there's an h4 element
        const titleEl = overlay.querySelector('h4');
        if (titleEl && title) {
            titleEl.textContent = title;
        }

        // If there's no subtitle area, we could update step labels or just log
        console.log(`[NoteToTask] Status: ${title} - ${subtitle}`);
    }

    /* 
     * Updates the visual state of a step in the checklist 
     * status: 'pending' | 'active' | 'complete'
     */
    setStepStatus(stepId, status) {
        const el = document.getElementById(stepId);
        if (!el) return;

        // Reset classes
        el.className = `process-step ${status}`;

        // Icon management
        const icon = el.querySelector('.step-icon i');
        if (icon) {
            if (status === 'complete') {
                icon.className = 'fas fa-check';
            } else if (status === 'active') {
                icon.className = 'fas fa-circle-notch fa-spin';
            } else {
                icon.className = 'fas fa-circle-notch';
            }
        }
    }

    closeModal() {
        const modal = document.getElementById('noteScanModal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
        }

        // Reset state
        this.batchImages = [];
        this.analyzedTasks = [];
        this.classificationResult = null; // Reset classification for next scan
        this.renderBatchUI();
    }

    getAvailableSubjects() {
        const allSemesters = storageService.get('academicSemesters', {});
        const currentSemester = SemesterService.getCurrentSemester();
        let subjects = allSemesters[currentSemester]?.subjects || storageService.get('academicSubjects', []);

        return subjects.map(s => ({
            name: s.name,
            tag: s.tag || s.name.substring(0, 3).toUpperCase()
        }));
    }

    /**
     * Escape HTML special characters to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize and export
const noteToTaskController = new NoteToTaskController();
export default noteToTaskController;
window.noteToTaskController = noteToTaskController;
