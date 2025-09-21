/**
 * Priority Worker Wrapper
 * 
 * This module provides a wrapper around the Node.js worker thread
 * that handles priority calculations. It offloads CPU-intensive
 * task priority calculations to a separate thread.
 */

const { Worker } = require('worker_threads');
const path = require('path');

/**
 * Run the priority calculation in a worker thread
 * @param {Object} input - Data needed for priority calculation
 * @returns {Promise} - Promise that resolves with the calculated priority tasks
 */
function runPriorityWorker(input) {
  return new Promise((resolve, reject) => {
    // Create a new worker instance
    const worker = new Worker(path.resolve(__dirname, '../worker.js'));
    
    // Send input data to the worker
    worker.postMessage(input);
    
    // Handle the result from the worker
    worker.on('message', resolve);
    
    // Handle any errors
    worker.on('error', reject);
    
    // Handle worker exit
    worker.on('exit', code => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

/**
 * Calculate priority scores for all tasks using the worker thread
 * @returns {Promise} - Promise that resolves with the calculated priority tasks
 */
async function calculatePrioritiesWithWorker() {
  try {
    // Get all the data needed for priority calculation
    const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');
    const tasks = {};
    
    // Get tasks for each subject
    subjects.forEach(subject => {
      tasks[subject.tag] = JSON.parse(localStorage.getItem(`tasks-${subject.tag}`) || '[]');
    });
    
    // Get academic performance data
    const subjectMarks = JSON.parse(localStorage.getItem('subjectMarks') || '{}');
    const academicPerformance = {};
    
    // Extract performance values for each subject
    Object.keys(subjectMarks).forEach(subjectId => {
      academicPerformance[subjectId] = subjectMarks[subjectId]._performance || 0;
    });
    
    // Get task weightages
    const subjectWeightages = JSON.parse(localStorage.getItem('subjectWeightages') || '{}');
    const projectWeightages = JSON.parse(localStorage.getItem('projectWeightages') || '{}');
    
    // Prepare input data for the worker
    const input = {
      subjects,
      tasks,
      academicPerformance,
      taskWeightages: {
        subjectWeightages,
        projectWeightages
      }
    };
    
    // Run the worker and get the result
    const result = await runPriorityWorker(input);
    
    // Store the result in localStorage
    localStorage.setItem('calculatedPriorityTasks', JSON.stringify(result));
    
    // Broadcast update if cross-tab sync is available
    if (window.crossTabSync) {
      window.crossTabSync.broadcastAction('priority-update', {
        timestamp: Date.now(),
        taskCount: result.length
      });
    }
    
    // Save to Firestore if possible
    if (typeof window.saveCalculatedTasksToFirestore === 'function') {
      window.saveCalculatedTasksToFirestore(result);
    }
    
    return result;
  } catch (error) {
    console.error('Error calculating priorities with worker:', error);
    
    // Fallback to the original calculation method if available
    if (typeof window.calculateAllTasksPriorities === 'function') {
      console.warn('Falling back to original calculation method');
      return window.calculateAllTasksPriorities();
    }
    
    // Return empty array if all else fails
    return [];
  }
}

// Export the function
module.exports = {
  calculatePrioritiesWithWorker
};
