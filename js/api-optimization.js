/**
 * API Optimization Utilities
 * Advanced techniques to minimize API usage and prevent quota exhaustion
 */

/**
 * Save the API cache to localStorage
 */
function saveApiCache() {
    try {
        // Convert Map to object for storage
        const cacheObject = {};
        window.apiOptimization.cache.forEach((value, key) => {
            cacheObject[key] = value;
        });

        localStorage.setItem('testFeedbackApiCache', JSON.stringify(cacheObject));
        console.log(`Saved ${window.apiOptimization.cache.size} cached API responses`);
    } catch (error) {
        console.error('Error saving API cache:', error);
    }
}

/**
 * Update daily API usage count
 * @param {number} count - Number of tokens or calls to add
 */
function updateApiUsage(count = 1) {
    window.apiOptimization.dailyUsage += count;
    localStorage.setItem('testFeedbackApiDailyUsage', window.apiOptimization.dailyUsage.toString());

    // Check if approaching quota limit
    const usagePercentage = (window.apiOptimization.dailyUsage / window.apiOptimization.dailyQuota) * 100;
    if (usagePercentage >= 90) {
        showNotification(`Warning: API usage at ${usagePercentage.toFixed(0)}% of daily quota`, 'warning');
    }
}

/**
 * Generate a cache key for a request
 * @param {string} prompt - The prompt text
 * @param {Array} imageParts - Optional image parts
 * @returns {string} - Cache key
 */
function generateCacheKey(prompt, imageParts = []) {
    // For text-only requests, use a hash of the prompt
    if (imageParts.length === 0) {
        return hashString(prompt);
    }

    // For requests with images, include image hashes
    const imageHashes = imageParts.map(part => {
        if (part.inlineData && part.inlineData.data) {
            // Use first 100 chars of base64 data as a fingerprint
            const dataFingerprint = part.inlineData.data.substring(0, 100);
            return hashString(dataFingerprint);
        }
        return '';
    }).join('_');

    return hashString(prompt + '_' + imageHashes);
}

/**
 * Simple string hashing function
 * @param {string} str - String to hash
 * @returns {string} - Hashed string
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16); // Convert to hex
}

/**
 * Check if we can use a cached response
 * @param {string} cacheKey - The cache key
 * @returns {Object|null} - Cached response or null
 */
function getCachedResponse(cacheKey) {
    if (window.apiOptimization.cache.has(cacheKey)) {
        const cachedItem = window.apiOptimization.cache.get(cacheKey);

        // Check if cache is still valid
        if (Date.now() - cachedItem.timestamp < window.apiOptimization.cacheExpiration) {
            console.log('Using cached API response');
            return cachedItem.data;
        } else {
            // Remove expired cache
            window.apiOptimization.cache.delete(cacheKey);
        }
    }
    return null;
}

/**
 * Store response in cache
 * @param {string} cacheKey - The cache key
 * @param {Object} data - The response data
 */
function cacheResponse(cacheKey, data) {
    window.apiOptimization.cache.set(cacheKey, {
        data: data,
        timestamp: Date.now()
    });

    // Periodically save cache to avoid losing it
    if (window.apiOptimization.cache.size % 5 === 0) {
        saveApiCache();
    }
}

/**
 * Check if content is too large and needs chunking
 * @param {string} content - The content to check
 * @returns {boolean} - True if content needs chunking
 */
function needsChunking(content) {
    return content.length > window.apiOptimization.maxContentSize;
}

/**
 * Split content into manageable chunks
 * @param {string} content - The content to split
 * @returns {Array} - Array of content chunks
 */
function chunkContent(content) {
    const chunks = [];
    const maxSize = window.apiOptimization.maxContentSize;

    // Try to split at paragraph boundaries
    const paragraphs = content.split(/\n\s*\n/);
    let currentChunk = '';

    for (const paragraph of paragraphs) {
        if (currentChunk.length + paragraph.length + 2 <= maxSize) {
            currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
        } else {
            // If current chunk is not empty, push it
            if (currentChunk) {
                chunks.push(currentChunk);
            }

            // If paragraph itself is too large, split it further
            if (paragraph.length > maxSize) {
                // Split at sentence boundaries
                const sentences = paragraph.split(/(?<=[.!?])\s+/);
                currentChunk = '';

                for (const sentence of sentences) {
                    if (currentChunk.length + sentence.length + 1 <= maxSize) {
                        currentChunk += (currentChunk ? ' ' : '') + sentence;
                    } else {
                        // If current chunk is not empty, push it
                        if (currentChunk) {
                            chunks.push(currentChunk);
                        }

                        // If sentence itself is too large, split it into fixed-size chunks
                        if (sentence.length > maxSize) {
                            for (let i = 0; i < sentence.length; i += maxSize) {
                                chunks.push(sentence.substring(i, i + maxSize));
                            }
                            currentChunk = '';
                        } else {
                            currentChunk = sentence;
                        }
                    }
                }

                // Push any remaining content in current chunk
                if (currentChunk) {
                    chunks.push(currentChunk);
                    currentChunk = '';
                }
            } else {
                currentChunk = paragraph;
            }
        }
    }

    // Push any remaining content
    if (currentChunk) {
        chunks.push(currentChunk);
    }

    return chunks;
}

