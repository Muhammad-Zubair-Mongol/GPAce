/**
 * Step 46: Bootstrap an isolated deterministic verification harness.
 * Verifies that the test harness runner and helpers satisfy all requirements:
 * - Runner passes positive fixtures
 * - Runner returns nonzero for missing test cases
 * - Runner returns nonzero for failing assertions
 * - Runner returns nonzero for skipped/todo tests
 * - NetworkGuard blocks unexpected outgoing external network requests
 * - Deterministic helpers (storage, clock, temp roots, mocks, ephemeral servers) work and close cleanly
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const http = require('node:http');

const {
  createTempDir,
  createIsolatedStorage,
  createFakeClock,
  createProviderMock,
  installNetworkGuard,
  createTestServer,
  createDisposableBrowserProfile,
  createMockAuth
} = require('../harness/helpers.cjs');

const RUN_CASE_PATH = path.resolve(__dirname, '..', 'harness', 'run-case.cjs');

function runHarness(args) {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [RUN_CASE_PATH, ...args], {
    encoding: 'utf8',
    env: childEnv
  });
}

describe('Step 46: Verification Harness & Runner Self-Test', () => {

  describe('Runner Contract Enforcement', () => {
    it('returns nonzero exit code when test case does not exist', () => {
      const result = runHarness(['99']);
      assert.notStrictEqual(result.status, 0, 'Missing case must return nonzero exit code');
      const output = (result.stdout || '') + (result.stderr || '');
      assert.match(output, /ERROR: Test file does not exist/i);
    });

    it('returns exit code 0 for a valid positive fixture', () => {
      const temp = createTempDir('harness-pos-');
      try {
        const fixturePath = path.join(temp.path, 'pos.test.cjs');
        fs.writeFileSync(fixturePath, `
          const { test } = require('node:test');
          const assert = require('node:assert/strict');
          test('passes deterministically', () => {
            assert.strictEqual(1 + 1, 2);
          });
        `);

        const result = runHarness([fixturePath]);
        assert.strictEqual(result.status, 0, 'Positive fixture must pass with exit code 0');
      } finally {
        temp.cleanup();
      }
    });

    it('returns nonzero exit code for an intentional failing assertion', () => {
      const temp = createTempDir('harness-fail-');
      try {
        const fixturePath = path.join(temp.path, 'fail.test.cjs');
        fs.writeFileSync(fixturePath, `
          const { test } = require('node:test');
          const assert = require('node:assert/strict');
          test('intentional failure', () => {
            assert.strictEqual(1, 2, 'Intentional failure assertion');
          });
        `);

        const result = runHarness([fixturePath]);
        assert.notStrictEqual(result.status, 0, 'Failing assertion must return nonzero exit code');
      } finally {
        temp.cleanup();
      }
    });

    it('returns nonzero exit code when a test is skipped', () => {
      const temp = createTempDir('harness-skip-');
      try {
        const fixturePath = path.join(temp.path, 'skip.test.cjs');
        fs.writeFileSync(fixturePath, `
          const { test } = require('node:test');
          test('skipped test', { skip: 'Skipped tests are forbidden' }, () => {});
        `);

        const result = runHarness([fixturePath]);
        assert.notStrictEqual(result.status, 0, 'Skipped test must return nonzero exit code');
        const output = (result.stdout || '') + (result.stderr || '');
        assert.match(output, /skipped.*violate harness contract/i);
      } finally {
        temp.cleanup();
      }
    });

    it('blocks unexpected external network requests via network guard', () => {
      const temp = createTempDir('harness-net-');
      try {
        const fixturePath = path.join(temp.path, 'net.test.cjs');
        fs.writeFileSync(fixturePath, `
          const { test } = require('node:test');
          const http = require('node:http');
          test('unexpected external request', () => {
            // Guard throws synchronously when external request is attempted
            http.get('http://api.production-example.com/data');
          });
        `);

        const result = runHarness([fixturePath]);
        assert.notStrictEqual(result.status, 0, 'Unexpected external network must fail the test');
        const output = (result.stdout || '') + (result.stderr || '');
        assert.match(output, /NetworkGuard.*Blocked unexpected outgoing request/i);
      } finally {
        temp.cleanup();
      }
    });
  });

  describe('Harness Deterministic Utilities', () => {
    it('createTempDir provides clean isolation and removes directories upon cleanup', () => {
      const temp = createTempDir('harness-util-');
      assert.ok(fs.existsSync(temp.path), 'Temp directory must exist');

      const testFile = path.join(temp.path, 'test.txt');
      fs.writeFileSync(testFile, 'hello gpace');
      assert.ok(fs.existsSync(testFile));

      temp.cleanup();
      assert.strictEqual(fs.existsSync(temp.path), false, 'Temp directory must be removed on cleanup');
    });

    it('createIsolatedStorage conforms to Web Storage API and enforces quotas', () => {
      const storage = createIsolatedStorage({ quotaLimit: 50 });

      storage.setItem('user', 'alex');
      assert.strictEqual(storage.getItem('user'), 'alex');
      assert.strictEqual(storage.length, 1);
      assert.strictEqual(storage.key(0), 'user');

      // Test quota exceeded
      assert.throws(() => {
        storage.setItem('large', 'x'.repeat(100));
      }, /QuotaExceededError/);

      storage.removeItem('user');
      assert.strictEqual(storage.getItem('user'), null);
      assert.strictEqual(storage.length, 0);
    });

    it('createFakeClock controls virtual time and advances timers deterministically', () => {
      const baseTime = new Date('2026-09-27T10:00:00.000Z');
      const clock = createFakeClock(baseTime);

      assert.strictEqual(clock.now(), baseTime.getTime());
      const fakeDate = new clock.Date();
      assert.strictEqual(fakeDate.toISOString(), '2026-09-27T10:00:00.000Z');

      let timerFired = false;
      clock.setTimeout(() => {
        timerFired = true;
      }, 5000);

      clock.tick(3000);
      assert.strictEqual(timerFired, false, 'Timer should not fire before deadline');

      clock.tick(2500);
      assert.strictEqual(timerFired, true, 'Timer should fire after clock advances past deadline');
    });

    it('createProviderMock logs calls and returns configurable mock responses', async () => {
      const mock = createProviderMock({ defaultResponse: { text: 'summary' } });

      const res1 = await mock.generateContent({ prompt: 'test prompt' });
      assert.deepStrictEqual(res1, { text: 'summary' });

      const calls = mock.getCalls();
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].params.prompt, 'test prompt');

      mock.setStatus(429);
      await assert.rejects(async () => {
        await mock.generateContent({ prompt: 'retry' });
      }, /Provider returned HTTP 429/);
    });

    it('createTestServer binds ephemeral port and closes all connections cleanly', async () => {
      const serverInstance = await createTestServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });

      assert.ok(serverInstance.port > 0, 'Must bind a valid port');
      assert.strictEqual(serverInstance.host, '127.0.0.1');

      // Make a local loopback request
      const response = await new Promise((resolve, reject) => {
        http.get(serverInstance.url, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data) }));
        }).on('error', reject);
      });

      assert.strictEqual(response.statusCode, 200);
      assert.deepStrictEqual(response.body, { ok: true });

      // Close the server and ensure it is terminated
      await serverInstance.close();

      // Ensure further requests to that closed port are rejected
      await assert.rejects(async () => {
        await new Promise((resolve, reject) => {
          http.get(serverInstance.url, resolve).on('error', reject);
        });
      });
    });

    it('createMockAuth generates valid test tokens and identities', () => {
      const auth = createMockAuth('user-abc-123', { role: 'admin' });
      assert.strictEqual(auth.user.uid, 'user-abc-123');
      assert.strictEqual(auth.user.role, 'admin');
      assert.ok(auth.authHeader.startsWith('Bearer '));
    });
  });
});
