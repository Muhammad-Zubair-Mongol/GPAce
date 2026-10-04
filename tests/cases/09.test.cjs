const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const { createTestServer } = require('../harness/helpers.cjs');
const { createStudySpaceRouter } = require('../../server/routes/study-spaces');
const { createAuthMiddleware } = require('../../server/middleware/auth');

function request(server, method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(`${server.url}${path}`);
        const encoded = body === undefined ? '' : JSON.stringify(body);
        const req = http.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port,
            path: target.pathname,
            method,
            headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) }), ...headers }
        }, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
        });
        req.on('error', reject);
        req.end(encoded);
    });
}

function setup(provider) {
    const locations = new Map();
    const repository = {
        failSave: false,
        forTenant(uid) {
            return {
                async saveLocation(location) {
                    if (repository.failSave) throw new Error('EACCES C:\\private\\locations.json');
                    const values = locations.get(uid) || [];
                    values.push(location);
                    locations.set(uid, values);
                    return true;
                },
                async getLocations() { return { spaces: locations.get(uid) || [] }; }
            };
        }
    };
    const uploadStore = {
        async read(uid, uploadId) {
            if (uid === 'user-a' && uploadId === 'upload-a') return { uploadId, mime: 'image/png', buffer: Buffer.from('png') };
            const error = new Error('upload not found');
            error.status = 404;
            error.code = 'UPLOAD_NOT_FOUND';
            error.publicMessage = 'Upload not found';
            throw error;
        }
    };
    const app = express();
    app.use(express.json());
    app.use(createStudySpaceRouter({
        auth: { verifyIdToken: async token => {
            if (token === 'a') return { uid: 'user-a' };
            if (token === 'b') return { uid: 'user-b' };
            throw new Error('invalid');
        } },
        uploadStore,
        repository,
        provider
    }));
    return { app, locations, repository, uploadStore };
}

const validResponse = { text: JSON.stringify({ noiseLevel: 'quiet', seating: 'empty', lighting: 'good', powerOutlets: true, spaceType: 'library' }) };

test('Step 09: authentication and upload validation happen before provider requests', async () => {
    let calls = 0;
    const fixture = setup({ generateContent: async () => { calls++; return validResponse; } });
    const server = await createTestServer(fixture.app);
    try {
        const anonymous = await request(server, 'POST', '/api/analyze-study-space', { uploadId: 'upload-a' });
        assert.equal(anonymous.status, 401);
        const invalid = await request(server, 'POST', '/api/analyze-study-space', { uploadId: '../outside' }, { Authorization: 'Bearer a' });
        assert.equal(invalid.status, 400);
        const foreign = await request(server, 'POST', '/api/analyze-study-space', { uploadId: 'upload-a' }, { Authorization: 'Bearer b' });
        assert.equal(foreign.status, 404);
        assert.equal(calls, 0);
    } finally {
        await server.close();
    }
});

test('Step 09: malformed provider JSON is rejected and is never persisted', async () => {
    const fixture = setup({ generateContent: async () => ({ text: '{"noiseLevel":"quiet"' }) });
    const server = await createTestServer(fixture.app);
    try {
        const response = await request(server, 'POST', '/api/analyze-study-space', { uploadId: 'upload-a' }, { Authorization: 'Bearer a' });
        assert.equal(response.status, 502);
        assert.equal(response.body.error.code, 'PROVIDER_INVALID_RESPONSE');
        assert.equal(fixture.locations.size, 0);
    } finally {
        await server.close();
    }
});

test('Step 09: persistence failure is non-success and does not claim a saved result', async () => {
    const fixture = setup({ generateContent: async () => validResponse });
    fixture.repository.failSave = true;
    const server = await createTestServer(fixture.app);
    try {
        const response = await request(server, 'POST', '/api/analyze-study-space', { uploadId: 'upload-a' }, { Authorization: 'Bearer a' });
        assert.equal(response.status, 500);
        assert.notEqual(response.body.success, true);
        assert.doesNotMatch(JSON.stringify(response.body), /private|EACCES|locations\.json/i);
    } finally {
        await server.close();
    }
});

test('Step 09: an owner can retrieve a saved location while another user sees an empty tenant', async () => {
    const fixture = setup({ generateContent: async () => validResponse });
    const server = await createTestServer(fixture.app);
    try {
        const saved = await request(server, 'POST', '/api/analyze-study-space', { uploadId: 'upload-a' }, { Authorization: 'Bearer a' });
        assert.equal(saved.status, 201);
        assert.equal(saved.body.saved, true);
        assert.equal(saved.body.location.uid, 'user-a');
        assert.deepEqual(saved.body.analysis, { noiseLevel: 'quiet', seating: 'empty', lighting: 'good', powerOutlets: true, spaceType: 'library' });

        const owner = await request(server, 'GET', '/api/locations', undefined, { Authorization: 'Bearer a' });
        assert.equal(owner.status, 200);
        assert.equal(owner.body.locations.length, 1);
        const other = await request(server, 'GET', '/api/locations', undefined, { Authorization: 'Bearer b' });
        assert.deepEqual(other.body.locations, []);
        const foreignRead = await request(server, 'GET', `/api/locations/${saved.body.location.id}`, undefined, { Authorization: 'Bearer b' });
        assert.equal(foreignRead.status, 404);
    } finally {
        await server.close();
    }
});
