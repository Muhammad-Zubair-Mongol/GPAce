const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { EventEmitter } = require('node:events');

const { createTestServer } = require('../harness/helpers.cjs');
const { createTimetableRouter } = require('../../server/routes/timetable');
const {
    AnalysisJobManager,
    roomForUser,
    validateEvents
} = require('../../server/services/analysis-jobs');

function request(server, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(`${server.url}${path}`);
        const encoded = JSON.stringify(body);
        const req = http.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port,
            path: target.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded), ...headers }
        }, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }));
        });
        req.on('error', reject);
        req.end(encoded);
    });
}

function event(id, date = '2026-09-29') {
    return { id, subject: `Subject ${id}`, type: 'class', startTime: '09:00', endTime: '10:00', date };
}

function workerFor(mode, resultEvents) {
    const worker = new EventEmitter();
    worker.terminated = false;
    worker.terminate = () => { worker.terminated = true; };
    if (mode === 'success') setImmediate(() => worker.emit('message', { success: true, calendarEvents: resultEvents }));
    if (mode === 'failure') setImmediate(() => worker.emit('message', { success: false, error: 'provider secret should stay private' }));
    if (mode === 'silent') setImmediate(() => worker.emit('exit', 0));
    return worker;
}

function makeRepository(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        failSave: false,
        forTenant(uid) {
            return {
                async getTimetable() { return data.get(uid) || []; },
                async saveTimetable(events) {
                    if (this.failSave) throw new Error('disk write failed');
                    if (repository.failSave) throw new Error('disk write failed');
                    data.set(uid, events);
                    return true;
                }
            };
        },
        async getTimetable(uid) { return data.get(uid) || []; },
        async saveTimetable(uid, events) { data.set(uid, events); return true; }
    };
    // eslint-disable-next-line no-use-before-define
    var repository;
}

function makeManager(options = {}) {
    const repository = options.repository || {
        data: new Map([['user-a', [event('old-a')]], ['user-b', [event('old-b')]]]),
        failSave: false,
        forTenant(uid) {
            return {
                async getTimetable() { return repository.data.get(uid) || []; },
                async saveTimetable(events) {
                    if (repository.failSave) throw new Error('disk write failed');
                    repository.data.set(uid, events);
                    return true;
                }
            };
        }
    };
    const uploadStore = options.uploadStore || {
        async read(uid, uploadId) {
            if (uid === 'user-a' && (uploadId === 'upload-a' || uploadId === 'upload-timeout') || uid === 'user-b' && uploadId === 'upload-b') {
                return { uploadId, uid, mime: 'image/png', buffer: Buffer.from('image') };
            }
            const error = new Error('upload not found');
            error.status = 404;
            error.code = 'UPLOAD_NOT_FOUND';
            throw error;
        }
    };
    return { repository, uploadStore };
}

test('Step 08: failed, silent, timeout and persistence-error jobs preserve the old timetable', async () => {
    const { repository, uploadStore } = makeManager();
    const modes = new Map([['upload-a', 'failure'], ['upload-b', 'silent']]);
    const manager = new AnalysisJobManager({
        repository,
        uploadStore,
        timeoutMs: 15,
        workerFactory: async ({ uploadId }) => workerFor(modes.get(uploadId) || 'timeout', [event('new')])
    });
    await assert.rejects(() => manager.run({ uid: 'user-a', uploadId: 'upload-a' }), error => error.code === 'ANALYSIS_FAILED');
    await assert.rejects(() => manager.run({ uid: 'user-b', uploadId: 'upload-b' }), error => error.code === 'ANALYSIS_NO_RESULT');
    await assert.rejects(() => manager.run({ uid: 'user-a', uploadId: 'upload-timeout' }), error => error.code === 'ANALYSIS_TIMEOUT');
    repository.failSave = true;
    modes.set('upload-a', 'success');
    await assert.rejects(() => manager.run({ uid: 'user-a', uploadId: 'upload-a' }), error => error.code === 'TIMETABLE_SAVE_FAILED');
    assert.deepEqual(repository.data.get('user-a'), [event('old-a')]);
    assert.deepEqual(repository.data.get('user-b'), [event('old-b')]);
});

test('Step 08: route accepts only owned upload IDs and rejects a foreign upload before worker creation', async () => {
    const { repository, uploadStore } = makeManager();
    let workers = 0;
    const app = express();
    app.use(express.json());
    app.use(createTimetableRouter({
        authenticate: async (req, _res, next) => {
            req.user = { uid: 'user-a' };
            next();
        },
        repository,
        uploadStore,
        workerFactory: async () => { workers++; return workerFor('success', [event('new')]); }
    }));
    const server = await createTestServer(app);
    try {
        const response = await request(server, '/api/analyze-timetable', { imagePath: 'outside/file.png' });
        assert.equal(response.status, 400);
        assert.equal(response.body.error.code, 'UPLOAD_ID_REQUIRED');
        const foreign = await request(server, '/api/analyze-timetable', { uploadId: 'upload-b' });
        assert.equal(foreign.status, 404);
        assert.equal(workers, 0);
    } finally {
        await server.close();
    }
});

test('Step 08: per-user cache and socket output are isolated', async () => {
    const { repository, uploadStore } = makeManager();
    const emitted = [];
    const manager = new AnalysisJobManager({
        repository,
        uploadStore,
        workerFactory: async ({ uid }) => workerFor('success', [event(uid)]),
        emit: (uid, name, payload) => emitted.push({ uid, name, payload })
    });
    await manager.run({ uid: 'user-a', uploadId: 'upload-a' });
    await manager.run({ uid: 'user-b', uploadId: 'upload-b' });
    assert.equal(manager.getCached('user-a')[0].id, 'user-a');
    assert.equal(manager.getCached('user-b')[0].id, 'user-b');
    assert.deepEqual(emitted.map(item => item.uid), ['user-a', 'user-b']);
    assert.equal(emitted[0].payload.uid, 'user-a');
    assert.equal(roomForUser('user-a'), 'gpace:user:user-a');
});

test('Step 08: invalid dates, times and timezones are rejected by the event boundary', () => {
    assert.throws(() => validateEvents([event('bad', '2026-02-30')], { timezone: 'UTC' }), /date/i);
    assert.throws(() => validateEvents([{ ...event('bad'), startTime: '25:00' }], { timezone: 'UTC' }), /time/i);
    assert.throws(() => validateEvents([event('bad')], { timezone: 'Mars/Olympus' }), /timezone/i);
});

test('Step 08: cancellation terminates the worker and releases the queue slot', async () => {
    const { repository, uploadStore } = makeManager();
    let pendingWorker;
    let call = 0;
    const manager = new AnalysisJobManager({
        repository,
        uploadStore,
        maxConcurrent: 1,
        timeoutMs: 1000,
        workerFactory: async () => {
            call++;
            if (call === 1) {
                pendingWorker = workerFor('timeout', [event('never')]);
                return pendingWorker;
            }
            return workerFor('success', [event('second')]);
        }
    });
    const controller = new AbortController();
    const first = manager.run({ uid: 'user-a', uploadId: 'upload-a', signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await assert.rejects(first, error => error.code === 'ANALYSIS_CANCELLED');
    assert.equal(pendingWorker.terminated, true);
    const second = await manager.run({ uid: 'user-b', uploadId: 'upload-b' });
    assert.equal(second.events[0].id, 'second');
    assert.equal(manager.activeCount, 0);
});
