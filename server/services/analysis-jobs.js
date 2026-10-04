'use strict';

const crypto = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_EVENTS = 500;

class AnalysisJobError extends Error {
    constructor(status, code, message, options = {}) {
        super(message);
        this.name = 'AnalysisJobError';
        this.status = status;
        this.code = code;
        this.publicMessage = options.publicMessage || message;
        this.cause = options.cause;
    }
}

function createAnalysisJobError(status, code, message, options) {
    return new AnalysisJobError(status, code, message, options);
}

function assertUid(uid) {
    if (typeof uid !== 'string' || !/^[A-Za-z0-9_.@-]{1,128}$/.test(uid)) {
        throw createAnalysisJobError(401, 'AUTH_REQUIRED', 'Authenticated user is required');
    }
    return uid;
}

function validateDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw createAnalysisJobError(400, 'INVALID_EVENT_DATE', 'Event date must use YYYY-MM-DD');
    }
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw createAnalysisJobError(400, 'INVALID_EVENT_DATE', 'Event date is not valid');
    }
    return value;
}

function validateTime(value) {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        throw createAnalysisJobError(400, 'INVALID_EVENT_TIME', 'Event time must use HH:mm');
    }
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
}

function validateTimezone(timezone = 'UTC') {
    if (typeof timezone !== 'string' || timezone.length < 1 || timezone.length > 64) {
        throw createAnalysisJobError(400, 'INVALID_TIMEZONE', 'A valid IANA timezone is required');
    }
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch {
        throw createAnalysisJobError(400, 'INVALID_TIMEZONE', 'A valid IANA timezone is required');
    }
    return timezone;
}

function validateEvent(event, index, timezone = 'UTC') {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw createAnalysisJobError(400, 'INVALID_EVENT', `Event ${index + 1} is invalid`);
    }
    const date = validateDate(event.date);
    const start = validateTime(event.startTime);
    const end = validateTime(event.endTime);
    const overnight = event.overnight === true;
    if (end <= start && !overnight) {
        throw createAnalysisJobError(400, 'INVALID_EVENT_RANGE', `Event ${index + 1} has an invalid time range`);
    }
    if (overnight && end + 24 * 60 - start > 24 * 60) {
        throw createAnalysisJobError(400, 'INVALID_EVENT_RANGE', `Event ${index + 1} exceeds one day`);
    }
    if (typeof event.subject !== 'string' || !event.subject.trim() || event.subject.length > 200) {
        throw createAnalysisJobError(400, 'INVALID_EVENT_SUBJECT', `Event ${index + 1} has an invalid subject`);
    }
    if (event.id !== undefined && (typeof event.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(event.id))) {
        throw createAnalysisJobError(400, 'INVALID_EVENT_ID', `Event ${index + 1} has an invalid ID`);
    }
    const type = event.type === undefined ? 'class' : event.type;
    if (!['class', 'study', 'break', 'free'].includes(type)) {
        throw createAnalysisJobError(400, 'INVALID_EVENT_TYPE', `Event ${index + 1} has an invalid type`);
    }

    const normalized = {
        ...event,
        subject: event.subject.trim(),
        type,
        date,
        timezone,
        overnight
    };
    if (event.recurring !== undefined && event.recurring !== null) {
        if (!event.recurring || typeof event.recurring !== 'object' || Array.isArray(event.recurring)) {
            throw createAnalysisJobError(400, 'INVALID_RECURRENCE', `Event ${index + 1} has invalid recurrence`);
        }
        if (event.recurring.startDate) validateDate(event.recurring.startDate);
        if (event.recurring.endDate) validateDate(event.recurring.endDate);
        normalized.recurring = { ...event.recurring };
    }
    return normalized;
}

function validateEvents(events, options = {}) {
    if (!Array.isArray(events) || events.length > (options.maxEvents || DEFAULT_MAX_EVENTS)) {
        throw createAnalysisJobError(400, 'INVALID_EVENTS', 'Timetable events must be a bounded array');
    }
    const timezone = validateTimezone(options.timezone || 'UTC');
    return events.map((event, index) => validateEvent(event, index, timezone));
}

