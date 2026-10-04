'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../../server/app');

function request(server, path) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.get({ hostname: '127.0.0.1', port: address.port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
  });
}

describe('Step 01: Injectable Express application factory', () => {
  it('imports without opening a listener or reading provider credentials', async () => {
    let readyCalls = 0;
    const provider = {
      async ready() { readyCalls += 1; }
    };
    const app = await createApp({ provider });

    assert.equal(typeof app, 'function');
    assert.equal(readyCalls, 1, 'injected provider readiness is awaited by factory use');
    assert.equal(app.locals.dependencies.provider, provider);
  });

  it('serves a route using injected dependencies through an ephemeral test listener', async () => {
    const repository = { value: 'fixture-only' };
    const app = await createApp({
      repositories: { fixture: repository },
      registerRoutes(expressApp, deps) {
        expressApp.get('/fixture', (_req, res) => res.json({ value: deps.repositories.fixture.value }));
      }
    });
    const server = http.createServer(app);

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await request(server, '/fixture');
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { value: 'fixture-only' });
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('rejects startup in a controlled way when injected readiness fails', async () => {
    const failure = new Error('fixture provider unavailable');
    await assert.rejects(
      () => createApp({ provider: { ready: async () => { throw failure; } } }),
      (error) => error === failure
    );
  });

  it('exposes a deterministic health response without a provider', async () => {
    const app = await createApp({ clock: { now: () => new Date('2026-01-01T00:00:00Z') } });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await request(server, '/api/health');
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { ok: true, provider: 'unconfigured' });
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
