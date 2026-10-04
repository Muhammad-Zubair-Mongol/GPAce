/**
 * ScheduleController - Handles wake/sleep time inputs and timetable upload/analysis
 */

function getGpaceApiClient() {
    if (window.gpaceApiClient) return Promise.resolve(window.gpaceApiClient);
    if (!window.__gpaceApiClientPromise) {
        const moduleUrl = new URL('/js/services/ApiClient.js', window.location.origin).href;
        window.__gpaceApiClientPromise = import(moduleUrl).then(({ getApiClient }) => getApiClient());
    }
    return window.__gpaceApiClientPromise;
}

class ScheduleController {
    constructor() {
        this.schedule = {
            wakeTime: null,
            wakeBuffer: 0,
            sleepTime: null,
            sleepBuffer: 0,
            timetableImage: null
        };
        this.userId = 'default';
    }

    /**
     * Initialize the controller
     */
    init() {
        this.setupTimeInputs();
        this.setupTimetableUpload();
    }

    /**
     * Set user ID for API calls
     */
    setUserId(userId) {
        this.userId = userId;
    }

    /**
     * Get current schedule state
     */
    getSchedule() {
        return this.schedule;
    }

    /**
     * Set schedule from loaded settings
     */
    setSchedule(schedule) {
        this.schedule = { ...this.schedule, ...schedule };
        this.restoreScheduleSettings();
    }

    /**
     * Setup time input event listeners
     */
    setupTimeInputs() {
        const wakeTimeInput = document.getElementById('wakeTime');
        const sleepTimeInput = document.getElementById('sleepTime');

        if (!wakeTimeInput || !sleepTimeInput) {
            console.warn('ScheduleController: Time inputs not found');
            return;
        }

        const wakeBuffer = document.getElementById('wakeBuffer');
        const sleepBuffer = document.getElementById('sleepBuffer');

        wakeTimeInput.addEventListener('change', (e) => {
            this.schedule.wakeTime = e.target.value;
            this.onScheduleChange();
        });

        if (wakeBuffer) {
            wakeBuffer.addEventListener('change', (e) => {
                this.schedule.wakeBuffer = parseInt(e.target.value);
                this.onScheduleChange();
            });
        }

        sleepTimeInput.addEventListener('change', (e) => {
            this.schedule.sleepTime = e.target.value;
            this.onScheduleChange();
        });

        if (sleepBuffer) {
            sleepBuffer.addEventListener('change', (e) => {
                this.schedule.sleepBuffer = parseInt(e.target.value);
                this.onScheduleChange();
            });
        }
    }

    /**
     * Setup timetable upload with drag and drop
     */
    setupTimetableUpload() {
        const timetableUpload = document.getElementById('timetableUpload');
        const fileInput = document.getElementById('timetableInput');

        if (!timetableUpload || !fileInput) {
            console.warn('ScheduleController: Timetable upload elements not found');
            return;
        }

        // Drag and drop handlers
        timetableUpload.addEventListener('dragover', (e) => {
            e.preventDefault();
            timetableUpload.classList.add('dragover');
        });

        timetableUpload.addEventListener('dragleave', () => {
            timetableUpload.classList.remove('dragover');
        });

        timetableUpload.addEventListener('drop', async (e) => {
            e.preventDefault();
            timetableUpload.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                await this.handleTimetableImage(file);
            }
        });

        // Click upload
        timetableUpload.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.handleTimetableImage(file);
            }
        });
    }

    /**
     * Handle timetable image upload and analysis
     */
    async handleTimetableImage(file) {
        try {
            const client = await getGpaceApiClient();
            const result = await client.upload(file);
            const upload = result && result.uploads && result.uploads[0];

            if (upload && upload.uploadId) {
                const uploadArea = document.getElementById('timetableUpload');
                const previewDiv = document.getElementById('timetablePreview');
                const previewUrl = URL.createObjectURL(file);

                if (previewDiv) {
                    previewDiv.innerHTML = `
                        <img src="${previewUrl}" alt="Class timetable"
                             style="max-width: 100%; height: 300px; object-fit: contain; border-radius: 8px;">
                        <p class="mt-2 text-muted">Click upload area to change image</p>
                    `;
                }

                this.schedule.timetableImage = {
                    uploadId: upload.uploadId,
                    fileName: upload.fileName || file.name,
                    previewUrl,
                    uploadTime: new Date().toISOString()
                };

                // Analyze the timetable
                await this.analyzeTimetable(upload.uploadId);

                this.onScheduleChange();

                if (window.soundManager) {
                    window.soundManager.playSound('click', 'confirm');
                }
            }
        } catch (error) {
            console.error('Error uploading timetable:', error);
            if (error && error.authFailure) {
                this.showError('Please sign in again. Your timetable draft is still selected.');
            } else {
                this.showError('Error uploading timetable. Please try again.');
            }
        }
    }

    /**
     * Analyze uploaded timetable image
     */
    async analyzeTimetable(uploadId) {
        try {
            const client = await getGpaceApiClient();
            const analysis = await client.post('/api/analyze-timetable', { uploadId });

            if (!analysis.error) {
                this.displayTimetableAnalysis(analysis);
                return analysis;
            } else {
                console.error('Analysis error:', analysis.error);
                return null;
            }
        } catch (error) {
            console.error('Error analyzing timetable:', error);
            if (error && error.authFailure) {
                this.showError('Please sign in again. Your timetable draft is still selected.');
            }
            return null;
        }
    }

    /**
     * Display timetable analysis results
     */
    displayTimetableAnalysis(analysis) {
        const analysisDiv = document.getElementById('timetableAnalysis');
        if (!analysisDiv) return;

        analysisDiv.style.display = 'block';
        analysisDiv.classList.add('fade-in');

        // Dispatch event for TimetableController to handle visualization
        window.dispatchEvent(new CustomEvent('timetableAnalyzed', { detail: analysis }));
    }

    /**
     * Restore schedule settings from saved data
     */
    restoreScheduleSettings() {
        const wakeTime = document.getElementById('wakeTime');
        const sleepTime = document.getElementById('sleepTime');
        const wakeBuffer = document.getElementById('wakeBuffer');
        const sleepBuffer = document.getElementById('sleepBuffer');

        if (this.schedule.wakeTime && wakeTime) wakeTime.value = this.schedule.wakeTime;
        if (this.schedule.sleepTime && sleepTime) sleepTime.value = this.schedule.sleepTime;
        if (this.schedule.wakeBuffer && wakeBuffer) wakeBuffer.value = this.schedule.wakeBuffer;
        if (this.schedule.sleepBuffer && sleepBuffer) sleepBuffer.value = this.schedule.sleepBuffer;

        if (this.schedule.timetableImage) {
            const previewDiv = document.getElementById('timetablePreview');
            if (previewDiv) {
                previewDiv.innerHTML = `
                    <img src="${this.schedule.timetableImage.path}" alt="Class timetable"
                         style="max-width: 100%; height: 300px; object-fit: contain; border-radius: 8px;">
                    <p class="mt-2 text-muted">Click upload area to change image</p>
                `;
            }
        }
    }

    /**
     * Called when schedule changes - override or listen to events
     */
    onScheduleChange() {
        window.dispatchEvent(new CustomEvent('scheduleChanged', { detail: this.schedule }));
    }

    /**
     * Show error message
     */
    showError(message) {
        if (typeof window.showErrorToast === 'function') {
            window.showErrorToast(message);
        } else {
            alert(message);
        }
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.ScheduleController = ScheduleController;
}
