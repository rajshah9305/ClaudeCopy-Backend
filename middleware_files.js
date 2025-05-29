// middleware/validation.js
const logger = require('../utils/logger');

const validateChatRequest = (req, res, next) => {
  const { message, provider, model } = req.body;

  // Validate required fields
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ 
      error: 'Message is required and must be a string' 
    });
  }

  if (message.trim().length === 0) {
    return res.status(400).json({ 
      error: 'Message cannot be empty' 
    });
  }

  if (message.length > 10000) {
    return res.status(400).json({ 
      error: 'Message is too long (max 10,000 characters)' 
    });
  }

  // Validate provider if specified
  if (provider && !['anthropic', 'openai', 'gemini', 'mistral', 'cohere'].includes(provider.toLowerCase())) {
    return res.status(400).json({ 
      error: 'Invalid AI provider specified' 
    });
  }

  // Validate temperature if specified
  if (req.body.temperature !== undefined) {
    const temp = parseFloat(req.body.temperature);
    if (isNaN(temp) || temp < 0 || temp > 2) {
      return res.status(400).json({ 
        error: 'Temperature must be a number between 0 and 2' 
      });
    }
    req.body.temperature = temp;
  }

  // Validate maxTokens if specified
  if (req.body.maxTokens !== undefined) {
    const tokens = parseInt(req.body.maxTokens);
    if (isNaN(tokens) || tokens < 1 || tokens > 4000) {
      return res.status(400).json({ 
        error: 'MaxTokens must be a number between 1 and 4000' 
      });
    }
    req.body.maxTokens = tokens;
  }

  // Validate conversationId if specified
  if (req.body.conversationId && typeof req.body.conversationId !== 'string') {
    return res.status(400).json({ 
      error: 'ConversationId must be a string' 
    });
  }

  // Sanitize inputs
  req.body.message = message.trim();
  if (req.body.systemPrompt) {
    req.body.systemPrompt = req.body.systemPrompt.trim();
  }

  next();
};

const validateImageRequest = (req, res, next) => {
  const { prompt, size, quality } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ 
      error: 'Prompt is required and must be a string' 
    });
  }

  if (prompt.trim().length === 0) {
    return res.status(400).json({ 
      error: 'Prompt cannot be empty' 
    });
  }

  if (size && !['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'].includes(size)) {
    return res.status(400).json({ 
      error: 'Invalid image size specified' 
    });
  }

  if (quality && !['standard', 'hd'].includes(quality)) {
    return res.status(400).json({ 
      error: 'Invalid image quality specified' 
    });
  }

  req.body.prompt = prompt.trim();
  next();
};

module.exports = {
  validateChatRequest,
  validateImageRequest
};

// middleware/auth.js
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const authenticateToken = (req, res, next) => {
  // Skip authentication if no JWT secret is configured
  if (!process.env.JWT_SECRET) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      logger.warn('Invalid token attempt:', err.message);
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  });
};

const generateToken = (userData) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET not configured');
  }

  return jwt.sign(
    { 
      id: userData.id, 
      username: userData.username 
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

const authenticateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!process.env.API_KEY) {
    return next(); // Skip if no API key configured
  }

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  next();
};

module.exports = {
  authenticateToken,
  generateToken,
  authenticateApiKey
};