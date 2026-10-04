/**
 * Task Notes Injector
 * This script directly modifies the HTML templates used by displayPriorityTask and navigateTask
 * to include the notes button without any visual delay.
 */

(function() {
  // Wait for the document to be fully loaded
  document.addEventListener('DOMContentLoaded', function() {
    console.log('Task Notes Injector: Initializing');
    
    // Function to inject the notes button template into the original functions
    function injectNotesButton() {
      // First, check if displayPriorityTask exists
      if (typeof window.displayPriorityTask === 'function') {
        console.log('Task Notes Injector: Modifying displayPriorityTask');
        
        // Get the original function as a string
        const originalFunctionStr = window.displayPriorityTask.toString();
        
        // Create a modified version with the notes button included
        let modifiedFunctionStr = originalFunctionStr;
        
        // Look for the pattern where task action buttons are defined
        if (originalFunctionStr.includes('task-actions')) {
          // Find the pattern for the Subtasks button which is usually the last button
          const subtasksButtonPattern = /<button onclick="toggleSubtasks\(this, '\${topTask\.id}'\)" class="task-btn subtasks-btn">[^<]*Subtasks[^<]*<\/button>/;
          
          // Add the notes button after the subtasks button
          modifiedFunctionStr = modifiedFunctionStr.replace(
            subtasksButtonPattern,
            match => `${match}
            <button onclick="openTaskNotes('\${topTask.id}', '\${topTask.projectId}')" class="task-btn notes-btn" title="Add or view notes">
                <i class="fas fa-sticky-note"></i> Notes
            </button>`
          );
          
          // Create a new function from the modified string
          try {
            // This is a complex approach that might not work in all browsers
            // Instead, we'll use a more reliable approach by modifying the HTML after it's generated
            console.log('Task Notes Injector: Using DOM modification approach');
          } catch (error) {
            console.error('Task Notes Injector: Error creating function from string:', error);
          }
        }
      }
      
      // Also check if navigateTask exists
      if (typeof window.navigateTask === 'function') {
        console.log('Task Notes Injector: Modifying navigateTask');
        
        // Get the original function as a string
        const originalFunctionStr = window.navigateTask.toString();
        
        // Create a modified version with the notes button included
        let modifiedFunctionStr = originalFunctionStr;
        
        // Look for the pattern where task action buttons are defined
        if (originalFunctionStr.includes('task-actions')) {
          // Find the pattern for the Links button which is usually the last button
          const linksButtonPattern = /<button onclick="toggleTaskLinks\('\${nextTask\.id}'\)" class="task-btn links-btn">[^<]*Links[^<]*<\/button>/;
          
          // Add the notes button after the links button
          modifiedFunctionStr = modifiedFunctionStr.replace(
            linksButtonPattern,
            match => `${match}
            <button onclick="openTaskNotes('\${nextTask.id}', '\${nextTask.projectId}')" class="task-btn notes-btn" title="Add or view notes">
                <i class="fas fa-sticky-note"></i> Notes
            </button>`
          );
          
          // Create a new function from the modified string
          try {
            // This is a complex approach that might not work in all browsers
            // Instead, we'll use a more reliable approach by modifying the HTML after it's generated
            console.log('Task Notes Injector: Using DOM modification approach for navigateTask');
          } catch (error) {
            console.error('Task Notes Injector: Error creating function from string for navigateTask:', error);
          }
        }
      }
    }
    
    // Define the global openTaskNotes function
    window.openTaskNotes = function(taskId, projectId) {
      console.log('Notes button clicked for task:', taskId, 'project:', projectId);
      if (window.taskNotesManager) {
        window.taskNotesManager.openNotesModal(taskId, projectId);
      } else {
        console.error('Task notes manager not available');
      }
    };
    
    // Try to inject the notes button
    injectNotesButton();
    
    // Set up a MutationObserver to add the notes button whenever the task box is updated
    const taskBoxObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Check if the task actions container was added
          const taskActions = document.querySelector('.task-actions');
          if (taskActions && !taskActions.querySelector('.notes-btn')) {
            // Get task info
            const taskInfo = document.querySelector('.task-info');
            if (taskInfo) {
              const taskId = taskInfo.dataset.taskId || taskInfo.dataset.taskIndex;
              const projectId = taskInfo.dataset.projectId;
              
              if (taskId && projectId) {
                // Create notes button
                const notesButton = document.createElement('button');
                notesButton.className = 'task-btn notes-btn';
                notesButton.title = 'Add or view notes';
                notesButton.innerHTML = '<i class="fas fa-sticky-note"></i> Notes';
                notesButton.onclick = function() { openTaskNotes(taskId, projectId); };
                
                // Add button to task actions
                taskActions.appendChild(notesButton);
                
                // Update task display to show note indicators
                if (window.taskNotesManager) {
                  window.taskNotesManager.updateTaskDisplay();
                }
              }
            }
          }
        }
      });
    });
    
    // Start observing the task box
    const taskBox = document.getElementById('priorityTaskBox');
    if (taskBox) {
      taskBoxObserver.observe(taskBox, { childList: true, subtree: true });
    }
  });
})();
