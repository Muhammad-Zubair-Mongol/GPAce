// Priority Calculator JavaScript Functions

// Theme Toggle Function
function toggleTheme() {
    const body = document.body;
    const themeIcon = document.querySelector('.theme-icon');
    const themeText = document.querySelector('.theme-text');

    body.classList.toggle('light-theme');

    if (body.classList.contains('light-theme')) {
        themeIcon.textContent = '🌚';
        themeText.textContent = 'Dark Mode';
        localStorage.setItem('theme', 'light');
    } else {
        themeIcon.textContent = '🌞';
        themeText.textContent = 'Light Mode';
        localStorage.setItem('theme', 'dark');
    }
}

// Initialize theme on page load
function initializeTheme() {
    const themeIcon = document.querySelector('.theme-icon');
    const themeText = document.querySelector('.theme-text');

    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-theme');
        themeIcon.textContent = '🌚';
        themeText.textContent = 'Dark Mode';
    }
}



function ensureWeightagesSynced() {
    // Get all subjects
    const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');

    // Get both weightage storages
    const subjectWeightages = JSON.parse(localStorage.getItem('subjectWeightages') || '{}');
    const projectWeightages = JSON.parse(localStorage.getItem('projectWeightages') || '{}');

    let updated = false;

    // Check each subject
    subjects.forEach(subject => {
        const projectId = subject.tag;

        // If subject exists in project weightages but not in subject weightages
        if (projectWeightages[projectId] && !subjectWeightages[projectId]) {
            if (typeof window.syncProjectToSubjectWeightages === 'function') {
                window.syncProjectToSubjectWeightages(projectId, projectWeightages[projectId]);
                updated = true;
            }
        }
    });

    return updated;
}





// Toggle Subject Statistics Visibility
function toggleStats(subjectId) {
    // Find the stats container for the specific subject
    const stats = document.getElementById(`stats-${subjectId}`);

    // Find the toggle button for the specific subject
    const button = document.getElementById(`toggle-${subjectId}`);

    // Check if elements exist to prevent potential errors
    if (!stats || !button) {
        console.error(`Elements not found for subject: ${subjectId}`);
        return;
    }

    // Toggle visibility using 'show' class
    if (stats.classList.contains('show')) {
        stats.classList.remove('show');
        // Change button icon to down chevron
        button.innerHTML = '<i class="bi bi-chevron-down"></i>';
    } else {
        stats.classList.add('show');
        // Change button icon to up chevron
        button.innerHTML = '<i class="bi bi-chevron-up"></i>';
    }
}

// Calculate Credit Hours Points for a Project
function calculateCreditHoursPoints(projectId) {
    // Retrieve academic subjects from localStorage
    const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');

    // Find the specific subject by its tag/projectId
    const subject = subjects.find(s => s.tag === projectId);

    // If no subject found, return 0
    if (!subject) return 0;

    // Return the relative score (already calculated as a percentage 0-100)
    return subject.relativeScore;
}

// Calculate Cognitive Difficulty Points for a Project
function calculateCognitiveDifficulty(projectId) {
    // Retrieve academic subjects from localStorage
    const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');

    // Find the specific subject by its tag/projectId
    const subject = subjects.find(s => s.tag === projectId);

    // If no subject found, return 0
    if (!subject) return 0;

    // Return the cognitive difficulty (already on a scale of 1-100)
    return subject.cognitiveDifficulty;
}

