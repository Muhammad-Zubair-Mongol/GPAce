class PomodoroTimer {
    constructor() {
        this.VERSION = '1.1.0';
        this.STATE_KEY = 'pomodoroState';
        this.LAST_TICK_KEY = 'pomodoroLastTick';

        this.TIMER_STATES = {
            FOCUS: 'focus',
            BREAK: 'break'
        };

        this.TIMER_DURATIONS = {
            POMODORO: 25 * 60,
            SHORT_BREAK: 5 * 60,
            LONG_BREAK: 15 * 60
        };

        // Initialize state with default values
        this.state = {
            timeLeft: this.TIMER_DURATIONS.POMODORO,
            currentState: this.TIMER_STATES.FOCUS,
            pomodoroCount: 0,
            isRunning: false,
            selectedFatigueLevel: null,
            version: this.VERSION,
            lastActiveTime: Date.now(),
            endTime: null // Store absolute end time for accurate tracking
        };

        // Internal flags
        this._isResetting = false;
        this._resetInProgress = false;
        this._pageHidden = false;
        this._notificationPermission = false;
        this._soundLoopInterval = null;

        // Initialize elements and load state
        this.initializeElements();
        this.loadState();
        this.setupEventListeners();
        this.setupVisibilityHandler();
        this.setupCrossTabSync();
        this.requestNotificationPermission();
        
        // Start update loop if timer was running
        if (this.state.isRunning) {
            this.resumeTimer();
        }
        
        // Update display
        this.updateDisplay();
    }

    initializeElements() {
        try {
            // Timer elements
            this.timerDisplay = document.getElementById('timer');
            this.timerLabel = document.querySelector('.timer-label');
            this.timerProgress = document.querySelector('.timer-progress');
            this.startBtn = document.getElementById('startBtn');
            this.resetBtn = document.getElementById('resetBtn');
            this.skipBtn = document.getElementById('skipBtn');
            
            // Mode buttons
            this.modeButtons = document.querySelectorAll('.timer-mode-btn');
            this.customTimeInput = document.getElementById('customTimeInput');
            
            // Stats elements
            this.pomodoroCountDisplay = document.getElementById('pomodoroCount');
            this.currentTimeDisplay = document.getElementById('currentTime');

            // Fatigue modal
            this.fatigueModal = document.getElementById('fatigueModal');
            this.fatigueLevels = document.querySelectorAll('.fatigue-level');
            this.confirmFatigueBtn = document.getElementById('confirmFatigue');
            this.cancelFatigueBtn = document.getElementById('cancelFatigue');
            
            // Log any elements that couldn't be found
            if (!this.timerDisplay) console.warn('Element #timer not found');
            if (!this.timerLabel) console.warn('Element .timer-label not found');
            if (!this.timerProgress) console.warn('Element .timer-progress not found');
            if (!this.startBtn) console.warn('Element #startBtn not found');
            if (!this.resetBtn) console.warn('Element #resetBtn not found');
            if (!this.skipBtn) console.warn('Element #skipBtn not found');
            if (!this.customTimeInput) console.warn('Element #customTimeInput not found');
            if (!this.pomodoroCountDisplay) console.warn('Element #pomodoroCount not found');
            if (!this.currentTimeDisplay) console.warn('Element #currentTime not found');
            if (!this.fatigueModal) console.warn('Element #fatigueModal not found');
            if (!this.confirmFatigueBtn) console.warn('Element #confirmFatigue not found');
            if (!this.cancelFatigueBtn) console.warn('Element #cancelFatigue not found');
        } catch (error) {
            console.error('Error initializing elements:', error);
        }
    }

    setupEventListeners() {
        try {
            // Remove any existing event listeners first to prevent duplicates
            if (this.startBtn) {
                // Clone and replace to remove all event listeners
                const newStartBtn = this.startBtn.cloneNode(true);
                this.startBtn.parentNode.replaceChild(newStartBtn, this.startBtn);
                this.startBtn = newStartBtn;
                
                this.startBtn.addEventListener('click', () => this.showFatigueModal());
            }
            
            if (this.resetBtn) {
                // Clone and replace to remove all event listeners
                const newResetBtn = this.resetBtn.cloneNode(true);
                this.resetBtn.parentNode.replaceChild(newResetBtn, this.resetBtn);
                this.resetBtn = newResetBtn;
                
                this.resetBtn.addEventListener('click', () => this.resetTimer());
            }
            
            if (this.skipBtn) {
                // Clone and replace to remove all event listeners
                const newSkipBtn = this.skipBtn.cloneNode(true);
                if (this.skipBtn.parentNode) {
                    this.skipBtn.parentNode.replaceChild(newSkipBtn, this.skipBtn);
                    this.skipBtn = newSkipBtn;
                    this.skipBtn.addEventListener('click', () => this.skipSession());
                }
            }

            // Mode selection
            if (this.modeButtons && this.modeButtons.length > 0) {
                this.modeButtons.forEach(btn => {
                    // Clone and replace each button to remove existing listeners
                    const newBtn = btn.cloneNode(true);
                    btn.parentNode.replaceChild(newBtn, btn);
                    
                    newBtn.addEventListener('click', () => {
                        this.modeButtons.forEach(b => b.classList.remove('active'));
                        newBtn.classList.add('active');
                        
                        const time = parseInt(newBtn.dataset.time);
                        const mode = newBtn.dataset.mode;
                        
                        this.state.timeLeft = time * 60;
                        this.state.currentState = mode;
                        this.updateTimerLabel(mode === 'focus' ? 'Focus Time' : 'Break Time');
                        this.updateDisplay();
                    });
                });
                
                // Update the reference to all buttons after cloning
                this.modeButtons = document.querySelectorAll('.timer-mode-btn');
            }

            // Custom time input
            if (this.customTimeInput) {
                // Clone and replace
                const newCustomTimeInput = this.customTimeInput.cloneNode(true);
                this.customTimeInput.parentNode.replaceChild(newCustomTimeInput, this.customTimeInput);
                this.customTimeInput = newCustomTimeInput;
                
                this.customTimeInput.addEventListener('change', (e) => {
                    const time = Math.min(Math.max(parseInt(e.target.value) || 25, 1), 60);
                    e.target.value = time;
                    this.state.timeLeft = time * 60;
                    this.updateDisplay();
                });
            }

            // Fatigue modal
            if (this.fatigueLevels && this.fatigueLevels.length > 0) {
                this.fatigueLevels.forEach(level => {
                    // Clone and replace
                    const newLevel = level.cloneNode(true);
                    level.parentNode.replaceChild(newLevel, level);
                    
                    newLevel.addEventListener('click', () => {
                        document.querySelectorAll('.fatigue-level').forEach(l => l.classList.remove('selected'));
                        newLevel.classList.add('selected');
                        this.state.selectedFatigueLevel = parseInt(newLevel.dataset.level);
                        if (this.confirmFatigueBtn) {
                            this.confirmFatigueBtn.disabled = false;
                        }
                    });
                });
                
                // Update reference
                this.fatigueLevels = document.querySelectorAll('.fatigue-level');
            }

            if (this.confirmFatigueBtn) {
                // Clone and replace
                const newConfirmBtn = this.confirmFatigueBtn.cloneNode(true);
                this.confirmFatigueBtn.parentNode.replaceChild(newConfirmBtn, this.confirmFatigueBtn);
                this.confirmFatigueBtn = newConfirmBtn;
                
                this.confirmFatigueBtn.addEventListener('click', () => {
                    if (this.state.selectedFatigueLevel !== null) {
                        this.hideFatigueModal();
                        
                        // Get the description for the selected level
                        const selectedLevelElement = document.querySelector(`.fatigue-level[data-level="${this.state.selectedFatigueLevel}"]`);
                        const description = selectedLevelElement ? 
                            selectedLevelElement.querySelector('h3').textContent.substring(3) : // Remove the "X. " prefix
                            `Energy Level ${this.state.selectedFatigueLevel}`;

                        // Update energy tracker
                        if (window.energyTracker && typeof window.energyTracker.addEnergyLevel === 'function') {
                            const entry = window.energyTracker.addEnergyLevel(this.state.selectedFatigueLevel, description);
                            console.log('Added energy level to tracker:', entry);
                            
                            // Update the energy graph
                            if (typeof updateEnergyChart === 'function') {
                                updateEnergyChart();
                                console.log('Updated energy chart');
                            }
                        } else {
                            console.warn('Energy tracker not available');
                        }

                        // Start the timer
                        this.startTimer();
                    }
                });
            }

            if (this.cancelFatigueBtn) {
                // Clone and replace
                const newCancelBtn = this.cancelFatigueBtn.cloneNode(true);
                this.cancelFatigueBtn.parentNode.replaceChild(newCancelBtn, this.cancelFatigueBtn);
                this.cancelFatigueBtn = newCancelBtn;
                
                this.cancelFatigueBtn.addEventListener('click', () => {
                    this.hideFatigueModal();
                });
            }

            // Add page unload event listener to clean up resources
            window.addEventListener('beforeunload', () => {
                if (this._soundLoopInterval) {
                    clearInterval(this._soundLoopInterval);
                    this._soundLoopInterval = null;
                }
            });
        } catch (error) {
            console.error('Error setting up event listeners:', error);
        }
    }

    showFatigueModal() {
        this.state.selectedFatigueLevel = null;
        
        if (this.fatigueLevels && this.fatigueLevels.length > 0) {
            this.fatigueLevels.forEach(level => level.classList.remove('selected'));
        }
        
        if (this.confirmFatigueBtn) {
            this.confirmFatigueBtn.disabled = true;
        }
        
        if (this.fatigueModal) {
            this.fatigueModal.classList.add('show');
        } else {
            console.warn('Fatigue modal element not found');
        }
    }

    hideFatigueModal() {
        if (this.fatigueModal) {
            this.fatigueModal.classList.remove('show');
        } else {
            console.warn('Fatigue modal element not found');
        }
    }

    setupVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this._pageHidden = true;
                // Save current state before page becomes hidden
                this.saveState();
            } else {
                this._pageHidden = false;
                // When page becomes visible again, sync with the actual time passed
                this.syncTimerState();
            }
        });
    }

    setupCrossTabSync() {
        // Listen for storage events from other tabs
        window.addEventListener('storage', (e) => {
            if (e.key === this.STATE_KEY) {
                const newState = JSON.parse(e.newValue);
                if (newState.version === this.VERSION) {
                    this.state = newState;
                    this.updateDisplay();
                    
                    // If timer is running, ensure we're using the correct end time
                    if (this.state.isRunning) {
                        this.resumeTimer();
                    }
                }
            }
        });
                
        // Periodic state sync - less frequent to reduce overhead
        setInterval(() => {
            if (this.state.isRunning) {
                this.saveState();
            }
        }, 5000); // Reduced from 1000ms to 5000ms for better performance
    }

    saveState() {
        try {
            this.state.lastActiveTime = Date.now();
            localStorage.setItem(this.STATE_KEY, JSON.stringify(this.state));
            localStorage.setItem(this.LAST_TICK_KEY, Date.now().toString());
        } catch (error) {
            console.error('Error saving timer state:', error);
        }
    }

    loadState() {
        try {
            const savedState = localStorage.getItem(this.STATE_KEY);
            if (savedState) {
                const parsedState = JSON.parse(savedState);
                
                // Only load state if version matches
                if (parsedState.version === this.VERSION) {
                    this.state = parsedState;
                    
                    // If timer was running, calculate time passed since last active
                    if (this.state.isRunning && this.state.endTime) {
                        const now = Date.now();
                        const timeLeftMs = Math.max(0, this.state.endTime - now);
                        this.state.timeLeft = Math.ceil(timeLeftMs / 1000);
                        
                        // If timer completed while away, handle completion
                        if (this.state.timeLeft <= 0) {
                            this.handleTimerComplete();
                        }
                    }
                } else {
                    // Version mismatch, reset timer
                    console.log('Timer version mismatch, resetting');
                    this.resetTimer();
                }
            }
        } catch (error) {
            console.error('Error loading timer state:', error);
            this.resetTimer();
        }
    }

    syncTimerState() {
        if (this.state.isRunning && this.state.endTime) {
            const now = Date.now();
            const timeLeftMs = Math.max(0, this.state.endTime - now);
            this.state.timeLeft = Math.ceil(timeLeftMs / 1000);
            
            this.updateDisplay();
            
            if (this.state.timeLeft <= 0) {
                this.handleTimerComplete();
            } else {
                this.resumeTimer();
            }
        }
    }

    resumeTimer() {
        // Clear any existing interval
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
        }
        
        // If timer is running but endTime is not set, set it now
        if (this.state.isRunning && !this.state.endTime) {
            this.state.endTime = Date.now() + (this.state.timeLeft * 1000);
        }
        
        // Use a more accurate timing approach with Date.now()
        this._timerInterval = setInterval(() => {
            if (this.state.isRunning) {
                const now = Date.now();
                const timeLeftMs = Math.max(0, this.state.endTime - now);
                this.state.timeLeft = Math.ceil(timeLeftMs / 1000);
                
                this.updateDisplay();
                
                // Only save state occasionally to reduce overhead
                if (this.state.timeLeft % 5 === 0) {
                    this.saveState();
                }
                
                if (this.state.timeLeft <= 0) {
                    this.handleTimerComplete();
                }
            }
        }, 500); // Run more frequently for smoother updates
    }

    startTimer() {
        if (!this.state.isRunning) {
            this.state.isRunning = true;
            this.state.lastActiveTime = Date.now();
            
            // Set absolute end time for accurate tracking
            this.state.endTime = Date.now() + (this.state.timeLeft * 1000);
            
            this.saveState();
            this.resumeTimer();
            this.updateDisplay();
            
            // Register a service worker for background notifications if supported
            this.registerTimerWorker();
        }
    }

    pauseTimer() {
        if (this.state.isRunning) {
            this.state.isRunning = false;
            
            if (this._timerInterval) {
                clearInterval(this._timerInterval);
                this._timerInterval = null;
            }
            
            // Clear the end time when paused
            this.state.endTime = null;
            
            this.saveState();
            this.updateDisplay();
        }
    }

    resetTimer() {
        // Prevent multiple resets
        if (this._resetInProgress) return;
        this._resetInProgress = true;
        
        // Clear interval
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        
        // Clear sound loop if it exists
        if (this._soundLoopInterval) {
            clearInterval(this._soundLoopInterval);
            this._soundLoopInterval = null;
        }
        
        // Reset state
        this.state.isRunning = false;
        this.state.timeLeft = this.TIMER_DURATIONS.POMODORO;
        this.state.currentState = this.TIMER_STATES.FOCUS;
        this.state.endTime = null;
        
        this.saveState();
        this.updateDisplay();
        
        this._resetInProgress = false;
    }

    toggleTimer() {
        const isRunning = this.startBtn.getAttribute('data-state') === 'running';
        if (isRunning) {
            this.pauseTimer();
        } else {
            this.startTimer();
        }
    }

    skipSession() {
        if (this.state.currentState === this.TIMER_STATES.FOCUS) {
            this.startBreak();
        } else {
            this.startFocus();
        }
    }

    handleTimerComplete() {
        // Clear interval
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        
        // Update global stats if a focus session completed
        if (window.stats && this.state.currentState === this.TIMER_STATES.FOCUS) {
            try {
                // If activeTimerStart exists, calculate the total time worked
                if (window.stats.activeTimerStart) {
                    const activeTime = Math.floor((Date.now() - window.stats.activeTimerStart - (window.stats.pausedTime || 0)) / 1000);
                    window.stats.totalWorkTime += activeTime;
                    window.stats.activeTimerStart = null;
                    window.stats.pausedTime = 0;
                    
                    // Update global streak count
                    if (window.stats.currentStreak !== undefined) {
                        window.stats.currentStreak = this.state.pomodoroCount;
                    }
                    
                    // Update stats display if the function exists
                    if (typeof window.updateStatsDisplay === 'function') {
                        window.updateStatsDisplay();
                    }
                    
                    // Save stats if the function exists
                    if (typeof window.saveStats === 'function') {
                        window.saveStats();
                    }
                    
                    console.log('Updated global stats on completed focus session, added active time:', activeTime);
                }
            } catch (error) {
                console.error('Error updating global stats in handleTimerComplete:', error);
            }
        }
        
        // Update session state
        if (this.state.currentState === this.TIMER_STATES.FOCUS) {
            this.state.pomodoroCount++;
            if (this.pomodoroCountDisplay) {
                this.pomodoroCountDisplay.textContent = this.state.pomodoroCount;
            }
            this.startBreak();
        } else {
            this.startFocus();
        }
        
        // Play sound and show notification
        this.playSound();
        this.showTimerNotification();
        
        this.saveState();
    }

    startBreak() {
        // Clear sound loop if it exists
        if (this._soundLoopInterval) {
            clearInterval(this._soundLoopInterval);
            this._soundLoopInterval = null;
        }
        
        this.state.currentState = this.TIMER_STATES.BREAK;
        this.state.timeLeft = this.state.pomodoroCount % 4 === 0 ? 
            this.TIMER_DURATIONS.LONG_BREAK : this.TIMER_DURATIONS.SHORT_BREAK;
        
        // Set new end time
        if (this.state.isRunning) {
            this.state.endTime = Date.now() + (this.state.timeLeft * 1000);
        } else {
            this.state.endTime = null;
        }
        
        this.updateDisplay();
        this.saveState();
    }

    startFocus() {
        // Clear sound loop if it exists
        if (this._soundLoopInterval) {
            clearInterval(this._soundLoopInterval);
            this._soundLoopInterval = null;
        }
        
        this.state.currentState = this.TIMER_STATES.FOCUS;
        this.state.timeLeft = this.TIMER_DURATIONS.POMODORO;
        
        // Set new end time
        if (this.state.isRunning) {
            this.state.endTime = Date.now() + (this.state.timeLeft * 1000);
        } else {
            this.state.endTime = null;
        }
        
        this.updateDisplay();
        this.saveState();
    }

    updateDisplay() {
        const minutes = Math.floor(this.state.timeLeft / 60);
        const seconds = this.state.timeLeft % 60;
        const display = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        if (this.timerDisplay) {
            this.timerDisplay.textContent = display;
        } else {
            console.warn('Timer display element not found');
        }

        // Update progress circle
        const totalTime = this.state.currentState === this.TIMER_STATES.FOCUS ? 
            this.TIMER_DURATIONS.POMODORO : 
            (this.state.pomodoroCount % 4 === 0 ? this.TIMER_DURATIONS.LONG_BREAK : this.TIMER_DURATIONS.SHORT_BREAK);
        
        const progress = ((totalTime - this.state.timeLeft) / totalTime) * 100;
        if (this.timerProgress) {
            this.timerProgress.style.setProperty('--progress', `${progress}%`);
        } else {
            console.warn('Timer progress element not found');
        }
    }

    updateTimerLabel(label) {
        if (this.timerLabel) {
            this.timerLabel.textContent = label;
        } else {
            console.warn('Timer label element (.timer-label) not found');
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `timer-notification ${type}`;
        notification.textContent = message;
        
        // Add to DOM
        const container = document.querySelector('.pomodoro-container') || document.body;
        container.appendChild(notification);
        
        // Remove after animation
        setTimeout(() => {
            notification.classList.add('show');
            
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => notification.remove(), 300);
            }, 4000);
        }, 10);
    }

    playSound() {
        // Clear any existing sound loop
        if (this._soundLoopInterval) {
            clearInterval(this._soundLoopInterval);
            this._soundLoopInterval = null;
        }
        
        const playAudioOnce = () => {
            try {
                // Create an AudioContext for better background tab support
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                
                // Create an audio element
                const audio = new Audio('pop.mp3');
                
                // Connect it to the audio context
                const source = audioContext.createMediaElementSource(audio);
                source.connect(audioContext.destination);
                
                // Play sound with user interaction requirement workaround
                const playPromise = audio.play();
                
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        console.log('Sound playback failed, likely due to user interaction requirement:', error);
                        
                        // Store that we need to play a sound when user interacts
                        this._needsSound = true;
                        
                        // Add a one-time click listener to play sound on next interaction
                        if (!this._soundInteractionHandler) {
                            this._soundInteractionHandler = () => {
                                if (this._needsSound) {
                                    const audio = new Audio('pop.mp3');
                                    audio.play().catch(e => console.log('Still failed to play sound:', e));
                                    this._needsSound = false;
                                }
                            };
                            
                            document.addEventListener('click', this._soundInteractionHandler, { once: true });
                        }
                    });
                }
            } catch (error) {
                console.warn('Could not play sound:', error);
                
                // Fallback to simple Audio API
                try {
                    const audio = new Audio('pop.mp3');
                    audio.play().catch(e => console.log('Fallback sound playback failed:', e));
                } catch (e) {
                    console.error('All sound playback attempts failed:', e);
                }
            }
        };
        
        // Play sound immediately
        playAudioOnce();
        
        // Set up interval to play sound every second
        this._soundLoopInterval = setInterval(playAudioOnce, 1000);
        
        // Add event listener to reset button to stop sound loop
        if (this.resetBtn) {
            const stopSoundLoop = () => {
                if (this._soundLoopInterval) {
                    clearInterval(this._soundLoopInterval);
                    this._soundLoopInterval = null;
                }
                this.resetBtn.removeEventListener('click', stopSoundLoop);
            };
            
            this.resetBtn.addEventListener('click', stopSoundLoop);
        }
    }
    
    requestNotificationPermission() {
        // Check if browser supports notifications
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                this._notificationPermission = true;
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    this._notificationPermission = permission === 'granted';
                });
            }
        }
    }
    
    showTimerNotification() {
        // Show browser notification if permission granted
        if (this._notificationPermission) {
            const title = this.state.currentState === this.TIMER_STATES.FOCUS ? 
                'Break Time!' : 'Focus Time!';
            const message = this.state.currentState === this.TIMER_STATES.FOCUS ?
                'Great job! Take a break.' : 'Break is over. Time to focus!';
                
            const notification = new Notification(title, {
                body: message,
                icon: '/icons/timer-icon.png', // Assuming there's an icon
                silent: false // Allow browser to play notification sound
            });
            
            // Auto close after 5 seconds
            setTimeout(() => notification.close(), 5000);
        }
        
        // Also show in-app notification
        this.showNotification(
            this.state.currentState === this.TIMER_STATES.FOCUS ?
            'Break Time! Great job!' : 'Focus Time! Break is over.',
            this.state.currentState === this.TIMER_STATES.FOCUS ? 'success' : 'info'
        );
    }
    
    registerTimerWorker() {
        // Register service worker for background notifications if supported
        if ('serviceWorker' in navigator && this.state.isRunning) {
            try {
                // Calculate when timer will end
                const timeUntilEnd = this.state.timeLeft * 1000;
                
                // Register the timer with the service worker
                navigator.serviceWorker.ready.then(registration => {
                    // Cancel any existing timers
                    registration.getNotifications().then(notifications => {
                        notifications.forEach(notification => notification.close());
                    });
                    
                    // Schedule notification for when timer ends
                    if (timeUntilEnd > 0) {
                        setTimeout(() => {
                            if (!document.hidden && this.state.timeLeft <= 0) {
                                // If page is visible and timer ended, no need for service worker notification
                                return;
                            }
                            
                            registration.showNotification('Pomodoro Timer', {
                                body: this.state.currentState === this.TIMER_STATES.FOCUS ?
                                    'Focus session complete! Time for a break.' :
                                    'Break time is over! Back to focus.',
                                icon: '/icons/timer-icon.png',
                                vibrate: [100, 50, 100],
                                tag: 'pomodoro-notification'
                            });
                        }, timeUntilEnd);
                    }
                }).catch(err => console.log('Service worker registration failed:', err));
            } catch (error) {
                console.log('Error registering timer with service worker:', error);
            }
        }
    }
}

