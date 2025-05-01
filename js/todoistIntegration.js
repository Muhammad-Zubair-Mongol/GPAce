class TodoistIntegration {
    constructor() {
        // Your Todoist client ID
        this.clientId = '9aee64de42b042c993820f741c9308f7';
        this.apiToken = null;
        this.userInfo = null;
        
        // Authentication state management
        this.authState = {
            isAuthenticating: false,
            lastAuthAttemptTimestamp: null,
            authAttempts: 0
        };
        
        // Initialize
        this.init();
    }

    init() {
        console.group('Todoist Integration Initialization');
        console.log('Setting up Todoist integration');
        
        // Check current URL for authentication callback
        this.checkAuthenticationCallback();
        
        // Setup login/logout buttons
        this.setupLoginButton();
        this.setupLogoutButton();
        
        // Update button state on page load
        this.updateButtonState();

        // Initialize task filters if logged in
        if (localStorage.getItem('todoistAccessToken')) {
            this.apiToken = localStorage.getItem('todoistAccessToken');
            this.initializeTaskFilters();
        }
        
        console.groupEnd();
    }

    setupLoginButton() {
        const loginButton = document.getElementById('todoistLogin');
        if (loginButton) {
            loginButton.addEventListener('click', () => this.initiateLogin());
        }
    }

    setupLogoutButton() {
        const logoutButton = document.getElementById('todoistLogout');
        if (logoutButton) {
            logoutButton.addEventListener('click', () => this.logout());
        }
    }

    checkAuthenticationCallback() {
        console.group('Authentication Callback Check');
        
        // Check if we're on the callback page
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const storedState = localStorage.getItem('todoistState');

        console.log('Callback Parameters:', { code, state });
        console.log('Stored State:', storedState);

        // Validate state and code
        if (code && state && state === storedState) {
            console.log('Valid Authorization Code Detected');
            
            // Prevent multiple simultaneous authentication attempts
            if (this.authState.isAuthenticating) {
                console.warn('Authentication already in progress');
                console.groupEnd();
                return;
            }

            // Mark authentication as in progress
            this.authState.isAuthenticating = true;
            this.authState.lastAuthAttemptTimestamp = Date.now();

            // Attempt to exchange code for token
            this.exchangeAuthorizationCode(code)
                .then(() => {
                    // Reset authentication state
                    this.authState.isAuthenticating = false;
                    this.authState.authAttempts = 0;
                })
                .catch(error => {
                    console.error('Authentication Failed:', error);
                    this.authState.isAuthenticating = false;
                    this.handleAuthenticationError(error);
                });
        }

        console.groupEnd();
    }

    async exchangeAuthorizationCode(code) {
        console.group('Authorization Code Exchange');
        
        try {
            // Prepare token exchange request
            const requestBody = new URLSearchParams({
                client_id: this.clientId,
                client_secret: '80e904adda564dbea9be2bad5f9a68c9', // Updated Todoist client secret
                code: code,
                redirect_uri: `${window.location.origin}/todoist-callback`,
                grant_type: 'authorization_code'
            });

            console.log('Exchanging Authorization Code');

            const response = await fetch('https://todoist.com/oauth/access_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: requestBody
            });

            // Log full response details
            console.log('Response Status:', response.status);
            
            // Parse response
            const responseText = await response.text();
            console.log('Raw Response:', responseText);

            let tokenData;
            try {
                tokenData = JSON.parse(responseText);
            } catch (parseError) {
                console.error('JSON Parsing Error:', parseError);
                throw new Error(`Unable to parse response: ${responseText}`);
            }

            // Validate token
            if (tokenData.error) {
                throw new Error(tokenData.error_description || 'Token exchange failed');
            }

            if (!tokenData.access_token) {
                throw new Error('No access token received');
            }

            // Store token
            this.apiToken = tokenData.access_token;
            localStorage.setItem('todoistAccessToken', this.apiToken);
            
            // Clear state to prevent reuse
            localStorage.removeItem('todoistState');

            console.log('Token Successfully Exchanged');
            
            // Optional: Fetch user info
            await this.fetchUserInfo();

            // Redirect to tasks page
            window.location.href = `${window.location.origin}/tasks.html`;

            // Update button state
            this.updateButtonState();

            console.groupEnd();
            return tokenData;

        } catch (error) {
            console.error('Token Exchange Error:', error);
            throw error;
        }
    }

    initiateLogin() {
        console.group('Todoist Login Initiation');
        
        // Generate a secure state
        const state = this.generateSecureState();
        
        // Store state for CSRF protection
        localStorage.setItem('todoistState', state);

        // Construct authorization URL
        const authUrl = this.buildAuthorizationUrl(state);

        console.log('Redirecting to Todoist Authorization');
        console.log('Authorization URL:', authUrl);
        
        // Redirect to Todoist authorization
        window.location.href = authUrl;
        
        console.groupEnd();
    }

    buildAuthorizationUrl(state) {
        const baseUrl = 'https://todoist.com/oauth/authorize';
        const params = new URLSearchParams({
            client_id: this.clientId,
            scope: 'task:add,data:read,data:read_write',
            state: state,
            redirect_uri: `${window.location.origin}/todoist-callback`
        });

        return `${baseUrl}?${params.toString()}`;
    }

    generateSecureState() {
        // Generate a cryptographically secure random state
        return Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    handleAuthenticationError(error) {
        console.group('Authentication Error Handling');
        
        // Create error modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        `;

        const modalContent = document.createElement('div');
        modalContent.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 10px;
            text-align: center;
            max-width: 500px;
            width: 90%;
        `;

        modalContent.innerHTML = `
            <h2>Authentication Failed</h2>
            <p>${error.message}</p>
            <p>Possible reasons:
                <ul>
                    <li>Authorization code expired</li>
                    <li>Code already used</li>
                    <li>Network issues</li>
                </ul>
            </p>
            <button id="retryAuth" style="
                background-color: #4CAF50;
                color: white;
                border: none;
                padding: 10px 20px;
                margin: 10px;
                border-radius: 5px;
                cursor: pointer;
            ">Try Again</button>
        `;

        const retryButton = modalContent.querySelector('#retryAuth');
        retryButton.addEventListener('click', () => {
            // Clear any existing state
            localStorage.removeItem('todoistState');
            // Restart login process
            this.initiateLogin();
        });

        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        console.groupEnd();
    }

    async fetchUserInfo() {
        console.group('Fetch Todoist User Info');
        try {
            const response = await fetch('https://api.todoist.com/sync/v9/user', {
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`
                }
            });
            this.userInfo = await response.json();
            
            console.log('User Info Retrieved');
            console.log('User Details:', {
                id: this.userInfo.id,
                email: this.userInfo.email
            });
            
            console.groupEnd();
        } catch (error) {
            console.error('Error Fetching User Info:', error);
            console.groupEnd();
        }
    }

    logout() {
        // Remove Todoist access token
        localStorage.removeItem('todoistAccessToken');
        
        // Reset API token and user info
        this.apiToken = null;
        this.userInfo = null;
        
        // Update button state
        this.updateButtonState();
        
        // Optional: Add any additional logout cleanup
        console.log('Logged out of Todoist');
    }

    updateButtonState() {
        const loginButton = document.getElementById('todoistLogin');
        const logoutButton = document.getElementById('todoistLogout');
        
        if (loginButton && logoutButton) {
            const isLoggedIn = !!localStorage.getItem('todoistAccessToken');
            
            loginButton.style.display = isLoggedIn ? 'none' : 'inline-block';
            logoutButton.style.display = isLoggedIn ? 'inline-block' : 'none';
        }
    }

    async updateUIForLoggedInState() {
        const loginButton = document.getElementById('todoistLogin');
        const logoutButton = document.getElementById('todoistLogout');
        const userInfo = document.getElementById('userInfo');
        const accountInfo = document.getElementById('accountInfo');
        
        // Get user info if we haven't already
        if (!this.userInfo) {
            try {
                const response = await fetch('https://api.todoist.com/rest/v2/user', {
                    headers: {
                        'Authorization': `Bearer ${this.apiToken}`
                    }
                });
                this.userInfo = await response.json();
            } catch (error) {
                console.error('Error fetching user info:', error);
            }
        }

        if (loginButton) {
            loginButton.style.display = 'none';
        }

        if (logoutButton) {
            logoutButton.style.display = 'block';
        }

        if (userInfo && this.userInfo) {
            userInfo.innerHTML = `
                <div class="user-profile">
                    <img src="${this.userInfo.avatar_url || 'assets/default-avatar.png'}" alt="Profile" class="user-avatar">
                    <div class="user-details">
                        <span class="user-name">${this.userInfo.full_name || this.userInfo.email}</span>
                        <span class="user-email">${this.userInfo.email}</span>
                    </div>
                </div>
            `;
        }

        if (accountInfo && this.userInfo) {
            accountInfo.innerHTML = `
                <div class="account-status">
                    <span class="status-indicator connected"></span>
                    Connected to Todoist
                </div>
            `;
        }

        // Fetch and display tasks if we're on the tasks page
        if (window.location.pathname.includes('tasks.html')) {
            await this.displayTasks();
        }
    }

    async displayTasks() {
        try {
            const tasks = await this.getTasks();
            this.displayFilteredTasks(tasks);
        } catch (error) {
            console.error('Error displaying tasks:', error);
        }
    }

    async getTasks() {
        console.group('Get Todoist Tasks');
        console.log('Attempting to retrieve tasks');
        
        // Enhanced authentication check
        if (!this.isAuthenticated()) {
            console.error('Authentication Failed');
            console.log('Current Token:', this.apiToken);
            const error = new Error('Not authenticated');
            error.details = {
                hasToken: !!this.apiToken,
                storedToken: localStorage.getItem('todoistAccessToken')
            };
            console.log('Error Details:', error.details);
            console.groupEnd();
            throw error;
        }

        try {
            const response = await fetch('https://api.todoist.com/rest/v2/tasks', {
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`
                }
            });

            console.log('Fetch Response Status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Task Fetch Error:', errorText);
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            const tasks = await response.json();
            console.log('Retrieved Tasks:', tasks.length);
            console.groupEnd();
            return tasks;
        } catch (error) {
            console.error('Error fetching tasks:', error);
            console.log('Current Token:', this.apiToken);
            console.groupEnd();
            throw error;
        }
    }

    async getProjects() {
        if (!this.apiToken) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await fetch('https://api.todoist.com/rest/v2/projects', {
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`
                }
            });
            return await response.json();
        } catch (error) {
            console.error('Error fetching projects:', error);
            throw error;
        }
    }

    async getSections(projectId) {
        if (!this.apiToken) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await fetch(`https://api.todoist.com/rest/v2/sections?project_id=${projectId}`, {
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`
                }
            });
            return await response.json();
        } catch (error) {
            console.error('Error fetching sections:', error);
            throw error;
        }
    }

    async getLabels() {
        if (!this.apiToken) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await fetch('https://api.todoist.com/rest/v2/labels', {
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`
                }
            });
            return await response.json();
        } catch (error) {
            console.error('Error fetching labels:', error);
            throw error;
        }
    }

    async applyTaskFilters() {
        const projectSelect = document.getElementById('projectFilter');
        const sectionSelect = document.getElementById('sectionFilter');
        const sortSelect = document.getElementById('sortFilter');
        const tasksContainer = document.getElementById('tasksList');

        // Prepare filters
        const filters = {};
        if (projectSelect.value) filters.project_id = projectSelect.value;
        if (sectionSelect.value) filters.section_id = sectionSelect.value;

        try {
            // Fetch filtered tasks
            let tasks = await this.fetchTasks(filters);

            // Sort tasks based on selected option
            const sortOption = sortSelect.value;
            switch (sortOption) {
                case 'dateAddedAsc':
                    tasks.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                    break;
                case 'dateAddedDesc':
                    tasks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                    break;
                case 'priorityAsc':
                    tasks.sort((a, b) => (a.priority || 4) - (b.priority || 4));
                    break;
                case 'priorityDesc':
                    tasks.sort((a, b) => (b.priority || 4) - (a.priority || 4));
                    break;
                case 'dueDateAsc':
                    tasks.sort((a, b) => {
                        if (!a.due) return 1;
                        if (!b.due) return -1;
                        return new Date(a.due.date) - new Date(b.due.date);
                    });
                    break;
                case 'dueDateDesc':
                    tasks.sort((a, b) => {
                        if (!a.due) return -1;
                        if (!b.due) return 1;
                        return new Date(b.due.date) - new Date(a.due.date);
                    });
                    break;
                default:
                    // Default to most recently added
                    tasks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            }

            // Clear existing tasks
            tasksContainer.innerHTML = '';

            // Check if no tasks found
            if (tasks.length === 0) {
                tasksContainer.classList.add('empty');
                tasksContainer.innerHTML = `
                    <p>No tasks found. Time to relax or create new tasks!</p>
                `;
                return;
            }

            // Remove empty state if present
            tasksContainer.classList.remove('empty');

            // Render tasks
            tasks.forEach(task => {
                const taskElement = document.createElement('div');
                taskElement.classList.add('task-item');
                
                // Determine priority color class
                const priorityClass = `priority-${task.priority || 4}`;

                // Format created date
                const createdDate = new Date(task.created_at);
                const formattedCreatedDate = createdDate.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });

                taskElement.innerHTML = `
                    <div class="task-priority ${priorityClass}">${task.priority || 4}</div>
                    <div class="task-completion-wrapper">
                        <div class="task-completion-checkbox" data-task-id="${task.id}">
                            <i class="bi bi-circle"></i>
                            <i class="bi bi-check-circle-fill"></i>
                        </div>
                        <h3>${task.content}</h3>
                    </div>
                    <div class="task-details">
                        <div class="task-detail">
                            <i class="bi bi-folder"></i>
                            <span>Project: ${task.project_id}</span>
                        </div>
                        <div class="task-detail">
                            <i class="bi bi-list-nested"></i>
                            <span>Section: ${task.section_id || 'Uncategorized'}</span>
                        </div>
                        <div class="task-detail">
                            <i class="bi bi-calendar-plus"></i>
                            <span>Added: ${formattedCreatedDate}</span>
                        </div>
                        ${task.due?.date ? `
                            <div class="task-detail">
                                <i class="bi bi-calendar-check"></i>
                                <span>Due: ${new Date(task.due.date).toLocaleDateString()}</span>
                            </div>
                        ` : ''}
                    </div>
                `;
                
                tasksContainer.appendChild(taskElement);

                // Add event listener for task completion
                const completionCheckbox = taskElement.querySelector('.task-completion-checkbox');
                completionCheckbox.addEventListener('click', async (event) => {
                    const taskId = event.currentTarget.dataset.taskId;
                    
                    // Toggle completion
                    completionCheckbox.classList.toggle('completed');
                    
                    // Call API to mark task as complete
                    await this.toggleTaskCompletion(taskId);

                    // Optional: Add sound effect
                    if (window.soundManager) {
                        window.soundManager.playSound('click', 'confirm');
                    }
                });
            });

        } catch (error) {
            console.error('Error applying task filters:', error);
            
            // Show error state
            tasksContainer.classList.add('empty');
            tasksContainer.innerHTML = `
                <p>Oops! Something went wrong while fetching tasks.</p>
            `;
        }
    }

    async initializeTaskFilters() {
        try {
            // Fetch projects
            const projects = await this.fetchUserProjects();
            const projectSelect = document.getElementById('projectFilter');
            
            // Clear existing options
            projectSelect.innerHTML = '<option value="">All Projects</option>';
            
            // Populate project dropdown
            projects.forEach(project => {
                const option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.name;
                projectSelect.appendChild(option);
            });

            // Setup sort filter
            const sortSelect = document.getElementById('sortFilter');
            sortSelect.addEventListener('change', async () => {
                await this.applyTaskFilters();
            });

            // Add event listener for project filter
            projectSelect.addEventListener('change', async (event) => {
                const selectedProjectId = event.target.value;
                const sectionSelect = document.getElementById('sectionFilter');
                
                // Clear existing section options
                sectionSelect.innerHTML = '<option value="">All Sections</option>';
                
                if (selectedProjectId) {
                    // Fetch sections for selected project
                    const sections = await this.fetchProjectSections(selectedProjectId);
                    
                    // Populate section dropdown
                    sections.forEach(section => {
                        const option = document.createElement('option');
                        option.value = section.id;
                        option.textContent = section.name;
                        sectionSelect.appendChild(option);
                    });
                }

                // Apply filters
                await this.applyTaskFilters();
            });

            // Add event listener for section filter
            const sectionSelect = document.getElementById('sectionFilter');
            sectionSelect.addEventListener('change', async () => {
                await this.applyTaskFilters();
            });

        } catch (error) {
            console.error('Error initializing task filters:', error);
        }
    }

    async toggleTaskCompletion(taskId) {
        if (!this.apiToken) {
            console.error('No API token available');
            return false;
        }

        try {
            const response = await fetch(`https://api.todoist.com/rest/v2/tasks/${taskId}/close`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Refresh tasks after completion
            await this.applyTaskFilters();

            return true;
        } catch (error) {
            console.error('Error toggling task completion:', error);
            return false;
        }
    }

    async createTask(content, dueString = null, priority = 1) {
        if (!this.apiToken) throw new Error('Not authenticated');

        const data = {
            content,
            due_string: dueString,
            priority
        };

        const response = await fetch('https://api.todoist.com/rest/v2/tasks', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        return response.json();
    }

    isAuthenticated() {
        console.group('Authentication Check');
        
        // Check both in-memory and localStorage tokens
        const memoryToken = this.apiToken;
        const storedToken = localStorage.getItem('todoistAccessToken');
        
        const isAuth = !!(memoryToken || storedToken);
        
        console.log('Authentication Status:', isAuth ? 'Authenticated' : 'Not Authenticated');
        console.log('Memory Token:', memoryToken ? 'Present' : 'Missing');
        console.log('Stored Token:', storedToken ? 'Present' : 'Missing');
        
        // If memory token is missing but stored token exists, restore it
        if (!memoryToken && storedToken) {
            this.apiToken = storedToken;
            console.log('Restored token from localStorage');
        }
        
        console.groupEnd();
        return isAuth;
    }

    async fetchUserProjects() {
        if (!this.apiToken) {
            console.error('No API token available');
            return [];
        }

        try {
            const response = await fetch('https://api.todoist.com/rest/v2/projects', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const projects = await response.json();
            console.log('Fetched Projects:', projects);
            return projects;
        } catch (error) {
            console.error('Error fetching projects:', error);
            return [];
        }
    }

    async fetchProjectSections(projectId) {
        if (!this.apiToken) {
            console.error('No API token available');
            return [];
        }

        try {
            const response = await fetch(`https://api.todoist.com/rest/v2/sections?project_id=${projectId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const sections = await response.json();
            console.log(`Fetched Sections for Project ${projectId}:`, sections);
            return sections;
        } catch (error) {
            console.error(`Error fetching sections for project ${projectId}:`, error);
            return [];
        }
    }

    async fetchTasks(filters = {}) {
        if (!this.apiToken) {
            console.error('No API token available');
            return [];
        }

        try {
            // Construct query parameters based on filters
            const queryParams = new URLSearchParams();
            
            if (filters.project_id) queryParams.append('project_id', filters.project_id);
            if (filters.section_id) queryParams.append('section_id', filters.section_id);
            if (filters.label) queryParams.append('label', filters.label);
            
            const url = `https://api.todoist.com/rest/v2/tasks?${queryParams.toString()}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const tasks = await response.json();
            console.log('Fetched Tasks:', tasks);
            return tasks;
        } catch (error) {
            console.error('Error fetching tasks:', error);
            return [];
        }
    }

}

// Initialize Todoist integration
const todoistIntegration = new TodoistIntegration();

// Export for use in other modules
window.todoistIntegration = todoistIntegration;
