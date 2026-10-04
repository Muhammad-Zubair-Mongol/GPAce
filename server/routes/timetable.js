'use strict';

const express = require('express');
const { createAuthMiddleware } = require('../middleware/auth');
const { createHttpError, sendError } = require('../middleware/errors');
const {
    AnalysisJobManager,
    validateEvents,
    validateTimezone
} = require('../services/analysis-jobs');

function createTimetableRouter(options = {}) {
    const router = express.Router();
    const authenticate = typeof options.authenticate === 'function'
        ? options.authenticate
        : createAuthMiddleware(options.auth || options);
    const manager = options.jobs || new AnalysisJobManager({
        uploadStore: options.uploadStore,
        repository: options.repository || options.repositories,
        workerFactory: options.workerFactory,
        timeoutMs: options.timeoutMs,
        maxConcurrent: options.maxConcurrent,
        maxEvents: options.maxEvents,
        cache: options.cache,
        io: options.io,
        emit: options.emit,
        logger: options.logger
    });

    async function analyze(req, res, next) {
        const controller = new AbortController();
        const abort = () => { if (!controller.signal.aborted) controller.abort(); };
        const close = () => { if (!res.writableEnded) abort(); };
        req.once('aborted', abort);
        res.once('close', close);
        try {
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            if (typeof body.uploadId !== 'string' || !body.uploadId.trim()) {
                throw createHttpError(400, 'UPLOAD_ID_REQUIRED', 'An opaque upload ID is required', { expose: true });
            }
            if (body.imagePath !== undefined) {
                throw createHttpError(400, 'UPLOAD_ID_REQUIRED', 'Use an owned upload ID', { expose: true });
            }
            const timezone = validateTimezone(body.timezone || 'UTC');
            const result = await manager.run({
                uid: req.user.uid,
                uploadId: body.uploadId,
                timezone,
                signal: controller.signal
            });
            return res.json({
                success: true,
                jobId: result.jobId,
                events: result.events,
                timezone,
                status: result.status
            });
        } catch (error) {
            return next(error);
        } finally {
            req.removeListener('aborted', abort);
            res.removeListener('close', close);
        }
    }

    async function save(req, res, next) {
        try {
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const events = validateEvents(body.events, { timezone: body.timezone || 'UTC' });
            const repository = options.repository || options.repositories;
            if (!repository) throw createHttpError(503, 'TIMETABLE_STORAGE_UNAVAILABLE', 'Timetable storage is unavailable', { expose: true });
            const tenant = typeof repository.forTenant === 'function' ? repository.forTenant(req.user.uid) : repository;
            const saved = typeof repository.forTenant === 'function'
                ? await tenant.saveTimetable(events)
                : await repository.saveTimetable(req.user.uid, events);
            if (saved === false) throw createHttpError(503, 'TIMETABLE_SAVE_FAILED', 'Timetable could not be saved', { expose: true });
            if (typeof options.emit === 'function') options.emit(req.user.uid, 'timetableData', { type: 'timetableData', content: events, uid: req.user.uid });
            return res.json({ success: true, events, timezone: body.timezone || 'UTC' });
        } catch (error) {
            return next(error);
        }
    }

    async function read(req, res, next) {
        try {
            const repository = options.repository || options.repositories;
            if (!repository) throw createHttpError(503, 'TIMETABLE_STORAGE_UNAVAILABLE', 'Timetable storage is unavailable', { expose: true });
            const tenant = typeof repository.forTenant === 'function' ? repository.forTenant(req.user.uid) : repository;
            const events = typeof repository.forTenant === 'function'
                ? await tenant.getTimetable()
                : await repository.getTimetable(req.user.uid);
            return res.json({ events: Array.isArray(events) ? events : [] });
        } catch (error) {
            return next(error);
        }
    }

    for (const route of ['/analyze-timetable', '/api/analyze-timetable']) router.post(route, authenticate, analyze);
    for (const route of ['/save-timetable', '/api/save-timetable']) router.post(route, authenticate, save);
    for (const route of ['/timetable', '/api/timetable']) router.get(route, authenticate, read);

    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        return sendError(res, error, req);
    });
    return router;
}

const router = createTimetableRouter({ workerFactory: null });
module.exports = router;
module.exports.router = router;
module.exports.createTimetableRouter = createTimetableRouter;
