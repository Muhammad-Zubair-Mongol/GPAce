/**
 * Workspace Flashcard Integration
 * Integrates flashcards with task attachments in workspace.html
 */

class WorkspaceFlashcardIntegration {
    constructor() {
        this.initialized = false;
        this.currentTaskId = null;
        this.connections = {};
        this.db = null;
        this.currentUser = null;
    }

    /**
     * Initialize the integration
     * @param {Object} workspaceAttachments - The WorkspaceAttachments instance
     */
    async init(workspaceAttachments) {
        if (this.initialized) return;

        console.log('Initializing workspace flashcard integration');

        // Store reference to workspace attachments
        this.workspaceAttachments = workspaceAttachments;

        // Load connections from localStorage
        this.loadConnections();

        // Initialize Firebase if available
        await this.initializeFirebase();

        // Mark as initialized
        this.initialized = true;
    }

    /**
     * Initialize Firebase if available
     */
    async initializeFirebase() {
        try {
            // Check if Firebase is available from parent window
            if (window.parent.firebase) {
                // Get Firebase modules from parent window
                const { getFirestore, collection, query, where, getDocs, doc, getDoc } = await import('firebase/firestore');
                
                // Get auth from parent window
                this.currentUser = window.parent.firebase.auth().currentUser;
                
                // Initialize Firestore
                this.db = getFirestore(window.parent.firebase.app());
                
                console.log('Firebase initialized for workspace flashcard integration');
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error initializing Firebase for workspace flashcard integration:', error);
            return false;
        }
    }

    /**
     * Load task-flashcard connections from localStorage
     */
    loadConnections() {
        try {
            const connectionsJson = localStorage.getItem('taskFlashcardConnections');
            if (connectionsJson) {
                this.connections = JSON.parse(connectionsJson);
                console.log('Loaded task-flashcard connections:', Object.keys(this.connections).length);
            }
        } catch (error) {
            console.error('Error loading task-flashcard connections:', error);
            this.connections = {};
        }
    }

    /**
     * Check if a task has associated flashcards
     * @param {string} taskId - The task ID to check
     * @returns {boolean} - Whether the task has flashcards
     */
    hasFlashcards(taskId) {
        return !!this.connections[taskId];
    }

    /**
     * Get flashcard deck for a task
     * @param {string} taskId - The task ID
     * @returns {Promise<Object>} - The flashcard deck data
     */
    async getFlashcardDeck(taskId) {
        const connection = this.connections[taskId];
        if (!connection) return null;

        try {
            if (this.db && this.currentUser) {
                const { doc, getDoc } = await import('firebase/firestore');
                
                // Get deck from Firestore
                const deckRef = doc(this.db, `users/${this.currentUser.uid}/flashcardDecks/${connection.deckId}`);
                const deckDoc = await getDoc(deckRef);
                
                if (deckDoc.exists()) {
                    return {
                        id: deckDoc.id,
                        ...deckDoc.data()
                    };
                }
            }
            
            // Fallback to localStorage
            const decks = JSON.parse(localStorage.getItem('flashcardDecks') || '[]');
            return decks.find(deck => deck.id === connection.deckId);
        } catch (error) {
            console.error('Error getting flashcard deck:', error);
            return null;
        }
    }

    /**
     * Get cards for a flashcard deck
     * @param {string} deckId - The deck ID
     * @returns {Promise<Array>} - The flashcards
     */
    async getFlashcards(deckId) {
        try {
            if (this.db && this.currentUser) {
                const { collection, query, getDocs, orderBy } = await import('firebase/firestore');
                
                // Get cards from Firestore
                const cardsRef = collection(this.db, `users/${this.currentUser.uid}/flashcardDecks/${deckId}/cards`);
                const q = query(cardsRef, orderBy('createdAt', 'desc'));
                const querySnapshot = await getDocs(q);
                
                const cards = [];
                querySnapshot.forEach(doc => {
                    cards.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
                
                return cards;
            }
            
            // Fallback to localStorage
            const cards = JSON.parse(localStorage.getItem(`flashcards-${deckId}`) || '[]');
            return cards;
        } catch (error) {
            console.error('Error getting flashcards:', error);
            return [];
        }
    }

    /**
     * Render flashcards for a task in the workspace attachments container
     * @param {string} taskId - The task ID
     * @param {HTMLElement} container - The container to render flashcards in
     */
    async renderFlashcards(taskId, container) {
        if (!this.hasFlashcards(taskId)) {
            return false;
        }

        try {
            // Get the deck
            const deck = await this.getFlashcardDeck(taskId);
            if (!deck) {
                console.log(`No flashcard deck found for task: ${taskId}`);
                return false;
            }

            // Get the cards
            const cards = await this.getFlashcards(deck.id);
            if (!cards || cards.length === 0) {
                console.log(`No flashcards found for deck: ${deck.id}`);
                return false;
            }

            // Create flashcard section
            const flashcardSection = document.createElement('div');
            flashcardSection.className = 'flashcard-attachment-section';
            flashcardSection.innerHTML = `
                <div class="flashcard-attachment-header">
                    <h4>Flashcards: ${deck.title}</h4>
                    <div class="flashcard-attachment-actions">
                        <button class="flashcard-study-btn">
                            <i class="bi bi-lightning"></i> Study Now
                        </button>
                        <button class="flashcard-view-all-btn">
                            <i class="bi bi-arrow-right"></i> View All
                        </button>
                    </div>
                </div>
                <div class="flashcard-preview-container"></div>
            `;

            // Add to container
            container.appendChild(flashcardSection);

            // Get the preview container
            const previewContainer = flashcardSection.querySelector('.flashcard-preview-container');

            // Show up to 3 cards as preview
            const previewCards = cards.slice(0, 3);
            previewCards.forEach(card => {
                const cardElement = document.createElement('div');
                cardElement.className = 'flashcard-preview';
                cardElement.innerHTML = `
                    <div class="flashcard-preview-inner">
                        <div class="flashcard-preview-front">
                            <div class="flashcard-preview-content">${card.question}</div>
                        </div>
                        <div class="flashcard-preview-back">
                            <div class="flashcard-preview-content">${card.answer}</div>
                        </div>
                    </div>
                `;

                // Add click handler to flip card
                cardElement.addEventListener('click', () => {
                    cardElement.classList.toggle('flipped');
                });

                previewContainer.appendChild(cardElement);
            });

            // Add event listeners for buttons
            const studyBtn = flashcardSection.querySelector('.flashcard-study-btn');
            studyBtn.addEventListener('click', () => {
                this.openStudyMode(deck.id);
            });

            const viewAllBtn = flashcardSection.querySelector('.flashcard-view-all-btn');
            viewAllBtn.addEventListener('click', () => {
                this.openFlashcardsPage(deck.id);
            });

            // Add styles if not already added
            this.addFlashcardStyles();

            return true;
        } catch (error) {
            console.error('Error rendering flashcards:', error);
            return false;
        }
    }

    /**
     * Add flashcard styles to the document
     */
    addFlashcardStyles() {
        if (document.getElementById('workspace-flashcard-styles')) return;

        const style = document.createElement('style');
        style.id = 'workspace-flashcard-styles';
        style.textContent = `
            .flashcard-attachment-section {
                margin-top: 20px;
                border-top: 1px solid var(--border-color);
                padding-top: 15px;
            }

            .flashcard-attachment-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
            }

            .flashcard-attachment-header h4 {
                margin: 0;
                font-size: 16px;
                color: var(--text-color);
            }

            .flashcard-attachment-actions {
                display: flex;
                gap: 10px;
            }

            .flashcard-attachment-actions button {
                background-color: var(--background-color);
                border: 1px solid var(--border-color);
                border-radius: 4px;
                padding: 5px 10px;
                font-size: 12px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 5px;
                color: var(--text-color);
            }

            .flashcard-attachment-actions button:hover {
                background-color: var(--hover-bg);
            }

            .flashcard-study-btn {
                background-color: var(--primary-color) !important;
                color: white !important;
            }

            .flashcard-preview-container {
                display: flex;
                gap: 15px;
                overflow-x: auto;
                padding-bottom: 10px;
            }

            .flashcard-preview {
                width: 200px;
                height: 120px;
                perspective: 1000px;
                flex-shrink: 0;
            }

            .flashcard-preview-inner {
                position: relative;
                width: 100%;
                height: 100%;
                text-align: center;
                transition: transform 0.6s;
                transform-style: preserve-3d;
                box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                border-radius: 8px;
                cursor: pointer;
            }

            .flashcard-preview.flipped .flashcard-preview-inner {
                transform: rotateY(180deg);
            }

            .flashcard-preview-front, .flashcard-preview-back {
                position: absolute;
                width: 100%;
                height: 100%;
                -webkit-backface-visibility: hidden;
                backface-visibility: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 15px;
                border-radius: 8px;
                overflow: hidden;
            }

            .flashcard-preview-front {
                background-color: var(--card-bg);
                color: var(--text-color);
                border: 1px solid var(--border-color);
            }

            .flashcard-preview-back {
                background-color: var(--primary-color);
                color: white;
                transform: rotateY(180deg);
            }

            .flashcard-preview-content {
                font-size: 14px;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 4;
                -webkit-box-orient: vertical;
                text-overflow: ellipsis;
            }

            /* Flashcard study modal */
            .flashcard-study-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                z-index: 1000;
                justify-content: center;
                align-items: center;
            }

            .flashcard-study-modal.active {
                display: flex;
            }

            .flashcard-study-content {
                background-color: var(--card-bg);
                border-radius: 8px;
                width: 90%;
                max-width: 600px;
                max-height: 90vh;
                overflow-y: auto;
                position: relative;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
            }

            .flashcard-study-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 20px;
                border-bottom: 1px solid var(--border-color);
            }

            .flashcard-study-title {
                margin: 0;
                font-size: 18px;
                color: var(--text-color);
            }

            .flashcard-study-close {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: var(--text-color);
            }

            .flashcard-study-body {
                padding: 20px;
            }

            .flashcard-study-footer {
                display: flex;
                justify-content: space-between;
                padding: 15px 20px;
                border-top: 1px solid var(--border-color);
            }
        `;

        document.head.appendChild(style);
    }

    /**
     * Open study mode for a deck
     * @param {string} deckId - The deck ID
     */
    async openStudyMode(deckId) {
        try {
            // Get the deck
            const deck = await this.getDeckById(deckId);
            if (!deck) {
                console.error(`Deck not found: ${deckId}`);
                return;
            }

            // Get due cards
            const cards = await this.getFlashcards(deckId);
            const dueCards = this.filterDueCards(cards);

            if (dueCards.length === 0) {
                showToast('No cards are due for review in this deck', 'info');
                return;
            }

            // Create modal if it doesn't exist
            let modal = document.getElementById('flashcardStudyModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'flashcardStudyModal';
                modal.className = 'flashcard-study-modal';
                modal.innerHTML = `
                    <div class="flashcard-study-content">
                        <div class="flashcard-study-header">
                            <h3 class="flashcard-study-title">Study Flashcards</h3>
                            <button class="flashcard-study-close">&times;</button>
                        </div>
                        <div class="flashcard-study-body">
                            <div class="flashcard-container">
                                <div class="flashcard" id="currentFlashcard">
                                    <div class="flashcard-inner">
                                        <div class="flashcard-front">
                                            <div class="flashcard-content" id="questionContent"></div>
                                        </div>
                                        <div class="flashcard-back">
                                            <div class="flashcard-content" id="answerContent"></div>
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
                                <p class="text-center">How well did you know this?</p>
                                <div class="rating-buttons">
                                    <button class="rating-btn" data-rating="1">Again</button>
                                    <button class="rating-btn" data-rating="2">Hard</button>
                                    <button class="rating-btn" data-rating="3">Good</button>
                                    <button class="rating-btn" data-rating="4">Easy</button>
                                    <button class="rating-btn" data-rating="5">Perfect</button>
                                </div>
                            </div>
                        </div>
                        <div class="flashcard-study-footer">
                            <div class="progress-counter">
                                Card <span id="currentCardNumber">1</span> of <span id="totalCards">0</span>
                            </div>
                            <button class="btn btn-secondary" id="closeStudyBtn">Close</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);

                // Add event listeners
                modal.querySelector('.flashcard-study-close').addEventListener('click', () => {
                    modal.classList.remove('active');
                });

                modal.querySelector('#closeStudyBtn').addEventListener('click', () => {
                    modal.classList.remove('active');
                });

                modal.querySelector('#flipCardBtn').addEventListener('click', () => {
                    this.flipCard(modal);
                });

                // Add rating button event listeners
                modal.querySelectorAll('.rating-btn').forEach(button => {
                    button.addEventListener('click', () => {
                        const rating = parseInt(button.dataset.rating);
                        this.rateCard(rating, modal);
                    });
                });
            }

            // Update modal title
            modal.querySelector('.flashcard-study-title').textContent = `Study: ${deck.title}`;

            // Store the study session in a global variable
            window.currentStudySession = {
                deckId: deckId,
                cards: this.shuffleArray(dueCards),
                currentIndex: 0,
                totalCards: dueCards.length
            };

            // Update total cards
            modal.querySelector('#totalCards').textContent = dueCards.length;

            // Display the first card
            this.displayCurrentCard(modal);

            // Show the modal
            modal.classList.add('active');
        } catch (error) {
            console.error('Error opening study mode:', error);
            showToast('Error opening study mode', 'error');
        }
    }

    /**
     * Get a deck by ID
     * @param {string} deckId - The deck ID
     * @returns {Promise<Object>} - The deck
     */
    async getDeckById(deckId) {
        try {
            if (this.db && this.currentUser) {
                const { doc, getDoc } = await import('firebase/firestore');
                
                // Get deck from Firestore
                const deckRef = doc(this.db, `users/${this.currentUser.uid}/flashcardDecks/${deckId}`);
                const deckDoc = await getDoc(deckRef);
                
                if (deckDoc.exists()) {
                    return {
                        id: deckDoc.id,
                        ...deckDoc.data()
                    };
                }
            }
            
            // Fallback to localStorage
            const decks = JSON.parse(localStorage.getItem('flashcardDecks') || '[]');
            return decks.find(deck => deck.id === deckId);
        } catch (error) {
            console.error('Error getting deck by ID:', error);
            return null;
        }
    }

    /**
     * Filter cards that are due for review
     * @param {Array} cards - The cards to filter
     * @returns {Array} - The due cards
     */
    filterDueCards(cards) {
        // If SM2 is available, use it to filter due cards
        if (window.SM2) {
            return cards.filter(card => window.SM2.isDue(card));
        }
        
        // Otherwise, return all cards
        return cards;
    }

    /**
     * Shuffle an array using Fisher-Yates algorithm
     * @param {Array} array - The array to shuffle
     * @returns {Array} - The shuffled array
     */
    shuffleArray(array) {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    }

    /**
     * Display the current card in study mode
     * @param {HTMLElement} modal - The modal element
     */
    displayCurrentCard(modal) {
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

        // Update current card number
        modal.querySelector('#currentCardNumber').textContent = session.currentIndex + 1;
    }

    /**
     * Flip the current card in study mode
     * @param {HTMLElement} modal - The modal element
     */
    flipCard(modal) {
        const flashcard = modal.querySelector('#currentFlashcard');
        flashcard.classList.toggle('flipped');

        // If card is flipped to show answer, display rating options
        if (flashcard.classList.contains('flipped')) {
            modal.querySelector('#flipCardPrompt').style.display = 'none';
            modal.querySelector('#ratingContainer').style.display = 'block';
        } else {
            modal.querySelector('#flipCardPrompt').style.display = 'block';
            modal.querySelector('#ratingContainer').style.display = 'none';
        }
    }

    /**
     * Rate a card in study mode
     * @param {number} rating - The rating (1-5)
     * @param {HTMLElement} modal - The modal element
     */
    async rateCard(rating, modal) {
        try {
            const session = window.currentStudySession;
            if (!session) return;

            const card = session.cards[session.currentIndex];

            // Process the card with SM2 algorithm if available
            if (window.SM2 && window.SM2.processCard) {
                const updatedCard = window.SM2.processCard(card, rating);

                // Update the card in Firestore if available
                if (this.db && this.currentUser) {
                    const { doc, updateDoc } = await import('firebase/firestore');
                    
                    const cardRef = doc(this.db, `users/${this.currentUser.uid}/flashcardDecks/${session.deckId}/cards/${card.id}`);
                    await updateDoc(cardRef, {
                        sm2: updatedCard.sm2,
                        lastReviewed: updatedCard.lastReviewed
                    });
                }
            }

            // Move to the next card
            session.currentIndex++;

            // If we've gone through all cards, show completion message
            if (session.currentIndex >= session.totalCards) {
                showToast('Study session complete!', 'success');
                modal.classList.remove('active');
                return;
            }

            // Display the next card
            this.displayCurrentCard(modal);
        } catch (error) {
            console.error('Error rating card:', error);
            showToast('Error saving your rating', 'error');
        }
    }

    /**
     * Open the flashcards page for a deck
     * @param {string} deckId - The deck ID
     */
    openFlashcardsPage(deckId) {
        window.open(`flashcards.html?deckId=${deckId}`, '_blank');
    }
}

// Create and export the integration
const workspaceFlashcardIntegration = new WorkspaceFlashcardIntegration();
export default workspaceFlashcardIntegration;
