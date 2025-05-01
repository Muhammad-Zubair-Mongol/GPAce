class RecipeManager {
    constructor() {
        this.recipes = [];
        this.flashcards = [];
        this.init();
    }

    init() {
        this.loadRecipes();
        this.loadFlashcards();
        this.setupEventListeners();
    }

    loadRecipes() {
        const savedRecipes = localStorage.getItem('recipes');
        this.recipes = savedRecipes ? JSON.parse(savedRecipes) : [];
        this.renderRecipes();
    }

    loadFlashcards() {
        const savedFlashcards = localStorage.getItem('recipe_flashcards');
        this.flashcards = savedFlashcards ? JSON.parse(savedFlashcards) : [];
        this.renderFlashcards();
    }

    setupEventListeners() {
        // Add Recipe Form Submission
        const saveRecipeBtn = document.getElementById('saveRecipeBtn');
        if (saveRecipeBtn) {
            saveRecipeBtn.addEventListener('click', () => this.saveRecipe());
        }

        // Add Flashcard Form Submission
        const saveFlashcardBtn = document.getElementById('saveFlashcardBtn');
        if (saveFlashcardBtn) {
            saveFlashcardBtn.addEventListener('click', () => this.saveFlashcard());
        }

        // Search functionality
        const searchInput = document.getElementById('recipeSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.searchRecipes(e.target.value));
        }

        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.filterRecipes(btn.dataset.category);
            });
        });
    }

    saveRecipe() {
        const recipeName = document.getElementById('recipeName').value;
        const recipeCategory = document.getElementById('recipeCategory').value;
        const recipeDescription = document.getElementById('recipeDescription').value;
        const prepTime = document.getElementById('prepTime').value;
        const cookTime = document.getElementById('cookTime').value;
        const recipeIngredients = document.getElementById('recipeIngredients').value;
        const recipeInstructions = document.getElementById('recipeInstructions').value;
        const recipeTags = document.getElementById('recipeTags').value;

        if (!recipeName) {
            this.showNotification('Please enter a recipe name', 'error');
            return;
        }

        // Create recipe object
        const recipe = {
            id: Date.now(),
            name: recipeName,
            category: recipeCategory,
            description: recipeDescription,
            prepTime: prepTime,
            cookTime: cookTime,
            ingredients: recipeIngredients.split('\n').filter(item => item.trim() !== ''),
            instructions: recipeInstructions,
            tags: recipeTags.split(',').map(tag => tag.trim()).filter(tag => tag !== ''),
            dateAdded: new Date().toISOString()
        };

        // Add to recipes array
        this.recipes.push(recipe);
        
        // Save to localStorage
        localStorage.setItem('recipes', JSON.stringify(this.recipes));

        // Close modal and reset form
        const modal = bootstrap.Modal.getInstance(document.getElementById('addRecipeModal'));
        modal.hide();
        document.getElementById('recipeForm').reset();

        // Show success message
        this.showNotification('Recipe saved successfully!', 'success');
        
        // Render recipes
        this.renderRecipes();
        
        // Create a flashcard automatically
        this.createFlashcardFromRecipe(recipe);
    }

    saveFlashcard() {
        const flashcardTitle = document.getElementById('flashcardTitle').value;
        const flashcardFront = document.getElementById('flashcardFront').value;
        const flashcardBack = document.getElementById('flashcardBack').value;

        if (!flashcardTitle || !flashcardFront || !flashcardBack) {
            this.showNotification('Please fill in all flashcard fields', 'error');
            return;
        }

        // Create flashcard object
        const flashcard = {
            id: Date.now(),
            title: flashcardTitle,
            front: flashcardFront,
            back: flashcardBack,
            dateAdded: new Date().toISOString()
        };

        // Add to flashcards array
        this.flashcards.push(flashcard);
        
        // Save to localStorage
        localStorage.setItem('recipe_flashcards', JSON.stringify(this.flashcards));

        // Close modal and reset form
        const modal = bootstrap.Modal.getInstance(document.getElementById('addFlashcardModal'));
        modal.hide();
        document.getElementById('flashcardForm').reset();

        // Show success message
        this.showNotification('Flashcard saved successfully!', 'success');
        
        // Render flashcards
        this.renderFlashcards();
    }

    createFlashcardFromRecipe(recipe) {
        // Extract key information for the flashcard
        const ingredients = recipe.ingredients.slice(0, 3).join(', ') + (recipe.ingredients.length > 3 ? '...' : '');
        const instructions = recipe.instructions.length > 100 ? recipe.instructions.substring(0, 100) + '...' : recipe.instructions;
        
        // Create flashcard object
        const flashcard = {
            id: Date.now(),
            title: recipe.name,
            front: `${recipe.name}\n${recipe.description || 'A delicious recipe'}`,
            back: `Ingredients: ${ingredients}\nInstructions: ${instructions}`,
            dateAdded: new Date().toISOString()
        };

        // Add to flashcards array
        this.flashcards.push(flashcard);
        
        // Save to localStorage
        localStorage.setItem('recipe_flashcards', JSON.stringify(this.flashcards));
        
        // Render flashcards
        this.renderFlashcards();
    }

    renderRecipes() {
        const recipeGrid = document.querySelector('.recipe-grid');
        if (!recipeGrid) return;

        // Clear existing recipes
        recipeGrid.innerHTML = '';

        if (this.recipes.length === 0) {
            recipeGrid.innerHTML = '<div class="no-recipes">No recipes found. Add your first recipe!</div>';
            return;
        }

        // Sort recipes by date (newest first)
        const sortedRecipes = [...this.recipes].sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));

        // Render each recipe
        sortedRecipes.forEach(recipe => {
            const recipeCard = document.createElement('div');
            recipeCard.className = 'recipe-card';
            
            // Generate a consistent image based on recipe name
            const imageSeed = encodeURIComponent(recipe.name.toLowerCase().replace(/\s+/g, '-'));
            
            recipeCard.innerHTML = `
                <img src="https://source.unsplash.com/300x200/?${imageSeed}" alt="${recipe.name}" class="recipe-image">
                <div class="recipe-content">
                    <h3 class="recipe-title">${recipe.name}</h3>
                    <p class="recipe-description">${recipe.description || 'No description provided.'}</p>
                    <div class="recipe-meta">
                        <span><i class="bi bi-clock"></i> ${recipe.prepTime ? recipe.prepTime + ' mins prep' : 'N/A'}</span>
                        <span><i class="bi bi-fire"></i> ${recipe.cookTime ? recipe.cookTime + ' mins cook' : 'N/A'}</span>
                    </div>
                    <div class="recipe-tags">
                        ${recipe.tags.map(tag => `<span class="recipe-tag">${tag}</span>`).join('')}
                    </div>
                    <div class="recipe-actions mt-3">
                        <button class="btn btn-sm btn-outline-primary view-recipe" data-id="${recipe.id}">
                            <i class="bi bi-eye"></i> View
                        </button>
                        <button class="btn btn-sm btn-outline-danger delete-recipe" data-id="${recipe.id}">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </div>
                </div>
            `;
            
            recipeGrid.appendChild(recipeCard);
            
            // Add event listeners
            recipeCard.querySelector('.view-recipe').addEventListener('click', () => this.viewRecipe(recipe.id));
            recipeCard.querySelector('.delete-recipe').addEventListener('click', () => this.deleteRecipe(recipe.id));
        });
    }

    renderFlashcards() {
        const flashcardContainer = document.querySelector('.flashcard-container .row');
        if (!flashcardContainer) return;

        // Clear existing flashcards
        flashcardContainer.innerHTML = '';

        if (this.flashcards.length === 0) {
            // Add default flashcards if none exist
            this.addDefaultFlashcards();
            return;
        }

        // Sort flashcards by date (newest first)
        const sortedFlashcards = [...this.flashcards].sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));

        // Render each flashcard (up to 6)
        sortedFlashcards.slice(0, 6).forEach(flashcard => {
            const flashcardCol = document.createElement('div');
            flashcardCol.className = 'col-md-4 mb-4';
            
            flashcardCol.innerHTML = `
                <div class="flashcard">
                    <div class="flashcard-inner">
                        <div class="flashcard-front">
                            <h3 class="flashcard-title">${flashcard.title}</h3>
                            <p>${flashcard.front.split('\n')[1] || ''}</p>
                        </div>
                        <div class="flashcard-back">
                            <h3 class="flashcard-title">Instructions</h3>
                            <p class="flashcard-content">${flashcard.back}</p>
                        </div>
                    </div>
                </div>
            `;
            
            flashcardContainer.appendChild(flashcardCol);
        });
    }

    addDefaultFlashcards() {
        const defaultFlashcards = [
            {
                id: 1,
                title: 'Pasta Carbonara',
                front: 'Pasta Carbonara\nClassic Italian pasta dish',
                back: 'Cook pasta, mix eggs with cheese, combine with hot pasta, add bacon',
                dateAdded: new Date().toISOString()
            },
            {
                id: 2,
                title: 'Chicken Curry',
                front: 'Chicken Curry\nSpicy Indian-inspired dish',
                back: 'Sauté onions, add spices, brown chicken, simmer with coconut milk',
                dateAdded: new Date().toISOString()
            },
            {
                id: 3,
                title: 'Chocolate Chip Cookies',
                front: 'Chocolate Chip Cookies\nClassic dessert recipe',
                back: 'Cream butter and sugar, add eggs, mix in dry ingredients, fold in chocolate chips',
                dateAdded: new Date().toISOString()
            }
        ];

        this.flashcards = defaultFlashcards;
        localStorage.setItem('recipe_flashcards', JSON.stringify(this.flashcards));
        this.renderFlashcards();
    }

    viewRecipe(id) {
        const recipe = this.recipes.find(r => r.id === id);
        if (!recipe) return;

        // Create modal content
        const modalContent = `
            <div class="modal-header">
                <h5 class="modal-title">${recipe.name}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" style="filter: invert(1);"></button>
            </div>
            <div class="modal-body">
                <p class="recipe-description">${recipe.description || 'No description provided.'}</p>
                
                <div class="recipe-meta mb-3">
                    <span class="me-3"><i class="bi bi-clock"></i> Prep: ${recipe.prepTime || 'N/A'} mins</span>
                    <span><i class="bi bi-fire"></i> Cook: ${recipe.cookTime || 'N/A'} mins</span>
                </div>
                
                <h6>Ingredients:</h6>
                <ul class="ingredients-list">
                    ${recipe.ingredients.map(ingredient => `<li>${ingredient}</li>`).join('')}
                </ul>
                
                <h6>Instructions:</h6>
                <div class="instructions">
                    ${recipe.instructions.split('\n').map(step => `<p>${step}</p>`).join('')}
                </div>
                
                <div class="recipe-tags mt-3">
                    ${recipe.tags.map(tag => `<span class="recipe-tag">${tag}</span>`).join('')}
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                <button type="button" class="btn btn-primary create-flashcard-btn" data-id="${recipe.id}">Create Flashcard</button>
            </div>
        `;

        // Create or update modal
        let viewModal = document.getElementById('viewRecipeModal');
        
        if (!viewModal) {
            viewModal = document.createElement('div');
            viewModal.className = 'modal fade';
            viewModal.id = 'viewRecipeModal';
            viewModal.setAttribute('tabindex', '-1');
            viewModal.setAttribute('aria-hidden', 'true');
            viewModal.innerHTML = `
                <div class="modal-dialog modal-lg">
                    <div class="modal-content" style="background-color: var(--card-bg); color: var(--text-color);">
                        ${modalContent}
                    </div>
                </div>
            `;
            document.body.appendChild(viewModal);
        } else {
            viewModal.querySelector('.modal-content').innerHTML = modalContent;
        }

        // Initialize modal
        const modal = new bootstrap.Modal(viewModal);
        modal.show();

        // Add event listener for create flashcard button
        viewModal.querySelector('.create-flashcard-btn').addEventListener('click', () => {
            this.createFlashcardFromRecipe(recipe);
            this.showNotification('Flashcard created successfully!', 'success');
        });
    }

    deleteRecipe(id) {
        if (confirm('Are you sure you want to delete this recipe?')) {
            this.recipes = this.recipes.filter(recipe => recipe.id !== id);
            localStorage.setItem('recipes', JSON.stringify(this.recipes));
            this.renderRecipes();
            this.showNotification('Recipe deleted successfully!', 'success');
        }
    }

    searchRecipes(query) {
        if (!query) {
            this.renderRecipes();
            return;
        }

        const filteredRecipes = this.recipes.filter(recipe => {
            const searchString = `${recipe.name} ${recipe.description} ${recipe.tags.join(' ')}`.toLowerCase();
            return searchString.includes(query.toLowerCase());
        });

        this.renderFilteredRecipes(filteredRecipes);
    }

    filterRecipes(category) {
        if (!category || category === 'all') {
            this.renderRecipes();
            return;
        }

        const filteredRecipes = this.recipes.filter(recipe => recipe.category === category);
        this.renderFilteredRecipes(filteredRecipes);
    }

    renderFilteredRecipes(filteredRecipes) {
        const recipeGrid = document.querySelector('.recipe-grid');
        if (!recipeGrid) return;

        // Clear existing recipes
        recipeGrid.innerHTML = '';

        if (filteredRecipes.length === 0) {
            recipeGrid.innerHTML = '<div class="no-recipes">No matching recipes found.</div>';
            return;
        }

        // Render each filtered recipe
        filteredRecipes.forEach(recipe => {
            const recipeCard = document.createElement('div');
            recipeCard.className = 'recipe-card';
            
            // Generate a consistent image based on recipe name
            const imageSeed = encodeURIComponent(recipe.name.toLowerCase().replace(/\s+/g, '-'));
            
            recipeCard.innerHTML = `
                <img src="https://source.unsplash.com/300x200/?${imageSeed}" alt="${recipe.name}" class="recipe-image">
                <div class="recipe-content">
                    <h3 class="recipe-title">${recipe.name}</h3>
                    <p class="recipe-description">${recipe.description || 'No description provided.'}</p>
                    <div class="recipe-meta">
                        <span><i class="bi bi-clock"></i> ${recipe.prepTime ? recipe.prepTime + ' mins prep' : 'N/A'}</span>
                        <span><i class="bi bi-fire"></i> ${recipe.cookTime ? recipe.cookTime + ' mins cook' : 'N/A'}</span>
                    </div>
                    <div class="recipe-tags">
                        ${recipe.tags.map(tag => `<span class="recipe-tag">${tag}</span>`).join('')}
                    </div>
                    <div class="recipe-actions mt-3">
                        <button class="btn btn-sm btn-outline-primary view-recipe" data-id="${recipe.id}">
                            <i class="bi bi-eye"></i> View
                        </button>
                        <button class="btn btn-sm btn-outline-danger delete-recipe" data-id="${recipe.id}">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </div>
                </div>
            `;
            
            recipeGrid.appendChild(recipeCard);
            
            // Add event listeners
            recipeCard.querySelector('.view-recipe').addEventListener('click', () => this.viewRecipe(recipe.id));
            recipeCard.querySelector('.delete-recipe').addEventListener('click', () => this.deleteRecipe(recipe.id));
        });
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="bi ${type === 'success' ? 'bi-check-circle' : type === 'error' ? 'bi-exclamation-circle' : 'bi-info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;
        
        // Add to document
        document.body.appendChild(notification);
        
        // Show notification
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    }
}

// Initialize the recipe manager
document.addEventListener('DOMContentLoaded', () => {
    window.recipeManager = new RecipeManager();
}); 