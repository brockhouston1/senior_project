import AudioRecordingService from './AudioRecordingService';
import AudioPlaybackService from './AudioPlaybackService';
import APIService from './APIService';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { Alert, Platform } from 'react-native';

// Helper to get the correct server URL based on platform
const getServerUrl = (): string => {
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

// Voice assistant states
export const VoiceState = {
  IDLE: 'IDLE',           // Initial state, ready to start
  LISTENING: 'LISTENING', // Listening for user input
  RESPONDING: 'RESPONDING', // Agent is speaking
  PROCESSING: 'PROCESSING', // Processing user input or generating response
  ERROR: 'ERROR'          // Error state
} as const;

export type VoiceStateType = typeof VoiceState[keyof typeof VoiceState];

// Type for state change listeners
type StateChangeListener = (state: VoiceStateType, error: Error | null) => void;

class VoiceStateManager {
  private state: VoiceStateType;
  private error: Error | null;
  private listeners: Set<StateChangeListener>;
  private isConnected: boolean;
  private connectionCheckInterval: ReturnType<typeof setInterval> | null;
  private silenceTimeout: ReturnType<typeof setTimeout> | null;
  private safetyTimeout: ReturnType<typeof setTimeout> | null;
  private isConnecting: boolean;
  private isFirstPlayback: boolean;
  private serverUrl: string;
  
  constructor() {
    this.state = VoiceState.IDLE;
    this.error = null;
    this.listeners = new Set();
    this.isConnected = false;
    this.connectionCheckInterval = null;
    this.silenceTimeout = null;
    this.safetyTimeout = null;
    this.isConnecting = false;
    this.isFirstPlayback = true;
    this.serverUrl = getServerUrl();
    
    // Set up playback completion handler
    AudioPlaybackService.setOnPlaybackComplete(() => {
      if (this.state === VoiceState.RESPONDING) {
        console.log('[VoiceStateManager] Audio playback completed, transitioning to LISTENING');
        
        // Always transition to LISTENING and start listening automatically after any audio playback
        this.setState(VoiceState.LISTENING);
        
        // Wait a moment before starting to listen
        setTimeout(() => {
          console.log('[VoiceStateManager] Starting to listen after playback');
          this.startListening();
        }, 500);
      }
    });
  }

  /**
   * Add a state change listener
   */
  public addListener(callback: StateChangeListener): void {
    this.listeners.add(callback);
    // Immediately notify the new listener of current state
    callback(this.state, this.error);
  }

  /**
   * Remove a state change listener
   */
  public removeListener(callback: StateChangeListener): void {
    this.listeners.delete(callback);
  }

  /**
   * Update the state and notify listeners
   */
  public setState(newState: VoiceStateType, error: Error | null = null): void {
    console.log(`[VoiceStateManager] State: ${newState}${error ? ` (Error: ${error.message})` : ''}`);
    this.state = newState;
    this.error = error;
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(callback => {
      try {
        callback(this.state, this.error);
      } catch (error) {
        console.error('[VoiceStateManager] Listener error:', error instanceof Error ? error.message : String(error));
      }
    });
  }

  /**
   * Handle silence detection
   */
  public handleSilence = (): void => {
    if (this.state === VoiceState.LISTENING) {
      console.log('[VoiceStateManager] Silence detected');
      this.stopListening();
    }
  };

  /**
   * Check if backend is ready
   */
  public async checkBackendConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/api/health`);
      if (!response.ok) {
        throw new Error(`Backend not ready (${response.status})`);
      }
      
      const data = await response.json();
      if (data.status !== 'ok') {
        throw new Error(data.message || 'Backend not ready');
      }
      
      this.isConnected = true;
      return true;
    } catch (error) {
      this.isConnected = false;
      console.log('[VoiceStateManager] Backend connection check failed:', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /**
   * Start periodic connection checks
   */
  public startConnectionChecks(): void {
    // Check immediately
    this.checkBackendConnection();
    
    // Then check every 30 seconds (changed from 5 seconds)
    this.connectionCheckInterval = setInterval(() => {
      this.checkBackendConnection();
    }, 30000);
  }

  /**
   * Stop periodic connection checks
   */
  public stopConnectionChecks(): void {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
  }

  /**
   * Activate the voice state manager
   */
  public async activate(): Promise<void> {
    try {
      console.log('[VoiceStateManager] Activating voice state');
      
      // Wait for backend to be ready
      let attempts = 0;
      const maxAttempts = 5;
      while (!this.isConnected && attempts < maxAttempts) {
        console.log('[VoiceStateManager] Waiting for backend to be ready...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        await this.checkBackendConnection();
        attempts++;
      }

      if (!this.isConnected) {
        throw new Error('Backend not ready after multiple attempts');
      }

      // Start connection monitoring
      this.startConnectionChecks();
      
      // Initialize audio recording mode
      await AudioRecordingService.initializeRecording();
      
      // Set initial state
      this.state = VoiceState.IDLE;
      this.error = null;
      this.notifyListeners();
      
      console.log('[VoiceStateManager] Voice state activated');
    } catch (error) {
      console.error('[VoiceStateManager] Activation error:', error);
      this.state = VoiceState.ERROR;
      this.error = error instanceof Error ? error : new Error(String(error));
      this.notifyListeners();
      throw error;
    }
  }

  /**
   * Start the voice assistant (called when user presses the button)
   */
  public async startAssistant(): Promise<void> {
    if (this.state !== VoiceState.IDLE) {
      console.log(`[VoiceStateManager] Cannot start assistant in state: ${this.state}`);
      return;
    }

    try {
      // Connect to WebSocket server
      APIService.connect();
      
      // Transition to responding state for initial greeting
      this.setState(VoiceState.RESPONDING);
      
      // Wait a moment for connection to be established
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Get initial greeting - in a real implementation this would 
      // use the socket connection to get a response
      await this.playWelcomeMessage();
      
      // Transition to listening state automatically
      this.setState(VoiceState.LISTENING);
      await this.startListening();
    } catch (error) {
      console.error('[VoiceStateManager] Start assistant error:', error);
      this.setState(VoiceState.ERROR, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
  
  /**
   * Play welcome message
   */
  private async playWelcomeMessage(): Promise<void> {
    try {
      // Here you could get a welcome message from your API
      // For now, we'll just simulate a delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // In a real implementation, socket would send audio back
      // that we'd play here
      console.log('[VoiceStateManager] Welcome message played');
    } catch (error) {
      console.error('[VoiceStateManager] Error playing welcome message:', error);
      throw error;
    }
  }

  /**
   * Start listening for user input
   */
  public async startListening(): Promise<void> {
    if (this.state !== VoiceState.LISTENING) {
      console.log(`[VoiceStateManager] Cannot start listening in state: ${this.state}`);
      return;
    }

    try {
      console.log('[VoiceStateManager] Starting to listen');
      
      // Check microphone permissions again
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Microphone permission not granted');
      }
      
      // Start recording with WebSocket streaming
      const started = await AudioRecordingService.startStreamingRecording();
      if (!started) {
        throw new Error('Failed to start recording');
      }
      
      // Start safety timeout (max recording duration)
      this.safetyTimeout = setTimeout(() => {
        console.log('[VoiceStateManager] Safety timeout reached (max recording duration)');
        this.stopListening();
      }, 15000); // 15 seconds max recording
      
      console.log('[VoiceStateManager] Listening started');
    } catch (error) {
      console.error('[VoiceStateManager] Start listening error:', error);
      this.setState(VoiceState.ERROR, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Stop listening and process audio
   */
  public async stopListening(): Promise<void> {
    // Clear safety timeout
    if (this.safetyTimeout) {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }
    
    // Clear silence timeout
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
    
    if (this.state !== VoiceState.LISTENING) {
      console.log(`[VoiceStateManager] Cannot stop listening in state: ${this.state}`);
      return;
    }
    
    try {
      console.log('[VoiceStateManager] Stopping listening');
      
      // Change state to processing
      this.setState(VoiceState.PROCESSING);
      
      // Stop recording
      const result = await AudioRecordingService.stopStreamingRecording();
      if (!result) {
        console.error('[VoiceStateManager] No recording result');
        this.setState(VoiceState.ERROR, new Error('No recording result'));
        return;
      }
      
      console.log('[VoiceStateManager] Recording stopped, duration:', result.duration);
      
      // Wait for server to process and send back response
      // This will happen automatically through the socket connection
      
      // For now, simulate a brief processing delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // In a real implementation, we would wait for the socket to emit a response event
      // Instead, we'll transition to responding for now
      this.setState(VoiceState.RESPONDING);
      
      // Wait for response or timeout after 5 seconds
      const responseTimeout = setTimeout(() => {
        if (this.state === VoiceState.PROCESSING) {
          console.error('[VoiceStateManager] Response timeout');
          this.setState(VoiceState.ERROR, new Error('Response timeout'));
        }
      }, 5000);
      
      // In a real implementation, the socket would handle this automatically
      // For now, we'll simulate a response
      clearTimeout(responseTimeout);
      
      // Simulate processing different stages
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // In a real implementation, the socket would send audio back
      // that we'd play in the RESPONDING state
      console.log('[VoiceStateManager] Processing completed, response received');
      
      // For demonstration, we'll just go back to listening state
      this.setState(VoiceState.LISTENING);
    } catch (error) {
      console.error('[VoiceStateManager] Stop listening error:', error);
      this.setState(VoiceState.ERROR, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Reset the voice state manager
   */
  public reset(): void {
    this.stopConnectionChecks();
    
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
    
    if (this.safetyTimeout) {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }
    
    this.state = VoiceState.IDLE;
    this.error = null;
    this.notifyListeners();
  }

  /**
   * Deactivate the voice state manager
   */
  public async deactivate(): Promise<void> {
    try {
      console.log('[VoiceStateManager] Deactivating voice state');
      
      // Stop any ongoing processes
      if (this.state === VoiceState.LISTENING) {
        await this.stopListening();
      }
      
      // Disconnect from server
      APIService.disconnect();
      
      // Stop connection checks
      this.stopConnectionChecks();
      
      // Clean up audio resources
      await this.cleanup();
      
      // Reset state
      this.reset();
      
      console.log('[VoiceStateManager] Voice state deactivated');
    } catch (error) {
      console.error('[VoiceStateManager] Deactivation error:', error);
      this.setState(VoiceState.ERROR, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    try {
      console.log('[VoiceStateManager] Cleaning up resources');
      
      // Clean up recording resources
      await AudioRecordingService.cleanup();
      
      // Clean up playback resources
      await AudioPlaybackService.cleanup();
      
      console.log('[VoiceStateManager] Resources cleaned up');
    } catch (error) {
      console.error('[VoiceStateManager] Cleanup error:', error);
    }
  }
  
  /**
   * Get the current state
   */
  public getCurrentState(): VoiceStateType {
    return this.state;
  }
  
  /**
   * Get the current error
   */
  public getCurrentError(): Error | null {
    return this.error;
  }
  
  /**
   * Check if the voice assistant is active
   */
  public isActive(): boolean {
    return this.state !== VoiceState.IDLE && this.state !== VoiceState.ERROR;
  }
}

// Export a singleton instance
export default new VoiceStateManager(); 