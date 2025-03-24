import AudioRecordingService from './AudioRecordingService';
import AudioPlaybackService from './AudioPlaybackService';
import APIService from './APIService';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { Alert } from 'react-native';

// Voice assistant states
export const VoiceState = {
  IDLE: 'IDLE',           // Initial state, ready to start
  LISTENING: 'LISTENING', // Listening for user input
  RESPONDING: 'RESPONDING', // Agent is speaking
  PROCESSING: 'PROCESSING', // Processing user input or generating response
  ERROR: 'ERROR'          // Error state
};

class VoiceStateManager {
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
    
    // Set up playback completion handler
    AudioPlaybackService.onPlaybackComplete = () => {
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
    };
  }

  /**
   * Add a state change listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    // Immediately notify the new listener of current state
    callback(this.state, this.error);
  }

  /**
   * Remove a state change listener
   */
  removeListener(callback) {
    this.listeners.delete(callback);
  }

  /**
   * Update the state and notify listeners
   */
  setState(newState, error = null) {
    console.log(`[VoiceStateManager] State: ${newState}${error ? ` (Error: ${error.message})` : ''}`);
    this.state = newState;
    this.error = error;
    this.notifyListeners();
  }

  notifyListeners() {
    this.listeners.forEach(callback => {
      try {
        callback(this.state, this.error);
      } catch (error) {
        console.error('[VoiceStateManager] Listener error:', error.message);
      }
    });
  }

  /**
   * Handle silence detection
   */
  handleSilence = () => {
    if (this.state === VoiceState.LISTENING) {
      console.log('[VoiceStateManager] Silence detected');
      this.stopListening();
    }
  };

  /**
   * Check if backend is ready
   */
  async checkBackendConnection() {
    try {
      const response = await fetch('http://144.38.136.80:5001/api/openai/health');
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
      console.log('[VoiceStateManager] Backend connection check failed:', error.message);
      return false;
    }
  }

  /**
   * Start periodic connection checks
   */
  startConnectionChecks() {
    // Check immediately
    this.checkBackendConnection();
    
    // Then check every 5 seconds
    this.connectionCheckInterval = setInterval(() => {
      this.checkBackendConnection();
    }, 5000);
  }

  /**
   * Stop periodic connection checks
   */
  stopConnectionChecks() {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
  }

  /**
   * Activate the voice state manager
   */
  async activate() {
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
      this.error = error;
      this.notifyListeners();
      throw error;
    }
  }

  /**
   * Start the voice assistant (called when user presses the button)
   */
  async startAssistant() {
    if (this.state !== VoiceState.IDLE) {
      console.log(`[VoiceStateManager] Cannot start assistant in state: ${this.state}`);
      return;
    }

    try {
      // Start a new conversation
      await APIService.startConversation();
      
      // Get initial greeting
      const response = await APIService.getResponse('Hello');
      if (response && response.audio) {
        this.setState(VoiceState.RESPONDING);
        await AudioPlaybackService.playAudio(response.audio);
        console.log('[VoiceStateManager] Welcome message played');
        
        // Wait for playback to complete and state to change
        await new Promise(resolve => {
          const checkState = () => {
            if (this.state === VoiceState.LISTENING) {
              resolve();
            } else {
              setTimeout(checkState, 100);
            }
          };
          checkState();
        });
      }
    } catch (error) {
      console.error('[VoiceStateManager] Start assistant error:', error);
      this.setState(VoiceState.ERROR, error);
      throw error;
    }
  }

  /**
   * Start listening for user input
   */
  async startListening() {
    if (this.state !== VoiceState.LISTENING) {
      console.log(`[VoiceStateManager] Cannot start listening in state: ${this.state}`);
      return;
    }

    try {
      console.log('[VoiceStateManager] Starting to listen');
      
      // Check microphone permissions again
      const { status } = await Audio.requestPermissionsAsync();
      console.log('[VoiceStateManager] Microphone permission status:', status);
      if (status !== 'granted') {
        console.error('[VoiceStateManager] Microphone permission not granted');
        Alert.alert('Microphone Permission', 'Please grant microphone permission in your device settings.');
        this.setState(VoiceState.ERROR, new Error('Microphone permission not granted'));
        return;
      }
      
      // Check if already recording
      const isRecording = AudioRecordingService.isCurrentlyRecording();
      if (isRecording) {
        console.log('[VoiceStateManager] Already recording, stopping previous recording');
        await AudioRecordingService.stopRecording();
      }
      
      // Start recording with retry logic
      console.log('[VoiceStateManager] Initializing recording...');
      let recordingStarted = false;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (!recordingStarted && retryCount < maxRetries) {
        recordingStarted = await AudioRecordingService.startRecording();
        console.log('[VoiceStateManager] Recording initialized result:', recordingStarted);
        
        if (!recordingStarted) {
          retryCount++;
          console.log(`[VoiceStateManager] Recording failed, retry ${retryCount}/${maxRetries}`);
          // Wait a moment before retrying
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      if (!recordingStarted) {
        console.error('[VoiceStateManager] Failed to start recording after retries');
        // Instead of throwing an error, reset to IDLE state
        this.setState(VoiceState.IDLE);
        return;
      }
      
      // DISABLE SILENCE DETECTION - use fixed recording time instead
      console.log('[VoiceStateManager] Silence detection disabled - using fixed recording time');
      
      // Set shorter fixed recording time (8 seconds)
      // This will automatically stop recording after 8 seconds
      this.safetyTimeout = setTimeout(async () => {
        console.log('[VoiceStateManager] Fixed recording time reached, stopping recording');
        await this.stopListening();
      }, 8000);
      
      console.log('[VoiceStateManager] Successfully started listening (will record for 8 seconds)');
      
    } catch (error) {
      console.error('[VoiceStateManager] Start listening error:', error);
      // Instead of going to ERROR state, go back to IDLE
      this.setState(VoiceState.IDLE);
    }
  }

  /**
   * Stop listening and process the recorded audio
   */
  async stopListening() {
    try {
      if (this.state !== VoiceState.LISTENING) {
        console.log(`[VoiceStateManager] Cannot stop listening from state: ${this.state}`);
        return;
      }

      if (this.silenceTimeout) {
        clearTimeout(this.silenceTimeout);
        this.silenceTimeout = null;
      }
      if (this.safetyTimeout) {
        clearTimeout(this.safetyTimeout);
        this.safetyTimeout = null;
      }

      this.setState(VoiceState.PROCESSING);
      
      // Check if recording is active
      if (!AudioRecordingService.isCurrentlyRecording()) {
        console.log('[VoiceStateManager] No active recording to stop');
        this.setState(VoiceState.IDLE);
        return;
      }
      
      const result = await AudioRecordingService.stopRecording();
      if (!result || !result.uri) {
        throw new Error('No audio recorded');
      }
      
      // Check file size
      const fileInfo = await FileSystem.getInfoAsync(result.uri);
      console.log('[VoiceStateManager] Audio file info:', fileInfo);
      
      if (!fileInfo.exists) {
        throw new Error('Audio file does not exist');
      }
      
      if (fileInfo.size === 0) {
        throw new Error('Audio file is empty');
      }
      
      if (fileInfo.size < 1000) { // Less than 1KB is probably not real audio
        console.warn('[VoiceStateManager] Audio file is very small, might not contain actual speech');
      }
      
      // Log recording duration if available
      if (result.duration) {
        console.log('[VoiceStateManager] Recording duration:', result.duration, 'ms');
      }
      
      console.log('[VoiceStateManager] Reading audio file as base64');
      const base64Audio = await FileSystem.readAsStringAsync(result.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      console.log('[VoiceStateManager] Base64 audio length:', base64Audio.length);
      
      if (base64Audio.length < 100) {
        throw new Error('Invalid audio data: base64 content too small');
      }
      
      console.log('[VoiceStateManager] Sending audio for transcription');
      const transcript = await APIService.transcribeAudio(base64Audio);
      
      if (!transcript) {
        throw new Error('Failed to transcribe audio');
      }
      
      console.log('[VoiceStateManager] Got transcript:', transcript);
      this.setState(VoiceState.RESPONDING);
      const response = await APIService.getResponse(transcript);
      
      if (response.audio) {
        await AudioPlaybackService.playAudio(response.audio);
        console.log('[VoiceStateManager] Response played');
      }
      
    } catch (error) {
      console.error('[VoiceStateManager] Processing error:', error.message);
      // Only show error state if we're actually in LISTENING or PROCESSING state
      if (this.state === VoiceState.LISTENING || this.state === VoiceState.PROCESSING) {
        this.setState(VoiceState.ERROR, error);
      }
      await this.cleanup();
    }
  }

  /**
   * Reset the voice assistant to initial state
   */
  reset() {
    this.state = VoiceState.IDLE;
    this.error = null;
    this.isFirstPlayback = true;
    this.notifyListeners();
  }

  /**
   * Deactivate the voice assistant
   */
  async deactivate() {
    try {
      console.log('[VoiceStateManager] Deactivating voice state');
      
      // Stop connection monitoring
      this.stopConnectionChecks();
      
      // Stop any ongoing recording
      await AudioRecordingService.stopRecording();
      
      // Clear conversation history
      await APIService.clearHistory();
      
      // Reset state
      this.reset();
      
      console.log('[VoiceStateManager] Voice state deactivated');
    } catch (error) {
      console.error('[VoiceStateManager] Deactivation error:', error);
      this.state = VoiceState.ERROR;
      this.error = error;
      this.notifyListeners();
      throw error;
    }
  }

  /**
   * Clean up resources and reset state
   */
  async cleanup() {
    // Clear timeouts
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
    if (this.safetyTimeout) {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }

    // Stop recording if active
    await AudioRecordingService.cleanup();
    
    // Stop playback if active
    await AudioPlaybackService.cleanup();
  }
}

// Export a singleton instance
export default new VoiceStateManager(); 