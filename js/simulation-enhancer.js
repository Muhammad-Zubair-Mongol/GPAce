/**
 * Simulation Enhancer Module
 * 
 * This module enhances simulations with:
 * 1. Step-by-step navigation
 * 2. Audio feedback and narration
 * 3. Haptic feedback for mobile devices
 * 4. Visual enhancements
 */

class SimulationEnhancer {
  constructor(iframe) {
    this.iframe = iframe;
    this.iframeDocument = null;
    this.currentStep = 1;
    this.totalSteps = 0;
    this.audioContext = null;
    this.soundEffects = {};
    this.narrationVoice = null;
    this.stepData = [];
    
    // Initialize when iframe is loaded
    this.iframe.addEventListener('load', () => this.initialize());
  }

  /**
   * Initialize the enhancer after iframe is loaded
   */
  initialize() {
    try {
      // Get iframe document
      this.iframeDocument = this.iframe.contentDocument || this.iframe.contentWindow.document;
      
      // Check if the simulation has step data
      this.detectSteps();
      
      // Initialize audio context
      this.initAudio();
      
      // Add step navigation if steps are detected
      if (this.totalSteps > 0) {
        this.addStepNavigation();
      }
      
      // Add event listeners for interactions
      this.addInteractionListeners();
      
      console.log('Simulation enhancer initialized successfully');
    } catch (error) {
      console.error('Error initializing simulation enhancer:', error);
    }
  }

  /**
   * Detect if the simulation has step-by-step structure
   */
  detectSteps() {
    try {
      // Look for step elements in the simulation
      const stepElements = this.iframeDocument.querySelectorAll('[data-step]');
      
      if (stepElements.length > 0) {
        // Simulation already has steps defined
        this.totalSteps = stepElements.length;
        this.stepData = Array.from(stepElements).map(el => ({
          element: el,
          title: el.getAttribute('data-step-title') || `Step ${el.getAttribute('data-step')}`,
          description: el.getAttribute('data-step-description') || '',
          narration: el.getAttribute('data-step-narration') || ''
        }));
        
        // Hide all steps except the first one
        this.stepData.forEach((step, index) => {
          step.element.style.display = index === 0 ? 'block' : 'none';
        });
        
        console.log(`Detected ${this.totalSteps} steps in simulation`);
      } else {
        // Try to infer steps from the simulation structure
        const sections = this.iframeDocument.querySelectorAll('section, .step, .section, .slide');
        
        if (sections.length > 1) {
          this.totalSteps = sections.length;
          this.stepData = Array.from(sections).map((el, index) => {
            // Add data-step attribute to the element
            el.setAttribute('data-step', index + 1);
            
            // Try to find a title
            const titleEl = el.querySelector('h1, h2, h3, h4, h5, h6');
            const title = titleEl ? titleEl.textContent : `Step ${index + 1}`;
            
            // Hide all steps except the first one
            el.style.display = index === 0 ? 'block' : 'none';
            
            return {
              element: el,
              title: title,
              description: '',
              narration: ''
            };
          });
          
          console.log(`Inferred ${this.totalSteps} steps from simulation structure`);
        } else {
          // No steps detected
          console.log('No steps detected in simulation');
        }
      }
    } catch (error) {
      console.error('Error detecting steps:', error);
    }
  }

