const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { createTempDir } = require('../harness/helpers.cjs');
const {
    GeminiProviderError,
    createGeminiProvider
} = require('../../server/services/gemini-provider');
const ImageAnalyzer = require('../../js/imageAnalyzer');

test('Step 07: provider initialization completes before generation and keeps user-scoped configuration', async () => {
    const events = [];
    const provider = createGeminiProvider({
        uid: 'user-a',
        apiKey: 'key-a',
        modelName: 'mock-model-a',
        clientFactory: async config => {
            events.push({ type: 'initialized', config });
            return {
                generateContent: async (contents) => {
                    events.push({ type: 'generated', contents });
                    return { text: 'mock response' };
                }
            };
        }
    });

    const response = await provider.generateContent('hello');
    assert.deepEqual(response, { text: 'mock response' });
    assert.deepEqual(events.map(event => event.type), ['initialized', 'generated']);
    assert.deepEqual(provider.getConfig(), { uid: 'user-a', modelName: 'mock-model-a' });
    assert.equal(provider.isReady(), true);
    assert.equal(events[0].config.apiKey, 'key-a');
});

test('Step 07: initialization failure prevents generation and exposes no secret', async () => {
    let generationCalls = 0;
    const provider = createGeminiProvider({
        uid: 'user-failing',
        apiKey: 'failure-secret',
        initialize: async () => {
            throw new Error('SDK failed with failure-secret');
        },
        generateContent: async () => {
            generationCalls++;
            return { text: 'must not run' };
        }
    });

    await assert.rejects(() => provider.ready(), error => {
        assert(error instanceof GeminiProviderError);
        assert.equal(error.code, 'PROVIDER_INIT_FAILED');
        assert.doesNotMatch(error.message, /failure-secret/);
        return true;
    });
    await assert.rejects(() => provider.generateContent('blocked'), /initialization failed/i);
    assert.equal(generationCalls, 0);
    assert.equal(provider.isReady(), false);
});

test('Step 07: separate provider instances retain separate identities and never mutate process environment', async () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const configs = [];
    try {
        const make = (uid, apiKey) => createGeminiProvider({
            uid,
            apiKey,
            clientFactory: async config => {
                configs.push(config);
                return { generateContent: async () => ({ uid }) };
            }
        });
        const first = make('user-a', 'key-a');
        const second = make('user-b', 'key-b');
        await Promise.all([first.ready(), second.ready()]);
        assert.deepEqual(configs.map(config => [config.uid, config.apiKey]), [['user-a', 'key-a'], ['user-b', 'key-b']]);
        assert.equal(process.env.GEMINI_API_KEY, undefined);
    } finally {
        if (original === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = original;
    }
});

test('Step 07: Node image ingestion uses Buffer/files without window or FileReader globals', async () => {
    const temp = createTempDir('gpace-image-node-');
    const filePath = `${temp.path}/fixture.png`;
    const originalWindow = globalThis.window;
    const originalFileReader = globalThis.FileReader;
    try {
        delete globalThis.window;
        delete globalThis.FileReader;
        const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        fs.writeFileSync(filePath, bytes);
        const analyzer = new ImageAnalyzer();
        const fromPath = await analyzer.loadImageData(filePath);
        const fromBuffer = await analyzer.loadImageData(bytes);
        assert.equal(fromPath.inlineData.data, bytes.toString('base64'));
        assert.equal(fromPath.inlineData.mimeType, 'image/png');
        assert.equal(fromBuffer.inlineData.data, bytes.toString('base64'));
        assert.equal(typeof globalThis.FileReader, 'undefined');
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
        if (originalFileReader === undefined) delete globalThis.FileReader;
        else globalThis.FileReader = originalFileReader;
        temp.cleanup();
    }
});
