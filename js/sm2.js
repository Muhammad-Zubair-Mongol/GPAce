/**
 * SM-2 Spaced Repetition Algorithm Implementation
 * Based on the SuperMemo 2 algorithm by Piotr Wozniak
 * 
 * This implementation calculates the next review date and updates
 * the ease factor based on the user's self-reported performance.
 */

const SM2 = {
    /**
     * Calculate the next review date and update card metrics
     * @param {Object} card - The flashcard object
     * @param {Number} quality - Rating from 1-5 where:
     *   1 = complete blackout
     *   2 = incorrect response but recognized answer
     *   3 = correct with difficulty
     *   4 = correct with hesitation
     *   5 = perfect recall
     * @returns {Object} Updated card metrics
     */
    processCard: function(card, quality) {
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
    },
    
    /**
     * Check if a card is due for review
     * @param {Object} card - The flashcard object
     * @returns {Boolean} True if the card is due for review
     */
    isDue: function(card) {
        if (!card.sm2 || !card.sm2.nextReview) {
            return true; // New cards are always due
        }
        
        const now = new Date();
        const nextReview = new Date(card.sm2.nextReview);
        
        return now >= nextReview;
    },
    
    /**
     * Get the number of days until the next review
     * @param {Object} card - The flashcard object
     * @returns {Number} Days until next review (0 if due now)
     */
    daysUntilReview: function(card) {
        if (!card.sm2 || !card.sm2.nextReview) {
            return 0; // New cards are due immediately
        }
        
        const now = new Date();
        const nextReview = new Date(card.sm2.nextReview);
        
        // Calculate difference in days
        const diffTime = nextReview.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        return Math.max(0, diffDays);
    },
    
    /**
     * Format the next review date as a string
     * @param {Object} card - The flashcard object
     * @returns {String} Formatted date string
     */
    formatNextReview: function(card) {
        if (!card.sm2 || !card.sm2.nextReview) {
            return 'Now';
        }
        
        const days = this.daysUntilReview(card);
        
        if (days === 0) {
            return 'Today';
        } else if (days === 1) {
            return 'Tomorrow';
        } else {
            const nextReview = new Date(card.sm2.nextReview);
            return nextReview.toLocaleDateString();
        }
    }
};

// Make SM2 available globally
window.SM2 = SM2;
