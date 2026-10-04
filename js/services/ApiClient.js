/**
 * Shared authenticated client for the browser-facing API.
 *
 * The client deliberately owns token acquisition, request deadlines, error
 * normalization, and upload identifiers.  Browser modules should never add
 * an application bearer token to a direct Google or other provider request.
 */

const DIRECT_PROVIDER_HOSTS = [
    'google.com',
    'googleapis.com',
    'gstatic.com',
    'generativelanguage.googleapis.com',
    'esm.run'
];

function getBrowserLocation() {
    return typeof window !== 'undefined' && window.location ? window.location : null;
}

function defaultBaseUrl() {
    if (typeof globalThis !== 'undefined' && globalThis.GPACE_API_BASE_URL) {
        return String(globalThis.GPACE_API_BASE_URL);
    }
    if (typeof window !== 'undefined' && window.GPACE_API_BASE_URL) {
        return String(window.GPACE_API_BASE_URL);
    }
    const location = getBrowserLocation();
    return location && location.origin ? location.origin : '';
}

function isProviderHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return DIRECT_PROVIDER_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function makeRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `gpace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function headerSet(headers, name, value) {
    if (headers && typeof headers.set === 'function') {
        headers.set(name, value);
        return headers;
    }
    const target = headers || {};
    target[name] = value;
    return target;
}

// Some embedded browser fixtures provide fetch without exposing the global
// Headers constructor. Keep the same set/get surface for callers while
// retaining enumerable header fields so fetch can consume the object as a
// normal HeadersInit record.
class FallbackHeaders {
    constructor(initial = {}) {
        Object.defineProperty(this, '_values', { value: new Map(), enumerable: false });
        if (initial && typeof initial.forEach === 'function') {
            initial.forEach((value, name) => this.set(name, value));
        } else if (initial && typeof initial === 'object') {
            for (const [name, value] of Object.entries(initial)) this.set(name, value);
        }
    }

    set(name, value) {
        const normalized = String(name).toLowerCase();
        const stringValue = String(value);
        this._values.set(normalized, stringValue);
        this[normalized] = stringValue;
    }

    get(name) {
        return this._values.get(String(name).toLowerCase()) ?? null;
    }

    has(name) {
        return this._values.has(String(name).toLowerCase());
    }

    entries() {
        return this._values.entries();
    }

    forEach(callback, thisArg) {
        this._values.forEach((value, name) => callback.call(thisArg, value, name, this));
    }

    [Symbol.iterator]() {
        return this.entries();
    }
}

function createHeaders(initial = {}) {
    return typeof Headers !== 'undefined' ? new Headers(initial) : new FallbackHeaders(initial);
}

function headerGet(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);
    return headers[name] || headers[name.toLowerCase()] || null;
}

async function parseResponseBody(response, responseType) {
    if (responseType === 'blob') return response.blob();
    if (responseType === 'text') return response.text();

    const contentType = headerGet(response.headers, 'content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json();
    }

    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

export class ApiClientError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'ApiClientError';
        this.status = Number.isFinite(details.status) ? details.status : 0;
        this.code = details.code || 'API_REQUEST_FAILED';
        this.body = details.body;
        this.url = details.url;
        this.requestId = details.requestId;
        this.authFailure = this.status === 401 || this.status === 403 || this.code === 'AUTH_REQUIRED';
        this.cause = details.cause;
    }
}

export class ApiClient {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl ?? defaultBaseUrl();
        this.auth = options.auth;
        this.getIdToken = options.getIdToken;
        this.fetchImpl = options.fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
        this.timeoutMs = options.timeoutMs || 20_000;
        this.onAuthFailure = options.onAuthFailure;
        this.lastAuthFailure = null;
    }

    currentUser() {
        if (typeof this.auth === 'function') return this.auth();
        if (this.auth && this.auth.currentUser) return this.auth.currentUser;
        if (typeof window !== 'undefined') {
            if (window.auth && window.auth.currentUser) return window.auth.currentUser;
            if (window.firebase && typeof window.firebase.auth === 'function') {
                return window.firebase.auth().currentUser;
            }
        }
        return null;
    }

    async verifiedToken() {
        const user = this.currentUser();
        let token = null;
        if (typeof this.getIdToken === 'function') {
            token = await this.getIdToken(user);
        } else if (user && typeof user.getIdToken === 'function') {
            token = await user.getIdToken();
        }
        if (!token || typeof token !== 'string') {
            throw new ApiClientError('A verified Firebase user token is required.', {
                code: 'AUTH_REQUIRED'
            });
        }
        return token;
    }

    resolveUrl(input) {
        const raw = String(input || '');
        const base = this.baseUrl || defaultBaseUrl();
        let url;
        try {
            url = new URL(raw, base || undefined);
        } catch (error) {
            throw new ApiClientError(`Invalid API URL: ${raw}`, {
                code: 'INVALID_URL',
                cause: error
            });
        }
        if (isProviderHost(url.hostname)) {
            throw new ApiClientError('Direct provider requests are not permitted through ApiClient.', {
                code: 'DIRECT_PROVIDER_BLOCKED',
                url: url.href
            });
        }
        return url;
    }

    async request(input, options = {}) {
        const url = this.resolveUrl(input);
        const requestId = makeRequestId();
        const method = String(options.method || 'GET').toUpperCase();
        const requiresAuth = options.auth !== false;
        const responseType = options.responseType || 'json';
        const timeoutMs = options.timeoutMs || this.timeoutMs;
        const headers = createHeaders(options.headers || {});

        headerSet(headers, 'X-Request-Id', requestId);
        let body = options.body;
        if (body !== undefined && body !== null && typeof body !== 'string' &&
            !(typeof FormData !== 'undefined' && body instanceof FormData) &&
            !(typeof Blob !== 'undefined' && body instanceof Blob) &&
            !(typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer)) {
            body = JSON.stringify(body);
            headerSet(headers, 'Content-Type', 'application/json');
        }

        if (requiresAuth) {
            let token;
            try {
                token = await this.verifiedToken();
            } catch (error) {
                this.notifyAuthFailure(error);
                throw error;
            }
            headerSet(headers, 'Authorization', `Bearer ${token}`);
        }

        if (typeof this.fetchImpl !== 'function') {
            throw new ApiClientError('Fetch is unavailable in this environment.', {
                code: 'FETCH_UNAVAILABLE',
                url: url.href,
                requestId
            });
        }

        const controller = new AbortController();
        const externalSignal = options.signal;
        const abortFromExternal = () => controller.abort(externalSignal.reason);
        if (externalSignal) {
            if (externalSignal.aborted) abortFromExternal();
            else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
        }
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        let response;
        try {
            response = await this.fetchImpl(url.href, {
                method,
                headers,
                body,
                signal: controller.signal,
                credentials: options.credentials || 'same-origin',
                cache: options.cache
            });
        } catch (error) {
            const timedOut = controller.signal.aborted && !externalSignal?.aborted;
            const failure = new ApiClientError(
                timedOut ? `API request exceeded ${timeoutMs}ms.` : 'API request failed.',
                {
                    status: timedOut ? 408 : 0,
                    code: timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
                    url: url.href,
                    requestId,
                    cause: error
                }
            );
            if (failure.authFailure) this.notifyAuthFailure(failure);
            throw failure;
        } finally {
            clearTimeout(timeout);
            if (externalSignal) externalSignal.removeEventListener('abort', abortFromExternal);
        }

        let parsedBody;
        try {
            parsedBody = await parseResponseBody(response, responseType);
        } catch (error) {
            throw new ApiClientError('API response could not be decoded.', {
                status: response.status,
                code: 'INVALID_RESPONSE',
                url: url.href,
                requestId,
                cause: error
            });
        }

        if (!response.ok) {
            const failure = new ApiClientError(
                parsedBody && parsedBody.error ? parsedBody.error : `API request failed with ${response.status}.`,
                {
                    status: response.status,
                    code: parsedBody && parsedBody.code ? parsedBody.code : 'API_REQUEST_FAILED',
                    body: parsedBody,
                    url: url.href,
                    requestId
                }
            );
            if (failure.authFailure) this.notifyAuthFailure(failure);
            throw failure;
        }

        return parsedBody;
    }

    notifyAuthFailure(error) {
        if (!error || !error.authFailure && error.code !== 'AUTH_REQUIRED') return;
        this.lastAuthFailure = error;
        if (typeof this.onAuthFailure === 'function') {
            try {
                this.onAuthFailure(error);
            } catch (callbackError) {
                console.warn('[ApiClient] auth failure callback failed', callbackError);
            }
        }
    }

    get(path, options = {}) {
        return this.request(path, { ...options, method: 'GET' });
    }

    post(path, body, options = {}) {
        return this.request(path, { ...options, method: 'POST', body });
    }

    async upload(fileOrFiles, options = {}) {
        const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
        const formData = new FormData();
        files.filter(Boolean).forEach((file, index) => {
            formData.append(index === 0 ? 'image' : 'images', file, file.name || `upload-${index}`);
        });
        return this.post('/api/upload', formData, options);
    }

    async readUpload(uploadId, options = {}) {
        if (!uploadId || typeof uploadId !== 'string') {
            throw new ApiClientError('An opaque uploadId is required.', { code: 'UPLOAD_ID_REQUIRED' });
        }
        return this.get(`/uploads/${encodeURIComponent(uploadId)}`, {
            ...options,
            responseType: 'blob'
        });
    }

    async uploadObjectUrl(uploadId, options = {}) {
        const blob = await this.readUpload(uploadId, options);
        if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
        return URL.createObjectURL(blob);
    }

    async socketAuth() {
        return { token: await this.verifiedToken() };
    }

    socketUrl() {
        return this.baseUrl || defaultBaseUrl() || undefined;
    }
}

export function createApiClient(options = {}) {
    return new ApiClient(options);
}

export const apiClient = createApiClient();

export function getApiClient() {
    return apiClient;
}

if (typeof window !== 'undefined') {
    window.GPACEApiClient = ApiClient;
    window.gpaceApiClient = apiClient;
}
