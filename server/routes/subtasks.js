'use strict';

const express = require('express');
const { createAuthMiddleware } = require('../middleware/auth');
const { createHttpError, getRequestId, sendError } = require('../middleware/errors');
const { createGeminiProvider } = require('../services/gemini-provider');
const { extractText, runWithDeadline } = require('./research');

const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_TEXT_BYTES = 8 * 1024;
const DEFAULT_MAX_PROVIDER_BYTES = 64 * 1024;
const DEFAULT_MAX_SUBTASKS = 20;
const DEFAULT_MAX_SUBTASK_BYTES = 512;
const DEFAULT_MAX_IDENTITY_BYTES = 1 * 1024;
const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

function invalidInput(code, message) {
    return createHttpError(400, code, message, { expose: true });
}

function providerInvalidResponse() {
    return createHttpError(502, 'UPSTREAM_INVALID_RESPONSE', 'The upstream provider returned an invalid response', { expose: true });
}

function jsonByteLength(value) {
    let serialized;
    try {
        serialized = JSON.stringify(value);
    } catch {
        return Infinity;
    }
    return typeof serialized === 'string' ? Buffer.byteLength(serialized, 'utf8') : 0;
}

function validateSubtaskInput(body, options = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw invalidInput('INVALID_SUBTASK_INPUT', 'Subtask input must be an object');
    }

    const candidate = body.text !== undefined ? body.text : body.prompt;
    if (typeof candidate !== 'string' || !candidate.trim()) {
        throw invalidInput('TEXT_REQUIRED', 'Task text is required');
    }

    const maxTextBytes = Number.isFinite(options.maxTextBytes)
        ? options.maxTextBytes
        : DEFAULT_MAX_TEXT_BYTES;
    const text = candidate.trim();
    if (Buffer.byteLength(text, 'utf8') > maxTextBytes) {
        throw invalidInput('TEXT_TOO_LARGE', 'Task text exceeds the allowed size');
    }

    const modelName = body.modelName === undefined
        ? (options.modelName || DEFAULT_MODEL)
        : body.modelName;
    if (typeof modelName !== 'string' || !MODEL_PATTERN.test(modelName)) {
        throw invalidInput('INVALID_MODEL', 'Model name is invalid');
    }

    const identity = {};
    for (const field of ['taskId', 'taskIdentity']) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
            if (jsonByteLength(body[field]) > DEFAULT_MAX_IDENTITY_BYTES) {
                throw invalidInput('TASK_ID_TOO_LARGE', 'Task identity exceeds the allowed size');
            }
            identity[field] = body[field];
        }
    }

    return {
        text,
        modelName,
        identity,
        apiKey: typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : null
    };
}

async function resolveProvider(options, uid, apiKey) {
    if (typeof options.providerFactory === 'function') {
        return options.providerFactory({ uid, apiKey, modelName: options.modelName || DEFAULT_MODEL });
    }
    if (options.provider) return options.provider;

    return createGeminiProvider({
        uid,
        modelName: options.modelName || DEFAULT_MODEL,
        apiKey: options.apiKey || process.env.GEMINI_API_KEY
    });
}

async function callProvider(provider, request, signal) {
    if (typeof provider.generateSubtasks === 'function') {
        return provider.generateSubtasks({
            text: request.text,
            taskId: request.identity.taskId,
            taskIdentity: request.identity.taskIdentity,
            signal
        }, { signal });
    }
    if (typeof provider.generateContent === 'function') {
        return provider.generateContent({
            model: request.modelName,
            contents: request.text
        }, { signal });
    }
    if (typeof provider.generate === 'function') {
        return provider.generate(request.text, { signal });
    }
    throw createHttpError(503, 'PROVIDER_UNAVAILABLE', 'Subtask generation is unavailable', { expose: true });
}

function cleanSubtask(value) {
    if (typeof value !== 'string') throw providerInvalidResponse();
    const cleaned = value
        .replace(/^\s*(?:\d+[.)]|[-*])\s+/, '')
        .replace(/\*\*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned || Buffer.byteLength(cleaned, 'utf8') > DEFAULT_MAX_SUBTASK_BYTES) {
        throw providerInvalidResponse();
    }
    return cleaned;
}

function parseListText(text) {
    const candidate = text.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    if (!candidate) return null;

    try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.subtasks)) return parsed.subtasks;
    } catch {
        // Plain numbered or bulleted provider output is handled below.
    }

    const lines = candidate.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) return null;
    const items = lines.map(line => {
        const match = /^(?:\d+[.)]|[-*])\s+(.+)$/.exec(line);
        return match ? match[1] : null;
    });
    return items.every(Boolean) ? items : null;
}

