/**
 * gpa-predictor.js
 * Real-time GPA Predictor Module
 * 
 * Features:
 * - Dynamic subject row management (add/remove)
 * - Dual input modes (numerical marks 0-100 OR letter grades)
 * - Configurable grading scales (4.0, 10.0, custom)
 * - Real-time GPA calculation with debouncing
 * - localStorage persistence
 * - What-if scenarios
 * - Comprehensive validation
 * - Accessibility support
 * 
 * @author GPAce Team
 * @version 2.0.0
 */

// ============================================
// Grading Scales Configuration
// ============================================

const GRADING_SCALES = {
    '4.0': {
        name: '4.0 Scale (US Standard)',
        maxGPA: 4.0,
        grades: [
            { min: 90, max: 100, grade: 'A+', gp: 4.0 },
            { min: 85, max: 89.99, grade: 'A', gp: 4.0 },
            { min: 80, max: 84.99, grade: 'A-', gp: 3.7 },
            { min: 75, max: 79.99, grade: 'B+', gp: 3.3 },
            { min: 70, max: 74.99, grade: 'B', gp: 3.0 },
            { min: 65, max: 69.99, grade: 'B-', gp: 2.7 },
            { min: 60, max: 64.99, grade: 'C+', gp: 2.3 },
            { min: 55, max: 59.99, grade: 'C', gp: 2.0 },
            { min: 50, max: 54.99, grade: 'C-', gp: 1.7 },
            { min: 45, max: 49.99, grade: 'D', gp: 1.0 },
            { min: 0, max: 44.99, grade: 'F', gp: 0.0 }
        ]
    },
    '10.0': {
        name: '10.0 Scale (India/Europe)',
        maxGPA: 10.0,
        grades: [
            { min: 90, max: 100, grade: 'O', gp: 10.0 },
            { min: 80, max: 89.99, grade: 'A+', gp: 9.0 },
            { min: 70, max: 79.99, grade: 'A', gp: 8.0 },
            { min: 60, max: 69.99, grade: 'B+', gp: 7.0 },
            { min: 50, max: 59.99, grade: 'B', gp: 6.0 },
            { min: 45, max: 49.99, grade: 'C', gp: 5.0 },
            { min: 40, max: 44.99, grade: 'D', gp: 4.0 },
            { min: 0, max: 39.99, grade: 'F', gp: 0.0 }
        ]
    },
    '5.0': {
        name: '5.0 Scale',
        maxGPA: 5.0,
        grades: [
            { min: 90, max: 100, grade: 'A+', gp: 5.0 },
            { min: 85, max: 89.99, grade: 'A', gp: 4.5 },
            { min: 80, max: 84.99, grade: 'A-', gp: 4.0 },
            { min: 75, max: 79.99, grade: 'B+', gp: 3.5 },
            { min: 70, max: 74.99, grade: 'B', gp: 3.0 },
            { min: 65, max: 69.99, grade: 'B-', gp: 2.5 },
            { min: 60, max: 64.99, grade: 'C+', gp: 2.0 },
            { min: 55, max: 59.99, grade: 'C', gp: 1.5 },
            { min: 50, max: 54.99, grade: 'D', gp: 1.0 },
            { min: 0, max: 49.99, grade: 'F', gp: 0.0 }
        ]
    }
};

// Storage key for persistence
const STORAGE_KEY = 'gpaPredictorData_v2';

// Debounce delay in ms
const DEBOUNCE_DELAY = 50;

// ============================================
// GPA Predictor Class
// ============================================

class GPAPredictor {
    constructor(containerId = 'gpaPredictorContainer') {
        this.containerId = containerId;
        this.container = null;
        this.subjects = [];
        this.currentScale = '4.0';
        this.inputMode = 'marks'; // 'marks' or 'grade'
        this.debounceTimer = null;
        this.isInitialized = false;

        // Bind methods
        this.handleInputChange = this.handleInputChange.bind(this);
        this.handleAddSubject = this.handleAddSubject.bind(this);
        this.handleRemoveSubject = this.handleRemoveSubject.bind(this);
        this.handleScaleChange = this.handleScaleChange.bind(this);
        this.handleReset = this.handleReset.bind(this);
    }

    // ============================================
    // Initialization
    // ============================================

