/**
 * Settings page entry point.
 *
 * The page intentionally has one owner for startup and user actions.  Optional
 * auth/task services can report their readiness, but settings remain useful
 * offline when a local storage backend is available.
 */

import { injectNavigation } from '../components/NavigationComponent.js';
import { themeManager } from '../themeManager.js';
import geminiKeyManager from '../GeminiKeyManager.js';

const SETTINGS_KEYS = Object.freeze({
    quotes: 'customQuotes',
    roleModels: 'roleModels'
});

const pageState = {
    status: 'idle',
    message: '',
    error: null,
    storage: null,
    initialized: false,
    boundRoot: null,
    boundHandler: null,
    retryHandler: null,
    initializedDocument: null,
    initPromise: null
};

function getRuntimeWindow(explicitWindow) {
    if (explicitWindow) return explicitWindow;
    return typeof window !== 'undefined' ? window : globalThis;
}

function getRuntimeDocument(explicitDocument, runtimeWindow) {
    if (explicitDocument) return explicitDocument;
    return runtimeWindow?.document || (typeof document !== 'undefined' ? document : null);
}

function createLocalStorageAdapter(runtimeWindow) {
    const backend = runtimeWindow?.localStorage || globalThis.localStorage;
    if (!backend) throw new Error('No browser storage backend is available');

    return {
        get(key, fallback) {
            const raw = backend.getItem(key);
            if (raw === null || raw === undefined) return fallback;
            try {
                return JSON.parse(raw);
            } catch {
                return raw;
            }
        },
        set(key, value) {
            backend.setItem(key, JSON.stringify(value));
            return { success: true, status: 'success', value };
        },
        remove(key) {
            backend.removeItem(key);
            return { success: true, status: 'success' };
        }
    };
}

function resolveStorage(runtimeWindow, providedStorage) {
    if (providedStorage) return providedStorage;

    if (runtimeWindow?.StorageAdapter?.getStorage) {
        const storage = runtimeWindow.StorageAdapter.getStorage();
        if (storage) return storage;
    }

    if (runtimeWindow?.StorageService) return runtimeWindow.StorageService;

    if (typeof runtimeWindow?.getStorage === 'function') {
        const storage = runtimeWindow.getStorage();
        if (storage) return storage;
    }

    return createLocalStorageAdapter(runtimeWindow);
}

function unwrapStorageValue(value, fallback) {
    if (value && typeof value === 'object' && 'success' in value && 'value' in value) {
        return value.success ? value.value : fallback;
    }
    return value === undefined ? fallback : value;
}

function readValue(key, fallback) {
    try {
        const value = pageState.storage?.get(key, fallback);
        return unwrapStorageValue(value, fallback);
    } catch (error) {
        throw new Error(`Unable to read ${key}: ${error.message}`);
    }
}

async function writeValue(key, value) {
    if (!pageState.storage || typeof pageState.storage.set !== 'function') {
        throw new Error('Settings storage is unavailable');
    }

    const outcome = await Promise.resolve(pageState.storage.set(key, value));
    if (outcome === false || (outcome && typeof outcome === 'object' &&
        ('success' in outcome || 'ok' in outcome) &&
        outcome.success !== true && outcome.ok !== true)) {
        const status = outcome?.status ? ` (${outcome.status})` : '';
        throw new Error(`Settings save was not committed${status}`);
    }
    return outcome;
}

function findElement(documentRef, id) {
    return documentRef?.getElementById?.(id) || null;
}

function setStatus(documentRef, status, message, showRetry = false) {
    pageState.status = status;
    pageState.message = message;
    const statusElement = findElement(documentRef, 'settingsStatus');
    if (statusElement) {
        statusElement.dataset.state = status;
        statusElement.textContent = message;
    }

    const retryButton = findElement(documentRef, 'settingsRetryBtn');
    if (retryButton) {
        retryButton.hidden = !showRetry;
        retryButton.disabled = !showRetry;
    }
}

