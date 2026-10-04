/**
 * ImageAnalyzer - Browser-compatible image analysis using Gemini API
 * Analyzes timetables and study spaces using Google's Generative AI
 */

async function getGeminiKeyManager() {
    if (typeof window !== 'undefined' && window.geminiKeyManager) {
        return window.geminiKeyManager;
    }
    try {
        const mod = await import('./GeminiKeyManager.js');
        return mod.geminiKeyManager || (typeof window !== 'undefined' ? window.geminiKeyManager : null);
    } catch (e) {
        return typeof window !== 'undefined' ? window.geminiKeyManager : null;
    }
}

class ImageAnalyzer {
    constructor(apiKey = null) {
        this.apiKey = apiKey;
        this.model = null;
        this.initialized = false;
    }

    /**
     * Initialize the analyzer with API key
     * @param {string} apiKey - Gemini API key
     * @param {string} modelName - Optional model name (reads from Settings if not provided)
     */
    async initialize(apiKey = null, modelName = null) {
        try {
            if (!apiKey) {
                const km = await getGeminiKeyManager();
                apiKey = km?.getKey() || null;
            }
            this.apiKey = apiKey;
            let GoogleGenerativeAI;

            // Check if we're in Node.js environment
            if (typeof module !== 'undefined' && module.exports) {
                // Node.js environment - use require
                const module = require('@google/generative-ai');
                GoogleGenerativeAI = module.GoogleGenerativeAI;
            }
            // Check if GoogleGenerativeAI is available globally (loaded via CDN script tag)
            else if (typeof window.GoogleGenerativeAI !== 'undefined') {
                GoogleGenerativeAI = window.GoogleGenerativeAI;
            }
            // Try dynamic import from ES module CDN
            else {
                try {
                    console.log('[ImageAnalyzer] Dynamically importing GoogleGenerativeAI...');
                    const module = await import('https://esm.run/@google/generative-ai@0.24.0');
                    GoogleGenerativeAI = module.GoogleGenerativeAI;
                    // Cache it globally for future use
                    window.GoogleGenerativeAI = GoogleGenerativeAI;
                    console.log('[ImageAnalyzer] GoogleGenerativeAI loaded successfully via dynamic import');
                } catch (importErr) {
                    console.error('[ImageAnalyzer] Failed to dynamically import GoogleGenerativeAI:', importErr);
                    throw new Error('GoogleGenerativeAI SDK could not be loaded. Check your internet connection.');
                }
            }

            if (!GoogleGenerativeAI) {
                throw new Error('GoogleGenerativeAI is not available');
            }

            // Use saved model from Settings if no explicit model provided
            const effectiveModel = modelName || this.getSavedGeminiModel();

            const genAI = new GoogleGenerativeAI(apiKey);
            this.model = genAI.getGenerativeModel({ model: effectiveModel });
            this.initialized = true;
            console.log(`[ImageAnalyzer] Initialized successfully with model: ${effectiveModel}`);
            return true;
        } catch (error) {
            console.error('[ImageAnalyzer] Error initializing:', error);
            this.initialized = false;
            throw error;
        }
    }

    /**
     * Verify API key availability via Firebase function (fallback)
     */
    async verifyApiKey() {
        try {
            if (this.apiKey && this.initialized) {
                return true;
            }

            // Try Firebase callable function as fallback
            if (typeof firebase !== 'undefined' && firebase.functions) {
                const functions = firebase.functions();
                const getGeminiConfig = functions.httpsCallable('getGeminiConfig');
                const result = await getGeminiConfig();
                return result.data.keyAvailable;
            }

            return false;
        } catch (error) {
            console.error('Error verifying API key:', error);
            return false;
        }
    }

