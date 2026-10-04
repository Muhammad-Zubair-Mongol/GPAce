/**
 * flashcards-controller.js
 * Main controller for the Flashcards page
 * 
 * This module provides:
 * - Centralized Firebase initialization
 * - XSS protection via sanitization
 * - Event delegation for dynamic content
 * - Memory-safe event listener management
 * - SM-2 spaced repetition algorithm integration
 */

import { SM2 } from './sm2.js';
import { getStorage } from './utils/StorageAdapter.js';
import sanitizer from './utils/Sanitizer.js';
import { firebaseConfig, getOrCreateFirebaseApp } from './firebaseConfig.js';

// ============================================
// Firebase SDK Imports
// ============================================
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
    getFirestore,
    collection,
    addDoc,
    getDocs,
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// ============================================
// Constants
// ============================================
const SUBDECK_CATEGORIES = ['Revision', 'Assignment', 'Quizzes', 'Mid Term / OHT', 'Finals'];

// ============================================
// State Management Class
// ============================================
class FlashcardsState {
    constructor() {
        this.db = null;
        this.auth = null;
        this.currentUser = null;
        this.subjectsWithDecks = [];
        this.subjectsWithSubDecks = {};
        this.taskFlashcardConnections = {};
        this.currentStudySession = null;
        this.abortController = null;
        this.authUnsubscribe = null;
    }

    reset() {
        this.subjectsWithDecks = [];
        this.subjectsWithSubDecks = {};
        this.taskFlashcardConnections = {};
        this.currentStudySession = null;
    }

