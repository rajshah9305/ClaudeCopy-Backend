const { CohereClient } = require('cohere-ai');
const logger = require('../utils/logger');

class CohereService {
  constructor() {
    this.client = new CohereClient({
      token: process.env.COHERE_API_KEY,
    });
  }

  async generateResponse({ messages, model = 'command', systemPrompt, temperature = 0.7, maxTokens = 1000 }) {
    try {
      // Convert messages to Cohere chat format
      const chatHistory = this.formatMessages(messages.slice(0, -1));
      const currentMessage = messages[messages.length - 1].content;
      
      const response = await this.client.chat({
        model,
        message: currentMessage,
        chatHistory,
        preamble: systemPrompt,
        temperature,
        maxTokens
      });

      return {
        content: response.text,
        model,
        usage: {
          prompt_tokens: response.meta?.billedUnits?.inputTokens || 0,
          completion_tokens: response.meta?.billedUnits?.outputTokens || 0,
          total_tokens: (response.meta?.billedUnits?.inputTokens || 0) + (response.meta?.billedUnits?.outputTokens || 0)
        }
      };
    } catch (error) {
      logger.error('Cohere API error:', error);
      throw new Error(`Cohere API error: ${error.message}`);
    }
  }

  async streamResponse({ messages, model = 'command', systemPrompt, temperature = 0.7, onChunk, onComplete, onError }) {
    try {
      const chatHistory = this.formatMessages(messages.slice(0, -1));
      const currentMessage = messages[messages.length - 1].content;
      
      const stream = await this.client.chatStream({
        model,
        message: currentMessage,
        chatHistory,
        preamble: systemPrompt,
        temperature,
        maxTokens: 1000
      });

      let fullContent = '';
      let usage = null;

      for await (const chunk of stream) {
        if (chunk.eventType === 'text-generation') {
          const content = chunk.text;
          fullContent += content;
          onChunk(content);
        } else if (chunk.eventType === 'stream-end') {
          usage = {
            prompt_tokens: chunk.response?.meta?.billedUnits?.inputTokens || 0,
            completion_tokens: chunk.response?.meta?.billedUnits?.outputTokens || 0,
            total_tokens: (chunk.response?.meta?.billedUnits?.inputTokens || 0) + (chunk.response?.meta?.billedUnits?.outputTokens || 0)
          };
        }
      }

      onComplete({
        content: fullContent,
        model,
        usage
      });
    } catch (error) {
      logger.error('Cohere streaming error:', error);
      onError(error);
    }
  }

  formatMessages(messages) {
    return messages.map(msg => ({
      role: msg.role === 'assistant' ? 'CHATBOT' : 'USER',
      message: msg.content
    }));
  }

  async generateEmbeddings({ texts, model = 'embed-english-v3.0' }) {
    try {
      const response = await this.client.embed({
        texts,
        model,
        inputType: 'search_document'
      });

      return {
        embeddings: response.embeddings,
        model,
        usage: {
          total_tokens: response.meta?.billedUnits?.inputTokens || 0
        }
      };
    } catch (error) {
      logger.error('Cohere embeddings error:', error);
      throw new Error(`Cohere embeddings error: ${error.message}`);
    }
  }

  async rerank({ query, documents, model = 'rerank-english-v3.0', topN = 10 }) {
    try {
      const response = await this.client.rerank({
        query,
        documents,
        model,
        topN
      });

      return {
        results: response.results,
        model,
        usage: {
          total_tokens: response.meta?.billedUnits?.searchUnits || 0
        }
      };
    } catch (error) {
      logger.error('Cohere rerank error:', error);
      throw new Error(`Cohere rerank error: ${error.message}`);
    }
  }

  async summarize({ text, model = 'command', length = 'medium', format = 'paragraph' }) {
    try {
      const response = await this.client.summarize({
        text,
        model,
        length,
        format,
        temperature: 0.3
      });

      return {
        summary: response.summary,
        model,
        usage: {
          prompt_tokens: response.meta?.billedUnits?.inputTokens || 0,
          completion_tokens: response.meta?.billedUnits?.outputTokens || 0,
          total_tokens: (response.meta?.billedUnits?.inputTokens || 0) + (response.meta?.billedUnits?.outputTokens || 0)
        }
      };
    } catch (error) {
      logger.error('Cohere summarize error:', error);
      throw new Error(`Cohere summarize error: ${error.message}`);
    }
  }

  async validateApiKey() {
    try {
      await this.client.chat({
        model: 'command-light',
        message: 'Test',
        maxTokens: 10
      });
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new CohereService();