/**
 * js/pages/grind.js - Clean Page-Level Module Entry for Grind Mode
 * 
 * Architecture Rules & Step 16 Specification:
 * - Single ES module entry point for grind.html (<script type="module" src="js/pages/grind.js"></script>)
 * - Awaited readiness lifecycle (initGrindPage) replacing timer-based assumptions
 * - Idempotent binding: calling initGrindPage twice binds exactly one handler set
 * - Safe null-guarded DOM binding (never throws on missing elements)
 * - Explicit disabled / error state for essential controls when dependencies are unavailable
 * - Full preservation of Grind features: focus timer, sound cues, workspace toggle,
 *   dual task views, motivational quotes, energy visualization / fatigue modal, stats & clock
 * - No unreferenced broken extracted controllers (GrindInitializationController is never mounted)
 */

// Timer constants
const TIMER_DEFAULTS = Object.freeze({
  FOCUS: 25 * 60,
  BREAK: 5 * 60,
  MIN_MINUTES: 1,
  MAX_MINUTES: 60
});

// Curated motivational quotes
const DEFAULT_QUOTES = Object.freeze([
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Focus is a muscle. The more you practice, the stronger it gets.", author: "GPAce" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" }
]);

// Singleton page controller state
let activeController = null;

class GrindPageController {
  constructor(options = {}) {
    this.win = options.window || (typeof window !== 'undefined' ? window : null);
    this.doc = options.document || (typeof document !== 'undefined' ? document : null);
    this.storage = options.storage || (this.win && this.win.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null);
    
    // AbortController for deterministic single-handler event binding
    this.abortController = new AbortController();
    
    // Interval handles
    this.timerInterval = null;
    this.clockInterval = null;
    this.quoteInterval = null;

    // State
    this.state = {
      mode: 'focus', // 'focus' | 'break'
      duration: TIMER_DEFAULTS.FOCUS,
      timeLeft: TIMER_DEFAULTS.FOCUS,
      isRunning: false,
      pomodoroCount: 0,
      totalWorkSeconds: 0,
      quoteIndex: 0,
      isWorkspaceOpen: false,
      currentEnergyLevel: null,
      pendingFatigueLevel: null,
      autoStartAfterFatigue: false,
      dependencies: {
        storage: false,
        auth: false,
        cloudSync: false,
        driveApi: false,
        aiService: false
      }
    };
  }

  /**
   * Safe event listener binder bounded by this controller's abort signal.
   */
  bind(selectorOrEl, event, handler, options = {}) {
    if (!this.doc) return null;
    const el = typeof selectorOrEl === 'string' ? this.doc.querySelector(selectorOrEl) : selectorOrEl;
    if (!el || typeof el.addEventListener !== 'function') return null;
    el.addEventListener(event, handler, {
      ...options,
      signal: this.abortController.signal
    });
    return el;
  }

  /**
   * Main awaited initialization logic.
   */
  async init() {
    if (!this.doc) return this;

    // 1. Await DOM readiness if loading
    if (this.doc.readyState === 'loading') {
      await new Promise(resolve => {
        this.doc.addEventListener('DOMContentLoaded', resolve, { once: true });
      });
    }

    // 2. Assess dependency readiness and apply explicit disabled/error states
    await this._assessDependencies();

    // 3. Load persistent preferences and state
    this._loadPersistedState();

    // 4. Initialize and bind UI components safely
    this._initTimerControls();
    this._initWorkspacePanel();
    this._initQuotes();
    this._initTasksDisplay();
    this._initEnergyAndHologram();
    this._initStatsAndClock();
    this._initAiAndTools();
    this._initThemeAndShortcuts();

    // 5. Expose backward-compatible global functions
    this._exposeGlobalShims();

    return this;
  }

