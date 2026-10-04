/**
 * TimetableController - Handles timetable visualization, timeline, and analysis display
 */

class TimetableController {
    constructor() {
        this.currentSchedule = null;
        this.currentDayIndex = 0;
    }

    /**
     * Initialize the controller
     */
    init() {
        // Listen for timetable analysis events
        window.addEventListener('timetableAnalyzed', (e) => {
            this.displayAnalysis(e.detail);
        });
    }

    /**
     * Display full timetable analysis
     */
    displayAnalysis(analysis) {
        if (!analysis) return;

        this.currentSchedule = analysis.schedule;
        this.displayScheduleGrid(analysis.schedule);
        this.displayFreeTimeAnalysis(analysis.dailyAnalysis);
        this.displayWeeklyStats(analysis.weeklyStats);
        this.displayRecommendations(analysis.recommendations);
        this.initializeTimeline(analysis.schedule);
    }

    /**
     * Display schedule grid by day
     */
    displayScheduleGrid(schedule) {
        const container = document.querySelector('#scheduleResults .schedule-container');
        if (!container || !schedule) return;

        container.innerHTML = '';

        Object.entries(schedule).forEach(([day, slots]) => {
            const dayCard = document.createElement('div');
            dayCard.className = 'day-schedule mb-3';

            const dayHeader = document.createElement('h6');
            dayHeader.className = 'text-capitalize fw-bold';
            dayHeader.textContent = day;
            dayCard.appendChild(dayHeader);

            const slotsContainer = document.createElement('div');
            slotsContainer.className = 'time-slots';

            if (Array.isArray(slots)) {
                slots.forEach(slot => {
                    const slotElement = document.createElement('div');
                    slotElement.className = `${slot.type === 'class' ? 'class-slot' : 'free-slot'} mb-2`;
                    slotElement.innerHTML = `
                        <span class="time small">${slot.start} - ${slot.end}</span>
                        <span class="detail ${slot.type === 'class' ? 'fw-medium' : 'text-muted'}">
                            ${slot.type === 'class' ? slot.subject : `Free (${slot.duration}h)`}
                        </span>
                    `;
                    slotsContainer.appendChild(slotElement);
                });
            }

            dayCard.appendChild(slotsContainer);
            container.appendChild(dayCard);
        });
    }

