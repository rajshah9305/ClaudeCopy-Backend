const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');

// Load environment variables
dotenv.config();

// Import AI service modules
const anthropicService = require('./services/anthropicService');
const openaiService = require('./services/openaiService');
const geminiService = require('./services/geminiService');
const mistralService = require('./services/mistralService');
const cohereService = require('./services/cohereService');

// Import middleware and utilities
const { authenticateToken } = require('./middleware/auth');
const { validateChatRequest } = require('./middleware/validation');
const conversationManager = require('./utils/conversationManager');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api/', limiter);

// Logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Get available AI models
app.get('/api/models', (req, res) => {
  const models = {
    anthropic: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
    openai: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    gemini: ['gemini-pro', 'gemini-pro-vision'],
    mistral: ['mistral-large', 'mistral-medium', 'mistral-small'],
    cohere: ['command', 'command-light', 'command-nightly']
  };
  
  res.json({ models });
});

// Chat endpoint - supports multiple AI providers
app.post('/api/chat', validateChatRequest, async (req, res) => {
  try {
    const { 
      message, 
      provider = 'anthropic', 
      model = 'claude-3-sonnet', 
      conversationId,
      systemPrompt,
      temperature = 0.7,
      maxTokens = 1000,
      includeHistory = true
    } = req.body;

    // Generate conversation ID if not provided
    const convId = conversationId || uuidv4();
    
    // Get conversation history
    const history = includeHistory ? 
      await conversationManager.getConversation(convId) : [];

    // Add current message to history
    const userMessage = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };

    // Select AI service based on provider
    let aiService;
    switch (provider.toLowerCase()) {
      case 'anthropic':
        aiService = anthropicService;
        break;
      case 'openai':
        aiService = openaiService;
        break;
      case 'gemini':
        aiService = geminiService;
        break;
      case 'mistral':
        aiService = mistralService;
        break;
      case 'cohere':
        aiService = cohereService;
        break;
      default:
        return res.status(400).json({ error: 'Unsupported AI provider' });
    }

    // Generate AI response
    const aiResponse = await aiService.generateResponse({
      messages: [...history, userMessage],
      model,
      systemPrompt,
      temperature,
      maxTokens
    });

    const assistantMessage = {
      role: 'assistant',
      content: aiResponse.content,
      timestamp: new Date().toISOString(),
      model: aiResponse.model,
      usage: aiResponse.usage
    };

    // Save conversation
    await conversationManager.saveMessage(convId, userMessage);
    await conversationManager.saveMessage(convId, assistantMessage);

    // Send response
    res.json({
      response: aiResponse.content,
      conversationId: convId,
      model: aiResponse.model,
      usage: aiResponse.usage,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Failed to generate response',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Stream chat endpoint for real-time responses
app.post('/api/chat/stream', validateChatRequest, async (req, res) => {
  try {
    const { 
      message, 
      provider = 'anthropic', 
      model = 'claude-3-sonnet',
      conversationId,
      systemPrompt,
      temperature = 0.7
    } = req.body;

    // Set up Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const convId = conversationId || uuidv4();
    const history = await conversationManager.getConversation(convId);
    
    const userMessage = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    };

    // Select AI service
    let aiService;
    switch (provider.toLowerCase()) {
      case 'anthropic':
        aiService = anthropicService;
        break;
      case 'openai':
        aiService = openaiService;
        break;
      default:
        res.write(`data: ${JSON.stringify({ error: 'Streaming not supported for this provider' })}\n\n`);
        res.end();
        return;
    }

    // Stream response
    await aiService.streamResponse({
      messages: [...history, userMessage],
      model,
      systemPrompt,
      temperature,
      onChunk: (chunk) => {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      },
      onComplete: async (fullResponse) => {
        const assistantMessage = {
          role: 'assistant',
          content: fullResponse.content,
          timestamp: new Date().toISOString(),
          model: fullResponse.model
        };

        await conversationManager.saveMessage(convId, userMessage);
        await conversationManager.saveMessage(convId, assistantMessage);

        res.write(`data: ${JSON.stringify({ 
          done: true, 
          conversationId: convId,
          usage: fullResponse.usage 
        })}\n\n`);
        res.end();
      },
      onError: (error) => {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    });

  } catch (error) {
    logger.error('Stream chat error:', error);
    res.write(`data: ${JSON.stringify({ error: 'Failed to stream response' })}\n\n`);
    res.end();
  }
});

// Conversation management endpoints
app.get('/api/conversations', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const conversations = await conversationManager.getConversations(limit, offset);
    res.json({ conversations });
  } catch (error) {
    logger.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await conversationManager.getConversation(id);
    res.json({ conversation });
  } catch (error) {
    logger.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

app.delete('/api/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await conversationManager.deleteConversation(id);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete conversation error:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// Model comparison endpoint
app.post('/api/compare', validateChatRequest, async (req, res) => {
  try {
    const { message, providers = ['anthropic', 'openai'], models } = req.body;
    
    const responses = await Promise.allSettled(
      providers.map(async (provider) => {
        const model = models?.[provider] || getDefaultModel(provider);
        const aiService = getAIService(provider);
        
        const response = await aiService.generateResponse({
          messages: [{ role: 'user', content: message }],
          model,
          temperature: 0.7,
          maxTokens: 1000
        });
        
        return {
          provider,
          model: response.model,
          content: response.content,
          usage: response.usage
        };
      })
    );

    const results = responses.map((result, index) => ({
      provider: providers[index],
      status: result.status,
      response: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason.message : null
    }));

    res.json({ results });
  } catch (error) {
    logger.error('Compare models error:', error);
    res.status(500).json({ error: 'Failed to compare models' });
  }
});

// Configuration endpoints
app.get('/api/config', (req, res) => {
  const config = {
    availableProviders: ['anthropic', 'openai', 'gemini', 'mistral', 'cohere'],
    defaultProvider: 'anthropic',
    maxTokens: 4000,
    maxConversationLength: 50,
    supportedFeatures: {
      streaming: ['anthropic', 'openai'],
      vision: ['openai', 'gemini'],
      functionCalling: ['openai', 'anthropic']
    }
  };
  res.json(config);
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Helper functions
function getDefaultModel(provider) {
  const defaults = {
    anthropic: 'claude-3-sonnet',
    openai: 'gpt-4',
    gemini: 'gemini-pro',
    mistral: 'mistral-large',
    cohere: 'command'
  };
  return defaults[provider] || 'claude-3-sonnet';
}

function getAIService(provider) {
  const services = {
    anthropic: anthropicService,
    openai: openaiService,
    gemini: geminiService,
    mistral: mistralService,
    cohere: cohereService
  };
  return services[provider];
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Chatbot backend server running on port ${PORT}`);
  logger.info(`📊 Health check available at http://localhost:${PORT}/health`);
  logger.info(`🤖 Chat API available at http://localhost:${PORT}/api/chat`);
});