  /**
   * Assess readiness of external services (storage, auth, firestore, drive, AI)
   * and apply explicit disabled / fallback states rather than throwing.
   */
  async _assessDependencies() {
    // A. Storage readiness
    try {
      if (this.storage) {
        const testKey = '__gpace_storage_test__';
        this.storage.setItem(testKey, '1');
        this.storage.removeItem(testKey);
        this.state.dependencies.storage = true;
      }
    } catch {
      this.state.dependencies.storage = false;
    }

    // B. Auth and Cloud Sync readiness
    const hasAuth = !!(this.win && (this.win.auth || this.win.firebase?.auth));
    const user = hasAuth && this.win.auth?.currentUser;
    this.state.dependencies.auth = !!user;
    this.state.dependencies.cloudSync = !!user;

    const syncIndicator = this.doc.querySelector('.sync-indicator');
    if (syncIndicator) {
      if (!this.state.dependencies.cloudSync) {
        syncIndicator.innerHTML = '<i class="bi bi-cloud-slash"></i> Offline Mode';
        syncIndicator.title = 'Local Mode: Cloud sync is unavailable (unauthenticated)';
        syncIndicator.classList.add('offline');
        syncIndicator.setAttribute('data-state', 'offline');
      } else {
        syncIndicator.innerHTML = '<i class="bi bi-arrow-repeat"></i> Auto-Synced';
        syncIndicator.title = 'Synced with Timetable';
        syncIndicator.classList.remove('offline');
        syncIndicator.setAttribute('data-state', 'synced');
      }
    }

    // C. Google Drive / Upload integration readiness
    const uploadBtn = this.doc.getElementById('uploadSubjectMaterial');
    const isDriveReady = !!(this.win?.googleDriveAPI && (this.win.googleDriveAPI.isInitialized || this.win.gapi?.client));
    this.state.dependencies.driveApi = isDriveReady;
    if (uploadBtn) {
      if (!isDriveReady) {
        uploadBtn.disabled = true;
        uploadBtn.setAttribute('aria-disabled', 'true');
        uploadBtn.title = 'Google Drive integration unavailable';
        uploadBtn.classList.add('btn-disabled');
      } else {
        uploadBtn.disabled = false;
        uploadBtn.removeAttribute('aria-disabled');
        uploadBtn.title = 'Upload Material';
        uploadBtn.classList.remove('btn-disabled');
      }
    }

    // D. AI Researcher readiness
    let hasApiKey = false;
    try {
      hasApiKey = !!(this.storage && (this.storage.getItem('geminiApiKey') || this.storage.getItem('apiKey')));
    } catch {}
    this.state.dependencies.aiService = hasApiKey;
    const searchBtn = this.doc.querySelector('.search-btn');
    const genSimBtn = this.doc.getElementById('generateSimulationBtn');
    if (!hasApiKey) {
      if (searchBtn) {
        searchBtn.setAttribute('data-api-status', 'unconfigured');
        searchBtn.title = 'Gemini API key unconfigured - click settings to enter key';
      }
      if (genSimBtn) {
        genSimBtn.disabled = true;
        genSimBtn.setAttribute('aria-disabled', 'true');
        genSimBtn.title = 'Simulation requires Gemini API key in settings';
      }
    } else {
      if (searchBtn) {
        searchBtn.removeAttribute('data-api-status');
        searchBtn.title = 'Search with AI';
      }
      if (genSimBtn) {
        genSimBtn.disabled = false;
        genSimBtn.removeAttribute('aria-disabled');
        genSimBtn.title = 'Generate an interactive simulation';
      }
    }
  }

  _loadPersistedState() {
    if (!this.storage) return;
    try {
      const savedCount = parseInt(this.storage.getItem('pomodoroCount') || '0', 10);
      if (!isNaN(savedCount)) this.state.pomodoroCount = savedCount;

      const savedEnergy = parseInt(this.storage.getItem('currentEnergyLevel') || '0', 10);
      if (savedEnergy >= 1 && savedEnergy <= 7) this.state.currentEnergyLevel = savedEnergy;

      const stats = JSON.parse(this.storage.getItem('pomodoroStats') || '{}');
      if (typeof stats.totalWorkTime === 'number') {
        this.state.totalWorkSeconds = stats.totalWorkTime;
      }
    } catch {
      // Gracefully retain memory defaults on parse/storage errors
    }
  }

