/**
 * Speech Synthesis Module for GPAce Workspace
 * Implements text-to-speech functionality using Web Speech API
 */

class SpeechSynthesisManager {
    constructor() {
        // Check if browser supports speech synthesis
        if (!('speechSynthesis' in window)) {
            console.error('Speech synthesis not supported in this browser');
            this.isSupported = false;
            return;
        }

        this.isSupported = true;
        this.synthesis = window.speechSynthesis;
        this.utterance = null;
        this.isSpeaking = false;
        this.isPaused = false;
        this.currentVoice = null;
        this.rate = 1.0;
        this.pitch = 1.0;
        this.volume = 1.0;
        this.highlightedRanges = [];
        this.currentWordRange = null;
        this.fullTextRange = null;
        this.textContent = '';
        this.wordBoundaries = [];
        this.currentWordIndex = -1;
        this.availableVoices = [];

        // Initialize voices
        this.loadVoices();

        // Some browsers need a delay to load voices
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = this.loadVoices.bind(this);
        }
    }

    loadVoices() {
        // Get list of available voices
        this.availableVoices = this.synthesis.getVoices();

        if (this.availableVoices.length > 0) {
            // Set default voice (prefer English)
            this.currentVoice = this.availableVoices.find(voice =>
                voice.lang.includes('en-US') || voice.lang.includes('en-GB')
            ) || this.availableVoices[0];

            console.log(`Loaded ${this.availableVoices.length} voices. Default: ${this.currentVoice.name}`);
        } else {
            console.warn('No voices available yet, will retry later');
        }
    }

    getVoiceOptions() {
        return this.availableVoices.map(voice => ({
            id: voice.voiceURI,
            name: `${voice.name} (${voice.lang})`,
            lang: voice.lang,
            default: voice.default
        }));
    }

    setVoice(voiceURI) {
        const voice = this.availableVoices.find(v => v.voiceURI === voiceURI);
        if (voice) {
            this.currentVoice = voice;

            // If currently speaking, update the voice
            if (this.isSpeaking && this.utterance) {
                this.stopSpeaking();
                this.speakText(this.lastSpokenText);
            }

            return true;
        }
        return false;
    }

    setRate(rate) {
        this.rate = parseFloat(rate);
        if (this.utterance) {
            this.utterance.rate = this.rate;
        }
    }

    setPitch(pitch) {
        this.pitch = parseFloat(pitch);
        if (this.utterance) {
            this.utterance.pitch = this.pitch;
        }
    }

    setVolume(volume) {
        this.volume = parseFloat(volume);
        if (this.utterance) {
            this.utterance.volume = this.volume;
        }
    }

    speakSelectedText() {
        // Get Quill editor instance
        const quillEditor = this.getQuillEditor();
        if (!quillEditor) {
            console.error('Quill editor not found');
            this.showToast('Editor not found', 'error');
            return false;
        }

        // Get selected text
        const range = quillEditor.getSelection();
        if (!range || range.length === 0) {
            this.showToast('No text selected. Please select text to read aloud.', 'info');
            return false;
        }

        // Get the selected text
        const text = quillEditor.getText(range.index, range.length);
        if (!text || text.trim() === '') {
            this.showToast('Selected text is empty', 'info');
            return false;
        }

        // Speak the selected text
        return this.speakText(text, range);
    }

    speakAllText() {
        // Get Quill editor instance
        const quillEditor = this.getQuillEditor();
        if (!quillEditor) {
            console.error('Quill editor not found');
            this.showToast('Editor not found', 'error');
            return false;
        }

        // Get all text
        const text = quillEditor.getText();
        if (!text || text.trim() === '') {
            this.showToast('Document is empty', 'info');
            return false;
        }

        // Speak the entire document
        return this.speakText(text);
    }

    speakText(text, range = null) {
        if (!this.isSupported) {
            this.showToast('Text-to-speech is not supported in your browser', 'error');
            return false;
        }

        // Stop any current speech
        if (this.isSpeaking) {
            this.stopSpeaking();
        }

        try {
            // Store the text and range for word highlighting
            this.textContent = text;
            this.fullTextRange = range;
            this.wordBoundaries = [];
            this.currentWordIndex = -1;

            // Create a new utterance
            this.utterance = new SpeechSynthesisUtterance(text);
            this.lastSpokenText = text;

            // Set voice and properties
            if (this.currentVoice) {
                this.utterance.voice = this.currentVoice;
            }
            this.utterance.rate = this.rate;
            this.utterance.pitch = this.pitch;
            this.utterance.volume = this.volume;

            // Set up event handlers
            this.utterance.onstart = () => {
                this.isSpeaking = true;
                this.isPaused = false;
                this.updateSpeakingState(true);

                // Highlight full text if range is provided
                if (range) {
                    this.highlightText(range, '#F0F8FF'); // Light blue background for full text
                }

                this.showToast('Reading text aloud', 'info');
            };

            // Handle word boundaries for highlighting current word
            this.utterance.onboundary = (event) => {
                // Only process word boundaries
                if (event.name === 'word') {
                    // Store word boundary information
                    this.wordBoundaries.push({
                        charIndex: event.charIndex,
                        charLength: event.charLength || this.estimateWordLength(text, event.charIndex)
                    });

                    // Update current word index
                    this.currentWordIndex = this.wordBoundaries.length - 1;

                    // Highlight the current word
                    this.highlightCurrentWord();
                }
            };

            this.utterance.onend = () => {
                this.isSpeaking = false;
                this.isPaused = false;
                this.updateSpeakingState(false);

                // Remove any highlights
                this.removeHighlights();

                // Reset word tracking
                this.wordBoundaries = [];
                this.currentWordIndex = -1;
                this.fullTextRange = null;

                this.showToast('Finished reading', 'success');
            };

            this.utterance.onerror = (event) => {
                console.error('Speech synthesis error:', event.error);
                this.isSpeaking = false;
                this.isPaused = false;
                this.updateSpeakingState(false);

                // Remove any highlights
                this.removeHighlights();

                // Reset word tracking
                this.wordBoundaries = [];
                this.currentWordIndex = -1;
                this.fullTextRange = null;

                this.showToast(`Speech synthesis error: ${event.error}`, 'error');
            };

            // Start speaking
            this.synthesis.speak(this.utterance);
            return true;
        } catch (error) {
            console.error('Error starting speech synthesis:', error);
            this.showToast('Error starting text-to-speech', 'error');
            return false;
        }
    }

    // Estimate word length when not provided by the browser
    estimateWordLength(text, startIndex) {
        // Find the end of the current word
        const wordEndRegex = /\s|[,.;:!?]|$/;
        let endIndex = startIndex;

        while (endIndex < text.length) {
            if (wordEndRegex.test(text[endIndex])) {
                break;
            }
            endIndex++;
        }

        return endIndex - startIndex;
    }

    // Highlight the current word being spoken
    highlightCurrentWord() {
        if (!this.isSpeaking || this.currentWordIndex < 0 || !this.fullTextRange) {
            return;
        }

        const quillEditor = this.getQuillEditor();
        if (!quillEditor) {
            return;
        }

        // Remove previous word highlight
        if (this.currentWordRange) {
            quillEditor.formatText(
                this.currentWordRange.index,
                this.currentWordRange.length,
                { 'background': '#F0F8FF' } // Reset to light blue (same as full text)
            );
        }

        // Get current word boundary
        const wordBoundary = this.wordBoundaries[this.currentWordIndex];
        if (!wordBoundary) {
            return;
        }

        // Calculate the position in the editor
        const startIndex = this.fullTextRange.index + wordBoundary.charIndex;
        const length = wordBoundary.charLength;

        // Highlight the current word
        quillEditor.formatText(
            startIndex,
            length,
            { 'background': '#FFEB3B' } // Yellow highlight for current word
        );

        // Store the current word range
        this.currentWordRange = { index: startIndex, length: length };

        // Scroll to the current word if needed
        this.scrollToCurrentWord(startIndex);
    }

    pauseSpeaking() {
        if (!this.isSpeaking || !this.isSupported) {
            return false;
        }

        if (this.isPaused) {
            // Resume speaking
            this.synthesis.resume();
            this.isPaused = false;
            this.showToast('Resumed reading', 'info');
        } else {
            // Pause speaking
            this.synthesis.pause();
            this.isPaused = true;
            this.showToast('Paused reading', 'info');
        }

        this.updateSpeakingState(true, this.isPaused);
        return true;
    }

    stopSpeaking() {
        if (!this.isSupported) {
            return false;
        }

        // Cancel any current speech
        this.synthesis.cancel();
        this.isSpeaking = false;
        this.isPaused = false;
        this.updateSpeakingState(false);

        // Remove any highlights
        this.removeHighlights();

        // Reset word tracking
        this.wordBoundaries = [];
        this.currentWordIndex = -1;
        this.fullTextRange = null;
        this.currentWordRange = null;

        return true;
    }

    updateSpeakingState(isSpeaking, isPaused = false) {
        // Update UI elements based on speaking state
        const speakBtn = document.getElementById('textToSpeechBtn');
        const pauseResumeBtn = document.getElementById('pauseResumeTextToSpeechBtn');
        const stopBtn = document.getElementById('stopTextToSpeechBtn');

        if (speakBtn) {
            speakBtn.disabled = isSpeaking;
        }

        if (pauseResumeBtn) {
            pauseResumeBtn.disabled = !isSpeaking;
            if (isPaused) {
                pauseResumeBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
                pauseResumeBtn.setAttribute('data-tooltip', 'Resume Reading');
            } else {
                pauseResumeBtn.innerHTML = '<i class="bi bi-pause-fill"></i>';
                pauseResumeBtn.setAttribute('data-tooltip', 'Pause Reading');
            }
        }

        if (stopBtn) {
            stopBtn.disabled = !isSpeaking;
        }
    }

    highlightText(range, color = '#FFEB3B') {
        // Get Quill editor instance
        const quillEditor = this.getQuillEditor();
        if (!quillEditor) {
            return;
        }

        // Add a background color to the text
        quillEditor.formatText(range.index, range.length, {
            'background': color
        });

        // Store the range for later removal
        this.highlightedRanges.push(range);
    }

    removeHighlights() {
        // Get Quill editor instance
        const quillEditor = this.getQuillEditor();
        if (!quillEditor) {
            return;
        }

        // Remove all highlights
        this.highlightedRanges.forEach(range => {
            quillEditor.formatText(range.index, range.length, {
                'background': false
            });
        });

        // Clear the stored ranges
        this.highlightedRanges = [];

        // Also clear current word highlight if any
        if (this.currentWordRange) {
            quillEditor.formatText(this.currentWordRange.index, this.currentWordRange.length, {
                'background': false
            });
            this.currentWordRange = null;
        }
    }

    scrollToCurrentWord(index) {
        const quillEditor = this.getQuillEditor();
        if (!quillEditor) {
            return;
        }

        // Get the bounds of the current word
        const bounds = quillEditor.getBounds(index);

        // Get the editor container
        const editorContainer = document.querySelector('.ql-editor');
        if (!editorContainer) {
            return;
        }

        // Calculate if the word is visible in the viewport
        const containerRect = editorContainer.getBoundingClientRect();
        const wordTop = bounds.top + editorContainer.scrollTop;
        const wordBottom = bounds.bottom + editorContainer.scrollTop;

        // If the word is not fully visible, scroll to make it visible
        if (wordTop < editorContainer.scrollTop || wordBottom > (editorContainer.scrollTop + containerRect.height)) {
            // Scroll to position the word in the middle of the viewport
            const targetScroll = wordTop - (containerRect.height / 2);
            editorContainer.scrollTop = Math.max(0, targetScroll);
        }
    }

    getQuillEditor() {
        // Try to get the Quill editor instance
        return window.quill || null;
    }

    showToast(message, type = 'info', duration = 3000) {
        // Create a custom compact toast for text-to-speech notifications
        const toastId = 'tts-toast-' + Date.now();

        // Create a new toast element
        const toast = document.createElement('div');
        toast.id = toastId;
        toast.className = `tts-status-message ${type}`;
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.right = '20px';
        toast.style.backgroundColor = 'var(--card-bg, #fff)';
        toast.style.color = 'var(--text-color, #333)';
        toast.style.padding = '8px 12px';
        toast.style.borderRadius = '4px';
        toast.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        toast.style.zIndex = '9999';
        toast.style.fontSize = '14px';
        toast.style.maxWidth = '250px';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'opacity 0.3s, transform 0.3s';

        // Set border color based on type
        let borderColor = '#2196F3'; // info (blue)
        let icon = 'info-circle-fill';

        switch(type) {
            case 'success':
                borderColor = '#4CAF50'; // green
                icon = 'check-circle-fill';
                break;
            case 'error':
                borderColor = '#F44336'; // red
                icon = 'exclamation-circle-fill';
                break;
            case 'warning':
                borderColor = '#FF9800'; // orange
                icon = 'exclamation-triangle-fill';
                break;
        }

        toast.style.borderLeft = `4px solid ${borderColor}`;

        // Add content
        toast.innerHTML = `
            <i class="bi bi-${icon}" style="margin-right: 8px; color: ${borderColor};"></i>
            <span>${message}</span>
            <button class="tts-toast-close" style="background: none; border: none; cursor: pointer; margin-left: 8px; font-size: 16px; color: var(--text-color, #333); opacity: 0.7;">&times;</button>
        `;

        // Add to document
        document.body.appendChild(toast);

        // Add close button functionality
        const closeBtn = toast.querySelector('.tts-toast-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hideToast(toastId);
            });
        }

        // Show with animation
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }, 10);

        // Auto-hide after duration
        if (duration > 0) {
            setTimeout(() => {
                this.hideToast(toastId);
            }, duration);
        }

        return toastId;
    }

    hideToast(id) {
        const toast = document.getElementById(id);
        if (toast) {
            // Fade out
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';

            // Remove after animation completes
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }
    }

    // Show a dialog to select voice and speech settings
    showSettingsDialog() {
        // Create modal if it doesn't exist
        let modal = document.getElementById('textToSpeechSettingsModal');

        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'textToSpeechSettingsModal';
            modal.className = 'modal';
            modal.style.display = 'none';
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100%';
            modal.style.height = '100%';
            modal.style.background = 'rgba(0,0,0,0.5)';
            modal.style.zIndex = '1000';

            const modalContent = document.createElement('div');
            modalContent.className = 'modal-content';
            modalContent.style.position = 'fixed';
            modalContent.style.top = '50%';
            modalContent.style.left = '50%';
            modalContent.style.transform = 'translate(-50%, -50%)';
            modalContent.style.background = 'var(--card-bg)';
            modalContent.style.padding = '20px';
            modalContent.style.borderRadius = '8px';
            modalContent.style.minWidth = '300px';

            modalContent.innerHTML = `
                <h3 style="margin-top: 0;">Text-to-Speech Settings</h3>

                <div style="margin: 10px 0;">
                    <label style="display: block; margin-bottom: 5px;">Voice:</label>
                    <select id="ttsVoiceSelect" style="width: 100%; padding: 8px; background: var(--background-color); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 4px;">
                        ${this.getVoiceOptions().map(voice =>
                            `<option value="${voice.id}" ${voice.id === this.currentVoice?.voiceURI ? 'selected' : ''}>${voice.name}</option>`
                        ).join('')}
                    </select>
                </div>

                <div style="margin: 10px 0;">
                    <label style="display: block; margin-bottom: 5px;">Rate: <span id="rateValue">${this.rate}</span></label>
                    <input type="range" id="ttsRateSlider" min="0.5" max="2" step="0.1" value="${this.rate}" style="width: 100%;">
                </div>

                <div style="margin: 10px 0;">
                    <label style="display: block; margin-bottom: 5px;">Pitch: <span id="pitchValue">${this.pitch}</span></label>
                    <input type="range" id="ttsPitchSlider" min="0.5" max="2" step="0.1" value="${this.pitch}" style="width: 100%;">
                </div>

                <div style="margin: 10px 0;">
                    <label style="display: block; margin-bottom: 5px;">Volume: <span id="volumeValue">${this.volume}</span></label>
                    <input type="range" id="ttsVolumeSlider" min="0" max="1" step="0.1" value="${this.volume}" style="width: 100%;">
                </div>

                <div class="modal-buttons" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 15px;">
                    <button id="ttsCancelBtn" style="padding: 6px 12px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--background-color); color: var(--text-color);">Cancel</button>
                    <button id="ttsApplyBtn" style="padding: 6px 12px; border-radius: 4px; border: none; background: var(--primary-color); color: white;">Apply</button>
                </div>
            `;

            modal.appendChild(modalContent);
            document.body.appendChild(modal);

            // Add event listeners
            document.getElementById('ttsRateSlider').addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                document.getElementById('rateValue').textContent = value.toFixed(1);
            });

            document.getElementById('ttsPitchSlider').addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                document.getElementById('pitchValue').textContent = value.toFixed(1);
            });

            document.getElementById('ttsVolumeSlider').addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                document.getElementById('volumeValue').textContent = value.toFixed(1);
            });

            document.getElementById('ttsCancelBtn').addEventListener('click', () => {
                modal.style.display = 'none';
            });

            document.getElementById('ttsApplyBtn').addEventListener('click', () => {
                // Apply settings
                const voiceURI = document.getElementById('ttsVoiceSelect').value;
                const rate = parseFloat(document.getElementById('ttsRateSlider').value);
                const pitch = parseFloat(document.getElementById('ttsPitchSlider').value);
                const volume = parseFloat(document.getElementById('ttsVolumeSlider').value);

                this.setVoice(voiceURI);
                this.setRate(rate);
                this.setPitch(pitch);
                this.setVolume(volume);

                modal.style.display = 'none';
                this.showToast('Text-to-speech settings updated', 'success');
            });
        } else {
            // Update existing modal with current values
            const voiceSelect = document.getElementById('ttsVoiceSelect');
            if (voiceSelect) {
                voiceSelect.innerHTML = this.getVoiceOptions().map(voice =>
                    `<option value="${voice.id}" ${voice.id === this.currentVoice?.voiceURI ? 'selected' : ''}>${voice.name}</option>`
                ).join('');
            }

            const rateSlider = document.getElementById('ttsRateSlider');
            const rateValue = document.getElementById('rateValue');
            if (rateSlider && rateValue) {
                rateSlider.value = this.rate;
                rateValue.textContent = this.rate.toFixed(1);
            }

            const pitchSlider = document.getElementById('ttsPitchSlider');
            const pitchValue = document.getElementById('pitchValue');
            if (pitchSlider && pitchValue) {
                pitchSlider.value = this.pitch;
                pitchValue.textContent = this.pitch.toFixed(1);
            }

            const volumeSlider = document.getElementById('ttsVolumeSlider');
            const volumeValue = document.getElementById('volumeValue');
            if (volumeSlider && volumeValue) {
                volumeSlider.value = this.volume;
                volumeValue.textContent = this.volume.toFixed(1);
            }
        }

        // Show the modal
        modal.style.display = 'block';
    }
}

