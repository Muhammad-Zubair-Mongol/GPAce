// Priority Calculator JavaScript Functions

// Helper function to get subjects from storage (handles namespace migration)
// StorageManager uses gpace_ prefix, but some code uses legacy unprefixed key
function getSubjectsFromStorage() {
    // Try namespaced key first (used by StorageManager)
    let subjects = JSON.parse(localStorage.getItem('gpace_academicSubjects') || 'null');

    if (!subjects || subjects.length === 0) {
        // Fallback to legacy non-namespaced key
        subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');
    }

    return subjects;
}

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
    const subjects = getSubjectsFromStorage();

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
    const subjects = getSubjectsFromStorage();

    // Find the specific subject by its tag/projectId
    const subject = subjects.find(s => s.tag === projectId);

    // If no subject found, return 0
    if (!subject) return 0;

    // Return the relative score (already calculated as a percentage 0-100)
    // Ensure it's a number and within valid range
    return Number(subject.relativeScore) || 0;
}

// Calculate Cognitive Difficulty Points for a Project
function calculateCognitiveDifficulty(projectId) {
    // Retrieve academic subjects from localStorage
    const subjects = getSubjectsFromStorage();

    // Find the specific subject by its tag/projectId
    const subject = subjects.find(s => s.tag === projectId);

    // If no subject found, return 0
    if (!subject) return 0;

    // Return the cognitive difficulty (already on a scale of 1-100)
    // Ensure it's a number and within valid range
    return Number(subject.cognitiveDifficulty) || 0;
}

const DEFAULT_CATEGORY_WEIGHTAGES = Object.freeze({
    assignment: 15,
    quiz: 10,
    midterm: 30,
    final: 40,
    revision: 5
});

const SECTION_TO_CATEGORY = Object.freeze({
    assignment: 'assignment',
    assignments: 'assignment',
    quizzes: 'quiz',
    quiz: 'quiz',
    'mid term / oht': 'midterm',
    midterm: 'midterm',
    finals: 'final',
    final: 'final',
    revision: 'revision'
});

/**
 * Convert an input into a finite number. Priority scores must never contain
 * NaN or Infinity because those values make ordering and persistence unstable.
 */
function toFiniteNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeSection(section) {
    return typeof section === 'string' ? section.trim().toLowerCase() : '';
}

/**
 * Pure weightage lookup used by both the browser calculator and the Node
 * worker. `projectWeightages` may contain the legacy `{avg}` shape.
 */
function calculateTaskWeightageFromData(projectId, taskSection, subjectWeightages = {}, projectWeightages = {}) {
    const normalizedSection = normalizeSection(taskSection);
    const category = SECTION_TO_CATEGORY[normalizedSection] || normalizedSection;
    const subjectWeightage = subjectWeightages?.[projectId];

    if (subjectWeightage && typeof subjectWeightage === 'object') {
        const direct = toFiniteNumber(subjectWeightage[category], NaN);
        if (Number.isFinite(direct)) return Math.max(0, direct);
    }

    const projectWeightage = projectWeightages?.[projectId];
    if (projectWeightage && typeof projectWeightage === 'object') {
        const matchingSection = Object.keys(projectWeightage)
            .find(section => normalizeSection(section) === normalizedSection);
        const value = matchingSection ? projectWeightage[matchingSection] : undefined;
        const projectValue = value && typeof value === 'object' ? value.avg : value;
        const finiteProjectValue = toFiniteNumber(projectValue, NaN);
        if (Number.isFinite(finiteProjectValue)) return Math.max(0, finiteProjectValue);
    }

    return Math.max(0, toFiniteNumber(DEFAULT_CATEGORY_WEIGHTAGES[category], 0));
}