  // -------------------------------------------------------------
  // Focus Timer Subsystem
  // -------------------------------------------------------------
  _initTimerControls() {
    this._updateTimerDisplay();

    // Start / Pause button
    this.bind('#startBtn', 'click', () => {
      this.toggleTimer();
    });

    // Reset button
    this.bind('#resetBtn', 'click', () => {
      this.resetTimer();
    });

    // Mode buttons (Focus / Break)
    const modeButtons = this.doc.querySelectorAll('.timer-mode-btn');
    modeButtons.forEach(btn => {
      this.bind(btn, 'click', (e) => {
        const mode = btn.dataset.mode || 'focus';
        const mins = parseInt(btn.dataset.time, 10) || (mode === 'focus' ? 25 : 5);
        this.setTimerMode(mode, mins);
      });
    });

    // Custom time input
    const customInput = this.doc.getElementById('customTimeInput');
    if (customInput) {
      const handleCustom = () => {
        let val = parseInt(customInput.value, 10);
        if (isNaN(val) || val < TIMER_DEFAULTS.MIN_MINUTES) val = TIMER_DEFAULTS.MIN_MINUTES;
        if (val > TIMER_DEFAULTS.MAX_MINUTES) val = TIMER_DEFAULTS.MAX_MINUTES;
        customInput.value = val;
        this.setTimerDuration(val * 60);
      };
      this.bind(customInput, 'change', handleCustom);
      this.bind(customInput, 'input', handleCustom);
    }
  }

  setTimerMode(mode, minutes) {
    this.state.mode = mode;
    const duration = minutes * 60;
    this.state.duration = duration;
    this.state.timeLeft = duration;
    this.pauseTimer();

    // Update active mode button styling
    const modeButtons = this.doc.querySelectorAll('.timer-mode-btn');
    modeButtons.forEach(btn => {
      if (btn.dataset.mode === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update custom input display
    const customInput = this.doc.getElementById('customTimeInput');
    if (customInput) customInput.value = minutes;

    // Update timer label
    const label = this.doc.querySelector('.timer-label');
    if (label) {
      label.textContent = mode === 'focus' ? 'Focus Time' : 'Break Time';
    }

    this._updateTimerDisplay();
  }

  setTimerDuration(seconds) {
    this.state.duration = seconds;
    this.state.timeLeft = seconds;
    this.pauseTimer();
    this._updateTimerDisplay();
  }

  toggleTimer() {
    if (this.state.isRunning) {
      this.pauseTimer();
    } else {
      this.startTimer();
    }
  }

  startTimer() {
    if (this.state.isRunning) return;

    // Prompt fatigue modal once for long focus sessions if not yet logged
    if (
      this.state.mode === 'focus' &&
      this.state.timeLeft > 15 * 60 &&
      !this.state.currentEnergyLevel
    ) {
      this.showFatigueModal(true);
      return;
    }

    this.state.isRunning = true;
    this._updateStartButtonUI(true);

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.state.timeLeft > 0) {
        this.state.timeLeft--;
        if (this.state.mode === 'focus') {
          this.state.totalWorkSeconds++;
          this._updateStatsDisplay();
        }
        this._updateTimerDisplay();
      } else {
        this._handleTimerComplete();
      }
    }, 1000);

    this._updateTimerDisplay();
  }

  pauseTimer() {
    this.state.isRunning = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this._updateStartButtonUI(false);
    this._updateTitleClock();
  }

  resetTimer() {
    this.pauseTimer();
    this.state.timeLeft = this.state.duration;
    this._updateTimerDisplay();
  }

