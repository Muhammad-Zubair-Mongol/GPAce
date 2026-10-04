const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const { createTestServer } = require('../harness/helpers.cjs');
const { createSubtasksRouter, SubtasksGateway } = require('../../server/routes/subtasks');

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
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(encoded),
                ...headers
            }
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

function appWith(options) {
    const app = express();
    app.use(express.json());
    app.use(createSubtasksRouter({
        ...options,
        auth: {
            verifyIdToken: async token => {
                if (token !== 'valid') throw new Error('invalid token');
                return { uid: 'user-a' };
            }
        }
    }));
    return app;
}

test('Step 12: authenticated subtask boundary enforces input, provider output, deadlines, and task identity', async () => {
    let providerCalls = 0;
    const inputServer = await createTestServer(appWith({
        provider: { generateContent: async () => { providerCalls++; return { subtasks: ['ok'] }; } }
    }));
    try {
        const anonymous = await request(inputServer, '/api/generate-subtasks', { text: 'plan this' });
        assert.equal(anonymous.status, 401);
        const empty = await request(inputServer, '/api/generate-subtasks', { text: '   ' }, { Authorization: 'Bearer valid' });
        assert.equal(empty.status, 400);
        const oversized = await request(inputServer, '/api/generate-subtasks', { text: 'x'.repeat(9000) }, { Authorization: 'Bearer valid' });
        assert.equal(oversized.status, 400);
        assert.equal(providerCalls, 0);
    } finally {
        await inputServer.close();
    }

    const malformedServer = await createTestServer(appWith({
        provider: { generateContent: async () => ({ text: 'provider-secret=should-not-leak' }) }
    }));
    try {
        const malformed = await request(malformedServer, '/api/generate-subtasks', { text: 'plan this' }, { Authorization: 'Bearer valid' });
        assert.equal(malformed.status, 502);
        assert.equal(malformed.body.error.code, 'UPSTREAM_INVALID_RESPONSE');
        assert.doesNotMatch(JSON.stringify(malformed.body), /provider-secret|should-not-leak/);
    } finally {
        await malformedServer.close();
    }

    const oversizedServer = await createTestServer(appWith({
        provider: { generateContent: async () => ({ subtasks: ['x'.repeat(513)] }) }
    }));
    try {
        const oversized = await request(oversizedServer, '/api/generate-subtasks', { text: 'plan this' }, { Authorization: 'Bearer valid' });
        assert.equal(oversized.status, 502);
        assert.equal(oversized.body.error.code, 'UPSTREAM_INVALID_RESPONSE');
    } finally {
        await oversizedServer.close();
    }

    let timeoutSignal;
    const timeoutServer = await createTestServer(appWith({
        timeoutMs: 20,
        provider: {
            generateContent: async (_request, options) => {
                timeoutSignal = options.signal;
                return new Promise(() => {});
            }
        }
    }));
    try {
        const timedOut = await request(timeoutServer, '/api/generate-subtasks', { text: 'plan this' }, { Authorization: 'Bearer valid' });
        assert.equal(timedOut.status, 504);
        assert.equal(timedOut.body.error.code, 'UPSTREAM_TIMEOUT');
        assert.equal(timeoutSignal.aborted, true);
    } finally {
        await timeoutServer.close();
    }

    let seenRequest;
    const validServer = await createTestServer(appWith({
        provider: {
            ready: async () => {},
            generateContent: async (requestBody, options) => {
                seenRequest = { requestBody, options };
                return { response: { text: async () => '1. Break the work into steps\n2. Review the result' } };
            }
        }
    }));
    try {
        const valid = await request(validServer, '/api/generate-subtasks', {
            text: 'prepare a study plan',
            taskId: 'task-42'
        }, { Authorization: 'Bearer valid' });
        assert.equal(valid.status, 200);
        assert.deepEqual(valid.body, {
            subtasks: ['Break the work into steps', 'Review the result'],
            taskId: 'task-42'
        });
        assert.equal(seenRequest.requestBody.contents, 'prepare a study plan');
        assert.equal(seenRequest.options.signal.aborted, false);
        assert.doesNotMatch(JSON.stringify(valid.body), /secret|apiKey|raw provider/i);
    } finally {
        await validServer.close();
    }

    const direct = new SubtasksGateway({ provider: { generateContent: async () => ({ subtasks: ['one', 'two'] }) } });
    assert.deepEqual(await direct.execute({ uid: 'user-a', body: { text: 'direct task', taskIdentity: { source: 'existing' } } }), {
        subtasks: ['one', 'two'],
        taskIdentity: { source: 'existing' }
    });
});
