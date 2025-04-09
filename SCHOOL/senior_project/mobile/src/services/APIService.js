import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import WebRTCService, { WEBRTC_EVENTS } from './WebRTCService';

// Helper to get the correct server URL based on platform
const getServerUrl = () => {
  if (__DEV__) {
    // Use localhost for iOS simulators
    if (Platform.OS === 'ios') {
      return 'http://localhost:5001';
    }
    // Use 10.0.2.2 for Android emulators (special IP that routes to host machine's localhost)
    else if (Platform.OS === 'android') {
      return 'http://10.0.2.2:5001';
    }
  }
  // Production endpoint
  return 'http://144.38.136.80:5001';
};

// API Configuration
const API_URL = getServerUrl();
const SOCKET_URL = getServerUrl();

// WebSocket Events
export const WS_EVENTS = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  TRANSCRIPTION: 'transcription',
  AUDIO_DATA: 'audio_data',
  RESPONSE: 'response',
  ERROR: 'error',
  STATUS: 'status',
  WEBRTC_READY: 'webrtc_ready',
  WEBRTC_CLOSED: 'webrtc_closed',
  WEBRTC_ERROR: 'webrtc_error'
};

class APIService {
  constructor() {
    this.baseUrl = API_URL;
    this.socketUrl = SOCKET_URL;
    this.socket = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimeout = null;
    this.eventListeners = new Map();
    this.conversationHistory = [];
    this.voicePreference = 'alloy'; // OpenAI voice options: alloy, echo, fable, onyx, nova, shimmer
    this.clientId = null;
    this.usingWebRTC = false;
    
    // Load any existing history
    this.loadHistory();
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
   * Connect to WebSocket server
   */
  connect() {
    if (this.socket) {
      if (this.connected) {
        console.log('[APIService] WebSocket already connected');
        return;
      } else {
        // If we have a socket instance but aren't connected, try to reconnect
        console.log('[APIService] Socket exists but disconnected, attempting to reconnect');
        if (this.socket.disconnected) {
          this.socket.connect();
          return;
        }
      }
    }
    
    try {
      console.log(`[APIService] Importing Socket.IO client`);
      // Import Socket.IO dynamically to prevent issues with SSR/testing
      import('socket.io-client').then(io => {
        console.log(`[APIService] Connecting to Socket.IO at ${this.socketUrl}`);
        
        this.socket = io.default(this.socketUrl, {
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: this.maxReconnectAttempts,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          // Increase Socket.IO timeout to handle large audio files
          timeout: 60000, // 60 second timeout
          // Allow larger message sizes (default is often too small for audio)
          maxHttpBufferSize: 10e6, // 10MB (adjust based on expected audio file sizes)
          // Automatically try reconnecting on errors
          autoConnect: true
        });
        
        // Socket.IO Connect
        this.socket.on('connect', () => {
          console.log('[APIService] Socket.IO connected, ID:', this.socket.id);
          this.connected = true;
          this.reconnectAttempts = 0;
          this.clientId = this.socket.id;
          
          // Initialize WebRTC service
          this._setupWebRTC();
          
          this.emitEvent(WS_EVENTS.CONNECT);
        });
        
        // Socket.IO Disconnect
        this.socket.on('disconnect', (reason) => {
          console.log('[APIService] Socket.IO disconnected, reason:', reason);
          this.connected = false;
          this.emitEvent(WS_EVENTS.DISCONNECT, reason);
          
          // Try to reconnect automatically on transport close
          if (reason === 'transport close' || reason === 'ping timeout') {
            console.log('[APIService] Transport issue detected, attempting immediate reconnect');
            setTimeout(() => {
              if (this.socket && this.socket.disconnected) {
                console.log('[APIService] Attempting to reconnect after transport close');
                this.socket.connect();
              }
            }, 1000);
          }
        });
        
        // Socket.IO Reconnect
        this.socket.on('reconnect', (attemptNumber) => {
          console.log('[APIService] Socket.IO reconnected, attempt:', attemptNumber);
          this.connected = true;
          this.emitEvent(WS_EVENTS.CONNECT); // Re-emit connect event on reconnect
        });
        
        // Socket.IO Reconnect Failed
        this.socket.on('reconnect_failed', () => {
          console.log('[APIService] Socket.IO reconnection failed after multiple attempts');
          this.emitEvent(WS_EVENTS.ERROR, new Error('Failed to reconnect after multiple attempts'));
        });
        
        // Socket.IO Reconnect Error
        this.socket.on('reconnect_error', (error) => {
          console.log('[APIService] Socket.IO reconnection error:', error);
        });
        
        // Socket.IO Error
        this.socket.on('error', (error) => {
          console.error('[APIService] Socket.IO error:', error);
          this.emitEvent(WS_EVENTS.ERROR, error);
        });
        
        // Server status
        this.socket.on('server_status', (data) => {
          console.log('[APIService] Server status:', data);
          
          if (data.session_data && data.session_data.client_id) {
            this.clientId = data.session_data.client_id;
            console.log('[APIService] Received client ID:', this.clientId);
          }
          
          this.emitEvent(WS_EVENTS.STATUS, data);
        });
        
        // Setup event handlers for different message types
        this._setupEventHandlers();
      }).catch(error => {
        console.error('[APIService] Error importing Socket.IO:', error);
        this.emitEvent(WS_EVENTS.ERROR, error);
      });
    } catch (error) {
      console.error('[APIService] Error connecting to Socket.IO:', error);
      this.emitEvent(WS_EVENTS.ERROR, error);
    }
  }
  
  /**
   * Setup event handlers for Socket.IO messages
   */
  _setupEventHandlers() {
    // Transcription events
    this.socket.on('transcription', (data) => {
      console.log('[APIService] Transcription received:', data.text);
      this.emitEvent(WS_EVENTS.TRANSCRIPTION, data.text);
    });
    
    // Audio data events
    this.socket.on('audio_data', (data) => {
      console.log('[APIService] Audio data received');
      this.emitEvent(WS_EVENTS.AUDIO_DATA, data.audio);
    });
    
    // Response events
    this.socket.on('response', (data) => {
      console.log('[APIService] Response received');
      
      // Add assistant response to history
      if (data.text) {
        this.conversationHistory.push({ role: 'assistant', content: data.text });
        this.saveHistory();
      }
      
      this.emitEvent(WS_EVENTS.RESPONSE, data);
    });
    
    // Error events
    this.socket.on('error_message', (data) => {
      // Suppress the specific "No chunk info received before chunk data" error
      if (data.message && data.message.includes('No chunk info received before chunk data')) {
        console.log('[APIService] Suppressed chunk info error (non-critical)');
        return;
      }
      
      console.error('[APIService] Error from server:', data.message);
      this.emitEvent(WS_EVENTS.ERROR, new Error(data.message));
    });
  }
  
  /**
   * Setup WebRTC integration
   */
  _setupWebRTC() {
    if (!this.socket || !this.clientId) {
      console.error('[APIService] Cannot set up WebRTC: Socket or client ID not available');
      return;
    }
    
    console.log('[APIService] Setting up WebRTC with client ID:', this.clientId);
    
    // Initialize WebRTC service with Socket.IO
    WebRTCService.initialize(this.socket, this.clientId);
    
    // Pass WebRTC events to API service listeners
    WebRTCService.on(WEBRTC_EVENTS.STREAM_READY, () => {
      console.log('[APIService] WebRTC stream ready');
      this.usingWebRTC = true;
      this.emitEvent(WS_EVENTS.WEBRTC_READY);
    });
    
    WebRTCService.on(WEBRTC_EVENTS.STREAM_CLOSED, () => {
      console.log('[APIService] WebRTC stream closed');
      this.usingWebRTC = false;
      this.emitEvent(WS_EVENTS.WEBRTC_CLOSED);
    });
    
    WebRTCService.on(WEBRTC_EVENTS.ERROR, (error) => {
      console.error('[APIService] WebRTC error:', error);
      this.emitEvent(WS_EVENTS.WEBRTC_ERROR, error);
    });
  }
  
  /**
   * Start WebRTC stream
   */
  async startWebRTCStream() {
    if (!this.connected) {
      console.error('[APIService] Cannot start WebRTC: Socket not connected');
      throw new Error('Socket not connected');
    }
    
    console.log('[APIService] Starting WebRTC stream');
    const success = await WebRTCService.startStream();
    
    if (success) {
      console.log('[APIService] WebRTC stream started successfully');
    } else {
      console.error('[APIService] Failed to start WebRTC stream');
    }
    
    return success;
  }
  
  /**
   * Stop WebRTC stream
   */
  stopWebRTCStream() {
    console.log('[APIService] Stopping WebRTC stream');
    WebRTCService.stopStream();
    this.usingWebRTC = false;
  }
  
  /**
   * Check if WebRTC is available and connected
   */
  isWebRTCAvailable() {
    return this.connected && WebRTCService.isStreamConnected();
  }
  
  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    // Stop WebRTC first if active
    if (this.usingWebRTC) {
      this.stopWebRTCStream();
    }
    
    if (this.socket) {
      console.log('[APIService] Disconnecting Socket.IO');
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
      this.clientId = null;
    }
  }
  
