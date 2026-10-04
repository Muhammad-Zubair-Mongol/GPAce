// Get storage service with fallback (use existing or create new)
if (typeof window.getStorage === 'undefined') {
    window.getStorage = () => window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };
}
// Use window.getStorage() directly to avoid redeclaration errors

const POMODORO_OWNER_KEY = '__gpacePomodoroTimerOwner';

function getExistingPomodoroOwner() {
    if (typeof window === 'undefined') return null;
    const owner = window[POMODORO_OWNER_KEY];
    return owner && owner.active && owner.instance && !owner.instance._disposed ? owner : null;
}

function claimPomodoroOwner(instance) {
    if (typeof window === 'undefined') return true;
    const current = getExistingPomodoroOwner();
    if (current && current.instance !== instance) return false;
    window[POMODORO_OWNER_KEY] = { instance, name: 'PomodoroTimer', active: true };
    return true;
}

function releasePomodoroOwner(instance) {
    if (typeof window !== 'undefined' && window[POMODORO_OWNER_KEY]?.instance === instance) {
        delete window[POMODORO_OWNER_KEY];
    }
}

class PomodoroTimer {
    constructor(options = {}) {
        if (!options.forceNew) {
            const existing = getExistingPomodoroOwner();
            if (existing?.name === 'PomodoroTimer') return existing.instance;
        }

        this._now = typeof options.now === 'function'
            ? options.now
            : (options.clock && typeof options.clock.now === 'function' ? options.clock.now.bind(options.clock) : () => Date.now());
        this._setInterval = options.setInterval || setInterval;
        this._clearInterval = options.clearInterval || clearInterval;
        this._setTimeout = options.setTimeout || setTimeout;
        this._clearTimeout = options.clearTimeout || clearTimeout;
        this._disposed = false;
        this._ownsTimer = claimPomodoroOwner(this);
        this._syncInterval = null;
        this._timerInterval = null;
        this._lastPersistedBoundary = null;
        this._completionToken = null;
        this._eventCleanups = [];
        this._scheduledTimeouts = new Set();

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
            lastActiveTime: this._now(),
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
        if (this.state.isRunning && this._ownsTimer) {
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
            const beforeUnloadHandler = () => {
                if (this._soundLoopInterval) {
                    this._clearInterval(this._soundLoopInterval);
                    this._soundLoopInterval = null;
                }
            };
            window.addEventListener('beforeunload', beforeUnloadHandler);
            this._eventCleanups.push(() => window.removeEventListener('beforeunload', beforeUnloadHandler));
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
        const visibilityHandler = () => {
            if (document.hidden) {
                this._pageHidden = true;
                // Save current state before page becomes hidden
                this.saveState();
            } else {
                this._pageHidden = false;
                // When page becomes visible again, sync with the actual time passed
                this.syncTimerState();
            }
        };
        document.addEventListener('visibilitychange', visibilityHandler);
        this._eventCleanups.push(() => document.removeEventListener('visibilitychange', visibilityHandler));
    }

    setupCrossTabSync() {
        // Listen for storage events from other tabs
        const storageHandler = (e) => {
            if (e.key === this.STATE_KEY) {
                let newState;
                try {
                    newState = e.newValue ? JSON.parse(e.newValue) : null;
                } catch {
                    return;
                }
                if (newState?.version === this.VERSION) {
                    this.state = newState;
                    this.updateDisplay();

                    // If timer is running, ensure we're using the correct end time
                    if (this.state.isRunning) {
                        this.resumeTimer();
                    }
                }
            }
        };
        window.addEventListener('storage', storageHandler);
        this._eventCleanups.push(() => window.removeEventListener('storage', storageHandler));

        // Periodic state sync - less frequent to reduce overhead
        this._syncInterval = this._setInterval(() => {
            if (this.state.isRunning) {
                this._persistBoundaryIfNeeded();
            }
        }, 5000); // Reduced from 1000ms to 5000ms for better performance
        this._eventCleanups.push(() => {
            if (this._syncInterval) {
                this._clearInterval(this._syncInterval);
                this._syncInterval = null;
            }
        });
    }

    saveState() {
        const storage = window.getStorage();
        try {
            this.state.lastActiveTime = this._now();
            storage.set(this.STATE_KEY, this.state);
            storage.set(this.LAST_TICK_KEY, this._now());
        } catch (error) {
            console.error('Error saving timer state:', error);
        }
    }

    _persistBoundaryIfNeeded() {
        const timeLeft = Number(this.state.timeLeft);
        if (!Number.isFinite(timeLeft) || timeLeft <= 0 || timeLeft % 5 !== 0) return;
        const boundary = Math.floor(timeLeft / 5);
        if (boundary === this._lastPersistedBoundary) return;
        this._lastPersistedBoundary = boundary;
        this.saveState();
    }

    loadState() {
        const storage = window.getStorage();
        try {
            const savedState = storage.get(this.STATE_KEY, null);
            if (savedState) {
                // Only load state if version matches
                if (savedState.version === this.VERSION) {
                    this.state = savedState;

                    // If timer was running, calculate time passed since last active
                    if (this.state.isRunning && this.state.endTime) {
                        const now = this._now();
                        const timeLeftMs = Math.max(0, this.state.endTime - now);
                        this.state.timeLeft = Math.ceil(timeLeftMs / 1000);

                        // If timer completed while away, handle completion
                        if (this.state.timeLeft <= 0) {
                            this._completeCurrentSession();
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
        if (this._disposed || !this._ownsTimer) return;
        if (this.state.isRunning && this.state.endTime) {
            const now = this._now();
            const timeLeftMs = Math.max(0, this.state.endTime - now);
            this.state.timeLeft = Math.ceil(timeLeftMs / 1000);

            this.updateDisplay();

            if (this.state.timeLeft <= 0) {
                this._completeCurrentSession();
            } else {
                this.resumeTimer();
            }
        }
    }

    _completeCurrentSession() {
        const token = this.state.endTime || `${this.state.currentState}:${this.state.timeLeft}`;
        if (this._completionToken === token) return;
        this._completionToken = token;
        this.state.timeLeft = 0;
        this.handleTimerComplete();
    }

    resumeTimer() {
        if (this._disposed || !this._ownsTimer || !this.state.isRunning) return;
        // Clear any existing interval
        if (this._timerInterval) {
            this._clearInterval(this._timerInterval);
        }

        // If timer is running but endTime is not set, set it now
        if (this.state.isRunning && !this.state.endTime) {
            this.state.endTime = this._now() + (this.state.timeLeft * 1000);
        }

        this._lastPersistedBoundary = Math.floor(Math.max(0, this.state.timeLeft) / 5);

        // Use the absolute deadline so background time jumps do not accumulate drift.
        this._timerInterval = this._setInterval(() => {
            if (this.state.isRunning) {
                const now = this._now();
                const timeLeftMs = Math.max(0, this.state.endTime - now);
                this.state.timeLeft = Math.ceil(timeLeftMs / 1000);

                this.updateDisplay();

                if (this.state.timeLeft <= 0) {
                    this._completeCurrentSession();
                } else {
                    this._persistBoundaryIfNeeded();
                }
            }
        }, 500); // Run more frequently for smoother updates
    }

    startTimer() {
        if (!this._ownsTimer || this._disposed) return false;
        if (!this.state.isRunning) {
            this.state.isRunning = true;
            this.state.lastActiveTime = this._now();

            // Set absolute end time for accurate tracking
            this.state.endTime = this._now() + (this.state.timeLeft * 1000);
            this._completionToken = null;
            this._lastPersistedBoundary = Math.floor(Math.max(0, this.state.timeLeft) / 5);

            this.saveState();
            this.resumeTimer();
            this.updateDisplay();

            // Register a service worker for background notifications if supported
            this.registerTimerWorker();
        }
        return true;
    }

    pauseTimer() {
        if (!this._ownsTimer || this._disposed) return false;
        if (this.state.isRunning) {
            if (this.state.endTime) {
                this.state.timeLeft = Math.ceil(Math.max(0, this.state.endTime - this._now()) / 1000);
            }
            this.state.isRunning = false;

            if (this._timerInterval) {
                this._clearInterval(this._timerInterval);
                this._timerInterval = null;
            }

            // Clear the end time when paused
            this.state.endTime = null;

            this.saveState();
            this.updateDisplay();
        }
        return true;
    }

    resetTimer() {
        if (this._disposed || !this._ownsTimer) return false;
        // Prevent multiple resets
        if (this._resetInProgress) return;
        this._resetInProgress = true;

        // Clear interval
        if (this._timerInterval) {
            this._clearInterval(this._timerInterval);
            this._timerInterval = null;
        }

        // Clear sound loop if it exists
        if (this._soundLoopInterval) {
            this._clearInterval(this._soundLoopInterval);
            this._soundLoopInterval = null;
        }

        // Reset state
        this.state.isRunning = false;
        this.state.timeLeft = this.TIMER_DURATIONS.POMODORO;
        this.state.currentState = this.TIMER_STATES.FOCUS;
        this.state.endTime = null;
        this._completionToken = null;
        this._lastPersistedBoundary = null;

        this.saveState();
        this.updateDisplay();

        this._resetInProgress = false;
        return true;
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
        if (this._disposed || !this._ownsTimer || !this.state.isRunning) return false;
        // Clear interval
        if (this._timerInterval) {
            this._clearInterval(this._timerInterval);
            this._timerInterval = null;
        }

        // Update global stats if a focus session completed
        if (window.stats && this.state.currentState === this.TIMER_STATES.FOCUS) {
            try {
                // If activeTimerStart exists, calculate the total time worked
                if (window.stats.activeTimerStart) {
                    const activeTime = Math.floor((this._now() - window.stats.activeTimerStart - (window.stats.pausedTime || 0)) / 1000);
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

        return true;
    }

    startBreak() {
        if (this._disposed || !this._ownsTimer) return false;
        // Clear sound loop if it exists
        if (this._soundLoopInterval) {
            this._clearInterval(this._soundLoopInterval);
            this._soundLoopInterval = null;
        }

        this.state.currentState = this.TIMER_STATES.BREAK;
        this.state.timeLeft = this.state.pomodoroCount % 4 === 0 ?
            this.TIMER_DURATIONS.LONG_BREAK : this.TIMER_DURATIONS.SHORT_BREAK;

        // Set new end time
        if (this.state.isRunning) {
            this.state.endTime = this._now() + (this.state.timeLeft * 1000);
        } else {
            this.state.endTime = null;
        }

        this._completionToken = null;
        this._lastPersistedBoundary = this.state.isRunning ? Math.floor(this.state.timeLeft / 5) : null;

        this.updateDisplay();
        this.saveState();
    }

    startFocus() {
        if (this._disposed || !this._ownsTimer) return false;
        // Clear sound loop if it exists
        if (this._soundLoopInterval) {
            this._clearInterval(this._soundLoopInterval);
            this._soundLoopInterval = null;
        }

        this.state.currentState = this.TIMER_STATES.FOCUS;
        this.state.timeLeft = this.TIMER_DURATIONS.POMODORO;

        // Set new end time
        if (this.state.isRunning) {
            this.state.endTime = this._now() + (this.state.timeLeft * 1000);
        } else {
            this.state.endTime = null;
        }

        this._completionToken = null;
        this._lastPersistedBoundary = this.state.isRunning ? Math.floor(this.state.timeLeft / 5) : null;

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
        if (this._disposed || typeof document === 'undefined' || !document.body) return;
        // Remove existing notifications first
        document.querySelectorAll('.timer-notification').forEach(el => el.remove());

        // Create notification element
        const notification = document.createElement('div');
        notification.className = `timer-notification ${type}`;
        notification.innerHTML = `<i class="bi bi-bell-fill" style="margin-right: 8px;"></i><span>${message}</span>`;

        // Add to body to avoid flex/grid container distortion
        document.body.appendChild(notification);

        // Show and remove smoothly
        const nextFrame = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (callback) => this._scheduleTimeout(callback, 0);
        nextFrame(() => {
            if (this._disposed) return;
            notification.classList.add('show');
            this._scheduleTimeout(() => {
                notification.classList.remove('show');
                this._scheduleTimeout(() => notification.remove(), 400);
            }, 4000);
        });
    }

    playSound() {
        // Clear any previous sound loop if one was running
        if (this._soundLoopInterval) {
            this._clearInterval(this._soundLoopInterval);
            this._soundLoopInterval = null;
        }

        try {
            // Play a single pleasant notification sound once
            const audio = new Audio('sounds/click-confirm.mp3');
            audio.volume = 0.6;
            audio.play().catch(() => {
                // Fallback to pop if needed
                const fallback = new Audio('pop.mp3');
                fallback.volume = 0.5;
                fallback.play().catch(e => console.log('Audio playback blocked by browser:', e));
            });
        } catch (error) {
            console.warn('Could not play timer sound:', error);
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
            this._scheduleTimeout(() => notification.close(), 5000);
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
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && this.state.isRunning) {
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
                        this._scheduleTimeout(() => {
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

    _scheduleTimeout(callback, delay) {
        const handle = this._setTimeout(() => {
            this._scheduledTimeouts.delete(handle);
            if (!this._disposed) callback();
        }, delay);
        this._scheduledTimeouts.add(handle);
        return handle;
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this.state.isRunning = false;

        if (this._timerInterval) {
            this._clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        if (this._syncInterval) {
            this._clearInterval(this._syncInterval);
            this._syncInterval = null;
        }
        if (this._soundLoopInterval) {
            this._clearInterval(this._soundLoopInterval);
            this._soundLoopInterval = null;
        }
        for (const handle of this._scheduledTimeouts) {
            this._clearTimeout(handle);
        }
        this._scheduledTimeouts.clear();
        for (const cleanup of this._eventCleanups.splice(0)) {
            try { cleanup(); } catch { /* disposal is best effort */ }
        }
        releasePomodoroOwner(this);
    }
}

if (typeof window !== 'undefined') {
    window.PomodoroTimer = PomodoroTimer;
}

// Initialize the Pomodoro timer
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        try {
            console.log('Initializing Pomodoro Timer...');
            // Check if the timer is already initialized to prevent multiple instances
            if (!window.pomodoroTimer) {
                window.pomodoroTimer = new PomodoroTimer();

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
}
