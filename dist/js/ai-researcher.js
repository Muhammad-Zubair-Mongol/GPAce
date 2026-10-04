/**
 * Browser research and simulation controls.
 *
 * Provider calls belong to the authenticated research gateway.  This module
 * keeps provider credentials out of browser-to-provider traffic and uses the
 * shared ApiClient for identity, deadlines, and typed failures.
 */
import { ApiClientError, getApiClient } from './services/ApiClient.js';

const getStorage = () => {
    if (typeof window !== 'undefined' && typeof window.getStorage === 'function') {
        return window.getStorage();
    }
    return {
        get: (key, fallback) => {
            try {
                const value = globalThis.localStorage?.getItem(key);
                return value == null ? fallback : JSON.parse(value);
            } catch {
                return fallback;
            }
        },
        set: (key, value) => {
            try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
        }
    };
};

const getSecureStorage = () => (typeof window !== 'undefined' && window.SecureStorage) || {
    getSecure: async (key, fallback = '') => {
        try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
    },
    setSecure: async (key, value) => {
        try { localStorage.setItem(key, value); return true; } catch { return false; }
    }
};

const apiKeys = {
    gemini: '',
    gemini2: '',
    gemini3: '',
    wolframAlpha: '',
    tavily: '',
    geminiModel: 'gemini-3.8-flash',
    temperature: 0.4
};
let apiKeysLoaded = false;
let uploadedImage = null;
let uploadedPdf = null;
let researchInFlight = false;
let lastSearchTimestamp = 0;
const researchCache = new Map();
const MIN_SEARCH_INTERVAL = 2000;

if (typeof window !== 'undefined') window.apiKeys = apiKeys;

