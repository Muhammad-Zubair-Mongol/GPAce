// Global Pomodoro Timer State Management
// This module ensures the Pomodoro timer state persists across different pages

// Storage helper with fallback (use existing or create new)
if (typeof window.getStorage === 'undefined') {
    window.getStorage = () => window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };
}
// Use window.getStorage() directly to avoid redeclaration errors

const GLOBAL_POMODORO_OWNER_KEY = '__gpacePomodoroTimerOwner';
const GLOBAL_POMODORO_RUNTIME_KEY = '__gpacePomodoroGlobalRuntime';

function globalPomodoroNow() {
    const injectedClock = window.__gpacePomodoroClock;
    if (injectedClock && typeof injectedClock.now === 'function') return injectedClock.now();
    return Date.now();
}

function claimGlobalPomodoroOwner() {
    const current = window[GLOBAL_POMODORO_OWNER_KEY];
    if (current?.active && current.name !== 'pomodoroGlobal') return false;
    window[GLOBAL_POMODORO_OWNER_KEY] = {
        name: 'pomodoroGlobal',
        instance: window,
        active: true
    };
    return true;
}

const globalPomodoroRuntime = window[GLOBAL_POMODORO_RUNTIME_KEY] || {
    initialized: false,
    ownsTimer: false,
    interval: null,
    storageHandler: null,
    lastPersistedBoundary: null,
    completionToken: null
};
window[GLOBAL_POMODORO_RUNTIME_KEY] = globalPomodoroRuntime;

// Constants
const TIMER_STATE_KEY = 'pomodoroState';
const TIMER_LAST_TICK_KEY = 'pomodoroLastTick';
const TIMER_VERSION = '1.1.0';

// At the top of the file, check if TIMER_STATES already exists
if (typeof window.POMODORO_GLOBALS === 'undefined') {
    // Create namespace for pomodoro globals
    window.POMODORO_GLOBALS = {
        TIMER_STATES: {
            IDLE: 'idle', // Added IDLE state for consistency if needed elsewhere
            FOCUS: 'focus',
            BREAK: 'break',
            LONG_BREAK: 'longBreak', // Added LONG_BREAK state for consistency
            PAUSED: 'paused' // Added PAUSED state for consistency
        },
        TIMER_DURATIONS: {
            POMODORO: 25 * 60,
            SHORT_BREAK: 5 * 60,
            LONG_BREAK: 15 * 60
        }
    };
}
// Then use window.POMODORO_GLOBALS.TIMER_STATES and window.POMODORO_GLOBALS.TIMER_DURATIONS

// Global timer state
let globalTimerState = {
    timeLeft: window.POMODORO_GLOBALS.TIMER_DURATIONS.POMODORO,
    currentState: window.POMODORO_GLOBALS.TIMER_STATES.FOCUS,
    pomodoroCount: 0,
    isRunning: false,
    selectedFatigueLevel: null,
    version: TIMER_VERSION,
    lastActiveTime: globalPomodoroNow(),
    endTime: null
};

// Initialize timer state
window.initializeTimerState = function () {
    try {
        // Load state from storage
        const storage = window.getStorage();
        const savedState = storage.get(TIMER_STATE_KEY, null);
        if (savedState) {
            // Only use saved state if version matches
            if (savedState.version === TIMER_VERSION) {
                globalTimerState = savedState;

                // If timer is running, update timeLeft based on endTime
                if (globalTimerState.isRunning && globalTimerState.endTime) {
                    const now = globalPomodoroNow();
                    const timeLeftMs = Math.max(0, globalTimerState.endTime - now);
                    globalTimerState.timeLeft = Math.ceil(timeLeftMs / 1000);

                    // If timer completed while away, handle completion
                    if (globalTimerState.timeLeft <= 0) {
                        handleTimerComplete();
                    }
                }
            } else {
                // Version mismatch, reset timer
                console.log('Timer version mismatch, resetting');
                resetTimer();
            }
        }
    } catch (error) {
        console.error('Error initializing timer state:', error);
        resetTimer();
    }
}

// Save timer state to storage
window.saveTimerState = function () {
    try {
        const storage = window.getStorage();
        globalTimerState.lastActiveTime = globalPomodoroNow();
        storage.set(TIMER_STATE_KEY, globalTimerState);
        storage.set(TIMER_LAST_TICK_KEY, globalPomodoroNow());

        // Notify service worker if timer is running
        if (globalTimerState.isRunning && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(registration => {
                registration.active.postMessage({
                    type: 'POMODORO_TIMER',
                    endTime: globalTimerState.endTime,
                    timerState: globalTimerState.currentState,
                    pomodoroCount: globalTimerState.pomodoroCount
                });
            }).catch(err => console.log('Failed to message service worker:', err));
        }
    } catch (error) {
        console.error('Error saving timer state:', error);
    }
}