  /**
   * Add step navigation UI to the simulation
   */
  addStepNavigation() {
    try {
      // Create navigation container
      const navContainer = document.createElement('div');
      navContainer.className = 'step-navigation';
      navContainer.style.cssText = `
        position: absolute;
        bottom: 20px;
        left: 0;
        right: 0;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 10px;
        padding: 10px;
        background-color: rgba(0, 0, 0, 0.7);
        border-radius: 8px;
        margin: 0 auto;
        width: 80%;
        max-width: 600px;
        z-index: 1000;
      `;
      
      // Add previous button
      const prevButton = document.createElement('button');
      prevButton.innerHTML = '&larr; Previous';
      prevButton.className = 'step-nav-btn prev-btn';
      prevButton.style.cssText = `
        background-color: #333;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 8px 12px;
        cursor: pointer;
        font-size: 14px;
        opacity: 0.7;
      `;
      prevButton.disabled = true;
      prevButton.addEventListener('click', () => this.navigateStep(-1));
      
      // Add next button
      const nextButton = document.createElement('button');
      nextButton.innerHTML = 'Next &rarr;';
      nextButton.className = 'step-nav-btn next-btn';
      nextButton.style.cssText = `
        background-color: #fe2c55;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 8px 12px;
        cursor: pointer;
        font-size: 14px;
      `;
      nextButton.addEventListener('click', () => this.navigateStep(1));
      
      // Add step indicator
      const stepIndicator = document.createElement('div');
      stepIndicator.className = 'step-indicator';
      stepIndicator.style.cssText = `
        flex-grow: 1;
        text-align: center;
        color: white;
        font-size: 14px;
      `;
      stepIndicator.textContent = `Step ${this.currentStep} of ${this.totalSteps}`;
      
      // Add step title
      const stepTitle = document.createElement('div');
      stepTitle.className = 'step-title';
      stepTitle.style.cssText = `
        position: absolute;
        top: -30px;
        left: 0;
        right: 0;
        text-align: center;
        color: white;
        font-size: 16px;
        font-weight: bold;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
      `;
      stepTitle.textContent = this.stepData[0]?.title || '';
      
      // Add elements to container
      navContainer.appendChild(prevButton);
      navContainer.appendChild(stepIndicator);
      navContainer.appendChild(nextButton);
      navContainer.appendChild(stepTitle);
      
      // Add container to iframe body
      this.iframeDocument.body.appendChild(navContainer);
      
      // Store references
      this.navElements = {
        container: navContainer,
        prevButton: prevButton,
        nextButton: nextButton,
        stepIndicator: stepIndicator,
        stepTitle: stepTitle
      };
      
      console.log('Step navigation added to simulation');
    } catch (error) {
      console.error('Error adding step navigation:', error);
    }
  }

  /**
   * Navigate to the next or previous step
   * @param {number} direction - 1 for next, -1 for previous
   */
  navigateStep(direction) {
    try {
      // Calculate new step
      const newStep = this.currentStep + direction;
      
      // Check if new step is valid
      if (newStep < 1 || newStep > this.totalSteps) {
        return;
      }
      
      // Hide current step
      if (this.stepData[this.currentStep - 1]) {
        this.stepData[this.currentStep - 1].element.style.display = 'none';
      }
      
      // Show new step
      if (this.stepData[newStep - 1]) {
        this.stepData[newStep - 1].element.style.display = 'block';
        
        // Play step transition sound
        this.playSound('stepTransition');
        
        // Trigger haptic feedback
        this.triggerHapticFeedback('medium');
        
        // Play narration if available
        const narration = this.stepData[newStep - 1].narration;
        if (narration) {
          this.speakText(narration);
        }
      }
      
      // Update current step
      this.currentStep = newStep;
      
      // Update navigation UI
      this.updateNavigationUI();
      
      console.log(`Navigated to step ${this.currentStep}`);
    } catch (error) {
      console.error('Error navigating step:', error);
    }
  }

  /**
   * Update the navigation UI based on current step
   */
  updateNavigationUI() {
    try {
      if (!this.navElements) return;
      
      // Update step indicator
      this.navElements.stepIndicator.textContent = `Step ${this.currentStep} of ${this.totalSteps}`;
      
      // Update step title
      this.navElements.stepTitle.textContent = this.stepData[this.currentStep - 1]?.title || '';
      
      // Update button states
      this.navElements.prevButton.disabled = this.currentStep === 1;
      this.navElements.prevButton.style.opacity = this.currentStep === 1 ? '0.5' : '1';
      this.navElements.nextButton.disabled = this.currentStep === this.totalSteps;
      this.navElements.nextButton.style.opacity = this.currentStep === this.totalSteps ? '0.5' : '1';
    } catch (error) {
      console.error('Error updating navigation UI:', error);
    }
  }

