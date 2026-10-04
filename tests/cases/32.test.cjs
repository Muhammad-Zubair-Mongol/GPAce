/** Step 32: side drawer modal/non-modal focus lifecycle verification. */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('../harness/node_modules/playwright');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DRAWER_SOURCE = fs.readFileSync('js/sideDrawer.js', 'utf8');
const DRAWER_CSS = fs.readFileSync('css/sideDrawer.css', 'utf8');

function fixture() {
  return `<!doctype html><html><head></head><body>
    <nav class="top-nav"><div class="nav-links"></div></nav>
    <main id="mainContent"><button id="outside">Outside content</button><a href="#outside-link" id="outsideLink">Outside link</a></main>
  </body></html>`;
}

async function loadDrawer(page, width) {
  await page.setViewportSize({ width, height: 800 });
  await page.setContent(fixture());
  await page.addStyleTag({ content: DRAWER_CSS });
  await page.evaluate(() => {
    window.auth = {
      currentUser: null,
      onAuthStateChanged(callback) { callback(null); }
    };
  });
  await page.addScriptTag({ content: DRAWER_SOURCE, type: 'module' });
  await page.waitForFunction(() => Boolean(window.sideDrawer && document.querySelector('.side-drawer')));
}

describe('Step 32: side drawer focus lifecycle', () => {
  let browser;
  let page;

  before(async () => {
    browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox'] });
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page.close();
  });

  after(async () => {
    await browser.close();
  });

  it('treats the mobile drawer as a modal with inert background, initial focus, Escape, and a focus trap', async () => {
    await loadDrawer(page, 390);
    const toggle = page.locator('.drawer-toggle');
    await toggle.focus();
    await page.evaluate(() => {
      window.sideDrawer.setupEventListeners();
      window.sideDrawer.setupEventListeners();
    });
    await toggle.click();

    assert.equal(await page.locator('.side-drawer').getAttribute('role'), 'dialog');
    assert.equal(await page.locator('.side-drawer').getAttribute('aria-modal'), 'true');
    assert.equal(await page.locator('.side-drawer').getAttribute('aria-hidden'), 'false');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#mainContent').getAttribute('inert'), '');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'drawer-close');

    await page.evaluate(() => {
      const focusable = window.sideDrawer.getFocusableElements();
      focusable[focusable.length - 1].focus();
    });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'drawer-close');

    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.side-drawer').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('#mainContent').getAttribute('inert'), null);
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'drawer-toggle');
  });

  it('treats the desktop drawer as a non-modal complementary panel and restores focus', async () => {
    await loadDrawer(page, 1024);
    const toggle = page.locator('.drawer-toggle');
    await toggle.focus();
    await toggle.click();

    assert.equal(await page.locator('.side-drawer').getAttribute('role'), 'complementary');
    assert.equal(await page.locator('.side-drawer').getAttribute('aria-modal'), null);
    assert.equal(await page.locator('#mainContent').getAttribute('inert'), null);
    assert.equal(await page.locator('.side-drawer').evaluate(element => getComputedStyle(element).visibility), 'visible');
    assert.equal(await page.locator('.side-drawer').evaluate(element => getComputedStyle(element).transform), 'matrix(1, 0, 0, 1, 0, 0)');

    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.side-drawer').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'drawer-toggle');
    assert.equal(await page.locator('.side-drawer').evaluate(element => getComputedStyle(element).visibility), 'hidden');
  });
});
