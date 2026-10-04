/**
 * Timetable Analyzer Module
 * Handles Socket.IO connection and timetable data processing
 */

function getGpaceApiClient() {
    if (window.gpaceApiClient) return Promise.resolve(window.gpaceApiClient);
    if (!window.__gpaceApiClientPromise) {
        const moduleUrl = new URL('/js/services/ApiClient.js', window.location.origin).href;
        window.__gpaceApiClientPromise = import(moduleUrl).then(({ getApiClient }) => getApiClient());
    }
    return window.__gpaceApiClientPromise;
}

// Initialize an authenticated Socket.IO connection.
async function initializeSocketConnection() {
    const client = await getGpaceApiClient();
    const auth = await client.socketAuth();
    const socketUrl = client.socketUrl();
    const socket = socketUrl ? io(socketUrl, { auth }) : io({ auth });

    // Listen for timetable analysis updates
    socket.on('timetableData', (data) => {
        if (data.type === 'timetableData') {
            
            // Revert loading text
            const preview = document.getElementById('timetablePreview');
            if(preview) {
                const loadingText = preview.querySelector('.loading-text');
                if(loadingText) loadingText.remove();
            }

            // Update the UI with the new timetable data
            if (data.content) {
                localStorage.setItem('gpace_timetable_events', JSON.stringify(data.content));
                updateTimetableDisplay(data.content);
            }
            
            // Render the AI insights
            if (data.analysis) {
                localStorage.setItem('gpace_timetable_analysis', JSON.stringify(data.analysis));
                renderAnalysisInsights(data.analysis);
                createAutomaticAlarms(data.analysis);
                
                // Dispatch event for TimetableController to use if needed
                window.dispatchEvent(new CustomEvent('timetableAnalyzed', { detail: data.analysis }));
            }
        }
    });

    socket.on('timetableAnalysisError', (data) => {
        if (typeof showErrorToast === 'function') {
            showErrorToast(data.error || 'An error occurred during timetable analysis');
        }
    });

    return socket;
}

// Group events by day of the week
function groupEventsByDay(events) {
    const grouped = {};
    const dayMap = {
        'monday': 1,
        'tuesday': 2,
        'wednesday': 3,
        'thursday': 4,
        'friday': 5,
        'saturday': 6,
        'sunday': 0
    };

    events.forEach(event => {
        if (event.recurring) {
            const day = event.recurring.dayOfWeek.toLowerCase();
            // Create array for this day if it doesn't exist
            if (!grouped[day]) {
                grouped[day] = [];
            }
            // Sort events by their actual day number to ensure correct order
            grouped[day].push({
                ...event,
                dayNumber: dayMap[day]
            });
        }
    });

    // Sort each day's events by start time
    Object.keys(grouped).forEach(day => {
        grouped[day].sort((a, b) => {
            // First sort by day number
            if (a.dayNumber !== b.dayNumber) {
                return a.dayNumber - b.dayNumber;
            }
            // Then sort by start time
            return a.startTime.localeCompare(b.startTime);
        });
    });

    return grouped;
}

// Update timetable display with data
function updateTimetableDisplay(timetableData) {
    const analysisDiv = document.getElementById('timetableAnalysis');
    if (!analysisDiv) return;

    analysisDiv.style.display = 'block';

    // Update schedule container
    const scheduleContainer = document.querySelector('.schedule-container');
    if (scheduleContainer) {
        let scheduleHtml = '';
        const groupedByDay = groupEventsByDay(timetableData);

        // Define the order of days
        const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

        // Iterate through days in order
        dayOrder.forEach(day => {
            if (groupedByDay[day] && groupedByDay[day].length > 0) {
                scheduleHtml += `
                    <div class="day-schedule">
                        <h6>${capitalizeFirstLetter(day)}</h6>
                        <ul class="list-unstyled">
                `;
                groupedByDay[day].forEach(event => {
                    const type = event.type === 'class' ? 'class-slot' : 'free-slot';
                    scheduleHtml += `
                        <li class="${type} mb-2">
                            ${event.type === 'class' ? event.subject : 'Free Time'}:
                            ${event.startTime} - ${event.endTime}
                        </li>
                    `;
                });
                scheduleHtml += `</ul></div>`;
            }
        });

        scheduleContainer.innerHTML = scheduleHtml;
    }
}

