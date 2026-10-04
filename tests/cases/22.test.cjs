const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  contains(value) { return this.values.has(value); }
}

class Element {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parentNode = null; this.dataset = {}; this.attributes = {}; this.classList = new ClassList(); this.listeners = new Map(); this.style = {}; }
  set id(value) { this._id = String(value); this.attributes.id = this._id; }
  get id() { return this._id || ''; }
  set className(value) { this.classList = new ClassList(); String(value || '').split(/\s+/).filter(Boolean).forEach(item => this.classList.add(item)); }
  get className() { return [...this.classList.values].join(' '); }
  set href(value) { this.attributes.href = String(value); }
  get href() { return this.attributes.href || ''; }
  set target(value) { this.attributes.target = String(value); }
  set rel(value) { this.attributes.rel = String(value); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  dispatchEvent(event) { (this.listeners.get(event.type) || []).forEach(handler => handler.call(this, event)); }
  matches(selector) {
    const value = selector.trim();
    if (value.startsWith('.')) return value.slice(1).split('.').every(name => this.classList.contains(name));
    if (value.startsWith('#')) return this.id === value.slice(1);
    const attr = value.match(/^([a-z]*)?\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]$/i);
    if (attr) {
      const key = attr[2].startsWith('data-') ? attr[2].slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) : attr[2];
      const candidate = this.dataset[key] ?? this.attributes[attr[2]];
      const present = candidate !== undefined;
      return (!attr[1] || this.tagName.toLowerCase() === attr[1].toLowerCase()) && present && (attr[3] === undefined || String(candidate) === attr[3]);
    }
    return this.tagName.toLowerCase() === value.toLowerCase();
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(value => value.trim()).filter(Boolean);
    const result = [];
    const visit = node => node.children.forEach(child => { if (selectors.some(value => child.matches(value))) result.push(child); visit(child); });
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { let node = this; while (node) { if (node.matches(selector)) return node; node = node.parentNode; } return null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
}

class Document {
  constructor() { this.body = new Element('body', this); }
  createElement(tag) { return new Element(tag, this); }
  querySelector(selector) { return this.body.querySelector(selector); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  getElementById(id) { return this.body.querySelector(`#${id}`); }
}

function loadManager() {
  const documentRef = new Document();
  const data = new Map([
    ['calculatedPriorityTasks', [
      { id: 'task-1', links: [
        { id: 'safe-link', url: 'https://example.com/valid', title: '<b>quoted</b>', description: '<img src=x onerror=alert(1)>', type: 'link' },
        { id: 'bad-link', url: 'javascript:alert(1)', title: 'Imported bad link', description: 'invalid', type: 'link' }
      ] },
      { id: 'task-2', links: [{ id: 'other-link', url: 'https://example.org', title: 'Other', type: 'link' }] }
    ]]
  ]);
  const opened = [];
  const localStorage = {
    getItem(key) { return data.has(key) ? JSON.stringify(data.get(key)) : null; },
    setItem(key, value) { data.set(key, JSON.parse(value)); }
  };
  const windowRef = { document: documentRef, localStorage, open: (...args) => opened.push(args), console };
  const context = { window: windowRef, document: documentRef, localStorage, URL, Date, Math, console, setTimeout, clearTimeout };
  const source = fs.readFileSync(path.join(ROOT, 'js/taskLinks.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'taskLinks.js' });
  return { manager: windowRef.taskLinksManager, documentRef, data, opened };
}

describe('Step 22: Stored task link safety and URL policy', () => {
  it('allows only HTTP(S), renders malformed imports visibly, and opens valid links safely', async () => {
    const { manager, documentRef, data, opened } = loadManager();
    assert.equal(manager.sanitizeUrl('https://example.com/a'), 'https://example.com/a');
    assert.equal(manager.sanitizeUrl('example.com/a'), 'https://example.com/a');
    for (const value of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'custom://host']) {
      assert.throws(() => manager.sanitizeUrl(value), /Only http and https|Invalid URL/);
    }
    assert.throws(() => manager.sanitizeUrl('example.com', { allowBare: false }), /Invalid URL|Only http/);

    const container = documentRef.createElement('section');
    container.className = 'links-container';
    container.dataset.taskId = 'task-1';
    const list = documentRef.createElement('div'); list.className = 'links-list'; container.appendChild(list); documentRef.body.appendChild(container);
    manager.renderLinks('task-1', container);
    const items = list.querySelectorAll('.link-item');
    assert.equal(items.length, 2);
    const valid = items.find(item => item.dataset.linkId === 'safe-link');
    const invalid = items.find(item => item.dataset.linkId === 'bad-link');
    const anchor = valid.querySelector('a');
    assert.equal(anchor.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(anchor.getAttribute('target'), '_blank');
    assert.equal(valid.querySelector('.link-title').textContent, '<b>quoted</b>');
    assert.equal(invalid.dataset.invalid, 'true');
    assert.equal(invalid.querySelector('a'), null, 'invalid imported records are non-clickable');
    assert.match(invalid.querySelector('.text-danger').textContent, /Invalid stored link/);

    const openButton = valid.querySelector('[data-link-action="open-link"]');
    list.dispatchEvent({ type: 'click', target: openButton });
    assert.deepEqual(opened[0], ['https://example.com/valid', '_blank', 'noopener,noreferrer']);

    const removeButton = valid.querySelector('[data-link-action="remove-link"]');
    list.dispatchEvent({ type: 'click', target: removeButton });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(data.get('calculatedPriorityTasks')[0].links.some(link => link.id === 'safe-link'), false);
    assert.equal(data.get('calculatedPriorityTasks')[1].links.length, 1, 'deleting one task link leaves another task untouched');
  });

  it('keeps rendering and handlers free of string HTML and inline JavaScript', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js/taskLinks.js'), 'utf8');
    assert.doesNotMatch(source, /onclick\s*=/i);
    assert.doesNotMatch(source, /innerHTML\s*[+]?=/i);
    assert.match(source, /noopener noreferrer/);
    assert.match(source, /data-link-action/);
  });
});