  _updateStartButtonUI(running) {
    const startBtn = this.doc.getElementById('startBtn');
    if (!startBtn) return;
    if (running) {
      startBtn.setAttribute('data-state', 'running');
      startBtn.innerHTML = '<i class="fas fa-pause"></i>';
      startBtn.title = 'Pause Timer';
    } else {
      startBtn.setAttribute('data-state', 'paused');
      startBtn.innerHTML = '<i class="fas fa-play"></i>';
      startBtn.title = 'Start Timer';
    }
  }

  _updateTimerDisplay() {
    const timerEl = this.doc.getElementById('timer');
    const minutes = Math.floor(this.state.timeLeft / 60);
    const seconds = this.state.timeLeft % 60;
    const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    if (timerEl) {
      timerEl.textContent = formatted;
    }

    // Update document title while running
    if (this.state.isRunning) {
      const modeTitle = this.state.mode === 'focus' ? 'Focus' : 'Break';
      this.doc.title = `${formatted} - ${modeTitle} - GPAce`;
    }
  }

  _handleTimerComplete() {
    this.pauseTimer();

    // Play auditory cue safely
    this._playAudioCue();

    // Focus session completion updates
    if (this.state.mode === 'focus') {
      this.state.pomodoroCount++;
      const countEl = this.doc.getElementById('pomodoroCount');
      if (countEl) countEl.textContent = this.state.pomodoroCount.toString();
      if (this.storage) {
        try {
          this.storage.setItem('pomodoroCount', this.state.pomodoroCount.toString());
        } catch {}
      }

      // Show notification banner
      const notification = this.doc.getElementById('notification');
      if (notification) {
        notification.textContent = 'Session Complete! Take a well-earned break.';
        notification.style.display = 'block';
        setTimeout(() => {
          notification.style.display = 'none';
        }, 5000);
      }

      // Auto-switch to break mode
      this.setTimerMode('break', 5);
    } else {
      // Break session completed
      const notification = this.doc.getElementById('notification');
      if (notification) {
        notification.textContent = 'Break finished! Ready for next focus round?';
        notification.style.display = 'block';
        setTimeout(() => {
          notification.style.display = 'none';
        }, 5000);
      }
      this.setTimerMode('focus', 25);
    }
  }