async function parseProviderSubtasks(value, options = {}) {
    const maxProviderBytes = Number.isFinite(options.maxProviderBytes)
        ? options.maxProviderBytes
        : DEFAULT_MAX_PROVIDER_BYTES;
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > maxProviderBytes) {
        throw providerInvalidResponse();
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && jsonByteLength(value) > maxProviderBytes) {
        throw providerInvalidResponse();
    }

    let items;
    if (Array.isArray(value)) {
        items = value;
    } else if (value && typeof value === 'object' && Array.isArray(value.subtasks)) {
        items = value.subtasks;
    } else {
        const text = await extractText(value);
        if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxProviderBytes) {
            throw providerInvalidResponse();
        }
        items = parseListText(text);
    }

    if (!Array.isArray(items) || !items.length || items.length > DEFAULT_MAX_SUBTASKS) {
        throw providerInvalidResponse();
    }
    return items.map(cleanSubtask);
}

function normalizeProviderError(error) {
    if (error && error.code === 'UPSTREAM_TIMEOUT' && error.status === 504) return error;
    if (error && error.code === 'REQUEST_CANCELLED' && error.status === 499) return error;
    if (error && error.code === 'UPSTREAM_INVALID_RESPONSE' && error.status === 502) return error;
    if (error && error.code === 'PROVIDER_UNAVAILABLE' && error.status === 503) return error;
    if (error && error.status === 429) {
        return createHttpError(429, 'UPSTREAM_RATE_LIMITED', 'The upstream provider is rate limited', { expose: true });
    }
    if (error && error.status === 503) {
        return createHttpError(503, 'PROVIDER_UNAVAILABLE', 'Subtask generation is unavailable', { expose: true });
    }
    return createHttpError(502, 'UPSTREAM_FAILED', 'The upstream provider failed', { expose: true });
}

class SubtasksGateway {
    constructor(options = {}) {
        this.options = options;
        this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    }

    async execute(input = {}) {
        if (!input || typeof input.uid !== 'string' || !input.uid.trim()) {
            throw createHttpError(401, 'AUTH_REQUIRED', 'Authentication required', { expose: true });
        }

        const request = validateSubtaskInput(input.body || input, this.options);
        const suppliedKey = input.apiKey || request.apiKey;
        if (suppliedKey && this.options.allowClientKey !== true) {
            throw invalidInput('BYOK_DISABLED', 'Client-supplied provider keys are not accepted');
        }

        try {
            const result = await runWithDeadline(async signal => {
                const provider = await resolveProvider(this.options, input.uid, suppliedKey);
                if (!provider) {
                    throw createHttpError(503, 'PROVIDER_UNAVAILABLE', 'Subtask generation is unavailable', { expose: true });
                }
                if (typeof provider.ready === 'function') await provider.ready();
                if (signal.aborted) {
                    throw createHttpError(499, 'REQUEST_CANCELLED', 'Request was cancelled', { expose: true });
                }
                return callProvider(provider, request, signal);
            }, { timeoutMs: this.timeoutMs, signal: input.signal });
            const subtasks = await parseProviderSubtasks(result, this.options);
            return { subtasks, ...request.identity };
        } catch (error) {
            throw normalizeProviderError(error);
        }
    }
}

function createSubtasksRouter(options = {}) {
    const router = express.Router();
    const authenticate = typeof options.authenticate === 'function'
        ? options.authenticate
        : createAuthMiddleware(options.auth || options);
    const gateway = options.gateway || new SubtasksGateway(options);

    async function handle(req, res) {
        const controller = new AbortController();
        const abort = () => { if (!controller.signal.aborted) controller.abort(); };
        const close = () => { if (!res.writableEnded) abort(); };
        req.once('aborted', abort);
        res.once('close', close);
        try {
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const result = await gateway.execute({
                uid: req.user.uid,
                body,
                apiKey: req.headers['x-gemini-key'],
                signal: controller.signal,
                requestId: getRequestId(req)
            });
            return res.json(result);
        } catch (error) {
            if (!res.headersSent && !req.aborted) return sendError(res, error, req);
            return undefined;
        } finally {
            req.removeListener('aborted', abort);
            res.removeListener('close', close);
        }
    }

    for (const path of ['/api/generate-subtasks', '/generate-subtasks']) {
        router.post(path, authenticate, handle);
    }
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        return sendError(res, error, req);
    });
    return router;
}

const router = createSubtasksRouter();
module.exports = router;
module.exports.router = router;
module.exports.SubtasksGateway = SubtasksGateway;
module.exports.createSubtasksRouter = createSubtasksRouter;
module.exports.parseProviderSubtasks = parseProviderSubtasks;
module.exports.validateSubtaskInput = validateSubtaskInput;
