'use strict';

const express = require('express');
const { createAuthMiddleware } = require('../middleware/auth');
const { createHttpError, getRequestId, sendError } = require('../middleware/errors');

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_QUERY_BYTES = 8 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_RATE_LIMIT = 20;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

function extractText(result) {
    if (typeof result === 'string') return result;
    if (!result || typeof result !== 'object') return null;
    if (typeof result.text === 'string') return result.text;
    if (typeof result.text === 'function') return result.text();
    if (result.response) return extractText(result.response);
    if (typeof result.message === 'string') return result.message;
    if (typeof result.answer === 'string') return result.answer;
    if (Array.isArray(result.candidates)) {
        const text = result.candidates.flatMap(item => item && item.content && Array.isArray(item.content.parts) ? item.content.parts : [])
            .map(part => part && part.text).filter(Boolean).join('\n');
        return text || null;
    }
    return null;
}

function validateResearchInput(body, options = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw createHttpError(400, 'INVALID_RESEARCH_INPUT', 'Research input must be an object', { expose: true });
    }
    if (typeof body.query !== 'string' || !body.query.trim()) {
        throw createHttpError(400, 'QUERY_REQUIRED', 'Query is required', { expose: true });
    }
    const maxBytes = options.maxQueryBytes || DEFAULT_MAX_QUERY_BYTES;
    if (Buffer.byteLength(body.query, 'utf8') > maxBytes) {
        throw createHttpError(400, 'QUERY_TOO_LARGE', 'Query exceeds the allowed size', { expose: true });
    }
    const modelName = body.modelName === undefined ? (options.defaultModel || 'gemini-3.8-flash') : body.modelName;
    if (typeof modelName !== 'string' || !MODEL_PATTERN.test(modelName)) {
        throw createHttpError(400, 'INVALID_MODEL', 'Model name is invalid', { expose: true });
    }
    const temperature = body.temperature === undefined ? undefined : Number(body.temperature);
    if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
        throw createHttpError(400, 'INVALID_TEMPERATURE', 'Temperature must be between 0 and 2', { expose: true });
    }
    const mode = body.mode === undefined ? 'gemini' : body.mode;
    if (!['gemini', 'tavily'].includes(mode)) {
        throw createHttpError(400, 'INVALID_PROVIDER', 'Research provider is invalid', { expose: true });
    }
    return { query: body.query.trim(), modelName, temperature, mode };
}

function upstreamError(error) {
    if (error && error.status === 429) {
        return createHttpError(429, 'UPSTREAM_RATE_LIMITED', 'The upstream provider is rate limited', { expose: true });
    }
    if (error && (error.status === 401 || error.status === 403)) {
        return createHttpError(502, 'UPSTREAM_AUTH_FAILED', 'The upstream provider rejected the request', { expose: true });
    }
    if (error && Number.isInteger(error.status) && error.status >= 500) {
        return createHttpError(502, 'UPSTREAM_FAILED', 'The upstream provider failed', { expose: true });
    }
    return createHttpError(502, 'UPSTREAM_FAILED', 'The upstream provider failed', { expose: true });
}

function runWithDeadline(operation, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const externalSignal = options.signal;
    let timer;
    let externalAbort;
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
            if (externalSignal && externalAbort) {
                externalSignal.removeEventListener('abort', externalAbort);
                externalAbort = undefined;
            }
        };
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) reject(error); else resolve(value);
        };
        const abortForClient = () => {
            controller.abort();
            finish(createHttpError(499, 'REQUEST_CANCELLED', 'Request was cancelled', { expose: true }));
        };
        const timeout = () => {
            controller.abort();
            finish(createHttpError(504, 'UPSTREAM_TIMEOUT', 'The upstream provider exceeded its time limit', { expose: true }));
        };
        if (externalSignal) {
            externalAbort = abortForClient;
            if (externalSignal.aborted) return abortForClient();
            externalSignal.addEventListener('abort', externalAbort, { once: true });
        }
        timer = setTimeout(timeout, timeoutMs);
        Promise.resolve()
            .then(() => operation(controller.signal))
            .then(value => finish(null, value), error => finish(error));
    });
}

function resolveProvider(options, uid, mode, apiKey) {
    if (typeof options.providerFactory === 'function') return options.providerFactory({ uid, mode, apiKey });
    if (mode === 'tavily') return options.tavily || options.tavilyProvider;
    return options.gemini || options.provider;
}

class ResearchGateway {
    constructor(options = {}) {
        this.options = options;
        this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
        this.maxResponseBytes = Number.isFinite(options.maxResponseBytes) ? options.maxResponseBytes : DEFAULT_MAX_RESPONSE_BYTES;
        this.maxConcurrent = Number.isInteger(options.maxConcurrent) ? options.maxConcurrent : DEFAULT_MAX_CONCURRENT;
        this.rateLimit = Number.isInteger(options.rateLimit) ? options.rateLimit : DEFAULT_RATE_LIMIT;
        this.rateWindowMs = Number.isFinite(options.rateWindowMs) ? options.rateWindowMs : DEFAULT_RATE_WINDOW_MS;
        this.active = new Map();
        this.requests = new Map();
        this.logger = typeof options.logger === 'function' ? options.logger : null;
        this.clock = options.clock || { now: () => Date.now() };
    }

