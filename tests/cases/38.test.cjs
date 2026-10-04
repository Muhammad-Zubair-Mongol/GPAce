/** Step 38: recovery modal validation, dismissal, and awaited restore verification. */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('../harness/node_modules/playwright');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SOURCE = fs.readFileSync('js/components/RecoveryModal.js', 'utf8');
const BACKUP = { slot: 'latest', taskCount: 4, createdAt: '2026-09-28T10:00:00.000Z' };

async function loadModal(page) {
  await page.setContent('<!doctype html><html><body><button id="outside">Outside</button><main id="content">Content</main></body></html>');
  await page.evaluate(() => {
    window.SyncStatusIndicator = {
      states: [],
      setState(state) { this.states.push(state); },
      synced() { this.states.push('synced'); }
    };
    window.TaskRepository = null;
  });
  await page.addScriptTag({ content: SOURCE, type: 'module' });
  await page.waitForFunction(() => Boolean(window.RecoveryModal && document.querySelector('#gpac-recovery-overlay')));
}

describe('Step 38: recovery modal lifecycle', () => {
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

  it('returns an honest fresh result and stays hidden when backups are empty or invalid', async () => {
    const result = await page.evaluate(async () => window.RecoveryModal.show([
      { slot: 'latest', taskCount: 0, createdAt: '2026-09-28T10:00:00.000Z' },
      { slot: 'corrupt', taskCount: 'not-a-number', createdAt: 'invalid' }
    ], 'empty'));
    assert.equal(result.action, 'fresh');
    assert.equal(result.reason, 'no-recoverable-backup');
    assert.equal(result.backups.length, 1);
    assert.equal(await page.locator('#gpac-recovery-overlay').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('#gpac-recovery-overlay').evaluate(element => element.classList.contains('active')), false);
  });

  it('provides a named dialog, disables empty slots, traps focus, and safely defers on Escape', async () => {
    await page.evaluate(backup => { window.__promise = window.RecoveryModal.show([backup, { slot: 'manual', taskCount: 0, createdAt: backup.createdAt }], 'corruption'); }, BACKUP);
    await page.waitForFunction(() => document.querySelector('#gpac-recovery-overlay')?.classList.contains('active'));

    const modal = page.locator('.gpac-recovery-modal');
    assert.equal(await modal.getAttribute('role'), 'dialog');
    assert.equal(await modal.getAttribute('aria-modal'), 'true');
    assert.equal(await modal.getAttribute('aria-labelledby'), 'gpac-recovery-title');
    assert.equal(await page.locator('#content').getAttribute('inert'), '');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.slot), 'latest');
    assert.equal(await page.locator('[data-slot="manual"]').isDisabled(), true);

    await page.keyboard.press('Escape');
    const result = await page.evaluate(() => window.__promise);
    assert.deepEqual(result, { action: 'defer', reason: 'dismissed' });
    assert.equal(await page.locator('#gpac-recovery-overlay').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('#content').getAttribute('inert'), null);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'outside');
  });

  it('awaits repository restore, retains the backup after failure, supports retry, and never reloads', async () => {
    assert.doesNotMatch(SOURCE, /location\.reload/);
    await page.evaluate(backup => {
      window.__restoreCalls = 0;
      window.TaskRepository = {
        async forceRecoveryFromBackup(slot) {
          window.__restoreCalls += 1;
          window.__restoreSlot = slot;
          return window.__restoreCalls > 1 ? { success: true } : false;
        }
      };
      window.__promise = window.RecoveryModal.show([backup], 'corruption');
    }, BACKUP);
    await page.waitForFunction(() => document.querySelector('#gpac-recovery-overlay')?.classList.contains('active'));

    await page.locator('#gpac-recovery-restore').click();
    await page.waitForFunction(() => document.querySelector('#gpac-recovery-status')?.classList.contains('error'));
    assert.equal(await page.evaluate(() => window.__restoreCalls), 1);
    assert.equal(await page.locator('#gpac-recovery-overlay').evaluate(element => element.classList.contains('active')), true);
    assert.equal(await page.locator('[data-slot="latest"]').isVisible(), true);
    assert.equal(await page.locator('#gpac-recovery-restore').textContent(), 'Retry restore');

    await page.locator('#gpac-recovery-restore').click();
    await page.waitForFunction(() => document.querySelector('#gpac-recovery-status')?.classList.contains('success'));
    const result = await page.evaluate(() => window.__promise);
    assert.equal(result.action, 'restore');
    assert.equal(result.slot, 'latest');
    assert.equal(await page.evaluate(() => window.__restoreSlot), 'latest');
    assert.equal(await page.evaluate(() => window.SyncStatusIndicator.states.includes('synced')), true);

    await page.locator('#gpac-recovery-restore').click();
    await page.waitForFunction(() => document.querySelector('#gpac-recovery-overlay')?.getAttribute('aria-hidden') === 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'outside');
  });
});
