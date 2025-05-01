const { GoogleGenerativeAI } = require('@google/generative-ai');

class ImageAnalyzer {
    constructor() {
        // No need to pass or retrieve API key
        // Firebase Functions will handle key management
        this.genAI = new GoogleGenerativeAI('dummy-key');
        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    }

    // Add a method to verify key availability via Firebase function
    async verifyApiKey() {
        try {
            // Use Firebase callable function to check key
            const functions = firebase.functions();
            const getGeminiConfig = functions.httpsCallable('getGeminiConfig');
            
            const result = await getGeminiConfig();
            return result.data.keyAvailable;
        } catch (error) {
            console.error('Error verifying API key:', error);
            return false;
        }
    }

    async analyzeTimetable(imagePath) {
        try {
            // First, verify key availability
            const keyAvailable = await this.verifyApiKey();
            if (!keyAvailable) {
                throw new Error('Gemini API Key is not configured');
            }

            const imageData = await this.loadImageData(imagePath);
            
            const prompt = `
                Analyze this timetable image in detail. Extract and provide the following information:
                1. All scheduled classes with their exact timings
                2. Free time slots between classes
                3. Days of the week covered
                4. Subject/Course names
                5. Calculate total free hours per day
                6. Identify prime study slots (2+ hour gaps)
                7. Suggest optimal break times
                
                Format the response as a JSON object with this structure:
                {
                    "schedule": {
                        "monday": [
                            {"type": "class", "subject": "Math", "start": "09:00", "end": "10:30", "duration": "1.5"},
                            {"type": "free", "start": "10:30", "end": "12:00", "duration": "1.5"}
                        ]
                    },
                    "dailyAnalysis": {
                        "monday": {
                            "totalClasses": 4,
                            "totalClassHours": 6,
                            "totalFreeHours": 4,
                            "primeStudySlots": [
                                {"start": "10:30", "end": "12:00", "duration": "1.5"}
                            ],
                            "suggestedBreaks": [
                                {"time": "10:30-10:45", "purpose": "Quick refreshment"},
                                {"time": "12:00-13:00", "purpose": "Lunch break"}
                            ]
                        }
                    },
                    "weeklyStats": {
                        "busiest_day": "monday",
                        "lightest_day": "friday",
                        "total_class_hours": 25,
                        "total_free_hours": 15,
                        "best_study_days": ["wednesday", "friday"]
                    },
                    "recommendations": {
                        "study_tips": [
                            "Utilize 2-hour gap on Monday for assignment work",
                            "Schedule group studies during common free slots"
                        ],
                        "break_management": [
                            "Take short breaks after consecutive classes",
                            "Use 30-min gaps for quick revision"
                        ]
                    }
                }
            `;

            const result = await this.model.generateContent([prompt, imageData]);
            const response = await result.response;
            const text = response.text();
            
            try {
                const analysis = JSON.parse(text);
                return {
                    ...analysis,
                    summary: this.generateSummary(analysis)
                };
            } catch (e) {
                console.error('Error parsing Gemini response:', e);
                return {
                    error: 'Could not parse schedule data',
                    rawResponse: text
                };
            }
        } catch (error) {
            console.error('Error analyzing timetable:', error);
            throw error;
        }
    }

    async analyzeStudySpace(imagePath) {
        try {
            // First, verify key availability
            const keyAvailable = await this.verifyApiKey();
            if (!keyAvailable) {
                throw new Error('Gemini API Key is not configured');
            }

            const imageData = await this.loadImageData(imagePath);
            
            const prompt = `
                Analyze this study space image and extract the following information:
                1. Estimated noise level (quiet, moderate, noisy)
                2. Available seating (empty, somewhat occupied, full)
                3. Lighting conditions (good, moderate, poor)
                4. Visible power outlets (yes/no)
                5. Type of space (library, cafe, classroom, etc.)
                
                Format the response as a JSON object.
            `;

            const result = await this.model.generateContent([prompt, imageData]);
            const response = await result.response;
            const text = response.text();
            
            try {
                return JSON.parse(text);
            } catch (e) {
                console.error('Error parsing Gemini response:', e);
                return {
                    error: 'Could not parse study space data',
                    rawResponse: text
                };
            }
        } catch (error) {
            console.error('Error analyzing study space:', error);
            throw error;
        }
    }

    generateSummary(analysis) {
        const summary = {
            dailyFreeTime: {},
            bestStudyTimes: [],
            timeManagementTips: []
        };

        // Calculate and format daily free time
        for (const [day, slots] of Object.entries(analysis.schedule)) {
            const freeSlots = slots.filter(slot => slot.type === 'free');
            const totalFreeHours = freeSlots.reduce((total, slot) => total + parseFloat(slot.duration), 0);
            summary.dailyFreeTime[day] = {
                hours: totalFreeHours,
                slots: freeSlots.map(slot => `${slot.start}-${slot.end}`)
            };
        }

        // Identify best study times
        for (const [day, data] of Object.entries(analysis.dailyAnalysis)) {
            data.primeStudySlots.forEach(slot => {
                summary.bestStudyTimes.push({
                    day,
                    time: `${slot.start}-${slot.end}`,
                    duration: slot.duration
                });
            });
        }

        // Add time management tips
        summary.timeManagementTips = [
            ...analysis.recommendations.study_tips,
            ...analysis.recommendations.break_management
        ];

        return summary;
    }

    async loadImageData(imagePath) {
        // Implementation depends on whether we're running in browser or Node.js
        if (typeof window === 'undefined') {
            // Node.js environment
            const fs = require('fs');
            const imageBytes = await fs.promises.readFile(imagePath);
            return {
                inlineData: {
                    data: imageBytes.toString('base64'),
                    mimeType: 'image/jpeg'
                }
            };
        } else {
            // Browser environment
            const response = await fetch(imagePath);
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve({
                    inlineData: {
                        data: reader.result.split(',')[1],
                        mimeType: blob.type
                    }
                });
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }
    }
}

// Export for both Node.js and browser environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageAnalyzer;
} else {
    window.ImageAnalyzer = ImageAnalyzer;
}