// Initialize the Pomodoro timer
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        try {
            console.log('Initializing Pomodoro Timer...');
            // Check if the timer is already initialized to prevent multiple instances
            if (!window.pomodoroTimer) {
                window.pomodoroTimer = new PomodoroTimer();
                
                // Add CSS for notifications
                const style = document.createElement('style');
                style.textContent = `
                    .timer-notification {
                        position: fixed;
                        bottom: 20px;
                        right: 20px;
                        padding: 15px 20px;
                        background: #333;
                        color: white;
                        border-radius: 5px;
                        box-shadow: 0 3px 10px rgba(0,0,0,0.2);
                        transform: translateY(100px);
                        opacity: 0;
                        transition: transform 0.3s ease, opacity 0.3s ease;
                        z-index: 9999;
                    }
                    .timer-notification.show {
                        transform: translateY(0);
                        opacity: 1;
                    }
                    .timer-notification.success {
                        background: #28a745;
                    }
                    .timer-notification.info {
                        background: #17a2b8;
                    }
                `;
                document.head.appendChild(style);
                
                // Register service worker if supported
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.register('/js/alarm-service-worker.js')
                        .then(registration => {
                            console.log('Service Worker registered with scope:', registration.scope);
                        })
                        .catch(error => {
                            console.log('Service Worker registration failed:', error);
                        });
                }
            }
        } catch (error) {
            console.error('Error initializing Pomodoro Timer:', error);
        }
    }, 500);
});
