const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

router.post('/api/generate-subtasks', async (req, res) => {
    try {
        console.log('Received request for subtask generation:', req.body);
        const { prompt } = req.body;
        
        if (!prompt) {
            throw new Error('No prompt provided');
        }

        // Get the generative model
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
        
        console.log('Generating content with prompt:', prompt);
        
        // Generate content
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        console.log('Generated text:', text);
        
        // Parse the numbered list into an array of subtasks
        const subtasks = text
            .split('\n')
            .filter(line => /^\d+\./.test(line.trim()))
            .map(line => {
                // Remove numbers and clean up the text
                let subtask = line.replace(/^\d+\.\s*/, '').trim();
                // Remove asterisks
                subtask = subtask.replace(/\*\*/g, '');
                // Remove time references (e.g., "(15 minutes)", "15-20 minutes", etc.)
                subtask = subtask.replace(/\(\d+(?:-\d+)?\s*(?:min(?:ute)?s?)?\)/gi, '');
                subtask = subtask.replace(/\d+(?:-\d+)?\s*(?:min(?:ute)?s?)/gi, '');
                subtask = subtask.replace(/\(approximately.*?\)/gi, '');
                subtask = subtask.replace(/takes?\s+about\s+\d+(?:-\d+)?\s*(?:min(?:ute)?s?)/gi, '');
                // Clean up any leftover artifacts
                subtask = subtask.replace(/\s+/g, ' ').trim();
                subtask = subtask.replace(/\s*[-:]\s*$/, '');
                return subtask;
            });
        
        console.log('Parsed subtasks:', subtasks);
        
        if (subtasks.length === 0) {
            // If no numbered list is found, split by newlines and clean up
            const fallbackSubtasks = text
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
            
            res.json({ subtasks: fallbackSubtasks });
        } else {
            res.json({ subtasks });
        }
    } catch (error) {
        console.error('Error generating subtasks:', error);
        res.status(500).json({ 
            error: 'Failed to generate subtasks',
            details: error.message 
        });
    }
});

module.exports = router;