function calculateTaskWeightage(projectId, taskSection) {
    let subjectWeightages = {};
    let projectWeightages = {};
    try {
        subjectWeightages = JSON.parse(localStorage.getItem('subjectWeightages') || '{}');
        projectWeightages = JSON.parse(localStorage.getItem('projectWeightages') || '{}');
    } catch (error) {
        console.warn('[Priority] Unable to read weightages; using defaults.', error);
    }

    return calculateTaskWeightageFromData(projectId, taskSection, subjectWeightages, projectWeightages);
}















// Get Active Tasks for a Specific Project
// Phase 2: Uses TaskRepository as primary source
function getActiveTasks(projectId) {
    // Phase 2: Use TaskRepository if available
    if (window.TaskRepository) {
        const tasks = window.TaskRepository.getAllTasks(projectId);
        console.log(`[getActiveTasks] ProjectID: ${projectId} - via TaskRepository`, {
            activeTasks: tasks.length
        });
        return tasks;
    }

    // Fallback: Try namespaced key first (new format used by StorageService)
    let subjectTasks = JSON.parse(localStorage.getItem(`gpace_tasks-${projectId}`) || 'null');

    // If null or empty, try legacy non-namespaced key
    if (!subjectTasks || subjectTasks.length === 0) {
        subjectTasks = JSON.parse(localStorage.getItem(`tasks-${projectId}`) || '[]');

        // If found in legacy location, migrate to namespaced key for consistency
        if (subjectTasks.length > 0) {
            console.log(`[getActiveTasks] Migrating ${subjectTasks.length} tasks from legacy key to namespaced key for ${projectId}`);
            localStorage.setItem(`gpace_tasks-${projectId}`, JSON.stringify(subjectTasks));
        }
    }

    // Filter out completed tasks - only return active (non-completed) tasks
    const activeTasks = subjectTasks.filter(task => !task.completed && !task.deleted);

    // Log task retrieval for debugging
    console.log(`[getActiveTasks] ProjectID: ${projectId}`, {
        totalTasks: subjectTasks.length,
        activeTasks: activeTasks.length,
        completedFiltered: subjectTasks.length - activeTasks.length
    });

    // Return only active (non-completed) tasks
    return activeTasks;
}

// Delete a Specific Task from a Project
function deleteTask(projectId, taskId) {
    // Phase 2: Use TaskRepository if available
    if (window.TaskRepository) {
        window.TaskRepository.deleteTask(projectId, taskId);
        console.log(`[deleteTask] Deleted via TaskRepository: ${taskId}`);
    } else {
        // Fallback: Get tasks for this project
        const tasks = JSON.parse(localStorage.getItem(`tasks-${projectId}`) || '[]');

        // Remove the task
        const updatedTasks = tasks.filter(task => String(task.id) !== String(taskId));

        // Save back to storage
        localStorage.setItem(`tasks-${projectId}`, JSON.stringify(updatedTasks));
    }

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

/**
 * Parse a date-only value as a calendar date. A bare YYYY-MM-DD is never
 * passed through `new Date(string)`, because that grammar is interpreted as
 * UTC and changes the local calendar day in negative offsets.
 */
function parseDateOnly(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(year, month - 1, day);
    if (
        candidate.getFullYear() !== year ||
        candidate.getMonth() !== month - 1 ||
        candidate.getDate() !== day
    ) return null;

    return { year, month, day };
}

function asDate(value) {
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
    }
    if (typeof value === 'number' || typeof value === 'string') {
        const result = new Date(value);
        return Number.isFinite(result.getTime()) ? result : null;
    }
    return null;
}

function calendarParts(value, timeZone) {
    const date = asDate(value);
    if (!date) return null;

    if (!timeZone) {
        return {
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            day: date.getDate()
        };
    }

    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date);
        const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
        const result = {
            year: Number(byType.year),
            month: Number(byType.month),
            day: Number(byType.day)
        };
        return Object.values(result).every(Number.isFinite) ? result : null;
    } catch {
        return null;
    }
}

function calendarDayNumber(parts) {
    if (!parts) return NaN;
    return Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000;
}