    cleanup() {
        if (this.authUnsubscribe) {
            this.authUnsubscribe();
            this.authUnsubscribe = null;
        }
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}

// Create singleton state instance
const state = new FlashcardsState();

// ============================================
// Sanitization Helper
// ============================================
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const str = String(text);
    if (sanitizer && typeof sanitizer.text === 'function') {
        return sanitizer.text(str);
    }
    // Fallback sanitization
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================
// Utility Functions
// ============================================
function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return escapeHtml(text);
    return escapeHtml(text.substring(0, maxLength)) + '...';
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function formatCardContent(content) {
    if (!content) return '';
    // Sanitize and convert line breaks
    return escapeHtml(content).replace(/\n/g, '<br>');
}

// ============================================
// Notification System
// ============================================
function showNotification(message, type = 'info') {
    const colors = {
        success: 'bg-success',
        error: 'bg-danger',
        warning: 'bg-warning',
        info: 'bg-info'
    };

    const icons = {
        success: 'bi-check-circle',
        error: 'bi-exclamation-circle',
        warning: 'bi-exclamation-triangle',
        info: 'bi-info-circle'
    };

    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center text-white ${colors[type] || colors.info} border-0`;
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');

    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                <i class="bi ${icons[type] || icons.info} me-2"></i>
                ${escapeHtml(message)}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;

    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(toastContainer);
    }
    toastContainer.appendChild(toastEl);

    const toast = new bootstrap.Toast(toastEl);
    toast.show();

    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

function showErrorMessage(message) {
    showNotification(message, 'error');
}

function showSuccessMessage(message) {
    showNotification(message, 'success');
}

// ============================================
// Firebase Initialization
// ============================================
async function initializeFirebase() {
    try {
        let app;

        // Check if Firebase is already initialized
        if (getApps().length > 0) {
            app = getApps()[0];
            console.log('[Flashcards] Using existing Firebase app');
        } else {
            app = initializeApp(firebaseConfig);
            console.log('[Flashcards] Firebase initialized');
        }

        state.db = getFirestore(app);
        state.auth = getAuth(app);

        // Also set on window for other modules
        window.db = state.db;
        window.auth = state.auth;

        return true;
    } catch (error) {
        console.error('[Flashcards] Firebase initialization error:', error);
        return false;
    }
}

// ============================================
// Auth State Management
// ============================================
function setupAuthListener() {
    if (!state.auth) return;

    state.authUnsubscribe = onAuthStateChanged(state.auth, async (user) => {
        if (user) {
            state.currentUser = user;
            console.log('[Flashcards] User signed in:', user.uid);
            await initializeFlashcards();
        } else {
            console.log('[Flashcards] No user signed in');
            state.currentUser = null;
            showLoginPrompt();
        }
    });
}

function showLoginPrompt() {
    const container = document.querySelector('.container');
    if (!container) return;

    container.innerHTML = `
        <div class="row">
            <div class="col-md-6 offset-md-3 text-center mt-5">
                <div class="card">
                    <div class="card-body">
                        <h3 class="card-title">Sign In Required</h3>
                        <p class="card-text">Please sign in to access the flashcards feature.</p>
                        <a href="grind.html" class="btn btn-primary">Go to Grind Mode</a>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// Main Initialization
// ============================================
async function initializeFlashcards() {
    try {
        await loadSubjects();
        await createDecksForExistingSubjects();
        await loadDecks();
        loadTaskFlashcardConnections();
        await autoConnectTasksToFlashcards();
        setupSubjectChangeListener();

        console.log('[Flashcards] Initialization complete');
    } catch (error) {
        console.error('[Flashcards] Initialization error:', error);
        showErrorMessage('Failed to load flashcard data. Please try again later.');
    }
}

// ============================================
// Subject Management
// ============================================
async function loadSubjects() {
    const storage = getStorage();

    try {
        const subjectsSelect = document.getElementById('deckSubject');
        if (subjectsSelect) {
            subjectsSelect.innerHTML = '<option value="">Select a subject</option>';
        }

        // Try to get subjects from storage first
        let subjects = storage.get('academicSubjects', null);

        if (!subjects) {
            // Try academicSemesters
            const allSemesters = storage.get('academicSemesters', null);
            if (allSemesters) {
                const currentSemester = storage.get('currentAcademicSemester', 'default');
                const semesterData = allSemesters[currentSemester];
                if (semesterData?.subjects?.length > 0) {
                    subjects = semesterData.subjects;
                }
            }
        }

        if (!subjects && state.currentUser) {
            // Fetch from Firestore
            const subjectsRef = collection(state.db, `users/${state.currentUser.uid}/subjects`);
            const querySnapshot = await getDocs(subjectsRef);

            if (!querySnapshot.empty) {
                subjects = [];
                querySnapshot.forEach(doc => {
                    subjects.push(doc.data());
                });
            }
        }

        if (subjects && subjectsSelect) {
            subjects.forEach(subject => {
                const option = document.createElement('option');
                option.value = subject.tag;
                option.textContent = escapeHtml(subject.name);
                subjectsSelect.appendChild(option);
            });
        }

        return subjects || [];
    } catch (error) {
        console.error('[Flashcards] Error loading subjects:', error);
        showErrorMessage('Failed to load subjects.');
        return [];
    }
}

function setupSubjectChangeListener() {
    const storage = getStorage();

    window.addEventListener('storage', (e) => {
        if (e.key === 'academicSubjects') {
            loadSubjects();
            createDecksForExistingSubjects();
        }
    });
}

// ============================================
// Deck Management
// ============================================
async function loadDecks() {
    try {
        const decksList = document.getElementById('decksList');
        const noDecksMessage = document.getElementById('noDecksMessage');

        if (!decksList) return;

        decksList.innerHTML = '';

        if (!state.currentUser) {
            if (noDecksMessage) noDecksMessage.style.display = 'block';
            return;
        }

        const userId = state.currentUser.uid;
        const decksRef = collection(state.db, `users/${userId}/flashcardDecks`);
        const q = query(decksRef, orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            if (noDecksMessage) noDecksMessage.style.display = 'block';
            return;
        }

        if (noDecksMessage) noDecksMessage.style.display = 'none';

        // Organize decks
        const mainDecks = [];
        const subDecks = {};

        querySnapshot.forEach(doc => {
            const deck = { ...doc.data(), id: doc.id };
            if (deck.parentDeckId) {
                if (!subDecks[deck.parentDeckId]) {
                    subDecks[deck.parentDeckId] = [];
                }
                subDecks[deck.parentDeckId].push(deck);
            } else {
                mainDecks.push(deck);
            }
        });

        // Group by subject
        const subjectGroups = {};
        mainDecks.forEach(deck => {
            if (!deck.subjectId) return;
            if (!subjectGroups[deck.subjectId]) {
                subjectGroups[deck.subjectId] = [];
            }
            subjectGroups[deck.subjectId].push(deck);
        });

        // Render decks
        for (const subjectId in subjectGroups) {
            const subjectDecks = subjectGroups[subjectId];
            if (subjectDecks.length === 0) continue;

            const firstDeck = subjectDecks[0];

            // Subject header
            const subjectHeader = document.createElement('div');
            subjectHeader.className = 'col-12 mb-3';
            subjectHeader.innerHTML = `
                <h4 class="subject-header">${escapeHtml(firstDeck.subjectName)}</h4>
                <hr>
            `;
            decksList.appendChild(subjectHeader);

            // Render each deck
            subjectDecks.forEach(deck => {
                const hasSubDecks = subDecks[deck.id]?.length > 0;
                const dueCards = deck.cardCount || 0;
                const subDeckCount = hasSubDecks ? subDecks[deck.id].length : 0;

                const deckCard = document.createElement('div');
                deckCard.className = 'col-md-4 mb-4';
                deckCard.innerHTML = `
                    <div class="card deck-card ${hasSubDecks ? 'has-sub-decks' : ''}" 
                         data-deck-id="${escapeHtml(deck.id)}"
                         data-action="open-deck">
                        <div class="card-body">
                            <h5 class="card-title">${escapeHtml(deck.title)}</h5>
                            <p class="card-text">${escapeHtml(deck.description || 'No description')}</p>
                            <div class="mt-2">
                                <span class="badge bg-primary">${deck.cardCount || 0} cards</span>
                                <span class="badge bg-info">${dueCards} due</span>
                                ${hasSubDecks ? `<span class="badge bg-secondary">${subDeckCount} sub-decks</span>` : ''}
                            </div>
                        </div>
                        <div class="card-footer d-flex justify-content-between align-items-center">
                            <small class="text-muted">Subject: ${escapeHtml(deck.subjectName)}</small>
                            ${hasSubDecks ? `
                                <button class="btn btn-sm btn-outline-secondary toggle-subdecks" 
                                        data-action="toggle-subdecks"
                                        data-target="sub-decks-${deck.id}">
                                    <i class="bi bi-chevron-down"></i> Sub-decks
                                </button>
                            ` : ''}
                        </div>
                    </div>
                `;
                decksList.appendChild(deckCard);

                // Render sub-decks if present (Hidden by default)
                if (hasSubDecks) {
                    const subDecksContainer = document.createElement('div');
                    subDecksContainer.className = 'col-12 mb-4 sub-decks-container d-none'; // Hidden by default
                    subDecksContainer.id = `sub-decks-${deck.id}`;
                    subDecksContainer.innerHTML = `
                        <div class="sub-decks-header">
                            Sub-decks for ${escapeHtml(deck.title)}
                            <button class="btn btn-sm btn-link float-end text-decoration-none" 
                                    data-action="close-subdecks">
                                <i class="bi bi-x-lg"></i> Close
                            </button>
                        </div>
                        <div class="row sub-decks-row">
                            ${subDecks[deck.id].map(subDeck => `
                                <div class="col-md-3 mb-3">
                                    <div class="card sub-deck-card" 
                                         data-deck-id="${escapeHtml(subDeck.id)}"
                                         data-action="open-deck">
                                        <div class="card-body">
                                            <h6 class="card-title">${escapeHtml(subDeck.category)}</h6>
                                            <div class="mt-2">
                                                <span class="badge bg-primary">${subDeck.cardCount || 0} cards</span>
                                            </div>
                                        </div>
                                        <div class="card-footer p-2 text-center">
                                            <small class="text-muted">Part of ${escapeHtml(deck.title)}</small>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `;
                    decksList.appendChild(subDecksContainer);
                }
            });
        }

    } catch (error) {
        console.error('[Flashcards] Error loading decks:', error);
        showErrorMessage('Failed to load flashcard decks.');
    }
}

async function createDeck() {
    try {
        const title = document.getElementById('deckTitle')?.value.trim();
        const subjectId = document.getElementById('deckSubject')?.value;
        const description = document.getElementById('deckDescription')?.value.trim();

        if (!title) {
            showErrorMessage('Please enter a deck title');
            return;
        }

        if (!subjectId) {
            showErrorMessage('Please select a subject');
            return;
        }

        const subjectSelect = document.getElementById('deckSubject');
        const subjectName = subjectSelect.options[subjectSelect.selectedIndex].text;

        const userId = state.currentUser.uid;
        const decksRef = collection(state.db, `users/${userId}/flashcardDecks`);

        await addDoc(decksRef, {
            title,
            subjectId,
            subjectName,
            description,
            cardCount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            manuallyCreated: true
        });

        if (!state.subjectsWithDecks.includes(subjectId)) {
            state.subjectsWithDecks.push(subjectId);
        }

        bootstrap.Modal.getInstance(document.getElementById('createDeckModal'))?.hide();
        showSuccessMessage('Deck created successfully!');
        await loadDecks();

    } catch (error) {
        console.error('[Flashcards] Error creating deck:', error);
        showErrorMessage('Failed to create deck.');
    }
}

async function deleteDeck(deckId) {
    try {
        const userId = state.currentUser.uid;
        const deckRef = doc(state.db, `users/${userId}/flashcardDecks/${deckId}`);
        const deckDoc = await getDoc(deckRef);

        if (!deckDoc.exists()) {
            showErrorMessage('Deck not found');
            return;
        }

        const deck = deckDoc.data();
        const isMainDeck = !deck.parentDeckId;

        if (isMainDeck) {
            const decksRef = collection(state.db, `users/${userId}/flashcardDecks`);
            const q = query(decksRef, where('parentDeckId', '==', deckId));
            const subDecksSnapshot = await getDocs(q);

            if (!subDecksSnapshot.empty) {
                if (!confirm(`This deck has ${subDecksSnapshot.size} sub-decks. Deleting it will also delete all sub-decks and their cards. Continue?`)) {
                    return;
                }

                // Delete sub-decks and their cards
                for (const subDeckDoc of subDecksSnapshot.docs) {
                    const subDeckId = subDeckDoc.id;
                    const cardsRef = collection(state.db, `users/${userId}/flashcardDecks/${subDeckId}/cards`);
                    const cardsSnapshot = await getDocs(cardsRef);

                    for (const cardDoc of cardsSnapshot.docs) {
                        await deleteDoc(cardDoc.ref);
                    }
                    await deleteDoc(subDeckDoc.ref);
                }
            }
        }

        // Delete cards in main deck
        const cardsRef = collection(state.db, `users/${userId}/flashcardDecks/${deckId}/cards`);
        const cardsSnapshot = await getDocs(cardsRef);

        for (const cardDoc of cardsSnapshot.docs) {
            await deleteDoc(cardDoc.ref);
        }

        await deleteDoc(deckRef);

        bootstrap.Modal.getInstance(document.getElementById('deckDetailsModal'))?.hide();
        showSuccessMessage(isMainDeck ? 'Deck and all sub-decks deleted!' : 'Sub-deck deleted!');

        if (isMainDeck && deck.subjectId) {
            const index = state.subjectsWithDecks.indexOf(deck.subjectId);
            if (index !== -1) {
                state.subjectsWithDecks.splice(index, 1);
            }
            delete state.subjectsWithSubDecks[deck.subjectId];
        }

        await loadDecks();

    } catch (error) {
        console.error('[Flashcards] Error deleting deck:', error);
        showErrorMessage('Failed to delete deck.');
    }
}

// ============================================
// Deck Details Modal
// ============================================
async function openDeckDetails(deckId) {
    try {
        const userId = state.currentUser.uid;
        const deckRef = doc(state.db, `users/${userId}/flashcardDecks/${deckId}`);
        const deckDoc = await getDoc(deckRef);

        if (!deckDoc.exists()) {
            showErrorMessage('Deck not found');
            return;
        }

        const deck = { ...deckDoc.data(), id: deckId };

        // Set deck details
        document.getElementById('deckDetailTitle').textContent = deck.parentDeckId
            ? `${deck.title} (${deck.category})`
            : deck.title;
        document.getElementById('deckDetailSubject').textContent = `Subject: ${deck.subjectName}`;
        document.getElementById('deckDetailDescription').textContent = deck.description || 'No description';
        document.getElementById('cardCount').textContent = `${deck.cardCount || 0} cards`;
        document.getElementById('currentDeckId').value = deckId;

        // Load cards
        const cardsRef = collection(state.db, `users/${userId}/flashcardDecks/${deckId}/cards`);
        const q = query(cardsRef, orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);

        const cardsTableBody = document.getElementById('cardsTableBody');
        cardsTableBody.innerHTML = '';

        let dueCount = 0;

        if (querySnapshot.empty) {
            cardsTableBody.innerHTML = '<tr><td colspan="4" class="text-center">No cards in this deck yet</td></tr>';
        } else {
            querySnapshot.forEach(cardDoc => {
                const card = cardDoc.data();
                const cardId = cardDoc.id;

                if (SM2.isDue(card)) dueCount++;

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${truncateText(card.question, 50)}</td>
                    <td>${truncateText(card.answer, 50)}</td>
                    <td>${SM2.formatNextReview(card)}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger" 
                                data-action="delete-card"
                                data-deck-id="${escapeHtml(deckId)}"
                                data-card-id="${escapeHtml(cardId)}"
                                aria-label="Delete card">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                `;
                cardsTableBody.appendChild(row);
            });
        }

        document.getElementById('dueCount').textContent = `${dueCount} due`;

        // Update button text for sub-decks
        const deleteDeckBtn = document.getElementById('deleteDeckBtn');
        deleteDeckBtn.textContent = deck.parentDeckId ? 'Delete Sub-Deck' : 'Delete Deck';

        new bootstrap.Modal(document.getElementById('deckDetailsModal')).show();

    } catch (error) {
        console.error('[Flashcards] Error opening deck details:', error);
        showErrorMessage('Failed to load deck details.');
    }
}

// ============================================
// Card Management
// ============================================
async function addCard() {
    try {
        const deckId = document.getElementById('currentDeckId')?.value;
        const question = document.getElementById('cardQuestion')?.value.trim();
        const answer = document.getElementById('cardAnswer')?.value.trim();

        if (!question) {
            showErrorMessage('Please enter a question');
            return;
        }

        if (!answer) {
            showErrorMessage('Please enter an answer');
            return;
        }

        const userId = state.currentUser.uid;
        const cardsRef = collection(state.db, `users/${userId}/flashcardDecks/${deckId}/cards`);

        await addDoc(cardsRef, {
            question,
            answer,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        // Update card count
        const deckRef = doc(state.db, `users/${userId}/flashcardDecks/${deckId}`);
        const deckDoc = await getDoc(deckRef);

        if (deckDoc.exists()) {
            await updateDoc(deckRef, {
                cardCount: (deckDoc.data().cardCount || 0) + 1,
                updatedAt: serverTimestamp()
            });
        }

        bootstrap.Modal.getInstance(document.getElementById('addCardModal'))?.hide();
        showSuccessMessage('Card added successfully!');
        await openDeckDetails(deckId);

    } catch (error) {
        console.error('[Flashcards] Error adding card:', error);
        showErrorMessage('Failed to add card.');
    }
}

async function deleteCard(deckId, cardId) {
    if (!confirm('Are you sure you want to delete this card?')) return;

    try {
        const userId = state.currentUser.uid;
        const cardRef = doc(state.db, `users/${userId}/flashcardDecks/${deckId}/cards/${cardId}`);

        await deleteDoc(cardRef);

        // Update card count
        const deckRef = doc(state.db, `users/${userId}/flashcardDecks/${deckId}`);
        const deckDoc = await getDoc(deckRef);

        if (deckDoc.exists()) {
            await updateDoc(deckRef, {
                cardCount: Math.max(0, (deckDoc.data().cardCount || 0) - 1),
                updatedAt: serverTimestamp()
            });
        }

        showSuccessMessage('Card deleted!');
        await openDeckDetails(deckId);

    } catch (error) {
        console.error('[Flashcards] Error deleting card:', error);
        showErrorMessage('Failed to delete card.');
    }
}

// ============================================
// Study Session
// ============================================
async function startStudySession(deckId) {
    try {
        const userId = state.currentUser.uid;
        const cardsRef = collection(state.db, `users/${userId}/flashcardDecks/${deckId}/cards`);
        const querySnapshot = await getDocs(cardsRef);

        if (querySnapshot.empty) {
            showErrorMessage('This deck has no cards to study');
            return;
        }

        const allCards = [];
        querySnapshot.forEach(doc => {
            allCards.push({ ...doc.data(), id: doc.id });
        });

        const dueCards = allCards.filter(card => SM2.isDue(card));

        if (dueCards.length === 0) {
            showErrorMessage('No cards are due for review');
            return;
        }

        state.currentStudySession = {
            deckId,
            cards: shuffleArray(dueCards),
            currentIndex: 0,
            totalCards: dueCards.length
        };

        displayCurrentCard();
        new bootstrap.Modal(document.getElementById('studyModal')).show();

    } catch (error) {
        console.error('[Flashcards] Error starting study session:', error);
        showErrorMessage('Failed to start study session.');
    }
}

function displayCurrentCard() {
    const session = state.currentStudySession;
    if (!session || session.currentIndex >= session.cards.length) {
        endStudySession();
        return;
    }

    const card = session.cards[session.currentIndex];

    document.getElementById('studyModalLabel').textContent =
        `Study Flashcards (${session.currentIndex + 1}/${session.totalCards})`;
    document.getElementById('questionContent').innerHTML = formatCardContent(card.question);
    document.getElementById('answerContent').innerHTML = formatCardContent(card.answer);

    const flashcard = document.getElementById('currentFlashcard');
    flashcard.classList.remove('flipped');

    document.getElementById('flipCardPrompt').style.display = 'block';
    document.getElementById('ratingContainer').style.display = 'none';

    document.getElementById('progressCounter').textContent =
        `${session.currentIndex + 1}/${session.totalCards}`;
}

function flipCard() {
    const flashcard = document.getElementById('currentFlashcard');
    flashcard.classList.toggle('flipped');

    if (flashcard.classList.contains('flipped')) {
        document.getElementById('flipCardPrompt').style.display = 'none';
        document.getElementById('ratingContainer').style.display = 'block';
    } else {
        document.getElementById('flipCardPrompt').style.display = 'block';
        document.getElementById('ratingContainer').style.display = 'none';
    }
}

async function rateCard(rating) {
    try {
        const session = state.currentStudySession;
        if (!session) return;

        const card = session.cards[session.currentIndex];
        const updatedCard = SM2.processCard(card, rating);

        const userId = state.currentUser.uid;
        const cardRef = doc(state.db, `users/${userId}/flashcardDecks/${session.deckId}/cards/${card.id}`);

        await updateDoc(cardRef, {
            sm2: updatedCard.sm2,
            lastReviewed: updatedCard.lastReviewed
        });

        session.currentIndex++;

        if (session.currentIndex >= session.cards.length) {
            endStudySession();
        } else {
            displayCurrentCard();
        }

    } catch (error) {
        console.error('[Flashcards] Error rating card:', error);
        showErrorMessage('Failed to save rating.');
    }
}

function endStudySession() {
    showSuccessMessage('Study session completed!');

    const studyModal = document.getElementById('studyModal');
    bootstrap.Modal.getInstance(studyModal)?.hide();

    state.currentStudySession = null;
    loadDecks();
}

// ============================================
// Task-Flashcard Connection
// ============================================
function loadTaskFlashcardConnections() {
    const storage = getStorage();
    state.taskFlashcardConnections = storage.get('taskFlashcardConnections', {});
}

async function autoConnectTasksToFlashcards() {
    // Placeholder for auto-connection logic
    // This would connect tasks from Hustle Hub to flashcard decks
}

async function createDecksForExistingSubjects() {
    // Placeholder for auto-deck creation
    // This would create decks for subjects that don't have them
}

// ============================================
// Event Delegation Setup
// ============================================
function setupEventDelegation() {
    state.abortController = new AbortController();
    const { signal } = state.abortController;

    // Decks list - event delegation for deck cards
    document.getElementById('decksList')?.addEventListener('click', (e) => {
        // Handle Toggle Sub-decks Button
        const toggleBtn = e.target.closest('[data-action="toggle-subdecks"]');
        if (toggleBtn) {
            e.stopPropagation();
            const targetId = toggleBtn.dataset.target;
            const targetEl = document.getElementById(targetId);
            if (targetEl) {
                targetEl.classList.toggle('d-none');
                // Toggle Icon
                const icon = toggleBtn.querySelector('i');
                if (icon) {
                    if (targetEl.classList.contains('d-none')) {
                        icon.className = 'bi bi-chevron-down';
                    } else {
                        icon.className = 'bi bi-chevron-up';
                    }
                }
            }
            return;
        }

        // Handle Close Sub-decks Button
        const closeBtn = e.target.closest('[data-action="close-subdecks"]');
        if (closeBtn) {
            e.stopPropagation();
            const container = closeBtn.closest('.sub-decks-container');
            if (container) {
                container.classList.add('d-none');
                // We can't easily toggle the chevron back here without a reference, 
                // but the next interaction will reset it or works fine.
            }
            return;
        }

        // Handle Open Deck
        const deckCard = e.target.closest('[data-action="open-deck"]');
        if (deckCard) {
            const deckId = deckCard.dataset.deckId;
            openDeckDetails(deckId);
        }
    }, { signal });

    // Cards table - event delegation for delete buttons
    document.getElementById('cardsTableBody')?.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('[data-action="delete-card"]');
        if (deleteBtn) {
            e.stopPropagation();
            const { deckId, cardId } = deleteBtn.dataset;
            deleteCard(deckId, cardId);
        }
    }, { signal });

    // Create deck button
    document.getElementById('createDeckBtn')?.addEventListener('click', () => {
        document.getElementById('deckTitle').value = '';
        document.getElementById('deckDescription').value = '';
        document.getElementById('deckSubject').selectedIndex = 0;
        new bootstrap.Modal(document.getElementById('createDeckModal')).show();
    }, { signal });

    // Save deck button
    document.getElementById('saveDeckBtn')?.addEventListener('click', createDeck, { signal });

    // Save card button
    document.getElementById('saveCardBtn')?.addEventListener('click', addCard, { signal });

    // Add card button
    document.getElementById('addCardBtn')?.addEventListener('click', () => {
        document.getElementById('cardQuestion').value = '';
        document.getElementById('cardAnswer').value = '';
        bootstrap.Modal.getInstance(document.getElementById('deckDetailsModal'))?.hide();
        new bootstrap.Modal(document.getElementById('addCardModal')).show();
    }, { signal });

    // Study deck button
    document.getElementById('studyDeckBtn')?.addEventListener('click', () => {
        const deckId = document.getElementById('currentDeckId')?.value;
        bootstrap.Modal.getInstance(document.getElementById('deckDetailsModal'))?.hide();
        startStudySession(deckId);
    }, { signal });

    // Delete deck button
    document.getElementById('deleteDeckBtn')?.addEventListener('click', () => {
        const deckId = document.getElementById('currentDeckId')?.value;
        if (confirm('Are you sure you want to delete this deck?')) {
            deleteDeck(deckId);
        }
    }, { signal });

    // Flip card button
    document.getElementById('flipCardBtn')?.addEventListener('click', flipCard, { signal });

    // Rating buttons
    document.querySelectorAll('.rating-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const rating = parseInt(btn.dataset.rating, 10);
            rateCard(rating);
        }, { signal });
    });

