// Function to receive timetable data from Node.js server
function handleTimetableData(timetableData) {
    if (!window.calendarManager) {
        console.error('Calendar manager not initialized');
        return;
    }

    console.log('Received timetable data:', timetableData);

    // Update the calendar with the new events
    if (Array.isArray(timetableData.content)) {
        window.calendarManager.setEvents(timetableData.content, timetableData.isNewTimetable);
        console.log('Calendar updated with events:', window.calendarManager.events);
    } else {
        console.error('Invalid timetable data format:', timetableData);
    }
}

// Listen for messages from the Node.js server
window.addEventListener('message', function(event) {
    // Verify the origin of the message for security
    if (event.data && event.data.type === 'timetableData') {
        handleTimetableData(event.data);
    }
});

// Set up Socket.IO listener
if (typeof io !== 'undefined') {
    const socket = io();
    socket.on('timetableData', function(data) {
        console.log('Received timetable data via socket:', data);
        handleTimetableData(data);
    });
}

// Export function to be called from Node.js
window.updateTimetable = handleTimetableData;
