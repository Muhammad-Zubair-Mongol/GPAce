/**
 * RelaxedModeController.js
 * Centralized event handling for relaxed-mode/index.html using event delegation.
 * Part of Batch 3: Inline Handler Extraction.
 */

class RelaxedModeController {
    constructor() {
        this.initialized = false;
        this.handlers = new Map();
        this.registerHandlers();
    }

    init() {
        if (this.initialized) {
            console.warn('[RelaxedModeController] Already initialized');
            return;
        }

        document.addEventListener('click', (e) => this.handleClick(e));
        document.addEventListener('change', (e) => this.handleChange(e));

        this.initialized = true;
        console.log('[RelaxedModeController] Initialized with event delegation');
    }

    registerHandlers() {
        // Task Form Actions
        this.register('show-add-task-form', () => window.showAddTaskForm?.());
        this.register('hide-add-task-form', () => window.hideAddTaskForm?.());
        this.register('save-task', () => window.saveTask?.());

        // Task Management Actions
        this.register('complete-task', (el) => {
            const taskId = el.dataset.taskId;
            window.completeTask?.(taskId);
        });
        this.register('delete-task', (el) => {
            const taskId = el.dataset.taskId;
            window.deleteTask?.(taskId);
        });
        this.register('edit-task', (el) => {
            const taskId = el.dataset.taskId;
            window.editTask?.(taskId);
        });

        // Quick Add Actions
        this.register('open-quick-add', () => {
            document.getElementById('quickAddModal')?.classList.add('show');
        });
        this.register('close-quick-add', () => {
            document.getElementById('quickAddModal')?.classList.remove('show');
        });
        this.register('quick-save-task', () => window.quickSaveTask?.());

        // Navigation
        this.register('navigate', (el) => {
            const url = el.dataset.url;
            if (url) window.location.href = url;
        });
        this.register('back-to-grind', () => {
            window.location.href = '../grind.html';
        });

        // Theme Actions
        this.register('toggle-theme', () => window.toggleTheme?.());
    }

    register(action, handler) {
        this.handlers.set(action, handler);
    }

    handleClick(e) {
        const actionElement = e.target.closest('[data-action]');
        if (!actionElement) return;

        const action = actionElement.dataset.action;
        const handler = this.handlers.get(action);

        if (handler) {
            e.preventDefault();
            e.stopPropagation();
            try {
                handler(actionElement, e);
            } catch (error) {
                console.error(`[RelaxedModeController] Error in action "${action}":`, error);
            }
        } else {
            console.warn(`[RelaxedModeController] Unknown action: ${action}`);
        }
    }

    handleChange(e) {
        const actionElement = e.target.closest('[data-change]');
        if (!actionElement) return;

        const action = actionElement.dataset.change;

        switch (action) {
            case 'update-priority':
                // Handle priority change
                break;
            default:
                console.warn(`[RelaxedModeController] Unknown change action: ${action}`);
        }
    }

    trigger(action, data = {}) {
        const handler = this.handlers.get(action);
        if (handler) {
            const mockElement = { dataset: data };
            handler(mockElement, null);
        }
    }
}

// Create singleton instance
const relaxedModeController = new RelaxedModeController();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => relaxedModeController.init());
} else {
    relaxedModeController.init();
}

// Export for ES modules
export { relaxedModeController, RelaxedModeController };
export default relaxedModeController;

// Register globally
window.relaxedModeController = relaxedModeController;
