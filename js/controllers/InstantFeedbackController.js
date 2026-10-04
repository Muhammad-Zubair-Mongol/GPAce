/**
 * InstantFeedbackController.js
 * Centralized event handling for instant-test-feedback.html using event delegation.
 * Part of Batch 3: Inline Handler Extraction.
 */

class InstantFeedbackController {
    constructor() {
        this.initialized = false;
        this.handlers = new Map();
        this.registerHandlers();
    }

    init() {
        if (this.initialized) {
            console.warn('[InstantFeedbackController] Already initialized');
            return;
        }

        document.addEventListener('click', (e) => this.handleClick(e));
        document.addEventListener('change', (e) => this.handleChange(e));
        document.addEventListener('input', (e) => this.handleInput(e));

        this.initialized = true;
        console.log('[InstantFeedbackController] Initialized with event delegation');
    }

    registerHandlers() {
        // API Settings Actions
        this.register('toggle-api-visibility', (el) => {
            const target = el.dataset.target;
            window.toggleApiVisibility?.(target);
        });
        this.register('save-api-keys', () => window.saveApiKeys?.());
        this.register('open-api-settings', () => window.openApiSettings?.());

        // Analysis Actions
        this.register('analyze-text', () => {
            document.getElementById('analyzeTextBtn')?.click();
        });
        this.register('analyze-images', () => {
            document.getElementById('analyzeImagesBtn')?.click();
        });

        // Results Actions
        this.register('download-pdf', () => {
            document.getElementById('downloadPdfBtn')?.click();
        });
        this.register('copy-results', () => {
            document.getElementById('copyResultsBtn')?.click();
        });
        this.register('save-results', () => {
            document.getElementById('saveResultsBtn')?.click();
        });

        // Theme Actions
        this.register('toggle-theme', () => window.toggleTheme?.());

        // Navigation
        this.register('navigate', (el) => {
            const url = el.dataset.url;
            if (url) window.location.href = url;
        });
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
                console.error(`[InstantFeedbackController] Error in action "${action}":`, error);
            }
        } else {
            console.warn(`[InstantFeedbackController] Unknown action: ${action}`);
        }
    }

    handleChange(e) {
        const actionElement = e.target.closest('[data-change]');
        if (!actionElement) return;

        const action = actionElement.dataset.change;

        switch (action) {
            case 'update-model':
                // Handle model selection change
                break;
            default:
                console.warn(`[InstantFeedbackController] Unknown change action: ${action}`);
        }
    }

    handleInput(e) {
        const actionElement = e.target.closest('[data-input]');
        if (!actionElement) return;

        const action = actionElement.dataset.input;

        switch (action) {
            case 'update-temperature':
                window.updateTemperatureDisplay?.(e.target.value);
                break;
            default:
                console.warn(`[InstantFeedbackController] Unknown input action: ${action}`);
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
const instantFeedbackController = new InstantFeedbackController();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => instantFeedbackController.init());
} else {
    instantFeedbackController.init();
}

// Export for ES modules
export { instantFeedbackController, InstantFeedbackController };
export default instantFeedbackController;

// Register globally
window.instantFeedbackController = instantFeedbackController;
