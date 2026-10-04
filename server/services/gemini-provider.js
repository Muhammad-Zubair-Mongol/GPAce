'use strict';

const DEFAULT_MODEL = 'gemini-3.8-flash';
const providerSecrets = new WeakMap();

class GeminiProviderError extends Error {
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'GeminiProviderError';
        this.code = code;
        this.status = options.status || 502;
        this.publicMessage = options.publicMessage || message;
        this.cause = options.cause;
    }
}

function normalizeOptions(apiKeyOrOptions, maybeOptions = {}) {
    if (typeof apiKeyOrOptions === 'string') {
        return { ...maybeOptions, apiKey: apiKeyOrOptions };
    }
    if (apiKeyOrOptions && typeof apiKeyOrOptions === 'object' && !Array.isArray(apiKeyOrOptions)) {
        return { ...apiKeyOrOptions };
    }
    return { ...maybeOptions };
}

class GeminiProvider {
    constructor(apiKeyOrOptions = {}, maybeOptions = {}) {
        const options = normalizeOptions(apiKeyOrOptions, maybeOptions);
        this.uid = options.uid || options.userId || null;
        this.modelName = options.modelName || options.model || DEFAULT_MODEL;
        providerSecrets.set(this, typeof options.apiKey === 'string' ? options.apiKey : null);
        this._client = options.client || null;
        this._model = options.modelClient || null;
        this._initialize = typeof options.initialize === 'function' ? options.initialize : null;
        this._clientFactory = typeof options.clientFactory === 'function' ? options.clientFactory : null;
        this._generateContent = typeof options.generateContent === 'function' ? options.generateContent : null;
        this._sdk = options.sdk || null;
        this._readyPromise = null;
        this._ready = false;
    }

    isReady() {
        return this._ready;
    }

    getConfig() {
        // Deliberately omit the API key.  This object is safe to use in logs and
        // request metadata while still allowing per-user model selection.
        return { uid: this.uid, modelName: this.modelName };
    }

    async _defaultClientFactory() {
        const apiKey = providerSecrets.get(this);
        if (!apiKey) {
            throw new GeminiProviderError('PROVIDER_CONFIG_MISSING', 'Gemini provider configuration is missing', { status: 503 });
        }

        const sdk = this._sdk || require('@google/genai');
        if (!sdk || typeof sdk.GoogleGenAI !== 'function') {
            throw new GeminiProviderError('PROVIDER_SDK_UNAVAILABLE', 'Gemini provider SDK is unavailable', { status: 503 });
        }
        return new sdk.GoogleGenAI({ apiKey });
    }

    async ready() {
        if (this._ready) return this;
        if (this._readyPromise) return this._readyPromise;

        this._readyPromise = (async () => {
            try {
                let initializedClient = this._client;
                if (this._initialize) {
                    const value = await this._initialize({
                        uid: this.uid,
                        modelName: this.modelName,
                        apiKey: providerSecrets.get(this)
                    });
                    if (value && typeof value === 'object') {
                        initializedClient = value.client || value.provider || value;
                    }
                } else if (!initializedClient && this._clientFactory) {
                    initializedClient = await this._clientFactory({
                        uid: this.uid,
                        modelName: this.modelName,
                        apiKey: providerSecrets.get(this)
                    });
                } else if (!initializedClient && !this._generateContent) {
                    initializedClient = await this._defaultClientFactory();
                }

                if (initializedClient && typeof initializedClient.ready === 'function' && initializedClient !== this) {
                    await initializedClient.ready();
                }

                if (initializedClient && typeof initializedClient.initialize === 'function' && !initializedClient.models && !initializedClient.generateContent) {
                    await initializedClient.initialize();
                }

                this._client = initializedClient || this._client;
                if (this._client && typeof this._client.getGenerativeModel === 'function') {
                    this._model = this._client.getGenerativeModel({ model: this.modelName });
                }

                if (!this._generateContent && !this._model && !this._client?.models?.generateContent && !this._client?.generateContent) {
                    throw new GeminiProviderError('PROVIDER_INVALID', 'Gemini provider has no generation method', { status: 503 });
                }

                this._ready = true;
                return this;
            } catch (error) {
                this._ready = false;
                if (error instanceof GeminiProviderError) throw error;
                throw new GeminiProviderError('PROVIDER_INIT_FAILED', 'Gemini provider initialization failed', {
                    status: 503
                });
            }
        })();

        return this._readyPromise;
    }

    async generateContent(contents, options = {}) {
        await this.ready();

        if (this._generateContent) {
            return this._generateContent(contents, options);
        }
        if (this._model && typeof this._model.generateContent === 'function') {
            return this._model.generateContent(contents, options);
        }
        if (this._client && this._client.models && typeof this._client.models.generateContent === 'function') {
            const request = {
                model: this.modelName,
                contents,
                ...(options && typeof options === 'object' ? options : {})
            };
            return this._client.models.generateContent(request);
        }
        if (this._client && typeof this._client.generateContent === 'function') {
            return this._client.generateContent(contents, options);
        }

        throw new GeminiProviderError('PROVIDER_INVALID', 'Gemini provider has no generation method', { status: 503 });
    }

    async generate(contents, options = {}) {
        return this.generateContent(contents, options);
    }
}

function createGeminiProvider(options, maybeOptions) {
    return new GeminiProvider(options, maybeOptions);
}

async function createReadyGeminiProvider(options, maybeOptions) {
    const provider = createGeminiProvider(options, maybeOptions);
    await provider.ready();
    return provider;
}

module.exports = {
    DEFAULT_MODEL,
    GeminiProvider,
    GeminiProviderError,
    createGeminiProvider,
    createReadyGeminiProvider,
    createRequestProvider: createGeminiProvider,
    createUserProvider: createGeminiProvider
};
