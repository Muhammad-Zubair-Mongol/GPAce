'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const BUDGET_PATH = path.join(ROOT, 'tests', 'fixtures', 'performance-budget.json');
const budget = JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8'));

const LOCKED_BUDGETS = Object.freeze({
  scoring: Object.freeze({ medianMs: 250, p95Ms: 1000 }),
  lifecycle: Object.freeze({ medianMs: 250, p95Ms: 1000 }),
  sync: Object.freeze({ medianMs: 250, p95Ms: 1000 }),
  backendJobs: Object.freeze({ medianMs: 1000, p95Ms: 3000 })
});

let report;

test.before(async () => {
  const profiler = await import('../../scripts/profile-hot-paths.mjs');
  report = await profiler.runProfiler({ budget });
});

test('Step 58: performance fixture records five offline runs and locked thresholds', () => {
  assert.equal(budget.reproducibility.offline, true);
  assert.equal(budget.reproducibility.runs, 5);
  assert.equal(budget.reproducibility.taskCount, 1000);
  assert.equal(budget.reproducibility.openCloseCycles, 20);
  assert.equal(budget.reproducibility.syncTabs, 2);
  assert.equal(budget.reproducibility.calendarMode, 'runtime');
  assert.equal(budget.contracts.jobDeadlineMs, 10000);
  assert.deepEqual(budget.budgets, LOCKED_BUDGETS, 'changing thresholds requires an explicit test diff');
  assert.equal(report.fixture.taskCount, 1000);
  assert.equal(report.environment.node.startsWith('v'), true);
  assert.equal(typeof report.environment.cpuCount, 'number');
});

test('Step 58: 1000-task scoring and measured hot paths stay within median and p95 budgets', () => {
  for (const [name, measurement] of Object.entries(report.measurements)) {
    assert.equal(measurement.runs, 5, `${name} must record five runs`);
    assert.equal(measurement.samplesMs.length, 5, `${name} must expose five samples`);
    assert.equal(Number.isFinite(measurement.medianMs), true);
    assert.equal(Number.isFinite(measurement.p95Ms), true);
    assert.equal(measurement.pass, true, `${name} exceeded its recorded budget`);
  }
  assert.equal(report.deterministicChecks.taskCount, 1000);
  assert.equal(report.deterministicChecks.workerCount, 1000);
  assert.equal(Number.isFinite(report.deterministicChecks.workerSmokeMs), true);
  assert.equal(report.deterministicChecks.directDigest, report.deterministicChecks.workerDigest);
  assert.equal(report.pass, true);
});

test('Step 58: 20 open/close cycles and two-tab sync leave no live resources', () => {
  assert.equal(report.measurements.lifecycle.pass, true);
  assert.equal(report.measurements.sync.pass, true);
  assert.equal(report.deterministicChecks.syncMessagesReceived, budget.reproducibility.syncMessages);
  assert.equal(report.resourceChecks.maxLiveListenersAfterDispose, budget.contracts.maxLiveListenersAfterDispose);
  assert.equal(report.resourceChecks.maxLiveIntervalsAfterDispose, budget.contracts.maxLiveIntervalsAfterDispose);
  assert.equal(report.resourceChecks.maxLiveWorkersAfterDispose, budget.contracts.maxLiveWorkersAfterDispose);
  assert.equal(report.resourceChecks.deadlineProbe.code, 'ANALYSIS_TIMEOUT');
  assert.equal(report.resourceChecks.deadlineProbe.status, 504);
  assert.equal(report.resourceChecks.bounded, true);
});

test('Step 58: backend deadline and durable timer write contracts remain bounded', () => {
  assert.equal(report.resourceChecks.deadlineMs, budget.contracts.jobDeadlineMs);
  assert.equal(report.timerBoundary.firstBoundaryWrites, 1);
  assert.equal(report.timerBoundary.duplicateBoundaryWrites, 0);
  assert.equal(report.timerBoundary.secondBoundaryWrites, 1);
  assert.ok(report.timerBoundary.maxWritesPerBoundary <= budget.contracts.maxDurableTimerWritesPerBoundary);
  assert.equal(report.timerBoundary.liveIntervalsAfterDispose, 0);
  assert.equal(report.timerBoundary.liveTimeoutsAfterDispose, 0);
  assert.equal(report.timerBoundary.liveWindowListenersAfterDispose, 0);
  assert.equal(report.timerBoundary.liveDocumentListenersAfterDispose, 0);
  assert.equal(report.measurements.backendJobs?.pass, true);
  assert.equal(report.resourceChecks.backend?.bounded, true);
  assert.equal(report.limitations.length >= 2, true);
  assert.match(report.warnings.join('\n'), /Browser rendering/);
  assert.match(report.warnings.join('\n'), /Firebase/);
});