/**
 * Process image to reduce size if needed
 * @param {File} imageFile - The image file
 * @returns {Promise<Blob>} - Processed image
 */
async function processImage(imageFile) {
    return new Promise((resolve, reject) => {
        // If image is small enough, return as is
        if (imageFile.size <= window.apiOptimization.maxImageSize) {
            resolve(imageFile);
            return;
        }

        // Create an image element
        const img = new Image();
        img.onload = function() {
            // Create a canvas to resize the image
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Calculate new dimensions while maintaining aspect ratio
            let width = img.width;
            let height = img.height;
            const aspectRatio = width / height;

            // Target a file size reduction proportional to how much it exceeds the limit
            const reductionFactor = Math.sqrt(window.apiOptimization.maxImageSize / imageFile.size);
            width = Math.floor(width * reductionFactor);
            height = Math.floor(height * reductionFactor);

            // Set canvas dimensions
            canvas.width = width;
            canvas.height = height;

            // Draw resized image
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to blob with reduced quality
            canvas.toBlob(
                (blob) => {
                    console.log(`Reduced image size from ${imageFile.size} to ${blob.size} bytes`);
                    resolve(blob);
                },
                imageFile.type,
                0.8 // Quality parameter (0.8 = 80% quality)
            );
        };

        img.onerror = function() {
            reject(new Error('Failed to load image for processing'));
        };

        // Load the image
        img.src = URL.createObjectURL(imageFile);
    });
}

/**
 * Check if we're approaching or exceeding quota limits
 * @returns {boolean} - True if we should throttle requests
 */
function shouldThrottleRequests() {
    // Check daily quota
    if (window.apiOptimization.dailyUsage >= window.apiOptimization.dailyQuota) {
        showNotification('Daily API quota reached. Please try again tomorrow.', 'error');
        return true;
    }

    // Check request timing
    const timeSinceLastRequest = Date.now() - window.apiOptimization.lastRequestTime;
    return timeSinceLastRequest < window.apiOptimization.minRequestInterval;
}

/**
 * Add a request to the queue for batching
 * @param {Function} requestFn - Function that makes the request
 * @returns {Promise} - Promise that resolves with the request result
 */
function queueRequest(requestFn) {
    return new Promise((resolve, reject) => {
        // Add to queue
        window.apiOptimization.requestQueue.push({
            requestFn,
            resolve,
            reject
        });

        // Start processing queue if not already processing
        if (!window.apiOptimization.processingQueue) {
            processRequestQueue();
        }
    });
}

/**
 * Process the request queue
 */
async function processRequestQueue() {
    if (window.apiOptimization.requestQueue.length === 0) {
        window.apiOptimization.processingQueue = false;
        return;
    }

    window.apiOptimization.processingQueue = true;

    // Get the next request
    const { requestFn, resolve, reject } = window.apiOptimization.requestQueue.shift();

    try {
        // Check if we need to throttle
        if (shouldThrottleRequests()) {
            // Wait for the minimum interval
            const waitTime = window.apiOptimization.minRequestInterval - (Date.now() - window.apiOptimization.lastRequestTime);
            await new Promise(r => setTimeout(r, Math.max(waitTime, 0)));
        }

        // Execute the request
        window.apiOptimization.lastRequestTime = Date.now();
        const result = await requestFn();
        resolve(result);
    } catch (error) {
        reject(error);
    }

    // Process next request with a small delay
    setTimeout(processRequestQueue, 100);
}

/**
 * Perform local analysis for simple cases to avoid API calls
 * @param {string} content - The content to analyze
 * @param {string} answerKey - Optional answer key
 * @returns {Object|null} - Analysis result or null if API is needed
 */
function performLocalAnalysis(content, answerKey) {
    // If no answer key, we need the API
    if (!answerKey) {
        return null;
    }

    try {
        // Simple case: Multiple choice questions with clear answer key
        const questions = extractMultipleChoiceQuestions(content);
        const answers = parseAnswerKey(answerKey);

        // If we couldn't extract questions or answers, use the API
        if (questions.length === 0 || Object.keys(answers).length === 0) {
            return null;
        }

        // Match questions with answers
        const results = analyzeMultipleChoice(questions, answers);

        // If we got valid results, return them
        if (results && results.questions.length > 0) {
            console.log('Using local analysis for multiple choice test');
            return results;
        }
    } catch (error) {
        console.error('Error in local analysis:', error);
    }

    return null;
}

/**
 * Extract multiple choice questions from content
 * @param {string} content - The content to analyze
 * @returns {Array} - Extracted questions
 */
