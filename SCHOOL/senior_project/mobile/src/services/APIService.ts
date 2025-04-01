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

// Type for event callback
type EventCallback = (data?: any) => void;

class APIService {
  baseUrl: string;
  socketUrl: string;
  socket: any; // Socket.IO client
  connected: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  reconnectTimeout: ReturnType<typeof setTimeout> | null;
  eventListeners: Map<string, EventCallback[]>;
  conversationHistory: Array<{role: string, content: string}>;
  voicePreference: string;
  clientId: string | null;
  usingWebRTC: boolean;
    
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
      console.error('[APIService] Error loading history:', error);
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
      console.error('[APIService] Error saving history:', error);
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
    if (this.socket && this.connected) {
      console.log('[APIService] WebSocket already connected');
      return;
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
          reconnectionDelayMax: 5000
        });
        
        // Socket.IO Connect
        this.socket.on('connect', () => {
          console.log('[APIService] Socket.IO connected, ID:', this.socket.id);
          this.connected = true;
          this.reconnectAttempts = 0;
          this.clientId = this.socket.id;
          
          // Initialize WebRTC service
          this._setupWebRTC();
          
          this.emitEvent(WS_EVENTS.CONNECT, null);
        });
        
        // Socket.IO Disconnect
        this.socket.on('disconnect', (reason: string) => {
          console.log('[APIService] Socket.IO disconnected, reason:', reason);
          this.connected = false;
          this.emitEvent(WS_EVENTS.DISCONNECT, reason);
        });
        
        // Socket.IO Reconnect
        this.socket.on('reconnect', (attemptNumber: number) => {
          console.log('[APIService] Socket.IO reconnected, attempt:', attemptNumber);
          this.connected = true;
        });
        
        // Socket.IO Error
        this.socket.on('error', (error: Error) => {
          console.error('[APIService] Socket.IO error:', error);
          this.emitEvent(WS_EVENTS.ERROR, error);
        });
        
        // Server status
        this.socket.on('server_status', (data: any) => {
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
    this.socket.on('transcription', (data: any) => {
      console.log('[APIService] Transcription received:', data.text);
      this.emitEvent(WS_EVENTS.TRANSCRIPTION, data.text);
    });
    
    // Audio data events
    this.socket.on('audio_data', (data: any) => {
      console.log('[APIService] Audio data received');
      this.emitEvent(WS_EVENTS.AUDIO_DATA, data.audio);
    });
    
    // Response events
    this.socket.on('response', (data: any) => {
      console.log('[APIService] Response received');
      
      // Add assistant response to history
      if (data.text) {
        this.conversationHistory.push({ role: 'assistant', content: data.text });
        this.saveHistory();
      }
      
      this.emitEvent(WS_EVENTS.RESPONSE, data);
    });
    
    // Error events
    this.socket.on('error_message', (data: any) => {
      console.error('[APIService] Error from server:', data.message);
      this.emitEvent(WS_EVENTS.ERROR, new Error(data.message));
    });

    // Audio received confirmation
    this.socket.on('audio_received', (data: any) => {
      console.log('[APIService] Audio chunk received confirmation:', data);
    });

    // Processing status updates
    this.socket.on('processing_status', (data: any) => {
      console.log('[APIService] Processing status update:', data);
      // You can emit custom events based on the processing stage
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
      this.emitEvent(WS_EVENTS.WEBRTC_READY, null);
    });
    
    WebRTCService.on(WEBRTC_EVENTS.STREAM_CLOSED, () => {
      console.log('[APIService] WebRTC stream closed');
      this.usingWebRTC = false;
      this.emitEvent(WS_EVENTS.WEBRTC_CLOSED, null);
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
    try {
      if (!this.connected) {
        console.error('[APIService] Cannot start WebRTC stream: WebSocket not connected');
        return false;
      }
      
      if (!WebRTCService) {
        console.error('[APIService] WebRTC service not available');
        return false;
      }
      
      console.log('[APIService] Starting WebRTC stream');
      const success = await WebRTCService.startStream();
      
      if (success) {
        console.log('[APIService] WebRTC stream started successfully');
        this.usingWebRTC = true;
        return true;
      } else {
        console.error('[APIService] Failed to start WebRTC stream');
        return false;
      }
    } catch (error) {
      console.error('[APIService] Error starting WebRTC stream:', error);
      return false;
    }
  }
  
  /**
   * Stop WebRTC stream
   */
  async stopWebRTCStream() {
    try {
      if (!WebRTCService) {
        console.error('[APIService] WebRTC service not available');
        return;
      }
      
      console.log('[APIService] Stopping WebRTC stream');
      await WebRTCService.stopStream();
      this.usingWebRTC = false;
      
      console.log('[APIService] WebRTC stream stopped');
    } catch (error) {
      console.error('[APIService] Error stopping WebRTC stream:', error);
    }
  }
  
  /**
   * Check if WebRTC is supported
   */
  isWebRTCSupported() {
    try {
      // Check if WebRTC service is available
      if (!WebRTCService) {
        return false;
      }
      
      // Check if the platform supports WebRTC
      if (Platform.OS === 'web') {
        // For web platforms, check if the browser supports WebRTC
        return typeof window !== 'undefined' && 
               'RTCPeerConnection' in window &&
               'getUserMedia' in navigator.mediaDevices;
      } else {
        // For native platforms, check if the module is available
        return true; // We assume the react-native-webrtc package is installed
      }
    } catch (error) {
      console.error('[APIService] Error checking WebRTC support:', error);
      return false;
    }
  }
  
  /**
   * Send an audio chunk to the server
   */
  sendAudioChunk(audioBase64: string) {
    if (!this.connected || !this.socket) {
      console.error('[APIService] Cannot send audio chunk: WebSocket not connected');
      return false;
    }
    
    try {
      this.socket.emit('audio', { audio_data: audioBase64 });
      return true;
    } catch (error) {
      console.error('[APIService] Error sending audio chunk:', error);
      return false;
    }
  }
  
  /**
   * Tell the server to process accumulated audio chunks
   */
  processAudio() {
    if (!this.connected || !this.socket) {
      console.error('[APIService] Cannot process audio: WebSocket not connected');
      return false;
    }
    
    try {
      this.socket.emit('process_audio');
      return true;
    } catch (error) {
      console.error('[APIService] Error sending process_audio command:', error);
      return false;
    }
  }
  
  /**
   * Send a text message to the server (for testing without audio)
   */
  sendTextMessage(text: string) {
    if (!this.connected || !this.socket) {
      console.error('[APIService] Cannot send text message: WebSocket not connected');
      return false;
    }
    
    try {
      // Add to conversation history
      this.conversationHistory.push({ role: 'user', content: text });
      this.saveHistory();
      
      // Send to server
      this.socket.emit('text_message', { text });
      return true;
    } catch (error) {
      console.error('[APIService] Error sending text message:', error);
      return false;
    }
  }
  
  /**
   * Add event listener
   */
  on(event: string, callback: EventCallback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.push(callback);
    }
    return this;
  }
  
  /**
   * Remove event listener
   */
  off(event: string, callback: EventCallback) {
    if (!this.eventListeners.has(event)) {
      return this;
    }
    
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
    
    return this;
  }
  
  /**
   * Emit event to listeners
   */
  emitEvent(event: string, data: any) {
    if (!this.eventListeners.has(event)) {
      return;
    }
    
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('[APIService] Error in event listener:', error);
        }
      });
    }
  }
  
  /**
   * Check if WebSocket is connected
   */
  isConnected() {
    return this.connected && !!this.socket;
  }
  
  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    if (this.socket) {
      try {
        this.socket.disconnect();
        this.socket = null;
        this.connected = false;
        console.log('[APIService] Disconnected from WebSocket server');
      } catch (error) {
        console.error('[APIService] Error disconnecting from WebSocket server:', error);
      }
    }
  }
}

// Export a singleton instance
export default new APIService(); 