  /**
   * Send a message through Socket.IO
   */
  emit(event, data = {}) {
    if (!this.socket || !this.connected) {
      console.error('[APIService] Cannot send message: Socket not connected');
      throw new Error('Socket not connected');
    }
    
    console.log(`[APIService] Emitting ${event} event`);
    this.socket.emit(event, data);
  }
  
  /**
   * Send audio data for transcription
   * Uses WebRTC if available, falls back to Socket.IO
   * @param {string} audioData - Base64 encoded audio data
   * @param {string} [fileFormat] - Optional file format (e.g., 'm4a', 'mp3')
   */
  async sendAudioForTranscription(audioData, fileFormat) {
    try {
      // Check connection before attempting to send data
      if (!this.socket) {
        console.log('[APIService] No socket connection, attempting to reconnect');
        this.connect();
        // Wait a bit for the connection to establish
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (!this.connected) {
        console.log('[APIService] Not connected to server, attempting to reconnect');
        if (this.socket) {
          this.socket.connect();
          // Wait a bit for the connection to establish
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          this.connect();
          // Wait a bit for the connection to establish
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // If still not connected, throw an error
        if (!this.connected) {
          throw new Error('Unable to connect to server');
        }
      }
      
      console.log('[APIService] Sending audio for transcription');
      
      // If using WebRTC and it's connected, audio is already streaming
      // No need to send audio data separately
      if (this.usingWebRTC && WebRTCService.isStreamConnected()) {
        console.log('[APIService] Using WebRTC for audio streaming');
        return;
      }
      
      // Get file format based on platform or use provided format
      const format = fileFormat || (Platform.OS === 'ios' ? 'm4a' : 'mp3');
      console.log(`[APIService] Using file format: ${format}`);
      
      // Check audio data size
      const audioSize = audioData.length;
      console.log(`[APIService] Audio data size: ${audioSize} bytes`);
      
      // Determine if we need to chunk the data
      // Typical limit for Socket.IO is around 1MB, so we'll chunk at 500KB to be safe
      const CHUNK_SIZE = 500 * 1024; // 500KB in base64 characters
      
      if (audioSize <= CHUNK_SIZE) {
        // Small enough to send in one message
        console.log('[APIService] Sending audio in single message');
        
        // Fallback to Socket.IO for audio transmission
        this.emit('audio', {
          audio_data: audioData,
          file_format: format,
          chunked: false
        });
      } else {
        // Large audio needs to be chunked
        console.log(`[APIService] Audio size (${audioSize} bytes) exceeds chunk size (${CHUNK_SIZE} bytes)`);
        console.log('[APIService] Sending audio in chunks');
        
        // Calculate number of chunks
        const chunkCount = Math.ceil(audioSize / CHUNK_SIZE);
        console.log(`[APIService] Sending audio in ${chunkCount} chunks`);
        
        // Send chunk info first
        this.emit('audio_chunk_info', {
          total_chunks: chunkCount,
          file_format: format,
          total_size: audioSize
        });
        
        // Send each chunk with small delay to prevent overwhelming the server
        for (let i = 0; i < chunkCount; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, audioSize);
          const chunk = audioData.substring(start, end);
          
          console.log(`[APIService] Sending chunk ${i+1}/${chunkCount}, size: ${chunk.length} bytes`);
          
          // Send the chunk
          this.emit('audio_chunk', {
            chunk_data: chunk,
            chunk_index: i,
            is_last: i === chunkCount - 1
          });
          
          // Small delay to prevent overwhelming the Socket.IO connection
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        console.log('[APIService] All chunks sent successfully');
      }
    } catch (error) {
      console.error('[APIService] Error sending audio for transcription:', error);
      throw error;
    }
  }
  
  /**
   * Send text for processing
   */
  sendTextMessage(text) {
    try {
      if (!this.connected) {
        throw new Error('Not connected to server');
      }
      
      console.log('[APIService] Sending text message:', text);
      
      // Add to conversation history
      this.conversationHistory.push({ role: 'user', content: text });
      this.saveHistory();
      
      // Send message through Socket.IO
      this.emit('message', {
        text,
        voice: this.voicePreference
      });
      
    } catch (error) {
      console.error('[APIService] Error sending text message:', error);
      throw error;
    }
  }

  /**
   * Set voice preference for TTS
   */
  setVoicePreference(voice) {
    console.log('[APIService] Setting voice preference:', voice);
    this.voicePreference = voice;
  }

  /**
   * Register event listener
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  /**
   * Remove event listener
   */
  off(event, callback) {
    if (!this.eventListeners.has(event)) return;
    
    const listeners = this.eventListeners.get(event);
    const index = listeners.indexOf(callback);
    
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * Emit event to registered listeners
   */
  emitEvent(event, data) {
    if (!this.eventListeners.has(event)) return;
    
    this.eventListeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('[APIService] Error in event listener:', error);
      }
    });
  }

