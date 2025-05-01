// Common Header Component with Alarm Integration
document.addEventListener('DOMContentLoaded', () => {
    // Add required CSS
    if (!document.querySelector('link[href="css/alarm-service.css"]')) {
        const alarmCss = document.createElement('link');
        alarmCss.rel = 'stylesheet';
        alarmCss.href = 'css/alarm-service.css';
        document.head.appendChild(alarmCss);
    }

    // Add mini clock display
    const miniClock = document.createElement('div');
    miniClock.className = 'mini-clock-display';
    miniClock.innerHTML = `
        <div class="mini-time">
            <span class="mini-hour">00</span>
            <span class="mini-colon">:</span>
            <span class="mini-minute">00</span>
            <span class="mini-ampm">AM</span>
        </div>
        <div class="mini-next-alarm"></div>
    `;
    document.body.appendChild(miniClock);

    // Add alarm notification container
    const notificationContainer = document.createElement('div');
    notificationContainer.className = 'alarm-notification-container';
    document.body.appendChild(notificationContainer);

    // Add wave animation container
    const waveContainer = document.createElement('div');
    waveContainer.className = 'wave-container';
    waveContainer.innerHTML = `
        <div class="wave"></div>
        <div class="wave"></div>
        <div class="wave"></div>
    `;
    document.body.appendChild(waveContainer);

    // Add audio element
    if (!document.getElementById('alarmSound')) {
        const audio = document.createElement('audio');
        audio.id = 'alarmSound';
        audio.preload = 'auto';
        audio.innerHTML = '<source src="alarm-sounds/alexa-ringtone.mp3" type="audio/mpeg">';
        document.body.appendChild(audio);
    }

    // Update mini clock
    function updateMiniClock() {
        const now = new Date();
        let hours = now.getHours();
        const minutes = now.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';

        // Convert to 12-hour format
        hours = hours % 12;
        hours = hours ? hours : 12;

        miniClock.querySelector('.mini-hour').textContent = hours.toString().padStart(2, '0');
        miniClock.querySelector('.mini-minute').textContent = minutes.toString().padStart(2, '0');
        miniClock.querySelector('.mini-ampm').textContent = ampm;

        // Update next alarm if available
        if (window.alarmService) {
            const nextAlarm = findNextAlarm();
            const miniNextAlarm = miniClock.querySelector('.mini-next-alarm');
            if (nextAlarm) {
                miniNextAlarm.textContent = `Next: ${nextAlarm.hour}:${nextAlarm.minute.toString().padStart(2, '0')} ${nextAlarm.ampm}`;
                miniNextAlarm.style.display = 'block';
            } else {
                miniNextAlarm.style.display = 'none';
            }
        }
    }

    function findNextAlarm() {
        if (!window.alarmService?.alarms?.length) return null;

        const now = new Date();
        let currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentAmPm = currentHour >= 12 ? 'PM' : 'AM';

        currentHour = currentHour % 12;
        currentHour = currentHour ? currentHour : 12;

        return window.alarmService.alarms
            .filter(alarm => alarm.enabled)
            .sort((a, b) => {
                const aTime = convertToMinutes(a.hour, a.minute, a.ampm);
                const bTime = convertToMinutes(b.hour, b.minute, b.ampm);
                const currentTime = convertToMinutes(currentHour, currentMinute, currentAmPm);

                const aAdjusted = aTime <= currentTime ? aTime + 24 * 60 : aTime;
                const bAdjusted = bTime <= currentTime ? bTime + 24 * 60 : bTime;

                return aAdjusted - bAdjusted;
            })[0] || null;
    }

    function convertToMinutes(hours, minutes, ampm) {
        let totalMinutes = hours * 60 + minutes;
        
        if (ampm === 'PM' && hours !== 12) {
            totalMinutes += 12 * 60;
        } else if (ampm === 'AM' && hours === 12) {
            totalMinutes -= 12 * 60;
        }

        return totalMinutes;
    }

    // Initialize
    setInterval(updateMiniClock, 1000);
    updateMiniClock();
});

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/js/alarm-service-worker.js')
            .then(registration => {
                console.log('Service Worker registered:', registration);
                initializeAlarmSystem(registration);
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });
    });
}

function initializeAlarmSystem(registration) {
    // Load alarms from localStorage
    const alarms = JSON.parse(localStorage.getItem('alarms') || '[]');
    
    // Schedule each alarm with the service worker
    alarms.forEach(alarm => {
        if (alarm.active) {
            registration.active.postMessage({
                type: 'SET_ALARM',
                time: alarm.time,
                label: alarm.label
            });
        }
    });

    // Listen for new alarms being set
    window.addEventListener('alarmSet', (event) => {
        const { time, label } = event.detail;
        registration.active.postMessage({
            type: 'SET_ALARM',
            time,
            label
        });
    });
}

// Request notification permission on page load
if ('Notification' in window) {
    Notification.requestPermission();
} 