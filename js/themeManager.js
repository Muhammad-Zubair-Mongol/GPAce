/**
 * Theme Manager
 * Handles theme toggling functionality and persistence
 */
class ThemeManager {
    constructor() {
        this.body = document.body;
        this.themeIcon = null;
        this.themeText = null;
        this.themeToggleBtn = null;
        
        // Initialize on DOM content loaded
        document.addEventListener('DOMContentLoaded', () => this.init());
    }

    init() {
        // Create theme toggle button if it doesn't exist
        this.createThemeToggleIfNeeded();
        
        // Get references to theme elements
        this.themeIcon = document.querySelector('.theme-icon');
        this.themeText = document.querySelector('.theme-text');
        
        // Add event listener to theme toggle button
        this.themeToggleBtn = document.querySelector('.theme-toggle');
        if (this.themeToggleBtn) {
            this.themeToggleBtn.addEventListener('click', () => this.toggleTheme());
        }
        
        // Initialize theme based on localStorage
        this.initializeTheme();
    }

    createThemeToggleIfNeeded() {
        // Check if theme toggle button already exists
        if (document.querySelector('.theme-toggle')) {
            return;
        }
        
        // Create theme toggle button
        const themeToggle = document.createElement('button');
        themeToggle.className = 'theme-toggle';
        themeToggle.setAttribute('aria-label', 'Toggle Theme');
        themeToggle.innerHTML = `
            <span class="theme-icon">🌞</span>
            <span class="theme-text">Light Mode</span>
        `;
        
        // Append to body
        document.body.appendChild(themeToggle);
    }

    initializeTheme() {
        // Apply saved theme preference
        if (localStorage.getItem('theme') === 'light') {
            this.body.classList.add('light-theme');
            if (this.themeIcon) this.themeIcon.textContent = '🌚';
            if (this.themeText) this.themeText.textContent = 'Dark Mode';
        } else {
            this.body.classList.remove('light-theme');
            if (this.themeIcon) this.themeIcon.textContent = '🌞';
            if (this.themeText) this.themeText.textContent = 'Light Mode';
        }
    }

    toggleTheme() {
        this.body.classList.toggle('light-theme');

        if (this.body.classList.contains('light-theme')) {
            if (this.themeIcon) this.themeIcon.textContent = '🌚';
            if (this.themeText) this.themeText.textContent = 'Dark Mode';
            localStorage.setItem('theme', 'light');
        } else {
            if (this.themeIcon) this.themeIcon.textContent = '🌞';
            if (this.themeText) this.themeText.textContent = 'Light Mode';
            localStorage.setItem('theme', 'dark');
        }
        
        // Play sound if sound manager is available
        if (window.soundManager) {
            window.soundManager.playSound('click', 'confirm');
        }
    }
}

// Initialize theme manager
const themeManager = new ThemeManager();

// Export for use in other modules
window.themeManager = themeManager;
