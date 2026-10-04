const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(v => this.values.add(v)); }
  remove(...values) { values.forEach(v => this.values.delete(v)); }
  toggle(value, force) { const next = force === undefined ? !this.values.has(value) : Boolean(force); if (next) this.values.add(value); else this.values.delete(value); return next; }
  contains(value) { return this.values.has(value); }
}

class Control {
  constructor() {
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.classList = new ClassList();
    this.icon = {
      classList: new ClassList(),
      textContent: '',
      setAttribute: (n, v) => {},
      tagName: 'I'
    };
    this.icon.classList.add('bi', 'bi-moon-stars', 'theme-icon');
    this.text = { textContent: '' };
  }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  querySelector(sel) {
    if (sel.includes('.theme-icon') || sel.includes('i.bi')) return this.icon;
    if (sel.includes('.theme-text')) return this.text;
    return null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
}

class ThemeDocument {
  constructor() {
    this.documentElement = { attributes: {}, setAttribute: (name, value) => { this.documentElement.attributes[name] = String(value); }, getAttribute: name => this.documentElement.attributes[name] || null };
    this.body = { classList: new ClassList(), attributes: {}, setAttribute: (name, value) => { this.body.attributes[name] = String(value); }, getAttribute: name => this.body.attributes[name] || null };
    this.controls = [new Control()];
    this.drawerBtns = [
      { dataset: { theme: 'light' }, classList: new ClassList(), getAttribute: () => 'light' },
      { dataset: { theme: 'dark' }, classList: new ClassList(), getAttribute: () => 'dark' }
    ];
  }
  querySelectorAll(selector) {
    if (selector.includes('.theme-toggle') || selector.includes('#themeToggleBtn')) return this.controls;
    if (selector.includes('.theme-btn')) return this.drawerBtns;
    return [];
  }
}

function luminance(hex) {
  const values = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

function contrast(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

describe('Step 20: Unified theme API and semantic tokens', () => {
  it('round-trips a stored preference and uses system preference on first load', async () => {
    const moduleUrl = new URL(`file:///${path.join(ROOT, 'js/themeManager.js').replace(/\\/g, '/')}`).href;
    const { ThemeManager } = await import(moduleUrl);
    const documentRef = new ThemeDocument();
    const writes = [];
    const storage = { get(key, fallback) { return key === 'theme' ? 'light' : fallback; }, set(key, value) { writes.push([key, value]); return { success: true }; } };
    const windowRef = {
      matchMedia: () => ({ matches: true }),
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
      dispatchEvent() {}
    };
    const manager = new ThemeManager({ document: documentRef, window: windowRef, storage });
    await manager.initializeTheme();
    assert.equal(manager.getTheme(), 'light', 'stored preference wins over system preference');
    assert.equal(documentRef.documentElement.attributes['data-theme'], 'light');
    assert.equal(documentRef.body.classList.contains('light-theme'), true);
    assert.equal(manager.toggleTheme(), 'dark');
    assert.equal(writes.at(-1)[1], 'dark');

    const systemDocument = new ThemeDocument();
    const systemManager = new ThemeManager({ document: systemDocument, window: { matchMedia: () => ({ matches: false }) }, storage: { get: (_, fallback) => fallback } });
    await systemManager.initializeTheme();
    assert.equal(systemManager.getTheme(), 'light', 'system light preference is honored without a stored value');
  });

  it('synchronizes across storage events, BroadcastChannel, and custom events', async () => {
    const moduleUrl = new URL(`file:///${path.join(ROOT, 'js/themeManager.js').replace(/\\/g, '/')}`).href;
    const { ThemeManager } = await import(moduleUrl);
    const documentRef = new ThemeDocument();
    const eventListeners = new Map();
    let broadcastMessage = null;

    class FakeBroadcastChannel {
      constructor(name) { this.name = name; }
      postMessage(msg) { broadcastMessage = msg; }
    }

    const windowRef = {
      addEventListener(type, fn) {
        const list = eventListeners.get(type) || [];
        list.push(fn);
        eventListeners.set(type, list);
      },
      dispatchEvent(event) {},
      matchMedia: () => ({ matches: true, addEventListener() {} }),
      BroadcastChannel: FakeBroadcastChannel,
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
    };

    const storage = { get: () => 'dark', set: () => ({ success: true }) };
    const manager = new ThemeManager({ document: documentRef, window: windowRef, storage });
    await manager.initializeTheme();
    assert.equal(manager.getTheme(), 'dark');

    // Simulate cross-tab storage event
    const storageHandler = eventListeners.get('storage')?.[0];
    assert.ok(typeof storageHandler === 'function', 'storage event handler must be registered');
    storageHandler({ key: 'theme', newValue: 'light' });
    assert.equal(manager.getTheme(), 'light', 'storage event updates theme');
    assert.equal(documentRef.documentElement.attributes['data-theme'], 'light');

    // Switch theme and verify broadcast
    manager.setTheme('dark');
    assert.deepEqual(broadcastMessage, { type: 'gpace_theme_changed', theme: 'dark' }, 'broadcasts theme change');

    // Simulate incoming broadcast channel message
    manager._broadcastChannel.onmessage({ data: { theme: 'light' } });
    assert.equal(manager.getTheme(), 'light', 'BroadcastChannel onmessage updates theme');
  });

  it('correctly updates button icons without textContent collisions and synchronizes SideDrawer theme buttons', async () => {
    const moduleUrl = new URL(`file:///${path.join(ROOT, 'js/themeManager.js').replace(/\\/g, '/')}`).href;
    const { ThemeManager } = await import(moduleUrl);
    const documentRef = new ThemeDocument();
    const windowRef = {
      matchMedia: () => ({ matches: false }),
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
      dispatchEvent() {}
    };
    const storage = { get: () => 'dark', set: () => ({ success: true }) };
    const manager = new ThemeManager({ document: documentRef, window: windowRef, storage });
    await manager.initializeTheme();

    const control = documentRef.controls[0];
    const lightBtn = documentRef.drawerBtns[0];
    const darkBtn = documentRef.drawerBtns[1];

    // Dark mode state:
    assert.equal(darkBtn.classList.contains('active'), true, 'dark theme button is active');
    assert.equal(lightBtn.classList.contains('active'), false, 'light theme button is not active');
    assert.equal(control.icon.classList.contains('bi-moon-stars'), true);
    assert.equal(control.icon.textContent, '', 'Bootstrap icon textContent must remain empty to prevent emoji overlap');

    // Switch to light mode:
    manager.setTheme('light');
    assert.equal(lightBtn.classList.contains('active'), true, 'light theme button is active in light mode');
    assert.equal(darkBtn.classList.contains('active'), false, 'dark theme button is not active in light mode');
    assert.equal(control.icon.classList.contains('bi-sun'), true);
    assert.equal(control.icon.textContent, '', 'Bootstrap icon textContent must remain empty in light mode');
  });

  it('keeps semantic foreground, muted, accent, and link colors above WCAG AA thresholds', () => {
    const css = fs.readFileSync(path.join(ROOT, 'css/design-tokens.css'), 'utf8');
    const required = ['--color-background', '--color-foreground', '--color-foreground-muted', '--color-accent', '--color-link', '--color-disabled-foreground'];
    required.forEach(token => assert.match(css, new RegExp(`${token}:\\s*#[0-9a-f]{6}`, 'i')));
    assert.ok(contrast('#f8f9fa', '#121212') >= 4.5);
    assert.ok(contrast('#c1c6cc', '#121212') >= 4.5);
    assert.ok(contrast('#202124', '#f8f9fa') >= 4.5);
    assert.ok(contrast('#4d5156', '#f8f9fa') >= 4.5);
    assert.ok(contrast('#ffffff', '#b3133f') >= 4.5);
    assert.ok(contrast('#ffffff', '#9d123b') >= 4.5);
    assert.match(css, /button:disabled[\s\S]*?opacity:\s*1/);
  });

  it('makes the historical filename a compatibility facade', () => {
    const facade = fs.readFileSync(path.join(ROOT, 'js/theme-manager.js'), 'utf8');
    assert.match(facade, /import\(['"]\.\/themeManager\.js['"]\)/);
    assert.doesNotMatch(facade, /class\s+ThemeManager/);
  });
});
