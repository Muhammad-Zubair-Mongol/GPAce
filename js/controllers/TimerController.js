/**
 * TimerController - Centralized Pomodoro Timer Management
 * 
 * This module consolidates all timer functionality that was previously
 * scattered across multiple inline scripts in grind.html.
 * 
 * Features:
 * - Unified timer state management
 * - Title updates with timer display
 * - Focus/Break mode switching
 * - Stats tracking integration
 * - Cross-tab synchronization
 */

// Timer Constants
const TIMER_STATES = Object.freeze({
    FOCUS: 'focus',
    BREAK: 'break',
    PAUSED: 'paused'
});

const TIMER_DURATIONS = Object.freeze({
    POMODORO: 25 * 60,      // 25 minutes
    SHORT_BREAK: 5 * 60,    // 5 minutes
    LONG_BREAK: 15 * 60,    // 15 minutes
    MIN_TIME: 1 * 60,       // 1 minute minimum
    MAX_TIME: 60 * 60       // 1 hour maximum
});

const TIMER_OWNER_KEY = '__gpacePomodoroTimerOwner';

function currentTimerOwner() {
    if (typeof window === 'undefined') return null;
    const owner = window[TIMER_OWNER_KEY];
    return owner && owner.active && owner.instance && !owner.instance._disposed ? owner : null;
}

function claimTimerOwner(instance) {
    if (typeof window === 'undefined') return true;
    const current = currentTimerOwner();
    if (current && current.instance !== instance) return false;
    window[TIMER_OWNER_KEY] = { name: 'TimerController', instance, active: true };
    return true;
}

function releaseTimerOwner(instance) {
    if (typeof window !== 'undefined' && window[TIMER_OWNER_KEY]?.instance === instance) {
        delete window[TIMER_OWNER_KEY];
    }
}

class TimerController {
    constructor(options = {}) {
        if (!options.forceNew) {
            const existing = currentTimerOwner();
            if (existing?.name === 'TimerController') return existing.instance;
        }

        this._now = typeof options.now === 'function'
            ? options.now
            : (options.clock && typeof options.clock.now === 'function' ? options.clock.now.bind(options.clock) : () => Date.now());
        this._setInterval = options.setInterval || setInterval;
        this._clearInterval = options.clearInterval || clearInterval;
        this._setTimeout = options.setTimeout || setTimeout;
        this._clearTimeout = options.clearTimeout || clearTimeout;
        this._disposed = false;
        this._ownsTimer = claimTimerOwner(this);
        this._initialized = false;
        this._lastPersistedBoundary = null;
        this._completionToken = null;
        this._eventAbortController = typeof AbortController === 'function' ? new AbortController() : null;

        // Unified state object - single source of truth
        this.state = {
            timeLeft: TIMER_DURATIONS.POMODORO,
            currentState: TIMER_STATES.FOCUS,
            pomodoroCount: 0,
            timerInterval: null,
            startTime: null,
            endTime: null,
            isRunning: false,
            fatigueLogged: false,
            originalTitle: 'GPAce - Current Task'
        };

        // Title update interval reference
        this.titleInterval = null;

        // Timer state batching for performance (reduce localStorage writes)
        this.ticksSinceLastSave = 0;
        this.SAVE_INTERVAL = 10; // Save every 10 seconds instead of every second

        // Stats integration
        this.stats = {
            totalWorkTime: 0,
            activeTimerStart: null,
            pausedTime: 0,
            sessionHistory: [],
            lastSessionDate: null
        };

        // User preferences
        this.preferences = {
            defaultPomodoroTime: TIMER_DURATIONS.POMODORO,
            soundEnabled: true,
            notifications: true,
            autoStartBreaks: false
        };

        // Bind methods to maintain context
        this.startTimer = this.startTimer.bind(this);
        this.pauseTimer = this.pauseTimer.bind(this);
        this.resetTimer = this.resetTimer.bind(this);
        this.handleTimerComplete = this.handleTimerComplete.bind(this);

        // Initialize
        this._loadState();
        this._loadStats();
        this._loadPreferences();
        // this._setupEventListeners(); // Moved to init
        this._setupVisibilityHandler();
    }

    /**
     * Initialize the timer controller
     */
    init() {
        if (this._initialized) return this;
        this._initialized = true;
        this._setupEventListeners();
        this.updateDisplay();
        this._updateTitleWithCurrentTime();
        console.log('TimerController initialized');
        return this;
    }

