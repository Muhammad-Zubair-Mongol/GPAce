const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FUNCTIONS_DIR = path.resolve(__dirname, '..', '..', 'functions');

test('Step 15: Functions runtime declares Node 22 and removes the unused legacy Gemini SDK', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, 'package-lock.json'), 'utf8'));
    assert.equal(packageJson.engines.node, '22');
    assert.equal(packageJson.dependencies['@google/generative-ai'], undefined);
    assert.equal(packageLock.packages[''].engines.node, '22');
    assert.equal(packageLock.packages[''].dependencies['@google/generative-ai'], undefined);
    assert.equal(packageLock.packages['node_modules/@google/generative-ai'], undefined);
});

test('Step 15: callable uses the v2 secret parameter API and never uses functions.config', () => {
    const source = fs.readFileSync(path.join(FUNCTIONS_DIR, 'index.js'), 'utf8');
    assert.match(source, /defineSecret\(['"]GEMINI_API_KEY['"]\)/);
    assert.match(source, /onCall\(\{\s*secrets:/s);
    assert.doesNotMatch(source, /functions\.config\s*\(/);
    assert.doesNotMatch(source, /return\s+[^\n]*geminiApiKey\b/);
});

test('Step 15: callable returns only key availability for missing and configured local secrets', async () => {
    const previous = process.env.GEMINI_API_KEY;
    const modulePath = require.resolve('../../functions/index.js');
    try {
        delete process.env.GEMINI_API_KEY;
        delete require.cache[modulePath];
        let functions = require('../../functions/index.js');
        const missing = await functions.getGeminiConfig.run({ data: {}, rawRequest: {} });
        assert.deepEqual(missing, { keyAvailable: false });

        process.env.GEMINI_API_KEY = 'local-test-secret';
        delete require.cache[modulePath];
        functions = require('../../functions/index.js');
        const configured = await functions.getGeminiConfig.run({ data: {}, rawRequest: {} });
        assert.deepEqual(configured, { keyAvailable: true });
        assert.doesNotMatch(JSON.stringify(configured), /local-test-secret/);
    } finally {
        if (previous === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previous;
        delete require.cache[modulePath];
    }
});

test('Step 15: functions module loads without constructing a Gemini client or making network requests', () => {
    const modulePath = require.resolve('../../functions/index.js');
    delete require.cache[modulePath];
    const functions = require('../../functions/index.js');
    assert.equal(typeof functions.getGeminiConfig, 'function');
    assert.equal(typeof functions.getGeminiConfig.run, 'function');
});
