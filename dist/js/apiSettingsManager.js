/**
 * API Settings Manager Module
 * Handles API key management and related UI interactions for Grind Station
 * Fully integrated with GeminiKeyManager smart rotation pool
 */

async function getGeminiKeyManager() {
    if (typeof window !== 'undefined' && window.geminiKeyManager) {
        return window.geminiKeyManager;
    }
    try {
        const mod = await import('./GeminiKeyManager.js');
        return mod.geminiKeyManager || (typeof window !== 'undefined' ? window.geminiKeyManager : null);
    } catch (e) {
        return typeof window !== 'undefined' ? window.geminiKeyManager : null;
    }
}

function getGpaceApiClient() {
    if (window.gpaceApiClient) return Promise.resolve(window.gpaceApiClient);
    if (!window.__gpaceApiClientPromise) {
        const moduleUrl = new URL('/js/services/ApiClient.js', window.location.origin).href;
        window.__gpaceApiClientPromise = import(moduleUrl).then(({ getApiClient }) => getApiClient());
    }
    return window.__gpaceApiClientPromise;
}

// Get secure storage with fallback
const getSecureStorage = () => window.SecureStorage || {
    getSecure: async (k, d) => localStorage.getItem(k) || d,
    setSecure: async (k, v) => { localStorage.setItem(k, v); return true; }
};

function updateModalBadge(keyManager) {
    const badge = document.getElementById('geminiModalKeyCountBadge');
    if (!badge || !keyManager) return;

    const status = keyManager.getStatus();
    if (status.healthyKeys > 0) {
        badge.textContent = `${status.healthyKeys} ${status.healthyKeys === 1 ? 'key' : 'keys'} active`;
        badge.className = 'badge bg-success';
    } else if (status.rateLimitedCount > 0) {
        badge.textContent = `${status.rateLimitedCount} ${status.rateLimitedCount === 1 ? 'key' : 'keys'} in cooldown`;
        badge.className = 'badge bg-warning text-dark';
    } else {
        badge.textContent = '0 keys active';
        badge.className = 'badge bg-secondary';
    }
}

// Open API settings modal
async function openApiSettings() {
    const modalElement = document.getElementById('apiSettingsModal');
    if (!modalElement) return;

    let modal = bootstrap.Modal.getInstance(modalElement);
    if (!modal) {
        modal = new bootstrap.Modal(modalElement);
    }

    const keyManager = await getGeminiKeyManager();
    const textarea = document.getElementById('geminiApiKeys');

    if (keyManager) {
        if (textarea) {
            textarea.value = keyManager.getKeysAsText();
        }
        updateModalBadge(keyManager);
    } else {
        const secureStorage = getSecureStorage();
        const savedKey = await secureStorage.getSecure('geminiApiKey');
        if (savedKey && textarea) {
            textarea.value = savedKey;
        }
    }

    // Hide any previous status
    const statusDiv = document.getElementById('apiKeyStatus');
    if (statusDiv) {
        statusDiv.classList.add('d-none');
    }

    modal.show();
}

// Toggle API key visibility (if single input present)
function toggleApiKeyVisibility(fieldId) {
    const id = fieldId || 'geminiApiKey';
    const input = document.getElementById(id);
    if (!input) return;

    const icon = input.parentElement?.querySelector('button i');
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.className = 'bi bi-eye-slash';
    } else {
        input.type = 'password';
        if (icon) icon.className = 'bi bi-eye';
    }
}

