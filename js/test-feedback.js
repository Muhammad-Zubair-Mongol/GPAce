/**
 * Instant Test Feedback - JavaScript
 * This file handles the functionality for the instant test feedback feature.
 */

// ===== GLOBAL VARIABLES =====
let uploadedImages = [];

// Use the same API configuration as in grind.html
// This is defined as a window property so it can be updated from api-settings.js
window.apiKeys = {
    gemini: localStorage.getItem('geminiApiKey') || '',
    wolframAlpha: localStorage.getItem('wolframAlphaApiKey') || '',
    tavily: localStorage.getItem('tavilyApiKey') || '',
    geminiModel: localStorage.getItem('geminiModel') || 'gemini-2.0-flash',
    temperature: parseFloat(localStorage.getItem('geminiTemperature') || '0.4')
};

// Advanced API usage optimization
// This is defined as a window property so it can be updated from api-settings.js
window.apiOptimization = {
    // Cache for storing API responses to avoid redundant calls
    cache: new Map(),
    // Cache expiration time (24 hours in milliseconds)
    cacheExpiration: 24 * 60 * 60 * 1000,
    // Daily quota tracking
    dailyUsage: parseInt(localStorage.getItem('testFeedbackApiDailyUsage') || '0'),
    dailyQuota: parseInt(localStorage.getItem('testFeedbackApiDailyQuota') || '100'),
    // Last reset date for daily usage
    lastResetDate: localStorage.getItem('testFeedbackApiLastResetDate') || new Date().toDateString(),
    // Throttling parameters
    lastRequestTime: 0,
    minRequestInterval: 1000, // Minimum time between requests (1 second)
    // Request queue for batching
    requestQueue: [],
    processingQueue: false,
    // Content size thresholds
    maxContentSize: 4000, // Characters
    maxImageSize: 1024 * 1024 // 1MB
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', function() {
    // Initialize API optimization system
    initApiOptimization();

    // Initialize subjects dropdown
    loadSubjects();

    // Set up event listeners
    setupEventListeners();

    // Initialize file upload functionality
    initializeFileUpload();
});

/**
 * Initialize API optimization system
 */
function initApiOptimization() {
    // Reset daily usage if it's a new day
    const today = new Date().toDateString();
    if (window.apiOptimization.lastResetDate !== today) {
        window.apiOptimization.dailyUsage = 0;
        window.apiOptimization.lastResetDate = today;
        localStorage.setItem('testFeedbackApiDailyUsage', '0');
        localStorage.setItem('testFeedbackApiLastResetDate', today);
    }

    // Load cached responses from localStorage
    try {
        const cachedResponses = JSON.parse(localStorage.getItem('testFeedbackApiCache') || '{}');
        Object.entries(cachedResponses).forEach(([key, value]) => {
            // Only load non-expired cache entries
            if (value.timestamp && (Date.now() - value.timestamp) < window.apiOptimization.cacheExpiration) {
                window.apiOptimization.cache.set(key, value);
            }
        });
        console.log(`Loaded ${window.apiOptimization.cache.size} cached API responses`);
    } catch (error) {
        console.error('Error loading API cache:', error);
    }

    // Set up periodic cache saving
    setInterval(saveApiCache, 5 * 60 * 1000); // Save cache every 5 minutes

    // Load API quota from localStorage
    const savedQuota = localStorage.getItem('testFeedbackApiDailyQuota');
    if (savedQuota && !isNaN(parseInt(savedQuota))) {
        window.apiOptimization.dailyQuota = parseInt(savedQuota);
    }

    // Display quota information
    console.log(`API Daily Usage: ${window.apiOptimization.dailyUsage}/${window.apiOptimization.dailyQuota}`);
}

// ===== SUBJECT LOADING =====
/**
 * Load subjects from localStorage or Firestore
 * Uses the same source as academic-details.html
 */
function loadSubjects() {
    const subjectSelect = document.getElementById('subjectSelect');

    try {
        // Get current semester from localStorage
        const currentSemester = localStorage.getItem('currentAcademicSemester') || 'default';

        // Try to get subjects from academicSemesters first (new format)
        const allSemesters = JSON.parse(localStorage.getItem('academicSemesters') || '{}');
        let subjects = [];

        if (allSemesters[currentSemester] && allSemesters[currentSemester].subjects) {
            subjects = allSemesters[currentSemester].subjects;
            console.log(`Loaded ${subjects.length} subjects from semester: ${currentSemester}`);
        } else {
            // Fallback to academicSubjects (old format)
            subjects = JSON.parse(localStorage.getItem('academicSubjects') || '[]');
            console.log(`Loaded ${subjects.length} subjects from academicSubjects`);
        }

        // Clear existing options
        subjectSelect.innerHTML = '<option value="">Select a subject...</option>';

        // Add subjects to dropdown
        subjects.forEach(subject => {
            const option = document.createElement('option');
            option.value = subject.tag || subject.id || subject.name;
            option.textContent = subject.name;
            subjectSelect.appendChild(option);
        });

        // If no subjects found, try to load from Firestore
        if (subjects.length === 0 && window.loadSubjectsFromFirestore) {
            console.log('No subjects found in localStorage, attempting to load from Firestore');
            window.loadSubjectsFromFirestore(currentSemester)
                .then(firestoreSubjects => {
                    if (firestoreSubjects && firestoreSubjects.length > 0) {
                        // Add subjects to dropdown
                        firestoreSubjects.forEach(subject => {
                            const option = document.createElement('option');
                            option.value = subject.tag || subject.id || subject.name;
                            option.textContent = subject.name;
                            subjectSelect.appendChild(option);
                        });
                    } else {
                        console.log('No subjects found in Firestore either');
                        addFallbackSubjects();
                    }
                })
                .catch(error => {
                    console.error('Error loading subjects from Firestore:', error);
                    addFallbackSubjects();
                });
        }

        // If still no subjects, add fallbacks
        if (subjects.length === 0 && subjectSelect.options.length <= 1) {
            addFallbackSubjects();
        }
    } catch (error) {
        console.error('Error loading subjects:', error);
        addFallbackSubjects();
    }
}