    /**
     * Display free time analysis
     */
    displayFreeTimeAnalysis(dailyAnalysis) {
        const container = document.querySelector('#freeTimeResults .free-time-container');
        if (!container || !dailyAnalysis) return;

        container.innerHTML = '';

        Object.entries(dailyAnalysis).forEach(([day, data]) => {
            const dayCard = document.createElement('div');
            dayCard.className = 'day-free-time mb-3 p-2 rounded';
            dayCard.style.backgroundColor = 'var(--hover-bg)';

            dayCard.innerHTML = `
                <h6 class="text-capitalize fw-bold mb-2">${day}</h6>
                <div class="stats small">
                    <div class="d-flex justify-content-between mb-1">
                        <span>Free Hours:</span>
                        <span class="fw-medium">${data.totalFreeHours?.toFixed(1) || 0}h</span>
                    </div>
                    ${data.primeStudySlots?.length ? `
                        <div class="prime-slots mt-2">
                            <span class="text-muted">Prime Study Slots:</span>
                            ${data.primeStudySlots.map(slot => `
                                <div class="prime-slot badge bg-success text-white mt-1 me-1">
                                    ${slot.start} - ${slot.end}
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;

            container.appendChild(dayCard);
        });
    }

    /**
     * Display weekly statistics
     */
    displayWeeklyStats(stats) {
        const container = document.querySelector('#weeklyStats .stats-container');
        if (!container || !stats) return;

        container.innerHTML = `
            <div class="row g-2">
                <div class="col-6">
                    <div class="stat-card p-2 rounded text-center" style="background-color: var(--hover-bg);">
                        <div class="small text-muted">Busiest Day</div>
                        <div class="fw-bold text-capitalize">${stats.busiest_day || 'N/A'}</div>
                    </div>
                </div>
                <div class="col-6">
                    <div class="stat-card p-2 rounded text-center" style="background-color: var(--hover-bg);">
                        <div class="small text-muted">Most Free Time</div>
                        <div class="fw-bold text-capitalize">${stats.lightest_day || 'N/A'}</div>
                    </div>
                </div>
                <div class="col-6">
                    <div class="stat-card p-2 rounded text-center" style="background-color: var(--hover-bg);">
                        <div class="small text-muted">Weekly Class Hours</div>
                        <div class="fw-bold">${stats.total_class_hours || 0}h</div>
                    </div>
                </div>
                <div class="col-6">
                    <div class="stat-card p-2 rounded text-center" style="background-color: var(--hover-bg);">
                        <div class="small text-muted">Weekly Free Hours</div>
                        <div class="fw-bold">${stats.total_free_hours || 0}h</div>
                    </div>
                </div>
            </div>
            ${stats.best_study_days?.length ? `
                <div class="best-days mt-3 text-center">
                    <span class="small text-muted">Best Study Days: </span>
                    ${stats.best_study_days.map(day =>
            `<span class="badge bg-primary text-capitalize me-1">${day}</span>`
        ).join('')}
                </div>
            ` : ''}
        `;
    }

    /**
     * Display recommendations
     */
    displayRecommendations(recommendations) {
        const container = document.querySelector('#studyRecommendations .recommendations-container');
        if (!container || !recommendations) return;

        container.innerHTML = `
            ${recommendations.study_tips?.length ? `
                <div class="study-tips mb-3">
                    <h6 class="fw-bold"><i class="bi bi-lightbulb me-2"></i>Study Tips</h6>
                    <ul class="list-unstyled small">
                        ${recommendations.study_tips.map(tip => `<li class="mb-1">• ${tip}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
            ${recommendations.break_management?.length ? `
                <div class="break-tips">
                    <h6 class="fw-bold"><i class="bi bi-cup-hot me-2"></i>Break Management</h6>
                    <ul class="list-unstyled small">
                        ${recommendations.break_management.map(tip => `<li class="mb-1">• ${tip}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
        `;
    }

    /**
     * Initialize visual timeline with navigation
     */
    initializeTimeline(schedule) {
        const timelineContainer = document.getElementById('visualTimeline');
        const currentDaySpan = document.getElementById('currentDay');
        const timelineGrid = document.querySelector('.timeline-grid');
        const prevBtn = document.getElementById('prevDay');
        const nextBtn = document.getElementById('nextDay');

        if (!timelineContainer || !schedule) return;

        const days = Object.keys(schedule);
        if (days.length === 0) return;

        this.currentDayIndex = 0;

        const updateTimeline = (dayIndex) => {
            const day = days[dayIndex];
            if (currentDaySpan) {
                currentDaySpan.textContent = day.charAt(0).toUpperCase() + day.slice(1);
            }

            if (!timelineGrid) return;
            timelineGrid.innerHTML = '';

            const wakeTimeInput = document.getElementById('wakeTime');
            const sleepTimeInput = document.getElementById('sleepTime');

            const wakeTime = wakeTimeInput?.value ? this.parseTime(wakeTimeInput.value) : 8;
            const sleepTime = sleepTimeInput?.value ? this.parseTime(sleepTimeInput.value) : 22;

            const slots = schedule[day] || [];
            const totalMinutes = Math.max(0, (sleepTime - wakeTime) * 60);

            for (let i = 0; i < totalMinutes / 30; i++) {
                const block = document.createElement('div');
                block.className = 'time-block';
                block.style.cssText = 'width: 20px; height: 30px; border-radius: 4px; display: inline-block; margin: 1px;';

                const currentHour = wakeTime + (i * 0.5);
                const hours = Math.floor(currentHour);
                const minutes = (currentHour % 1) * 60;
                const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

                block.setAttribute('data-time', timeString);

                const overlappingSlot = this.findOverlappingSlot(currentHour, slots);
                if (overlappingSlot) {
                    block.style.backgroundColor = overlappingSlot.type === 'class'
                        ? 'var(--primary-color)'
                        : 'var(--success-color, #28a745)';
                    block.title = overlappingSlot.type === 'class'
                        ? `${overlappingSlot.subject}\n${overlappingSlot.start} - ${overlappingSlot.end}`
                        : `Free Time\n${overlappingSlot.start} - ${overlappingSlot.end}`;
                } else {
                    block.style.backgroundColor = 'var(--border-color)';
                    block.title = 'Buffer Time';
                }

                timelineGrid.appendChild(block);
            }
        };

        // Initial render
        updateTimeline(this.currentDayIndex);

        // Navigation buttons
        if (prevBtn) {
            prevBtn.onclick = () => {
                this.currentDayIndex = (this.currentDayIndex - 1 + days.length) % days.length;
                updateTimeline(this.currentDayIndex);
            };
        }

        if (nextBtn) {
            nextBtn.onclick = () => {
                this.currentDayIndex = (this.currentDayIndex + 1) % days.length;
                updateTimeline(this.currentDayIndex);
            };
        }

        // Update on time changes
        const wakeTimeInput = document.getElementById('wakeTime');
        const sleepTimeInput = document.getElementById('sleepTime');

        if (wakeTimeInput) {
            wakeTimeInput.addEventListener('change', () => updateTimeline(this.currentDayIndex));
        }
        if (sleepTimeInput) {
            sleepTimeInput.addEventListener('change', () => updateTimeline(this.currentDayIndex));
        }
    }

    /**
     * Parse time string to decimal hours
     */
    parseTime(timeString) {
        if (!timeString) return 0;
        const [hours, minutes] = timeString.split(':').map(Number);
        return hours + (minutes / 60);
    }

    /**
     * Find overlapping slot for a given time
     */
    findOverlappingSlot(currentHour, slots) {
        if (!Array.isArray(slots)) return null;

        return slots.find(slot => {
            const startTime = this.parseTime(slot.start);
            const endTime = this.parseTime(slot.end);
            return currentHour >= startTime && currentHour < endTime;
        });
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.TimetableController = TimetableController;
}
