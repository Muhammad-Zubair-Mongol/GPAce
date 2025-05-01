// common.js - Common initialization for all pages

// Function to ensure data is initialized
async function ensureDataInitialized() {
    console.log('🔄 Checking data initialization...');
    
    // Check if data is already initialized
    const dataInitialized = localStorage.getItem('dataInitialized') === 'true';
    const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');
    
    if (!dataInitialized || subjects.length === 0) {
        console.log('📥 Data not initialized, starting initialization...');
        if (typeof window.initializeFirestoreData === 'function') {
            await window.initializeFirestoreData();
        }
    } else {
        console.log('✅ Data already initialized');
        
        // Still update priority tasks to ensure they're current
        if (typeof window.updatePriorityTasks === 'function') {
            await window.updatePriorityTasks();
        }
    }
}

// Load global Pomodoro timer
function loadGlobalPomodoro() {
    if (!document.getElementById('pomodoroGlobalScript')) {
        const script = document.createElement('script');
        script.id = 'pomodoroGlobalScript';
        script.src = '/js/pomodoroGlobal.js';
        document.head.appendChild(script);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    loadGlobalPomodoro();
    // Wait for auth to be ready
    setTimeout(async () => {
        await ensureDataInitialized();
    }, 1000);
});

// Listen for storage changes
window.addEventListener('storage', async (e) => {
    if (e.key === 'academicSubjects' || e.key?.startsWith('tasks-')) {
        console.log('🔄 Storage changed, updating data...');
        await ensureDataInitialized();
    }
}); 