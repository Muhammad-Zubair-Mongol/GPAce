/**
 * Task Links Management System
 * ===========================
 * Handles the storage, display, and management of links associated with tasks
 */

class TaskLinksManager {
    constructor() {
        this.db = null;
        this.initializeFirestore();
    }

async initializeFirestore() {
  try {
    // First try to use the db object if it's already available in the window
    if (window.db) {
      this.db = window.db;
      return;
    }
    
    // Next try to use Firebase from window if available (from non-module script)
    if (window.firebase) {
      // Get config directly - don't rely on localStorage
      const firebaseConfig = {
        apiKey: "AIzaSyCdxGGpfoWD_M_6BwWFqWZ-6MAOKTUjIrI",
        authDomain: "mzm-gpace.firebaseapp.com",
        projectId: "mzm-gpace",
        storageBucket: "mzm-gpace.firebasestorage.app",
        messagingSenderId: "949014366726",
        appId: "1:949014366726:web:3aa05a6e133e2066c45187"
      };
      
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      this.db = firebase.firestore();
      window.db = this.db; // Store for other components
    } else {
      // If Firebase is not available, log an error but don't crash
      console.warn("Firebase not available - taskLinks functionality limited");
    }
  } catch (error) {
    console.error("Failed to initialize Firestore:", error);
  }
}

