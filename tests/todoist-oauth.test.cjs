const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');

test('Todoist exchanges codes server-side and rejects invalid origins and input', async () => {
  let calls = 0;
  const app = await createApp({
    todoistClientId: 'public-id',
    todoistClientSecret: 'server-only-secret',
    todoistFetch: async (url, options) => {
      calls += 1;
      assert.equal(url, 'https://todoist.com/oauth/access_token');
      assert.equal(options.body.get('client_secret'), 'server-only-secret');
      assert.equal(options.body.get('redirect_uri'), `${origin}/todoist-callback`);
      return { ok: true, json: async () => ({ access_token: 'test-token' }) };
    }
  });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const request = (requestOrigin, code) => fetch(`${origin}/api/todoist/token`, {
      method: 'POST',
      headers: { origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    assert.equal((await request('https://attacker.example', 'abc')).status, 403);
    assert.equal((await request(origin, '<script>')).status, 400);
    const response = await request(origin, 'valid_code');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { access_token: 'test-token' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(calls, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
