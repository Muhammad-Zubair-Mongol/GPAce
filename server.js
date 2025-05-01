const express = require('express');
const path = require('path');
const multer = require('multer');
const fsPromises = require('fs').promises;
const fs = require('fs');
require('dotenv').config();
const ImageAnalyzer = require('./js/imageAnalyzer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dataStorage = require('./server/dataStorage');
const subtasksRouter = require('./server/routes/subtasks');
const cors = require('cors');
const compression = require('compression');
const { exec } = require('child_process');
const { Worker } = require('worker_threads');
const crypto = require('crypto');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const port = process.env.PORT || 3000;

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Verify API key is loaded
if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY not found in environment variables');
    process.exit(1);
}

// Middleware for parsing JSON and handling CORS
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Initialize image analyzer with API key
const imageAnalyzer = new ImageAnalyzer(process.env.GEMINI_API_KEY);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const userId = req.body.userId || 'default';
        const userDir = path.join(uploadsDir, userId);

        // Create user directory if it doesn't exist
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        cb(null, userDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG and GIF are allowed.'));
        }
    }
});

// Serve static files
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Cache middleware
const cacheControl = (req, res, next) => {
    // Cache static assets for 1 week
    if (req.url.match(/\.(css|js|png|jpg|jpeg|gif|ico|woff|woff2|ttf|svg)$/)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
    }
    // Cache HTML files for 1 hour
    else if (req.url.match(/\.html$/)) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    next();
};

app.use(cacheControl);

// Create a simple in-memory cache for AI responses
const aiResponseCache = new Map();
const AI_CACHE_TTL = 3600 * 1000; // 1 hour

