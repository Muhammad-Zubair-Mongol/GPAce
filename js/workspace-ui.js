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
    switch(type) {
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
    document.body.appendChild(toast);

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
function toggleTheme() {
    const body = document.body;
    const themeIcon = document.querySelector('.theme-icon');
    const themeText = document.querySelector('.theme-text');

    if (body.classList.contains('light-theme')) {
        body.classList.remove('light-theme');
        themeIcon.textContent = '🌞';
        themeText.textContent = 'Light Mode';
        localStorage.setItem('theme', 'dark');
    } else {
        body.classList.add('light-theme');
        themeIcon.textContent = '🌙';
        themeText.textContent = 'Dark Mode';
        localStorage.setItem('theme', 'light');
    }
}

/**
 * Set initial theme based on localStorage
 */
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        document.querySelector('.theme-icon').textContent = '🌙';
        document.querySelector('.theme-text').textContent = 'Dark Mode';
    }
}

/**
 * Listen for theme changes from other tabs
 */
function setupThemeListener() {
    window.addEventListener('storage', (e) => {
        if (e.key === 'theme') {
            const body = document.body;
            const themeIcon = document.querySelector('.theme-icon');
            const themeText = document.querySelector('.theme-text');

            if (e.newValue === 'light') {
                body.classList.add('light-theme');
                themeIcon.textContent = '🌙';
                themeText.textContent = 'Dark Mode';
            } else {
                body.classList.remove('light-theme');
                themeIcon.textContent = '🌞';
                themeText.textContent = 'Light Mode';
            }
        }
    });
}

// Initialize theme
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setupThemeListener();
});

// Export functions for other modules
window.showToast = showToast;
window.hideToast = hideToast;
window.toggleTheme = toggleTheme;
