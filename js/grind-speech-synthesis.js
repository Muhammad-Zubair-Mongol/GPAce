/**
 * Speech Synthesis Module for GPAce Grind
 * Implements text-to-speech functionality with word highlighting for AI search results
 */

class GrindSpeechSynthesis {
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
        this.textContent = '';
        this.wordBoundaries = [];
        this.currentWordIndex = -1;
        this.availableVoices = [];
        this.resultsContainer = null;
        this.originalContent = null;
        this.highlightedWords = [];

        // Load saved preferences
        this.loadPreferences();

        // Initialize voices
        this.loadVoices();

        // Some browsers need a delay to load voices
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = this.loadVoices.bind(this);
        }

        // Set up event listeners for voice settings
        this.setupEventListeners();
    }

    // Load saved preferences from localStorage
    loadPreferences() {
        try {
            // Load speech rate
            const savedRate = localStorage.getItem('tts-rate');
            if (savedRate) {
                this.rate = parseFloat(savedRate);
            }

            // Load voice preference (we'll apply it after voices are loaded)
            this.savedVoiceURI = localStorage.getItem('tts-voice');
        } catch (error) {
            console.error('Error loading TTS preferences:', error);
        }
    }

    // Save preferences to localStorage
    savePreferences() {
        try {
            // Save speech rate
            localStorage.setItem('tts-rate', this.rate.toString());

            // Save voice preference
            if (this.currentVoice) {
                localStorage.setItem('tts-voice', this.currentVoice.voiceURI);
            }
        } catch (error) {
            console.error('Error saving TTS preferences:', error);
        }
    }

    loadVoices() {
        try {
            // Force a refresh of the voices list
            window.speechSynthesis.cancel();

            // Get available voices
            const voices = this.synthesis.getVoices();
            console.log(`Loading voices, found ${voices ? voices.length : 0} voices`);

            if (voices && voices.length > 0) {
                this.availableVoices = voices;

                // Try to find the saved voice
                let selectedVoice = null;

                if (this.savedVoiceURI) {
                    console.log(`Looking for saved voice: ${this.savedVoiceURI}`);
                    selectedVoice = voices.find(voice => voice.voiceURI === this.savedVoiceURI);
                    if (selectedVoice) {
                        console.log(`Found saved voice: ${selectedVoice.name}`);
                    } else {
                        console.log(`Saved voice not found in available voices`);
                    }
                }

                // If no saved voice or saved voice not found, use default
                if (!selectedVoice) {
                    console.log('Selecting default voice');

                    // Prefer natural-sounding voices (often these are not "localService")
                    // Try to find Google, Microsoft, or Amazon voices first
                    selectedVoice = voices.find(voice =>
                        voice.name.includes('Google') ||
                        voice.name.includes('Microsoft') ||
                        voice.name.includes('Amazon')
                    );

                    if (selectedVoice) {
                        console.log(`Selected premium voice: ${selectedVoice.name}`);
                    }

                    // If no premium voice found, try to find any English voice
                    if (!selectedVoice) {
                        selectedVoice = voices.find(voice => voice.lang.includes('en'));
                        if (selectedVoice) {
                            console.log(`Selected English voice: ${selectedVoice.name}`);
                        }
                    }

                    // Fallback to first voice if nothing else found
                    if (!selectedVoice) {
                        selectedVoice = voices[0];
                        console.log(`Fallback to first voice: ${selectedVoice.name}`);
                    }
                }

                this.currentVoice = selectedVoice;
                console.log(`Speech synthesis voices loaded: ${voices.length}`);
                console.log(`Selected voice: ${this.currentVoice.name} (${this.currentVoice.lang})`);

                // Populate the voice selector dropdown
                this.populateVoiceSelector();
            } else {
                console.warn('No speech synthesis voices available');

                // Try again after a short delay
                setTimeout(() => {
                    const retryVoices = this.synthesis.getVoices();
                    if (retryVoices && retryVoices.length > 0) {
                        console.log(`Retry successful, found ${retryVoices.length} voices`);
                        this.availableVoices = retryVoices;
                        this.populateVoiceSelector();
                    } else {
                        console.error('Still no voices available after retry');
                    }
                }, 1000);
            }
        } catch (error) {
            console.error('Error loading speech synthesis voices:', error);
        }
    }

    speakSearchResults() {
        // Get the search results container
        this.resultsContainer = document.getElementById('searchResults');
        if (!this.resultsContainer) {
            this.showToast('Results container not found', 'error');
            return false;
        }

        // Get the text content
        const text = this.resultsContainer.innerText;
        if (!text || text.trim() === '') {
            this.showToast('No content to read', 'info');
            return false;
        }

        // If already speaking, cycle through highlight styles instead of restarting
        if (this.isSpeaking) {
            this.cycleHighlightStyle();
            return true;
        }

        // Save original content for restoration
        this.originalContent = this.resultsContainer.innerHTML;

        // Speak the text
        return this.speakText(text);
    }

    // Cycle through different highlight styles
    cycleHighlightStyle() {
        if (!this.resultsContainer) return;

        // Define the highlight styles
        const highlightStyles = ['', 'tts-highlight-style-2', 'tts-highlight-style-3'];

        // Find the current style index
        let currentIndex = highlightStyles.indexOf(this.currentHighlightStyle);

        // Move to the next style (or back to the first)
        currentIndex = (currentIndex + 1) % highlightStyles.length;
        const newStyle = highlightStyles[currentIndex];

        // Remove all style classes
        this.resultsContainer.classList.remove(
            'tts-highlight-style-2',
            'tts-highlight-style-3'
        );

        // Add the new style class if it's not the default (empty string)
        if (newStyle) {
            this.resultsContainer.classList.add(newStyle);
        }

        // Update the current style
        this.currentHighlightStyle = newStyle;

        // Show a toast with the style name
        const styleNames = ['Default', 'Purple', 'Teal'];
        this.showToast(`Highlight style: ${styleNames[currentIndex]}`, 'info', 1500);
    }

    speakText(text) {
        if (!this.isSupported) {
            this.showToast('Text-to-speech is not supported in your browser', 'error');
            return false;
        }

        // Stop any current speech
        if (this.isSpeaking) {
            this.stopSpeaking();
        }

        try {
            // Store the text for word highlighting
            this.textContent = text;
            this.wordBoundaries = [];
            this.currentWordIndex = -1;
            this.highlightedWords = [];

            // Prepare the content for highlighting
            this.prepareContentForHighlighting();

            // Create a new utterance
            this.utterance = new SpeechSynthesisUtterance(text);

            // Set voice and properties
            if (this.currentVoice) {
                try {
                    // Ensure we have the most up-to-date voice object
                    const freshVoices = window.speechSynthesis.getVoices();
                    const freshVoice = freshVoices.find(v => v.voiceURI === this.currentVoice.voiceURI);

                    if (freshVoice) {
                        this.utterance.voice = freshVoice;
                        console.log(`Using voice: ${freshVoice.name} (${freshVoice.lang})`);
                    } else {
                        this.utterance.voice = this.currentVoice;
                        console.log(`Using cached voice: ${this.currentVoice.name} (${this.currentVoice.lang})`);
                    }
                } catch (error) {
                    console.error('Error setting voice:', error);
                    // Fallback to direct assignment
                    this.utterance.voice = this.currentVoice;
                    console.log(`Fallback to direct voice assignment: ${this.currentVoice.name}`);
                }
            } else {
                console.warn('No voice selected, using browser default');
            }

            // Apply saved rate
            this.utterance.rate = this.rate;
            console.log(`Using speech rate: ${this.rate}x`);

            this.utterance.pitch = this.pitch;
            this.utterance.volume = this.volume;

            // Set up event handlers
            this.utterance.onstart = () => {
                this.isSpeaking = true;
                this.isPaused = false;
                this.updateSpeakingState(true);
                this.showToast('Reading results aloud', 'info');
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
                this.restoreOriginalContent();
                this.showToast('Finished reading', 'success');
            };

            this.utterance.onerror = (event) => {
                console.error('Speech synthesis error:', event);
                this.isSpeaking = false;
                this.isPaused = false;
                this.updateSpeakingState(false);
                this.restoreOriginalContent();
                this.showToast('Error during text-to-speech', 'error');
            };

            // Start speaking
            try {
                // Cancel any previous speech first to ensure clean state
                this.synthesis.cancel();

                // Add the utterance to the queue
                this.synthesis.speak(this.utterance);

                // Check if speech actually started
                if (this.synthesis.speaking) {
                    console.log('Speech started successfully');
                    return true;
                } else {
                    // If speech didn't start, try again with default voice
                    console.warn('Speech did not start, trying with default voice');
                    this.utterance.voice = null;
                    this.synthesis.speak(this.utterance);
                    return true;
                }
            } catch (error) {
                console.error('Error in speak method:', error);
                // Try one more time with minimal settings
                try {
                    const simpleUtterance = new SpeechSynthesisUtterance(text);
                    this.synthesis.speak(simpleUtterance);
                    return true;
                } catch (fallbackError) {
                    console.error('Fallback speech attempt failed:', fallbackError);
                    return false;
                }
            }
        } catch (error) {
            console.error('Error starting speech synthesis:', error);
            this.showToast('Error starting text-to-speech', 'error');
            return false;
        }
    }

    // Prepare the content for word-by-word highlighting
    prepareContentForHighlighting() {
        if (!this.resultsContainer) return;

        // Add a highlight style class to the container (randomly select a style)
        const highlightStyles = ['', 'tts-highlight-style-2', 'tts-highlight-style-3'];
        const randomStyle = highlightStyles[Math.floor(Math.random() * highlightStyles.length)];
        this.resultsContainer.classList.add(randomStyle);
        this.currentHighlightStyle = randomStyle;

        // Split the text into words and wrap each in a span for highlighting
        const words = this.textContent.split(/(\s+)/);
        let htmlContent = '';

        words.forEach((word, index) => {
            if (word.trim() === '') {
                // Preserve whitespace
                htmlContent += word;
            } else {
                // Wrap words in spans with unique IDs
                htmlContent += `<span class="tts-word" id="tts-word-${index}">${word}</span>`;
            }
        });

        // Replace the content with our prepared version
        this.resultsContainer.innerHTML = htmlContent;
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
        if (!this.isSpeaking || this.currentWordIndex < 0 || !this.resultsContainer) {
            return;
        }

        // Get current word boundary
        const wordBoundary = this.wordBoundaries[this.currentWordIndex];
        if (!wordBoundary) {
            return;
        }

        // Find the word at this position
        const wordToHighlight = this.findWordAtPosition(wordBoundary.charIndex);

        // Remove highlight from previously highlighted words
        this.highlightedWords.forEach(wordId => {
            const wordElement = document.getElementById(wordId);
            if (wordElement) {
                wordElement.classList.remove('tts-highlighted');
            }
        });

        // Clear the array
        this.highlightedWords = [];

        // Add highlight to current word
        if (wordToHighlight) {
            wordToHighlight.classList.add('tts-highlighted');
            this.highlightedWords.push(wordToHighlight.id);

            // Scroll to the highlighted word
            this.scrollToElement(wordToHighlight);
        }
    }

    // Find the word element at a specific character position
    findWordAtPosition(charIndex) {
        // This is a simplified approach - in a real implementation,
        // you would need a more sophisticated algorithm to map character
        // positions to word elements

        // Get all word elements
        const wordElements = this.resultsContainer.querySelectorAll('.tts-word');

        // Calculate cumulative character count
        let cumulativeLength = 0;

        for (let i = 0; i < wordElements.length; i++) {
            const wordLength = wordElements[i].textContent.length;

            // Check if this word contains the character at charIndex
            if (charIndex >= cumulativeLength && charIndex < cumulativeLength + wordLength) {
                return wordElements[i];
            }

            // Add word length plus 1 for the space
            cumulativeLength += wordLength + 1;
        }

        return null;
    }

    // Scroll to make the element visible
    scrollToElement(element) {
        if (!element) return;

        // Get the container's scroll position and dimensions
        const container = this.resultsContainer;
        const containerRect = container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();

        // Check if the element is outside the visible area
        if (elementRect.top < containerRect.top ||
            elementRect.bottom > containerRect.bottom) {

            // Calculate scroll position to center the element
            const scrollTop = element.offsetTop - (container.clientHeight / 2) + (element.offsetHeight / 2);

            // Smooth scroll to the element
            container.scrollTo({
                top: scrollTop,
                behavior: 'smooth'
            });
        }
    }

    pauseSpeaking() {
        if (!this.isSupported || !this.isSpeaking) {
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

        this.updateSpeakingState(true);
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

        // Restore original content
        this.restoreOriginalContent();

        return true;
    }

    restoreOriginalContent() {
        if (this.resultsContainer && this.originalContent) {
            // Remove any highlight style classes
            this.resultsContainer.classList.remove(
                'tts-highlight-style-2',
                'tts-highlight-style-3'
            );

            // Restore the original content
            this.resultsContainer.innerHTML = this.originalContent;
            this.originalContent = null;
            this.currentHighlightStyle = null;
        }
    }

    updateSpeakingState(isSpeaking) {
        // Update UI elements based on speaking state
        const pauseResumeBtn = document.getElementById('pauseResumeTextToSpeechBtn');
        const stopBtn = document.getElementById('stopTextToSpeechBtn');
        const speakBtn = document.getElementById('speakResultsBtn');
        const decreaseSpeedBtn = document.getElementById('decreaseSpeedBtn');
        const increaseSpeedBtn = document.getElementById('increaseSpeedBtn');

        if (pauseResumeBtn) {
            pauseResumeBtn.disabled = !isSpeaking;

            // Update icon based on paused state
            const icon = pauseResumeBtn.querySelector('i');
            if (icon) {
                icon.className = this.isPaused ? 'fas fa-play' : 'fas fa-pause';
            }
        }

        if (stopBtn) {
            stopBtn.disabled = !isSpeaking;
        }

        if (speakBtn) {
            speakBtn.disabled = isSpeaking;
        }

        // Update speed control buttons
        if (decreaseSpeedBtn) {
            decreaseSpeedBtn.disabled = !isSpeaking || this.rate <= 0.25;
        }

        if (increaseSpeedBtn) {
            increaseSpeedBtn.disabled = !isSpeaking || this.rate >= 10;
        }

        // Update the speed display
        if (isSpeaking) {
            this.updateSpeedDisplay();
        }
    }

    // Populate the voice selector dropdown with available voices
    populateVoiceSelector() {
        const voiceSelector = document.getElementById('voiceSelector');
        if (!voiceSelector) return;

        // Clear existing options
        voiceSelector.innerHTML = '';

        // Group voices by language
        const voicesByLang = {};

        this.availableVoices.forEach(voice => {
            const langCode = voice.lang.split('-')[0]; // Get the base language code (e.g., 'en' from 'en-US')
            if (!voicesByLang[langCode]) {
                voicesByLang[langCode] = [];
            }
            voicesByLang[langCode].push(voice);
        });

        // Create option groups for each language
        Object.keys(voicesByLang).sort().forEach(langCode => {
            const voices = voicesByLang[langCode];

            // Create optgroup
            const optgroup = document.createElement('optgroup');
            optgroup.label = this.getLanguageName(langCode) || langCode.toUpperCase();

            // Add voices to the group
            voices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.voiceURI;
                option.textContent = voice.name;
                option.selected = (this.currentVoice && voice.voiceURI === this.currentVoice.voiceURI);
                optgroup.appendChild(option);
            });

            voiceSelector.appendChild(optgroup);
        });

        // Set the rate selector value
        const rateSelector = document.getElementById('rateSelector');
        if (rateSelector) {
            rateSelector.value = this.rate.toString();
        }
    }

    // Get language name from language code
    getLanguageName(langCode) {
        const languageNames = {
            'en': 'English',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'it': 'Italian',
            'pt': 'Portuguese',
            'ru': 'Russian',
            'ja': 'Japanese',
            'ko': 'Korean',
            'zh': 'Chinese',
            'ar': 'Arabic',
            'hi': 'Hindi',
            'bn': 'Bengali',
            'pa': 'Punjabi',
            'ta': 'Tamil',
            'te': 'Telugu',
            'mr': 'Marathi',
            'gu': 'Gujarati',
            'kn': 'Kannada',
            'ml': 'Malayalam',
            'nl': 'Dutch',
            'pl': 'Polish',
            'tr': 'Turkish',
            'uk': 'Ukrainian',
            'vi': 'Vietnamese',
            'th': 'Thai',
            'id': 'Indonesian',
            'ms': 'Malay',
            'fil': 'Filipino',
            'sv': 'Swedish',
            'no': 'Norwegian',
            'da': 'Danish',
            'fi': 'Finnish',
            'cs': 'Czech',
            'sk': 'Slovak',
            'hu': 'Hungarian',
            'ro': 'Romanian',
            'bg': 'Bulgarian',
            'el': 'Greek',
            'he': 'Hebrew'
        };

        return languageNames[langCode];
    }

    // Set up event listeners for voice settings and speed controls
    setupEventListeners() {
        // Voice settings button
        const voiceSettingsBtn = document.getElementById('voiceSettingsBtn');
        if (voiceSettingsBtn) {
            voiceSettingsBtn.addEventListener('click', () => {
                this.toggleVoiceSettingsDropdown();
            });
        }

        // Voice selector
        const voiceSelector = document.getElementById('voiceSelector');
        if (voiceSelector) {
            voiceSelector.addEventListener('change', () => {
                this.changeVoice(voiceSelector.value);
            });
        }

        // Rate selector in dropdown
        const rateSelector = document.getElementById('rateSelector');
        if (rateSelector) {
            rateSelector.addEventListener('change', () => {
                this.changeRate(parseFloat(rateSelector.value));
            });
        }

        // Speed control buttons
        const decreaseSpeedBtn = document.getElementById('decreaseSpeedBtn');
        if (decreaseSpeedBtn) {
            decreaseSpeedBtn.addEventListener('click', () => {
                this.decreaseSpeed();
            });
        }

        const increaseSpeedBtn = document.getElementById('increaseSpeedBtn');
        if (increaseSpeedBtn) {
            increaseSpeedBtn.addEventListener('click', () => {
                this.increaseSpeed();
            });
        }

        // Keyboard shortcuts for speed control
        document.addEventListener('keydown', (e) => {
            // Only process if we're speaking
            if (!this.isSpeaking) return;

            // Check if the target is not an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                return;
            }

            // Speed controls: [ and ] keys
            if (e.key === '[') {
                e.preventDefault();
                this.decreaseSpeed();
            } else if (e.key === ']') {
                e.preventDefault();
                this.increaseSpeed();
            }
            // Reset speed: \ key
            else if (e.key === '\\') {
                e.preventDefault();
                this.resetSpeed();
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.voice-selector-container') &&
                !e.target.closest('#voiceSettingsBtn')) {
                this.hideVoiceSettingsDropdown();
            }
        });

        // Update speed display
        this.updateSpeedDisplay();
    }

    // Toggle voice settings dropdown
    toggleVoiceSettingsDropdown() {
        const dropdown = document.getElementById('voiceSettingsDropdown');
        if (dropdown) {
            dropdown.classList.toggle('show');
        }
    }

    // Hide voice settings dropdown
    hideVoiceSettingsDropdown() {
        const dropdown = document.getElementById('voiceSettingsDropdown');
        if (dropdown) {
            dropdown.classList.remove('show');
        }
    }

    // Change voice
    changeVoice(voiceURI) {
        try {
            console.log(`Attempting to change voice to URI: ${voiceURI}`);
            console.log(`Available voices: ${this.availableVoices.length}`);

            // Refresh available voices to ensure we have the latest list
            const freshVoices = window.speechSynthesis.getVoices();
            if (freshVoices.length > 0) {
                this.availableVoices = freshVoices;
                console.log(`Refreshed voices list, now have ${this.availableVoices.length} voices`);
            }

            // Find the voice by URI
            const voice = this.availableVoices.find(v => v.voiceURI === voiceURI);

            if (voice) {
                console.log(`Found voice: ${voice.name} (${voice.lang})`);
                this.currentVoice = voice;
                this.savePreferences();
                this.showToast(`Voice changed to ${voice.name}`, 'info');

                // If currently speaking, restart with new voice
                if (this.isSpeaking) {
                    const text = this.textContent;
                    this.stopSpeaking();

                    // Use a longer timeout to ensure speech engine has time to reset
                    setTimeout(() => {
                        this.speakText(text);
                    }, 300);
                }

                return true;
            } else {
                console.error(`Voice with URI ${voiceURI} not found`);
                this.showToast(`Could not find selected voice`, 'error');
                return false;
            }
        } catch (error) {
            console.error('Error changing voice:', error);
            this.showToast(`Error changing voice: ${error.message}`, 'error');
            return false;
        }
    }

    // Change speech rate
    changeRate(rate) {
        // Ensure rate is within valid range (0.1 to 10)
        rate = Math.max(0.1, Math.min(10, rate));

        this.rate = rate;
        this.savePreferences();
        this.updateSpeedDisplay();
        this.showToast(`Speech rate changed to ${rate.toFixed(2)}x`, 'info');

        // If currently speaking, update the rate
        if (this.isSpeaking && this.utterance) {
            this.utterance.rate = rate;

            // Some browsers require restarting speech to apply rate change
            if (this.isPaused) {
                this.synthesis.resume();
                setTimeout(() => {
                    this.synthesis.pause();
                }, 50);
            }
        }
    }

    // Increase speech rate
    increaseSpeed() {
        let newRate;

        // Use predefined increments
        if (this.rate < 1) {
            newRate = Math.min(1, this.rate + 0.25);
        } else if (this.rate < 2) {
            newRate = Math.min(2, this.rate + 0.25);
        } else if (this.rate < 3) {
            newRate = Math.min(3, this.rate + 0.5);
        } else {
            newRate = Math.min(10, this.rate + 1);
        }

        this.changeRate(newRate);
    }

    // Decrease speech rate
    decreaseSpeed() {
        let newRate;

        // Use predefined decrements
        if (this.rate <= 1) {
            newRate = Math.max(0.25, this.rate - 0.25);
        } else if (this.rate <= 2) {
            newRate = Math.max(1, this.rate - 0.25);
        } else if (this.rate <= 3) {
            newRate = Math.max(2, this.rate - 0.5);
        } else {
            newRate = Math.max(3, this.rate - 1);
        }

        this.changeRate(newRate);
    }

    // Reset speed to normal (1x)
    resetSpeed() {
        this.changeRate(1.0);
    }

    // Update the speed display
    updateSpeedDisplay() {
        const currentSpeed = document.getElementById('currentSpeed');
        if (currentSpeed) {
            // Format the rate for display
            let displayRate;
            if (this.rate === 1) {
                displayRate = '1x';
            } else if (this.rate < 1) {
                displayRate = this.rate.toFixed(2) + 'x';
            } else {
                displayRate = this.rate.toFixed(1) + 'x';
            }

            // Update the display
            currentSpeed.textContent = displayRate;

            // Add highlight animation
            currentSpeed.classList.add('highlight');
            setTimeout(() => {
                currentSpeed.classList.remove('highlight');
            }, 500);
        }

        // Update the dropdown selector if it exists
        const rateSelector = document.getElementById('rateSelector');
        if (rateSelector) {
            // Find the closest option
            const options = Array.from(rateSelector.options);
            let closestOption = options[0];
            let minDiff = Math.abs(parseFloat(options[0].value) - this.rate);

            for (let i = 1; i < options.length; i++) {
                const diff = Math.abs(parseFloat(options[i].value) - this.rate);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestOption = options[i];
                }
            }

            // Select the closest option
            if (minDiff < 0.1) { // Only select if it's close enough
                rateSelector.value = closestOption.value;
            }
        }

        // Update button states
        this.updateSpeedButtonStates();
    }

    // Update speed button states (enabled/disabled)
    updateSpeedButtonStates() {
        const decreaseBtn = document.getElementById('decreaseSpeedBtn');
        const increaseBtn = document.getElementById('increaseSpeedBtn');

        if (decreaseBtn) {
            decreaseBtn.disabled = !this.isSpeaking || this.rate <= 0.25;
        }

        if (increaseBtn) {
            increaseBtn.disabled = !this.isSpeaking || this.rate >= 10;
        }
    }

    showToast(message, type = 'info', duration = 3000) {
        // Use the existing toast function if available
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
        } else if (typeof window.showToast === 'function') {
            window.showToast(message, type, duration);
        } else {
            console.log(`${type.toUpperCase()}: ${message}`);
        }
    }
}

// Initialize the speech synthesis manager
let grindSpeechSynthesis;

document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Grind Speech Synthesis');
    grindSpeechSynthesis = new GrindSpeechSynthesis();
    console.log('Speech Synthesis supported:', grindSpeechSynthesis.isSupported);
});

// Global functions to control speech synthesis
function speakSearchResults() {
    if (!grindSpeechSynthesis) return;
    grindSpeechSynthesis.speakSearchResults();
}

function pauseResumeTextToSpeech() {
    if (!grindSpeechSynthesis) return;
    grindSpeechSynthesis.pauseSpeaking();
}

function stopTextToSpeech() {
    if (!grindSpeechSynthesis) return;
    grindSpeechSynthesis.stopSpeaking();
}

// Make functions available globally
window.speakSearchResults = speakSearchResults;
window.pauseResumeTextToSpeech = pauseResumeTextToSpeech;
window.stopTextToSpeech = stopTextToSpeech;