function calculateTaskWeightage(projectId, taskSection) {
    // Get subject weightages directly
    const subjectWeightages = JSON.parse(localStorage.getItem('subjectWeightages') || '{}');

    // Also get project weightages as a fallback
    const projectWeightages = JSON.parse(localStorage.getItem('projectWeightages') || '{}');

    // Get weightages for specific subject
    let subjectWeightage = subjectWeightages[projectId] || {};

    // Map section names to category names (case insensitive)
    const sectionToCategory = {
        'assignment': 'assignment',
        'assignments': 'assignment',
        'quizzes': 'quiz',
        'quiz': 'quiz',
        'mid term / oht': 'midterm',
        'midterm': 'midterm',
        'finals': 'final',
        'final': 'final',
        'revision': 'revision'
    };

    // Default weightages to use if nothing else is found
    const defaultCategoryWeightages = {
        assignment: 15,
        quiz: 10,
        midterm: 30,
        final: 40,
        revision: 5
    };

    // Normalize section name to lowercase for case-insensitive matching
    const normalizedSection = taskSection.toLowerCase();

    // Get the category name for this section
    const category = sectionToCategory[normalizedSection] || normalizedSection;

    // If subject weightage doesn't exist, try to get from project weightages
    if (Object.keys(subjectWeightage).length === 0 && projectWeightages[projectId]) {
        // Try to map from project weightages
        const projectSection = Object.keys(projectWeightages[projectId])
            .find(section => section.toLowerCase() === normalizedSection);

        if (projectSection && projectWeightages[projectId][projectSection]) {
            return projectWeightages[projectId][projectSection].avg || defaultCategoryWeightages[category] || 0;
        }
    }

    // Return exact weightage from subject marks or default if not found
    return subjectWeightage[category] || defaultCategoryWeightages[category] || 0;
}















// Get Active Tasks for a Specific Project
function getActiveTasks(projectId) {
    // Retrieve tasks directly from project's task storage
    const subjectTasks = JSON.parse(localStorage.getItem(`tasks-${projectId}`) || '[]');

    // Log task retrieval for debugging
    console.log(`[getActiveTasks] ProjectID: ${projectId}`, {
        tasksFound: subjectTasks.length,
        tasks: subjectTasks
    });

    // Return all tasks (no filtering)
    return subjectTasks;
}

// Delete a Specific Task from a Project
function deleteTask(projectId, taskId) {
    // Get tasks for this project
    const tasks = JSON.parse(localStorage.getItem(`tasks-${projectId}`) || '[]');

    // Remove the task
    const updatedTasks = tasks.filter(task => task.id !== taskId);

    // Save back to storage
    localStorage.setItem(`tasks-${projectId}`, JSON.stringify(updatedTasks));

    // Update the display
    updatePriorityScores();
}

// Get Academic Performance for a Specific Project
function getAcademicPerformance(projectId) {
    // Get subject marks from localStorage
    const subjectMarks = JSON.parse(localStorage.getItem('subjectMarks') || '{}');

    // Get the subject's marks
    const subjectData = subjectMarks[projectId];

    if (!subjectData) return 0;

    // Get the performance value that was calculated and shown in the progress bar
    // This is stored when updateSubjectPerformance is called in subject-marks.html
    const performance = subjectData._performance || 0;

    // Return the performance value directly
    return performance;
}

// Function to calculate time remaining and convert to priority points
function calculateTimeRemainingPoints(dueDate) {
    // Validate input
    if (!dueDate) {
        console.error('No due date provided');
        return 0; // Lowest possible priority boost
    }

    // Get current time
    const currentTime = new Date();

    // Parse the due date, handling different formats
    let deadline;
    try {
        // Try parsing as ISO string first
        deadline = new Date(dueDate);

        // If invalid, try converting from input date format (YYYY-MM-DD)
        if (isNaN(deadline.getTime())) {
            const [year, month, day] = dueDate.split('-').map(Number);
            deadline = new Date(year, month - 1, day); // month is 0-based in Date constructor
        }

        // If still invalid, return 0
        if (isNaN(deadline.getTime())) {
            console.error('Invalid date format:', dueDate);
            return 0;
        }
    } catch (error) {
        console.error('Error parsing due date:', error);
        return 0;
    }

    // Reset times to start of day for consistent comparison
    currentTime.setHours(0, 0, 0, 0);
    deadline.setHours(0, 0, 0, 0);

    // Calculate time difference in milliseconds
    const timeDiff = deadline.getTime() - currentTime.getTime();

    // Extensive logging for debugging
    console.group('Time Remaining Calculation');
    console.log('Due Date Input:', dueDate);
    console.log('Parsed Deadline:', deadline);
    console.log('Current Time:', currentTime);
    console.log('Time Difference (ms):', timeDiff);

    // If deadline has not passed, calculate normal remaining time
    if (timeDiff > 0) {
        const totalHours = timeDiff / (1000 * 60 * 60);
        const days = Math.floor(totalHours / 24);
        const hours = Math.floor(totalHours % 24);

        console.log('Future Task - Remaining Time:', { days, hours });
        const points = (1 / (days + hours/24)) * 10;
        console.log('Calculated Points:', points);
        console.groupEnd();
        return points;
    }

    // For overdue tasks: exponential priority increase
    // Convert time difference to days
    const overduedays = Math.abs(Math.floor(timeDiff / (1000 * 60 * 60 * 24)));
    console.log('Overdue Days:', overduedays);

    // Prevent potential infinity by adding a max cap
    const safeOverdueDays = Math.min(overduedays, 30);

    // Exponential priority calculation with capped value
    const timeRemainingPoints = 10 * (1 + Math.log(safeOverdueDays + 1));

    console.log(`Overdue Time Remaining Points: ${timeRemainingPoints.toFixed(2)}`);
    console.groupEnd();

    return timeRemainingPoints;
}

