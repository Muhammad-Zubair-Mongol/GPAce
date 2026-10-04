// Mini Alarm Display Component
class AlarmMiniDisplay {
    constructor() {
        this.createDisplay();
        this.updateDisplay();
        setInterval(() => this.updateDisplay(), 1000);
    }

    createDisplay() {
        const display = document.createElement('div');
        display.className = 'mini-alarm-display';
        display.innerHTML = `
            <div class="icon">
                <i class="bi bi-alarm"></i>
            </div>
            <div class="time"></div>
            <div class="next-alarm"></div>
        `;
        document.body.appendChild(display);
        this.display = display;
    }

    updateDisplay() {
        const now = new Date();
        let hours = now.getHours();
        const minutes = now.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';

        // Convert to 12-hour format
        if (hours > 12) {
            hours -= 12;
        } else if (hours === 0) {
            hours = 12;
        }

        const timeStr = `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
        this.display.querySelector('.time').textContent = timeStr;

        // Find next alarm
        const nextAlarm = this.findNextAlarm();
        const nextAlarmElement = this.display.querySelector('.next-alarm');
        
        if (nextAlarm) {
            nextAlarmElement.textContent = `Next: ${nextAlarm.hour}:${nextAlarm.minute.toString().padStart(2, '0')} ${nextAlarm.ampm}`;
            nextAlarmElement.style.display = 'block';
        } else {
            nextAlarmElement.style.display = 'none';
        }
    }

    findNextAlarm() {
        if (!window.alarmService?.alarms?.length) return null;

        const now = new Date();
        let currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentAmPm = currentHour >= 12 ? 'PM' : 'AM';

        // Convert current hour to 12-hour format
        if (currentHour > 12) {
            currentHour -= 12;
        } else if (currentHour === 0) {
            currentHour = 12;
        }

        // Filter enabled alarms and sort them
        const enabledAlarms = window.alarmService.alarms
            .filter(alarm => alarm.enabled)
            .sort((a, b) => {
                // Convert alarm times to comparable numbers
                const aTime = this.convertToMinutes(a.hour, a.minute, a.ampm);
                const bTime = this.convertToMinutes(b.hour, b.minute, b.ampm);
                const currentTime = this.convertToMinutes(currentHour, currentMinute, currentAmPm);

                // Adjust times for comparison
                const aAdjusted = aTime <= currentTime ? aTime + 24 * 60 : aTime;
                const bAdjusted = bTime <= currentTime ? bTime + 24 * 60 : bTime;

                return aAdjusted - bAdjusted;
            });

        return enabledAlarms[0] || null;
    }

    convertToMinutes(hours, minutes, ampm) {
        let totalMinutes = hours * 60 + minutes;
        
        // Adjust for PM
        if (ampm === 'PM' && hours !== 12) {
            totalMinutes += 12 * 60;
        }
        // Adjust for AM 12
        else if (ampm === 'AM' && hours === 12) {
            totalMinutes -= 12 * 60;
        }

        return totalMinutes;
    }
}

// Initialize mini display when alarm service is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait for alarm service to be available
    const checkAlarmService = setInterval(() => {
        if (window.alarmService) {
            new AlarmMiniDisplay();
            clearInterval(checkAlarmService);
        }
    }, 100);
}); 