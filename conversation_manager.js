const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class ConversationManager {
  constructor() {
    this.conversationsDir = path.join(process.cwd(), 'data', 'conversations');
    this.ensureDirectoryExists();
  }

  async ensureDirectoryExists() {
    try {
      await fs.mkdir(this.conversationsDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create conversations directory:', error);
    }
  }

  async saveMessage(conversationId, message) {
    try {
      const filePath = path.join(this.conversationsDir, `${conversationId}.json`);
      
      let conversation = [];
      try {
        const existingData = await fs.readFile(filePath, 'utf8');
        conversation = JSON.parse(existingData);
      } catch (error) {
        // File doesn't exist yet, start with empty array
      }

      conversation.push({
        ...message,
        id: Date.now() + Math.random(), // Simple unique ID
        createdAt: new Date().toISOString()
      });

      // Keep only last 50 messages to prevent files from growing too large
      if (conversation.length > 50) {
        conversation = conversation.slice(-50);
      }

      await fs.writeFile(filePath, JSON.stringify(conversation, null, 2));
      
      // Update conversation metadata
      await this.updateConversationMetadata(conversationId, message);
      
    } catch (error) {
      logger.error(`Failed to save message for conversation ${conversationId}:`, error);
      throw error;
    }
  }

  async getConversation(conversationId) {
    try {
      const filePath = path.join(this.conversationsDir, `${conversationId}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return []; // Return empty array if conversation doesn't exist
      }
      logger.error(`Failed to get conversation ${conversationId}:`, error);
      throw error;
    }
  }

  async getConversations(limit = 20, offset = 0) {
    try {
      const metadataPath = path.join(this.conversationsDir, 'metadata.json');
      let metadata = {};
      
      try {
        const metadataData = await fs.readFile(metadataPath, 'utf8');
        metadata = JSON.parse(metadataData);
      } catch (error) {
        // No metadata file yet
      }

      const conversations = Object.entries(metadata)
        .sort(([,a], [,b]) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
        .slice(offset, offset + limit)
        .map(([id, data]) => ({
          id,
          ...data
        }));

      return conversations;
    } catch (error) {
      logger.error('Failed to get conversations:', error);
      throw error;
    }
  }

  async deleteConversation(conversationId) {
    try {
      const filePath = path.join(this.conversationsDir, `${conversationId}.json`);
      await fs.unlink(filePath);
      
      // Remove from metadata
      const metadataPath = path.join(this.conversationsDir, 'metadata.json');
      try {
        const metadataData = await fs.readFile(metadataPath, 'utf8');
        const metadata = JSON.parse(metadataData);
        delete metadata[conversationId];
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      } catch (error) {
        // Metadata file might not exist
      }
      
    } catch (error) {
      logger.error(`Failed to delete conversation ${conversationId}:`, error);
      throw error;
    }
  }

  async updateConversationMetadata(conversationId, lastMessage) {
    try {
      const metadataPath = path.join(this.conversationsDir, 'metadata.json');
      let metadata = {};
      
      try {
        const metadataData = await fs.readFile(metadataPath, 'utf8');
        metadata = JSON.parse(metadataData);
      } catch (error) {
        // File doesn't exist yet
      }

      if (!metadata[conversationId]) {
        metadata[conversationId] = {
          createdAt: new Date().toISOString(),
          messageCount: 0,
          title: this.generateTitle(lastMessage.content)
        };
      }

      metadata[conversationId].lastUpdated = new Date().toISOString();
      metadata[conversationId].messageCount += 1;
      metadata[conversationId].lastMessage = {
        role: lastMessage.role,
        content: lastMessage.content.substring(0, 100) + (lastMessage.content.length > 100 ? '...' : ''),
        timestamp: lastMessage.timestamp
      };

      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      logger.error('Failed to update conversation metadata:', error);
    }
  }

  generateTitle(content) {
    // Generate a title from the first message content
    const cleanContent = content.replace(/[^\w\s]/gi, '').trim();
    const words = cleanContent.split(' ').slice(0, 5);
    return words.join(' ') || 'New Conversation';
  }

  async searchConversations(query, limit = 10) {
    try {
      const files = await fs.readdir(this.conversationsDir);
      const conversationFiles = files.filter(file => file.endsWith('.json') && file !== 'metadata.json');
      
      const results = [];
      
      for (const file of conversationFiles) {
        const conversationId = file.replace('.json', '');
        const conversation = await this.getConversation(conversationId);
        
        // Search through messages
        const matchingMessages = conversation.filter(msg => 
          msg.content.toLowerCase().includes(query.toLowerCase())
        );
        
        if (matchingMessages.length > 0) {
          results.push({
            conversationId,
            matches: matchingMessages.length,
            preview: matchingMessages[0].content.substring(0, 200) + '...'
          });
        }
        
        if (results.length >= limit) break;
      }
      
      return results.sort((a, b) => b.matches - a.matches);
    } catch (error) {
      logger.error('Failed to search conversations:', error);
      throw error;
    }
  }

  async getConversationStats() {
    try {
      const metadataPath = path.join(this.conversationsDir, 'metadata.json');
      let metadata = {};
      
      try {
        const metadataData = await fs.readFile(metadataPath, 'utf8');
        metadata = JSON.parse(metadataData);
      } catch (error) {
        return { totalConversations: 0, totalMessages: 0 };
      }

      const totalConversations = Object.keys(metadata).length;
      const totalMessages = Object.values(metadata).reduce((sum, conv) => sum + conv.messageCount, 0);
      
      return {
        totalConversations,
        totalMessages,
        averageMessagesPerConversation: totalConversations > 0 ? Math.round(totalMessages / totalConversations) : 0
      };
    } catch (error) {
      logger.error('Failed to get conversation stats:', error);
      throw error;
    }
  }

  async exportConversation(conversationId, format = 'json') {
    try {
      const conversation = await this.getConversation(conversationId);
      
      if (format === 'txt') {
        return conversation.map(msg => 
          `[${msg.timestamp}] ${msg.role.toUpperCase()}: ${msg.content}`
        ).join('\n\n');
      }
      
      return JSON.stringify(conversation, null, 2);
    } catch (error) {
      logger.error(`Failed to export conversation ${conversationId}:`, error);
      throw error;
    }
  }

  async importConversation(conversationData, conversationId) {
    try {
      const id = conversationId || Date.now().toString();
      const filePath = path.join(this.conversationsDir, `${id}.json`);
      
      await fs.writeFile(filePath, JSON.stringify(conversationData, null, 2));
      
      // Update metadata
      if (conversationData.length > 0) {
        await this.updateConversationMetadata(id, conversationData[conversationData.length - 1]);
      }
      
      return id;
    } catch (error) {
      logger.error('Failed to import conversation:', error);
      throw error;
    }
  }
}

module.exports = new ConversationManager();