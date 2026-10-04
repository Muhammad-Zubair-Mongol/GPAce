#!/usr/bin/env node

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const priority = require('../priority-calculator.js');
const { calculatePrioritiesWithWorker } = require('../js/priority-worker-wrapper.js');
const { AnalysisJobManager } = require('../server/services/analysis-jobs.js');

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_BUDGET_PATH = path.join(ROOT, 'tests', 'fixtures', 'performance-budget.json');

const QUIET_CONSOLE = Object.freeze({
  log() {},
  info() {},
  warn() {},
  error() {},
  debug() {}
});

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function digest(value) {
  let hash = 2166136261;
  const source = JSON.stringify(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function roundMs(value) {
  return Math.round(value * 1000) / 1000;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function summarizeSamples(samples) {
  return {
    samplesMs: samples.map(roundMs),
    medianMs: roundMs(percentile(samples, 0.5)),
    p95Ms: roundMs(percentile(samples, 0.95))
  };
}

async function measureRuns(label, operation, options = {}) {
  const runs = Number.isInteger(options.runs) ? options.runs : 5;
  const warmupRuns = Number.isInteger(options.warmupRuns) ? options.warmupRuns : 1;
  for (let index = 0; index < warmupRuns; index += 1) await operation();

  const samples = [];
  let lastValue;
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    lastValue = await operation();
    samples.push(performance.now() - started);
  }
  return {
    label,
    runs,
    warmupRuns,
    ...summarizeSamples(samples),
    lastValue
  };
}

function loadBudget(budgetPath = DEFAULT_BUDGET_PATH) {
  const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
  if (budget?.reproducibility?.offline !== true) {
    throw new Error('Step 58 performance fixture must remain offline');
  }
  if (budget?.reproducibility?.runs !== 5) {
    throw new Error('Step 58 performance fixture must record exactly five measured runs');
  }
  if (budget?.contracts?.jobDeadlineMs !== 10000) {
    throw new Error('Step 58 job deadline must remain 10000ms');
  }
  return budget;
}

function buildScoringFixture({ taskCount = 1000, seed = 58058, now, timeZone, calendarMode = 'explicit' } = {}) {
  if (!Number.isInteger(taskCount) || taskCount < 1) throw new TypeError('taskCount must be a positive integer');
  const subjectCount = 10;
  const subjects = Array.from({ length: subjectCount }, (_, subjectIndex) => ({
    tag: `fixture-subject-${String(subjectIndex).padStart(2, '0')}`,
    name: `Fixture Subject ${subjectIndex}`,
    relativeScore: 40 + ((seed + subjectIndex * 7) % 60),
    cognitiveDifficulty: 10 + ((seed + subjectIndex * 11) % 90)
  }));
  const tasks = Object.fromEntries(subjects.map(subject => [subject.tag, []]));
  for (let index = 0; index < taskCount; index += 1) {
    const subject = subjects[index % subjects.length];
    const month = String(9 + Math.floor(index / 30) % 3).padStart(2, '0');
    const day = String(1 + (index * 7) % 28).padStart(2, '0');
    const section = ['Assignment', 'Quiz', 'Midterm', 'Final', 'Revision'][index % 5];
    tasks[subject.tag].push({
      id: `fixture-task-${String(index).padStart(4, '0')}`,
      section,
      dueDate: `2026-${month}-${day}`,
      completed: false,
      title: `Offline scoring fixture task ${index}`
    });
  }

  const academicPerformance = Object.fromEntries(subjects.map((subject, index) => [
    subject.tag,
    (index * 13 + seed) % 101
  ]));
  const subjectWeightages = Object.fromEntries(subjects.map(subject => [subject.tag, {
    assignment: 15,
    quiz: 10,
    midterm: 30,
    final: 40,
    revision: 5
  }]));
  const scoringTimeZone = calendarMode === 'runtime' ? undefined : (timeZone || 'UTC');
  const options = {
    subjects,
    tasks,
    academicPerformance,
    taskWeightages: { subjectWeightages, projectWeightages: {} },
    now: now || '2026-09-29T12:00:00.000Z',
    timeZone: scoringTimeZone
  };
  return {
    taskCount,
    directInput: options,
    workerInput: {
      subjects,
      allTasks: tasks,
      subjectMarks: Object.fromEntries(subjects.map(subject => [subject.tag, {
        _performance: academicPerformance[subject.tag]
      }])),
      subjectWeightages,
      projectWeightages: {},
      now: options.now,
      timeZone: options.timeZone
    }
  };
}

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
  const writes = [];
  return {
    values,
    writes,
    get(key, fallback) { return values.has(key) ? clone(values.get(key)) : clone(fallback); },
    set(key, value) {
      writes.push({ key, value: clone(value) });
      values.set(key, clone(value));
      return { success: true, status: 'success' };
    },
    getItem(key) { return values.has(key) ? JSON.stringify(values.get(key)) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function makeEventTarget(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
      if (listeners.get(type)?.size === 0) listeners.delete(type);
    },
    dispatchEvent(event) {
      for (const callback of [...(listeners.get(event.type) || [])]) callback(event);
      return true;
    },
    listenerCount(type) { return listeners.get(type)?.size || 0; },
    totalListeners() {
      let count = 0;
      for (const callbacks of listeners.values()) count += callbacks.size;
      return count;
    }
  };
}

class FixtureCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

function loadPomodoroTimer() {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'pomodoroTimer.js'), 'utf8');
  const intervals = new Map();
  const timeouts = new Map();
  let nextTimerId = 1;
  const storage = makeStorage();
  const windowRef = makeEventTarget({
    getStorage: () => storage,
    CustomEvent: FixtureCustomEvent,
    Notification: { permission: 'denied', requestPermission: async () => 'denied' }
  });
  windowRef.window = windowRef;
  const documentRef = makeEventTarget({
    hidden: false,
    visibilityState: 'visible',
    body: { appendChild() {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ classList: { add() {}, remove() {} }, remove() {} })
  });
  const context = {
    console: QUIET_CONSOLE,
    window: windowRef,
    document: documentRef,
    navigator: {},
    Notification: windowRef.Notification,
    Audio: class AudioFixture { play() { return Promise.resolve(); } },
    CustomEvent: FixtureCustomEvent,
    requestAnimationFrame: callback => callback(),
    setInterval(callback) {
      const id = nextTimerId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback) {
      const id = nextTimerId++;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeout(id) { timeouts.delete(id); }
  };
  vm.runInNewContext(source, context, { filename: 'js/pomodoroTimer.js' });
  return {
    Timer: windowRef.PomodoroTimer,
    window: windowRef,
    document: documentRef,
    storage,
    intervals,
    timeouts
  };
}

function timerBoundaryProbe() {
  const runtime = loadPomodoroTimer();
  let now = 0;
  const timer = new runtime.Timer({
    forceNew: true,
    now: () => now,
    setInterval: (callback, delay) => {
      const id = runtime.intervals.size + 1;
      runtime.intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval: id => runtime.intervals.delete(id),
    setTimeout: (callback, delay) => {
      const id = 1000 + runtime.timeouts.size + 1;
      runtime.timeouts.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => runtime.timeouts.delete(id)
  });
  timer.state.isRunning = true;
  timer.state.timeLeft = 10;
  timer._lastPersistedBoundary = null;
  const stateWrites = () => runtime.storage.writes.filter(write => write.key === timer.STATE_KEY).length;

  timer._persistBoundaryIfNeeded();
  const firstBoundaryWrites = stateWrites();
  timer._persistBoundaryIfNeeded();
  const duplicateBoundaryWrites = stateWrites() - firstBoundaryWrites;
  timer.state.timeLeft = 5;
  timer._persistBoundaryIfNeeded();
  const secondBoundaryWrites = stateWrites() - firstBoundaryWrites - duplicateBoundaryWrites;
  timer.dispose();
  timer.state.timeLeft = 0;
  timer._persistBoundaryIfNeeded();

  return {
    firstBoundaryWrites,
    duplicateBoundaryWrites,
    secondBoundaryWrites,
    maxWritesPerBoundary: Math.max(firstBoundaryWrites, duplicateBoundaryWrites, secondBoundaryWrites),
    liveIntervalsAfterDispose: runtime.intervals.size,
    liveTimeoutsAfterDispose: runtime.timeouts.size,
    liveWindowListenersAfterDispose: runtime.window.totalListeners(),
    liveDocumentListenersAfterDispose: runtime.document.totalListeners() - 1
  };
}

function lifecycleProbe(cycles) {
  const runtime = loadPomodoroTimer();
  const baselineDocumentListeners = runtime.document.totalListeners();
  let maxLiveListenersAfterDispose = 0;
  let maxLiveIntervalsAfterDispose = 0;
  let maxLiveTimeoutsAfterDispose = 0;
  let lastWindowListeners = 0;
  let lastDocumentListeners = baselineDocumentListeners;

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const timer = new runtime.Timer({
      forceNew: true,
      now: () => 0,
      setInterval: (callback, delay) => {
        const id = runtime.intervals.size + cycle * 100 + 1;
        runtime.intervals.set(id, { callback, delay });
        return id;
      },
      clearInterval: id => runtime.intervals.delete(id),
      setTimeout: (callback, delay) => {
        const id = 10000 + runtime.timeouts.size + cycle * 100;
        runtime.timeouts.set(id, { callback, delay });
        return id;
      },
      clearTimeout: id => runtime.timeouts.delete(id)
    });
    timer.dispose();
    lastWindowListeners = runtime.window.totalListeners();
    lastDocumentListeners = runtime.document.totalListeners();
    maxLiveListenersAfterDispose = Math.max(maxLiveListenersAfterDispose, lastWindowListeners);
    maxLiveListenersAfterDispose = Math.max(maxLiveListenersAfterDispose, lastDocumentListeners - baselineDocumentListeners);
    maxLiveIntervalsAfterDispose = Math.max(maxLiveIntervalsAfterDispose, runtime.intervals.size);
    maxLiveTimeoutsAfterDispose = Math.max(maxLiveTimeoutsAfterDispose, runtime.timeouts.size);
  }

  return {
    cycles,
    baselineDocumentListeners,
    maxLiveListenersAfterDispose,
    lastWindowListeners,
    lastDocumentListeners,
    maxLiveIntervalsAfterDispose,
    maxLiveTimeoutsAfterDispose
  };
}

class SharedBroadcastChannel {
  static peers = new Map();

  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
    if (!SharedBroadcastChannel.peers.has(name)) SharedBroadcastChannel.peers.set(name, new Set());
    SharedBroadcastChannel.peers.get(name).add(this);
  }

  postMessage(message) {
    if (this.closed) return;
    for (const peer of SharedBroadcastChannel.peers.get(this.name) || []) {
      if (peer !== this && !peer.closed && typeof peer.onmessage === 'function') {
        peer.onmessage({ data: clone(message) });
      }
    }
  }

  close() {
    this.closed = true;
    SharedBroadcastChannel.peers.get(this.name)?.delete(this);
    if (SharedBroadcastChannel.peers.get(this.name)?.size === 0) SharedBroadcastChannel.peers.delete(this.name);
  }

  static liveCount() {
    let count = 0;
    for (const peers of SharedBroadcastChannel.peers.values()) count += peers.size;
    return count;
  }
}

function loadCrossTabSync() {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'cross-tab-sync.js'), 'utf8');
  const singletonStart = source.indexOf('// Export a singleton instance');
  if (singletonStart < 0) throw new Error('CrossTabSync singleton boundary not found');
  const executable = `${source.slice(0, singletonStart)}\nglobalThis.__CrossTabSync = CrossTabSync;`;
  const context = {
    console: QUIET_CONSOLE,
    Date,
    Math,
    Map,
    Set,
    JSON,
    CustomEvent: FixtureCustomEvent
  };
  vm.runInNewContext(executable, context, { filename: 'js/cross-tab-sync.js' });
  return context.__CrossTabSync;
}

