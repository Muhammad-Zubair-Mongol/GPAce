/**
 * Quote Manager
 * Handles quote management functionality including adding, displaying, and deleting quotes
 */

// Storage helper with fallback (use existing or create new)
if (typeof window.getStorage === 'undefined') {
    window.getStorage = () => window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };
}
const getStorage = window.getStorage;

class QuoteManager {
    constructor() {
        this.quoteTextInput = null;
        this.quoteAuthorInput = null;
        this.quoteImageInput = null;
        this.quoteList = null;
        this.addQuoteBtn = null;

        // Initialize on DOM content loaded
        document.addEventListener('DOMContentLoaded', () => this.init());
    }

    init() {
        // Get references to DOM elements
        this.quoteTextInput = document.getElementById('quoteText');
        this.quoteAuthorInput = document.getElementById('quoteAuthor');
        this.quoteImageInput = document.getElementById('quoteImage');
        this.quoteList = document.getElementById('quoteList');
        this.addQuoteBtn = document.querySelector('.quote-input-container .interactive-button');

        // Add event listener to add quote button
        if (this.addQuoteBtn) {
            this.addQuoteBtn.addEventListener('click', () => this.addQuote());
        }

        // Render existing quotes
        this.renderQuotes();
    }

    addQuote() {
        const quoteText = this.quoteTextInput?.value;
        const quoteAuthor = this.quoteAuthorInput?.value;
        const quoteImage = this.quoteImageInput?.value;

        if (!quoteText || !quoteAuthor) {
            alert('Please enter quote text and author');
            return;
        }

        try {
            const storage = getStorage();
            const quotes = storage.get('customQuotes', []);
            quotes.push({ text: quoteText, author: quoteAuthor, image: quoteImage });
            storage.set('customQuotes', quotes);

            this.renderQuotes();
            this.clearQuoteInputs();

            // Play sound if sound manager is available
            if (window.soundManager) {
                window.soundManager.playSound('click', 'confirm');
            }
        } catch (error) {
            console.error('Error adding quote:', error);
            alert('Failed to add quote. Please try again.');
        }
    }

    renderQuotes() {
        if (!this.quoteList) return;

        try {
            const storage = getStorage();
            const quotes = storage.get('customQuotes', []);

            this.quoteList.innerHTML = quotes.map((quote, index) => `
                <div class="quote-card">
                    ${quote.image ? `<img src="${quote.image}" alt="Quote Image" class="quote-image">` : ''}
                    <p>"${quote.text}"</p>
                    <p>- ${quote.author}</p>
                    <button class="delete-quote" data-index="${index}">Delete</button>
                </div>
            `).join('');

            // Add event listeners to delete buttons
            document.querySelectorAll('.delete-quote').forEach(button => {
                button.addEventListener('click', (e) => {
                    const index = parseInt(e.target.getAttribute('data-index'));
                    this.deleteQuote(index);
                });
            });
        } catch (error) {
            console.error('Error rendering quotes:', error);
            this.quoteList.innerHTML = '<p>Error loading quotes. Please refresh the page.</p>';
        }
    }

    deleteQuote(index) {
        try {
            const storage = getStorage();
            const quotes = storage.get('customQuotes', []);
            quotes.splice(index, 1);
            storage.set('customQuotes', quotes);
            this.renderQuotes();

            // Play sound if sound manager is available
            if (window.soundManager) {
                window.soundManager.playSound('click', 'default');
            }
        } catch (error) {
            console.error('Error deleting quote:', error);
            alert('Failed to delete quote. Please try again.');
        }
    }

    clearQuoteInputs() {
        if (this.quoteTextInput) this.quoteTextInput.value = '';
        if (this.quoteAuthorInput) this.quoteAuthorInput.value = '';
        if (this.quoteImageInput) this.quoteImageInput.value = '';
    }
}

// Initialize quote manager
const quoteManager = new QuoteManager();

// Export for use in other modules
window.quoteManager = quoteManager;