function persistGlobalBoundaryIfNeeded() {
    const timeLeft = Number(globalTimerState.timeLeft);
    if (!Number.isFinite(timeLeft) || timeLeft <= 0 || timeLeft % 5 !== 0) return;
    const boundary = Math.floor(timeLeft / 5);
    if (boundary === globalPomodoroRuntime.lastPersistedBoundary) return;
    globalPomodoroRuntime.lastPersistedBoundary = boundary;
    window.saveTimerState();
}

// Reset timer to default state
window.resetTimer = function () {
    if (!globalPomodoroRuntime.ownsTimer) return false;
    globalTimerState = {
        timeLeft: window.POMODORO_GLOBALS.TIMER_DURATIONS.POMODORO,
        currentState: window.POMODORO_GLOBALS.TIMER_STATES.FOCUS,
        pomodoroCount: 0,
        isRunning: false,
        selectedFatigueLevel: null,
        version: TIMER_VERSION,
        lastActiveTime: globalPomodoroNow(),
        endTime: null
    };

    globalPomodoroRuntime.lastPersistedBoundary = null;
    globalPomodoroRuntime.completionToken = null;

    saveTimerState();
    return true;
}

// Handle timer completion
window.handleTimerComplete = function () {
    if (!globalPomodoroRuntime.ownsTimer || !globalTimerState.isRunning) return false;
    const token = globalTimerState.endTime || `${globalTimerState.currentState}:${globalTimerState.timeLeft}`;
    if (globalPomodoroRuntime.completionToken === token) return false;
    globalPomodoroRuntime.completionToken = token;

    // Update session state
    if (globalTimerState.currentState === window.POMODORO_GLOBALS.TIMER_STATES.FOCUS) {
        globalTimerState.pomodoroCount++;
        startBreak();
    } else {
        startFocus();
    }

    // Play sound if possible
    try {
        const audio = new Audio('pop.mp3');
        audio.play().catch(error => {
            console.log('Sound playback failed:', error);
        });
    } catch (error) {
        console.log('Sound playback failed:', error);
    }

    // Show notification if possible
    if ('Notification' in window && Notification.permission === 'granted') {
        const title = globalTimerState.currentState === window.POMODORO_GLOBALS.TIMER_STATES.FOCUS ?
            'Break Time!' : 'Focus Time!';
        const message = globalTimerState.currentState === window.POMODORO_GLOBALS.TIMER_STATES.FOCUS ?
            'Great job! Take a break.' : 'Break is over. Time to focus!';

        const notification = new Notification(title, {
            body: message,
            icon: '/icons/timer-icon.png',
            silent: true
        });

        setTimeout(() => notification.close(), 5000);
    }

    return true;
}

// Start a break session
window.startBreak = function () {
    if (!globalPomodoroRuntime.ownsTimer) return false;
    globalTimerState.currentState = window.POMODORO_GLOBALS.TIMER_STATES.BREAK;
    globalTimerState.timeLeft = globalTimerState.pomodoroCount % 4 === 0 ?
        window.POMODORO_GLOBALS.TIMER_DURATIONS.LONG_BREAK : window.POMODORO_GLOBALS.TIMER_DURATIONS.SHORT_BREAK;

    // Set new end time if timer is running
    if (globalTimerState.isRunning) {
        globalTimerState.endTime = globalPomodoroNow() + (globalTimerState.timeLeft * 1000);
    } else {
        globalTimerState.endTime = null;
    }

    globalPomodoroRuntime.completionToken = null;
    globalPomodoroRuntime.lastPersistedBoundary = globalTimerState.isRunning
        ? Math.floor(globalTimerState.timeLeft / 5)
        : null;

    saveTimerState();
    return true;
}

// Start a focus session
window.startFocus = function () {
    if (!globalPomodoroRuntime.ownsTimer) return false;
    globalTimerState.currentState = window.POMODORO_GLOBALS.TIMER_STATES.FOCUS;
    globalTimerState.timeLeft = window.POMODORO_GLOBALS.TIMER_DURATIONS.POMODORO;

    // Set new end time if timer is running
    if (globalTimerState.isRunning) {
        globalTimerState.endTime = globalPomodoroNow() + (globalTimerState.timeLeft * 1000);
    } else {
        globalTimerState.endTime = null;
    }

    globalPomodoroRuntime.completionToken = null;
    globalPomodoroRuntime.lastPersistedBoundary = globalTimerState.isRunning
        ? Math.floor(globalTimerState.timeLeft / 5)
        : null;

    saveTimerState();
    return true;
}

