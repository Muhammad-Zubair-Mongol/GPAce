'use strict';

const express = require('express');
const compression = require('compression');
const os = require('node:os');
const path = require('node:path');

const { createAuthMiddleware } = require('./middleware/auth');
const {
  createErrorMiddleware,
  createHttpError,
  notFoundMiddleware,
  sendError
} = require('./middleware/errors');
const { createPublicAssets } = require('./public-assets');
const { UploadStore } = require('./services/upload-store');
const { createUploadRouter } = require('./routes/uploads');
const { createSettingsRouter } = require('./routes/settings');
const { createConversionRouter } = require('./routes/conversion');
const { createConverter } = require('./services/converter');
const { createResearchRouter } = require('./routes/research');
const { createStudySpaceRouter } = require('./routes/study-spaces');
const { createTimetableRouter } = require('./routes/timetable');
const { createSubtasksRouter } = require('./routes/subtasks');

function unavailableUploadStore() {
  const fail = async () => {
    throw createHttpError(503, 'UPLOAD_STORAGE_UNAVAILABLE', 'Upload storage is unavailable', { expose: true });
  };
  return { save: fail, read: fail, remove: fail };
}

function resolveUploadStore(options) {
  if (options.uploadStore) return options.uploadStore;
  if (options.store) return options.store;
  const uploadRootDir = options.uploadRootDir || options.uploadsRootDir || options.uploadDir;
  if (uploadRootDir) {
    return new UploadStore({
      rootDir: uploadRootDir,
      maxBytes: options.maxUploadBytes,
      maxFiles: options.maxUploadFiles
    });
  }
  return unavailableUploadStore();
}

function resolveJobManager(options, dependencies) {
  const candidate = options.jobs || dependencies.jobs;
  return candidate && typeof candidate.run === 'function' ? candidate : undefined;
}

function registerUnavailableFeature(app, pathName, code, label) {
  const handler = (req, res) => sendError(
    res,
    createHttpError(501, code, `${label} storage is unavailable`, { expose: true }),
    req
  );
  app.get(pathName, handler);
  app.post(pathName, handler);
}

function registerSecuredRoutes(app, options, dependencies) {
  const authOptions = options.auth || {};
  const authenticate = typeof options.authenticate === 'function'
    ? options.authenticate
    : createAuthMiddleware(authOptions);
  const repository = options.repository || dependencies.repositories;
  const provider = options.provider || dependencies.provider || null;
  const uploadStore = resolveUploadStore(options);
  const settingsRootDir = options.settingsRootDir || options.settingsDir || path.join(os.tmpdir(), 'gpace-settings');
  const jobManager = resolveJobManager(options, dependencies);

  const uploadRouter = createUploadRouter({
    store: uploadStore,
    maxBytes: options.maxUploadBytes,
    maxFiles: options.maxUploadFiles,
    auth: authOptions,
    authenticate
  });
  app.use('/uploads', uploadRouter);
  app.use('/api/upload', uploadRouter);

  const settingsRouter = createSettingsRouter({
    rootDir: settingsRootDir,
    fs: options.settingsFs,
    store: options.settingsStore,
    auth: authOptions,
    authenticate
  });
  app.use('/settings', settingsRouter);
  app.use('/api/settings', settingsRouter);

  const conversionRouter = createConversionRouter({ converter: options.converter || createConverter(options.converterOptions || {}) });
  app.use('/api', (req, res, next) => {
    if (req.path === '/convert') return authenticate(req, res, next);
    return next();
  }, conversionRouter);

  app.use(createResearchRouter({
    gateway: options.researchGateway,
    provider,
    providerFactory: options.providerFactory,
    tavily: options.tavily,
    auth: authOptions,
    authenticate,
    allowClientKey: options.allowClientKey,
    timeoutMs: options.timeoutMs,
    rateLimit: options.rateLimit,
    maxConcurrent: options.maxConcurrent
  }));

  app.use(createStudySpaceRouter({
    uploadStore,
    repository,
    provider,
    providerFactory: options.providerFactory,
    auth: authOptions,
    authenticate,
    clock: dependencies.clock
  }));

  app.use(createTimetableRouter({
    jobs: jobManager,
    uploadStore,
    repository,
    workerFactory: options.workerFactory || (dependencies.jobs && dependencies.jobs.workerFactory),
    maxConcurrent: options.maxConcurrent,
    timeoutMs: options.timeoutMs,
    maxEvents: options.maxEvents,
    cache: options.cache,
    io: dependencies.io,
    emit: options.emit,
    auth: authOptions,
    authenticate
  }));

  app.use(createSubtasksRouter({
    provider,
    providerFactory: options.providerFactory,
    auth: authOptions,
    authenticate,
    allowClientKey: options.allowClientKey,
    timeoutMs: options.timeoutMs,
    maxTextBytes: options.maxTextBytes,
    maxProviderBytes: options.maxProviderBytes
  }));

  return { authenticate, repository, provider, uploadStore };
}

