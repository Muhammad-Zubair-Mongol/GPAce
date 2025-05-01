// initFirestoreData.js - Initializes data from Firestore on page load

// Import necessary Firestore functions
import { loadSubjectsFromFirestore, loadTasksFromFirestore } from './firestore.js';

// Function to calculate priority scores for tasks
async function calculatePriorityScores(tasks, subject) {
    try {
        // Get subject weightages directly
        const subjectWeightages = JSON.parse(localStorage.getItem('subjectWeightages') || '{}');
        const subjectWeightage = subjectWeightages[subject.tag] || {};

        // Get subject marks for performance adjustment
        const subjectMarks = JSON.parse(localStorage.getItem('subjectMarks') || '{}');
        const subjectPerformance = subjectMarks[subject.tag]?._manualPerformance || 0;

        return tasks.map(task => {
            // Map section to category for weightage lookup
            const sectionToCategory = {
                'Assignment': 'assignment',
                'Quizzes': 'quiz',
                'Mid Term / OHT': 'midterm',
                'Finals': 'final',
                'Revision': 'revision'
            };
            
            // Get exact weightage from subject marks
            const category = sectionToCategory[task.section] || task.section.toLowerCase();
            const taskWeightage = subjectWeightage[category] || 0;

            // Calculate time remaining points
            const now = new Date();
            const dueDate = new Date(task.dueDate);
            const timeDiff = dueDate.getTime() - now.getTime();
            const daysRemaining = timeDiff / (1000 * 3600 * 24);
            
            let timePoints;
            if (daysRemaining < 0) {
                // Overdue tasks get increasing priority
                timePoints = 100 * (1 + Math.log(Math.abs(daysRemaining) + 1));
            } else {
                // Upcoming tasks get inverse priority
                timePoints = 100 * (1 / (daysRemaining + 1));
            }

            // Calculate final score
            const baseScore = (
                subject.relativeScore +  // Credit Hours Points
                (subject.cognitiveDifficulty || 50) + // Cognitive Difficulty Points
                taskWeightage +  // Task Weightage Points
                timePoints  // Time Remaining Points
            );

            // Apply academic performance adjustment
            const finalScore = baseScore * (1 - subjectPerformance/100);

            return {
                ...task,
                projectId: subject.tag,
                projectName: subject.name,
                priorityScore: finalScore
            };
        });
    } catch (error) {
        console.error('Error calculating priority scores:', error);
        return tasks.map(task => ({
            ...task,
            projectId: subject.tag,
            projectName: subject.name,
            priorityScore: 0
        }));
    }
}

// Function to update priority tasks based on loaded data
async function updatePriorityTasks() {
    try {
        // First check if we have existing priority tasks to preserve order
        const existingPriorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
        const existingTaskIds = new Set(existingPriorityTasks.map(task => task.id));
        
        // Get all subjects
        const subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');
        const newPriorityTasks = [];

        // Process tasks for each subject/project
        for (const subject of subjects) {
            const projectId = subject.tag;
            const tasksKey = `tasks-${projectId}`;
            const tasks = JSON.parse(localStorage.getItem(tasksKey) || '[]');
            
            // Only process non-completed tasks that aren't already in priority list
            const newTasks = tasks.filter(task => !task.completed && !existingTaskIds.has(task.id));
            
            // Calculate priority scores for new tasks
            const scoredTasks = await calculatePriorityScores(newTasks, subject);
            newPriorityTasks.push(...scoredTasks);
        }

        // Sort new tasks by priority score
        newPriorityTasks.sort((a, b) => b.priorityScore - a.priorityScore);

        // Filter out completed tasks from existing priority tasks
        const updatedExistingTasks = existingPriorityTasks.filter(task => {
            const projectTasks = JSON.parse(localStorage.getItem(`tasks-${task.projectId}`) || '[]');
            return projectTasks.some(t => t.id === task.id && !t.completed);
        });

        // Combine existing tasks with new tasks
        const finalPriorityTasks = [...updatedExistingTasks, ...newPriorityTasks];
        
        // Store calculated priority tasks
        localStorage.setItem('calculatedPriorityTasks', JSON.stringify(finalPriorityTasks));
        console.log(`✅ Updated priority tasks: ${finalPriorityTasks.length} tasks prioritized`);

        // If we're on grind.html, update the display
        if (typeof window.displayPriorityTask === 'function') {
            window.displayPriorityTask();
        }
    } catch (error) {
        console.error('❌ Error updating priority tasks:', error);
    }
}

