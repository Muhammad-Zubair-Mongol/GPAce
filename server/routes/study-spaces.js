'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { createAuthMiddleware } = require('../middleware/auth');
const { createHttpError, sendError } = require('../middleware/errors');

const DEFAULT_PROMPT = 'Analyze this study space and return JSON with noiseLevel, seating, lighting, powerOutlets, and spaceType.';
const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

function providerText(result) {
    if (typeof result === 'string') return result;
    if (!result || typeof result !== 'object') return null;
    if (typeof result.text === 'string') return result.text;
    if (typeof result.text === 'function') return result.text();
    if (result.response) return providerText(result.response);
    if (Array.isArray(result.candidates)) {
        const parts = result.candidates.flatMap(candidate => candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : []);
        const text = parts.map(part => part && part.text).filter(Boolean).join('\n');
        return text || null;
    }
    return null;
}

function parseProviderAnalysisText(text) {
    if (!text || typeof text !== 'string' || text.length > 50_000) {
        throw createHttpError(502, 'PROVIDER_INVALID_RESPONSE', 'Study-space analysis response was invalid', { expose: true });
    }
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        throw createHttpError(502, 'PROVIDER_INVALID_RESPONSE', 'Study-space analysis response was invalid', { expose: true });
    }
}

function parseProviderAnalysis(result) {
    if (result && typeof result === 'object' && !Array.isArray(result) &&
        (result.noiseLevel || result.noise || result.seating || result.lighting || result.powerOutlets || result.spaceType || result.type)) {
        return result;
    }
    const text = providerText(result);
    if (text && typeof text.then === 'function') return text.then(parseProviderAnalysisText);
    return parseProviderAnalysisText(text);
}

function enumValue(value, allowed, code, label) {
    if (typeof value !== 'string') throw createHttpError(502, code, `Study-space ${label} was invalid`, { expose: true });
    const normalized = value.trim().toLowerCase();
    const match = allowed.find(item => item.toLowerCase() === normalized);
    if (!match) throw createHttpError(502, code, `Study-space ${label} was invalid`, { expose: true });
    return match;
}

function normalizePowerOutlets(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        if (/^(yes|true)$/i.test(value.trim())) return true;
        if (/^(no|false)$/i.test(value.trim())) return false;
    }
    throw createHttpError(502, 'PROVIDER_INVALID_RESPONSE', 'Study-space power-outlet data was invalid', { expose: true });
}

function validateStudySpaceAnalysis(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw createHttpError(502, 'PROVIDER_INVALID_RESPONSE', 'Study-space analysis response was invalid', { expose: true });
    }
    const noiseLevel = enumValue(input.noiseLevel || input.noise, ['quiet', 'moderate', 'noisy'], 'PROVIDER_INVALID_RESPONSE', 'noise level');
    const seating = enumValue(input.seating || input.availableSeating, ['empty', 'somewhat occupied', 'full'], 'PROVIDER_INVALID_RESPONSE', 'seating');
    const lighting = enumValue(input.lighting, ['good', 'moderate', 'poor'], 'PROVIDER_INVALID_RESPONSE', 'lighting');
    const powerOutlets = normalizePowerOutlets(input.powerOutlets ?? input.visiblePowerOutlets);
    const spaceType = input.spaceType || input.type;
    if (typeof spaceType !== 'string' || !spaceType.trim() || spaceType.length > 100) {
        throw createHttpError(502, 'PROVIDER_INVALID_RESPONSE', 'Study-space type was invalid', { expose: true });
    }
    return {
        noiseLevel,
        seating,
        lighting,
        powerOutlets,
        spaceType: spaceType.trim()
    };
}

function resolveProvider(options, uid) {
    if (typeof options.providerFactory === 'function') return options.providerFactory({ uid });
    if (options.providers && options.providers[uid]) return options.providers[uid];
    return options.provider;
}

function resolveTenant(repository, uid) {
    if (!repository) return null;
    return typeof repository.forTenant === 'function' ? repository.forTenant(uid) : repository;
}

function normalizeLocations(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.spaces)) return value.spaces;
    return [];
}