/**
 * Add fallback subjects when no subjects are available
 */
function addFallbackSubjects() {
    const subjectSelect = document.getElementById('subjectSelect');
    const fallbackSubjects = [
        { tag: 'math', name: 'Mathematics' },
        { tag: 'science', name: 'Science' },
        { tag: 'english', name: 'English' },
        { tag: 'history', name: 'History' },
        { tag: 'computer', name: 'Computer Science' }
    ];

    fallbackSubjects.forEach(subject => {
        const option = document.createElement('option');
        option.value = subject.tag;
        option.textContent = subject.name;
        subjectSelect.appendChild(option);
    });
}

// ===== EVENT LISTENERS =====
/**
 * Set up all event listeners
 */
function setupEventListeners() {
    // Text analysis button
    document.getElementById('analyzeTextBtn').addEventListener('click', analyzeTextContent);

    // Image analysis button
    document.getElementById('analyzeImagesBtn').addEventListener('click', analyzeImageContent);

    // Download PDF button
    document.getElementById('downloadPdfBtn').addEventListener('click', downloadPdf);

    // Copy results button
    document.getElementById('copyResultsBtn').addEventListener('click', copyResults);

    // Save results button
    document.getElementById('saveResultsBtn').addEventListener('click', saveResults);
}

// ===== FILE UPLOAD HANDLING =====
/**
 * Initialize file upload functionality
 */
function initializeFileUpload() {
    const dropZone = document.getElementById('imageDropZone');
    const fileInput = document.getElementById('imageUpload');

    // Click on drop zone to trigger file input
    dropZone.addEventListener('click', () => fileInput.click());

    // Handle file selection
    fileInput.addEventListener('change', handleFileSelect);

    // Drag and drop functionality
    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('dragleave', handleDragLeave);
    dropZone.addEventListener('drop', handleFileDrop);
}

/**
 * Handle file selection from input
 */
function handleFileSelect(event) {
    const files = event.target.files;
    processFiles(files);
}

/**
 * Handle drag over event
 */
function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    this.classList.add('drag-over');
}

/**
 * Handle drag leave event
 */
function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    this.classList.remove('drag-over');
}

/**
 * Handle file drop event
 */
function handleFileDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    this.classList.remove('drag-over');

    const files = event.dataTransfer.files;
    processFiles(files);
}

/**
 * Process uploaded files
 */
function processFiles(files) {
    if (!files || files.length === 0) return;

    const uploadedImagesContainer = document.getElementById('uploadedImages');
    const analyzeImagesBtn = document.getElementById('analyzeImagesBtn');

    // Process each file
    Array.from(files).forEach(file => {
        // Check if file is an image
        if (!file.type.startsWith('image/')) {
            showError(`File "${file.name}" is not an image. Please upload only image files.`);
            return;
        }

        // Create a unique ID for the image
        const imageId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Add to uploaded images array
        uploadedImages.push({
            id: imageId,
            file: file,
            name: file.name
        });

        // Create image preview
        const reader = new FileReader();
        reader.onload = function(e) {
            const imageItem = document.createElement('div');
            imageItem.className = 'uploaded-image-item';
            imageItem.dataset.id = imageId;

            imageItem.innerHTML = `
                <img src="${e.target.result}" alt="${file.name}">
                <button class="remove-image" data-id="${imageId}">
                    <i class="fas fa-times"></i>
                </button>
            `;

            uploadedImagesContainer.appendChild(imageItem);

            // Add event listener to remove button
            imageItem.querySelector('.remove-image').addEventListener('click', function() {
                removeImage(this.dataset.id);
            });
        };

        reader.readAsDataURL(file);
    });

    // Enable analyze button if there are uploaded images
    if (uploadedImages.length > 0) {
        analyzeImagesBtn.disabled = false;
    }
}

/**
 * Remove an image from the uploaded images
 */
function removeImage(imageId) {
    // Remove from array
    uploadedImages = uploadedImages.filter(img => img.id !== imageId);

    // Remove from UI
    const imageItem = document.querySelector(`.uploaded-image-item[data-id="${imageId}"]`);
    if (imageItem) {
        imageItem.remove();
    }

    // Disable analyze button if no images left
    if (uploadedImages.length === 0) {
        document.getElementById('analyzeImagesBtn').disabled = true;
    }
}

// ===== TEXT ANALYSIS =====
/**
 * Analyze text content with optimized API usage
 */
