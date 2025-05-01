class CalendarManager {
    constructor() {
        this.currentDate = new Date();
        this.events = [];
        this.wakeTime = '00:00';
        this.sleepTime = '23:59';
        this.draggedEvent = null;
        this.resizingEvent = null;
        this.editingEvent = null;
        this.isCreatingEvent = false;
        this.creationStart = null;
        this.creationPreview = null;
        this.pixelsPerMinute = 1; // 1 pixel per minute (60px per hour)

        this.totalAvailableTimeElement = document.getElementById('totalAvailableTime');
        this.freeStudyTimeElement = document.getElementById('freeStudyTime');
        this.scheduledTimeElement = document.getElementById('scheduledTime');

        window.addEventListener('storage', (e) => {
            if (e.key === 'dailySchedule') {
                this.renderSleepSchedule();
                this.updateTimeCalculations();
            }
        });

        this.initializeElements();
        this.setupEventListeners();
        this.loadSavedData();
        this.render();
        this.adjustCalendarToViewport();

        // Add window resize listener to adjust calendar height dynamically
        window.addEventListener('resize', () => this.adjustCalendarToViewport());
    }

    initializeElements() {
        this.prevButton = document.getElementById('prevDay');
        this.nextButton = document.getElementById('nextDay');
        this.currentDateElement = document.getElementById('currentDate');
        this.wakeTimeInput = document.getElementById('wakeTime');
        this.sleepTimeInput = document.getElementById('sleepTime');
        this.applyTimesButton = document.getElementById('applyTimes');
        this.calendarGrid = document.querySelector('.calendar-grid');
        this.timeAxis = document.querySelector('.time-axis');

        // Modal elements
        this.modal = document.querySelector('.event-edit-modal');
        this.modalBackdrop = document.querySelector('.modal-backdrop');
        this.modalClose = document.querySelector('.modal-close');
        this.eventTitleInput = document.getElementById('eventTitle');
        this.eventTypeSelect = document.getElementById('eventType');
        this.eventStartInput = document.getElementById('eventStart');
        this.eventEndInput = document.getElementById('eventEnd');
        this.saveEventButton = document.getElementById('saveEvent');
        this.deleteEventButton = document.getElementById('deleteEvent');
        this.cancelEditButton = document.getElementById('cancelEdit');

        // New Event Creation Modal elements
        this.createModal = document.querySelector('.event-create-modal');
        this.newEventTitle = document.getElementById('newEventTitle');
        this.newEventType = document.getElementById('newEventType');
        this.newEventStart = document.getElementById('newEventStart');
        this.newEventEnd = document.getElementById('newEventEnd');
        this.createEventBtn = document.getElementById('createEvent');
        this.cancelCreateBtn = document.getElementById('cancelCreate');
    }

    setupEventListeners() {
        this.prevButton.addEventListener('click', () => this.previousDay());
        this.nextButton.addEventListener('click', () => this.nextDay());
        this.applyTimesButton.addEventListener('click', () => this.updateTimeRange());

        // Add drag and drop listeners to calendar grid
        this.calendarGrid.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.calendarGrid.addEventListener('drop', (e) => this.handleDrop(e));

        // Modal event listeners
        this.modalClose.addEventListener('click', () => this.closeEditModal());
        this.cancelEditButton.addEventListener('click', () => this.closeEditModal());
        this.saveEventButton.addEventListener('click', () => this.saveEventChanges());
        this.deleteEventButton.addEventListener('click', () => this.deleteCurrentEvent());
        this.modalBackdrop.addEventListener('click', () => this.closeEditModal());

        // Enable time block selection
        this.calendarGrid.addEventListener('mousedown', (e) => this.startTimeBlockSelection(e));
        document.addEventListener('mouseup', () => this.endTimeBlockSelection());
        document.addEventListener('mousemove', (e) => this.handleTimeBlockSelection(e));

        // Add event creation listeners to calendar grid
        this.calendarGrid.addEventListener('mousedown', (e) => this.startEventCreation(e));
        this.calendarGrid.addEventListener('mousemove', (e) => this.updateEventCreation(e));
        this.calendarGrid.addEventListener('mouseup', (e) => this.finishEventCreation(e));

        // New Event Modal listeners
        this.createEventBtn.addEventListener('click', () => this.createNewEvent());
        this.cancelCreateBtn.addEventListener('click', () => this.closeCreateModal());
        this.createModal.querySelector('.modal-close').addEventListener('click', () => this.closeCreateModal());
    }

    openEditModal(event) {
        this.editingEvent = event;

        // Populate modal fields
        this.eventTitleInput.value = event.subject || event.title;
        this.eventTypeSelect.value = event.type;
        this.eventStartInput.value = event.startTime;
        this.eventEndInput.value = event.endTime;

        // Show modal
        this.modal.classList.add('show');
        this.modalBackdrop.classList.add('show');
    }

    closeEditModal() {
        this.modal.classList.remove('show');
        this.modalBackdrop.classList.remove('show');
        this.editingEvent = null;
    }

    saveEventChanges() {
        if (!this.editingEvent) return;

        const updates = {
            title: this.eventTitleInput.value,
            subject: this.eventTitleInput.value,
            type: this.eventTypeSelect.value,
            startTime: this.eventStartInput.value,
            endTime: this.eventEndInput.value
        };

        // Find and update the event
        const eventIndex = this.events.findIndex(e => e.id === this.editingEvent.id);
        if (eventIndex !== -1) {
            this.events[eventIndex] = { ...this.events[eventIndex], ...updates };
            this.saveEvents();
            this.render();
        }

        this.closeEditModal();
    }

    deleteCurrentEvent() {
        if (!this.editingEvent) return;

        // Remove the event
        this.events = this.events.filter(e => e.id !== this.editingEvent.id);
        this.saveEvents();
        this.render();
        this.closeEditModal();
    }

    updateTimeRange() {
        this.wakeTime = this.wakeTimeInput.value;
        this.sleepTime = this.sleepTimeInput.value;
        this.render();
    }

    navigateDate(delta) {
        this.currentDate.setDate(this.currentDate.getDate() + delta);
        this.render();
    }

    formatTime(hours, minutes) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    createTimeAxis() {
        this.timeAxis.innerHTML = '';
        const totalHours = 24;

        for (let hour = 0; hour < totalHours; hour++) {
            // Create hour label
            const hourLabel = document.createElement('div');
            hourLabel.className = 'time-label hour-label';
            hourLabel.textContent = this.formatTime(hour, 0);
            hourLabel.style.top = `${hour * 60}px`; // 60px per hour (1px per minute)
            this.timeAxis.appendChild(hourLabel);

            // Create 15-minute markers
            for (let minute = 15; minute < 60; minute += 15) {
                const minuteLabel = document.createElement('div');
                minuteLabel.className = 'time-label minute-label';
                minuteLabel.textContent = this.formatTime(hour, minute);
                minuteLabel.style.top = `${hour * 60 + minute}px`;
                this.timeAxis.appendChild(minuteLabel);
            }
        }
    }

    createCalendarGrid() {
        this.calendarGrid.innerHTML = '';
        const totalHours = 24;

        // Create hour and 15-minute division lines
        for (let hour = 0; hour < totalHours; hour++) {
            // Hour line
            const hourLine = document.createElement('div');
            hourLine.className = 'grid-line hour-line';
            hourLine.style.top = `${hour * 60}px`;
            this.calendarGrid.appendChild(hourLine);

            // 15-minute division lines
            for (let minute = 15; minute < 60; minute += 15) {
                const minuteLine = document.createElement('div');
                minuteLine.className = 'grid-line minute-line';
                minuteLine.style.top = `${hour * 60 + minute}px`;
                this.calendarGrid.appendChild(minuteLine);
            }
        }
    }

    updateDateDisplay() {
        const options = { weekday: 'long', month: 'long', day: 'numeric' };
        this.currentDateElement.textContent = this.currentDate.toLocaleDateString('en-US', options);
    }

    renderEvents() {
        // Clear existing events
        document.querySelectorAll('.task-block').forEach(el => el.remove());

        // Filter events for the current day
        const currentDateStr = this.currentDate.toISOString().split('T')[0];
        const todayEvents = this.events.filter(event => event.date === currentDateStr);

        // Sort events by start time to handle overlaps
        todayEvents.sort((a, b) => {
            const timeA = this.timeToMinutes(a.startTime);
            const timeB = this.timeToMinutes(b.startTime);
            return timeA - timeB;
        });

        // Track overlapping events
        const timeSlots = new Map();

        // Render each event for today
        todayEvents.forEach(event => {
            const startTime = this.parseTime(event.startTime);
            const endTime = this.parseTime(event.endTime);

            if (startTime && endTime) {
                const taskBlock = document.createElement('div');
                taskBlock.className = `task-block ${event.type}`;

                // Create time element
                const taskTime = document.createElement('div');
                taskTime.className = 'task-time';
                taskTime.textContent = `${event.startTime} - ${event.endTime}`;
                taskBlock.appendChild(taskTime);

                // Create task title
                const taskTitle = document.createElement('div');
                taskTitle.className = 'task-title';
                taskTitle.textContent = event.subject || event.title;
                taskBlock.appendChild(taskTitle);

                // Set position and height based on time
                const startMinutes = this.timeToMinutes(event.startTime);
                const endMinutes = this.timeToMinutes(event.endTime);
                const duration = Math.max(30, endMinutes - startMinutes); // Minimum height of 30px

                // Handle overlapping events
                let horizontalOffset = 0;
                for (let time = startMinutes; time < endMinutes; time += 15) {
                    if (timeSlots.has(time)) {
                        horizontalOffset = Math.max(horizontalOffset, timeSlots.get(time) + 1);
                    }
                }

                // Update time slots
                for (let time = startMinutes; time < endMinutes; time += 15) {
                    timeSlots.set(time, horizontalOffset);
                }

                // Position exactly according to minutes (1px = 1min)
                taskBlock.style.top = `${startMinutes}px`;
                taskBlock.style.height = `${duration}px`;
                taskBlock.style.left = `${5 + (horizontalOffset * 20)}px`; // Offset overlapping events
                taskBlock.style.width = `calc(100% - ${10 + (horizontalOffset * 20)}px)`;

                // Set event data
                taskBlock.dataset.eventId = event.id;
                taskBlock.dataset.startTime = event.startTime;
                taskBlock.dataset.endTime = event.endTime;
                taskBlock.dataset.type = event.type;

                // Add to calendar grid
                this.calendarGrid.appendChild(taskBlock);

                // Set up interaction
                this.setupEventBlockInteraction(taskBlock, event);
            }
        });
    }

    parseTime(timeStr) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return { hours, minutes };
    }

    setupEventBlockInteraction(block, event) {
        let isDragging = false;
        let isResizing = false;
        let startY = 0;
        let startTop = 0;
        let startHeight = 0;
        let resizeHandle = null;

        // Update task title when clicked
        block.addEventListener('click', (e) => {
            e.stopPropagation();
            const taskTitle = document.getElementById('taskTitle');
            const eventTitle = block.querySelector('.event-title').textContent;
            taskTitle.textContent = eventTitle || 'No Task Selected';
        });

        // Double click to edit
        block.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.openEditModal(event);
        });

        // Drag to move
        block.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('resize-handle')) {
                isResizing = true;
                resizeHandle = e.target;
                startY = e.clientY;
                startTop = parseInt(block.style.top);
                startHeight = parseInt(block.style.height);
            } else {
                isDragging = true;
                startY = e.clientY;
                startTop = parseInt(block.style.top);
            }
            block.style.zIndex = '1000';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging && !isResizing) return;

            const deltaY = e.clientY - startY;

            if (isResizing) {
                if (resizeHandle.classList.contains('top')) {
                    const newTop = startTop + deltaY;
                    const newHeight = startHeight - deltaY;
                    if (newHeight >= 30) { // Minimum height of 30px
                        block.style.top = `${newTop}px`;
                        block.style.height = `${newHeight}px`;
                    }
                } else {
                    const newHeight = startHeight + deltaY;
                    if (newHeight >= 30) {
                        block.style.height = `${newHeight}px`;
                    }
                }
            } else if (isDragging) {
                const newTop = startTop + deltaY;
                if (newTop >= 0 && newTop <= this.calendarGrid.clientHeight - parseInt(block.style.height)) {
                    block.style.top = `${newTop}px`;
                }
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging || isResizing) {
                isDragging = false;
                isResizing = false;
                block.style.zIndex = '1';

                // Update event times
                const eventId = block.dataset.eventId;
                const newStartTime = this.pixelsToTime(parseInt(block.style.top));
                const newEndTime = this.pixelsToTime(parseInt(block.style.top) + parseInt(block.style.height));

                this.updateEventTimes(eventId, newStartTime, newEndTime);
            }
        });
    }

    updateEvent(eventId, updates) {
        const eventIndex = this.events.findIndex(e => e.id === eventId);
        if (eventIndex !== -1) {
            this.events[eventIndex] = {
                ...this.events[eventIndex],
                ...updates
            };
            this.saveEvents();
            this.render();
        }
    }

    deleteEvent(eventId) {
        this.events = this.events.filter(e => e.id !== eventId);
        this.saveEvents();
        this.render();
    }

    updateEventTimes(eventId, newStartTime, newEndTime) {
        const eventIndex = this.events.findIndex(e => e.id === eventId);
        if (eventIndex !== -1) {
            this.events[eventIndex].startTime = newStartTime;
            this.events[eventIndex].endTime = newEndTime;
            this.saveEvents();
        }
    }

    async saveEvents() {
        try {
            await fetch('/api/save-timetable', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ events: this.events })
            });
        } catch (error) {
            console.error('Error saving events:', error);
        }
    }

    timeToPixels(time) {
        const [hours, minutes] = time.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes;
        const gridHeight = this.calendarGrid.clientHeight;
        return (totalMinutes / 1440) * gridHeight; // 1440 = minutes in 24 hours
    }

    pixelsToTime(pixels) {
        const gridHeight = this.calendarGrid.clientHeight;
        const totalMinutes = (pixels / gridHeight) * 1440; // 1440 = minutes in 24 hours
        const hours = Math.floor(totalMinutes / 60);
        const minutes = Math.floor(totalMinutes % 60);
        return this.formatTime(Math.min(23, Math.max(0, hours)), Math.min(59, Math.max(0, minutes)));
    }

    startTimeBlockSelection(e) {
        if (e.target.classList.contains('time-block')) {
            this.isSelecting = true;
            const rect = this.calendarGrid.getBoundingClientRect();
            this.selectionStart = e.clientY - rect.top;
            this.selectionStart = Math.max(0, Math.min(this.selectionStart, rect.height));
        }
    }

    handleTimeBlockSelection(e) {
        if (!this.isSelecting) return;

        const rect = this.calendarGrid.getBoundingClientRect();
        let currentY = e.clientY - rect.top;

        currentY = Math.max(0, Math.min(currentY, rect.height));

        // Remove previous selection
        document.querySelectorAll('.selection-preview').forEach(el => el.remove());

        // Create selection preview
        const block = document.createElement('div');
        block.className = 'event-block free-block selection-preview';

        const top = Math.min(this.selectionStart, currentY);
        const height = Math.abs(currentY - this.selectionStart);

        Object.assign(block.style, {
            position: 'absolute',
            top: `${top}px`,
            height: `${height}px`,
            width: 'calc(100% - 10px)',
            left: '5px'
        });

        this.calendarGrid.appendChild(block);
    }

    endTimeBlockSelection() {
        if (!this.isSelecting) return;
        this.isSelecting = false;

        const preview = document.querySelector('.selection-preview');
        if (preview) {
            const startTime = this.pixelsToTime(parseInt(preview.style.top));
            const endTime = this.pixelsToTime(parseInt(preview.style.top) + parseInt(preview.style.height));

            const currentDateStr = this.currentDate.toISOString().split('T')[0];

            // Add the new event
            this.events.push({
                id: Math.random().toString(36).substr(2, 9),
                title: 'Free Time',
                type: 'free',
                startTime,
                endTime,
                date: currentDateStr
            });

            preview.remove();
            this.saveEvents();
            this.render();
        }
    }

    setEvents(events, isNewTimetable = false) {
        if (isNewTimetable) {
            // Clear all existing events if this is a new timetable
            this.events = [];
        }

        // Get wake and sleep times from localStorage
        const savedSchedule = localStorage.getItem('dailySchedule');
        if (savedSchedule) {
            const scheduleData = JSON.parse(savedSchedule);
            const wakeTime = scheduleData.wakeTime || '00:00';
            const sleepTime = scheduleData.sleepTime || '23:59';

            // Convert wake and sleep times to minutes for comparison
            const [wakeHours, wakeMinutes] = wakeTime.split(':').map(Number);
            const [sleepHours, sleepMinutes] = sleepTime.split(':').map(Number);
            const wakeTimeInMinutes = wakeHours * 60 + wakeMinutes;
            const sleepTimeInMinutes = sleepHours * 60 + sleepMinutes;

            // Adjust events to fit within wake/sleep schedule
            this.events = events.map(event => {
                const [startHours, startMinutes] = event.startTime.split(':').map(Number);
                const [endHours, endMinutes] = event.endTime.split(':').map(Number);

                let startTimeInMinutes = startHours * 60 + startMinutes;
                let endTimeInMinutes = endHours * 60 + endMinutes;

                // Adjust start time if before wake time
                if (startTimeInMinutes < wakeTimeInMinutes) {
                    startTimeInMinutes = wakeTimeInMinutes;
                    event.startTime = wakeTime;
                    console.log(`Event "${event.title}" start time adjusted to wake time: ${wakeTime}`);
                }

                // Adjust end time if after sleep time
                if (endTimeInMinutes > sleepTimeInMinutes) {
                    endTimeInMinutes = sleepTimeInMinutes;
                    event.endTime = sleepTime;
                    console.log(`Event "${event.title}" end time adjusted to sleep time: ${sleepTime}`);
                }

                // Skip events that are completely outside wake/sleep times
                if (startTimeInMinutes >= sleepTimeInMinutes || endTimeInMinutes <= wakeTimeInMinutes) {
                    console.log(`Event "${event.title}" skipped - outside wake/sleep schedule`);
                    return null;
                }

                // Format times back to HH:MM
                const adjustedStartHours = Math.floor(startTimeInMinutes / 60);
                const adjustedStartMinutes = startTimeInMinutes % 60;
                const adjustedEndHours = Math.floor(endTimeInMinutes / 60);
                const adjustedEndMinutes = endTimeInMinutes % 60;

                return {
                    ...event,
                    startTime: `${String(adjustedStartHours).padStart(2, '0')}:${String(adjustedStartMinutes).padStart(2, '0')}`,
                    endTime: `${String(adjustedEndHours).padStart(2, '0')}:${String(adjustedEndMinutes).padStart(2, '0')}`
                };
            }).filter(event => event !== null); // Remove skipped events
        } else {
            this.events = events;
        }

        this.updateTimeCalculations();
        this.render();
    }

    async loadSavedData() {
        try {
            const response = await fetch('/api/timetable');
            const data = await response.json();
            if (data.success && data.data) {
                this.setEvents(data.data, true);
            }
        } catch (error) {
            console.error('Error loading saved timetable:', error);
        }
    }

    render() {
        this.updateDateDisplay();
        this.createTimeAxis();
        this.createCalendarGrid();
        this.renderEvents();
        this.renderSleepSchedule();
        this.updateTimeCalculations();
        this.updateCurrentTimeIndicator();
        this.adjustCalendarToViewport();
    }

    renderSleepSchedule() {
        const savedSchedule = localStorage.getItem('dailySchedule');
        if (!savedSchedule) return;

        const scheduleData = JSON.parse(savedSchedule);
        const wakeTime = scheduleData.wakeTime;
        const sleepTime = scheduleData.sleepTime;
        const wakeBuffer = parseInt(scheduleData.wakeBuffer) || 0;
        const sleepBuffer = parseInt(scheduleData.sleepBuffer) || 0;

        if (wakeTime) {
            // Wake time indicator
            const wakeIndicator = document.createElement('div');
            wakeIndicator.className = 'sleep-indicator';
            const wakePosition = this.timeToPosition(wakeTime);
            wakeIndicator.style.top = `${wakePosition}px`;
            wakeIndicator.style.height = '20px';
            this.calendarGrid.appendChild(wakeIndicator);

            // Wake buffer zone
            if (wakeBuffer > 0) {
                const wakeBufferZone = document.createElement('div');
                wakeBufferZone.className = 'wake-buffer-zone';
                const bufferStartPosition = this.timeToPosition(this.adjustTimeByMinutes(wakeTime, -wakeBuffer));
                wakeBufferZone.style.top = `${bufferStartPosition}px`;
                wakeBufferZone.style.height = `${wakeBuffer * this.pixelsPerMinute}px`;
                wakeBufferZone.style.position = 'absolute';
                wakeBufferZone.style.width = '100%';
                this.calendarGrid.appendChild(wakeBufferZone);
            }
        }

        if (sleepTime) {
            // Sleep time indicator
            const sleepIndicator = document.createElement('div');
            sleepIndicator.className = 'sleep-indicator';
            const sleepPosition = this.timeToPosition(sleepTime);
            sleepIndicator.style.top = `${sleepPosition}px`;
            sleepIndicator.style.height = '20px';
            this.calendarGrid.appendChild(sleepIndicator);

            // Sleep buffer zone
            if (sleepBuffer > 0) {
                const sleepBufferZone = document.createElement('div');
                sleepBufferZone.className = 'sleep-buffer-zone';
                const bufferStartPosition = this.timeToPosition(this.adjustTimeByMinutes(sleepTime, -sleepBuffer));
                sleepBufferZone.style.top = `${bufferStartPosition}px`;
                sleepBufferZone.style.height = `${sleepBuffer * this.pixelsPerMinute}px`;
                sleepBufferZone.style.position = 'absolute';
                sleepBufferZone.style.width = '100%';
                this.calendarGrid.appendChild(sleepBufferZone);
            }
        }
    }

    updateTimeCalculations() {
        const schedule = this.getSleepSchedule();
        if (!schedule) return;

        const { wakeTime, sleepTime } = schedule;

        // Calculate total available time
        const totalAvailable = this.calculateTimeDifference(wakeTime, sleepTime);

        // Get current date in YYYY-MM-DD format
        const currentDateStr = this.currentDate.toISOString().split('T')[0];

        // Calculate scheduled time (from events for current date only)
        let scheduledMinutes = 0;
        this.events
            .filter(event => event.date === currentDateStr) // Only consider events for current date
            .forEach(event => {
                const startTime = this.timeToMinutes(event.startTime);
                const endTime = this.timeToMinutes(event.endTime);
                scheduledMinutes += endTime - startTime;
            });

        // Calculate free study time (total - scheduled)
        const freeStudyMinutes = totalAvailable - scheduledMinutes;

        // Update display
        this.totalAvailableTimeElement.textContent =
            `Total Available: ${this.formatMinutesToTime(totalAvailable)}`;
        this.freeStudyTimeElement.textContent =
            `Study Time: ${this.formatMinutesToTime(Math.max(0, freeStudyMinutes))}`; // Ensure non-negative
        this.scheduledTimeElement.textContent =
            `Scheduled: ${this.formatMinutesToTime(scheduledMinutes)}`;
    }

    getSleepSchedule() {
        const savedSchedule = localStorage.getItem('dailySchedule');
        return savedSchedule ? JSON.parse(savedSchedule) : null;
    }

    calculateTimeDifference(startTime, endTime) {
        const start = this.timeToMinutes(startTime);
        const end = this.timeToMinutes(endTime);
        let diff = end - start;
        if (diff < 0) diff += 24 * 60; // Add 24 hours if end is next day
        return diff;
    }

    timeToMinutes(time) {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    }

    formatMinutesToTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    }

    adjustTimeByMinutes(time, minutes) {
        const [hours, mins] = time.split(':').map(Number);
        let totalMinutes = hours * 60 + mins + minutes;

        // Handle overflow/underflow
        if (totalMinutes < 0) totalMinutes += 24 * 60;
        if (totalMinutes >= 24 * 60) totalMinutes -= 24 * 60;

        const adjustedHours = Math.floor(totalMinutes / 60);
        const adjustedMinutes = totalMinutes % 60;

        return `${String(adjustedHours).padStart(2, '0')}:${String(adjustedMinutes).padStart(2, '0')}`;
    }

    timeToPosition(time) {
        if (!time) return 0;
        const [hours, minutes] = time.split(':').map(Number);
        return (hours * 60 + minutes);
    }

    updateCurrentTimeIndicator() {
        console.log("Updating current time indicator");

        try {
            // Get the current time
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();

            // Calculate position (1px = 1min)
            const totalMinutes = hours * 60 + minutes;
            const position = totalMinutes;

            console.log(`Current time: ${hours}:${minutes} (${totalMinutes} minutes)`);
            console.log(`Setting indicator position to ${position}px`);

            // Create or update the indicator element
            let indicator = this.calendarGrid.querySelector('.current-time-indicator');
            if (!indicator) {
                // Create new indicator if it doesn't exist
                indicator = document.createElement('div');
                indicator.className = 'current-time-indicator';

                const timeLabel = document.createElement('div');
                timeLabel.className = 'current-time-label';
                indicator.appendChild(timeLabel);

                this.calendarGrid.appendChild(indicator);
                console.log("Created new time indicator");
            }

            // Update indicator position with exact pixel position
            // Add precise offset to fix alignment
            indicator.style.top = `${position}px`;
            indicator.style.display = 'block';
            indicator.style.zIndex = '200';

            // Format time with leading zeros
            const formattedHours = hours.toString().padStart(2, '0');
            const formattedMinutes = minutes.toString().padStart(2, '0');
            const timeString = `${formattedHours}:${formattedMinutes}`;

            // Update time label
            const timeLabel = indicator.querySelector('.current-time-label');
            if (timeLabel) {
                timeLabel.textContent = timeString;
                timeLabel.style.display = 'block';
            }

            // Display the current task if any
            this.displayCurrentTask(now);

            // Auto-scroll to current time if needed
            const gridContainer = document.querySelector('.calendar-grid-container');
            if (gridContainer) {
                const containerHeight = gridContainer.clientHeight;
                const scrollTop = gridContainer.scrollTop;
                const scrollBottom = scrollTop + containerHeight;

                // Check if current time is outside the visible area
                if (position < scrollTop || position > scrollBottom - 100) {
                    // Scroll to put the current time indicator in the middle of the visible area
                    const scrollPosition = Math.max(0, position - (containerHeight / 2));
                    gridContainer.scrollTop = scrollPosition;
                }
            }
        } catch (error) {
            console.error("Error updating time indicator:", error);
        }
    }

    displayCurrentTask(currentTime) {
        const currentDateStr = currentTime.toISOString().split('T')[0];
        const currentTimeStr = this.formatTime(currentTime.getHours(), currentTime.getMinutes());

        // Filter events for current day
        const todayEvents = this.events.filter(event => event.date === currentDateStr);

        // Find event that encompasses current time
        const currentEvent = todayEvents.find(event => {
            const startParts = event.startTime.split(':');
            const endParts = event.endTime.split(':');
            const eventStart = new Date(currentTime);
            const eventEnd = new Date(currentTime);

            eventStart.setHours(parseInt(startParts[0]), parseInt(startParts[1]), 0);
            eventEnd.setHours(parseInt(endParts[0]), parseInt(endParts[1]), 0);

            return currentTime >= eventStart && currentTime <= eventEnd;
        });

        // Update current task in shared manager
        if (window.currentTaskManager) {
            window.currentTaskManager.setCurrentTask(currentEvent || null);
        }

        // Update visual state in calendar
        document.querySelectorAll('.current-active-task').forEach(el => {
            el.classList.remove('current-active-task');
        });

        if (currentEvent) {
            const eventBlock = document.querySelector(`[data-event-id="${currentEvent.id}"]`);
            if (eventBlock) {
                eventBlock.classList.add('current-active-task');
            }
        }
    }

    updateEventSeries(seriesId, updates) {
        this.events = this.events.map(event => {
            if (event.recurring && event.recurring.seriesId === seriesId) {
                return { ...event, ...updates };
            }
            return event;
        });
        this.saveEvents();
        this.render();
    }

    deleteEventSeries(seriesId) {
        this.events = this.events.filter(event =>
            !(event.recurring && event.recurring.seriesId === seriesId)
        );
        this.saveEvents();
        this.render();
    }

    // Drag and Drop Handlers
    handleDragStart(e, event) {
        this.draggedEvent = event;
        e.target.classList.add('dragging');
        // Store the mouse offset within the event block
        const rect = e.target.getBoundingClientRect();
        this.dragOffset = e.clientY - rect.top;
    }

    handleDrag(e, event) {
        if (!this.draggedEvent) return;
        e.preventDefault();
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    handleDrop(e) {
        e.preventDefault();
        if (!this.draggedEvent) return;

        const calendarRect = this.calendarGrid.getBoundingClientRect();
        const dropY = e.clientY - calendarRect.top - this.dragOffset;

        // Convert drop position to time
        const minutesSinceMidnight = Math.floor((dropY / this.calendarGrid.offsetHeight) * 24 * 60);
        const hours = Math.floor(minutesSinceMidnight / 60);
        const minutes = minutesSinceMidnight % 60;

        // Round to nearest 30 minutes
        const roundedMinutes = Math.round(minutes / 30) * 30;
        const newStartTime = `${String(hours).padStart(2, '0')}:${String(roundedMinutes).padStart(2, '0')}`;

        // Calculate new end time maintaining the same duration
        const startTime = this.parseTime(this.draggedEvent.startTime);
        const endTime = this.parseTime(this.draggedEvent.endTime);
        const duration = endTime - startTime;
        const newEndDate = new Date(new Date().setHours(hours, roundedMinutes) + duration);
        const newEndTime = `${String(newEndDate.getHours()).padStart(2, '0')}:${String(newEndDate.getMinutes()).padStart(2, '0')}`;

        // Update the event times
        this.draggedEvent.startTime = newStartTime;
        this.draggedEvent.endTime = newEndTime;

        // Save and re-render
        this.saveEvents();
        this.render();
    }

    handleDragEnd(e, event) {
        e.target.classList.remove('dragging');
        this.draggedEvent = null;
        this.dragOffset = 0;
    }

    startEventCreation(e) {
        // Only start creation if clicking directly on the grid (not on existing events)
        if (e.target.classList.contains('calendar-grid') || e.target.classList.contains('grid-line')) {
            this.isCreatingEvent = true;
            const rect = this.calendarGrid.getBoundingClientRect();
            this.creationStart = e.clientY - rect.top;

            // Create preview block
            this.creationPreview = document.createElement('div');
            this.creationPreview.className = 'task-block creating';
            this.creationPreview.style.top = `${this.creationStart}px`;
            this.creationPreview.style.height = '30px';
            this.creationPreview.style.width = 'calc(100% - 10px)';
            this.creationPreview.style.left = '5px';
            this.calendarGrid.appendChild(this.creationPreview);
        }
    }

    updateEventCreation(e) {
        if (!this.isCreatingEvent || !this.creationPreview) return;

        const rect = this.calendarGrid.getBoundingClientRect();
        const currentY = e.clientY - rect.top;

        const top = Math.min(this.creationStart, currentY);
        const height = Math.abs(currentY - this.creationStart);

        this.creationPreview.style.top = `${top}px`;
        this.creationPreview.style.height = `${height}px`;
    }

    finishEventCreation(e) {
        if (!this.isCreatingEvent || !this.creationPreview) return;

        const rect = this.calendarGrid.getBoundingClientRect();
        const endY = e.clientY - rect.top;

        // Convert positions to times
        const startTime = this.pixelsToTime(Math.min(this.creationStart, endY));
        const endTime = this.pixelsToTime(Math.max(this.creationStart, endY));

        // Remove preview
        this.creationPreview.remove();
        this.creationPreview = null;
        this.isCreatingEvent = false;

        // Open creation modal with pre-filled times
        this.openCreateModal(startTime, endTime);
    }

    openCreateModal(startTime, endTime) {
        this.newEventStart.value = startTime;
        this.newEventEnd.value = endTime;
        this.createModal.classList.add('show');
        this.newEventTitle.focus();
    }

    closeCreateModal() {
        this.createModal.classList.remove('show');
        this.newEventTitle.value = '';
        this.newEventType.value = 'study';
    }

    createNewEvent() {
        const title = this.newEventTitle.value.trim();
        if (!title) {
            alert('Please enter an event title');
            return;
        }

        // Get wake and sleep times
        const savedSchedule = localStorage.getItem('dailySchedule');
        if (savedSchedule) {
            const scheduleData = JSON.parse(savedSchedule);
            const wakeTime = scheduleData.wakeTime || '00:00';
            const sleepTime = scheduleData.sleepTime || '23:59';

            let startTime = this.newEventStart.value;
            let endTime = this.newEventEnd.value;

            // Validate times against wake/sleep schedule
            if (startTime < wakeTime) {
                startTime = wakeTime;
                alert('Event start time adjusted to wake time');
            }
            if (endTime > sleepTime) {
                endTime = sleepTime;
                alert('Event end time adjusted to sleep time');
            }

            // Only create event if it's within wake/sleep times
            if (startTime >= sleepTime || endTime <= wakeTime) {
                alert('Cannot create event outside of wake/sleep schedule');
                return;
            }

            const newEvent = {
                id: Math.random().toString(36).substr(2, 9),
                title: title,
                type: this.newEventType.value,
                startTime: startTime,
                endTime: endTime,
                date: this.currentDate.toISOString().split('T')[0]
            };

            this.events.push(newEvent);
            this.saveEvents();
            this.render();
            this.updateTimeCalculations();
            this.closeCreateModal();
        }
    }

    updateDate(date) {
        this.currentDate = date;
        this.updateDateDisplay();
        this.render(); // This will trigger updateTimeCalculations
    }

    nextDay() {
        const nextDate = new Date(this.currentDate);
        nextDate.setDate(nextDate.getDate() + 1);
        this.updateDate(nextDate);
    }

    previousDay() {
        const prevDate = new Date(this.currentDate);
        prevDate.setDate(prevDate.getDate() - 1);
        this.updateDate(prevDate);
    }

    goToToday() {
        this.updateDate(new Date());
    }

    adjustCalendarToViewport() {
        // Calculate available space
        const container = document.querySelector('.calendar-container');
        const header = document.querySelector('.calendar-header');
        const legend = document.querySelector('.calendar-legend');
        const details = document.querySelector('.event-details');

        if (!container || !this.calendarGrid) return;

        // Calculate the space taken by other elements
        const otherElementsHeight =
            (header ? header.offsetHeight : 0) +
            (legend ? legend.offsetHeight : 0) +
            (details && details.style.display !== 'none' ? details.offsetHeight : 0) +
            40; // Additional padding/margins

        // Set the calendar grid container to fill remaining space
        const availableHeight = container.clientHeight - otherElementsHeight;
        if (availableHeight > 200) { // Minimum reasonable height
            const gridContainer = document.querySelector('.calendar-grid-container');
            if (gridContainer) {
                gridContainer.style.height = `${availableHeight}px`;

                // Scale time indicators and grid lines to match the new height if necessary
                // This ensures everything stays visible and properly spaced
                this.updateScaleForViewport(availableHeight);
            }
        }
    }

    updateScaleForViewport(availableHeight) {
        // Only apply scaling if available height would make the calendar too compressed
        // Standard size is 1440px (24h * 60min * 1px per min)
        const standardSize = 1440;

        if (availableHeight < standardSize && availableHeight > 0) {
            // The calendar can remain at the original time scale, as the container now scrolls
            // No need to scale the time indicators or grid lines

            // Make the grid-line positions absolute so they maintain position when scrolling
            document.querySelectorAll('.grid-line').forEach(line => {
                line.style.position = 'absolute';
            });

            // Ensure task blocks are properly positioned with absolute values
            document.querySelectorAll('.task-block').forEach(block => {
                block.style.position = 'absolute';
            });
        }
    }
}

// Initialize the calendar manager
document.addEventListener('DOMContentLoaded', () => {
    window.calendarManager = new CalendarManager();
    setInterval(() => window.calendarManager.updateCurrentTimeIndicator(), 60000);
});
