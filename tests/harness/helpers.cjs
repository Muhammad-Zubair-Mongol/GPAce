/**
 * Isolated deterministic verification harness helpers for GPAce.
 * Provides fake clocks, isolated storage, temp roots, provider mocks,
 * network guards, and disposable browser/server environments.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const EventEmitter = require('node:events');

const activeResources = {
  tempDirs: new Set(),
  servers: new Set(),
  cleanups: new Set()
};

// Ensure all resources are closed on process exit
process.on('exit', () => {
  cleanupAllSync();
});

function cleanupAllSync() {
  for (const s of activeResources.servers) {
    try {
      if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
      s.close();
    } catch {}
  }
  activeResources.servers.clear();

  for (const dir of activeResources.tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  activeResources.tempDirs.clear();

  for (const fn of activeResources.cleanups) {
    try { fn(); } catch {}
  }
  activeResources.cleanups.clear();
}

async function cleanupAll() {
  cleanupAllSync();
}

/**
 * Creates an isolated temporary directory.
 */
function createTempDir(prefix = 'gpace-test-') {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  activeResources.tempDirs.add(dirPath);

  const cleanup = () => {
    activeResources.tempDirs.delete(dirPath);
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch {}
  };

  return {
    path: dirPath,
    cleanup
  };
}

/**
 * Isolated in-memory Web Storage (localStorage / sessionStorage) implementation.
 */
function createIsolatedStorage(options = {}) {
  const store = new Map();
  const emitter = new EventEmitter();
  const quotaLimit = options.quotaLimit || Infinity;

  const storage = {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      const k = String(key);
      const v = String(value);
      let currentSize = 0;
      for (const [keyItem, valItem] of store.entries()) {
        if (keyItem !== k) {
          currentSize += keyItem.length + valItem.length;
        }
      }
      if (currentSize + k.length + v.length > quotaLimit) {
        const error = new Error('QuotaExceededError: Setting the value of \'' + k + '\' exceeded the quota.');
        error.name = 'QuotaExceededError';
        error.code = 22;
        throw error;
      }
      const oldValue = store.get(k) || null;
      store.set(k, v);
      emitter.emit('storage', { key: k, oldValue, newValue: v });
    },
    removeItem(key) {
      const k = String(key);
      if (store.has(k)) {
        const oldValue = store.get(k);
        store.delete(k);
        emitter.emit('storage', { key: k, oldValue, newValue: null });
      }
    },
    clear() {
      store.clear();
      emitter.emit('storage', { key: null, oldValue: null, newValue: null });
    },
    key(index) {
      const keys = Array.from(store.keys());
      return keys[index] !== undefined ? keys[index] : null;
    },
    get length() {
      return store.size;
    },
    // Helper inspection methods
    dump() {
      return Object.fromEntries(store.entries());
    },
    load(obj) {
      store.clear();
      for (const [k, v] of Object.entries(obj)) {
        store.set(String(k), String(v));
      }
    },
    subscribe(fn) {
      emitter.on('storage', fn);
      return () => emitter.off('storage', fn);
    }
  };

  return storage;
}

/**
 * Deterministic fake clock.
 */
function createFakeClock(initialTime = new Date('2026-09-27T12:00:00.000Z')) {
  let currentTime = new Date(initialTime).getTime();
  const scheduled = [];
  let timerId = 1;

  const clock = {
    now() {
      return currentTime;
    },
    Date: class FakeDate extends Date {
      constructor(...args) {
        if (args.length === 0) {
          super(currentTime);
        } else {
          super(...args);
        }
      }
      static now() {
        return currentTime;
      }
    },
    tick(ms) {
      currentTime += ms;
      // Settle any expired timers
      const ready = scheduled.filter(t => t.time <= currentTime);
      for (const t of ready) {
        const idx = scheduled.indexOf(t);
        if (idx !== -1) scheduled.splice(idx, 1);
        try {
          t.callback(...t.args);
        } catch (err) {
          console.error('FakeClock timer error:', err);
        }
      }
    },
    setTime(target) {
      currentTime = new Date(target).getTime();
    },
    setTimeout(callback, delay = 0, ...args) {
      const id = timerId++;
      scheduled.push({ id, time: currentTime + delay, callback, args });
      return id;
    },
    clearTimeout(id) {
      const idx = scheduled.findIndex(t => t.id === id);
      if (idx !== -1) scheduled.splice(idx, 1);
    }
  };

  return clock;
}

/**
 * Mock provider for AI (Gemini, Tavily, etc.)
 */
function createProviderMock(config = {}) {
  const calls = [];
  let defaultResponse = config.defaultResponse || { text: 'mock AI response' };
  let status = config.status || 200;
  let errorToThrow = null;

  return {
    async generateContent(params) {
      calls.push({ type: 'generateContent', params, time: Date.now() });
      if (errorToThrow) throw errorToThrow;
      if (status >= 400) {
        const err = new Error(`Provider returned HTTP ${status}`);
        err.status = status;
        throw err;
      }
      return typeof defaultResponse === 'function' ? defaultResponse(params) : defaultResponse;
    },
    async search(query, options) {
      calls.push({ type: 'search', query, options, time: Date.now() });
      if (errorToThrow) throw errorToThrow;
      return typeof defaultResponse === 'function' ? defaultResponse({ query, options }) : defaultResponse;
    },
    setResponse(resp) {
      defaultResponse = resp;
    },
    setStatus(s) {
      status = s;
    },
    setError(err) {
      errorToThrow = err;
    },
    getCalls() {
      return [...calls];
    },
    clearCalls() {
      calls.length = 0;
    }
  };
}

