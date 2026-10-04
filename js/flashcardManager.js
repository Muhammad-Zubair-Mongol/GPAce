/**
 * Flashcard Manager
 * Handles the creation, storage, and display of flashcards for studying
 */

// Storage helper with fallback (use existing or create new)
if (typeof window.getStorage === 'undefined') {
    window.getStorage = () => window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };
}
const getStorage = window.getStorage;

// Initialize flashcard data structure
const storage = getStorage();
let flashcardSets = storage.get('flashcardSets', []);
let flashcards = storage.get('flashcards', []);
let subjects = [];

// DOM Elements
document.addEventListener('DOMContentLoaded', function () {
    // Load subjects first
    loadSubjects();

    // Initialize UI elements
    initializeUI();

    // Load existing flashcards
    renderFlashcards();
    renderFlashcardSets();

    // Set up event listeners
    setupEventListeners();
});

/**
 * Load subjects from the academic system
 */
function loadSubjects() {
    const storage = getStorage();
    // Get subjects from storage
    subjects = storage.get('academicSubjects', []);

    // Create default flashcard sets for subjects if they don't exist
    subjects.forEach(subject => {
        if (!flashcardSets.some(set => set.subjectTag === subject.tag)) {
            const newSet = {
                id: generateId(),
                name: `${subject.name} Flashcards`,
                category: subject.tag,
                subjectTag: subject.tag,
                description: `Study flashcards for ${subject.name}`,
                tags: [subject.name.toLowerCase(), 'course material'],
                createdAt: new Date().toISOString()
            };
            flashcardSets.push(newSet);
        }
    });

    // Save updated flashcard sets
    storage.set('flashcardSets', flashcardSets);
}

/**
 * Initialize UI elements
 */
