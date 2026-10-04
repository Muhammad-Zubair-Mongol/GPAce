/**
 * Step 57: cross-page accessibility and viewport regression gates.
 *
 * The case audits local source assets through a small deterministic server. If
 * Chrome or axe-core is unavailable, the same matrix still runs its static
 * asset and focus-contract checks and reports the browser-only limitations.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTestServer, createTempDir } = require('../harness/helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const MATRIX_PATH = path.join(ROOT, 'tests', 'fixtures', 'accessibility-matrix.json');
const MATRIX = JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

let chromium = null;
let axeSource = null;
try {
  ({ chromium } = require('../harness/node_modules/playwright'));
} catch {}
try {
  axeSource = require('../harness/node_modules/axe-core').source;
} catch {}

const browserAvailable = Boolean(chromium && fs.existsSync(CHROME) && axeSource);

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg'
  })[extension] || 'application/octet-stream';
}

function isExternalReference(reference) {
  return !reference
    || reference.startsWith('#')
    || /^(?:https?:|\/\/|data:|blob:|mailto:|javascript:|about:)/i.test(reference)
    || /\$\{[^}]+\}/.test(reference)
    || reference.startsWith('/socket.io/');
}

function normalizeReference(reference) {
  return reference.split('#')[0].split('?')[0].trim();
}

function browserAssetPath(value) {
  return normalizeReference(value).replace(/^\/+/, '');
}

function assetExceptionMatches(exception, pagePath, requestUrl) {
  let requestPath;
  try {
    requestPath = browserAssetPath(new URL(requestUrl).pathname);
  } catch {
    return false;
  }
  return exception.page === pagePath
    && browserAssetPath(exception.reference) === requestPath;
}

function isReviewedAssetFailure(pagePath, requestUrl) {
  return (MATRIX.assetExceptions || []).some(exception =>
    assetExceptionMatches(exception, pagePath, requestUrl)
  );
}

function resolveLocalReference(pagePath, reference) {
  const clean = normalizeReference(reference);
  if (isExternalReference(clean)) return null;
  const alias = (MATRIX.assetAliases || []).find(item => item.from === clean);
  if (alias) return path.resolve(ROOT, alias.to);
  const pageDirectory = path.posix.dirname(pagePath);
  const relative = clean.startsWith('/')
    ? clean.replace(/^\/+/, '')
    : path.posix.normalize(path.posix.join(pageDirectory, clean));
  return path.resolve(ROOT, relative.replace(/^\.\//, ''));
}

function localReferences(pagePath, source) {
  const references = [];
  const tagPattern = /<(script|link|img|iframe|source|video|audio)\b[^>]*>/gi;
  for (const match of source.matchAll(tagPattern)) {
    const tag = match[0];
    for (const attribute of ['src', 'href', 'poster', 'srcset']) {
      const valueMatch = tag.match(new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, 'i'));
      if (!valueMatch) continue;
      const values = attribute === 'srcset'
        ? valueMatch[1].split(',').map(value => value.trim().split(/\s+/)[0])
        : [valueMatch[1]];
      for (const value of values) {
        const target = resolveLocalReference(pagePath, value);
        if (target) references.push({ value, target, tag });
      }
    }
  }
  return references;
}

function validateMatrixShape() {
  assert.equal(MATRIX.expectedPageCount, 20);
  assert.equal(MATRIX.pages.length, MATRIX.expectedPageCount);
  assert.deepEqual(MATRIX.viewports.map(viewport => viewport.width), [320, 390, 768, 1440]);
  assert.deepEqual(MATRIX.modes.map(mode => mode.name), ['light', 'dark', 'reduced-motion']);
  assert.deepEqual(MATRIX.gates.axeImpacts, ['critical', 'serious']);
  assert.equal(MATRIX.gates.overflowTolerancePx, 1);

  const pages = new Set();
  for (const page of MATRIX.pages) {
    assert.ok(page.path && page.name, 'every matrix page needs a stable path and name');
    assert.equal(pages.has(page.path), false, `duplicate matrix page: ${page.path}`);
    pages.add(page.path);
    assert.ok(fs.existsSync(path.join(ROOT, page.path)), `matrix page is missing: ${page.path}`);
  }

  for (const exception of MATRIX.assetExceptions || []) {
    assert.ok(exception.page && exception.reference && exception.reason && exception.owner, 'asset exceptions need an owner and reason');
  }

  for (const exception of MATRIX.controlExceptions || []) {
    for (const field of ['page', 'selector', 'criterion', 'owner', 'reason']) {
      assert.ok(exception[field], `control exception is missing ${field}`);
    }
  }

  const viewportExceptionKeys = new Set();
  for (const exception of MATRIX.viewportExceptions || []) {
    for (const field of ['page', 'mode', 'width', 'selector', 'criterion', 'scope', 'classification', 'owner', 'reason', 'rationale', 'remediation']) {
      assert.ok(exception[field], `viewport exception is missing ${field}`);
    }
    assert.ok(exception.mode === '*' || MATRIX.modes.some(mode => mode.name === exception.mode), `${exception.page} ${exception.selector} uses an unknown mode`);
    assert.ok(exception.width === '*' || MATRIX.viewports.some(viewport => viewport.width === exception.width), `${exception.page} ${exception.selector} uses an unknown viewport`);
    assert.equal(exception.criterion, '1.4.10', `${exception.page} ${exception.selector} must cite WCAG 1.4.10`);
    assert.equal(exception.owner, 'Step 57 follow-up', `${exception.page} ${exception.selector} must name the reviewed owner`);
    const key = `${exception.page}|${exception.mode}|${exception.width}|${exception.selector}`;
    assert.equal(viewportExceptionKeys.has(key), false, `duplicate viewport exception: ${key}`);
    viewportExceptionKeys.add(key);
    if (['html', 'body'].includes(exception.selector)) {
      assert.equal(exception.scope, 'legacy-page', `${exception.page} ${exception.selector} must be classified as a legacy page finding`);
      assert.equal(exception.classification, 'documented-legacy-page-overflow', `${exception.page} ${exception.selector} needs the legacy page classification`);
    } else {
      assert.equal(exception.scope, 'local-content', `${exception.page} ${exception.selector} must be classified as local content`);
      assert.equal(exception.classification, 'documented-local-content-scroll', `${exception.page} ${exception.selector} needs the local-content classification`);
    }
  }

  for (const waiver of MATRIX.waivers) {
    for (const field of ['page', 'rule', 'criterion', 'selector', 'owner', 'reason']) {
      assert.ok(waiver[field], `axe waiver is missing ${field}`);
    }
  }
}

function runStaticAssetAudit() {
  const missing = [];
  for (const page of MATRIX.pages) {
    const source = fs.readFileSync(path.join(ROOT, page.path), 'utf8');
    for (const reference of localReferences(page.path, source)) {
      if (!fs.existsSync(reference.target) || !fs.statSync(reference.target).isFile()) {
        const exception = (MATRIX.assetExceptions || []).find(item => item.page === page.path && item.reference === reference.value);
        if (!exception) missing.push(`${page.path} -> ${reference.value}`);
      }
    }
    for (const frame of source.matchAll(/<iframe\b([^>]*)>/gi)) {
      assert.match(frame[1], /\btitle\s*=\s*["'][^"']+[^"']["']/i, `${page.path} has an unnamed iframe`);
    }
  }
  assert.deepEqual(missing, [], 'local page assets must resolve before browser assertions run');

  for (const signal of MATRIX.fallback.requiredSignals) {
    const source = fs.readFileSync(path.join(ROOT, signal.file), 'utf8');
    assert.match(source, new RegExp(signal.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `${signal.file} lacks ${signal.purpose}`);
  }

  for (const exception of MATRIX.fallback.reviewedExceptions || []) {
    for (const field of ['file', 'pattern', 'criterion', 'selector', 'owner', 'reason']) {
      assert.ok(exception[field], `reviewed fallback exception is missing ${field}`);
    }
    const source = fs.readFileSync(path.join(ROOT, exception.file), 'utf8');
    assert.doesNotMatch(source, new RegExp(exception.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `${exception.file} unexpectedly owns the reviewed-unleased rule`);
  }
}

async function serveWorkspace() {
  return createTestServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (requestPath === '/socket.io/socket.io.js') {
      response.setHeader('content-type', 'text/javascript; charset=utf-8');
      response.end('window.io = window.io || function () { return { on() {}, off() {}, emit() {}, disconnect() {} }; };');
      return;
    }

    let relativePath = (requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, ''));
    const alias = (MATRIX.assetAliases || []).find(item => item.from === relativePath);
    if (alias) relativePath = alias.to;
    const filePath = path.resolve(ROOT, relativePath);
    if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }
    response.setHeader('content-type', contentType(filePath));
    response.setHeader('cache-control', 'no-store');
    response.end(fs.readFileSync(filePath));
  });
}

function waiverMatches(waiver, pagePath, violation, target) {
  return (waiver.page === '*' || waiver.page === pagePath)
    && (waiver.rule === '*' || waiver.rule === violation.id)
    && (waiver.selector === '*' || waiver.selector === target);
}

function controlExceptionMatches(exception, pagePath, control) {
  return (exception.page === '*' || exception.page === pagePath) && exception.selector === control.selector;
}

function viewportExceptionMatches(exception, pagePath, mode, viewport, source) {
  return exception.page === pagePath
    && (exception.mode === '*' || exception.mode === mode.name)
    && (exception.width === '*' || exception.width === viewport.width)
    && exception.selector === source.selector
    && exception.criterion === '1.4.10'
    && exception.owner === 'Step 57 follow-up'
    && Boolean(exception.reason)
    && Boolean(exception.rationale)
    && Boolean(exception.remediation)
    && ['local-content', 'legacy-page'].includes(exception.scope);
}

function inspectViewportOverflow(metrics, pageFixture, mode, viewport) {
  const tolerance = MATRIX.gates.overflowTolerancePx;
  const exceptions = (MATRIX.viewportExceptions || []).filter(exception =>
    exception.page === pageFixture.path
      && (exception.mode === '*' || exception.mode === mode.name)
      && (exception.width === '*' || exception.width === viewport.width)
  );
  const sources = metrics.localScrollable;
  const rootOverflow = Math.max(metrics.documentWidth, metrics.bodyWidth) - metrics.viewport;
  const rootSources = sources.filter(source => ['html', 'body'].includes(source.selector));
  const rootCovered = rootOverflow <= tolerance || rootSources.some(source =>
    exceptions.some(exception => viewportExceptionMatches(exception, pageFixture.path, mode, viewport, source))
  );
  // Local scrollable regions are allowed when the document itself fits the
  // viewport. Once the document overflows, every unreviewed source remains
  // actionable unless an exact matrix exception covers the root finding.
  const unwaivedSources = rootOverflow <= tolerance || rootCovered
    ? []
    : sources.filter(source =>
      !exceptions.some(exception => viewportExceptionMatches(exception, pageFixture.path, mode, viewport, source))
    );

  return {
    rootOverflow,
    unwaivedSources,
    unattributedRoot: rootOverflow > tolerance && !rootCovered,
    reviewedSources: sources.filter(source =>
      exceptions.some(exception => viewportExceptionMatches(exception, pageFixture.path, mode, viewport, source))
    )
  };
}

async function settleLayout(page) {
  // Legacy pages can replace the document or suspend animation frames while
  // external resources are blocked. Keep the matrix bounded; the viewport
  // assertions below still inspect the settled document that is available.
  await Promise.race([
    page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })),
    new Promise(resolve => setTimeout(resolve, 250))
  ]);
}

async function measureViewport(page, zoom = 1) {
  return page.evaluate(scale => {
    const root = document.documentElement;
    if (scale === 1) root.style.removeProperty('font-size');
    else root.style.fontSize = `${scale * 100}%`;
    const documentWidth = root.scrollWidth;
    const bodyWidth = document.body?.scrollWidth || 0;
    const viewport = window.innerWidth;
    const localScrollable = Array.from(document.querySelectorAll('*'))
      .filter(element => element.scrollWidth > element.clientWidth + 1)
      .map(element => ({
        selector: element.id ? `#${element.id}` : element.className ? `.${String(element.className).split(/\s+/)[0]}` : element.tagName.toLowerCase(),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      }));
    if (scale === 1) root.style.removeProperty('font-size');
    return { viewport, documentWidth, bodyWidth, localScrollable };
  }, zoom);
}

async function inspectSemantics(page) {
  return page.evaluate(() => {
    const isVisible = element => {
      const style = getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.visibility !== 'collapse'
        && element.getAttribute('aria-hidden') !== 'true'
        && !element.closest('[aria-hidden="true"], [inert]')
        && element.getClientRects().length > 0;
    };
    const text = element => (element?.textContent || '').replace(/\s+/g, ' ').trim();
    const accessibleName = element => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const value = labelledBy.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(text).join(' ').trim();
        if (value) return value;
      }
      for (const attribute of ['aria-label', 'title', 'alt', 'placeholder']) {
        const value = element.getAttribute(attribute)?.trim();
        if (value) return value;
      }
      if (element.labels?.length) {
        const value = Array.from(element.labels).map(text).join(' ').trim();
        if (value) return value;
      }
      return text(element);
    };
    const controls = Array.from(document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])'))
      .filter(element => isVisible(element));
    const unnamedControls = controls
      .filter(element => !accessibleName(element))
      .map(element => ({
        selector: element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}.${String(element.className || '').split(/\s+/).filter(Boolean).join('.')}`,
        tag: element.tagName.toLowerCase()
      }));
    const frames = Array.from(document.querySelectorAll('iframe')).filter(isVisible).map(element => ({
      selector: element.id ? `#${element.id}` : 'iframe',
      title: element.getAttribute('title') || ''
    }));
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).filter(isVisible).map(element => ({
      selector: element.id ? `#${element.id}` : `[role="${element.getAttribute('role')}" ]`,
      role: element.getAttribute('role'),
      modal: element.getAttribute('aria-modal'),
      name: accessibleName(element)
    }));
    const focusProbes = controls.filter(element => !element.disabled).slice(0, 12).map(element => {
      element.focus({ preventScroll: true });
      const style = getComputedStyle(element);
      const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth || '0') > 0;
      const hasShadow = style.boxShadow && style.boxShadow !== 'none';
      return {
        selector: element.id ? `#${element.id}` : element.tagName.toLowerCase(),
        name: accessibleName(element),
        visibleFocus: hasOutline || hasShadow || element.matches(':focus-visible')
      };
    });
    document.activeElement?.blur?.();
    return {
      controls: controls.length,
      unnamedControls,
      frames,
      dialogs,
      focusProbes,
      activeTag: document.activeElement?.tagName || ''
    };
  });
}

async function inspectMedia(page, mode) {
  return page.evaluate(expected => ({
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    expectedTheme: expected.storedTheme,
    dataTheme: document.documentElement.getAttribute('data-theme') || document.documentElement.dataset.theme || '',
    bodyTheme: document.body?.className || ''
  }), mode);
}

async function checkKeyboardTraversal(page, controls) {
  if (controls === 0) return { trapped: false, visited: [] };
  await page.evaluate(() => document.activeElement?.blur?.());
  const visited = [];
  const limit = Math.min(Math.max(controls + 2, 5), 24);
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Tab');
    visited.push(await page.evaluate(() => {
      const element = document.activeElement;
      return element?.id || element?.getAttribute('aria-label') || element?.textContent?.trim().slice(0, 40) || element?.tagName || '';
    }));
  }
  const repeatedPrefix = visited.length >= 4 && visited.every(value => value && value === visited[0]);
  return { trapped: repeatedPrefix, visited };
}

async function runAxe(page) {
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      resultTypes: ['violations']
    });
    return result.violations;
  });
}

describe('Step 57: cross-page accessibility and viewport regression gates', () => {
  let server;
  let browser;
  let screenshotDirectory;

  before(async () => {
    if (browserAvailable) {
      browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
      server = await serveWorkspace();
      screenshotDirectory = createTempDir('gpace-step57-screenshots-');
    }
  });

  after(async () => {
    await browser?.close();
    await server?.close();
    screenshotDirectory?.cleanup();
  });

  it('keeps the matrix complete and the deterministic fallback audit active', () => {
    validateMatrixShape();
    runStaticAssetAudit();
    assert.ok(MATRIX.fallback.limitations.length >= 2);
  });

  it('audits every local page across widths, themes, motion, focus, dialogs, zoom, and axe', async () => {
    if (!browserAvailable) {
      console.warn('[Step57] Browser/axe unavailable; static fixture audit passed, browser-only gates were not executable.');
      return;
    }

    const browserWarnings = [];
    const unwaivedAxe = [];
    const unwaivedControls = [];
    const focusFailures = [];
    const viewportFailures = [];
    const localFailures = [];
    let screenshotCount = 0;

    for (const mode of MATRIX.modes) {
      const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
      await page.emulateMedia({
        colorScheme: mode.colorScheme,
        reducedMotion: mode.reducedMotion ? 'reduce' : 'no-preference'
      });
      await page.addInitScript(({ storedTheme }) => {
        try { localStorage.setItem('theme', storedTheme); } catch {}
      }, mode);
      await page.addInitScript({ content: axeSource });

      const externalFailures = [];
      const pageErrors = [];
      const requestPages = new WeakMap();
      let activePagePath = null;
      await page.route('**/*', async route => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.origin !== server.url) {
          externalFailures.push(route.request().url());
          await route.abort();
          return;
        }
        await route.continue();
      });
      page.on('request', request => {
        requestPages.set(request, activePagePath);
      });
      page.on('requestfailed', request => {
        const url = new URL(request.url());
        const pagePath = requestPages.get(request) || activePagePath;
        if (url.origin === server.url) {
          // A page navigation can abort a child document or a script request
          // while the matrix advances to the next fixture. Playwright reports
          // that normal teardown as ERR_ABORTED; the parent navigation itself
          // is still checked by page.goto and its HTTP status assertion.
          if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
          if (!isReviewedAssetFailure(pagePath, request.url())) {
            localFailures.push(`${pagePath || 'unknown-page'} -> ${request.url()} (${request.failure()?.errorText || 'failed'})`);
          }
        } else externalFailures.push(request.url());
      });
      page.on('pageerror', error => pageErrors.push(error.message));

      for (const pageFixture of MATRIX.pages) {
        activePagePath = pageFixture.path;
        const url = `${server.url}/${pageFixture.path}`;
        let response;
        try {
          response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await settleLayout(page);
        } catch (error) {
          browserWarnings.push(`${pageFixture.path} [${mode.name}] navigation: ${error.message}`);
          continue;
        }
        assert.ok(response && response.status() < 400, `${pageFixture.path} returned HTTP ${response?.status()}`);

        for (const viewport of MATRIX.viewports) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await settleLayout(page);
          const metrics = await measureViewport(page);
          const overflowCheck = inspectViewportOverflow(metrics, pageFixture, mode, viewport);
          if (overflowCheck.unwaivedSources.length > 0 || overflowCheck.unattributedRoot) {
            viewportFailures.push({
              page: pageFixture.path,
              mode: mode.name,
              width: viewport.width,
              phase: 'viewport',
              overflow: overflowCheck.rootOverflow,
              unwaivedSelectors: overflowCheck.unwaivedSources.map(source => source.selector),
              unattributedRoot: overflowCheck.unattributedRoot
            });
          } else if (overflowCheck.reviewedSources.length > 0 && mode.name === 'light' && viewport.width === 390) {
            browserWarnings.push(`${pageFixture.path} [${mode.name}/${viewport.width}] overflow matched ${overflowCheck.reviewedSources.map(source => source.selector).join(', ')}`);
          }

          const media = await inspectMedia(page, mode);
          assert.equal(media.colorScheme, mode.colorScheme, `${pageFixture.path} did not receive ${mode.colorScheme} media`);
          assert.equal(media.reducedMotion, mode.reducedMotion, `${pageFixture.path} did not receive reduced-motion media`);

          const semantics = await inspectSemantics(page);
          if (MATRIX.gates.requireNamedOperableControls) {
            const reviewedUnnamed = semantics.unnamedControls.filter(control =>
              (MATRIX.controlExceptions || []).some(exception => controlExceptionMatches(exception, pageFixture.path, control))
            );
            const unwaivedUnnamed = semantics.unnamedControls.filter(control =>
              !reviewedUnnamed.includes(control)
            );
            unwaivedControls.push(...unwaivedUnnamed.map(control => ({
              page: pageFixture.path,
              mode: mode.name,
              width: viewport.width,
              ...control
            })));
            if (reviewedUnnamed.length > 0 && mode.name === 'light' && viewport.width === 390) {
              browserWarnings.push(`${pageFixture.path} reviewed named-control exception: ${reviewedUnnamed.map(control => control.selector).join(', ')}`);
            }
          }
          if (MATRIX.gates.requireNamedFrames) {
            assert.deepEqual(semantics.frames.filter(frame => !frame.title), [], `${pageFixture.path} has an unnamed frame`);
          }
          for (const dialog of semantics.dialogs) {
            assert.equal(dialog.modal, 'true', `${pageFixture.path} ${dialog.selector} must declare aria-modal=true`);
            assert.ok(dialog.name, `${pageFixture.path} ${dialog.selector} must have an accessible name`);
          }
          if (MATRIX.gates.requireVisibleFocus) {
            const missingFocus = semantics.focusProbes.filter(probe => !probe.visibleFocus);
            focusFailures.push(...missingFocus.map(probe => ({
              page: pageFixture.path,
              mode: mode.name,
              width: viewport.width,
              ...probe
            })));
          }

          const violations = await runAxe(page);
          for (const violation of violations.filter(item => MATRIX.gates.axeImpacts.includes(item.impact))) {
            for (const node of violation.nodes) {
              const target = node.target.join(' ');
              if (!(MATRIX.waivers || []).some(waiver => waiverMatches(waiver, pageFixture.path, violation, target))) {
                unwaivedAxe.push({ page: pageFixture.path, mode: mode.name, width: viewport.width, rule: violation.id, impact: violation.impact, target });
              }
            }
          }

          if (mode.name === 'light' && viewport.width === 390) {
            const keyboard = await checkKeyboardTraversal(page, semantics.controls);
            if (MATRIX.gates.requireNoKeyboardTrap) assert.equal(keyboard.trapped, false, `${pageFixture.path} traps keyboard focus: ${keyboard.visited.join(' -> ')}`);
            if (MATRIX.gates.captureScreenshots) {
              const fileName = `${pageFixture.path.replace(/[^a-z0-9]+/gi, '_')}_${mode.name}.png`;
              try {
                await page.screenshot({
                  path: path.join(screenshotDirectory.path, fileName),
                  animations: 'disabled',
                  timeout: 10000
                });
              } catch (error) {
                throw new Error(`screenshot failed for ${pageFixture.path} [${mode.name}/${viewport.width}]: ${error.message}`);
              }
              screenshotCount += 1;
            }
          }

          if (mode.name === 'light' && viewport.width === 320) {
            const zoomMetrics = await measureViewport(page, MATRIX.gates.zoomTextScale);
            const zoomCheck = inspectViewportOverflow(zoomMetrics, pageFixture, mode, viewport);
            if (zoomCheck.unwaivedSources.length > 0 || zoomCheck.unattributedRoot) {
              viewportFailures.push({
                page: pageFixture.path,
                mode: mode.name,
                width: viewport.width,
                phase: `text-zoom-${MATRIX.gates.zoomTextScale}x`,
                overflow: zoomCheck.rootOverflow,
                unwaivedSelectors: zoomCheck.unwaivedSources.map(source => source.selector),
                unattributedRoot: zoomCheck.unattributedRoot
              });
            }
          }
        }

        if (externalFailures.length > 0) browserWarnings.push(`${pageFixture.path} [${mode.name}] blocked external requests: ${externalFailures.length}`);
        if (pageErrors.length > 0) browserWarnings.push(`${pageFixture.path} [${mode.name}] runtime errors: ${pageErrors.slice(0, 3).join(' | ')}`);
      }
      await page.close();
    }

    assert.deepEqual(localFailures, [], `local asset requests failed: ${localFailures.join('; ')}`);
    assert.deepEqual(viewportFailures, [], `unwaived viewport overflow: ${JSON.stringify(viewportFailures.slice(0, 30))}`);
    assert.deepEqual(unwaivedControls, [], `unwaived unnamed controls: ${JSON.stringify(unwaivedControls.slice(0, 30))}`);
    assert.deepEqual(focusFailures, [], `controls without visible focus: ${JSON.stringify(focusFailures.slice(0, 30))}`);
    assert.deepEqual(unwaivedAxe, [], `unwaived critical/serious axe findings: ${JSON.stringify(unwaivedAxe.slice(0, 20))}`);
    assert.equal(screenshotCount, MATRIX.pages.length, `one active-page screenshot should be captured per matrix page; navigation warnings: ${browserWarnings.filter(warning => warning.includes('navigation:')).join(' | ')}`);
    if (!MATRIX.gates.compareReviewedBaselines) {
      console.warn('[Step57] Screenshots were captured, but no reviewed baseline directory is committed; visual baseline comparison remains a limitation.');
    }
    if (browserWarnings.length > 0) {
      console.warn(`[Step57] Browser limitations/warnings (${browserWarnings.length}): ${browserWarnings.slice(0, 12).join(' || ')}`);
    }
  });
});
