const { describe, it, afterEach } = require('node:test');
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
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parentNode = null; this.dataset = {}; this.attributes = {}; this.classList = new ClassList(); this.style = {}; this.listeners = new Map(); this.disabled = false; this.hidden = false; this.textContent = ''; }
  set id(value) { this._id = String(value); this.attributes.id = this._id; }
  get id() { return this._id || ''; }
  set className(value) { this.classList = new ClassList(); String(value || '').split(/\s+/).filter(Boolean).forEach(valueItem => this.classList.add(valueItem)); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(candidate => candidate !== handler)); }
  dispatchEvent(event) { (this.listeners.get(event.type) || []).forEach(handler => handler.call(this, event)); }
  matches(selector) { if (selector.startsWith('#')) return this.id === selector.slice(1); if (selector.startsWith('.')) return this.classList.contains(selector.slice(1)); return this.tagName.toLowerCase() === selector.toLowerCase(); }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(value => value.trim()).filter(Boolean);
    const result = [];
    const visit = node => node.children.forEach(child => { if (selectors.some(item => child.matches(item))) result.push(child); visit(child); });
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { let node = this; while (node) { if (node.matches(selector)) return node; node = node.parentNode; } return null; }
}

class Document {
  constructor() { this.readyState = 'complete'; this.body = new Element('body', this); this.listeners = new Map(); }
  createElement(tag) { return new Element(tag, this); }
  getElementById(id) { return this.body.querySelector(`#${id}`); }
  querySelector(selector) { return this.body.querySelector(selector); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(candidate => candidate !== handler)); }
}

function workspaceDocument() {
  const doc = new Document();
  const editor = doc.createElement('div'); editor.id = 'editor'; doc.body.appendChild(editor);
  for (const id of ['editorReadinessStatus', 'editorRetryBtn', 'editorWordCount', 'editorCharCount', 'editorLastSaved', 'wordCount', 'charCount']) { const node = doc.createElement('div'); node.id = id; doc.body.appendChild(node); }
  const container = doc.createElement('div'); container.id = 'editorContainer'; doc.body.appendChild(container);
  return doc;
}

class FakeQuill {
  static constructions = 0;
  constructor(element) { FakeQuill.constructions += 1; this.element = element; this.handlers = {}; this.contents = null; this.history = { undo() {}, redo() {} }; }
  on(type, handler) { this.handlers[type] = handler; }
  setContents(value) { this.contents = value; }
  getText() { return 'restored workspace text\n'; }
  getBounds() { return { top: 0, bottom: 10, left: 0, width: 10 }; }
}

describe('Step 18: Workspace editor readiness boundary', () => {
  let workspace;
  afterEach(() => { workspace?.destroyWorkspace?.(); });

  it('loads Quill once and restores content only after the ready state', async () => {
    const moduleUrl = new URL(`file:///${path.join(ROOT, 'js/workspace-core.js').replace(/\\/g, '/')}`).href;
    workspace = await import(moduleUrl);
    workspace.destroyWorkspace();
    FakeQuill.constructions = 0;
    const documentRef = workspaceDocument();
    const saved = { ops: [{ insert: 'restored workspace text\n' }] };
    const storage = { get(key, fallback) { return key === 'workspaceContent' ? saved : fallback; }, set() { return { success: true }; } };
    const windowRef = { setInterval() { return null; }, clearInterval() {}, PriorityListSorter: { applySavedSort() {} } };

    const first = await workspace.initWorkspace({ documentRef, windowRef, Quill: FakeQuill, storage, skipDomReady: true, force: true });
    const second = await workspace.initWorkspace({ documentRef, windowRef, Quill: FakeQuill, storage, skipDomReady: true });
    const state = workspace.getWorkspaceState();
    assert.strictEqual(first, second, 'repeated startup must reuse the controller');
    assert.equal(state.status, 'ready');
    assert.equal(state.editorCount, 1);
    assert.equal(FakeQuill.constructions, 1, 'one Quill instance is created');
    assert.deepEqual(first.quill.contents, saved, 'saved content is restored after Quill is ready');
    assert.equal(documentRef.getElementById('editorReadinessStatus').dataset.state, 'ready');
  });

  it('shows a retryable error and blocks early writes when Quill fails', async () => {
    const moduleUrl = new URL(`file:///${path.join(ROOT, 'js/workspace-core.js').replace(/\\/g, '/')}`).href;
    workspace = workspace || await import(moduleUrl);
    workspace.destroyWorkspace();
    const documentRef = workspaceDocument();
    let writes = 0;
    const windowRef = {
      saveContent() { writes += 1; return true; },
      setInterval() { return null; }, clearInterval() {}
    };
    const controller = await workspace.initWorkspace({ documentRef, windowRef, storage: { get: () => null }, skipDomReady: true, force: true });
    assert.ok(controller);
    assert.equal(workspace.getWorkspaceState().status, 'error');
    assert.equal(documentRef.getElementById('editorRetryBtn').hidden, false, 'retry control is visible');
    assert.match(documentRef.getElementById('editorReadinessStatus').textContent, /unavailable|retry/i);
    windowRef.saveContent();
    assert.equal(writes, 0, 'save calls before readiness are blocked');
  });

  it('declares one pinned Quill script and an explicit readiness promise', () => {
    const html = fs.readFileSync(path.join(ROOT, 'workspace.html'), 'utf8');
    const quillScripts = [...html.matchAll(/<script[^>]+(?:src|id)=["'][^"']*quill[^"']*["'][^>]*>/gi)];
    assert.equal(quillScripts.length, 1, 'workspace should load one Quill dependency script');
    assert.match(html, /__gpaceQuillDependency/);
    assert.match(html, /editorReadinessStatus/);
    assert.match(html, /editorRetryBtn/);
  });
});