// Handle single file upload
app.post('/upload', upload.single('image'), (req, res) => {
    try {
        console.log('Received file upload request:', req.file);
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Return the file path relative to the uploads directory
        const relativePath = path.relative(uploadsDir, req.file.path).replace(/\\/g, '/');
        res.json({
            success: true,
            filePath: '/uploads/' + relativePath,
            fileName: req.file.filename
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Error uploading file' });
    }
});

// Handle multiple file upload
app.post('/upload-multiple', upload.array('images', 3), (req, res) => {
    try {
        console.log('Received multiple file upload request:', req.files);
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const fileData = req.files.map(file => {
            const relativePath = path.relative(uploadsDir, file.path).replace(/\\/g, '/');
            return {
                filePath: '/uploads/' + relativePath,
                fileName: file.filename
            };
        });

        res.json({
            success: true,
            files: fileData
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Error uploading files' });
    }
});

// Get user settings
app.get('/settings/:userId', async (req, res) => {
    const userId = req.params.userId || 'default';
    const settingsPath = path.join(uploadsDir, userId, 'settings.json');

    try {
        if (await fsPromises.access(settingsPath).catch(() => null)) {
            const settings = JSON.parse(await fsPromises.readFile(settingsPath, 'utf8'));
            res.json(settings);
        } else {
            res.json({});
        }
    } catch (error) {
        console.error('Error reading settings:', error);
        res.status(500).json({ error: 'Error reading settings' });
    }
});

// Save user settings
app.post('/settings/:userId', async (req, res) => {
    const userId = req.params.userId || 'default';
    const userDir = path.join(uploadsDir, userId);
    const settingsPath = path.join(userDir, 'settings.json');

    try {
        if (!(await fsPromises.access(userDir).catch(() => null))) {
            await fsPromises.mkdir(userDir, { recursive: true });
        }

        await fsPromises.writeFile(settingsPath, JSON.stringify(req.body, null, 2));
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving settings:', error);
        res.status(500).json({ error: 'Error saving settings' });
    }
});

// Get saved timetable
app.get('/api/timetable', async (req, res) => {
    try {
        const timetable = await dataStorage.getTimetable();
        res.json({ success: true, data: timetable });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get saved locations
app.get('/api/locations', async (req, res) => {
    try {
        const locations = await dataStorage.getLocations();
        res.json({ success: true, data: locations });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Timetable analysis endpoint
app.post('/api/analyze-timetable', async (req, res) => {
    try {
        const { imagePath, userId = 'default' } = req.body;
        if (!imagePath) {
            return res.status(400).json({ success: false, error: 'No image path provided' });
        }

        // Remove leading slash if present and join with __dirname
        const cleanPath = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
        const fullPath = path.join(__dirname, cleanPath);

        if (!fs.existsSync(fullPath)) {
            return res.status(400).json({ success: false, error: 'Image file not found' });
        }

        // Generate a cache key based on image path and last modified time
        const stats = fs.statSync(fullPath);
        const cacheKey = `${userId}-${imagePath}-${stats.mtimeMs}`;

        // Check if we have a cached response
        if (aiResponseCache.has(cacheKey)) {
            const cachedData = aiResponseCache.get(cacheKey);
            if (Date.now() - cachedData.timestamp < AI_CACHE_TTL) {
                console.log('Using cached AI analysis result');

                // If we have a cached result, we still need to clear and save the timetable data
                await dataStorage.clearTimetable();
                await dataStorage.saveTimetable(cachedData.calendarEvents);

                // Emit the cached result via websocket
                if (io) {
                    io.emit('timetableData', {
                        type: 'timetableData',
                        content: cachedData.calendarEvents,
                        isNewTimetable: true
                    });
                }

                return res.json({
                    success: true,
                    analysis: cachedData.analysis,
                    calendarEvents: cachedData.calendarEvents,
                    fromCache: true
                });
            }
        }

        // Clear existing timetable data first
        await dataStorage.clearTimetable();

        // Generate a unique task ID for this analysis
        const taskId = crypto.randomBytes(8).toString('hex');

        // Create a worker for the CPU-intensive task
        const worker = new Worker('./workers/imageAnalysis.js', {
            workerData: {
                imagePath: fullPath,
                apiKey: process.env.GEMINI_API_KEY
            }
        });

        // Send a quick response to the client
        res.json({
            success: true,
            message: 'Analysis started',
            taskId: taskId
        });

        // Process result in the background
        worker.on('message', async (result) => {
            if (result.success) {
                // Cache the result
                aiResponseCache.set(cacheKey, {
                    analysis: result.analysis,
                    calendarEvents: result.calendarEvents,
                    timestamp: Date.now()
                });

                // Save the timetable data
                await dataStorage.saveTimetable(result.calendarEvents);

                // Notify clients via websocket
                if (io) {
                    io.emit('timetableData', {
                        type: 'timetableData',
                        content: result.calendarEvents,
                        isNewTimetable: true,
                        taskId: taskId,
                        status: 'completed'
                    });
                }
            } else {
                console.error('Worker thread error:', result.error);
                if (io) {
                    io.emit('timetableAnalysisError', {
                        taskId: taskId,
                        error: result.error
                    });
                }
            }
        });

        // Handle worker errors
        worker.on('error', (error) => {
            console.error('Worker error:', error);
            if (io) {
                io.emit('timetableAnalysisError', {
                    taskId: taskId,
                    error: error.message
                });
            }
        });

    } catch (error) {
        console.error('Error starting analysis:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add endpoint to save updated timetable events
app.post('/api/save-timetable', async (req, res) => {
    try {
        const { events } = req.body;

        if (!Array.isArray(events)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid events data format'
            });
        }

        // Validate each event
        const validatedEvents = events.map(event => ({
            id: event.id || Math.random().toString(36).substr(2, 9),
            subject: event.subject || 'Untitled',
            type: ['class', 'study', 'break', 'free'].includes(event.type) ? event.type : 'free',
            startTime: event.startTime,
            endTime: event.endTime,
            date: event.date,
            color: event.color,
            recurring: event.recurring ? {
                frequency: event.recurring.frequency,
                dayOfWeek: event.recurring.dayOfWeek,
                seriesId: event.recurring.seriesId,
                startDate: event.recurring.startDate,
                endDate: event.recurring.endDate
            } : null
        }));

        // Save the updated events
        await dataStorage.saveTimetable(validatedEvents);

        // Notify all connected clients about the update
        if (io) {
            io.emit('timetableData', {
                type: 'timetableData',
                content: validatedEvents
            });
        }

        res.json({
            success: true,
            message: 'Timetable updated successfully'
        });

    } catch (error) {
        console.error('Error saving timetable:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save timetable'
        });
    }
});

// Endpoint to analyze study space image
app.post('/api/analyze-study-space', async (req, res) => {
    try {
        const imagePath = req.body.imagePath;
        if (!imagePath) {
            return res.status(400).json({ error: 'No image path provided' });
        }

        const analysis = await imageAnalyzer.analyzeStudySpace(imagePath);

        // Save the location data
        await dataStorage.saveLocation({
            imagePath: imagePath,
            analysis: analysis
        });

        res.json({
            success: true,
            analysis: analysis
        });

    } catch (error) {
        console.error('Error analyzing study space:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint to get current task
app.get('/api/current-task', async (req, res) => {
    try {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTime = currentHour * 60 + currentMinute;

        // Get today's events
        const events = await dataStorage.getTimetable();
        const today = new Date().toISOString().split('T')[0];

        const currentTask = events.find(event => {
            if (event.date !== today) return false;

            const [startHour, startMinute] = event.startTime.split(':').map(Number);
            const [endHour, endMinute] = event.endTime.split(':').map(Number);

            const startTimeMinutes = startHour * 60 + startMinute;
            const endTimeMinutes = endHour * 60 + endMinute;

            return currentTime >= startTimeMinutes && currentTime < endTimeMinutes;
        });

        if (currentTask) {
            // Calculate progress percentage
            const [startHour, startMinute] = currentTask.startTime.split(':').map(Number);
            const [endHour, endMinute] = currentTask.endTime.split(':').map(Number);

            const startTimeMinutes = startHour * 60 + startMinute;
            const endTimeMinutes = endHour * 60 + endMinute;
            const duration = endTimeMinutes - startTimeMinutes;
            const elapsed = currentTime - startTimeMinutes;

            const progress = Math.min(100, Math.max(0, (elapsed / duration) * 100));

            res.json({
                currentTask,
                progress
            });
        } else {
            res.json({
                currentTask: null,
                progress: 0
            });
        }
    } catch (error) {
        console.error('Error getting current task:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get current task'
        });
    }
});

// Handle routes
app.get('/todoist-callback', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/tasks.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'tasks.html'));
});

app.get('/study-spaces.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'study-spaces.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Routes
app.use('/', subtasksRouter);

// Research endpoint
app.post('/api/research', async (req, res) => {
    try {
        const { query, modelName } = req.body;
        const apiKey = req.headers['x-gemini-key'];

        if (!apiKey) {
            return res.status(400).json({ error: 'API key is required' });
        }

        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        // Use the provided model or default to gemini-2.0-flash
        const selectedModel = modelName || 'gemini-2.0-flash';

        // Initialize Gemini with the selected model
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: selectedModel });

        console.log(`Using Gemini model for research: ${selectedModel}`);

        // Generate content
        const result = await model.generateContent(query);
        const response = await result.response;
        const text = response.text();

        // Return the research results
        res.json({
            message: text,
            sources: [] // In a real implementation, you might want to add source tracking
        });
    } catch (error) {
        console.error('Research error:', error);
        res.status(500).json({ error: 'An error occurred during research' });
    }
});

// Test API key endpoint
app.post('/api/test-api-key', async (req, res) => {
    try {
        const { apiKey } = req.body;

        if (!apiKey) {
            return res.status(400).json({
                success: false,
                error: 'API key is required'
            });
        }

        // Test the API key with a simple prompt
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

        // Try a simple test prompt
        await model.generateContent('Test prompt to verify API key');

        res.json({
            success: true,
            message: 'API key is valid'
        });
    } catch (error) {
        console.error('API key test error:', error);
        res.status(400).json({
            success: false,
            error: 'Invalid API key or API error'
        });
    }
});

// Initialize analyzer endpoint
app.post('/api/initialize-analyzer', async (req, res) => {
    try {
        const { apiKey } = req.body;

        if (!apiKey) {
            return res.status(400).json({
                success: false,
                error: 'API key is required'
            });
        }

        // Initialize a new analyzer instance with the provided key
        try {
            const analyzer = new ImageAnalyzer(apiKey);
            // Store the analyzer instance or key as needed
            process.env.GEMINI_API_KEY = apiKey; // Update the environment variable

            res.json({
                success: true,
                message: 'Analyzer initialized successfully'
            });
        } catch (initError) {
            console.error('Analyzer initialization error:', initError);
            res.status(500).json({
                success: false,
                error: 'Failed to initialize analyzer'
            });
        }
    } catch (error) {
        console.error('Initialize analyzer error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during initialization'
        });
    }
});

// Tavily search API endpoint
app.post('/api/tavily-search', async (req, res) => {
    try {
        const { query, apiKey } = req.body;

        if (!query) {
            return res.status(400).json({ success: false, message: 'Query is required' });
        }

        if (!apiKey) {
            return res.status(400).json({ success: false, message: 'Tavily API key is required' });
        }

        // Create a temporary Python file to execute the Tavily search
        const pythonScriptPath = path.join(__dirname, 'tavily_search_temp.py');
        const scriptContent = `
from tavily import TavilyClient
import json
import sys

try:
    tavily_client = TavilyClient(api_key="${apiKey}")
    response = tavily_client.search("${query.replace(/"/g, '\\"')}")
    print(json.dumps(response))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

        await fsPromises.writeFile(pythonScriptPath, scriptContent);

        // Execute the Python script
        exec(`python "${pythonScriptPath}"`, async (error, stdout, stderr) => {
            // Clean up the temporary script
            await fsPromises.unlink(pythonScriptPath).catch(console.error);

            if (error) {
                console.error(`Tavily search error: ${error.message}`);
                console.error(`stderr: ${stderr}`);
                return res.status(500).json({
                    success: false,
                    message: 'Error executing Tavily search',
                    error: error.message
                });
            }

            try {
                const result = JSON.parse(stdout);
                if (result.error) {
                    return res.status(400).json({
                        success: false,
                        message: `Tavily API error: ${result.error}`
                    });
                }

                return res.json({
                    success: true,
                    results: result.results || [],
                    context: result.context || ''
                });
            } catch (parseError) {
                console.error('Error parsing Tavily response:', parseError);
                console.error('Raw stdout:', stdout);
                return res.status(500).json({
                    success: false,
                    message: 'Error parsing Tavily response',
                    error: parseError.message
                });
            }
        });
    } catch (error) {
        console.error('Tavily search error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error processing Tavily search',
            error: error.message
        });
    }
});

// Recipe API endpoints
app.get('/api/recipes', (req, res) => {
    try {
        // In a real app, this would fetch from a database
        // For now, we'll just return a success message
        res.json({
            success: true,
            message: 'Recipe API is working'
        });
    } catch (error) {
        console.error('Error in recipe API:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

app.post('/api/recipes', express.json(), (req, res) => {
    try {
        const { recipe } = req.body;

        if (!recipe || !recipe.name) {
            return res.status(400).json({
                success: false,
                message: 'Recipe name is required'
            });
        }

        // In a real app, this would save to a database
        // For now, we'll just return success with the recipe
        res.json({
            success: true,
            message: 'Recipe saved successfully',
            recipe
        });
    } catch (error) {
        console.error('Error saving recipe:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

app.get('/api/flashcards', (req, res) => {
    try {
        // In a real app, this would fetch from a database
        // For now, we'll just return a success message
        res.json({
            success: true,
            message: 'Flashcard API is working'
        });
    } catch (error) {
        console.error('Error in flashcard API:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

app.post('/api/flashcards', express.json(), (req, res) => {
    try {
        const { flashcard } = req.body;

        if (!flashcard || !flashcard.title) {
            return res.status(400).json({
                success: false,
                message: 'Flashcard title is required'
            });
        }

        // In a real app, this would save to a database
        // For now, we'll just return success with the flashcard
        res.json({
            success: true,
            message: 'Flashcard saved successfully',
            flashcard
        });
    } catch (error) {
        console.error('Error saving flashcard:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Markdown to DOCX Converter Route - Client-side conversion using Pandoc.js WebAssembly

// Serve the markdown-converter.html page
app.get('/markdown-converter.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'markdown-converter.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        details: err.message
    });
});

// Start server
server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('File upload endpoint: http://localhost:${port}/upload');
    console.log('Settings endpoint: http://localhost:${port}/settings/:userId');
});
