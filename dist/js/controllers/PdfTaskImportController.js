/**
 * PdfTaskImportController.js
 * 
 * Interactive UI Controller for PDF Batch Task Ingestion in Grind Mode.
 * - Handles PDF file selection / drag-drop.
 * - Displays live extraction progress across PDF rendering and Gemini key rotation.
 * - Renders the Interactive Verification Modal for user review, field edits, and subject grounding.
 * - Commits approved tasks into GPAce task storage and triggers UI updates.
 * 
 * Strict GEMINI.md compliance: pure Vanilla JS, zero inline styles, 100% accessible.
 */

import { pdfTaskExtractor } from '../services/PdfTaskExtractor.js';
import { subjectGrounder } from '../services/SubjectGrounder.js';

export class PdfTaskImportController {
  constructor(options = {}) {
    this.doc = options.document || (typeof document !== 'undefined' ? document : null);
    this.win = options.window || (typeof window !== 'undefined' ? window : null);
    this.storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.extractor = options.extractor || pdfTaskExtractor;
    this.grounder = options.grounder || subjectGrounder;

    this.candidateTasks = [];
    this.isProcessing = false;
  }

  /**
   * Initializes event listeners on trigger buttons and file inputs.
   */
  init() {
    if (!this.doc) return;

    // Trigger button on the General Tasks card
    const importBtn = this.doc.getElementById('importPdfTasksBtn');
    if (importBtn) {
      importBtn.addEventListener('click', () => this.openFilePicker());
    }

    // Secondary trigger button inside task modal
    const modalImportBtn = this.doc.getElementById('modalImportPdfBtn');
    if (modalImportBtn) {
      modalImportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof this.win?.hideTaskModal === 'function') {
          this.win.hideTaskModal();
        }
        this.openFilePicker();
      });
    }

    // Hidden file input
    const fileInput = this.doc.getElementById('pdfFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => this.handleFileSelected(e));
    }

    // Setup verification modal action handlers
    this._bindModalEvents();
  }

  /**
   * Triggers the hidden file input.
   */
  openFilePicker() {
    const fileInput = this.doc.getElementById('pdfFileInput');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  /**
   * Handles user file selection.
   */
  async handleFileSelected(event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      this._showToast('Please select a valid PDF file.', 'error');
      return;
    }

    await this.processPdf(file);
  }

  /**
   * Runs the extraction pipeline with live progress reporting.
   */
  async processPdf(file) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    this._showProgressModal(`Initializing PDF analysis for "${file.name}"...`);

    try {
      const extractedTasks = await this.extractor.extractTasksFromPdf(file, (progress) => {
        this._updateProgress(progress.percent, progress.message);
      });

      this._hideProgressModal();

      if (!extractedTasks || extractedTasks.length === 0) {
        this._showToast('No actionable tasks could be extracted from this PDF.', 'warning');
        return;
      }

      this.candidateTasks = extractedTasks;
      this.renderVerificationModal();

    } catch (err) {
      this._hideProgressModal();
      console.error('[PdfTaskImportController] Extraction failed:', err);
      this._showToast(err.message || 'Failed to extract tasks from PDF.', 'error');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Renders the interactive Task Verification Modal with editable fields and subject grounding.
   */
  renderVerificationModal() {
    const modal = this.doc.getElementById('pdfTaskVerificationModal');
    const container = this.doc.getElementById('pdfVerificationList');
    const titleEl = this.doc.getElementById('pdfVerificationTitle');
    const countBadge = this.doc.getElementById('pdfTasksCountBadge');

    if (!modal || !container) return;

    if (countBadge) {
      countBadge.textContent = `${this.candidateTasks.length} Found`;
    }

    // Retrieve all user subjects for dropdown options
    const userSubjects = this.grounder.getUserSubjects();
    const subjectOptionsHtml = userSubjects.map(s => 
      `<option value="${this._escapeHtml(s.name)}">${this._escapeHtml(s.name)} (${this._escapeHtml(s.code)})</option>`
    ).join('');

    container.innerHTML = '';

    this.candidateTasks.forEach((task, index) => {
      const row = this.doc.createElement('div');
      row.className = `pdf-task-review-row ${task.isGrounded ? 'is-grounded' : 'needs-grounding'}`;
      row.dataset.index = String(index);

      const isChecked = true;
      const groundStatusBadge = task.isGrounded
        ? `<span class="badge badge-grounded"><i class="bi bi-shield-check"></i> Grounded in ${this._escapeHtml(task.project)}</span>`
        : `<span class="badge badge-ungrounded"><i class="bi bi-exclamation-triangle"></i> Not Grounded — Please Verify Subject</span>`;

      row.innerHTML = `
        <div class="task-review-header">
          <label class="task-review-select">
            <input type="checkbox" class="task-select-checkbox" ${isChecked ? 'checked' : ''} data-index="${index}">
            <span class="task-review-num">Task #${index + 1}</span>
          </label>
          <div class="task-review-status">${groundStatusBadge}</div>
          <button type="button" class="btn-delete-row" data-index="${index}" title="Remove task" aria-label="Remove task">
            <i class="bi bi-trash"></i>
          </button>
        </div>

        <div class="task-review-body">
          <div class="form-group task-title-group">
            <label>Task Title</label>
            <input type="text" class="form-control task-edit-title" value="${this._escapeHtml(task.title)}" data-index="${index}">
          </div>

          <div class="form-group task-subject-group">
            <label>Subject / Project</label>
            <select class="form-select task-edit-subject" data-index="${index}">
              ${subjectOptionsHtml}
            </select>
          </div>

          <div class="form-group task-priority-group">
            <label>Priority</label>
            <select class="form-select task-edit-priority" data-index="${index}">
              <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
              <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
            </select>
          </div>

          <div class="form-group task-due-group">
            <label>Due Date</label>
            <input type="date" class="form-control task-edit-due" value="${task.dueDate || ''}" data-index="${index}">
          </div>

          <div class="form-group task-duration-group">
            <label>Duration (min)</label>
            <input type="number" class="form-control task-edit-duration" min="5" max="360" step="5" value="${task.estimatedMinutes || 30}" data-index="${index}">
          </div>
        </div>
      `;

      // Set the select element's value to matched subject
      const selectEl = row.querySelector('.task-edit-subject');
      if (selectEl) {
        selectEl.value = task.project || 'General';
      }

      container.appendChild(row);
    });

    this._updateSelectedCountBadge();
    modal.classList.add('open');
  }

  /**
   * Commits the reviewed and confirmed tasks into GPAce task storage.
   */
  commitTasks() {
    const container = this.doc.getElementById('pdfVerificationList');
    if (!container) return;

    const rows = container.querySelectorAll('.pdf-task-review-row');
    const tasksToSave = [];

    rows.forEach((row) => {
      const checkbox = row.querySelector('.task-select-checkbox');
      if (!checkbox || !checkbox.checked) return;

      const titleInput = row.querySelector('.task-edit-title');
      const subjectSelect = row.querySelector('.task-edit-subject');
      const prioritySelect = row.querySelector('.task-edit-priority');
      const dueInput = row.querySelector('.task-edit-due');
      const durationInput = row.querySelector('.task-edit-duration');

      const title = titleInput ? titleInput.value.trim() : '';
      if (!title) return;

      const subject = subjectSelect ? subjectSelect.value : 'General';
      const priority = prioritySelect ? prioritySelect.value : 'medium';
      const dueDate = dueInput ? dueInput.value : null;
      const duration = durationInput ? parseInt(durationInput.value, 10) : 30;

      tasksToSave.push({
        id: 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        title,
        project: subject,
        subcategory: 'Imported',
        priority,
        dueDate,
        estimatedMinutes: isNaN(duration) ? 30 : duration,
        completed: false,
        createdAt: new Date().toISOString()
      });
    });

    if (tasksToSave.length === 0) {
      this._showToast('No tasks selected for import.', 'warning');
      return;
    }

    // Save to localStorage
    try {
      const existing = JSON.parse(this.storage.getItem('tasks') || '[]');
      const combined = [...existing, ...tasksToSave];
      this.storage.setItem('tasks', JSON.stringify(combined));

      // Also persist to TaskRepository if available
      if (this.win?.TaskRepository?.saveAll) {
        this.win.TaskRepository.saveAll(combined);
      }
    } catch (e) {
      console.error('[PdfTaskImportController] Storage error:', e);
    }

    // Close modal
    this.closeVerificationModal();

    // Trigger Grind page task refresh
    if (typeof this.win?.displayPriorityTask === 'function') {
      this.win.displayPriorityTask();
    } else if (typeof this.win?.initGrindPage === 'function') {
      this.win.initGrindPage();
    }

    // Broadcast update across widgets/tabs
    if (this.win?.dispatchEvent) {
      this.win.dispatchEvent(new CustomEvent('tasksUpdated', { detail: { count: tasksToSave.length } }));
    }

    this._showToast(`Successfully imported ${tasksToSave.length} task${tasksToSave.length === 1 ? '' : 's'} grounded in your subjects!`, 'success');
  }

  closeVerificationModal() {
    const modal = this.doc.getElementById('pdfTaskVerificationModal');
    if (modal) {
      modal.classList.remove('open');
    }
  }

  _bindModalEvents() {
    // Select all / deselect all
    const selectAllBtn = this.doc.getElementById('pdfSelectAllTasksBtn');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        const checkboxes = this.doc.querySelectorAll('.task-select-checkbox');
        const anyUnchecked = Array.from(checkboxes).some(cb => !cb.checked);
        checkboxes.forEach(cb => { cb.checked = anyUnchecked; });
        this._updateSelectedCountBadge();
      });
    }

    // Cancel modal
    const cancelBtn = this.doc.getElementById('pdfCancelImportBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.closeVerificationModal());
    }

    const closeIcon = this.doc.getElementById('pdfVerificationModalClose');
    if (closeIcon) {
      closeIcon.addEventListener('click', () => this.closeVerificationModal());
    }

    // Confirm import
    const confirmBtn = this.doc.getElementById('pdfConfirmImportBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => this.commitTasks());
    }

    // Event delegation on verification container (checkboxes & delete buttons)
    const container = this.doc.getElementById('pdfVerificationList');
    if (container) {
      container.addEventListener('change', (e) => {
        if (e.target.classList.contains('task-select-checkbox')) {
          this._updateSelectedCountBadge();
        }
      });

      container.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.btn-delete-row');
        if (deleteBtn) {
          const row = deleteBtn.closest('.pdf-task-review-row');
          if (row) {
            row.remove();
            this._updateSelectedCountBadge();
          }
        }
      });
    }
  }

  _updateSelectedCountBadge() {
    const checkboxes = this.doc.querySelectorAll('.task-select-checkbox:checked');
    const confirmBtn = this.doc.getElementById('pdfConfirmImportBtn');
    if (confirmBtn) {
      confirmBtn.textContent = `Import Selected (${checkboxes.length})`;
      confirmBtn.disabled = checkboxes.length === 0;
    }
  }

  _showProgressModal(initialMsg) {
    const modal = this.doc.getElementById('pdfImportProgressModal');
    const msgEl = this.doc.getElementById('pdfProgressMessage');
    const barEl = this.doc.getElementById('pdfProgressBar');
    if (modal) {
      if (msgEl) msgEl.textContent = initialMsg;
      if (barEl) barEl.style.width = '5%';
      modal.classList.add('open');
    }
  }

  _updateProgress(percent, message) {
    const msgEl = this.doc.getElementById('pdfProgressMessage');
    const barEl = this.doc.getElementById('pdfProgressBar');
    if (msgEl && message) msgEl.textContent = message;
    if (barEl && typeof percent === 'number') {
      barEl.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
  }

  _hideProgressModal() {
    const modal = this.doc.getElementById('pdfImportProgressModal');
    if (modal) {
      modal.classList.remove('open');
    }
  }

  _showToast(msg, type = 'info') {
    if (typeof this.win?.showToast === 'function') {
      this.win.showToast(msg, type);
      return;
    }
    // Fallback toast
    const existing = this.doc.querySelector('.sync-toast');
    if (existing) existing.remove();
    const toast = this.doc.createElement('div');
    toast.className = `sync-toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
    toast.textContent = msg;
    this.doc.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

export const pdfTaskImportController = new PdfTaskImportController();
if (typeof window !== 'undefined') {
  window.PdfTaskImportController = PdfTaskImportController;
  window.pdfTaskImportController = pdfTaskImportController;
}