function ensureRetryControl(documentRef) {
    if (!documentRef || findElement(documentRef, 'settingsRetryBtn')) return;
    const statusElement = findElement(documentRef, 'settingsStatus');
    if (!statusElement?.parentNode || typeof documentRef.createElement !== 'function') return;

    const retryButton = documentRef.createElement('button');
    retryButton.id = 'settingsRetryBtn';
    retryButton.type = 'button';
    retryButton.className = 'settings-retry-btn';
    retryButton.textContent = 'Retry settings';
    retryButton.hidden = true;
    retryButton.disabled = true;
    statusElement.parentNode.insertBefore(retryButton, statusElement.nextSibling);
}

function setActionAvailability(documentRef, enabled) {
    ['addQuoteBtn', 'addRoleModelBtn', 'saveGeminiKeysBtn', 'clearGeminiKeysBtn'].forEach((id) => {
        const button = findElement(documentRef, id);
        if (button) button.disabled = !enabled;
    });
}

function safeHttpUrl(value) {
    if (!value) return '';
    try {
        const parsed = new URL(String(value), 'https://gpace.invalid');
        if (parsed.origin === 'https://gpace.invalid' && !/^(https?:)?\/\//i.test(String(value))) {
            return '';
        }
        return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : '';
    } catch {
        return '';
    }
}

function makeListMessage(documentRef, text) {
    const element = documentRef.createElement('p');
    element.className = 'settings-empty-state';
    element.textContent = text;
    return element;
}

function renderQuotes(documentRef) {
    const list = findElement(documentRef, 'quoteList');
    if (!list || typeof documentRef.createElement !== 'function') return;

    const quotes = readValue(SETTINGS_KEYS.quotes, []);
    list.replaceChildren();
    if (!Array.isArray(quotes) || quotes.length === 0) {
        list.appendChild(makeListMessage(documentRef, 'No saved quotes yet.'));
        return;
    }

    quotes.forEach((quote, index) => {
        const card = documentRef.createElement('article');
        card.className = 'quote-card';
        card.dataset.index = String(index);

        const text = documentRef.createElement('p');
        text.className = 'quote-text';
        text.textContent = `“${String(quote?.text || '')}”`;
        card.appendChild(text);

        const author = documentRef.createElement('p');
        author.className = 'quote-author';
        author.textContent = `— ${String(quote?.author || 'Unknown author')}`;
        card.appendChild(author);

        const imageUrl = safeHttpUrl(quote?.image);
        if (imageUrl) {
            const image = documentRef.createElement('img');
            image.className = 'quote-image';
            image.src = imageUrl;
            image.alt = 'Quote image';
            card.insertBefore(image, text);
        }

        const deleteButton = documentRef.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'delete-quote';
        deleteButton.dataset.action = 'delete-quote';
        deleteButton.dataset.index = String(index);
        deleteButton.textContent = 'Delete';
        card.appendChild(deleteButton);
        list.appendChild(card);
    });
}

function renderRoleModels(documentRef) {
    const list = findElement(documentRef, 'roleModelList');
    if (!list || typeof documentRef.createElement !== 'function') return;

    const roleModels = readValue(SETTINGS_KEYS.roleModels, []);
    list.replaceChildren();
    if (!Array.isArray(roleModels) || roleModels.length === 0) {
        list.appendChild(makeListMessage(documentRef, 'No role models saved yet.'));
        return;
    }

    roleModels.forEach((model, index) => {
        const card = documentRef.createElement('article');
        card.className = 'role-model-card';
        card.dataset.index = String(index);

        const imageUrl = safeHttpUrl(model?.image);
        if (imageUrl) {
            const image = documentRef.createElement('img');
            image.className = 'role-model-image';
            image.src = imageUrl;
            image.alt = String(model?.name || 'Role model');
            card.appendChild(image);
        }

        const name = documentRef.createElement('h3');
        name.textContent = String(model?.name || 'Unnamed role model');
        card.appendChild(name);

        const deleteButton = documentRef.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'delete-role-model';
        deleteButton.dataset.action = 'delete-role-model';
        deleteButton.dataset.index = String(index);
        deleteButton.textContent = 'Delete';
        card.appendChild(deleteButton);
        list.appendChild(card);
    });
}

function getInputValue(documentRef, id) {
    return String(findElement(documentRef, id)?.value || '').trim();
}

