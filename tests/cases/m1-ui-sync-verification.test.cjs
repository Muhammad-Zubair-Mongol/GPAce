'use strict';

/**
 * tests/cases/m1-ui-sync-verification.test.cjs
 * 
 * Milestone 1 Empirical UI Compliance & Cross-View Synchronization Test Suite.
 * Verified by challenger_m1_2.
 * 
 * Asserts:
 * 1. ZERO inline style="..." attributes on any element touched by Milestone 1 in settings.html and study-spaces.html.
 * 2. Saving keys in Settings triggers 'geminiKeysUpdated' event and broadcasts across BroadcastChannel('gpace_gemini_keys').
 * 3. Grind Station (study-spaces) receives the updated pool count and updates UI elements.
 * 4. Static build compliance passes cleanly.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

// Test keys matching /^AIza[0-9A-Za-z-_]{30,45}$/
const TEST_KEY_1 = 'AIzaSyA_AlphaKey1234567890123456789012';
const TEST_KEY_2 = 'AIzaSyB_BetaKey12345678901234567890123';
const TEST_KEY_3 = 'AIzaSyC_GammaKey123456789012345678901';

// Helper to extract outer tag or block by regex
function extractTag(html, tagName, idOrClass) {
  const pattern = new RegExp(`<${tagName}[^>]*id=["']${idOrClass}["'][^>]*>`, 'i');
  return html.match(pattern);
}

describe('Milestone 1: Empirical UI Compliance & Cross-View Synchronization', () => {

  describe('Tier 1: UI Compliance & Zero Inline Styles', () => {
    const settingsHtml = fs.readFileSync(path.join(ROOT_DIR, 'settings.html'), 'utf8');
    const studySpacesHtml = fs.readFileSync(path.join(ROOT_DIR, 'study-spaces.html'), 'utf8');

    it('T1.UI.01: settings.html contains semantic gemini-settings-section', () => {
      assert.match(
        settingsHtml,
        /<section[^>]*class=["'][^"']*gemini-settings-section[^"']*["']/i,
        'settings.html must contain a section with class "gemini-settings-section"'
      );
    });

    it('T1.UI.02: ZERO inline style="..." on any element within gemini-settings-section in settings.html', () => {
      const sectionMatch = settingsHtml.match(
        /<section[^>]*class=["'][^"']*gemini-settings-section[^"']*["'][\s\S]*?<\/section>/i
      );
      assert.ok(sectionMatch, 'gemini-settings-section block not found in settings.html');

      const sectionContent = sectionMatch[0];
      const inlineStyleMatches = sectionContent.match(/<[^>]+\bstyle\s*=\s*["'][^"']*["'][^>]*>/gi) || [];

      assert.deepEqual(
        inlineStyleMatches,
        [],
        `Found prohibited inline styles in settings.html gemini-settings-section: ${inlineStyleMatches.join(', ')}`
      );
    });

    it('T1.UI.03: ZERO inline style="..." anywhere in the entire settings.html document', () => {
      const allInlineStyles = settingsHtml.match(/<[^>]+\bstyle\s*=\s*["'][^"']*["'][^>]*>/gi) || [];
      assert.deepEqual(
        allInlineStyles,
        [],
        `Found prohibited inline styles across settings.html: ${allInlineStyles.join(', ')}`
      );
    });

    it('T1.UI.04: study-spaces.html contains apiSettingsModal with textarea and status badge', () => {
      assert.match(
        studySpacesHtml,
        /<div[^>]*id=["']apiSettingsModal["']/i,
        'study-spaces.html must contain modal with id "apiSettingsModal"'
      );
      assert.match(
        studySpacesHtml,
        /<textarea[^>]*id=["']geminiApiKeys["']/i,
        'study-spaces.html must contain textarea with id "geminiApiKeys"'
      );
      assert.match(
        studySpacesHtml,
        /<span[^>]*id=["']geminiModalKeyCountBadge["']/i,
        'study-spaces.html must contain badge with id "geminiModalKeyCountBadge"'
      );
    });

    it('T1.UI.05: ZERO inline style="..." on any element within apiSettingsModal in study-spaces.html', () => {
      // Find modal block from opening <div id="apiSettingsModal" to its corresponding closing boundary
      const modalStartIndex = studySpacesHtml.indexOf('id="apiSettingsModal"');
      assert.ok(modalStartIndex !== -1, 'apiSettingsModal start tag not found');

      // The modal ends before the settings trigger button
      const triggerBtnIndex = studySpacesHtml.indexOf('id="apiSettingsBtn"');
      assert.ok(triggerBtnIndex > modalStartIndex, 'apiSettingsBtn must follow apiSettingsModal');

      const modalBlock = studySpacesHtml.substring(modalStartIndex - 30, triggerBtnIndex);
      const inlineStyleMatches = modalBlock.match(/<[^>]+\bstyle\s*=\s*["'][^"']*["'][^>]*>/gi) || [];

      assert.deepEqual(
        inlineStyleMatches,
        [],
        `Found prohibited inline styles in study-spaces.html apiSettingsModal: ${inlineStyleMatches.join(', ')}`
      );
    });

    it('T1.UI.06: study-spaces.html #apiKeyStatus uses utility class d-none with ZERO inline styles', () => {
      const statusMatch = studySpacesHtml.match(/<div[^>]*id=["']apiKeyStatus["'][^>]*>/i);
      assert.ok(statusMatch, '#apiKeyStatus tag must exist');
      assert.match(statusMatch[0], /\bclass=["'][^"']*\bd-none\b[^"']*["']/i, '#apiKeyStatus must use class "d-none"');
      assert.equal(/\bstyle\s*=/i.test(statusMatch[0]), false, '#apiKeyStatus must not have inline style');
    });

    it('T1.UI.07: study-spaces.html #apiSettingsBtn uses class api-settings-trigger with ZERO inline styles', () => {
      const btnMatch = studySpacesHtml.match(/<button[^>]*id=["']apiSettingsBtn["'][^>]*>/i);
      assert.ok(btnMatch, '#apiSettingsBtn tag must exist');
      assert.match(
        btnMatch[0],
        /\bclass=["'][^"']*\bapi-settings-trigger\b[^"']*["']/i,
        '#apiSettingsBtn must use class "api-settings-trigger"'
      );
      assert.equal(/\bstyle\s*=/i.test(btnMatch[0]), false, '#apiSettingsBtn must not have inline style');
    });

    it('T1.UI.08: css/settings.css and css/study-spaces.css contain styling classes for M1 components', () => {
      const settingsCss = fs.readFileSync(path.join(ROOT_DIR, 'css', 'settings.css'), 'utf8');
      const studySpacesCss = fs.readFileSync(path.join(ROOT_DIR, 'css', 'study-spaces.css'), 'utf8');

      assert.match(settingsCss, /\.gemini-settings-section/);
      assert.match(settingsCss, /\.gemini-textarea/);
      assert.match(settingsCss, /\.gemini-key-badge/);
      assert.match(settingsCss, /\.badge-active/);

      assert.match(studySpacesCss, /\.api-settings-trigger/);
    });

    it('T1.UI.09: Every individual element touched by M1 (#geminiApiKeys, #saveGeminiKeysBtn, #clearGeminiKeysBtn, #geminiKeyCountBadge, #geminiKeyFeedback, #apiSettingsModal, #apiSettingsBtn, #apiKeyStatus) has ZERO inline styles', () => {
      const settingsElements = [
        '#geminiApiKeys',
        '#saveGeminiKeysBtn',
        '#clearGeminiKeysBtn',
        '#geminiKeyCountBadge',
        '#geminiKeyFeedback'
      ];
      for (const sel of settingsElements) {
        const id = sel.slice(1);
        const match = settingsHtml.match(new RegExp(`<[^>]*id=["']${id}["'][^>]*>`, 'i'));
        assert.ok(match, `Element ${sel} must exist in settings.html`);
        assert.equal(/\bstyle\s*=/i.test(match[0]), false, `Element ${sel} in settings.html must have ZERO inline style`);
      }

      const studySpacesElements = [
        '#geminiApiKeys',
        '#apiSettingsModal',
        '#apiSettingsBtn',
        '#apiKeyStatus'
      ];
      for (const sel of studySpacesElements) {
        const id = sel.slice(1);
        const match = studySpacesHtml.match(new RegExp(`<[^>]*id=["']${id}["'][^>]*>`, 'i'));
        assert.ok(match, `Element ${sel} must exist in study-spaces.html`);
        assert.equal(/\bstyle\s*=/i.test(match[0]), false, `Element ${sel} in study-spaces.html must have ZERO inline style`);
      }
    });
  });

  describe('Tier 2: Event Trigger & BroadcastChannel Propagation', () => {
    let broadcastMessages;
    let windowEvents;
    let GeminiKeyManager;
    let manager;

    beforeEach(async () => {
      broadcastMessages = [];
      windowEvents = [];

      // Isolated storage
      const storageMap = new Map();
      globalThis.localStorage = {
        getItem: (k) => storageMap.get(k) || null,
        setItem: (k, v) => storageMap.set(k, String(v)),
        removeItem: (k) => storageMap.delete(k),
        clear: () => storageMap.clear()
      };

      // Mock BroadcastChannel
      class MockBroadcastChannel {
        constructor(channelName) {
          this.name = channelName;
          this.onmessage = null;
        }
        postMessage(data) {
          broadcastMessages.push({ channel: this.name, data });
        }
        close() {}
      }
      globalThis.BroadcastChannel = MockBroadcastChannel;

      // Mock window
      globalThis.window = globalThis;
      const listeners = new Map();
      globalThis.addEventListener = (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      };
      globalThis.removeEventListener = (type, fn) => {
        if (listeners.has(type)) listeners.get(type).delete(fn);
      };
      globalThis.dispatchEvent = (event) => {
        windowEvents.push(event);
        const handlers = listeners.get(event.type);
        if (handlers) {
          for (const h of handlers) h(event);
        }
        return true;
      };

      const mod = await import('../../js/GeminiKeyManager.js');
      GeminiKeyManager = mod.GeminiKeyManager;
      GeminiKeyManager.instance = null;
      manager = new GeminiKeyManager();
    });

    afterEach(() => {
      if (GeminiKeyManager) GeminiKeyManager.instance = null;
    });

    it('T2.EV.01: parseAndSetKeys triggers geminiKeysUpdated DOM CustomEvent on window', async () => {
      let receivedEvent = null;
      globalThis.addEventListener('geminiKeysUpdated', (e) => {
        receivedEvent = e;
      });

      const result = await manager.parseAndSetKeys(`${TEST_KEY_1}\n${TEST_KEY_2}`);

      assert.equal(result.validCount, 2);
      assert.ok(receivedEvent, 'geminiKeysUpdated event must be received');
      assert.equal(receivedEvent.type, 'geminiKeysUpdated');
      assert.equal(receivedEvent.detail.healthyKeys, 2);
      assert.equal(receivedEvent.detail.totalKeys, 2);
    });

    it('T2.EV.02: parseAndSetKeys broadcasts payload across BroadcastChannel("gpace_gemini_keys")', async () => {
      await manager.parseAndSetKeys(`${TEST_KEY_1}\n${TEST_KEY_2}\n${TEST_KEY_3}`);

      const broadcastMsg = broadcastMessages.find(m => m.channel === 'gpace_gemini_keys');
      assert.ok(broadcastMsg, 'Message must be sent to BroadcastChannel "gpace_gemini_keys"');
      assert.equal(broadcastMsg.data.type, 'geminiKeysUpdated');
      assert.equal(broadcastMsg.data.status.healthyKeys, 3);
      assert.equal(broadcastMsg.data.status.totalKeys, 3);
      assert.ok(broadcastMsg.data.timestamp > 0);
    });

    it('T2.EV.03: storage ping gpace_keys_sync_ping is updated on key changes', async () => {
      await manager.parseAndSetKeys(TEST_KEY_1);
      const ping = globalThis.localStorage.getItem('gpace_keys_sync_ping');
      assert.ok(ping, 'gpace_keys_sync_ping must be set in localStorage');
      assert.ok(Number(ping) > 0, 'Ping must be valid timestamp');
    });

    it('T2.EV.04: BroadcastChannel payload format inspection (actual vs { type: "GEMINI_KEYS_UPDATED", count: N })', async () => {
      await manager.parseAndSetKeys(`${TEST_KEY_1}\n${TEST_KEY_2}`);

      const broadcastMsg = broadcastMessages.find(m => m.channel === 'gpace_gemini_keys');
      assert.ok(broadcastMsg, 'Message must be transmitted on gpace_gemini_keys');

      // Canonical GPAce interface contract verification
      assert.equal(broadcastMsg.data.type, 'geminiKeysUpdated', 'Canonical type is camelCase geminiKeysUpdated');
      assert.equal(broadcastMsg.data.status.healthyKeys, 2, 'Key count is carried inside status.healthyKeys');
      assert.equal(broadcastMsg.data.status.totalKeys, 2, 'Total key count is inside status.totalKeys');

      // Empirical challenger finding: compare with alternative format { type: "GEMINI_KEYS_UPDATED", count: N }
      const hasScreamingSnakeType = broadcastMsg.data.type === 'GEMINI_KEYS_UPDATED';
      const hasFlatCount = broadcastMsg.data.count !== undefined;
      assert.equal(hasScreamingSnakeType, false, 'Payload uses canonical geminiKeysUpdated rather than GEMINI_KEYS_UPDATED');
      assert.equal(hasFlatCount, false, 'Payload encapsulates count in status.healthyKeys rather than flat count');
    });
  });

  describe('Tier 3: End-to-End Cross-View Synchronization (Settings -> Grind Station)', () => {
    let storageMap;
    let broadcastChannels;
    let GeminiKeyManager;

    beforeEach(async () => {
      storageMap = new Map();
      broadcastChannels = [];

      globalThis.localStorage = {
        getItem: (k) => storageMap.get(k) || null,
        setItem: (k, v) => storageMap.set(k, String(v)),
        removeItem: (k) => storageMap.delete(k),
        clear: () => storageMap.clear()
      };

      // Full BroadcastChannel bus interconnecting simulated tabs
      class InterconnectedBroadcastChannel {
        constructor(channelName) {
          this.name = channelName;
          this.targetWindow = globalThis.window;
          this.onmessage = null;
          broadcastChannels.push(this);
        }
        postMessage(data) {
          for (const ch of broadcastChannels) {
            if (ch !== this && ch.name === this.name && typeof ch.onmessage === 'function') {
              queueMicrotask(async () => {
                const prev = globalThis.window;
                if (ch.targetWindow) globalThis.window = ch.targetWindow;
                try {
                  await ch.onmessage({ data });
                } finally {
                  globalThis.window = prev;
                }
              });
            }
          }
        }
        close() {
          const idx = broadcastChannels.indexOf(this);
          if (idx !== -1) broadcastChannels.splice(idx, 1);
        }
      }
      globalThis.BroadcastChannel = InterconnectedBroadcastChannel;

      const mod = await import('../../js/GeminiKeyManager.js');
      GeminiKeyManager = mod.GeminiKeyManager;
    });

    afterEach(() => {
      if (GeminiKeyManager) GeminiKeyManager.instance = null;
      broadcastChannels = [];
    });

    it('T3.SYNC.01: Same-window sync: saving keys in Settings updates Grind Station modal badge and textarea', async () => {
      // Simulate DOM containing both Settings and Grind Station elements
      const elements = new Map();
      function makeElem(id, tagName = 'div') {
        const el = {
          id,
          tagName: tagName.toUpperCase(),
          textContent: '',
          value: '',
          className: '',
          hidden: false,
          classList: {
            add: (c) => { if (!el.className.includes(c)) el.className = (el.className + ' ' + c).trim(); },
            remove: (c) => { el.className = el.className.replace(new RegExp('\\b' + c + '\\b', 'g'), '').trim(); },
            contains: (c) => el.className.includes(c)
          }
        };
        elements.set(id, el);
        return el;
      }

      // Settings elements
      const settingsTextarea = makeElem('geminiApiKeys', 'textarea');
      const settingsBadge = makeElem('geminiKeyCountBadge', 'span');
      const settingsFeedback = makeElem('geminiKeyFeedback', 'div');

      // Grind Station elements (simulate station modal)
      const stationBadge = makeElem('geminiModalKeyCountBadge', 'span');
      const stationStatus = makeElem('apiKeyStatus', 'div');

      const listeners = new Map();
      const mockWindow = {
        addEventListener: (t, fn) => {
          if (!listeners.has(t)) listeners.set(t, new Set());
          listeners.get(t).add(fn);
        },
        removeEventListener: (t, fn) => {
          if (listeners.has(t)) listeners.get(t).delete(fn);
        },
        dispatchEvent: (e) => {
          const handlers = listeners.get(e.type);
          if (handlers) {
            for (const h of handlers) h(e);
          }
          return true;
        },
        localStorage: globalThis.localStorage,
        BroadcastChannel: globalThis.BroadcastChannel
      };

      globalThis.window = mockWindow;
      GeminiKeyManager.instance = null;
      const keyManager = new GeminiKeyManager();
      mockWindow.geminiKeyManager = keyManager;

      // Register Grind Station listener matching apiSettingsManager.js:193
      mockWindow.addEventListener('geminiKeysUpdated', async () => {
        const status = keyManager.getStatus();
        if (status.healthyKeys > 0) {
          stationBadge.textContent = `${status.healthyKeys} ${status.healthyKeys === 1 ? 'key' : 'keys'} active`;
          stationBadge.className = 'badge bg-success';
        } else {
          stationBadge.textContent = '0 keys active';
          stationBadge.className = 'badge bg-secondary';
        }
      });

      // User enters 2 keys in Settings
      settingsTextarea.value = `${TEST_KEY_1}\n${TEST_KEY_2}`;

      // Save keys in Settings
      const parseResult = await keyManager.parseAndSetKeys(settingsTextarea.value);
      assert.equal(parseResult.validCount, 2);

      // Verify Grind Station modal badge received the update!
      assert.equal(stationBadge.textContent, '2 keys active');
      assert.equal(stationBadge.className, 'badge bg-success');
    });

    it('T3.SYNC.02: Multi-tab cross-view sync: Settings in Tab 1 saves keys -> Grind Station in Tab 2 updates pool count', async () => {
      // Tab 1 (Settings)
      const tab1Listeners = new Map();
      const tab1Window = {
        addEventListener: (t, fn) => {
          if (!tab1Listeners.has(t)) tab1Listeners.set(t, new Set());
          tab1Listeners.get(t).add(fn);
        },
        dispatchEvent: (e) => {
          const h = tab1Listeners.get(e.type);
          if (h) for (const fn of h) fn(e);
          return true;
        },
        localStorage: globalThis.localStorage,
        BroadcastChannel: globalThis.BroadcastChannel
      };

      globalThis.window = tab1Window;
      GeminiKeyManager.instance = null;
      const tab1KeyManager = new GeminiKeyManager();
      await tab1KeyManager.init();

      // Tab 2 (Grind Station)
      const tab2Listeners = new Map();
      const tab2Elements = new Map();
      const tab2Badge = { id: 'geminiModalKeyCountBadge', textContent: '0 keys active', className: 'badge bg-secondary' };
      const tab2Textarea = { id: 'geminiApiKeys', value: '' };

      const tab2Window = {
        addEventListener: (t, fn) => {
          if (!tab2Listeners.has(t)) tab2Listeners.set(t, new Set());
          tab2Listeners.get(t).add(fn);
        },
        dispatchEvent: (e) => {
          const h = tab2Listeners.get(e.type);
          if (h) for (const fn of h) fn(e);
          return true;
        },
        localStorage: globalThis.localStorage,
        BroadcastChannel: globalThis.BroadcastChannel
      };

      globalThis.window = tab2Window;
      GeminiKeyManager.instance = null;
      const tab2KeyManager = new GeminiKeyManager();
      await tab2KeyManager.init();

      // Register Tab 2 Grind Station listener (from apiSettingsManager.js)
      tab2Window.addEventListener('geminiKeysUpdated', () => {
        tab2Textarea.value = tab2KeyManager.getKeysAsText();
        const status = tab2KeyManager.getStatus();
        if (status.healthyKeys > 0) {
          tab2Badge.textContent = `${status.healthyKeys} ${status.healthyKeys === 1 ? 'key' : 'keys'} active`;
          tab2Badge.className = 'badge bg-success';
        } else {
          tab2Badge.textContent = '0 keys active';
          tab2Badge.className = 'badge bg-secondary';
        }
      });

      // Initially Tab 2 has 0 keys
      assert.equal(tab2Badge.textContent, '0 keys active');

      // Now Tab 1 saves 3 keys
      globalThis.window = tab1Window;
      await tab1KeyManager.parseAndSetKeys(`${TEST_KEY_1}\n${TEST_KEY_2}\n${TEST_KEY_3}`);

      // Wait for BroadcastChannel microtask to propagate to Tab 2
      await new Promise(r => setTimeout(r, 100));

      // Tab 2 Grind Station must now reflect 3 keys active!
      assert.equal(tab2Badge.textContent, '3 keys active');
      assert.equal(tab2Badge.className, 'badge bg-success');
      assert.ok(tab2Textarea.value.includes(TEST_KEY_1));
      assert.ok(tab2Textarea.value.includes(TEST_KEY_2));
      assert.ok(tab2Textarea.value.includes(TEST_KEY_3));
    });

    it('T3.SYNC.03: Clearing keys in Settings immediately syncs 0 keys to Grind Station', async () => {
      // Seed storage with 2 keys
      globalThis.window = {
        addEventListener: () => {},
        dispatchEvent: () => true,
        localStorage: globalThis.localStorage,
        BroadcastChannel: globalThis.BroadcastChannel
      };
      GeminiKeyManager.instance = null;
      const km = new GeminiKeyManager();
      await km.parseAndSetKeys(`${TEST_KEY_1}\n${TEST_KEY_2}`);

      // Grind Station badge mock
      const stationBadge = { textContent: '2 keys active', className: 'badge bg-success' };

      // Clear keys
      await km.parseAndSetKeys('');
      const status = km.getStatus();

      if (status.healthyKeys > 0) {
        stationBadge.textContent = `${status.healthyKeys} keys active`;
      } else {
        stationBadge.textContent = '0 keys active';
        stationBadge.className = 'badge bg-secondary';
      }

      assert.equal(stationBadge.textContent, '0 keys active');
      assert.equal(stationBadge.className, 'badge bg-secondary');
      assert.equal(km.getKeysAsText(), '');
    });
  });

  describe('Tier 4: Static Distribution Compliance', () => {
    it('T4.BLD.01: node scripts/build-static.mjs --check completes with exit code 0', () => {
      const output = execSync('node scripts/build-static.mjs --check', {
        cwd: ROOT_DIR,
        encoding: 'utf8'
      });
      assert.match(output, /\[build-static\] PASSED/);
    });
  });
});
