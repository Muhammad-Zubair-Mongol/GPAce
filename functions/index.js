'use strict';

const { onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

// Secret values are resolved by the Functions runtime and are never returned to
// clients.  The callable exposes only the existing availability boolean.
const geminiApiKey = defineSecret('GEMINI_API_KEY');

exports.getGeminiConfig = onCall({ secrets: [geminiApiKey] }, () => ({
    keyAvailable: Boolean(geminiApiKey.value())
}));