// Render AI insights (Stats, Free Time, Recommendations)
function renderAnalysisInsights(analysis) {
    const analysisDiv = document.getElementById('timetableAnalysis');
    if (!analysisDiv) return;
    analysisDiv.style.display = 'block';

    // Display weekly stats
    const statsContainer = document.querySelector('.stats-container');
    if (statsContainer && analysis.weeklyStats) {
        statsContainer.innerHTML = `
            <ul class="list-unstyled">
                <li class="mb-2">Busiest Day: ${analysis.weeklyStats.busiest_day}</li>
                <li class="mb-2">Most Free Time: ${analysis.weeklyStats.lightest_day}</li>
                <li class="mb-2">Total Class Hours: ${analysis.weeklyStats.total_class_hours}</li>
                <li class="mb-2">Total Free Hours: ${analysis.weeklyStats.total_free_hours}</li>
                <li class="mb-2">Best Study Days: ${analysis.weeklyStats.best_study_days ? analysis.weeklyStats.best_study_days.join(', ') : 'N/A'}</li>
            </ul>
        `;
    }

    // Display free time analysis (extract free slots from schedule)
    const freeTimeContainer = document.querySelector('.free-time-container');
    if (freeTimeContainer && analysis.schedule) {
        let freeTimeHtml = '';
        Object.entries(analysis.schedule).forEach(([day, events]) => {
            const freeSlots = events.filter(e => e.type === 'free');
            if (freeSlots.length > 0) {
                freeTimeHtml += `
                    <div class="day-schedule mb-3">
                        <h6 class="text-capitalize">${day}</h6>
                        <ul class="list-unstyled">
                `;
                freeSlots.forEach(slot => {
                    freeTimeHtml += `
                        <li class="free-slot mb-2">
                            ${slot.start} - ${slot.end} <span class="text-muted">(${slot.duration || 'N/A'}h)</span>
                        </li>
                    `;
                });
                freeTimeHtml += `</ul></div>`;
            }
        });
        
        if (!freeTimeHtml) {
            freeTimeHtml = '<p class="text-muted">No free time slots identified.</p>';
        }
        freeTimeContainer.innerHTML = freeTimeHtml;
    }

    // Display recommendations
    const recommendationsContainer = document.querySelector('.recommendations-container');
    if (recommendationsContainer && analysis.recommendations) {
        recommendationsContainer.innerHTML = `
            <div class="study-tips mb-4">
                <h6>Study Tips</h6>
                <ul class="list-unstyled">
                    ${analysis.recommendations.study_tips ? analysis.recommendations.study_tips.map(tip => `<li class="mb-2">${tip}</li>`).join('') : ''}
                </ul>
            </div>
            <div class="break-tips">
                <h6>Break Management</h6>
                <ul class="list-unstyled">
                    ${analysis.recommendations.break_management ? analysis.recommendations.break_management.map(tip => `<li class="mb-2">${tip}</li>`).join('') : ''}
                </ul>
            </div>
        `;
    }
}

// Automatically create editable alarms 5 mins before class
function createAutomaticAlarms(analysis) {
    if (!window.alarmService) {
        console.warn('AlarmService not found, skipping automatic alarms.');
        return;
    }

    if (!analysis || !analysis.schedule) return;

    // ── Step 1: Remove all previously auto-generated timetable alarms ──
    // They are tagged with fromTimetable: true so we can safely delete only those
    window.alarmService.alarms = window.alarmService.alarms.filter(a => !a.fromTimetable);

    // ── Step 2: Map days to integers (0=Sun … 6=Sat) ──────────────────
    const dayMap = {
        'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
        'thursday': 4, 'friday': 5, 'saturday': 6
    };

    // ── Step 3: Collapse identical subject+time across days ───────────
    const uniqueClasses = {};

    Object.entries(analysis.schedule).forEach(([day, slots]) => {
        slots.forEach(slot => {
            if (slot.type === 'class') {
                const key = `${slot.subject}-${slot.start}`;
                if (!uniqueClasses[key]) {
                    uniqueClasses[key] = {
                        subject: slot.subject,
                        start: slot.start,
                        days: []
                    };
                }
                const mappedDay = dayMap[day.toLowerCase()];
                if (mappedDay !== undefined && !uniqueClasses[key].days.includes(mappedDay)) {
                    uniqueClasses[key].days.push(mappedDay);
                }
            }
        });
    });

    // ── Step 4: Create one alarm per unique class, tagged fromTimetable ─
    Object.values(uniqueClasses).forEach(cls => {
        let [hour, minute] = cls.start.split(':').map(Number);

        // Subtract 5 minutes for the pre-class buffer
        minute -= 5;
        if (minute < 0) {
            minute += 60;
            hour -= 1;
            if (hour < 0) hour += 24;
        }

        const ampm = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12;
        if (hour === 0) hour = 12;

        window.alarmService.addAlarm(
            hour, minute, ampm,
            `Class: ${cls.subject}`,
            { days: cls.days, recurring: cls.days.length > 0, fromTimetable: true }
        );
    });

    console.log(`Auto-alarms set: ${Object.keys(uniqueClasses).length} unique classes.`);
}