/**
 * Network guard to ensure isolated tests do not make unintended external requests.
 */
function installNetworkGuard(options = {}) {
  const allowedHosts = new Set(options.allowedHosts || ['localhost', '127.0.0.1', '::1']);
  const blockedRequests = [];

  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  const originalFetch = globalThis.fetch;

  function isHostAllowed(host) {
    if (!host) return false;
    const cleanHost = host.split(':')[0].toLowerCase();
    return allowedHosts.has(cleanHost);
  }

  function checkAndBlock(host, fullUrl) {
    if (!isHostAllowed(host)) {
      const err = new Error(`[NetworkGuard] Blocked unexpected outgoing request to: ${host} (${fullUrl}) in isolated test harness`);
      blockedRequests.push({ host, fullUrl, time: Date.now() });
      throw err;
    }
  }

  // Patch http.request
  http.request = function (optionsArg, callback) {
    let host = 'localhost';
    let fullUrl = '';
    if (typeof optionsArg === 'string') {
      try {
        const u = new URL(optionsArg);
        host = u.hostname;
        fullUrl = optionsArg;
      } catch {
        host = optionsArg;
        fullUrl = optionsArg;
      }
    } else if (optionsArg && typeof optionsArg === 'object') {
      host = optionsArg.hostname || optionsArg.host || 'localhost';
      fullUrl = `${optionsArg.protocol || 'http:'}//${host}${optionsArg.path || '/'}`;
    }
    checkAndBlock(host, fullUrl);
    return originalHttpRequest.call(http, optionsArg, callback);
  };

  // Patch https.request
  https.request = function (optionsArg, callback) {
    let host = 'localhost';
    let fullUrl = '';
    if (typeof optionsArg === 'string') {
      try {
        const u = new URL(optionsArg);
        host = u.hostname;
        fullUrl = optionsArg;
      } catch {
        host = optionsArg;
        fullUrl = optionsArg;
      }
    } else if (optionsArg && typeof optionsArg === 'object') {
      host = optionsArg.hostname || optionsArg.host || 'localhost';
      fullUrl = `${optionsArg.protocol || 'https:'}//${host}${optionsArg.path || '/'}`;
    }
    checkAndBlock(host, fullUrl);
    return originalHttpsRequest.call(https, optionsArg, callback);
  };

  // Patch globalThis.fetch
  if (typeof originalFetch === 'function') {
    globalThis.fetch = async function (resource, init) {
      let host = 'localhost';
      let fullUrl = '';
      if (typeof resource === 'string') {
        try {
          const u = new URL(resource);
          host = u.hostname;
          fullUrl = resource;
        } catch {
          host = resource;
          fullUrl = resource;
        }
      } else if (resource && resource.url) {
        try {
          const u = new URL(resource.url);
          host = u.hostname;
          fullUrl = resource.url;
        } catch {
          host = resource.url;
          fullUrl = resource.url;
        }
      }
      checkAndBlock(host, fullUrl);
      return originalFetch.call(globalThis, resource, init);
    };
  }

  const originalHttpGet = http.get;
  const originalHttpsGet = https.get;

  // Patch http.get
  http.get = function (...args) {
    const req = http.request(...args);
    req.end();
    return req;
  };

  // Patch https.get
  https.get = function (...args) {
    const req = https.request(...args);
    req.end();
    return req;
  };

  const uninstall = () => {
    http.request = originalHttpRequest;
    http.get = originalHttpGet;
    https.request = originalHttpsRequest;
    https.get = originalHttpsGet;
    if (typeof originalFetch === 'function') {
      globalThis.fetch = originalFetch;
    }
    activeResources.cleanups.delete(uninstall);
  };

  activeResources.cleanups.add(uninstall);

  return {
    uninstall,
    getBlockedRequests() {
      return [...blockedRequests];
    },
    allowHost(h) {
      allowedHosts.add(h.toLowerCase());
    }
  };
}

/**
 * Creates an ephemeral local HTTP test server on 127.0.0.1.
 */
function createTestServer(appOrHandler, options = {}) {
  const connections = new Set();
  const server = http.createServer(appOrHandler);

  server.on('connection', (conn) => {
    connections.add(conn);
    conn.on('close', () => connections.delete(conn));
  });

  activeResources.servers.add(server);

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr.port;
      const host = '127.0.0.1';
      const url = `http://${host}:${port}`;

      const close = () => {
        return new Promise((doneClose) => {
          activeResources.servers.delete(server);
          for (const conn of connections) {
            try { conn.destroy(); } catch {}
          }
          connections.clear();
          server.close(() => doneClose());
        });
      };

      resolve({
        server,
        port,
        host,
        url,
        close
      });
    });
    server.on('error', reject);
  });
}

/**
 * Creates disposable browser profile directories and options.
 */
function createDisposableBrowserProfile() {
  const tempDir = createTempDir('gpace-browser-');
  return {
    userDataDir: tempDir.path,
    cleanup: tempDir.cleanup
  };
}

/**
 * Helper to create mock authenticated user identity.
 */
function createMockAuth(uid = 'test-user-1', claims = {}) {
  const user = {
    uid,
    email: `${uid}@example.com`,
    email_verified: true,
    ...claims
  };
  const token = `mock-bearer-token-${uid}`;
  const authHeader = `Bearer ${token}`;

  return {
    user,
    token,
    authHeader
  };
}

module.exports = {
  createTempDir,
  createIsolatedStorage,
  createFakeClock,
  createProviderMock,
  installNetworkGuard,
  createTestServer,
  createDisposableBrowserProfile,
  createMockAuth,
  cleanupAll,
  cleanupAllSync
};
