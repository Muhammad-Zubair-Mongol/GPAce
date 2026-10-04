/**
 * workspace-ui.js
 * Handles UI elements like toast notifications, theme toggling, etc.
 */

/**
 * Show toast notification
 */
function showToast(message, type = 'info', duration = 2000) {
    // Create a unique ID for this toast
    const toastId = 'toast-' + Date.now();

    // Truncate message if it's too long
    let displayMessage = message;
    if (message.length > 50) {
        displayMessage = message.substring(0, 47) + '...';
    }

    // Get appropriate icon for the message type
    let icon;
    switch (type) {
        case 'success':
            icon = 'check-circle-fill';
            break;
        case 'error':
            icon = 'exclamation-circle-fill';
            break;
        case 'warning':
            icon = 'exclamation-triangle-fill';
            break;
        default:
            icon = 'info-circle-fill';
    }

    // Create a new toast element
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = `status-message ${type}`;
    toast.innerHTML = `
        <i class="bi bi-${icon}"></i>
        <span>${displayMessage}</span>
        ${duration > 0 ? '<button class="toast-close" onclick="hideToast(\'' + toastId + '\')">&times;</button>' : ''}
    `;

    // Add title for full message on hover
    if (message.length > 50) {
        toast.title = message;
    }

    // Add the toast to the document
    const statusBar = document.querySelector('.status-bar');
    if (statusBar) statusBar.before(toast);
    else document.body.appendChild(toast);
    toast.setAttribute('role', 'status');

    // Show the toast with a slight delay for animation
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0) scale(1)';
    }, 10);

    // Auto-hide after duration (if not persistent)
    if (duration > 0) {
        setTimeout(() => {
            hideToast(toastId);
        }, duration);
    }

    // Limit the number of toasts to 3 at a time
    const toasts = document.querySelectorAll('.status-message');
    if (toasts.length > 3) {
        for (let i = 0; i < toasts.length - 3; i++) {
            if (toasts[i].id !== toastId) {
                hideToast(toasts[i].id);
            }
        }
    }

    return toastId;
}

/**
 * Hide toast notification
 */
function hideToast(id) {
    const toast = document.getElementById(id);
    if (toast) {
        // Fade out and slide up
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px) scale(0.95)';

        // Remove after animation completes
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }
}

/**
 * Toggle theme between light and dark
 */
// Helper function to abstract storage access
function getStorage() {
    if (window.StorageService) {
        return window.StorageService;
    }
    return {
        get: (key, defaultValue) => {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (e) {
                // If parsing fails, it might be a raw string (like theme)
                return localStorage.getItem(key) || defaultValue;
            }
        },
        set: (key, value) => {
            if (typeof value === 'string') {
                localStorage.setItem(key, value);
            } else {
                localStorage.setItem(key, JSON.stringify(value));
            }
        }
    };
}

function toggleTheme() {
    if (typeof window !== 'undefined' && window.themeManager?.toggleTheme) {
        return window.themeManager.toggleTheme();
    }
    const storage = getStorage();
    const body = document.body;
    const isLight = body.classList.toggle('light-theme');
    const nextTheme = isLight ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    storage.set('theme', nextTheme);
    try { localStorage.setItem('theme', nextTheme); } catch {}
    return nextTheme;
}

/**
 * Set initial theme based on localStorage
 */
function initTheme() {
    if (typeof window !== 'undefined' && window.themeManager?.initializeTheme) {
        return window.themeManager.initializeTheme();
    }
    const storage = getStorage();
    const savedTheme = storage.get('theme', 'dark');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        document.documentElement.setAttribute('data-theme', 'light');
    }
}

/**
 * Listen for theme changes from other tabs
 */
function setupThemeListener() {
    // Cross-tab synchronization is canonically handled by ThemeManager
}

// Initialize theme
document.addEventListener('DOMContentLoaded', () => {
    if (!window.themeManager) {
        initTheme();
    }
});

// ============================================
// Module Exports (ES Modules - preferred)
// ============================================
export {
    showToast,
    hideToast,
    toggleTheme,
    initTheme,
    setupThemeListener
};

// ============================================
// Global Registration (for HTML onclick compatibility)
// ============================================
const registerGlobal = (name, value, module) => {
    window[name] = value;
    if (window.DEBUG_GLOBALS) {
        console.log(`[workspace-ui] Registered global: ${name}`);
    }
};

// Register functions that need to be called from HTML (e.g., onclick="hideToast('...')")
registerGlobal('showToast', showToast, 'workspace-ui');
registerGlobal('hideToast', hideToast, 'workspace-ui');
registerGlobal('toggleTheme', toggleTheme, 'workspace-ui');
