/**
 * QuoteController - Motivational Quote Management
 */
class QuoteController {
    constructor() {
        this.currentQuoteIndex = 0;
        this.rotationInterval = null;
        this.defaultQuotes = [
            { text: "Success is not final, failure is not fatal.", author: "Winston Churchill" },
            { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
            { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" }
        ];
    }

    init() {
        // document.addEventListener('DOMContentLoaded', () => {
        this.rotateQuote();
        this.rotationInterval = setInterval(() => this.rotateQuote(), 60000);
        // });
        return this;
    }

    getQuotes() {
        const stored = JSON.parse(localStorage.getItem('customQuotes') || '[]');
        const roleModels = JSON.parse(localStorage.getItem('roleModels') || '[]');
        const rmQuotes = roleModels.flatMap(m => m.research?.map(r => ({
            text: r.description, author: `About ${m.name}`, image: r.image || m.image
        })) || []);
        return [...stored, ...rmQuotes, ...this.defaultQuotes];
    }

    rotateQuote(direction = 1) {
        const quotes = this.getQuotes();
        const container = document.getElementById('dynamicQuoteContainer');
        if (!container || !quotes.length) return;

        this.currentQuoteIndex = direction > 0
            ? (this.currentQuoteIndex + 1) % quotes.length
            : (this.currentQuoteIndex - 1 + quotes.length) % quotes.length;

        const quote = quotes[this.currentQuoteIndex];
        const content = document.createElement('div');
        content.className = 'quote-container';
        content.style.cssText = 'opacity:0;transition:opacity 0.3s';
        content.innerHTML = `
            ${quote.image ? `<img class="quote-image" src="${quote.image}" alt="" width="120" height="120">` : ''}
            <div class="quote-content">
                <p class="quote-text">"${quote.text}"</p>
                <p class="quote-author">- ${quote.author}</p>
            </div>`;

        container.innerHTML = '';
        container.appendChild(content);
        setTimeout(() => content.style.opacity = '1', 50);
    }
}

const quoteController = new QuoteController();
export default quoteController;
if (typeof window !== 'undefined') {
    window.quoteController = quoteController;
    window.rotateQuote = (d) => quoteController.rotateQuote(d);
}