    /**
     * Start the timer
     */
    startTimer() {
        if (this._disposed || !this._ownsTimer || this.state.timerInterval) return false;

        // Get time from display if available
        const timerDisplay = document.getElementById('timer');
        if (timerDisplay) {
            const [minutes, seconds] = timerDisplay.textContent.split(':').map(Number);
            if (!isNaN(minutes) && !isNaN(seconds)) {
                this.state.timeLeft = minutes * 60 + seconds;
            }
        }

        // Set start time if not resuming
        if (!this.state.isRunning) {
            this.state.startTime = this._now();
            this.stats.activeTimerStart = this._now();
        }

        this.state.isRunning = true;
        this.state.endTime = this._now() + (this.state.timeLeft * 1000);
        this._completionToken = null;
        this._lastPersistedBoundary = Math.floor(Math.max(0, this.state.timeLeft) / 5);

        // Start one deadline-based interval. Wall-clock jumps are reflected on
        // the next tick instead of accumulating one-second drift.
        this.state.timerInterval = this._setInterval(() => {
            if (!this.state.isRunning || !this.state.endTime) return;
            this.state.timeLeft = Math.ceil(Math.max(0, this.state.endTime - this._now()) / 1000);
            if (this.state.timeLeft <= 0) {
                this._completeCurrentSession();
                return;
            }
            this._persistBoundaryIfNeeded();
            this.updateDisplay();
        }, 1000);

        // Start title updates
        this._startTitleUpdates();

        // Update button UI
        this._updateButtonState('running');

        // Reset batch counter on start
        this.ticksSinceLastSave = 0;

        // Save state immediately on start
        this._saveState();

        // Show notification
        this._showNotification('Timer started', 'success');
        return true;
    }

    /**
     * Pause the timer
     */
    pauseTimer() {
        if (this._disposed || !this._ownsTimer) return false;
        if (this.state.endTime && this.state.isRunning) {
            this.state.timeLeft = Math.ceil(Math.max(0, this.state.endTime - this._now()) / 1000);
        }
        if (this.state.timerInterval) {
            this._clearInterval(this.state.timerInterval);
            this.state.timerInterval = null;
        }

        this.state.isRunning = false;
        this.state.endTime = null;

        // Track paused time for stats
        if (this.stats.activeTimerStart) {
            this.stats.pausedTime += this._now() - this.stats.activeTimerStart;
        }

        // Save state immediately on pause (important for data persistence)
        this._saveState();
        this._updateButtonState('paused');
        this._stopTitleUpdates();
        this._updateTitleWithCurrentTime();
        this._showNotification('Timer paused', 'info');
        return true;
    }

    /**
     * Reset the timer to initial state
     */
    resetTimer() {
        if (this._disposed || !this._ownsTimer) return false;
        // Stop any running interval
        if (this.state.timerInterval) {
            this._clearInterval(this.state.timerInterval);
            this.state.timerInterval = null;
        }

        // Save work time before reset
        if (this.stats.activeTimerStart && this.state.currentState === TIMER_STATES.FOCUS) {
            const activeTime = Math.floor((this._now() - this.stats.activeTimerStart - this.stats.pausedTime) / 1000);
            this.stats.totalWorkTime += activeTime;
            this._saveStats();
        }

        // Reset state
        this.state.isRunning = false;
        this.state.timeLeft = TIMER_DURATIONS.POMODORO;
        this.state.currentState = TIMER_STATES.FOCUS;
        this.state.startTime = null;
        this.state.endTime = null;
        this.state.fatigueLogged = false;
        this.stats.activeTimerStart = null;
        this.stats.pausedTime = 0;

        this.updateDisplay();
        this._updateButtonState('paused');
        // Save state immediately on reset (important for data persistence)
        this._saveState();
        this._stopTitleUpdates();
        this._updateTitleWithCurrentTime();
        this._showNotification('Timer reset', 'info');
        this._lastPersistedBoundary = null;
        this._completionToken = null;
        return true;
    }

    /**
     * Set a custom timer duration
     */
    setCustomTime(minutes) {
        if (minutes > 0 && minutes <= 60) {
            this.state.timeLeft = minutes * 60;
            this.state.currentState = TIMER_STATES.FOCUS;
            this.updateDisplay();
            // Immediate save on custom time change
            this._saveState();
        }
    }

