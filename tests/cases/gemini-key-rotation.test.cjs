'use strict';

/**
 * tests/cases/gemini-key-rotation.test.cjs
 * 
 * Dedicated comprehensive test suite for Gemini API Key Rotation & Multi-Key Infrastructure.
 * Validates multi-line parsing, regex format validation, deduplication, true round-robin load distribution,
 * immediate zero-delay HTTP 429 failover with 60-second cooldown recovery, status reporting,
 * event emission (geminiKeysUpdated), BroadcastChannel multi-tab sync, and persistent storage.
 * 
 * Structure: 4-Tier Test Methodology (TEST_INFRA.md, ORIGINAL_REQUEST.md, PROJECT.md)
 * - Tier 1: Feature Coverage (F1 to F5)
 * - Tier 2: Boundary & Corner Cases (B1 to B5)
 * - Tier 3: Cross-Feature Integration (T3.X01 to T3.X05)
 * - Tier 4: Real-World Scenarios (T4.S01 to T4.S02)
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createIsolatedStorage } = require('../harness/helpers.cjs');

// Canonical test keys conforming to /^AIza[0-9A-Za-z-_]{30,45}$/
const VALID_KEY_A = 'AIzaSyA_AlphaKey1234567890123456789012'; // 39 chars
const VALID_KEY_B = 'AIzaSyB_BetaKey12345678901234567890123'; // 39 chars
const VALID_KEY_C = 'AIzaSyC_GammaKey123456789012345678901'; // 38 chars
const VALID_KEY_D = 'AIzaSyD_DeltaKey1234567890123456789012'; // 39 chars

// Malformed key samples
const INVALID_KEY_OPENAI = 'sk-proj-1234567890abcdefghijklmnopqrstuvwxyz';
const INVALID_KEY_ANTHROPIC = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz12345';
const INVALID_KEY_SHORT = 'AIzaShort';
const INVALID_KEY_LONG = 'AIzaSyA_TooLongKeyThatExceedsTheMaximumAllowedLengthLimitHere1234567890';
const INVALID_KEY_CHARS = 'AIzaSyA_BadChars!@#$%^&*()_+=123456789';

describe('Gemini API Key Rotation & Multi-Key Infrastructure', () => {
  let isolatedStorage;
  let GeminiKeyManager;
  let manager;
  let broadcastMessages;
  let dispatchedEvents;
  let originalDateNow;

  beforeEach(async () => {
    // Isolated storage setup
    isolatedStorage = createIsolatedStorage();
    globalThis.localStorage = isolatedStorage;
    globalThis.window = globalThis;

    broadcastMessages = [];
    dispatchedEvents = [];
    originalDateNow = Date.now;

    // Mock BroadcastChannel
    class MockBroadcastChannel {
      constructor(name) {
        this.name = name;
        this.onmessage = null;
      }
      postMessage(data) {
        broadcastMessages.push({ channel: this.name, data });
      }
      close() {}
    }
    globalThis.BroadcastChannel = MockBroadcastChannel;

    // Mock window event dispatching
    const listeners = new Map();
    globalThis.addEventListener = (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    };
    globalThis.removeEventListener = (type, fn) => {
      if (listeners.has(type)) listeners.get(type).delete(fn);
    };
    globalThis.dispatchEvent = (event) => {
      dispatchedEvents.push(event);
      const handlers = listeners.get(event.type);
      if (handlers) {
        for (const handler of handlers) handler(event);
      }
      return true;
    };

    // Load GeminiKeyManager dynamically
    const keyManagerMod = await import('../../js/GeminiKeyManager.js');
    GeminiKeyManager = keyManagerMod.GeminiKeyManager;

    // Reset singleton instance for test isolation
    GeminiKeyManager.instance = null;
    manager = new GeminiKeyManager();
  });

  afterEach(() => {
    Date.now = originalDateNow;
    if (GeminiKeyManager) {
      GeminiKeyManager.instance = null;
    }
  });

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (F1 to F5)
  // =========================================================================
  describe('Tier 1: Feature Coverage', () => {

    describe('Feature 1: Multi-line Key Parsing & Sanitization', () => {
      it('T1.F1.01: parses keys separated by standard Unix newlines (\\n)', async () => {
        const rawInput = `${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_C}`;
        const outcome = await manager.parseAndSetKeys(rawInput);

        assert.equal(outcome.validCount, 3);
        assert.equal(manager.keys.length, 3);
        assert.deepEqual(manager.keys.map(k => k.key), [VALID_KEY_A, VALID_KEY_B, VALID_KEY_C]);
      });

      it('T1.F1.02: parses keys separated by Windows CRLF newlines (\\r\\n)', async () => {
        const rawInput = `${VALID_KEY_A}\r\n${VALID_KEY_B}\r\n${VALID_KEY_C}`;
        const outcome = await manager.parseAndSetKeys(rawInput);

        assert.equal(outcome.validCount, 3);
        assert.equal(manager.keys.length, 3);
        assert.deepEqual(manager.keys.map(k => k.key), [VALID_KEY_A, VALID_KEY_B, VALID_KEY_C]);
      });

      it('T1.F1.03: parses comma-separated keys and mixed newline/comma delimiters', async () => {
        const rawInput = `${VALID_KEY_A}, ${VALID_KEY_B}\n${VALID_KEY_C},${VALID_KEY_D}`;
        const outcome = await manager.parseAndSetKeys(rawInput);

        assert.equal(outcome.validCount, 4);
        assert.equal(manager.keys.length, 4);
        assert.deepEqual(manager.keys.map(k => k.key), [VALID_KEY_A, VALID_KEY_B, VALID_KEY_C, VALID_KEY_D]);
      });

      it('T1.F1.04: trims leading, trailing, and tab whitespace around each key', async () => {
        const rawInput = `  \t ${VALID_KEY_A}  \n\t\t${VALID_KEY_B}   \r\n   ${VALID_KEY_C}\t `;
        const outcome = await manager.parseAndSetKeys(rawInput);

        assert.equal(outcome.validCount, 3);
        assert.deepEqual(manager.keys.map(k => k.key), [VALID_KEY_A, VALID_KEY_B, VALID_KEY_C]);
      });

      it('T1.F1.05: ignores empty lines, blank lines, and trailing blank lines without errors', async () => {
        const rawInput = `\n\n   \n${VALID_KEY_A}\n\n   \t  \n${VALID_KEY_B}\n\n\n`;
        const outcome = await manager.parseAndSetKeys(rawInput);

        assert.equal(outcome.validCount, 2);
        assert.equal(manager.keys.length, 2);
        assert.deepEqual(manager.keys.map(k => k.key), [VALID_KEY_A, VALID_KEY_B]);
      });
    });

    describe('Feature 2: Key Format Validation', () => {
      it('T1.F2.01: accepts standard Google AI Studio keys matching /^AIza[0-9A-Za-z-_]{30,45}$/', async () => {
        const outcome = await manager.parseAndSetKeys(VALID_KEY_A);
        assert.equal(outcome.validCount, 1);
        assert.equal(outcome.invalidCount, 0);
        assert.equal(manager.keys[0].key, VALID_KEY_A);
      });

      it('T1.F2.02: rejects non-Google keys (OpenAI, Anthropic) without adding them to pool', async () => {
        const rawInput = `${VALID_KEY_A}\n${INVALID_KEY_OPENAI}\n${INVALID_KEY_ANTHROPIC}\n${VALID_KEY_B}`;
        const outcome = await manager.parseAndSetKeys(rawInput);

        assert.equal(outcome.validCount, 2);
        assert.equal(outcome.invalidCount, 2);
        assert.deepEqual(manager.keys.map(k => k.key), [VALID_KEY_A, VALID_KEY_B]);
        assert.ok(outcome.invalidKeys.includes(INVALID_KEY_OPENAI));
        assert.ok(outcome.invalidKeys.includes(INVALID_KEY_ANTHROPIC));
      });

      it('T1.F2.03: rejects keys with invalid lengths (too short or too long)', async () => {
        const rawInput = `${INVALID_KEY_SHORT}\n${VALID_KEY_A}\n${INVALID_KEY_LONG}`;
        const outcome = await manager.parseAndSetKeys(rawInput);

        assert.equal(outcome.validCount, 1);
        assert.equal(outcome.invalidCount, 2);
        assert.deepEqual(manager.keys.map(k => k.key), [VALID_KEY_A]);
      });

      it('T1.F2.04: rejects keys containing illegal punctuation and special characters', async () => {
        const rawInput = `${INVALID_KEY_CHARS}\n${VALID_KEY_C}`;
        const outcome = await manager.parseAndSetKeys(rawInput);

        assert.equal(outcome.validCount, 1);
        assert.equal(outcome.invalidCount, 1);
        assert.deepEqual(manager.keys.map(k => k.key), [VALID_KEY_C]);
      });

      it('T1.F2.05: accurately returns parse metadata including invalidCount and invalidKeys array', () => {
        const outcome = manager.parseKeysInput(`${VALID_KEY_A}\nbad_key_1\nbad_key_2`);
        assert.equal(outcome.validCount, 1);
        assert.equal(outcome.invalidCount, 2);
        assert.deepEqual(outcome.invalidKeys, ['bad_key_1', 'bad_key_2']);
        assert.deepEqual(outcome.keys, [VALID_KEY_A]);
      });
    });

    describe('Feature 3: Deduplication', () => {
      it('T1.F3.01: collapses duplicate identical keys into a single entry in the pool', async () => {
        const rawInput = `${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_A}`;
        const outcome = await manager.parseAndSetKeys(rawInput);

        assert.equal(outcome.validCount, 2);
        assert.equal(outcome.duplicatesRemoved, 3);
        assert.equal(manager.keys.length, 2);
        assert.deepEqual(manager.keys.map(k => k.key), [VALID_KEY_A, VALID_KEY_B]);
      });

      it('T1.F3.02: collapses duplicates even when entered with differing whitespace padding', async () => {
        const rawInput = `  ${VALID_KEY_A}  \n\t${VALID_KEY_A}\t\t\n${VALID_KEY_A}`;
        const outcome = await manager.parseAndSetKeys(rawInput);

        assert.equal(outcome.validCount, 1);
        assert.equal(outcome.duplicatesRemoved, 2);
        assert.equal(manager.keys.length, 1);
        assert.equal(manager.keys[0].key, VALID_KEY_A);
      });

      it('T1.F3.03: preserves input order for the first unique occurrence of each key', async () => {
        const rawInput = `${VALID_KEY_C}\n${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_C}\n${VALID_KEY_A}`;
        const outcome = await manager.parseAndSetKeys(rawInput);

        assert.equal(outcome.validCount, 3);
        assert.deepEqual(manager.keys.map(k => k.key), [VALID_KEY_C, VALID_KEY_A, VALID_KEY_B]);
      });

      it('T1.F3.04: reports accurate duplicatesRemoved count in parse outcome', () => {
        const outcome = manager.parseKeysInput(`${VALID_KEY_A}\n${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_B}\n${VALID_KEY_B}`);
        assert.equal(outcome.duplicatesRemoved, 3);
        assert.equal(outcome.validCount, 2);
      });
    });

    describe('Feature 4: Round-Robin Rotation', () => {
      it('T1.F4.01: sequential calls to getNextKey() cycle through healthy keys: 0 -> 1 -> 2 -> 0 -> 1', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_C}`);

        const call1 = manager.getNextKey();
        const call2 = manager.getNextKey();
        const call3 = manager.getNextKey();
        const call4 = manager.getNextKey();
        const call5 = manager.getNextKey();

        assert.equal(call1, VALID_KEY_A);
        assert.equal(call2, VALID_KEY_B);
        assert.equal(call3, VALID_KEY_C);
        assert.equal(call4, VALID_KEY_A);
        assert.equal(call5, VALID_KEY_B);
      });

      it('T1.F4.02: withKeyRotation() executes successive calls using keys in round-robin order', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_C}`);

        const usedKeys = [];
        const dummyFn = async (key) => {
          usedKeys.push(key);
          return `result_${key}`;
        };

        const r1 = await manager.withKeyRotation(dummyFn);
        const r2 = await manager.withKeyRotation(dummyFn);
        const r3 = await manager.withKeyRotation(dummyFn);
        const r4 = await manager.withKeyRotation(dummyFn);

        assert.deepEqual(usedKeys, [VALID_KEY_A, VALID_KEY_B, VALID_KEY_C, VALID_KEY_A]);
        assert.equal(r1, `result_${VALID_KEY_A}`);
        assert.equal(r2, `result_${VALID_KEY_B}`);
        assert.equal(r3, `result_${VALID_KEY_C}`);
        assert.equal(r4, `result_${VALID_KEY_A}`);
      });

      it('T1.F4.03: increments usageToday on each successful withKeyRotation execution', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

        await manager.withKeyRotation(async (key) => 'ok1');
        await manager.withKeyRotation(async (key) => 'ok2');
        await manager.withKeyRotation(async (key) => 'ok3');

        const keyA = manager.keys.find(k => k.key === VALID_KEY_A);
        const keyB = manager.keys.find(k => k.key === VALID_KEY_B);

        assert.equal(keyA.usageToday, 2, 'Key A should have processed 2 successful calls');
        assert.equal(keyB.usageToday, 1, 'Key B should have processed 1 successful call');
      });

      it('T1.F4.04: rotation index wraps around smoothly over multiple full pool iterations', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

        const results = [];
        for (let i = 0; i < 8; i++) {
          results.push(manager.getNextKey());
        }

        const expected = [
          VALID_KEY_A, VALID_KEY_B,
          VALID_KEY_A, VALID_KEY_B,
          VALID_KEY_A, VALID_KEY_B,
          VALID_KEY_A, VALID_KEY_B
        ];
        assert.deepEqual(results, expected);
      });
    });

    describe('Feature 5: Key Pool Status Reporting', () => {
      it('T1.F5.01: getStatus() accurately reports totalKeys', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_C}`);
        const status = manager.getStatus();

        assert.equal(status.totalKeys, 3);
        assert.equal(status.hasKeys, true);
      });

      it('T1.F5.02: getStatus() accurately reports healthyKeys count', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_C}`);
        let status = manager.getStatus();
        assert.equal(status.healthyKeys, 3);

        // Mark one key rate limited
        manager.markRateLimited(VALID_KEY_B, new Error('429 Quota Exceeded'));
        status = manager.getStatus();

        assert.equal(status.totalKeys, 3);
        assert.equal(status.healthyKeys, 2);
      });

      it('T1.F5.03: getStatus() reports rateLimitedCount / in-cooldown count', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_C}`);

        manager.markRateLimited(VALID_KEY_A, new Error('429 Rate limit'));
        manager.markRateLimited(VALID_KEY_C, new Error('429 Rate limit'));

        const status = manager.getStatus();
        assert.equal(status.rateLimitedCount, 2);
        assert.equal(status.healthyKeys, 1);
      });

      it('T1.F5.04: getStatus() reports allExhausted: true when every key is unavailable', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

        manager.markRateLimited(VALID_KEY_A, new Error('429 Quota'));
        manager.markRateLimited(VALID_KEY_B, new Error('429 Quota'));

        const status = manager.getStatus();
        assert.equal(status.allExhausted, true);
        assert.equal(status.healthyKeys, 0);
      });
    });

  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (B1 to B5)
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases', () => {

    describe('B1: Empty and Whitespace Handling', () => {
      it('T2.B1.01: empty string input does not throw and leaves pool empty', async () => {
        const outcome = await manager.parseAndSetKeys('');

        assert.equal(outcome.validCount, 0);
        assert.equal(manager.keys.length, 0);
        assert.equal(manager.getStatus().hasKeys, false);
      });

      it('T2.B1.02: whitespace-only input (spaces, tabs, newlines) produces zero keys without error', async () => {
        const outcome = await manager.parseAndSetKeys('   \n\t  \r\n   ');

        assert.equal(outcome.validCount, 0);
        assert.equal(outcome.invalidCount, 0);
        assert.equal(manager.keys.length, 0);
      });

      it('T2.B1.03: null and undefined inputs are handled gracefully without throwing', async () => {
        const outcomeNull = await manager.parseAndSetKeys(null);
        const outcomeUndefined = await manager.parseAndSetKeys(undefined);

        assert.equal(outcomeNull.validCount, 0);
        assert.equal(outcomeUndefined.validCount, 0);
        assert.equal(manager.keys.length, 0);
      });
    });

    describe('B2: Single Key Pool Behavior', () => {
      it('T2.B2.01: pool with a single key returns that key repeatedly without index out-of-bounds', async () => {
        await manager.parseAndSetKeys(VALID_KEY_A);

        for (let i = 0; i < 5; i++) {
          assert.equal(manager.getNextKey(), VALID_KEY_A);
        }
      });

      it('T2.B2.02: withKeyRotation() executes stably over 10 consecutive requests on single key pool', async () => {
        await manager.parseAndSetKeys(VALID_KEY_A);

        let executions = 0;
        for (let i = 0; i < 10; i++) {
          const res = await manager.withKeyRotation(async (key) => {
            assert.equal(key, VALID_KEY_A);
            executions++;
            return `res_${i}`;
          });
          assert.equal(res, `res_${i}`);
        }

        assert.equal(executions, 10);
        assert.equal(manager.keys[0].usageToday, 10);
      });

      it('T2.B2.03: single key failure marks the key unhealthy and leaves healthy count at 0', async () => {
        await manager.parseAndSetKeys(VALID_KEY_A);

        await assert.rejects(async () => {
          await manager.withKeyRotation(async () => {
            const err = new Error('429 Quota Exceeded');
            err.status = 429;
            throw err;
          });
        });

        const status = manager.getStatus();
        assert.equal(status.healthyKeys, 0);
        assert.equal(status.allExhausted, true);
        assert.equal(status.rateLimitedCount, 1);
      });
    });

    describe('B3: Immediate HTTP 429 / Quota Failover', () => {
      it('T2.B3.01: HTTP status 429 on key N immediately fails over to key N+1 without delay', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

        const attempts = [];
        const startTime = Date.now();

        const result = await manager.withKeyRotation(async (key) => {
          attempts.push(key);
          if (key === VALID_KEY_A) {
            const err = new Error('Rate limit reached');
            err.status = 429;
            throw err;
          }
          return 'ok_from_b';
        });

        const duration = Date.now() - startTime;

        assert.equal(result, 'ok_from_b');
        assert.deepEqual(attempts, [VALID_KEY_A, VALID_KEY_B]);
        assert.ok(duration < 200, `Failover should be immediate with zero backoff; took ${duration}ms`);
      });

      it('T2.B3.02: RESOURCE_EXHAUSTED error message triggers immediate failover to key N+1', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

        const attempts = [];
        const result = await manager.withKeyRotation(async (key) => {
          attempts.push(key);
          if (key === VALID_KEY_A) {
            throw new Error('GoogleGenerativeAI: [429 RESOURCE_EXHAUSTED] Quota exceeded for quota metric');
          }
          return 'rescued_by_b';
        });

        assert.equal(result, 'rescued_by_b');
        assert.deepEqual(attempts, [VALID_KEY_A, VALID_KEY_B]);
      });

      it('T2.B3.03: failing key is marked with a 60-second cooldown timestamp (cooldownUntil)', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

        const fixedNow = 1700000000000;
        Date.now = () => fixedNow;

        await manager.withKeyRotation(async (key) => {
          if (key === VALID_KEY_A) {
            const err = new Error('Quota exceeded');
            err.status = 429;
            throw err;
          }
          return 'success';
        });

        const keyA = manager.keys.find(k => k.key === VALID_KEY_A);
        assert.equal(keyA.cooldownUntil, fixedNow + 60000, 'Cooldown must be set to Date.now() + 60s');
        assert.equal(keyA.healthy, false);
      });

      it('T2.B3.04: key in cooldown is excluded from getHealthyKeys()', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_C}`);

        manager.markRateLimited(VALID_KEY_B, new Error('429 Too Many Requests'));

        const healthyKeys = manager.getHealthyKeys().map(k => k.key);
        assert.deepEqual(healthyKeys, [VALID_KEY_A, VALID_KEY_C]);
        assert.ok(!healthyKeys.includes(VALID_KEY_B));
      });

      it('T2.B3.05: failover does not execute unnecessary sleep/backoff when alternate healthy keys are available', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_C}`);

        let callCount = 0;
        const start = Date.now();

        const result = await manager.withKeyRotation(async (key) => {
          callCount++;
          if (key === VALID_KEY_A) {
            const err = new Error('429');
            err.status = 429;
            throw err;
          }
          return 'instant_result';
        });

        const elapsed = Date.now() - start;

        assert.equal(result, 'instant_result');
        assert.equal(callCount, 2);
        assert.ok(elapsed < 100, `Expected instant failover under 100ms, took ${elapsed}ms`);
      });
    });

    describe('B4: Cooldown Expiration & Recovery', () => {
      it('T2.B4.01: key in cooldown is restored to healthy status after cooldownDurationMs elapses', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

        let simulatedTime = 1700000000000;
        Date.now = () => simulatedTime;

        manager.markRateLimited(VALID_KEY_A, new Error('429 Rate limited'));
        assert.equal(manager.getHealthyKeys().length, 1);

        // Advance simulated time past 60s cooldown window
        simulatedTime += 60001;

        const healthy = manager.getHealthyKeys();
        assert.equal(healthy.length, 2, 'Key A should be restored after cooldown duration expires');
        const keyA = manager.keys.find(k => k.key === VALID_KEY_A);
        assert.equal(keyA.cooldownUntil, 0);
        assert.equal(keyA.healthy, true);
      });

      it('T2.B4.02: restored key re-enters active round-robin rotation automatically', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

        let simulatedTime = 1700000000000;
        Date.now = () => simulatedTime;

        manager.markRateLimited(VALID_KEY_A, new Error('429 Rate limited'));

        // Advance time 65 seconds
        simulatedTime += 65000;

        const call1 = manager.getNextKey();
        const call2 = manager.getNextKey();

        // Both keys should be available and cycled
        const keysObserved = new Set([call1, call2]);
        assert.ok(keysObserved.has(VALID_KEY_A), 'Restored Key A must be picked up by getNextKey()');
        assert.ok(keysObserved.has(VALID_KEY_B), 'Key B must remain accessible');
      });
    });

    describe('B5: Exhaustion & Error Cascades', () => {
      it('T2.B5.01: withKeyRotation() throws descriptive error when all keys in pool are exhausted', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

        await assert.rejects(async () => {
          await manager.withKeyRotation(async () => {
            const err = new Error('HTTP 429 Resource Exhausted');
            err.status = 429;
            throw err;
          });
        }, (err) => {
          assert.ok(/exhausted|failed/i.test(err.message), `Expected exhaustion message, got: ${err.message}`);
          return true;
        });

        assert.equal(manager.getStatus().allExhausted, true);
      });

      it('T2.B5.02: calling getNextKey() on empty pool returns null without crashing', async () => {
        await manager.parseAndSetKeys('');
        const nextKey = manager.getNextKey();
        assert.equal(nextKey, null);
      });

      it('T2.B5.03: status reports allExhausted: true when every key is in cooldown or unhealthy', async () => {
        await manager.parseAndSetKeys(`${VALID_KEY_A}`);
        manager.markRateLimited(VALID_KEY_A, new Error('429'));

        const status = manager.getStatus();
        assert.equal(status.allExhausted, true);
        assert.equal(status.healthyKeys, 0);
      });
    });

  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE INTEGRATION
  // =========================================================================
  describe('Tier 3: Cross-Feature Integration', () => {
    it('T3.X01: saving keys dispatches geminiKeysUpdated DOM CustomEvent on window', async () => {
      await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

      const updateEvents = dispatchedEvents.filter(e => e.type === 'geminiKeysUpdated');
      assert.ok(updateEvents.length >= 1, 'geminiKeysUpdated event must be dispatched on window');
    });

    it('T3.X02: geminiKeysUpdated event detail contains updated pool status object', async () => {
      let capturedDetail = null;
      globalThis.addEventListener('geminiKeysUpdated', (e) => {
        capturedDetail = e.detail;
      });

      await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_C}`);

      assert.ok(capturedDetail, 'Event listener should capture detail payload');
      assert.equal(capturedDetail.totalKeys, 3);
      assert.equal(capturedDetail.healthyKeys, 3);
      assert.equal(capturedDetail.hasKeys, true);
    });

    it('T3.X03: key updates broadcast to BroadcastChannel("gpace_gemini_keys")', async () => {
      await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

      const keyMessages = broadcastMessages.filter(m => m.channel === 'gpace_gemini_keys');
      assert.ok(keyMessages.length >= 1, 'BroadcastChannel must receive update message');
      assert.equal(keyMessages[0].data.type, 'geminiKeysUpdated');
      assert.equal(keyMessages[0].data.status.totalKeys, 2);
    });

    it('T3.X04: keys are persisted in localStorage under grind_gemini_keys_v2 and geminiApiKey', async () => {
      await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

      const storedRaw = isolatedStorage.getItem('grind_gemini_keys_v2');
      assert.ok(storedRaw, 'Storage key grind_gemini_keys_v2 must exist');

      const parsed = JSON.parse(storedRaw);
      assert.equal(parsed.keys.length, 2);
      assert.equal(parsed.keys[0].key, VALID_KEY_A);
      assert.equal(parsed.keys[1].key, VALID_KEY_B);

      // Backwards-compatible single key
      assert.equal(isolatedStorage.getItem('geminiApiKey'), VALID_KEY_A);
    });

    it('T3.X05: newly instantiated GeminiKeyManager restores keys and index from storage', async () => {
      await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_C}`);
      manager.getNextKey(); // Advance index to 1

      // Re-instantiate a fresh manager instance
      GeminiKeyManager.instance = null;
      const secondManager = new GeminiKeyManager();
      await secondManager.init();

      assert.equal(secondManager.keys.length, 3);
      assert.deepEqual(secondManager.keys.map(k => k.key), [VALID_KEY_A, VALID_KEY_B, VALID_KEY_C]);
      assert.equal(secondManager.currentIndex, 1, 'Current index should be restored from storage');
    });
  });

  // =========================================================================
  // TIER 4: REAL-WORLD SCENARIOS
  // =========================================================================
  describe('Tier 4: Real-World Scenarios', () => {

    it('T4.S01: Multi-call PDF vision ingestion with mid-stream 429 quota exhaustion', async () => {
      // Setup 3 keys simulating a student\'s configured key pool
      await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}\n${VALID_KEY_C}`);

      const executionLog = [];
      const pdfPages = ['Page 1: Syllabus', 'Page 2: Schedule', 'Page 3: Readings', 'Page 4: Exams', 'Page 5: Grading'];

      // Process 5 pages sequentially
      for (let i = 0; i < pdfPages.length; i++) {
        const pageTitle = pdfPages[i];

        const pageResult = await manager.withKeyRotation(async (apiKey) => {
          executionLog.push({ page: i + 1, key: apiKey, attempt: 'first' });

          // Simulate Key C exhausting quota on Page 3
          if (apiKey === VALID_KEY_C && i === 2) {
            const quotaErr = new Error('Resource has been exhausted (e.g. check quota).');
            quotaErr.status = 429;
            throw quotaErr;
          }

          return { page: pageTitle, processedBy: apiKey, status: 'extracted' };
        }, { label: `PDF Page ${i + 1}` });

        assert.equal(pageResult.status, 'extracted');
      }

      // Assertions on the full workload execution
      assert.equal(executionLog.length, 6, '5 successful pages + 1 failed attempt on Key C = 6 invocations');

      // Page 1 should use Key A
      assert.equal(executionLog[0].key, VALID_KEY_A);
      // Page 2 should use Key B
      assert.equal(executionLog[1].key, VALID_KEY_B);
      // Page 3 attempt 1 used Key C (failed)
      assert.equal(executionLog[2].key, VALID_KEY_C);
      // Page 3 attempt 2 failed over immediately to Key A (succeeded)
      assert.equal(executionLog[3].key, VALID_KEY_A);
      // Page 4 used Key B (succeeded)
      assert.equal(executionLog[4].key, VALID_KEY_B);
      // Page 5 used Key A (succeeded)
      assert.equal(executionLog[5].key, VALID_KEY_A);

      // Key C must now be in cooldown
      const status = manager.getStatus();
      assert.equal(status.totalKeys, 3);
      assert.equal(status.healthyKeys, 2);
      assert.equal(status.rateLimitedCount, 1);
    });

    it('T4.S02: Multi-tab synchronization and cooldown recovery cycle', async () => {
      // Tab 1 configures keys
      await manager.parseAndSetKeys(`${VALID_KEY_A}\n${VALID_KEY_B}`);

      // Simulate Tab 2 receiving broadcast and initializing
      GeminiKeyManager.instance = null;
      const tab2Manager = new GeminiKeyManager();
      await tab2Manager.init();

      assert.equal(tab2Manager.keys.length, 2);

      let simulatedTime = 1720000000000;
      Date.now = () => simulatedTime;

      // Tab 2 hits rate limit on Key A
      tab2Manager.markRateLimited(VALID_KEY_A, new Error('429 Quota Exceeded'));
      assert.equal(tab2Manager.getHealthyKeys().length, 1);

      // 30 seconds pass: Key A still in cooldown
      simulatedTime += 30000;
      assert.equal(tab2Manager.getHealthyKeys().length, 1);

      // 61 seconds pass: Key A recovers
      simulatedTime += 31000;
      const recoveredHealthy = tab2Manager.getHealthyKeys();
      assert.equal(recoveredHealthy.length, 2);
      assert.deepEqual(recoveredHealthy.map(k => k.key).sort(), [VALID_KEY_A, VALID_KEY_B].sort());

      // Subsequent call in Tab 2 successfully uses recovered key
      const nextKey = tab2Manager.getNextKey();
      assert.ok([VALID_KEY_A, VALID_KEY_B].includes(nextKey));
    });

  });

});
