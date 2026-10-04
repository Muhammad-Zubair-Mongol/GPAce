'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const http = require('node:http');
const path = require('node:path');

const { createApp } = require('../../server/app');
const {
  createTempDir,
  createTestServer,
  installNetworkGuard
} = require('../harness/helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'security-payloads.json'), 'utf8'));

function authFixture() {
  const identities = new Map([
    ['owner-token', FIXTURES.identities.owner],
    ['other-token', FIXTURES.identities.other],
    ['symlink-token', FIXTURES.identities.symlink],
    ['traversal-token', FIXTURES.identities.traversalUid]
  ]);
  return {
    verifyIdToken: async token => {
      const uid = identities.get(token);
      if (!uid) throw new Error('unknown fixture token');
      return { uid };
    }
  };
}

function request(server, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const base = new URL(server.url);
    const rawBody = options.body === undefined ? undefined : JSON.stringify(options.body);
    const headers = { ...(options.headers || {}) };
    if (rawBody !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(rawBody);
    }
    const req = http.request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port,
      path: requestPath,
      method: options.method || 'GET',
      headers
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let body = null;
        if (text && String(response.headers['content-type'] || '').includes('application/json')) {
          try { body = JSON.parse(text); } catch {}
        }
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body,
          text,
          buffer
        });
      });
    });
    req.on('error', reject);
    if (rawBody !== undefined) req.write(rawBody);
    req.end();
  });
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

async function uploadFixture(server, token, fixture) {
  const form = new FormData();
  form.append(
    'image',
    new Blob([fixture.body], { type: fixture.mime }),
    fixture.filename
  );
  const response = await fetch(`${server.url}/uploads`, {
    method: 'POST',
    headers: bearer(token),
    body: form
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { status: response.status, headers: response.headers, body, text };
}

async function snapshotTree(root) {
  const entries = [];

  async function visit(current, relative) {
    const directoryEntries = await fsp.readdir(current, { withFileTypes: true });
    directoryEntries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of directoryEntries) {
      const entryRelative = path.join(relative, entry.name);
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        entries.push(`link:${entryRelative}:${await fsp.readlink(entryPath)}`);
      } else if (entry.isDirectory()) {
        entries.push(`dir:${entryRelative}`);
        await visit(entryPath, entryRelative);
      } else {
        const digest = crypto.createHash('sha256').update(await fsp.readFile(entryPath)).digest('hex');
        entries.push(`file:${entryRelative}:${digest}`);
      }
    }
  }

  await visit(root, '');
  return entries.join('\n');
}

function watchChildProcesses() {
  const names = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];
  const originals = new Map();
  const calls = [];
  for (const name of names) {
    originals.set(name, childProcess[name]);
    childProcess[name] = (...args) => {
      calls.push({ name, args });
      throw new Error(`unexpected child process: ${name}`);
    };
  }
  return {
    calls,
    restore() {
      for (const [name, original] of originals) childProcess[name] = original;
    }
  };
}

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  contains(value) { return this.values.has(value); }
}

