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
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parentNode = null; this.dataset = {}; this.attributes = {}; this.classList = new ClassList(); this.listeners = new Map(); }
  set id(value) { this._id = String(value); this.attributes.id = this._id; }
  get id() { return this._id || ''; }
  set href(value) { this.attributes.href = String(value); }
  get href() { return this.attributes.href || ''; }
  set className(value) { this.classList = new ClassList(); String(value || '').split(/\s+/).filter(Boolean).forEach(item => this.classList.add(item)); }
  get className() { return [...this.classList.values].join(' '); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, before) { child.parentNode = this; const index = before ? this.children.indexOf(before) : -1; if (index < 0) this.children.push(child); else this.children.splice(index, 0, child); return child; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this._id = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== handler)); }
  dispatchEvent(event) { (this.listeners.get(event.type) || []).forEach(handler => handler.call(this, event)); }
  matches(selector) {
    const simple = selector.trim();
    if (simple.startsWith('#')) return this.id === simple.slice(1);
    if (simple.startsWith('.')) return this.classList.contains(simple.slice(1));
    const attr = simple.match(/^([a-z]*)?\[data-([\w-]+)\]$/i);
    if (attr) return (!attr[1] || this.tagName.toLowerCase() === attr[1].toLowerCase()) && this.dataset[attr[2].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] !== undefined;
    return this.tagName.toLowerCase() === simple.toLowerCase();
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(item => item.trim()).filter(Boolean);
    const result = [];
    const visit = node => node.children.forEach(child => { if (selectors.some(item => child.matches(item))) result.push(child); visit(child); });
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
}

class Document {
  constructor() { this.body = new Element('body', this); this.listeners = new Map(); }
  createElement(tag) { return new Element(tag, this); }
  querySelector(selector) { if (selector === 'body') return this.body; return this.body.querySelector(selector); }
  querySelectorAll(selector) { return selector === 'body' ? [this.body] : this.body.querySelectorAll(selector); }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== handler)); }
}

describe('Step 19: Consolidated navigation rendering', () => {
  it('injects one landmark, exposes current route, and keeps reinjection idempotent', async () => {
    const moduleUrl = new URL(`file:///${path.join(ROOT, 'js/components/NavigationComponent.js').replace(/\\/g, '/')}`).href;
    const navigation = await import(moduleUrl);
    const documentRef = new Document();
    const windowRef = { scrollY: 0, addEventListener() {}, removeEventListener() {}, requestAnimationFrame(callback) { callback(); }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } };

    const first = navigation.injectNavigation({ document: documentRef, window: windowRef, location: { pathname: '/settings.html' } });
    assert.equal(documentRef.querySelectorAll('.top-nav').length, 1);
    assert.equal(documentRef.querySelectorAll('nav').length, 1);
    const active = first.querySelector('a[data-nav-link]');
    const settingsLink = first.querySelectorAll('a').find(link => link.getAttribute('href') === 'settings.html');
    assert.equal(settingsLink.getAttribute('aria-current'), 'page');
    assert.equal(first.querySelector('#navToggleBtn').getAttribute('aria-expanded'), 'false');

    const second = navigation.injectNavigation({ document: documentRef, window: windowRef, location: { pathname: '/settings.html' } });
    assert.equal(documentRef.querySelectorAll('.top-nav').length, 1, 'reinjection removes the previous landmark');
    assert.notStrictEqual(second, first);
    const toggle = second.querySelector('#navToggleBtn');
    const links = second.querySelector('#mainNavigationLinks');
    toggle.dispatchEvent({ type: 'click', preventDefault() {} });
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(links.classList.contains('show'), true, 'expanded state makes the mobile links visible');
    assert.equal(navigation.toggleNavigation(documentRef), false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(active, first.querySelector('a[data-nav-link]'), 'the first tree was detached rather than duplicated');
  });

  it('defines separate mobile and desktop visibility contracts', () => {
    const css = fs.readFileSync(path.join(ROOT, 'css/components/navigation.css'), 'utf8');
    assert.match(css, /\.nav-links\.show\s*\{[\s\S]*?display:\s*flex/i);
    assert.match(css, /@media\s*\(min-width:\s*993px\)[\s\S]*?\.nav-links\s*\{[\s\S]*?display:\s*flex/i);
    assert.match(css, /aria-expanded|nav-toggle/);
  });
});
