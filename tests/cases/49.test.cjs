'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const http = require('node:http');
const path = require('node:path');

const { createApp } = require('../../server/app');
const { configureSocketAuth, roomForUser } = require('../../server/socket-auth');
const { createTempDir, createTestServer } = require('../harness/helpers.cjs');

function request(server, requestPath, options = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(`${server.url}${requestPath}`);
        const body = options.body === undefined ? undefined : JSON.stringify(options.body);
        const headers = { ...(options.headers || {}) };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(body);
        }
        const req = http.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port,
            path: `${target.pathname}${target.search}`,
            method: options.method || 'GET',
            headers
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const text = buffer.toString('utf8');
                let parsed = null;
                if ((res.headers['content-type'] || '').includes('application/json') && text) {
                    parsed = JSON.parse(text);
                }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed, text, buffer });
            });
        });
        req.on('error', reject);
        if (body !== undefined) req.write(body);
        req.end();
    });
}

function authFixture() {
    return {
        verifyIdToken: async token => {
            if (token === 'a') return { uid: 'user-a' };
            if (token === 'b') return { uid: 'user-b' };
            throw new Error('invalid token');
        }
    };
}

function repositoryFixture() {
    const timetables = new Map([
        ['user-a', [{ id: 'a-event', subject: 'A', type: 'class', date: '2026-09-29', startTime: '09:00', endTime: '10:00' }]],
        ['user-b', [{ id: 'b-event', subject: 'B', type: 'class', date: '2026-09-29', startTime: '11:00', endTime: '12:00' }]]
    ]);
    const locations = new Map([
        ['user-a', [{ id: 'a-location', uid: 'user-a', uploadId: 'upload-a' }]],
        ['user-b', []]
    ]);
    return {
        timetables,
        locations,
        forTenant(uid) {
            return {
                async getTimetable() { return timetables.get(uid) || []; },
                async saveTimetable(events) { timetables.set(uid, events); return true; },
                async getLocations() { return { spaces: locations.get(uid) || [] }; },
                async saveLocation(location) {
                    const values = locations.get(uid) || [];
                    values.push(location);
                    locations.set(uid, values);
                    return true;
                }
            };
        }
    };
}

function uploadFixture() {
    return {
        async read(uid, uploadId) {
            if (uid === 'user-a' && uploadId === 'upload-a') {
                return { uid, uploadId, mime: 'image/png', buffer: Buffer.from('fixture-image') };
            }
            const error = new Error('upload not found');
            error.status = 404;
            error.code = 'UPLOAD_NOT_FOUND';
            error.publicMessage = 'Upload not found';
            throw error;
        },
        async save() { throw new Error('not used by integration fixture'); },
        async remove() {}
    };
}

async function createFixtureApp() {
    const publicDir = createTempDir('gpace-step49-public-');
    const settingsRootDir = createTempDir('gpace-step49-settings-');
    await fs.writeFile(path.join(publicDir.path, 'index.html'), '<!doctype html><title>fixture</title>');
    await fs.writeFile(path.join(publicDir.path, 'app.js'), 'window.__fixtureAsset = true;');
    const repository = repositoryFixture();
    const app = await createApp({
        auth: authFixture(),
        repositories: repository,
        uploadStore: uploadFixture(),
        settingsRootDir: settingsRootDir.path,
        publicDir: publicDir.path
    });
    return { app, repository, publicDir, settingsRootDir };
}

test('Step 49: secured APIs precede the public UI boundary and non-AI startup stays usable', async () => {
    const fixture = await createFixtureApp();
    const server = await createTestServer(fixture.app);
    try {
        const health = await request(server, '/api/health');
        assert.equal(health.status, 200);
        assert.deepEqual(health.body, { ok: true, provider: 'unconfigured' });

        const status = await request(server, '/api/status');
        assert.equal(status.status, 200);
        assert.equal(status.body.provider, 'unconfigured');
        assert.doesNotMatch(JSON.stringify(status.body), /GEMINI_API_KEY|apiKey|secret/i);

        const unknownApi = await request(server, '/api/does-not-exist', {
            headers: { Accept: 'text/html' }
        });
        assert.equal(unknownApi.status, 404);
        assert.equal(unknownApi.body.error.code, 'NOT_FOUND');
        assert.match(unknownApi.headers['content-type'], /application\/json/);

        const page = await request(server, '/', { headers: { Accept: 'text/html' } });
        assert.equal(page.status, 200);
        assert.match(page.text, /fixture/);
        assert.match(page.headers['cache-control'], /no-cache/);
        assert.equal(page.headers['x-content-type-options'], 'nosniff');

        const asset = await request(server, '/app.js');
        assert.equal(asset.status, 200);
        assert.match(asset.text, /__fixtureAsset/);
        assert.match(asset.headers['cache-control'], /immutable/);
        assert.equal(asset.headers['x-content-type-options'], 'nosniff');

        const privateSource = await request(server, '/server.js', { headers: { Accept: 'text/html' } });
        assert.equal(privateSource.status, 404);
        assert.doesNotMatch(privateSource.text, /Server running|process\.env|GEMINI_API_KEY/);
    } finally {
        await server.close();
        fixture.publicDir.cleanup();
        fixture.settingsRootDir.cleanup();
    }
});

