/**
 * Flashcards Module for GPAce
 * Implements a spaced repetition flashcard system using the SM-2 algorithm
 */

// Firebase imports
let db, auth, currentUser;

// Global variables for subject tracking
let subjectsWithDecks = [];
let subjectsWithSubDecks = {};

// Define the standard categories for sub-decks
const SUBDECK_CATEGORIES = ['Revision', 'Assignment', 'Quizzes', 'Mid Term / OHT', 'Finals'];

// Map to track task-to-flashcard connections
let taskFlashcardConnections = {};

// Initialize Firebase when the page loads
document.addEventListener('DOMContentLoaded', async function() {
    try {
        // Import Firebase modules
        const { initializeApp } = await import('firebase/app');
        const { getFirestore, collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, query, where, orderBy } = await import('firebase/firestore');
        const { getAuth, onAuthStateChanged } = await import('firebase/auth');

        // Initialize Firebase with config from localStorage
        const firebaseConfig = JSON.parse(localStorage.getItem('firebaseConfig'));
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // Check authentication state
        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                console.log('User is signed in:', user.uid);
                initializeFlashcards();
            } else {
                console.log('No user is signed in');
                // Redirect to login or show login prompt
                showLoginPrompt();
            }
        });

        // Set up event listeners
        setupEventListeners();

    } catch (error) {
        console.error('Error initializing Firebase:', error);
        showErrorMessage('Failed to initialize the application. Please refresh the page and try again.');
    }
});

/**
 * Initialize the flashcards system
 */
async function initializeFlashcards() {
    try {
        // Load subjects for deck creation
        await loadSubjects();

        // Check for existing subjects and create decks if needed
        await createDecksForExistingSubjects();

        // Load existing decks
        await loadDecks();

        // Load task-flashcard connections
        loadTaskFlashcardConnections();

        // Auto-connect tasks to flashcard decks
        await autoConnectTasksToFlashcards();

        // Set up storage event listener to detect subject changes
        setupSubjectChangeListener();

    } catch (error) {
        console.error('Error initializing flashcards:', error);
        showErrorMessage('Failed to load flashcard data. Please try again later.');
    }
}

/**
 * Load subjects from localStorage or Firestore for deck creation
 */
async function loadSubjects() {
    try {
        const { collection, getDocs } = await import('firebase/firestore');

        const subjectsSelect = document.getElementById('deckSubject');
        if (subjectsSelect) {
            subjectsSelect.innerHTML = '<option value="">Select a subject</option>';
        }

        // First try to get subjects from localStorage
        const storedSubjects = localStorage.getItem('academicSubjects');

        if (storedSubjects) {
            const subjects = JSON.parse(storedSubjects);

            // Add subjects to select dropdown if it exists
            if (subjectsSelect) {
                subjects.forEach(subject => {
                    const option = document.createElement('option');
                    option.value = subject.tag; // Use tag as the value
                    option.textContent = subject.name;
                    subjectsSelect.appendChild(option);
                });
            }

            return subjects;
        }

        // If not in localStorage, try to get from academicSemesters
        const allSemestersJson = localStorage.getItem('academicSemesters');
        if (allSemestersJson) {
            const allSemesters = JSON.parse(allSemestersJson);
            const currentSemester = localStorage.getItem('currentAcademicSemester') || 'default';
            const semesterData = allSemesters[currentSemester];

            if (semesterData && semesterData.subjects && semesterData.subjects.length > 0) {
                const subjects = semesterData.subjects;

                // Add subjects to select dropdown if it exists
                if (subjectsSelect) {
                    subjects.forEach(subject => {
                        const option = document.createElement('option');
                        option.value = subject.tag; // Use tag as the value
                        option.textContent = subject.name;
                        subjectsSelect.appendChild(option);
                    });
                }

                return subjects;
            }
        }

        // If not in localStorage, fetch from Firestore
        if (!currentUser) {
            console.log('No user is signed in');
            return [];
        }

        const userId = currentUser.uid;
        const subjectsRef = collection(db, `users/${userId}/subjects`);
        const querySnapshot = await getDocs(subjectsRef);

        if (querySnapshot.empty) {
            console.log('No subjects found in Firestore');
            return [];
        }

        const subjects = [];
        querySnapshot.forEach(doc => {
            const subject = doc.data();
            subjects.push(subject);

            // Add to select dropdown if it exists
            if (subjectsSelect) {
                const option = document.createElement('option');
                option.value = subject.tag || doc.id;
                option.textContent = subject.name;
                subjectsSelect.appendChild(option);
            }
        });

        return subjects;

    } catch (error) {
        console.error('Error loading subjects:', error);
        showErrorMessage('Failed to load subjects. Please try again later.');
        return [];
    }
}

/**
 * Load flashcard decks from Firestore
 */