class Element {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.classList = new ClassList();
    this.listeners = new Map();
    this.style = {};
    this.textContent = '';
  }

  set className(value) {
    this.classList = new ClassList();
    String(value || '').split(/\s+/).filter(Boolean).forEach(item => this.classList.add(item));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...children) { children.forEach(child => this.appendChild(child)); }

  replaceChildren(...children) {
    this.children = [];
    children.forEach(child => this.appendChild(child));
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  matches(selector) {
    const value = selector.trim();
    if (value.startsWith('.')) return value.slice(1).split('.').every(name => this.classList.contains(name));
    if (value.startsWith('#')) return this.attributes.id === value.slice(1);
    const attribute = value.match(/^([a-z]*)?\[([\w-]+)\]$/i);
    if (attribute) {
      const key = attribute[2].startsWith('data-')
        ? attribute[2].slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
        : attribute[2];
      return (!attribute[1] || this.tagName.toLowerCase() === attribute[1].toLowerCase()) &&
        (this.dataset[key] !== undefined || this.attributes[attribute[2]] !== undefined);
    }
    return this.tagName.toLowerCase() === value.toLowerCase();
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map(item => item.trim()).filter(Boolean);
    const result = [];
    const visit = node => {
      for (const child of node.children) {
        if (selectors.some(item => child.matches(item))) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest?.(selector) || null; }
}

class Document {
  constructor() { this.body = new Element('body', this); }
  createElement(tagName) { return new Element(tagName, this); }
  querySelector(selector) { return this.body.querySelector(selector); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  getElementById(id) { return this.body.querySelector(`#${id}`); }
}

function loadTaskLinksFixture() {
  const documentRef = new Document();
  const records = [{
    id: FIXTURES.storedLinks.taskId,
    links: [FIXTURES.storedLinks.safe, ...FIXTURES.storedLinks.hostile]
  }];
  const values = new Map([['calculatedPriorityTasks', JSON.stringify(records)]]);
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
  const windowRef = { document: documentRef, localStorage, console };
  const source = fs.readFileSync(path.join(ROOT, 'js', 'taskLinks.js'), 'utf8');
  const vm = require('node:vm');
  vm.runInNewContext(source, {
    window: windowRef,
    document: documentRef,
    URL,
    console,
    setTimeout,
    clearTimeout
  }, { filename: 'taskLinks-security-fixture.js' });
  return { manager: windowRef.taskLinksManager, documentRef, values };
}

class ParentWindow {
  constructor() { this.listeners = new Set(); }
  addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === 'message') this.listeners.delete(listener); }
  emit(event) { for (const listener of [...this.listeners]) listener(event); }
  get listenerCount() { return this.listeners.size; }
}

class Iframe {
  constructor() {
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.contentWindow = {};
    this.srcdoc = '';
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
}

function loadSimulationHandshake() {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'ai-researcher.js'), 'utf8');
  const start = source.indexOf('function createSimulationToken()');
  const end = source.indexOf('// Copy simulation code to clipboard');
  assert.ok(start >= 0 && end > start, 'simulation handshake functions must be present');
  const isolated = `${source.slice(start, end)}\nmodule.exports = { createSimulationToken, buildSimulationSource, renderSimulation };`;
  const moduleRef = { exports: {} };
  const parentWindow = new ParentWindow();
  require('node:vm').runInNewContext(isolated, {
    window: parentWindow,
    document: {},
    setTimeout,
    clearTimeout,
    console,
    module: moduleRef
  }, { filename: 'simulation-security-fixture.js' });
  return { ...moduleRef.exports, parentWindow };
}

