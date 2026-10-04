/**
 * API Settings Management
 * Shared functionality for managing API keys across the application
 * Uses SecureStorage for encrypted API key storage
 */

// Storage helper with fallback (use existing or create new)
if (typeof window.getStorage === 'undefined') {
    window.getStorage = () => window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };
}
var getStorage = window.getStorage;

const getSecureStorage = () => window.SecureStorage || {
    getSecure: async (k, d) => localStorage.getItem(k) || d,
    setSecure: async (k, v) => { localStorage.setItem(k, v); return true; }
};

// Toggle API key visibility between password and text
function toggleApiVisibility(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const button = input.nextElementSibling;
    const icon = button?.querySelector('i');

    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.classList.replace('bi-eye', 'bi-eye-slash');
    } else {
        input.type = 'password';
        if (icon) icon.classList.replace('bi-eye-slash', 'bi-eye');
    }
}

// Open API settings modal
function openApiSettings() {
    const modalElement = document.getElementById('apiSettingsModal');
    if (!modalElement) {
        console.warn('[API Settings] Modal element not found');
        return;
    }

    // Create modal instance if using Bootstrap 5
    if (window.bootstrap) {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
    } else {
        // Fallback for custom modal implementation
        modalElement.style.display = 'block';
    }

    // Load saved API keys
    loadSavedApiKeys();
}

// Load saved API keys from secure storage
async function loadSavedApiKeys() {
    const storage = getStorage();
    const secureStorage = getSecureStorage();

    try {
        // Load API keys from secure storage
        const geminiKey = await secureStorage.getSecure('geminiApiKey', '');
        if (geminiKey) {
            const el = document.getElementById('geminiApiKey');
            if (el) el.value = geminiKey;
        }

        const wolframKey = await secureStorage.getSecure('wolframAlphaApiKey', '');
        if (wolframKey) {
            const el = document.getElementById('wolframAlphaApiKey');
            if (el) el.value = wolframKey;
        }

        const tavilyKey = await secureStorage.getSecure('tavilyApiKey', '');
        if (tavilyKey) {
            const el = document.getElementById('tavilyApiKey');
            if (el) el.value = tavilyKey;
        }

        // Load non-sensitive settings from regular storage
        const geminiModel = storage.get('api.geminiModel', 'gemini-3.8-flash');
        const el1 = document.getElementById('geminiModel');
        if (el1) el1.value = geminiModel;

        const temperature = storage.get('api.geminiTemperature', 0.4);
        const el2 = document.getElementById('geminiTemperature');
        if (el2) {
            el2.value = temperature;
            updateTemperatureDisplay(temperature);
        }

        const apiQuota = storage.get('api.dailyQuota', 100);
        const el3 = document.getElementById('apiQuota');
        if (el3) el3.value = apiQuota;

    } catch (error) {
        console.error('[API Settings] Error loading saved keys:', error);
    }
}

// Update temperature display based on slider value
function updateTemperatureDisplay(value) {
    const temperatureDisplay = document.getElementById('temperatureDisplay');
    if (!temperatureDisplay) return;

    let description = '';

    // Get description based on value
    if (value <= 0.2) {
        description = 'Precise';
    } else if (value <= 0.4) {
        description = 'Balanced';
    } else if (value <= 0.7) {
        description = 'Varied';
    } else {
        description = 'Creative';
    }

    temperatureDisplay.textContent = `${description} (${value})`;
}

