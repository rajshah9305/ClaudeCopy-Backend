const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../utils/logger');

class GeminiService {
  constructor() {
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }

  async generateResponse({ messages, model = 'gemini-pro', systemPrompt, temperature = 0.7, maxTokens = 1000 }) {
    try {
      const genModel = this.client.getGenerativeModel({ 
        model,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens
        }
      });

      // Format conversation for Gemini
      const formattedMessages = this.formatMessages(messages, systemPrompt);
      
      const chat = genModel.startChat({
        history: formattedMessages.slice(0, -1), // All but the last message
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens
        }
      });

      const lastMessage = formattedMessages[formattedMessages.length - 1];
      const result = await chat.sendMessage(lastMessage.parts[0].text);
      const response = await result.response;

      return {
        content: response.text(),
        model,
        usage: {
          prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
          completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: response.usageMetadata?.totalTokenCount || 0
        }
      };
    } catch (error) {
      logger.error('Gemini API error:', error);
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  async streamResponse({ messages, model = 'gemini-pro', systemPrompt, temperature = 0.7, onChunk, onComplete, onError }) {
    try {
      const genModel = this.client.getGenerativeModel({ 
        model,
        generationConfig: {
          temperature,
          maxOutputTokens: 1000
        }
      });

      const formattedMessages = this.formatMessages(messages, systemPrompt);
      
      const chat = genModel.startChat({
        history: formattedMessages.slice(0, -1)
      });

      const lastMessage = formattedMessages[formattedMessages.length - 1];
      const result = await chat.sendMessageStream(lastMessage.parts[0].text);

      let fullContent = '';
      
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullContent += chunkText;
        onChunk(chunkText);
      }

      const finalResult = await result.response;
      
      onComplete({
        content: fullContent,
        model,
        usage: {
          prompt_tokens: finalResult.usageMetadata?.promptTokenCount || 0,
          completion_tokens: finalResult.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: finalResult.usageMetadata?.totalTokenCount || 0
        }
      });
    } catch (error) {
      logger.error('Gemini streaming error:', error);
      onError(error);
    }
  }

  formatMessages(messages, systemPrompt) {
    const formattedMessages = [];
    
    // Add system prompt as first user message if provided
    if (systemPrompt) {
      formattedMessages.push({
        role: 'user',
        parts: [{ text: systemPrompt }]
      });
      formattedMessages.push({
        role: 'model',
        parts: [{ text: 'I understand.' }]
      });
    }

    // Convert messages to Gemini format
    messages.forEach(msg => {
      formattedMessages.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    });

    return formattedMessages;
  }

  async generateWithVision({ prompt, imageData, model = 'gemini-pro-vision' }) {
    try {
      const genModel = this.client.getGenerativeModel({ model });
      
      const result = await genModel.generateContent([
        prompt,
        {
          inlineData: {
            data: imageData,
            mimeType: 'image/jpeg'
          }
        }
      ]);

      const response = await result.response;
      
      return {
        content: response.text(),
        model,
        usage: {
          prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
          completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: response.usageMetadata?.totalTokenCount || 0
        }
      };
    } catch (error) {
      logger.error('Gemini vision error:', error);
      throw new Error(`Gemini vision error: ${error.message}`);
    }
  }

  async validateApiKey() {
    try {
      const genModel = this.client.getGenerativeModel({ model: 'gemini-pro' });
      await genModel.generateContent('Test');
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new GeminiService();