async function analyzeTextContent() {
    // Show loading indicator
    showLoading(true);

    try {
        // Get input values
        const title = document.getElementById('testTitle').value;
        const content = document.getElementById('testContent').value;
        const answerKey = document.getElementById('answerKey').value;
        const subject = document.getElementById('subjectSelect').value;
        const testType = document.getElementById('testType').value;
        const feedbackDetail = document.getElementById('feedbackDetail').value;

        // Validate inputs
        if (!content) {
            throw new Error('Please enter test content to analyze');
        }

        // Try local analysis first for simple cases (to save API calls)
        const localAnalysis = performLocalAnalysis(content, answerKey);
        if (localAnalysis) {
            showNotification('Using local analysis to save API quota', 'success');
            processResults(localAnalysis);
            showLoading(false);
            return;
        }

        // Check if content needs chunking
        if (needsChunking(content)) {
            // Split content into chunks
            const chunks = chunkContent(content);
            showNotification(`Content is large, processing in ${chunks.length} parts to optimize API usage`, 'info');

            // Process each chunk
            const results = [];
            for (let i = 0; i < chunks.length; i++) {
                // Update loading message
                document.querySelector('.loading-text').textContent = `Analyzing part ${i+1} of ${chunks.length}...`;

                // Prepare prompt for this chunk
                const chunkPrompt = prepareTextPrompt(
                    `${title} (Part ${i+1}/${chunks.length})`,
                    chunks[i],
                    answerKey,
                    subject,
                    testType,
                    feedbackDetail
                );

                // Call Gemini API with chunk info
                const chunkFeedback = await callGeminiAPI(chunkPrompt, [], {
                    chunkIndex: i,
                    totalChunks: chunks.length
                });

                results.push(chunkFeedback);
            }

            // Combine results
            const combinedResults = combineChunkedResults(results);
            processResults(combinedResults);
        } else {
            // Prepare prompt for Gemini API
            const prompt = prepareTextPrompt(title, content, answerKey, subject, testType, feedbackDetail);

            // Call Gemini API
            const feedback = await callGeminiAPI(prompt);

            // Process and display results
            processResults(feedback);
        }
    } catch (error) {
        console.error('Error analyzing text content:', error);
        showError(error.message);
    } finally {
        showLoading(false);
    }
}

/**
 * Combine results from chunked analysis
 */
function combineChunkedResults(results) {
    if (results.length === 0) return null;
    if (results.length === 1) return results[0];

    // Combine scores
    let totalCorrect = 0;
    let totalIncorrect = 0;
    let totalPartial = 0;
    let totalQuestions = 0;

    // Combine questions and improvements
    const allQuestions = [];
    const allImprovements = [];

    results.forEach(result => {
        if (result.score) {
            totalCorrect += result.score.correct || 0;
            totalIncorrect += result.score.incorrect || 0;
            totalPartial += result.score.partial || 0;
            totalQuestions += result.score.total || 0;
        }

        if (result.questions && Array.isArray(result.questions)) {
            allQuestions.push(...result.questions);
        }

        if (result.improvements && Array.isArray(result.improvements)) {
            allImprovements.push(...result.improvements);
        }
    });

    // Calculate combined percentage
    const percentage = totalQuestions > 0 ?
        Math.round((totalCorrect / totalQuestions) * 100) : 0;

    // Deduplicate improvements by title
    const uniqueImprovements = [];
    const improvementTitles = new Set();

    allImprovements.forEach(improvement => {
        if (!improvementTitles.has(improvement.title)) {
            improvementTitles.add(improvement.title);
            uniqueImprovements.push(improvement);
        }
    });

    // Limit to top 5 improvements
    const topImprovements = uniqueImprovements.slice(0, 5);

    return {
        score: {
            percentage,
            correct: totalCorrect,
            incorrect: totalIncorrect,
            partial: totalPartial,
            total: totalQuestions
        },
        questions: allQuestions,
        improvements: topImprovements
    };
}

/**
 * Prepare prompt for text analysis with high-quality instructions
 */