function el(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderMarkdown(value) {
    const text = String(value || '');
    const marked = typeof window !== 'undefined' && window.marked;
    if (marked && typeof marked.parse === 'function') return marked.parse(text);
    return escapeHtml(text).replace(/\n/g, '<br>');
}

function showNotification(message, type = 'info') {
    if (typeof window !== 'undefined' && typeof window.showNotification === 'function') {
        window.showNotification(message, type);
        return;
    }
    const status = el('apiKeyStatus') || el('researchStatus');
    if (status) {
        status.textContent = message;
        status.dataset.type = type;
    }
    if (type === 'error') console.error(message);
}

function getTemperatureDescription(temp) {
    const value = Number(temp);
    if (value < 0.3) return 'precise';
    if (value < 0.7) return 'balanced';
    return 'creative';
}

function updateTemperatureDisplay(value) {
    const display = el('temperatureValue') || el('geminiTemperatureValue');
    if (display) display.textContent = Number(value).toFixed(1);
}

async function loadApiKeys() {
    const storage = getStorage();
    const secureStorage = getSecureStorage();

    // These values remain UI preferences. Provider requests use the backend
    // gateway and never use these browser values as a direct SDK credential.
    apiKeys.gemini = await secureStorage.getSecure('geminiApiKey', '');
    apiKeys.gemini2 = await secureStorage.getSecure('geminiApiKey2', '');
    apiKeys.gemini3 = await secureStorage.getSecure('geminiApiKey3', '');
    apiKeys.wolframAlpha = await secureStorage.getSecure('wolframAlphaApiKey', '');
    apiKeys.tavily = await secureStorage.getSecure('tavilyApiKey', '');
    apiKeys.geminiModel = storage.get('api.geminiModel', storage.get('geminiModel', apiKeys.geminiModel));
    apiKeys.temperature = Number(storage.get('api.geminiTemperature', storage.get('geminiTemperature', apiKeys.temperature))) || 0.4;
    apiKeysLoaded = true;

    const model = el('geminiModel');
    const temperature = el('geminiTemperature');
    if (model) model.value = apiKeys.geminiModel;
    if (temperature) temperature.value = apiKeys.temperature;
    updateTemperatureDisplay(apiKeys.temperature);
    return apiKeys;
}

async function ensureApiKeysLoaded() {
    return apiKeysLoaded ? apiKeys : loadApiKeys();
}

function toggleApiVisibility(inputId = 'geminiApiKey') {
    const input = el(inputId);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    const icon = input.parentElement?.querySelector('button i');
    if (icon) icon.className = input.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
}

function toggleApiConfig() {
    const section = el('apiConfigSection');
    if (section) {
        section.style.display = section.style.display === 'none' ? 'block' : 'none';
        return;
    }
    const panel = el('apiConfigPanel') || document.querySelector('.api-config-panel');
    if (panel) panel.classList.toggle('visible');
}

async function saveApiKeys() {
    const apiKeyInput = el('geminiApiKey');
    const apiKey = apiKeyInput?.value?.trim();
    if (!apiKey) {
        showNotification('Please enter an API key.', 'error');
        return;
    }
    try {
        const client = getApiClient();
        const result = await client.post('/api/test-api-key', { apiKey });
        if (!result || result.success === false) throw new Error('The backend rejected the key.');
        const secureStorage = getSecureStorage();
        await secureStorage.setSecure('geminiApiKey', apiKey);
        showNotification('API key validated by the backend.', 'success');
    } catch (error) {
        if (error instanceof ApiClientError && error.authFailure) {
            showNotification('Please sign in again. The entered key remains in the form.', 'error');
        } else if (error instanceof ApiClientError && error.status === 404) {
            showNotification('The deployed backend does not expose key testing yet.', 'warning');
        } else {
            showNotification('The backend could not validate this key.', 'error');
        }
    }
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function handleFileSelect(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        uploadedPdf = file;
        uploadedImage = null;
    } else if (file.type.startsWith('image/')) {
        uploadedImage = file;
        uploadedPdf = null;
    }
    const preview = el('selectedFileName');
    if (preview) preview.textContent = file.name;
    if (el('fileInfo')) el('fileInfo').style.display = 'flex';
    if (el('clearImage')) el('clearImage').style.display = 'inline-flex';
}

function clearSelectedImage() {
    uploadedImage = null;
    uploadedPdf = null;
    const imageInput = el('imageUpload');
    const pdfInput = el('pdfUpload');
    if (imageInput) imageInput.value = '';
    if (pdfInput) pdfInput.value = '';
    const preview = el('selectedFileName');
    if (preview) preview.textContent = '';
    if (el('fileInfo')) el('fileInfo').style.display = 'none';
}

async function uploadResearchAttachment(client) {
    const file = uploadedImage || uploadedPdf;
    if (!file) return null;
    const result = await client.upload(file);
    return result?.uploads?.[0]?.uploadId || null;
}

function researchQuery() {
    return el('searchQuery')?.value?.trim() || '';
}

async function performAISearch() {
    const query = researchQuery();
    if (!query && !uploadedImage && !uploadedPdf) {
        showNotification('Enter a research question or choose an attachment.', 'error');
        return null;
    }
    if (researchInFlight) return null;
    if (Date.now() - lastSearchTimestamp < MIN_SEARCH_INTERVAL) {
        showNotification('Please wait a moment before submitting another query.', 'warning');
        return null;
    }
    researchInFlight = true;
    lastSearchTimestamp = Date.now();
    const results = el('searchResults');
    if (results?.closest('.results-area')) results.closest('.results-area').style.display = 'block';
    if (results) results.innerHTML = '<p class="research-status">Researching securely…</p>';
    try {
        await ensureApiKeysLoaded();
        const client = getApiClient();
        const uploadId = await uploadResearchAttachment(client);
        const requestQuery = query || 'Analyze the uploaded study material.';
        const cached = !uploadId && researchCache.get(requestQuery);
        const result = cached || await client.post('/api/research', {
            query: requestQuery,
            modelName: apiKeys.geminiModel,
            temperature: apiKeys.temperature,
            mode: 'gemini',
            ...(uploadId ? { uploadId } : {})
        });
        const message = result?.message || result?.text || 'No research response was returned.';
        if (!uploadId) researchCache.set(requestQuery, result);
        if (results) results.innerHTML = `<div class="research-response">${renderMarkdown(message)}</div>`;
        ['copyResultsBtn', 'downloadResultsPdfBtn', 'speakResultsBtn'].forEach(id => { if (el(id)) el(id).disabled = false; });
        showNotification(`Research completed using ${apiKeys.geminiModel}.`, 'success');
        return result;
    } catch (error) {
        if (results) results.innerHTML = '';
        if (error instanceof ApiClientError && error.authFailure) {
            showNotification('Please sign in again. Your research question remains in the form.', 'error');
        } else {
            showNotification(error?.message || 'Research could not be completed.', 'error');
        }
        return null;
    } finally {
        researchInFlight = false;
    }
}

function extractCodeBlock(text) {
    const match = String(text || '').match(/```(?:html|javascript|js)?\s*([\s\S]*?)```/i);
    return (match ? match[1] : String(text || '')).trim();
}

async function generateSimulation() {
    const query = researchQuery() || 'Create an interactive educational simulation for the current study topic.';
    const frame = el('simulationFrame');
    const container = el('simulationContainer');
    const code = el('simulationCode');
    const progress = el('simulationProgress');
    try {
        await ensureApiKeysLoaded();
        if (container) container.style.display = 'block';
        if (progress) progress.style.display = 'block';
        const result = await getApiClient().post('/api/research', {
            query: `${query}\n\nReturn a self-contained HTML simulation in a fenced html block.`,
            modelName: apiKeys.geminiModel,
            temperature: apiKeys.temperature,
            mode: 'gemini'
        });
        const source = extractCodeBlock(result?.message || '');
        if (!source) throw new Error('The backend returned no simulation source.');
        if (code) code.textContent = source;
        if (frame) await renderSimulation(source, frame);
        const ready = el('simulationReadyMessage');
        if (ready) ready.style.display = 'none';
        showNotification('Simulation generated through the authenticated research gateway.', 'success');
        return source;
    } catch (error) {
        if (error instanceof ApiClientError && error.authFailure) {
            showNotification('Please sign in again. The simulation request was retained.', 'error');
        } else {
            showNotification(error?.message || 'Simulation generation failed.', 'error');
        }
        return null;
    } finally {
        if (progress) progress.style.display = 'none';
    }
}

function createSimulationToken() {
    const random = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
        ? Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('')
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `gpace-${random}`;
}

// Generated frame markup is intentionally equivalent to <iframe sandbox="allow-scripts">.
function buildSimulationSource(source, token) {
    const safeToken = JSON.stringify(String(token));
    const readyScript = `<script>(function(){const token=${safeToken};const ready=()=>window.parent.postMessage({source:'gpace-simulation',type:'ready',token},'*');if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',ready,{once:true});}else{ready();}})();<\/script>`;
    const html = String(source || '');
    return html.includes('</body>')
        ? html.replace('</body>', `${readyScript}</body>`)
        : `${html}${readyScript}`;
}

function renderSimulation(source, iframe = el('simulationFrame'), options = {}) {
    if (!iframe) return Promise.reject(new Error('Simulation frame is unavailable.'));
    const windowRef = options.windowRef || (typeof window !== 'undefined' ? window : null);
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : 5000;
    if (!windowRef || typeof windowRef.addEventListener !== 'function') {
        return Promise.reject(new Error('Simulation message channel is unavailable.'));
    }

    const token = createSimulationToken();
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.dataset.simulationToken = token;
    iframe.srcdoc = buildSimulationSource(source, token);
    iframe.style.display = 'block';

    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            windowRef.removeEventListener('message', onMessage);
            callback(value);
        };
        const onMessage = (event) => {
            const data = event?.data;
            if (!event || event.source !== iframe.contentWindow || event.origin !== 'null') return;
            if (!data || data.source !== 'gpace-simulation' || data.type !== 'ready' || data.token !== token) return;
            finish(resolve, { iframe, token });
        };
        const timer = setTimeout(() => {
            finish(reject, new Error(`Simulation ready handshake timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
        windowRef.addEventListener('message', onMessage);
    });
}

function showSimulationFailure(error) {
    const message = error?.message || 'Simulation could not be started.';
    showNotification(message, 'error');
    return null;
}

async function runSimulation() {
    try {
        const frame = el('simulationFrame');
        const retryButton = el('runSimulationBtn');
        if (!frame?.srcdoc) throw new Error('No simulation code is available. Generate the simulation again.');
        if (retryButton) delete retryButton.dataset.action;
        frame.style.display = 'block';
        return frame;
    } catch (error) {
        const retryButton = el('runSimulationBtn');
        if (retryButton) retryButton.dataset.action = 'retry-simulation';
        return showSimulationFailure(error);
    }
}

// Helper function to escape HTML

function closeSimulation() {
    const container = el('simulationContainer');
    const frame = el('simulationFrame');
    if (container) container.style.display = 'none';
    if (frame) frame.srcdoc = '';
}

// Copy simulation code to clipboard
async function copySimulationCode() {
    const value = el('simulationCode')?.textContent || '';
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    showNotification('Simulation code copied.', 'success');
}

async function copySearchResults() {
    const value = el('searchResults')?.innerText || '';
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    showNotification('Research copied.', 'success');
}

function downloadSimulation() {
    const source = el('simulationCode')?.textContent || '';
    if (!source) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([source], { type: 'text/html' }));
    link.download = 'gpace-simulation.html';
    link.click();
    URL.revokeObjectURL(link.href);
}

function downloadSearchResultsAsPdf() {
    window.print?.();
}

function toggleResultsExpansion() {
    const panel = el('aiResearcherPanel');
    panel?.classList.toggle('expanded');
    el('resultsToggleBtn')?.setAttribute('aria-expanded', String(panel?.classList.contains('expanded')));
}

function toggleAIContainer() {
    const container = document.querySelector('.ai-researcher-container');
    if (container) container.classList.toggle('hidden');
}

function ensureLatexRendering() {
    if (typeof window !== 'undefined' && typeof window.renderMathJax === 'function') {
        window.renderMathJax(document);
    }
}

function openResearchAttachment(file) {
    if (!file) return;
    handleFileSelect({ target: { files: [file] } });
}

// Keep the old page-level names available while routing behavior through the
// secured client. The module is safe to load more than once.
if (typeof window !== 'undefined') {
    Object.assign(window, {
        apiKeys,
        toggleApiVisibility,
        saveApiKeys,
        performAISearch,
        toggleApiConfig,
        clearSelectedImage,
        toggleResultsExpansion,
        generateSimulation,
        renderSimulation,
        runSimulation,
        copySimulationCode,
        closeSimulation,
        toggleAIContainer,
        copySearchResults,
        downloadSearchResultsAsPdf,
        downloadSimulation,
        ensureLatexRendering,
        handleFileSelect,
        openResearchAttachment
    });
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', async () => {
        await ensureApiKeysLoaded();
        el('imageUpload')?.addEventListener('change', handleFileSelect);
        el('pdfUpload')?.addEventListener('change', handleFileSelect);
        el('generateSimulationBtn')?.addEventListener('click', generateSimulation);
        el('runSimulationBtn')?.addEventListener('click', runSimulation);
        el('copySimulationCode')?.addEventListener('click', copySimulationCode);
        el('downloadSimulation')?.addEventListener('click', downloadSimulation);
        el('closeSimulation')?.addEventListener('click', closeSimulation);
        
        el('geminiTemperature')?.addEventListener('input', (event) => {
            apiKeys.temperature = Number(event.target.value) || 0.4;
            updateTemperatureDisplay(apiKeys.temperature);
        });
    });
}

export {
    apiKeys,
    ensureApiKeysLoaded,
    performAISearch,
    generateSimulation,
    renderSimulation,
    saveApiKeys,
    handleFileSelect
};
