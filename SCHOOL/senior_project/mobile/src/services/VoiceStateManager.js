import AudioRecordingService from './AudioRecordingService';
import AudioPlaybackService from './AudioPlaybackService';
import APIService from './APIService';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { Alert, Platform } from 'react-native';

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
    this.serverUrl = getServerUrl();
    
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
    
    // Listen for audio data from API service
    APIService.on('audio_data', async (audioData) => {
      console.log('[VoiceStateManager] Received audio data from server');
      if (audioData) {
        this.setState(VoiceState.RESPONDING);
        try {
          await AudioPlaybackService.playAudio(audioData);
        } catch (error) {
          console.error('[VoiceStateManager] Error playing audio:', error);
        }
      }
    });
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
    
    // Then check every 30 seconds (changed from 5 seconds)
    this.connectionCheckInterval = setInterval(() => {
      this.checkBackendConnection();
    }, 30000);
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
      // Connect to WebSocket server
      APIService.connect();
      
      // Set up response listener if not already listening
      APIService.on('response', (data) => {
        console.log('[VoiceStateManager] Received response from server:', data);
        if (data && data.text) {
          // Response contains text - can be stored or displayed
          console.log('[VoiceStateManager] Response text:', data.text);
        }
      });
      
      // Transition to responding state for initial greeting
      this.setState(VoiceState.RESPONDING);
      
      // Wait a moment for connection to be established
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // TESTING ONLY: Simulate a greeting with audio from the server
      console.log('[VoiceStateManager] Simulating welcome audio for testing');
      
      try {
        // Try to play a beep using the Audio API directly (no remote URL required)
        await this.playLocalBeep();
      } catch (localError) {
        console.error('[VoiceStateManager] Error playing local beep:', localError);
        
        // As a backup, try to play a remote sound
        try {
          await this.playRemoteAudioForTesting();
        } catch (remoteError) {
          console.error('[VoiceStateManager] Error playing test audio:', remoteError);
        }
      }
      
      // Transition to listening state automatically
      this.setState(VoiceState.LISTENING);
      await this.startListening();
    } catch (error) {
      console.error('[VoiceStateManager] Start assistant error:', error);
      this.setState(VoiceState.ERROR, error);
      throw error;
    }
  }
  
  /**
   * Play a simple local beep sound using the Audio API directly
   */
  async playLocalBeep() {
    try {
      console.log('[VoiceStateManager] Creating local sound');
      
      // Initialize the Audio API
      await this.initializeAudio();
      
      // Create and play a simple beep
      const sound = new Audio.Sound();
      
      console.log('[VoiceStateManager] Loading sound from Google CDN');
      await sound.loadAsync({
        uri: 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg'
      });
      
      console.log('[VoiceStateManager] Playing sound');
      await sound.playAsync();
      
      // Wait for the sound to finish or timeout
      await new Promise(resolve => {
        // Add status update handler
        sound.setOnPlaybackStatusUpdate(status => {
          if (status.didJustFinish) {
            console.log('[VoiceStateManager] Sound finished playing');
            resolve();
          }
        });
        
        // Set a timeout in case the sound doesn't trigger didJustFinish
        setTimeout(() => {
          console.log('[VoiceStateManager] Sound playback timeout');
          resolve();
        }, 2000);
      });
      
      // Clean up
      await sound.unloadAsync();
      console.log('[VoiceStateManager] Local beep sequence finished');
    } catch (error) {
      console.error('[VoiceStateManager] Error playing local beep:', error);
      throw error;
    }
  }
  
  /**
   * Initialize audio settings for playback
   */
  async initializeAudio() {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeIOS: 1, // Audio.InterruptionModeIOS.DoNotMix
        shouldDuckAndroid: false,
        interruptionModeAndroid: 1, // Audio.InterruptionModeAndroid.DoNotMix
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.error('[VoiceStateManager] Error initializing audio:', error);
      throw error;
    }
  }

  /**
   * Play a remote audio file for testing (temporary)
   */
  async playRemoteAudioForTesting() {
    try {
      console.log('[VoiceStateManager] Creating sound object from remote URL');
      
      // Create a new sound object
      const sound = new Audio.Sound();
      
      // Load from Google's CDN (highly reliable)
      await sound.loadAsync({
        uri: 'https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg'
      });
      
      // Play the sound
      console.log('[VoiceStateManager] Playing test sound');
      await sound.playAsync();
      
      // Wait for the sound to finish or timeout
      await new Promise(resolve => {
        // Add status update handler
        sound.setOnPlaybackStatusUpdate(status => {
          if (status.didJustFinish) {
            console.log('[VoiceStateManager] Sound finished playing');
            resolve();
          }
        });
        
        // Set a timeout in case the sound doesn't trigger didJustFinish
        setTimeout(() => {
          console.log('[VoiceStateManager] Sound playback timeout');
          resolve();
        }, 3000);
      });
      
      // Clean up
      await sound.unloadAsync();
      console.log('[VoiceStateManager] Test sound finished');
    } catch (error) {
      console.error('[VoiceStateManager] Error playing remote test audio:', error);
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
      
      // Send audio data to API service
      console.log('[VoiceStateManager] Sending audio for transcription');
      await APIService.sendAudioForTranscription(base64Audio);
      
      // For now, simulate a response by waiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      this.setState(VoiceState.IDLE);
      
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