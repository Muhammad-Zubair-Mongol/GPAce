/** Step 37: conflict modal semantics, focus, defer, and concurrency verification. */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('../harness/node_modules/playwright');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SOURCE = fs.readFileSync('js/components/ConflictModal.js', 'utf8');

async function loadModal(page) {
  await page.setContent('<!doctype html><html><body><button id="outside">Outside</button><main id="content">Content</main></body></html>');
  await page.evaluate(() => {
    window.SyncStatusIndicator = {
      states: [],
      setState(state) { this.states.push(state); }
    };
  });
  await page.addScriptTag({ content: SOURCE, type: 'module' });
  await page.waitForFunction(() => Boolean(window.ConflictModal && document.querySelector('#gpac-conflict-overlay')));
}

describe('Step 37: conflict modal lifecycle', () => {
  let browser;
  let page;

  before(async () => {
    browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await loadModal(page);
  });

  afterEach(async () => {
    await page.close();
  });

  after(async () => {
    await browser.close();
  });

  it('opens a named dialog, inerting the background and trapping focus while Escape leaves the conflict unresolved', async () => {
    await page.evaluate(() => {
      window.__promise = window.ConflictModal.show(
        { ts: 1700000000000, data: { local: 'keep' } },
        { ts: 1700000060000, data: { remote: 'keep' } }
      );
    });
    await page.waitForFunction(() => document.querySelector('#gpac-conflict-overlay')?.classList.contains('active'));

    const modal = page.locator('.gpac-conflict-modal');
    assert.equal(await modal.getAttribute('role'), 'dialog');
    assert.equal(await modal.getAttribute('aria-modal'), 'true');
    assert.equal(await modal.getAttribute('aria-labelledby'), 'gpac-conflict-title');
    assert.equal(await modal.getAttribute('aria-describedby'), 'gpac-conflict-message');
    assert.equal(await page.locator('#content').getAttribute('inert'), '');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'local');

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.gpac-conflict-btn'));
      buttons[buttons.length - 1].focus();
    });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'local');

    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#gpac-conflict-overlay').getAttribute('aria-hidden'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'local');

    await page.locator('[data-action="defer"]').click();
    const result = await page.evaluate(() => window.__promise);
    assert.equal(result.action, 'defer');
    assert.equal(result.unresolved, true);
    assert.deepEqual(result.localData.data, { local: 'keep' });
    assert.deepEqual(result.remoteData.data, { remote: 'keep' });
    assert.equal(await page.locator('#content').getAttribute('inert'), null);
  });

  it('serializes concurrent shows and does not report a deferred conflict as synced', async () => {
    await page.evaluate(() => {
      window.__first = window.ConflictModal.show(
        { ts: 1700000000000, data: { source: 'first-local' } },
        { ts: 1700000010000, data: { source: 'first-remote' } }
      );
      window.__second = window.ConflictModal.show(
        { ts: 1700000100000, data: { source: 'second-local' } },
        { ts: 1700000110000, data: { source: 'second-remote' } }
      );
    });
    await page.waitForFunction(() => document.querySelector('#gpac-local-info')?.textContent.includes('2023'));
    await page.locator('[data-action="remote"]').click();
    await page.waitForFunction(() => document.querySelector('#gpac-remote-info')?.textContent.includes('2023'));
    await page.locator('[data-action="defer"]').click();

    const results = await page.evaluate(async () => Promise.all([window.__first, window.__second]));
    assert.equal(results[0], 'remote');
    assert.equal(results[1].action, 'defer');
    assert.equal(results[1].unresolved, true);
    assert.deepEqual(await page.evaluate(() => window.SyncStatusIndicator.states), ['conflict', 'conflict']);
    assert.equal(await page.locator('#gpac-conflict-overlay').getAttribute('aria-hidden'), 'true');
  });
});
