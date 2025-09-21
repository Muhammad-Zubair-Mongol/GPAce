const { parentPort } = require('worker_threads');

// Listen for messages from the main thread
parentPort.on('message', (input) => {
  const result = calculateAllTasksPriorities(input);
  parentPort.postMessage(result);
});

/**
 * Calculate priority scores for all tasks across all subjects
 * @param {Object} input - Contains subjects and tasks data
 * @returns {Array} - Sorted array of tasks with priority scores
 */
function calculateAllTasksPriorities(input) {
  const { subjects, tasks } = input;
  let allTasksWithScores = [];

  subjects.forEach(subject => {
    // Get tasks for this subject
    const subjectTasks = tasks[subject.tag] || [];

    // Calculate subject-level scores
    const creditHoursPoints = subject.relativeScore;
    const cognitiveDifficultyPoints = subject.cognitiveDifficulty;

    // Calculate scores for all tasks
    subjectTasks.forEach(task => {
      const score = calculateTaskScore(
        task, 
        creditHoursPoints, 
        cognitiveDifficultyPoints, 
        subject.tag,
        input.academicPerformance[subject.tag] || 0,
        input.taskWeightages
      );
      
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

  return allTasksWithScores;
}

/**
 * Calculate Task Score Based on Multiple Factors
 * @param {Object} task - Task object
 * @param {number} creditHoursPoints - Points based on credit hours
 * @param {number} cognitiveDifficultyPoints - Points based on cognitive difficulty
 * @param {string} projectId - Project/subject ID
 * @param {number} academicPerformanceAdjustment - Academic performance adjustment
 * @param {Object} taskWeightages - Task weightages data
 * @returns {number} - Final task score
 */
function calculateTaskScore(
  task, 
  creditHoursPoints, 
  cognitiveDifficultyPoints, 
  projectId,
  academicPerformanceAdjustment,
  taskWeightages
) {
  // Calculate time remaining points
  const timeRemainingPoints = calculateTimeRemainingPoints(task.dueDate);

  // Get task weightage points
  const taskWeightagePoints = calculateTaskWeightage(projectId, task.section, taskWeightages);

  // Calculate base score
  const baseScore = creditHoursPoints + cognitiveDifficultyPoints + taskWeightagePoints + timeRemainingPoints;

  // Apply academic performance adjustment as a percentage reduction
  const finalScore = baseScore * (1 - academicPerformanceAdjustment/100);

  return finalScore;
}

/**
 * Calculate task weightage based on section and project
 * @param {string} projectId - Project/subject ID
 * @param {string} taskSection - Task section
 * @param {Object} taskWeightages - Task weightages data
 * @returns {number} - Weightage points
 */
function calculateTaskWeightage(projectId, taskSection, taskWeightages) {
  // Get subject weightages
  const subjectWeightages = taskWeightages.subjectWeightages || {};
  
  // Also get project weightages as a fallback
  const projectWeightages = taskWeightages.projectWeightages || {};

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

/**
 * Function to calculate time remaining and convert to priority points
 * @param {string} dueDate - Task due date
 * @returns {number} - Time remaining points
 */
function calculateTimeRemainingPoints(dueDate) {
  // Validate input
  if (!dueDate) {
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
      return 0;
    }
  } catch (error) {
    return 0;
  }

  // Reset times to start of day for consistent comparison
  currentTime.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);

  // Calculate time difference in milliseconds
  const timeDiff = deadline.getTime() - currentTime.getTime();

  // If deadline has not passed, calculate normal remaining time
  if (timeDiff > 0) {
    const totalHours = timeDiff / (1000 * 60 * 60);
    const days = Math.floor(totalHours / 24);
    const hours = Math.floor(totalHours % 24);

    const points = (1 / (days + hours/24)) * 10;
    return points;
  }

  // For overdue tasks: exponential priority increase
  // Convert time difference to days
  const overduedays = Math.abs(Math.floor(timeDiff / (1000 * 60 * 60 * 24)));

  // Prevent potential infinity by adding a max cap
  const safeOverdueDays = Math.min(overduedays, 30);

  // Exponential priority calculation with capped value
  const timeRemainingPoints = 10 * (1 + Math.log(safeOverdueDays + 1));

  return timeRemainingPoints;
}
