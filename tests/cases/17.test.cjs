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
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.classList = new ClassList();
    this.style = {};
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
  }
  set id(value) { this._id = String(value); this.attributes.id = this._id; }
  get id() { return this._id || ''; }
  set className(value) { this.classList = new ClassList(); String(value || '').split(/\s+/).filter(Boolean).forEach(v => this.classList.add(v)); }
  get className() { return [...this.classList.values].join(' '); }
  appendChild(child) { if (!child) return child; child.parentNode = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  insertBefore(child, before) { child.parentNode = this; const index = before ? this.children.indexOf(before) : -1; if (index < 0) this.children.push(child); else this.children.splice(index, 0, child); return child; }
  replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this._id = String(value); if (name === 'class') this.className = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(candidate => candidate !== handler)); }
  listenerCount(type) { return (this.listeners.get(type) || []).length; }
  dispatchEvent(event) { (this.listeners.get(event.type) || []).forEach(handler => handler.call(this, event)); }
  matches(selector) {
    if (selector === '*') return true;
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector === '[data-action]') return Boolean(this.dataset.action);
    if (selector === '.theme-toggle') return this.classList.contains('theme-toggle');
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  querySelectorAll(selector) {
    const result = [];
    const visit = node => { node.children.forEach(child => { if (child.matches(selector)) result.push(child); visit(child); }); };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { let node = this; while (node) { if (node.matches(selector)) return node; node = node.parentNode; } return null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
}

class Document {
  constructor() {
    this.readyState = 'complete';
    this.body = new Element('body', this);
    this.documentElement = new Element('html', this);
    this.documentElement.appendChild(this.body);
    this.listeners = new Map();
  }
  createElement(tag) { return new Element(tag, this); }
  getElementById(id) { return this.body.querySelector(`#${id}`); }
  querySelector(selector) { return this.body.querySelector(selector); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(candidate => candidate !== handler)); }
}

function makeSettingsDocument() {
  const doc = new Document();
  const main = doc.createElement('main'); main.id = 'main-content'; doc.body.appendChild(main);
  const status = doc.createElement('div'); status.id = 'settingsStatus'; doc.body.appendChild(status);
  const theme = doc.createElement('button'); theme.id = 'themeToggle'; theme.className = 'theme-toggle'; doc.body.appendChild(theme);
  for (const id of ['quoteText', 'quoteAuthor', 'quoteImage', 'roleModelName', 'roleModelImage']) {
    const input = doc.createElement('input'); input.id = id; main.appendChild(input);
  }
  for (const [id, label] of [['addQuoteBtn', 'Add'], ['addRoleModelBtn', 'Add']]) {
    const button = doc.createElement('button'); button.id = id; button.textContent = label; main.appendChild(button);
  }
  for (const id of ['quoteList', 'roleModelList']) { const list = doc.createElement('div'); list.id = id; main.appendChild(list); }
  return doc;
}

describe('Step 17: Settings page startup and storage failure contract', () => {
  let settings;
  afterEach(() => { settings?.destroySettingsPage?.(); });

  it('has one explicit settings module entry and no stale app entry', () => {
    const html = fs.readFileSync(path.join(ROOT, 'settings.html'), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(match => match[1]);
    assert.equal(scripts.filter(src => src === 'js/pages/settings.js').length, 1);
    assert.equal(scripts.includes('js/app.js'), false);
    assert.equal(new Set(scripts.filter(src => src.startsWith('js/'))).size, scripts.filter(src => src.startsWith('js/')).length);
    assert.match(html, /id="settingsStatus"/);
  });

  it('initializes once and reports offline saves as pending/failed', async () => {
    const moduleUrl = new URL(`file:///${path.join(ROOT, 'js/pages/settings.js').replace(/\\/g, '/')}`).href;
    settings = await import(moduleUrl);
    const documentRef = makeSettingsDocument();
    const stored = { customQuotes: [], roleModels: [] };
    const storage = {
      get(key, fallback) { return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : fallback; },
      set() { throw new Error('offline backend'); }
    };
    const windowRef = { matchMedia: () => ({ matches: false }), addEventListener() {}, dispatchEvent() {} };

    const first = await settings.initSettingsPage({ documentRef, windowRef, storage });
    const second = await settings.initSettingsPage({ documentRef, windowRef, storage });
    assert.strictEqual(first, second, 'repeated initialization should reuse the controller');
    assert.equal(documentRef.getElementById('addQuoteBtn').listenerCount('click'), 1, 'one add handler is bound');

    documentRef.getElementById('quoteText').value = '<img src=x onerror=alert(1)>';
    documentRef.getElementById('quoteAuthor').value = 'offline';
    const result = await first.addQuote();
    assert.equal(result.success, false);
    assert.match(documentRef.getElementById('settingsStatus').textContent, /pending\/failed/i);
    assert.doesNotMatch(documentRef.getElementById('settingsStatus').textContent, /^Quote saved\.$/);
    assert.equal(stored.customQuotes.length, 0, 'failed storage must not mutate the saved list');
  });
});