    /**
     * Analyze a timetable image
     * @param {string|Blob|File} imageInput - Image path, Blob, or File
     * @returns {Promise<Object>} Analysis results
     */
    async analyzeTimetable(imageInput) {
        try {
            if (!this.initialized || !this.model) {
                throw new Error('ImageAnalyzer not initialized. Call initialize() first.');
            }

            const imageData = await this.loadImageData(imageInput);

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

            let result;
            const keyManager = await getGeminiKeyManager();
            if (keyManager && typeof keyManager.withKeyRotation === 'function') {
                result = await keyManager.withKeyRotation(async (activeKey) => {
                    const model = await this.createModelWithKey(activeKey);
                    return await model.generateContent([prompt, imageData]);
                }, { label: 'Timetable analysis' });
            } else {
                result = await this.model.generateContent([prompt, imageData]);
            }
            const response = await result.response;
            const text = response.text();

            try {
                // Extract JSON from response (may be wrapped in markdown)
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const analysis = JSON.parse(jsonMatch[0]);
                    return {
                        ...analysis,
                        summary: this.generateSummary(analysis)
                    };
                }
                throw new Error('No JSON found in response');
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

    /**
     * Analyze a study space image
     * @param {string|Blob|File} imageInput - Image path, Blob, or File
     * @returns {Promise<Object>} Analysis results
     */
    async analyzeStudySpace(imageInput) {
        try {
            if (!this.initialized || !this.model) {
                throw new Error('ImageAnalyzer not initialized. Call initialize() first.');
            }

            const imageData = await this.loadImageData(imageInput);

            const prompt = `
                Analyze this study space image and extract the following information:
                1. Estimated noise level (quiet, moderate, noisy)
                2. Available seating (empty, somewhat occupied, full)
                3. Lighting conditions (good, moderate, poor)
                4. Visible power outlets (yes/no)
                5. Type of space (library, cafe, classroom, etc.)
                
                Format the response as a JSON object.
            `;

            let result;
            const keyManager = await getGeminiKeyManager();
            if (keyManager && typeof keyManager.withKeyRotation === 'function') {
                result = await keyManager.withKeyRotation(async (activeKey) => {
                    const model = await this.createModelWithKey(activeKey);
                    return await model.generateContent([prompt, imageData]);
                }, { label: 'Study space analysis' });
            } else {
                result = await this.model.generateContent([prompt, imageData]);
            }
            const response = await result.response;
            const text = response.text();

            try {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                throw new Error('No JSON found in response');
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
    /**
     * Analyze task notes image(s) to extract actionable tasks
     * SMART APPROACH: Always try combined first (1 API call), only fallback to page-by-page if needed
     * @param {string|Blob|File|Array} imageInput - Single or Array of Image paths, Blobs, or Files
     * @param {Array} availableSubjects - List of available subjects {name, tag}
     * @returns {Promise<Array>} List of extracted tasks
     */
    async analyzeTaskNotes(imageInput, availableSubjects = []) {
        try {
            if (!this.initialized || !this.model) {
                throw new Error('ImageAnalyzer not initialized. Call initialize() first.');
            }

            // Normalize input to array
            const inputs = Array.isArray(imageInput) ? imageInput : [imageInput];
            const pageCount = inputs.length;

            console.log(`[ImageAnalyzer] Analyzing ${pageCount} page(s) for tasks...`);

            const subjectsJson = JSON.stringify(availableSubjects.map(s => ({ name: s.name, tag: s.tag })));
            const today = new Date().toISOString().split('T')[0];

            // Load all image data first
            const imageParts = await Promise.all(inputs.map(img => this.loadImageData(img)));

            // STRATEGY: Always try combined analysis first (1 API call)
            // Only fall back to page-by-page if combined fails badly
            console.log('[ImageAnalyzer] Trying combined analysis (1 API call)...');

            const combinedTasks = await this.tryCombinedAnalysis(
                imageParts, pageCount, subjectsJson, today
            );

            // If combined analysis worked well (found tasks), use those
            if (combinedTasks && combinedTasks.length >= Math.min(3, pageCount)) {
                console.log(`[ImageAnalyzer] Combined analysis found ${combinedTasks.length} tasks - using these`);
                return combinedTasks;
            }

            // If combined analysis found some tasks but not many, still use them
            // (Better than wasting more API calls)
            if (combinedTasks && combinedTasks.length > 0) {
                console.log(`[ImageAnalyzer] Combined analysis found ${combinedTasks.length} tasks (may be incomplete)`);
                return combinedTasks;
            }

            // Combined analysis completely failed - try page-by-page as last resort
            // But only if we have 2+ pages (no point for 1 page)
            if (pageCount >= 2) {
                console.log('[ImageAnalyzer] Combined failed, trying page-by-page...');
                const pageByPageTasks = await this.analyzeTaskNotesPageByPage(
                    inputs, imageParts, subjectsJson, today
                );

                if (pageByPageTasks && pageByPageTasks.length > 0) {
                    return pageByPageTasks;
                }
            }

            // Everything failed
            console.warn('[ImageAnalyzer] No tasks extracted from any method');
            return [];

        } catch (error) {
            console.error('[ImageAnalyzer] Error analyzing task notes:', error);

            // Check for quota error and provide helpful message
            if (this.isQuotaError(error)) {
                throw new Error('API quota exceeded. Please try again later or add backup API keys in settings.');
            }

            throw error;
        }
    }

    /**
     * Check if error is a quota/rate limit error
     */
    isQuotaError(error) {
        const msg = error?.message?.toLowerCase() || '';
        return msg.includes('429') ||
            msg.includes('quota') ||
            msg.includes('rate limit') ||
            msg.includes('too many requests');
    }

    /**
     * Analyze a SINGLE page for tasks (used for progressive/streaming UI)
     * @param {Blob|File} pageImage - Single image
     * @param {Array} availableSubjects - List of available subjects
     * @param {number} pageNum - Current page number (1-indexed)
     * @param {number} totalPages - Total number of pages being scanned
     * @returns {Promise<Array>} List of extracted tasks from this page
     */
    async analyzeSinglePage(pageImage, availableSubjects = [], pageNum = 1, totalPages = 1) {
        if (!this.initialized || !this.model) {
            throw new Error('ImageAnalyzer not initialized. Call initialize() first.');
        }

        console.log(`[ImageAnalyzer] Analyzing single page ${pageNum}/${totalPages}...`);

        const subjectsJson = JSON.stringify(availableSubjects.map(s => ({ name: s.name, tag: s.tag })));
        const today = new Date().toISOString().split('T')[0];

        // Load the image data
        const imageData = await this.loadImageData(pageImage);

        // Build the prompt for this single page
        const pagePrompt = `
You are analyzing PAGE ${pageNum} of ${totalPages} of handwritten/printed notes.

**CRITICAL: Extract EVERY task, todo, assignment, deadline from THIS page.**
**Be AGGRESSIVE - extract everything that could be an action item!**

Today's date: ${today}

Available subjects (match if possible, otherwise use "General"):
${subjectsJson}

**EXTRACT ALL OF THESE:**
- Assignment questions (numbers like 6-8, 6-10, 6-29)
- Project tasks (reports, slides, graphs, images, presentations)
- Deadlines and due dates (submit by, due, next week, tomorrow)
- Study/revision notes (revise chapter, study pages 510-541)
- Lab work, practicals, experiments
- To-do items, checkboxes, bullets
- Any circled, underlined, or highlighted items
- Side notes and scribbles with actionable content
- Personal/relaxed goals (gym, hobbies, meetings, events, shopping)
- Even vague notes like "have to make images" or "meaning of centralization"

**SECTION CLASSIFICATION:**
- "Assignment" - homework, projects, reports, essays, question numbers
- "Quizzes" - quizzes, class tests
- "Mid Term / OHT" - midterms, OHT, sessionals, post-mid work
- "Finals" - final exams
- "Revision" - study, revise, review, read chapters

**PRIORITY (1=lowest, 4=highest):**
- 4 = exam prep, urgent deadlines, "must complete"
- 3 = assignments due soon, important projects
- 2 = regular assignments, homework
- 1 = revision, optional study, notes to review

**OUTPUT FORMAT - STRICT JSON ARRAY ONLY:**
[
    {
        "content": "Task description here",
        "subject": "SubjectTag or General",
        "section": "Assignment|Quizzes|Mid Term / OHT|Finals|Revision",
        "dueDate": "YYYY-MM-DD or null",
        "due_string": "original date text if any",
        "priority": 1-4,
        "page": ${pageNum}
    }
]

Extract 3-15 tasks from this page. Return ONLY the JSON array, no markdown, no explanation.
`;

        try {
            // Use GeminiKeyManager if available for PROPER key rotation
            let result;
            if (window.geminiKeyManager && typeof window.geminiKeyManager.withKeyRotation === 'function') {
                // The key rotation passes a new API key - we must create a fresh model with it!
                result = await window.geminiKeyManager.withKeyRotation(async (apiKey) => {
                    // Create a fresh model with the rotated key
                    const freshModel = await this.createModelWithKey(apiKey);
                    return await freshModel.generateContent([pagePrompt, imageData]);
                }, { label: `Page ${pageNum} analysis` });
            } else {
                // Fallback to cached model
                result = await this.model.generateContent([pagePrompt, imageData]);
            }

            const response = await result.response;
            const text = response.text();

            console.log(`[ImageAnalyzer] Page ${pageNum} response length:`, text.length);

            const pageTasks = this.parseTaskResponse(text);

            if (Array.isArray(pageTasks)) {
                // Ensure each task has page number
                pageTasks.forEach(task => {
                    task.page = pageNum;
                });
                return pageTasks;
            }

            return [];

        } catch (error) {
            console.error(`[ImageAnalyzer] Error on page ${pageNum}:`, error);
            throw error; // Let caller handle error
        }
    }

    /**
     * Create a fresh model instance with a specific API key
     * Used for key rotation - each rotated key needs a new model
     */
    async createModelWithKey(apiKey) {
        let GoogleGenerativeAI = window.GoogleGenerativeAI;

        if (!GoogleGenerativeAI) {
            // Try to import it
            try {
                const module = await import('https://esm.run/@google/generative-ai@0.24.0');
                GoogleGenerativeAI = module.GoogleGenerativeAI;
                window.GoogleGenerativeAI = GoogleGenerativeAI;
            } catch (e) {
                throw new Error('GoogleGenerativeAI SDK not available');
            }
        }

        // Get the saved model from Settings (check multiple storage locations)
        const savedModel = this.getSavedGeminiModel();
        console.log(`[ImageAnalyzer] Using model: ${savedModel}`);

        const genAI = new GoogleGenerativeAI(apiKey);
        return genAI.getGenerativeModel({ model: savedModel });
    }

    /**
     * Get the saved Gemini model from Settings
     * Checks multiple storage locations for compatibility
     */
    getSavedGeminiModel() {
        // Default fallback
        const defaultModel = 'gemini-3.6-flash';

        try {
            // 1. Try StorageService format (gpace_ prefix with JSON)
            let model = localStorage.getItem('gpace_api.geminiModel');
            if (model) {
                try { model = JSON.parse(model); } catch (e) { /* not JSON */ }
                if (model && typeof model === 'string') {
                    console.log(`[ImageAnalyzer] Found model via gpace_api.geminiModel: ${model}`);
                    return model;
                }
            }

            // 2. Try gpace_geminiModel (older format)
            model = localStorage.getItem('gpace_geminiModel');
            if (model) {
                try { model = JSON.parse(model); } catch (e) { /* not JSON */ }
                if (model && typeof model === 'string') {
                    console.log(`[ImageAnalyzer] Found model via gpace_geminiModel: ${model}`);
                    return model;
                }
            }

            // 3. Try raw localStorage (legacy)
            model = localStorage.getItem('geminiModel');
            if (model && typeof model === 'string') {
                console.log(`[ImageAnalyzer] Found model via geminiModel: ${model}`);
                return model;
            }

            console.log(`[ImageAnalyzer] No saved model found, using default: ${defaultModel}`);
            return defaultModel;

        } catch (e) {
            console.warn('[ImageAnalyzer] Error reading saved model:', e);
            return defaultModel;
        }
    }

    /**
     * Build an enhanced prompt that aggressively extracts ALL tasks
     */
    buildEnhancedTaskPrompt(pageCount, subjectsJson, today) {
        return `
You are an EXPERT academic task extractor. You MUST extract EVERY actionable item from the notes.

**CRITICAL INSTRUCTIONS:**
1. You are analyzing ${pageCount} page(s) of handwritten/printed notes
2. You MUST extract EVERY task, todo, assignment, deadline, and action item
3. Extract from ALL pages - do NOT skip any page
4. Even partial notes or side scribbles may contain tasks - INCLUDE THEM
5. If a bullet point or numbered item exists, it's likely a task - EXTRACT IT
6. Be AGGRESSIVE - extract 5-15+ tasks if the notes are detailed

**TODAY'S DATE:** ${today}

**AVAILABLE SUBJECTS (match if possible):**
${subjectsJson}
If no match found, use "General".

**WHAT TO EXTRACT (look for ALL of these):**
- Assignments with question numbers (e.g., "6-8, 6-10, 6-29")
- Project work ("complete report", "make slides", "finish project")
- Deadlines ("submit by", "due", "next week", "tomorrow")
- Revision notes ("revise chapter", "study pages 510-541")
- Lab work, practical work, experiments
- Presentation prep, viva prep
- Personal study goals ("understand X", "practice Y")
- To-do items with checkboxes or bullets
- Anything underlined, circled, or highlighted
- Side notes like "have to make images", "create graphs"
- Even random tasks like "meaning of centralization"

**SECTION CLASSIFICATION:**
- "Assignment" - homework, projects, reports, essays, question numbers
- "Quizzes" - quizzes, class tests
- "Mid Term / OHT" - midterms, OHT, sessionals, post-mid work
- "Finals" - final exams
- "Revision" - study, revise, review, read chapters

**PRIORITY (1=lowest, 4=highest):**
- 4 = exam prep, urgent deadlines, "must complete"
- 3 = assignments due soon, important projects
- 2 = regular assignments, homework
- 1 = revision, optional study, notes to review

**OUTPUT FORMAT - STRICT JSON ARRAY:**
[
    {
        "content": "Complete Assignment questions 6-8, 6-10, 6-18, 6-26",
        "subject": "SubjectTag or General",
        "section": "Assignment",
        "dueDate": "YYYY-MM-DD or null",
        "due_string": "next Monday",
        "priority": 2,
        "page": 1
    },
    {
        "content": "Make report accepted, compile all graphs and data",
        "subject": "AVP",
        "section": "Assignment",
        "dueDate": null,
        "due_string": "",
        "priority": 3,
        "page": 1
    },
    {
        "content": "Study pages 510-541 for Turboshaft",
        "subject": "Propulsion",
        "section": "Revision",
        "dueDate": null,
        "due_string": "",
        "priority": 2,
        "page": 2
    }
]

**REMEMBER:**
- Extract EVERYTHING that looks like an action item
- Include page numbers for reference
- Return ONLY the JSON array, no other text
- Aim for 5-20 tasks from detailed notes
`;
    }

    /**
     * Try combined analysis - all pages in one API call
     */
    async tryCombinedAnalysis(imageParts, pageCount, subjectsJson, today) {
        try {
            const prompt = this.buildEnhancedTaskPrompt(pageCount, subjectsJson, today);

            let result;
            const keyManager = await getGeminiKeyManager();
            if (keyManager && typeof keyManager.withKeyRotation === 'function') {
                result = await keyManager.withKeyRotation(async (activeKey) => {
                    const freshModel = await this.createModelWithKey(activeKey);
                    return await freshModel.generateContent([prompt, ...imageParts]);
                }, { label: 'Combined notes analysis' });
            } else {
                result = await this.model.generateContent([prompt, ...imageParts]);
            }

            const response = await result.response;
            const text = response.text();

            console.log('[ImageAnalyzer] Combined response length:', text.length);

            return this.parseTaskResponse(text);

        } catch (error) {
            console.error('[ImageAnalyzer] Combined analysis failed:', error);

            // Fail fast on quota errors - don't try page-by-page
            if (this.isQuotaError(error)) {
                throw error;
            }

            return null;
        }
    }

    /**
     * Analyze multiple pages one-by-one (FALLBACK ONLY)
     * Uses pre-loaded imageParts to avoid re-loading
     */
    async analyzeTaskNotesPageByPage(inputs, imageParts, subjectsJson, today) {
        const allTasks = [];
        const pageCount = inputs.length;

        // Limit to first 3 pages to save API calls
        const maxPages = Math.min(pageCount, 3);
        console.log(`[ImageAnalyzer] Page-by-page: analyzing ${maxPages} of ${pageCount} pages`);

        for (let i = 0; i < maxPages; i++) {
            const pageNum = i + 1;
            console.log(`[ImageAnalyzer] Analyzing page ${pageNum}/${maxPages}...`);

            try {
                const imageData = imageParts[i];

                const pagePrompt = `
You are analyzing PAGE ${pageNum} of ${pageCount} of handwritten/printed notes.

**CRITICAL: Extract EVERY task, todo, assignment, deadline from THIS page.**

Today's date: ${today}
Available subjects: ${subjectsJson}

**EXTRACT ALL OF THESE:**
- Assignment questions (numbers like 6-8, 6-10)
- Project tasks (reports, slides, graphs, images)
- Deadlines and due dates
- Study/revision notes (chapters, pages)
- To-do items, checkboxes, bullets
- Any circled, underlined, or highlighted items
- Side notes and scribbles with actionable content

**OUTPUT FORMAT - JSON ARRAY ONLY:**
[
    {
        "content": "Task description here",
        "subject": "SubjectTag or General",
        "section": "Assignment|Quizzes|Mid Term / OHT|Finals|Revision",
        "dueDate": "YYYY-MM-DD or null",
        "due_string": "original date text",
        "priority": 1-4,
        "page": ${pageNum}
    }
]

Extract 3-10+ tasks from this page. Return ONLY the JSON array.
`;

                let result;
                const keyManager = await getGeminiKeyManager();
                if (keyManager && typeof keyManager.withKeyRotation === 'function') {
                    result = await keyManager.withKeyRotation(async (activeKey) => {
                        const freshModel = await this.createModelWithKey(activeKey);
                        return await freshModel.generateContent([pagePrompt, imageData]);
                    }, { label: `Page ${pageNum} notes analysis` });
                } else {
                    result = await this.model.generateContent([pagePrompt, imageData]);
                }

                const response = await result.response;
                const text = response.text();

                const pageTasks = this.parseTaskResponse(text);

                if (Array.isArray(pageTasks) && pageTasks.length > 0) {
                    pageTasks.forEach(task => {
                        task.page = task.page || pageNum;
                    });
                    allTasks.push(...pageTasks);
                    console.log(`[ImageAnalyzer] Page ${pageNum}: found ${pageTasks.length} tasks`);
                } else {
                    console.warn(`[ImageAnalyzer] Page ${pageNum}: no tasks found`);
                }

                // Delay between pages to avoid rate limiting
                if (i < maxPages - 1) {
                    await new Promise(r => setTimeout(r, 1500)); // Increased to 1.5s
                }

            } catch (pageError) {
                console.error(`[ImageAnalyzer] Error on page ${pageNum}:`, pageError);

                // FAIL FAST on quota errors - no point trying more pages
                if (this.isQuotaError(pageError)) {
                    console.error('[ImageAnalyzer] Quota exceeded - stopping further page analysis');

                    // If we got some tasks, return them
                    if (allTasks.length > 0) {
                        console.log(`[ImageAnalyzer] Returning ${allTasks.length} tasks extracted before quota error`);
                        return this.deduplicateTasks(allTasks);
                    }

                    throw pageError;
                }
                // Other errors: continue with remaining pages
            }
        }

        console.log(`[ImageAnalyzer] Total tasks extracted: ${allTasks.length}`);

        // Deduplicate similar tasks
        const dedupedTasks = this.deduplicateTasks(allTasks);
        console.log(`[ImageAnalyzer] After deduplication: ${dedupedTasks.length}`);

        return dedupedTasks;
    }

    /**
     * Parse task response from AI text
     */
    parseTaskResponse(text) {
        try {
            const jsonMatch = text.match(/\[[\s\S]*\]/); // Match array
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            // Fallback: try matching object if single task
            const objectMatch = text.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                return [JSON.parse(objectMatch[0])];
            }
            console.warn('[ImageAnalyzer] No JSON found in response');
            return [];
        } catch (e) {
            console.error('[ImageAnalyzer] Error parsing response:', e);
            return {
                error: 'Could not parse task data',
                rawResponse: text
            };
        }
    }

    /**
     * Remove duplicate tasks based on content similarity
     */
    deduplicateTasks(tasks) {
        if (!Array.isArray(tasks) || tasks.length <= 1) return tasks;

        const unique = [];
        const seenContent = new Set();

        for (const task of tasks) {
            const content = (task.content || '').toLowerCase().trim();

            // Check for exact or near-exact duplicates
            let isDupe = false;
            for (const seen of seenContent) {
                if (this.calculateTaskSimilarity(content, seen) > 0.85) {
                    isDupe = true;
                    break;
                }
            }

            if (!isDupe && content.length > 3) {
                unique.push(task);
                seenContent.add(content);
            }
        }

        return unique;
    }

    /**
     * Calculate similarity between two task strings
     */
    calculateTaskSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;

        const words1 = new Set(str1.split(/\s+/));
        const words2 = new Set(str2.split(/\s+/));

        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);

        return intersection.size / union.size;
    }

    /**
     * Generate summary from analysis
     * @param {Object} analysis - Parsed analysis object
     * @returns {Object} Summary object
     */
    generateSummary(analysis) {
        const summary = {
            dailyFreeTime: {},
            bestStudyTimes: [],
            timeManagementTips: []
        };

        try {
            // Calculate and format daily free time
            if (analysis.schedule) {
                for (const [day, slots] of Object.entries(analysis.schedule)) {
                    if (Array.isArray(slots)) {
                        const freeSlots = slots.filter(slot => slot.type === 'free');
                        const totalFreeHours = freeSlots.reduce((total, slot) =>
                            total + parseFloat(slot.duration || 0), 0);
                        summary.dailyFreeTime[day] = {
                            hours: totalFreeHours,
                            slots: freeSlots.map(slot => `${slot.start}-${slot.end}`)
                        };
                    }
                }
            }

            // Identify best study times
            if (analysis.dailyAnalysis) {
                for (const [day, data] of Object.entries(analysis.dailyAnalysis)) {
                    if (data.primeStudySlots && Array.isArray(data.primeStudySlots)) {
                        data.primeStudySlots.forEach(slot => {
                            summary.bestStudyTimes.push({
                                day,
                                time: `${slot.start}-${slot.end}`,
                                duration: slot.duration
                            });
                        });
                    }
                }
            }

            // Add time management tips
            if (analysis.recommendations) {
                summary.timeManagementTips = [
                    ...(analysis.recommendations.study_tips || []),
                    ...(analysis.recommendations.break_management || [])
                ];
            }
        } catch (e) {
            console.warn('Error generating summary:', e);
        }

        return summary;
    }

    /**
     * Load image data for API consumption.
     *
     * Browser inputs stay on the FileReader adapter so existing pages retain
     * their File/Blob behavior.  Node inputs use Buffer and fs/fetch directly;
     * they never require window or FileReader to exist.
     *
     * @param {string|Buffer|Uint8Array|ArrayBuffer|Blob|File} imageInput
     * @returns {Promise<Object>} Image data object for Gemini API
     */
    async loadImageData(imageInput) {
        const isNode = typeof process !== 'undefined' && Boolean(process.versions && process.versions.node) && typeof window === 'undefined';
        if (isNode) return this.loadNodeImageData(imageInput);
        return this.loadBrowserImageData(imageInput);
    }

    async loadBrowserImageData(imageInput) {
        const hasBlob = typeof Blob !== 'undefined' && imageInput instanceof Blob;
        const hasFile = typeof File !== 'undefined' && imageInput instanceof File;
        if (hasBlob || hasFile) {
            if (typeof FileReader === 'function') {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve({
                        inlineData: {
                            data: String(reader.result).split(',')[1],
                            mimeType: imageInput.type || 'image/jpeg'
                        }
                    });
                    reader.onerror = reject;
                    reader.readAsDataURL(imageInput);
                });
            }
            const bytes = new Uint8Array(await imageInput.arrayBuffer());
            return {
                inlineData: {
                    data: this.bytesToBase64(bytes),
                    mimeType: imageInput.type || 'image/jpeg'
                }
            };
        }

        if (typeof imageInput === 'string') {
            const response = await fetch(imageInput);
            if (!response.ok) throw new Error(`Unable to load image (${response.status})`);
            const blob = await response.blob();
            return this.loadBrowserImageData(blob);
        }

        throw new Error('Invalid image input type');
    }

