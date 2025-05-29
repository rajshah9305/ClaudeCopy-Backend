const axios = require('axios');
const logger = require('../utils/logger');

class MistralService {
  constructor() {
    this.apiKey = process.env.MISTRAL_API_KEY;
    this.baseURL = 'https://api.mistral.ai/v1';
  }

  async generateResponse({ messages, model = 'mistral-large-latest', systemPrompt, temperature = 0.7, maxTokens = 1000 }) {
    try {
      const mistralMessages = this.formatMessages(messages, systemPrompt);
      
      const response = await axios.post(`${this.baseURL}/chat/completions`, {
        model,
        messages: mistralMessages,
        temperature,
        max_tokens: maxTokens,
        top_p: 1,
        stream: false
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      const data = response.data;
      
      return {
        content: data.choices[0].message.content,
        model: data.model,
        usage: {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens
        }
      };
    } catch (error) {
      logger.error('Mistral API error:', error.response?.data || error.message);
      throw new Error(`Mistral API error: ${error.response?.data?.message || error.message}`);
    }
  }

  async streamResponse({ messages, model = 'mistral-large-latest', systemPrompt, temperature = 0.7, onChunk, onComplete, onError }) {
    try {
      const mistralMessages = this.formatMessages(messages, systemPrompt);
      
      const response = await axios.post(`${this.baseURL}/chat/completions`, {
        model,
        messages: mistralMessages,
        temperature,
        max_tokens: 1000,
        stream: true
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        responseType: 'stream'
      });

      let fullContent = '';
      let usage = null;

      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              onComplete({
                content: fullContent,
                model,
                usage
              });
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content || '';
              
              if (content) {
                fullContent += content;
                onChunk(content);
              }
              
              if (parsed.usage) {
                usage = parsed.usage;
              }
            } catch (e) {
              // Ignore parsing errors for incomplete chunks
            }
          }
        }
      });

      response.data.on('error', (error) => {
        onError(error);
      });

    } catch (error) {
      logger.error('Mistral streaming error:', error);
      onError(error);
    }
  }

  formatMessages(messages, systemPrompt) {
    const formattedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    if (systemPrompt) {
      formattedMessages.unshift({
        role: 'system',
        content: systemPrompt
      });
    }

    return formattedMessages;
  }

  async getAvailableModels() {
    try {
      const response = await axios.get(`${this.baseURL}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return response.data.data.map(model => ({
        id: model.id,
        name: model.id,
        description: model.description || `Mistral ${model.id} model`
      }));
    } catch (error) {
      logger.error('Failed to get Mistral models:', error);
      throw new Error(`Failed to get Mistral models: ${error.message}`);
    }
  }

  async validateApiKey() {
    try {
      await this.getAvailableModels();
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new MistralService();