let syncNamespace = 0;

function syncProbe(tabCount, messageCount) {
  if (tabCount !== 2) throw new Error('Step 58 sync fixture requires exactly two tabs');
  const CrossTabSync = loadCrossTabSync();
  const namespace = `step58-sync-${syncNamespace++}`;
  const sharedStorage = makeStorage();
  const tabWindows = Array.from({ length: tabCount }, () => makeEventTarget({
    location: { pathname: '/priority-calculator.html' },
    CustomEvent: FixtureCustomEvent
  }));
  const tabs = tabWindows.map(windowRef => {
    const tab = new CrossTabSync(namespace, {
      window: windowRef,
      storage: sharedStorage,
      BroadcastChannel: SharedBroadcastChannel
    });
    tab.setupStorageListener();
    return tab;
  });
  const received = [];
  const receivedHandler = event => received.push(event.detail);
  tabWindows[1].addEventListener('gpace:task-update', receivedHandler);
  for (let index = 0; index < messageCount; index += 1) {
    tabs[0].broadcastAction('task-update', {
      projectId: 'fixture-project',
      taskId: `fixture-task-${index}`,
      revision: index + 1
    });
  }
  const beforeDispose = {
    received: received.length,
    liveChannels: SharedBroadcastChannel.liveCount(),
    liveListeners: tabWindows.reduce((sum, windowRef) => sum + windowRef.totalListeners(), 0)
  };
  tabWindows[1].removeEventListener('gpace:task-update', receivedHandler);
  tabs.forEach(tab => tab.destroy());
  const afterDispose = {
    liveChannels: SharedBroadcastChannel.liveCount(),
    liveListeners: tabWindows.reduce((sum, windowRef) => sum + windowRef.totalListeners(), 0)
  };
  return { tabCount, messageCount, beforeDispose, afterDispose };
}