// Initialize the speech synthesis manager
let speechSynthesisManager;

document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Speech Synthesis Manager');
    speechSynthesisManager = new SpeechSynthesisManager();
    console.log('Speech Synthesis supported:', speechSynthesisManager.isSupported);
});

// Global functions to control speech synthesis
function speakSelectedText() {
    if (!speechSynthesisManager) return;
    speechSynthesisManager.speakSelectedText();
    closeTextToSpeechDropdown();
}

function speakAllText() {
    if (!speechSynthesisManager) return;
    speechSynthesisManager.speakAllText();
    closeTextToSpeechDropdown();
}

function pauseResumeSpeaking() {
    if (!speechSynthesisManager) return;
    speechSynthesisManager.pauseSpeaking();
}

function stopSpeaking() {
    if (!speechSynthesisManager) return;
    speechSynthesisManager.stopSpeaking();
}

function showTextToSpeechSettings() {
    if (!speechSynthesisManager) return;
    speechSynthesisManager.showSettingsDialog();
    closeTextToSpeechDropdown();
}

// Check if browser supports speech synthesis
function isSpeechSynthesisSupported() {
    return 'speechSynthesis' in window;
}

// Create a dropdown menu for text-to-speech options
function showTextToSpeechOptions() {
    const dropdown = document.getElementById('textToSpeechOptionsDropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

// Close the text-to-speech dropdown
function closeTextToSpeechDropdown() {
    const dropdown = document.getElementById('textToSpeechOptionsDropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
    }
}

// Log support status when the script loads
console.log('Speech Synthesis API supported:', isSpeechSynthesisSupported());