async function addQuote(documentRef) {
    const text = getInputValue(documentRef, 'quoteText');
    const author = getInputValue(documentRef, 'quoteAuthor');
    const image = getInputValue(documentRef, 'quoteImage');
    if (!text || !author) {
        setStatus(documentRef, 'ready', 'Enter quote text and author before saving.');
        return { success: false, reason: 'validation' };
    }

    try {
        const quotes = readValue(SETTINGS_KEYS.quotes, []);
        const nextQuotes = Array.isArray(quotes) ? [...quotes, { text, author, image }] : [{ text, author, image }];
        await writeValue(SETTINGS_KEYS.quotes, nextQuotes);
        renderQuotes(documentRef);
        ['quoteText', 'quoteAuthor', 'quoteImage'].forEach(id => {
            const input = findElement(documentRef, id);
            if (input) input.value = '';
        });
        setStatus(documentRef, 'ready', 'Quote saved.');
        return { success: true };
    } catch (error) {
        setStatus(documentRef, 'degraded', `Quote save pending/failed: ${error.message}`, true);
        return { success: false, reason: 'storage', error };
    }
}

async function addRoleModel(documentRef) {
    const name = getInputValue(documentRef, 'roleModelName');
    const image = getInputValue(documentRef, 'roleModelImage');
    if (!name) {
        setStatus(documentRef, 'ready', 'Enter a role model name before saving.');
        return { success: false, reason: 'validation' };
    }

    try {
        const models = readValue(SETTINGS_KEYS.roleModels, []);
        const nextModels = Array.isArray(models) ? [...models, { name, image, research: null }] : [{ name, image, research: null }];
        await writeValue(SETTINGS_KEYS.roleModels, nextModels);
        renderRoleModels(documentRef);
        ['roleModelName', 'roleModelImage'].forEach(id => {
            const input = findElement(documentRef, id);
            if (input) input.value = '';
        });
        setStatus(documentRef, 'ready', 'Role model saved.');
        return { success: true };
    } catch (error) {
        setStatus(documentRef, 'degraded', `Role model save pending/failed: ${error.message}`, true);
        return { success: false, reason: 'storage', error };
    }
}

async function deleteAt(documentRef, key, index) {
    const numericIndex = Number(index);
    if (!Number.isInteger(numericIndex) || numericIndex < 0) return { success: false, reason: 'validation' };
    try {
        const values = readValue(key, []);
        if (!Array.isArray(values) || numericIndex >= values.length) {
            throw new Error('The saved item no longer exists');
        }
        const nextValues = values.filter((_, candidateIndex) => candidateIndex !== numericIndex);
        await writeValue(key, nextValues);
        if (key === SETTINGS_KEYS.quotes) renderQuotes(documentRef);
        else renderRoleModels(documentRef);
        setStatus(documentRef, 'ready', 'Saved item deleted.');
        return { success: true };
    } catch (error) {
        setStatus(documentRef, 'degraded', `Delete pending/failed: ${error.message}`, true);
        return { success: false, reason: 'storage', error };
    }
}

function renderGeminiKeys(documentRef) {
    const textarea = findElement(documentRef, 'geminiApiKeys');
    const badge = findElement(documentRef, 'geminiKeyCountBadge');
    if (!badge) return;

    const status = geminiKeyManager.getStatus();
    if (textarea && documentRef.activeElement !== textarea) {
        textarea.value = geminiKeyManager.getKeysAsText();
    }

    if (status.healthyKeys > 0) {
        badge.textContent = `${status.healthyKeys} ${status.healthyKeys === 1 ? 'key' : 'keys'} active`;
        badge.className = 'gemini-key-badge badge-active';
    } else if (status.rateLimitedCount > 0) {
        badge.textContent = `${status.rateLimitedCount} ${status.rateLimitedCount === 1 ? 'key' : 'keys'} in cooldown`;
        badge.className = 'gemini-key-badge badge-empty';
    } else {
        badge.textContent = '0 keys active';
        badge.className = 'gemini-key-badge badge-empty';
    }
}

