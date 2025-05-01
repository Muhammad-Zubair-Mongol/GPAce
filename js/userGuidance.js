class UserGuidance {
    constructor() {
        this.storageKey = 'gpace-user-guidance';
        this.initializeGuidance();
    }

    // Check if it's the first time the user is using the app
    isFirstTimeUser() {
        const guidanceData = this.getGuidanceData();
        return !guidanceData.hasCompletedInitialTour;
    }

    // Get or initialize guidance data
    getGuidanceData() {
        const storedData = localStorage.getItem(this.storageKey);
        return storedData
            ? JSON.parse(storedData)
            : {
                hasCompletedInitialTour: true,
                hasCompletedNavigationGuide: false,
                navigationGuideShown: false,
                completedPages: [],
                lastVisitedPage: null,
                tourProgress: 0
            };
    }

    // Save guidance data
    saveGuidanceData(data) {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
    }

    // Initialize guidance system
    initializeGuidance() {
        const guidanceData = this.getGuidanceData();

        // Show navigation guide only once for new users
        if (!guidanceData.hasCompletedNavigationGuide && !guidanceData.navigationGuideShown) {
            // Mark that navigation guide has been shown
            guidanceData.navigationGuideShown = true;
            this.saveGuidanceData(guidanceData);

            // Show navigation guide
            this.showNavigationGuide();
        }
    }

    // Start the initial tour
    startInitialTour() {
        // Create a full-screen overlay with tour information
        const tourOverlay = this.createTourOverlay();
        document.body.appendChild(tourOverlay);
    }

    // Create an interactive tour overlay
    createTourOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'user-guidance-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            z-index: 9999;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            color: white;
            text-align: center;
            padding: 20px;
            box-sizing: border-box;
        `;

        const tourSteps = [
            {
                title: "Welcome to GPAce!",
                description: "Your personal productivity and task management companion.",
                nextStep: "Let's get started with a quick tour."
            },
            {
                title: "Grind Page: Your Task Hub",
                description: "This is where you'll manage and track your tasks. Create, prioritize, and complete tasks efficiently.",
                nextStep: "Learn how to add your first task."
            },
            {
                title: "Adding Tasks",
                description: "Click the '+' button to add a new task. You can add details like project, section, and priority.",
                nextStep: "Discover task prioritization."
            },
            {
                title: "Task Prioritization",
                description: "Tasks are automatically prioritized based on various factors. The Priority Calculator helps you understand task importance.",
                nextStep: "Explore more features."
            }
        ];

        let currentStep = 0;

        const titleEl = document.createElement('h1');
        const descriptionEl = document.createElement('p');
        const nextStepEl = document.createElement('p');
        const nextButton = document.createElement('button');

        titleEl.style.cssText = 'font-size: 2rem; margin-bottom: 20px; color: #fe2c55;';
        descriptionEl.style.cssText = 'font-size: 1.2rem; max-width: 600px; margin-bottom: 20px;';
        nextStepEl.style.cssText = 'font-style: italic; margin-bottom: 20px;';
        nextButton.style.cssText = `
            background-color: #fe2c55;
            color: white;
            border: none;
            padding: 10px 20px;
            font-size: 1rem;
            border-radius: 5px;
            cursor: pointer;
            transition: background-color 0.3s;
        `;

        nextButton.textContent = 'Next';
        nextButton.addEventListener('click', () => {
            currentStep++;
            if (currentStep < tourSteps.length) {
                updateStep();
            } else {
                this.completeTour();
                overlay.remove();
            }
        });

        function updateStep() {
            const step = tourSteps[currentStep];
            titleEl.textContent = step.title;
            descriptionEl.textContent = step.description;
            nextStepEl.textContent = step.nextStep;
            nextButton.textContent = currentStep === tourSteps.length - 1 ? 'Finish' : 'Next';
        }

        updateStep();

        overlay.appendChild(titleEl);
        overlay.appendChild(descriptionEl);
        overlay.appendChild(nextStepEl);
        overlay.appendChild(nextButton);

        return overlay;
    }

    // Complete the initial tour
    completeTour() {
        const guidanceData = this.getGuidanceData();
        guidanceData.hasCompletedInitialTour = true;
        this.saveGuidanceData(guidanceData);
    }

    // Show contextual help for a specific page
    showContextualHelp(pageName) {
        const helpContent = {
            'grind.html': {
                title: 'Task Management',
                description: 'Add, prioritize, and track your tasks here. Use the "+" button to create new tasks.',
                tips: [
                    'Click "+" to add a new task',
                    'Drag and drop to reorder tasks',
                    'Use the priority calculator to understand task importance'
                ]
            },
            'priority-calculator.html': {
                title: 'Priority Insights',
                description: 'Understand how your tasks are prioritized based on various factors.',
                tips: [
                    'View detailed priority breakdown',
                    'Learn why a task is considered high or low priority'
                ]
            }
            // Add more pages as needed
        };

        const content = helpContent[pageName];
        if (!content) return;

        // Create a help modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            color: black;
            padding: 20px;
            border-radius: 10px;
            z-index: 1000;
            max-width: 400px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;

        modal.innerHTML = `
            <h2 style="color: #fe2c55;">${content.title}</h2>
            <p>${content.description}</p>
            <h3>Quick Tips:</h3>
            <ul>
                ${content.tips.map(tip => `<li>${tip}</li>`).join('')}
            </ul>
            <button id="close-help-modal" style="
                background-color: #fe2c55;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
            ">Close</button>
        `;

        document.body.appendChild(modal);

        // Close modal functionality
        modal.querySelector('#close-help-modal').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
    }

    // Add navigation guide method
    showNavigationGuide() {
        // Create a full-screen overlay for navigation guidance
        const navGuideOverlay = document.createElement('div');
        navGuideOverlay.id = 'navigation-guide-overlay';
        navGuideOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.85);
            z-index: 9999;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            color: white;
            text-align: center;
            padding: 20px;
            box-sizing: border-box;
        `;

        // Enhanced page descriptions with interactive elements
        const pageDescriptions = {
            'grind': {
                title: "Task Management Hub",
                description: "Your central workspace for managing tasks and boosting productivity.",
                features: [
                    "Create and organize tasks by project and priority",
                    "Track progress with visual indicators",
                    "Set deadlines and reminders",
                    "Filter tasks by status or category"
                ],
                demoAction: () => {
                    const demoTask = document.createElement('div');
                    demoTask.className = 'demo-task';
                    demoTask.innerHTML = `
                        <h4>Example Task</h4>
                        <div class="task-details">
                            <span>Priority: High</span>
                            <span>Due: Tomorrow</span>
                        </div>
                        <div class="task-actions">
                            <button>Complete</button>
                            <button>Edit</button>
                        </div>
                    `;
                    return demoTask;
                }
            },
            'priority-calculator': {
                title: "Smart Priority Calculator",
                description: "Understand and optimize your task prioritization.",
                features: [
                    "Automatic priority scoring based on multiple factors",
                    "Visual priority breakdown",
                    "Customizable weight factors",
                    "Priority trends and insights"
                ],
                demoAction: () => {
                    const demoCalc = document.createElement('div');
                    demoCalc.className = 'demo-calculator';
                    demoCalc.innerHTML = `
                        <div class="priority-factors">
                            <div>Urgency: <input type="range" min="1" max="5" value="3"></div>
                            <div>Importance: <input type="range" min="1" max="5" value="4"></div>
                            <div>Effort: <input type="range" min="1" max="5" value="2"></div>
                        </div>
                        <div class="priority-score">
                            Priority Score: 8.5/10
                        </div>
                    `;
                    return demoCalc;
                }
            },
            'study-spaces': {
                title: "Personalized Study Environments",
                description: "Create and customize your ideal study spaces.",
                features: [
                    "Create multiple study space layouts",
                    "Track time spent in each space",
                    "Set environment preferences",
                    "Quick-switch between spaces"
                ],
                demoAction: () => {
                    const demoSpace = document.createElement('div');
                    demoSpace.className = 'demo-study-space';
                    demoSpace.innerHTML = `
                        <div class="space-preview">
                            <h4>Math Study Space</h4>
                            <div class="space-tools">
                                <span>📚 Resources</span>
                                <span>⏱️ Timer</span>
                                <span>📝 Notes</span>
                            </div>
                        </div>
                    `;
                    return demoSpace;
                }
            },
            'academic-details': {
                title: "Academic Progress Tracker",
                description: "Monitor and analyze your academic journey.",
                features: [
                    "Track course grades and GPA",
                    "Set academic goals",
                    "View progress trends",
                    "Generate progress reports"
                ],
                demoAction: () => {
                    const demoAcademics = document.createElement('div');
                    demoAcademics.className = 'demo-academics';
                    demoAcademics.innerHTML = `
                        <div class="grade-summary">
                            <div>Current GPA: 3.8</div>
                            <div class="course-list">
                                <div>Math 101: A-</div>
                                <div>Physics 201: B+</div>
                                <div>CS 301: A</div>
                            </div>
                        </div>
                    `;
                    return demoAcademics;
                }
            }
        };

        // Create interactive content container
        const contentContainer = document.createElement('div');
        contentContainer.style.cssText = `
            background: rgba(255,255,255,0.1);
            border-radius: 10px;
            padding: 30px;
            margin: 20px;
            max-width: 800px;
            width: 90%;
            backdrop-filter: blur(5px);
        `;

        // Style for interactive elements
        const style = document.createElement('style');
        style.textContent = `
            .demo-section {
                margin: 20px 0;
                padding: 15px;
                background: rgba(255,255,255,0.1);
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.3s ease;
            }
            .demo-section:hover {
                background: rgba(255,255,255,0.2);
                transform: translateY(-2px);
            }
            .feature-list {
                text-align: left;
                margin: 15px 0;
            }
            .feature-item {
                margin: 8px 0;
                display: flex;
                align-items: center;
            }
            .feature-item:before {
                content: '→';
                margin-right: 10px;
                color: #fe2c55;
            }
            .demo-container {
                margin-top: 20px;
                padding: 15px;
                background: rgba(0,0,0,0.3);
                border-radius: 8px;
            }
            .nav-button {
                background: #fe2c55;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                margin: 5px;
                transition: all 0.3s ease;
            }
            .nav-button:hover {
                background: #ff4d70;
                transform: translateY(-2px);
            }
            .demo-task, .demo-calculator, .demo-study-space, .demo-academics {
                background: rgba(255,255,255,0.9);
                color: #333;
                padding: 15px;
                border-radius: 8px;
                margin: 10px 0;
            }
        `;
        document.head.appendChild(style);

        // Function to create section content
        function createSectionContent(pageKey) {
            const pageInfo = pageDescriptions[pageKey];
            if (!pageInfo) return null;

            const section = document.createElement('div');
            section.className = 'demo-section';

            section.innerHTML = `
                <h2 style="color: #fe2c55;">${pageInfo.title}</h2>
                <p style="font-size: 1.1em; margin: 15px 0;">${pageInfo.description}</p>
                <div class="feature-list">
                    ${pageInfo.features.map(feature => `
                        <div class="feature-item">${feature}</div>
                    `).join('')}
                </div>
            `;

            // Add interactive demo
            const demoContainer = document.createElement('div');
            demoContainer.className = 'demo-container';
            demoContainer.appendChild(pageInfo.demoAction());
            section.appendChild(demoContainer);

            // Add try it button
            const tryButton = document.createElement('button');
            tryButton.className = 'nav-button';
            tryButton.textContent = 'Try It Now';
            tryButton.onclick = () => {
                window.location.href = `${pageKey}.html`;
            };
            section.appendChild(tryButton);

            return section;
        }

        // Navigation controls
        const navControls = document.createElement('div');
        navControls.style.cssText = `
            display: flex;
            justify-content: center;
            gap: 10px;
            margin-top: 20px;
        `;

        const pages = Object.keys(pageDescriptions);
        let currentPageIndex = 0;

        function updateContent() {
            contentContainer.innerHTML = '';
            const content = createSectionContent(pages[currentPageIndex]);
            if (content) {
                contentContainer.appendChild(content);
            }
        }

        // Previous button
        const prevButton = document.createElement('button');
        prevButton.className = 'nav-button';
        prevButton.textContent = '← Previous';
        prevButton.onclick = () => {
            if (currentPageIndex > 0) {
                currentPageIndex--;
                updateContent();
            }
        };

        // Next button
        const nextButton = document.createElement('button');
        nextButton.className = 'nav-button';
        nextButton.textContent = 'Next →';
        nextButton.onclick = () => {
            if (currentPageIndex < pages.length - 1) {
                currentPageIndex++;
                updateContent();
            } else {
                // Complete the tour
                navGuideOverlay.remove();
                const guidanceData = this.getGuidanceData();
                guidanceData.hasCompletedNavigationGuide = true;
                this.saveGuidanceData(guidanceData);
            }
        };

        // Close button
        const closeButton = document.createElement('button');
        closeButton.className = 'nav-button';
        closeButton.textContent = '✕ Close Guide';
        closeButton.onclick = () => {
            navGuideOverlay.remove();
            const guidanceData = this.getGuidanceData();
            guidanceData.hasCompletedNavigationGuide = true;
            this.saveGuidanceData(guidanceData);
        };

        navControls.appendChild(prevButton);
        navControls.appendChild(nextButton);
        navControls.appendChild(closeButton);

        // Initial content setup
        updateContent();

        navGuideOverlay.appendChild(contentContainer);
        navGuideOverlay.appendChild(navControls);
        document.body.appendChild(navGuideOverlay);
    }

    // Modify help button to always show navigation guide
    addHelpButton() {
        const helpButton = document.createElement('button');
        helpButton.textContent = '?';
        helpButton.style.cssText = `
            position: fixed;
            top: calc(var(--button-top-position, 5rem) + 7rem);
            left: 1.25rem;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background-color: #fe2c55;
            color: white;
            border: none;
            font-size: 24px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            cursor: pointer;
            z-index: 1000;
            transition: all 0.3s ease;
        `;

        helpButton.addEventListener('click', () => {
            // Always show full navigation guide
            this.showNavigationGuide();
        });

        // Add mobile responsiveness
        const updateHelpButtonPosition = () => {
            if (window.innerWidth <= 768) {
                helpButton.style.top = 'var(--button-top-position-mobile, 4rem)';
                helpButton.style.left = '-100%rem';
            } else {
                helpButton.style.top = 'var(--button-top-position, 5rem)';
                helpButton.style.left = '-100%rem';
            }
        };

        // Initial position
        updateHelpButtonPosition();

        // Update on resize
        window.addEventListener('resize', updateHelpButtonPosition);

        document.body.appendChild(helpButton);
    }
}

// Initialize user guidance
const userGuidance = new UserGuidance();

// Add help button to all pages
userGuidance.addHelpButton();

export default userGuidance;