// Calculate Task Score Based on Multiple Factors
function calculateTaskScore(task, creditHoursPoints, cognitiveDifficultyPoints, projectId) {
    // Get academic performance adjustment (APA)
    const academicPerformanceAdjustment = getAcademicPerformance(projectId);

    // Calculate time remaining points
    const timeRemainingPoints = calculateTimeRemainingPoints(task.dueDate);

    // Get task weightage points
    const taskWeightagePoints = calculateTaskWeightage(projectId, task.section);

    // Calculate base score
    const baseScore = creditHoursPoints + cognitiveDifficultyPoints + taskWeightagePoints + timeRemainingPoints;

    // Apply academic performance adjustment as a percentage reduction
    const finalScore = baseScore * (1 - academicPerformanceAdjustment/100);

    // Log detailed scoring breakdown
    console.log('Task Score Breakdown:', {
        creditHoursPoints,
        cognitiveDifficultyPoints,
        taskWeightagePoints,
        timeRemainingPoints,
        academicPerformanceAdjustment,
        baseScore,
        finalScore
    });

    return finalScore;
}

// Calculate priority scores for all tasks across all subjects
function calculateAllTasksPriorities() {
    // Get all subjects and sort them by total priority potential
    const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');
    let allTasksWithScores = [];

    subjects.forEach(subject => {
        let tasks = getActiveTasks(subject.tag);

        // Calculate subject-level scores
        const creditHoursPoints = subject.relativeScore;
        const cognitiveDifficultyPoints = subject.cognitiveDifficulty;

        // Calculate scores for all tasks
        tasks.forEach(task => {
            const score = calculateTaskScore(task, creditHoursPoints, cognitiveDifficultyPoints, subject.tag);
            allTasksWithScores.push({
                ...task,
                priorityScore: score,
                projectName: subject.name,
                projectId: subject.tag
            });
        });
    });

    // Sort all tasks by priority score
    allTasksWithScores.sort((a, b) => b.priorityScore - a.priorityScore);




    // Store in localStorage for the priority list page
    localStorage.setItem('calculatedPriorityTasks', JSON.stringify(allTasksWithScores));

    if (window.crossTabSync) {
        window.crossTabSync.broadcastAction('priority-update', {
            timestamp: Date.now(),
            taskCount: allTasksWithScores.length
        });
    }

    // NEW CODE: Save to Firestore if possible
    saveCalculatedTasksToFirestore(allTasksWithScores);


    return allTasksWithScores;
}


