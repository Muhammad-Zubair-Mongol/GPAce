// Function to process Gemini API response and format it for the calendar
function processGeminiResponse(geminiData) {
    // Assuming geminiData is the parsed response from Gemini API
    return geminiData.map(entry => ({
        subject: entry.subject,
        startTime: entry.startTime,
        endTime: entry.endTime,
        date: entry.date
    }));
}

// Function to send data to the frontend
function sendToFrontend(socket, data) {
    const processedData = processGeminiResponse(data);
    socket.emit('timetableData', {
        type: 'timetableData',
        content: processedData
    });
}

module.exports = {
    processGeminiResponse,
    sendToFrontend
};