function initializeUI() {
    // Populate flashcard set dropdown in the Add Flashcard modal
    const flashcardSetSelect = document.getElementById('flashcardSet');
    if (flashcardSetSelect) {
        flashcardSetSelect.innerHTML = '';

        if (flashcardSets.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No sets available - create one first';
            flashcardSetSelect.appendChild(option);
        } else {
            flashcardSets.forEach(set => {
                const option = document.createElement('option');
                option.value = set.id;
                option.textContent = set.name;
                flashcardSetSelect.appendChild(option);
            });
        }
    }

    // Populate subject dropdown in the Add Flashcard Set modal
    const subjectSelect = document.getElementById('setCategory');
    if (subjectSelect) {
        subjectSelect.innerHTML = '';

        if (subjects.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No subjects available - add subjects in Brain Juice first';
            subjectSelect.appendChild(option);
        } else {
            subjects.forEach(subject => {
                const option = document.createElement('option');
                option.value = subject.tag;
                option.textContent = subject.name;
                subjectSelect.appendChild(option);
            });
        }
    }

    // Update filter buttons with subject categories
    const filterContainer = document.querySelector('.filter-buttons');
    if (filterContainer) {
        filterContainer.innerHTML = `
            <button class="filter-btn active" data-category="all">All</button>
            ${subjects.map(subject =>
            `<button class="filter-btn" data-category="${subject.tag}">${subject.name}</button>`
        ).join('')}
        `;
    }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Save Flashcard Set button
    const saveFlashcardSetBtn = document.getElementById('saveFlashcardSetBtn');
    if (saveFlashcardSetBtn) {
        saveFlashcardSetBtn.addEventListener('click', saveFlashcardSet);
    }

    // Save Flashcard button
    const saveFlashcardBtn = document.getElementById('saveFlashcardBtn');
    if (saveFlashcardBtn) {
        saveFlashcardBtn.addEventListener('click', saveFlashcard);
    }

    // Filter buttons
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(button => {
        button.addEventListener('click', function () {
            const category = this.getAttribute('data-category');
            filterFlashcardsByCategory(category);

            // Update active state
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Search input
    const searchInput = document.getElementById('flashcardSearch');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            const searchTerm = this.value.toLowerCase().trim();
            searchFlashcards(searchTerm);
        });
    }

    // Image upload handling
    const imageInput = document.getElementById('imageUpload');
    const imagePreview = document.getElementById('imagePreview');
    if (imageInput) {
        imageInput.addEventListener('change', function () {
            handleImageUpload(this, imagePreview);
        });
    }
}

/**
 * Save a new flashcard set
 */
function saveFlashcardSet() {
    const storage = getStorage();
    const setName = document.getElementById('setName').value.trim();
    const setCategory = document.getElementById('setCategory').value;
    const setDescription = document.getElementById('setDescription').value.trim();
    const setTags = document.getElementById('setTags').value.trim();

    if (!setName) {
        showNotification('Please enter a name for your flashcard set', 'error');
        return;
    }

    const subject = subjects.find(s => s.tag === setCategory);
    if (!subject) {
        showNotification('Please select a valid subject', 'error');
        return;
    }

    const newSet = {
        id: generateId(),
        name: setName,
        category: setCategory,
        subjectTag: setCategory,
        description: setDescription,
        tags: setTags.split(',').map(tag => tag.trim()).filter(tag => tag),
        createdAt: new Date().toISOString()
    };

    flashcardSets.push(newSet);
    storage.set('flashcardSets', flashcardSets);

    // Close modal and reset form
    const modal = bootstrap.Modal.getInstance(document.getElementById('addFlashcardSetModal'));
    modal.hide();
    document.getElementById('flashcardSetForm').reset();

    // Update UI
    renderFlashcardSets();
    initializeUI();

    showNotification('Flashcard set created successfully!', 'success');
}

/**
 * Save a new flashcard
 */
function saveFlashcard() {
    const storage = getStorage();
    const flashcardSet = document.getElementById('flashcardSet').value;
    const flashcardTerm = document.getElementById('flashcardTerm');
    const flashcardDefinition = document.getElementById('flashcardDefinition');
    const flashcardImage = document.getElementById('flashcardImage');

    // Form validation
    let isValid = true;
    const errors = {};

    if (!flashcardSet) {
        errors.set = 'Please select a flashcard set';
        isValid = false;
    }

    if (!flashcardTerm.value.trim()) {
        errors.term = 'Please enter a term';
        flashcardTerm.classList.add('is-invalid');
        isValid = false;
    } else {
        flashcardTerm.classList.remove('is-invalid');
    }

    if (!flashcardDefinition.value.trim()) {
        errors.definition = 'Please enter a definition';
        flashcardDefinition.classList.add('is-invalid');
        isValid = false;
    } else {
        flashcardDefinition.classList.remove('is-invalid');
    }

    // Show validation errors
    if (!isValid) {
        Object.values(errors).forEach(error => {
            showNotification(error, 'error');
        });
        return;
    }

    const newFlashcard = {
        id: generateId(),
        setId: flashcardSet,
        term: flashcardTerm.value.trim(),
        definition: flashcardDefinition.value.trim(),
        image: flashcardImage.value.trim(),
        createdAt: new Date().toISOString()
    };

    flashcards.push(newFlashcard);
    storage.set('flashcards', flashcards);

    // Close modal and reset form
    const modal = bootstrap.Modal.getInstance(document.getElementById('addFlashcardModal'));
    modal.hide();
    document.getElementById('flashcardForm').reset();

    // Update UI
    renderFlashcards();

    showNotification('Flashcard added successfully!', 'success');
}

/**
 * Render all flashcard sets
 */
function renderFlashcardSets() {
    const flashcardGrid = document.querySelector('.flashcard-grid');
    if (!flashcardGrid) return;

    if (flashcardSets.length === 0) {
        flashcardGrid.innerHTML = `
            <div class="no-flashcards">
                <h3>No flashcard sets yet</h3>
                <p>Create your first flashcard set to get started!</p>
            </div>
        `;
        return;
    }

    flashcardGrid.innerHTML = '';

    flashcardSets.forEach(set => {
        // Count flashcards in this set
        const setFlashcards = flashcards.filter(card => card.setId === set.id);

        const setCard = document.createElement('div');
        setCard.className = 'flashcard-card';
        setCard.innerHTML = `
            <div class="flashcard-content">
                <h3 class="flashcard-title">${set.name}</h3>
                <p class="flashcard-description">${set.description || 'No description'}</p>
                <div class="flashcard-meta">
                    <span>${setFlashcards.length} flashcards</span>
                    <span>Subject: ${subjects.find(s => s.tag === set.subjectTag)?.name || 'Unknown'}</span>
                </div>
                <div class="flashcard-tags">
                    ${set.tags.map(tag => `<span class="flashcard-tag">${tag}</span>`).join('')}
                </div>
                <div class="mt-3">
                    <button class="btn btn-sm btn-primary study-set-btn" data-set-id="${set.id}">
                        Study Now
                    </button>
                    <button class="btn btn-sm btn-outline-danger delete-set-btn" data-set-id="${set.id}">
                        Delete
                    </button>
                </div>
            </div>
        `;

        flashcardGrid.appendChild(setCard);
    });

    // Add event listeners to the study and delete buttons
    document.querySelectorAll('.study-set-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const setId = this.getAttribute('data-set-id');
            studyFlashcardSet(setId);
        });
    });

    document.querySelectorAll('.delete-set-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const setId = this.getAttribute('data-set-id');
            deleteFlashcardSet(setId);
        });
    });
}

