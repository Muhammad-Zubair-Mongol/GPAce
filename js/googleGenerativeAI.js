const { GoogleGenerativeAI } = require('@google/generative-ai');

class GoogleGenerativeAIWrapper {
    constructor(apiKey) {
        this.genAI = new GoogleGenerativeAI(apiKey);
    }

    async getGenerativeModel(config) {
        return this.genAI.getGenerativeModel(config);
    }

    async generateContent(prompt) {
        const model = await this.getGenerativeModel({ model: "gemini-pro-vision" });
        return model.generateContent(prompt);
    }
}

module.exports = GoogleGenerativeAIWrapper;
