/**
 * Sanitizer.js
 * Centralized HTML/text sanitization utility for XSS prevention.
 * Part of Batch 5: Security Hardening.
 * 
 * Features:
 * - DOMPurify integration with fallback
 * - Context-aware sanitization (HTML, text, URL, etc.)
 * - Configurable allowed tags/attributes
 * - Logging for blocked content
 * 
 * Usage:
 *   import Sanitizer from './Sanitizer.js';
 *   
 *   // Sanitize HTML content
 *   const safeHtml = Sanitizer.html(userInput);
 *   
 *   // Sanitize for plain text only
 *   const safeText = Sanitizer.text(userInput);
 *   
 *   // Sanitize URL
 *   const safeUrl = Sanitizer.url(userInput);
 */

// Check if DOMPurify is available
const hasDOMPurify = typeof DOMPurify !== 'undefined';

if (!hasDOMPurify) {
    console.warn('[Sanitizer] DOMPurify not loaded. Using fallback sanitization.');
}

// Default configuration for DOMPurify
const DEFAULT_CONFIG = {
    ALLOWED_TAGS: [
        'p', 'br', 'b', 'i', 'u', 'strong', 'em', 'span', 'div',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'a', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'blockquote', 'pre', 'code',
        'sub', 'sup', 'mark', 'del', 'ins'
    ],
    ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'class', 'id', 'style',
        'target', 'rel', 'width', 'height', 'colspan', 'rowspan'
    ],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    RETURN_DOM_IMPORT: false
};

// Strict config for AI/user generated content
const STRICT_CONFIG = {
    ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'u', 'strong', 'em', 'span'],
    ALLOWED_ATTR: ['class'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'a', 'img'],
    KEEP_CONTENT: true
};

// Rich text config for workspace/flashcards
const RICH_CONFIG = {
    ...DEFAULT_CONFIG,
    ALLOWED_TAGS: [
        ...DEFAULT_CONFIG.ALLOWED_TAGS,
        'hr', 'details', 'summary', 'figure', 'figcaption',
        'audio', 'video', 'source'
    ],
    ALLOWED_ATTR: [
        ...DEFAULT_CONFIG.ALLOWED_ATTR,
        'controls', 'autoplay', 'loop', 'muted', 'poster', 'type'
    ]
};

class Sanitizer {
    constructor() {
        this.stats = {
            sanitized: 0,
            blocked: 0
        };
    }

    /**
     * Sanitize HTML content
     * @param {string} dirty - Untrusted HTML string
     * @param {Object} options - Optional DOMPurify config override
     * @returns {string} Sanitized HTML
     */
    html(dirty, options = {}) {
        if (!dirty || typeof dirty !== 'string') {
            return '';
        }

        this.stats.sanitized++;
        const config = { ...DEFAULT_CONFIG, ...options };

        if (hasDOMPurify) {
            const clean = DOMPurify.sanitize(dirty, config);
            this._logIfDifferent(dirty, clean, 'html');
            return clean;
        }

        return this._fallbackSanitizeHtml(dirty);
    }

    /**
     * Sanitize with strict settings (for AI/user content)
     * @param {string} dirty - Untrusted content
     * @returns {string} Sanitized content
     */
    strict(dirty) {
        if (!dirty || typeof dirty !== 'string') {
            return '';
        }

        this.stats.sanitized++;

        if (hasDOMPurify) {
            const clean = DOMPurify.sanitize(dirty, STRICT_CONFIG);
            this._logIfDifferent(dirty, clean, 'strict');
            return clean;
        }

        return this._fallbackSanitizeText(dirty);
    }

    /**
     * Sanitize for rich text (workspace, flashcards)
     * @param {string} dirty - Untrusted HTML
     * @returns {string} Sanitized HTML
     */
    rich(dirty) {
        if (!dirty || typeof dirty !== 'string') {
            return '';
        }

        this.stats.sanitized++;

        if (hasDOMPurify) {
            const clean = DOMPurify.sanitize(dirty, RICH_CONFIG);
            this._logIfDifferent(dirty, clean, 'rich');
            return clean;
        }

        return this._fallbackSanitizeHtml(dirty);
    }