class FixtureWorker {
  constructor() {
    this.listeners = new Map();
    this.terminated = false;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
    return this;
  }

  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
    return this;
  }

  emit(event, value) {
    for (const callback of [...(this.listeners.get(event) || [])]) callback(value);
  }

  terminate() {
    this.terminated = true;
    this.listeners.clear();
    return Promise.resolve();
  }

  listenerCount() {
    let count = 0;
    for (const callbacks of this.listeners.values()) count += callbacks.size;
    return count;
  }
}

function validFixtureEvent(uid, jobIndex) {
  return {
    id: `${uid}-event-${jobIndex}`,
    subject: 'Offline fixture class',
    type: 'class',
    date: '2026-09-29',
    startTime: '09:00',
    endTime: '10:00'
  };
}

async function backendProbe({ jobs, deadlineMs }) {
  const liveWorkers = new Set();
  const saved = [];
  const repository = {
    forTenant(uid) {
      return {
        async saveTimetable(events) {
          saved.push({ uid, events: clone(events) });
          return true;
        }
      };
    }
  };
  const uploadStore = {
    async read(uid, uploadId) {
      return { uid, uploadId, mime: 'image/png', buffer: Buffer.from('offline-upload-fixture') };
    }
  };
  let jobIndex = 0;
  const manager = new AnalysisJobManager({
    timeoutMs: deadlineMs,
    maxConcurrent: 2,
    repository,
    uploadStore,
    emit() {},
    workerFactory: async () => {
      const worker = new FixtureWorker();
      liveWorkers.add(worker);
      const current = jobIndex++;
      setImmediate(() => {
        if (!worker.terminated) worker.emit('message', { events: [validFixtureEvent('backend-user', current)] });
      });
      return worker;
    }
  });

  for (let index = 0; index < jobs; index += 1) {
    const result = await manager.run({
      uid: 'backend-user',
      uploadId: 'offline-upload',
      timezone: 'UTC'
    });
    if (result.status !== 'completed' || result.events.length !== 1) {
      throw new Error('bounded backend fixture did not complete a valid job');
    }
  }

  const deadlineClock = {
    nextId: 1,
    timers: new Map(),
    delays: [],
    setTimeout(callback, delay) {
      const id = this.nextId++;
      this.timers.set(id, callback);
      this.delays.push(delay);
      return id;
    },
    clearTimeout(id) { this.timers.delete(id); },
    fireAll() {
      for (const [id, callback] of [...this.timers]) {
        this.timers.delete(id);
        callback();
      }
    }
  };
  const slowWorker = new FixtureWorker();
  const deadlineManager = new AnalysisJobManager({
    timeoutMs: deadlineMs,
    clock: deadlineClock,
    repository,
    uploadStore,
    emit() {},
    workerFactory: async () => slowWorker
  });
  const pending = deadlineManager.run({
    uid: 'deadline-user',
    uploadId: 'offline-upload',
    timezone: 'UTC'
  });
  for (let attempt = 0; attempt < 20 && deadlineClock.timers.size === 0; attempt += 1) {
    await Promise.resolve();
  }
  const scheduledDeadline = deadlineClock.delays[0];
  deadlineClock.fireAll();
  let deadlineError = null;
  try {
    await pending;
  } catch (error) {
    deadlineError = error;
  }
  await Promise.resolve();

  return {
    completedJobs: saved.length,
    deadlineMs,
    scheduledDeadline,
    deadlineError: deadlineError ? { status: deadlineError.status, code: deadlineError.code } : null,
    activeJobsAfterDispose: manager.activeCount + deadlineManager.activeCount,
    pendingJobRecordsAfterDispose: manager.jobs.size + deadlineManager.jobs.size,
    liveWorkersAfterDispose: [...liveWorkers].filter(worker => !worker.terminated).length,
    slowWorkerTerminated: slowWorker.terminated,
    slowWorkerListenersAfterDispose: slowWorker.listenerCount(),
    bounded: saved.length === jobs &&
      scheduledDeadline === deadlineMs &&
      deadlineError?.status === 504 &&
      deadlineError?.code === 'ANALYSIS_TIMEOUT' &&
      manager.activeCount + deadlineManager.activeCount === 0 &&
      manager.jobs.size + deadlineManager.jobs.size === 0 &&
      [...liveWorkers].every(worker => worker.terminated) &&
      slowWorker.terminated &&
      slowWorker.listenerCount() === 0
  };
}

