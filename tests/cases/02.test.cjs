const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const {
    createAuthMiddleware,
    createOriginPolicy,
    createOwnershipMiddleware
} = require('../../server/middleware/auth');
const {
    createErrorMiddleware,
    HttpError
} = require('../../server/middleware/errors');
const { createTestServer } = require('../harness/helpers.cjs');

function request(server, path, options = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(`${server.url}${path}`);
        const req = http.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                let parsed = null;
                try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });
        req.on('error', reject);
        req.end(options.body);
    });
}

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use(createOriginPolicy({ allowedOrigins: ['https://app.example.test'] }));
    app.use(createAuthMiddleware({
        verifyIdToken: async token => {
            if (token === 'token-user-a') return { uid: 'user-a', email: 'a@example.test' };
            if (token === 'token-user-b') return { uid: 'user-b', email: 'b@example.test' };
            throw new Error('token rejected');
        }
    }));
    app.get('/users/:userId/data', createOwnershipMiddleware(), (req, res) => {
        res.json({ uid: req.user.uid, ownerUid: req.ownerUid });
    });
    app.get('/boom', () => {
        throw new Error('provider apiKey=top-secret at C:\\private\\source.js');
    });
    app.use(createErrorMiddleware());
    return app;
}

test('Step 02: missing and invalid bearer tokens are rejected with stable JSON errors', async () => {
    const server = await createTestServer(makeApp());
    try {
        const missing = await request(server, '/users/user-a/data');
        assert.equal(missing.status, 401);
        assert.equal(missing.body.error.code, 'AUTH_REQUIRED');
        assert.equal(typeof missing.body.error.requestId, 'string');

        const invalid = await request(server, '/users/user-a/data', {
            headers: { Authorization: 'Bearer bad-token' }
        });
        assert.equal(invalid.status, 401);
        assert.equal(invalid.body.error.code, 'AUTH_INVALID');
    } finally {
        await server.close();
    }
});

test('Step 02: ownership is derived from the verified UID and rejects cross-user access', async () => {
    const server = await createTestServer(makeApp());
    try {
        const forbidden = await request(server, '/users/user-b/data', {
            headers: { Authorization: 'Bearer token-user-a' }
        });
        assert.equal(forbidden.status, 403);
        assert.equal(forbidden.body.error.code, 'FORBIDDEN');

        const allowed = await request(server, '/users/user-a/data', {
            headers: { Authorization: 'Bearer token-user-a' }
        });
        assert.equal(allowed.status, 200);
        assert.deepEqual(allowed.body, { uid: 'user-a', ownerUid: 'user-a' });
    } finally {
        await server.close();
    }
});

test('Step 02: the origin policy permits configured preflight and denies foreign origins', async () => {
    const server = await createTestServer(makeApp());
    try {
        const allowed = await request(server, '/users/user-a/data', {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://app.example.test',
                'Access-Control-Request-Method': 'GET'
            }
        });
        assert.equal(allowed.status, 204);
        assert.equal(allowed.headers['access-control-allow-origin'], 'https://app.example.test');
        assert.match(allowed.headers['access-control-allow-methods'], /GET/);

        const denied = await request(server, '/users/user-a/data', {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://attacker.example.test',
                'Access-Control-Request-Method': 'GET'
            }
        });
        assert.equal(denied.status, 403);
        assert.equal(denied.headers['access-control-allow-origin'], undefined);
        assert.equal(denied.body.error.code, 'ORIGIN_DENIED');
    } finally {
        await server.close();
    }
});

test('Step 02: internal error responses redact provider credentials and filesystem paths', async () => {
    const server = await createTestServer(makeApp());
    try {
        const response = await request(server, '/boom', {
            headers: { Authorization: 'Bearer token-user-a' }
        });
        assert.equal(response.status, 500);
        assert.deepEqual(response.body.error.message, 'Internal server error');
        assert.doesNotMatch(JSON.stringify(response.body), /top-secret|private|source\.js|apiKey/i);
        assert.match(response.headers['x-request-id'], /^[A-Za-z0-9._:-]+$/);
    } finally {
        await server.close();
    }
});

test('Step 02: typed HTTP errors expose only their safe public message', () => {
    const error = new HttpError(422, 'INVALID_INPUT', 'The submitted value is invalid', { expose: true });
    assert.equal(error.status, 422);
    assert.equal(error.code, 'INVALID_INPUT');
    assert.equal(error.publicMessage, 'The submitted value is invalid');
});