// Function to initialize data from Firestore
async function initializeFirestoreData(retry = 0) {
    console.log(`🚀 Initializing data from Firestore... (Attempt ${retry + 1})`);
    
    try {
        // Check if auth is available
        if (window.auth) {
            // Wait for auth state to be resolved with longer timeout
            const user = await new Promise((resolve) => {
                const unsubscribe = window.auth.onAuthStateChanged(user => {
                    if (user) {
                        unsubscribe();
                        resolve(user);
                    } else if (retry > 0) {
                        // Only resolve null after first retry to give time for auth
                        unsubscribe();
                        resolve(null);
                    }
                    // On first attempt, don't resolve null to wait for potential auth
                });
                
                // Set a timeout to resolve null if auth takes too long
                setTimeout(() => {
                    unsubscribe();
                    resolve(null);
                }, 5000); // Increased from implicit 1000ms to 5000ms
            });
            
            // If not authenticated, try to silently use local data
            if (!user) {
                console.log('⚠️ User not authenticated, using local data');
                // Clear any existing versioning to force Firestore sync on next login
                localStorage.setItem('forceFirestoreSync', 'true');
                
                // Still try to update priority tasks with what we have
                updatePriorityTasks();
                if (typeof window.displayPriorityTask === 'function') {
                    window.displayPriorityTask();
                }
                return;
            }
            
            console.log(`✅ Authenticated as: ${user.email}`);
            
            // Check if we need to force a Firestore sync (new device or forced)
            const shouldForceSync = localStorage.getItem('forceFirestoreSync') === 'true';
            if (shouldForceSync) {
                console.log('🔄 Forcing Firestore sync due to new device or forced sync flag');
                localStorage.removeItem('forceFirestoreSync');
            }
            
            // Load subjects from Firestore
            console.log('📚 Loading academic subjects from Firestore...');
            const subjects = await loadSubjectsFromFirestore();
            
            if (subjects && subjects.length > 0) {
                console.log(`✅ Successfully loaded ${subjects.length} subjects`);
                
                // Load tasks for each subject
                console.log('📋 Loading tasks for each subject...');
                const loadPromises = [];
                
                for (const subject of subjects) {
                    const projectId = subject.tag;
                    console.log(`🔍 Loading tasks for project: ${projectId}`);
                    
                    loadPromises.push(
                        loadTasksFromFirestore(projectId)
                            .then(tasks => {
                                console.log(`✅ Loaded ${tasks.length} tasks for ${projectId}`);
                                return tasks;
                            })
                            .catch(error => {
                                console.error(`❌ Error loading tasks for ${projectId}:`, error);
                                return [];
                            })
                    );
                }
                
                // Wait for all tasks to load
                await Promise.all(loadPromises);
                
                // Update priority tasks after all data is loaded
                console.log('🔄 Calculating and updating priority tasks...');
                await updatePriorityTasks();
                
                // Set a flag indicating successful data load
                localStorage.setItem('dataInitialized', 'true');
                console.log('✅ Data initialization complete!');
                
                return true;
            } else {
                console.log('⚠️ No subjects found');
                if (retry < 5) {  // Increased retry count from 3 to 5
                    console.log(`🔄 Retrying in 2 seconds... (Attempt ${retry + 1})`);
                    setTimeout(() => initializeFirestoreData(retry + 1), 2000);  // Increased from 1 to 2 seconds
                    return;
                }
            }
        } else {
            console.log('⚠️ Auth not initialized, deferring data loading');
            if (retry < 5) {  // Increased retry count from 3 to 5
                console.log(`🔄 Retrying in 2 seconds... (Attempt ${retry + 1})`);
                setTimeout(() => initializeFirestoreData(retry + 1), 2000);  // Increased from 1 to 2 seconds
                return;
            }
        }
    } catch (error) {
        console.error('❌ Error initializing data:', error);
        if (retry < 5) {  // Increased retry count from 3 to 5
            console.log(`🔄 Retrying in 2 seconds... (Attempt ${retry + 1})`);
            setTimeout(() => initializeFirestoreData(retry + 1), 2000);  // Increased from 1 to 2 seconds
            return;
        }
    }
    
    return false;
}

// Make the function available globally
window.initializeFirestoreData = initializeFirestoreData;

// Initialize on DOM loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🔄 DOM loaded, initializing Firestore data...');
    // Wait longer to make sure auth is initialized
    setTimeout(initializeFirestoreData, 2000);  // Increased from 1000 to 2000ms
}); 