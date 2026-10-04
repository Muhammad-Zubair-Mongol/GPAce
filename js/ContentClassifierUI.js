/**
 * ContentClassifierUI.js
 * UI components for content classification confirmation modal
 * 
 * Shows users when non-academic tasks are detected and offers
 * to route them to Relaxed Mode
 * 
 * @author GPAce Team
 * @version 1.0.0
 */

class ContentClassifierUI {
    constructor(classifier) {
        this.classifier = classifier || window.contentClassifier;
        this.modalId = 'contentRouterModal';
        this.onConfirm = null;
        this.onCancel = null;

        // Inject styles
        this.injectStyles();
    }

    /**
     * Inject CSS styles
     */
    injectStyles() {
        if (document.getElementById('content-classifier-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'content-classifier-styles';
        styles.textContent = `
            /* Content Router Modal */
            .content-router-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.75);
                backdrop-filter: blur(6px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10002;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease;
            }
            
            .content-router-overlay.active {
                opacity: 1;
                visibility: visible;
            }
            
            .content-router-modal {
                background: var(--bg-primary, #1a1a2e);
                border: 1px solid rgba(147, 112, 219, 0.3);
                border-radius: 20px;
                width: 90%;
                max-width: 520px;
                max-height: 85vh;
                overflow: hidden;
                box-shadow: 0 25px 80px rgba(147, 112, 219, 0.2);
                transform: translateY(30px) scale(0.95);
                transition: transform 0.3s ease;
            }
            
            .content-router-overlay.active .content-router-modal {
                transform: translateY(0) scale(1);
            }
            
            .content-router-header {
                display: flex;
                align-items: center;
                gap: 16px;
                padding: 24px 28px;
                background: linear-gradient(135deg, rgba(147, 112, 219, 0.15), rgba(52, 152, 219, 0.08));
                border-bottom: 1px solid rgba(147, 112, 219, 0.2);
            }
            
            .content-router-icon {
                width: 52px;
                height: 52px;
                background: linear-gradient(135deg, #9b59b6, #3498db);
                border-radius: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                color: white;
                flex-shrink: 0;
            }
            
            .content-router-title-area h3 {
                margin: 0;
                font-size: 18px;
                font-weight: 600;
                color: var(--text-primary, #fff);
            }
            
            .content-router-title-area p {
                margin: 4px 0 0;
                font-size: 13px;
                color: var(--text-secondary, #888);
            }
            
            .content-router-body {
                padding: 24px 28px;
                max-height: 50vh;
                overflow-y: auto;
            }
            
            .content-router-body::-webkit-scrollbar {
                width: 6px;
            }
            
            .content-router-body::-webkit-scrollbar-thumb {
                background: rgba(147, 112, 219, 0.3);
                border-radius: 3px;
            }
            
            /* Task Preview List */
            .relaxed-task-preview {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            
            .relaxed-task-item {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                padding: 14px 16px;
                background: var(--bg-secondary, #252538);
                border: 1px solid rgba(147, 112, 219, 0.15);
                border-radius: 12px;
                transition: all 0.2s;
            }
            
            .relaxed-task-item:hover {
                border-color: rgba(147, 112, 219, 0.4);
                transform: translateX(4px);
            }
            
            .relaxed-task-checkbox {
                width: 20px;
                height: 20px;
                accent-color: #9b59b6;
                margin-top: 2px;
                cursor: pointer;
            }
            
            .relaxed-task-content {
                flex: 1;
                min-width: 0;
            }
            
            .relaxed-task-title {
                font-size: 14px;
                font-weight: 500;
                color: var(--text-primary, #e0e0e0);
                margin-bottom: 4px;
                word-break: break-word;
            }
            
            .relaxed-task-meta {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            
            .relaxed-category-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 3px 10px;
                background: rgba(147, 112, 219, 0.2);
                border-radius: 12px;
                font-size: 11px;
                color: #9b59b6;
                text-transform: capitalize;
            }
            
            .relaxed-category-badge i {
                font-size: 10px;
            }
            
            /* Category Colors */
            .relaxed-category-badge.sports { background: rgba(46, 204, 113, 0.2); color: #2ecc71; }
            .relaxed-category-badge.music { background: rgba(241, 196, 15, 0.2); color: #f1c40f; }
            .relaxed-category-badge.arts { background: rgba(231, 76, 60, 0.2); color: #e74c3c; }
            .relaxed-category-badge.clubs { background: rgba(52, 152, 219, 0.2); color: #3498db; }
            .relaxed-category-badge.volunteering { background: rgba(26, 188, 156, 0.2); color: #1abc9c; }
            .relaxed-category-badge.health { background: rgba(155, 89, 182, 0.2); color: #9b59b6; }
            .relaxed-category-badge.fitness { background: rgba(46, 204, 113, 0.2); color: #2ecc71; }
            .relaxed-category-badge.entertainment { background: rgba(241, 196, 15, 0.2); color: #f1c40f; }
            .relaxed-category-badge.hobby { background: rgba(230, 126, 34, 0.2); color: #e67e22; }
            .relaxed-category-badge.social { background: rgba(52, 73, 94, 0.3); color: #95a5a6; }
            
            /* Footer */
            .content-router-footer {
                display: flex;
                flex-direction: column;
                gap: 16px;
                padding: 20px 28px 28px;
                border-top: 1px solid var(--border-color, #333);
                background: rgba(0, 0, 0, 0.15);
            }
            
            .session-remember-toggle {
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 13px;
                color: var(--text-secondary, #888);
            }
            
            .session-remember-toggle input {
                accent-color: #9b59b6;
            }
            
            .content-router-actions {
                display: flex;
                gap: 12px;
            }
            
            .content-router-btn {
                flex: 1;
                padding: 14px 20px;
                border: none;
                border-radius: 12px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }
            
            .content-router-btn.primary {
                background: linear-gradient(135deg, #9b59b6, #8e44ad);
                color: white;
            }
            
            .content-router-btn.primary:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 20px rgba(147, 112, 219, 0.4);
            }
            
            .content-router-btn.secondary {
                background: var(--bg-secondary, #252538);
                color: var(--text-secondary, #888);
                border: 1px solid var(--border-color, #444);
            }
            
            .content-router-btn.secondary:hover {
                background: rgba(255, 255, 255, 0.05);
                color: var(--text-primary, #fff);
            }
            
            .content-router-btn.tertiary {
                background: none;
                color: var(--text-secondary, #666);
                flex: 0;
                padding: 14px 16px;
            }
            
            .content-router-btn.tertiary:hover {
                color: var(--text-primary, #fff);
            }
            
            /* Summary indicator */
            .classification-summary {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                background: rgba(52, 152, 219, 0.1);
                border: 1px solid rgba(52, 152, 219, 0.2);
                border-radius: 10px;
                margin-bottom: 16px;
                font-size: 13px;
                color: var(--text-secondary, #888);
            }
            
            .classification-summary .summary-icon {
                font-size: 20px;
            }
            
            .classification-summary strong {
                color: var(--text-primary, #fff);
            }
        `;

        document.head.appendChild(styles);
    }

    /**
     * Show the confirmation modal
     * @param {Array} relaxedTasks - Tasks detected as relaxed/extracurricular
     * @param {number} academicCount - Count of academic tasks
     * @returns {Promise<Object>} User's choice: { confirmed: boolean, selectedTasks: [], skipFuture: boolean }
     */
    showConfirmation(relaxedTasks, academicCount = 0) {
        return new Promise((resolve) => {
            // Check if user has opted to skip for this session
            if (this.classifier?.sessionSkipConfirmation) {
                resolve({ confirmed: false, selectedTasks: [], skipFuture: false });
                return;
            }

            const modal = this.createModal(relaxedTasks, academicCount);
            document.body.appendChild(modal);

            // Show with animation
            requestAnimationFrame(() => {
                modal.classList.add('active');
            });

            // Store resolve for button handlers
            modal._resolve = resolve;
        });
    }

    /**
     * Create the modal element
     */
    createModal(relaxedTasks, academicCount) {
        const overlay = document.createElement('div');
        overlay.id = this.modalId;
        overlay.className = 'content-router-overlay';

        // Get category icons
        const getCategoryIcon = (category) => {
            const icons = {
                'sports': 'bi-trophy',
                'music': 'bi-music-note-beamed',
                'arts': 'bi-palette',
                'clubs': 'bi-people',
                'volunteering': 'bi-heart',
                'health': 'bi-heart-pulse',
                'fitness': 'bi-bicycle',
                'entertainment': 'bi-film',
                'hobby': 'bi-puzzle',
                'social': 'bi-chat-dots',
                'personal': 'bi-person',
                'travel': 'bi-airplane',
                'family': 'bi-house-heart',
                'other': 'bi-star'
            };
            return icons[category] || 'bi-star';
        };

        overlay.innerHTML = `
            <div class="content-router-modal">
                <div class="content-router-header">
                    <div class="content-router-icon">
                        <i class="bi bi-magic"></i>
                    </div>
                    <div class="content-router-title-area">
                        <h3>We found non-academic items!</h3>
                        <p>These look like extracurricular activities or personal tasks</p>
                    </div>
                </div>
                
                <div class="content-router-body">
                    <div class="classification-summary">
                        <span class="summary-icon">📊</span>
                        <span><strong>${academicCount}</strong> academic task${academicCount !== 1 ? 's' : ''} • <strong>${relaxedTasks.length}</strong> relaxed/extracurricular</span>
                    </div>
                    
                    <div class="relaxed-task-preview" id="relaxedTaskPreview">
                        ${relaxedTasks.map((task, index) => `
                            <div class="relaxed-task-item">
                                <input type="checkbox" class="relaxed-task-checkbox" data-index="${index}" checked>
                                <div class="relaxed-task-content">
                                    <div class="relaxed-task-title">${this.escapeHtml(task.content || task.title || 'Untitled')}</div>
                                    <div class="relaxed-task-meta">
                                        <span class="relaxed-category-badge ${task.relaxedCategory || 'other'}">
                                            <i class="bi ${getCategoryIcon(task.relaxedCategory)}"></i>
                                            ${task.relaxedCategory || 'other'}
                                        </span>
                                        ${task.dueDate ? `<span style="font-size: 11px; color: #888;">📅 ${task.dueDate}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="content-router-footer">
                    <label class="session-remember-toggle">
                        <input type="checkbox" id="skipFutureConfirmation">
                        <span>Don't ask again for this session</span>
                    </label>
                    
                    <div class="content-router-actions">
                        <button class="content-router-btn tertiary" id="routerCancelBtn">
                            Cancel
                        </button>
                        <button class="content-router-btn secondary" id="routerIgnoreBtn">
                            <i class="bi bi-x-lg"></i> Ignore
                        </button>
                        <button class="content-router-btn primary" id="routerConfirmBtn">
                            <i class="bi bi-check-lg"></i> Send to Relaxed Mode
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add event listeners
        setTimeout(() => {
            const confirmBtn = overlay.querySelector('#routerConfirmBtn');
            const ignoreBtn = overlay.querySelector('#routerIgnoreBtn');
            const cancelBtn = overlay.querySelector('#routerCancelBtn');
            const skipCheckbox = overlay.querySelector('#skipFutureConfirmation');

            confirmBtn?.addEventListener('click', () => {
                const checkboxes = overlay.querySelectorAll('.relaxed-task-checkbox:checked');
                const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));
                const selectedTasks = selectedIndices.map(i => relaxedTasks[i]).filter(Boolean);
                const skipFuture = skipCheckbox?.checked || false;

                if (skipFuture && this.classifier) {
                    this.classifier.sessionSkipConfirmation = true;
                }

                this.hideModal();
                overlay._resolve({
                    confirmed: true,
                    selectedTasks,
                    skipFuture
                });
            });

            ignoreBtn?.addEventListener('click', () => {
                const skipFuture = skipCheckbox?.checked || false;
                if (skipFuture && this.classifier) {
                    this.classifier.sessionSkipConfirmation = true;
                }
                this.hideModal();
                overlay._resolve({
                    confirmed: false,
                    selectedTasks: [],
                    skipFuture
                });
            });

            cancelBtn?.addEventListener('click', () => {
                this.hideModal();
                overlay._resolve({
                    confirmed: false,
                    selectedTasks: [],
                    skipFuture: false,
                    cancelled: true
                });
            });

            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.hideModal();
                    overlay._resolve({
                        confirmed: false,
                        selectedTasks: [],
                        skipFuture: false,
                        cancelled: true
                    });
                }
            });
        }, 0);

        return overlay;
    }

    /**
     * Hide and remove the modal
     */
    hideModal() {
        const overlay = document.getElementById(this.modalId);
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        }
    }

    /**
     * Show a success toast
     */
    showSuccessToast(count) {
        const toast = document.createElement('div');
        toast.className = 'classification-toast success';
        toast.innerHTML = `
            <i class="bi bi-check-circle-fill"></i>
            <span>Added ${count} task${count !== 1 ? 's' : ''} to Relaxed Mode!</span>
        `;
        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            padding: 14px 24px;
            background: linear-gradient(135deg, #27ae60, #2ecc71);
            color: white;
            border-radius: 12px;
            font-size: 14px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 10003;
            box-shadow: 0 8px 24px rgba(46, 204, 113, 0.3);
            animation: slideUp 0.3s ease;
        `;

        // Add animation keyframes if not exists
        if (!document.getElementById('toast-animations')) {
            const animStyle = document.createElement('style');
            animStyle.id = 'toast-animations';
            animStyle.textContent = `
                @keyframes slideUp {
                    from { transform: translateX(-50%) translateY(20px); opacity: 0; }
                    to { transform: translateX(-50%) translateY(0); opacity: 1; }
                }
                @keyframes slideDown {
                    from { transform: translateX(-50%) translateY(0); opacity: 1; }
                    to { transform: translateX(-50%) translateY(20px); opacity: 0; }
                }
            `;
            document.head.appendChild(animStyle);
        }

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideDown 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    /**
     * Helper to escape HTML
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Create singleton instance
const contentClassifierUI = new ContentClassifierUI();

// Expose globally
window.ContentClassifierUI = ContentClassifierUI;
window.contentClassifierUI = contentClassifierUI;

// Export for ES modules
export { ContentClassifierUI, contentClassifierUI };
export default contentClassifierUI;
