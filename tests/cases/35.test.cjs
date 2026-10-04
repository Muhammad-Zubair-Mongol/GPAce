const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  toggle(value, force) {
    const next = force === undefined ? !this.values.has(value) : Boolean(force);
    if (next) this.add(value); else this.remove(value);
    return next;
  }
  contains(value) { return this.values.has(value); }
}

class Element {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.dataset = {};
    this.attributes = {};
    this.classList = new ClassList();
    this.style = {};
    this.listeners = new Map();
    this.disabled = false;
    this.title = '';
    this.innerHTML = '';
    this.textContent = '';
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  dispatch(type) {
    const event = { type, target: this, preventDefault() {} };
    (this.listeners.get(type) || []).forEach(handler => handler(event));
  }
}

class GrindDocument {
  constructor() {
    this.readyState = 'complete';
    this.title = '';
    this.nodes = new Map();
    this.nodes.set('customTimeInput', new Element('customTimeInput'));
    this.nodes.set('startBtn', new Element('startBtn'));
    this.nodes.set('resetBtn', new Element('resetBtn'));
    this.nodes.set('generateSimulationBtn', new Element('generateSimulationBtn'));
    this.listeners = new Map();
  }
  getElementById(id) { return this.nodes.get(id) || null; }
  querySelector(selector) {
    if (selector.startsWith('#')) return this.getElementById(selector.slice(1));
    return null;
  }
  querySelectorAll() { return []; }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  removeEventListener() {}
}

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

describe('Step 35: Grind controls and embedded region accessibility', () => {
  let grind;

  afterEach(() => {
    grind?.destroyGrindPage?.();
    grind = null;
  });

  it('names controls and frames, labels the duration, and makes stats inspectable', () => {
    const html = fs.readFileSync(path.join(ROOT, 'grind.html'), 'utf8');
    const allFrames = [...html.matchAll(/<iframe\b([^>]*)>/gi)].map(match => match[1]);
    const frames = allFrames.filter(attributes => /\bsandbox="allow-scripts"/i.test(attributes));
    assert.equal(allFrames.length, 3, 'workspace plus two simulation regions are intentional');
    assert.equal(frames.length, 2, 'two sandboxed embedded simulation regions are expected');
    allFrames.forEach(attributes => assert.match(attributes, /\btitle="[^"]+"/i));
    assert.match(html, /id="customTimeInput"[^>]*min="1"[^>]*max="60"[^>]*required/);
    assert.match(html, /<label[^>]+for="customTimeInput"[^>]*>[\s\S]*?duration/i);
    assert.match(html, /id="customTimeInput"[^>]*aria-describedby="customTimeHint"/);
    assert.doesNotMatch(html, /id="stats-container-does-not-exist"/i);
    assert.match(html, /class="stats-container modern"[^>]*role="region"[^>]*tabindex="0"[^>]*aria-labelledby="statsHeading"/);
    assert.match(html, /id="statsHeading"[^>]*>Study session statistics/);
    for (const label of ['Open workspace', 'Close workspace', 'Previous motivational quote', 'Next motivational quote', 'Start focus timer', 'Reset focus timer', 'Search with AI']) {
      assert.match(html, new RegExp('aria-label="' + label + '"'));
    }
    assert.doesNotMatch(html, /sandbox="allow-scripts allow-same-origin"/i);
  });

  it('rejects out-of-range timer input through the live controller contract', async () => {
    const moduleUrl = new URL('file:///' + path.join(ROOT, 'js/pages/grind.js').replace(/\\/g, '/')).href;
    grind = await import(moduleUrl);
    grind.destroyGrindPage();
    const documentRef = new GrindDocument();
    const windowRef = {
      innerWidth: 1024,
      addEventListener() {},
      removeEventListener() {},
      setInterval() { return null; },
      clearInterval() {},
      localStorage: storage()
    };
    const controller = await grind.initGrindPage({
      document: documentRef,
      window: windowRef,
      storage: windowRef.localStorage,
      force: true
    });
    const input = documentRef.getElementById('customTimeInput');

    input.value = '0';
    input.dispatch('input');
    assert.equal(input.value, 1);
    assert.equal(controller.state.duration, 60);

    input.value = '120';
    input.dispatch('change');
    assert.equal(input.value, 60);
    assert.equal(controller.state.duration, 3600);
  });
});
