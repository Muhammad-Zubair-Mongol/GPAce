/**
 * Role Model Manager
 * Handles role model management functionality including adding, displaying, researching, and deleting role models
 */
class RoleModelManager {
    constructor() {
        this.roleModelNameInput = null;
        this.roleModelImageInput = null;
        this.roleModelList = null;
        this.roleModelResearch = null;
        this.addRoleModelBtn = null;
        
        // Initialize on DOM content loaded
        document.addEventListener('DOMContentLoaded', () => this.init());
    }

    init() {
        // Get references to DOM elements
        this.roleModelNameInput = document.getElementById('roleModelName');
        this.roleModelImageInput = document.getElementById('roleModelImage');
        this.roleModelList = document.getElementById('roleModelList');
        this.roleModelResearch = document.getElementById('roleModelResearch');
        this.addRoleModelBtn = document.querySelector('.role-model-input-container .interactive-button');
        
        // Add event listener to add role model button
        if (this.addRoleModelBtn) {
            this.addRoleModelBtn.addEventListener('click', () => this.addRoleModel());
        }
        
        // Render existing role models
        this.renderRoleModels();
    }

    addRoleModel() {
        const roleModelName = this.roleModelNameInput?.value;
        const roleModelImage = this.roleModelImageInput?.value;

        if (!roleModelName) {
            alert('Please enter role model name');
            return;
        }

        // Check Gemini API key
        if (!window.geminiApi || !window.geminiApi.apiKey) {
            const apiKey = prompt('Enter your Google AI API Key:');
            if (apiKey) {
                // Reinitialize with new API key
                window.geminiApi = new GeminiApiService(apiKey);
            } else {
                alert('API key is required to research role models');
                return;
            }
        }

        try {
            const roleModels = JSON.parse(localStorage.getItem('roleModels') || '[]');
            roleModels.push({
                name: roleModelName,
                image: roleModelImage,
                research: null  // Placeholder for research
            });
            localStorage.setItem('roleModels', JSON.stringify(roleModels));

            this.renderRoleModels();
            this.clearRoleModelInputs();
            this.fetchRoleModelQuote(roleModelName);
            this.researchRoleModel(roleModelName);
            
            // Play sound if sound manager is available
            if (window.soundManager) {
                window.soundManager.playSound('click', 'confirm');
            }
        } catch (error) {
            console.error('Error adding role model:', error);
            alert('Failed to add role model. Please try again.');
        }
    }

    renderRoleModels() {
        if (!this.roleModelList) return;
        
        try {
            const roleModels = JSON.parse(localStorage.getItem('roleModels') || '[]');

            this.roleModelList.innerHTML = roleModels.map((model, index) => `
                <div class="role-model-card">
                    ${model.image ? `<img src="${model.image}" alt="${model.name}" class="role-model-image">` : ''}
                    <h3>${model.name}</h3>
                    <div id="quote-${model.name.replace(/\\s+/g, '-')}"></div>
                    ${model.research ? `
                        <div class="role-model-research-preview">
                            <h4>Research Highlights</h4>
                            ${model.research.slice(0, 1).map(research => `
                                <p>${research.title}</p>
                            `).join('')}
                        </div>
                    ` : ''}
                    <div class="role-model-actions">
                        <button class="interactive-button research-button" data-name="${model.name}">Refresh Research</button>
                        <button class="delete-role-model" data-index="${index}">Delete</button>
                    </div>
                </div>
            `).join('');
            
            // Add event listeners to buttons
            document.querySelectorAll('.research-button').forEach(button => {
                button.addEventListener('click', (e) => {
                    const name = e.target.getAttribute('data-name');
                    this.researchRoleModel(name);
                });
            });
            
            document.querySelectorAll('.delete-role-model').forEach(button => {
                button.addEventListener('click', (e) => {
                    const index = parseInt(e.target.getAttribute('data-index'));
                    this.deleteRoleModel(index);
                });
            });
        } catch (error) {
            console.error('Error rendering role models:', error);
            this.roleModelList.innerHTML = '<p>Error loading role models. Please refresh the page.</p>';
        }
    }

