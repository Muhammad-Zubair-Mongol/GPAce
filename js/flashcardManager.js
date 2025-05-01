/**
 * Flashcard Manager
 * Handles the creation, storage, and display of flashcards for studying
 */

// Initialize flashcard data structure
let flashcardSets = JSON.parse(localStorage.getItem('flashcardSets')) || [];
let flashcards = JSON.parse(localStorage.getItem('flashcards')) || [];
let subjects = [];

// DOM Elements
document.addEventListener('DOMContentLoaded', function() {
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
    // Get subjects from localStorage
    const subjectsJson = localStorage.getItem('academicSubjects') || '[]';
    subjects = JSON.parse(subjectsJson);
    
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
    localStorage.setItem('flashcardSets', JSON.stringify(flashcardSets));
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
        button.addEventListener('click', function() {
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
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase().trim();
            searchFlashcards(searchTerm);
        });
    }
    
    // Image upload handling
    const imageInput = document.getElementById('imageUpload');
    const imagePreview = document.getElementById('imagePreview');
    if (imageInput) {
        imageInput.addEventListener('change', function() {
            handleImageUpload(this, imagePreview);
        });
    }
}

/**
 * Save a new flashcard set
 */
function saveFlashcardSet() {
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
    localStorage.setItem('flashcardSets', JSON.stringify(flashcardSets));
    
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
    localStorage.setItem('flashcards', JSON.stringify(flashcards));
    
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
        btn.addEventListener('click', function() {
            const setId = this.getAttribute('data-set-id');
            studyFlashcardSet(setId);
        });
    });
    
    document.querySelectorAll('.delete-set-btn').forEach(btn => {
        btn.addEventListener('click', function() {
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
        btn.addEventListener('click', function() {
            const setId = this.getAttribute('data-set-id');
            studyFlashcardSet(setId);
        });
    });
    
    document.querySelectorAll('.delete-set-btn').forEach(btn => {
        btn.addEventListener('click', function() {
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
        btn.addEventListener('click', function() {
            const setId = this.getAttribute('data-set-id');
            studyFlashcardSet(setId);
        });
    });
    
    document.querySelectorAll('.delete-set-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const setId = this.getAttribute('data-set-id');
            deleteFlashcardSet(setId);
        });
    });
}

/**
 * Study a flashcard set
 */
