const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  toggle(value, force) { const next = force === undefined ? !this.values.has(value) : Boolean(force); if (next) this.add(value); else this.remove(value); return next; }
  contains(value) { return this.values.has(value); }
}

class Element {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parentNode = null; this.dataset = {}; this.attributes = {}; this.classList = new ClassList(); this.style = {}; this.listeners = new Map(); this.replaceCount = 0; }
  set id(value) { this._id = String(value); this.attributes.id = this._id; }
  get id() { return this._id || ''; }
  set className(value) { this.classList = new ClassList(); String(value || '').split(/\s+/).filter(Boolean).forEach(item => this.classList.add(item)); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...children) { this.replaceCount += 1; this.children = []; children.forEach(child => this.appendChild(child)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== handler)); }
  dispatchEvent(event) { (this.listeners.get(event.type) || []).forEach(handler => handler.call(this, event)); }
  matches(selector) {
    const value = selector.trim();
    if (value.startsWith('.')) return value.slice(1).split('.').every(className => this.classList.contains(className));
    const attr = value.match(/^([a-z]*)?\[data-([\w-]+)\]$/i);
    if (attr) return (!attr[1] || this.tagName.toLowerCase() === attr[1].toLowerCase()) && this.dataset[attr[2].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] !== undefined;
    if (value.startsWith('#')) return this.id === value.slice(1);
    return this.tagName.toLowerCase() === value.toLowerCase();
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(item => item.trim()).filter(Boolean);
    const result = [];
    const visit = node => node.children.forEach(child => { if (selectors.some(item => child.matches(item))) result.push(child); visit(child); });
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { let node = this; while (node) { if (node.matches(selector)) return node; node = node.parentNode; } return null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
}

class Document {
  constructor() { this.body = new Element('body', this); this.listeners = new Map(); }
  createElement(tag) { return new Element(tag, this); }
  createDocumentFragment() { return new Element('fragment', this); }
  getElementById(id) { return this.body.querySelector(`#${id}`); }
  querySelector(selector) { return this.body.querySelector(selector); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== handler)); }
}

function makeDocument() {
  const doc = new Document();
  const box = doc.createElement('section'); box.id = 'priorityTaskBox'; doc.body.appendChild(box);
  return { doc, box };
}

function taskData() {
  return [{ id: 'task-<quoted>', projectId: 'project-1', title: '<img src=x onerror=alert(1)>', section: '<script>alert(1)</script>', projectName: 'fallback', links: [], lastInterleaved: null }];
}

describe('Step 21: Safe priority task rendering', () => {
  it('renders hostile task fields as text and delegates actions by validated IDs', async () => {
    const moduleUrl = new URL(`file:///${path.join(ROOT, 'js/controllers/TaskDisplayController.js').replace(/\\/g, '/')}`).href;
    const { TaskDisplayController } = await import(moduleUrl);
    const { doc, box } = makeDocument();
    const calls = [];
    const windowRef = { addEventListener() {}, removeEventListener() {}, PriorityListSorter: { applySavedSort() {} }, completeTask: (...args) => calls.push(args) };
    const storage = { get(key, fallback) { return key === 'academicSubjects' ? [{ tag: 'project-1', name: '<b>Math</b>' }] : fallback; } };
    const controller = new TaskDisplayController({ document: doc, window: windowRef, storage, repository: { getPriorityTasks: async () => taskData() } });
    controller.init({ document: doc, window: windowRef, storage });
    assert.equal(await controller._displayPriorityTaskImpl(true), true);

    const title = box.querySelector('.task-title');
    const details = box.querySelector('.task-details');
    assert.equal(title.textContent, taskData()[0].title);
    assert.match(details.textContent, /<script>alert\(1\)<\/script>/);
    assert.equal(box.querySelector('[onclick]'), null, 'rendered actions have no inline handler');

    const complete = box.querySelector('[data-task-action]');
    const allActions = box.querySelectorAll('[data-task-action]');
    const completeButton = allActions.find(button => button.dataset.taskAction === 'complete-task');
    box.dispatchEvent({ type: 'click', target: completeButton });
    assert.deepEqual(calls, [['project-1', 'task-<quoted>']]);
    assert.ok(complete || completeButton);
  });

  it('skips an identical successful render but keeps the hash retryable after failure', async () => {
    const moduleUrl = new URL(`file:///${path.join(ROOT, 'js/controllers/TaskDisplayController.js').replace(/\\/g, '/')}`).href;
    const { TaskDisplayController } = await import(moduleUrl);
    const { doc, box } = makeDocument();
    const windowRef = { addEventListener() {}, removeEventListener() {}, PriorityListSorter: { applySavedSort() {} } };
    const repository = { getPriorityTasks: async () => taskData() };
    const controller = new TaskDisplayController({ document: doc, window: windowRef, storage: { get: (_, fallback) => fallback }, repository });
    controller.init({ document: doc, window: windowRef, storage: { get: (_, fallback) => fallback } });
    await controller._displayPriorityTaskImpl(true);
    const renderCount = box.replaceCount;
    assert.equal(await controller._displayPriorityTaskImpl(false), false);
    assert.equal(box.replaceCount, renderCount, 'identical data is not rendered again');

    controller.lastTasksHash = null;
    const originalFragment = doc.createDocumentFragment;
    doc.createDocumentFragment = () => { throw new Error('<b>render failed</b>'); };
    assert.equal(await controller._displayPriorityTaskImpl(true), false);
    assert.equal(controller.lastTasksHash, null, 'failed rendering does not commit its hash');
    assert.match(box.textContent || box.querySelector('.task-error').textContent, /render failed/);
    doc.createDocumentFragment = originalFragment;
    assert.equal(await controller._displayPriorityTaskImpl(true), true, 'the failed render can be retried');
  });

  it('keeps error state text inert and exposes repository injection', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js/controllers/TaskDisplayController.js'), 'utf8');
    assert.match(source, /textContent/);
    assert.match(source, /setRepository\(repository\)/);
    assert.doesNotMatch(source, /onclick\s*=/i);
  });
});
