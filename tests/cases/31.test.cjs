const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
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
    this.listeners = new Map();
  }
  set id(value) { this._id = String(value); this.attributes.id = this._id; }
  get id() { return this._id || ''; }
  set className(value) {
    this.classList = new ClassList();
    String(value || '').split(/\s+/).filter(Boolean).forEach(item => this.classList.add(item));
  }
  get className() { return [...this.classList.values].join(' '); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, before) {
    child.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
    return child;
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  focus() { this.ownerDocument.activeElement = this; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this._id = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(candidate => candidate !== handler));
  }
  dispatchEvent(event) {
    event.target ||= this;
    (this.listeners.get(event.type) || []).forEach(handler => handler.call(this, event));
  }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector === 'nav') return this.tagName === 'NAV';
    if (selector === 'a[data-nav-link]') return this.tagName === 'A' && this.dataset.navLink === 'true';
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(item => item.trim()).filter(Boolean);
    const result = [];
    const visit = node => {
      node.children.forEach(child => {
        if (selectors.some(item => child.matches(item))) result.push(child);
        visit(child);
      });
    };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
}

class Document {
  constructor() {
    this.body = new Element('body', this);
    this.listeners = new Map();
    this.activeElement = null;
  }
  createElement(tag) { return new Element(tag, this); }
  querySelector(selector) { return selector === 'body' ? this.body : this.body.querySelector(selector); }
  querySelectorAll(selector) { return selector === 'body' ? [this.body] : this.body.querySelectorAll(selector); }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(candidate => candidate !== handler));
  }
  dispatchEvent(event) { (this.listeners.get(event.type) || []).forEach(handler => handler.call(this, event)); }
}

function windowRef() {
  return {
    scrollY: 0,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(callback) { callback(); },
    CustomEvent: class {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    }
  };
}

describe('Step 31: keyboard navigation disclosure lifecycle', () => {
  it('opens with Enter/Space, closes on Escape, and restores focus', async () => {
    const moduleUrl = new URL('file:///' + path.join(ROOT, 'js/components/NavigationComponent.js').replace(/\\/g, '/')).href;
    const navigation = await import(moduleUrl);
    const documentRef = new Document();
    const nav = navigation.injectNavigation({
      document: documentRef,
      window: windowRef(),
      location: { pathname: '/settings.html' }
    });
    const toggle = nav.querySelector('#navToggleBtn');
    const links = nav.querySelector('#mainNavigationLinks');

    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle.getAttribute('aria-controls'), 'mainNavigationLinks');
    assert.equal(links.classList.contains('show'), false);

    toggle.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(links.classList.contains('show'), true);

    toggle.dispatchEvent({ type: 'keydown', key: ' ', preventDefault() {} });
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');

    toggle.dispatchEvent({ type: 'click', preventDefault() {} });
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    documentRef.dispatchEvent({ type: 'keydown', key: 'Escape', target: documentRef.body });
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(documentRef.activeElement, toggle);
  });

  it('closes from an outside click without trapping desktop tab order', async () => {
    const moduleUrl = new URL('file:///' + path.join(ROOT, 'js/components/NavigationComponent.js').replace(/\\/g, '/')).href;
    const navigation = await import(moduleUrl);
    const documentRef = new Document();
    const first = navigation.injectNavigation({
      document: documentRef,
      window: windowRef(),
      location: { pathname: '/grind.html' }
    });
    const toggle = first.querySelector('#navToggleBtn');
    const outside = documentRef.createElement('main');
    documentRef.body.appendChild(outside);

    toggle.dispatchEvent({ type: 'click', preventDefault() {} });
    documentRef.dispatchEvent({ type: 'click', target: outside });
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(first.querySelectorAll('a[data-nav-link]').some(link => link.getAttribute('tabindex')), false);

    const second = navigation.injectNavigation({
      document: documentRef,
      window: windowRef(),
      location: { pathname: '/grind.html' }
    });
    assert.equal(documentRef.querySelectorAll('nav').length, 1);
    assert.equal(second.querySelector('#navToggleBtn').getAttribute('aria-expanded'), 'false');
    assert.equal(second.querySelector('a[data-nav-link]').getAttribute('aria-current'), 'page');
  });
});