// Save and validate API key pool
async function saveApiKey() {
    const textarea = document.getElementById('geminiApiKeys');
    const singleInput = document.getElementById('geminiApiKey');
    const rawKeys = textarea ? textarea.value : (singleInput?.value || '');

    if (!rawKeys.trim()) {
        showStatus('Please enter at least one Gemini API key (starts with "AIza").', 'danger');
        return;
    }

    const keyManager = await getGeminiKeyManager();
    if (keyManager) {
        try {
            const parseResult = await keyManager.parseAndSetKeys(rawKeys);
            updateModalBadge(keyManager);

            if (parseResult.validCount > 0) {
                let msg = `Successfully saved ${parseResult.validCount} API key${parseResult.validCount > 1 ? 's' : ''} to rotating pool!`;
                if (parseResult.duplicatesRemoved > 0) {
                    msg += ` (${parseResult.duplicatesRemoved} duplicate${parseResult.duplicatesRemoved > 1 ? 's' : ''} removed)`;
                }
                if (parseResult.invalidCount > 0) {
                    msg += ` (${parseResult.invalidCount} invalid format${parseResult.invalidCount > 1 ? 's' : ''} ignored)`;
                }
                showStatus(msg, 'success');
            } else {
                showStatus('No valid Gemini API keys found. Keys must begin with "AIza".', 'danger');
            }
        } catch (e) {
            showStatus(`Error saving API keys: ${e.message}`, 'danger');
        }
        return;
    }

    // Fallback for environment without keyManager
    try {
        const client = await getGpaceApiClient();
        const primaryKey = rawKeys.split(/[\r\n,]+/)[0]?.trim();
        const result = await client.post('/api/test-api-key', { apiKey: primaryKey });

        if (result.success) {
            const secureStorage = getSecureStorage();
            await secureStorage.setSecure('geminiApiKey', primaryKey);
            showStatus('API key validated and saved successfully!', 'success');
        } else {
            showStatus('Invalid API key. Please check and try again.', 'danger');
        }
    } catch (error) {
        showStatus('Error saving API key. Please try again.', 'danger');
    }
}

// Show status message in the API settings modal without inline styles
function showStatus(message, type) {
    const statusDiv = document.getElementById('apiKeyStatus');
    if (!statusDiv) return;

    statusDiv.className = `alert alert-${type}`;
    statusDiv.textContent = message;
    statusDiv.classList.remove('d-none');
}

// Show error toast notification
function showErrorToast(message) {
    const toastEl = document.getElementById('errorToast');
    if (!toastEl) return;
    const toast = new bootstrap.Toast(toastEl);
    toastEl.querySelector('.toast-body').textContent = message;
    toast.show();
}

// Initialize API settings manager
function initializeApiSettingsManager() {
    const apiSettingsBtn = document.getElementById('apiSettingsBtn');
    if (apiSettingsBtn) {
        apiSettingsBtn.addEventListener('click', openApiSettings);
    }

    const toggleVisibilityBtn = document.getElementById('toggleApiKeyBtn');
    if (toggleVisibilityBtn) {
        toggleVisibilityBtn.addEventListener('click', () => toggleApiKeyVisibility('geminiApiKey'));
    }

    const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    if (saveApiKeyBtn) {
        saveApiKeyBtn.addEventListener('click', saveApiKey);
    }

    // Real-time synchronization when keys are updated from another view/tab
    if (typeof window !== 'undefined') {
        window.addEventListener('geminiKeysUpdated', async () => {
            const keyManager = await getGeminiKeyManager();
            if (keyManager) {
                const textarea = document.getElementById('geminiApiKeys');
                if (textarea && document.activeElement !== textarea) {
                    textarea.value = keyManager.getKeysAsText();
                }
                updateModalBadge(keyManager);
            }
        });
    }

    // Check key configuration on page load
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            const keyManager = await getGeminiKeyManager();
            let hasKeys = false;
            if (keyManager) {
                hasKeys = keyManager.getHealthyKeys().length > 0;
            } else {
                const secureStorage = getSecureStorage();
                const savedKey = await secureStorage.getSecure('geminiApiKey');
                hasKeys = Boolean(savedKey);
            }

            if (!hasKeys) {
                showErrorToast('Please configure your Gemini API keys in settings to enable AI features.');
            }
        } catch (e) {
            console.warn('[apiSettingsManager] Check key configuration error:', e);
        }
    });
}

// Initialize when DOM is ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeApiSettingsManager);
    } else {
        initializeApiSettingsManager();
    }
}

// Export functions for global use
if (typeof window !== 'undefined') {
    window.openApiSettings = openApiSettings;
    window.toggleApiKeyVisibility = toggleApiKeyVisibility;
    window.saveApiKey = saveApiKey;
    window.showErrorToast = showErrorToast;
}

export { openApiSettings, saveApiKey, toggleApiKeyVisibility, showErrorToast };