function prepareTextPrompt(title, content, answerKey, subject, testType, feedbackDetail) {
    // Default title if not provided
    const testTitle = title || 'Untitled Test';

    // Get subject name from select element
    const subjectElement = document.getElementById('subjectSelect');
    const subjectName = subject ? subjectElement.options[subjectElement.selectedIndex].text : 'General';

    // Build the prompt with enhanced quality instructions
    let prompt = `
You are an expert educator, academic assessor, and subject matter specialist in ${subjectName}. I need you to analyze the following ${testType} and provide detailed, constructive feedback that will help the student improve their understanding and performance.

TEST TITLE: ${testTitle}

SUBJECT: ${subjectName}

TEST CONTENT:
${content}
`;

    // Add answer key if provided
    if (answerKey) {
        prompt += `
ANSWER KEY:
${answerKey}
`;
    } else {
        prompt += `
No answer key has been provided. Please use your expertise to determine the correct answers based on standard ${subjectName} knowledge and principles.
`;
    }

    // Add detailed analysis instructions based on feedback detail level
    prompt += `
ANALYSIS INSTRUCTIONS:
1. IMPORTANT: ONLY analyze questions that are EXPLICITLY present in the TEST CONTENT provided above. DO NOT make up or invent any questions that aren't clearly in the content.
2. First, identify and extract all actual questions from the TEST CONTENT. If no clear questions are found, state this in your feedback.
3. For each identified question and its provided answer, determine if it is:
   - Correct (fully accurate and complete)
   - Partially correct (contains some accurate elements but has errors or omissions)
   - Incorrect (fundamentally wrong or missing the point)
4. Provide specific, educational feedback for each question that explains:
   - Why the answer is correct/incorrect
   - What concepts the student understands well
   - What misconceptions or knowledge gaps are evident
5. Calculate an overall score as a percentage, giving appropriate partial credit where deserved.
6. Identify patterns in the student's understanding, including common mistakes or misconceptions.
7. Suggest specific, actionable areas for improvement that address the root causes of errors.
`;

    if (feedbackDetail === 'detailed' || feedbackDetail === 'comprehensive') {
        prompt += `
7. For each incorrect or partially correct answer, provide a clear explanation of:
   - The correct approach or methodology
   - The specific error in the student's reasoning or calculation
   - How to avoid similar mistakes in the future
8. Recommend specific learning resources, practice problems, or concepts to review for each identified weakness.
9. Highlight connections between the test content and broader concepts in ${subjectName}.
`;
    }

    if (feedbackDetail === 'comprehensive') {
        prompt += `
10. Create a personalized, structured study plan based on the identified weaknesses, including:
    - Prioritized topics to review (most critical first)
    - Estimated time needed for each topic
    - Specific learning objectives for each area
11. Suggest targeted practice exercises with increasing difficulty to strengthen weak areas.
12. Provide deeper conceptual explanations that connect the test material to fundamental principles in ${subjectName}.
13. Identify any prerequisite knowledge that may need reinforcement.
14. Suggest metacognitive strategies to improve the student's approach to similar problems.
`;
    }

    // Request structured JSON response with detailed format instructions
    prompt += `
FORMAT YOUR RESPONSE AS A VALID JSON OBJECT with the following structure:
{
  "score": {
    "percentage": 85, // Overall percentage score
    "correct": 17, // Number of correct answers
    "incorrect": 3, // Number of incorrect answers
    "partial": 0, // Number of partially correct answers
    "total": 20 // Total number of questions
  },
  "questions": [
    {
      "number": 1, // Question number or identifier
      "status": "correct", // Must be exactly one of: "correct", "incorrect", or "partial"
      "question": "[ACTUAL QUESTION FROM TEST CONTENT]", // The exact question text from the content
      "userAnswer": "[STUDENT'S ANSWER FROM TEST CONTENT]", // The student's answer from the content
      "correctAnswer": "[CORRECT ANSWER]", // The correct answer based on answer key or expertise
      "feedback": "[SPECIFIC FEEDBACK FOR THIS QUESTION]" // Detailed, educational feedback
    },
    // Include an entry for each question in the test
  ],
  "improvements": [
    {
      "title": "Review Algebra Fundamentals", // Concise improvement area title
      "description": "Focus on equation solving techniques, particularly when dealing with fractions. Practice problems involving multiple steps and check your work systematically." // Detailed, actionable advice
    },
    // Include 3-5 key improvement areas
  ]
}

CRITICAL REQUIREMENTS:
1. Your response MUST be valid JSON that can be parsed by JavaScript's JSON.parse().
2. Do NOT include any text, explanations, or markdown outside the JSON structure.
3. Ensure all JSON syntax is correct (quotes around keys, commas between items, etc.).
4. ONLY include questions that are EXPLICITLY present in the TEST CONTENT. DO NOT invent or make up questions.
5. If no clear questions are found in the content, return an empty questions array and explain this in the improvements section.
6. Make sure to extract and analyze ALL actual questions from the test content.
7. Provide substantive, educational feedback that helps the student improve.
8. BRANDING: Include "Made by GPAce - A&A 230101017" somewhere in one of the feedback messages.
`;

    return prompt;
}

// ===== IMAGE ANALYSIS =====
/**
 * Analyze image content with optimized API usage
 */
async function analyzeImageContent() {
    // Show loading indicator
    showLoading(true);

    try {
        // Get input values
        const title = document.getElementById('imageTitle').value;
        const subject = document.getElementById('subjectSelect').value;
        const testType = document.getElementById('testType').value;
        const feedbackDetail = document.getElementById('feedbackDetail').value;

        // Validate inputs
        if (uploadedImages.length === 0) {
            throw new Error('Please upload at least one image to analyze');
        }

        // Prepare prompt for Gemini API
        const prompt = prepareImagePrompt(title, subject, testType, feedbackDetail);

        // Process images to optimize size
        showNotification('Optimizing images to reduce API usage...', 'info');
        document.querySelector('.loading-text').textContent = 'Processing images...';

        const processedImages = [];
        for (let i = 0; i < uploadedImages.length; i++) {
            // Update loading message
            document.querySelector('.loading-subtext').textContent = `Processing image ${i+1} of ${uploadedImages.length}`;

            // Process image to reduce size if needed
            const processedImage = await processImage(uploadedImages[i].file);
            processedImages.push({
                ...uploadedImages[i],
                processedFile: processedImage
            });
        }

        // Convert processed images to base64
        document.querySelector('.loading-text').textContent = 'Preparing images for analysis...';
        const imagesParts = await Promise.all(
            processedImages.map(async (img, index) => {
                document.querySelector('.loading-subtext').textContent = `Preparing image ${index+1} of ${processedImages.length}`;
                return await fileToGenerativePart(img.processedFile);
            })
        );

        // Check if we need to process images in batches
        if (imagesParts.length > 1) {
            showNotification(`Processing ${imagesParts.length} images in separate batches to optimize API usage`, 'info');

            // Process each image separately and combine results
            const results = [];
            for (let i = 0; i < imagesParts.length; i++) {
                // Update loading message
                document.querySelector('.loading-text').textContent = `Analyzing image ${i+1} of ${imagesParts.length}...`;

                // Prepare prompt for this image
                const imagePrompt = prepareImagePrompt(
                    `${title} (Image ${i+1}/${imagesParts.length})`,
                    subject,
                    testType,
                    feedbackDetail
                );

                // Call Gemini API with single image
                const imageFeedback = await callGeminiAPI(imagePrompt, [imagesParts[i]], {
                    chunkIndex: i,
                    totalChunks: imagesParts.length
                });

                results.push(imageFeedback);
            }

            // Combine results
            const combinedResults = combineChunkedResults(results);
            processResults(combinedResults);
        } else {
            // Call Gemini API with all images
            document.querySelector('.loading-text').textContent = 'Analyzing test content...';
            const feedback = await callGeminiAPI(prompt, imagesParts);

            // Process and display results
            processResults(feedback);
        }
    } catch (error) {
        console.error('Error analyzing image content:', error);
        showError(error.message);
    } finally {
        showLoading(false);
    }
}

