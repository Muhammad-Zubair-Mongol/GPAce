/**
 * GPAce Service Worker
 * Provides basic caching for critical resources and offline support
 */

const CACHE_NAME = 'gpace-cache-v1';
const CRITICAL_RESOURCES = [
    '/',
    '/grind.html',
    '/landing.html',
    '/priority-list.html'
];

// Install event - cache essential resources
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing');

    // Skip waiting to activate immediately
    self.skipWaiting();

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching critical resources');
                // Use addAll with error handling for each resource
                return Promise.allSettled(
                    CRITICAL_RESOURCES.map(url =>
                        cache.add(url).catch(err => {
                            console.warn(`[Service Worker] Failed to cache ${url}:`, err);
                        })
                    )
                );
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating');

    // Claim all clients immediately
    event.waitUntil(self.clients.claim());

    // Clean up old caches
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Removing old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Fetch event - network-first strategy for HTML, cache-first for static assets
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // For HTML pages, use network-first strategy
    if (event.request.mode === 'navigate' ||
        event.request.headers.get('accept')?.includes('text/html')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Cache successful responses
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Fallback to cache if network fails
                    return caches.match(event.request);
                })
        );
        return;
    }

    // For static assets (CSS, JS, images), use cache-first strategy
    if (url.pathname.endsWith('.css') ||
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.png') ||
        url.pathname.endsWith('.jpg') ||
        url.pathname.endsWith('.svg') ||
        url.pathname.endsWith('.ico')) {
        event.respondWith(
            caches.match(event.request)
                .then((response) => {
                    if (response) {
                        // Return cached response and update cache in background
                        fetch(event.request).then((networkResponse) => {
                            if (networkResponse.ok) {
                                caches.open(CACHE_NAME).then((cache) => {
                                    cache.put(event.request, networkResponse);
                                });
                            }
                        }).catch(() => { });
                        return response;
                    }

                    // Not in cache, fetch from network
                    return fetch(event.request).then((networkResponse) => {
                        if (networkResponse.ok) {
                            const responseClone = networkResponse.clone();
                            caches.open(CACHE_NAME).then((cache) => {
                                cache.put(event.request, responseClone);
                            });
                        }
                        return networkResponse;
                    });
                })
        );
        return;
    }
});

// Handle messages from main thread
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.delete(CACHE_NAME).then(() => {
            console.log('[Service Worker] Cache cleared');
        });
    }
});