async function loadDecks() {
    try {
        const { collection, getDocs, query, where, orderBy } = await import('firebase/firestore');

        const decksList = document.getElementById('decksList');
        const noDecksMessage = document.getElementById('noDecksMessage');

        // Clear existing decks
        decksList.innerHTML = '';

        const userId = currentUser.uid;
        const decksRef = collection(db, `users/${userId}/flashcardDecks`);
        const q = query(decksRef, orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            noDecksMessage.style.display = 'block';
            return;
        }

        noDecksMessage.style.display = 'none';

        // Organize decks by subject and separate main decks from sub-decks
        const mainDecks = [];
        const subDecks = {};

        querySnapshot.forEach(doc => {
            const deck = doc.data();
            deck.id = doc.id;

            if (deck.parentDeckId) {
                // This is a sub-deck
                if (!subDecks[deck.parentDeckId]) {
                    subDecks[deck.parentDeckId] = [];
                }
                subDecks[deck.parentDeckId].push(deck);
            } else {
                // This is a main deck
                mainDecks.push(deck);
            }
        });

        // Group main decks by subject
        const subjectGroups = {};
        mainDecks.forEach(deck => {
            if (!deck.subjectId) return;

            if (!subjectGroups[deck.subjectId]) {
                subjectGroups[deck.subjectId] = [];
            }
            subjectGroups[deck.subjectId].push(deck);
        });

        // Display decks grouped by subject
        for (const subjectId in subjectGroups) {
            const subjectDecks = subjectGroups[subjectId];
            if (subjectDecks.length === 0) continue;

            // Get the first deck to get subject info
            const firstDeck = subjectDecks[0];

            // Create subject header
            const subjectHeader = document.createElement('div');
            subjectHeader.className = 'col-12 mb-3';
            subjectHeader.innerHTML = `
                <h4 class="subject-header">${firstDeck.subjectName}</h4>
                <hr>
            `;
            decksList.appendChild(subjectHeader);

            // Display main decks for this subject
            subjectDecks.forEach(deck => {
                // Calculate due cards
                const dueCards = deck.cardCount ? deck.cardCount : 0;

                // Create deck card
                const deckCard = document.createElement('div');
                deckCard.className = 'col-md-4 mb-4';

                // Check if this deck has sub-decks
                const hasSubDecks = subDecks[deck.id] && subDecks[deck.id].length > 0;

                deckCard.innerHTML = `
                    <div class="card deck-card ${hasSubDecks ? 'has-sub-decks' : ''}" data-deck-id="${deck.id}">
                        <div class="card-body">
                            <h5 class="card-title">${deck.title}</h5>
                            <p class="card-text">${deck.description || 'No description'}</p>
                            <div class="mt-2">
                                <span class="badge bg-primary">${deck.cardCount || 0} cards</span>
                                <span class="badge bg-info">${dueCards} due</span>
                                ${hasSubDecks ? `<span class="badge bg-secondary">${subDecks[deck.id].length} sub-decks</span>` : ''}
                            </div>
                        </div>
                        <div class="card-footer">
                            <small class="text-muted">Subject: ${deck.subjectName}</small>
                        </div>
                    </div>
                `;

                // Add click event to open deck details
                deckCard.querySelector('.deck-card').addEventListener('click', () => {
                    openDeckDetails(deck.id);
                });

                decksList.appendChild(deckCard);

                // If this deck has sub-decks, display them
                if (hasSubDecks) {
                    const subDecksContainer = document.createElement('div');
                    subDecksContainer.className = 'col-12 mb-4 sub-decks-container';
                    subDecksContainer.innerHTML = `
                        <div class="sub-decks-header">Sub-decks for ${deck.title}</div>
                        <div class="row sub-decks-row">
                            ${subDecks[deck.id].map(subDeck => `
                                <div class="col-md-3 mb-3">
                                    <div class="card sub-deck-card" data-deck-id="${subDeck.id}">
                                        <div class="card-body">
                                            <h6 class="card-title">${subDeck.category}</h6>
                                            <div class="mt-2">
                                                <span class="badge bg-primary">${subDeck.cardCount || 0} cards</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `;

                    decksList.appendChild(subDecksContainer);

                    // Add click events to sub-deck cards
                    const subDeckCards = subDecksContainer.querySelectorAll('.sub-deck-card');
                    subDeckCards.forEach((card, index) => {
                        card.addEventListener('click', () => {
                            const subDeckId = card.getAttribute('data-deck-id');
                            openDeckDetails(subDeckId);
                        });
                    });
                }
            });
        }

    } catch (error) {
        console.error('Error loading decks:', error);
        showErrorMessage('Failed to load flashcard decks. Please try again later.');
    }
}

/**
 * Open deck details modal
 * @param {string} deckId - The ID of the deck to open
 */
async function openDeckDetails(deckId) {
    try {
        const { doc, getDoc, collection, getDocs, query, orderBy, where } = await import('firebase/firestore');

        const userId = currentUser.uid;
        const deckRef = doc(db, `users/${userId}/flashcardDecks/${deckId}`);
        const deckDoc = await getDoc(deckRef);

        if (!deckDoc.exists()) {
            showErrorMessage('Deck not found');
            return;
        }

        const deck = deckDoc.data();
        deck.id = deckId;

        // Set deck details in modal
        document.getElementById('deckDetailTitle').textContent = deck.title;
        document.getElementById('deckDetailSubject').textContent = `Subject: ${deck.subjectName}`;
        document.getElementById('deckDetailDescription').textContent = deck.description || 'No description';
        document.getElementById('cardCount').textContent = `${deck.cardCount || 0} cards`;

        // Set current deck ID for adding cards
        document.getElementById('currentDeckId').value = deckId;

        // Check if this is a sub-deck
        const isSubDeck = deck.parentDeckId ? true : false;

        // If this is a sub-deck, show the category
        if (isSubDeck) {
            document.getElementById('deckDetailTitle').textContent = `${deck.title} (${deck.category})`;
        }

        // Load cards for this deck
        const cardsRef = collection(db, `users/${userId}/flashcardDecks/${deckId}/cards`);
        const q = query(cardsRef, orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);

        const cardsTableBody = document.getElementById('cardsTableBody');
        cardsTableBody.innerHTML = '';

        let dueCount = 0;

        if (querySnapshot.empty) {
            cardsTableBody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center">No cards in this deck yet</td>
                </tr>
            `;
        } else {
            querySnapshot.forEach(doc => {
                const card = doc.data();
                const cardId = doc.id;

                // Check if card is due
                const isDue = SM2.isDue(card);
                if (isDue) dueCount++;

                // Format next review date
                const nextReview = SM2.formatNextReview(card);

                // Create table row
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${truncateText(card.question, 50)}</td>
                    <td>${truncateText(card.answer, 50)}</td>
                    <td>${nextReview}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger delete-card-btn" data-card-id="${cardId}">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                `;

                // Add delete card event listener
                row.querySelector('.delete-card-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteCard(deckId, cardId);
                });

                cardsTableBody.appendChild(row);
            });
        }

        // Update due count
        document.getElementById('dueCount').textContent = `${dueCount} due`;

        // Set up study button
        const studyDeckBtn = document.getElementById('studyDeckBtn');
        studyDeckBtn.onclick = () => {
            // Close details modal and open study modal
            bootstrap.Modal.getInstance(document.getElementById('deckDetailsModal')).hide();
            startStudySession(deckId);
        };

        // Set up delete deck button
        const deleteDeckBtn = document.getElementById('deleteDeckBtn');

        // If this is a sub-deck, show a warning about deleting it
        if (isSubDeck) {
            deleteDeckBtn.textContent = 'Delete Sub-Deck';
            deleteDeckBtn.onclick = () => {
                if (confirm('Are you sure you want to delete this sub-deck? This will delete all cards in this category.')) {
                    deleteDeck(deckId);
                }
            };
        } else {
            deleteDeckBtn.textContent = 'Delete Deck';
            deleteDeckBtn.onclick = () => deleteDeck(deckId);
        }

        // Set up add card button
        const addCardBtn = document.getElementById('addCardBtn');
        addCardBtn.onclick = () => {
            // Close details modal and open add card modal
            bootstrap.Modal.getInstance(document.getElementById('deckDetailsModal')).hide();

            // Clear form
            document.getElementById('cardQuestion').value = '';
            document.getElementById('cardAnswer').value = '';

            // Show add card modal
            new bootstrap.Modal(document.getElementById('addCardModal')).show();
        };

        // Show deck details modal
        new bootstrap.Modal(document.getElementById('deckDetailsModal')).show();

    } catch (error) {
        console.error('Error opening deck details:', error);
        showErrorMessage('Failed to load deck details. Please try again later.');
    }
}

/**
 * Start a study session for a deck
 * @param {string} deckId - The ID of the deck to study
 */
async function startStudySession(deckId) {
    try {
        const { collection, getDocs, query, where, orderBy } = await import('firebase/firestore');

        const userId = currentUser.uid;
        const cardsRef = collection(db, `users/${userId}/flashcardDecks/${deckId}/cards`);
        const querySnapshot = await getDocs(cardsRef);

        if (querySnapshot.empty) {
            showErrorMessage('This deck has no cards to study');
            return;
        }

        // Get all cards and filter due cards
        const allCards = [];
        querySnapshot.forEach(doc => {
            const card = doc.data();
            card.id = doc.id;
            allCards.push(card);
        });

        // Filter cards that are due for review
        const dueCards = allCards.filter(card => SM2.isDue(card));

        if (dueCards.length === 0) {
            showErrorMessage('No cards are due for review in this deck');
            return;
        }

        // Shuffle the cards
        const shuffledCards = shuffleArray(dueCards);

        // Store the study session in a global variable
        window.currentStudySession = {
            deckId: deckId,
            cards: shuffledCards,
            currentIndex: 0,
            totalCards: shuffledCards.length
        };

        // Display the first card
        displayCurrentCard();

        // Update progress counter
        updateProgressCounter();

        // Show the study modal
        new bootstrap.Modal(document.getElementById('studyModal')).show();

    } catch (error) {
        console.error('Error starting study session:', error);
        showErrorMessage('Failed to start study session. Please try again later.');
    }
}

/**
 * Display the current card in the study session
 */
function displayCurrentCard() {
    const session = window.currentStudySession;
    if (!session || session.currentIndex >= session.cards.length) {
        endStudySession();
        return;
    }

    const card = session.cards[session.currentIndex];

    // Update modal title
    document.getElementById('studyModalLabel').textContent = `Study Flashcards (${session.currentIndex + 1}/${session.totalCards})`;

    // Set card content
    document.getElementById('questionContent').innerHTML = formatCardContent(card.question);
    document.getElementById('answerContent').innerHTML = formatCardContent(card.answer);

    // Reset card flip state
    const flashcard = document.getElementById('currentFlashcard');
    flashcard.classList.remove('flipped');

    // Show flip button, hide rating
    document.getElementById('flipCardPrompt').style.display = 'block';
    document.getElementById('ratingContainer').style.display = 'none';

    // Update progress counter
    updateProgressCounter();
}

/**
 * Update the progress counter in the study modal
 */
function updateProgressCounter() {
    const session = window.currentStudySession;
    if (!session) return;

    const progressCounter = document.getElementById('progressCounter');
    progressCounter.textContent = `${session.currentIndex + 1}/${session.totalCards}`;
}

/**
 * Format card content for display
 * @param {string} content - The card content to format
 * @returns {string} Formatted HTML content
 */
function formatCardContent(content) {
    // Convert line breaks to <br> tags
    return content.replace(/\n/g, '<br>');
}

/**
 * Handle card flip in study session
 */
function flipCard() {
    const flashcard = document.getElementById('currentFlashcard');
    flashcard.classList.toggle('flipped');

    // If card is flipped to show answer, display rating options
    if (flashcard.classList.contains('flipped')) {
        document.getElementById('flipCardPrompt').style.display = 'none';
        document.getElementById('ratingContainer').style.display = 'block';
    } else {
        document.getElementById('flipCardPrompt').style.display = 'block';
        document.getElementById('ratingContainer').style.display = 'none';
    }
}

/**
 * Handle card rating in study session
 * @param {number} rating - The rating from 1-5
 */
async function rateCard(rating) {
    try {
        const { doc, updateDoc } = await import('firebase/firestore');

        const session = window.currentStudySession;
        if (!session) return;

        const card = session.cards[session.currentIndex];

        // Process the card with SM2 algorithm
        const updatedCard = SM2.processCard(card, rating);

        // Update the card in Firestore
        const userId = currentUser.uid;
        const cardRef = doc(db, `users/${userId}/flashcardDecks/${session.deckId}/cards/${card.id}`);
        await updateDoc(cardRef, {
            sm2: updatedCard.sm2,
            lastReviewed: updatedCard.lastReviewed
        });

        // Move to the next card
        session.currentIndex++;

        // Check if we've reached the end of the session
        if (session.currentIndex >= session.cards.length) {
            endStudySession();
        } else {
            // Display the next card
            displayCurrentCard();
        }

    } catch (error) {
        console.error('Error rating card:', error);
        showErrorMessage('Failed to save your rating. Please try again.');
    }
}

/**
 * End the current study session
 */
function endStudySession() {
    // Show completion message
    showSuccessMessage('Study session completed!');

    // Close the study modal
    const studyModal = document.getElementById('studyModal');
    const modal = bootstrap.Modal.getInstance(studyModal);
    if (modal) {
        modal.hide();
    }

    // Clear the current study session
    window.currentStudySession = null;

    // Reload decks to update counts
    loadDecks();
}

/**
 * Create a new flashcard deck
 */
async function createDeck() {
    try {
        const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');

        const title = document.getElementById('deckTitle').value.trim();
        const subjectId = document.getElementById('deckSubject').value;
        const description = document.getElementById('deckDescription').value.trim();

        if (!title) {
            showErrorMessage('Please enter a deck title');
            return;
        }

        if (!subjectId) {
            showErrorMessage('Please select a subject');
            return;
        }

        // Get subject name from select element
        const subjectSelect = document.getElementById('deckSubject');
        const subjectName = subjectSelect.options[subjectSelect.selectedIndex].text;

        const userId = currentUser.uid;
        const decksRef = collection(db, `users/${userId}/flashcardDecks`);

        // Create the deck
        const newDeck = {
            title,
            subjectId, // This is now the subject tag
            subjectName,
            description,
            cardCount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            manuallyCreated: true
        };

        await addDoc(decksRef, newDeck);

        // Add to tracking array
        if (!subjectsWithDecks.includes(subjectId)) {
            subjectsWithDecks.push(subjectId);
        }

        // Close the modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('createDeckModal'));
        modal.hide();

        // Show success message
        showSuccessMessage('Deck created successfully!');

        // Reload decks
        loadDecks();

    } catch (error) {
        console.error('Error creating deck:', error);
        showErrorMessage('Failed to create deck. Please try again later.');
    }
}

/**
 * Add a new card to a deck
 */
async function addCard() {
    try {
        const { collection, addDoc, doc, getDoc, updateDoc, serverTimestamp } = await import('firebase/firestore');

        const deckId = document.getElementById('currentDeckId').value;
        const question = document.getElementById('cardQuestion').value.trim();
        const answer = document.getElementById('cardAnswer').value.trim();

        if (!question) {
            showErrorMessage('Please enter a question');
            return;
        }

        if (!answer) {
            showErrorMessage('Please enter an answer');
            return;
        }

        const userId = currentUser.uid;
        const cardsRef = collection(db, `users/${userId}/flashcardDecks/${deckId}/cards`);

        // Create the card
        await addDoc(cardsRef, {
            question,
            answer,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        // Update card count in deck
        const deckRef = doc(db, `users/${userId}/flashcardDecks/${deckId}`);
        const deckDoc = await getDoc(deckRef);

        if (deckDoc.exists()) {
            const deck = deckDoc.data();
            await updateDoc(deckRef, {
                cardCount: (deck.cardCount || 0) + 1,
                updatedAt: serverTimestamp()
            });
        }

        // Close the modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('addCardModal'));
        modal.hide();

        // Show success message
        showSuccessMessage('Card added successfully!');

        // Reopen deck details
        openDeckDetails(deckId);

    } catch (error) {
        console.error('Error adding card:', error);
        showErrorMessage('Failed to add card. Please try again later.');
    }
}

/**
 * Delete a card from a deck
 * @param {string} deckId - The ID of the deck
 * @param {string} cardId - The ID of the card to delete
 */
async function deleteCard(deckId, cardId) {
    try {
        const { doc, deleteDoc, getDoc, updateDoc, serverTimestamp } = await import('firebase/firestore');

        if (!confirm('Are you sure you want to delete this card?')) {
            return;
        }

        const userId = currentUser.uid;
        const cardRef = doc(db, `users/${userId}/flashcardDecks/${deckId}/cards/${cardId}`);

        // Delete the card
        await deleteDoc(cardRef);

        // Update card count in deck
        const deckRef = doc(db, `users/${userId}/flashcardDecks/${deckId}`);
        const deckDoc = await getDoc(deckRef);

        if (deckDoc.exists()) {
            const deck = deckDoc.data();
            await updateDoc(deckRef, {
                cardCount: Math.max(0, (deck.cardCount || 0) - 1),
                updatedAt: serverTimestamp()
            });
        }

        // Show success message
        showSuccessMessage('Card deleted successfully!');

        // Refresh deck details
        openDeckDetails(deckId);

    } catch (error) {
        console.error('Error deleting card:', error);
        showErrorMessage('Failed to delete card. Please try again later.');
    }
}

/**
 * Delete a deck and all its cards
 * @param {string} deckId - The ID of the deck to delete
 */
async function deleteDeck(deckId) {
    try {
        const { doc, getDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp } = await import('firebase/firestore');

        const userId = currentUser.uid;

        // Get the deck to check if it's a main deck or sub-deck
        const deckRef = doc(db, `users/${userId}/flashcardDecks/${deckId}`);
        const deckDoc = await getDoc(deckRef);

        if (!deckDoc.exists()) {
            showErrorMessage('Deck not found');
            return;
        }

        const deck = deckDoc.data();
        const isMainDeck = !deck.parentDeckId;

        // If this is a main deck, check if it has sub-decks
        if (isMainDeck) {
            // Find all sub-decks for this main deck
            const decksRef = collection(db, `users/${userId}/flashcardDecks`);
            const q = query(decksRef, where('parentDeckId', '==', deckId));
            const subDecksSnapshot = await getDocs(q);

            if (!subDecksSnapshot.empty) {
                if (!confirm(`This deck has ${subDecksSnapshot.size} sub-decks. Deleting it will also delete all sub-decks and their cards. Are you sure you want to continue?`)) {
                    return;
                }

                // Delete all sub-decks and their cards
                const subDeckDeletePromises = [];

                subDecksSnapshot.forEach(async (subDeckDoc) => {
                    const subDeckId = subDeckDoc.id;

                    // Delete all cards in the sub-deck
                    const cardsRef = collection(db, `users/${userId}/flashcardDecks/${subDeckId}/cards`);
                    const cardsSnapshot = await getDocs(cardsRef);

                    cardsSnapshot.forEach(cardDoc => {
                        subDeckDeletePromises.push(deleteDoc(cardDoc.ref));
                    });

                    // Delete the sub-deck
                    subDeckDeletePromises.push(deleteDoc(subDeckDoc.ref));
                });

                await Promise.all(subDeckDeletePromises);
            }
        }

        // Delete all cards in the deck
        const cardsRef = collection(db, `users/${userId}/flashcardDecks/${deckId}/cards`);
        const querySnapshot = await getDocs(cardsRef);

        const deletePromises = [];
        querySnapshot.forEach(doc => {
            deletePromises.push(deleteDoc(doc.ref));
        });

        await Promise.all(deletePromises);

        // Delete the deck itself
        await deleteDoc(deckRef);

        // Close the modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('deckDetailsModal'));
        modal.hide();

        // Show success message
        if (isMainDeck) {
            showSuccessMessage('Deck and all sub-decks deleted successfully!');
        } else {
            showSuccessMessage('Sub-deck deleted successfully!');
        }

        // Update tracking arrays
        if (isMainDeck && deck.subjectId) {
            // Remove from subjectsWithDecks
            const index = subjectsWithDecks.indexOf(deck.subjectId);
            if (index !== -1) {
                subjectsWithDecks.splice(index, 1);
            }

            // Remove from subjectsWithSubDecks
            if (subjectsWithSubDecks[deck.subjectId]) {
                delete subjectsWithSubDecks[deck.subjectId];
            }
        }

        // Reload decks
        loadDecks();

    } catch (error) {
        console.error('Error deleting deck:', error);
        showErrorMessage('Failed to delete deck. Please try again later.');
    }
}

/**
 * Set up event listeners for the page
 */
function setupEventListeners() {
    // Create deck button
    document.getElementById('createDeckBtn').addEventListener('click', () => {
        // Clear form
        document.getElementById('deckTitle').value = '';
        document.getElementById('deckDescription').value = '';
        document.getElementById('deckSubject').selectedIndex = 0;

        // Show modal
        new bootstrap.Modal(document.getElementById('createDeckModal')).show();
    });

    // Save deck button
    document.getElementById('saveDeckBtn').addEventListener('click', createDeck);

    // Save card button
    document.getElementById('saveCardBtn').addEventListener('click', addCard);

    // Flip card button
    document.getElementById('flipCardBtn').addEventListener('click', flipCard);

    // Rating buttons
    document.querySelectorAll('.rating-btn').forEach(button => {
        button.addEventListener('click', () => {
            const rating = parseInt(button.dataset.rating);
            rateCard(rating);
        });
    });

    // Handle form submissions
    document.getElementById('createDeckForm').addEventListener('submit', (e) => {
        e.preventDefault();
        createDeck();
    });

    document.getElementById('addCardForm').addEventListener('submit', (e) => {
        e.preventDefault();
        addCard();
    });
}

/**
 * Show a login prompt if user is not authenticated
 */
function showLoginPrompt() {
    const container = document.querySelector('.container');
    container.innerHTML = `
        <div class="row">
            <div class="col-md-6 offset-md-3 text-center mt-5">
                <div class="card">
                    <div class="card-body">
                        <h3 class="card-title">Sign In Required</h3>
                        <p class="card-text">Please sign in to access the flashcards feature.</p>
                        <button class="btn btn-primary" onclick="window.location.href='grind.html'">
                            Go to Grind Mode
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Show an error message to the user
 * @param {string} message - The error message to display
 */
function showErrorMessage(message) {
    // Create toast element
    const toastEl = document.createElement('div');
    toastEl.className = 'toast align-items-center text-white bg-danger border-0';
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');

    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                <i class="bi bi-exclamation-circle me-2"></i>
                ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;

    // Add to container
    const toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        const container = document.createElement('div');
        container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(container);
        container.appendChild(toastEl);
    } else {
        toastContainer.appendChild(toastEl);
    }

    // Initialize and show toast
    const toast = new bootstrap.Toast(toastEl);
    toast.show();

    // Remove after hiding
    toastEl.addEventListener('hidden.bs.toast', () => {
        toastEl.remove();
    });
}

/**
 * Show a success message to the user
 * @param {string} message - The success message to display
 */
function showSuccessMessage(message) {
    // Create toast element
    const toastEl = document.createElement('div');
    toastEl.className = 'toast align-items-center text-white bg-success border-0';
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');

    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                <i class="bi bi-check-circle me-2"></i>
                ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;

    // Add to container
    const toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        const container = document.createElement('div');
        container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(container);
        container.appendChild(toastEl);
    } else {
        toastContainer.appendChild(toastEl);
    }

    // Initialize and show toast
    const toast = new bootstrap.Toast(toastEl);
    toast.show();

    // Remove after hiding
    toastEl.addEventListener('hidden.bs.toast', () => {
        toastEl.remove();
    });
}

/**
 * Truncate text to a specified length
 * @param {string} text - The text to truncate
 * @param {number} maxLength - The maximum length
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

/**
 * Create flashcard decks for existing subjects that don't have decks yet
 */
async function createDecksForExistingSubjects() {
    try {
        const { collection, getDocs, query, where, addDoc, serverTimestamp } = await import('firebase/firestore');

        // Get all subjects
        const subjects = await loadSubjects();
        if (!subjects || subjects.length === 0) {
            console.log('No subjects found to create decks for');
            return;
        }

        // Get all existing decks
        const userId = currentUser.uid;
        const decksRef = collection(db, `users/${userId}/flashcardDecks`);
        const querySnapshot = await getDocs(decksRef);

        // Create a map of subject tags that already have decks
        const existingDeckSubjects = new Set();

        // Track which subjects already have sub-decks
        subjectsWithSubDecks = {};

        querySnapshot.forEach(doc => {
            const deck = doc.data();
            if (deck.subjectId) {
                existingDeckSubjects.add(deck.subjectId);

                // Check if this is a sub-deck
                if (deck.parentDeckId) {
                    if (!subjectsWithSubDecks[deck.parentDeckId]) {
                        subjectsWithSubDecks[deck.parentDeckId] = new Set();
                    }
                    subjectsWithSubDecks[deck.parentDeckId].add(deck.category);
                }
            }
        });

        // Store the subjects that already have decks
        subjectsWithDecks = Array.from(existingDeckSubjects);

        // Create decks for subjects that don't have one yet
        const createPromises = [];
        const createdMainDecks = {}; // To track newly created main decks for sub-deck creation

        for (const subject of subjects) {
            if (!existingDeckSubjects.has(subject.tag)) {
                console.log(`Creating deck for subject: ${subject.name} (${subject.tag})`);

                // Create a new deck for this subject
                const newDeck = {
                    title: `${subject.name} Flashcards`,
                    subjectId: subject.tag,
                    subjectName: subject.name,
                    description: `Study flashcards for ${subject.name}`,
                    cardCount: 0,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    autoCreated: true,
                    isMainDeck: true
                };

                // We need to get the ID of the newly created deck to create sub-decks
                const deckPromise = addDoc(decksRef, newDeck).then(docRef => {
                    createdMainDecks[subject.tag] = docRef.id;
                    return docRef;
                });

                createPromises.push(deckPromise);
                subjectsWithDecks.push(subject.tag);
            }
        }

        // Wait for all main deck creations to complete
        if (createPromises.length > 0) {
            await Promise.all(createPromises);
            console.log(`Created ${createPromises.length} new main flashcard decks for subjects`);
        } else {
            console.log('All subjects already have main flashcard decks');
        }

        // Now create sub-decks for all subjects (both existing and newly created)
        await createSubDecksForSubjects(createdMainDecks);

    } catch (error) {
        console.error('Error creating decks for subjects:', error);
    }
}

/**
 * Create sub-decks for subjects based on standard categories
 * @param {Object} newlyCreatedDecks - Object mapping subject tags to their newly created deck IDs
 */
async function createSubDecksForSubjects(newlyCreatedDecks = {}) {
    try {
        const { collection, getDocs, query, where, addDoc, serverTimestamp } = await import('firebase/firestore');

        const userId = currentUser.uid;
        const decksRef = collection(db, `users/${userId}/flashcardDecks`);

        // Get all existing decks to find main decks and their IDs
        const querySnapshot = await getDocs(decksRef);

        // Map of subject tags to their main deck IDs
        const subjectMainDecks = {};

        // Find all main decks
        querySnapshot.forEach(doc => {
            const deck = doc.data();
            if (deck.subjectId && (deck.isMainDeck || !deck.parentDeckId)) {
                subjectMainDecks[deck.subjectId] = doc.id;
            }
        });

        // Add newly created decks to the map
        Object.assign(subjectMainDecks, newlyCreatedDecks);

        // Create sub-decks for each subject
        const createPromises = [];
        let totalSubDecksToCreate = 0;

        for (const subjectTag in subjectMainDecks) {
            const mainDeckId = subjectMainDecks[subjectTag];

            // Skip if we've already processed this subject's sub-decks
            if (!subjectsWithSubDecks[subjectTag]) {
                subjectsWithSubDecks[subjectTag] = new Set();
            }

            // Get subject name
            const subjects = await loadSubjects();
            const subject = subjects.find(s => s.tag === subjectTag);
            if (!subject) continue;

            // Create sub-decks for each category
            for (const category of SUBDECK_CATEGORIES) {
                // Skip if this category already has a sub-deck
                if (subjectsWithSubDecks[subjectTag].has(category)) {
                    continue;
                }

                console.log(`Creating sub-deck for ${subject.name}: ${category}`);

                // Create the sub-deck
                const newSubDeck = {
                    title: `${subject.name} - ${category}`,
                    subjectId: subjectTag,
                    subjectName: subject.name,
                    description: `${category} flashcards for ${subject.name}`,
                    category: category,
                    parentDeckId: mainDeckId,
                    cardCount: 0,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    autoCreated: true
                };

                createPromises.push(addDoc(decksRef, newSubDeck));
                subjectsWithSubDecks[subjectTag].add(category);
                totalSubDecksToCreate++;
            }
        }

        // Wait for all sub-deck creations to complete
        if (createPromises.length > 0) {
            await Promise.all(createPromises);
            console.log(`Created ${totalSubDecksToCreate} new sub-decks for subjects`);
        } else {
            console.log('All subjects already have all required sub-decks');
        }

    } catch (error) {
        console.error('Error creating sub-decks for subjects:', error);
    }
}

/**
 * Set up a listener for changes to subjects in localStorage
 */
function setupSubjectChangeListener() {
    // Listen for storage events (when subjects are added/changed)
    window.addEventListener('storage', async (event) => {
        if (event.key === 'academicSubjects' || event.key === 'academicSemesters') {
            console.log('Subjects changed in localStorage, checking for new subjects');
            await createDecksForExistingSubjects();
            await loadDecks(); // Reload decks to show the new ones
        }
    });

    // Listen for custom event from academic-details.html
    window.addEventListener('subjectsChanged', async (event) => {
        console.log('Subjects changed event received, creating decks for new subjects');
        await createDecksForExistingSubjects();
        await loadDecks(); // Reload decks to show the new ones
    });

    // Also check periodically for changes (in case the storage event doesn't fire)
    setInterval(async () => {
        const subjects = await loadSubjects();
        if (!subjects) return;

        // Check if there are any new subjects that don't have decks
        let hasNewSubjects = false;
        for (const subject of subjects) {
            if (!subjectsWithDecks.includes(subject.tag)) {
                hasNewSubjects = true;
                break;
            }
        }

        if (hasNewSubjects) {
            console.log('Found new subjects, creating decks');
            await createDecksForExistingSubjects();
            await loadDecks(); // Reload decks to show the new ones
        }
    }, 30000); // Check every 30 seconds
}

/**
 * Load task-flashcard connections from localStorage
 */
function loadTaskFlashcardConnections() {
    try {
        const connections = localStorage.getItem('taskFlashcardConnections');
        if (connections) {
            taskFlashcardConnections = JSON.parse(connections);
            console.log('Loaded task-flashcard connections:', Object.keys(taskFlashcardConnections).length);
        } else {
            console.log('No existing task-flashcard connections found');
            taskFlashcardConnections = {};
        }
    } catch (error) {
        console.error('Error loading task-flashcard connections:', error);
        taskFlashcardConnections = {};
    }
}

/**
 * Save task-flashcard connections to localStorage
 */
function saveTaskFlashcardConnections() {
    try {
        localStorage.setItem('taskFlashcardConnections', JSON.stringify(taskFlashcardConnections));
        console.log('Saved task-flashcard connections');

        // Dispatch an event to notify other components
        window.dispatchEvent(new CustomEvent('taskFlashcardConnectionsUpdated', {
            detail: { connections: taskFlashcardConnections }
        }));
    } catch (error) {
        console.error('Error saving task-flashcard connections:', error);
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

    taskFlashcardConnections[taskId] = {
        deckId: deckId,
        taskData: taskData,
        connectedAt: new Date().toISOString()
    };

    saveTaskFlashcardConnections();
}

/**
 * Get the flashcard deck connected to a task
 * @param {string} taskId - The ID of the task
 * @returns {string|null} The ID of the connected deck, or null if none
 */
function getTaskFlashcardDeck(taskId) {
    if (!taskId || !taskFlashcardConnections[taskId]) return null;
    return taskFlashcardConnections[taskId].deckId;
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

        const { collection, getDocs, query, where } = await import('firebase/firestore');

        if (!currentUser) return null;

        const userId = currentUser.uid;
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
 * Auto-connect tasks to flashcard decks based on subject and section
 * This function scans all tasks and connects them to appropriate flashcard decks
 */
async function autoConnectTasksToFlashcards() {
    try {
        // Get all projects
        const projects = JSON.parse(localStorage.getItem('projects') || '[]');
        let tasksConnected = 0;

        // Process each project's tasks
        for (const project of projects) {
            const tasksKey = `tasks-${project.id}`;
            const tasks = JSON.parse(localStorage.getItem(tasksKey) || '[]');

            // Get subject tag for this project
            const subjectTag = project.subjectTag || project.id;

            // Process each task
            for (const task of tasks) {
                // Skip completed tasks
                if (task.completed) continue;

                // Skip tasks that already have connections
                if (taskFlashcardConnections[task.id]) continue;

                // Find the appropriate sub-deck for this task
                const deckId = await findSubDeckForTask(subjectTag, task.section);

                if (deckId) {
                    // Connect the task to the deck
                    connectTaskToFlashcardDeck(task.id, deckId, {
                        title: task.title,
                        section: task.section,
                        projectId: project.id,
                        projectName: project.name
                    });

                    tasksConnected++;
                }
            }
        }

        console.log(`Auto-connected ${tasksConnected} tasks to flashcard decks`);

    } catch (error) {
        console.error('Error auto-connecting tasks to flashcards:', error);
    }
}

/**
 * Shuffle an array using the Fisher-Yates algorithm
 * @param {Array} array - The array to shuffle
 * @returns {Array} Shuffled array
 */
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}