    _checkLimits(uid) {
        const now = typeof this.clock.now === 'function' ? Number(this.clock.now()) : Date.now();
        const recent = (this.requests.get(uid) || []).filter(time => now - time < this.rateWindowMs);
        if (recent.length >= this.rateLimit) throw createHttpError(429, 'RATE_LIMITED', 'Too many research requests', { expose: true });
        if ((this.active.get(uid) || 0) >= this.maxConcurrent) throw createHttpError(429, 'CONCURRENCY_LIMITED', 'Too many research requests are running', { expose: true });
        recent.push(now);
        this.requests.set(uid, recent);
        this.active.set(uid, (this.active.get(uid) || 0) + 1);
    }

    _release(uid) {
        const count = (this.active.get(uid) || 1) - 1;
        if (count <= 0) this.active.delete(uid); else this.active.set(uid, count);
    }

    async execute(input = {}) {
        const uid = input.uid;
        if (typeof uid !== 'string' || !uid) throw createHttpError(401, 'AUTH_REQUIRED', 'Authentication required', { expose: true });
        const request = validateResearchInput(input.body || input, this.options);
        const suppliedKey = input.apiKey;
        if (suppliedKey && this.options.allowClientKey !== true) {
            throw createHttpError(400, 'BYOK_DISABLED', 'Client-supplied provider keys are not accepted', { expose: true });
        }
        this._checkLimits(uid);
        try {
            const value = await runWithDeadline(async signal => {
                const provider = await resolveProvider(this.options, uid, request.mode, suppliedKey);
                if (!provider) throw createHttpError(503, 'PROVIDER_UNAVAILABLE', 'Research provider is unavailable', { expose: true });
                if (typeof provider.ready === 'function') await provider.ready();
                if (signal.aborted) throw createHttpError(499, 'REQUEST_CANCELLED', 'Request was cancelled', { expose: true });
                if (request.mode === 'tavily' && typeof provider.search === 'function') {
                    return provider.search(request.query, { signal, maxResults: this.options.maxResults || 5 });
                }
                if (typeof provider.research === 'function') {
                    return provider.research({ ...request, signal });
                }
                if (typeof provider.generateContent === 'function') {
                    return provider.generateContent({
                        model: request.modelName,
                        contents: request.query,
                        config: request.temperature === undefined ? undefined : { temperature: request.temperature }
                    }, { signal });
                }
                throw createHttpError(503, 'PROVIDER_UNAVAILABLE', 'Research provider is unavailable', { expose: true });
            }, { timeoutMs: this.timeoutMs, signal: input.signal });

            const text = await extractText(value);
            if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text, 'utf8') > this.maxResponseBytes) {
                throw createHttpError(502, 'UPSTREAM_INVALID_RESPONSE', 'The upstream provider returned an invalid response', { expose: true });
            }
            const result = request.mode === 'tavily' && value && typeof value === 'object'
                ? { message: text.trim(), sources: Array.isArray(value.results) ? value.results.slice(0, this.options.maxResults || 5) : [] }
                : { message: text.trim(), sources: [] };
            if (this.logger) this.logger({ event: 'research-complete', uid, mode: request.mode, status: 200, requestId: input.requestId || null });
            return result;
        } catch (error) {
            const safeError = error && error.code && error.status ? error : upstreamError(error);
            if (this.logger) this.logger({ event: 'research-failed', uid, mode: request.mode, status: safeError.status, code: safeError.code, requestId: input.requestId || null });
            throw safeError;
        } finally {
            this._release(uid);
        }
    }
}

function createResearchRouter(options = {}) {
    const router = express.Router();
    const authenticate = typeof options.authenticate === 'function'
        ? options.authenticate
        : createAuthMiddleware(options.auth || options);
    const gateway = options.gateway || new ResearchGateway(options);

    async function handle(req, res, next, forcedMode) {
        const controller = new AbortController();
        const abort = () => { if (!controller.signal.aborted) controller.abort(); };
        req.once('aborted', abort);
        res.once('close', () => { if (!res.writableEnded) abort(); });
        try {
            const body = { ...(req.body && typeof req.body === 'object' ? req.body : {}) };
            if (forcedMode) body.mode = forcedMode;
            const key = body.apiKey || req.headers['x-gemini-key'];
            const result = await gateway.execute({
                uid: req.user.uid,
                body,
                apiKey: key,
                signal: controller.signal,
                requestId: getRequestId(req)
            });
            return res.json(result);
        } catch (error) {
            if (!res.headersSent && !req.aborted) return sendError(res, error, req);
            return undefined;
        } finally {
            req.removeListener('aborted', abort);
        }
    }

    for (const route of ['/research', '/api/research']) router.post(route, authenticate, (req, res, next) => handle(req, res, next, 'gemini'));
    for (const route of ['/tavily-search', '/api/tavily-search']) router.post(route, authenticate, (req, res, next) => handle(req, res, next, 'tavily'));
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        return sendError(res, error, req);
    });
    return router;
}

const router = createResearchRouter();
module.exports = router;
module.exports.router = router;
module.exports.ResearchGateway = ResearchGateway;
module.exports.createResearchRouter = createResearchRouter;
module.exports.extractText = extractText;
module.exports.runWithDeadline = runWithDeadline;
module.exports.validateResearchInput = validateResearchInput;
