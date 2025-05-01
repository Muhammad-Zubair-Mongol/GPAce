// Global Pomodoro Timer State Management
// This module ensures the Pomodoro timer state persists across different pages

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
    lastActiveTime: Date.now(),
    endTime: null
};

// Initialize timer state
function initializeTimerState() {
    try {
        // Load state from localStorage
        const savedState = localStorage.getItem(TIMER_STATE_KEY);
        if (savedState) {
            const parsedState = JSON.parse(savedState);
            
            // Only use saved state if version matches
            if (parsedState.version === TIMER_VERSION) {
                globalTimerState = parsedState;
                
                // If timer is running, update timeLeft based on endTime
                if (globalTimerState.isRunning && globalTimerState.endTime) {
                    const now = Date.now();
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

// Save timer state to localStorage
function saveTimerState() {
    try {
        globalTimerState.lastActiveTime = Date.now();
        localStorage.setItem(TIMER_STATE_KEY, JSON.stringify(globalTimerState));
        localStorage.setItem(TIMER_LAST_TICK_KEY, Date.now().toString());
        
        // Notify service worker if timer is running
        if (globalTimerState.isRunning && 'serviceWorker' in navigator) {
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

// Reset timer to default state
function resetTimer() {
    globalTimerState = {
        timeLeft: window.POMODORO_GLOBALS.TIMER_DURATIONS.POMODORO,
        currentState: window.POMODORO_GLOBALS.TIMER_STATES.FOCUS,
        pomodoroCount: 0,
        isRunning: false,
        selectedFatigueLevel: null,
        version: TIMER_VERSION,
        lastActiveTime: Date.now(),
        endTime: null
    };
    
    saveTimerState();
}

// Handle timer completion
function handleTimerComplete() {
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
    
    saveTimerState();
}

// Start a break session
function startBreak() {
    globalTimerState.currentState = window.POMODORO_GLOBALS.TIMER_STATES.BREAK;
    globalTimerState.timeLeft = globalTimerState.pomodoroCount % 4 === 0 ?
        window.POMODORO_GLOBALS.TIMER_DURATIONS.LONG_BREAK : window.POMODORO_GLOBALS.TIMER_DURATIONS.SHORT_BREAK;
    
    // Set new end time if timer is running
    if (globalTimerState.isRunning) {
        globalTimerState.endTime = Date.now() + (globalTimerState.timeLeft * 1000);
    } else {
        globalTimerState.endTime = null;
    }
    
    saveTimerState();
}

// Start a focus session
function startFocus() {
    globalTimerState.currentState = window.POMODORO_GLOBALS.TIMER_STATES.FOCUS;
    globalTimerState.timeLeft = window.POMODORO_GLOBALS.TIMER_DURATIONS.POMODORO;
    
    // Set new end time if timer is running
    if (globalTimerState.isRunning) {
        globalTimerState.endTime = Date.now() + (globalTimerState.timeLeft * 1000);
    } else {
        globalTimerState.endTime = null;
    }
    
    saveTimerState();
}

// Start the timer
function startTimer() {
    if (!globalTimerState.isRunning) {
        globalTimerState.isRunning = true;
        globalTimerState.lastActiveTime = Date.now();
        
        // Set absolute end time for accurate tracking
        globalTimerState.endTime = Date.now() + (globalTimerState.timeLeft * 1000);
        
        saveTimerState();
    }
}

// Pause the timer
function pauseTimer() {
    if (globalTimerState.isRunning) {
        globalTimerState.isRunning = false;
        globalTimerState.endTime = null;
        
        saveTimerState();
    }
}

// Setup cross-tab synchronization
function setupCrossTabSync() {
    window.addEventListener('storage', (e) => {
        if (e.key === TIMER_STATE_KEY) {
            const newState = JSON.parse(e.newValue);
            if (newState.version === TIMER_VERSION) {
                globalTimerState = newState;
                
                // Notify any listeners
                window.dispatchEvent(new CustomEvent('pomodoroStateChanged', {
                    detail: { state: globalTimerState }
                }));
            }
        }
    });
    
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
    
    // Request notification permission
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeTimerState();
    setupCrossTabSync();
    
    // Periodically sync timer state if running
    setInterval(() => {
        if (globalTimerState.isRunning && globalTimerState.endTime) {
            const now = Date.now();
            const timeLeftMs = Math.max(0, globalTimerState.endTime - now);
            globalTimerState.timeLeft = Math.ceil(timeLeftMs / 1000);
            
            // Check if timer completed
            if (globalTimerState.timeLeft <= 0) {
                handleTimerComplete();
            } else if (globalTimerState.timeLeft % 5 === 0) {
                // Save state occasionally to reduce overhead
                saveTimerState();
            }
            
            // Notify any listeners
            window.dispatchEvent(new CustomEvent('pomodoroStateChanged', {
                detail: { state: globalTimerState }
            }));
        }
    }, 1000);
});

// Export the API
window.pomodoroGlobal = {
    getState: () => ({ ...globalTimerState }),
    startTimer,
    pauseTimer,
    resetTimer,
    startFocus,
    startBreak,
    TIMER_STATES: window.POMODORO_GLOBALS.TIMER_STATES,
    TIMER_DURATIONS: window.POMODORO_GLOBALS.TIMER_DURATIONS
}; 