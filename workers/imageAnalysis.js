const { workerData, parentPort } = require('worker_threads');
const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function analyzeImage() {
    try {
        const { imagePath, apiKey } = workerData;
        
        // Read the image file as base64
        const fullPath = path.resolve(imagePath);
        const imageBuffer = await fs.readFile(fullPath);
        const base64Image = imageBuffer.toString('base64');
        
        // Initialize Gemini API
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Prepare the image part for Gemini
        const imagePart = {
            inlineData: {
                data: base64Image,
                mimeType: "image/jpeg" // Adjust based on your image type
            }
        };

        // Create prompt for timetable analysis with more specific instructions
        const prompt = `Analyze this timetable image and extract:
1. Daily schedule (Mon-Fri)
2. Class times, subjects, and free slots
3. Weekly stats
4. Study recommendations

Format as JSON:
{
    "schedule": {
        "monday": [
            {"type": "class", "start": "09:00", "end": "10:30", "subject": "Math"},
            {"type": "free", "start": "10:30", "end": "12:00", "duration": 1.5}
        ]
    },
    "weeklyStats": {
        "busiest_day": "monday",
        "lightest_day": "friday",
        "total_class_hours": 25,
        "total_free_hours": 15,
        "best_study_days": ["wednesday", "friday"]
    },
    "recommendations": {
        "study_tips": ["Use Monday 2-hour break for Math review"],
        "break_management": ["Take 15-min breaks between classes"]
    }
}`;

        // Generate content using Gemini
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();
        
        // Clean the response text by removing markdown code block indicators
        const cleanedText = text.replace(/```json\n|\n```/g, '').trim();
        
        // Parse the JSON response
        const analysis = JSON.parse(cleanedText);
        
        // Convert schedule to calendar events and identify free time slots
        const calendarEvents = [];
        const today = new Date();
        const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        
        // Generate dates for 6 months
        const endDate = new Date(today);
        endDate.setMonth(endDate.getMonth() + 6);

        // Create recurring events for 6 months
        let currentDate = new Date(today);
        while (currentDate <= endDate) {
            const dayName = daysOfWeek[currentDate.getDay()].toLowerCase();
            const dateStr = currentDate.toISOString().split('T')[0];

            // If there are classes for this day of the week
            if (analysis.schedule[dayName]) {
                const classes = analysis.schedule[dayName];
                
                // Sort classes by start time
                const sortedClasses = classes.sort((a, b) => {
                    return a.start.localeCompare(b.start);
                });

                // Add class events
                sortedClasses.forEach(classItem => {
                    const [startHour, startMinute] = classItem.start.split(':').map(Number);
                    const [endHour, endMinute] = classItem.end.split(':').map(Number);
                    
                    calendarEvents.push({
                        id: Math.random().toString(36).substr(2, 9),
                        subject: classItem.subject,
                        type: 'class',
                        startTime: `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`,
                        endTime: `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`,
                        date: dateStr,
                        recurring: {
                            frequency: 'weekly',
                            dayOfWeek: dayName,
                            seriesId: `${dayName}-${classItem.subject}-${classItem.start}`,
                            startDate: today.toISOString().split('T')[0],
                            endDate: endDate.toISOString().split('T')[0]
                        }
                    });
                });

                // Free time slots logic
                let previousEndTime = '08:00'; // Start of day
                const endOfDay = '22:00'; // End of day

                sortedClasses.forEach(classItem => {
                    // Add free time slot before class if there's a gap
                    if (classItem.start > previousEndTime) {
                        calendarEvents.push({
                            id: Math.random().toString(36).substr(2, 9),
                            subject: 'Available for Study',
                            type: 'free',
                            startTime: previousEndTime,
                            endTime: classItem.start,
                            date: dateStr,
                            recurring: {
                                frequency: 'weekly',
                                dayOfWeek: dayName,
                                seriesId: `${dayName}-free-${previousEndTime}-${classItem.start}`,
                                startDate: today.toISOString().split('T')[0],
                                endDate: endDate.toISOString().split('T')[0]
                            }
                        });
                    }
                    previousEndTime = classItem.end;
                });

                // Add final free time slot of the day if there's time after last class
                if (previousEndTime < endOfDay) {
                    calendarEvents.push({
                        id: Math.random().toString(36).substr(2, 9),
                        subject: 'Available for Study',
                        type: 'free',
                        startTime: previousEndTime,
                        endTime: endOfDay,
                        date: dateStr,
                        recurring: {
                            frequency: 'weekly',
                            dayOfWeek: dayName,
                            seriesId: `${dayName}-free-${previousEndTime}-${endOfDay}`,
                            startDate: today.toISOString().split('T')[0],
                            endDate: endDate.toISOString().split('T')[0]
                        }
                    });
                }
            }

            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        // Send the results back to the main thread
        parentPort.postMessage({
            success: true,
            analysis,
            calendarEvents
        });
        
    } catch (error) {
        // Send error back to main thread
        parentPort.postMessage({
            success: false,
            error: error.message
        });
    }
}

// Start the analysis
analyzeImage(); 