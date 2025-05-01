// Priority List Sorting functionality
// Priority List Sorting functionality
// Priority List Sorting functionality
// Priority List Sorting functionality
class PriorityListSorter {
    constructor() {
        // Set default sort to priority score descending (high to low)
        this.currentSort = {
            field: 'priorityScore',
            direction: 'desc'  // This ensures high to low sorting
        };
        
        this.init();
        
        // Apply default sorting immediately after initialization
        setTimeout(() => this.sortTasks(), 0);
    }

    init() {
        // Create and add the sorting controls
        this.createSortingControls();

        // Add event listeners
        this.addEventListeners();
    }

    createSortingControls() {
        const container = document.querySelector('.container');
        if (!container) return;
        
        const listHeader = document.querySelector('.list-header');
        if (!listHeader) return;
    
        // Remove any existing controls to avoid duplicates
        const existingControls = document.querySelector('.sorting-controls');
        if (existingControls) {
            existingControls.remove();
        }
        
        // Create sorting controls
        const sortingControls = document.createElement('div');
        sortingControls.className = 'sorting-controls mb-3';
        sortingControls.innerHTML = `
            <div class="d-flex align-items-center gap-3">
                <label for="sortField" class="form-label mb-0">Sort by:</label>
                <select id="sortField" class="form-select form-select-sm" style="width: auto;">
                    <option value="priorityScore" selected>Priority Score</option>
                    <option value="title">Task Name</option>
                    <option value="section">Section</option>
                    <option value="projectName">Project</option>
                    <option value="dueDate">Due Date</option>
                    <option value="createdAt">Created Date</option>
                    <option value="lastInterleaved">Last Interleaved</option>
                </select>
                <button id="sortDirection" class="btn btn-sm btn-outline-secondary">
                    <i class="bi bi-sort-down"></i>
                </button>
            </div>
        `;
    
        // Insert sorting controls before the list header
        container.insertBefore(sortingControls, listHeader);
    }

    addEventListeners() {
        const sortField = document.getElementById('sortField');
        const sortDirection = document.getElementById('sortDirection');
        
        if (!sortField || !sortDirection) return;

        sortField.addEventListener('change', () => {
            this.currentSort.field = sortField.value;
            
            // Automatically set direction to desc for priorityScore
            if (sortField.value === 'priorityScore') {
                this.currentSort.direction = 'desc';
                this.updateSortDirectionButton();
            }
            
            this.sortTasks();
        });

        sortDirection.addEventListener('click', () => {
            this.currentSort.direction = this.currentSort.direction === 'asc' ? 'desc' : 'asc';
            this.updateSortDirectionButton();
            this.sortTasks();
        });
    }

    updateSortDirectionButton() {
        const button = document.getElementById('sortDirection');
        if (!button) return;
        
        const icon = button.querySelector('i');
        if (!icon) return;

        if (this.currentSort.direction === 'asc') {
            icon.className = 'bi bi-sort-up';
        } else {
            icon.className = 'bi bi-sort-down';
        }
    }