  /**
   * Check if backend is available via REST (fallback)
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
   * Process transcription and get LLM response
   * @param {string} transcription - Text to send to the LLM
   */
  processTranscription(transcription) {
    try {
      if (!this.connected) {
        console.error('[APIService] Cannot process transcription: Socket not connected');
        throw new Error('Socket not connected');
      }
      
      console.log('[APIService] Processing transcription with LLM:', transcription);
      
      // Send request to process the transcription
      this.emit('process_transcription', {
        text: transcription,
        voice: this.voicePreference
      });
    } catch (error) {
      console.error('[APIService] Error processing transcription:', error);
      throw error;
    }
  }

  /**
   * Check if the socket is actually connected based on socket properties
   * @returns {Promise<boolean>} True if the socket is connected
   */
  async checkSocketConnection() {
    return new Promise((resolve) => {
      if (!this.socket) {
        console.log('[APIService] No socket object exists');
        resolve(false);
        return;
      }
      
      // Check socket properties to determine connection status
      const hasId = !!this.socket.id;
      const isConnected = this.socket.connected;
      
      if (hasId && isConnected) {
        console.log('[APIService] Socket appears connected: ID=' + this.socket.id);
        
        // Send a health check to the server which should work with any server
        this.socket.emit('health_check');
        
        // Return true immediately since we're checking the properties
        resolve(true);
      } else {
        console.log('[APIService] Socket disconnected: hasId=' + hasId + ', connected=' + isConnected);
        
        // Check if we need to reconnect
        if (this.socket.disconnected) {
          console.log('[APIService] Socket is explicitly disconnected, attempting to connect');
          this.socket.connect();
        }
        
        resolve(false);
      }
    });
  }
}

// Export a singleton instance
export default new APIService(); 