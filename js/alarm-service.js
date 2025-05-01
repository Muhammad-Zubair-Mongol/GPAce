// Global Alarm Service for GPAce
class AlarmService {
    constructor() {
        this.alarms = [];
        this.templates = {
            weekday: [
                { hour: 7, minute: 0, ampm: 'AM', label: 'Wake Up', days: [1,2,3,4,5] },
                { hour: 12, minute: 0, ampm: 'PM', label: 'Lunch Break', days: [1,2,3,4,5] },
                { hour: 6, minute: 0, ampm: 'PM', label: 'Study Time', days: [1,2,3,4,5] }
            ],
            weekend: [
                { hour: 9, minute: 0, ampm: 'AM', label: 'Wake Up', days: [0,6] },
                { hour: 2, minute: 0, ampm: 'PM', label: 'Study Session', days: [0,6] }
            ],
            study: [
                { hour: 9, minute: 0, ampm: 'AM', label: 'Morning Study', days: [1,2,3,4,5] },
                { hour: 3, minute: 0, ampm: 'PM', label: 'Afternoon Review', days: [1,2,3,4,5] },
                { hour: 8, minute: 0, ampm: 'PM', label: 'Evening Practice', days: [1,2,3,4,5] }
            ]
        };
        this.loadAlarms();
        this.initializeAudio();
        this.initializeDisplay();
        this.setupKeyboardShortcuts();
    }

    initializeAudio() {
        this.alarmSound = new Audio('/alarm-sounds/alexa-ringtone.mp3');
        this.alarmSound.loop = true;
    }

    loadAlarms() {
        const savedAlarms = localStorage.getItem('gpace_alarms');
        this.alarms = savedAlarms ? JSON.parse(savedAlarms) : [];
    }

