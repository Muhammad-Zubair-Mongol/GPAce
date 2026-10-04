/**
 * Priority Worker Wrapper
 * 
 * This module provides a wrapper around the Node.js worker thread
 * that handles priority calculations. It offloads CPU-intensive
 * task priority calculations to a separate thread.
 * 
 * NOTE: This is a Node.js module. It does NOT have access to browser
 * globals like window, localStorage, or document. All data must be
 * passed in as parameters.
 */

const { Worker } = require('worker_threads');
const path = require('path');
const {
  calculateTaskPrioritiesPure,
  toFiniteNumber
} = require('../priority-calculator.js');

const DEFAULT_WORKER_TIMEOUT_MS = 5000;

// The legacy worker.js contains a second copy of the old scoring policy. Keep
// this wrapper self-contained and load the canonical pure scorer inside the
// worker so direct and worker results cannot drift on date or numeric rules.
const PRIORITY_WORKER_SOURCE = `
  const { parentPort } = require('worker_threads');
  const { calculateTaskPrioritiesPure } = require(${JSON.stringify(path.resolve(__dirname, '../priority-calculator.js'))});

  parentPort.on('message', (input) => {
    const result = calculateTaskPrioritiesPure(input);
    parentPort.postMessage(result);
  });
`;

class PriorityWorkerTimeoutError extends Error {
  constructor(timeoutMs) {
    super('Priority worker timed out after ' + timeoutMs + 'ms');
    this.name = 'PriorityWorkerTimeoutError';
    this.code = 'WORKER_TIMEOUT';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Run the priority calculation in a worker thread
 * @param {Object} input - Data needed for priority calculation
 * @returns {Promise} - Promise that resolves with the calculated priority tasks
 */
function runPriorityWorker(input, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1, Number(options.timeoutMs))
    : DEFAULT_WORKER_TIMEOUT_MS;
  const workerFactory = typeof options.workerFactory === 'function'
    ? options.workerFactory
    : (source, workerOptions) => new Worker(source, workerOptions);
  const workerSource = options.workerPath
    ? path.resolve(options.workerPath)
    : PRIORITY_WORKER_SOURCE;
  const workerOptions = options.workerPath ? {} : { eval: true };

  return new Promise((resolve, reject) => {
    let worker;
    let timer;
    let settled = false;

    const removeListeners = () => {
      if (!worker) return;
      if (typeof worker.removeListener === 'function') {
        worker.removeListener('message', onMessage);
        worker.removeListener('error', onError);
        worker.removeListener('exit', onExit);
      }
    };

    const terminate = async () => {
      if (!worker || typeof worker.terminate !== 'function') return;
      try {
        await worker.terminate();
      } catch {
        // The worker may already have exited; cleanup remains complete.
      }
    };

    const settle = async (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      removeListeners();
      await terminate();
      if (error) reject(error);
      else resolve(value);
    };

    const onMessage = (value) => {
      void settle(null, value);
    };
    const onError = (error) => {
      void settle(error);
    };
    const onExit = (code) => {
      if (settled) return;
      const message = code === 0
        ? 'Priority worker exited before returning a result'
        : `Priority worker stopped with exit code ${code}`;
      void settle(Object.assign(new Error(message), {
        code: code === 0 ? 'WORKER_NO_RESULT' : 'WORKER_EXIT'
      }));
    };

    try {
      worker = workerFactory(workerSource, workerOptions);
      if (!worker || typeof worker.on !== 'function' || typeof worker.postMessage !== 'function') {
        throw new TypeError('workerFactory must return a Worker-like object');
      }

      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
      timer = setTimeout(() => {
        void settle(new PriorityWorkerTimeoutError(timeoutMs));
      }, timeoutMs);
      worker.postMessage(input);
    } catch (error) {
      void settle(error);
    }
  });
}

/**
 * Calculate priority scores for all tasks using the worker thread
 * 
 * @param {Object} storageData - Required data from storage (must be passed in from caller)
 * @param {Array} storageData.subjects - Array of academic subjects
 * @param {Object} storageData.subjectMarks - Subject marks data
 * @param {Object} storageData.subjectWeightages - Subject weightages
 * @param {Object} storageData.projectWeightages - Project weightages
 * @param {Function} [storageData.getTasksForSubject] - Optional function to get tasks for a subject tag
 * @param {Object} [storageData.allTasks] - Optional: pre-loaded tasks object { subjectTag: tasksArray }
 * @returns {Promise<Array>} - Promise that resolves with the calculated priority tasks
 */
async function calculatePrioritiesWithWorker(storageData = {}, options = {}) {
  // Validate required input
  if (!storageData || typeof storageData !== 'object') {
    throw new Error('storageData parameter is required. This module runs in Node.js and cannot access browser storage.');
  }

    const {
      subjects = [],
      subjectMarks = {},
      subjectWeightages = {},
      projectWeightages = {},
      allTasks = {},
      getTasksForSubject = null,
      now,
      timeZone
    } = storageData;

  try {
    const tasks = {};

    // Get tasks for each subject
    for (const subject of subjects) {
      if (allTasks[subject.tag]) {
        // Use pre-loaded tasks if available
        tasks[subject.tag] = allTasks[subject.tag];
      } else if (typeof getTasksForSubject === 'function') {
        // Use callback function if provided
        tasks[subject.tag] = getTasksForSubject(subject.tag) || [];
      } else {
        // Default to empty array
        tasks[subject.tag] = [];
      }
    }

    // Extract performance values for each subject
    const academicPerformance = {};
    Object.keys(subjectMarks).forEach(subjectId => {
      academicPerformance[subjectId] = toFiniteNumber(subjectMarks[subjectId]?._performance, 0);
    });

    // Prepare input data for the worker
    const input = {
      subjects,
      tasks,
      academicPerformance,
      taskWeightages: {
        subjectWeightages,
        projectWeightages
      },
      now,
      timeZone
    };

    // Run the worker and get the result
    const workerOptions = {
      ...options,
      timeoutMs: options.timeoutMs ?? storageData.timeoutMs,
      workerPath: options.workerPath ?? storageData.workerPath,
      workerFactory: options.workerFactory ?? storageData.workerFactory
    };
    const result = await runPriorityWorker(input, workerOptions);

    return result;
  } catch (error) {
    console.error('Error calculating priorities with worker:', error);
    throw error;
  }
}

/**
 * Helper function to prepare storage data from browser context
 * This should be called from the BROWSER side before invoking the worker
 * 
 * @param {Function} getStorage - Storage accessor function
 * @returns {Object} - Storage data object suitable for calculatePrioritiesWithWorker
 * 
 * @example
 * // In browser context:
 * const storage = window.StorageService || getStorage();
 * const storageData = prepareStorageData(storage);
 * // Then pass storageData to a server endpoint or IPC channel
 */
function prepareStorageData(storage) {
  if (!storage || typeof storage.get !== 'function') {
    throw new Error('Valid storage object with get() method is required');
  }

  const subjects = storage.get('academicSubjects', []);
  const allTasks = {};

  // Get tasks for each subject
  subjects.forEach(subject => {
    allTasks[subject.tag] = storage.get(`tasks-${subject.tag}`, []);
  });

  return {
    subjects,
    subjectMarks: storage.get('subjectMarks', {}),
    subjectWeightages: storage.get('subjectWeightages', {}),
    projectWeightages: storage.get('projectWeightages', {}),
    allTasks
  };
}

// Export the functions
module.exports = {
  calculatePrioritiesWithWorker,
  runPriorityWorker,
  prepareStorageData,
  PriorityWorkerTimeoutError,
  DEFAULT_WORKER_TIMEOUT_MS,
  PRIORITY_WORKER_SOURCE
};
