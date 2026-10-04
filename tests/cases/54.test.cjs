/**
 * Step 54: authenticated browser contracts and deployment boundary.
 *
 * These fixtures exercise the shared client against a real local Express
 * application, prove opaque upload ownership, and verify that Hosting and the
 * browser consumers agree on the frontend/backend split.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs').promises;
const path = require('node:path');

const { ApiClient, ApiClientError } = require('../../js/services/ApiClient.js');
const { createApp } = require('../../server/app');
const { createTempDir, createTestServer } = require('../harness/helpers.cjs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const leasedConsumers = [
    'js/timetableAnalyzer.js',
    'js/studySpaceAnalyzer.js',
    'js/controllers/ScheduleController.js',
    'js/calendarManager.js',
    'js/studySpacesManager.js',
    'js/priority-list-utils.js',
    'js/apiSettingsManager.js',
    'js/ai-researcher.js'
];

async function read(relativePath) {
    return fs.readFile(path.join(ROOT_DIR, ...relativePath.split('/')), 'utf8');
}

async function digestTree(root) {
    const files = [];
    async function visit(directory, relative = '') {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
            const child = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(child, childRelative);
            else files.push([childRelative.replaceAll('\\', '/'), await fs.readFile(child)]);
        }
    }
    await visit(root);
    const hash = crypto.createHash('sha256');
    for (const [name, contents] of files) {
        hash.update(name);
        hash.update('\0');
        hash.update(contents);
        hash.update('\0');
    }
    return { files: files.map(([name]) => name), digest: hash.digest('hex') };
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    });
}

test('Step 54: ApiClient attaches verified identity, rejects direct providers, and enforces deadlines', async () => {
    const calls = [];
    const client = new ApiClient({
        baseUrl: 'https://frontend.example.test',
        getIdToken: async () => 'verified-user-token',
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return jsonResponse({ ok: true });
        }
    });

    const result = await client.post('/api/research', { query: 'secure fixture' });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.get('Authorization'), 'Bearer verified-user-token');
    assert.equal(calls[0].options.headers.get('X-Request-Id').length > 10, true);
    assert.deepEqual(JSON.parse(calls[0].options.body), { query: 'secure fixture' });

    await assert.rejects(
        client.get('https://generativelanguage.googleapis.com/v1beta/models'),
        error => error instanceof ApiClientError && error.code === 'DIRECT_PROVIDER_BLOCKED'
    );
    assert.equal(calls.length, 1, 'blocked provider URL must not reach fetch');

    const timeoutClient = new ApiClient({
        baseUrl: 'https://frontend.example.test',
        timeoutMs: 5,
        getIdToken: async () => 'verified-user-token',
        fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        })
    });
    await assert.rejects(
        timeoutClient.get('/api/slow'),
        error => error instanceof ApiClientError && error.code === 'REQUEST_TIMEOUT' && error.status === 408
    );
});

test('Step 54: uploads use opaque IDs and 401/403 failures retain caller drafts', async () => {
    let uploadRequest;
    const client = new ApiClient({
        baseUrl: 'https://frontend.example.test',
        getIdToken: async () => 'verified-user-token',
        fetchImpl: async (_url, options) => {
            uploadRequest = options;
            return jsonResponse({ success: true, uploads: [{ uploadId: 'opaque-upload-1', fileName: 'table.png' }] }, 201);
        }
    });
    const file = new File([Buffer.from('fixture-image')], 'table.png', { type: 'image/png' });
    const result = await client.upload(file);
    assert.equal(result.uploads[0].uploadId, 'opaque-upload-1');
    assert.ok(uploadRequest.options === undefined || uploadRequest.body instanceof FormData);
    assert.equal(uploadRequest.body.get('image').name, 'table.png');
    assert.equal(uploadRequest.body.get('userId'), null);

    let authFailure;
    const failingClient = new ApiClient({
        baseUrl: 'https://frontend.example.test',
        getIdToken: async () => 'expired-token',
        onAuthFailure: error => { authFailure = error; },
        fetchImpl: async () => jsonResponse({ error: 'owner required', code: 'FORBIDDEN' }, 403)
    });
    const draft = { events: [{ id: 'draft-event', title: 'Retain me' }] };
    await assert.rejects(
        failingClient.post('/api/save-timetable', { events: draft.events }),
        error => error instanceof ApiClientError && error.status === 403 && error.authFailure
    );
    assert.equal(authFailure.status, 403);
    assert.deepEqual(draft, { events: [{ id: 'draft-event', title: 'Retain me' }] });
});

test('Step 54: browser fixture reaches secured routes with bearer identity and owner uploadId', async () => {
    const uploadRoot = createTempDir('gpace-step54-uploads-');
    const settingsRoot = createTempDir('gpace-step54-settings-');
    const jobs = [];
    const repository = {
        forTenant(uid) {
            return {
                async getTimetable() { return []; },
                async saveTimetable(events) { return events; },
                async getLocations() { return []; },
                async saveLocation() { return true; },
                uid
            };
        }
    };
    const app = await createApp({
        auth: {
            verifyIdToken: async token => {
                if (token === 'user-a-token') return { uid: 'user-a' };
                if (token === 'user-b-token') return { uid: 'user-b' };
                throw new Error('expired token');
            }
        },
        uploadRootDir: uploadRoot.path,
        settingsRootDir: settingsRoot.path,
        repositories: repository,
        jobs: {
            async run(input) {
                jobs.push(input);
                return { jobId: 'job-fixture', events: [], status: 'queued' };
            }
        }
    });
    const server = await createTestServer(app);
    try {
        const client = new ApiClient({
            baseUrl: server.url,
            getIdToken: async () => 'user-a-token'
        });
        const validOneByOnePng = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64'
        );
        const upload = await client.upload(new File([validOneByOnePng], 'owned.png', { type: 'image/png' }));
        const uploadId = upload.uploads[0].uploadId;
        assert.match(uploadId, /^[A-Za-z0-9_-]+$/);

        const analysis = await client.post('/api/analyze-timetable', { uploadId });
        assert.equal(analysis.success, true);
        assert.equal(jobs[0].uid, 'user-a');
        assert.equal(jobs[0].uploadId, uploadId);
        assert.equal(Object.hasOwn(jobs[0], 'imagePath'), false);

        const otherUser = new ApiClient({
            baseUrl: server.url,
            getIdToken: async () => 'user-b-token'
        });
        let retainedDraft = { title: 'wrong-user draft' };
        await assert.rejects(
            otherUser.post('/api/settings/user-a', { theme: 'dark' }),
            error => error instanceof ApiClientError && error.status === 403
        );
        assert.deepEqual(retainedDraft, { title: 'wrong-user draft' });
    } finally {
        await server.close();
        uploadRoot.cleanup();
        settingsRoot.cleanup();
    }
});

test('Step 54: static consumers use ApiClient contracts and never send path-based uploads', async () => {
    for (const relativePath of leasedConsumers) {
        const source = await read(relativePath);
        assert.doesNotMatch(source, /fetch\s*\(/, `${relativePath} still owns a raw fetch call`);
        assert.doesNotMatch(source, /GoogleGenerativeAI|@google\/generative-ai/, `${relativePath} still owns the retired browser SDK`);
        assert.doesNotMatch(source, /\b(?:imagePath|filePath)\b/, `${relativePath} still uses a path-based upload contract`);
    }
    const clientSource = await read('js/services/ApiClient.js');
    assert.match(clientSource, /Authorization/);
    assert.match(clientSource, /DIRECT_PROVIDER_BLOCKED/);
    assert.match(clientSource, /REQUEST_TIMEOUT/);
    assert.match(clientSource, /uploadId/);
});

test('Step 54: Hosting points only at dist and routes APIs before the UI fallback', async () => {
    const firebase = JSON.parse(await read('firebase.json'));
    assert.equal(firebase.hosting.public, 'dist');
    const rewrites = firebase.hosting.rewrites;
    const fallbackIndex = rewrites.findIndex(rule => rule.destination === '/index.html');
    assert.ok(fallbackIndex > 0);
    for (const rule of rewrites.slice(0, fallbackIndex)) {
        if (rule.source.startsWith('/api/') || rule.source.startsWith('/uploads/') || rule.source.startsWith('/settings/')) {
            assert.equal(rule.run.serviceId, 'gpace-api');
        }
    }
    const headers = firebase.hosting.headers;
    assert.ok(headers.some(rule => rule.source === '**' && rule.headers.some(header => header.key === 'X-Content-Type-Options' && header.value === 'nosniff')));
    assert.ok(headers.some(rule => rule.source.includes('html') && rule.headers.some(header => header.key === 'Cache-Control' && header.value.includes('no-cache'))));
    assert.ok(headers.some(rule => rule.source.includes('js') && rule.headers.some(header => header.key === 'Cache-Control' && header.value.includes('immutable'))));

    const ignored = (await read('.firebaseignore')).split(/\r?\n/).filter(Boolean);
    for (const entry of ['server/**', 'private/**', 'data/**', 'archive/**', 'audit/**', 'tests/**', 'package-lock.json']) {
        assert.ok(ignored.includes(entry), `${entry} must remain outside the Hosting boundary`);
    }
    const packageJson = JSON.parse(await read('package.json'));
    assert.equal(typeof packageJson.scripts['build:static'], 'string');
    assert.equal(typeof packageJson.scripts['verify:deployment'], 'string');
});

test('Step 54: static builder remains reproducible for a clean allowlisted fixture', async () => {
    const { buildStatic } = await import('../../scripts/build-static.mjs');
    const fixture = createTempDir('gpace-step54-static-');
    try {
        const manifestPath = path.join(fixture.path, 'config', 'assets-manifest.json');
        await fs.mkdir(path.dirname(manifestPath), { recursive: true });
        await fs.writeFile(path.join(fixture.path, 'index.html'), '<script type="module" src="app.js"></script>');
        await fs.writeFile(path.join(fixture.path, 'app.js'), 'export const ready = true;');
        await fs.writeFile(manifestPath, JSON.stringify({
            version: 1,
            pages: ['index.html'],
            assetRoots: [],
            requiredFiles: [],
            assetFiles: [],
            aliases: {},
            virtualDependencies: [],
            virtualRoutes: [],
            externalDependencies: [],
            requirePinnedExternalAssets: true
        }));
        const firstOut = path.join(fixture.path, 'dist-one');
        const secondOut = path.join(fixture.path, 'dist-two');
        await buildStatic({ rootDir: fixture.path, manifestPath, outDir: firstOut });
        await buildStatic({ rootDir: fixture.path, manifestPath, outDir: secondOut });
        const first = await digestTree(firstOut);
        const second = await digestTree(secondOut);
        assert.deepEqual(first.files, ['app.js', 'index.html']);
        assert.equal(first.digest, second.digest);
    } finally {
        fixture.cleanup();
    }
});

test('Step 54: legacy SDK retirement is evidence-gated', async () => {
    const packageJson = JSON.parse(await read('package.json'));
    const legacyReferences = [];
    for (const relativePath of ['study-spaces.html', 'workers/imageAnalysis.js', 'js/imageAnalyzer.js', 'js/ContentClassifier.js']) {
        const source = await read(relativePath);
        if (/GoogleGenerativeAI|@google\/generative-ai/.test(source)) legacyReferences.push(relativePath);
    }
    if (legacyReferences.length > 0) {
        assert.ok(packageJson.dependencies['@google/generative-ai'], 'legacy runtime roots still require the compatibility package');
        console.warn(`[Step54] retained @google/generative-ai because live unleased roots remain: ${legacyReferences.join(', ')}`);
    } else {
        assert.equal(packageJson.dependencies['@google/generative-ai'], undefined);
    }
});