async function saveCalculatedTasksToFirestore(tasks) {
    try {
        // Check if auth is available
        if (!window.auth) {
            console.warn('Auth not available, skipping Firestore save');
            return;
        }

        const user = window.auth.currentUser;
        if (!user) {
            console.warn('No user logged in, skipping Firestore save');
            return;
        }

        // Use dynamic import to get Firestore functionality
        const { getFirestore, doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const db = getFirestore();

        // Save to Firestore with version tracking
        await setDoc(doc(db, 'users', user.uid, 'settings', 'priorityTasks'), {
            tasks: tasks,
            version: Date.now(),
            updatedAt: new Date().toISOString()
        });

        console.log('📤 Saved calculated priority tasks to Firestore:', tasks.length);
    } catch (error) {
        console.error('Error saving priority tasks to Firestore:', error);
    }
}




function ensureWeightagesSynced() {
    // Get all subjects
    const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');

    // Get both weightage storages
    const subjectWeightages = JSON.parse(localStorage.getItem('subjectWeightages') || '{}');
    const projectWeightages = JSON.parse(localStorage.getItem('projectWeightages') || '{}');

    let updated = false;

    // Check each subject
    subjects.forEach(subject => {
        const projectId = subject.tag;

        // If subject exists in project weightages but not in subject weightages
        if (projectWeightages[projectId] && !subjectWeightages[projectId]) {
            if (typeof window.syncProjectToSubjectWeightages === 'function') {
                window.syncProjectToSubjectWeightages(projectId, projectWeightages[projectId]);
                updated = true;
            }
        }
    });

    return updated;
}

function updatePriorityScores() {
    // Ensure weightages are synchronized before calculating scores
    ensureWeightagesSynced();

    // Check if initialization is needed
    if (typeof window.initializeAllSubjectWeightages === 'function') {
        window.initializeAllSubjectWeightages().then(() => {
            // Now proceed with the actual update
            updatePriorityScoresInternal();
        }).catch(error => {
            console.error('Error initializing weightages:', error);
            // Continue anyway to show at least partial data
            updatePriorityScoresInternal();
        });
    } else {
        // If initializeAllSubjectWeightages is not available, proceed directly
        updatePriorityScoresInternal();
    }

    function updatePriorityScoresInternal() {
        const priorityList = document.getElementById('priorityList');
        if (priorityList) {
            priorityList.innerHTML = ''; // Clear existing content
        }

        const allTasksWithScores = calculateAllTasksPriorities();
        const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');

        // Continue with the existing display logic
        subjects.forEach(subject => {
            let tasks = getActiveTasks(subject.tag);
            const projectCard = document.createElement('div');
            projectCard.className = 'priority-card';

            // Calculate subject-level scores
            const creditHoursPoints = subject.relativeScore;
            const cognitiveDifficultyPoints = subject.cognitiveDifficulty;
            const academicPerformancePoints = getAcademicPerformance(subject.tag);

            // Calculate scores for all tasks
            tasks.forEach(task => {
                task.score = calculateTaskScore(task, creditHoursPoints, cognitiveDifficultyPoints, subject.tag);
            });

            // Sort all tasks by score (highest first)
            tasks.sort((a, b) => b.score - a.score);

            // Group sorted tasks by section
            const tasksBySection = {};
            tasks.forEach(task => {
                if (!tasksBySection[task.section]) {
                    tasksBySection[task.section] = [];
                }
                tasksBySection[task.section].push(task);
            });

            projectCard.innerHTML = `
                <div class="subject-header">
                    <div class="subject-title-row">
                        <h3>${subject.name}</h3>
                        <button class="toggle-stats" id="toggle-${subject.tag}">
                            <i class="bi bi-chevron-down"></i>
                        </button>
                    </div>
                    <div class="subject-stats" id="stats-${subject.tag}">
                        <div class="stat">
                            <span>Credit Hours:</span>
                            <span>${subject.creditHours}</span>
                        </div>
                        <div class="stat">
                            <span>Credit Hours Points:</span>
                            <span>${creditHoursPoints.toFixed(2)}</span>
                        </div>
                        <div class="stat">
                            <span>Cognitive Difficulty:</span>
                            <span>${cognitiveDifficultyPoints.toFixed(2)}</span>
                        </div>
                        <div class="stat">
                            <span>Academic Performance:</span>
                            <span>${academicPerformancePoints.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
                <div class="task-list">
                    ${tasks.length > 0 ?
                        // Sort sections by their highest priority task
                        Object.entries(tasksBySection)
                            .sort((a, b) => {
                                const maxScoreA = Math.max(...a[1].map(t => t.score));
                                const maxScoreB = Math.max(...b[1].map(t => t.score));
                                return maxScoreB - maxScoreA;
                            })
                            .map(([section, sectionTasks]) => `
                                <div class="section-tasks mb-4">
                                    <h4 class="section-header">
                                        ${section}
                                        <small class="text-muted">(${sectionTasks.length} task${sectionTasks.length !== 1 ? 's' : ''})</small>
                                    </h4>
                                    ${sectionTasks.map(task => {
                                        const taskWeightagePoints = calculateTaskWeightage(subject.tag, task.section);
                                        const timeRemainingPoints = calculateTimeRemainingPoints(task.dueDate);
                                        const totalPoints = task.score;

                                        // Calculate days overdue or remaining
                                        const currentTime = new Date();
                                        const deadline = new Date(task.dueDate);
                                        const timeDiff = currentTime.getTime() - deadline.getTime();
                                        const daysStatus = timeDiff <= 0
                                            ? `${Math.ceil(Math.abs(timeDiff) / (1000 * 60 * 60 * 24))} days remaining`
                                            : `${Math.ceil(Math.abs(timeDiff) / (1000 * 60 * 60 * 24))} days overdue`;

                                        return `
                                            <div class="task-item mb-3">
                                                <div class="d-flex justify-content-between align-items-center">
                                                    <div class="task-info">
                                                        <h5>${task.title}</h5>
                                                        <small class="text-muted">Due: ${new Date(task.dueDate).toLocaleDateString()} (${daysStatus})</small>
                                                    </div>
                                                    <div class="d-flex align-items-center">
                                                        <span class="priority-score me-3">${totalPoints.toFixed(2)}</span>
                                                        <button class="delete-btn" onclick="deleteTask('${subject.tag}', '${task.id}')" title="Delete Task">
                                                            <i class="bi bi-trash"></i>
                                                        </button>
                                                    </div>
                                                </div>
                                                <div class="score-breakdown">
                                                    <div class="component-score">
                                                        <span>Credit Hours Points:</span>
                                                        <span>${creditHoursPoints.toFixed(2)}</span>
                                                    </div>
                                                    <div class="component-score">
                                                        <span>Cognitive Difficulty Points:</span>
                                                        <span>${cognitiveDifficultyPoints.toFixed(2)}</span>
                                                    </div>
                                                    <div class="component-score">
                                                        <span>Task Weightage Points:</span>
                                                        <span>${taskWeightagePoints.toFixed(2)}</span>
                                                    </div>
                                                    <div class="component-score">
                                                        <span>Time Remaining Points:</span>
                                                        <span>${timeRemainingPoints.toFixed(2)}</span>
                                                    </div>
                                                    <div class="component-score">
                                                        <span>Academic Performance Adjustment:</span>
                                                        <span>-${academicPerformancePoints.toFixed(2)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            `).join('')
                        : `
                            <div class="no-tasks-message">
                                <i class="bi bi-clipboard-check"></i>
                                <p>No active tasks for this subject</p>
                            </div>
                        `}
                </div>
            `;
            if (priorityList) {
                priorityList.appendChild(projectCard);
            }
        });
    }
}




/**
 * Function to check for task updates
 * Previously in inline script in priority-calculator.html
 */
function checkForUpdates() {
    console.log('[checkForUpdates] Checking for new tasks...');
    updatePriorityScores();
}

/**
 * Set up event listeners for storage events to update priority scores
 * Previously in inline script in priority-calculator.html
 */
function setupUpdateListeners() {
    // Update scores when tasks change
    window.addEventListener('storage', function(e) {
        console.log('[Storage Event]', {
            key: e.key,
            newValue: e.newValue,
            oldValue: e.oldValue
        });
        if (e.key === 'tasks' || e.key?.startsWith('tasks-') || e.key === 'academicSubjects' || e.key === 'projectWeightages') {
            console.log('[Storage Event] Triggering updatePriorityScores');
            updatePriorityScores();
        }
    });
}

/**
 * Set up toggle functionality for subject statistics
 * Previously in inline script in priority-calculator.html
 */
function setupToggleStats() {
    const toggleStatsButtons = document.querySelectorAll('.toggle-stats');
    toggleStatsButtons.forEach(button => {
        button.addEventListener('click', function() {
            const subjectId = button.id.replace('toggle-', '');
            const stats = document.getElementById(`stats-${subjectId}`);
            if (stats.classList.contains('show')) {
                stats.classList.remove('show');
                button.innerHTML = '<i class="bi bi-chevron-down"></i>';
            } else {
                stats.classList.add('show');
                button.innerHTML = '<i class="bi bi-chevron-up"></i>';
            }
        });
    });
}

// Initialize everything when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize theme
    initializeTheme();

    // Set up toggle stats functionality
    setupToggleStats();

    // Set up update listeners
    setupUpdateListeners();

    // Start periodic updates
    setInterval(checkForUpdates, 600000); // Check every 10 minutes

    // Initial load
    updatePriorityScores();
});


