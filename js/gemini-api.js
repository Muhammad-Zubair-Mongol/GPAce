// Gemini API Integration
class GeminiApiService {
    constructor(apiKey, model) {
        this.apiKey = apiKey || 'AIzaSyD_NmyxJDO--WtvXIU41sRJ7XqZWLNUFd0';
        this.model = model || localStorage.getItem('geminiModel') || 'gemini-2.0-flash';
        this.baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;

        console.log(`GeminiApiService initialized with model: ${this.model}`);
    }

    async research(options) {
        const { query, maxResults = 1, model = 'gemini-pro'} = options;

        try {
            // Use the selected model from localStorage if available
            const selectedModel = localStorage.getItem('geminiModel') || model;
            const modelEndpoint = selectedModel.includes('gemini-') ? selectedModel : 'gemini-pro';

            // Update the base URL to use the selected model
            const modelUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelEndpoint}:generateContent`;

            const response = await fetch(`${modelUrl}?key=${this.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `Generate 5 real emotional and inspiring quotes or sayings from ${query}.
                            Provide ${maxResults}:
                            1. A concise title Quote
                            2. Seperate quotes line by line`
                        }]
                    }]
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`API request failed: ${errorBody}`);
            }

            const data = await response.json();
            const researchText = data.candidates[0].content.parts[0].text;

            // Enhanced parsing with more robust error handling
            const results = this.parseResearchResults(researchText);

            if (results.length === 0) {
                throw new Error('No valid research results could be parsed');
            }

            return results.slice(0, maxResults);
        } catch (error) {
            console.error('Gemini API Research Error:', error);

            // Detailed error logging
            if (error.message.includes('403')) {
                console.error('API Key may be invalid or quota exceeded');
            }

            throw error;
        }
    }

    parseResearchResults(text) {
        const results = [];
        const achievementRegex = /(\d+\.\s*[^\n]+)\n(.*?)(?=\n\d|\n*$)/gs;

        let match;
        while ((match = achievementRegex.exec(text)) !== null) {
            const [, title, description] = match;
            results.push({
                title: title.trim(),
                description: description.trim(),
                image: this.generateImageUrl(title)
            });
        }

        return results;
    }

    generateImageUrl(title) {
        // Generate a placeholder image URL based on the title
        const safeTitle = encodeURIComponent(title.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 50));
        return `https://via.placeholder.com/300x200.png?text=${safeTitle}`;
    }
}

// Initialize the Gemini API service with environment API key and selected model
const savedApiKey = localStorage.getItem('geminiApiKey');
const savedModel = localStorage.getItem('geminiModel') || 'gemini-2.0-flash';

// Initialize the Gemini API service
window.geminiApi = new GeminiApiService(savedApiKey, savedModel);

// Add a method to update the model
window.updateGeminiModel = function(model) {
    if (window.geminiApi) {
        window.geminiApi.model = model;
        window.geminiApi.baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        console.log(`Gemini model updated to: ${model}`);
    }
};
