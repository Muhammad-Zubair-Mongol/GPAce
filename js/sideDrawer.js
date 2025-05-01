class SideDrawer {
    constructor() {
        this.isOpen = false;
        this.init();
        this.initializeAuth();
    }

    init() {
        // Create drawer HTML
        const drawer = document.createElement('div');
        drawer.className = 'side-drawer';
        drawer.innerHTML = `
            <div class="drawer-content">
                <button class="drawer-close">&times;</button>
                <div class="drawer-header">
                    <h3>Settings</h3>
                </div>
                <div class="drawer-body">
                    <div id="userProfile" class="user-profile">
                        <!-- Profile content will be dynamically updated -->
                    </div>
                    <button id="authButton" class="auth-button">
                        <i class="fas fa-sign-in-alt"></i>
                        Sign In
                    </button>
                    <div class="theme-section">
                        <h4>Theme</h4>
                        <div class="theme-buttons">
                            <button class="theme-btn light-theme" data-theme="light">
                                <i class="bi bi-sun-fill"></i>
                                Light
                            </button>
                            <button class="theme-btn dark-theme" data-theme="dark">
                                <i class="bi bi-moon-fill"></i>
                                Dark
                            </button>
                        </div>
                    </div>
                    <div class="drawer-links">
                        <a href="settings.html" class="drawer-link">
                            <i class="bi bi-gear"></i>
                            Settings
                        </a>
                        <a href="sleep-saboteurs.html" class="drawer-link">
                            <i class="bi bi-clock"></i>
                            Sleep Saboteurs
                        </a>
                        <a href="priority-calculator.html" class="drawer-link">
                            <i class="bi bi-calculator"></i>
                            Priority Calculator
                        </a>
                    </div>
                </div>
            </div>
        `;

        // Add drawer to body
        document.body.appendChild(drawer);

        // Add drawer toggle button if it doesn't exist
        if (!document.querySelector('.drawer-toggle')) {
            const toggleButton = document.createElement('button');
            toggleButton.className = 'drawer-toggle';
            toggleButton.innerHTML = '<i class="bi bi-gear"></i>';
            document.querySelector('.nav-links').appendChild(toggleButton);
        }

        // Event listeners
        this.setupEventListeners();
    }

    setupEventListeners() {
        const drawerToggle = document.querySelector('.drawer-toggle');
        const drawerClose = document.querySelector('.drawer-close');
        const authButton = document.getElementById('authButton');

        if (drawerToggle) {
            drawerToggle.addEventListener('click', () => this.toggleDrawer());
        }

        if (drawerClose) {
            drawerClose.addEventListener('click', () => this.closeDrawer());
        }

        if (authButton) {
            authButton.addEventListener('click', () => this.handleAuth());
        }

        // Theme buttons
        const themeButtons = document.querySelectorAll('.theme-btn');
        themeButtons.forEach(button => {
            button.addEventListener('click', () => this.handleThemeChange(button.dataset.theme));
        });
    }

    async handleAuth() {
        const auth = window.auth; // Get auth instance from window

        if (auth.currentUser) {
            try {
                await window.signOutUser();
                console.log('User signed out successfully');
                // Refresh page after sign out
                location.reload();
            } catch (error) {
                console.error('Error signing out:', error);
            }
        } else {
            try {
                await window.signInWithGoogle();
                console.log('User signed in successfully');
                // Wait a moment for auth state to update
                setTimeout(() => {
                    console.log('🔄 Refreshing page to load user data...');
                    location.reload();
                }, 1000);
            } catch (error) {
                console.error('Error signing in:', error);
            }
        }
    }

    updateUIForUser(user) {
        const authButton = document.getElementById('authButton');
        const userProfile = document.getElementById('userProfile');

        if (authButton && userProfile) {
            // Update auth button
            authButton.innerHTML = `
                <img src="${user.photoURL || 'default-avatar.png'}" alt="${user.displayName}" class="user-avatar">
                <span class="user-name">${user.displayName || user.email}</span>
                <button id="sideDrawerSignOutBtn" class="logout-btn">Sign Out</button>
            `;

            // Add event listener to the sign out button
            const signOutBtn = document.getElementById('sideDrawerSignOutBtn');
            if (signOutBtn) {
                signOutBtn.addEventListener('click', () => this.handleAuth());
            }

            // Show user profile
            userProfile.style.display = 'flex';

            // Initialize data if needed
            if (typeof window.initializeFirestoreData === 'function') {
                window.initializeFirestoreData();
            }
        }
    }

    updateUIForSignedOut() {
        const authButton = document.getElementById('authButton');
        const userProfile = document.getElementById('userProfile');

        if (authButton && userProfile) {
            // Reset auth button
            authButton.innerHTML = `
                <i class="fas fa-sign-in-alt"></i>
                Sign In
            `;

            // Hide user profile
            userProfile.style.display = 'none';
        }
    }

    initializeAuth() {
        // Listen for auth state changes
        if (window.auth) {
            window.auth.onAuthStateChanged(user => {
                if (user) {
                    this.updateUIForUser(user);
                } else {
                    this.updateUIForSignedOut();
                }
            });
        }
    }

    toggleDrawer() {
        const drawer = document.querySelector('.side-drawer');
        if (drawer) {
            this.isOpen = !this.isOpen;
            drawer.classList.toggle('open', this.isOpen);
        }
    }

    closeDrawer() {
        const drawer = document.querySelector('.side-drawer');
        if (drawer) {
            this.isOpen = false;
            drawer.classList.remove('open');
        }
    }

    handleThemeChange(theme) {
        const body = document.body;
        const themeButtons = document.querySelectorAll('.theme-btn');

        // Update theme
        if (theme === 'light') {
            body.classList.add('light-theme');
            localStorage.setItem('theme', 'light');
        } else {
            body.classList.remove('light-theme');
            localStorage.setItem('theme', 'dark');
        }

        // Update active state of theme buttons
        themeButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.theme === theme);
        });
    }
}

// Initialize drawer
document.addEventListener('DOMContentLoaded', () => {
    window.sideDrawer = new SideDrawer();
});