/**
 * Render all flashcards
 */
function renderFlashcards() {
    const flashcardContainer = document.querySelector('.flashcard-container .row');
    if (!flashcardContainer) return;

    if (flashcards.length === 0) {
        flashcardContainer.innerHTML = `
            <div class="col-12">
                <div class="no-flashcards">
                    <h3>No flashcards yet</h3>
                    <p>Create your first flashcard to start studying!</p>
                </div>
            </div>
        `;
        return;
    }

    // Sort by most recently created
    const sortedFlashcards = [...flashcards].sort((a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt)
    ).slice(0, 6); // Show only the 6 most recent

    flashcardContainer.innerHTML = '';

    sortedFlashcards.forEach(card => {
        const set = flashcardSets.find(s => s.id === card.setId);
        const setName = set ? set.name : 'Unknown Set';

        const flashcardCol = document.createElement('div');
        flashcardCol.className = 'col-md-4 mb-4';
        flashcardCol.innerHTML = `
            <div class="flashcard">
                <div class="flashcard-inner">
                    <div class="flashcard-front">
                        <h3 class="flashcard-title">${card.term}</h3>
                        <p class="text-muted">${setName}</p>
                    </div>
                    <div class="flashcard-back">
                        <p class="flashcard-content">${card.definition}</p>
                        ${card.image ? `<img src="${card.image}" alt="${card.term}" style="max-width: 100%; max-height: 100px; margin-top: 10px;">` : ''}
                    </div>
                </div>
            </div>
        `;

        flashcardContainer.appendChild(flashcardCol);
    });
}

/**
 * Filter flashcards by category (subject)
 */