async function saveGeminiKeys(documentRef) {
    const textarea = findElement(documentRef, 'geminiApiKeys');
    const feedback = findElement(documentRef, 'geminiKeyFeedback');
    if (!textarea) return { success: false };

    const rawText = textarea.value;
    try {
        const result = await geminiKeyManager.parseAndSetKeys(rawText);
        renderGeminiKeys(documentRef);

        if (feedback) {
            feedback.hidden = false;
            if (result.validCount > 0) {
                feedback.className = 'gemini-feedback feedback-success';
                let msg = `Successfully saved and validated ${result.validCount} Gemini API key${result.validCount > 1 ? 's' : ''}.`;
                if (result.duplicatesRemoved > 0) {
                    msg += ` (${result.duplicatesRemoved} duplicate${result.duplicatesRemoved > 1 ? 's' : ''} removed)`;
                }
                if (result.invalidCount > 0) {
                    msg += ` Note: ${result.invalidCount} invalid key${result.invalidCount > 1 ? 's were' : ' was'} ignored.`;
                }
                feedback.textContent = msg;
            } else if (!rawText.trim()) {
                feedback.className = 'gemini-feedback feedback-warning';
                feedback.textContent = 'API key pool cleared. Outbound AI features will be disabled until a key is added.';
            } else {
                feedback.className = 'gemini-feedback feedback-error';
                feedback.textContent = 'No valid keys found. Gemini keys must begin with "AIza" followed by 30-45 valid characters.';
            }
        }
        return { success: true, result };
    } catch (error) {
        if (feedback) {
            feedback.hidden = false;
            feedback.className = 'gemini-feedback feedback-error';
            feedback.textContent = `Error saving API keys: ${error.message}`;
        }
        return { success: false, error };
    }
}

async function clearGeminiKeys(documentRef) {
    const textarea = findElement(documentRef, 'geminiApiKeys');
    const feedback = findElement(documentRef, 'geminiKeyFeedback');
    if (textarea) textarea.value = '';

    try {
        await geminiKeyManager.parseAndSetKeys('');
        renderGeminiKeys(documentRef);
        if (feedback) {
            feedback.hidden = false;
            feedback.className = 'gemini-feedback feedback-warning';
            feedback.textContent = 'All API keys removed from pool.';
        }
        return { success: true };
    } catch (error) {
        return { success: false, error };
    }
}

function bindActions(documentRef) {
    const root = findElement(documentRef, 'main-content') || documentRef?.body;
    if (!root || typeof root.addEventListener !== 'function' || root === pageState.boundRoot) return;

    const handler = (event) => {
        const target = event.target?.closest?.('[data-action]');
        if (!target) return;
        const action = target.dataset.action;
        if (action === 'delete-quote') void deleteAt(documentRef, SETTINGS_KEYS.quotes, target.dataset.index);
        if (action === 'delete-role-model') void deleteAt(documentRef, SETTINGS_KEYS.roleModels, target.dataset.index);
    };

    root.addEventListener('click', handler);
    pageState.boundRoot = root;
    pageState.boundHandler = handler;

    const quoteButton = findElement(documentRef, 'addQuoteBtn');
    const roleModelButton = findElement(documentRef, 'addRoleModelBtn');
    if (quoteButton && !quoteButton.dataset.settingsBound) {
        quoteButton.addEventListener('click', () => void addQuote(documentRef));
        quoteButton.dataset.settingsBound = 'true';
    }
    if (roleModelButton && !roleModelButton.dataset.settingsBound) {
        roleModelButton.addEventListener('click', () => void addRoleModel(documentRef));
        roleModelButton.dataset.settingsBound = 'true';
    }

    const saveKeysBtn = findElement(documentRef, 'saveGeminiKeysBtn');
    if (saveKeysBtn && !saveKeysBtn.dataset.settingsBound) {
        saveKeysBtn.addEventListener('click', () => void saveGeminiKeys(documentRef));
        saveKeysBtn.dataset.settingsBound = 'true';
    }

    const clearKeysBtn = findElement(documentRef, 'clearGeminiKeysBtn');
    if (clearKeysBtn && !clearKeysBtn.dataset.settingsBound) {
        clearKeysBtn.addEventListener('click', () => void clearGeminiKeys(documentRef));
        clearKeysBtn.dataset.settingsBound = 'true';
    }

    const retryButton = findElement(documentRef, 'settingsRetryBtn');
    if (retryButton && !retryButton.dataset.settingsBound) {
        pageState.retryHandler = () => void initSettingsPage({ documentRef, windowRef: getRuntimeWindow(), force: true });
        retryButton.addEventListener('click', pageState.retryHandler);
        retryButton.dataset.settingsBound = 'true';
    }
}