function extractMultipleChoiceQuestions(content) {
    const questions = [];

    // Look for patterns like "1. Question text" or "Question 1: Question text"
    const questionRegex = /(?:^|\n)(?:(?:Question\s*)?(\d+)[:.)\s]+|[A-Z][:.)\s]+)(.+?)(?:\n\s*(?:[a-zA-Z][).]\s+.+\n?)+)/gm;

    let match;
    while ((match = questionRegex.exec(content)) !== null) {
        const questionNumber = match[1] || questions.length + 1;
        const questionText = match[2].trim();
        const optionsText = match[0].substring(match[0].indexOf(questionText) + questionText.length).trim();

        // Extract options (a, b, c, d, etc.)
        const options = {};
        const optionRegex = /(?:^|\n)\s*([a-zA-Z][).]\s+)(.+?)(?=\n\s*[a-zA-Z][).]\s+|\n*$)/gm;
        let optionMatch;

        while ((optionMatch = optionRegex.exec(optionsText)) !== null) {
            const optionLetter = optionMatch[1].replace(/[^a-zA-Z]/g, '').toLowerCase();
            const optionText = optionMatch[2].trim();
            options[optionLetter] = optionText;
        }

        // Only add if we found options
        if (Object.keys(options).length > 0) {
            questions.push({
                number: parseInt(questionNumber),
                text: questionText,
                options: options
            });
        }
    }

    return questions;
}

/**
 * Parse answer key
 * @param {string} answerKey - The answer key text
 * @returns {Object} - Parsed answers
 */
function parseAnswerKey(answerKey) {
    const answers = {};

    // Look for patterns like "1. A" or "1: A" or "Question 1: A"
    const answerRegex = /(?:Question\s*)?(\d+)[:.)\s]+\s*([a-zA-Z])/gi;

    let match;
    while ((match = answerRegex.exec(answerKey)) !== null) {
        const questionNumber = parseInt(match[1]);
        const answer = match[2].toLowerCase();
        answers[questionNumber] = answer;
    }

    // Also look for simple format like "1. A, 2. B, 3. C"
    if (Object.keys(answers).length === 0) {
        const simpleRegex = /(\d+)[:.)\s]+\s*([a-zA-Z])/gi;
        while ((match = simpleRegex.exec(answerKey)) !== null) {
            const questionNumber = parseInt(match[1]);
            const answer = match[2].toLowerCase();
            answers[questionNumber] = answer;
        }
    }

    return answers;
}

/**
 * Analyze multiple choice questions
 * @param {Array} questions - Extracted questions
 * @param {Object} answers - Parsed answers
 * @returns {Object} - Analysis result
 */
function analyzeMultipleChoice(questions, answers) {
    let correct = 0;
    let incorrect = 0;
    const analyzedQuestions = [];

    for (const question of questions) {
        const questionNumber = question.number;
        const correctAnswer = answers[questionNumber];

        // Skip if we don't have the answer for this question
        if (!correctAnswer) {
            continue;
        }

        // Look for selected answer in the question text
        let userAnswer = null;
        const selectedRegex = /(?:^|\n)\s*([a-zA-Z][).]\s+)(.+?)(?=\n\s*[a-zA-Z][).]\s+|\n*$)/gm;
        const questionText = question.text;

        // Check if any option is marked as selected
        for (const [option, text] of Object.entries(question.options)) {
            // Look for indicators like "✓", "*", "selected", etc.
            if (text.includes('✓') || text.includes('*') || text.includes('selected') ||
                text.includes('chosen') || text.includes('marked')) {
                userAnswer = option;
                break;
            }
        }

        // If no option is marked, we can't determine the user's answer
        if (!userAnswer) {
            continue;
        }

        // Check if the answer is correct
        const isCorrect = userAnswer.toLowerCase() === correctAnswer.toLowerCase();
        if (isCorrect) {
            correct++;
        } else {
            incorrect++;
        }

        // Create feedback
        let feedback;
        if (isCorrect) {
            feedback = `Your answer "${userAnswer.toUpperCase()}" is correct.`;
        } else {
            feedback = `Your answer "${userAnswer.toUpperCase()}" is incorrect. The correct answer is "${correctAnswer.toUpperCase()}".`;
        }

        // Add to analyzed questions
        analyzedQuestions.push({
            number: questionNumber,
            status: isCorrect ? 'correct' : 'incorrect',
            question: question.text,
            userAnswer: question.options[userAnswer] || userAnswer,
            correctAnswer: question.options[correctAnswer] || correctAnswer,
            feedback: feedback
        });
    }

    // Only return results if we analyzed at least one question
    if (analyzedQuestions.length === 0) {
        return null;
    }

    // Calculate score
    const total = correct + incorrect;
    const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;

    // Generate improvement suggestions
    const improvements = [];
    if (incorrect > 0) {
        improvements.push({
            title: 'Review Incorrect Answers',
            description: `You missed ${incorrect} out of ${total} questions. Focus on understanding the correct answers and why your answers were incorrect.`
        });
    }

    // Add GPAce branding
    if (analyzedQuestions.length > 0) {
        analyzedQuestions[0].feedback += ' Made by GPAce - A&A 230101017';
    }

    return {
        score: {
            percentage,
            correct,
            incorrect,
            partial: 0,
            total
        },
        questions: analyzedQuestions,
        improvements
    };
}