function normalizePriorityOptions(options) {
    if (options instanceof Date || typeof options === 'number' || typeof options === 'string') {
        return { now: options };
    }
    return options && typeof options === 'object' ? options : {};
}

/**
 * Calculate time priority by calendar day.
 *
 * Policy: date-only values are local calendar dates in the selected
 * `timeZone` (or the runtime local zone when omitted). All values are reduced
 * to calendar days before comparison, so DST transitions cannot create a
 * fractional day. Tasks due today receive the documented finite maximum of
 * 100. Overdue priority is capped at 30 calendar days.
 *
 * @param {string|Date|number} dueDate
 * @param {{now?: string|Date|number, timeZone?: string}} options
 */
function calculateTimeRemainingPoints(dueDate, options = {}) {
    if (dueDate === null || dueDate === undefined || dueDate === '') return 0;

    const config = normalizePriorityOptions(options);
    const nowValue = config.now === undefined ? new Date() : config.now;
    const timeZone = typeof config.timeZone === 'string' && config.timeZone ? config.timeZone : undefined;

    const dueDateOnly = parseDateOnly(dueDate);
    const dueParts = dueDateOnly || calendarParts(dueDate, timeZone);
    const nowParts = calendarParts(nowValue, timeZone);
    const dueDay = calendarDayNumber(dueParts);
    const today = calendarDayNumber(nowParts);

    if (!Number.isFinite(dueDay) || !Number.isFinite(today)) return 0;

    const dayDelta = dueDay - today;
    if (dayDelta === 0) return 100;
    if (dayDelta > 0) return Math.max(0, 10 / dayDelta);

    const overdueDays = Math.min(Math.abs(dayDelta), 30);
    const score = 10 * (1 + Math.log(overdueDays + 1));
    return Number.isFinite(score) ? score : 0;
}

/**
 * Calculate one task score using finite numeric inputs and an optional pure
 * context. The four-argument browser call remains supported.
 */
function calculateTaskScore(task = {}, creditHoursPoints, cognitiveDifficultyPoints, projectId, options = {}) {
    const config = typeof options === 'number'
        ? { academicPerformance: options }
        : normalizePriorityOptions(options);
    const pureContext = Boolean(
        config.taskWeightages ||
        Object.prototype.hasOwnProperty.call(config, 'academicPerformance') ||
        Object.prototype.hasOwnProperty.call(config, 'now') ||
        Object.prototype.hasOwnProperty.call(config, 'timeZone')
    );
    const rawAPA = config.academicPerformance === undefined
        ? (pureContext ? 0 : getAcademicPerformance(projectId))
        : config.academicPerformance;
    const academicPerformanceAdjustment = Math.max(0, Math.min(100, toFiniteNumber(rawAPA, 0)));
    const timeRemainingPoints = calculateTimeRemainingPoints(task?.dueDate, config);
    const taskWeightagePoints = config.taskWeightages
        ? calculateTaskWeightageFromData(
            projectId,
            task?.section,
            config.taskWeightages.subjectWeightages || {},
            config.taskWeightages.projectWeightages || {}
        )
        : calculateTaskWeightage(projectId, task?.section);

    const baseScore =
        toFiniteNumber(creditHoursPoints, 0) +
        toFiniteNumber(cognitiveDifficultyPoints, 0) +
        toFiniteNumber(taskWeightagePoints, 0) +
        toFiniteNumber(timeRemainingPoints, 0);
    const finalScore = baseScore * (1 - academicPerformanceAdjustment / 100);
    return Number.isFinite(finalScore) ? Math.max(0, finalScore) : 0;
}

/**
 * Pure collection scorer shared with the Node worker. Stable ordering uses
 * score, project id, task id, then source order as deterministic tie-breakers.
 */
