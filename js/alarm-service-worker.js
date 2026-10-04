// Pomodoro Timer Service Worker
// Version: 1.0.0

const CACHE_NAME = 'pomodoro-timer-cache-v1';
const ASSETS_TO_CACHE = [
  '/pop.mp3',
  '/icons/timer-icon.png'
];

// Install event - cache necessary files
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing Service Worker');
  
  // Skip waiting to ensure the new service worker activates immediately
  self.skipWaiting();
  
  // Cache essential assets
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching app assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating Service Worker');
  
  // Claim clients to ensure the service worker controls all clients
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

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Received message:', event.data);
  
  if (event.data && event.data.type === 'POMODORO_TIMER') {
    const { endTime, timerState, pomodoroCount } = event.data;
    
    // Schedule notification for when timer ends
    if (endTime) {
      const timeUntilEnd = endTime - Date.now();
      
      if (timeUntilEnd > 0) {
        console.log(`[Service Worker] Scheduling notification in ${timeUntilEnd}ms`);
        
        setTimeout(() => {
          // Check if we should show notification (only if no clients are visible)
          self.clients.matchAll({ type: 'window' })
            .then((clients) => {
              const visibleClient = clients.find(client => client.visibilityState === 'visible');
              
              if (!visibleClient) {
                // No visible clients, show notification
                const title = timerState === 'focus' ? 'Break Time!' : 'Focus Time!';
                const body = timerState === 'focus' 
                  ? 'Great job! Take a break.' 
                  : 'Break is over. Time to focus!';
                
                self.registration.showNotification(title, {
                  body: body,
                  icon: '/icons/timer-icon.png',
                  vibrate: [100, 50, 100],
                  tag: 'pomodoro-notification',
                  data: {
                    timerState: timerState,
                    pomodoroCount: pomodoroCount
                  }
                });
              }
            });
        }, timeUntilEnd);
      }
    }
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification click received');
  
  event.notification.close();
  
  // Open or focus the app when notification is clicked
  event.waitUntil(
    self.clients.matchAll({ type: 'window' })
      .then((clientList) => {
        // If a window client is already open, focus it
        for (const client of clientList) {
          if (client.url.includes('/grind.html') && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow('/grind.html');
        }
      })
  );
});

// Fetch event - serve cached assets when offline
self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') return;
  
  // For audio files and icons, try the cache first
  if (event.request.url.includes('/pop.mp3') || 
      event.request.url.includes('/icons/')) {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          // Return cached response if found
          if (response) {
            return response;
          }
          
          // Otherwise fetch from network
          return fetch(event.request)
            .then((networkResponse) => {
              // Cache the fetched response
              return caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, networkResponse.clone());
                  return networkResponse;
                });
            });
        })
    );
  }
}); 