  _playAudioCue() {
    try {
      const AudioCtx = this.win?.AudioContext || this.win?.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5 chime
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
      } else if (this.win?.Audio) {
        const audio = new this.win.Audio('sounds/transition.mp3');
        audio.play().catch(() => {});
      }
    } catch {
      // Audio playback unavailable/blocked, continue safely
    }
  }

  _updateTitleClock() {
    if (!this.state.isRunning && this.doc) {
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      this.doc.title = `${hours}:${minutes} - GPAce`;
    }
  }

  // -------------------------------------------------------------
  // Workspace Panel Subsystem
  // -------------------------------------------------------------
  _initWorkspacePanel() {
    const toggle = this.doc.getElementById('workspaceToggle');
    const closeBtn = this.doc.getElementById('workspaceClose');
    const overlay = this.doc.getElementById('workspaceOverlay');

    if (toggle) {
      this.bind(toggle, 'click', () => this.toggleWorkspace());
    }
    if (closeBtn) {
      this.bind(closeBtn, 'click', () => this.toggleWorkspace(false));
    }
    if (overlay) {
      this.bind(overlay, 'click', () => this.toggleWorkspace(false));
    }

    // Responsive position handling
    if (this.win) {
      this.bind(this.win, 'resize', () => {
        if (!toggle) return;
        const panel = this.doc.getElementById('workspacePanel');
        const isOpen = panel?.classList.contains('open');
        if (this.win.innerWidth <= 768) {
          toggle.style.right = '20px';
        } else if (isOpen) {
          toggle.style.right = 'calc(50% + 20px)';
        }
      });
    }
  }

  toggleWorkspace(force) {
    const panel = this.doc.getElementById('workspacePanel');
    const toggle = this.doc.getElementById('workspaceToggle');
    const container = this.doc.querySelector('.container');
    if (!panel) return;

    const willOpen = force !== undefined ? !!force : !panel.classList.contains('open');
    this.state.isWorkspaceOpen = willOpen;

    if (willOpen) {
      panel.style.display = 'flex';
      panel.style.visibility = 'visible';
      panel.classList.add('open');
      if (container) container.classList.add('workspace-open');
      if (toggle && this.win && this.win.innerWidth > 768) {
        toggle.style.right = 'calc(50% + 20px)';
      }
    } else {
      panel.classList.remove('open');
      if (container) container.classList.remove('workspace-open');
      if (toggle) toggle.style.right = '20px';
    }
  }

  // -------------------------------------------------------------
  // Quotes Subsystem
  // -------------------------------------------------------------
  _initQuotes() {
    this._renderCurrentQuote();

    const prevBtn = this.doc.querySelector('.quote-nav-btn:first-child');
    const nextBtn = this.doc.querySelector('.quote-nav-btn:last-child');
    if (prevBtn) this.bind(prevBtn, 'click', () => this.rotateQuote(-1));
    if (nextBtn) this.bind(nextBtn, 'click', () => this.rotateQuote(1));

    // Auto rotate every 60s
    if (this.quoteInterval) clearInterval(this.quoteInterval);
    this.quoteInterval = setInterval(() => this.rotateQuote(1), 60000);
  }

  getQuotes() {
    let custom = [];
    if (this.storage) {
      try {
        custom = JSON.parse(this.storage.getItem('customQuotes') || '[]');
      } catch {}
    }
    return Array.isArray(custom) && custom.length > 0 ? custom : DEFAULT_QUOTES;
  }

  rotateQuote(direction = 1) {
    const quotes = this.getQuotes();
    if (!quotes.length) return;
    this.state.quoteIndex = (this.state.quoteIndex + direction + quotes.length) % quotes.length;
    this._renderCurrentQuote();
  }

  _renderCurrentQuote() {
    const quotes = this.getQuotes();
    const quote = quotes[this.state.quoteIndex] || DEFAULT_QUOTES[0];
    const textEl = this.doc.querySelector('.quote-text');
    const authorEl = this.doc.querySelector('.quote-author');
    if (textEl) textEl.textContent = `"${quote.text}"`;
    if (authorEl) authorEl.textContent = `- ${quote.author}`;
  }

  // -------------------------------------------------------------
  // Task Display & Creation Subsystem
  // -------------------------------------------------------------
  _initTasksDisplay() {
    this._renderPriorityTasks();

    // Task modal buttons
    const addBtns = this.doc.querySelectorAll('.btn-icon-add, .add-task-button');
    addBtns.forEach(btn => {
      this.bind(btn, 'click', () => this.showTaskModal());
    });

    const modalClose = this.doc.querySelector('.modal-close');
    if (modalClose) {
      this.bind(modalClose, 'click', () => this.hideTaskModal());
    }

    const createTaskBtn = this.doc.querySelector('.create-task-btn');
    if (createTaskBtn) {
      this.bind(createTaskBtn, 'click', () => this.createTask());
    }
  }

  _renderPriorityTasks() {
    const priorityBox = this.doc.getElementById('priorityTaskBox');
    if (!priorityBox) return;

    let tasks = [];
    if (this.storage) {
      try {
        tasks = JSON.parse(this.storage.getItem('calculatedPriorityTasks') || this.storage.getItem('tasks') || '[]');
      } catch {}
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      priorityBox.innerHTML = `
        <div class="empty-priority-task text-center p-3 text-muted">
          <i class="bi bi-check2-circle fs-3 d-block mb-1"></i>
          <span>No priority tasks scheduled. Create one to begin your grind!</span>
        </div>
      `;
      const currentTaskDisplay = this.doc.getElementById('taskTitle');
      if (currentTaskDisplay) currentTaskDisplay.textContent = 'No Current Task';
      return;
    }

    const topTask = tasks[0];
    priorityBox.innerHTML = `
      <div class="priority-task-item p-2">
        <h4 class="task-title mb-1">${topTask.title || 'Untitled Task'}</h4>
        <span class="badge bg-primary">${topTask.project || 'General'}</span>
      </div>
    `;

    const currentTaskDisplay = this.doc.getElementById('taskTitle');
    if (currentTaskDisplay) currentTaskDisplay.textContent = topTask.title || 'Untitled Task';
  }

  showTaskModal() {
    const modal = this.doc.getElementById('taskModal');
    if (modal) modal.style.display = 'block';
  }

  hideTaskModal() {
    const modal = this.doc.getElementById('taskModal');
    if (modal) modal.style.display = 'none';
  }

  createTask() {
    const titleInput = this.doc.getElementById('taskTitleInput');
    const projectSelect = this.doc.getElementById('projectSelect');
    if (!titleInput || !titleInput.value.trim()) return;

    const newTask = {
      id: 'task_' + Date.now(),
      title: titleInput.value.trim(),
      project: projectSelect ? projectSelect.value : 'General',
      createdAt: new Date().toISOString()
    };

    if (this.storage) {
      try {
        const tasks = JSON.parse(this.storage.getItem('tasks') || '[]');
        tasks.push(newTask);
        this.storage.setItem('tasks', JSON.stringify(tasks));
      } catch {}
    }

    titleInput.value = '';
    this.hideTaskModal();
    this._renderPriorityTasks();
  }

  // -------------------------------------------------------------
  // Energy Visualization & Fatigue Modal
  // -------------------------------------------------------------
  _initEnergyAndHologram() {
    const fatigueLevels = this.doc.querySelectorAll('.fatigue-level');
    fatigueLevels.forEach(level => {
      this.bind(level, 'click', () => {
        fatigueLevels.forEach(l => l.classList.remove('selected'));
        level.classList.add('selected');
        const levelNum = parseInt(level.dataset.level, 10);
        this.state.pendingFatigueLevel = levelNum;

        const confirmBtn = this.doc.getElementById('confirmFatigue');
        if (confirmBtn) confirmBtn.disabled = false;
      });
    });

    const confirmFatigue = this.doc.getElementById('confirmFatigue');
    if (confirmFatigue) {
      this.bind(confirmFatigue, 'click', () => {
        if (this.state.pendingFatigueLevel) {
          this.state.currentEnergyLevel = this.state.pendingFatigueLevel;
          if (this.storage) {
            try {
              this.storage.setItem('currentEnergyLevel', this.state.currentEnergyLevel.toString());
            } catch {}
          }
          this.updateEnergyVisualization(this.state.currentEnergyLevel);
        }
        this.hideFatigueModal();
        if (this.state.autoStartAfterFatigue) {
          this.state.autoStartAfterFatigue = false;
          this.startTimer();
        }
      });
    }

    const cancelFatigue = this.doc.getElementById('cancelFatigue');
    if (cancelFatigue) {
      this.bind(cancelFatigue, 'click', () => {
        this.hideFatigueModal();
        if (this.state.autoStartAfterFatigue) {
          this.state.autoStartAfterFatigue = false;
          this.startTimer();
        }
      });
    }

    // Initialize hologram visual state
    if (this.state.currentEnergyLevel) {
      this.updateEnergyVisualization(this.state.currentEnergyLevel);
    }
  }

  showFatigueModal(autoStart = false) {
    this.state.autoStartAfterFatigue = autoStart;
    const modal = this.doc.getElementById('fatigueModal');
    if (modal) modal.style.display = 'block';
  }

  hideFatigueModal() {
    const modal = this.doc.getElementById('fatigueModal');
    if (modal) modal.style.display = 'none';
  }

  updateEnergyVisualization(level, description = '') {
    const hologram = this.doc.getElementById('hologramContainer');
    if (hologram) {
      hologram.setAttribute('data-energy-level', level.toString());
      hologram.classList.remove('energy-low', 'energy-medium', 'energy-high');
      if (level <= 2) hologram.classList.add('energy-high');
      else if (level <= 5) hologram.classList.add('energy-medium');
      else hologram.classList.add('energy-low');
    }
  }

  // -------------------------------------------------------------
  // Stats & Real-Time Clock
  // -------------------------------------------------------------
  _initStatsAndClock() {
    this._updateStatsDisplay();

    // Clock updater
    const updateClock = () => {
      const clockEl = this.doc.getElementById('currentTime');
      if (clockEl) {
        clockEl.textContent = new Date().toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
        });
      }
      this._updateTitleClock();
    };

    updateClock();
    if (this.clockInterval) clearInterval(this.clockInterval);
    this.clockInterval = setInterval(updateClock, 1000);
  }

  _updateStatsDisplay() {
    const workEl = this.doc.getElementById('totalWorkTime');
    if (workEl) {
      workEl.textContent = this.formatTimeHHMMSS(this.state.totalWorkSeconds);
    }

    const pomodoroEl = this.doc.getElementById('pomodoroCount');
    if (pomodoroEl) {
      pomodoroEl.textContent = this.state.pomodoroCount.toString();
    }

    const utilEl = this.doc.getElementById('timeUtilization');
    if (utilEl) {
      // Simple percentage calculation based on standard 8hr daily baseline
      const pct = Math.min(100, Math.round((this.state.totalWorkSeconds / (8 * 3600)) * 100));
      utilEl.textContent = `${pct}%`;
    }

    // Persist stats periodically
    if (this.storage && this.state.totalWorkSeconds > 0) {
      try {
        this.storage.setItem('pomodoroStats', JSON.stringify({
          totalWorkTime: this.state.totalWorkSeconds,
          pomodoroCount: this.state.pomodoroCount,
          lastUpdated: new Date().toISOString()
        }));
      } catch {}
    }
  }

  formatTimeHHMMSS(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // -------------------------------------------------------------
  // AI, Simulation, and Tools Subsystem
  // -------------------------------------------------------------
  _initAiAndTools() {
    // AI Container Toggle
    const aiToggle = this.doc.getElementById('aiContainerToggle');
    const aiContainer = this.doc.querySelector('.ai-researcher-container');
    if (aiToggle && aiContainer) {
      this.bind(aiToggle, 'click', () => {
        aiContainer.classList.toggle('collapsed');
      });
    }

    // API Config Toggle
    const configBtn = this.doc.getElementById('toggleApiConfig');
    const configSection = this.doc.getElementById('apiConfigSection');
    if (configBtn && configSection) {
      this.bind(configBtn, 'click', () => {
        configSection.style.display = configSection.style.display === 'none' ? 'block' : 'none';
      });
    }

    // Simulation Popout Controls
    const popoutBtn = this.doc.getElementById('popoutSimulation');
    const popoutWin = this.doc.getElementById('simulationPopout');
    const minBtn = this.doc.getElementById('minimizeSimulationPopout');
    const closePopoutBtn = this.doc.getElementById('closeSimulationPopout');

    if (popoutBtn && popoutWin) {
      this.bind(popoutBtn, 'click', () => {
        popoutWin.style.display = 'block';
      });
    }
    if (minBtn && popoutWin) {
      this.bind(minBtn, 'click', () => {
        popoutWin.style.display = 'none';
      });
    }
    if (closePopoutBtn && popoutWin) {
      this.bind(closePopoutBtn, 'click', () => {
        popoutWin.style.display = 'none';
      });
    }
  }

  // -------------------------------------------------------------
  // Theme and Keyboard Shortcuts
  // -------------------------------------------------------------
  _initThemeAndShortcuts() {
    // Theme setup via canonical themeManager
    if (this.win?.themeManager?.initializeTheme) {
      try { this.win.themeManager.initializeTheme(); } catch {}
    } else if (this.storage) {
      try {
        const savedTheme = this.storage.getItem('theme');
        if (savedTheme === 'light' && this.doc && this.doc.body) {
          this.doc.body.classList.add('light-theme');
          this.doc.documentElement?.setAttribute?.('data-theme', 'light');
        }
      } catch {}
    }

    // Debug Mode Shortcut: Ctrl+Shift+D
    this.bind(this.doc, 'keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        this.doc.body.classList.toggle('task-debug-mode');
      }
    });
  }

  // -------------------------------------------------------------
  // Global Compatibility Shim Wiring
  // -------------------------------------------------------------
  _exposeGlobalShims() {
    if (!this.win) return;

    this.win.initGrindPage = () => initGrindPage();
    this.win.startTimer = () => this.startTimer();
    this.win.pauseTimer = () => this.pauseTimer();
    this.win.resetTimer = () => this.resetTimer();
    this.win.toggleWorkspace = (force) => this.toggleWorkspace(force);
    this.win.rotateQuote = (dir) => this.rotateQuote(dir);
    this.win.showTaskModal = () => this.showTaskModal();
    this.win.hideTaskModal = () => this.hideTaskModal();
    this.win.createTask = () => this.createTask();
    this.win.showFatigueModal = (auto) => this.showFatigueModal(auto);
    this.win.hideFatigueModal = () => this.hideFatigueModal();
    this.win.updateEnergyVisualization = (lvl, desc) => this.updateEnergyVisualization(lvl, desc);
    this.win.displayPriorityTask = () => this._renderPriorityTasks();
    this.win.navigateTask = (dir) => this.rotateQuote(dir === 'next' ? 1 : -1);

    this.win.toggleTheme = () => {
      if (typeof this.win.themeManager?.toggleTheme === 'function') {
        return this.win.themeManager.toggleTheme();
      }
      const isLight = this.doc.body.classList.toggle('light-theme');
      const nextTheme = isLight ? 'light' : 'dark';
      this.doc.documentElement?.setAttribute?.('data-theme', nextTheme);
      if (this.storage) {
        this.storage.setItem('theme', nextTheme);
      }
      return nextTheme;
    };

    this.win.safeAddEventListener = (sel, ev, fn) => this.bind(sel, ev, fn);
  }

  /**
   * Teardown previous event listeners and intervals to guarantee single-handler sets.
   */
  destroy() {
    this.abortController.abort();
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.clockInterval) clearInterval(this.clockInterval);
    if (this.quoteInterval) clearInterval(this.quoteInterval);
    this.timerInterval = null;
    this.clockInterval = null;
    this.quoteInterval = null;
  }
}

/**
 * Awaited entry point for Grind page initialization.
 * Guaranteed idempotent: calling twice binds one handler set.
 *
 * @param {Object} options - Optional environment overrides (window, document, storage, force)
 * @returns {Promise<GrindPageController>}
 */
export async function initGrindPage(options = {}) {
  // If already initialized and not forced, return existing controller without re-binding
  if (activeController && !options.force) {
    return activeController;
  }

  // Clean up previous instance before re-initializing
  if (activeController) {
    activeController.destroy();
  }

  const controller = new GrindPageController(options);
  activeController = controller;
  await controller.init();
  return controller;
}

export function getGrindState() {
  return activeController ? activeController.state : null;
}

export function destroyGrindPage() {
  if (activeController) {
    activeController.destroy();
    activeController = null;
  }
}

export default initGrindPage;

// Auto-bootstrap in browser module context
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.initGrindPage = initGrindPage;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initGrindPage().catch(err => console.error('[GrindPage] Bootstrap error:', err));
    }, { once: true });
  } else {
    initGrindPage().catch(err => console.error('[GrindPage] Bootstrap error:', err));
  }
}
