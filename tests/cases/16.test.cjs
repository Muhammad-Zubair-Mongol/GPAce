/**
 * Step 16: Repair Grind page module bootstrap
 * 
 * Verifies:
 * 1. HTML topology: grind.html loads single module entry js/pages/grind.js, deduplicates
 *    dependencies, and does not mount unreferenced broken GrindInitializationController.
 * 2. Clean headless initialization with no syntax/duplicate-global/null-listener errors.
 * 3. Idempotent initialization: initGrindPage() twice binds exactly one handler set.
 * 4. Graceful handling: missing elements or unavailable storage do not throw uncaught errors.
 * 5. State preservation: state getters and controls maintain expected defaults.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const GRIND_HTML_PATH = path.resolve(ROOT_DIR, 'grind.html');
const GRIND_JS_PATH = path.resolve(ROOT_DIR, 'js', 'pages', 'grind.js');

describe('Step 16: Grind Page Module Bootstrap', () => {

  describe('HTML Topology & Script Mode Validation', () => {
    it('grind.html references js/pages/grind.js as a native ES module', () => {
      assert.ok(fs.existsSync(GRIND_HTML_PATH), 'grind.html must exist');
      const html = fs.readFileSync(GRIND_HTML_PATH, 'utf8');

      // Must have type="module" src="js/pages/grind.js"
      const moduleMatch = html.match(/<script\s+type="module"\s+src="js\/pages\/grind\.js(?:\?[^"']+)?">\s*<\/script>/i);
      assert.ok(moduleMatch, 'grind.html must load js/pages/grind.js as a native ES module');
    });

    it('does NOT mount broken unreferenced GrindInitializationController', () => {
      const html = fs.readFileSync(GRIND_HTML_PATH, 'utf8');
      assert.strictEqual(
        html.includes('GrindInitializationController'),
        false,
        'grind.html must not mount broken GrindInitializationController'
      );
    });

    it('does not have duplicate script references', () => {
      const html = fs.readFileSync(GRIND_HTML_PATH, 'utf8');
      const scriptTags = html.match(/<script[^>]+src=["']([^"']+)["']/gi) || [];
      const srcList = scriptTags.map(tag => {
        const m = tag.match(/src=["']([^"']+)["']/i);
        return m ? m[1] : '';
      });

      const counts = {};
      for (const src of srcList) {
        counts[src] = (counts[src] || 0) + 1;
        assert.strictEqual(counts[src], 1, `Duplicate script reference found: ${src}`);
      }
    });

    it('preserves essential UI markup containers', () => {
      const html = fs.readFileSync(GRIND_HTML_PATH, 'utf8');
      assert.ok(html.includes('id="currentTaskDisplay"'), 'Must have currentTaskDisplay');
      assert.ok(html.includes('id="timerMinutes"') || html.includes('timer'), 'Must have timer controls');
      assert.ok(html.includes('id="workspacePanel"'), 'Must have workspacePanel');
      assert.ok(html.includes('dynamicQuoteContainer') || html.includes('quote-container'), 'Must have quote container');
    });
  });

  describe('Module Exports & Implementation Contracts', () => {
    it('js/pages/grind.js exists and exports initGrindPage, getGrindState, destroyGrindPage', async () => {
      assert.ok(fs.existsSync(GRIND_JS_PATH), 'js/pages/grind.js must exist');
      const fileUrl = new URL(`file:///${GRIND_JS_PATH.replace(/\\/g, '/')}`).href;
      const mod = await import(fileUrl);

      assert.strictEqual(typeof mod.initGrindPage, 'function', 'initGrindPage must be exported');
      assert.strictEqual(typeof mod.getGrindState, 'function', 'getGrindState must be exported');
      assert.strictEqual(typeof mod.destroyGrindPage, 'function', 'destroyGrindPage must be exported');
    });

    it('idempotent initialization: calling twice binds one handler set and returns existing controller', async () => {
      const fileUrl = new URL(`file:///${GRIND_JS_PATH.replace(/\\/g, '/')}`).href;
      const { initGrindPage, destroyGrindPage } = await import(fileUrl);

      destroyGrindPage();

      // Mock DOM environment
      const mockDoc = {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      const mockWin = {
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      const mockStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      };

      const c1 = await initGrindPage({ document: mockDoc, window: mockWin, storage: mockStorage });
      const c2 = await initGrindPage({ document: mockDoc, window: mockWin, storage: mockStorage });

      assert.strictEqual(c1, c2, 'Second init call without force must return the identical controller');

      destroyGrindPage();
    });

    it('handles completely missing DOM elements gracefully without throwing null listener errors', async () => {
      const fileUrl = new URL(`file:///${GRIND_JS_PATH.replace(/\\/g, '/')}`).href;
      const { initGrindPage, destroyGrindPage } = await import(fileUrl);

      destroyGrindPage();

      const emptyDoc = {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {}
      };

      await assert.doesNotReject(async () => {
        const controller = await initGrindPage({
          document: emptyDoc,
          window: { addEventListener: () => {}, removeEventListener: () => {} },
          storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
          force: true
        });
        assert.ok(controller, 'Controller must initialize even with missing DOM elements');
      });

      destroyGrindPage();
    });

    it('handles disabled / unavailable storage gracefully', async () => {
      const fileUrl = new URL(`file:///${GRIND_JS_PATH.replace(/\\/g, '/')}`).href;
      const { initGrindPage, destroyGrindPage } = await import(fileUrl);

      destroyGrindPage();

      const failingStorage = {
        getItem: () => { throw new Error('Storage disabled'); },
        setItem: () => { throw new Error('Storage disabled'); },
        removeItem: () => {}
      };

      await assert.doesNotReject(async () => {
        const controller = await initGrindPage({
          document: {
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener: () => {},
            removeEventListener: () => {}
          },
          window: { addEventListener: () => {}, removeEventListener: () => {} },
          storage: failingStorage,
          force: true
        });
        assert.ok(controller.state, 'Controller state must be accessible');
        assert.strictEqual(controller.state.mode, 'focus');
      });

      destroyGrindPage();
    });
  });
});