  /**
   * Initialize audio context and load sound effects
   */
  initAudio() {
    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Load sound effects
      this.loadSoundEffects();
      
      // Initialize speech synthesis
      this.initSpeechSynthesis();
      
      console.log('Audio initialized successfully');
    } catch (error) {
      console.error('Error initializing audio:', error);
    }
  }

  /**
   * Load sound effects for the simulation
   */
  loadSoundEffects() {
    try {
      // Define sound effects to load
      const effectsToLoad = {
        click: 'sounds/click.mp3',
        hover: 'sounds/hover.mp3',
        stepTransition: 'sounds/transition.mp3',
        success: 'sounds/success.mp3',
        error: 'sounds/error.mp3'
      };
      
      // Load each sound effect
      Object.entries(effectsToLoad).forEach(([name, url]) => {
        fetch(url)
          .then(response => response.arrayBuffer())
          .then(arrayBuffer => this.audioContext.decodeAudioData(arrayBuffer))
          .then(audioBuffer => {
            this.soundEffects[name] = audioBuffer;
            console.log(`Loaded sound effect: ${name}`);
          })
          .catch(error => {
            console.error(`Error loading sound effect ${name}:`, error);
            
            // Create fallback sound
            this.createFallbackSound(name);
          });
      });
    } catch (error) {
      console.error('Error loading sound effects:', error);
      
      // Create fallback sounds
      this.createFallbackSounds();
    }
  }

  /**
   * Create fallback sounds using oscillator
   * @param {string} name - Sound effect name
   */
  createFallbackSound(name) {
    try {
      // Create a short buffer for the sound
      const sampleRate = this.audioContext.sampleRate;
      const buffer = this.audioContext.createBuffer(1, sampleRate * 0.2, sampleRate);
      const channel = buffer.getChannelData(0);
      
      // Fill the buffer with different waveforms based on the sound type
      switch (name) {
        case 'click':
          // Short click sound
          for (let i = 0; i < buffer.length; i++) {
            channel[i] = i < buffer.length * 0.1 ? Math.sin(i * 0.1) * Math.exp(-i / (buffer.length * 0.1)) : 0;
          }
          break;
        case 'hover':
          // Soft hover sound
          for (let i = 0; i < buffer.length; i++) {
            channel[i] = Math.sin(i * 0.05) * Math.exp(-i / (buffer.length * 0.5)) * 0.3;
          }
          break;
        case 'stepTransition':
          // Transition sound (ascending tone)
          for (let i = 0; i < buffer.length; i++) {
            channel[i] = Math.sin(i * (0.05 + i / buffer.length * 0.1)) * Math.exp(-i / (buffer.length * 0.8));
          }
          break;
        case 'success':
          // Success sound (ascending chord)
          for (let i = 0; i < buffer.length; i++) {
            channel[i] = (
              Math.sin(i * 0.04) + 
              Math.sin(i * 0.06) * 0.7 + 
              Math.sin(i * 0.08) * 0.5
            ) * Math.exp(-i / (buffer.length * 0.8)) * 0.3;
          }
          break;
        case 'error':
          // Error sound (descending tone)
          for (let i = 0; i < buffer.length; i++) {
            channel[i] = Math.sin(i * (0.1 - i / buffer.length * 0.05)) * Math.exp(-i / (buffer.length * 0.5));
          }
          break;
        default:
          // Generic beep
          for (let i = 0; i < buffer.length; i++) {
            channel[i] = Math.sin(i * 0.1) * Math.exp(-i / (buffer.length * 0.5));
          }
      }
      
      // Store the buffer
      this.soundEffects[name] = buffer;
      console.log(`Created fallback sound for: ${name}`);
    } catch (error) {
      console.error(`Error creating fallback sound for ${name}:`, error);
    }
  }

  /**
   * Create all fallback sounds
   */
  createFallbackSounds() {
    ['click', 'hover', 'stepTransition', 'success', 'error'].forEach(name => {
      this.createFallbackSound(name);
    });
  }

  /**
   * Play a sound effect
   * @param {string} name - Sound effect name
   * @param {number} volume - Volume (0-1)
   */
  playSound(name, volume = 0.5) {
    try {
      if (!this.audioContext || !this.soundEffects[name]) {
        return;
      }
      
      // Create source node
      const source = this.audioContext.createBufferSource();
      source.buffer = this.soundEffects[name];
      
      // Create gain node for volume control
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = volume;
      
      // Connect nodes
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      // Play sound
      source.start();
      
      return source;
    } catch (error) {
      console.error(`Error playing sound ${name}:`, error);
    }
  }

  /**
   * Initialize speech synthesis for narration
   */
  initSpeechSynthesis() {
    try {
      if (!('speechSynthesis' in window)) {
        console.warn('Speech synthesis not supported');
        return;
      }
      
      // Get available voices
      const getVoices = () => {
        const voices = speechSynthesis.getVoices();
        
        if (voices.length > 0) {
          // Prefer a natural-sounding voice
          this.narrationVoice = voices.find(voice => 
            voice.name.includes('Google') && voice.name.includes('US')
          ) || voices[0];
          
          console.log(`Selected voice: ${this.narrationVoice.name}`);
        }
      };
      
      // Get voices on load
      getVoices();
      
      // Get voices when they change
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = getVoices;
      }
      
      console.log('Speech synthesis initialized');
    } catch (error) {
      console.error('Error initializing speech synthesis:', error);
    }
  }

  /**
   * Speak text using speech synthesis
   * @param {string} text - Text to speak
   * @param {number} rate - Speech rate (0.1-10)
   * @param {number} pitch - Speech pitch (0-2)
   */
  speakText(text, rate = 1, pitch = 1) {
    try {
      if (!('speechSynthesis' in window)) {
        console.warn('Speech synthesis not supported');
        return;
      }
      
      // Cancel any current speech
      speechSynthesis.cancel();
      
      // Create utterance
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Set voice if available
      if (this.narrationVoice) {
        utterance.voice = this.narrationVoice;
      }
      
      // Set properties
      utterance.rate = rate;
      utterance.pitch = pitch;
      
      // Speak
      speechSynthesis.speak(utterance);
      
      console.log(`Speaking: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      
      return utterance;
    } catch (error) {
      console.error('Error speaking text:', error);
    }
  }

  /**
   * Trigger haptic feedback on mobile devices
   * @param {string} intensity - 'weak', 'medium', or 'strong'
   */
  triggerHapticFeedback(intensity = 'medium') {
    try {
      if (!('vibrate' in navigator)) {
        console.warn('Haptic feedback not supported');
        return;
      }
      
      // Define vibration patterns based on intensity
      const patterns = {
        weak: [20],
        medium: [40],
        strong: [80],
        success: [30, 20, 40, 20, 50],
        error: [60, 30, 60, 30, 80],
        warning: [40, 30, 40],
        step: [30, 50, 30]
      };
      
      // Get pattern
      const pattern = patterns[intensity] || patterns.medium;
      
      // Trigger vibration
      navigator.vibrate(pattern);
      
      console.log(`Triggered haptic feedback: ${intensity}`);
    } catch (error) {
      console.error('Error triggering haptic feedback:', error);
    }
  }

  /**
   * Add event listeners for interactions in the simulation
   */
  addInteractionListeners() {
    try {
      // Add click sound to buttons and interactive elements
      const interactiveElements = this.iframeDocument.querySelectorAll('button, .interactive, [data-interactive], input[type="range"], input[type="checkbox"], select');
      
      interactiveElements.forEach(element => {
        // Add click sound
        element.addEventListener('click', () => {
          this.playSound('click');
          this.triggerHapticFeedback('weak');
        });
        
        // Add hover sound
        element.addEventListener('mouseenter', () => {
          this.playSound('hover', 0.2);
        });
        
        // Add focus style
        element.addEventListener('focus', () => {
          element.style.outline = '2px solid #fe2c55';
        });
        
        element.addEventListener('blur', () => {
          element.style.outline = '';
        });
      });
      
      // Add input change handlers for sliders and inputs
      const inputElements = this.iframeDocument.querySelectorAll('input[type="range"], input[type="number"]');
      
      inputElements.forEach(element => {
        element.addEventListener('input', () => {
          // Play sound with pitch based on value
          const min = parseFloat(element.min) || 0;
          const max = parseFloat(element.max) || 100;
          const value = parseFloat(element.value) || 0;
          const normalizedValue = (value - min) / (max - min); // 0 to 1
          
          // Create a sound with pitch based on the value
          this.playDynamicTone(normalizedValue);
        });
        
        element.addEventListener('change', () => {
          this.triggerHapticFeedback('weak');
        });
      });
      
      console.log('Added interaction listeners to simulation elements');
    } catch (error) {
      console.error('Error adding interaction listeners:', error);
    }
  }

  /**
   * Play a dynamic tone based on a normalized value (0-1)
   * @param {number} normalizedValue - Value between 0 and 1
   */
  playDynamicTone(normalizedValue) {
    try {
      if (!this.audioContext) {
        return;
      }
      
      // Create oscillator
      const oscillator = this.audioContext.createOscillator();
      
      // Map normalized value to frequency (200Hz to 800Hz)
      const frequency = 200 + normalizedValue * 600;
      oscillator.frequency.value = frequency;
      
      // Create gain node for volume and fade out
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 0.2;
      
      // Connect nodes
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      // Start oscillator
      oscillator.start();
      
      // Fade out and stop
      gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.2);
      setTimeout(() => oscillator.stop(), 200);
    } catch (error) {
      console.error('Error playing dynamic tone:', error);
    }
  }
}

// Export the class
export default SimulationEnhancer;
