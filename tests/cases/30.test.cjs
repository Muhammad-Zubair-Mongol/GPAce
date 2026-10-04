/** Step 30: landing and academic page resource/layout/accessibility verification. */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../harness/node_modules/playwright');
const { createTestServer } = require('../harness/helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGES = ['index.html', 'landing.html', 'academic-details.html', 'priority-calculator.html'];

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8'
  })[ext] || 'application/octet-stream';
}

async function serveWorkspace() {
  return createTestServer((req, res) => {
    const requestPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const relative = requestPath.replace(/^\/+/, '');
    const filePath = path.resolve(ROOT, relative);
    if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('content-type', contentType(filePath));
    res.end(fs.readFileSync(filePath));
  });
}

function localResourceRefs(fileName) {
  const source = fs.readFileSync(path.join(ROOT, fileName), 'utf8');
  const refs = [];
  const tagPattern = /<(script|link|img|source)\b[^>]*>/gi;
  for (const match of source.matchAll(tagPattern)) {
    const tag = match[0];
    for (const attr of ['src', 'href', 'srcset']) {
      const attrMatch = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
      if (!attrMatch) continue;
      for (const value of attrMatch[1].split(',').map(item => item.trim().split(/\s+/)[0])) {
        if (!value || /^(?:https?:|\/\/|data:|mailto:|javascript:|#)/i.test(value)) continue;
        refs.push(value.split('#')[0].split('?')[0]);
      }
    }
  }
  return refs;
}

describe('Step 30: landing and academic details verification', () => {
  let browser;
  let server;
  let page;

  before(async () => {
    browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
    server = await serveWorkspace();
    page = await browser.newPage();
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== server.url) return route.abort();
      if (url.pathname.endsWith('.js')) return route.abort();
      return route.continue();
    });
  });

  after(async () => {
    await page.close();
    await browser.close();
    await server.close();
  });

  it('removes known stale local resource references and keeps every remaining local asset resolvable', () => {
    const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const landing = fs.readFileSync(path.join(ROOT, 'landing.html'), 'utf8');
    const academic = fs.readFileSync(path.join(ROOT, 'academic-details.html'), 'utf8');
    assert.doesNotMatch(index, /js\/cacheManager\.js/i);
    assert.doesNotMatch(landing, /js\/theme-toggle\.js/i);
    assert.doesNotMatch(academic, /\.webp(?:["')\s]|$)/i);

    for (const fileName of PAGES) {
      for (const ref of localResourceRefs(fileName)) {
        const target = path.resolve(ROOT, ref.replace(/^\/+/, ''));
        assert.ok(fs.existsSync(target), `${fileName} references missing local asset ${ref}`);
      }
    }

    for (const image of [...landing.matchAll(/<img\b[^>]*>/gi), ...academic.matchAll(/<img\b[^>]*>/gi)]) {
      assert.match(image[0], /\balt\s*=\s*["'][^"']+["']/i, `image in ${image.input.slice(0, 30)} needs alt text`);
      assert.match(image[0], /\b(?:width|height)\s*=\s*["'][^"']+["']/i, 'above-the-fold image needs a reserved dimension');
    }
  });

  it('keeps the landing page inside the viewport at phone widths', async () => {
    await page.goto(`${server.url}/landing.html`, { waitUntil: 'load' });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const metrics = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        viewport: innerWidth,
        offenders: [...document.body.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(element).position !== 'fixed').map(element => `${element.tagName}.${String(element.className).slice(0, 50)}`).slice(0, 12),
        logo: document.querySelector('.top-nav .nav-brand img')?.getBoundingClientRect().toJSON(),
        footerLogo: document.querySelector('.footer-logo')?.getBoundingClientRect().toJSON()
      }));
      assert.ok(metrics.documentWidth <= width + 1, `${width}px landing document width was ${metrics.documentWidth}; offenders: ${metrics.offenders.join(', ')}`);
      assert.ok(metrics.bodyWidth <= width + 1, `${width}px landing body width was ${metrics.bodyWidth}`);
      assert.ok(metrics.logo.width <= width, 'navigation logo exceeds viewport');
      assert.ok(metrics.footerLogo.width <= width, 'footer logo exceeds viewport');
    }
  });

  it('exposes the priority formula helper as an operable named control with readable copy', async () => {
    await page.goto(`${server.url}/priority-calculator.html`, { waitUntil: 'domcontentloaded' });
    const info = page.locator('#formulaInfoButton');
    assert.equal(await info.evaluate(element => element.tagName), 'BUTTON');
    assert.equal(await info.getAttribute('aria-label'), 'How the priority score is calculated');
    assert.equal(await info.getAttribute('aria-controls'), 'formula-help');
    assert.equal(await info.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#formula-help').getAttribute('hidden'), '');
    assert.equal(await page.locator('#formulaInfoButton i').getAttribute('aria-hidden'), 'true');

    const colors = await page.evaluate(() => {
      const paragraph = document.querySelector('.formula-component p');
      const code = document.querySelector('.formula-component code');
      return {
        paragraphColor: getComputedStyle(paragraph).color,
        paragraphOpacity: getComputedStyle(paragraph).opacity,
        codeColor: getComputedStyle(code).color,
        codeOpacity: getComputedStyle(code).opacity
      };
    });
    assert.notEqual(colors.paragraphColor, 'rgba(0, 0, 0, 0)');
    assert.notEqual(colors.codeColor, 'rgba(0, 0, 0, 0)');
    assert.equal(colors.paragraphOpacity, '1');
    assert.equal(colors.codeOpacity, '1');

    await info.click();
    assert.equal(await info.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#formula-help').getAttribute('hidden'), null);
    await info.click();
    assert.equal(await info.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#formula-help').getAttribute('hidden'), '');
  });

  it('guards the index redirect against repeated execution', () => {
    const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.match(source, /let\s+redirected\s*=\s*false/);
    assert.match(source, /if\s*\(redirected\)\s*return/);
    assert.match(source, /window\.location\.replace\(['"]landing\.html['"]\)/);
  });
});
