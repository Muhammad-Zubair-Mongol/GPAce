/**
 * ContentClassifier.js
 * Smart AI-powered content classification for Notes Analyzer
 * 
 * Classifies extracted tasks into:
 * - Academic (exams, assignments, subjects, lab work, etc.)
 * - Relaxed/Extracurricular (sports, clubs, events, hobbies, personal, etc.)
 * 
 * Integrated with GeminiKeyManager for multi-key failover
 * 
 * @author GPAce Team
 * @version 1.0.0
 */

// Storage key for relaxed mode tasks
const RELAXED_TASKS_KEY = 'relaxed_mode_tasks';

// Categories for relaxed mode
const RELAXED_CATEGORIES = [
    'sports', 'music', 'arts', 'clubs', 'volunteering',
    'health', 'fitness', 'social', 'entertainment', 'hobby',
    'personal', 'travel', 'family', 'meditation', 'other'
];

// Keywords that indicate academic content
const ACADEMIC_KEYWORDS = [
    'exam', 'test', 'quiz', 'assignment', 'homework', 'lecture', 'class',
    'submit', 'submission', 'deadline', 'project', 'lab', 'report', 'essay',
    'thesis', 'presentation', 'grade', 'gpa', 'semester', 'syllabus',
    'chapter', 'revision', 'study', 'midterm', 'final', 'oht', 'sessional',
    'professor', 'teacher', 'course', 'subject', 'module', 'credit',
    'attendance', 'notes', 'textbook', 'reading', 'research', 'paper'
];

// Keywords that indicate relaxed/extracurricular content
const RELAXED_KEYWORDS = [
    'gym', 'workout', 'exercise', 'fitness', 'sports', 'basketball', 'football',
    'soccer', 'cricket', 'tennis', 'swimming', 'running', 'yoga', 'meditation',
    'club', 'meetup', 'event', 'fest', 'hackathon', 'competition', 'tournament',
    'music', 'band', 'concert', 'dance', 'drama', 'theater', 'art', 'painting',
    'movie', 'watch', 'netflix', 'gaming', 'game', 'party', 'hangout',
    'volunteer', 'ngo', 'community', 'leadership', 'organize', 'team',
    'travel', 'trip', 'vacation', 'family', 'friends', 'dinner', 'lunch',
    'hobby', 'photography', 'coding challenge', 'personal project', 'side project',
    'google developer', 'microsoft learn', 'aws', 'tech talk', 'webinar',
    'podcast', 'blog', 'journal', 'diary', 'reading for fun', 'book club'
];

class ContentClassifier {
    constructor() {
        this.sessionSkipConfirmation = false;
        this.maxClassificationRetries = 3;
    }

    /**
     * Quick local classification based on keywords (no API call)
     * @param {string} content - Text content to classify
     * @returns {Object} { type: 'academic'|'relaxed', confidence: 0-1 }
     */
    quickClassify(content) {
        if (!content) return { type: 'academic', confidence: 0.5 };

        const lowerContent = content.toLowerCase();

        let academicScore = 0;
        let relaxedScore = 0;

        // Count keyword matches
        ACADEMIC_KEYWORDS.forEach(keyword => {
            if (lowerContent.includes(keyword)) academicScore++;
        });

        RELAXED_KEYWORDS.forEach(keyword => {
            if (lowerContent.includes(keyword)) relaxedScore++;
        });

        // Calculate confidence based on score difference
        const total = academicScore + relaxedScore;
        if (total === 0) return { type: 'academic', confidence: 0.5 }; // Default to academic

        const academicRatio = academicScore / total;

        if (academicRatio > 0.6) {
            return { type: 'academic', confidence: academicRatio };
        } else if (academicRatio < 0.4) {
            return { type: 'relaxed', confidence: 1 - academicRatio };
        }

        // Ambiguous - default to academic with low confidence
        return { type: 'academic', confidence: 0.5 };
    }