function filterFlashcardsByCategory(category) {
    if (category === 'all') {
        renderFlashcardSets();
        return;
    }

    const filteredSets = flashcardSets.filter(set => set.subjectTag === category);

    const flashcardGrid = document.querySelector('.flashcard-grid');
    if (!flashcardGrid) return;

    if (filteredSets.length === 0) {
        flashcardGrid.innerHTML = `
            <div class="no-flashcards">
                <h3>No flashcard sets for this subject</h3>
                <p>Create a new set to start studying!</p>
            </div>
        `;
        return;
    }

    flashcardGrid.innerHTML = '';

    filteredSets.forEach(set => {
        // Count flashcards in this set
        const setFlashcards = flashcards.filter(card => card.setId === set.id);

        const setCard = document.createElement('div');
        setCard.className = 'flashcard-card';
        setCard.innerHTML = `
            <div class="flashcard-content">
                <h3 class="flashcard-title">${set.name}</h3>
                <p class="flashcard-description">${set.description || 'No description'}</p>
                <div class="flashcard-meta">
                    <span>${setFlashcards.length} flashcards</span>
                    <span>Subject: ${subjects.find(s => s.tag === set.subjectTag)?.name || 'Unknown'}</span>
                </div>
                <div class="flashcard-tags">
                    ${set.tags.map(tag => `<span class="flashcard-tag">${tag}</span>`).join('')}
                </div>
                <div class="mt-3">
                    <button class="btn btn-sm btn-primary study-set-btn" data-set-id="${set.id}">
                        Study Now
                    </button>
                    <button class="btn btn-sm btn-outline-danger delete-set-btn" data-set-id="${set.id}">
                        Delete
                    </button>
                </div>
            </div>
        `;

        flashcardGrid.appendChild(setCard);
    });

    // Re-add event listeners
    document.querySelectorAll('.study-set-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const setId = this.getAttribute('data-set-id');
            studyFlashcardSet(setId);
        });
    });

    document.querySelectorAll('.delete-set-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const setId = this.getAttribute('data-set-id');
            deleteFlashcardSet(setId);
        });
    });
}

/**
 * Search flashcards by term or definition
 */
function searchFlashcards(searchTerm) {
    if (!searchTerm) {
        renderFlashcardSets();
        return;
    }

    // Search in sets (name, description, tags)
    const matchingSets = flashcardSets.filter(set =>
        set.name.toLowerCase().includes(searchTerm) ||
        (set.description && set.description.toLowerCase().includes(searchTerm)) ||
        set.tags.some(tag => tag.toLowerCase().includes(searchTerm))
    );

    // Search in flashcards (term, definition)
    const matchingCardSetIds = flashcards.filter(card =>
        card.term.toLowerCase().includes(searchTerm) ||
        card.definition.toLowerCase().includes(searchTerm)
    ).map(card => card.setId);

    // Combine results (unique set IDs)
    const allMatchingSetIds = [...new Set([
        ...matchingSets.map(set => set.id),
        ...matchingCardSetIds
    ])];

    const finalMatchingSets = flashcardSets.filter(set =>
        allMatchingSetIds.includes(set.id)
    );

    const flashcardGrid = document.querySelector('.flashcard-grid');
    if (!flashcardGrid) return;

    if (finalMatchingSets.length === 0) {
        flashcardGrid.innerHTML = `
            <div class="no-flashcards">
                <h3>No matching flashcard sets</h3>
                <p>Try a different search term</p>
            </div>
        `;
        return;
    }

    flashcardGrid.innerHTML = '';

    finalMatchingSets.forEach(set => {
        // Count flashcards in this set
        const setFlashcards = flashcards.filter(card => card.setId === set.id);

        const setCard = document.createElement('div');
        setCard.className = 'flashcard-card';
        setCard.innerHTML = `
            <div class="flashcard-content">
                <h3 class="flashcard-title">${set.name}</h3>
                <p class="flashcard-description">${set.description || 'No description'}</p>
                <div class="flashcard-meta">
                    <span>${setFlashcards.length} flashcards</span>
                    <span>Subject: ${subjects.find(s => s.tag === set.subjectTag)?.name || 'Unknown'}</span>
                </div>
                <div class="flashcard-tags">
                    ${set.tags.map(tag => `<span class="flashcard-tag">${tag}</span>`).join('')}
                </div>
                <div class="mt-3">
                    <button class="btn btn-sm btn-primary study-set-btn" data-set-id="${set.id}">
                        Study Now
                    </button>
                    <button class="btn btn-sm btn-outline-danger delete-set-btn" data-set-id="${set.id}">
                        Delete
                    </button>
                </div>
            </div>
        `;

        flashcardGrid.appendChild(setCard);
    });

    // Re-add event listeners
    document.querySelectorAll('.study-set-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const setId = this.getAttribute('data-set-id');
            studyFlashcardSet(setId);
        });
    });

    document.querySelectorAll('.delete-set-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const setId = this.getAttribute('data-set-id');
            deleteFlashcardSet(setId);
        });
    });
}