// Save API keys to secure storage
async function saveApiKeys() {
    const storage = getStorage();
    const secureStorage = getSecureStorage();

    // Get values from form
    const geminiKey = document.getElementById('geminiApiKey')?.value?.trim() || '';
    const wolframKey = document.getElementById('wolframAlphaApiKey')?.value?.trim() || '';
    const tavilyKey = document.getElementById('tavilyApiKey')?.value?.trim() || '';
    const geminiModel = document.getElementById('geminiModel')?.value || 'gemini-3.8-flash';
    const temperature = document.getElementById('geminiTemperature')?.value || '0.4';
    const apiQuota = document.getElementById('apiQuota')?.value || '100';

    // Validate at least one API key is provided
    if (!geminiKey && !wolframKey && !tavilyKey) {
        showApiStatus('Please enter at least one API key', 'danger');
        return;
    }

    try {
        // Save API keys to secure storage (encrypted)
        if (geminiKey) {
            await secureStorage.setSecure('geminiApiKey', geminiKey);
            if (window.apiKeys) window.apiKeys.gemini = geminiKey;
        }

        if (wolframKey) {
            await secureStorage.setSecure('wolframAlphaApiKey', wolframKey);
            if (window.apiKeys) window.apiKeys.wolframAlpha = wolframKey;
        }

        if (tavilyKey) {
            await secureStorage.setSecure('tavilyApiKey', tavilyKey);
            if (window.apiKeys) window.apiKeys.tavily = tavilyKey;
        }

        // Save non-sensitive settings to regular storage
        storage.set('api.geminiModel', geminiModel);
        storage.set('api.geminiTemperature', parseFloat(temperature));

        if (window.apiKeys) {
            window.apiKeys.geminiModel = geminiModel;
            window.apiKeys.temperature = parseFloat(temperature);
        }

        // Save API quota
        if (apiQuota && !isNaN(parseInt(apiQuota))) {
            storage.set('api.dailyQuota', parseInt(apiQuota));
            if (window.apiOptimization) {
                window.apiOptimization.dailyQuota = parseInt(apiQuota);
            }
        }

        // Show success message
        const modelDisplayName = geminiModel.replace('gemini-', 'Gemini ').replace('-exp-03-25', '');
        const temperatureDesc = getTemperatureDescription(temperature);
        showApiStatus(`API settings saved securely! Using ${modelDisplayName} with ${temperatureDesc} responses.`, 'success');

        // Close modal after a delay
        setTimeout(() => {
            if (window.bootstrap) {
                const modalElement = document.getElementById('apiSettingsModal');
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) {
                    modal.hide();
                }
            } else {
                const modalEl = document.getElementById('apiSettingsModal');
                if (modalEl) modalEl.style.display = 'none';
            }

            // Show notification
            if (window.showNotification) {
                window.showNotification(`API settings updated. Using ${modelDisplayName} with ${temperatureDesc} responses.`, 'success');
            }
        }, 1500);

    } catch (error) {
        console.error('[API Settings] Error saving keys:', error);
        showApiStatus('Error saving API settings. Please try again.', 'danger');
    }
}

// Show API status message
function showApiStatus(message, type) {
    const statusDiv = document.getElementById('apiKeyStatus');
    if (!statusDiv) {
        console.log(`[API Settings] ${type}: ${message}`);
        return;
    }

    statusDiv.className = `alert alert-${type}`;
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';

    // Hide after 5 seconds
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 5000);

    // Also show a notification if showNotification is available
    if (typeof window.showNotification === 'function') {
        window.showNotification(message, type);
    }
}

// Helper function to get temperature description
function getTemperatureDescription(temp) {
    temp = parseFloat(temp);
    if (temp <= 0.2) return 'precise';
    if (temp <= 0.4) return 'balanced';
    if (temp <= 0.7) return 'varied';
    return 'creative';
}

// Migrate legacy plain-text API keys to secure storage
async function migrateLegacyApiKeys() {
    const secureStorage = getSecureStorage();

    const legacyKeys = [
        'geminiApiKey',
        'wolframAlphaApiKey',
        'tavilyApiKey'
    ];

    for (const key of legacyKeys) {
        const plainValue = localStorage.getItem(key);
        if (plainValue && !plainValue.startsWith('ENC:') && !plainValue.startsWith('OBF:')) {
            console.log(`[API Settings] Migrating ${key} to secure storage...`);
            await secureStorage.setSecure(key, plainValue);
            localStorage.removeItem(key);
        }
    }
}