function studyFlashcardSet(setId) {
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
    localStorage.setItem(`studyState_${setId}`, JSON.stringify(studyState));
    
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
        studyCard.addEventListener('click', function() {
            this.classList.add('flipped');
            confidenceRating.style.display = 'block';
            navigationButtons.style.display = 'none';
        });
    }
    
    // Add confidence rating handlers
    document.querySelectorAll('.confidence-rating button').forEach(button => {
        button.addEventListener('click', function() {
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
 * Spaced Repetition System (SRS)
 * Based on SuperMemo 2 algorithm
 */
function calculateNextReview(confidence, lastReview, repetitions) {
    // SuperMemo 2 algorithm parameters
    const MIN_INTERVAL = 1; // 1 day
    const MAX_INTERVAL = 365; // 1 year
    const EASY_FACTOR = 2.5;
    const HARD_FACTOR = 1.3;
    
    // Convert confidence (1-5) to quality (0-5)
    const quality = confidence - 1;
    
    // Calculate easiness factor (EF)
    let ef = EASY_FACTOR;
    if (quality < 3) {
        ef = HARD_FACTOR;
    } else {
        ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    }
    ef = Math.max(1.3, ef); // minimum EF of 1.3
    
    // Calculate interval
    let interval;
    if (repetitions === 0) {
        interval = MIN_INTERVAL;
    } else if (repetitions === 1) {
        interval = 6; // 6 days
    } else {
        interval = Math.round(lastReview * ef);
    }
    
    // Cap interval
    interval = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, interval));
    
    return {
        nextReview: new Date(Date.now() + interval * 24 * 60 * 60 * 1000),
        easinessFactor: ef,
        repetitions: quality >= 3 ? repetitions + 1 : 0
    };
}

/**
 * Update card review data when recording confidence
 */
function recordConfidence(setId, confidence) {
    const studyState = JSON.parse(localStorage.getItem(`studyState_${setId}`));
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
    const cardData = JSON.parse(localStorage.getItem(`card_${currentCard.id}_srs`) || 'null') || {
        repetitions: 0,
        lastReview: 1,
        easinessFactor: 2.5,
        nextReview: new Date()
    };
    
    const srsData = calculateNextReview(confidence, cardData.lastReview, cardData.repetitions);
    
    // Save updated SRS data
    localStorage.setItem(`card_${currentCard.id}_srs`, JSON.stringify({
        repetitions: srsData.repetitions,
        lastReview: Math.round((srsData.nextReview - new Date()) / (24 * 60 * 60 * 1000)),
        easinessFactor: srsData.easinessFactor,
        nextReview: srsData.nextReview,
        lastStudied: new Date()
    }));
    
    // Update progress bar
    const progress = (studyState.cardsStudied / studyState.totalCards) * 100;
    const progressBar = document.querySelector('.progress-bar');
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
        progressBar.setAttribute('aria-valuenow', progress);
        progressBar.textContent = `${Math.round(progress)}%`;
    }
    
    // Save updated state
    localStorage.setItem(`studyState_${setId}`, JSON.stringify(studyState));
    
    // Check if study session is complete
    if (studyState.cardsStudied === studyState.totalCards) {
        showStudyResults(setId);
    }
}

/**
 * Show study session results
 */
function showStudyResults(setId) {
    const studyState = JSON.parse(localStorage.getItem(`studyState_${setId}`));
    if (!studyState) return;
    
    const endTime = new Date();
    const duration = Math.round((endTime - new Date(studyState.startTime)) / 1000); // in seconds
    const accuracy = (studyState.correctAnswers / studyState.totalCards) * 100;
    
    const flashcardContainer = document.querySelector('.flashcard-container');
    if (!flashcardContainer) return;
    
    flashcardContainer.innerHTML = `
        <div class="study-results text-center">
            <h2>Study Session Complete!</h2>
            <div class="row mt-4">
                <div class="col-md-8 mx-auto">
                    <div class="card">
                        <div class="card-body">
                            <h3>Results</h3>
                            <div class="row mt-4">
                                <div class="col-6">
                                    <h4>${studyState.totalCards}</h4>
                                    <p>Cards Studied</p>
                                </div>
                                <div class="col-6">
                                    <h4>${Math.round(accuracy)}%</h4>
                                    <p>Accuracy</p>
                                </div>
                                <div class="col-6">
                                    <h4>${Math.floor(duration / 60)}m ${duration % 60}s</h4>
                                    <p>Time Spent</p>
                                </div>
                                <div class="col-6">
                                    <h4>${Math.round(studyState.totalCards / (duration / 60))}</h4>
                                    <p>Cards per Minute</p>
                                </div>
                            </div>
                            <div class="mt-4">
                                <button class="btn btn-primary me-2" onclick="studyFlashcardSet('${setId}')">
                                    Study Again
                                </button>
                                <button class="btn btn-outline-primary" onclick="reviewMistakes('${setId}')">
                                    Review Mistakes
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Save study session results
    const set = flashcardSets.find(s => s.id === setId);
    const studyHistory = JSON.parse(localStorage.getItem('studyHistory') || '[]');
    studyHistory.push({
        setId: setId,
        setName: set.name,
        date: new Date().toISOString(),
        totalCards: studyState.totalCards,
        correctAnswers: studyState.correctAnswers,
        accuracy: accuracy,
        duration: duration,
        cardsPerMinute: Math.round(studyState.totalCards / (duration / 60))
    });
    localStorage.setItem('studyHistory', JSON.stringify(studyHistory));
}

/**
 * Navigate to previous card in study mode
 */
function previousCard() {
    const urlParams = new URLSearchParams(window.location.search);
    const setId = urlParams.get('studySetId');
    if (!setId) return;
    
    const studyState = JSON.parse(localStorage.getItem(`studyState_${setId}`));
    if (!studyState || studyState.currentIndex === 0) return;
    
    studyState.currentIndex--;
    localStorage.setItem(`studyState_${setId}`, JSON.stringify(studyState));
    
    updateStudyCard(setId);
}

/**
 * Navigate to next card in study mode
 */
function nextCard() {
    const urlParams = new URLSearchParams(window.location.search);
    const setId = urlParams.get('studySetId');
    if (!setId) return;
    
    const studyState = JSON.parse(localStorage.getItem(`studyState_${setId}`));
    if (!studyState || studyState.currentIndex >= studyState.totalCards - 1) return;
    
    studyState.currentIndex++;
    localStorage.setItem(`studyState_${setId}`, JSON.stringify(studyState));
    
    updateStudyCard(setId);
}

/**
 * Update the study card display
 */
function updateStudyCard(setId) {
    const studyState = JSON.parse(localStorage.getItem(`studyState_${setId}`));
    if (!studyState) return;
    
    const currentCard = studyState.cards[studyState.currentIndex];
    
    // Update card content
    const cardTitle = document.querySelector('.flashcard-title');
    const cardContent = document.querySelector('.flashcard-content');
    if (cardTitle) cardTitle.textContent = currentCard.term;
    if (cardContent) cardContent.textContent = currentCard.definition;
    
    // Update progress
    const cardProgress = document.querySelector('.study-header p');
    if (cardProgress) {
        cardProgress.textContent = `Card ${studyState.currentIndex + 1} of ${studyState.totalCards}`;
    }
    
    // Reset card state
    const studyCard = document.querySelector('.study-card');
    const confidenceRating = document.querySelector('.confidence-rating');
    const navigationButtons = document.querySelector('.navigation-buttons');
    
    if (studyCard) studyCard.classList.remove('flipped');
    if (confidenceRating) confidenceRating.style.display = 'none';
    if (navigationButtons) navigationButtons.style.display = 'block';
}

/**
 * Review cards marked as difficult
 */
function reviewMistakes(setId) {
    const studyState = JSON.parse(localStorage.getItem(`studyState_${setId}`));
    if (!studyState) return;
    
    // Filter cards with low confidence
    const mistakeCards = studyState.cards.filter(card => card.confidence < 3);
    
    if (mistakeCards.length === 0) {
        showNotification('No cards to review! Great job!', 'success');
        return;
    }
    
    // Create new study session with mistake cards
    const reviewState = {
        currentIndex: 0,
        totalCards: mistakeCards.length,
        cardsStudied: 0,
        correctAnswers: 0,
        startTime: new Date(),
        setId: setId,
        cards: mistakeCards.map(card => ({
            ...card,
            studied: false,
            confidence: 0
        }))
    };
    
    localStorage.setItem(`studyState_${setId}`, JSON.stringify(reviewState));
    studyFlashcardSet(setId);
}

/**
 * Delete a flashcard set
 */
function deleteFlashcardSet(setId) {
    if (!confirm('Are you sure you want to delete this flashcard set? This will also delete all flashcards in the set.')) {
        return;
    }
    
    // Remove the set
    flashcardSets = flashcardSets.filter(set => set.id !== setId);
    
    // Remove all flashcards in the set
    flashcards = flashcards.filter(card => card.setId !== setId);
    
    // Update localStorage
    localStorage.setItem('flashcardSets', JSON.stringify(flashcardSets));
    localStorage.setItem('flashcards', JSON.stringify(flashcards));
    
    // Update UI
    renderFlashcardSets();
    renderFlashcards();
    initializeUI();
    
    showNotification('Flashcard set deleted successfully', 'success');
}

/**
 * Show a notification
 */
function showNotification(message, type = 'info') {
    // Check if notification container exists, if not create it
    let notificationContainer = document.querySelector('.notification-container');
    if (!notificationContainer) {
        notificationContainer = document.createElement('div');
        notificationContainer.className = 'notification-container';
        document.body.appendChild(notificationContainer);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="bi ${type === 'success' ? 'bi-check-circle' : type === 'error' ? 'bi-exclamation-circle' : 'bi-info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    
    notificationContainer.appendChild(notification);
    
    // Show notification
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Hide and remove notification after 3 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

/**
 * Generate a unique ID
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

/**
 * Export flashcard set to PDF
 */
function exportToPDF(setId) {
    const set = flashcardSets.find(s => s.id === setId);
    const setFlashcards = flashcards.filter(card => card.setId === setId);
    
    if (!set || setFlashcards.length === 0) {
        showNotification('No flashcards to export', 'error');
        return;
    }
    
    // Create PDF content
    const content = `
        <div class="pdf-container" style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
            <h1 style="color: #fe2c55; text-align: center;">${set.name}</h1>
            <p style="color: #666; text-align: center;">${set.description || ''}</p>
            
            <div style="margin-top: 30px;">
                ${setFlashcards.map((card, index) => `
                    <div style="margin-bottom: 30px; page-break-inside: avoid;">
                        <h3 style="color: #333;">Card ${index + 1}</h3>
                        <div style="border: 1px solid #ddd; padding: 20px; border-radius: 8px; margin-bottom: 10px;">
                            <h4 style="margin: 0; color: #fe2c55;">Term:</h4>
                            <p style="margin: 10px 0;">${card.term}</p>
                        </div>
                        <div style="border: 1px solid #ddd; padding: 20px; border-radius: 8px;">
                            <h4 style="margin: 0; color: #25f4ee;">Definition:</h4>
                            <p style="margin: 10px 0;">${card.definition}</p>
                            ${card.image ? `<img src="${card.image}" style="max-width: 100%; margin-top: 10px;">` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <div style="text-align: center; margin-top: 30px; color: #666;">
                <p>Generated by GPAce Study Flashcards</p>
                <p>Date: ${new Date().toLocaleDateString()}</p>
            </div>
        </div>
    `;
    
    // Create a hidden iframe for printing
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    
    iframe.contentDocument.write(`
        <!DOCTYPE html>
        <html>
            <head>
                <title>${set.name} - Flashcards</title>
                <style>
                    @media print {
                        @page {
                            margin: 1cm;
                        }
                    }
                </style>
            </head>
            <body>${content}</body>
        </html>
    `);
    
    // Print the iframe
    iframe.contentWindow.print();
    
    // Remove the iframe after printing
    setTimeout(() => {
        document.body.removeChild(iframe);
    }, 1000);
}

/**
 * Share flashcard set
 */
function shareFlashcardSet(setId) {
    const set = flashcardSets.find(s => s.id === setId);
    if (!set) return;
    
    // Create share modal HTML
    const modalHTML = `
        <div class="modal fade" id="shareModal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content" style="background-color: var(--card-bg); color: var(--text-color);">
                    <div class="modal-header">
                        <h5 class="modal-title">Share "${set.name}"</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" style="filter: invert(1);"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-4">
                            <label class="form-label">Share Link</label>
                            <div class="input-group">
                                <input type="text" class="form-control" value="${window.location.href}?set=${setId}" readonly>
                                <button class="btn btn-outline-primary" onclick="copyShareLink(this)">
                                    <i class="bi bi-clipboard"></i>
                                </button>
                            </div>
                        </div>
                        
                        <div class="mb-4">
                            <label class="form-label">Share on Social Media</label>
                            <div class="d-flex gap-2">
                                <button class="btn btn-outline-primary" onclick="shareOnPlatform('twitter', '${setId}')">
                                    <i class="bi bi-twitter"></i>
                                </button>
                                <button class="btn btn-outline-primary" onclick="shareOnPlatform('facebook', '${setId}')">
                                    <i class="bi bi-facebook"></i>
                                </button>
                                <button class="btn btn-outline-primary" onclick="shareOnPlatform('linkedin', '${setId}')">
                                    <i class="bi bi-linkedin"></i>
                                </button>
                                <button class="btn btn-outline-primary" onclick="shareOnPlatform('whatsapp', '${setId}')">
                                    <i class="bi bi-whatsapp"></i>
                                </button>
                            </div>
                        </div>
                        
                        <div>
                            <label class="form-label">Export Options</label>
                            <div class="d-flex gap-2">
                                <button class="btn btn-outline-primary" onclick="exportToPDF('${setId}')">
                                    <i class="bi bi-file-pdf"></i> Export as PDF
                                </button>
                                <button class="btn btn-outline-primary" onclick="printFlashcards('${setId}')">
                                    <i class="bi bi-printer"></i> Print
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Add modal to body
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHTML;
    document.body.appendChild(modalContainer);
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('shareModal'));
    modal.show();
    
    // Remove modal when hidden
    document.getElementById('shareModal').addEventListener('hidden.bs.modal', function() {
        document.body.removeChild(modalContainer);
    });
}

/**
 * Copy share link to clipboard
 */
function copyShareLink(button) {
    const input = button.parentElement.querySelector('input');
    input.select();
    document.execCommand('copy');
    
    // Show copied feedback
    const originalHTML = button.innerHTML;
    button.innerHTML = '<i class="bi bi-check"></i>';
    button.disabled = true;
    
    setTimeout(() => {
        button.innerHTML = originalHTML;
        button.disabled = false;
    }, 2000);
    
    showNotification('Link copied to clipboard!', 'success');
}

/**
 * Share on social media platform
 */
function shareOnPlatform(platform, setId) {
    const set = flashcardSets.find(s => s.id === setId);
    if (!set) return;
    
    const url = encodeURIComponent(window.location.href + '?set=' + setId);
    const text = encodeURIComponent(`Check out my flashcard set "${set.name}" on GPAce Study Flashcards!`);
    
    let shareUrl = '';
    switch (platform) {
        case 'twitter':
            shareUrl = `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
            break;
        case 'facebook':
            shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
            break;
        case 'linkedin':
            shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
            break;
        case 'whatsapp':
            shareUrl = `https://wa.me/?text=${text}%20${url}`;
            break;
    }
    
    window.open(shareUrl, '_blank');
}

/**
 * Print flashcards
 */
function printFlashcards(setId) {
    // Use the same content as PDF but optimize for printing
    exportToPDF(setId);
}

// Add share and export buttons to flashcard set cards
function addShareButtons() {
    document.querySelectorAll('.flashcard-card').forEach(card => {
        const setId = card.querySelector('.study-set-btn').getAttribute('data-set-id');
        const buttonContainer = card.querySelector('.mt-3');
        
        // Add share and export buttons
        buttonContainer.insertAdjacentHTML('beforeend', `
            <button class="btn btn-sm btn-outline-primary ms-2" onclick="shareFlashcardSet('${setId}')">
                <i class="bi bi-share"></i>
            </button>
        `);
    });
}

// Update renderFlashcardSets to include share buttons
const originalRenderFlashcardSets = renderFlashcardSets;
renderFlashcardSets = function() {
    originalRenderFlashcardSets.apply(this, arguments);
    addShareButtons();
};

/**
 * Get cards due for review
 */
function getDueCards(setId) {
    const setFlashcards = flashcards.filter(card => card.setId === setId);
    const now = new Date();
    
    return setFlashcards.filter(card => {
        const srsData = JSON.parse(localStorage.getItem(`card_${card.id}_srs`) || 'null');
        if (!srsData) return true; // New cards are always due
        return new Date(srsData.nextReview) <= now;
    });
}

/**
 * Start a spaced repetition study session
 */
function startSRSStudy(setId) {
    const dueCards = getDueCards(setId);
    
    if (dueCards.length === 0) {
        showNotification('No cards due for review!', 'info');
        return;
    }
    
    // Create study session with due cards
    const studyState = {
        currentIndex: 0,
        totalCards: dueCards.length,
        cardsStudied: 0,
        correctAnswers: 0,
        startTime: new Date(),
        setId: setId,
        cards: dueCards.map(card => ({
            ...card,
            studied: false,
            confidence: 0
        }))
    };
    
    // Save study state
    localStorage.setItem(`studyState_${setId}`, JSON.stringify(studyState));
    
    // Start study session
    studyFlashcardSet(setId);
}

// Add SRS button to flashcard set cards
function addSRSButtons() {
    document.querySelectorAll('.flashcard-card').forEach(card => {
        const setId = card.querySelector('.study-set-btn').getAttribute('data-set-id');
        const buttonContainer = card.querySelector('.mt-3');
        
        // Get number of due cards
        const dueCards = getDueCards(setId);
        
        if (dueCards.length > 0) {
            // Add SRS study button
            buttonContainer.insertAdjacentHTML('beforeend', `
                <button class="btn btn-sm btn-outline-success ms-2" onclick="startSRSStudy('${setId}')">
                    <i class="bi bi-clock-history"></i> Review (${dueCards.length})
                </button>
            `);
        }
    });
}

// Update renderFlashcardSets to include SRS buttons
const originalRenderWithShare = renderFlashcardSets;
renderFlashcardSets = function() {
    originalRenderWithShare.apply(this, arguments);
    addSRSButtons();
};

/**
 * Handle image upload
 */
function handleImageUpload(input, previewElement) {
    const file = input.files[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
        showNotification('Please select an image file', 'error');
        return;
    }
    
    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showNotification('Image size should be less than 5MB', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const imageUrl = e.target.result;
        
        // Update preview
        if (previewElement) {
            previewElement.innerHTML = `
                <div class="position-relative">
                    <img src="${imageUrl}" alt="Preview" class="img-fluid rounded" style="max-height: 200px;">
                    <button type="button" class="btn btn-sm btn-danger position-absolute top-0 end-0 m-2" onclick="removeImage(this)">
                        <i class="bi bi-x"></i>
                    </button>
                </div>
            `;
        }
        
        // Store image URL
        document.getElementById('flashcardImage').value = imageUrl;
    };
    reader.readAsDataURL(file);
}

/**
 * Remove uploaded image
 */
function removeImage(button) {
    const previewElement = button.closest('.image-preview');
    if (previewElement) {
        previewElement.innerHTML = '';
    }
    document.getElementById('flashcardImage').value = '';
} 