    async loadNodeImageData(imageInput) {
        const fs = require('node:fs').promises;
        const path = require('node:path');
        const { fileURLToPath } = require('node:url');

        let buffer;
        let mimeType;
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(imageInput)) {
            buffer = imageInput;
        } else if (typeof Uint8Array !== 'undefined' && imageInput instanceof Uint8Array) {
            buffer = Buffer.from(imageInput);
        } else if (typeof ArrayBuffer !== 'undefined' && imageInput instanceof ArrayBuffer) {
            buffer = Buffer.from(new Uint8Array(imageInput));
        } else if (imageInput && typeof imageInput.arrayBuffer === 'function') {
            buffer = Buffer.from(await imageInput.arrayBuffer());
            mimeType = imageInput.type;
        } else if (typeof imageInput === 'string') {
            const dataUrl = /^data:([^;,]+)?;base64,(.*)$/s.exec(imageInput);
            if (dataUrl) {
                buffer = Buffer.from(dataUrl[2], 'base64');
                mimeType = dataUrl[1];
            } else {
                let sourcePath = imageInput;
                if (/^file:/i.test(imageInput)) sourcePath = fileURLToPath(imageInput);
                if (/^https?:/i.test(imageInput)) {
                    const response = await fetch(imageInput);
                    if (!response.ok) throw new Error(`Unable to load image (${response.status})`);
                    buffer = Buffer.from(await response.arrayBuffer());
                    mimeType = response.headers.get('content-type') || undefined;
                } else {
                    buffer = await fs.readFile(sourcePath);
                    mimeType = this.mimeTypeForPath(sourcePath);
                }
            }
        } else {
            throw new Error('Invalid image input type');
        }

        if (!buffer || buffer.length === 0) throw new Error('Image input is empty');
        return {
            inlineData: {
                data: buffer.toString('base64'),
                mimeType: mimeType || 'image/jpeg'
            }
        };
    }

    mimeTypeForPath(filePath) {
        const extension = require('node:path').extname(filePath).toLowerCase();
        return {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.bmp': 'image/bmp',
            '.tif': 'image/tiff',
            '.tiff': 'image/tiff'
        }[extension] || 'application/octet-stream';
    }

    bytesToBase64(bytes) {
        if (typeof btoa === 'function') {
            let binary = '';
            const chunkSize = 0x8000;
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
            }
            return btoa(binary);
        }
        return Buffer.from(bytes).toString('base64');
    }
}

// Export for browser environment
if (typeof window !== 'undefined') {
    window.ImageAnalyzer = ImageAnalyzer;
}

// Export for Node.js environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageAnalyzer;
}
