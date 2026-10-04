/**
 * ToastService - Centralized notification/toast management
 * 
 * Provides a unified API for showing notifications across the application.
 * Uses Bootstrap Toast component when available, falls back to custom implementation.
 * 
 * @module ToastService
 */

/**
 * Toast configuration defaults
 */
const DEFAULTS = {
    duration: 3000,
    position: 'bottom-right',
    animation: true
};

/**
 * Toast types with their styling
 */
const TOAST_TYPES = {
    success: {
        bgClass: 'bg-success',
        icon: 'bi-check-circle-fill',
        textClass: 'text-white'
    },
    error: {
        bgClass: 'bg-danger',
        icon: 'bi-exclamation-triangle-fill',
        textClass: 'text-white'
    },
    warning: {
        bgClass: 'bg-warning',
        icon: 'bi-exclamation-circle-fill',
        textClass: 'text-dark'
    },
    info: {
        bgClass: 'bg-info',
        icon: 'bi-info-circle-fill',
        textClass: 'text-white'
    }
};

/**
 * Creates or gets the toast container element
 * @returns {HTMLElement} Toast container
 */
function getToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        container.style.zIndex = '1100';
        document.body.appendChild(container);
    }
    return container;
}

/**
 * Creates a toast element
 * @param {string} message - Toast message
 * @param {string} type - Toast type (success, error, warning, info)
 * @param {Object} options - Additional options
 * @returns {HTMLElement} Toast element
 */
function createToastElement(message, type, options = {}) {
    const typeConfig = TOAST_TYPES[type] || TOAST_TYPES.info;
    const duration = options.duration || DEFAULTS.duration;

    const toast = document.createElement('div');
    toast.className = `toast align-items-center ${typeConfig.bgClass} ${typeConfig.textClass} border-0`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    toast.setAttribute('data-bs-delay', duration.toString());

    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body d-flex align-items-center gap-2">
                <i class="bi ${typeConfig.icon}"></i>
                <span>${escapeHtml(message)}</span>
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;

    return toast;
}

/**
 * Escapes HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Shows a toast notification
 * @param {string} message - Message to display
 * @param {string} type - Toast type
 * @param {Object} options - Additional options
 */
function showToast(message, type = 'info', options = {}) {
    const container = getToastContainer();
    const toastElement = createToastElement(message, type, options);
    container.appendChild(toastElement);

    // Use Bootstrap Toast if available
    if (window.bootstrap && window.bootstrap.Toast) {
        const bsToast = new window.bootstrap.Toast(toastElement, {
            autohide: true,
            delay: options.duration || DEFAULTS.duration
        });

        toastElement.addEventListener('hidden.bs.toast', () => {
            toastElement.remove();
        });

        bsToast.show();
    } else {
        // Fallback: manual show/hide
        toastElement.classList.add('show');
        setTimeout(() => {
            toastElement.classList.remove('show');
            setTimeout(() => toastElement.remove(), 300);
        }, options.duration || DEFAULTS.duration);
    }
}

/**
 * ToastService public API
 */
export const ToastService = {
    /**
     * Show a success toast
     * @param {string} message - Success message
     * @param {Object} options - Additional options
     */
    success(message, options = {}) {
        showToast(message, 'success', options);
    },

    /**
     * Show an error toast
     * @param {string} message - Error message
     * @param {Object} options - Additional options
     */
    error(message, options = {}) {
        showToast(message, 'error', options);
    },

    /**
     * Show a warning toast
     * @param {string} message - Warning message
     * @param {Object} options - Additional options
     */
    warning(message, options = {}) {
        showToast(message, 'warning', options);
    },

    /**
     * Show an info toast
     * @param {string} message - Info message
     * @param {Object} options - Additional options
     */
    info(message, options = {}) {
        showToast(message, 'info', options);
    },

    /**
     * Generic show method
     * @param {string} message - Message
     * @param {string} type - Toast type
     * @param {Object} options - Additional options
     */
    show(message, type = 'info', options = {}) {
        showToast(message, type, options);
    }
};

// Make available globally for non-module scripts
if (typeof window !== 'undefined') {
    window.ToastService = ToastService;
}

export default ToastService;