    /**
     * Switch to focus mode
     */
    startFocus() {
        this.state.currentState = TIMER_STATES.FOCUS;
        this.state.timeLeft = TIMER_DURATIONS.POMODORO;
        this.state.startTime = this._now();
        this.updateDisplay();
        this._stopTitleUpdates();
        this.startTimer();
    }

    /**
     * Switch to break mode
     */
    startBreak() {
        this.state.currentState = TIMER_STATES.BREAK;
        this.state.timeLeft = (this.state.pomodoroCount % 4 === 0) ?
            TIMER_DURATIONS.LONG_BREAK : TIMER_DURATIONS.SHORT_BREAK;
        this.state.startTime = this._now();
        this.updateDisplay();
        this._stopTitleUpdates();
        this.startTimer();
    }

    /**
     * Handle timer completion
     */
    _completeCurrentSession() {
        const token = this.state.endTime || `${this.state.currentState}:${this.state.timeLeft}`;
        if (this._completionToken === token) return false;
        this._completionToken = token;
        return this.handleTimerComplete();
    }

    _persistBoundaryIfNeeded() {
        const timeLeft = Number(this.state.timeLeft);
        if (!Number.isFinite(timeLeft) || timeLeft <= 0 || timeLeft % 5 !== 0) return;
        const boundary = Math.floor(timeLeft / 5);
        if (boundary === this._lastPersistedBoundary) return;
        this._lastPersistedBoundary = boundary;
        this._saveState();
    }

    handleTimerComplete() {
        if (this._disposed || !this._ownsTimer || !this.state.isRunning) return false;
        this._clearInterval(this.state.timerInterval);
        this.state.timerInterval = null;
        this.state.timeLeft = 0;
        this.state.isRunning = false;
        this.state.endTime = null;

        // Play notification sound
        this._playNotificationSound();

        // Show browser notification
        this._showBrowserNotification();

        if (this.state.currentState === TIMER_STATES.FOCUS) {
            // Update stats before transitioning
            const elapsedSeconds = Math.floor((this._now() - this.stats.activeTimerStart - this.stats.pausedTime) / 1000);
            this.stats.totalWorkTime += elapsedSeconds;
            this._updateStatsDisplay();
            this._saveStats();

            this.state.pomodoroCount++;

            // Log current energy level after focus session (if we have one stored)
            this._logSessionEnergy('Focus session completed');

            this.startBreak();
        } else {
            // Break completed - prompt for new energy level before starting focus
            // This helps track how refreshed the user feels after break
            this._promptForEnergyLevel();
            this.startFocus();
        }

        return true;
    }

    /**
     * Log energy level after a session and update chart
     */
    _logSessionEnergy(description) {
        const storedLevel = localStorage.getItem('currentEnergyLevel');
        if (storedLevel && window.energyTracker) {
            const level = parseInt(storedLevel);
            if (level >= 1 && level <= 7) {
                window.energyTracker.addEnergyLevel(level, description);

                // Update the energy chart
                if (window.energyController) {
                    window.energyController.updateEnergyChart();
                }
            }
        }
    }

    /**
     * Prompt user for energy level (after break completes)
     */
    _promptForEnergyLevel() {
        // Show fatigue modal if function is available
        if (typeof window.showFatigueModal === 'function') {
            // Slight delay to let the break sound play
            this._setTimeout(() => {
                if (this._disposed) return;
                window.showFatigueModal(false); // false = don't auto-start timer
            }, 1500);
        }
    }

    /**
     * Update the timer display
     */
    updateDisplay() {
        const minutes = Math.floor(this.state.timeLeft / 60);
        const seconds = this.state.timeLeft % 60;
        const display = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // Update timer display
        const timerElement = document.getElementById('timer');
        if (timerElement) {
            timerElement.textContent = display;
        }

        // Update session type label
        const sessionTypeElement = document.querySelector('.timer-label');
        if (sessionTypeElement) {
            sessionTypeElement.textContent =
                this.state.currentState === TIMER_STATES.FOCUS ? 'Focus Time' :
                    (this.state.pomodoroCount % 4 === 0 ? 'Long Break' : 'Short Break');
        }

        // Update progress ring
        const totalTime = this.state.currentState === TIMER_STATES.FOCUS ?
            TIMER_DURATIONS.POMODORO :
            (this.state.pomodoroCount % 4 === 0 ? TIMER_DURATIONS.LONG_BREAK : TIMER_DURATIONS.SHORT_BREAK);
        const progress = ((totalTime - this.state.timeLeft) / totalTime) * 100;

        const progressElement = document.querySelector('.timer-progress');
        if (progressElement) {
            progressElement.style.setProperty('--progress', `${progress}%`);
        }

        // Update pomodoro count
        const countElement = document.getElementById('pomodoroCount');
        if (countElement) {
            countElement.textContent = this.state.pomodoroCount;
        }
    }

