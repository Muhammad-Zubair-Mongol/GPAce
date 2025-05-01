const functions = require('firebase-functions');
const { GoogleGenerativeAI } = require('@google/generative-ai');

exports.getGeminiConfig = functions.https.onCall((data, context) => {
  // Retrieve the key from Firebase config
  const geminiApiKey = functions.config().gemini.key;
  
  // For security, don't return the actual key
  return { 
    keyAvailable: !!geminiApiKey 
  };
});