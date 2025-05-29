const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

class AnthropicService {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async generateResponse({ messages, model = 'claude-3-sonnet-20240229', systemPrompt, temperature = 0.7, maxTokens = 1000 }) {
    try {
      // Convert messages to Anthropic format
      const anthropicMessages = this.formatMessages(messages);
      
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: anthropicMessages
      });

      return {
        content: response.content[0].text,
        model: response.model,
        usage: {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.input_tokens + response.usage.output_tokens
        }
      };
    } catch (error) {
      logger.error('Anthropic API error:', error);
      throw new Error(`Anthropic API error: ${error.message}`);
    }
  }

  async streamResponse({ messages, model = 'claude-3-sonnet-20240229', systemPrompt, temperature = 0.7, onChunk, onComplete, onError }) {
    try {
      const anthropicMessages = this.formatMessages(messages);
      
      const stream = await this.client.messages.create({
        model,
        max_tokens: 1000,
        temperature,
        system: systemPrompt,
        messages: anthropicMessages,
        stream: true
      });

      let fullContent = '';
      let usage = null;

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta') {
          const content = chunk.delta.text;
          fullContent += content;
          onChunk(content);
        } else if (chunk.type === 'message_delta') {
          usage = chunk.usage;
        }
      }

      onComplete({
        content: fullContent,
        model,
        usage: usage ? {
          prompt_tokens: usage.input_tokens,
          completion_tokens: usage.output_tokens,
          total_tokens: usage.input_tokens + usage.output_tokens
        } : null
      });
    } catch (error) {
      logger.error('Anthropic streaming error:', error);
      onError(error);
    }
  }

  formatMessages(messages) {
    return messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));
  }

  async validateApiKey() {
    try {
      await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Test' }]
      });
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new AnthropicService();