/**
 * Delete a flashcard set and all its flashcards
 */
function deleteFlashcardSet(setId) {
    const storage = getStorage();
    if (!confirm('Are you sure you want to delete this flashcard set and all its cards?')) {
        return;
    }

    // Remove flashcards belonging to this set
    flashcards = flashcards.filter(card => card.setId !== setId);
    storage.set('flashcards', flashcards);

    // Remove the set
    flashcardSets = flashcardSets.filter(set => set.id !== setId);
    storage.set('flashcardSets', flashcardSets);

    // Update UI
    renderFlashcardSets();
    renderFlashcards();
    initializeUI();

    showNotification('Flashcard set deleted successfully!', 'success');
}

/**
 * Study a flashcard set
 */
function studyFlashcardSet(setId) {
    const storage = getStorage();
    const setFlashcards = flashcards.filter(card => card.setId === setId);
    const set = flashcardSets.find(s => s.id === setId);

    if (setFlashcards.length === 0) {
        showNotification('This set has no flashcards yet. Add some first!', 'info');
        return;
    }

    // Create study session state
    const studyState = {
        currentIndex: 0,
        totalCards: setFlashcards.length,
        cardsStudied: 0,
        correctAnswers: 0,
        startTime: new Date(),
        setId: setId,
        cards: setFlashcards.map(card => ({
            ...card,
            studied: false,
            confidence: 0 // 0-5 scale
        }))
    };

    // Save study state
    storage.set(`studyState_${setId}`, studyState);

    // Update the flashcard container to show study mode
    const flashcardContainer = document.querySelector('.flashcard-container');
    if (!flashcardContainer) return;

    flashcardContainer.innerHTML = `
        <div class="study-mode">
            <div class="study-header d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h3>${set.name}</h3>
                    <p class="text-muted">Card ${studyState.currentIndex + 1} of ${studyState.totalCards}</p>
                </div>
                <div class="progress" style="width: 200px;">
                    <div class="progress-bar" role="progressbar" style="width: 0%;" 
                         aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">0%</div>
                </div>
            </div>
            
            <div class="row">
                <div class="col-md-8 mx-auto">
                    <div class="flashcard study-card">
                        <div class="flashcard-inner">
                            <div class="flashcard-front">
                                <h3 class="flashcard-title">${setFlashcards[0].term}</h3>
                                <p class="text-muted">Click to flip</p>
                            </div>
                            <div class="flashcard-back">
                                <p class="flashcard-content">${setFlashcards[0].definition}</p>
                                ${setFlashcards[0].image ?
            `<img src="${setFlashcards[0].image}" alt="${setFlashcards[0].term}" 
                                    style="max-width: 100%; max-height: 200px; margin-top: 10px;">` :
            ''}
                            </div>
                        </div>
                    </div>
                    
                    <div class="confidence-rating text-center mt-4" style="display: none;">
                        <p>How well did you know this?</p>
                        <div class="btn-group">
                            <button class="btn btn-outline-danger" data-confidence="1">Again</button>
                            <button class="btn btn-outline-warning" data-confidence="2">Hard</button>
                            <button class="btn btn-outline-info" data-confidence="3">Good</button>
                            <button class="btn btn-outline-success" data-confidence="4">Easy</button>
                            <button class="btn btn-outline-primary" data-confidence="5">Perfect</button>
                        </div>
                    </div>
                    
                    <div class="navigation-buttons text-center mt-4">
                        <button class="btn btn-secondary me-2" onclick="previousCard()">
                            <i class="bi bi-arrow-left"></i> Previous
                        </button>
                        <button class="btn btn-primary" onclick="nextCard()">
                            Next <i class="bi bi-arrow-right"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Add event listeners for the study mode
    setupStudyModeListeners(setId);

    // Scroll to the study section
    flashcardContainer.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Set up event listeners for study mode
 */
function setupStudyModeListeners(setId) {
    const studyCard = document.querySelector('.study-card');
    const confidenceRating = document.querySelector('.confidence-rating');
    const navigationButtons = document.querySelector('.navigation-buttons');

    if (studyCard) {
        studyCard.addEventListener('click', function () {
            this.classList.add('flipped');
            confidenceRating.style.display = 'block';
            navigationButtons.style.display = 'none';
        });
    }

    // Add confidence rating handlers
    document.querySelectorAll('.confidence-rating button').forEach(button => {
        button.addEventListener('click', function () {
            const confidence = parseInt(this.getAttribute('data-confidence'));
            recordConfidence(setId, confidence);

            // Show navigation buttons
            confidenceRating.style.display = 'none';
            navigationButtons.style.display = 'block';

            // Remove flip class for next card
            if (studyCard) {
                studyCard.classList.remove('flipped');
            }
        });
    });
}

/**
 * Record confidence for a card
 */
function recordConfidence(setId, confidence) {
    const storage = getStorage();
    const studyState = storage.get(`studyState_${setId}`, null);
    if (!studyState) return;

    // Get current card
    const currentCard = studyState.cards[studyState.currentIndex];

    // Update current card
    currentCard.studied = true;
    currentCard.confidence = confidence;
    studyState.cardsStudied++;

    if (confidence >= 3) {
        studyState.correctAnswers++;
    }

    // Update SRS data
    const cardData = storage.get(`card_${currentCard.id}_srs`, {
        repetitions: 0,
        lastReview: 1,
        easinessFactor: 2.5,
        nextReview: new Date()
    });

    const srsData = calculateNextReview(confidence, cardData.lastReview, cardData.repetitions);

    // Save updated SRS data
    storage.set(`card_${currentCard.id}_srs`, {
        repetitions: srsData.repetitions,
        lastReview: Math.round((srsData.nextReview - new Date()) / (24 * 60 * 60 * 1000)),
        easinessFactor: srsData.easinessFactor,
        nextReview: srsData.nextReview,
        lastStudied: new Date()
    });

    // Update progress bar
    const progress = (studyState.cardsStudied / studyState.totalCards) * 100;
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
        progressBar.setAttribute('aria-valuenow', progress);
        progressBar.textContent = `${Math.round(progress)}%`;
    }

    // Save updated state
    storage.set(`studyState_${setId}`, studyState);

    // Check if study session is complete
    if (studyState.cardsStudied === studyState.totalCards) {
        showStudyResults(setId);
    }
}

/**
 * Calculate next review based on SRS algorithm
 */
function calculateNextReview(confidence, lastReview, repetitions) {
    const MIN_INTERVAL = 1;
    const MAX_INTERVAL = 365;
    const EASY_FACTOR = 2.5;
    const HARD_FACTOR = 1.3;

    const quality = confidence - 1;

    let ef = EASY_FACTOR;
    if (quality < 3) {
        ef = HARD_FACTOR;
    } else {
        ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    }
    ef = Math.max(1.3, ef);

    let interval;
    if (repetitions === 0) {
        interval = MIN_INTERVAL;
    } else if (repetitions === 1) {
        interval = 6;
    } else {
        interval = Math.round(lastReview * ef);
    }

    interval = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, interval));

    return {
        nextReview: new Date(Date.now() + interval * 24 * 60 * 60 * 1000),
        easinessFactor: ef,
        repetitions: quality >= 3 ? repetitions + 1 : 0
    };
}

/**
 * Show study results
 */
function showStudyResults(setId) {
    const storage = getStorage();
    const studyState = storage.get(`studyState_${setId}`, null);
    if (!studyState) return;

    const endTime = new Date();
    const duration = Math.round((endTime - new Date(studyState.startTime)) / 1000);
    const accuracy = (studyState.correctAnswers / studyState.totalCards) * 100;

    const flashcardContainer = document.querySelector('.flashcard-container');
    if (!flashcardContainer) return;

    flashcardContainer.innerHTML = `
        <div class="study-results text-center">
            <h2>Study Session Complete!</h2>
            <div class="row mt-4">
                <div class="col-md-8 mx-auto">
                    <div class="results-card p-4">
                        <h4>Session Summary</h4>
                        <p>Cards Studied: ${studyState.totalCards}</p>
                        <p>Correct: ${studyState.correctAnswers}</p>
                        <p>Accuracy: ${accuracy.toFixed(1)}%</p>
                        <p>Duration: ${Math.floor(duration / 60)}m ${duration % 60}s</p>
                        <button class="btn btn-primary mt-3" onclick="location.reload()">
                            Back to Flashcards
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Navigate to next card
 */
function nextCard() {
    const storage = getStorage();
    const studyCard = document.querySelector('.study-card');
    if (studyCard) studyCard.classList.remove('flipped');

    // Get current set ID from study state
    const setIds = Object.keys(flashcardSets).map(s => flashcardSets[s].id);
    for (const setId of setIds) {
        const studyState = storage.get(`studyState_${setId}`, null);
        if (studyState && studyState.currentIndex < studyState.totalCards - 1) {
            studyState.currentIndex++;
            storage.set(`studyState_${setId}`, studyState);
            updateStudyCard(setId);
            break;
        }
    }
}

/**
 * Navigate to previous card
 */
function previousCard() {
    const storage = getStorage();
    const studyCard = document.querySelector('.study-card');
    if (studyCard) studyCard.classList.remove('flipped');

    // Get current set ID from study state
    const setIds = Object.keys(flashcardSets).map(s => flashcardSets[s].id);
    for (const setId of setIds) {
        const studyState = storage.get(`studyState_${setId}`, null);
        if (studyState && studyState.currentIndex > 0) {
            studyState.currentIndex--;
            storage.set(`studyState_${setId}`, studyState);
            updateStudyCard(setId);
            break;
        }
    }
}

/**
 * Update the study card display
 */
function updateStudyCard(setId) {
    const storage = getStorage();
    const studyState = storage.get(`studyState_${setId}`, null);
    if (!studyState) return;

    const card = studyState.cards[studyState.currentIndex];
    const studyCard = document.querySelector('.study-card .flashcard-inner');

    if (studyCard) {
        studyCard.innerHTML = `
            <div class="flashcard-front">
                <h3 class="flashcard-title">${card.term}</h3>
                <p class="text-muted">Click to flip</p>
            </div>
            <div class="flashcard-back">
                <p class="flashcard-content">${card.definition}</p>
                ${card.image ?
                `<img src="${card.image}" alt="${card.term}" 
                    style="max-width: 100%; max-height: 200px; margin-top: 10px;">` :
                ''}
            </div>
        `;
    }

    // Update card counter
    const cardCounter = document.querySelector('.study-header p.text-muted');
    if (cardCounter) {
        cardCounter.textContent = `Card ${studyState.currentIndex + 1} of ${studyState.totalCards}`;
    }
}

/**
 * Generate a unique ID
 */
function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `alert alert-${type === 'error' ? 'danger' : type} notification`;
    notification.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    notification.textContent = message;

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

/**
 * Handle image upload
 */
function handleImageUpload(input, preview) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        if (preview) {
            preview.innerHTML = `<img src="${e.target.result}" alt="Preview" style="max-width: 100%; max-height: 150px;">`;
        }
        document.getElementById('flashcardImage').value = e.target.result;
    };
    reader.readAsDataURL(file);
}