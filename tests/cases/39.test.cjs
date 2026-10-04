/** Step 39: one timer owner, deadline timekeeping, and bounded persistence. */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTimerRuntime() {
  let now = 0;
  let nextId = 1;
  const intervals = new Map();
  const timeouts = new Map();
  const writes = [];
  const stored = new Map();

  const storage = {
    get(key, fallback) {
      return stored.has(key) ? structuredClone(stored.get(key)) : structuredClone(fallback);
    },
    set(key, value) {
      writes.push({ key, value: structuredClone(value) });
      stored.set(key, structuredClone(value));
      return true;
    }
  };
  const listeners = new Map();
  const document = {
    hidden: false,
    visibilityState: 'visible',
    title: '',
    body: null,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, handler) { listeners.set(`document:${type}`, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(`document:${type}`) === handler) listeners.delete(`document:${type}`);
    }
  };
  const window = {
    getStorage: () => storage,
    addEventListener(type, handler) { listeners.set(`window:${type}`, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(`window:${type}`) === handler) listeners.delete(`window:${type}`);
    },
    dispatchEvent() {},
    stats: null,
    showNotification() {}
  };

  const context = {
    console,
    window,
    document,
    navigator: {},
    Notification: { permission: 'denied', requestPermission: async () => 'denied' },
    Audio: class Audio { play() { return Promise.resolve(); } },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Date,
    Math,
    JSON,
    structuredClone,
    requestAnimationFrame: callback => callback(),
    setInterval(callback) { const id = nextId++; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback, delay) { const id = nextId++; timeouts.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timeouts.delete(id); }
  };
  window.window = window;

  const source = fs.readFileSync(path.resolve(__dirname, '../../js/pomodoroTimer.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'js/pomodoroTimer.js' });

  return {
    context,
    Timer: context.window.PomodoroTimer,
    clock: {
      now: () => now,
      advance(ms) { now += ms; }
    },
    intervals,
    timeouts,
    writes,
    storage,
    disposeAll() {
      for (const callback of [...intervals.values()]) callback();
    }
  };
}

describe('Step 39: Timer persistence and ownership', () => {
  it('persists each five-second boundary at most once', () => {
    const runtime = createTimerRuntime();
    const timer = new runtime.Timer({
      now: runtime.clock.now,
      setInterval: runtime.context.setInterval,
      clearInterval: runtime.context.clearInterval,
      setTimeout: runtime.context.setTimeout,
      clearTimeout: runtime.context.clearTimeout
    });
    timer.state.timeLeft = 10;
    timer.startTimer();
    const tick = runtime.intervals.get(timer._timerInterval);
    const initialWrites = runtime.writes.filter(write => write.key === timer.STATE_KEY).length;

    runtime.clock.advance(5000);
    tick();
    tick();
    const boundaryWrites = runtime.writes.filter(write => write.key === timer.STATE_KEY).length;
    assert.equal(boundaryWrites, initialWrites + 1);
    timer.dispose();
  });

  it('completes once after a background jump and ignores stale callbacks after disposal', () => {
    const runtime = createTimerRuntime();
    const timer = new runtime.Timer({
      now: runtime.clock.now,
      setInterval: runtime.context.setInterval,
      clearInterval: runtime.context.clearInterval,
      setTimeout: runtime.context.setTimeout,
      clearTimeout: runtime.context.clearTimeout
    });
    let notifications = 0;
    timer.playSound = () => {};
    timer.showTimerNotification = () => { notifications++; };
    timer.state.timeLeft = 1;
    timer.startTimer();
    const staleTick = runtime.intervals.get(timer._timerInterval);
    runtime.clock.advance(1000);
    staleTick();
    staleTick();
    assert.equal(notifications, 1);
    assert.equal(timer.state.currentState, timer.TIMER_STATES.BREAK);

    const writesBeforeDispose = runtime.writes.length;
    timer.dispose();
    staleTick();
    assert.equal(runtime.writes.length, writesBeforeDispose);
  });

  it('preserves deadline semantics across pause, resume, and reset', () => {
    const runtime = createTimerRuntime();
    const timer = new runtime.Timer({
      now: runtime.clock.now,
      setInterval: runtime.context.setInterval,
      clearInterval: runtime.context.clearInterval,
      setTimeout: runtime.context.setTimeout,
      clearTimeout: runtime.context.clearTimeout
    });
    timer.state.timeLeft = 10;
    timer.startTimer();
    const firstDeadline = timer.state.endTime;
    runtime.clock.advance(3000);
    timer.pauseTimer();
    assert.equal(timer.state.isRunning, false);
    assert.equal(timer.state.endTime, null);
    assert.equal(timer.state.timeLeft, 7);

    runtime.clock.advance(5000);
    timer.startTimer();
    assert.equal(timer.state.endTime, runtime.clock.now() + 7000);
    assert.notEqual(timer.state.endTime, firstDeadline);
    timer.resetTimer();
    assert.equal(timer.state.timeLeft, timer.TIMER_DURATIONS.POMODORO);
    assert.equal(timer.state.endTime, null);
    timer.dispose();
  });

  it('returns one owner for repeated PomodoroTimer construction and disposes it cleanly', () => {
    const runtime = createTimerRuntime();
    const first = new runtime.Timer({
      now: runtime.clock.now,
      setInterval: runtime.context.setInterval,
      clearInterval: runtime.context.clearInterval,
      setTimeout: runtime.context.setTimeout,
      clearTimeout: runtime.context.clearTimeout
    });
    const second = new runtime.Timer({
      now: runtime.clock.now,
      setInterval: runtime.context.setInterval,
      clearInterval: runtime.context.clearInterval,
      setTimeout: runtime.context.setTimeout,
      clearTimeout: runtime.context.clearTimeout
    });
    assert.strictEqual(first, second);
    assert.equal(runtime.intervals.size, 1, 'only the owner periodic sync interval is active');
    first.dispose();
    assert.equal(runtime.intervals.size, 0);
  });

  it('makes TimerController initialization idempotent and keeps one active timer', async () => {
    const previous = {
      window: globalThis.window,
      document: globalThis.document,
      localStorage: globalThis.localStorage,
      Notification: globalThis.Notification,
      Audio: globalThis.Audio
    };
    const listeners = [];
    const intervals = new Map();
    let nextId = 1;
    const local = new Map();
    globalThis.window = globalThis;
    globalThis.document = {
      visibilityState: 'hidden',
      title: '',
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: (type, handler) => listeners.push({ type, handler }),
      removeEventListener: () => {}
    };
    globalThis.localStorage = {
      getItem: key => local.get(key) ?? null,
      setItem: (key, value) => local.set(key, String(value)),
      removeItem: key => local.delete(key)
    };
    globalThis.Notification = { permission: 'denied' };
    globalThis.Audio = class Audio { play() { return Promise.resolve(); } };
    globalThis.showNotification = () => {};

    const moduleUrl = new URL('../../js/controllers/TimerController.js', `file://${__dirname}/`).href + `?case39=${Date.now()}-${Math.random()}`;
    const controllerModule = await import(moduleUrl);
    controllerModule.default.dispose();
    const controller = new controllerModule.TimerController({
      now: () => 0,
      setInterval: callback => { const id = nextId++; intervals.set(id, callback); return id; },
      clearInterval: id => intervals.delete(id),
      setTimeout: callback => { const id = nextId++; intervals.set(id, callback); return id; },
      clearTimeout: id => intervals.delete(id),
      forceNew: true
    });
    assert.strictEqual(controller.init(), controller);
    assert.strictEqual(controller.init(), controller);
    assert.equal(controller.startTimer(), true);
    assert.equal(controller.startTimer(), false);
    assert.equal(controller.state.isRunning, true);
    controller.dispose();

    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.localStorage = previous.localStorage;
    globalThis.Notification = previous.Notification;
    globalThis.Audio = previous.Audio;
  });
});
