class TaskFilters {
    constructor(todoistIntegration) {
        this.todoistIntegration = todoistIntegration;
        this.filters = {
            priority: '',
            project: '',
            section: '',
            dateFrom: '',
            dateTo: ''
        };
        this.sections = {};  // Store sections by project ID
        this.init();
    }

    init() {
        this.setupFilterListeners();
        this.populateProjects();
    }

    setupFilterListeners() {
        // Priority filter
        const priorityFilter = document.getElementById('priorityFilter');
        if (priorityFilter) {
            priorityFilter.addEventListener('change', (e) => {
                this.filters.priority = e.target.value;
                this.applyFilters();
            });
        }

        // Project filter
        const projectFilter = document.getElementById('projectFilter');
        if (projectFilter) {
            projectFilter.addEventListener('change', (e) => {
                this.filters.project = e.target.value;
                this.filters.section = ''; // Reset section when project changes
                this.populateSections(e.target.value);
                this.applyFilters();
            });
        }

        // Section filter
        const sectionFilter = document.getElementById('sectionFilter');
        if (sectionFilter) {
            sectionFilter.addEventListener('change', (e) => {
                this.filters.section = e.target.value;
                this.applyFilters();
            });
        }

        // Date range filters
        const dateFrom = document.getElementById('dateFrom');
        const dateTo = document.getElementById('dateTo');
        if (dateFrom && dateTo) {
            dateFrom.addEventListener('change', (e) => {
                this.filters.dateFrom = e.target.value;
                this.applyFilters();
            });
            dateTo.addEventListener('change', (e) => {
                this.filters.dateTo = e.target.value;
                this.applyFilters();
            });
        }

        // Clear filters button
        const clearFiltersBtn = document.getElementById('clearFilters');
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', () => this.clearFilters());
        }
    }

    async populateProjects() {
        try {
            const projects = await this.todoistIntegration.getProjects();
            const projectFilter = document.getElementById('projectFilter');
            if (projectFilter && projects) {
                projects.forEach(project => {
                    const option = document.createElement('option');
                    option.value = project.id;
                    option.textContent = project.name;
                    projectFilter.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Error populating projects:', error);
        }
    }

    async populateSections(projectId) {
        try {
            const sectionFilter = document.getElementById('sectionFilter');
            if (!sectionFilter) return;

            // Clear existing sections
            sectionFilter.innerHTML = '<option value="">All Sections</option>';
            
            if (!projectId) return;

            // Get sections for the selected project
            const sections = await this.todoistIntegration.getSections(projectId);
            this.sections[projectId] = sections;

            if (sections) {
                sections.forEach(section => {
                    const option = document.createElement('option');
                    option.value = section.id;
                    option.textContent = section.name;
                    sectionFilter.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Error populating sections:', error);
        }
    }

    clearFilters() {
        // Reset all filter values
        this.filters = {
            priority: '',
            project: '',
            section: '',
            dateFrom: '',
            dateTo: ''
        };

        // Reset UI elements
        const priorityFilter = document.getElementById('priorityFilter');
        const projectFilter = document.getElementById('projectFilter');
        const sectionFilter = document.getElementById('sectionFilter');
        const dateFrom = document.getElementById('dateFrom');
        const dateTo = document.getElementById('dateTo');

        if (priorityFilter) priorityFilter.value = '';
        if (projectFilter) projectFilter.value = '';
        if (sectionFilter) sectionFilter.value = '';
        if (dateFrom) dateFrom.value = '';
        if (dateTo) dateTo.value = '';

        // Reapply filters (which will now show all tasks)
        this.applyFilters();
    }

    async applyFilters() {
        try {
            const tasks = await this.todoistIntegration.getTasks();
            const filteredTasks = tasks.filter(task => {
                // Priority filter
                if (this.filters.priority && task.priority !== parseInt(this.filters.priority)) {
                    return false;
                }

                // Project filter
                if (this.filters.project && task.project_id !== this.filters.project) {
                    return false;
                }

                // Section filter
                if (this.filters.section && task.section_id !== this.filters.section) {
                    return false;
                }

                // Date range filter
                if (task.due) {
                    const taskDate = new Date(task.due.date);
                    if (this.filters.dateFrom) {
                        const fromDate = new Date(this.filters.dateFrom);
                        if (taskDate < fromDate) return false;
                    }
                    if (this.filters.dateTo) {
                        const toDate = new Date(this.filters.dateTo);
                        if (taskDate > toDate) return false;
                    }
                }

                return true;
            });

            // Update the display with filtered tasks
            this.todoistIntegration.displayFilteredTasks(filteredTasks);
        } catch (error) {
            console.error('Error applying filters:', error);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaskFilters;
}
