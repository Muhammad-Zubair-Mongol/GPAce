'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT_DIR = path.resolve(__dirname, '..');
const { createApp } = require('../server/app');
const { startServer } = require('../server');

const RESULTS = {
  passed: 0,
  failed: 0,
  failures: []
};

function recordPass(testName) {
  RESULTS.passed++;
  console.log(`  [PASS] ${testName}`);
}

function recordFail(testName, error) {
  RESULTS.failed++;
  RESULTS.failures.push({ testName, error: error.message || String(error) });
  console.error(`  [FAIL] ${testName}:`, error.message || error);
}

async function runTest(name, fn) {
  try {
    await fn();
    recordPass(name);
  } catch (err) {
    recordFail(name, err);
  }
}

// -------------------------------------------------------------
// Helper to query local server
// -------------------------------------------------------------
async function fetchManual(url, method = 'GET') {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        Host: `${parsed.hostname}:${parsed.port}`
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('====================================================');
  console.log('M2 EMPIRICAL ADVERSARIAL VERIFICATION HARNESS');
  console.log('====================================================\n');

  // =========================================================
  // SUITE 1: Express app.js Direct Routing & Redirection Tests
  // =========================================================
  console.log('--- Suite 1: server/app.js Route & Redirection Tests ---');

  const appWithDist = await createApp({
    publicDir: path.resolve(ROOT_DIR, 'dist')
  });

  const server1 = http.createServer(appWithDist);
  await new Promise((resolve, reject) => {
    server1.listen(0, (err) => err ? reject(err) : resolve());
  });
  const port1 = server1.address().port;
  const base1 = `http://localhost:${port1}`;

  try {
    await runTest('GET /tasks.html returns 301 with Location: /grind.html', async () => {
      const res = await fetchManual(`${base1}/tasks.html`);
      assert.equal(res.status, 301);
      assert.equal(res.headers.location, '/grind.html');
    });

    await runTest('GET /tasks.html?foo=bar returns 301 preserving query string', async () => {
      const res = await fetchManual(`${base1}/tasks.html?foo=bar`);
      assert.equal(res.status, 301);
      assert.equal(res.headers.location, '/grind.html?foo=bar');
    });

    await runTest('GET /tasks.html?code=abc123&state=xyz%20789&filter=urgent preserves multi-parameter encoded query', async () => {
      const res = await fetchManual(`${base1}/tasks.html?code=abc123&state=xyz%20789&filter=urgent`);
      assert.equal(res.status, 301);
      assert.equal(res.headers.location, '/grind.html?code=abc123&state=xyz%20789&filter=urgent');
    });

    await runTest('GET /tasks.html? (empty query) returns 301 with Location: /grind.html?', async () => {
      const res = await fetchManual(`${base1}/tasks.html?`);
      assert.equal(res.status, 301);
      assert.ok(res.headers.location === '/grind.html?' || res.headers.location === '/grind.html');
    });

    await runTest('GET /tasks returns 301 with Location: /grind.html', async () => {
      const res = await fetchManual(`${base1}/tasks`);
      assert.equal(res.status, 301);
      assert.equal(res.headers.location, '/grind.html');
    });

    await runTest('GET /tasks?filter=today returns 301 with Location: /grind.html?filter=today', async () => {
      const res = await fetchManual(`${base1}/tasks?filter=today`);
      assert.equal(res.status, 301);
      assert.equal(res.headers.location, '/grind.html?filter=today');
    });

    await runTest('HEAD /tasks.html returns 301 with Location: /grind.html', async () => {
      const res = await fetchManual(`${base1}/tasks.html`, 'HEAD');
      assert.equal(res.status, 301);
      assert.equal(res.headers.location, '/grind.html');
    });

    await runTest('HEAD /tasks returns 301 with Location: /grind.html', async () => {
      const res = await fetchManual(`${base1}/tasks`, 'HEAD');
      assert.equal(res.status, 301);
      assert.equal(res.headers.location, '/grind.html');
    });

    await runTest('GET /todoist-callback returns 200 and serves grind.html content', async () => {
      const res = await fetchManual(`${base1}/todoist-callback`);
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type']?.includes('text/html'), 'Content-type should be text/html');
      assert.ok(
        res.body.includes('Grind Mode') || res.body.includes('grindContainer') || res.body.includes('gpace-logo-white.png'),
        'Body must contain grind.html content'
      );
      assert.ok(!res.body.includes('Redirecting to <a href="grind.html">'), 'Body must NOT be tasks.html redirect stub');
    });

    await runTest('GET /todoist-callback?code=oauth123&state=xyz returns 200 and serves grind.html', async () => {
      const res = await fetchManual(`${base1}/todoist-callback?code=oauth123&state=xyz`);
      assert.equal(res.status, 200);
      assert.ok(res.body.includes('Grind Mode') || res.body.includes('grindContainer'));
    });

  } finally {
    await new Promise(r => server1.close(r));
  }

  // =========================================================
  // SUITE 2: Full Server Stack (server.js startServer)
  // =========================================================
  console.log('\n--- Suite 2: Full server.js Production Stack Verification ---');

  const prodRuntime = await startServer({
    port: 0,
    publicDir: path.resolve(ROOT_DIR, 'dist')
  });
  const prodPort = prodRuntime.server.address().port;
  const prodBase = `http://localhost:${prodPort}`;

  try {
    await runTest('Production stack: GET /tasks.html returns 301 to /grind.html', async () => {
      const res = await fetchManual(`${prodBase}/tasks.html`);
      assert.equal(res.status, 301);
      assert.equal(res.headers.location, '/grind.html');
    });

    await runTest('Production stack: GET /tasks returns 301 to /grind.html', async () => {
      const res = await fetchManual(`${prodBase}/tasks`);
      assert.equal(res.status, 301);
      assert.equal(res.headers.location, '/grind.html');
    });

    await runTest('Production stack: GET /todoist-callback returns 200 with grind.html', async () => {
      const res = await fetchManual(`${prodBase}/todoist-callback`);
      assert.equal(res.status, 200);
      assert.ok(res.body.includes('Grind Mode') || res.body.includes('grindContainer'));
    });
  } finally {
    await new Promise(r => prodRuntime.server.close(r));
  }

  // =========================================================
  // SUITE 3: Static Scan of All 20 HTML Files
  // =========================================================
  console.log('\n--- Suite 3: Static HTML Landmark & Navigation Scan (All 20 Pages) ---');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'config', 'assets-manifest.json'), 'utf8'));
  const pages = manifest.pages;

  await runTest('Manifest defines exactly 20 pages', () => {
    assert.equal(pages.length, 20);
  });

  const CANONICAL_LINKS = [
    'grind.html',
    'study-spaces.html',
    'daily-calendar.html',
    'academic-details.html',
    'extracted.html',
    'subject-marks.html',
    'flashcards.html',
    'markdown-converter.html',
    'sleep-saboteurs.html',
    'settings.html'
  ];

  for (const pagePath of pages) {
    const fullPath = path.join(ROOT_DIR, pagePath);
    const html = fs.readFileSync(fullPath, 'utf8');

    await runTest(`Check page exists and is readable: ${pagePath}`, () => {
      assert.ok(html.length > 50, `${pagePath} should have valid HTML content`);
    });

    // Check navigation landmark
    const navMatch = html.match(/<nav\b[^>]*\bid=["']mainNavigation["'][^>]*>([\s\S]*?)<\/nav>/i);
    if (navMatch) {
      const navHtml = navMatch[0];

      await runTest(`Nav in ${pagePath} contains ZERO tasks.html links`, () => {
        const hasTasks = /<a\b[^>]*\bhref=["'][^"']*tasks\.html["']/i.test(navHtml);
        assert.equal(hasTasks, false, `${pagePath} must NOT contain tasks.html in mainNavigation`);
      });

      await runTest(`Nav in ${pagePath} contains all 10 canonical links`, () => {
        for (const link of CANONICAL_LINKS) {
          const regex = new RegExp(`href=["'][^"']*${link}["']`, 'i');
          assert.match(navHtml, regex, `${pagePath} mainNavigation must contain ${link}`);
        }
      });

      await runTest(`Nav in ${pagePath} has ZERO inline styles`, () => {
        const inlineStyles = navHtml.match(/\bstyle\s*=\s*["'][^"']*["']/gi) || [];
        assert.deepEqual(inlineStyles, [], `${pagePath} mainNavigation must not contain inline style="..."`);
      });
    } else {
      // workspace.html and tasks.html do not have mainNavigation
      await runTest(`Excluded page ${pagePath} is either workspace.html or tasks.html`, () => {
        assert.ok(pagePath === 'workspace.html' || pagePath === 'tasks.html',
          `${pagePath} has no mainNavigation landmark, which is only permitted for workspace.html or tasks.html`);
      });
    }
  }

  // =========================================================
  // SUITE 4: tasks.html Client-Side Redirect Stub Inspection
  // =========================================================
  console.log('\n--- Suite 4: tasks.html Redirect Stub Deep Inspection ---');

  const tasksPaths = [
    path.join(ROOT_DIR, 'tasks.html'),
    path.join(ROOT_DIR, 'dist', 'tasks.html')
  ];

  for (const tPath of tasksPaths) {
    const label = path.relative(ROOT_DIR, tPath);
    const content = fs.readFileSync(tPath, 'utf8');

    await runTest(`${label} has meta http-equiv="refresh" pointing to grind.html`, () => {
      assert.match(content, /<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=grind\.html["']/i);
    });

    await runTest(`${label} has window.location.replace script`, () => {
      assert.match(content, /window\.location\.replace\s*\(/);
      assert.match(content, /grind\.html/);
    });

    await runTest(`${label} preserves query strings and hash anchors in JS redirect`, () => {
      assert.match(content, /window\.location\.search/);
      assert.match(content, /window\.location\.hash/);
    });

    await runTest(`${label} has link rel="canonical" href="grind.html"`, () => {
      assert.match(content, /<link\b[^>]*rel=["']canonical["'][^>]*href=["']grind\.html["']/i);
    });

    await runTest(`${label} has accessible fallback link to grind.html`, () => {
      assert.match(content, /<a\b[^>]*href=["']grind\.html["'][^>]*>\s*Grind Mode\s*<\/a>/i);
    });

    await runTest(`${label} has ZERO inline style="..." attributes`, () => {
      const inlineStyles = content.match(/\bstyle\s*=\s*["'][^"']*["']/gi) || [];
      assert.deepEqual(inlineStyles, [], `${label} must have zero inline styles`);
    });

    await runTest(`${label} contains required Step 33 compatibility selectors in d-none`, () => {
      assert.match(content, /id="projectFilter"/);
      assert.match(content, /id="sectionFilter"/);
      assert.match(content, /id="sortFilter"/);
      assert.match(content, /class="[^"]*d-none[^"]*"/);
      assert.match(content, /normalizeAuthControls/);
      assert.match(content, /data-auth-actions="true"/);
    });
  }

  // =========================================================
  // SUITE 5: Ancillary Files & References Audit
  // =========================================================
  console.log('\n--- Suite 5: Ancillary Task References Audit ---');

  await runTest('firebase.json redirects /tasks.html and /tasks with 301 to /grind.html', () => {
    const fb = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'firebase.json'), 'utf8'));
    const redirects = fb.hosting?.redirects || [];
    const rTasksHtml = redirects.find(r => r.source === '/tasks.html');
    const rTasks = redirects.find(r => r.source === '/tasks');
    assert.ok(rTasksHtml, 'firebase.json must redirect /tasks.html');
    assert.equal(rTasksHtml.destination, '/grind.html');
    assert.equal(rTasksHtml.type, 301);
    assert.ok(rTasks, 'firebase.json must redirect /tasks');
    assert.equal(rTasks.destination, '/grind.html');
    assert.equal(rTasks.type, 301);

    const rewrites = fb.hosting?.rewrites || [];
    const rTodoist = rewrites.find(r => r.source === '/todoist-callback');
    assert.ok(rTodoist, 'firebase.json must rewrite /todoist-callback');
    assert.equal(rTodoist.destination, '/grind.html');
  });

  await runTest('settings.html line 69 .task-portal-btn links to grind.html, not tasks.html', () => {
    const settingsHtml = fs.readFileSync(path.join(ROOT_DIR, 'settings.html'), 'utf8');
    assert.doesNotMatch(settingsHtml, /task-portal-btn[^>]*href=["']tasks\.html["']|href=["']tasks\.html["'][^>]*task-portal-btn/);
    assert.match(settingsHtml, /task-portal-btn[^>]*href=["']grind\.html["']|href=["']grind\.html["'][^>]*task-portal-btn/);
  });

  await runTest('public/service-worker.js does not cache /tasks.html in CRITICAL_RESOURCES', () => {
    const swPath = path.join(ROOT_DIR, 'public', 'service-worker.js');
    if (fs.existsSync(swPath)) {
      const sw = fs.readFileSync(swPath, 'utf8');
      assert.doesNotMatch(sw, /['"]\/?tasks\.html['"]/);
    }
  });

  await runTest('todoistIntegration.js redirects to grind.html after auth', () => {
    const tdPath = path.join(ROOT_DIR, 'js', 'todoistIntegration.js');
    const td = fs.readFileSync(tdPath, 'utf8');
    assert.ok(
      td.includes('window.location.href = `${window.location.origin}/grind.html`') ||
      td.includes("window.location.href = '/grind.html'") ||
      td.includes('window.location.href = "grind.html"')
    );
  });

  // =========================================================
  // SUMMARY
  // =========================================================
  console.log('\n====================================================');
  console.log(`TOTAL TESTS: ${RESULTS.passed + RESULTS.failed}`);
  console.log(`PASSED: ${RESULTS.passed}`);
  console.log(`FAILED: ${RESULTS.failed}`);
  console.log('====================================================');

  if (RESULTS.failed > 0) {
    console.error('\nFailures summary:');
    for (const f of RESULTS.failures) {
      console.error(`- ${f.testName}: ${f.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Fatal error in test harness:', err);
  process.exit(1);
});
