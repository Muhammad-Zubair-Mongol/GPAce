/**
 * Speech Recognition Module for GPAce Workspace
 * Implements real-time transcription and summarization using Web Speech API and Gemini API
 */

class SpeechRecognitionManager {
    constructor() {
        // Check if browser supports speech recognition
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.error('Speech recognition not supported in this browser');
            this.isSupported = false;
            return;
        }

        this.isSupported = true;
        // Use the appropriate constructor based on browser support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.isRecording = false;
        this.isPaused = false;
        this.currentInterimResult = '';
        this.transcriptionStartIndex = null;
        this.lastInterimLength = 0;
        this.lastFinalizedIndex = -1;
        this.recordingStartTime = null;
        this.recordingDuration = null;
        this.finalizationTimeout = null;
        this.silenceTimer = null;
        this.lastSpeechTime = null;
        this.heartbeatInterval = null;
        this.recognitionRestartCount = 0;

        // Language settings
        this.primaryLanguage = localStorage.getItem('primaryRecognitionLang') || 'en-US';
        this.secondaryLanguage = localStorage.getItem('secondaryRecognitionLang') || 'hi-IN';
        this.currentLanguage = this.primaryLanguage;

        // Volume and sensitivity settings
        this.volumeThreshold = parseFloat(localStorage.getItem('speechRecognitionVolumeThreshold') || '0.15');
        this.currentVolume = 0;
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.scriptProcessor = null;
        this.volumeDataArray = null;
        this.isVolumeMonitoringActive = false;

        // Configure recognition
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = this.currentLanguage;

