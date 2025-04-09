import { Audio } from 'expo-av';

class AudioRecordingService {
  constructor() {
    this.recording = null;
    this.isInitialized = false;
    this.onRecordingStatusUpdate = null;
    
    // Silence detection parameters
    this.silenceDetectionEnabled = true;
    this.silenceThresholdDb = -50; // dB threshold for silence (much more lenient)
    this.silenceTimeThreshold = 5000; // 5 seconds of silence before stopping
    this.silenceDetectionStartTime = null;
    this.statusUpdateInterval = null;
    this.onSilenceDetected = null;
    
    // Recording options optimized for voice
    this.recordingOptions = {
      android: {
        extension: '.wav',
        outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_DEFAULT,
        audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_DEFAULT,
        sampleRate: 44100,
        numberOfChannels: 1,
        bitRate: 128000,
      },
      ios: {
        extension: '.wav',
        outputFormat: Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_LINEAR_PCM,
        audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_HIGH,
        sampleRate: 44100,
        numberOfChannels: 1,
        bitRate: 128000,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
    };
  }

  /**
   * Initialize audio recording settings
   */
  async initializeRecording() {
    try {
      // Request microphone permission
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        console.error('[AudioRecordingService] Microphone permission not granted');
        return false;
      }
      
      // Make sure to set the audio mode before recording
      console.log('[AudioRecordingService] Setting audio mode...');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: 1,
        interruptionModeAndroid: 1,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      console.log('[AudioRecordingService] Audio mode set successfully');
      
      this.isInitialized = true;
      console.log('[AudioRecordingService] Recording mode initialized');
      return true;
    } catch (error) {
      console.error('[AudioRecordingService] Error initializing recording mode:', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Set callback for when silence is detected
   * @param {Function} callback - Function to call when silence is detected
   */
  setOnSilenceDetected(callback) {
    this.onSilenceDetected = callback;
  }

  /**
   * Configure silence detection
   * @param {boolean} enabled - Whether silence detection is enabled
   * @param {number} thresholdDb - dB threshold for silence detection
   * @param {number} timeThreshold - Time in ms of silence before stopping
   */
  configureSilenceDetection(enabled = true, thresholdDb = -30, timeThreshold = 2000) {
    this.silenceDetectionEnabled = enabled;
    this.silenceThresholdDb = thresholdDb;
    this.silenceTimeThreshold = timeThreshold;
    console.log(`[AudioRecordingService] Silence detection ${enabled ? 'enabled' : 'disabled'}, threshold: ${thresholdDb}dB, time: ${timeThreshold}ms`);
  }

  /**
   * Start recording audio
   */
  async startRecording() {
    try {
      // Return if already recording
      if (this.recording) {
        console.log('[AudioRecordingService] Already recording');
        return true;
      }
      
      console.log('[AudioRecordingService] Initializing recording');
      // Always re-initialize audio mode before recording to ensure it's properly set
      const initialized = await this.initializeRecording();
      if (!initialized) {
        console.error('[AudioRecordingService] Failed to initialize recording');
        return false;
      }
      
      // Prepare recording object
      console.log('[AudioRecordingService] Creating recording object');
      this.recording = new Audio.Recording();
      
      console.log('[AudioRecordingService] Preparing to record');
      
      // Use WAV format which is better supported by transcription services
      const recordingOptions = {
        android: {
          extension: '.wav',
          outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_DEFAULT,
          audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_DEFAULT,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.wav',
          outputFormat: Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_LINEAR_PCM,
          audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_HIGH,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
      };
      
      console.log('[AudioRecordingService] Using recording options:', JSON.stringify(recordingOptions));
      await this.recording.prepareToRecordAsync(recordingOptions);
      
      // Set up status update handler for silence detection
      if (this.silenceDetectionEnabled) {
        console.log('[AudioRecordingService] Setting up silence detection');
        this.silenceDetectionStartTime = null;
        
        // Set up status update monitoring
        this.recording.setOnRecordingStatusUpdate(this._handleRecordingStatus);
        this.recording.setProgressUpdateInterval(500); // Update every 500ms
      }
      
      // Start recording
      console.log('[AudioRecordingService] Starting recording');
      await this.recording.startAsync();
      console.log('[AudioRecordingService] Recording started successfully');
      return true;
    } catch (error) {
      console.error('[AudioRecordingService] Error starting recording:', error);
      // Clean up if there was an error
      if (this.recording) {
        try {
          this.recording = null;
        } catch (cleanupError) {
          console.error('[AudioRecordingService] Error cleaning up recording:', cleanupError);
        }
      }
      return false;
    }
  }

  /**
   * Handle recording status updates for silence detection
   */
  _handleRecordingStatus = (status) => {
    if (!this.silenceDetectionEnabled || !status.isRecording) {
      return;
    }
    
    // Get the audio level (metering) from the status
    const metering = status.metering || -160; // Default to -160 if not available
    
    // Check if the audio level indicates silence
    if (metering <= this.silenceThresholdDb) {
      // If silence just started, record the start time
      if (this.silenceDetectionStartTime === null) {
        this.silenceDetectionStartTime = new Date().getTime();
        console.log(`[AudioRecordingService] Silence detected, starting timer (level: ${metering}dB)`);
      } else {
        // Check if silence has been ongoing for the threshold duration
        const silenceDuration = new Date().getTime() - this.silenceDetectionStartTime;
        
        if (silenceDuration >= this.silenceTimeThreshold) {
          console.log(`[AudioRecordingService] Silence threshold reached (${silenceDuration}ms), stopping recording`);
          
          // Stop recording
          this.stopRecording().then(result => {
            if (this.onSilenceDetected && result) {
              this.onSilenceDetected(result);
            }
          });
        }
      }
    } else {
      // Reset the silence timer if sound is detected
      if (this.silenceDetectionStartTime !== null) {
        console.log(`[AudioRecordingService] Sound detected (level: ${metering}dB), resetting silence timer`);
        this.silenceDetectionStartTime = null;
      }
    }
  }

  /**
   * Stop recording and return the audio URI
   */
  async stopRecording() {
    if (!this.recording) {
      console.log('[AudioRecordingService] Not recording or no recording object');
      return null;
    }

    try {
      console.log('[AudioRecordingService] Stopping recording');
      
      // Get status before stopping to get duration info
      let recordingDuration = 0;
      try {
        const status = await this.recording.getStatusAsync();
        recordingDuration = status.durationMillis || 0;
        console.log('[AudioRecordingService] Recording status before stopping:', status);
      } catch (statusError) {
        console.error('[AudioRecordingService] Error getting status:', statusError);
      }
      
      // Store the recording object before stopping
      const recordingObject = this.recording;
      
      try {
        await this.recording.stopAndUnloadAsync();
        
        // Get the recording URI
        const uri = recordingObject.getURI();
        console.log(`[AudioRecordingService] Recording saved to: ${uri}`);
        
        // Clean up
        this.recording = null;
        this.silenceDetectionStartTime = null;
        
        return {
          uri,
          recording: recordingObject,
          duration: recordingDuration
        };
      } catch (stopError) {
        // If we get the "Recorder does not exist" error, just log it and continue
        if (stopError.message && stopError.message.includes('Recorder does not exist')) {
          console.log('[AudioRecordingService] Recorder already stopped, continuing...');
          
          // Try to get the URI anyway
          try {
            const uri = recordingObject.getURI();
            console.log(`[AudioRecordingService] Recording saved to: ${uri}`);
            
            // Clean up
            this.recording = null;
            this.silenceDetectionStartTime = null;
            
            return {
              uri,
              recording: recordingObject,
              duration: recordingDuration
            };
          } catch (uriError) {
            console.log('[AudioRecordingService] Could not get URI from stopped recorder');
            return null;
          }
        } else {
          // For other errors, rethrow
          throw stopError;
        }
      }
    } catch (error) {
      console.error('[AudioRecordingService] Error stopping recording:', error);
      this.recording = null;
      this.silenceDetectionStartTime = null;
      return null;
    }
  }

  /**
   * Get recording status
   */
  async getStatus() {
    if (!this.recording) {
      return false;
    }
    try {
      const status = await this.recording.getStatusAsync();
      return status && status.isRecording;
    } catch (error) {
      console.error('[AudioRecordingService] Error getting recording status:', error);
      return false;
    }
  }

  /**
   * Check if currently recording
   */
  isCurrentlyRecording() {
    return !!this.recording;
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.recording) {
      try {
        await this.recording.stopAndUnloadAsync();
      } catch (e) {
        console.warn('[AudioRecordingService] Error cleaning up recording:', e);
      }
      this.recording = null;
    }
    this.silenceDetectionStartTime = null;
  }
}

// Export a singleton instance
export default new AudioRecordingService(); 