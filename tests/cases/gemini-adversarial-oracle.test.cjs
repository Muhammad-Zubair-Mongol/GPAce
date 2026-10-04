'use strict';

/**
 * tests/cases/gemini-adversarial-oracle.test.cjs
 * 
 * EMPIRICAL ADVERSARIAL STRESS TEST SUITE & ORACLE FOR GEMINI KEY MANAGER
 * 
 * Verifies 5 Critical Stress Dimensions:
 * 1. High concurrency / rapid burst calls through withKeyRotation.
 * 2. Random 429 rate limit injections across pools of 1, 2, 5, and 10 keys.
 * 3. Cooldown timestamp expiration and recovery under simulated clock skew.
 * 4. Fuzz testing input parsing (mixed line breaks, UTF-8 whitespace, tab characters, duplicate keys, trailing commas).
 * 5. Exhaustion of all keys behavior and lifecycle recovery.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createIsolatedStorage } = require('../harness/helpers.cjs');

// Canonical valid keys (AIza prefix, base64 url-safe, 39 chars)
const KEY_1 = 'AIzaSyA_KeyOne123456789012345678901234';
const KEY_2 = 'AIzaSyB_KeyTwo123456789012345678901234';
const KEY_3 = 'AIzaSyC_KeyThree1234567890123456789012';
const KEY_4 = 'AIzaSyD_KeyFour12345678901234567890123';
const KEY_5 = 'AIzaSyE_KeyFive12345678901234567890123';
const KEY_6 = 'AIzaSyF_KeySix123456789012345678901234';
const KEY_7 = 'AIzaSyG_KeySeven1234567890123456789012';
const KEY_8 = 'AIzaSyH_KeyEight1234567890123456789012';
const KEY_9 = 'AIzaSyI_KeyNine12345678901234567890123';
const KEY_10 = 'AIzaSyJ_KeyTen123456789012345678901234';

const ALL_10_KEYS = [KEY_1, KEY_2, KEY_3, KEY_4, KEY_5, KEY_6, KEY_7, KEY_8, KEY_9, KEY_10];

describe('GeminiKeyManager Empirical Adversarial Oracle', () => {
  let isolatedStorage;
  let GeminiKeyManager;
  let manager;
  let originalDate;
  let simulatedTime;

  beforeEach(async () => {
    isolatedStorage = createIsolatedStorage();
    globalThis.localStorage = isolatedStorage;
    globalThis.window = globalThis;

    // Time base: 2026-10-01T12:00:00.000Z
    simulatedTime = 1790856000000;
    originalDate = globalThis.Date;

    class FakeDate extends originalDate {
      constructor(...args) {
        if (args.length === 0) {
          super(simulatedTime);
        } else {
          super(...args);
        }
      }
      static now() {
        return simulatedTime;
      }
    }
    globalThis.Date = FakeDate;

    // Mock BroadcastChannel
    class MockBroadcastChannel {
      constructor(name) { this.name = name; }
      postMessage() {}
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
      const handlers = listeners.get(event.type);
      if (handlers) {
        for (const handler of handlers) handler(event);
      }
      return true;
    };

    // Load fresh GeminiKeyManager module
    const keyManagerMod = await import('../../js/GeminiKeyManager.js');
    GeminiKeyManager = keyManagerMod.GeminiKeyManager;
    GeminiKeyManager.instance = null;
    manager = new GeminiKeyManager();
  });

  afterEach(() => {
    globalThis.Date = originalDate;
    if (GeminiKeyManager) {
      GeminiKeyManager.instance = null;
    }
  });

  // =========================================================================
  // SUITE 1: High Concurrency / Rapid Burst Calls
  // =========================================================================
  describe('Dimension 1: High Concurrency & Burst Stress', () => {
    it('ADV-1.1: 50 concurrent async requests across 5 keys distribute load evenly with 0 dropped calls', async () => {
      const pool = [KEY_1, KEY_2, KEY_3, KEY_4, KEY_5];
      await manager.parseAndSetKeys(pool.join('\n'));

      const keyUsageCounts = new Map(pool.map(k => [k, 0]));
      const concurrency = 50;

      // Launch 50 simultaneous calls with variable artificial async delays
      const promises = Array.from({ length: concurrency }, async (_, i) => {
        return manager.withKeyRotation(async (key) => {
          // Micro-delay between 1ms and 15ms to induce interleaved execution
          await new Promise(res => setTimeout(res, (i % 5) * 2 + 1));
          keyUsageCounts.set(key, (keyUsageCounts.get(key) || 0) + 1);
          return { id: i, usedKey: key };
        }, { label: `Burst-${i}` });
      });

      const results = await Promise.all(promises);

      assert.equal(results.length, concurrency, 'All 50 concurrent calls must complete');
      for (const r of results) {
        assert.ok(pool.includes(r.usedKey), 'Each call must return a valid key from the pool');
      }

      // Verify load distribution across all 5 keys: exactly 10 requests per key
      let totalUsage = 0;
      for (const key of pool) {
        const count = keyUsageCounts.get(key);
        totalUsage += count;
        assert.equal(count, 10, `Key ${key.slice(0, 10)} must have handled exactly 10 calls under round-robin`);
      }
      assert.equal(totalUsage, concurrency, 'Total usage count must equal 50');

      // Verify internal manager state consistency
      const status = manager.getStatus();
      assert.equal(status.usedQuota, concurrency, 'usedQuota must equal 50');
      assert.equal(status.healthyKeys, 5, 'All 5 keys must remain healthy');
    });

    it('ADV-1.2: 100 rapid sequential burst calls maintain round-robin monotonic balance and storage integrity', async () => {
      const pool = [KEY_1, KEY_2, KEY_3];
      await manager.parseAndSetKeys(pool.join('\n'));

      const callOrder = [];
      for (let i = 0; i < 100; i++) {
        await manager.withKeyRotation(async (key) => {
          callOrder.push(key);
          return i;
        });
      }

      assert.equal(callOrder.length, 100);
      for (let i = 0; i < 100; i++) {
        const expectedKey = pool[i % pool.length];
        assert.equal(callOrder[i], expectedKey, `Call ${i} must match round-robin cycle`);
      }

      // Check storage integrity
      const rawStored = isolatedStorage.getItem('grind_gemini_keys_v2');
      assert.ok(rawStored, 'Keys must be written to storage');
      const parsedStored = JSON.parse(rawStored);
      assert.equal(parsedStored.currentIndex, 100 % 3, 'currentIndex in storage must match cycle remainder');
    });

    it('ADV-1.3: 30 concurrent calls under in-flight 429 failover route cleanly without unhandled rejections', async () => {
      const pool = [KEY_1, KEY_2, KEY_3];
      await manager.parseAndSetKeys(pool.join('\n'));

      // KEY_1 consistently throws 429, forcing all calls to failover to KEY_2 or KEY_3
      const results = await Promise.all(
        Array.from({ length: 30 }, async (_, i) => {
          return manager.withKeyRotation(async (key) => {
            await new Promise(res => setTimeout(res, (i % 3) * 3 + 1));
            if (key === KEY_1) {
              const err = new Error('429 RESOURCE_EXHAUSTED: quota exceeded');
              err.status = 429;
              throw err;
            }
            return { id: i, key };
          });
        })
      );

      assert.equal(results.length, 30, 'All 30 concurrent requests must succeed despite KEY_1 429s');
      // Verify KEY_1 was placed in cooldown
      const key1Obj = manager.keys.find(k => k.key === KEY_1);
      assert.equal(key1Obj.healthy, false, 'KEY_1 must be marked unhealthy');
      assert.ok(key1Obj.cooldownUntil > simulatedTime, 'KEY_1 must have active cooldown');

      // Subsequent calls in the burst must have routed strictly to KEY_2 and KEY_3
      for (const r of results) {
        assert.ok(r.key === KEY_2 || r.key === KEY_3, 'Successful requests must only use healthy keys');
      }
    });

    it('ADV-1.4: Hot-swapping key pool via parseAndSetKeys during active concurrent requests does not crash', async () => {
      await manager.parseAndSetKeys(`${KEY_1}\n${KEY_2}`);

      // Start 20 concurrent requests
      const promises = Array.from({ length: 20 }, async (_, i) => {
        return manager.withKeyRotation(async (key) => {
          await new Promise(res => setTimeout(res, 10));
          return { id: i, key };
        });
      });

      // Mid-flight, update keys
      await new Promise(res => setTimeout(res, 2));
      await manager.parseAndSetKeys(`${KEY_3}\n${KEY_4}\n${KEY_5}`);

      const results = await Promise.all(promises);
      assert.equal(results.length, 20, 'All 20 requests must complete without crashing on hot-swap');
    });

    it('ADV-1.5: Concurrency race condition: in-flight success on already rate-limited key behavior', async () => {
      await manager.parseAndSetKeys(`${KEY_1}\n${KEY_2}`);

      // Deliberately simulate two concurrent requests sharing KEY_1:
      // Req A and Req B both receive KEY_1 before either finishes.
      // Req A finishes first with 429 -> marks KEY_1 in cooldown.
      manager.markRateLimited(KEY_1, new Error('429 Quota Exceeded'));
      const key1Obj = manager.keys.find(k => k.key === KEY_1);
      assert.equal(key1Obj.healthy, false);
      assert.ok(key1Obj.cooldownUntil > simulatedTime);

      // Now Req B (which was sent before 429) finishes with 200 OK and calls markSuccess(KEY_1):
      manager.markSuccess(KEY_1);

      // Observe actual behavior:
      // Does markSuccess override the active cooldown?
      // In current GeminiKeyManager.js lines 589-591:
      // markSuccess unconditionally sets healthy = true and cooldownUntil = 0!
      // This is a verified empirical finding regarding concurrency edge-cases.
      assert.equal(key1Obj.healthy, true, 'Empirically observes that markSuccess restores health');
      assert.equal(key1Obj.cooldownUntil, 0, 'Empirically observes that markSuccess resets cooldown to 0');
    });
  });

  // =========================================================================
  // SUITE 2: Random 429 Injections across Pools of 1, 2, 5, and 10 Keys
  // =========================================================================
  describe('Dimension 2: 429 Rate Limit Injection across Pool Sizes (1, 2, 5, 10)', () => {
    it('ADV-2.1: Pool size = 1: 429 injection retries up to allowed limit, marks cooldown, and exhausts cleanly', async () => {
      await manager.parseAndSetKeys(KEY_1);
      assert.equal(manager.keys.length, 1);

      let attempts = 0;
      await assert.rejects(
        async () => {
          await manager.withKeyRotation(async (key) => {
            attempts++;
            const err = new Error('HTTP 429 Too Many Requests');
            err.status = 429;
            throw err;
          });
        },
        (err) => {
          assert.equal(err.status, 429);
          return true;
        }
      );

      // In a 1-key pool, initialHealthy.length = 1. allowedAttempts = Math.max(1*2, 3) = 3.
      // After attempt 1, KEY_1 is marked in cooldown.
      // healthyKeys becomes empty (length 0). The while loop immediately breaks.
      assert.equal(attempts, 1, 'Single key pool must not fruitlessly loop once key is marked rate-limited');

      const status = manager.getStatus();
      assert.equal(status.healthyKeys, 0);
      assert.equal(status.allExhausted, true);
      assert.equal(status.rateLimitedCount, 1);
    });

    it('ADV-2.2: Pool size = 2: 100% 429 injection on primary fails over to secondary with zero delay', async () => {
      await manager.parseAndSetKeys(`${KEY_1}\n${KEY_2}`);

      // Run 10 calls. KEY_1 always throws 429; KEY_2 always succeeds.
      for (let i = 0; i < 10; i++) {
        const result = await manager.withKeyRotation(async (key) => {
          if (key === KEY_1) {
            const err = new Error('Quota exceeded: 429');
            err.status = 429;
            throw err;
          }
          return `success-${key}`;
        });
        assert.equal(result, `success-${KEY_2}`);
      }

      // KEY_1 must be in cooldown; KEY_2 must have absorbed all 10 calls
      const k1 = manager.keys.find(k => k.key === KEY_1);
      const k2 = manager.keys.find(k => k.key === KEY_2);
      assert.equal(k1.healthy, false);
      assert.equal(k2.healthy, true);
      assert.equal(k2.usageToday, 10);
    });

    it('ADV-2.3: Pool size = 5: Pseudo-random 429 chaos oracle fails over until all keys in cooldown', async () => {
      const pool = [KEY_1, KEY_2, KEY_3, KEY_4, KEY_5];
      await manager.parseAndSetKeys(pool.join('\n'));

      // Deterministic pseudo-random seed generator for reproducible chaos
      let seed = 42;
      const pseudoRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      // Each key has a 50% chance to fail with 429 if called
      let successfulCalls = 0;
      let totalHops = 0;

      for (let i = 0; i < 30; i++) {
        const healthyBefore = manager.getHealthyKeys().length;
        if (healthyBefore === 0) break;

        try {
          await manager.withKeyRotation(async (key) => {
            totalHops++;
            if (pseudoRandom() < 0.5) {
              const err = new Error('429 rate limit exceeded');
              err.status = 429;
              throw err;
            }
            return 'ok';
          });
          successfulCalls++;
        } catch (err) {
          // May throw when all remaining keys become rate limited in this call
          assert.ok(err.message.includes('429') || err.message.includes('No healthy') || err.message.includes('failed'));
        }
      }

      assert.ok(successfulCalls > 0, 'Must have successfully processed calls before all keys exhausted');
      assert.ok(totalHops >= successfulCalls, 'Total hops must reflect failover transitions');
    });

    it('ADV-2.4: Pool size = 10: 5 dead keys (always 429) + 5 healthy keys routes 40 requests with 100% success', async () => {
      await manager.parseAndSetKeys(ALL_10_KEYS.join('\n'));
      assert.equal(manager.keys.length, 10);

      const deadKeys = new Set([KEY_1, KEY_3, KEY_5, KEY_7, KEY_9]);
      const healthyKeys = [KEY_2, KEY_4, KEY_6, KEY_8, KEY_10];

      let successfulCalls = 0;
      for (let i = 0; i < 40; i++) {
        const result = await manager.withKeyRotation(async (key) => {
          if (deadKeys.has(key)) {
            const err = new Error('HTTP 429 rate limit');
            err.status = 429;
            throw err;
          }
          return `ok-${key}`;
        });
        assert.ok(result.startsWith('ok-'));
        successfulCalls++;
      }

      assert.equal(successfulCalls, 40, 'All 40 requests must succeed');
      const status = manager.getStatus();
      assert.equal(status.rateLimitedCount, 5, 'All 5 dead keys must be in cooldown');
      assert.equal(status.healthyKeys, 5, '5 healthy keys must remain active');

      // The 40 calls should be distributed across the 5 healthy keys
      for (const k of healthyKeys) {
        const obj = manager.keys.find(x => x.key === k);
        assert.ok(obj.usageToday >= 6 && obj.usageToday <= 10, `Key ${k} usage (${obj.usageToday}) should be evenly distributed`);
      }
    });
  });

  // =========================================================================
  // SUITE 3: Cooldown Expiration and Simulated Clock Skew
  // =========================================================================
  describe('Dimension 3: Cooldown Expiration & Simulated Clock Skew', () => {
    it('ADV-3.1: Cooldown boundary oracle: key remains unhealthy at T+59999ms and recovers precisely at T+60000ms', async () => {
      await manager.parseAndSetKeys(KEY_1);
      const keyObj = manager.keys[0];

      // Mark rate limited at T = simulatedTime
      const t0 = simulatedTime;
      manager.markRateLimited(KEY_1, new Error('429 Quota Exceeded'));

      assert.equal(keyObj.healthy, false);
      assert.equal(keyObj.cooldownUntil, t0 + 60000);
      assert.equal(manager.getHealthyKeys().length, 0);

      // Boundary 1: T + 30000ms (halfway)
      simulatedTime = t0 + 30000;
      assert.equal(manager.getHealthyKeys().length, 0, 'Must still be in cooldown at T+30s');

      // Boundary 2: T + 59999ms (1ms before expiration)
      simulatedTime = t0 + 59999;
      assert.equal(manager.getHealthyKeys().length, 0, 'Must still be in cooldown at T+59999ms');

      // Boundary 3: T + 60000ms (exact boundary)
      simulatedTime = t0 + 60000;
      const healthyKeys = manager.getHealthyKeys();
      assert.equal(healthyKeys.length, 1, 'Must recover precisely at T+60000ms');
      assert.equal(keyObj.healthy, true, 'keyObj.healthy must reset to true');
      assert.equal(keyObj.cooldownUntil, 0, 'cooldownUntil must reset to 0');
      assert.equal(keyObj.failCount, 0, 'failCount must reset to 0');
    });

    it('ADV-3.2: Forward clock skew (+15 minutes): multiple keys in cooldown recover immediately upon time leap', async () => {
      await manager.parseAndSetKeys(`${KEY_1}\n${KEY_2}\n${KEY_3}`);
      const t0 = simulatedTime;

      manager.markRateLimited(KEY_1, '429');
      manager.markRateLimited(KEY_2, '429');
      manager.markRateLimited(KEY_3, '429');

      assert.equal(manager.getHealthyKeys().length, 0);
      assert.equal(manager.getStatus().allExhausted, true);

      // Leap forward by 15 minutes (900,000ms)
      simulatedTime = t0 + 900000;

      const healthy = manager.getHealthyKeys();
      assert.equal(healthy.length, 3, 'All 3 keys must recover after forward clock leap');
      assert.equal(manager.getStatus().allExhausted, false);
      assert.equal(manager.getStatus().rateLimitedCount, 0);
    });

    it('ADV-3.3: Forward clock skew across day boundary triggers checkDailyReset, clearing quota and cooldowns', async () => {
      await manager.parseAndSetKeys(`${KEY_1}\n${KEY_2}`);
      const t0 = simulatedTime;

      // Seed usage and failure
      manager.keys[0].usageToday = 450;
      manager.keys[1].usageToday = 300;
      manager.markRateLimited(KEY_1, '429 quota reached');

      assert.equal(manager.keys[0].healthy, false);
      assert.equal(manager.getStatus().usedQuota, 750);

      // Advance clock by 25 hours (+90,000,000ms) to cross to next calendar day
      simulatedTime = t0 + 90000000;

      // checkDailyReset checks Date.toDateString() vs DAILY_RESET_KEY
      manager.checkDailyReset();

      assert.equal(manager.keys[0].usageToday, 0, 'Key 1 usageToday must be reset to 0');
      assert.equal(manager.keys[1].usageToday, 0, 'Key 2 usageToday must be reset to 0');
      assert.equal(manager.keys[0].healthy, true, 'Key 1 must be restored to healthy on new day');
      assert.equal(manager.keys[0].cooldownUntil, 0, 'Key 1 cooldownUntil must be reset to 0');
    });

    it('ADV-3.4: Backward clock skew (-10 minutes): keys in cooldown remain protected, recover once timestamp is reached', async () => {
      await manager.parseAndSetKeys(KEY_1);
      const t0 = simulatedTime;

      manager.markRateLimited(KEY_1, '429');
      const targetCooldown = t0 + 60000;
      assert.equal(manager.keys[0].cooldownUntil, targetCooldown);

      // Simulate clock step backwards by 10 minutes (-600,000ms) e.g. NTP backwards sync
      simulatedTime = t0 - 600000;

      // Key must NOT prematurely recover when clock is rolled back
      const healthyKeys = manager.getHealthyKeys();
      assert.equal(healthyKeys.length, 0, 'Key must not recover when clock is rolled backward');
      assert.equal(manager.keys[0].healthy, false);

      // Now advance clock past targetCooldown
      simulatedTime = targetCooldown + 5000;
      const recoveredKeys = manager.getHealthyKeys();
      assert.equal(recoveredKeys.length, 1, 'Key must recover once actual cooldown timestamp is reached');
      assert.equal(recoveredKeys[0].key, KEY_1);
    });
  });

  // =========================================================================
  // SUITE 4: Fuzz Testing Input Parsing
  // =========================================================================
  describe('Dimension 4: Input Parsing Fuzzing & Sanitization', () => {
    it('ADV-4.1: Mixed line breaks: arbitrary combinations of \\r\\n, \\n, and \\r parse valid keys without errors', async () => {
      const mixedInput = `${KEY_1}\r\n\r\n${KEY_2}\n\n${KEY_3}\r${KEY_4}\r\n\n\r${KEY_5}`;
      const res = manager.parseKeysInput(mixedInput);

      assert.equal(res.validCount, 5, 'Must parse exactly 5 valid keys');
      assert.equal(res.invalidCount, 0, 'Must have 0 invalid keys');
      assert.deepEqual(res.keys, [KEY_1, KEY_2, KEY_3, KEY_4, KEY_5]);
    });

    it('ADV-4.2: UTF-8 whitespace: handles \\u00A0 (NBSP), \\u2003 (em space), \\u3000 (ideographic), tabs, and form feeds', async () => {
      const utf8PaddedInput = [
        `\u00A0${KEY_1}\u00A0`,             // Non-breaking space
        `\u2003\t${KEY_2}\u2003\t`,          // Em-space + Tab
        `\u3000${KEY_3}\u3000`,             // Ideographic space (CJK)
        `\f\v${KEY_4}\v\f`,                 // Form feed + vertical tab
        `   \u2002  ${KEY_5}  \u2002   `    // En-space with regular spaces
      ].join('\n');

      const res = manager.parseKeysInput(utf8PaddedInput);
      assert.equal(res.validCount, 5, 'All UTF-8 and control-padded keys must be cleanly trimmed and valid');
      assert.equal(res.invalidCount, 0);
      assert.deepEqual(res.keys, [KEY_1, KEY_2, KEY_3, KEY_4, KEY_5]);
    });

    it('ADV-4.3: Delimiter fuzzing: leading, trailing, and consecutive commas with random whitespace parse cleanly', async () => {
      const delimiterMess = `,,,,,\n\n  ,  ${KEY_1} ,,,, \t\n ,,, ${KEY_2} ,,,, ,,, \n ${KEY_3} ,,,,,`;
      const res = manager.parseKeysInput(delimiterMess);

      assert.equal(res.validCount, 3);
      assert.equal(res.invalidCount, 0);
      assert.deepEqual(res.keys, [KEY_1, KEY_2, KEY_3]);
    });

    it('ADV-4.4: Deduplication fuzzing: repeated keys with differing surrounding whitespace collapse to 1 entry', async () => {
      const duplicateMess = [
        KEY_1,
        `  ${KEY_1}  `,
        `\t${KEY_1}\t`,
        `\n${KEY_1}\n`,
        `\u00A0${KEY_1}\u00A0`,
        KEY_2,
        `  ${KEY_2}  `,
        KEY_1
      ].join(',');

      const res = manager.parseKeysInput(duplicateMess);
      assert.equal(res.validCount, 2);
      assert.equal(res.duplicatesRemoved, 6);
      assert.deepEqual(res.keys, [KEY_1, KEY_2]);
    });

    it('ADV-4.5: Malformed garbage fuzzing: SQL, XSS, JSON, null bytes, 100k length strings, non-string types safely rejected', async () => {
      const adversarialJunk = [
        '<script>alert("pwned")</script>',
        'SELECT * FROM api_keys WHERE 1=1;',
        '{"apiKey": "AIzaSyFakeKey12345678901234567890123"}',
        'AIzaSy\x00NullByteInTheMiddleOfKey1234567890',
        'sk-proj-not-a-gemini-key-1234567890abcdef',
        'AIza' + 'X'.repeat(100000), // 100k char overflow attack
        'AIzaWithSymbols!@#$%^&*()_+~`|}{[]:;?><',
        KEY_1 // Only this 1 is valid
      ].join('\n');

      const res = manager.parseKeysInput(adversarialJunk);
      assert.equal(res.validCount, 1);
      assert.equal(res.keys[0], KEY_1);
      assert.equal(res.invalidCount, 7);

      // Non-string types must return empty result without throwing
      assert.equal(manager.parseKeysInput(null).validCount, 0);
      assert.equal(manager.parseKeysInput(undefined).validCount, 0);
      assert.equal(manager.parseKeysInput(12345).validCount, 0);
      assert.equal(manager.parseKeysInput({}).validCount, 0);
      assert.equal(manager.parseKeysInput([]).validCount, 0);
    });

    it('ADV-4.6: Key length boundary fuzzing: validates min valid length (34 chars) and max valid length (49 chars)', async () => {
      // Regex is /^AIza[0-9A-Za-z-_]{30,45}$/ -> Min length: 4 + 30 = 34; Max length: 4 + 45 = 49
      const tooShort33 = 'AIza' + 'a'.repeat(29); // 33 chars
      const minValid34 = 'AIza' + 'a'.repeat(30); // 34 chars
      const normal39 = 'AIza' + 'a'.repeat(35);   // 39 chars
      const maxValid49 = 'AIza' + 'a'.repeat(45); // 49 chars
      const tooLong50 = 'AIza' + 'a'.repeat(46);  // 50 chars

      const input = [tooShort33, minValid34, normal39, maxValid49, tooLong50].join('\n');
      const res = manager.parseKeysInput(input);

      assert.equal(res.validCount, 3);
      assert.deepEqual(res.keys, [minValid34, normal39, maxValid49]);
      assert.equal(res.invalidCount, 2);
      assert.ok(res.invalidKeys.includes(tooShort33));
      assert.ok(res.invalidKeys.includes(tooLong50));
    });
  });

  // =========================================================================
  // SUITE 5: Exhaustion of All Keys Behavior
  // =========================================================================
  describe('Dimension 5: Key Exhaustion & Lifecycle Recovery', () => {
    it('ADV-5.1: Cascade exhaustion: sequential 429s across 3 keys exhausts pool, records cooldowns, throws last error', async () => {
      const pool = [KEY_1, KEY_2, KEY_3];
      await manager.parseAndSetKeys(pool.join('\n'));

      const attemptedKeys = [];
      await assert.rejects(
        async () => {
          await manager.withKeyRotation(async (key) => {
            attemptedKeys.push(key);
            const err = new Error(`429 Quota Exhausted on ${key}`);
            err.status = 429;
            throw err;
          });
        },
        (err) => {
          assert.equal(err.status, 429);
          assert.ok(err.message.includes('429'));
          return true;
        }
      );

      // Must have tried all 3 keys in sequence
      assert.deepEqual(attemptedKeys, [KEY_1, KEY_2, KEY_3]);

      // All 3 keys must now be marked rate-limited with active cooldowns
      for (const k of pool) {
        const keyObj = manager.keys.find(x => x.key === k);
        assert.equal(keyObj.healthy, false);
        assert.ok(keyObj.cooldownUntil > simulatedTime);
        assert.ok(keyObj.lastError.includes('429'));
      }

      const status = manager.getStatus();
      assert.equal(status.healthyKeys, 0);
      assert.equal(status.allExhausted, true);
      assert.equal(status.rateLimitedCount, 3);
    });

    it('ADV-5.2: Fast-fail circuit breaker: calling withKeyRotation on pre-exhausted pool rejects with 0 downstream attempts', async () => {
      await manager.parseAndSetKeys(`${KEY_1}\n${KEY_2}`);

      // Put both in cooldown
      manager.markRateLimited(KEY_1, '429');
      manager.markRateLimited(KEY_2, '429');
      assert.equal(manager.getHealthyKeys().length, 0);

      let downstreamInvocationCount = 0;
      await assert.rejects(
        async () => {
          await manager.withKeyRotation(async () => {
            downstreamInvocationCount++;
            return 'should never run';
          });
        },
        /No healthy Gemini API keys configured/
      );

      assert.equal(downstreamInvocationCount, 0, 'Callback must never be invoked when all keys are already exhausted');
    });

    it('ADV-5.3: Status contract under exhaustion: allExhausted=true, healthyKeys=0, rateLimitedCount=totalKeys', async () => {
      await manager.parseAndSetKeys([KEY_1, KEY_2, KEY_3, KEY_4].join('\n'));

      for (const k of [KEY_1, KEY_2, KEY_3, KEY_4]) {
        manager.markRateLimited(k, '429');
      }

      const status = manager.getStatus();
      assert.equal(status.totalKeys, 4);
      assert.equal(status.healthyKeys, 0);
      assert.equal(status.rateLimitedCount, 4);
      assert.equal(status.allExhausted, true);
      assert.equal(status.hasKeys, true);
    });

    it('ADV-5.4: Full lifecycle recovery: Healthy -> Partial Fail -> Full Exhaustion -> Partial Recovery -> Full Recovery', async () => {
      const pool = [KEY_1, KEY_2, KEY_3];
      await manager.parseAndSetKeys(pool.join('\n'));
      const t0 = simulatedTime;

      // Stage 1: Healthy rotation
      let res1 = await manager.withKeyRotation(async k => `ok-${k}`);
      assert.equal(res1, `ok-${KEY_1}`);

      // Stage 2: KEY_1 and KEY_2 hit 429
      manager.markRateLimited(KEY_1, '429');
      manager.markRateLimited(KEY_2, '429');
      assert.equal(manager.getHealthyKeys().length, 1);

      // Requests route to KEY_3
      let res2 = await manager.withKeyRotation(async k => `ok-${k}`);
      assert.equal(res2, `ok-${KEY_3}`);

      // Stage 3: KEY_3 hits 429 -> Full Exhaustion
      manager.markRateLimited(KEY_3, '429');
      assert.equal(manager.getStatus().allExhausted, true);
      await assert.rejects(async () => manager.withKeyRotation(async () => {}), /No healthy/);

      // Stage 4: Advance clock +60000ms -> KEY_1 and KEY_2 recover (staggered recovery simulation)
      simulatedTime = t0 + 60001;
      // Mark KEY_3 cooldown to expire later
      const k3Obj = manager.keys.find(x => x.key === KEY_3);
      k3Obj.cooldownUntil = simulatedTime + 30000;

      let healthyPartial = manager.getHealthyKeys();
      assert.equal(healthyPartial.length, 2, 'KEY_1 and KEY_2 must have recovered');
      assert.equal(manager.getStatus().allExhausted, false);

      let res3 = await manager.withKeyRotation(async k => `ok-${k}`);
      assert.ok(res3 === `ok-${KEY_1}` || res3 === `ok-${KEY_2}`);

      // Stage 5: Advance clock past KEY_3 cooldown -> Full Recovery
      simulatedTime += 35000;
      let healthyFull = manager.getHealthyKeys();
      assert.equal(healthyFull.length, 3, 'All 3 keys must be restored to healthy pool');
      assert.equal(manager.getStatus().rateLimitedCount, 0);

      // Confirm all 3 keys participate in rotation again
      const restoredUsed = [];
      for (let i = 0; i < 3; i++) {
        await manager.withKeyRotation(async k => restoredUsed.push(k));
      }
      assert.equal(new Set(restoredUsed).size, 3, 'All 3 keys must participate in active rotation');
    });
  });
});
