const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const { createTempDir, createTestServer } = require('../harness/helpers.cjs');
const { createPublicAssets } = require('../../server/public-assets');

function request(server, requestPath, headers = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(`${server.url}${requestPath}`);
        const req = http.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            headers
        }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

function buildFixture() {
    const build = createTempDir('gpace-public-build-');
    const outside = createTempDir('gpace-private-root-');
    fs.mkdirSync(path.join(build.path, 'assets'));
    fs.writeFileSync(path.join(build.path, 'index.html'), '<!doctype html><html><body>public shell</body></html>');
    fs.writeFileSync(path.join(build.path, 'assets', 'app.js'), 'window.__public = true;');
    fs.writeFileSync(path.join(outside.path, 'server.js'), 'private source');
    fs.mkdirSync(path.join(outside.path, 'data'));
    fs.writeFileSync(path.join(outside.path, 'data', 'timetable.json'), '{"private":true}');
    return { build, outside };
}

test('Step 03: only the explicit build directory is public and assets carry security/cache headers', async () => {
    const fixture = buildFixture();
    const app = express();
    app.use(createPublicAssets(fixture.build.path));
    app.use((_req, res) => res.status(404).end());
    const server = await createTestServer(app);
    try {
        const asset = await request(server, '/assets/app.js');
        assert.equal(asset.status, 200);
        assert.match(asset.headers['content-type'], /javascript/);
        assert.equal(asset.headers['x-content-type-options'], 'nosniff');
        assert.match(asset.headers['cache-control'], /public/);
        assert.match(asset.headers['cache-control'], /max-age=/);

        const index = await request(server, '/', { Accept: 'text/html' });
        assert.equal(index.status, 200);
        assert.match(index.headers['content-type'], /html/);
        assert.equal(index.headers['cache-control'], 'no-cache');
    } finally {
        await server.close();
        fixture.build.cleanup();
        fixture.outside.cleanup();
    }
});

test('Step 03: source, data, lockfile, archive and dot paths return 404', async () => {
    const fixture = buildFixture();
    const app = express();
    app.use(createPublicAssets(fixture.build.path));
    app.use((_req, res) => res.status(404).end());
    const server = await createTestServer(app);
    try {
        for (const requestPath of [
            '/server.js',
            '/data/timetable.json',
            '/package-lock.json',
            '/functions/package-lock.json',
            '/gpace-v2.zip',
            '/.env',
            '/%2e%2e/server.js',
            '/%2e%2e/%2e%2e/data/timetable.json'
        ]) {
            const response = await request(server, requestPath, { Accept: 'text/html' });
            assert.equal(response.status, 404, `${requestPath} must not be public`);
        }
    } finally {
        await server.close();
        fixture.build.cleanup();
        fixture.outside.cleanup();
    }
});

test('Step 03: navigation fallback serves the UI shell while API paths stay JSON-safe 404s', async () => {
    const fixture = buildFixture();
    const app = express();
    app.use(createPublicAssets(fixture.build.path));
    app.use((req, res) => {
        if (req.path.startsWith('/api/')) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
        return res.status(404).end();
    });
    const server = await createTestServer(app);
    try {
        const navigation = await request(server, '/workspace/today', { Accept: 'text/html,application/xhtml+xml' });
        assert.equal(navigation.status, 200);
        assert.match(navigation.body, /public shell/);

        const api = await request(server, '/api/unknown', { Accept: 'text/html' });
        assert.equal(api.status, 404);
        assert.match(api.headers['content-type'], /application\/json/);
        assert.match(api.body, /NOT_FOUND/);
    } finally {
        await server.close();
        fixture.build.cleanup();
        fixture.outside.cleanup();
    }
});