async function waitForReadiness(runtimeWindow, timeoutMs = 2500) {
    const readiness = runtimeWindow?.settingsReady || runtimeWindow?.authReady;
    if (!readiness) return { available: true };

    const promise = typeof readiness === 'function' ? readiness() : readiness;
    await Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Settings dependency readiness timed out')), timeoutMs))
    ]);
    return { available: true };
}

function createController(documentRef, runtimeWindow) {
    return {
        get state() {
            return { ...pageState };
        },
        retry() {
            return initSettingsPage({ documentRef, windowRef: runtimeWindow, force: true });
        },
        addQuote: () => addQuote(documentRef),
        addRoleModel: () => addRoleModel(documentRef),
        saveGeminiKeys: () => saveGeminiKeys(documentRef),
        clearGeminiKeys: () => clearGeminiKeys(documentRef),
        destroy() {
            if (pageState.boundRoot && pageState.boundHandler) {
                pageState.boundRoot.removeEventListener?.('click', pageState.boundHandler);
            }
            pageState.boundRoot = null;
            pageState.boundHandler = null;
            pageState.initialized = false;
            pageState.initializedDocument = null;
            pageState.initPromise = null;
        }
    };
}

let activeController = null;

export async function initSettingsPage(options = {}) {
    const runtimeWindow = getRuntimeWindow(options.windowRef);
    const documentRef = getRuntimeDocument(options.documentRef, runtimeWindow);
    if (!documentRef) throw new Error('Settings requires a document');

    if (pageState.initialized && !options.force && pageState.initializedDocument === documentRef) {
        return activeController;
    }
    if (pageState.initPromise && !options.force) return pageState.initPromise;

    ensureRetryControl(documentRef);
    setActionAvailability(documentRef, false);
    setStatus(documentRef, 'loading', 'Loading settings…');

    pageState.initPromise = (async () => {
        try {
            await waitForReadiness(runtimeWindow, options.timeoutMs || 2500);
            pageState.storage = resolveStorage(runtimeWindow, options.storage);
            // Probe the backend before enabling actions. A failing probe is a real
            // degraded state and is never reported as a successful save.
            readValue(SETTINGS_KEYS.quotes, []);
            readValue(SETTINGS_KEYS.roleModels, []);

            activeController = createController(documentRef, runtimeWindow);
            bindActions(documentRef);
            renderQuotes(documentRef);
            renderRoleModels(documentRef);
            renderGeminiKeys(documentRef);

            if (runtimeWindow && !pageState.geminiSyncBound) {
                runtimeWindow.addEventListener('geminiKeysUpdated', () => {
                    renderGeminiKeys(documentRef);
                });
                pageState.geminiSyncBound = true;
            }
            try {
                await themeManager.initializeTheme({ documentRef, windowRef: runtimeWindow, storage: pageState.storage });
            } catch (themeError) {
                console.warn('[settings] Theme initialization unavailable:', themeError.message);
            }
            try {
                injectNavigation({ document: documentRef, window: runtimeWindow, existingNavSelector: '.top-nav', showIcons: true });
            } catch (navigationError) {
                console.warn('[settings] Navigation initialization unavailable:', navigationError.message);
            }
            setActionAvailability(documentRef, true);
            setStatus(documentRef, 'ready', 'Settings ready.');
            pageState.initialized = true;
            pageState.initializedDocument = documentRef;
            return activeController;
        } catch (error) {
            pageState.error = error;
            pageState.initialized = false;
            setActionAvailability(documentRef, false);
            setStatus(documentRef, 'error', `Settings unavailable: ${error.message}`, true);
            bindActions(documentRef);
            return createController(documentRef, runtimeWindow);
        } finally {
            pageState.initPromise = null;
        }
    })();

    return pageState.initPromise;
}

export function getSettingsState() {
    return { ...pageState };
}

export function destroySettingsPage() {
    activeController?.destroy();
    activeController = null;
}

if (typeof document !== 'undefined') {
    const start = () => void initSettingsPage();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}

if (typeof window !== 'undefined') {
    window.initSettingsPage = initSettingsPage;
    window.getSettingsState = getSettingsState;
    window.destroySettingsPage = destroySettingsPage;
}
