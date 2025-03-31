import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';

// Use any for Socket since we're dynamically importing it
type Socket = any;

// Define MediaStreamConstraints manually since it's not exported from react-native-webrtc
interface MediaStreamConstraints {
  audio?: boolean;
  video?: boolean;
}

// Event types emitted by the WebRTC service
export const WEBRTC_EVENTS = {
  STREAM_READY: 'webrtc_stream_ready',
  STREAM_CLOSED: 'webrtc_stream_closed',
  ERROR: 'webrtc_error',
  ICE_STATE_CHANGE: 'ice_state_change',
  CONNECTION_STATE_CHANGE: 'connection_state_change'
} as const;

// Type for WebRTC event names
export type WebRTCEventType = typeof WEBRTC_EVENTS[keyof typeof WEBRTC_EVENTS];

// Type for event callbacks
type EventCallback = (data?: any) => void;

class WebRTCService {
  private peerConnection: RTCPeerConnection | null;
  private localStream: MediaStream | null;
  private isInitialized: boolean;
  private socketService: Socket | null;
  private isConnected: boolean;
  private eventListeners: Map<WebRTCEventType, EventCallback[]>;
  private clientId: string | null;
  
  // ICE Servers configuration (STUN/TURN)
  private iceServers: RTCConfiguration;
  
