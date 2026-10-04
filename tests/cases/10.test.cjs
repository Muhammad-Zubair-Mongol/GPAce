const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const { createTestServer } = require('../harness/helpers.cjs');
const { createResearchRouter, ResearchGateway } = require('../../server/routes/research');

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
            res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
        });
        req.on('error', reject);
        req.end(encoded);
    });
}

function appWith(gateway) {
    const app = express();
    app.use(express.json());
    app.use(createResearchRouter({
        gateway,
        auth: { verifyIdToken: async token => token === 'a' ? { uid: 'user-a' } : (() => { throw new Error('bad'); })() }
    }));
    return app;
}

test('Step 10: malformed input is 400 and anonymous requests never reach the provider', async () => {
    let calls = 0;
    const gateway = new ResearchGateway({ provider: { generateContent: async () => { calls++; return 'ok'; } } });
    const server = await createTestServer(appWith(gateway));
    try {
        const anonymous = await request(server, '/api/research', { query: 'private' });
        assert.equal(anonymous.status, 401);
        const blank = await request(server, '/api/research', { query: '   ' }, { Authorization: 'Bearer a' });
        assert.equal(blank.status, 400);
        const oversized = await request(server, '/api/research', { query: 'x'.repeat(9000) }, { Authorization: 'Bearer a' });
        assert.equal(oversized.status, 400);
        const invalidTemperature = await request(server, '/api/research', { query: 'x', temperature: 3 }, { Authorization: 'Bearer a' });
        assert.equal(invalidTemperature.status, 400);
        assert.equal(calls, 0);
    } finally {
        await server.close();
    }
});

test('Step 10: upstream 429 is distinguishable and ordinary logs contain no query or key', async () => {
    const logs = [];
    const gateway = new ResearchGateway({
        logger: item => logs.push(item),
        provider: { generateContent: async () => { const error = new Error('apiKey=secret query=private'); error.status = 429; throw error; } }
    });
    const server = await createTestServer(appWith(gateway));
    try {
        const response = await request(server, '/api/research', { query: 'private question', apiKey: 'secret-key' }, { Authorization: 'Bearer a' });
        assert.equal(response.status, 400);
        assert.equal(response.body.error.code, 'BYOK_DISABLED');

        const rateLimited = await request(server, '/api/research', { query: 'private question' }, { Authorization: 'Bearer a' });
        assert.equal(rateLimited.status, 429);
        assert.equal(rateLimited.body.error.code, 'UPSTREAM_RATE_LIMITED');
        assert.doesNotMatch(JSON.stringify(logs), /private question|secret-key|apiKey=secret/);
    } finally {
        await server.close();
    }
});

test('Step 10: deadline aborts the upstream adapter and returns 504 without retrying', async () => {
    let calls = 0;
    let signal;
    const gateway = new ResearchGateway({
        timeoutMs: 20,
        provider: {
            generateContent: async (_request, options) => {
                calls++;
                signal = options.signal;
                return new Promise(() => {});
            }
        }
    });
    await assert.rejects(() => gateway.execute({ uid: 'user-a', body: { query: 'bounded' } }), error => {
        assert.equal(error.status, 504);
        assert.equal(error.code, 'UPSTREAM_TIMEOUT');
        return true;
    });
    assert.equal(calls, 1);
    assert.equal(signal.aborted, true);
});

test('Step 10: per-user concurrency limit is released after completion', async () => {
    let release;
    let calls = 0;
    const gateway = new ResearchGateway({
        maxConcurrent: 1,
        provider: { generateContent: async () => {
            calls++;
            if (calls === 1) return new Promise(resolve => { release = () => resolve({ text: 'done' }); });
            return { text: 'done' };
        } }
    });
    const first = gateway.execute({ uid: 'user-a', body: { query: 'one' } });
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(() => gateway.execute({ uid: 'user-a', body: { query: 'two' } }), error => error.code === 'CONCURRENCY_LIMITED');
    release();
    assert.deepEqual(await first, { message: 'done', sources: [] });
    assert.deepEqual(await gateway.execute({ uid: 'user-a', body: { query: 'three' } }), { message: 'done', sources: [] });
});

test('Step 10: client cancellation propagates an abort signal', async () => {
    let signal;
    const controller = new AbortController();
    const gateway = new ResearchGateway({
        provider: { generateContent: async (_request, options) => {
            signal = options.signal;
            return new Promise(() => {});
        } }
    });
    const pending = gateway.execute({ uid: 'user-a', body: { query: 'cancel me' }, signal: controller.signal });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await assert.rejects(pending, error => error.code === 'REQUEST_CANCELLED');
    assert.equal(signal.aborted, true);
});
