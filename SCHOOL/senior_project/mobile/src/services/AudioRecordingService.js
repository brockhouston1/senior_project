import { Audio } from 'expo-av';

class AudioRecordingService {
  constructor() {
    this.recording = null;
    this.isInitialized = false;
    this.onRecordingStatusUpdate = null;
    this.silenceDetectionStartTime = null;
    
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
        audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_HIGH,
        sampleRate: 44100,
        numberOfChannels: 1,
        bitRate: 128000,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
      web: {
        mimeType: 'audio/wav',
        audioBitsPerSecond: 128000,
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
   * Set callback for recording status updates
   */
  setOnRecordingStatusUpdate(callback) {
    this.onRecordingStatusUpdate = callback;
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
      
      // Use platform-specific formats that are well supported
      const recordingOptions = {
        android: {
          extension: '.mp3',
          outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
          audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a', // iOS supports M4A much better than MP3 for recording
          outputFormat: Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_MPEG4AAC,
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
      
      await this.recording.stopAndUnloadAsync();
      
      // Get the recording URI
      const uri = this.recording.getURI();
      console.log(`[AudioRecordingService] Recording saved to: ${uri}`);
      
      // Clean up
      const recordingObject = this.recording;
      this.recording = null;
      
      return {
        uri,
        recording: recordingObject,
        duration: recordingDuration
      };
    } catch (error) {
      console.error('[AudioRecordingService] Error stopping recording:', error);
      this.recording = null;
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
  }
}

// Export a singleton instance
export default new AudioRecordingService(); 