    /**
     * Toggle timer (start/pause)
     */
    toggle() {
        if (this.state.isRunning) {
            this.pauseTimer();
        } else {
            this.startTimer();
        }
    }

    // ==================== Private Methods ====================

    /**
     * Start updating the document title with timer info
     */
    _startTitleUpdates() {
        this._stopTitleUpdates(); // Clear any existing interval

        const updateTitle = () => {
            const minutes = Math.floor(this.state.timeLeft / 60);
            const seconds = this.state.timeLeft % 60;
            const display = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            const timerType = this.state.currentState === TIMER_STATES.FOCUS ? 'Focus' : 'Break';
            document.title = `${display} - ${timerType} - GPAce`;
        };

        updateTitle();
        this.titleInterval = this._setInterval(updateTitle, 1000);
    }

    /**
     * Stop updating the document title with timer info
     */
    _stopTitleUpdates() {
        if (this.titleInterval) {
            this._clearInterval(this.titleInterval);
            this.titleInterval = null;
        }
    }

    /**
     * Update title with current time (when timer not running)
     */
    _updateTitleWithCurrentTime() {
        const now = new Date(this._now());
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        document.title = `${formattedTime} - GPAce`;
    }

    /**
     * Update button states
     */
    _updateButtonState(state) {
        const startBtn = document.getElementById('startBtn');
        if (!startBtn) return;

        if (state === 'running') {
            startBtn.innerHTML = '<i class="fas fa-pause"></i>';
            startBtn.setAttribute('data-state', 'running');
        } else {
            startBtn.innerHTML = '<i class="fas fa-play"></i>';
            startBtn.setAttribute('data-state', 'paused');
        }
    }

