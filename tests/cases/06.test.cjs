const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');

const { createTempDir, createTestServer } = require('../harness/helpers.cjs');
const {
    ConversionError,
    cleanupArtifacts,
    createConverter
} = require('../../server/services/converter');
const { createConversionRouter } = require('../../server/routes/conversion');
const { createApp } = require('../../server/app');
const { createErrorMiddleware } = require('../../server/middleware/errors');

function request(server, requestPath, body, options = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(`${server.url}${requestPath}`);
        const encoded = body === undefined ? '' : JSON.stringify(body);
        const req = http.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port,
            path: target.pathname,
            method: options.method || 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(encoded),
                ...(options.headers || {})
            }
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.end(encoded);
    });
}

function availablePandocStub({ delay = 0, writeOutput = true, calls = [] } = {}) {
    return (command, args, options, callback) => {
        calls.push({ command, args, options });
        const child = new EventEmitter();
        child.kill = () => { child.killed = true; };
        setTimeout(async () => {
            if (args[0] === '--version') return callback(null, 'pandoc 3.1.9\n', '');
            if (writeOutput) await fsp.writeFile(args[args.indexOf('-o') + 1], Buffer.from('PK fake docx'));
            callback(null, '', '');
        }, delay);
        return child;
    };
}

test('Step 06: status reports the availability of the converter used by the API', async () => {
    for (const available of [false, true]) {
        const converter = {
            checkPandoc: async () => ({ available, version: available ? '3.1.9' : null }),
            convert: async () => { throw new Error('conversion should not run for status'); }
        };
        const app = await createApp({ converter });
        const server = await createTestServer(app);
        try {
            const response = await fetch(`${server.url}/api/status`);
            assert.equal(response.status, 200);
            const body = await response.json();
            assert.equal(body.pandoc_available, available);
            assert.equal(body.pandoc_version, available ? '3.1.9' : null);
        } finally {
            await server.close();
        }
    }
});

test('Step 06: non-string and oversized markdown are rejected before tool execution', async () => {
    let calls = 0;
    const converter = createConverter({
        execFile: (...args) => { calls++; return availablePandocStub()(...args); },
        maxMarkdownBytes: 8
    });

    await assert.rejects(() => converter.convert({ markdown: 'wrong' }), error => {
        assert(error instanceof ConversionError);
        assert.equal(error.status, 400);
        assert.equal(error.code, 'INVALID_MARKDOWN');
        return true;
    });
    await assert.rejects(() => converter.convert('   '), error => {
        assert.equal(error.status, 400);
        assert.equal(error.code, 'INVALID_MARKDOWN');
        return true;
    });
    await assert.rejects(() => converter.convert('this is too large'), error => {
        assert.equal(error.status, 413);
        assert.equal(error.code, 'MARKDOWN_TOO_LARGE');
        return true;
    });
    assert.equal(calls, 0);
});

test('Step 06: missing Pandoc is typed as tool unavailable without revealing command paths', async () => {
    const converter = createConverter({
        execFile: (_command, _args, _options, callback) => {
            const error = new Error('spawn pandoc ENOENT at C:\\private\\pandoc.exe');
            error.code = 'ENOENT';
            callback(error);
            return new EventEmitter();
        }
    });
    await assert.rejects(() => converter.convert('# heading'), error => {
        assert.equal(error.status, 503);
        assert.equal(error.code, 'CONVERTER_UNAVAILABLE');
        assert.equal(error.publicMessage, 'Document conversion is currently unavailable');
        return true;
    });
});

test('Step 06: concurrent conversions use distinct request directories and clean artifacts after download', async () => {
    const temp = createTempDir('gpace-converter-root-');
    const calls = [];
    const converter = createConverter({ tempRoot: temp.path, execFile: availablePandocStub({ calls }) });
    const [one, two] = await Promise.all([converter.convert('# one'), converter.convert('# two')]);
    try {
        assert.notEqual(one.tempDir, two.tempDir);
        assert.ok(fs.existsSync(one.outputPath));
        assert.ok(fs.existsSync(two.outputPath));
        assert.equal(calls.filter(call => call.args[0] === '--version').length, 2);
    } finally {
        await Promise.all([one.cleanup(), two.cleanup()]);
        temp.cleanup();
    }
    assert.equal(fs.existsSync(one.tempDir), false);
    assert.equal(fs.existsSync(two.tempDir), false);
});

test('Step 06: a hung child is killed by the deadline and returns a sanitized timeout error', async () => {
    let child;
    const converter = createConverter({
        timeoutMs: 20,
        execFile: (_command, args, _options, callback) => {
            child = new EventEmitter();
            child.kill = () => { child.killed = true; };
            // Version check succeeds; conversion itself never calls back.
            if (args[0] === '--version') setImmediate(() => callback(null, 'pandoc 3.1.9', ''));
            return child;
        }
    });
    await assert.rejects(() => converter.convert('# hangs'), error => {
        assert.equal(error.status, 504);
        assert.equal(error.code, 'CONVERSION_TIMEOUT');
        return true;
    });
    assert.equal(child.killed, true);
});

test('Step 06: route returns 503 for an unavailable converter and 400 for invalid body input', async () => {
    const unavailable = createConverter({
        execFile: (_command, _args, _options, callback) => {
            const error = new Error('not installed');
            error.code = 'ENOENT';
            callback(error);
            return new EventEmitter();
        }
    });
    const app = express();
    app.use(express.json());
    app.use('/api', createConversionRouter({ converter: unavailable }));
    app.use(createErrorMiddleware());
    const server = await createTestServer(app);
    try {
        const invalid = await request(server, '/api/convert', { markdown: { value: '# no' } });
        assert.equal(invalid.status, 400);
        assert.equal(JSON.parse(invalid.body).error.code, 'INVALID_MARKDOWN');

        const unavailableResponse = await request(server, '/api/convert', { markdown: '# valid' });
        assert.equal(unavailableResponse.status, 503);
        assert.equal(JSON.parse(unavailableResponse.body).error.code, 'CONVERTER_UNAVAILABLE');
    } finally {
        await server.close();
    }
});

test('Step 06: cleanup attempts every artifact even when one unlink fails', async () => {
    const removed = [];
    const fakeFs = {
        async unlink(filePath) {
            removed.push(filePath);
            if (filePath.endsWith('input.md')) throw new Error('injected unlink failure');
        },
        async rm(dirPath) {
            removed.push(dirPath);
        }
    };
    const result = await cleanupArtifacts(['/tmp/input.md', '/tmp/output.docx', '/tmp/request-dir'], fakeFs);
    assert.deepEqual(removed, ['/tmp/input.md', '/tmp/output.docx', '/tmp/request-dir']);
    assert.equal(result.filter(item => !item.ok).length, 1);
    assert.equal(result.filter(item => item.ok).length, 2);
});
