class CacheManager {
    constructor() {
        this.criticalResources = [
            'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css',
            'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css',
            'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js',
            'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js',
            'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js',
            'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js'
        ];
        this.init();
    }

    init() {
        // Register service worker
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/service-worker.js')
                    .then(registration => {
                        console.log('ServiceWorker registration successful');
                    })
                    .catch(err => {
                        console.log('ServiceWorker registration failed: ', err);
                    });
            });
        }

        // Preload critical resources
        this.preloadResources();

        // Set up page transition cache
        this.setupPageTransitionCache();
    }

    preloadResources() {
        this.criticalResources.forEach(url => {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = url.endsWith('.css') ? 'style' : 'script';
            link.href = url;
            document.head.appendChild(link);
        });
    }

    setupPageTransitionCache() {
        // Cache pages for smooth transitions
        document.querySelectorAll('a[href^="/"]').forEach(link => {
            link.addEventListener('mouseenter', () => {
                const href = link.getAttribute('href');
                if (href && !href.includes('#')) {
                    const prefetchLink = document.createElement('link');
                    prefetchLink.rel = 'prefetch';
                    prefetchLink.href = href;
                    document.head.appendChild(prefetchLink);
                }
            });
        });
    }

    // Store data in localStorage with expiration
    setWithExpiry(key, value, ttl) {
        const item = {
            value: value,
            expiry: new Date().getTime() + ttl,
        };
        localStorage.setItem(key, JSON.stringify(item));
    }

    // Get data from localStorage, checking expiration
    getWithExpiry(key) {
        const itemStr = localStorage.getItem(key);
        if (!itemStr) return null;

        const item = JSON.parse(itemStr);
        const now = new Date().getTime();

        if (now > item.expiry) {
            localStorage.removeItem(key);
            return null;
        }
        return item.value;
    }

    // Clear expired items from localStorage
    clearExpiredItems() {
        Object.keys(localStorage).forEach(key => {
            this.getWithExpiry(key);
        });
    }
}

// Initialize cache manager
window.cacheManager = new CacheManager(); 