    /**
     * AI-powered classification using Gemini
     * @param {Array} tasks - Array of task objects with content/title
     * @returns {Promise<Object>} { academic: [], relaxed: [] }
     */
    async classifyWithAI(tasks) {
        if (!tasks || tasks.length === 0) {
            return { academic: [], relaxed: [] };
        }

        console.log('[ContentClassifier] Classifying', tasks.length, 'tasks with AI');

        // Build a compact representation for classification
        const taskDescriptions = tasks.map((task, index) => {
            const content = task.content || task.title || '';
            const desc = task.description || '';
            return `${index + 1}. ${content} ${desc}`.trim();
        }).join('\n');

        const classificationPrompt = `
You are a task classification assistant. Classify each task below into ONE of two categories:

**ACADEMIC** - Tasks related to education, coursework, exams, assignments, studying, research, classes
Examples: "Submit assignment", "Revise calculus", "Prepare for midterm", "Lab report due"

**RELAXED** - Tasks related to extracurricular activities, hobbies, sports, clubs, personal life, health, entertainment
Examples: "Gym at 6pm", "Attend Google Developer Club", "Watch movie", "Basketball practice", "Meditation"

Tasks to classify:
${taskDescriptions}

**IMPORTANT: Return ONLY a valid JSON object** with this exact structure:
{
    "academic_indices": [1, 2],
    "relaxed_indices": [3, 4, 5],
    "relaxed_categories": {
        "3": "fitness",
        "4": "clubs",
        "5": "entertainment"
    }
}

Where indices are the task numbers (1-based) from the list above.
Valid relaxed categories: sports, music, arts, clubs, volunteering, health, fitness, social, entertainment, hobby, personal, travel, family, other
`;

        try {
            // Use GeminiKeyManager if available
            let responseText;

            if (window.geminiKeyManager && window.geminiKeyManager.keys.length > 0) {
                responseText = await window.geminiKeyManager.withKeyRotation(async (apiKey) => {
                    const { GoogleGenerativeAI } = await import('https://esm.run/@google/generative-ai@0.24.0');
                    const genAI = new GoogleGenerativeAI(apiKey);
                    const model = genAI.getGenerativeModel({
                        model: 'gemini-3.6-flash',
                        generationConfig: {
                            maxOutputTokens: 256,
                            temperature: 0.1 // Low temp for consistent classification
                        }
                    });

                    const result = await model.generateContent(classificationPrompt);
                    const response = await result.response;
                    return response.text();
                }, { label: 'Task Classification', maxTotalRetries: this.maxClassificationRetries });
            } else {
                // Fallback to single key
                const apiKey = await this.getApiKey();
                if (!apiKey) {
                    console.warn('[ContentClassifier] No API key, using local classification');
                    return this.classifyLocally(tasks);
                }

                const { GoogleGenerativeAI } = await import('https://esm.run/@google/generative-ai@0.24.0');
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({
                    model: 'gemini-1.5-flash',
                    generationConfig: {
                        maxOutputTokens: 256,
                        temperature: 0.1
                    }
                });

                const result = await model.generateContent(classificationPrompt);
                const response = await result.response;
                responseText = response.text();
            }

            // Parse the AI response
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.warn('[ContentClassifier] No JSON in response, falling back to local');
                return this.classifyLocally(tasks);
            }

            const classification = JSON.parse(jsonMatch[0]);

            // Map indices back to tasks
            const academic = [];
            const relaxed = [];

            (classification.academic_indices || []).forEach(idx => {
                const task = tasks[idx - 1]; // Convert to 0-based
                if (task) academic.push(task);
            });

            (classification.relaxed_indices || []).forEach(idx => {
                const task = tasks[idx - 1];
                if (task) {
                    // Add category from AI
                    const category = classification.relaxed_categories?.[String(idx)] || 'other';
                    relaxed.push({ ...task, relaxedCategory: category });
                }
            });

            console.log('[ContentClassifier] AI classification result:', {
                academic: academic.length,
                relaxed: relaxed.length
            });

            return { academic, relaxed };

        } catch (error) {
            console.error('[ContentClassifier] AI classification failed:', error);
            // Fallback to local classification
            return this.classifyLocally(tasks);
        }
    }

    /**
     * Fallback local classification (no API)
     */
    classifyLocally(tasks) {
        console.log('[ContentClassifier] Using local classification');

        const academic = [];
        const relaxed = [];

        tasks.forEach(task => {
            const content = (task.content || task.title || '') + ' ' + (task.description || '');
            const result = this.quickClassify(content);

            if (result.type === 'relaxed' && result.confidence > 0.6) {
                // Determine category
                const category = this.determineRelaxedCategory(content);
                relaxed.push({ ...task, relaxedCategory: category });
            } else {
                academic.push(task);
            }
        });

        return { academic, relaxed };
    }

    /**
     * Determine the best relaxed category for a task
     */
    determineRelaxedCategory(content) {
        const lowerContent = content.toLowerCase();

        const categoryKeywords = {
            'sports': ['gym', 'workout', 'basketball', 'football', 'soccer', 'cricket', 'tennis', 'swimming', 'running', 'sports', 'exercise', 'fitness'],
            'music': ['music', 'band', 'concert', 'guitar', 'piano', 'singing', 'practice'],
            'arts': ['art', 'painting', 'drawing', 'photography', 'design', 'creative'],
            'clubs': ['club', 'meetup', 'google developer', 'microsoft', 'ieee', 'acm', 'tech talk'],
            'volunteering': ['volunteer', 'ngo', 'community', 'charity', 'social work'],
            'health': ['meditation', 'yoga', 'health', 'doctor', 'wellness', 'mental health'],
            'entertainment': ['movie', 'netflix', 'watch', 'gaming', 'game', 'party', 'hangout', 'fun'],
            'hobby': ['hobby', 'personal project', 'side project', 'coding challenge', 'blog', 'journal'],
            'travel': ['travel', 'trip', 'vacation', 'tour'],
            'family': ['family', 'dinner', 'lunch', 'parents', 'relatives'],
            'social': ['friends', 'hangout', 'meetup', 'catch up']
        };

        for (const [category, keywords] of Object.entries(categoryKeywords)) {
            if (keywords.some(kw => lowerContent.includes(kw))) {
                return category;
            }
        }

        return 'other';
    }

    /**
     * Get API key from various sources
     */
    async getApiKey() {
        if (window.apiKeys?.gemini) return window.apiKeys.gemini;

        if (window.SecureStorage) {
            const key = await window.SecureStorage.getSecure('geminiApiKey', '');
            if (key) return key;
        }

        return localStorage.getItem('geminiApiKey') || null;
    }

    /**
     * Check for duplicate tasks
     * @param {Object} newTask - Task to check
     * @param {Array} existingTasks - Existing tasks to compare against
     * @param {number} threshold - Similarity threshold (0-1)
     */
    isDuplicate(newTask, existingTasks, threshold = 0.85) {
        const newContent = (newTask.content || newTask.title || '').toLowerCase().trim();
        if (!newContent) return false;

        return existingTasks.some(existing => {
            const existingContent = (existing.content || existing.title || '').toLowerCase().trim();
            const similarity = this.calculateSimilarity(newContent, existingContent);
            return similarity >= threshold;
        });
    }

    /**
     * Calculate text similarity (Jaccard index)
     */
    calculateSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;

        const words1 = new Set(str1.split(/\s+/));
        const words2 = new Set(str2.split(/\s+/));

        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);

        return intersection.size / union.size;
    }

    /**
     * Save tasks to relaxed mode storage
     */
    saveRelaxedTasks(tasks) {
        const existing = JSON.parse(localStorage.getItem(RELAXED_TASKS_KEY) || '[]');

        // Filter duplicates
        const newTasks = tasks.filter(task => !this.isDuplicate(task, existing));

        if (newTasks.length === 0) {
            console.log('[ContentClassifier] All relaxed tasks already exist');
            return 0;
        }

        // Convert to relaxed mode format
        const formattedTasks = newTasks.map(task => ({
            id: `relaxed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            title: task.content || task.title || 'Untitled Task',
            description: task.description || task.due_string || '',
            category: task.relaxedCategory || 'other',
            priority: task.priority === 3 || task.priority === 4 ? 'high' :
                task.priority === 2 ? 'medium' : 'low',
            dueDate: task.dueDate || null,
            completed: false,
            createdAt: new Date().toISOString(),
            source: 'notes_analyzer'
        }));

        const updated = [...existing, ...formattedTasks];
        localStorage.setItem(RELAXED_TASKS_KEY, JSON.stringify(updated));

        console.log(`[ContentClassifier] Saved ${formattedTasks.length} tasks to Relaxed Mode`);

        // Dispatch event for real-time updates
        window.dispatchEvent(new CustomEvent('relaxed-tasks-updated', {
            detail: { added: formattedTasks.length }
        }));

        return formattedTasks.length;
    }
}

// Create singleton instance
const contentClassifier = new ContentClassifier();

// Expose globally
window.ContentClassifier = ContentClassifier;
window.contentClassifier = contentClassifier;

// Export for ES modules
export { ContentClassifier, contentClassifier, RELAXED_CATEGORIES };
export default contentClassifier;