    async addLink(taskId, linkData) {
        console.log("Adding link for task:", taskId, linkData);
        
        if (!taskId || !linkData.url) {
            throw new Error('Invalid input: taskId and URL are required');
        }

        try {
            // Create link object
            const linkId = `link_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const link = {
                id: linkId,
                url: this.sanitizeUrl(linkData.url),
                title: linkData.title || this.extractTitle(linkData.url),
                type: this.getLinkType(linkData.url),
                addedAt: new Date().toISOString(),
                description: linkData.description || ''
            };

            // Update Local Storage
            const updateResult = await this.updateLocalStorage(taskId, link);
            if (!updateResult.success) {
                throw new Error(updateResult.error);
            }

            // Update Firestore
            await this.updateFirestore(taskId, link);

            return {
                success: true,
                link: link
            };
        } catch (error) {
            console.error('Error in addLink:', error);
            throw error;
        }
    }

    sanitizeUrl(url) {
        try {
            // Add https:// if no protocol is specified
            if (!url.match(/^[a-zA-Z]+:\/\//)) {
                url = 'https://' + url;
            }
            const urlObj = new URL(url);
            return urlObj.toString();
        } catch {
            throw new Error('Invalid URL format');
        }
    }

    getLinkType(url) {
        const urlLower = url.toLowerCase();
        
        if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
            return 'youtube';
        }
        if (urlLower.includes('docs.google.com') || urlLower.endsWith('.pdf') || 
            urlLower.endsWith('.doc') || urlLower.endsWith('.docx')) {
            return 'document';
        }
        if (urlLower.includes('github.com')) {
            return 'github';
        }
        if (urlLower.includes('medium.com') || urlLower.includes('dev.to') || 
            urlLower.includes('blog')) {
            return 'article';
        }
        return 'link';
    }

    extractTitle(url) {
        try {
            const urlObj = new URL(url);
            let title = urlObj.hostname.replace('www.', '');
            
            // For YouTube, try to get video ID
            if (url.includes('youtube.com') || url.includes('youtu.be')) {
                if (url.includes('youtube.com/watch')) {
                    title += ' - Video';
                } else if (url.includes('youtube.com/playlist')) {
                    title += ' - Playlist';
                }
            }
            
            return title;
        } catch {
            return url;
        }
    }
    async updateLocalStorage(taskId, link) {
        try {
            console.log("Updating localStorage for task:", taskId);
            
            // Get current tasks
            const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
            
            // Get the current task info from the DOM
            const taskInfo = document.querySelector('.task-info');
            if (!taskInfo) {
                throw new Error('Cannot find task info element');
            }
            
            const taskTitle = taskInfo.querySelector('.task-title')?.textContent?.trim() || '';
            const taskDetails = taskInfo.querySelector('.task-details')?.textContent?.trim() || '';
            const projectName = taskDetails.split('•')[1]?.trim() || '';
            const projectId = taskInfo.dataset.projectId;
            
            // Find task index using the same logic as interleaveTask
            let taskIndex = -1;
            for (let i = 0; i < priorityTasks.length; i++) {
                const task = priorityTasks[i];
                if ((task.title === taskTitle || task.title.trim() === taskTitle) && 
                    (task.projectId === projectId || task.projectName === projectName)) {
                    taskIndex = i;
                    break;
                }
            }
    
            if (taskIndex === -1) {
                console.error("Task not found in priority tasks:", { taskTitle, projectName, projectId });
                throw new Error('Task not found in priority list');
            }
    
            // Rest of the function remains the same
            if (!priorityTasks[taskIndex].links) {
                priorityTasks[taskIndex].links = [];
            }
    
            priorityTasks[taskIndex].links.push(link);
            localStorage.setItem('calculatedPriorityTasks', JSON.stringify(priorityTasks));
            
            // Update project tasks
            if (projectId) {
                const projectTasks = JSON.parse(localStorage.getItem(`tasks-${projectId}`) || '[]');
                const projectTaskIndex = projectTasks.findIndex(t => 
                    t.title === taskTitle || t.title.trim() === taskTitle
                );
                
                if (projectTaskIndex !== -1) {
                    if (!projectTasks[projectTaskIndex].links) {
                        projectTasks[projectTaskIndex].links = [];
                    }
                    projectTasks[projectTaskIndex].links.push(link);
                    localStorage.setItem(`tasks-${projectId}`, JSON.stringify(projectTasks));
                }
            }
    
            return { success: true };
        } catch (error) {
            console.error("Error updating localStorage:", error);
            return { success: false, error: error.message };
        }
    }

    async updateFirestore(taskId, link) {
        try {
            if (!this.db) {
                console.warn("Firestore not initialized, skipping Firestore update");
                return { success: false, error: "Firestore not initialized" };
            }
            
            const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
            const task = priorityTasks.find(t => String(t.id) === String(taskId));

            if (!task) {
                throw new Error('Task not found for Firestore update');
            }

            const projectId = task.projectId;
            if (!projectId) {
                console.warn("No project ID for task, skipping Firestore update");
                return { success: false, error: "No project ID" };
            }
            
            await this.db.collection('projects')
                .doc(projectId)
                .collection('tasks')
                .doc(taskId)
                .update({
                    links: firebase.firestore.FieldValue.arrayUnion(link)
                });

            return { success: true };
        } catch (error) {
            console.error('Firestore update failed:', error);
            // Don't throw here, just log the error
            return { success: false, error: error.message };
        }
    }

    renderLinks(taskId, container) {
        console.log("Rendering links for task:", taskId);
        
        const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
        const task = priorityTasks.find(t => String(t.id) === String(taskId));
        
        if (!task) {
            console.error("Task not found for rendering links:", taskId);
            return;
        }
        
        const linksList = container.querySelector('.links-list');
        
        if (!task.links || task.links.length === 0) {
            linksList.innerHTML = '<div class="no-links-message">No links added yet. Click "Add New Link" to get started.</div>';
            return;
        }

        linksList.innerHTML = task.links.map(link => this.createLinkElement(link, taskId)).join('');
    }

    createLinkElement(link, taskId) {
        const typeIcons = {
            youtube: 'bi-youtube',
            document: 'bi-file-text',
            article: 'bi-newspaper',
            github: 'bi-github',
            link: 'bi-link-45deg'
        };

        return `
            <div class="link-item ${link.type}" data-link-id="${link.id}">
                <div class="link-icon">
                    <i class="bi ${typeIcons[link.type] || typeIcons.link}"></i>
                </div>
                <div class="link-content">
                    <p class="link-title">${link.title}</p>
                    <div class="link-url">
                        <a href="${link.url}" target="_blank" rel="noopener noreferrer">
                            ${new URL(link.url).hostname}
                        </a>
                    </div>
                </div>
                <div class="link-actions">
                    <button onclick="window.open('${link.url}', '_blank')" 
                            title="Open link">
                        <i class="bi bi-box-arrow-up-right"></i>
                    </button>
                    <button onclick="taskLinksManager.removeLink('${taskId}', '${link.id}')" 
                            class="text-danger" 
                            title="Remove link">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    async removeLink(taskId, linkId) {
        try {
            // Update localStorage
            const priorityTasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
            const taskIndex = priorityTasks.findIndex(t => String(t.id) === String(taskId));
            
            if (taskIndex === -1 || !priorityTasks[taskIndex].links) {
                throw new Error('Task or links not found');
            }
            
            priorityTasks[taskIndex].links = priorityTasks[taskIndex].links.filter(l => l.id !== linkId);
            localStorage.setItem('calculatedPriorityTasks', JSON.stringify(priorityTasks));
            
            // Update project tasks
            const projectId = priorityTasks[taskIndex].projectId;
            if (projectId) {
                const projectTasks = JSON.parse(localStorage.getItem(`tasks-${projectId}`) || '[]');
                const projectTaskIndex = projectTasks.findIndex(t => String(t.id) === String(taskId));
                
                if (projectTaskIndex !== -1 && projectTasks[projectTaskIndex].links) {
                    projectTasks[projectTaskIndex].links = projectTasks[projectTaskIndex].links.filter(l => l.id !== linkId);
                    localStorage.setItem(`tasks-${projectId}`, JSON.stringify(projectTasks));
                }
            }
            
            // Update Firestore
            if (this.db && projectId) {
                try {
                    // Get the current document
                    const taskDoc = await this.db.collection('projects')
                        .doc(projectId)
                        .collection('tasks')
                        .doc(taskId)
                        .get();
                    
                    if (taskDoc.exists) {
                        const taskData = taskDoc.data();
                        if (taskData.links) {
                            // Filter out the link to remove
                            const updatedLinks = taskData.links.filter(l => l.id !== linkId);
                            
                            // Update the document with the new links array
                            await this.db.collection('projects')
                                .doc(projectId)
                                .collection('tasks')
                                .doc(taskId)
                                .update({
                                    links: updatedLinks
                                });
                        }
                    }
                } catch (firestoreError) {
                    console.error('Error updating Firestore:', firestoreError);
                }
            }
            
            // Refresh the display
            const container = document.getElementById(`links-${taskId}`);
            if (container) {
                this.renderLinks(taskId, container);
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error removing link:', error);
            return { success: false, error: error.message };
        }
    }
}

// Initialize globally
window.taskLinksManager = new TaskLinksManager();

// Task Links Management
const taskLinks = {
    // Save link to localStorage
    saveLink: async function(taskId, linkData) {
        try {
            const tasksLinks = JSON.parse(localStorage.getItem('taskLinks') || '{}');
            if (!tasksLinks[taskId]) {
                tasksLinks[taskId] = [];
            }
            tasksLinks[taskId].push({
                ...linkData,
                id: Date.now(),
                createdAt: new Date().toISOString()
            });
            localStorage.setItem('taskLinks', JSON.stringify(tasksLinks));
            return true;
        } catch (error) {
            console.error('Error saving link:', error);
            return false;
        }
    },

    // Display links for a task
    display: function(taskId) {
        const container = document.querySelector(`#links-${taskId} .links-list`);
        if (!container) return;

        const tasksLinks = JSON.parse(localStorage.getItem('taskLinks') || '{}');
        const links = tasksLinks[taskId] || [];

        container.innerHTML = links.map(link => `
            <div class="link-item ${this.getLinkType(link.url)}">
                <i class="bi ${this.getLinkIcon(link.url)} link-icon"></i>
                <div class="link-content">
                    <div class="link-title">${link.title}</div>
                    <div class="link-url">
                        <a href="${link.url}" target="_blank">${link.url}</a>
                    </div>
                    ${link.description ? `<div class="link-description">${link.description}</div>` : ''}
                </div>
                <div class="link-actions">
                    <button onclick="taskLinks.deleteLink('${taskId}', ${link.id})">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    },

    // Delete a link
    deleteLink: function(taskId, linkId) {
        const tasksLinks = JSON.parse(localStorage.getItem('taskLinks') || '{}');
        if (tasksLinks[taskId]) {
            tasksLinks[taskId] = tasksLinks[taskId].filter(link => link.id !== linkId);
            localStorage.setItem('taskLinks', JSON.stringify(tasksLinks));
            this.display(taskId);
        }
    },

    // Helper function to determine link type
    getLinkType: function(url) {
        if (url.includes('youtube.com')) return 'youtube';
        if (url.includes('github.com')) return 'github';
        if (url.includes('.pdf')) return 'document';
        if (url.includes('medium.com') || url.includes('blog')) return 'article';
        return 'link';
    },

    // Helper function to get appropriate icon
    getLinkIcon: function(url) {
        if (url.includes('youtube.com')) return 'bi-youtube';
        if (url.includes('github.com')) return 'bi-github';
        if (url.includes('.pdf')) return 'bi-file-pdf';
        if (url.includes('medium.com') || url.includes('blog')) return 'bi-file-text';
        return 'bi-link-45deg';
    }
};

// Global functions for HTML access
window.saveTaskLink = async function(taskId, linkData) {
    await taskLinks.saveLink(taskId, linkData);
    taskLinks.display(taskId);
};

window.displayTaskLinks = function(taskId) {
    taskLinks.display(taskId);
};

// Global functions for task links UI
window.toggleTaskLinks = function(taskId) {
    const container = document.getElementById(`links-${taskId}`);
    if (container) {
        container.classList.toggle('expanded');
        // Initialize links display if container is expanded
        if (container.classList.contains('expanded')) {
            window.taskLinks.display(taskId);
        }
    }
};

window.addNewLink = function(taskId) {
    const modal = document.getElementById('addLinkModal');
    modal.style.display = 'block';
    
    const form = document.getElementById('addLinkForm');
    form.onsubmit = async (e) => {
        e.preventDefault();
        const url = document.getElementById('linkUrl').value;
        const title = document.getElementById('linkTitle').value;
        const description = document.getElementById('linkDescription').value;
        
        await window.taskLinks.saveLink(taskId, { url, title, description });
        form.reset();
        modal.style.display = 'none';
        window.taskLinks.display(taskId);
    };
};

window.closeAddLinkModal = function() {
    const modal = document.getElementById('addLinkModal');
    modal.style.display = 'none';
};

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    const modal = document.getElementById('addLinkModal');
    if (e.target === modal) {
        window.closeAddLinkModal();
    }
});