function calculateTaskPrioritiesPure(input = {}) {
    const subjects = Array.isArray(input.subjects) ? input.subjects : [];
    const tasksBySubject = input.tasks && typeof input.tasks === 'object' ? input.tasks : {};
    const academicPerformance = input.academicPerformance && typeof input.academicPerformance === 'object'
        ? input.academicPerformance
        : {};
    const taskWeightages = input.taskWeightages || null;
    const options = {
        now: input.now,
        timeZone: input.timeZone,
        taskWeightages,
        academicPerformance: undefined
    };
    const scored = [];
    let sourceOrder = 0;

    for (const subject of subjects) {
        if (!subject || typeof subject !== 'object') continue;
        const subjectTasks = Array.isArray(tasksBySubject[subject.tag]) ? tasksBySubject[subject.tag] : [];
        for (const task of subjectTasks) {
            const score = calculateTaskScore(
                task,
                subject.relativeScore,
                subject.cognitiveDifficulty,
                subject.tag,
                {
                    ...options,
                    academicPerformance: toFiniteNumber(academicPerformance[subject.tag], 0)
                }
            );
            scored.push({
                ...task,
                priorityScore: score,
                projectName: subject.name,
                projectId: subject.tag,
                __sourceOrder: sourceOrder++
            });
        }
    }

    scored.sort((a, b) => {
        const scoreDelta = toFiniteNumber(b.priorityScore, 0) - toFiniteNumber(a.priorityScore, 0);
        if (scoreDelta !== 0) return scoreDelta;
        const projectDelta = String(a.projectId ?? '').localeCompare(String(b.projectId ?? ''));
        if (projectDelta !== 0) return projectDelta;
        const taskDelta = String(a.id ?? '').localeCompare(String(b.id ?? ''));
        return taskDelta || a.__sourceOrder - b.__sourceOrder;
    });

    return scored.map(({ __sourceOrder, ...task }) => task);
}

// Calculate priority scores for all tasks across all subjects
function calculateAllTasksPriorities(options = {}) {
    const subjects = getSubjectsFromStorage();
    const tasks = {};
    subjects.forEach(subject => {
        tasks[subject.tag] = getActiveTasks(subject.tag);
    });

    const allTasksWithScores = calculateTaskPrioritiesPure({
        subjects,
        tasks,
        subjectMarks: {},
        academicPerformance: Object.fromEntries(
            subjects.map(subject => [subject.tag, getAcademicPerformance(subject.tag)])
        ),
        taskWeightages: {
            subjectWeightages: JSON.parse(localStorage.getItem('subjectWeightages') || '{}'),
            projectWeightages: JSON.parse(localStorage.getItem('projectWeightages') || '{}')
        },
        now: options.now,
        timeZone: options.timeZone
    });




    // Phase 2: Store via TaskRepository (handles broadcast internally)
    if (window.TaskRepository) {
        window.TaskRepository.savePriorityCache(allTasksWithScores);
    } else {
        localStorage.setItem('calculatedPriorityTasks', JSON.stringify(allTasksWithScores));
    }

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
        // Use centralized helper from firestore.js
        if (window.savePriorityTasksToFirestore) {
            await window.savePriorityTasksToFirestore(tasks);
        } else {
            // Dynamic import as fallback or main method if window var not set yet
            const { savePriorityTasksToFirestore } = await import('./js/firestore.js');
            await savePriorityTasksToFirestore(tasks);
        }
    } catch (error) {
        console.error('Error saving priority tasks to Firestore:', error);
    }
}