test.describe('Step 52: adversarial security fixtures', { concurrency: false }, () => {
  test.it('denies static disclosure and traversal while serving only safe local assets', async () => {
    const build = createTempDir('gpace-step52-build-');
    const privateRoot = createTempDir('gpace-step52-private-');
    const settingsRoot = createTempDir('gpace-step52-settings-');
    let server;
    try {
      await fsp.mkdir(path.join(build.path, 'assets'), { recursive: true });
      await fsp.writeFile(path.join(build.path, 'index.html'), FIXTURES.static.safeIndex);
      await fsp.writeFile(path.join(build.path, 'assets', 'safe.js'), FIXTURES.static.safeAsset);
      await fsp.mkdir(path.join(privateRoot.path, 'data'), { recursive: true });
      await fsp.writeFile(path.join(privateRoot.path, 'server.js'), 'private source fixture');
      await fsp.writeFile(path.join(privateRoot.path, '.env'), 'PRIVATE_FIXTURE_SECRET=never-served');
      await fsp.writeFile(path.join(privateRoot.path, 'data', 'timetable.json'), '{"private":true}');

      const beforeBuild = await snapshotTree(build.path);
      const beforePrivate = await snapshotTree(privateRoot.path);
      const app = await createApp({
        auth: authFixture(),
        publicDir: build.path,
        settingsRootDir: settingsRoot.path,
        uploadRootDir: path.join(settingsRoot.path, 'uploads')
      });
      server = await createTestServer(app);

      const index = await request(server, '/', { headers: { Accept: 'text/html' } });
      assert.equal(index.status, 200);
      assert.match(index.text, /safe local fixture/);
      assert.equal(index.headers['x-content-type-options'], 'nosniff');
      assert.match(index.headers['cache-control'], /no-cache/);

      const asset = await request(server, '/assets/safe.js');
      assert.equal(asset.status, 200);
      assert.match(asset.text, /__safeSecurityFixture/);
      assert.match(asset.headers['cache-control'], /immutable/);

      const navigation = await request(server, '/workspace/security', { headers: { Accept: 'text/html' } });
      assert.equal(navigation.status, 200);
      assert.match(navigation.text, /safe local fixture/);

      for (const blockedPath of FIXTURES.static.blockedPaths) {
        const response = await request(server, blockedPath, { headers: { Accept: 'text/html' } });
        assert.equal(response.status, 404, `${blockedPath} must remain private`);
        assert.doesNotMatch(response.text, /private source fixture|PRIVATE_FIXTURE_SECRET|\"private\":true/);
      }

      const apiFallback = await request(server, '/api/unknown-security-fixture', { headers: { Accept: 'text/html' } });
      assert.equal(apiFallback.status, 404);
      assert.match(apiFallback.headers['content-type'], /application\/json/);
      assert.equal(apiFallback.body.error.code, 'NOT_FOUND');
      assert.equal(await snapshotTree(build.path), beforeBuild, 'denied static requests must not mutate the build root');
      assert.equal(await snapshotTree(privateRoot.path), beforePrivate, 'private fixture files must remain untouched');
    } finally {
      if (server) {
        await server.close();
        assert.equal(server.server.listening, false);
        assert.equal(server.server.address(), null);
      }
      build.cleanup();
      privateRoot.cleanup();
      settingsRoot.cleanup();
    }
  });

  test.it('rejects spoofed uploads, traversal identities, symlink escapes, and cross-user reads', async () => {
    const uploadRoot = createTempDir('gpace-step52-uploads-');
    const outside = createTempDir('gpace-step52-outside-');
    const settingsRoot = createTempDir('gpace-step52-upload-settings-');
    let server;
    const childWatch = watchChildProcesses();
    const network = installNetworkGuard();
    try {
      const app = await createApp({
        auth: authFixture(),
        uploadRootDir: uploadRoot.path,
        settingsRootDir: settingsRoot.path
      });
      server = await createTestServer(app);
      const valid = {
        filename: FIXTURES.uploads.validFilename,
        mime: FIXTURES.uploads.validMime,
        body: Buffer.from(FIXTURES.uploads.validPngBase64, 'base64')
      };

      const ownerUpload = await uploadFixture(server, 'owner-token', valid);
      assert.equal(ownerUpload.status, 201);
      assert.equal(ownerUpload.body.uploads.length, 1);
      const uploadId = ownerUpload.body.uploads[0].uploadId;
      assert.match(uploadId, /^[a-f0-9]{32}$/);

      const ownerRead = await request(server, `/uploads/${uploadId}`, { headers: bearer('owner-token') });
      assert.equal(ownerRead.status, 200);
      assert.equal(ownerRead.headers['content-type'], 'image/png');
      assert.deepEqual(ownerRead.buffer, valid.body);

      const beforeDenied = await snapshotTree(uploadRoot.path);
      const spoofed = await uploadFixture(server, 'owner-token', {
        filename: FIXTURES.uploads.spoofed.filename,
        mime: FIXTURES.uploads.spoofed.mime,
        body: Buffer.from(FIXTURES.uploads.spoofed.body)
      });
      assert.equal(spoofed.status, 415);
      assert.equal(await snapshotTree(uploadRoot.path), beforeDenied, 'spoofed bytes must not be published');

      const foreignRead = await request(server, `/uploads/${uploadId}`, { headers: bearer('other-token') });
      assert.equal(foreignRead.status, 404);
      const afterForeignRead = await snapshotTree(uploadRoot.path);
      assert.equal(afterForeignRead, beforeDenied, 'foreign reads must not alter the owner store');

      for (const traversalId of FIXTURES.uploads.traversalIds) {
        const response = await request(server, `/uploads/${encodeURIComponent(traversalId)}`, {
          headers: bearer('owner-token')
        });
        assert.equal(response.status, 400, `${traversalId} must not become a filesystem path`);
      }
      const traversalUid = await uploadFixture(server, 'traversal-token', valid);
      assert.equal(traversalUid.status, 400, 'verified identities still require safe storage keys');
      assert.equal(await snapshotTree(uploadRoot.path), beforeDenied, 'traversal probes must not write outside the store');

      const symlinkPath = path.join(uploadRoot.path, FIXTURES.identities.symlink);
      await fsp.symlink(outside.path, symlinkPath, process.platform === 'win32' ? 'junction' : 'dir');
      const symlinkUpload = await uploadFixture(server, 'symlink-token', valid);
      assert.equal(symlinkUpload.status, 400);
      assert.deepEqual(await fsp.readdir(outside.path), [], 'symlink escape must not write to the outside directory');
      assert.equal(network.getBlockedRequests().length, 0, 'upload probes must stay on the local test server');
      assert.deepEqual(childWatch.calls, [], 'upload probes must not start child processes');
    } finally {
      if (server) await server.close();
      network.uninstall();
      childWatch.restore();
      assert.equal(server?.server.listening || false, false);
      uploadRoot.cleanup();
      outside.cleanup();
      settingsRoot.cleanup();
    }
  });

  test.it('keeps settings owned and renders stored markup and URLs inert', async () => {
    const settingsRoot = createTempDir('gpace-step52-owned-settings-');
    let server;
    try {
      const app = await createApp({ auth: authFixture(), settingsRootDir: settingsRoot.path });
      server = await createTestServer(app);
      const safeSettings = { theme: 'light', notifications: false, pomodoroDuration: 30 };
      const saved = await request(server, `/settings/${FIXTURES.identities.owner}`, {
        method: 'POST',
        headers: bearer('owner-token'),
        body: safeSettings
      });
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.body.settings, safeSettings);

      const ownerRead = await request(server, `/settings/${FIXTURES.identities.owner}`, {
        headers: bearer('owner-token')
      });
      assert.equal(ownerRead.status, 200);
      assert.equal(ownerRead.body.theme, 'light');
      const beforeDenied = await snapshotTree(settingsRoot.path);

      const foreignRead = await request(server, `/settings/${FIXTURES.identities.owner}`, {
        headers: bearer('other-token')
      });
      assert.equal(foreignRead.status, 403);
      const foreignWrite = await request(server, `/settings/${FIXTURES.identities.owner}`, {
        method: 'POST',
        headers: bearer('other-token'),
        body: { theme: 'dark' }
      });
      assert.equal(foreignWrite.status, 403);
      const markupSettings = await request(server, `/settings/${FIXTURES.identities.owner}`, {
        method: 'POST',
        headers: bearer('owner-token'),
        body: { ...safeSettings, label: FIXTURES.storedLinks.hostile[0].title }
      });
      assert.equal(markupSettings.status, 400);
      assert.equal(await snapshotTree(settingsRoot.path), beforeDenied, 'denied settings writes must preserve the owner file');

      const { manager, documentRef, values } = loadTaskLinksFixture();
      for (const hostile of FIXTURES.storedLinks.hostile.slice(1)) {
        assert.throws(() => manager.sanitizeUrl(hostile.url, { allowBare: false }), /Only http and https|Invalid URL/);
      }
      assert.equal(manager.sanitizeUrl(FIXTURES.storedLinks.safe.url, { allowBare: false }), FIXTURES.storedLinks.safe.url);

      const container = documentRef.createElement('section');
      const list = documentRef.createElement('div');
      list.className = 'links-list';
      container.className = 'links-container';
      container.dataset.taskId = FIXTURES.storedLinks.taskId;
      container.appendChild(list);
      documentRef.body.appendChild(container);
      const beforeLinks = values.get('calculatedPriorityTasks');
      manager.renderLinks(FIXTURES.storedLinks.taskId, container);
      const items = list.querySelectorAll('.link-item');
      assert.equal(items.length, FIXTURES.storedLinks.hostile.length + 1);
      const valid = items.find(item => item.dataset.linkId === FIXTURES.storedLinks.safe.id);
      assert.equal(valid.querySelector('a').href, FIXTURES.storedLinks.safe.url);
      assert.equal(valid.querySelector('a').rel, 'noopener noreferrer');
      const hostileItems = items.filter(item => item.dataset.invalid === 'true');
      assert.equal(hostileItems.length, FIXTURES.storedLinks.hostile.length - 1);
      assert.equal(hostileItems.some(item => item.querySelector('a')), false);
      assert.equal(valid.querySelector('.link-title').textContent, FIXTURES.storedLinks.safe.title);
      assert.equal(items.find(item => item.dataset.linkId === 'markup-title').querySelector('.link-title').textContent, FIXTURES.storedLinks.hostile[0].title);
      assert.equal(values.get('calculatedPriorityTasks'), beforeLinks, 'rendering stored records must not write or execute them');
    } finally {
      if (server) await server.close();
      assert.equal(server?.server.listening || false, false);
      settingsRoot.cleanup();
    }
  });

  test.it('keeps generated simulations in an opaque-origin frame and ignores forged readiness', async () => {
    const { renderSimulation, parentWindow } = loadSimulationHandshake();
    const iframe = new Iframe();
    const pending = renderSimulation(FIXTURES.simulation.hostileHtml, iframe, {
      windowRef: parentWindow,
      timeoutMs: 100
    });
    const token = iframe.dataset.simulationToken;
    assert.equal(iframe.getAttribute('sandbox'), 'allow-scripts');
    assert.doesNotMatch(iframe.getAttribute('sandbox'), /allow-same-origin|allow-top-navigation|allow-forms|allow-popups|allow-modals/);
    assert.match(iframe.srcdoc, /window\.parent\.document/);
    assert.match(iframe.srcdoc, new RegExp(token));

    let settled = false;
    pending.then(() => { settled = true; });
    parentWindow.emit({ source: {}, origin: 'null', data: { source: 'gpace-simulation', type: 'ready', token } });
    parentWindow.emit({ source: iframe.contentWindow, origin: 'https://network.invalid', data: { source: 'gpace-simulation', type: 'ready', token } });
    parentWindow.emit({ source: iframe.contentWindow, origin: 'null', data: { source: 'gpace-simulation', type: 'ready', token: 'forged-token' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, 'untrusted source, origin, and token cannot unlock the frame');

    parentWindow.emit({ source: iframe.contentWindow, origin: 'null', data: { source: 'gpace-simulation', type: 'ready', token } });
    const result = await pending;
    assert.equal(result.iframe, iframe);
    assert.equal(parentWindow.listenerCount, 0, 'handshake listener is removed after settlement');

    const safeFrame = new Iframe();
    const safePending = renderSimulation(FIXTURES.simulation.safeHtml, safeFrame, { windowRef: parentWindow, timeoutMs: 100 });
    const safeToken = safeFrame.dataset.simulationToken;
    parentWindow.emit({ source: safeFrame.contentWindow, origin: 'null', data: { source: 'gpace-simulation', type: 'ready', token: safeToken } });
    assert.equal((await safePending).iframe, safeFrame, 'valid safe simulation fixtures still complete the handshake');
  });

  test.it('uses no unexpected process or network capability and closes disposable ports', async () => {
    const childWatch = watchChildProcesses();
    const network = installNetworkGuard();
    const server = await createTestServer((_req, res) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end('local security fixture');
    });
    try {
      const response = await request(server, '/local-only');
      assert.equal(response.status, 200);
      assert.equal(response.text, 'local security fixture');
      assert.equal(network.getBlockedRequests().length, 0);
      assert.deepEqual(childWatch.calls, []);
    } finally {
      await server.close();
      network.uninstall();
      childWatch.restore();
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(server.server.listening, false);
    assert.equal(server.server.address(), null);
    const activePort = process._getActiveHandles().some(handle => handle === server.server && handle.listening);
    assert.equal(activePort, false, 'closed fixture port must not remain active');
    assert.deepEqual(childWatch.calls, [], 'security fixtures must not spawn subprocesses');
    assert.equal(network.getBlockedRequests().length, 0, 'security fixtures must not contact external hosts');
  });
});
