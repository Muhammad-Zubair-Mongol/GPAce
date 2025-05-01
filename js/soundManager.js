class SoundManager {
    constructor() {
        this.sounds = {
            click: {
                default: new Audio('sounds/click.mp3'),
                soft: new Audio('sounds/click-soft.mp3'),
                confirm: new Audio('sounds/click-confirm.mp3')
            },
            hover: {
                default: new Audio('sounds/hover.mp3'),
                menu: new Audio('sounds/hover-menu.mp3')
            },
            scroll: {
                default: new Audio('sounds/scroll.mp3'),
                end: new Audio('sounds/scroll-end.mp3')
            },
            transition: {
                default: new Audio('sounds/transition.mp3'),
                page: new Audio('sounds/page-transition.mp3')
            }
        };
        
        this.enabled = true;
        this.volume = 0.5;
        this.init();
    }

    init() {
        // Initialize sound toggle button
        const toggleButton = document.getElementById('toggleSound');
        if (toggleButton) {
            toggleButton.addEventListener('click', () => this.toggleSound());
        }

        // Load sound preference from localStorage
        this.enabled = localStorage.getItem('soundEnabled') !== 'false';
        this.updateSoundIcon();

        // Initialize interaction sounds
        this.initializeInteractionSounds();
    }

    initializeInteractionSounds() {
        // Click sounds for interactive elements
        document.addEventListener('click', (e) => {
            if (e.target.closest('.interactive-button')) {
                this.playSound('click', 'confirm');
            } else if (e.target.matches('button, a, input[type="submit"]')) {
                this.playSound('click', 'default');
            }
        });

        // Hover sounds
        document.addEventListener('mouseover', (e) => {
            if (e.target.matches('button, a, .interactive-button')) {
                this.playSound('hover', 'default');
            }
        });

        // Scroll sounds (debounced)
        let scrollTimeout;
        document.addEventListener('scroll', () => {
            if (scrollTimeout) clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                this.playSound('scroll', 'default');
            }, 150);
        });
    }

    playSound(category, variant = 'default') {
        if (!this.enabled) return;
        
        const sound = this.sounds[category]?.[variant];
        if (sound) {
            sound.volume = this.volume;
            sound.currentTime = 0;
            sound.play().catch(error => {
                console.warn('Sound playback failed:', error);
            });
        }
    }

    toggleSound() {
        this.enabled = !this.enabled;
        localStorage.setItem('soundEnabled', this.enabled);
        this.updateSoundIcon();
        
        // Play feedback sound if enabling
        if (this.enabled) {
            this.playSound('click', 'confirm');
        }
    }

    updateSoundIcon() {
        const icon = document.querySelector('.sound-icon');
        if (icon) {
            icon.textContent = this.enabled ? '🔊' : '🔇';
        }
    }

    setVolume(level) {
        this.volume = Math.max(0, Math.min(1, level));
    }
}

// Initialize sound manager
const soundManager = new SoundManager();

// Export for use in other modules
window.soundManager = soundManager;
