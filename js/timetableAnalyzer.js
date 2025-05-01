/**
 * Timetable Analyzer Module
 * Handles Socket.IO connection and timetable data processing
 */

// Initialize Socket.IO connection
function initializeSocketConnection() {
    const socket = io();

    // Listen for timetable analysis updates
    socket.on('timetableData', (data) => {
        if (data.type === 'timetableData') {
            // Update the UI with the new timetable data
            if (data.content) {
                updateTimetableDisplay(data.content);
            }
        }
    });

    socket.on('timetableAnalysisError', (data) => {
        showErrorToast(data.error || 'An error occurred during timetable analysis');
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
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Timetable preview" class="img-fluid rounded">`;

    processTimetableImage(file);
}

// Process timetable image
async function processTimetableImage(file) {
    try {
        const formData = new FormData();
        formData.append('image', file);

        // Upload the image first
        const uploadResponse = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        const uploadResult = await uploadResponse.json();

        if (!uploadResult.success) {
            throw new Error(uploadResult.error || 'Failed to upload image');
        }

        // Analyze the uploaded image
        const analysisResponse = await fetch('/api/analyze-timetable', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ imagePath: uploadResult.filePath })
        });
        const analysis = await analysisResponse.json();

        if (!analysis.success) {
            throw new Error(analysis.error || 'Failed to analyze timetable');
        }

        // Display results
        const analysisDiv = document.getElementById('timetableAnalysis');
        analysisDiv.style.display = 'block';

        // Display schedule
        const scheduleContainer = document.querySelector('.schedule-container');
        let scheduleHtml = '';
        for (const [day, slots] of Object.entries(analysis.schedule)) {
            scheduleHtml += `
                <div class="day-schedule">
                    <h6>${day.charAt(0).toUpperCase() + day.slice(1)}</h6>
                    <ul class="list-unstyled">
            `;
            slots.forEach(slot => {
                const type = slot.type === 'class' ? 'class-slot' : 'free-slot';
                scheduleHtml += `
                    <li class="${type} mb-2">
                        ${slot.type === 'class' ? slot.subject : 'Free Time'}:
                        ${slot.start} - ${slot.end}
                        (${slot.duration} hours)
                    </li>
                `;
            });
            scheduleHtml += `</ul></div>`;
        }
        scheduleContainer.innerHTML = scheduleHtml;

        // Display free time analysis
        const freeTimeContainer = document.querySelector('.free-time-container');
        let freeTimeHtml = '<div class="daily-free-time">';
        for (const [day, data] of Object.entries(analysis.summary.dailyFreeTime)) {
            freeTimeHtml += `
                <div class="day-free-time mb-3">
                    <h6>${day.charAt(0).toUpperCase() + day.slice(1)}</h6>
                    <p class="mb-2">Total Free Hours: ${data.hours}</p>
                    <ul class="list-unstyled">
                        ${data.slots.map(slot => `<li class="mb-1">${slot}</li>`).join('')}
                    </ul>
                </div>
            `;
        }
        freeTimeHtml += '</div>';
        freeTimeContainer.innerHTML = freeTimeHtml;

        // Display weekly stats
        const statsContainer = document.querySelector('.stats-container');
        statsContainer.innerHTML = `
            <ul class="list-unstyled">
                <li class="mb-2">Busiest Day: ${analysis.weeklyStats.busiest_day}</li>
                <li class="mb-2">Most Free Time: ${analysis.weeklyStats.lightest_day}</li>
                <li class="mb-2">Total Class Hours: ${analysis.weeklyStats.total_class_hours}</li>
                <li class="mb-2">Total Free Hours: ${analysis.weeklyStats.total_free_hours}</li>
                <li class="mb-2">Best Study Days: ${analysis.weeklyStats.best_study_days.join(', ')}</li>
            </ul>
        `;

        // Display recommendations
        const recommendationsContainer = document.querySelector('.recommendations-container');
        recommendationsContainer.innerHTML = `
            <div class="study-tips mb-4">
                <h6>Study Tips</h6>
                <ul class="list-unstyled">
                    ${analysis.recommendations.study_tips.map(tip => `<li class="mb-2">${tip}</li>`).join('')}
                </ul>
            </div>
            <div class="break-tips">
                <h6>Break Management</h6>
                <ul class="list-unstyled">
                    ${analysis.recommendations.break_management.map(tip => `<li class="mb-2">${tip}</li>`).join('')}
                </ul>
            </div>
        `;

    } catch (error) {
        console.error('Error analyzing timetable:', error);
        showErrorToast('Failed to analyze timetable. Please try again.');
    }
}

// Initialize timetable analyzer
function initializeTimetableAnalyzer() {
    // Initialize Socket.IO connection
    const socket = initializeSocketConnection();
    
    // Set up timetable input event listener
    const timetableInput = document.getElementById('timetableInput');
    if (timetableInput) {
        timetableInput.addEventListener('change', handleTimetableUpload);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeTimetableAnalyzer);
