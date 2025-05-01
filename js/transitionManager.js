class TransitionManager {
    constructor() {
        this.init();
    }

    init() {
        // Initialize intersection observer for scroll-based animations
        this.setupScrollAnimations();
        
        // Initialize page transition observers
        this.setupPageTransitions();
        
        // Add transition classes to interactive elements
        this.setupInteractiveElements();
    }

    setupScrollAnimations() {
        const options = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('fade-in');
                    // Play transition sound
                    if (window.soundManager) {
                        window.soundManager.playSound('transition', 'default');
                    }
                }
            });
        }, options);

        // Observe all animatable elements
        document.querySelectorAll('.animatable').forEach(element => {
            observer.observe(element);
        });
    }

    setupPageTransitions() {
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link && link.href && !link.target && !e.ctrlKey && !e.shiftKey) {
                e.preventDefault();
                this.transitionToPage(link.href);
            }
        });
    }

    async transitionToPage(href) {
        // Play transition sound
        if (window.soundManager) {
            window.soundManager.playSound('transition', 'page');
        }

        // Add exit animation
        document.body.classList.add('page-exit');

        // Wait for animation
        await new Promise(resolve => setTimeout(resolve, 300));

        // Navigate to new page
        window.location.href = href;
    }

    setupInteractiveElements() {
        // Add hover effect classes
        document.querySelectorAll('.interactive-button, button, a').forEach(element => {
            element.addEventListener('mouseenter', () => {
                element.classList.add('hover-effect');
            });

            element.addEventListener('mouseleave', () => {
                element.classList.remove('hover-effect');
            });

            // Add click effect
            element.addEventListener('click', () => {
                element.classList.add('click-effect');
                setTimeout(() => {
                    element.classList.remove('click-effect');
                }, 200);
            });
        });
    }

    // Utility method to add transition to any element
    addTransition(element, type = 'fade') {
        switch(type) {
            case 'fade':
                element.classList.add('fade-in');
                break;
            case 'slide':
                element.classList.add('slide-in');
                break;
            // Add more transition types as needed
        }
    }
}

// Initialize transition manager
const transitionManager = new TransitionManager();

// Export for use in other modules
window.transitionManager = transitionManager;
