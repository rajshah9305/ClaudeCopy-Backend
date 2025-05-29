const OpenAI = require('openai');
const logger = require('../utils/logger');

class OpenAIService {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async generateResponse({ messages, model = 'gpt-4', systemPrompt, temperature = 0.7, maxTokens = 1000 }) {
    try {
      const openaiMessages = this.formatMessages(messages, systemPrompt);
      
      const response = await this.client.chat.completions.create({
        model,
        messages: openaiMessages,
        temperature,
        max_tokens: maxTokens,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      });

      return {
        content: response.choices[0].message.content,
        model: response.model,
        usage: {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens
        }
      };
    } catch (error) {
      logger.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }

  async streamResponse({ messages, model = 'gpt-4', systemPrompt, temperature = 0.7, onChunk, onComplete, onError }) {
    try {
      const openaiMessages = this.formatMessages(messages, systemPrompt);
      
      const stream = await this.client.chat.completions.create({
        model,
        messages: openaiMessages,
        temperature,
        max_tokens: 1000,
        stream: true
      });

      let fullContent = '';
      let usage = null;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullContent += content;
          onChunk(content);
        }
        
        if (chunk.choices[0]?.finish_reason === 'stop') {
          usage = chunk.usage;
        }
      }

      onComplete({
        content: fullContent,
        model,
        usage
      });
    } catch (error) {
      logger.error('OpenAI streaming error:', error);
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

  async generateImage({ prompt, size = '1024x1024', quality = 'standard', n = 1 }) {
    try {
      const response = await this.client.images.generate({
        model: 'dall-e-3',
        prompt,
        size,
        quality,
        n
      });

      return {
        images: response.data.map(img => ({
          url: img.url,
          revised_prompt: img.revised_prompt
        }))
      };
    } catch (error) {
      logger.error('OpenAI image generation error:', error);
      throw new Error(`OpenAI image generation error: ${error.message}`);
    }
  }

  async transcribeAudio({ audioBuffer, language }) {
    try {
      const transcription = await this.client.audio.transcriptions.create({
        file: audioBuffer,
        model: 'whisper-1',
        language
      });

      return {
        text: transcription.text
      };
    } catch (error) {
      logger.error('OpenAI transcription error:', error);
      throw new Error(`OpenAI transcription error: ${error.message}`);
    }
  }

  async validateApiKey() {
    try {
      await this.client.models.list();
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new OpenAIService();