    async researchRoleModel(name) {
        if (!this.roleModelResearch) return;
        
        this.roleModelResearch.innerHTML = `
            <div class="research-loading">
                <p>Researching ${name}...</p>
                <div class="spinner">🔍</div>
            </div>
        `;

        try {
            // Validate Gemini API availability
            if (!window.geminiApi || typeof window.geminiApi.research !== 'function') {
                throw new Error('Gemini API not properly initialized');
            }

            const researchResults = await window.geminiApi.research({
                query: `Provide key academic and professional achievements of ${name}`,
                maxResults: 5
            });

            // Validate research results
            if (!researchResults || researchResults.length === 0) {
                throw new Error('No research results found');
            }

            // Process and display research results
            const researchHtml = researchResults.map(result => `
                <div class="role-model-research-card">
                    <h4>${result.title}</h4>
                    <p>${result.description}</p>
                    ${result.image ? `<img src="${result.image}" alt="${result.title}" class="role-model-image">` : ''}
                </div>
            `).join('');

            this.roleModelResearch.innerHTML = `
                <h3>Research on ${name}</h3>
                <div class="role-model-research-content">
                    ${researchHtml}
                </div>
            `;

            // Update role model in localStorage with research
            const roleModels = JSON.parse(localStorage.getItem('roleModels') || '[]');
            const updatedRoleModels = roleModels.map(model =>
                model.name === name
                    ? { ...model, research: researchResults }
                    : model
            );
            localStorage.setItem('roleModels', JSON.stringify(updatedRoleModels));

            // Trigger role models refresh
            this.renderRoleModels();

            // Update quote container
            const quoteContainer = document.getElementById(`quote-${name.replace(/\\s+/g, '-')}`);
            if (quoteContainer && !quoteContainer.innerHTML.trim() && researchResults.length > 0) {
                const firstResult = researchResults[0];
                quoteContainer.innerHTML = `
                    <p class="quote-text">"${firstResult.description}"</p>
                    <p class="quote-author">About ${name}</p>
                `;
            }
            
            // Play sound if sound manager is available
            if (window.soundManager) {
                window.soundManager.playSound('transition', 'default');
            }

        } catch (error) {
            console.error('Role model research failed:', error);

            // Detailed error handling
            let errorMessage = 'Could not research role model. ';
            if (error.message.includes('API key')) {
                errorMessage += 'Please check your API configuration.';
            } else if (error.message.includes('network')) {
                errorMessage += 'Check your internet connection.';
            } else {
                errorMessage += 'An unexpected error occurred.';
            }

            this.roleModelResearch.innerHTML = `
                <div class="error-message">
                    <p>${errorMessage}</p>
                    <button class="interactive-button retry-research" data-name="${name}">
                        Try Again
                    </button>
                </div>
            `;
            
            // Add event listener to retry button
            document.querySelector('.retry-research')?.addEventListener('click', (e) => {
                const name = e.target.getAttribute('data-name');
                this.researchRoleModel(name);
            });
        }
    }

    async fetchRoleModelQuote(name) {
        try {
            const response = await axios.get(`https://api.quotable.io/quotes/random?author=${encodeURIComponent(name)}`);
            const quote = response.data[0];

            if (quote) {
                const quoteContainer = document.getElementById(`quote-${name.replace(/\\s+/g, '-')}`);
                if (quoteContainer) {
                    quoteContainer.innerHTML = `
                        <p>"${quote.content}"</p>
                    `;
                }
            }
        } catch (error) {
            console.error('Could not fetch quote:', error);
        }
    }

    deleteRoleModel(index) {
        try {
            const roleModels = JSON.parse(localStorage.getItem('roleModels') || '[]');
            roleModels.splice(index, 1);
            localStorage.setItem('roleModels', JSON.stringify(roleModels));
            this.renderRoleModels();
            
            // Clear research container
            if (this.roleModelResearch) {
                this.roleModelResearch.innerHTML = '';
            }
            
            // Play sound if sound manager is available
            if (window.soundManager) {
                window.soundManager.playSound('click', 'default');
            }
        } catch (error) {
            console.error('Error deleting role model:', error);
            alert('Failed to delete role model. Please try again.');
        }
    }

    clearRoleModelInputs() {
        if (this.roleModelNameInput) this.roleModelNameInput.value = '';
        if (this.roleModelImageInput) this.roleModelImageInput.value = '';
    }
}

// Initialize role model manager
const roleModelManager = new RoleModelManager();

// Export for use in other modules
window.roleModelManager = roleModelManager;
