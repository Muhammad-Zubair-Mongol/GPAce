/**
 * Flashcard Task Integration
 * Integrates flashcards with tasks in the priority shower
 */

class FlashcardTaskIntegration {
    constructor() {
        this.connections = {};
        this.initialized = false;
        this.currentTaskId = null;
    }

    /**
     * Initialize the integration
     */
    async init() {
        if (this.initialized) return;

        console.log('Initializing flashcard task integration');

        // Load connections from localStorage
        this.loadConnections();

        // Set up event listeners
        this.setupEventListeners();

        // Mark as initialized
        this.initialized = true;

        // Add the flashcard button to the current task if available
        this.addFlashcardButtonToCurrentTask();
    }

    /**
     * Load task-flashcard connections from localStorage
     */
    loadConnections() {
        try {
            const connections = localStorage.getItem('taskFlashcardConnections');
            if (connections) {
                this.connections = JSON.parse(connections);
                console.log('Loaded task-flashcard connections:', Object.keys(this.connections).length);
            } else {
                console.log('No existing task-flashcard connections found');
                this.connections = {};
            }
        } catch (error) {
            console.error('Error loading task-flashcard connections:', error);
            this.connections = {};
        }
    }

    /**
     * Set up event listeners
     */
    setupEventListeners() {
        // Listen for task-flashcard connections updates
        window.addEventListener('taskFlashcardConnectionsUpdated', (event) => {
            console.log('Task-flashcard connections updated');
            this.connections = event.detail.connections;
            this.addFlashcardButtonToCurrentTask();
        });

        // Listen for priority task updates
        window.addEventListener('storage', (event) => {
            if (event.key === 'calculatedPriorityTasks') {
                console.log('Priority tasks updated, refreshing flashcard button');
                setTimeout(() => {
                    this.addFlashcardButtonToCurrentTask();
                }, 500); // Give time for the priority task to be displayed
            }
        });

        // Listen for DOM changes to detect new task displays
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Check if the priority task box was updated
                    const taskBox = document.getElementById('priorityTaskBox');
                    if (taskBox && mutation.target === taskBox) {
                        console.log('Priority task box updated, refreshing flashcard button');
                        this.addFlashcardButtonToCurrentTask();
                    }
                }
            });
        });

        // Start observing the document body for changes
        observer.observe(document.body, { childList: true, subtree: true });
    }

    /**
     * Add flashcard button to the current task in the priority shower
     */
    addFlashcardButtonToCurrentTask() {
        // Find the current task info element
        const taskInfo = document.querySelector('.task-info');
        if (!taskInfo) {
            console.log('No task info element found');
            return;
        }

        // Get the task ID
        const taskId = taskInfo.dataset.taskId;
        if (!taskId) {
            console.log('No task ID found in task info element');
            return;
        }

        this.currentTaskId = taskId;

        // Check if this task has a connected flashcard deck
        const connection = this.connections[taskId];
        if (!connection) {
            console.log(`No flashcard deck connected to task: ${taskId}`);
            return;
        }

        // Find the task actions container
        const taskActions = taskInfo.nextElementSibling;
        if (!taskActions || !taskActions.classList.contains('task-actions')) {
            console.log('No task actions element found');
            return;
        }

        // Check if the flashcard button already exists
        let flashcardBtn = taskActions.querySelector('.flashcard-btn');
        if (flashcardBtn) {
            // Update the button if it exists
            flashcardBtn.setAttribute('data-deck-id', connection.deckId);
            return;
        }

        // Create the flashcard button
        flashcardBtn = document.createElement('button');
        flashcardBtn.className = 'task-btn flashcard-btn';
        flashcardBtn.setAttribute('data-deck-id', connection.deckId);
        flashcardBtn.innerHTML = '<i class="bi bi-card-text"></i> Flashcards';

        // Add click handler
        flashcardBtn.addEventListener('click', () => {
            this.openFlashcardDeck(connection.deckId);
        });

        // Add the button to the task actions
        taskActions.appendChild(flashcardBtn);

        // Add some styling for the button
        this.addButtonStyles();
    }

    /**
     * Add styles for the flashcard button
     */
    addButtonStyles() {
        if (document.getElementById('flashcard-task-styles')) return;

        const style = document.createElement('style');
        style.id = 'flashcard-task-styles';
        style.textContent = `
            .flashcard-btn {
                background-color: #6c5ce7;
                color: white;
            }

            .flashcard-btn:hover {
                background-color: #5541d8;
            }

            .flashcard-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                z-index: 1000;
                overflow: auto;
            }

            .flashcard-modal-content {
                background-color: var(--surface-color, #1f2937);
                margin: 5% auto;
                padding: 20px;
                border-radius: 10px;
                width: 80%;
                max-width: 800px;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
                position: relative;
            }

            .flashcard-modal-close {
                position: absolute;
                top: 10px;
                right: 10px;
                font-size: 24px;
                cursor: pointer;
                color: var(--text-secondary);
            }

            .flashcard-modal-close:hover {
                color: var(--text-primary);
            }

            .flashcard-modal-header {
                margin-bottom: 20px;
                padding-bottom: 10px;
                border-bottom: 1px solid var(--border-color);
            }

            .flashcard-modal-title {
                font-size: 1.5rem;
                margin: 0;
            }

            .flashcard-modal-body {
                max-height: 70vh;
                overflow-y: auto;
            }

            body.light-theme .flashcard-modal-content {
                background-color: #ffffff;
                color: #333333;
            }
        `;

        document.head.appendChild(style);
    }

    /**
     * Open a flashcard deck in a modal
     * @param {string} deckId - The ID of the deck to open
     */
    async openFlashcardDeck(deckId) {
        try {
            // Create modal if it doesn't exist
            let modal = document.getElementById('flashcardModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'flashcardModal';
                modal.className = 'flashcard-modal';
                modal.innerHTML = `
                    <div class="flashcard-modal-content">
                        <span class="flashcard-modal-close">&times;</span>
                        <div class="flashcard-modal-header">
                            <h3 class="flashcard-modal-title">Loading Flashcards...</h3>
                        </div>
                        <div class="flashcard-modal-body">
                            <div class="text-center py-4">
                                <div class="spinner-border text-primary" role="status"></div>
                                <div class="mt-2">Loading flashcards...</div>
                            </div>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);

                // Add close handler
                const closeBtn = modal.querySelector('.flashcard-modal-close');
                closeBtn.addEventListener('click', () => {
                    modal.style.display = 'none';
                });

                // Close when clicking outside
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        modal.style.display = 'none';
                    }
                });
            }

            // Show the modal
            modal.style.display = 'block';

            // Load the deck details
            await this.loadDeckDetails(deckId, modal);

        } catch (error) {
            console.error('Error opening flashcard deck:', error);
        }
    }

    /**
     * Load deck details and display in modal
     * @param {string} deckId - The ID of the deck to load
     * @param {HTMLElement} modal - The modal element
     */
    async loadDeckDetails(deckId, modal) {
        try {
            // Import Firebase modules
            const { getFirestore, doc, getDoc, collection, getDocs, query, orderBy } = await import('firebase/firestore');

            // Get Firebase config from localStorage
            const firebaseConfig = JSON.parse(localStorage.getItem('firebaseConfig'));

            // Initialize Firebase if needed
            if (!window.firebase) {
                const { initializeApp } = await import('firebase/app');
                window.firebase = initializeApp(firebaseConfig);
            }

            const db = getFirestore();

            // Get current user
            const userJson = localStorage.getItem('user');
            if (!userJson) {
                throw new Error('User not authenticated');
            }

            const user = JSON.parse(userJson);

            // Get deck details
            const deckRef = doc(db, `users/${user.uid}/flashcardDecks/${deckId}`);
            const deckDoc = await getDoc(deckRef);

            if (!deckDoc.exists()) {
                throw new Error('Deck not found');
            }

            const deck = deckDoc.data();

            // Update modal title
            const title = modal.querySelector('.flashcard-modal-title');
            title.textContent = deck.title;

            // Get cards for this deck
            const cardsRef = collection(db, `users/${user.uid}/flashcardDecks/${deckId}/cards`);
            const q = query(cardsRef, orderBy('createdAt', 'desc'));
            const querySnapshot = await getDocs(q);

            const modalBody = modal.querySelector('.flashcard-modal-body');

            if (querySnapshot.empty) {
                modalBody.innerHTML = `
                    <div class="text-center py-4">
                        <div class="alert alert-info">
                            <i class="bi bi-info-circle me-2"></i>
                            No flashcards in this deck yet.
                        </div>
                        <a href="flashcards.html" class="btn btn-primary mt-3" target="_blank">
                            <i class="bi bi-plus-lg"></i> Add Flashcards
                        </a>
                    </div>
                `;
                return;
            }

            // Prepare cards for study
            const cards = [];
            querySnapshot.forEach(doc => {
                const card = doc.data();
                card.id = doc.id;
                cards.push(card);
            });

            // Filter cards that are due for review
            const dueCards = cards.filter(card => {
                if (!card.sm2 || !card.sm2.nextReview) return true;
                const now = new Date();
                const nextReview = new Date(card.sm2.nextReview);
                return now >= nextReview;
            });

            // Display study interface
            modalBody.innerHTML = `
                <div class="mb-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <div>
                            <span class="badge bg-primary me-2">${cards.length} cards</span>
                            <span class="badge bg-info">${dueCards.length} due</span>
                        </div>
                        <a href="flashcards.html" class="btn btn-sm btn-outline-primary" target="_blank">
                            <i class="bi bi-pencil"></i> Edit Deck
                        </a>
                    </div>

                    ${dueCards.length > 0 ? `
                        <div class="flashcard-container">
                            <div class="flashcard" id="currentFlashcard">
                                <div class="flashcard-inner">
                                    <div class="flashcard-front">
                                        <div class="flashcard-content" id="questionContent">
                                            ${dueCards[0].question}
                                        </div>
                                    </div>
                                    <div class="flashcard-back">
                                        <div class="flashcard-content" id="answerContent">
                                            ${dueCards[0].answer}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="text-center mt-4" id="flipCardPrompt">
                            <button class="btn btn-outline-primary" id="flipCardBtn">
                                <i class="bi bi-arrow-repeat"></i> Flip Card
                            </button>
                        </div>

                        <div class="rating-container mt-4" id="ratingContainer" style="display: none;">
                            <p class="text-center mb-2">How well did you know this?</p>
                            <div class="d-flex justify-content-center">
                                <button class="btn btn-outline-danger mx-1 rating-btn" data-rating="1">
                                    <i class="bi bi-emoji-frown"></i> Not at all
                                </button>
                                <button class="btn btn-outline-warning mx-1 rating-btn" data-rating="2">
                                    <i class="bi bi-emoji-neutral"></i> Barely
                                </button>
                                <button class="btn btn-outline-info mx-1 rating-btn" data-rating="3">
                                    <i class="bi bi-emoji-smile"></i> Somewhat
                                </button>
                                <button class="btn btn-outline-success mx-1 rating-btn" data-rating="4">
                                    <i class="bi bi-emoji-laughing"></i> Well
                                </button>
                                <button class="btn btn-outline-primary mx-1 rating-btn" data-rating="5">
                                    <i class="bi bi-emoji-sunglasses"></i> Perfectly
                                </button>
                            </div>
                        </div>
                    ` : `
                        <div class="alert alert-success">
                            <i class="bi bi-check-circle me-2"></i>
                            All cards in this deck are up to date! No cards due for review.
                        </div>
                    `}
                </div>
            `;

            // Add event listeners for flashcard study
            if (dueCards.length > 0) {
                // Set up current study session
                window.currentStudySession = {
                    deckId: deckId,
                    cards: dueCards,
                    currentIndex: 0,
                    totalCards: dueCards.length
                };

                // Add flip card handler
                const flipCardBtn = modalBody.querySelector('#flipCardBtn');
                flipCardBtn.addEventListener('click', () => {
                    const flashcard = modalBody.querySelector('#currentFlashcard');
                    flashcard.classList.toggle('flipped');

                    // If card is flipped to show answer, display rating options
                    if (flashcard.classList.contains('flipped')) {
                        modalBody.querySelector('#flipCardPrompt').style.display = 'none';
                        modalBody.querySelector('#ratingContainer').style.display = 'block';
                    } else {
                        modalBody.querySelector('#flipCardPrompt').style.display = 'block';
                        modalBody.querySelector('#ratingContainer').style.display = 'none';
                    }
                });

                // Add rating handlers
                const ratingBtns = modalBody.querySelectorAll('.rating-btn');
                ratingBtns.forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const rating = parseInt(btn.dataset.rating);
                        await this.rateCard(rating, deckId, modal);
                    });
                });
            }

        } catch (error) {
            console.error('Error loading deck details:', error);

            const modalBody = modal.querySelector('.flashcard-modal-body');
            modalBody.innerHTML = `
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle me-2"></i>
                    Error loading flashcards: ${error.message}
                </div>
                <div class="text-center mt-3">
                    <a href="flashcards.html" class="btn btn-primary" target="_blank">
                        Open Flashcards Page
                    </a>
                </div>
            `;
        }
    }

    /**
     * Rate a flashcard and move to the next one
     * @param {number} rating - The rating from 1-5
     * @param {string} deckId - The ID of the deck
     * @param {HTMLElement} modal - The modal element
     */
    async rateCard(rating, deckId, modal) {
        try {
            const session = window.currentStudySession;
            if (!session) return;

            const card = session.cards[session.currentIndex];

            // Import Firebase modules
            const { getFirestore, doc, updateDoc } = await import('firebase/firestore');

            // Get current user
            const userJson = localStorage.getItem('user');
            if (!userJson) {
                throw new Error('User not authenticated');
            }

            const user = JSON.parse(userJson);
            const db = getFirestore();

            // Process the card with SM2 algorithm
            const updatedCard = this.processCard(card, rating);

            // Update the card in Firestore
            const cardRef = doc(db, `users/${user.uid}/flashcardDecks/${deckId}/cards/${card.id}`);
            await updateDoc(cardRef, {
                sm2: updatedCard.sm2,
                lastReviewed: updatedCard.lastReviewed
            });

            // Move to the next card
            session.currentIndex++;

            // Check if we've reached the end of the session
            if (session.currentIndex >= session.cards.length) {
                // Show completion message
                const modalBody = modal.querySelector('.flashcard-modal-body');
                modalBody.innerHTML = `
                    <div class="text-center py-4">
                        <div class="alert alert-success">
                            <i class="bi bi-check-circle me-2"></i>
                            Study session completed!
                        </div>
                        <a href="flashcards.html" class="btn btn-primary mt-3" target="_blank">
                            <i class="bi bi-card-text"></i> Go to Flashcards
                        </a>
                    </div>
                `;

                // Clear the current study session
                window.currentStudySession = null;
            } else {
                // Display the next card
                this.displayNextCard(modal);
            }

        } catch (error) {
            console.error('Error rating card:', error);
            alert('Failed to save your rating. Please try again.');
        }
    }

    /**
     * Display the next card in the study session
     * @param {HTMLElement} modal - The modal element
     */
    displayNextCard(modal) {
        const session = window.currentStudySession;
        if (!session) return;

        const card = session.cards[session.currentIndex];

        // Update question and answer content
        const questionContent = modal.querySelector('#questionContent');
        const answerContent = modal.querySelector('#answerContent');

        questionContent.innerHTML = card.question;
        answerContent.innerHTML = card.answer;

        // Reset card flip state
        const flashcard = modal.querySelector('#currentFlashcard');
        flashcard.classList.remove('flipped');

        // Show flip button, hide rating
        modal.querySelector('#flipCardPrompt').style.display = 'block';
        modal.querySelector('#ratingContainer').style.display = 'none';
    }

    /**
     * Process a card with the SM-2 algorithm
     * @param {Object} card - The flashcard object
     * @param {Number} quality - Rating from 1-5
     * @returns {Object} Updated card metrics
     */
    processCard(card, quality) {
        // Initialize card metrics if they don't exist
        if (!card.sm2) {
            card.sm2 = {
                repetitions: 0,
                easeFactor: 2.5,
                interval: 0,
                nextReview: new Date()
            };
        }

        const sm2 = card.sm2;

        // Convert 1-5 scale to 0-5 scale for SM-2 algorithm
        quality = Math.max(0, quality - 1);

        // Calculate ease factor
        // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        sm2.easeFactor = Math.max(1.3, sm2.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

        // Handle quality < 3 (incorrect response)
        if (quality < 3) {
            sm2.repetitions = 0;
            sm2.interval = 1; // Review again in 1 day
        } else {
            // Handle correct response
            sm2.repetitions++;

            // Calculate interval based on repetitions
            if (sm2.repetitions === 1) {
                sm2.interval = 1; // First correct response: 1 day
            } else if (sm2.repetitions === 2) {
                sm2.interval = 6; // Second correct response: 6 days
            } else {
                // For subsequent correct responses: I(n) = I(n-1) * EF
                sm2.interval = Math.round(sm2.interval * sm2.easeFactor);
            }
        }

        // Calculate next review date
        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + sm2.interval);
        sm2.nextReview = nextReview;

        // Return updated card
        return {
            ...card,
            sm2: sm2,
            lastReviewed: new Date()
        };
    }
}

/**
 * Find a sub-deck for a task based on subject and section
 * @param {string} subjectTag - The subject tag
 * @param {string} section - The task section (Revision, Assignment, etc.)
 * @returns {Promise<string|null>} The ID of the matching sub-deck, or null if none found
 */
async function findSubDeckForTask(subjectTag, section) {
    try {
        if (!subjectTag || !section) return null;

        // Import Firebase modules
        const { initializeApp } = await import('firebase/app');
        const { getFirestore, collection, getDocs, query, where } = await import('firebase/firestore');

        // Get Firebase config from localStorage
        const firebaseConfig = JSON.parse(localStorage.getItem('firebaseConfig'));

        // Initialize Firebase if needed
        if (!window.firebase) {
            window.firebase = initializeApp(firebaseConfig);
        }

        const db = getFirestore();

        // Get current user
        const userJson = localStorage.getItem('user');
        if (!userJson) {
            console.error('User not authenticated');
            return null;
        }

        const user = JSON.parse(userJson);
        const userId = user.uid;

        const decksRef = collection(db, `users/${userId}/flashcardDecks`);

        // First find the main deck for this subject
        const mainDeckQuery = query(decksRef, where('subjectId', '==', subjectTag), where('isMainDeck', '==', true));
        const mainDeckSnapshot = await getDocs(mainDeckQuery);

        if (mainDeckSnapshot.empty) {
            console.log(`No main deck found for subject: ${subjectTag}`);
            return null;
        }

        const mainDeckId = mainDeckSnapshot.docs[0].id;

        // Now find the sub-deck for this section
        const subDeckQuery = query(decksRef, where('parentDeckId', '==', mainDeckId), where('category', '==', section));
        const subDeckSnapshot = await getDocs(subDeckQuery);

        if (subDeckSnapshot.empty) {
            console.log(`No sub-deck found for subject: ${subjectTag}, section: ${section}`);
            return null;
        }

        return subDeckSnapshot.docs[0].id;
    } catch (error) {
        console.error('Error finding sub-deck for task:', error);
        return null;
    }
}

/**
 * Connect a task to a flashcard deck
 * @param {string} taskId - The ID of the task
 * @param {string} deckId - The ID of the flashcard deck
 * @param {Object} taskData - Additional task data to store
 */
function connectTaskToFlashcardDeck(taskId, deckId, taskData = {}) {
    if (!taskId || !deckId) return;

    // Load existing connections
    let connections = {};
    try {
        const connectionsJson = localStorage.getItem('taskFlashcardConnections');
        if (connectionsJson) {
            connections = JSON.parse(connectionsJson);
        }
    } catch (error) {
        console.error('Error loading task-flashcard connections:', error);
    }

    // Add the new connection
    connections[taskId] = {
        deckId: deckId,
        taskData: taskData,
        connectedAt: new Date().toISOString()
    };

    // Save connections
    try {
        localStorage.setItem('taskFlashcardConnections', JSON.stringify(connections));
        console.log('Saved task-flashcard connection for task:', taskId);

        // Dispatch an event to notify other components
        window.dispatchEvent(new CustomEvent('taskFlashcardConnectionsUpdated', {
            detail: { connections: connections }
        }));
    } catch (error) {
        console.error('Error saving task-flashcard connections:', error);
    }
}

// Create and export the integration
const flashcardTaskIntegration = new FlashcardTaskIntegration();
export default flashcardTaskIntegration;
export { findSubDeckForTask, connectTaskToFlashcardDeck };