        // Set up event handlers
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Set up keyboard shortcut for language switching (Ctrl+L)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key.toLowerCase() === 'l') {
                this.toggleRecognitionLanguage();
                e.preventDefault(); // Prevent browser's 'focus address bar' shortcut
            }
        });

        // Handle results
        this.recognition.onresult = (event) => {
            // Get the Quill editor instance (try both global and local variable)
            const quillEditor = this.getQuillEditor();
            if (!quillEditor) {
                console.error('Quill editor not found');
                return;
            }

            // Get current cursor position or create one if none exists
            let range = quillEditor.getSelection();
            if (!range) {
                range = { index: quillEditor.getLength(), length: 0 };
                quillEditor.setSelection(range.index, 0);
            }

            // If this is our first result in this session, store the cursor position
            if (!this.transcriptionStartIndex) {
                this.transcriptionStartIndex = range.index;
                this.lastInterimLength = 0;
                // Reset the last finalized index when starting a new transcription segment
                this.lastFinalizedIndex = -1;
                console.log('New transcription segment started at index:', this.transcriptionStartIndex);
            }

            let interimTranscript = '';
            let finalTranscript = '';
            let finalizedUpTo = 0;

            // Debug log to help diagnose duplication issues
            console.log('Speech result event:', {
                resultIndex: event.resultIndex,
                resultsLength: event.results.length,
                lastFinalizedIndex: this.lastFinalizedIndex
            });

            // Process results - only process from the resultIndex to avoid repetition
            for (let i = event.resultIndex; i < event.results.length; i++) {
                // Skip already finalized results to prevent duplication
                if (i <= this.lastFinalizedIndex) {
                    console.log(`Skipping already finalized result at index ${i}`);
                    continue;
                }

                const transcript = event.results[i][0].transcript;

                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                    finalizedUpTo = i + 1;
                    // Store the last finalized index to avoid repetition
                    this.lastFinalizedIndex = i;
                    console.log(`Finalized result at index ${i}: "${transcript}"`);
                } else if (i >= finalizedUpTo) {
                    interimTranscript += transcript + ' ';
                    console.log(`Interim result at index ${i}: "${transcript}"`);
                }
            }

            // Check if volume is above threshold
            const isVolumeAboveThreshold = this.currentVolume >= this.volumeThreshold;

            // Handle the transcription in the editor
            if ((finalTranscript || interimTranscript) && isVolumeAboveThreshold) {
                // Update the last speech time whenever we get any results
                this.lastSpeechTime = Date.now();
                console.log('Speech detected above threshold, timestamp updated:', this.lastSpeechTime);

                // Clear any existing finalization timeout
                if (this.finalizationTimeout) {
                    clearTimeout(this.finalizationTimeout);
                    this.finalizationTimeout = null;
                }

                // First, remove any previous interim results
                if (this.lastInterimLength > 0) {
                    quillEditor.deleteText(
                        this.transcriptionStartIndex,
                        this.lastInterimLength
                    );
                }

                // Insert the final transcript (if any)
                if (finalTranscript) {
                    quillEditor.insertText(
                        this.transcriptionStartIndex,
                        finalTranscript
                    );

                    // Update the start index for future interim results
                    this.transcriptionStartIndex += finalTranscript.length;
                }

                // Insert the new interim results (if any)
                if (interimTranscript) {
                    // Insert interim text with a special format (e.g., italics)
                    quillEditor.insertText(
                        this.transcriptionStartIndex,
                        interimTranscript,
                        { italic: true, color: '#666666' }  // Make it more visible
                    );

                    // Store the length of the interim text for future removal
                    this.lastInterimLength = interimTranscript.length;

                    // Set a timeout to finalize this interim result if no new results come in
                    this.finalizationTimeout = setTimeout(() => {
                        this.finalizeInterimResults(quillEditor);
                    }, 2000);  // 2 seconds of silence will finalize the interim results
                } else {
                    this.lastInterimLength = 0;
                }

                // Move cursor to end of inserted text
                quillEditor.setSelection(
                    this.transcriptionStartIndex + this.lastInterimLength,
                    0
                );

                // Update word count
                if (typeof updateCounts === 'function') {
                    updateCounts();
                }

                // Start or reset the silence detection timer
                this.startSilenceDetection(quillEditor);
            }

            // Store interim result for potential use
            this.currentInterimResult = interimTranscript;
        };

        // Handle errors
        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);

            // Show error message to user
            this.showToast(`Speech recognition error: ${event.error}`, 'error');

            // If it's a fatal error, stop recording
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                this.stopRecording();
            }
        };

        // Handle end of recognition
        this.recognition.onend = () => {
            console.log('Speech recognition ended. isRecording:', this.isRecording, 'isPaused:', this.isPaused);

            // If not manually paused, restart recognition
            if (this.isRecording && !this.isPaused) {
                try {
                    // Finalize any interim results before restarting
                    const quillEditor = this.getQuillEditor();
                    if (quillEditor && this.lastInterimLength > 0) {
                        this.finalizeInterimResults(quillEditor);
                    }

                    // Reset transcription tracking to prevent duplication
                    // We'll get a new cursor position when the next result comes in
                    this.transcriptionStartIndex = null;
                    this.lastInterimLength = 0;
                    this.lastFinalizedIndex = -1;

                    // Add a small delay before restarting to prevent potential issues
                    setTimeout(() => {
                        if (this.isRecording && !this.isPaused) {
                            this.recognition.start();
                            console.log('Restarted speech recognition after automatic end');
                        }
                    }, 100);
                } catch (error) {
                    console.error('Error restarting speech recognition:', error);
                    // Try one more time after a longer delay
                    setTimeout(() => {
                        if (this.isRecording && !this.isPaused) {
                            try {
                                this.recognition.start();
                                console.log('Restarted speech recognition after error recovery');
                            } catch (retryError) {
                                console.error('Failed to restart speech recognition after retry:', retryError);
                                this.showToast('Speech recognition error. Please try again.', 'error');
                                this.updateRecordingState(false);
                                this.isRecording = false;
                            }
                        }
                    }, 500);
                }
            } else if (!this.isPaused) {
                // If we're not paused but recognition ended, we've stopped recording
                this.updateRecordingState(false);
            }
        };
    }

    async startRecording() {
        if (!this.isSupported) {
            this.showToast('Speech recognition is not supported in your browser. Please try Chrome.', 'error');
            return false;
        }

        try {
            // Initialize volume monitoring if not already active
            if (!this.isVolumeMonitoringActive) {
                await this.initializeVolumeMonitoring();
            }

            // Show the volume controls
            this.toggleVolumeControls(true);

            // Ask for lecture duration
            const duration = await this.promptForLectureDuration();
            if (duration) {
                this.recordingDuration = duration * 60 * 1000; // Convert minutes to milliseconds
            }

            // Reset transcription tracking variables
            this.transcriptionStartIndex = null;
            this.lastInterimLength = 0;
            this.lastFinalizedIndex = -1;

            // Make sure any previous recognition session is properly stopped
            try {
                this.recognition.stop();
                console.log('Stopped any existing recognition session');
            } catch (e) {
                // Ignore errors when stopping non-existent sessions
                console.log('No active recognition session to stop');
            }

            // In some browsers, we might need to recreate the recognition instance
            // if it's in an error state or has been stopped multiple times
            if (this.recognitionRestartCount && this.recognitionRestartCount > 3) {
                console.log('Creating a new SpeechRecognition instance after multiple restarts');
                // Create a new instance
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                this.recognition = new SpeechRecognition();

                // Configure the new instance
                this.recognition.continuous = true;
                this.recognition.interimResults = true;
                this.recognition.lang = this.currentLanguage;

                // Set up event handlers for the new instance
                this.setupEventListeners();

                // Reset the restart count
                this.recognitionRestartCount = 0;
            } else {
                // Increment the restart count
                this.recognitionRestartCount = (this.recognitionRestartCount || 0) + 1;
            }

            // Set flags before starting to ensure onend handler works correctly
            this.isRecording = true;
            this.isPaused = false;

            // Start recognition after a small delay to ensure clean state
            setTimeout(() => {
                try {
                    this.recognition.start();
                    console.log('Speech recognition started successfully');
                } catch (error) {
                    console.error('Error starting speech recognition:', error);
                    this.showToast('Error starting recording. Please try again.', 'error');
                    this.isRecording = false;
                    this.updateRecordingState(false);
                }
            }, 50);

            // Start the timer
            this.recordingStartTime = Date.now();
            this.startTimer();

            // Update UI
            this.updateRecordingState(true);

            // Enable control buttons
            document.getElementById('pauseResumeBtn').disabled = false;
            document.getElementById('summarizeBtn').disabled = false;

            // Show the timer
            const timerElement = document.getElementById('recordingTimer');
            if (timerElement) {
                timerElement.style.display = 'inline-block';
            }

            // Show and update the language indicator
            this.updateLanguageIndicator();

            // Set up a heartbeat to ensure recognition stays active
            // This will periodically check if recognition is still running
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
            }

            this.heartbeatInterval = setInterval(() => {
                if (this.isRecording && !this.isPaused) {
                    // Check if we've received any speech events recently
                    const now = Date.now();
                    const timeSinceLastSpeech = this.lastSpeechTime ? (now - this.lastSpeechTime) : 0;

                    // If it's been more than 5 seconds since we received any speech events,
                    // check if recognition is still running
                    if (timeSinceLastSpeech > 5000 || !this.lastSpeechTime) {
                        console.log('Heartbeat check: Ensuring recognition is running...');
                        this.ensureRecognitionIsRunning();
                    }
                }
            }, 3000); // Check every 3 seconds

            this.showToast('Recording started', 'success');
            console.log('Speech recognition started');

            // If a duration was set, schedule automatic stop
            if (this.recordingDuration) {
                this.recordingTimeout = setTimeout(() => {
                    if (this.isRecording) {
                        this.stopRecording();
                        this.showToast('Recording complete', 'info');
                    }
                }, this.recordingDuration);
            }

            return true;
        } catch (error) {
            console.error('Error starting speech recognition:', error);
            this.showToast('Error starting recording', 'error');
            return false;
        }
    }

    pauseRecording() {
        if (this.isRecording && !this.isPaused) {
            this.recognition.stop();
            this.isPaused = true;

            // Store the pause time for timer calculations
            this.pauseTime = Date.now();

            // Clear finalization and silence detection timers
            if (this.finalizationTimeout) {
                clearTimeout(this.finalizationTimeout);
                this.finalizationTimeout = null;
            }

            if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
            }

            // Finalize any interim text by removing formatting
            if (this.lastInterimLength > 0) {
                const quillEditor = this.getQuillEditor();
                if (quillEditor) {
                    // Use the finalizeInterimResults method
                    this.finalizeInterimResults(quillEditor);
                }
            }

            // Update pause button
            const pauseBtn = document.getElementById('pauseResumeBtn');
            pauseBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
            pauseBtn.setAttribute('data-tooltip', 'Resume Recording');

            this.showToast('Recording paused', 'info');
            console.log('Speech recognition paused');
        }
    }

    resumeRecording() {
        if (this.isRecording && this.isPaused) {
            // When resuming, we'll start a new segment of transcription
            // Get the current cursor position for the new transcription
            const quillEditor = this.getQuillEditor();
            if (quillEditor) {
                const range = quillEditor.getSelection() || { index: quillEditor.getLength(), length: 0 };
                this.transcriptionStartIndex = range.index;
                this.lastInterimLength = 0;
                // Reset the last finalized index when starting a new transcription segment
                this.lastFinalizedIndex = -1;
                console.log('New transcription segment started at index:', this.transcriptionStartIndex);
            }

            // Adjust the recording start time to account for the pause duration
            if (this.pauseTime && this.recordingStartTime) {
                const pauseDuration = Date.now() - this.pauseTime;
                this.recordingStartTime += pauseDuration;
                this.pauseTime = null;
            }

            // Set flag before starting to ensure onend handler works correctly
            this.isPaused = false;

            // Start recognition after a small delay to ensure clean state
            setTimeout(() => {
                try {
                    this.recognition.start();
                    console.log('Speech recognition resumed successfully');
                } catch (error) {
                    console.error('Error resuming speech recognition:', error);
                    this.showToast('Error resuming recording. Please try again.', 'error');
                    // Try one more time after a longer delay
                    setTimeout(() => {
                        try {
                            this.recognition.start();
                            console.log('Speech recognition resumed after retry');
                        } catch (retryError) {
                            console.error('Failed to resume speech recognition after retry:', retryError);
                            this.showToast('Speech recognition error. Please try stopping and starting again.', 'error');
                        }
                    }, 300);
                }
            }, 50);

            // Update pause button
            const pauseBtn = document.getElementById('pauseResumeBtn');
            pauseBtn.innerHTML = '<i class="bi bi-pause-fill"></i>';
            pauseBtn.setAttribute('data-tooltip', 'Pause Recording');

            this.showToast('Recording resumed', 'info');
            console.log('Speech recognition resumed');
        }
    }

    stopRecording() {
        if (this.isRecording) {
            this.recognition.stop();
            this.isRecording = false;
            this.isPaused = false;

            // Stop the timer
            this.stopTimer();

            // Clear any scheduled stop
            if (this.recordingTimeout) {
                clearTimeout(this.recordingTimeout);
                this.recordingTimeout = null;
            }

            // Clear finalization and silence detection timers
            if (this.finalizationTimeout) {
                clearTimeout(this.finalizationTimeout);
                this.finalizationTimeout = null;
            }

            if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
            }

            // Clear the heartbeat interval
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }

            // Finalize any interim text by removing formatting
            if (this.lastInterimLength > 0) {
                const quillEditor = this.getQuillEditor();
                if (quillEditor) {
                    // Use the finalizeInterimResults method
                    this.finalizeInterimResults(quillEditor);

                    // Reset transcription start index after finalization
                    this.transcriptionStartIndex = null;
                }
            }

            // Update UI
            this.updateRecordingState(false);

            // Disable pause button
            document.getElementById('pauseResumeBtn').disabled = true;

            // Enable summarize button
            document.getElementById('summarizeBtn').disabled = false;

            // Hide the timer
            const timerElement = document.getElementById('recordingTimer');
            if (timerElement) {
                timerElement.style.display = 'none';
            }

            // Hide the language indicator
            const langIndicator = document.getElementById('speechLangIndicator');
            if (langIndicator) {
                langIndicator.style.display = 'none';
            }

            // Hide and stop volume monitoring
            this.toggleVolumeControls(false);
            this.stopVolumeMonitoring();

            this.showToast('Recording stopped', 'info');
            console.log('Speech recognition stopped');
        }
    }

    // Timer methods
    startTimer() {
        // Clear any existing timer
        this.stopTimer();

        // Update the timer display immediately
        this.updateTimerDisplay();

        // Set up the timer interval (update every second)
        this.timerInterval = setInterval(() => {
            this.updateTimerDisplay();
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    updateTimerDisplay() {
        if (!this.recordingStartTime) return;

        const timerElement = document.getElementById('recordingTimer');
        if (!timerElement) return;

        // Calculate elapsed time
        const elapsedMs = this.isPaused ?
            (this.pauseTime - this.recordingStartTime) :
            (Date.now() - this.recordingStartTime);

        // Format the time as HH:MM:SS
        const hours = Math.floor(elapsedMs / (1000 * 60 * 60));
        const minutes = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((elapsedMs % (1000 * 60)) / 1000);

        const formattedTime = [
            hours.toString().padStart(2, '0'),
            minutes.toString().padStart(2, '0'),
            seconds.toString().padStart(2, '0')
        ].join(':');

        timerElement.textContent = formattedTime;
    }

    // Prompt for lecture duration
    promptForLectureDuration() {
        return new Promise((resolve) => {
            // Create a custom modal for duration input
            const modal = document.createElement('div');
            modal.className = 'lecture-duration-modal';
            modal.innerHTML = `
                <div class="lecture-duration-content">
                    <h3>Lecture Duration</h3>
                    <p>How long is this lecture? (in minutes)</p>
                    <div class="duration-options">
                        <button data-duration="30">30 min</button>
                        <button data-duration="45">45 min</button>
                        <button data-duration="60">1 hour</button>
                        <button data-duration="90">1.5 hours</button>
                        <button data-duration="120">2 hours</button>
                    </div>
                    <div class="custom-duration">
                        <input type="number" id="customDuration" min="1" max="300" placeholder="Custom duration">
                        <span>minutes</span>
                    </div>
                    <div class="modal-buttons">
                        <button id="cancelDuration">Cancel</button>
                        <button id="confirmDuration">Start Recording</button>
                    </div>
                </div>
            `;

            // Add styles for the modal
            const style = document.createElement('style');
            style.textContent = `
                .lecture-duration-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                }
                .lecture-duration-content {
                    background-color: var(--card-bg, #374151);
                    color: var(--text-color, #f9fafb);
                    padding: 20px;
                    border-radius: 8px;
                    width: 400px;
                    max-width: 90%;
                }
                .lecture-duration-content h3 {
                    margin-top: 0;
                    margin-bottom: 10px;
                }
                .duration-options {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                    margin: 15px 0;
                }
                .duration-options button {
                    background-color: var(--surface-color, #1f2937);
                    color: var(--text-color, #f9fafb);
                    border: 1px solid var(--border-color, #6b7280);
                    border-radius: 4px;
                    padding: 8px 12px;
                    cursor: pointer;
                    flex-grow: 1;
                }
                .duration-options button:hover {
                    background-color: var(--hover-bg, #4b5563);
                }
                .custom-duration {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 15px;
                }
                .custom-duration input {
                    background-color: var(--surface-color, #1f2937);
                    color: var(--text-color, #f9fafb);
                    border: 1px solid var(--border-color, #6b7280);
                    border-radius: 4px;
                    padding: 8px;
                    flex-grow: 1;
                }
                .modal-buttons {
                    display: flex;
                    justify-content: flex-end;
                    gap: 10px;
                }
                .modal-buttons button {
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                }
                #cancelDuration {
                    background-color: transparent;
                    color: var(--text-color, #f9fafb);
                    border: 1px solid var(--border-color, #6b7280);
                }
                #confirmDuration {
                    background-color: var(--primary-color, #4f46e5);
                    color: white;
                    border: none;
                }
            `;

            document.head.appendChild(style);
            document.body.appendChild(modal);

            // Set up event listeners
            let selectedDuration = null;

            // Duration option buttons
            const durationButtons = modal.querySelectorAll('.duration-options button');
            durationButtons.forEach(button => {
                button.addEventListener('click', () => {
                    // Remove active class from all buttons
                    durationButtons.forEach(btn => btn.style.backgroundColor = '');
                    // Add active class to clicked button
                    button.style.backgroundColor = 'var(--primary-color, #4f46e5)';
                    selectedDuration = parseInt(button.dataset.duration);
                    document.getElementById('customDuration').value = '';
                });
            });

            // Custom duration input
            const customDurationInput = document.getElementById('customDuration');
            customDurationInput.addEventListener('input', () => {
                // Remove active class from all buttons
                durationButtons.forEach(btn => btn.style.backgroundColor = '');
                selectedDuration = parseInt(customDurationInput.value);
            });

            // Cancel button
            document.getElementById('cancelDuration').addEventListener('click', () => {
                document.body.removeChild(modal);
                document.head.removeChild(style);
                resolve(null);
            });

            // Confirm button
            document.getElementById('confirmDuration').addEventListener('click', () => {
                const customValue = customDurationInput.value ? parseInt(customDurationInput.value) : null;
                const finalDuration = customValue || selectedDuration || null;
                document.body.removeChild(modal);
                document.head.removeChild(style);
                resolve(finalDuration);
            });
        });
    }

    // We don't need these methods anymore as we're inserting directly into the Quill editor

    updateRecordingState(isRecording) {
        // Update button icon
        const recordBtn = document.getElementById('speechRecognitionBtn');

        if (isRecording) {
            // Change to recording state
            document.body.classList.add('recording-active');
            recordBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
            recordBtn.setAttribute('data-tooltip', 'Stop Recording');
        } else {
            // Change to non-recording state
            document.body.classList.remove('recording-active');
            recordBtn.innerHTML = '<i class="bi bi-mic"></i>';
            recordBtn.setAttribute('data-tooltip', 'Start Recording');
        }
    }

    // Finalize interim results by converting them to normal text
    finalizeInterimResults(quillEditor) {
        if (!quillEditor || this.lastInterimLength <= 0 || !this.transcriptionStartIndex) {
            return;
        }

        try {
            // Get the current interim text
            const interimText = quillEditor.getText(
                this.transcriptionStartIndex,
                this.lastInterimLength
            );

            if (!interimText.trim()) {
                return; // Nothing to finalize
            }

            // Remove the formatted interim text
            quillEditor.deleteText(
                this.transcriptionStartIndex,
                this.lastInterimLength
            );

            // Re-insert it as normal text
            quillEditor.insertText(
                this.transcriptionStartIndex,
                interimText
            );

            // Update tracking variables
            this.transcriptionStartIndex += interimText.length;
            this.lastInterimLength = 0;

            // Update word count
            if (typeof updateCounts === 'function') {
                updateCounts();
            }
        } catch (error) {
            console.error('Error finalizing interim results:', error);
        }
    }

    // Start or reset the silence detection timer
    startSilenceDetection(quillEditor) {
        // Clear any existing timer
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
        }

        // Set a new timer to check for silence
        this.silenceTimer = setTimeout(() => {
            const now = Date.now();
            // If it's been more than 3 seconds since the last speech
            if (this.lastSpeechTime && (now - this.lastSpeechTime > 3000)) {
                // Finalize any interim results
                this.finalizeInterimResults(quillEditor);
            }

            // Continue checking for silence if still recording
            if (this.isRecording && !this.isPaused) {
                this.startSilenceDetection(quillEditor);
            }
        }, 1000); // Check every second
    }

    // Helper method to get the Quill editor instance
    getQuillEditor() {
        // Try to get the editor from the window object first (global variable)
        if (window.quill) {
            return window.quill;
        }

        // If not found, try to get it from the parent window (iframe case)
        if (window.parent && window.parent.quill) {
            return window.parent.quill;
        }

        // If still not found, try to get it by ID (local variable case)
        const editorElement = document.getElementById('editor');
        if (editorElement && editorElement.querySelector('.ql-editor')) {
            // The editor exists, but we don't have direct access to the Quill instance
            // This is a fallback that won't work for our needs
            return null;
        }

        return null;
    }

    async summarizeTranscript() {
        // Get the Quill editor instance
        const quillEditor = this.getQuillEditor();
        if (!quillEditor) {
            console.error('Quill editor not found');
            this.showToast('Editor not found', 'error');
            return;
        }

        // Get the text content from the editor
        const editorContent = quillEditor.getText().trim();

        if (!editorContent) {
            this.showToast('No content to summarize', 'warning');
            return;
        }

        // Variable to store toast IDs so we can hide them later
        let toastId;

        try {
            // Show analyzing message and store the toast ID
            toastId = this.showToast('Analyzing content...', 'info', 0); // Set duration to 0 to make it persistent

            // Get API key from localStorage
            const apiKey = localStorage.getItem('geminiApiKey');

            if (!apiKey) {
                // Hide the analyzing toast before showing the error
                this.hideToast(toastId);

                // Create a more helpful error message with instructions
                const errorMessage = 'Gemini API key not found. You need to set up your API key in the AI container settings.';
                console.error(errorMessage);

                // Show a more detailed toast with instructions
                this.showToast(errorMessage, 'error', 8000); // Show for 8 seconds

                // If we're in an iframe, try to communicate with the parent window
                if (window.parent && window.parent !== window) {
                    try {
                        window.parent.postMessage({ type: 'openAISettings' }, '*');
                    } catch (e) {
                        console.error('Failed to communicate with parent window:', e);
                    }
                }

                return;
            }

            // Get selected model from localStorage or use default
            const modelName = localStorage.getItem('geminiModel') || 'gemini-2.0-flash';

            // Hide the analyzing toast before showing the generating toast
            this.hideToast(toastId);

            // Show processing message and store the new toast ID
            toastId = this.showToast('Generating summary...', 'info', 0); // Set duration to 0 to make it persistent

            // Call the API
            const summary = await this.callGeminiAPI(apiKey, modelName, editorContent);

            // Insert a separator and the summary at the end of the document
            const length = quillEditor.getLength();
            quillEditor.insertText(length, '\n\n');

            // Insert the formatted summary
            const delta = this.convertSummaryToDelta(summary);
            quillEditor.updateContents(delta);

            // Scroll to the summary
            quillEditor.setSelection(length, 0);

            // Hide the generating toast before showing the completion toast
            this.hideToast(toastId);

            // Show completion message
            this.showToast('Summary complete', 'success');
        } catch (error) {
            console.error('Error summarizing content:', error);

            // Hide any existing toast notification
            if (toastId) {
                this.hideToast(toastId);
            }

            // Provide more helpful error messages based on the error type
            let errorMessage = 'Error generating summary';

            if (error.message.includes('API key')) {
                errorMessage = 'Invalid API key. Please check your Gemini API key in settings.';
            } else if (error.message.includes('quota')) {
                errorMessage = 'API quota exceeded. Please try again later or check your Gemini API usage limits.';
            } else if (error.message.includes('429')) {
                errorMessage = 'Too many requests. Please wait a moment and try again.';
            } else if (error.message.includes('500')) {
                errorMessage = 'Gemini API server error. Please try again later.';
            } else {
                errorMessage = `Error: ${error.message}`;
            }

            this.showToast(errorMessage, 'error', 5000);
        }
    }

    // Pre-process transcript to remove filler words and repetitions
    preprocessTranscript(transcript) {
        if (!transcript || typeof transcript !== 'string') return transcript;

        // Convert to lowercase for processing
        let processed = transcript;

        // Remove excessive spaces
        processed = processed.replace(/\s+/g, ' ').trim();

        // Remove common filler words when they stand alone (not part of another word)
        const fillerWords = ['um', 'uh', 'like', 'you know', 'sort of', 'kind of', 'basically', 'literally', 'actually', 'so yeah', 'right'];
        fillerWords.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            processed = processed.replace(regex, '');
        });

        // Remove repeated phrases (3 or more words repeated exactly)
        const phrases = processed.split(/[.!?]\s+/);
        const uniquePhrases = [];
        const seenPhrases = new Set();

        phrases.forEach(phrase => {
            // Normalize the phrase for comparison
            const normalizedPhrase = phrase.trim().toLowerCase();
            if (normalizedPhrase.split(' ').length >= 3) {
                if (!seenPhrases.has(normalizedPhrase)) {
                    seenPhrases.add(normalizedPhrase);
                    uniquePhrases.push(phrase);
                }
            } else {
                // Keep short phrases regardless
                uniquePhrases.push(phrase);
            }
        });

        processed = uniquePhrases.join('. ').replace(/\.\./g, '.').replace(/\s+/g, ' ').trim();

        return processed;
    }

    async callGeminiAPI(apiKey, modelName, transcript) {
        try {
            // Pre-process the transcript
            const processedTranscript = this.preprocessTranscript(transcript);

            // Prepare the enhanced prompt for summarization
            const prompt = `
                You are an expert academic assistant tasked with summarizing a lecture transcript.

                INSTRUCTIONS:
                1. First, analyze the transcript for accuracy and coherence. Identify and ignore any parts that appear to be:
                   - Speech recognition errors or gibberish
                   - Off-topic tangents or administrative announcements
                   - Repetitive content

                2. Create a comprehensive summary focusing on:
                   - Main topics and key concepts
                   - Important definitions and explanations
                   - Theoretical frameworks and methodologies

                3. In a separate section, highlight any EXAM/QUIZ HINTS such as:
                   - Explicit mentions of exam or quiz content
                   - Points the lecturer emphasizes as important to remember
                   - Topics the lecturer spends significant time on
                   - Any direct hints like "this will be on the test" or "make sure you understand this"

                4. Format your response using markdown:
                   - # Main Heading for major sections
                   - ## Subheading for topics
                   - - Bullet points for key points
                   - **Bold text** for emphasis

                5. Begin with a "# Lecture Summary" section followed by the main content
                6. End with a "# Exam/Quiz Hints" section if any hints were identified

                TRANSCRIPT:
                ${processedTranscript}
            `;

            // Make API request with temperature setting for better quality
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.2,  // Lower temperature for more factual output
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 4096  // Allow for longer summaries
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`API request failed: ${errorData}`);
            }

            const data = await response.json();
            const summaryText = data.candidates[0].content.parts[0].text;

            return summaryText;
        } catch (error) {
            console.error('Gemini API error:', error);
            throw error;
        }
    }

    // Convert markdown-formatted summary to Quill Delta format
    convertSummaryToDelta(text) {
        const delta = { ops: [] };
        const lines = text.split('\n');

        lines.forEach(line => {
            // Handle headings
            if (line.startsWith('# ')) {
                delta.ops.push({
                    insert: line.substring(2),
                    attributes: { header: 1 }
                });
                delta.ops.push({ insert: '\n' });
            }
            // Handle subheadings
            else if (line.startsWith('## ')) {
                delta.ops.push({
                    insert: line.substring(3),
                    attributes: { header: 2 }
                });
                delta.ops.push({ insert: '\n' });
            }
            // Handle bullet points
            else if (line.startsWith('- ')) {
                delta.ops.push({ insert: line.substring(2) });
                delta.ops.push({
                    insert: '\n',
                    attributes: { list: 'bullet' }
                });
            }
            // Handle bold text
            else if (line.includes('**')) {
                let parts = line.split('**');
                for (let i = 0; i < parts.length; i++) {
                    if (i % 2 === 0) {
                        // Regular text
                        if (parts[i]) delta.ops.push({ insert: parts[i] });
                    } else {
                        // Bold text
                        delta.ops.push({
                            insert: parts[i],
                            attributes: { bold: true }
                        });
                    }
                }
                delta.ops.push({ insert: '\n' });
            }
            // Regular text
            else {
                delta.ops.push({ insert: line });
                delta.ops.push({ insert: '\n' });
            }
        });

        return delta;
    }

    showToast(message, type = 'info', duration = 3000) {
        // Use the existing toast function if available
        if (typeof window.showToast === 'function') {
            // Check if the existing showToast function accepts a duration parameter
            if (window.showToast.length >= 3) {
                return window.showToast(message, type, duration);
            } else {
                // Fall back to the original function without duration
                return window.showToast(message, type);
            }
        } else {
            // Create our own toast if the global function isn't available
            return this.createToast(message, type, duration);
        }
    }

    createToast(message, type = 'info', duration = 3000) {
        // First, log to console
        console.log(`${type.toUpperCase()}: ${message}`);

        // Create a unique ID for this toast
        const toastId = 'custom-toast-' + Date.now();

        // Create toast element
        const toast = document.createElement('div');
        toast.id = toastId;
        toast.className = `custom-toast toast-${type}`;

        // Add icon based on type
        let icon = '';
        switch (type) {
            case 'success': icon = '<i class="bi bi-check-circle"></i>'; break;
            case 'error': icon = '<i class="bi bi-exclamation-circle"></i>'; break;
            case 'warning': icon = '<i class="bi bi-exclamation-triangle"></i>'; break;
            default: icon = '<i class="bi bi-info-circle"></i>';
        }

        // Set content - make message shorter if it's too long
        const shortMessage = message.length > 30 ? message.substring(0, 27) + '...' : message;
        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-message">${shortMessage}</div>
            <button class="toast-close">&times;</button>
        `;

        // Add styles if they don't exist
        if (!document.getElementById('custom-toast-styles')) {
            const style = document.createElement('style');
            style.id = 'custom-toast-styles';
            style.textContent = `
                .custom-toast {
                    position: fixed;
                    top: 10px;           /* Position at top instead of bottom */
                    right: 10px;          /* Closer to the edge */
                    padding: 6px 10px;     /* Much smaller padding */
                    border-radius: 4px;    /* Smaller radius */
                    display: flex;
                    align-items: center;
                    gap: 6px;              /* Smaller gap */
                    color: white;
                    max-width: 200px;      /* Much narrower */
                    font-size: 12px;       /* Smaller font */
                    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1); /* Lighter shadow */
                    z-index: 10000;
                    opacity: 0.85;         /* Slightly transparent */
                    transition: transform 0.3s, opacity 0.3s;
                    transform: translateY(0);
                }
                .custom-toast.hiding {
                    opacity: 0;
                    transform: translateY(-20px);
                }
                .toast-success { background-color: rgba(16, 185, 129, 0.85); } /* Semi-transparent */
                .toast-error { background-color: rgba(239, 68, 68, 0.85); }
                .toast-warning { background-color: rgba(245, 158, 11, 0.85); }
                .toast-info { background-color: rgba(59, 130, 246, 0.85); }
                .toast-icon {
                    flex-shrink: 0;
                    font-size: 10px;    /* Smaller icon */
                }
                .toast-message {
                    flex-grow: 1;
                    font-size: 11px;    /* Smaller text */
                    line-height: 1.2;    /* Tighter line height */
                }
                .toast-close {
                    background: none;
                    border: none;
                    color: white;
                    cursor: pointer;
                    font-size: 14px;    /* Smaller close button */
                    opacity: 0.7;
                    transition: opacity 0.2s;
                    padding: 0 0 0 5px; /* Minimal padding */
                }
                .toast-close:hover { opacity: 1; }
            `;
            document.head.appendChild(style);
        }

        // Add to document
        document.body.appendChild(toast);

        // Add close button functionality
        const closeBtn = toast.querySelector('.toast-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hideToast(toastId);
            });
        }

        // Auto-remove after duration (if not persistent)
        if (duration > 0) {
            setTimeout(() => {
                this.hideToast(toastId);
            }, duration);
        }

        // Return the toast ID so it can be referenced later
        return toastId;
    }

    // Method to hide a toast by ID
    hideToast(id) {
        if (!id) return;

        // Try to find the toast by ID
        const toast = document.getElementById(id);
        if (!toast) return;

        // Add the hiding class for animation
        toast.classList.add('hiding');

        // Remove after animation completes
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }

    // Reset the transcription
    resetTranscription() {
        this.currentInterimResult = '';

        // We don't clear the editor content as it might contain user's work
        // Just disable the summarize button
        document.getElementById('summarizeBtn').disabled = true;

        this.showToast('Speech recognition reset', 'info');
    }

    // Toggle between primary and secondary language
    toggleRecognitionLanguage() {
        if (!this.isSupported) return;

        // Toggle between primary and secondary language
        this.currentLanguage = (this.currentLanguage === this.primaryLanguage) ?
            this.secondaryLanguage : this.primaryLanguage;

        // Update the recognition instance language
        this.recognition.lang = this.currentLanguage;

        // Show a notification to the user
        const langName = this.getLanguageName(this.currentLanguage);
        this.showToast(`Switched to ${langName}`, 'info');
        console.log(`Speech recognition language switched to: ${this.currentLanguage}`);

        // Update the language indicator in the UI
        this.updateLanguageIndicator();

        // If we're currently recording, we need to restart the recognition
        // to apply the new language setting
        if (this.isRecording && !this.isPaused) {
            try {
                // Finalize any interim results before restarting
                const quillEditor = this.getQuillEditor();
                if (quillEditor && this.lastInterimLength > 0) {
                    this.finalizeInterimResults(quillEditor);
                }

                // Reset transcription tracking to prevent duplication
                // We'll get a new cursor position when the next result comes in
                this.transcriptionStartIndex = null;
                this.lastInterimLength = 0;
                this.lastFinalizedIndex = -1;

                // Stop the current recognition
                this.recognition.stop();

                // Start a new recognition with the new language after a short delay
                setTimeout(() => {
                    if (this.isRecording && !this.isPaused) {
                        try {
                            this.recognition.start();
                            console.log(`Recognition restarted with language: ${this.currentLanguage}`);
                        } catch (error) {
                            console.error('Error restarting recognition after language change:', error);
                        }
                    }
                }, 100);
            } catch (error) {
                // If stopping fails, the recognition wasn't running
                console.log('Recognition not running when language changed');

                // Reset transcription tracking to prevent duplication
                this.transcriptionStartIndex = null;
                this.lastInterimLength = 0;
                this.lastFinalizedIndex = -1;

                // Try to start it with the new language
                setTimeout(() => {
                    if (this.isRecording && !this.isPaused) {
                        try {
                            this.recognition.start();
                            console.log(`Recognition started with language: ${this.currentLanguage}`);
                        } catch (startError) {
                            console.error('Error starting recognition after language change:', startError);
                        }
                    }
                }, 100);
            }
        }
    }

    // Update the language indicator in the UI
    updateLanguageIndicator() {
        // Find or create the language indicator element
        let langIndicator = document.getElementById('speechLangIndicator');

        if (!langIndicator) {
            // Create the indicator if it doesn't exist
            langIndicator = document.createElement('span');
            langIndicator.id = 'speechLangIndicator';
            langIndicator.className = 'speech-lang-indicator';

            // Add styles for the indicator
            const style = document.createElement('style');
            style.textContent = `
                .speech-lang-indicator {
                    display: inline-block;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: bold;
                    color: white;
                    background-color: var(--primary-color, #4f46e5);
                    margin-left: 5px;
                    vertical-align: middle;
                    cursor: pointer;
                }
                .speech-lang-indicator:hover {
                    opacity: 0.9;
                }
            `;
            document.head.appendChild(style);

            // Find the recording timer element to place the indicator next to it
            const timerElement = document.getElementById('recordingTimer');
            if (timerElement && timerElement.parentNode) {
                timerElement.parentNode.insertBefore(langIndicator, timerElement.nextSibling);
            } else {
                // Fallback: add it near the speech recognition button
                const recordBtn = document.getElementById('speechRecognitionBtn');
                if (recordBtn && recordBtn.parentNode) {
                    recordBtn.parentNode.appendChild(langIndicator);
                }
            }

            // Add click handler to toggle language
            langIndicator.addEventListener('click', () => {
                this.toggleRecognitionLanguage();
            });
        }

        // Update the indicator text with the current language code
        const langCode = this.currentLanguage.split('-')[0].toUpperCase();
        langIndicator.textContent = langCode;
        langIndicator.title = `Current language: ${this.getLanguageName(this.currentLanguage)}. Click to toggle or press Ctrl+L`;

        // Show the indicator if we're recording
        langIndicator.style.display = this.isRecording ? 'inline-block' : 'none';
    }

    // Get a human-readable language name from the language code
    getLanguageName(langCode) {
        return this.getSupportedLanguages()[langCode] || langCode;
    }

    // Get all supported languages
    getSupportedLanguages() {
        return {
            'en-US': 'English (US)',
            'en-GB': 'English (UK)',
            'en-IN': 'English (India)',
            'hi-IN': 'Hindi',
            'es-ES': 'Spanish',
            'fr-FR': 'French',
            'de-DE': 'German',
            'it-IT': 'Italian',
            'ja-JP': 'Japanese',
            'ko-KR': 'Korean',
            'zh-CN': 'Chinese (Simplified)',
            'zh-TW': 'Chinese (Traditional)',
            'ar-SA': 'Arabic',
            'ru-RU': 'Russian',
            'pt-BR': 'Portuguese (Brazil)',
            'nl-NL': 'Dutch',
            'pl-PL': 'Polish',
            'tr-TR': 'Turkish',
            'th-TH': 'Thai',
            'vi-VN': 'Vietnamese'
        };
    }

    // Show language settings dialog
    showLanguageSettings() {
        // Create a modal dialog for language settings
        const modal = document.createElement('div');
        modal.className = 'language-settings-modal';

        // Get all supported languages
        const languages = this.getSupportedLanguages();

        // Create language option HTML
        let languageOptionsHtml = '';
        for (const [code, name] of Object.entries(languages)) {
            languageOptionsHtml += `<option value="${code}">${name}</option>`;
        }

        modal.innerHTML = `
            <div class="language-settings-content">
                <h3>Speech Recognition Language Settings</h3>
                <p>Configure the languages used for speech recognition. You can toggle between these languages during recording using Ctrl+L or by clicking the language indicator.</p>

                <div class="language-setting">
                    <label for="primaryLang">Primary Language:</label>
                    <select id="primaryLang">
                        ${languageOptionsHtml}
                    </select>
                </div>

                <div class="language-setting">
                    <label for="secondaryLang">Secondary Language:</label>
                    <select id="secondaryLang">
                        ${languageOptionsHtml}
                    </select>
                </div>

                <div class="language-info">
                    <p><strong>Tip:</strong> Press Ctrl+L during recording to switch between languages.</p>
                </div>

                <div class="modal-buttons">
                    <button id="cancelLangSettings">Cancel</button>
                    <button id="saveLangSettings">Save Settings</button>
                </div>
            </div>
        `;

        // Add styles for the modal
        const style = document.createElement('style');
        style.textContent = `
            .language-settings-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
            }
            .language-settings-content {
                background-color: var(--card-bg, #374151);
                color: var(--text-color, #f9fafb);
                padding: 20px;
                border-radius: 8px;
                width: 450px;
                max-width: 90%;
            }
            .language-settings-content h3 {
                margin-top: 0;
                margin-bottom: 10px;
            }
            .language-setting {
                margin: 15px 0;
                display: flex;
                flex-direction: column;
                gap: 5px;
            }
            .language-setting label {
                font-weight: bold;
            }
            .language-setting select {
                background-color: var(--surface-color, #1f2937);
                color: var(--text-color, #f9fafb);
                border: 1px solid var(--border-color, #6b7280);
                border-radius: 4px;
                padding: 8px;
                width: 100%;
            }
            .language-info {
                margin: 15px 0;
                padding: 10px;
                background-color: var(--surface-color, #1f2937);
                border-radius: 4px;
                font-size: 0.9em;
            }
            .modal-buttons {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                margin-top: 20px;
            }
            .modal-buttons button {
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
            }
            #cancelLangSettings {
                background-color: transparent;
                color: var(--text-color, #f9fafb);
                border: 1px solid var(--border-color, #6b7280);
            }
            #saveLangSettings {
                background-color: var(--primary-color, #4f46e5);
                color: white;
                border: none;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(modal);

        // Set current values
        const primarySelect = document.getElementById('primaryLang');
        const secondarySelect = document.getElementById('secondaryLang');

        if (primarySelect) primarySelect.value = this.primaryLanguage;
        if (secondarySelect) secondarySelect.value = this.secondaryLanguage;

        // Set up event listeners
        document.getElementById('cancelLangSettings')?.addEventListener('click', () => {
            document.body.removeChild(modal);
            document.head.removeChild(style);
        });

        document.getElementById('saveLangSettings')?.addEventListener('click', () => {
            // Get the selected values
            const newPrimaryLang = primarySelect?.value || this.primaryLanguage;
            const newSecondaryLang = secondarySelect?.value || this.secondaryLanguage;

            // Save to localStorage
            localStorage.setItem('primaryRecognitionLang', newPrimaryLang);
            localStorage.setItem('secondaryRecognitionLang', newSecondaryLang);

            // Update the instance
            this.primaryLanguage = newPrimaryLang;
            this.secondaryLanguage = newSecondaryLang;

            // If current language was primary, update to new primary
            if (this.currentLanguage === this.primaryLanguage ||
                !this.getSupportedLanguages()[this.currentLanguage]) {
                this.currentLanguage = this.primaryLanguage;
                this.recognition.lang = this.currentLanguage;
            }

            // Update UI if needed
            if (this.isRecording) {
                this.updateLanguageIndicator();
            }

            // Show confirmation
            this.showToast('Language settings saved', 'success');

            // Close the modal
            document.body.removeChild(modal);
            document.head.removeChild(style);
        });
    }

    // Initialize audio context and volume monitoring
    async initializeVolumeMonitoring() {
        if (this.isVolumeMonitoringActive) return;

        try {
            // Create audio context
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();

            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Create analyser node
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;

            // Create microphone source
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);

            // Create script processor for volume calculation
            this.scriptProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);
            this.analyser.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioContext.destination);

            // Create data array for volume calculation
            this.volumeDataArray = new Uint8Array(this.analyser.frequencyBinCount);

            // Set up volume monitoring
            this.scriptProcessor.onaudioprocess = () => {
                this.analyser.getByteFrequencyData(this.volumeDataArray);

                // Calculate volume level (0-1)
                let sum = 0;
                for (let i = 0; i < this.volumeDataArray.length; i++) {
                    sum += this.volumeDataArray[i];
                }
                this.currentVolume = sum / (this.volumeDataArray.length * 255);

                // Update volume meter
                this.updateVolumeMeter();
            };

            this.isVolumeMonitoringActive = true;
            console.log('Volume monitoring initialized');

            // Create volume meter and sensitivity slider if they don't exist
            this.createVolumeControls();

            return true;
        } catch (error) {
            console.error('Error initializing volume monitoring:', error);
            this.showToast('Could not access microphone for volume monitoring', 'error');
            return false;
        }
    }

    // Stop volume monitoring
    stopVolumeMonitoring() {
        if (!this.isVolumeMonitoringActive) return;

        try {
            // Disconnect and clean up audio nodes
            if (this.scriptProcessor) {
                this.scriptProcessor.disconnect();
                this.scriptProcessor.onaudioprocess = null;
            }

            if (this.analyser) this.analyser.disconnect();
            if (this.microphone) this.microphone.disconnect();

            // Close audio context
            if (this.audioContext && this.audioContext.state !== 'closed') {
                this.audioContext.close();
            }

            this.isVolumeMonitoringActive = false;
            console.log('Volume monitoring stopped');
        } catch (error) {
            console.error('Error stopping volume monitoring:', error);
        }
    }

    // Create volume meter and sensitivity slider
    createVolumeControls() {
        // Check if controls already exist
        if (document.getElementById('volumeMeterContainer')) return;

        // Create container for volume controls
        const container = document.createElement('div');
        container.id = 'volumeMeterContainer';
        container.className = 'volume-meter-container';

        // Create title
        const title = document.createElement('div');
        title.className = 'volume-meter-title';
        title.textContent = 'Microphone:';

        // Create volume meter
        const volumeMeter = document.createElement('div');
        volumeMeter.id = 'volumeMeter';
        volumeMeter.className = 'volume-meter';

        // Create volume level indicator
        const volumeLevel = document.createElement('div');
        volumeLevel.id = 'volumeLevel';
        volumeLevel.className = 'volume-level';
        volumeMeter.appendChild(volumeLevel);

        // Create threshold indicator
        const thresholdIndicator = document.createElement('div');
        thresholdIndicator.id = 'thresholdIndicator';
        thresholdIndicator.className = 'threshold-indicator';
        volumeMeter.appendChild(thresholdIndicator);

        // Create sensitivity slider
        const sensitivityContainer = document.createElement('div');
        sensitivityContainer.className = 'sensitivity-container';

        const sensitivityLabel = document.createElement('label');
        sensitivityLabel.htmlFor = 'sensitivitySlider';
        sensitivityLabel.textContent = 'Sensitivity:';
        sensitivityLabel.className = 'sensitivity-label';

        const sensitivitySlider = document.createElement('input');
        sensitivitySlider.type = 'range';
        sensitivitySlider.id = 'sensitivitySlider';
        sensitivitySlider.className = 'sensitivity-slider';
        sensitivitySlider.min = '0';
        sensitivitySlider.max = '1';
        sensitivitySlider.step = '0.01';
        sensitivitySlider.value = this.volumeThreshold.toString();

        // Add event listener to slider
        sensitivitySlider.addEventListener('input', (e) => {
            this.volumeThreshold = parseFloat(e.target.value);
            localStorage.setItem('speechRecognitionVolumeThreshold', this.volumeThreshold.toString());
            this.updateVolumeMeter(); // Update threshold indicator
        });

        // Assemble the controls
        sensitivityContainer.appendChild(sensitivityLabel);
        sensitivityContainer.appendChild(sensitivitySlider);

        // Assemble the container
        container.appendChild(title);
        container.appendChild(volumeMeter);
        container.appendChild(sensitivityContainer);

        // Add styles
        const style = document.createElement('style');
        style.id = 'volumeControlsStyle';
        style.textContent = `
            .volume-meter-container {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                background-color: var(--card-bg, #374151);
                border-bottom: 1px solid var(--border-color, #4b5563);
                padding: 6px 15px;
                display: flex;
                align-items: center;
                gap: 10px;
                z-index: 100;
                height: 30px;
            }

            .volume-meter-title {
                font-weight: 500;
                font-size: 0.85rem;
                color: var(--text-color, #f9fafb);
                white-space: nowrap;
            }

            .sensitivity-label {
                white-space: nowrap;
                font-size: 0.85rem;
            }

            /* Add padding to the editor container to make room for the volume controls */
            .editor-container {
                padding-top: 30px !important;
            }

            .volume-meter {
                height: 14px;
                background-color: var(--surface-color, #1f2937);
                border-radius: 7px;
                position: relative;
                overflow: hidden;
                flex: 0 0 120px;
            }

            .volume-level {
                height: 100%;
                width: 0%;
                background: linear-gradient(90deg, #4f46e5 0%, #06b6d4 100%);
                border-radius: 7px;
                transition: width 0.1s ease;
            }

            .threshold-indicator {
                position: absolute;
                top: 0;
                height: 100%;
                width: 2px;
                background-color: #ef4444;
                transition: left 0.2s ease;
            }

            .sensitivity-container {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1;
                max-width: 200px;
            }

            .sensitivity-slider {
                flex-grow: 1;
                height: 5px;
                -webkit-appearance: none;
                appearance: none;
                background: var(--surface-color, #1f2937);
                outline: none;
                border-radius: 5px;
            }

            .sensitivity-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 15px;
                height: 15px;
                border-radius: 50%;
                background: var(--primary-color, #4f46e5);
                cursor: pointer;
            }

            .sensitivity-slider::-moz-range-thumb {
                width: 15px;
                height: 15px;
                border-radius: 50%;
                background: var(--primary-color, #4f46e5);
                cursor: pointer;
                border: none;
            }

            /* Pulse animation for when volume is above threshold */
            @keyframes pulse {
                0% { box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.7); }
                70% { box-shadow: 0 0 0 5px rgba(79, 70, 229, 0); }
                100% { box-shadow: 0 0 0 0 rgba(79, 70, 229, 0); }
            }

            .volume-level.active {
                animation: pulse 1.5s infinite;
            }
        `;

        document.head.appendChild(style);

        // Find a good place to add the controls
        const editorContainer = document.querySelector('.editor-container');
        if (editorContainer) {
            editorContainer.appendChild(container);
        } else {
            document.body.appendChild(container);
        }
    }

    // Update volume meter display
    updateVolumeMeter() {
        const volumeLevel = document.getElementById('volumeLevel');
        const thresholdIndicator = document.getElementById('thresholdIndicator');

        if (volumeLevel) {
            // Update volume level width
            volumeLevel.style.width = `${this.currentVolume * 100}%`;

            // Add/remove active class based on threshold
            if (this.currentVolume >= this.volumeThreshold) {
                volumeLevel.classList.add('active');
            } else {
                volumeLevel.classList.remove('active');
            }
        }

        if (thresholdIndicator) {
            // Update threshold indicator position
            thresholdIndicator.style.left = `${this.volumeThreshold * 100}%`;
        }
    }

    // This method is kept for compatibility but no longer minimizes the controls
    toggleVolumeControls(show) {
        // Volume controls are now always visible, so this method does nothing
        // We keep it for compatibility with existing code
    }

    // Method to ensure recognition is running if it should be
    ensureRecognitionIsRunning() {
        if (this.isRecording && !this.isPaused) {
            try {
                // Finalize any interim results before restarting
                const quillEditor = this.getQuillEditor();
                if (quillEditor && this.lastInterimLength > 0) {
                    this.finalizeInterimResults(quillEditor);
                }

                // Check if recognition is active by trying to stop it
                // This will throw an error if it's not running
                this.recognition.stop();

                // Reset transcription tracking to prevent duplication
                this.transcriptionStartIndex = null;
                this.lastInterimLength = 0;
                this.lastFinalizedIndex = -1;

                // If we get here, recognition was running and we stopped it
                // So we need to restart it
                setTimeout(() => {
                    if (this.isRecording && !this.isPaused) {
                        try {
                            this.recognition.start();
                            console.log('Recognition restarted after check');
                        } catch (error) {
                            console.error('Error restarting recognition after check:', error);
                        }
                    }
                }, 100);
            } catch (error) {
                // If we get an error, recognition wasn't running
                // So we need to start it
                console.log('Recognition not running but should be, restarting...');

                // Reset transcription tracking to prevent duplication
                this.transcriptionStartIndex = null;
                this.lastInterimLength = 0;
                this.lastFinalizedIndex = -1;

                setTimeout(() => {
                    if (this.isRecording && !this.isPaused) {
                        try {
                            this.recognition.start();
                            console.log('Recognition started after finding it stopped');
                        } catch (startError) {
                            console.error('Error starting recognition after finding it stopped:', startError);
                        }
                    }
                }, 100);
            }
        }
    }
}

// Initialize the speech recognition manager
let speechRecognitionManager;

document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Speech Recognition Manager');
    speechRecognitionManager = new SpeechRecognitionManager();
    console.log('Speech Recognition supported:', speechRecognitionManager.isSupported);

    // Initialize volume controls on page load
    if (speechRecognitionManager.isSupported) {
        // Create the volume controls
        speechRecognitionManager.createVolumeControls();

        // Initialize volume monitoring after a short delay to ensure the DOM is fully loaded
        setTimeout(() => {
            speechRecognitionManager.initializeVolumeMonitoring();
        }, 500);
    }

    // Clean up resources when page is unloaded
    window.addEventListener('beforeunload', () => {
        if (speechRecognitionManager) {
            // Stop recording if active
            if (speechRecognitionManager.isRecording) {
                speechRecognitionManager.stopRecording();
            }

            // Stop volume monitoring
            speechRecognitionManager.stopVolumeMonitoring();
        }
    });
});

// Global functions to control speech recognition
function toggleSpeechRecognition() {
    if (!speechRecognitionManager) return;

    if (speechRecognitionManager.isRecording) {
        speechRecognitionManager.stopRecording();
    } else {
        speechRecognitionManager.startRecording();
    }
}

function pauseResumeSpeechRecognition() {
    if (!speechRecognitionManager) return;

    if (speechRecognitionManager.isPaused) {
        speechRecognitionManager.resumeRecording();
    } else {
        speechRecognitionManager.pauseRecording();
    }
}

function stopSpeechRecognition() {
    if (!speechRecognitionManager) return;
    speechRecognitionManager.stopRecording();
}

function summarizeTranscription() {
    if (!speechRecognitionManager) return;
    speechRecognitionManager.summarizeTranscript();
}

function toggleSpeechLanguage() {
    if (!speechRecognitionManager) return;
    speechRecognitionManager.toggleRecognitionLanguage();
}

function showSpeechLanguageSettings() {
    if (!speechRecognitionManager) return;
    speechRecognitionManager.showLanguageSettings();
}

function toggleVolumeSettings() {
    if (!speechRecognitionManager) return;

    // Initialize volume monitoring if not already active
    if (!speechRecognitionManager.isVolumeMonitoringActive) {
        speechRecognitionManager.initializeVolumeMonitoring();
    }

    // Volume controls are now always visible, so this function just ensures they're initialized
}

// Check if browser supports speech recognition
function isSpeechRecognitionSupported() {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

// Log support status when the script loads
console.log('Speech Recognition API supported:', isSpeechRecognitionSupported());
