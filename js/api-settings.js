/**
 * API Settings Management
 * Shared functionality for managing API keys across the application
 */

// Toggle API key visibility between password and text
function toggleApiVisibility(inputId) {
    const input = document.getElementById(inputId);
    const icon = input.nextElementSibling.querySelector('i');

    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('bi-eye', 'bi-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('bi-eye-slash', 'bi-eye');
    }
}

// Open API settings modal
function openApiSettings() {
    // Get the modal element
    const modalElement = document.getElementById('apiSettingsModal');

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

// Load saved API keys from localStorage
function loadSavedApiKeys() {
    // Load Gemini API key
    const geminiKey = localStorage.getItem('geminiApiKey');
    if (geminiKey) {
        document.getElementById('geminiApiKey').value = geminiKey;
    }

    // Load Wolfram Alpha API key
    const wolframKey = localStorage.getItem('wolframAlphaApiKey');
    if (wolframKey) {
        document.getElementById('wolframAlphaApiKey').value = wolframKey;
    }

    // Load Tavily API key
    const tavilyKey = localStorage.getItem('tavilyApiKey');
    if (tavilyKey) {
        document.getElementById('tavilyApiKey').value = tavilyKey;
    }

    // Load Gemini model
    const geminiModel = localStorage.getItem('geminiModel');
    if (geminiModel) {
        document.getElementById('geminiModel').value = geminiModel;
    }

    // Load temperature setting
    const temperature = localStorage.getItem('geminiTemperature');
    if (temperature) {
        document.getElementById('geminiTemperature').value = temperature;
        updateTemperatureDisplay(temperature);
    }

    // Load API quota
    const apiQuota = localStorage.getItem('testFeedbackApiDailyQuota');
    if (apiQuota) {
        document.getElementById('apiQuota').value = apiQuota;
    } else {
        document.getElementById('apiQuota').value = '100'; // Default value
    }
}

// Update temperature display based on slider value
function updateTemperatureDisplay(value) {
    const temperatureDisplay = document.getElementById('temperatureDisplay');
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

// Save API keys to localStorage
function saveApiKeys() {
    // Get values from form
    const geminiKey = document.getElementById('geminiApiKey').value.trim();
    const wolframKey = document.getElementById('wolframAlphaApiKey').value.trim();
    const tavilyKey = document.getElementById('tavilyApiKey').value.trim();
    const geminiModel = document.getElementById('geminiModel').value;
    const temperature = document.getElementById('geminiTemperature').value;
    const apiQuota = document.getElementById('apiQuota').value;

    // Validate at least one API key is provided
    if (!geminiKey && !wolframKey && !tavilyKey) {
        showApiStatus('Please enter at least one API key', 'danger');
        return;
    }

    // Save API keys to localStorage
    if (geminiKey) {
        localStorage.setItem('geminiApiKey', geminiKey);
        window.apiKeys.gemini = geminiKey;
    }

    if (wolframKey) {
        localStorage.setItem('wolframAlphaApiKey', wolframKey);
        window.apiKeys.wolframAlpha = wolframKey;
    }

    if (tavilyKey) {
        localStorage.setItem('tavilyApiKey', tavilyKey);
        window.apiKeys.tavily = tavilyKey;
    }

    // Save model and temperature
    localStorage.setItem('geminiModel', geminiModel);
    localStorage.setItem('geminiTemperature', temperature);
    window.apiKeys.geminiModel = geminiModel;
    window.apiKeys.temperature = parseFloat(temperature);

    // Save API quota
    if (apiQuota && !isNaN(parseInt(apiQuota))) {
        localStorage.setItem('testFeedbackApiDailyQuota', apiQuota);
        if (window.apiOptimization) {
            window.apiOptimization.dailyQuota = parseInt(apiQuota);
        }
    }

    // Show success message
    const modelDisplayName = geminiModel.replace('gemini-', 'Gemini ').replace('-exp-03-25', '');
    const temperatureDesc = getTemperatureDescription(temperature);
    showApiStatus(`API settings saved successfully! Using ${modelDisplayName} with ${temperatureDesc} responses.`, 'success');

    // Close modal after a delay
    setTimeout(() => {
        if (window.bootstrap) {
            const modalElement = document.getElementById('apiSettingsModal');
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) {
                modal.hide();
            }
        } else {
            document.getElementById('apiSettingsModal').style.display = 'none';
        }

        // Show notification
        if (window.showNotification) {
            window.showNotification(`API settings updated. Using ${modelDisplayName} with ${temperatureDesc} responses.`, 'success');
        }
    }, 1500);
}

// Show API status message
function showApiStatus(message, type) {
    const statusDiv = document.getElementById('apiKeyStatus');
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

// Make functions available globally
window.toggleApiVisibility = toggleApiVisibility;
window.openApiSettings = openApiSettings;
window.loadSavedApiKeys = loadSavedApiKeys;
window.updateTemperatureDisplay = updateTemperatureDisplay;
window.saveApiKeys = saveApiKeys;
window.showApiStatus = showApiStatus;
window.getTemperatureDescription = getTemperatureDescription;
