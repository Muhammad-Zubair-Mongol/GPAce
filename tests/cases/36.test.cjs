const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
}

class Element {
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.classList = new ClassList();
    this.listeners = new Map();
    this.style = {};
    this._innerHTML = '';
    this.textContent = '';
    this.focused = false;
  }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }
  get innerHTML() { return this._innerHTML; }
  set id(value) { this._id = String(value); this.attributes.id = this._id; }
  get id() { return this._id || ''; }
  set className(value) { this.classList = new ClassList(); String(value).split(/\s+/).filter(Boolean).forEach(item => this.classList.add(item)); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  focus() { this.focused = true; this.ownerDocument.activeElement = this; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  dispatch(type) {
    const event = { type, target: this, stopPropagation() {} };
    (this.listeners.get(type) || []).forEach(handler => handler(event));
  }
  click() {}
  querySelector() { return null; }
}

class AttachmentDocument {
  constructor() {
    this.body = new Element('body', this);
    this.nodes = new Map();
    const editor = new Element('div', this); editor.id = 'editor'; this.nodes.set('editor', editor);
    const container = new Element('div', this); container.id = 'attachmentsContainer'; this.nodes.set('attachmentsContainer', container);
    const selector = new Element('select', this); selector.id = 'taskSelector'; this.nodes.set('taskSelector', selector);
    this.body.append(editor, container, selector);
    this.activeElement = null;
  }
  createElement(tag) { return new Element(tag, this); }
  getElementById(id) { return this.nodes.get(id) || null; }
  querySelector() { return null; }
}

function loadAttachments(documentRef) {
  const source = fs.readFileSync(path.join(ROOT, 'js/workspace-attachments.js'), 'utf8');
  const windowRef = {
    getStorage: () => ({ get: () => [], set() {} }),
    parent: {},
    addEventListener() {},
    removeEventListener() {},
    open() {}
  };
  const context = {
    window: windowRef,
    document: documentRef,
    localStorage: { getItem() { return null; }, setItem() {} },
    console,
    setTimeout,
    clearTimeout,
    showToast() {},
    confirm: () => false
  };
  vm.runInNewContext(source, context, { filename: 'workspace-attachments.js' });
  return { Attachments: context.window.WorkspaceAttachments };
}

describe('Step 36: accessible workspace attachment states', () => {
  it('uses status semantics for empty state and list/listitem semantics for files', () => {
    const html = fs.readFileSync(path.join(ROOT, 'workspace.html'), 'utf8');
    const source = fs.readFileSync(path.join(ROOT, 'js/workspace-attachments.js'), 'utf8');
    assert.match(html, /id="attachmentsContainer"[^>]*aria-label="Attachment files"/);
    assert.match(html, /class="no-attachments-message"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.doesNotMatch(html, /id="attachmentsContainer"[^>]*role="list"/);
    assert.match(source, /role', 'listitem'/);
    assert.match(source, /title="PDF attachment preview"/);
    assert.match(source, /aria-label', 'Open attachment '/);
    assert.match(source, /restoreEditorFocus/);
  });

  it('renders one or many attachments with names and restores editor focus after an action', () => {
    const documentRef = new AttachmentDocument();
    const { Attachments } = loadAttachments(documentRef);
    const manager = new Attachments();
    const container = documentRef.getElementById('attachmentsContainer');

    manager.showNoAttachmentsMessage('No attachments for this task');
    assert.equal(container.getAttribute('role'), null);
    assert.equal(container.children[0].getAttribute('role'), 'status');
    assert.equal(container.children[0].children[1].textContent, 'No attachments for this task');

    manager.attachments = [
      { name: 'notes.pdf', mimeType: 'application/pdf', createdTime: '2026-01-01', webViewLink: 'https://drive.invalid/view', webContentLink: 'https://drive.invalid/download' },
      { name: 'diagram.png', mimeType: 'image/png', createdTime: '2026-01-02', webContentLink: 'https://drive.invalid/image' }
    ];
    manager.renderAttachments();
    assert.equal(container.getAttribute('role'), 'list');
    assert.equal(container.children.length, 2);
    assert.deepEqual(container.children.map(card => card.getAttribute('role')), ['listitem', 'listitem']);

    const actions = container.children[0].children[2].children;
    assert.equal(actions.length, 3);
    assert.match(actions[0].getAttribute('aria-label'), /Open attachment notes\.pdf/);
    assert.match(actions[1].getAttribute('aria-label'), /Download attachment notes\.pdf/);
    assert.match(actions[2].getAttribute('aria-label'), /Delete attachment notes\.pdf/);

    documentRef.getElementById('editor').focused = false;
    actions[1].dispatch('click');
    assert.equal(documentRef.getElementById('editor').focused, true);
  });
});
