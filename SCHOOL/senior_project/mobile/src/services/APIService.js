import AsyncStorage from '@react-native-async-storage/async-storage';

// API URL - use your computer's IP address for physical devices
const API_URL = 'http://144.38.136.80:5001/api/openai';

class APIService {
  constructor() {
    this.baseUrl = 'http://144.38.136.80:5001';
    this.conversationHistory = [];
    this.voicePreference = 'alloy'; // OpenAI voice options: alloy, echo, fable, onyx, nova, shimmer
    this.loadHistory(); // Load any existing history
    this.clearHistory(); // Clear it immediately to ensure fresh start
  }

  /**
   * Load conversation history from AsyncStorage
   */
  async loadHistory() {
    try {
      const saved = await AsyncStorage.getItem('conversation_history');
      if (saved) {
        this.conversationHistory = JSON.parse(saved);
        console.log('[APIService] Loaded conversation history:', this.conversationHistory.length, 'messages');
      }
    } catch (error) {
      console.error('[APIService] Error loading history:', error.message);
    }
  }

  /**
   * Save conversation history to AsyncStorage
   */
  async saveHistory() {
    try {
      await AsyncStorage.setItem('conversation_history', JSON.stringify(this.conversationHistory));
      console.log('[APIService] Saved conversation history:', this.conversationHistory.length, 'messages');
    } catch (error) {
      console.error('[APIService] Error saving history:', error.message);
    }
  }

  /**
   * Clear conversation history
   */
  async clearHistory() {
    try {
      console.log('[APIService] Clearing conversation history');
      this.conversationHistory = [];
      await AsyncStorage.removeItem('conversation_history');
      console.log('[APIService] Conversation history cleared');
    } catch (error) {
      console.error('[APIService] Error clearing history:', error);
      throw error;
    }
  }

  /**
   * Set the voice preference for TTS
   */
  setVoice(voice) {
    this.voicePreference = voice;
  }

  /**
   * Make an API request with retry logic
   */
  async makeRequest(url, options, maxRetries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        lastError = error;
        console.log(`[APIService] Request attempt ${attempt} failed:`, error.message);
        if (attempt < maxRetries) {
          // Wait before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw lastError;
  }

  /**
   * Check if backend is available
   */
  async checkBackendAvailability() {
    try {
      const response = await fetch(`${this.baseUrl}/api/openai/health`);
      if (!response.ok) {
        throw new Error(`Backend not ready (${response.status})`);
      }
      const data = await response.json();
      return data.status === 'ok';
    } catch (error) {
      console.error('[APIService] Backend check failed:', error.message);
      return false;
    }
  }

  /**
   * Start a new conversation
   */
  async startConversation() {
    try {
      console.log('[APIService] Starting conversation');
      
      const data = await this.makeRequest(`${this.baseUrl}/api/openai/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          voice: this.voicePreference
        }),
      });
      
      await this.clearHistory(); // Clear history for new conversation
      console.log('[APIService] Start conversation response:', data);
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to start conversation');
      }
      
      return data;
    } catch (error) {
      console.error('[APIService] Error starting conversation:', error.message);
      throw error;
    }
  }

  /**
   * End the current conversation
   */
  async endConversation() {
    try {
      console.log('[APIService] Ending conversation');
      
      const response = await fetch(`${this.baseUrl}/api/openai/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          voice: this.voicePreference
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to end conversation: ${response.statusText}`);
      }
      
      await this.clearHistory(); // Clear history when conversation ends
      const data = await response.json();
      console.log('[APIService] End conversation response:', data);
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to end conversation');
      }
      
      return data;
    } catch (error) {
      console.error('[APIService] Error ending conversation:', error.message);
      throw error;
    }
  }

  /**
   * Get response from OpenAI
   */
  async getResponse(text) {
    try {
      // Add user message to history
      this.conversationHistory.push({ role: 'user', content: text });
      await this.saveHistory(); // Save after adding user message
      
      console.log('[APIService] Getting response for message:', text);
      
      const response = await fetch(`${this.baseUrl}/api/openai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
          history: this.conversationHistory
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get response: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('[APIService] Chat response:', data);
      
      // Add assistant response to history
      if (data.text) {
        this.conversationHistory.push({ role: 'assistant', content: data.text });
        await this.saveHistory(); // Save after adding assistant response
      }
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to get response');
      }
      
      return data;
    } catch (error) {
      console.error('[APIService] Error getting response:', error.message);
      throw error;
    }
  }

  /**
   * Transcribe audio using OpenAI API
   */
  async transcribeAudio(base64Audio) {
    try {
      console.log('[APIService] Transcribing audio');
      
      // Add retry logic for transcription
      const maxRetries = 2;
      let retryCount = 0;
      let transcript = null;
      
      // Determine file format based on platform
      const Platform = require('react-native').Platform;
      const fileFormat = Platform.OS === 'ios' ? 'm4a' : 'mp3';
      console.log(`[APIService] Using ${fileFormat} format for transcription`);
      
      while (!transcript && retryCount <= maxRetries) {
        try {
          console.log('[APIService] Sending audio for transcription (attempt ' + (retryCount + 1) + ')');
          
          // Try a more standard approach to match OpenAI API expectations
          const requestData = {
            audio_data: base64Audio,
            file_format: fileFormat,
            model: 'whisper-1'  // Explicitly specify the model
          };
          
          console.log('[APIService] Transcription request data structure:', 
                     Object.keys(requestData).join(', '));
          
          const response = await fetch(`${this.baseUrl}/api/openai/transcribe`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[APIService] Transcription error (${response.status}):`, errorText);
            throw new Error(`Transcription failed: ${response.status} - ${errorText}`);
          }
          
          const data = await response.json();
          
          if (data && data.success && data.text) {
            transcript = data.text;
            console.log('[APIService] Transcription successful:', transcript);
          } else {
            throw new Error('Invalid transcription response');
          }
        } catch (error) {
          retryCount++;
          if (retryCount <= maxRetries) {
            console.log(`[APIService] Transcription retry ${retryCount}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retry
          } else {
            throw error; // Rethrow after all retries
          }
        }
      }
      
      return transcript;
    } catch (error) {
      console.error('[APIService] Error transcribing audio:', error.message || error);
      throw new Error('Failed to transcribe audio: ' + (error.message || ''));
    }
  }
}

// Export a singleton instance
export default new APIService(); 