// Utility function to capitalize first letter
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// Handle timetable file upload
function handleTimetableUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Display preview
    const preview = document.getElementById('timetablePreview');
    const previewUrl = URL.createObjectURL(file);
    window.gpaceTimetableDraft = { file, previewUrl };
    preview.innerHTML = `
        <img src="${previewUrl}" alt="Timetable preview" class="img-fluid rounded">
        <p class="loading-text mt-2 text-primary fw-bold">Analyzing your timetable, this may take a moment...</p>
    `;

    processTimetableImage(file);
}

// Process timetable image
async function processTimetableImage(file) {
    try {
        const client = await getGpaceApiClient();
        const uploadResult = await client.upload(file);
        const upload = uploadResult && uploadResult.uploads && uploadResult.uploads[0];
        if (!upload || !upload.uploadId) throw new Error('Upload did not return an uploadId.');

        // Analyze the uploaded image (Delegates to background worker)
        const analysis = await client.post('/api/analyze-timetable', { uploadId: upload.uploadId });

        if (!analysis.success) {
            throw new Error(analysis.error || 'Failed to start analysis');
        }
        
        // Notice: We no longer crash by parsing analysis.schedule synchronously here.
        // We wait for the 'timetableData' Socket event to deliver the completed insights!

    } catch (error) {
        console.error('Error analyzing timetable:', error);
        
        const preview = document.getElementById('timetablePreview');
        if(preview) {
            const loadingText = preview.querySelector('.loading-text');
            if(loadingText) loadingText.remove();
        }
        
        // Fallback to error toast if show is available
        if (error && error.authFailure) {
            if (typeof showErrorToast === 'function') {
                showErrorToast('Please sign in again. Your timetable draft is still selected.');
            }
            return;
        }
        if (typeof showErrorToast === 'function') {
            showErrorToast('Failed to analyze timetable. Please try again.');
        } else {
            alert('Failed to analyze timetable. Please try again.');
        }
    }
}

// Initialize timetable analyzer
function initializeTimetableAnalyzer() {
    // Initialize Socket.IO connection
    initializeSocketConnection().catch((error) => {
        console.error('Could not establish authenticated timetable socket:', error);
        if (error && error.authFailure && typeof showErrorToast === 'function') {
            showErrorToast('Please sign in to receive timetable analysis updates.');
        }
    });
    
    // Set up timetable input event listener
    const timetableInput = document.getElementById('timetableInput');
    if (timetableInput) {
        timetableInput.addEventListener('change', handleTimetableUpload);
    }
    
    // Load previously saved timetable and analysis
    const savedEvents = localStorage.getItem('gpace_timetable_events');
    const savedAnalysis = localStorage.getItem('gpace_timetable_analysis');
    
    if (savedEvents) {
        try {
            updateTimetableDisplay(JSON.parse(savedEvents));
        } catch (e) { console.error('Failed to parse saved events', e); }
    }
    
    if (savedAnalysis) {
        try {
            const analysisObj = JSON.parse(savedAnalysis);
            renderAnalysisInsights(analysisObj);
            // We don't re-create automatic alarms here because they are already saved in alarm-service
        } catch (e) { console.error('Failed to parse saved analysis', e); }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeTimetableAnalyzer);