// Start the timer
window.startTimer = function () {
    if (!globalPomodoroRuntime.ownsTimer) return false;
    if (!globalTimerState.isRunning) {
        globalTimerState.isRunning = true;
        globalTimerState.lastActiveTime = globalPomodoroNow();

        // Set absolute end time for accurate tracking
        globalTimerState.endTime = globalPomodoroNow() + (globalTimerState.timeLeft * 1000);
        globalPomodoroRuntime.lastPersistedBoundary = Math.floor(Math.max(0, globalTimerState.timeLeft) / 5);
        globalPomodoroRuntime.completionToken = null;

        window.saveTimerState();
    }
    return true;
}

// Pause the timer
window.pauseTimer = function () {
    if (!globalPomodoroRuntime.ownsTimer) return false;
    if (globalTimerState.isRunning) {
        if (globalTimerState.endTime) {
            globalTimerState.timeLeft = Math.ceil(Math.max(0, globalTimerState.endTime - globalPomodoroNow()) / 1000);
        }
        globalTimerState.isRunning = false;
        globalTimerState.endTime = null;

        window.saveTimerState();
    }
    return true;
}

// Setup cross-tab synchronization
window.setupCrossTabSync = function () {
    if (globalPomodoroRuntime.initialized) return globalPomodoroRuntime.ownsTimer;
    globalPomodoroRuntime.ownsTimer = claimGlobalPomodoroOwner();
    if (!globalPomodoroRuntime.ownsTimer) return false;

    const storageHandler = (e) => {
        if (e.key === TIMER_STATE_KEY) {
            let newState;
            try {
                newState = e.newValue ? JSON.parse(e.newValue) : null;
            } catch {
                return;
            }
            if (newState?.version === TIMER_VERSION) {
                globalTimerState = newState;
                globalPomodoroRuntime.lastPersistedBoundary = globalTimerState.isRunning
                    ? Math.floor(Math.max(0, globalTimerState.timeLeft) / 5)
                    : null;

                // Notify any listeners
                window.dispatchEvent(new CustomEvent('pomodoroStateChanged', {
                    detail: { state: globalTimerState }
                }));
            }
        }
    };
    globalPomodoroRuntime.storageHandler = storageHandler;
    window.addEventListener('storage', storageHandler);

    // Register service worker if supported
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('/js/alarm-service-worker.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
            })
            .catch(error => {
                console.log('Service Worker registration failed:', error);
            });
    }

    // Request notification permission
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }

    globalPomodoroRuntime.initialized = true;
    return true;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    if (!globalPomodoroRuntime.ownsTimer) {
        globalPomodoroRuntime.ownsTimer = claimGlobalPomodoroOwner();
    }
    initializeTimerState();
    setupCrossTabSync();

    // Periodically sync timer state if running
    if (!globalPomodoroRuntime.interval && globalPomodoroRuntime.ownsTimer) {
    globalPomodoroRuntime.interval = setInterval(() => {
        if (globalTimerState.isRunning && globalTimerState.endTime) {
            const now = globalPomodoroNow();
            const timeLeftMs = Math.max(0, globalTimerState.endTime - now);
            globalTimerState.timeLeft = Math.ceil(timeLeftMs / 1000);

            // Check if timer completed
            if (globalTimerState.timeLeft <= 0) {
                window.handleTimerComplete();
            } else {
                persistGlobalBoundaryIfNeeded();
            }

            // Notify any listeners
            window.dispatchEvent(new CustomEvent('pomodoroStateChanged', {
                detail: { state: globalTimerState }
            }));
        }
    }, 1000);
    }
});

window.disposePomodoroGlobal = function () {
    if (globalPomodoroRuntime.interval) {
        clearInterval(globalPomodoroRuntime.interval);
        globalPomodoroRuntime.interval = null;
    }
    if (globalPomodoroRuntime.storageHandler) {
        window.removeEventListener('storage', globalPomodoroRuntime.storageHandler);
        globalPomodoroRuntime.storageHandler = null;
    }
    globalPomodoroRuntime.initialized = false;
    globalPomodoroRuntime.ownsTimer = false;
    globalTimerState.isRunning = false;
    if (window[GLOBAL_POMODORO_OWNER_KEY]?.name === 'pomodoroGlobal') {
        delete window[GLOBAL_POMODORO_OWNER_KEY];
    }
};

// Export the API
window.pomodoroGlobal = {
    getState: () => ({ ...globalTimerState }),
    startTimer: window.startTimer,
    pauseTimer: window.pauseTimer,
    resetTimer: window.resetTimer,
    startFocus: window.startFocus,
    startBreak: window.startBreak,
    dispose: window.disposePomodoroGlobal,
    TIMER_STATES: window.POMODORO_GLOBALS.TIMER_STATES,
    TIMER_DURATIONS: window.POMODORO_GLOBALS.TIMER_DURATIONS
}; 