/**
 * Prepare prompt for image analysis with enhanced quality instructions
 */
function prepareImagePrompt(title, subject, testType, feedbackDetail) {
    // Default title if not provided
    const testTitle = title || 'Untitled Test';

    // Get subject name from select element
    const subjectElement = document.getElementById('subjectSelect');
    const subjectName = subject ? subjectElement.options[subjectElement.selectedIndex].text : 'General';

    // Build the prompt with enhanced quality instructions
    let prompt = `
You are an expert educator, academic assessor, and subject matter specialist in ${subjectName} with advanced capabilities in visual content analysis. I need you to analyze the following ${testType} image(s) and provide detailed, constructive feedback that will help the student improve their understanding and performance.

TEST TITLE: ${testTitle}

SUBJECT: ${subjectName}

IMAGE ANALYSIS INSTRUCTIONS:
1. IMPORTANT: ONLY analyze questions that are EXPLICITLY visible in the image(s). DO NOT make up or invent any questions that aren't clearly visible.

2. First, carefully extract all text content from the image(s), including:
   - All questions exactly as written (do not modify or create questions)
   - All student answers exactly as written
   - Any instructions or context provided in the image
   - Any visible scoring or marking

3. If the image contains handwritten content:
   - Pay special attention to mathematical notation, diagrams, or symbols
   - Consider potential ambiguities in handwriting
   - Note if portions are illegible and make reasonable inferences
   - If you can't read something clearly, indicate this rather than guessing

4. If no clear questions are found in the image, state this in your feedback and return an empty questions array.

5. For each actual question found, analyze the provided answers with academic rigor appropriate for ${subjectName}.

6. For each answer, determine if it is:
   - Correct (fully accurate and complete)
   - Partially correct (contains some accurate elements but has errors or omissions)
   - Incorrect (fundamentally wrong or missing the point)

7. Provide specific, educational feedback for each question that explains:
   - Why the answer is correct/incorrect
   - What concepts the student understands well
   - What misconceptions or knowledge gaps are evident

8. Calculate an overall score as a percentage, giving appropriate partial credit where deserved.

9. Identify patterns in the student's understanding, including common mistakes or misconceptions.

10. Suggest specific, actionable areas for improvement that address the root causes of errors.
`;

    if (feedbackDetail === 'detailed' || feedbackDetail === 'comprehensive') {
        prompt += `
9. For each incorrect or partially correct answer, provide a clear explanation of:
   - The correct approach or methodology
   - The specific error in the student's reasoning or calculation
   - How to avoid similar mistakes in the future

10. Recommend specific learning resources, practice problems, or concepts to review for each identified weakness.

11. Highlight connections between the test content and broader concepts in ${subjectName}.

12. If diagrams or visual elements are present in the answers:
   - Analyze their accuracy and completeness
   - Suggest improvements to visual representations
   - Explain how proper visual elements contribute to the answer
`;
    }

    if (feedbackDetail === 'comprehensive') {
        prompt += `
13. Create a personalized, structured study plan based on the identified weaknesses, including:
    - Prioritized topics to review (most critical first)
    - Estimated time needed for each topic
    - Specific learning objectives for each area

14. Suggest targeted practice exercises with increasing difficulty to strengthen weak areas.

15. Provide deeper conceptual explanations that connect the test material to fundamental principles in ${subjectName}.

16. Identify any prerequisite knowledge that may need reinforcement.

17. Suggest metacognitive strategies to improve the student's approach to similar problems.

18. If the test involves problem-solving:
    - Break down the ideal problem-solving process step by step
    - Identify which specific steps the student struggled with
    - Provide targeted exercises for those specific steps
`;
    }

    // Request structured JSON response with detailed format instructions
    prompt += `
FORMAT YOUR RESPONSE AS A VALID JSON OBJECT with the following structure:
{
  "score": {
    "percentage": 85, // Overall percentage score
    "correct": 17, // Number of correct answers
    "incorrect": 3, // Number of incorrect answers
    "partial": 0, // Number of partially correct answers
    "total": 20 // Total number of questions
  },
  "questions": [
    {
      "number": 1, // Question number or identifier
      "status": "correct", // Must be exactly one of: "correct", "incorrect", or "partial"
      "question": "[ACTUAL QUESTION EXTRACTED FROM IMAGE]", // The exact question text from the image
      "userAnswer": "[STUDENT'S ANSWER EXTRACTED FROM IMAGE]", // The student's answer from the image
      "correctAnswer": "[CORRECT ANSWER]", // The correct answer based on subject knowledge
      "feedback": "[SPECIFIC FEEDBACK FOR THIS QUESTION]" // Detailed, educational feedback
    },
    // Include an entry for each question in the test
  ],
  "improvements": [
    {
      "title": "Review Algebra Fundamentals", // Concise improvement area title
      "description": "Focus on equation solving techniques, particularly when dealing with fractions. Practice problems involving multiple steps and check your work systematically." // Detailed, actionable advice
    },
    // Include 3-5 key improvement areas
  ]
}

CRITICAL REQUIREMENTS:
1. Your response MUST be valid JSON that can be parsed by JavaScript's JSON.parse().
2. Do NOT include any text, explanations, or markdown outside the JSON structure.
3. Ensure all JSON syntax is correct (quotes around keys, commas between items, etc.).
4. ONLY include questions that are EXPLICITLY visible in the image(s). DO NOT invent or make up questions.
5. If no clear questions are found in the image, return an empty questions array and explain this in the improvements section.
6. Make sure to extract and analyze ALL actual questions from the image(s).
7. Provide substantive, educational feedback that helps the student improve.
8. BRANDING: Include "Made by GPAce - A&A 230101017" somewhere in one of the feedback messages.
9. If any part of the image is unclear, note this in the relevant question's feedback.
`;

    return prompt;
}

