'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const { createSettingsRouter } = require('../../server/routes/settings');

function start(app) {
  const server = http.createServer(app);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function jsonCall(server, token, method, userId, body) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/settings/${userId}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, json: await response.json() };
}

describe('Step 05: Owned settings contract', () => {
  let rootDir;
  let server;

  before(async () => {
    rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gpace-settings-test-'));
    const app = express();
    app.use(express.json());
    app.use('/settings', createSettingsRouter({ rootDir, auth: { verifyIdToken: async token => ({ uid: token }) } }));
    server = await start(app);
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fsp.rm(rootDir, { recursive: true, force: true });
  });

  it('saves and loads the same allowlisted settings for their owner', async () => {
    const saved = { theme: 'light', notifications: false, pomodoroDuration: 50, geminiModel: 'fixture-model' };
    const write = await jsonCall(server, 'userA', 'POST', 'userA', saved);
    assert.equal(write.response.status, 200);
    assert.deepEqual(write.json.settings, saved);
    const read = await jsonCall(server, 'userA', 'GET', 'userA');
    assert.equal(read.response.status, 200);
    assert.deepEqual(read.json, { pomodoroDuration: 50, theme: 'light', notifications: false, geminiModel: 'fixture-model' });
  });

  it('returns defaults only for a genuinely missing file', async () => {
    const read = await jsonCall(server, 'userB', 'GET', 'userB');
    assert.equal(read.response.status, 200);
    assert.deepEqual(read.json, { theme: 'dark', notifications: true, pomodoroDuration: 25 });
  });

  it('distinguishes corrupt JSON and permission failures from empty settings', async () => {
    const userDir = path.join(rootDir, 'userC');
    await fsp.mkdir(userDir, { recursive: true });
    await fsp.writeFile(path.join(userDir, 'settings.json'), '{bad json', 'utf8');
    const corrupt = await jsonCall(server, 'userC', 'GET', 'userC');
    assert.equal(corrupt.response.status, 422);
    assert.equal(corrupt.json.error.code, 'SETTINGS_CORRUPT');
    assert.equal(await fsp.readFile(path.join(userDir, 'settings.json'), 'utf8'), '{bad json');

    const permissionFs = {
      readFile: async () => { const error = new Error('denied'); error.code = 'EACCES'; throw error; },
      mkdir: fsp.mkdir,
      writeFile: fsp.writeFile,
      rename: fsp.rename,
      unlink: fsp.unlink
    };
    const app = express();
    app.use(express.json());
    app.use('/settings', createSettingsRouter({ rootDir, fs: permissionFs, auth: { verifyIdToken: async token => ({ uid: token }) } }));
    const permissionServer = await start(app);
    try {
      const denied = await jsonCall(permissionServer, 'userA', 'GET', 'userA');
      assert.equal(denied.response.status, 503);
      assert.equal(denied.json.error.code, 'SETTINGS_UNAVAILABLE');
    } finally {
      await new Promise(resolve => permissionServer.close(resolve));
    }
  });

  it('rejects forged user IDs and unsupported settings without touching another store', async () => {
    const forged = await jsonCall(server, 'userA', 'GET', 'userB');
    assert.equal(forged.response.status, 403);
    const invalid = await jsonCall(server, 'userA', 'POST', 'userA', { unexpected: true });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.json.error.code, 'INVALID_SETTINGS');
  });
});