    init() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.warn(`[GPA Predictor] Container #${this.containerId} not found`);
            return;
        }

        // Load saved data
        this.loadFromStorage();

        // Render UI
        this.render();

        // Setup event delegation
        this.setupEventListeners();

        // Initial calculation
        this.calculateGPA();

        this.isInitialized = true;
        console.log('[GPA Predictor] Initialized successfully');
    }

    // ============================================
    // Rendering
    // ============================================

    render() {
        const scale = GRADING_SCALES[this.currentScale];

        this.container.innerHTML = `
            <div class="gpa-predictor-section" role="region" aria-label="GPA Predictor">
                <!-- Header -->
                <div class="gpa-predictor-header">
                    <div class="gpa-predictor-title">
                        <span class="icon">📊</span>
                        <h3>GPA Predictor</h3>
                    </div>
                    <div class="gpa-predictor-controls">
                        <div class="scale-selector">
                            <label for="gpaScale">Scale:</label>
                            <select id="gpaScale" aria-label="Select GPA Scale">
                                ${Object.entries(GRADING_SCALES).map(([key, s]) => `
                                    <option value="${key}" ${key === this.currentScale ? 'selected' : ''}>
                                        ${s.name}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                        <div class="input-mode-toggle" role="group" aria-label="Input mode">
                            <button type="button" 
                                    class="${this.inputMode === 'marks' ? 'active' : ''}" 
                                    data-mode="marks"
                                    aria-pressed="${this.inputMode === 'marks'}">
                                Marks
                            </button>
                            <button type="button" 
                                    class="${this.inputMode === 'grade' ? 'active' : ''}" 
                                    data-mode="grade"
                                    aria-pressed="${this.inputMode === 'grade'}">
                                Grade
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Main GPA Display -->
                <div class="gpa-display-card">
                    <div id="gpaMainValue" class="gpa-main-value empty" aria-live="polite">—</div>
                    <div class="gpa-scale-indicator">out of ${scale.maxGPA.toFixed(1)}</div>
                    <div id="gpaClassification" class="gpa-classification" style="display:none;"></div>
                    <div class="gpa-progress-container">
                        <div class="gpa-progress-track">
                            <div id="gpaProgressFill" class="gpa-progress-fill" style="width: 0%;"></div>
                        </div>
                    </div>
                </div>

                <!-- Stats Grid -->
                <div class="gpa-stats-grid">
                    <div class="gpa-stat-card">
                        <div id="totalCredits" class="gpa-stat-value">0</div>
                        <div class="gpa-stat-label">Total Credits</div>
                    </div>
                    <div class="gpa-stat-card">
                        <div id="totalGradePoints" class="gpa-stat-value">0</div>
                        <div class="gpa-stat-label">Grade Points Earned</div>
                    </div>
                    <div class="gpa-stat-card">
                        <div id="subjectCount" class="gpa-stat-value">0</div>
                        <div class="gpa-stat-label">Subjects</div>
                    </div>
                    <div class="gpa-stat-card">
                        <div id="averageMarks" class="gpa-stat-value">—</div>
                        <div class="gpa-stat-label">Avg. Marks</div>
                    </div>
                </div>

                <!-- Subject Rows -->
                <div class="gpa-subjects-container">
                    <div class="gpa-subjects-header" aria-hidden="true">
                        <span>Subject / Course</span>
                        <span>Credits</span>
                        <span>${this.inputMode === 'marks' ? 'Marks (0-100)' : 'Grade'}</span>
                        <span>Grade</span>
                        <span>Grade Points</span>
                        <span></span>
                    </div>
                    <div id="subjectRowsContainer" class="gpa-subjects-list" role="list">
                        ${this.renderSubjectRows()}
                    </div>
                </div>

                <!-- Add Subject Button -->
                <button type="button" 
                        class="btn-add-subject" 
                        id="addSubjectBtn"
                        aria-label="Add new subject">
                    <span class="icon">+</span>
                    <span>Add New Subject</span>
                </button>

                <!-- What-If Scenario -->
                <div class="what-if-section">
                    <h4>
                        <span>🎯</span>
                        What-If Scenario
                    </h4>
                    <div class="what-if-slider-container">
                        <div class="what-if-slider-label">
                            <span>If I score this in remaining subjects:</span>
                            <span id="whatIfValue" class="what-if-value">75%</span>
                        </div>
                        <input type="range" 
                               id="whatIfSlider" 
                               class="what-if-slider"
                               min="0" max="100" value="75"
                               aria-label="What-if marks percentage">
                        <div class="what-if-result">
                            <span>Projected GPA:</span>
                            <span id="whatIfGPA" class="what-if-projected-gpa">—</span>
                        </div>
                    </div>
                </div>

                <!-- Grade Scale Reference (Collapsible) -->
                <div class="grade-scale-reference" id="gradeScaleRef">
                    <h4>📋 Grade Scale Reference</h4>
                    <div class="grade-scale-grid">
                        ${scale.grades.map(g => `
                            <div class="grade-scale-item">
                                <span class="grade">${g.grade}</span>
                                <span class="range">${g.min}-${g.max}%</span>
                                <span class="gp">${g.gp.toFixed(1)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Action Buttons -->
                <div class="gpa-actions">
                    <button type="button" class="btn-gpa-action secondary" id="syncBtn" title="Refresh subjects from your academic data">
                        <span>🔄</span> Sync Subjects
                    </button>
                    <button type="button" class="btn-gpa-action secondary" id="exportBtn">
                        <span>📄</span> Export
                    </button>
                    <button type="button" class="btn-gpa-action danger" id="resetBtn">
                        <span>🗑️</span> Reset All
                    </button>
                </div>
            </div>
        `;

        // Update the header based on input mode
        this.updateInputModeHeader();
    }

    renderSubjectRows() {
        if (this.subjects.length === 0) {
            return `
                <div class="gpa-empty-state">
                    <div class="icon">📚</div>
                    <h4>No Subjects Added</h4>
                    <p>Click "Add New Subject" to start calculating your GPA.</p>
                </div>
            `;
        }

        return this.subjects.map((subject, index) => this.renderSubjectRow(subject, index)).join('');
    }

    renderSubjectRow(subject, index) {
        const scale = GRADING_SCALES[this.currentScale];
        const gradeInfo = this.getGradeFromMarks(subject.marks);
        const gradeClass = this.getGradeClass(gradeInfo.grade);

        const marksInput = `
            <input type="number" 
                   class="subject-marks-input"
                   data-index="${index}"
                   value="${subject.marks !== null ? subject.marks : ''}"
                   min="0" max="100" step="0.01"
                   placeholder="0-100"
                   aria-label="Marks for ${subject.name || 'subject'}"
                   ${this.inputMode !== 'marks' ? 'style="display:none;"' : ''}>
        `;

        const gradeSelect = `
            <select class="subject-grade-select"
                    data-index="${index}"
                    aria-label="Grade for ${subject.name || 'subject'}"
                    ${this.inputMode !== 'grade' ? 'style="display:none;"' : ''}>
                <option value="">Select</option>
                ${scale.grades.map(g => `
                    <option value="${g.grade}" ${subject.selectedGrade === g.grade ? 'selected' : ''}>
                        ${g.grade} (${g.gp.toFixed(1)})
                    </option>
                `).join('')}
            </select>
        `;

        return `
            <div class="gpa-subject-row ${!this.isValidSubject(subject) ? 'invalid' : ''}" 
                 role="listitem" 
                 data-index="${index}">
                <input type="text" 
                       class="subject-name-input"
                       data-index="${index}"
                       value="${this.escapeHtml(subject.name || '')}"
                       placeholder="Subject Name / Code"
                       aria-label="Subject name">
                <input type="number" 
                       class="subject-credits-input"
                       data-index="${index}"
                       value="${subject.credits}"
                       min="0.5" max="12" step="0.5"
                       placeholder="Credits"
                       aria-label="Credit hours">
                <div class="marks-grade-input-wrapper">
                    ${marksInput}
                    ${gradeSelect}
                </div>
                <span class="grade-badge ${gradeClass}">
                    ${gradeInfo.grade || '—'}
                </span>
                <span class="grade-point-display">
                    ${gradeInfo.gp !== null ? gradeInfo.gp.toFixed(1) : '—'}
                </span>
                <button type="button" 
                        class="btn-remove-row" 
                        data-index="${index}"
                        aria-label="Remove subject"
                        title="Remove this subject">
                    ✕
                </button>
            </div>
        `;
    }

    updateInputModeHeader() {
        const header = this.container.querySelector('.gpa-subjects-header');
        if (header) {
            const spans = header.querySelectorAll('span');
            if (spans[2]) {
                spans[2].textContent = this.inputMode === 'marks' ? 'Marks (0-100)' : 'Grade';
            }
        }
    }

    // ============================================
    // Event Handling
    // ============================================

    setupEventListeners() {
        // Use event delegation for dynamic content
        this.container.addEventListener('input', (e) => {
            const target = e.target;

            if (target.classList.contains('subject-name-input') ||
                target.classList.contains('subject-credits-input') ||
                target.classList.contains('subject-marks-input')) {
                this.handleInputChange(e);
            }

            if (target.id === 'whatIfSlider') {
                this.handleWhatIfChange(e);
            }
        });

        this.container.addEventListener('change', (e) => {
            const target = e.target;

            if (target.id === 'gpaScale') {
                this.handleScaleChange(e);
            }

            if (target.classList.contains('subject-grade-select')) {
                this.handleGradeSelect(e);
            }
        });

        this.container.addEventListener('click', (e) => {
            const target = e.target;

            // Add subject button
            if (target.closest('#addSubjectBtn')) {
                this.handleAddSubject();
            }

            // Remove row button
            if (target.closest('.btn-remove-row')) {
                const index = parseInt(target.closest('.btn-remove-row').dataset.index);
                this.handleRemoveSubject(index);
            }

            // Input mode toggle
            const modeBtn = target.closest('.input-mode-toggle button');
            if (modeBtn) {
                this.handleInputModeChange(modeBtn.dataset.mode);
            }

            // Reset button
            if (target.closest('#resetBtn')) {
                this.handleReset();
            }

            // Export button
            if (target.closest('#exportBtn')) {
                this.handleExport();
            }

            // Sync button
            if (target.closest('#syncBtn')) {
                this.handleSync();
            }

            // Grade scale reference toggle
            if (target.closest('.grade-scale-reference h4')) {
                this.toggleGradeScaleReference();
            }
        });

        // Keyboard navigation
        this.container.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.classList.contains('subject-name-input')) {
                // Move to credits input
                const row = e.target.closest('.gpa-subject-row');
                const creditsInput = row.querySelector('.subject-credits-input');
                if (creditsInput) creditsInput.focus();
            }
        });
    }

    handleInputChange(e) {
        const index = parseInt(e.target.dataset.index);
        const subject = this.subjects[index];

        if (!subject) return;

        if (e.target.classList.contains('subject-name-input')) {
            subject.name = e.target.value.trim();
        }

        if (e.target.classList.contains('subject-credits-input')) {
            let credits = parseFloat(e.target.value);
            // Validate credits
            if (isNaN(credits) || credits < 0) credits = 0;
            if (credits > 12) credits = 12;
            subject.credits = credits;
        }

        if (e.target.classList.contains('subject-marks-input')) {
            let marks = parseFloat(e.target.value);
            // Validate marks
            if (e.target.value === '') {
                subject.marks = null;
            } else {
                if (isNaN(marks)) marks = null;
                else if (marks < 0) marks = 0;
                else if (marks > 100) {
                    marks = 100;
                    e.target.value = 100;
                    this.showToast('Marks capped at 100', 'warning');
                }
                subject.marks = marks;
            }
            subject.selectedGrade = null; // Clear grade selection when using marks
        }

        // Debounced calculation and save
        this.debouncedUpdate();
    }

    handleGradeSelect(e) {
        const index = parseInt(e.target.dataset.index);
        const subject = this.subjects[index];

        if (!subject) return;

        const selectedGrade = e.target.value;
        subject.selectedGrade = selectedGrade;

        // Convert grade to marks for calculation
        const scale = GRADING_SCALES[this.currentScale];
        const gradeInfo = scale.grades.find(g => g.grade === selectedGrade);
        if (gradeInfo) {
            subject.marks = (gradeInfo.min + gradeInfo.max) / 2; // Use midpoint
        } else {
            subject.marks = null;
        }

        this.debouncedUpdate();
    }

    handleAddSubject() {
        this.subjects.push({
            id: this.generateId(),
            name: '',
            credits: 3,
            marks: null,
            selectedGrade: null
        });

        this.refreshSubjectRows();
        this.saveToStorage();

        // Focus on the new row's name input
        setTimeout(() => {
            const rows = this.container.querySelectorAll('.gpa-subject-row');
            const lastRow = rows[rows.length - 1];
            if (lastRow) {
                const nameInput = lastRow.querySelector('.subject-name-input');
                if (nameInput) nameInput.focus();
            }
        }, 100);
    }

    handleRemoveSubject(index) {
        if (index < 0 || index >= this.subjects.length) return;

        this.subjects.splice(index, 1);
        this.refreshSubjectRows();
        this.calculateGPA();
        this.saveToStorage();
    }

    handleScaleChange(e) {
        this.currentScale = e.target.value;

        // Re-render to update grade scale reference and calculations
        this.render();
        this.setupEventListeners();
        this.calculateGPA();
        this.saveToStorage();
    }

    handleInputModeChange(mode) {
        if (mode === this.inputMode) return;

        this.inputMode = mode;

        // Toggle visibility of marks inputs vs grade selects
        const marksInputs = this.container.querySelectorAll('.subject-marks-input');
        const gradeSelects = this.container.querySelectorAll('.subject-grade-select');

        marksInputs.forEach(input => {
            input.style.display = mode === 'marks' ? 'block' : 'none';
        });

        gradeSelects.forEach(select => {
            select.style.display = mode === 'grade' ? 'block' : 'none';
        });

        // Update toggle buttons
        const toggleBtns = this.container.querySelectorAll('.input-mode-toggle button');
        toggleBtns.forEach(btn => {
            const isActive = btn.dataset.mode === mode;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', isActive);
        });

        this.updateInputModeHeader();
        this.saveToStorage();
    }

    handleWhatIfChange(e) {
        const value = parseInt(e.target.value);
        const valueDisplay = this.container.querySelector('#whatIfValue');
        if (valueDisplay) {
            valueDisplay.textContent = `${value}%`;
        }

        this.calculateWhatIfGPA(value);
    }

    handleReset() {
        if (!confirm('Are you sure you want to reset all subjects? This cannot be undone.')) {
            return;
        }

        this.subjects = [];
        this.currentScale = '4.0';
        this.inputMode = 'marks';

        localStorage.removeItem(STORAGE_KEY);

        this.render();
        this.setupEventListeners();
        this.calculateGPA();

        this.showToast('All data reset successfully', 'success');
    }

    handleSync() {
        // Sync subjects from academic data
        this.syncFromAcademicSubjects();
        this.showToast('Subjects synced from your academic data!', 'success');
    }

    handleExport() {
        const gpaData = this.getGPAData();
        const scale = GRADING_SCALES[this.currentScale];

        let content = `GPA Report\n`;
        content += `${'='.repeat(50)}\n`;
        content += `Generated: ${new Date().toLocaleString()}\n`;
        content += `Scale: ${scale.name}\n\n`;

        content += `SUMMARY\n`;
        content += `${'-'.repeat(30)}\n`;
        content += `GPA: ${gpaData.gpa !== null ? gpaData.gpa.toFixed(2) : 'N/A'} / ${scale.maxGPA.toFixed(1)}\n`;
        content += `Total Credits: ${gpaData.totalCredits}\n`;
        content += `Total Grade Points: ${gpaData.totalGradePoints.toFixed(2)}\n`;
        content += `Average Marks: ${gpaData.averageMarks !== null ? gpaData.averageMarks.toFixed(1) + '%' : 'N/A'}\n\n`;

        content += `SUBJECTS\n`;
        content += `${'-'.repeat(30)}\n`;

        this.subjects.forEach((subject, idx) => {
            const gradeInfo = this.getGradeFromMarks(subject.marks);
            content += `${idx + 1}. ${subject.name || 'Unnamed'}\n`;
            content += `   Credits: ${subject.credits} | Marks: ${subject.marks !== null ? subject.marks : 'N/A'} | Grade: ${gradeInfo.grade || 'N/A'} | GP: ${gradeInfo.gp !== null ? gradeInfo.gp.toFixed(1) : 'N/A'}\n`;
        });

        // Create and download file
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gpa-report-${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showToast('GPA report exported successfully', 'success');
    }

    toggleGradeScaleReference() {
        const ref = this.container.querySelector('#gradeScaleRef');
        if (ref) {
            ref.classList.toggle('collapsed');
        }
    }

    // ============================================
    // Calculation Logic
    // ============================================

    calculateGPA() {
        const data = this.getGPAData();

        // Update main GPA display
        const gpaValue = this.container.querySelector('#gpaMainValue');
        const gpaProgress = this.container.querySelector('#gpaProgressFill');
        const gpaClassification = this.container.querySelector('#gpaClassification');

        if (data.gpa !== null) {
            gpaValue.textContent = data.gpa.toFixed(2);

            const classification = this.getGPAClassification(data.gpa);
            gpaValue.className = `gpa-main-value ${classification.class}`;
            gpaProgress.className = `gpa-progress-fill ${classification.class}`;

            const scale = GRADING_SCALES[this.currentScale];
            const percentage = (data.gpa / scale.maxGPA) * 100;
            gpaProgress.style.width = `${percentage}%`;

            gpaClassification.textContent = classification.label;
            gpaClassification.className = `gpa-classification ${classification.class}`;
            gpaClassification.style.display = 'inline-block';
        } else {
            gpaValue.textContent = '—';
            gpaValue.className = 'gpa-main-value empty';
            gpaProgress.style.width = '0%';
            gpaClassification.style.display = 'none';
        }

        // Update stats
        this.container.querySelector('#totalCredits').textContent = data.totalCredits;
        this.container.querySelector('#totalGradePoints').textContent = data.totalGradePoints.toFixed(1);
        this.container.querySelector('#subjectCount').textContent = data.validSubjects;
        this.container.querySelector('#averageMarks').textContent =
            data.averageMarks !== null ? `${data.averageMarks.toFixed(1)}%` : '—';

        // Update what-if
        const slider = this.container.querySelector('#whatIfSlider');
        if (slider) {
            this.calculateWhatIfGPA(parseInt(slider.value));
        }

        // Update row displays
        this.updateRowDisplays();
    }

    getGPAData() {
        let totalCredits = 0;
        let totalGradePoints = 0;
        let totalMarks = 0;
        let validSubjects = 0;
        let subjectsWithMarks = 0;

        this.subjects.forEach(subject => {
            if (!this.isValidSubject(subject)) return;

            const gradeInfo = this.getGradeFromMarks(subject.marks);
            if (gradeInfo.gp !== null) {
                totalCredits += subject.credits;
                totalGradePoints += subject.credits * gradeInfo.gp;
                validSubjects++;

                if (subject.marks !== null) {
                    totalMarks += subject.marks;
                    subjectsWithMarks++;
                }
            }
        });

        const gpa = totalCredits > 0 ? totalGradePoints / totalCredits : null;
        const averageMarks = subjectsWithMarks > 0 ? totalMarks / subjectsWithMarks : null;

        return {
            gpa,
            totalCredits,
            totalGradePoints,
            validSubjects,
            averageMarks
        };
    }

    calculateWhatIfGPA(targetMarks) {
        const scale = GRADING_SCALES[this.currentScale];
        const whatIfGPAEl = this.container.querySelector('#whatIfGPA');

        // Get current valid subjects data
        const data = this.getGPAData();

        if (data.validSubjects === 0) {
            whatIfGPAEl.textContent = '—';
            return;
        }

        // Simulate: What if all current subjects had targetMarks?
        const targetGradeInfo = this.getGradeFromMarks(targetMarks);
        let simulatedGradePoints = 0;
        let totalCredits = 0;

        this.subjects.forEach(subject => {
            if (subject.credits > 0) {
                totalCredits += subject.credits;

                // If subject already has marks, use those; otherwise use target
                const marksToUse = subject.marks !== null ? subject.marks : targetMarks;
                const gradeInfo = this.getGradeFromMarks(marksToUse);
                simulatedGradePoints += subject.credits * (gradeInfo.gp || 0);
            }
        });

        const projectedGPA = totalCredits > 0 ? simulatedGradePoints / totalCredits : null;

        if (projectedGPA !== null) {
            const classification = this.getGPAClassification(projectedGPA);
            whatIfGPAEl.textContent = projectedGPA.toFixed(2);
            whatIfGPAEl.style.color = this.getClassificationColor(classification.class);
        } else {
            whatIfGPAEl.textContent = '—';
        }
    }

    getGradeFromMarks(marks) {
        if (marks === null || marks === undefined) {
            return { grade: null, gp: null };
        }

        const scale = GRADING_SCALES[this.currentScale];

        for (const gradeLevel of scale.grades) {
            if (marks >= gradeLevel.min && marks <= gradeLevel.max) {
                return { grade: gradeLevel.grade, gp: gradeLevel.gp };
            }
        }

        // Fallback for edge cases
        return { grade: 'F', gp: 0 };
    }

    getGPAClassification(gpa) {
        const scale = GRADING_SCALES[this.currentScale];
        const percentage = (gpa / scale.maxGPA) * 100;

        if (percentage >= 85) {
            return { class: 'excellent', label: 'Excellent Performance' };
        } else if (percentage >= 70) {
            return { class: 'good', label: 'Good Performance' };
        } else if (percentage >= 50) {
            return { class: 'average', label: 'Average Performance' };
        } else {
            return { class: 'poor', label: 'Needs Improvement' };
        }
    }

    getClassificationColor(classType) {
        const colors = {
            excellent: '#10b981',
            good: '#3b82f6',
            average: '#f59e0b',
            poor: '#ef4444'
        };
        return colors[classType] || 'var(--text-color)';
    }

    getGradeClass(grade) {
        if (!grade) return '';
        const firstChar = grade.charAt(0).toUpperCase();
        if (firstChar === 'A' || firstChar === 'O') return 'grade-a';
        if (firstChar === 'B') return 'grade-b';
        if (firstChar === 'C') return 'grade-c';
        if (firstChar === 'D') return 'grade-d';
        return 'grade-f';
    }

    isValidSubject(subject) {
        return subject &&
            subject.credits > 0 &&
            (subject.marks !== null || subject.selectedGrade);
    }

    // ============================================
    // UI Helpers
    // ============================================

    refreshSubjectRows() {
        const container = this.container.querySelector('#subjectRowsContainer');
        if (container) {
            container.innerHTML = this.renderSubjectRows();
        }
    }

    updateRowDisplays() {
        this.subjects.forEach((subject, index) => {
            const row = this.container.querySelector(`.gpa-subject-row[data-index="${index}"]`);
            if (!row) return;

            const gradeInfo = this.getGradeFromMarks(subject.marks);
            const gradeBadge = row.querySelector('.grade-badge');
            const gradePointDisplay = row.querySelector('.grade-point-display');

            if (gradeBadge) {
                gradeBadge.textContent = gradeInfo.grade || '—';
                gradeBadge.className = `grade-badge ${this.getGradeClass(gradeInfo.grade)}`;
            }

            if (gradePointDisplay) {
                gradePointDisplay.textContent = gradeInfo.gp !== null ? gradeInfo.gp.toFixed(1) : '—';
            }

            // Update row validity state
            row.classList.toggle('invalid', !this.isValidSubject(subject));
        });
    }

    debouncedUpdate() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.calculateGPA();
            this.saveToStorage();
        }, DEBOUNCE_DELAY);
    }

    showToast(message, type = 'info') {
        // Remove existing toast
        const existingToast = document.querySelector('.gpa-toast');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.className = `gpa-toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ============================================
    // Persistence
    // ============================================

    saveToStorage() {
        const data = {
            subjects: this.subjects,
            currentScale: this.currentScale,
            inputMode: this.inputMode,
            savedAt: new Date().toISOString()
        };

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('[GPA Predictor] Failed to save to localStorage:', e);
        }
    }

    loadFromStorage() {
        try {
            // First, try to load GPA Predictor's own saved data
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const data = JSON.parse(saved);
                this.subjects = data.subjects || [];
                this.currentScale = data.currentScale || '4.0';
                this.inputMode = data.inputMode || 'marks';
                console.log('[GPA Predictor] Loaded saved data:', data.savedAt);
            }

            // If no subjects in GPA Predictor data, try to import from existing academic subjects
            if (this.subjects.length === 0) {
                this.importFromAcademicSubjects();
            }
        } catch (e) {
            console.warn('[GPA Predictor] Failed to load from localStorage:', e);
            this.subjects = [];
            // Still try to import from academic subjects as fallback
            this.importFromAcademicSubjects();
        }
    }

    /**
     * Import subjects from the existing academicSubjects data in localStorage
     * This integrates with the main subject marks system
     * Uses the academicPerformance (Current Grade %) directly from subject data
     */
    importFromAcademicSubjects() {
        try {
            // Try to get subjects from academicSubjects (main storage key)
            const academicSubjectsRaw = localStorage.getItem('academicSubjects');

            if (academicSubjectsRaw) {
                const academicSubjects = JSON.parse(academicSubjectsRaw);

                if (Array.isArray(academicSubjects) && academicSubjects.length > 0) {
                    console.log('[GPA Predictor] Found', academicSubjects.length, 'existing subjects, importing...');

                    // Log the raw data for debugging
                    console.log('[GPA Predictor] Raw academic subjects:', academicSubjects);

                    // Convert academic subjects to GPA Predictor format
                    this.subjects = academicSubjects.map(subject => {
                        // Log the full subject object to see what properties exist
                        console.log('[GPA Predictor] Processing subject:', subject);

                        // Use the academicPerformance directly - this is the "Current Grade" shown in UI
                        let marks = null;

                        // Use academicPerformance if it exists (this is the Current Grade %)
                        // Note: 0 is a valid value (no marks entered yet = 0%)
                        if (subject.academicPerformance !== undefined && subject.academicPerformance !== null) {
                            marks = parseFloat(subject.academicPerformance);
                        }

                        // Get credit hours - check multiple possible property names
                        let credits = 3; // Default
                        if (subject.creditHours !== undefined && subject.creditHours !== null) {
                            credits = parseFloat(subject.creditHours);
                        } else if (subject.hours !== undefined && subject.hours !== null) {
                            credits = parseFloat(subject.hours);
                        } else if (subject.credits !== undefined && subject.credits !== null) {
                            credits = parseFloat(subject.credits);
                        }

                        console.log(`[GPA Predictor] ${subject.name}: Credits=${credits}, Grade=${marks}%`);

                        return {
                            id: subject.tag || this.generateId(),
                            name: subject.name || 'Unnamed Subject',
                            credits: credits,
                            marks: marks, // This is now the Current Grade %
                            selectedGrade: null,
                            // Keep reference to original subject for potential future sync
                            _sourceTag: subject.tag
                        };
                    });

                    console.log('[GPA Predictor] Imported subjects:', this.subjects);

                    // Save the imported data
                    this.saveToStorage();
                }
            }
        } catch (e) {
            console.warn('[GPA Predictor] Failed to import from academicSubjects:', e);
        }
    }

    /**
     * Sync/refresh subjects from the main academic data
     * Can be called manually or when academic subjects change
     */
    syncFromAcademicSubjects() {
        // Clear current subjects and re-import
        this.subjects = [];
        this.importFromAcademicSubjects();
        this.refreshSubjectRows();
        this.calculateGPA();
    }

    // ============================================
    // Utility Methods
    // ============================================

    generateId() {
        return 'subj_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============================================
    // Public API
    // ============================================

    addSubject(name, credits, marks) {
        this.subjects.push({
            id: this.generateId(),
            name: name || '',
            credits: credits || 3,
            marks: marks,
            selectedGrade: null
        });
        this.refreshSubjectRows();
        this.calculateGPA();
        this.saveToStorage();
    }

    getSubjects() {
        return [...this.subjects];
    }

    setScale(scale) {
        if (GRADING_SCALES[scale]) {
            this.currentScale = scale;
            this.render();
            this.setupEventListeners();
            this.calculateGPA();
            this.saveToStorage();
        }
    }

    getCurrentGPA() {
        return this.getGPAData().gpa;
    }

    destroy() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        clearTimeout(this.debounceTimer);
    }
}

// ============================================
// Auto-initialization
// ============================================

let gpaPredictorInstance = null;

function initGPAPredictor(containerId = 'gpaPredictorContainer') {
    if (gpaPredictorInstance) {
        gpaPredictorInstance.destroy();
    }
    gpaPredictorInstance = new GPAPredictor(containerId);
    gpaPredictorInstance.init();
    return gpaPredictorInstance;
}

// Expose globally for non-module scripts (works with file:// protocol)
window.GPAPredictor = GPAPredictor;
window.initGPAPredictor = initGPAPredictor;
window.GRADING_SCALES = GRADING_SCALES;

// Export for ES module usage (only works when loaded as type="module")
// This is wrapped to prevent syntax errors when loaded as regular script
try {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { GPAPredictor, initGPAPredictor, GRADING_SCALES };
    }
} catch (e) {
    // Not in a module context, that's fine
}

// Signal that script is ready
console.log('[GPA Predictor] Script loaded and globals registered');