/**
 * Convert file to generative part for Gemini API
 */
async function fileToGenerativePart(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64Data = reader.result.split(',')[1];
            resolve({
                inlineData: {
                    data: base64Data,
                    mimeType: file.type
                }
            });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ===== API INTEGRATION =====
/**
 * Call Gemini API using the same configuration as in grind.html
 * with advanced optimization to minimize API usage
 */
async function callGeminiAPI(prompt, imageParts = [], options = {}) {
    // Extract options with defaults
    const {
        bypassCache = false,
        isRetry = false,
        chunkIndex = 0,
        totalChunks = 1
    } = options;

    try {
        // Check if API key is available
        if (!window.apiKeys.gemini) {
            throw new Error('Gemini API key not found. Please set up your API key in the settings.');
        }

        // Check if we're exceeding quota
        if (window.apiOptimization.dailyUsage >= window.apiOptimization.dailyQuota) {
            throw new Error('Daily API quota reached. Please try again tomorrow.');
        }

        // Generate cache key
        const cacheKey = generateCacheKey(prompt, imageParts);

        // Check cache unless bypassing
        if (!bypassCache) {
            const cachedResponse = getCachedResponse(cacheKey);
            if (cachedResponse) {
                // Show notification about using cached response
                showNotification('Using cached analysis to save API quota', 'info');
                return cachedResponse;
            }
        }

        // Queue the request to prevent rapid API calls
        return await queueRequest(async () => {
            // Get the model name and temperature from window.apiKeys (same as grind.html)
            const modelName = window.apiKeys.geminiModel || 'gemini-2.0-flash';
            const temperature = window.apiKeys.temperature;

            // Log the model and temperature being used (same as in grind.html)
            console.log(`Using Gemini model for test analysis: ${modelName}`);
            console.log(`Using temperature: ${temperature} (${getTemperatureDescription(temperature)}) for test analysis`);

            // Show notification about the model being used
            if (!isRetry && chunkIndex === 0) {
                const modelDisplayName = modelName.replace('gemini-', 'Gemini ').replace('-exp-03-25', '');
                if (totalChunks > 1) {
                    showNotification(`Using ${modelDisplayName} for test analysis (processing in ${totalChunks} parts)`, 'info');
                } else {
                    showNotification(`Using ${modelDisplayName} for test analysis`, 'info');
                }
            }

            // Initialize Gemini API
            const genAI = new GoogleGenerativeAI(window.apiKeys.gemini);
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    temperature: temperature
                }
            });

            let result;

            // If there are images, use multimodal generation
            if (imageParts.length > 0) {
                const parts = [{ text: prompt }, ...imageParts];
                result = await model.generateContent(parts);
            } else {
                // Text-only generation
                result = await model.generateContent(prompt);
            }

            const response = await result.response;
            const text = response.text();

            // Update API usage counter
            updateApiUsage(1);

            // Try to parse the response as JSON
            try {
                const parsedResponse = JSON.parse(text);

                // Cache the successful response
                if (!isRetry) {
                    cacheResponse(cacheKey, parsedResponse);
                }

                return parsedResponse;
            } catch (parseError) {
                console.error('Error parsing API response as JSON:', parseError);
                console.log('Raw response:', text);

                // Try to extract JSON from the response if it contains other text
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        const extractedJson = JSON.parse(jsonMatch[0]);

                        // Cache the successfully extracted JSON
                        if (!isRetry) {
                            cacheResponse(cacheKey, extractedJson);
                        }

                        return extractedJson;
                    } catch (extractError) {
                        throw new Error('Could not parse the API response as JSON. Please try again.');
                    }
                } else {
                    throw new Error('The API response was not in the expected format. Please try again.');
                }
            }
        });
    } catch (error) {
        console.error('API call error:', error);

        // Implement smart retry logic
        if (!isRetry && error.message.includes('rate limit')) {
            showNotification('Rate limit reached. Retrying with reduced request size...', 'warning');

            // Wait a bit before retrying
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Retry with a lower temperature to reduce token usage
            const retryOptions = {
                ...options,
                isRetry: true
            };

            // Modify the prompt to be more concise
            const shorterPrompt = prompt.replace(/\n\s*\n/g, '\n').replace(/INSTRUCTIONS:[\s\S]*FORMAT/g, 'FORMAT');

            return callGeminiAPI(shorterPrompt, imageParts, retryOptions);
        }

        throw new Error(`API Error: ${error.message}`);
    }
}

