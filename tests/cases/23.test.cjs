const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

class ParentWindow {
  constructor() { this.listeners = new Set(); }
  addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === 'message') this.listeners.delete(listener); }
  emit(event) { [...this.listeners].forEach(listener => listener(event)); }
}

class Iframe {
  constructor() { this.attributes = {}; this.dataset = {}; this.style = {}; this.contentWindow = {}; this.srcdoc = ''; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
}

function loadHandshakeFunctions() {
  const source = fs.readFileSync(path.join(ROOT, 'js/ai-researcher.js'), 'utf8');
  const start = source.indexOf('function createSimulationToken()');
  const end = source.indexOf('// Copy simulation code to clipboard');
  assert.ok(start >= 0 && end > start, 'simulation handshake functions must be present');
  const isolated = `${source.slice(start, end)}\nmodule.exports = { createSimulationToken, buildSimulationSource, renderSimulation };`;
  const context = { window: new ParentWindow(), document: {}, setTimeout, clearTimeout, console, module: { exports: {} } };
  vm.runInNewContext(isolated, context, { filename: 'simulation-handshake.js' });
  return { ...context.module.exports, parentWindow: context.window };
}

describe('Step 23: Opaque-origin simulation isolation', () => {
  it('accepts only the current frame/token ready message and rejects forged messages', async () => {
    const { renderSimulation, parentWindow } = loadHandshakeFunctions();
    const iframe = new Iframe();
    const pending = renderSimulation('<!doctype html><p>safe fixture</p>', iframe, { windowRef: parentWindow, timeoutMs: 100 });
    const token = iframe.dataset.simulationToken;
    assert.equal(iframe.getAttribute('sandbox'), 'allow-scripts');
    assert.match(iframe.srcdoc, new RegExp(token));

    let settled = false;
    pending.then(() => { settled = true; });
    parentWindow.emit({ source: {}, origin: 'null', data: { source: 'gpace-simulation', type: 'ready', token } });
    parentWindow.emit({ source: iframe.contentWindow, origin: 'https://gpace.invalid', data: { source: 'gpace-simulation', type: 'ready', token } });
    parentWindow.emit({ source: iframe.contentWindow, origin: 'null', data: { source: 'gpace-simulation', type: 'ready', token: 'forged-token' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'forged source, origin, and token messages are ignored');

    parentWindow.emit({ source: iframe.contentWindow, origin: 'null', data: { source: 'gpace-simulation', type: 'ready', token } });
    const result = await pending;
    assert.equal(result.iframe, iframe);
  });

  it('times out without a ready handshake and leaves a recoverable path for runSimulation', async () => {
    const { renderSimulation, parentWindow } = loadHandshakeFunctions();
    await assert.rejects(renderSimulation('<p>never ready</p>', new Iframe(), { windowRef: parentWindow, timeoutMs: 5 }), /timed out/i);

    const ai = fs.readFileSync(path.join(ROOT, 'js/ai-researcher.js'), 'utf8');
    const runSection = ai.slice(ai.indexOf('async function runSimulation()'), ai.indexOf('// Helper function to escape HTML'));
    assert.match(runSection, /catch\s*\(error\)[\s\S]*showSimulationFailure/);
    assert.match(ai, /retryButton\.dataset\.action\s*=\s*['"]retry-simulation['"]/);
  });

  it('uses minimal sandbox attributes in static and regenerated frame markup', () => {
    const grind = fs.readFileSync(path.join(ROOT, 'grind.html'), 'utf8');
    const ai = fs.readFileSync(path.join(ROOT, 'js/ai-researcher.js'), 'utf8');
    const frameTags = [...grind.matchAll(/<iframe[^>]+sandbox=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
    assert.equal(frameTags.length, 2);
    frameTags.forEach(value => assert.equal(value, 'allow-scripts'));
    assert.match(ai, /sandbox="allow-scripts"/);
    assert.doesNotMatch(grind, /allow-same-origin|allow-top-navigation|allow-forms|allow-popups|allow-modals|allow-pointer-lock/);
    const renderSection = ai.slice(ai.indexOf('function renderSimulation'), ai.indexOf('// Copy simulation code to clipboard'));
    assert.doesNotMatch(renderSection, /contentDocument|document\.write|\.write\(/);
    assert.match(renderSection, /event\.source\s*!==\s*iframe\.contentWindow/);
    assert.match(renderSection, /event\.origin\s*!==\s*['"]null['"]/);
    assert.match(renderSection, /data\.token\s*!==\s*token/);
    assert.match(grind, /runSimulationBtn[\s\S]*?Run Simulation/);
  });
});