// Run migration on load
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        migrateLegacyApiKeys().catch(console.error);
    });
}

// Make functions available globally
window.toggleApiVisibility = toggleApiVisibility;
window.openApiSettings = openApiSettings;
window.loadSavedApiKeys = loadSavedApiKeys;
window.updateTemperatureDisplay = updateTemperatureDisplay;
window.saveApiKeys = saveApiKeys;
window.showApiStatus = showApiStatus;
window.getTemperatureDescription = getTemperatureDescription;
// Fetch available models from Gemini API
async function fetchAvailableModels() {
    const secureStorage = getSecureStorage();
    const apiKey = await secureStorage.getSecure('geminiApiKey', '');
    const modelSelect = document.getElementById('geminiModel');
    const statusDiv = document.getElementById('modelFetchStatus') || createModelStatusDiv();

    if (!apiKey) {
        showApiStatus('Please save your API key first.', 'warning');
        return;
    }

    try {
        statusDiv.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Fetching models...';
        statusDiv.className = 'text-primary mt-1 small';
        statusDiv.style.display = 'block';

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();

        if (data.models && Array.isArray(data.models)) {
            // Filter for generateContent support
            const contentModels = data.models.filter(m =>
                m.supportedGenerationMethods &&
                m.supportedGenerationMethods.includes('generateContent')
            );

            // Sort: Pro models first, then Flash, then others. Newest versions first.
            contentModels.sort((a, b) => {
                const nameA = a.name.split('/').pop();
                const nameB = b.name.split('/').pop();

                // Prioritize newer versions (higher numbers)
                const versionA = parseFloat(nameA.match(/\d+(\.\d+)?/)?.[0] || 0);
                const versionB = parseFloat(nameB.match(/\d+(\.\d+)?/)?.[0] || 0);

                if (versionA !== versionB) return versionB - versionA; // Descending version

                // Prioritize Pro over Flash
                if (nameA.includes('pro') && !nameB.includes('pro')) return -1;
                if (!nameA.includes('pro') && nameB.includes('pro')) return 1;

                return nameA.localeCompare(nameB);
            });

            // Update select dropdown
            if (modelSelect) {
                const currentVal = modelSelect.value;
                modelSelect.innerHTML = '';

                contentModels.forEach(model => {
                    const modelId = model.name.split('/').pop(); // "models/gemini-pro" -> "gemini-pro"
                    const option = document.createElement('option');
                    option.value = modelId;
                    option.textContent = `${model.displayName || modelId} (${modelId})`;
                    modelSelect.appendChild(option);
                });

                // Restore selection if it still exists, otherwise select first
                if (Array.from(modelSelect.options).some(o => o.value === currentVal)) {
                    modelSelect.value = currentVal;
                } else {
                    // Try to select a flash model by default if current invalid
                    const defaultModel = contentModels.find(m => m.name.includes('flash'))?.name.split('/').pop();
                    if (defaultModel) modelSelect.value = defaultModel;
                }
            }

            statusDiv.textContent = `Success! Found ${contentModels.length} models.`;
            statusDiv.className = 'text-success mt-1 small';
            setTimeout(() => statusDiv.style.display = 'none', 3000);
            showApiStatus('Model list updated from Google API!', 'success');
        }

    } catch (error) {
        console.error('Failed to fetch models:', error);
        statusDiv.textContent = 'Failed to fetch model list.';
        statusDiv.className = 'text-danger mt-1 small';
        showApiStatus('Could not fetch models. Check API Key.', 'danger');
    }
}

function createModelStatusDiv() {
    const parent = document.getElementById('geminiModel')?.parentNode;
    if (parent) {
        const div = document.createElement('div');
        div.id = 'modelFetchStatus';
        parent.appendChild(div);
        return div;
    }
    return { style: {}, innerHTML: '', textContent: '', className: '' }; // Dummy
}

window.fetchAvailableModels = fetchAvailableModels;
window.migrateLegacyApiKeys = migrateLegacyApiKeys;