function resolveTenantRepository(repository, uid) {
    if (!repository) return null;
    if (typeof repository.forTenant === 'function') return repository.forTenant(uid);
    if (typeof repository.forUser === 'function') return repository.forUser(uid);
    return repository;
}

async function saveTimetable(repository, uid, events) {
    const tenant = resolveTenantRepository(repository, uid);
    if (!tenant || typeof tenant.saveTimetable !== 'function') {
        throw createAnalysisJobError(503, 'TIMETABLE_STORAGE_UNAVAILABLE', 'Timetable storage is unavailable');
    }
    const result = tenant === repository
        ? await tenant.saveTimetable(uid, events)
        : await tenant.saveTimetable(events);
    if (result === false) {
        throw createAnalysisJobError(503, 'TIMETABLE_SAVE_FAILED', 'Timetable could not be saved');
    }
    return result;
}

function roomForUser(uid) {
    return `gpace:user:${uid}`;
}

function extractSocketToken(socket) {
    const auth = socket && socket.handshake && socket.handshake.auth;
    const header = socket && socket.handshake && socket.handshake.headers && socket.handshake.headers.authorization;
    const value = auth && (auth.token || auth.accessToken) || header;
    if (typeof value !== 'string') return null;
    const match = /^Bearer\s+(.+)$/i.exec(value.trim());
    return match ? match[1] : value.trim();
}

function createSocketAuthMiddleware(options = {}) {
    const verifyIdToken = options.verifyIdToken || (options.auth && options.auth.verifyIdToken);
    if (typeof verifyIdToken !== 'function') {
        throw new TypeError('Socket authorization requires verifyIdToken');
    }
    return async (socket, next) => {
        const token = extractSocketToken(socket);
        if (!token) return next(new Error('Authentication required'));
        try {
            const user = await verifyIdToken(token);
            if (!user || typeof user.uid !== 'string' || !user.uid) return next(new Error('Invalid authentication token'));
            socket.user = { ...user, uid: user.uid };
            return next();
        } catch {
            return next(new Error('Invalid authentication token'));
        }
    };
}

function configureSocketAuthorization(io, options = {}) {
    if (!io || typeof io.use !== 'function' || typeof io.on !== 'function') {
        throw new TypeError('A Socket.IO server is required');
    }
    io.use(createSocketAuthMiddleware(options));
    io.on('connection', socket => {
        const uid = socket.user && socket.user.uid;
        if (!uid) return socket.disconnect(true);
        socket.join(roomForUser(uid));
        if (typeof options.onAuthenticatedConnection === 'function') {
            options.onAuthenticatedConnection(socket, uid);
        }
    });
    return io;
}

function emitToUser(io, uid, event, payload) {
    assertUid(uid);
    if (!io || typeof io.to !== 'function') return false;
    const room = io.to(roomForUser(uid));
    if (!room || typeof room.emit !== 'function') return false;
    room.emit(event, payload);
    return true;
}

class AnalysisJobManager {
    constructor(options = {}) {
        this.uploadStore = options.uploadStore;
        this.repository = options.repository || options.repositories;
        this.workerFactory = options.workerFactory;
        this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
        this.maxConcurrent = Number.isInteger(options.maxConcurrent) ? options.maxConcurrent : DEFAULT_MAX_CONCURRENT;
        this.maxEvents = Number.isInteger(options.maxEvents) ? options.maxEvents : DEFAULT_MAX_EVENTS;
        this.clock = options.clock || { setTimeout, clearTimeout };
        this.idFactory = options.idFactory || (() => crypto.randomUUID());
        this.emit = typeof options.emit === 'function'
            ? options.emit
            : (uid, event, payload) => emitToUser(options.io, uid, event, payload);
        this.logger = typeof options.logger === 'function' ? options.logger : null;
        this.cache = options.cache || new Map();
        this.jobs = new Map();
        this.activeCount = 0;
    }

    getCached(uid) {
        assertUid(uid);
        return this.cache instanceof Map ? this.cache.get(uid) : undefined;
    }