// ensureWeightagesSynced is defined above at line 36 - no duplicate needed here


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

        // Calculate all task scores once
        const allTasksWithScores = calculateAllTasksPriorities();
        const subjects = getSubjectsFromStorage();

        // Group tasks by projectId for efficient lookup
        const tasksByProject = {};
        allTasksWithScores.forEach(task => {
            if (!tasksByProject[task.projectId]) {
                tasksByProject[task.projectId] = [];
            }
            tasksByProject[task.projectId].push(task);
        });

        // Render each subject with its pre-calculated tasks
        subjects.forEach(subject => {
            // Get pre-calculated tasks for this subject (already have scores)
            const tasks = tasksByProject[subject.tag] || [];

            // Skip subjects with no tasks
            if (tasks.length === 0) {
                return;
            }

            const projectCard = document.createElement('div');
            projectCard.className = 'priority-card';

            // Get subject-level scores for display
            const creditHoursPoints = subject.relativeScore;
            const cognitiveDifficultyPoints = subject.cognitiveDifficulty;
            const academicPerformancePoints = getAcademicPerformance(subject.tag);

            // Tasks are already sorted by priority from calculateAllTasksPriorities
            // But we need to sort within this subject for display
            tasks.sort((a, b) => b.priorityScore - a.priorityScore);

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
                            const maxScoreA = Math.max(...a[1].map(t => t.priorityScore));
                            const maxScoreB = Math.max(...b[1].map(t => t.priorityScore));
                            return maxScoreB - maxScoreA;
                        })
                        .map(([section, sectionTasks]) => `
                                <div class="section-tasks mb-4">
                                    <h4 class="section-header">
                                        ${section}
                                        <small class="text-muted">(${sectionTasks.length} task${sectionTasks.length !== 1 ? 's' : ''})</small>
                                    </h4>
                                    ${sectionTasks.map(task => {
                            // Use pre-calculated values from task object
                            const totalPoints = task.priorityScore;

                            // Re-calculate component scores ONLY for display breakdown
                            // (These are cheap calculations, not the full flow)
                            const taskWeightagePoints = calculateTaskWeightage(subject.tag, task.section);
                            const timeRemainingPoints = calculateTimeRemainingPoints(task.dueDate);

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
    window.addEventListener('storage', function (e) {
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
        button.addEventListener('click', function () {
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

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    // Initialize everything when the document is ready
    document.addEventListener('DOMContentLoaded', () => {
        initializeTheme();
        setupToggleStats();
        setupUpdateListeners();
        setInterval(checkForUpdates, 600000);
        updatePriorityScores();

        // Poll for data availability if initial load found nothing.
        let pollCount = 0;
        const maxPolls = 30;
        const pollInterval = setInterval(() => {
            pollCount++;
            const subjects = getSubjectsFromStorage();

            if (subjects.length > 0) {
                console.log('[PriorityCalculator] Data now available (' + subjects.length + ' subjects), refreshing...');
                updatePriorityScores();
                clearInterval(pollInterval);
            } else if (pollCount >= maxPolls) {
                console.log('[PriorityCalculator] Timeout waiting for data');
                clearInterval(pollInterval);
            }
        }, 1000);
    });

    // Also listen for storage events in case data is loaded from another tab.
    window.addEventListener('storage', (event) => {
        if (event.key === 'academicSubjects' || (event.key && event.key.startsWith('tasks-'))) {
            console.log('[PriorityCalculator] Storage changed (' + event.key + '), refreshing...');
            setTimeout(() => updatePriorityScores(), 500);
        }
    });

    // Listen for dataInitialized event from DataInitializationService.
    window.addEventListener('dataInitialized', (event) => {
        console.log('[PriorityCalculator] DataInitService complete, refreshing...', event.detail);
        setTimeout(() => updatePriorityScores(), 500);
    });
}

const priorityCalculatorApi = {
    calculateTimeRemainingPoints,
    calculateTaskScore,
    calculateTaskWeightageFromData,
    calculateTaskPrioritiesPure,
    toFiniteNumber,
    PRIORITY_POLICY: Object.freeze({
        dateOnly: 'calendar-day in the selected time zone (runtime local zone by default)',
        dueTodayScore: 100,
        overdueDayCap: 30,
        overdueFormula: '10 * (1 + log(overdueDays + 1))'
    })
};

if (typeof window !== 'undefined') {
    window.PriorityCalculator = priorityCalculatorApi;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = priorityCalculatorApi;
}
