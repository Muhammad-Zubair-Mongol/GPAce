document.addEventListener('DOMContentLoaded', () => {
    // Create audio element for alarm sound
    const alarmAudio = document.createElement('audio');
    alarmAudio.id = 'alarm-sound';
    alarmAudio.src = '/alarm-sounds/alexa-ringtone.mp3';
    alarmAudio.preload = 'auto';
    document.body.appendChild(alarmAudio);

    // Add module support
    const moduleScript = document.createElement('script');
    moduleScript.type = 'importmap';
    moduleScript.textContent = JSON.stringify({
        imports: {
            'firebase/app': 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js',
            'firebase/firestore': 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js',
            'firebase/auth': 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
        }
    });
    document.head.appendChild(moduleScript);

    // Load alarm handler as a module
    const alarmHandler = document.createElement('script');
    alarmHandler.type = 'module';
    alarmHandler.src = '/js/alarm-handler.js';
    document.body.appendChild(alarmHandler);

    // Check for stored alarms and initialize service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/js/alarm-service-worker.js')
            .then(registration => {
                console.log('Alarm Service Worker registered');
                // Load alarms from localStorage
                const alarms = JSON.parse(localStorage.getItem('alarms') || '[]');
                
                // Schedule active alarms
                alarms.forEach(alarm => {
                    if (alarm.active) {
                        registration.active.postMessage({
                            type: 'SET_ALARM',
                            time: alarm.time,
                            label: alarm.label
                        });
                    }
                });
            })
            .catch(error => {
                console.error('Alarm Service Worker registration failed:', error);
            });
    }

    // Request notification permission if not already granted
    if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
}); 