    getStatus(jobId) {
        const job = this.jobs.get(jobId);
        return job ? { id: job.id, uid: job.uid, status: job.status } : null;
    }

    cancel(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) return false;
        job.controller.abort();
        return true;
    }

    async run(options = {}) {
        const uid = assertUid(options.uid);
        if (this.activeCount >= this.maxConcurrent) {
            throw createAnalysisJobError(429, 'ANALYSIS_CAPACITY', 'Analysis capacity is currently full');
        }
        if (typeof options.uploadId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(options.uploadId)) {
            throw createAnalysisJobError(400, 'UPLOAD_ID_REQUIRED', 'An opaque upload ID is required');
        }
        const timezone = validateTimezone(options.timezone || 'UTC');
        if (!this.uploadStore || typeof this.uploadStore.read !== 'function') {
            throw createAnalysisJobError(503, 'UPLOAD_STORAGE_UNAVAILABLE', 'Upload storage is unavailable');
        }
        if (typeof this.workerFactory !== 'function') {
            throw createAnalysisJobError(503, 'ANALYSIS_UNAVAILABLE', 'Timetable analysis is unavailable');
        }

        this.activeCount += 1;
        const jobId = this.idFactory();
        const controller = new AbortController();
        const job = { id: jobId, uid, status: 'starting', controller };
        this.jobs.set(jobId, job);
        let removeAbort = null;
        try {
            const upload = await this.uploadStore.read(uid, options.uploadId);
            if (!upload || !Buffer.isBuffer(upload.buffer)) {
                throw createAnalysisJobError(422, 'INVALID_UPLOAD', 'Owned upload content is invalid');
            }
            if (options.signal) {
                if (options.signal.aborted) controller.abort();
                else {
                    removeAbort = () => controller.abort();
                    options.signal.addEventListener('abort', removeAbort, { once: true });
                }
            }
            job.status = 'running';
            const worker = await this.workerFactory({
                jobId,
                uid,
                uploadId: options.uploadId,
                upload,
                buffer: upload.buffer,
                mimeType: upload.mime || 'application/octet-stream',
                timezone,
                signal: controller.signal
            });
            const result = await this._runWorker(worker, { job, timezone, signal: controller.signal });
            return result;
        } catch (error) {
            if (error instanceof AnalysisJobError) throw error;
            if (error && Number.isInteger(error.status) && typeof error.code === 'string') {
                throw createAnalysisJobError(
                    error.status,
                    error.code,
                    error.publicMessage || (error.status < 500 ? error.message : 'Analysis request failed')
                );
            }
            if (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) {
                throw createAnalysisJobError(499, 'ANALYSIS_CANCELLED', 'Timetable analysis was cancelled');
            }
            throw createAnalysisJobError(500, 'ANALYSIS_FAILED', 'Timetable analysis failed', { cause: error });
        } finally {
            if (removeAbort && options.signal) options.signal.removeEventListener('abort', removeAbort);
            this.jobs.delete(jobId);
            this.activeCount -= 1;
        }
    }

    async _runWorker(workerLike, context) {
        let worker = workerLike;
        if (worker && worker.worker) worker = worker.worker;
        const { job, timezone, signal } = context;
        if (!worker) throw createAnalysisJobError(502, 'ANALYSIS_WORKER_FAILED', 'Analysis worker failed to start');

        if (worker && typeof worker.then === 'function') {
            return this._commitWorkerResult(await worker, context);
        }
        if (typeof worker.on !== 'function') {
            throw createAnalysisJobError(502, 'ANALYSIS_WORKER_FAILED', 'Analysis worker failed to start');
        }

        return new Promise((resolve, reject) => {
            let settled = false;
            let settling = false;
            let timer = null;
            const listeners = [];

            const removeListeners = () => {
                for (const [event, handler] of listeners) {
                    if (typeof worker.off === 'function') worker.off(event, handler);
                    else if (typeof worker.removeListener === 'function') worker.removeListener(event, handler);
                }
                if (timer) this.clock.clearTimeout(timer);
                if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
            };
            const terminate = () => {
                if (typeof worker.terminate === 'function') {
                    try { return worker.terminate(); } catch {}
                }
                if (typeof worker.kill === 'function') {
                    try { worker.kill(); } catch {}
                }
                return undefined;
            };
            const fail = error => {
                if (settled || settling) return;
                settling = true;
                removeListeners();
                terminate();
                settled = true;
                reject(error);
            };
            const succeed = async message => {
                if (settled || settling) return;
                settling = true;
                removeListeners();
                try {
                    const value = await this._commitWorkerResult(message, context);
                    terminate();
                    settled = true;
                    resolve(value);
                } catch (error) {
                    terminate();
                    settled = true;
                    reject(error);
                }
            };
            const onMessage = message => {
                if (!message || message.success === false) {
                    return fail(createAnalysisJobError(502, 'ANALYSIS_FAILED', 'Timetable analysis failed'));
                }
                return succeed(message);
            };
            const onError = () => fail(createAnalysisJobError(502, 'ANALYSIS_WORKER_FAILED', 'Analysis worker failed'));
            const onExit = code => {
                if (settled || settling) return;
                if (code === 0) fail(createAnalysisJobError(502, 'ANALYSIS_NO_RESULT', 'Analysis worker exited without a result'));
                else fail(createAnalysisJobError(502, 'ANALYSIS_WORKER_EXITED', 'Analysis worker exited unexpectedly'));
            };
            const onAbort = () => fail(createAnalysisJobError(499, 'ANALYSIS_CANCELLED', 'Timetable analysis was cancelled'));
            const abortHandler = onAbort;

            for (const [event, handler] of [['message', onMessage], ['error', onError], ['exit', onExit]]) {
                worker.on(event, handler);
                listeners.push([event, handler]);
            }
            if (signal) {
                if (signal.aborted) return onAbort();
                signal.addEventListener('abort', abortHandler, { once: true });
            }
            timer = this.clock.setTimeout(() => fail(createAnalysisJobError(504, 'ANALYSIS_TIMEOUT', 'Timetable analysis exceeded its time limit')), this.timeoutMs);
        });
    }

    async _commitWorkerResult(message, context) {
        const { job, timezone } = context;
        const rawEvents = message && (message.calendarEvents || message.events || message.content);
        let events;
        try {
            events = validateEvents(rawEvents, { timezone, maxEvents: this.maxEvents });
        } catch (error) {
            if (error instanceof AnalysisJobError) throw error;
            throw createAnalysisJobError(502, 'ANALYSIS_INVALID_RESULT', 'Analysis returned invalid events');
        }

        try {
            await saveTimetable(this.repository, job.uid, events);
        } catch (error) {
            if (error instanceof AnalysisJobError) {
                if (error.code === 'TIMETABLE_SAVE_FAILED' || error.code === 'TIMETABLE_STORAGE_UNAVAILABLE') throw error;
            }
            throw createAnalysisJobError(503, 'TIMETABLE_SAVE_FAILED', 'Timetable could not be saved');
        }

        if (this.cache instanceof Map) this.cache.set(job.uid, events);
        this.emit(job.uid, 'timetableData', {
            type: 'timetableData',
            content: events,
            uid: job.uid,
            jobId: job.id,
            status: 'completed'
        });
        job.status = 'completed';
        if (this.logger) this.logger({ event: 'timetable-analysis-complete', uid: job.uid, jobId: job.id, count: events.length });
        return { jobId: job.id, uid: job.uid, events, status: 'completed' };
    }
}

module.exports = {
    AnalysisJobError,
    AnalysisJobManager,
    DEFAULT_MAX_CONCURRENT,
    DEFAULT_MAX_EVENTS,
    DEFAULT_TIMEOUT_MS,
    assertUid,
    configureSocketAuthorization,
    createAnalysisJobError,
    createSocketAuthMiddleware,
    emitToUser,
    roomForUser,
    validateDate,
    validateEvent,
    validateEvents,
    validateTime,
    validateTimezone
};