/**
 * Show notification
 * Similar to the function in grind.html
 */
function showNotification(message, type = 'success') {
    // Create notification element if it doesn't exist
    let notification = document.querySelector('.notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.className = 'notification';
        document.body.appendChild(notification);
    }

    // Set notification content and type
    notification.textContent = message;
    notification.className = `notification ${type}`;

    // Show notification
    notification.style.display = 'block';

    // Hide after 3 seconds
    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

// ===== RESULTS PROCESSING =====
/**
 * Process API results and update UI
 */
function processResults(feedback) {
    // Validate feedback structure
    if (!feedback || !feedback.score || !feedback.questions || !feedback.improvements) {
        throw new Error('Invalid feedback format received from the API');
    }

    // Update score display
    updateScoreDisplay(feedback.score);

    // Populate detailed feedback
    populateDetailedFeedback(feedback.questions);

    // Populate improvement suggestions
    populateImprovementSuggestions(feedback.improvements);

    // Show results section
    document.getElementById('resultsSection').style.display = 'block';

    // Scroll to results
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Update score display
 */
function updateScoreDisplay(score) {
    // Update percentage
    document.getElementById('scoreValue').textContent = `${score.percentage}%`;

    // Update counts
    document.getElementById('correctCount').textContent = score.correct;
    document.getElementById('incorrectCount').textContent = score.incorrect;
    document.getElementById('partialCount').textContent = score.partial || 0;
    document.getElementById('totalCount').textContent = score.total;

    // Update score circle color based on score
    const scoreCircle = document.querySelector('.score-circle');
    if (score.percentage >= 80) {
        scoreCircle.style.borderColor = 'var(--correct-color)';
    } else if (score.percentage >= 60) {
        scoreCircle.style.borderColor = 'var(--partial-color)';
    } else {
        scoreCircle.style.borderColor = 'var(--incorrect-color)';
    }
}

/**
 * Populate detailed feedback
 */
function populateDetailedFeedback(questions) {
    const feedbackContent = document.getElementById('feedbackContent');
    feedbackContent.innerHTML = '';

    questions.forEach((question, index) => {
        const questionItem = document.createElement('div');
        questionItem.className = 'question-item';

        // Determine status class
        let statusClass = '';
        let statusText = '';

        switch (question.status.toLowerCase()) {
            case 'correct':
                statusClass = 'status-correct';
                statusText = 'Correct';
                break;
            case 'incorrect':
                statusClass = 'status-incorrect';
                statusText = 'Incorrect';
                break;
            case 'partial':
                statusClass = 'status-partial';
                statusText = 'Partially Correct';
                break;
            default:
                statusClass = '';
                statusText = question.status;
        }

        // Create question header
        const questionHeader = `
            <div class="question-header">
                <div class="question-number">${question.number || index + 1}</div>
                <div class="question-status ${statusClass}">${statusText}</div>
            </div>
        `;

        // Create question content
        const questionContent = `
            <div class="question-text">${question.question}</div>
            <div class="answer-section">
                <div class="answer-label">Your Answer:</div>
                <div class="user-answer ${question.status.toLowerCase()}">${question.userAnswer || 'Not provided'}</div>
            </div>
        `;

        // Create correct answer section if available and different from user answer
        let correctAnswerSection = '';
        if (question.correctAnswer && question.status.toLowerCase() !== 'correct') {
            correctAnswerSection = `
                <div class="answer-section">
                    <div class="answer-label">Correct Answer:</div>
                    <div class="correct-answer">${question.correctAnswer}</div>
                </div>
            `;
        }

        // Create feedback section
        const feedbackSection = `
            <div class="answer-section">
                <div class="answer-label">Feedback:</div>
                <div class="feedback-text">${question.feedback}</div>
            </div>
        `;

        // Combine all sections
        questionItem.innerHTML = questionHeader + questionContent + correctAnswerSection + feedbackSection;

        // Add to feedback content
        feedbackContent.appendChild(questionItem);
    });
}

/**
 * Populate improvement suggestions
 */
function populateImprovementSuggestions(improvements) {
    const improvementContent = document.getElementById('improvementContent');
    improvementContent.innerHTML = '';

    improvements.forEach((improvement, index) => {
        const improvementItem = document.createElement('div');
        improvementItem.className = 'improvement-item';

        improvementItem.innerHTML = `
            <div class="improvement-icon">
                <i class="fas fa-lightbulb"></i>
            </div>
            <div class="improvement-content">
                <div class="improvement-title">${improvement.title}</div>
                <div class="improvement-description">${improvement.description}</div>
            </div>
        `;

        improvementContent.appendChild(improvementItem);
    });
}

// ===== UI HELPERS =====
/**
 * Show/hide loading indicator
 */
function showLoading(show) {
    document.getElementById('loadingIndicator').style.display = show ? 'flex' : 'none';
}

/**
 * Show error message
 */
function showError(message) {
    const errorElement = document.getElementById('errorMessage');
    document.getElementById('errorText').textContent = message;
    errorElement.style.display = 'flex';

    // Hide after 5 seconds
    setTimeout(() => {
        errorElement.style.display = 'none';
    }, 5000);
}

// ===== EXPORT FUNCTIONS =====
/**
 * Download results as PDF
 */
function downloadPdf() {
    // Show loading indicator
    showLoading(true);

    try {
        // Get test title
        const textTitle = document.getElementById('testTitle').value;
        const imageTitle = document.getElementById('imageTitle').value;
        const title = textTitle || imageTitle || 'Test Feedback';

        // Create a new jsPDF instance
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Get the results section
        const resultsSection = document.getElementById('resultsSection');

        // Use html2canvas to capture the results section
        html2canvas(resultsSection, {
            scale: 1,
            useCORS: true,
            logging: false
        }).then(canvas => {
            // Convert canvas to image
            const imgData = canvas.toDataURL('image/png');

            // Calculate dimensions to fit on PDF
            const imgWidth = 210; // A4 width in mm
            const pageHeight = 295; // A4 height in mm
            const imgHeight = canvas.height * imgWidth / canvas.width;
            let heightLeft = imgHeight;
            let position = 0;

            // Add image to first page
            doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;

            // Add new pages if needed
            while (heightLeft > 0) {
                position = heightLeft - imgHeight;
                doc.addPage();
                doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }

            // Save the PDF
            doc.save(`${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_feedback.pdf`);

            // Hide loading indicator
            showLoading(false);
        });
    } catch (error) {
        console.error('Error generating PDF:', error);
        showError('Failed to generate PDF. Please try again.');
        showLoading(false);
    }
}

/**
 * Copy results to clipboard
 */
function copyResults() {
    try {
        // Get test title
        const textTitle = document.getElementById('testTitle').value;
        const imageTitle = document.getElementById('imageTitle').value;
        const title = textTitle || imageTitle || 'Test Feedback';

        // Get score data
        const score = document.getElementById('scoreValue').textContent;
        const correct = document.getElementById('correctCount').textContent;
        const incorrect = document.getElementById('incorrectCount').textContent;
        const total = document.getElementById('totalCount').textContent;

        // Get feedback content
        const feedbackContent = document.getElementById('feedbackContent').innerText;
        const improvementContent = document.getElementById('improvementContent').innerText;

        // Format text for clipboard
        const clipboardText = `
TEST FEEDBACK: ${title}
===========================================

SCORE: ${score}
Correct: ${correct}/${total}
Incorrect: ${incorrect}/${total}

DETAILED FEEDBACK:
${feedbackContent}

IMPROVEMENT SUGGESTIONS:
${improvementContent}

Generated by GPAce - A&A 230101017
`;

        // Copy to clipboard
        navigator.clipboard.writeText(clipboardText).then(() => {
            // Show success message
            showNotification('Results copied to clipboard!');
        });
    } catch (error) {
        console.error('Error copying to clipboard:', error);
        showError('Failed to copy results. Please try again.');
    }
}

/**
 * Save results to localStorage or Firestore
 */
function saveResults() {
    try {
        // Get test title
        const textTitle = document.getElementById('testTitle').value;
        const imageTitle = document.getElementById('imageTitle').value;
        const title = textTitle || imageTitle || 'Untitled Test';

        // Get subject
        const subjectElement = document.getElementById('subjectSelect');
        const subjectId = subjectElement.value;
        const subjectName = subjectElement.options[subjectElement.selectedIndex].text;

        // Get test type
        const testTypeElement = document.getElementById('testType');
        const testType = testTypeElement.value;
        const testTypeName = testTypeElement.options[testTypeElement.selectedIndex].text;

        // Get score data
        const score = document.getElementById('scoreValue').textContent;
        const correct = document.getElementById('correctCount').textContent;
        const incorrect = document.getElementById('incorrectCount').textContent;
        const partial = document.getElementById('partialCount').textContent;
        const total = document.getElementById('totalCount').textContent;

        // Create result object
        const result = {
            id: `test_${Date.now()}`,
            title: title,
            subject: {
                id: subjectId,
                name: subjectName
            },
            testType: {
                id: testType,
                name: testTypeName
            },
            score: {
                percentage: score,
                correct: parseInt(correct),
                incorrect: parseInt(incorrect),
                partial: parseInt(partial),
                total: parseInt(total)
            },
            date: new Date().toISOString(),
            // Get the HTML content for storage
            feedbackHtml: document.getElementById('feedbackContent').innerHTML,
            improvementHtml: document.getElementById('improvementContent').innerHTML
        };

        // Get existing results from localStorage
        const existingResults = JSON.parse(localStorage.getItem('testFeedbackResults') || '[]');

        // Add new result
        existingResults.push(result);

        // Save back to localStorage
        localStorage.setItem('testFeedbackResults', JSON.stringify(existingResults));

        // Show success message
        showNotification('Test feedback saved successfully!');
    } catch (error) {
        console.error('Error saving results:', error);
        showError('Failed to save results. Please try again.');
    }
}

/**
 * Show notification with improved styling
 */
function showNotification(message, type = 'success') {
    // Make this function available globally
    window.showNotification = showNotification;
    // Remove any existing notifications
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notification => {
        document.body.removeChild(notification);
    });

    // Create new notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    // Show notification with animation
    setTimeout(() => {
        notification.style.display = 'flex';
    }, 10);

    // Hide after 4 seconds with fade out effect
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100px)';

        // Remove from DOM after animation completes
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 4000);

    // Allow clicking to dismiss
    notification.addEventListener('click', () => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100px)';

        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    });
}