function createStudySpaceRouter(options = {}) {
    const router = express.Router();
    const authenticate = typeof options.authenticate === 'function'
        ? options.authenticate
        : createAuthMiddleware(options.auth || options);
    const uploadStore = options.uploadStore;
    const repository = options.repository || options.repositories;
    const clock = options.clock || { now: () => new Date() };

    async function analyze(req, res, next) {
        const controller = new AbortController();
        const abort = () => { if (!controller.signal.aborted) controller.abort(); };
        req.once('aborted', abort);
        res.once('close', () => { if (!res.writableEnded) abort(); });
        try {
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const uploadId = body.uploadId;
            if (typeof uploadId !== 'string' || !UPLOAD_ID_PATTERN.test(uploadId)) {
                throw createHttpError(400, 'UPLOAD_ID_REQUIRED', 'An opaque upload ID is required', { expose: true });
            }
            if (body.imagePath !== undefined) {
                throw createHttpError(400, 'UPLOAD_ID_REQUIRED', 'Use an owned upload ID', { expose: true });
            }
            if (!uploadStore || typeof uploadStore.read !== 'function') {
                throw createHttpError(503, 'UPLOAD_STORAGE_UNAVAILABLE', 'Upload storage is unavailable', { expose: true });
            }
            const upload = await uploadStore.read(req.user.uid, uploadId);
            if (!upload || !Buffer.isBuffer(upload.buffer)) {
                throw createHttpError(422, 'INVALID_UPLOAD', 'Owned upload content is invalid', { expose: true });
            }
            const provider = await resolveProvider(options, req.user.uid);
            if (!provider || typeof provider.generateContent !== 'function') {
                throw createHttpError(503, 'PROVIDER_UNAVAILABLE', 'Study-space analysis is unavailable', { expose: true });
            }
            if (typeof provider.ready === 'function') await provider.ready();
            if (controller.signal.aborted) throw createHttpError(499, 'REQUEST_CANCELLED', 'Request was cancelled', { expose: true });
            const result = await provider.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: options.prompt || DEFAULT_PROMPT },
                        { inlineData: { data: upload.buffer.toString('base64'), mimeType: upload.mime || 'application/octet-stream' } }
                    ]
                }]
            }, { signal: controller.signal });
            const analysis = validateStudySpaceAnalysis(await parseProviderAnalysis(await result));

            const tenant = resolveTenant(repository, req.user.uid);
            if (!tenant || typeof tenant.saveLocation !== 'function') {
                throw createHttpError(503, 'LOCATION_STORAGE_UNAVAILABLE', 'Location storage is unavailable', { expose: true });
            }
            const location = {
                id: crypto.randomUUID(),
                uid: req.user.uid,
                uploadId,
                analysis,
                createdAt: new Date(typeof clock.now === 'function' ? clock.now() : Date.now()).toISOString()
            };
            const saved = typeof repository.forTenant === 'function'
                ? await tenant.saveLocation(location)
                : await repository.saveLocation(req.user.uid, location);
            if (saved === false) throw createHttpError(503, 'LOCATION_SAVE_FAILED', 'Study-space result could not be saved', { expose: true });
            return res.status(201).json({ success: true, saved: true, location, analysis });
        } catch (error) {
            if (error && Number.isInteger(error.status) && error.status >= 500 && error.code && error.code !== 'PROVIDER_INVALID_RESPONSE') {
                // Persistence/provider internals are intentionally reduced to a typed public error.
                if (error.code === 'EACCES' || error.code === 'EPERM') {
                    return sendError(res, createHttpError(503, 'LOCATION_SAVE_FAILED', 'Study-space result could not be saved', { expose: true }), req);
                }
            }
            if (!res.headersSent && !req.aborted) return sendError(res, error, req);
            return undefined;
        } finally {
            req.removeListener('aborted', abort);
        }
    }

    async function list(req, res, next) {
        try {
            const tenant = resolveTenant(repository, req.user.uid);
            if (!tenant || typeof tenant.getLocations !== 'function') throw createHttpError(503, 'LOCATION_STORAGE_UNAVAILABLE', 'Location storage is unavailable', { expose: true });
            const locations = typeof repository.forTenant === 'function'
                ? await tenant.getLocations()
                : await repository.getLocations(req.user.uid);
            return res.json({ locations: normalizeLocations(locations) });
        } catch (error) {
            return next(error);
        }
    }

    async function readOne(req, res, next) {
        try {
            const tenant = resolveTenant(repository, req.user.uid);
            if (!tenant || typeof tenant.getLocations !== 'function') throw createHttpError(503, 'LOCATION_STORAGE_UNAVAILABLE', 'Location storage is unavailable', { expose: true });
            const locations = normalizeLocations(typeof repository.forTenant === 'function' ? await tenant.getLocations() : await repository.getLocations(req.user.uid));
            const location = locations.find(item => item && item.id === req.params.locationId);
            if (!location) throw createHttpError(404, 'LOCATION_NOT_FOUND', 'Location not found', { expose: true });
            return res.json({ location });
        } catch (error) {
            return next(error);
        }
    }

    for (const route of ['/analyze-study-space', '/api/analyze-study-space']) router.post(route, authenticate, analyze);
    for (const route of ['/locations', '/api/locations']) router.get(route, authenticate, list);
    for (const route of ['/locations/:locationId', '/api/locations/:locationId']) router.get(route, authenticate, readOne);
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        return sendError(res, error, req);
    });
    return router;
}

const router = createStudySpaceRouter();
module.exports = router;
module.exports.router = router;
module.exports.createStudySpaceRouter = createStudySpaceRouter;
module.exports.parseProviderAnalysis = parseProviderAnalysis;
module.exports.validateStudySpaceAnalysis = validateStudySpaceAnalysis;