test('Step 49: anonymous, private, and cross-user probes retain UID ownership', async () => {
    const fixture = await createFixtureApp();
    const server = await createTestServer(fixture.app);
    try {
        const anonymousTimetable = await request(server, '/api/timetable');
        assert.equal(anonymousTimetable.status, 401);
        const anonymousSubtasks = await request(server, '/api/generate-subtasks', {
            method: 'POST',
            body: { text: 'private task' }
        });
        assert.equal(anonymousSubtasks.status, 401);
        const anonymousUpload = await request(server, '/uploads/upload-a');
        assert.equal(anonymousUpload.status, 401);

        const ownerTimetable = await request(server, '/api/timetable', {
            headers: { Authorization: 'Bearer a' }
        });
        assert.equal(ownerTimetable.status, 200);
        assert.equal(ownerTimetable.body.events[0].id, 'a-event');

        const otherTimetable = await request(server, '/api/timetable', {
            headers: { Authorization: 'Bearer b' }
        });
        assert.equal(otherTimetable.status, 200);
        assert.equal(otherTimetable.body.events[0].id, 'b-event');
        assert.doesNotMatch(JSON.stringify(otherTimetable.body), /a-event/);

        const defaults = await request(server, '/settings/user-a', {
            headers: { Authorization: 'Bearer a' }
        });
        assert.equal(defaults.status, 200);
        assert.equal(defaults.body.theme, 'dark');

        const forgedSettings = await request(server, '/settings/user-b', {
            headers: { Authorization: 'Bearer a' }
        });
        assert.equal(forgedSettings.status, 403);
        assert.equal(forgedSettings.body.error.code, 'FORBIDDEN');

        const ownerLocations = await request(server, '/api/locations', {
            headers: { Authorization: 'Bearer a' }
        });
        assert.equal(ownerLocations.status, 200);
        assert.equal(ownerLocations.body.locations[0].uid, 'user-a');

        const otherLocations = await request(server, '/api/locations', {
            headers: { Authorization: 'Bearer b' }
        });
        assert.deepEqual(otherLocations.body.locations, []);

        const foreignUpload = await request(server, '/uploads/upload-a', {
            headers: { Authorization: 'Bearer b' }
        });
        assert.equal(foreignUpload.status, 404);
    } finally {
        await server.close();
        fixture.publicDir.cleanup();
        fixture.settingsRootDir.cleanup();
    }
});

test('Step 49: AI and placeholder APIs return typed JSON instead of UI fallback or false saves', async () => {
    const fixture = await createFixtureApp();
    const server = await createTestServer(fixture.app);
    try {
        const research = await request(server, '/api/research', {
            method: 'POST',
            body: { query: 'fixture query' },
            headers: { Authorization: 'Bearer a', Accept: 'text/html' }
        });
        assert.equal(research.status, 503);
        assert.equal(research.body.error.code, 'PROVIDER_UNAVAILABLE');

        const studySpace = await request(server, '/api/analyze-study-space', {
            method: 'POST',
            body: { uploadId: 'upload-a' },
            headers: { Authorization: 'Bearer a' }
        });
        assert.equal(studySpace.status, 503);
        assert.equal(studySpace.body.error.code, 'PROVIDER_UNAVAILABLE');

        const timetableAnalysis = await request(server, '/api/analyze-timetable', {
            method: 'POST',
            body: { uploadId: 'upload-a' },
            headers: { Authorization: 'Bearer a' }
        });
        assert.equal(timetableAnalysis.status, 503);
        assert.equal(timetableAnalysis.body.error.code, 'ANALYSIS_UNAVAILABLE');

        const conversion = await request(server, '/api/convert', {
            method: 'POST',
            body: { markdown: '# private' }
        });
        assert.equal(conversion.status, 401);

        for (const endpoint of ['/api/recipes', '/api/flashcards']) {
            const getResponse = await request(server, endpoint, {
                headers: { Authorization: 'Bearer a' }
            });
            assert.equal(getResponse.status, 501);
            assert.equal(getResponse.body.error.code.endsWith('_UNAVAILABLE'), true);
            assert.match(getResponse.headers['content-type'], /application\/json/);

            const response = await request(server, endpoint, {
                method: 'POST',
                body: { title: 'discarded fixture' },
                headers: { Authorization: 'Bearer a' }
            });
            assert.equal(response.status, 501);
            assert.notEqual(response.body.success, true);
            assert.match(response.headers['content-type'], /application\/json/);
        }
    } finally {
        await server.close();
        fixture.publicDir.cleanup();
        fixture.settingsRootDir.cleanup();
    }
});

test('Step 49: socket authentication assigns only the verified UID room', async () => {
    let middleware;
    let connectionHandler;
    const joined = [];
    const io = {
        use(handler) { middleware = handler; },
        on(event, handler) {
            if (event === 'connection') connectionHandler = handler;
        }
    };

    configureSocketAuth(io, {
        verifyIdToken: async token => {
            if (token === 'a') return { uid: 'user-a' };
            throw new Error('invalid token');
        }
    });

    const owner = {
        handshake: { auth: { token: 'a', room: roomForUser('user-b') }, headers: {} },
        join(room) { joined.push(room); },
        disconnect() { this.disconnected = true; }
    };
    let ownerError;
    await middleware(owner, error => { ownerError = error; });
    assert.equal(ownerError, undefined);
    assert.equal(owner.user.uid, 'user-a');
    connectionHandler(owner);
    assert.deepEqual(joined, [roomForUser('user-a')]);
    assert.equal(owner.disconnected, undefined);

    const anonymous = {
        handshake: { auth: {}, headers: {} },
        join() { throw new Error('anonymous socket must not join a room'); },
        disconnect() { this.disconnected = true; }
    };
    let anonymousError;
    await middleware(anonymous, error => { anonymousError = error; });
    assert.ok(anonymousError instanceof Error);
    assert.equal(anonymous.disconnected, undefined);
});