    /**
     * Convert to plain text (strip all HTML)
     * @param {string} dirty - Untrusted content
     * @returns {string} Plain text only
     */
    text(dirty) {
        if (!dirty || typeof dirty !== 'string') {
            return '';
        }

        this.stats.sanitized++;

        if (hasDOMPurify) {
            return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [], KEEP_CONTENT: true });
        }

        return this._fallbackSanitizeText(dirty);
    }

    /**
     * Sanitize URL
     * @param {string} url - Untrusted URL
     * @returns {string} Safe URL or empty string
     */
    url(url) {
        if (!url || typeof url !== 'string') {
            return '';
        }

        this.stats.sanitized++;
        const trimmed = url.trim();

        // Check for dangerous protocols
        const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
        const lowerUrl = trimmed.toLowerCase();

        for (const protocol of dangerousProtocols) {
            if (lowerUrl.startsWith(protocol)) {
                this.stats.blocked++;
                console.warn('[Sanitizer] Blocked dangerous URL protocol:', protocol);
                return '';
            }
        }

        // Validate URL format
        try {
            const parsed = new URL(trimmed, window.location.origin);

            // Only allow http, https, mailto, and tel
            const allowedProtocols = ['http:', 'https:', 'mailto:', 'tel:'];
            if (!allowedProtocols.includes(parsed.protocol)) {
                this.stats.blocked++;
                return '';
            }

            return parsed.href;
        } catch (e) {
            // If it's a relative URL, it's okay
            if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
                return encodeURI(trimmed);
            }

            // If it starts with # it's an anchor
            if (trimmed.startsWith('#')) {
                return trimmed;
            }

            return '';
        }
    }

    /**
     * Sanitize for use in HTML attributes
     * @param {string} value - Untrusted attribute value
     * @returns {string} Safe attribute value
     */
    attr(value) {
        if (!value || typeof value !== 'string') {
            return '';
        }

        this.stats.sanitized++;

        // Encode special characters for attribute context
        return value
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/`/g, '&#96;');
    }

    /**
     * Sanitize JSON string before parsing
     * @param {string} json - JSON string to validate
     * @returns {Object|null} Parsed object or null
     */
    json(json) {
        if (!json || typeof json !== 'string') {
            return null;
        }

        try {
            return JSON.parse(json);
        } catch (e) {
            console.warn('[Sanitizer] Invalid JSON:', e.message);
            return null;
        }
    }

    /**
     * Get sanitization statistics
     * @returns {Object} Stats object
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = { sanitized: 0, blocked: 0 };
    }

    // ============================================
    // Private Methods - Fallback Sanitization
    // ============================================

    /**
     * Fallback HTML sanitization when DOMPurify unavailable
     * @private
     */
    _fallbackSanitizeHtml(dirty) {
        // Create a temporary element
        const temp = document.createElement('div');
        temp.textContent = dirty;

        // This escapes all HTML
        let escaped = temp.innerHTML;

        // Selectively restore safe tags
        const safeTags = ['b', 'i', 'u', 'strong', 'em', 'p', 'br', 'span'];

        safeTags.forEach(tag => {
            // Restore opening tags
            const openRegex = new RegExp(`&lt;${tag}(&gt;|\\s[^&]*&gt;)`, 'gi');
            escaped = escaped.replace(openRegex, (match) => {
                return match.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            });

            // Restore closing tags
            const closeRegex = new RegExp(`&lt;/${tag}&gt;`, 'gi');
            escaped = escaped.replace(closeRegex, `</${tag}>`);
        });

        return escaped;
    }

    /**
     * Fallback text sanitization
     * @private
     */
    _fallbackSanitizeText(dirty) {
        const temp = document.createElement('div');
        temp.innerHTML = dirty;
        return temp.textContent || temp.innerText || '';
    }

    /**
     * Log if sanitization changed the content
     * @private
     */
    _logIfDifferent(original, sanitized, context) {
        if (original !== sanitized && original.length > 0) {
            this.stats.blocked++;

            // Only log in debug mode to avoid console spam
            if (window.DEBUG_SANITIZER) {
                console.log(`[Sanitizer:${context}] Content modified:`, {
                    originalLength: original.length,
                    sanitizedLength: sanitized.length,
                    removed: original.length - sanitized.length
                });
            }
        }
    }
}

// Create singleton instance
const sanitizer = new Sanitizer();

// Export for ES modules
export { sanitizer, Sanitizer };
export default sanitizer;

// Register globally
window.Sanitizer = sanitizer;