  constructor() {
    this.peerConnection = null;
    this.localStream = null;
    this.isInitialized = false;
    this.socketService = null;
    this.isConnected = false;
    this.eventListeners = new Map<WebRTCEventType, EventCallback[]>();
    this.clientId = null;
    
    // ICE Servers configuration (STUN/TURN)
    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };
  }
  
  /**
   * Initialize WebRTC with a socket service
   * @param socketService - Socket.IO service instance
   * @param clientId - Client ID for the WebRTC connection
   */
  initialize(socketService: Socket, clientId: string): void {
    if (this.isInitialized) {
      console.log('[WebRTCService] Already initialized');
      return;
    }
    
    console.log('[WebRTCService] Initializing with client ID:', clientId);
    this.socketService = socketService;
    this.clientId = clientId;
    
    // Register socket event handlers for WebRTC signaling
    this._registerSocketHandlers();
    
    this.isInitialized = true;
  }
  
  /**
   * Register event handlers for Socket.IO signaling
   */
  private _registerSocketHandlers(): void {
    if (!this.socketService) {
      console.error('[WebRTCService] Socket service not available');
      return;
    }
    
    // Register handlers for WebRTC signaling events
    this.socketService.on('webrtc_offer', this._handleOffer.bind(this));
    this.socketService.on('webrtc_answer', this._handleAnswer.bind(this));
    this.socketService.on('webrtc_ice_candidate', this._handleRemoteICECandidate.bind(this));
    this.socketService.on('webrtc_stream_ready_ack', this._handleStreamReadyAck.bind(this));
    this.socketService.on('webrtc_close', this._handleRemoteClose.bind(this));
  }
  
  /**
   * Start WebRTC stream - creates a peer connection and media stream
   */
  async startStream(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        throw new Error('WebRTC service not initialized');
      }
      
      console.log('[WebRTCService] Starting WebRTC stream');
      
      // Create new RTCPeerConnection
      this.peerConnection = new RTCPeerConnection(this.iceServers);
      
      // Setup event handlers
      this._setupPeerConnectionEvents();
      
      // Get local media stream (audio only for voice assistant)
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: false
      };
      
      console.log('[WebRTCService] Getting user media with constraints:', constraints);
      this.localStream = await mediaDevices.getUserMedia(constraints);
      console.log('[WebRTCService] Got local stream with tracks:', this.localStream.getTracks().length);
      
      // Add tracks to the peer connection
      this.localStream.getTracks().forEach(track => {
        if (this.peerConnection && this.localStream) {
          console.log('[WebRTCService] Adding track to peer connection:', track.kind);
          this.peerConnection.addTrack(track, this.localStream);
        }
      });
      
      // Create and send offer
      await this._createAndSendOffer();
      
      // Notify server that stream is ready
      if (this.socketService) {
        this.socketService.emit('webrtc_stream_ready', {
          audio_config: {
            sampleRate: 48000,
            channels: 1
          }
        });
      }
      
      this.isConnected = true;
      this._emitEvent(WEBRTC_EVENTS.STREAM_READY);
      return true;
    } catch (error) {
      console.error('[WebRTCService] Error starting stream:', error);
      this._emitEvent(WEBRTC_EVENTS.ERROR, error);
      this.stopStream();
      return false;
    }
  }
  
  /**
   * Create and send an SDP offer
   */
  private async _createAndSendOffer(): Promise<void> {
    try {
      if (!this.peerConnection) {
        throw new Error('Peer connection not created');
      }
      
      console.log('[WebRTCService] Creating offer');
      const offer = await this.peerConnection.createOffer({});
      console.log('[WebRTCService] Setting local description');
      await this.peerConnection.setLocalDescription(offer);
      
      if (this.socketService && this.peerConnection.localDescription) {
        console.log('[WebRTCService] Sending offer to server');
        this.socketService.emit('webrtc_offer', {
          sdp: this.peerConnection.localDescription,
          target: 'server' // The target should be 'server' for the Flask server
        });
      }
    } catch (error) {
      console.error('[WebRTCService] Error creating and sending offer:', error);
      throw error;
    }
  }
  
  /**
   * Setup peer connection event handlers
   */
  private _setupPeerConnectionEvents(): void {
    if (!this.peerConnection) return;
    
    // ICE candidate event
    this.peerConnection.addEventListener('icecandidate', (event) => {
      if (event.candidate && this.socketService) {
        console.log('[WebRTCService] ICE candidate generated');
        // Send ICE candidate to the server
        this.socketService.emit('webrtc_ice_candidate', {
          candidate: event.candidate,
          target: 'server'
        });
      }
    });
    
    // ICE connection state change
    this.peerConnection.addEventListener('iceconnectionstatechange', () => {
      if (!this.peerConnection) return;
      
      const state = this.peerConnection.iceConnectionState;
      console.log('[WebRTCService] ICE connection state changed:', state);
      this._emitEvent(WEBRTC_EVENTS.ICE_STATE_CHANGE, state);
      
      // Handle disconnection
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this._handleDisconnection();
      }
    });
    
    // Connection state change
    this.peerConnection.addEventListener('connectionstatechange', () => {
      if (!this.peerConnection) return;
      
      const state = this.peerConnection.connectionState;
      console.log('[WebRTCService] Connection state changed:', state);
      this._emitEvent(WEBRTC_EVENTS.CONNECTION_STATE_CHANGE, state);
      
      if (state === 'connected') {
        console.log('[WebRTCService] WebRTC connected successfully');
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this._handleDisconnection();
      }
    });
    
    // Negotiation needed - DISABLING automatic renegotiation for now
    // The initial offer/answer is sufficient for our audio streaming needs
    this.peerConnection.addEventListener('negotiationneeded', async () => {
      console.log('[WebRTCService] Negotiation needed - skipping automatic renegotiation');
      // Uncomment below if you need to re-enable renegotiation
      /*
      try {
        await this._createAndSendOffer();
      } catch (error) {
        console.error('[WebRTCService] Error handling negotiation:', error);
      }
      */
    });
  }
  
  /**
   * Handle WebRTC offer from server
   */
  private async _handleOffer(data: { sdp: RTCSessionDescription, from?: string }): Promise<void> {
    try {
      console.log('[WebRTCService] Received WebRTC offer from server');
      
      if (!this.peerConnection) {
        console.log('[WebRTCService] Creating peer connection in response to offer');
        this.peerConnection = new RTCPeerConnection(this.iceServers);
        this._setupPeerConnectionEvents();
      }
      
      // Set remote description
      const remoteDesc = new RTCSessionDescription(data.sdp);
      await this.peerConnection.setRemoteDescription(remoteDesc);
      
      // Create answer
      console.log('[WebRTCService] Creating answer');
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      
      // Send answer back to server
      if (this.socketService && this.peerConnection.localDescription) {
        console.log('[WebRTCService] Sending answer to server');
        this.socketService.emit('webrtc_answer', {
          sdp: this.peerConnection.localDescription,
          target: data.from || 'server'
        });
      }
    } catch (error) {
      console.error('[WebRTCService] Error handling offer:', error);
      this._emitEvent(WEBRTC_EVENTS.ERROR, error);
    }
  }
  
  /**
   * Handle WebRTC answer from server
   */
  private async _handleAnswer(data: { sdp: RTCSessionDescription, from?: string }): Promise<void> {
    try {
      console.log('[WebRTCService] Received WebRTC answer from server');
      
      if (!this.peerConnection) {
        console.error('[WebRTCService] Received answer but no peer connection exists');
        return;
      }
      
      // Set remote description
      const remoteDesc = new RTCSessionDescription(data.sdp);
      await this.peerConnection.setRemoteDescription(remoteDesc);
      
      console.log('[WebRTCService] Remote description set successfully');
    } catch (error) {
      console.error('[WebRTCService] Error handling answer:', error);
      this._emitEvent(WEBRTC_EVENTS.ERROR, error);
    }
  }
  
  /**
   * Handle ICE candidate from remote peer
   */
  private async _handleRemoteICECandidate(data: { candidate: RTCIceCandidateInit }): Promise<void> {
    try {
      if (!this.peerConnection) {
        console.warn('[WebRTCService] Received ICE candidate but no peer connection exists');
        return;
      }
      
      console.log('[WebRTCService] Adding remote ICE candidate');
      const candidate = new RTCIceCandidate(data.candidate);
      await this.peerConnection.addIceCandidate(candidate);
    } catch (error) {
      console.error('[WebRTCService] Error adding ICE candidate:', error);
    }
  }
  
  /**
   * Handle stream ready acknowledgment
   */
  private _handleStreamReadyAck(data: { message: string }): void {
    console.log('[WebRTCService] Stream ready acknowledged by server:', data.message);
  }
  
  /**
   * Handle remote close event
   */
  private _handleRemoteClose(data: { reason: string }): void {
    console.log('[WebRTCService] Received close request from server:', data.reason);
    this.stopStream();
  }
  
  /**
   * Handle disconnection
   */
  private _handleDisconnection(): void {
    if (this.isConnected) {
      console.log('[WebRTCService] WebRTC disconnected');
      this.isConnected = false;
      this._emitEvent(WEBRTC_EVENTS.STREAM_CLOSED);
    }
  }
  
  /**
   * Stop WebRTC stream and cleanup resources
   */
  stopStream(): void {
    console.log('[WebRTCService] Stopping WebRTC stream');
    
    // Close local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop();
      });
      this.localStream = null;
    }
    
    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    this.isConnected = false;
    this._emitEvent(WEBRTC_EVENTS.STREAM_CLOSED);
  }
  
  /**
   * Check if WebRTC is connected
   */
  isStreamConnected(): boolean {
    return this.isConnected && 
           !!this.peerConnection && 
           (this.peerConnection.connectionState === 'connected' || 
            this.peerConnection.iceConnectionState === 'connected');
  }
  
  /**
   * Register event listener
   */
  on(event: WebRTCEventType, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.push(callback);
    }
  }
  
  /**
   * Remove event listener
   */
  off(event: WebRTCEventType, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) return;
    
    const listeners = this.eventListeners.get(event);
    if (!listeners) return;
    
    const index = listeners.indexOf(callback);
    
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }
  
  /**
   * Emit event to registered listeners
   */
  private _emitEvent(event: WebRTCEventType, data?: any): void {
    if (!this.eventListeners.has(event)) return;
    
    const listeners = this.eventListeners.get(event);
    if (!listeners) return;
    
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('[WebRTCService] Error in event listener:', error);
      }
    });
  }
  
  /**
   * Clean up resources
   */
  cleanup(): void {
    this.stopStream();
    this.eventListeners.clear();
    this.isInitialized = false;
    this.socketService = null;
    this.clientId = null;
  }
}

// Export a singleton instance
export default new WebRTCService(); 