function registerApiNotFound(app) {
  app.use((req, res, next) => {
    const pathname = typeof req.path === 'string' ? req.path : req.url;
    if (/^\/api(?:\/|$)/.test(pathname)) {
      return sendError(res, createHttpError(404, 'NOT_FOUND', 'API route not found', { expose: true }), req);
    }
    return next();
  });
}

/**
 * Build the HTTP application without opening a listener or requiring an AI
 * provider. All external services and persistence are injected by the
 * bootstrap or by isolated tests.
 *
 * @param {Object} [options]
 * @returns {Promise<Function>} an Express application
 */
async function createApp(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('createApp options must be an object');
  }

  const dependencies = {
    repositories: options.repositories || {},
    provider: options.provider || null,
    jobs: options.jobs || {},
    auth: options.auth || null,
    clock: options.clock || { now: () => new Date() },
    io: options.io || null
  };

  if (dependencies.provider && typeof dependencies.provider.ready === 'function') {
    await dependencies.provider.ready();
  }

  const app = express();
  app.disable('x-powered-by');
  app.locals.dependencies = dependencies;

  app.use(compression());
  app.use(express.json({ limit: options.jsonLimit || '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: options.urlencodedLimit || '1mb' }));

  const converter = options.converter || createConverter(options.converterOptions || {});

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, provider: dependencies.provider ? 'configured' : 'unconfigured' });
  });
  app.get('/api/status', async (_req, res) => {
    const pandoc = await converter.checkPandoc();
    res.json({
      status: 'ok',
      provider: dependencies.provider ? 'configured' : 'unconfigured',
      server: 'GPAce',
      pandoc_available: pandoc.available,
      pandoc_version: pandoc.version
    });
  });

  app.post('/api/todoist/token', async (req, res) => {
    const clientId = options.todoistClientId || process.env.TODOIST_CLIENT_ID;
    const clientSecret = options.todoistClientSecret || process.env.TODOIST_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return sendError(res, createHttpError(503, 'TODOIST_UNCONFIGURED', 'Todoist is not configured'), req);
    }
    const code = req.body?.code;
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(code)) {
      return sendError(res, createHttpError(400, 'INVALID_CODE', 'Invalid authorization code'), req);
    }
    const origin = req.get('origin');
    const allowed = new Set([
      'https://mzm-gpace.web.app',
      'https://mzm-gpace.firebaseapp.com',
      process.env.GPACE_PUBLIC_ORIGIN
    ].filter(Boolean));
    if (/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(req.get('host') || '')) {
      allowed.add(`http://${req.get('host')}`);
    }
    if (!origin || !allowed.has(origin)) {
      return sendError(res, createHttpError(403, 'INVALID_ORIGIN', 'Invalid origin'), req);
    }
    try {
      const response = await (options.todoistFetch || fetch)('https://todoist.com/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: `${origin}/todoist-callback`
        }),
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) {
        return sendError(res, createHttpError(502, 'TODOIST_EXCHANGE_FAILED', 'Todoist authorization failed'), req);
      }
      const data = await response.json();
      if (typeof data?.access_token !== 'string' || !data.access_token) {
        return sendError(res, createHttpError(502, 'TODOIST_EXCHANGE_FAILED', 'Todoist authorization failed'), req);
      }
      res.set('Cache-Control', 'no-store');
      return res.json({ access_token: data.access_token });
    } catch {
      return sendError(res, createHttpError(502, 'TODOIST_EXCHANGE_FAILED', 'Todoist authorization failed'), req);
    }
  });

  registerSecuredRoutes(app, { ...options, converter }, dependencies);

  // These legacy surfaces have no owned persistence adapter yet. An explicit
  // 501 keeps them JSON APIs and prevents a false "saved" acknowledgement.
  registerUnavailableFeature(app, '/api/recipes', 'RECIPE_STORE_UNAVAILABLE', 'Recipe');
  registerUnavailableFeature(app, '/api/flashcards', 'FLASHCARD_STORE_UNAVAILABLE', 'Flashcard');

  if (typeof options.registerRoutes === 'function') {
    await options.registerRoutes(app, dependencies);
  }

  registerApiNotFound(app);

  // 301 permanent redirect for decommissioned tasks surfaces
  app.get(['/tasks.html', '/tasks'], (req, res) => {
    const query = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
    res.redirect(301, `/grind.html${query}`);
  });

  const publicDir = options.publicDir || options.buildDir || options.publicAssetsDir;
  if (publicDir) {
    app.get('/todoist-callback', (_req, res) => res.sendFile(path.join(publicDir, 'grind.html')));
  }
  if (options.publicAssets) {
    app.use(options.publicAssets);
  } else if (publicDir) {
    app.use(createPublicAssets({
      buildDir: publicDir,
      indexName: options.indexName,
      assetCacheControl: options.assetCacheControl,
      htmlCacheControl: options.htmlCacheControl
    }));
  }

  app.use(notFoundMiddleware);
  app.use(createErrorMiddleware({ logger: options.logger }));
  return app;
}

module.exports = {
  createApp,
  registerApiNotFound,
  registerSecuredRoutes
};
