import alarmDataService from './alarm-data-service.js';

class AlarmHandler {
    constructor() {
        this.alarmSound = document.getElementById('alarm-sound');
        this.initialize();
    }

    async initialize() {
        // Load existing alarms
        await alarmDataService.loadAlarms();

        // Add listener for alarm changes
        alarmDataService.addListener(alarms => {
            this.syncAlarmsWithServiceWorker(alarms);
        });

        // Set up service worker message handling
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                this.handleServiceWorkerMessage(event);
            });
        }
    }

    async handleServiceWorkerMessage(event) {
        switch (event.data.type) {
            case 'PLAY_ALARM_SOUND':
                await this.playAlarmSound();
                break;
            case 'STOP_ALARM_SOUND':
                this.stopAlarmSound();
                break;
            case 'SAVE_SNOOZE_ALARM':
                await this.handleSnoozeAlarm(event.data.alarm);
                break;
        }
    }

    async playAlarmSound() {
        try {
            this.alarmSound.loop = true;
            await this.alarmSound.play();
        } catch (error) {
            console.error('Failed to play alarm sound:', error);
        }
    }

    stopAlarmSound() {
        this.alarmSound.pause();
        this.alarmSound.currentTime = 0;
    }

    async handleSnoozeAlarm(alarm) {
        await alarmDataService.saveAlarm(alarm);
    }

    syncAlarmsWithServiceWorker(alarms) {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SYNC_ALARMS',
                alarms
            });
        }
    }
}

// Initialize alarm handler
const alarmHandler = new AlarmHandler(); 