function budgetResult(measurement, budget) {
  return {
    ...measurement,
    budget,
    pass: measurement.medianMs <= budget.medianMs && measurement.p95Ms <= budget.p95Ms
  };
}

function environmentReport() {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model || 'unknown',
    totalMemoryMiB: Math.round(os.totalmem() / 1024 / 1024),
    execPath: process.execPath
  };
}

export async function runProfiler(options = {}) {
  const budget = options.budget || loadBudget(options.budgetPath || DEFAULT_BUDGET_PATH);
  const reproducibility = budget.reproducibility;
  if (reproducibility.calendarMode === 'runtime' && reproducibility.timeZone) {
    process.env.TZ = reproducibility.timeZone;
  }
  const runOptions = {
    runs: reproducibility.runs,
    warmupRuns: reproducibility.warmupRuns
  };
  const fixture = buildScoringFixture({
    taskCount: reproducibility.taskCount,
    seed: reproducibility.seed,
    now: reproducibility.now,
    timeZone: reproducibility.timeZone,
    calendarMode: reproducibility.calendarMode
  });
  const directResult = priority.calculateTaskPrioritiesPure(fixture.directInput);
  const directDigest = digest(directResult);
  let workerDigest = null;
  let workerCount = 0;
  const workerSmokeStarted = performance.now();
  const workerSmokeResult = await calculatePrioritiesWithWorker(fixture.workerInput, {
    timeoutMs: reproducibility.backendJobs ? budget.contracts.jobDeadlineMs : 10000,
    workerFactory: (source, workerOptions) => new Worker(source, {
      ...workerOptions,
      type: 'commonjs'
    })
  });
  const workerSmokeMs = roundMs(performance.now() - workerSmokeStarted);
  workerCount = workerSmokeResult.length;
  workerDigest = digest(workerSmokeResult);
  const scoringMeasurement = await measureRuns('1000-task-scoring', async () => {
    const result = priority.calculateTaskPrioritiesPure(fixture.directInput);
    return result.length;
  }, runOptions);
  const scoring = budgetResult(scoringMeasurement, budget.budgets.scoring);
  scoring.lastValue = undefined;

  let lifecycleResourceCheck = null;
  const lifecycleMeasurement = await measureRuns('20-open-close-cycles', async () => {
    const result = lifecycleProbe(reproducibility.openCloseCycles);
    lifecycleResourceCheck = result;
    return result.cycles;
  }, runOptions);
  const lifecycle = budgetResult(lifecycleMeasurement, budget.budgets.lifecycle);
  lifecycle.lastValue = undefined;

  let syncResourceCheck = null;
  const syncMeasurement = await measureRuns('two-tab-sync', async () => {
    const result = syncProbe(reproducibility.syncTabs, reproducibility.syncMessages);
    syncResourceCheck = result;
    return result.beforeDispose.received;
  }, runOptions);
  const sync = budgetResult(syncMeasurement, budget.budgets.sync);
  sync.lastValue = undefined;

  let backendResourceCheck = null;
  const backendMeasurement = await measureRuns('bounded-backend-jobs', async () => {
    const result = await backendProbe({
      jobs: reproducibility.backendJobs,
      deadlineMs: budget.contracts.jobDeadlineMs
    });
    backendResourceCheck = result;
    return result.completedJobs;
  }, runOptions);
  const backendJobs = budgetResult(backendMeasurement, budget.budgets.backendJobs);
  backendJobs.lastValue = undefined;

  const timerBoundary = timerBoundaryProbe();
  const resourceChecks = {
    lifecycle: lifecycleResourceCheck,
    backend: backendResourceCheck,
    maxLiveWorkersAfterDispose: Math.max(
      backendResourceCheck?.liveWorkersAfterDispose || 0,
      backendResourceCheck?.slowWorkerTerminated === false ? 1 : 0
    ),
    maxLiveListenersAfterDispose: Math.max(
      lifecycleResourceCheck?.maxLiveListenersAfterDispose || 0,
      syncResourceCheck?.afterDispose.liveListeners || 0,
      backendResourceCheck?.slowWorkerListenersAfterDispose || 0
    ),
    maxLiveIntervalsAfterDispose: Math.max(
      lifecycleResourceCheck?.maxLiveIntervalsAfterDispose || 0,
      timerBoundary.liveIntervalsAfterDispose || 0
    ),
    timerWritesPerBoundary: timerBoundary.maxWritesPerBoundary,
    deadlineMs: backendResourceCheck?.scheduledDeadline,
    deadlineProbe: backendResourceCheck?.deadlineError,
    bounded: backendResourceCheck?.bounded === true
  };
  const contractPass =
    workerCount === reproducibility.taskCount &&
    workerDigest === directDigest &&
    lifecycleResourceCheck?.maxLiveListenersAfterDispose <= budget.contracts.maxLiveListenersAfterDispose &&
    lifecycleResourceCheck?.maxLiveIntervalsAfterDispose <= budget.contracts.maxLiveIntervalsAfterDispose &&
    syncResourceCheck?.beforeDispose.received === reproducibility.syncMessages &&
    syncResourceCheck?.afterDispose.liveChannels === 0 &&
    syncResourceCheck?.afterDispose.liveListeners === 0 &&
    backendResourceCheck?.activeJobsAfterDispose === 0 &&
    backendResourceCheck?.pendingJobRecordsAfterDispose === 0 &&
    backendResourceCheck?.liveWorkersAfterDispose <= budget.contracts.maxLiveWorkersAfterDispose &&
    backendResourceCheck?.slowWorkerTerminated === true &&
    backendResourceCheck?.slowWorkerListenersAfterDispose === 0 &&
    backendResourceCheck?.scheduledDeadline === budget.contracts.jobDeadlineMs &&
    backendResourceCheck?.deadlineError?.status === 504 &&
    backendResourceCheck?.deadlineError?.code === 'ANALYSIS_TIMEOUT' &&
    backendResourceCheck?.bounded === true &&
    timerBoundary.maxWritesPerBoundary <= budget.contracts.maxDurableTimerWritesPerBoundary;

  return {
    schemaVersion: budget.schemaVersion,
    fixture: reproducibility,
    environment: environmentReport(),
    measurements: { scoring, lifecycle, sync, backendJobs },
    deterministicChecks: {
      taskCount: reproducibility.taskCount,
      directDigest,
      workerDigest,
      workerCount,
      workerSmokeMs,
      syncMessagesReceived: syncResourceCheck?.beforeDispose.received
    },
    resourceChecks,
    timerBoundary,
    limitations: budget.limitations,
    warnings: [
      'Browser rendering metrics (CLS, INP, LCP) were not measured in the Node-only harness.',
      'No Firebase Auth or Firestore emulator was contacted; backend jobs use local injected fixtures.'
    ],
    pass: scoring.pass && lifecycle.pass && sync.pass && backendJobs.pass && contractPass
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  runProfiler().then(report => {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.pass ? 0 : 1;
  }).catch(error => {
    console.error('[profile-hot-paths] failed:', error.message);
    process.exitCode = 1;
  });
}