    /**
     * Setup event listeners for timer controls
     */
    _setupEventListeners() {
        const listenerOptions = this._eventAbortController
            ? { signal: this._eventAbortController.signal }
            : undefined;
        // Start/Pause button
        const startBtn = document.getElementById('startBtn');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                const state = startBtn.getAttribute('data-state');
                if (state === 'paused') {
                    // Show fatigue modal if appropriate (long session & not logged)
                    const minutes = this.state.timeLeft / 60;
                    if (minutes > 15 && !this.state.fatigueLogged && typeof window.showFatigueModal === 'function') {
                        // Pass true to auto-start timer after selection
                        window.showFatigueModal(true);
                        // Mark as logged to prevent looping behavior if user cancels and clicks again immediately?
                        // No, let them be prompted again if they cancel. 
                        // But if they proceed, showFatigueModal -> EnergyController -> window.startTimer() -> this.startTimer().
                        // So next time (after pause), fatigueLogged is still false unless we set it.
                        // We should set it when timer starts successfully? or when fatigue is logged?
                        // Ideally checking if(fatigueLogged) inside startTimer? No, logic is in click handler.
                        // If auto-start works, it bypasses this handler.
                        // If they pause and start again, we want to prompt again if long enough?
                        // Maybe. For now, let's keep it simple.

                        // We mark it true in the EnergyController flow implicitly by the fact that the timer starts.
                        // But we need to track it here.
                        // Let's rely on session duration check mainly.
                    } else {
                        this.startTimer();
                    }
                } else if (state === 'running') {
                    this.pauseTimer();
                }
            }, listenerOptions);
        }

        // Reset button
        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetTimer(), listenerOptions);
        }

        // Mode buttons
        document.querySelectorAll('.timer-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                const time = parseInt(btn.dataset.time);

                // Update active state
                document.querySelectorAll('.timer-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Update timer
                this.state.currentState = mode;
                this.state.timeLeft = time * 60;
                this.updateDisplay();
                this._saveState();
            }, listenerOptions);
        });

        // Custom time input
        const customTimeInput = document.getElementById('customTimeInput');
        if (customTimeInput) {
            customTimeInput.addEventListener('input', (e) => {
                let value = parseInt(e.target.value);
                if (isNaN(value) || value < 1) {
                    e.target.value = 1;
                    value = 1;
                } else if (value > 60) {
                    e.target.value = 60;
                    value = 60;
                }
                this.setCustomTime(value);
            }, listenerOptions);
        }
    }

    /**
     * Handle visibility changes to ensure title updates work
     */
    _setupVisibilityHandler() {
        const visibilityHandler = () => {
            if (document.visibilityState === 'visible') {
                if (this.state.isRunning) {
                    this._startTitleUpdates();
                } else {
                    this._updateTitleWithCurrentTime();
                }
            }
        };
        const options = this._eventAbortController ? { signal: this._eventAbortController.signal } : undefined;
        document.addEventListener('visibilitychange', visibilityHandler, options);
    }

    /**
     * Play notification sound
     */
    _playNotificationSound() {
        try {
            if (this.preferences.soundEnabled) {
                const audio = new Audio('assets/sounds/notification.mp3');
                audio.play().catch(e => console.log('Audio play failed', e));
            }
        } catch (e) {
            console.error('Error playing sound:', e);
        }
    }

    /**
     * Show browser notification
     */
    _showBrowserNotification() {
        if (typeof window === 'undefined' || !('Notification' in window) || !this.preferences.notifications || Notification.permission !== 'granted') return;

        const title = this.state.currentState === TIMER_STATES.FOCUS ? 'Focus Session Complete!' : 'Break Over!';
        const body = this.state.currentState === TIMER_STATES.FOCUS ?
            'Great job! Take a break.' : 'Time to get back to work!';

        new Notification(title, {
            body: body,
            icon: 'assets/icons/icon-192x192.png'
        });
    }

    /**
     * Show toast notification
     */
    _showNotification(message, type = 'info') {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
        } else {
            console.log(`Notification (${type}): ${message}`);
        }
    }

    _loadState() {
        const savedState = localStorage.getItem('timerState');
        if (savedState) {
            try {
                const parsed = JSON.parse(savedState);
                if (parsed.timeLeft && parsed.currentState) {
                    this.state.timeLeft = parsed.timeLeft;
                    this.state.currentState = parsed.currentState;
                    this.state.pomodoroCount = parsed.pomodoroCount || 0;
                    this.state.endTime = null;
                    this.state.isRunning = false;
                    // Don't auto-resume running state from refresh unless we handle it carefully
                    // For now, default to paused on reload
                }
            } catch (e) {
                console.error('Error loading timer state', e);
            }
        }
    }

    _saveState() {
        // Use Validators for safe localStorage writes if available
        const stateData = {
            timeLeft: this.state.timeLeft,
            currentState: this.state.currentState,
            pomodoroCount: this.state.pomodoroCount,
            isRunning: this.state.isRunning,
            endTime: this.state.endTime
        };

        if (typeof window.Validators !== 'undefined') {
            window.Validators.setValidatedStorageItem('timerState', stateData);
        } else {
            // Fallback to direct localStorage
            localStorage.setItem('timerState', JSON.stringify(stateData));
        }
    }

    _loadStats() {
        if (typeof window.loadStats === 'function') {
            // Stats are managed by StatsController now, but we might keep local ref
            // For now, we update global stats directly via window.stats if available
        }
    }

    _updateStatsDisplay() {
        if (typeof window.updateStatsDisplay === 'function') {
            window.updateStatsDisplay();
        }
    }

    _saveStats() {
        // Delegate to StatsController (via saveStats global)
        if (typeof window.saveStats === 'function') {
            window.saveStats();
        }
    }

    _loadPreferences() {
        // Could load from localStorage if we had settings
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this.state.isRunning = false;
        if (this.state.timerInterval) {
            this._clearInterval(this.state.timerInterval);
            this.state.timerInterval = null;
        }
        this._stopTitleUpdates();
        if (this._eventAbortController) {
            this._eventAbortController.abort();
        }
        releaseTimerOwner(this);
    }

    destroy() {
        this.dispose();
    }
}

const timerController = new TimerController();
export default timerController;
export { TimerController, TIMER_STATES, TIMER_DURATIONS };

// Expose to window for legacy scripts
if (typeof window !== 'undefined') {
    window.timerController = timerController;
    // Map legacy functions
    window.startTimer = timerController.startTimer;
    window.pauseTimer = timerController.pauseTimer;
    window.resetTimer = timerController.resetTimer;
    window.toggleTimer = () => timerController.toggle();
}