    // Form submissions
    document.getElementById('createDeckForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        createDeck();
    }, { signal });

    document.getElementById('addCardForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        addCard();
    }, { signal });

    // Keyboard support for flashcard
    document.addEventListener('keydown', (e) => {
        if (!state.currentStudySession) return;

        if (e.code === 'Space') {
            e.preventDefault();
            flipCard();
        } else if (e.key >= '1' && e.key <= '5') {
            const flashcard = document.getElementById('currentFlashcard');
            if (flashcard.classList.contains('flipped')) {
                rateCard(parseInt(e.key, 10));
            }
        }
    }, { signal });
}

// ============================================
// Initialization Entry Point
// ============================================
async function init() {
    console.log('[Flashcards] Starting initialization...');

    const firebaseReady = await initializeFirebase();
    if (!firebaseReady) {
        showErrorMessage('Failed to initialize. Please refresh the page.');
        return;
    }

    setupEventDelegation();
    setupAuthListener();
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ============================================
// Exports
// ============================================
export {
    state,
    loadDecks,
    createDeck,
    deleteDeck,
    openDeckDetails,
    addCard,
    deleteCard,
    startStudySession,
    flipCard,
    rateCard,
    showNotification,
    showErrorMessage,
    showSuccessMessage
};

// Global exposure for debugging
window.FlashcardsController = {
    state,
    loadDecks,
    createDeck,
    openDeckDetails,
    startStudySession
};
