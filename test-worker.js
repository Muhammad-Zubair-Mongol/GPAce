/**
 * Test script for the priority calculation worker
 * 
 * This script tests the worker functionality with sample data
 * to verify that it works correctly before integrating it into the main app.
 */

const { Worker } = require('worker_threads');
const path = require('path');

// Sample test data
const testData = {
  subjects: [
    {
      name: "Mathematics",
      tag: "math101",
      relativeScore: 85,
      cognitiveDifficulty: 75,
      creditHours: 4
    },
    {
      name: "Physics",
      tag: "phys101",
      relativeScore: 70,
      cognitiveDifficulty: 80,
      creditHours: 3
    }
  ],
  tasks: {
    "math101": [
      {
        id: "task1",
        title: "Calculus Assignment",
        section: "assignment",
        dueDate: new Date(Date.now() + 86400000).toISOString() // Tomorrow
      },
      {
        id: "task2",
        title: "Midterm Exam",
        section: "midterm",
        dueDate: new Date(Date.now() + 604800000).toISOString() // 1 week from now
      }
    ],
    "phys101": [
      {
        id: "task3",
        title: "Lab Report",
        section: "assignment",
        dueDate: new Date(Date.now() + 172800000).toISOString() // 2 days from now
      },
      {
        id: "task4",
        title: "Final Exam",
        section: "final",
        dueDate: new Date(Date.now() + 1209600000).toISOString() // 2 weeks from now
      }
    ]
  },
  academicPerformance: {
    "math101": 20,
    "phys101": 15
  },
  taskWeightages: {
    subjectWeightages: {
      "math101": {
        "assignment": 20,
        "midterm": 30,
        "final": 50
      }
    },
    projectWeightages: {
      "phys101": {
        "assignment": { avg: 25 },
        "final": { avg: 50 }
      }
    }
  }
};

// Function to run the worker
function runWorker(input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.resolve(__dirname, './worker.js'));
    
    worker.postMessage(input);
    
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', code => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

// Run the test
async function runTest() {
  console.log('Starting worker test with sample data...');
  console.time('Worker execution time');
  
  try {
    const result = await runWorker(testData);
    console.timeEnd('Worker execution time');
    
    console.log('Worker test completed successfully!');
    console.log('Calculated priority tasks:', result);
    
    // Verify the results
    if (result.length !== 4) {
      console.error('Expected 4 tasks in result, but got', result.length);
    } else {
      console.log('✅ Correct number of tasks returned');
    }
    
    // Check if tasks are sorted by priority
    const isSorted = result.every((task, i) => 
      i === 0 || task.priorityScore <= result[i-1].priorityScore
    );
    
    if (isSorted) {
      console.log('✅ Tasks are correctly sorted by priority score');
    } else {
      console.error('❌ Tasks are not sorted correctly by priority score');
    }
    
    // Print each task with its score for verification
    console.log('\nTask Priority Breakdown:');
    result.forEach(task => {
      console.log(`- ${task.title} (${task.projectName}): ${task.priorityScore.toFixed(2)}`);
    });
    
  } catch (error) {
    console.error('Worker test failed:', error);
  }
}

// Run the test
runTest();