    saveAlarms() {
        localStorage.setItem('gpace_alarms', JSON.stringify(this.alarms));
        this.renderAlarms();
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Alt + A: Quick Add Alarm
            if (e.altKey && e.key === 'a') {
                this.showQuickAddModal();
            }
            // Alt + T: Apply Template
            if (e.altKey && e.key === 't') {
                this.showTemplateModal();
            }
            // Alt + B: Bulk Add
            if (e.altKey && e.key === 'b') {
                this.showBulkAddModal();
            }
        });
    }

    addAlarm(hour, minute, ampm, label = '', options = {}) {
        const alarm = {
            id: Date.now(),
            hour: parseInt(hour),
            minute: parseInt(minute),
            ampm: ampm.toUpperCase(),
            label,
            enabled: true,
            recurring: options.recurring || false,
            days: options.days || [],
            color: options.color || '#fe2c55',
            priority: options.priority || 'normal',
            snoozeTime: options.snoozeTime || 5,
            sound: options.sound || 'default'
        };
        this.alarms.push(alarm);
        this.saveAlarms();
        this.showNotification('Alarm set successfully!');
        return alarm;
    }

    applyTemplate(templateName) {
        const template = this.templates[templateName];
        if (!template) return;

        template.forEach(alarm => {
            this.addAlarm(alarm.hour, alarm.minute, alarm.ampm, alarm.label, {
                recurring: true,
                days: alarm.days
            });
        });
    }

    bulkAddAlarms(alarms) {
        alarms.forEach(alarm => {
            this.addAlarm(
                alarm.hour,
                alarm.minute,
                alarm.ampm,
                alarm.label,
                alarm.options || {}
            );
        });
    }

    importFromCSV(csvContent) {
        const rows = csvContent.split('\\n');
        const alarms = rows.slice(1).map(row => {
            const [time, label, days] = row.split(',');
            const [hour, minute, ampm] = time.split(':');
            return {
                hour: parseInt(hour),
                minute: parseInt(minute),
                ampm: ampm.trim().toUpperCase(),
                label: label.trim(),
                options: {
                    recurring: !!days,
                    days: days ? days.split(';').map(Number) : []
                }
            };
        });
        this.bulkAddAlarms(alarms);
    }

    showQuickAddModal() {
        const modal = document.createElement('div');
        modal.className = 'alarm-modal quick-add';
        modal.innerHTML = `
            <div class="alarm-modal-content">
                <h3>Quick Add Alarm</h3>
                <div class="quick-add-form">
                    <div class="time-input">
                        <input type="time" id="quickTime" required>
                        <select id="quickAmPm">
                            <option value="AM">AM</option>
                            <option value="PM">PM</option>
                        </select>
                    </div>
                    <input type="text" id="quickLabel" placeholder="Alarm Label">
                    <div class="day-selector">
                        ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, i) => `
                            <label>
                                <input type="checkbox" value="${i}">
                                ${day}
                            </label>
                        `).join('')}
                    </div>
                    <div class="quick-add-actions">
                        <button class="save-btn">Save (Alt+S)</button>
                        <button class="cancel-btn">Cancel (Esc)</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Add keyboard shortcuts for the quick add modal
        const handleQuickAddKeys = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', handleQuickAddKeys);
            }
            if (e.altKey && e.key === 's') {
                this.saveQuickAdd(modal);
                document.removeEventListener('keydown', handleQuickAddKeys);
            }
        };
        document.addEventListener('keydown', handleQuickAddKeys);

        // Add click handlers
        modal.querySelector('.save-btn').onclick = () => this.saveQuickAdd(modal);
        modal.querySelector('.cancel-btn').onclick = () => modal.remove();
    }

    showTemplateModal() {
        const modal = document.createElement('div');
        modal.className = 'alarm-modal template-select';
        modal.innerHTML = `
            <div class="alarm-modal-content">
                <h3>Apply Alarm Template</h3>
                <div class="template-list">
                    ${Object.keys(this.templates).map(template => `
                        <div class="template-item">
                            <h4>${template.charAt(0).toUpperCase() + template.slice(1)}</h4>
                            <p>${this.templates[template].length} alarms</p>
                            <button onclick="window.alarmService.applyTemplate('${template}')">
                                Apply Template
                            </button>
                        </div>
                    `).join('')}
                </div>
                <div class="template-actions">
                    <button class="close-btn">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.querySelector('.close-btn').onclick = () => modal.remove();
    }

    showBulkAddModal() {
        const modal = document.createElement('div');
        modal.className = 'alarm-modal bulk-add';
        modal.innerHTML = `
            <div class="alarm-modal-content">
                <h3>Bulk Add Alarms</h3>
                <div class="bulk-add-options">
                    <div class="csv-upload">
                        <h4>Upload CSV</h4>
                        <p>CSV Format: Time,Label,Days (optional)</p>
                        <input type="file" accept=".csv" id="csvUpload">
                    </div>
                    <div class="manual-bulk-add">
                        <h4>Manual Entry</h4>
                        <div id="bulkAlarmEntries">
                            <div class="bulk-alarm-entry">
                                <input type="time" required>
                                <select>
                                    <option value="AM">AM</option>
                                    <option value="PM">PM</option>
                                </select>
                                <input type="text" placeholder="Label">
                                <button class="remove-entry">×</button>
                            </div>
                        </div>
                        <button id="addMoreAlarms">+ Add Another Alarm</button>
                    </div>
                </div>
                <div class="bulk-add-actions">
                    <button class="save-btn">Save All</button>
                    <button class="cancel-btn">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Set up event handlers
        modal.querySelector('#csvUpload').onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => this.importFromCSV(e.target.result);
                reader.readAsText(file);
                modal.remove();
            }
        };

        modal.querySelector('#addMoreAlarms').onclick = () => {
            const entry = document.createElement('div');
            entry.className = 'bulk-alarm-entry';
            entry.innerHTML = `
                <input type="time" required>
                <select>
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                </select>
                <input type="text" placeholder="Label">
                <button class="remove-entry">×</button>
            `;
            modal.querySelector('#bulkAlarmEntries').appendChild(entry);
        };

        modal.querySelector('.save-btn').onclick = () => {
            const entries = modal.querySelectorAll('.bulk-alarm-entry');
            entries.forEach(entry => {
                const [hour, minute] = entry.querySelector('input[type="time"]').value.split(':');
                const ampm = entry.querySelector('select').value;
                const label = entry.querySelector('input[type="text"]').value;
                this.addAlarm(hour, minute, ampm, label);
            });
            modal.remove();
        };

        modal.querySelector('.cancel-btn').onclick = () => modal.remove();
    }

    saveQuickAdd(modal) {
        const timeInput = modal.querySelector('#quickTime').value;
        const [hour, minute] = timeInput.split(':');
        const ampm = modal.querySelector('#quickAmPm').value;
        const label = modal.querySelector('#quickLabel').value;
        const days = Array.from(modal.querySelectorAll('.day-selector input:checked'))
            .map(input => parseInt(input.value));

        this.addAlarm(hour, minute, ampm, label, {
            recurring: days.length > 0,
            days: days
        });
        modal.remove();
    }

    removeAlarm(id) {
        this.alarms = this.alarms.filter(alarm => alarm.id !== id);
        this.saveAlarms();
    }

    toggleAlarm(id) {
        const alarm = this.alarms.find(a => a.id === id);
        if (alarm) {
            alarm.enabled = !alarm.enabled;
            this.saveAlarms();
        }
    }

    initializeDisplay() {
        // Initial render
        this.renderAlarms();

        // Set up alarm checking interval
        setInterval(() => this.checkAlarms(), 1000);
    }

    renderAlarms() {
        const alarmList = document.getElementById('alarm-list');
        if (!alarmList) return;

        alarmList.innerHTML = '';
        this.alarms.forEach(alarm => {
            const alarmItem = document.createElement('div');
            alarmItem.className = 'alarm-item';
            alarmItem.innerHTML = `
                <div class="alarm-details">
                    <div class="alarm-time">${alarm.hour}:${alarm.minute.toString().padStart(2, '0')} ${alarm.ampm}</div>
                    <div class="alarm-label">${alarm.label || 'Alarm'}</div>
                </div>
                <div class="alarm-controls">
                    <div class="alarm-toggle">
                        <input type="checkbox" id="toggle-${alarm.id}" ${alarm.enabled ? 'checked' : ''}>
                        <label for="toggle-${alarm.id}"></label>
                    </div>
                    <button class="delete-alarm" data-id="${alarm.id}">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            `;

            // Add event listeners
            const toggleBtn = alarmItem.querySelector(`#toggle-${alarm.id}`);
            toggleBtn.addEventListener('change', () => this.toggleAlarm(alarm.id));

            const deleteBtn = alarmItem.querySelector('.delete-alarm');
            deleteBtn.addEventListener('click', () => this.removeAlarm(alarm.id));

            alarmList.appendChild(alarmItem);
        });
    }

    checkAlarms() {
        const now = new Date();
        let currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentAmPm = currentHour >= 12 ? 'PM' : 'AM';

        // Convert to 12-hour format
        currentHour = currentHour % 12;
        currentHour = currentHour ? currentHour : 12;

        this.alarms.forEach(alarm => {
            if (!alarm.enabled) return;

            if (alarm.hour === currentHour &&
                alarm.minute === currentMinute &&
                alarm.ampm === currentAmPm) {
                this.triggerAlarm(alarm);
            }
        });
    }

    triggerAlarm(alarm) {
        // Show notification
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('GPAce Alarm', {
                body: alarm.label || 'Time to wake up!',
                icon: '/icons/alarm-icon.png'
            });
        }

        // Play sound
        this.alarmSound.play().catch(error => {
            console.warn('Could not play alarm sound:', error);
        });

        // Show alarm modal
        this.showAlarmModal(alarm);
    }

    showAlarmModal(alarm) {
        const modal = document.createElement('div');
        modal.className = 'alarm-modal';
        modal.innerHTML = `
            <div class="alarm-modal-content">
                <h2>${alarm.label || 'Time to wake up!'}</h2>
                <p>${alarm.hour}:${alarm.minute.toString().padStart(2, '0')} ${alarm.ampm}</p>
                <div class="alarm-modal-buttons">
                    <button class="snooze-btn">Snooze (5 min)</button>
                    <button class="stop-btn">Stop</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.snooze-btn').addEventListener('click', () => {
            this.snoozeAlarm(alarm);
            this.stopAlarm();
            modal.remove();
        });

        modal.querySelector('.stop-btn').addEventListener('click', () => {
            this.stopAlarm();
            modal.remove();
        });
    }

    snoozeAlarm(alarm) {
        let snoozeMinute = alarm.minute + 5;
        let snoozeHour = alarm.hour;
        let snoozeAmPm = alarm.ampm;

        if (snoozeMinute >= 60) {
            snoozeMinute -= 60;
            snoozeHour += 1;
            if (snoozeHour > 12) {
                snoozeHour = 1;
                snoozeAmPm = snoozeAmPm === 'AM' ? 'PM' : 'AM';
            }
        }

        this.addAlarm(
            snoozeHour,
            snoozeMinute,
            snoozeAmPm,
            alarm.label + ' (Snoozed)'
        );
    }

    stopAlarm() {
        this.alarmSound.pause();
        this.alarmSound.currentTime = 0;
    }

    showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'gpace-notification';
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    requestNotificationPermission() {
        if ('Notification' in window) {
            Notification.requestPermission();
        }
    }
}

// Initialize the global alarm service
const alarmService = new AlarmService();
alarmService.requestNotificationPermission();

// Export for use in other files
window.alarmService = alarmService;

/**
 * Initialize the alarm form toggle functionality
 */
function initializeAlarmFormToggle() {
    const addAlarmBtn = document.getElementById('addAlarmBtn');
    const alarmForm = document.querySelector('.alarm-form');

    if (addAlarmBtn && alarmForm) {
        addAlarmBtn.addEventListener('click', () => {
            alarmForm.classList.toggle('active');
            addAlarmBtn.innerHTML = alarmForm.classList.contains('active')
                ? '<i class="bi bi-x-circle-fill me-2"></i>Cancel'
                : '<i class="bi bi-plus-circle-fill me-2"></i>Add Alarm';
        });
    }
}

/**
 * Initialize the AM/PM toggle functionality
 */
function initializeAmPmToggle() {
    const amPmBtns = document.querySelectorAll('.am-pm-toggle button');

    amPmBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            amPmBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

/**
 * Initialize the alarm form submission
 */
function initializeAlarmForm() {
    const setAlarmBtn = document.querySelector('.set-alarm-btn');
    const cancelAlarmBtn = document.querySelector('.cancel-alarm-btn');
    const alarmForm = document.querySelector('.alarm-form');
    const addAlarmBtn = document.getElementById('addAlarmBtn');

    if (setAlarmBtn) {
        setAlarmBtn.addEventListener('click', () => {
            const hour = parseInt(document.getElementById('hour').value);
            const minute = parseInt(document.getElementById('minute').value);
            const ampm = document.querySelector('.am-pm-toggle .active').textContent;
            const label = document.getElementById('alarm-label').value;

            if (hour && !isNaN(hour) && minute && !isNaN(minute)) {
                if (hour < 1 || hour > 12) {
                    alert('Please enter a valid hour (1-12)');
                    return;
                }
                if (minute < 0 || minute > 59) {
                    alert('Please enter a valid minute (0-59)');
                    return;
                }

                window.alarmService.addAlarm(hour, minute, ampm, label);
                alarmForm.classList.remove('active');
                addAlarmBtn.innerHTML = '<i class="bi bi-plus-circle-fill me-2"></i>Add Alarm';

                // Clear form
                document.getElementById('hour').value = '';
                document.getElementById('minute').value = '';
                document.getElementById('second').value = '';
                document.getElementById('alarm-label').value = '';
            } else {
                alert('Please enter valid hour and minute values');
            }
        });
    }

    if (cancelAlarmBtn) {
        cancelAlarmBtn.addEventListener('click', () => {
            alarmForm.classList.remove('active');
            addAlarmBtn.innerHTML = '<i class="bi bi-plus-circle-fill me-2"></i>Add Alarm';

            // Clear form
            document.getElementById('hour').value = '';
            document.getElementById('minute').value = '';
            document.getElementById('second').value = '';
            document.getElementById('alarm-label').value = '';
        });
    }
}

// Export UI functions for use in other modules
window.alarmUI = {
    initializeAlarmFormToggle,
    initializeAmPmToggle,
    initializeAlarmForm
};