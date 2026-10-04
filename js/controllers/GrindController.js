/**
 * GrindController - Main orchestrator for grind.html
 * Initializes all controllers and coordinates functionality
 */
import timerController from './TimerController.js';
import taskDisplayController from './TaskDisplayController.js';
import energyController from './EnergyController.js';
import quoteController from './QuoteController.js';
import taskCreationController from './TaskCreationController.js';
import statsController from './StatsController.js';
import subjectMaterialController from './SubjectMaterialController.js';
import simulationUIController from './SimulationUIController.js';
import SimulationEnhancer from '../simulation-enhancer.js'; // Adjust path if needed, assuming js/simulation-enhancer.js relative to controllers? No, relative to this file. js/controllers -> ../simulation-enhancer.js
// Import taskAttachments to ensure the module loads and window.taskAttachments is set
import '../taskAttachments.js';
// Compatibility layer for legacy inline scripts
import './GrindCompatibility.js';

class GrindController {
    constructor() {
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        console.log('🚀 GrindController initializing...');

        try {
            // Initialize controllers
            timerController.init();
            taskDisplayController.init();
            energyController.init();
            quoteController.init();
            taskCreationController.init();
            statsController.init();
            subjectMaterialController.init();
            simulationUIController.init();

            // Setup global utilities
            this._setupGlobalUtilities();
            this._setupWorkspacePanel();
            this._setupProfileScroll();
            this._setupTheme();
            this._updateCurrentTime();
            this._setupDebugMode();
            this._setupSimulationEnhancer();

            // Data initialization is handled by DataInitializationService in grind.html
            // Removed deprecated initializeFirestoreData call

            this.initialized = true;
            console.log('✅ GrindController initialized successfully');
        } catch (error) {
            console.error('❌ GrindController initialization failed:', error);
        }
    }

    _setupGlobalUtilities() {
        // Safe event listener helper
        window.safeAddEventListener = (selector, event, handler) => {
            const el = document.querySelector(selector);
            if (el) el.addEventListener(event, handler);
        };

        // Safe class toggle helper
        window.safeToggleClass = (selector, className, condition) => {
            const el = document.querySelector(selector);
            if (el?.classList) {
                condition ? el.classList.add(className) : el.classList.remove(className);
                return true;
            }
            return false;
        };
    }

    _setupWorkspacePanel() {
        const panel = document.getElementById('workspacePanel');
        const toggle = document.getElementById('workspaceToggle');
        const close = document.getElementById('workspaceClose');
        const container = document.querySelector('.container');

        if (!panel || !toggle) return;

        let isAnimating = false;

        const handleTransitionEnd = (e) => {
            if (e.propertyName === 'right') {
                isAnimating = false;
                const isCurrentlyOpen = panel.classList.contains('open');
                if (!isCurrentlyOpen) {
                    panel.style.visibility = 'hidden';
                    panel.style.display = 'none';
                }
                panel.removeEventListener('transitionend', handleTransitionEnd);
            }
        };

        const toggleWorkspace = () => {
            if (isAnimating) return;
            isAnimating = true;

            const isCurrentlyOpen = panel.classList.contains('open');

            if (!isCurrentlyOpen) {
                // Opening
                panel.style.display = 'flex';
                panel.style.visibility = 'visible';
                void panel.offsetWidth; // Force reflow

                requestAnimationFrame(() => {
                    panel.classList.add('open');
                    if (container) container.classList.add('workspace-open');
                    if (window.innerWidth > 768) {
                        toggle.style.right = 'calc(50% + 20px)';
                    }
                });
            } else {
                // Closing
                panel.classList.remove('open');
                if (container) container.classList.remove('workspace-open');
                toggle.style.right = '20px';
            }

            // Clean up old listener before adding new one
            panel.removeEventListener('transitionend', handleTransitionEnd);
            panel.addEventListener('transitionend', handleTransitionEnd);
        };

        // Clear existing listeners
        if (toggle.onclick) toggle.onclick = null;
        if (close && close.onclick) close.onclick = null;

        toggle.addEventListener('click', toggleWorkspace);
        if (close) close.addEventListener('click', toggleWorkspace);

        // Resize handler
        window.addEventListener('resize', () => {
            const isOpen = panel.classList.contains('open');
            if (window.innerWidth <= 768) {
                toggle.style.right = '20px';
            } else if (isOpen) {
                toggle.style.right = 'calc(50% + 20px)';
            }
        });
    }

    _updateCurrentTime() {
        const update = () => {
            const el = document.getElementById('currentTime');
            if (el) {
                el.textContent = new Date().toLocaleTimeString('en-US', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
                });
            }
        };
        update();
        setInterval(update, 1000);
    }

    _setupProfileScroll() {
        let lastScrollTop = 0;
        window.addEventListener('scroll', () => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            if (scrollTop < lastScrollTop || scrollTop < 100) {
                // Scrolling up or near top
                if (window.safeToggleClass) window.safeToggleClass('.profile-icon', 'visible', true);
            } else {
                // Scrolling down
                if (window.safeToggleClass) window.safeToggleClass('.profile-icon', 'visible', false);
            }
            lastScrollTop = scrollTop;
        });
        // Show initially if at top of page
        if (window.pageYOffset < 100) {
            if (window.safeToggleClass) window.safeToggleClass('.profile-icon', 'visible', true);
        }
    }

    _setupDebugMode() {
        // Keyboard shortcut for task manager debug mode (Ctrl+Shift+D)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                e.preventDefault();
                if (typeof window.toggleTaskManagerDebug === 'function') {
                    const debugEnabled = window.toggleTaskManagerDebug();
                    document.body.classList.toggle('task-debug-mode', debugEnabled);
                }
            }
        });

        // Check load state
        if (localStorage.getItem('debugTaskManager') === 'true' && window.currentTaskManager) {
            document.body.classList.add('task-debug-mode');
        }
    }

    _setupSimulationEnhancer() {
        // Ensure any existing LaTeX content is rendered
        setTimeout(() => {
            if (typeof window.ensureLatexRendering === 'function') window.ensureLatexRendering();
        }, 500);

        // Override the original renderSimulation function to add enhancement
        const originalRenderSimulation = window.renderSimulation;

        if (originalRenderSimulation) {
            window.renderSimulation = function (code, iframe) {
                // Call the original function first
                originalRenderSimulation(code, iframe);

                // Then enhance the simulation with multi-sensory features
                setTimeout(() => {
                    // Create a new simulation enhancer for this iframe
                    const enhancer = new SimulationEnhancer(iframe);
                    // Store the enhancer instance for future reference
                    iframe.enhancer = enhancer;
                    console.log('Simulation enhanced with multi-sensory features');
                }, 500);
            };
            console.log('Simulation rendering function enhanced');
        }
    }

    _setupTheme() {
        if (typeof window !== 'undefined' && window.themeManager?.initializeTheme) {
            window.themeManager.initializeTheme();
        }
        window.toggleTheme = () => {
            if (typeof window !== 'undefined' && window.themeManager?.toggleTheme) {
                return window.themeManager.toggleTheme();
            }
            const body = document.body;
            const isLight = body.classList.toggle('light-theme');
            const nextTheme = isLight ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', nextTheme);
            try { localStorage.setItem('theme', nextTheme); } catch {}
            return nextTheme;
        };
    }
}

const grindController = new GrindController();
export default grindController;

// Auto-initialize on DOM ready
if (typeof window !== 'undefined') {
    window.grindController = grindController;
    document.addEventListener('DOMContentLoaded', () => grindController.init());
}