    sortTasks() {
        console.log('Sorting tasks with settings:', this.currentSort);
        
        // Make a deep copy to avoid modifying original data
        const tasks = JSON.parse(localStorage.getItem('calculatedPriorityTasks') || '[]');
        if (!tasks || !tasks.length) return;
        
        tasks.sort((a, b) => {
            let comparison = 0;
            const field = this.currentSort.field;
    
            // Handle different field types
            switch (field) {
                case 'priorityScore':
                    comparison = b.priorityScore - a.priorityScore; // Always sort priority score high to low
                    break;
                case 'dueDate':
                    // Handle cases where dates might be missing
                    if (!a.dueDate && !b.dueDate) comparison = 0;
                    else if (!a.dueDate) comparison = 1;
                    else if (!b.dueDate) comparison = -1;
                    else comparison = new Date(a.dueDate) - new Date(b.dueDate);
                    break;
                case 'createdAt':
                    // Handle cases where dates might be missing
                    if (!a.createdAt && !b.createdAt) comparison = 0;
                    else if (!a.createdAt) comparison = 1;
                    else if (!b.createdAt) comparison = -1;
                    else comparison = new Date(a.createdAt) - new Date(b.createdAt);
                    break;
                case 'lastInterleaved':
                    // Special case for interleave date
                    if (!a.lastInterleaved && !b.lastInterleaved) comparison = 0;
                    else if (!a.lastInterleaved) comparison = -1; // Non-interleaved first
                    else if (!b.lastInterleaved) comparison = 1;
                    else comparison = new Date(a.lastInterleaved) - new Date(b.lastInterleaved);
                    break;
                default:
                    // Handle text fields
                    const valueA = (a[field] || '').toString().toLowerCase();
                    const valueB = (b[field] || '').toString().toLowerCase();
                    comparison = valueA.localeCompare(valueB);
            }
    
            // Only apply sort direction for non-priorityScore fields
            // For priorityScore, we always want high to low (desc)
            if (field === 'priorityScore') {
                return comparison; // Already set to desc (b - a) in the switch case
            } else {
                return this.currentSort.direction === 'asc' ? comparison : -comparison;
            }
        });
    
        // Store sort settings in localStorage for persistence
        localStorage.setItem('prioritySortSettings', JSON.stringify(this.currentSort));
        
        // Update localStorage with sorted tasks
        localStorage.setItem('calculatedPriorityTasks', JSON.stringify(tasks));
    
        // Refresh the display
        if (typeof displayTasks === 'function') {
            displayTasks();
        }
        
        // Notify other tabs/windows
        window.dispatchEvent(new StorageEvent('storage', {
            key: 'calculatedPriorityTasks',
            newValue: JSON.stringify(tasks),
            url: window.location.href
        }));
    }
    
    // Apply saved sort settings
    static applySavedSort() {
        try {
            const savedSettings = JSON.parse(localStorage.getItem('prioritySortSettings'));
            if (savedSettings) {
                const sorter = new PriorityListSorter();
                sorter.currentSort = savedSettings;
                
                // Update UI to match saved settings
                const sortField = document.getElementById('sortField');
                if (sortField) sortField.value = savedSettings.field;
                
                sorter.updateSortDirectionButton();
                sorter.sortTasks();
            }
        } catch (error) {
            console.error('Error applying saved sort settings:', error);
            // If there's an error, initialize with defaults
            new PriorityListSorter();
        }
    }
}

// Initialize sorting when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing sorter');
    
    // Clear any existing controls to prevent duplicates
    const existingControls = document.querySelector('.sorting-controls');
    if (existingControls) existingControls.remove();
    
    // Check if we have saved settings
    const savedSettings = localStorage.getItem('prioritySortSettings');
    
    if (savedSettings) {
        console.log('Applying saved sort settings');
        PriorityListSorter.applySavedSort();
    } else {
        console.log('No saved settings, creating new sorter with defaults');
        const sorter = new PriorityListSorter();
        // Force immediate sort
        sorter.sortTasks();
    }
    
    // Force a re-sort after a short delay to ensure everything is loaded
    setTimeout(() => {
        console.log('Performing delayed sort to ensure proper ordering');
        const sorter = new PriorityListSorter();
        sorter.sortTasks();
    }, 500);
});

// Make sorter available globally
window.PriorityListSorter = PriorityListSorter;

// Initialize sorting when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    // Ensure we clear any existing controls first to avoid duplicates
    const existingControls = document.querySelector('.sorting-controls');
    if (existingControls) {
        existingControls.remove();
    }
    
    // Initialize with saved settings or create new
    const savedSettings = localStorage.getItem('prioritySortSettings');
    if (savedSettings) {
        PriorityListSorter.applySavedSort();
    } else {
        new PriorityListSorter();
    }
});

// Make sorter available globally
window.PriorityListSorter = PriorityListSorter;
// Initialize sorting when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize with saved settings or create new
    const savedSettings = localStorage.getItem('prioritySortSettings');
    if (savedSettings) {
        PriorityListSorter.applySavedSort();
    } else {
        new PriorityListSorter();
    }
});

// Make sorter available globally
window.PriorityListSorter = PriorityListSorter;

// Initialize sorting when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    new PriorityListSorter();
});