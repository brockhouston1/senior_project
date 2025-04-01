import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import APIService from './APIService';

// Types for recording options
interface RecordingOptions {
  android: {
    extension: string;
    outputFormat: number;
    audioEncoder: number;
    sampleRate: number;
    numberOfChannels: number;
    bitRate: number;
  };
  ios: {
    extension: string;
    outputFormat?: number;
    audioQuality: number;
    sampleRate: number;
    numberOfChannels: number;
    bitRate: number;
    linearPCMBitDepth: number;
    linearPCMIsBigEndian: boolean;
    linearPCMIsFloat: boolean;
  };
  web: {
    mimeType: string;
    audioBitsPerSecond: number;
  };
}

// Types for recording status
interface RecordingStatus {
  isRecording: boolean;
  durationMillis: number;
  isDoneRecording: boolean;
  metering?: number;
  // Add any other properties from the recording status
}

// Types for streaming config
interface StreamingConfig {
  chunkDurationMs: number;
  useWebRTC: boolean;
  silenceDetectionEnabled: boolean;
  silenceThresholdDb: number;
  silenceTimeoutMs: number;
}

class AudioRecordingService {
  private recording: Audio.Recording | null;
  private isInitialized: boolean;
  private onRecordingStatusUpdate: ((status: RecordingStatus) => void) | null;
  private silenceDetectionStartTime: number | null;
  private recordingOptions: RecordingOptions;
  private streamingEnabled: boolean;
  private streamingConfig: StreamingConfig;
  private audioChunks: string[];
  private isStreaming: boolean;
  private streamingInterval: ReturnType<typeof setInterval> | null;
  private recordingStartTime: number;
  
  constructor() {
    this.recording = null;
    this.isInitialized = false;
    this.onRecordingStatusUpdate = null;
    this.silenceDetectionStartTime = null;
    this.streamingEnabled = false;
    this.audioChunks = [];
    this.isStreaming = false;
    this.streamingInterval = null;
    this.recordingStartTime = 0;
    
    // Default streaming configuration
    this.streamingConfig = {
      chunkDurationMs: 500, // Send audio in 500ms chunks (adjust as needed)
      useWebRTC: false,     // Use WebRTC instead of chunked WebSocket streaming
      silenceDetectionEnabled: true,
      silenceThresholdDb: -25,  // dB threshold for silence detection
      silenceTimeoutMs: 2000    // Stop after 2 seconds of silence
    };
    
    // Recording options optimized for voice and WebSocket streaming
    this.recordingOptions = {
      android: {
        extension: '.webm', // WebM format is well supported for streaming
        outputFormat: 6, // Android WEBM value
        audioEncoder: 7, // Android OPUS value
        sampleRate: 24000,  // Match server sample rate
        numberOfChannels: 1,
        bitRate: 32000,    // Lower bitrate for streaming
      },
      ios: {
        extension: '.m4a',
        outputFormat: 2, // iOS MPEG4AAC value
        audioQuality: Audio.IOSAudioQuality.MEDIUM, // Balance quality/size for streaming
        sampleRate: 24000,
        numberOfChannels: 1,
        bitRate: 32000,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
      web: {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 32000,
      },
    };
  }

  /**
   * Configure streaming options
   */
  public configureStreaming(config: Partial<StreamingConfig>): void {
    this.streamingConfig = {
      ...this.streamingConfig,
      ...config
    };
    
    console.log('[AudioRecordingService] Streaming config updated:', this.streamingConfig);
    
    // If WebRTC is enabled, check if API Service has WebRTC capability
    if (this.streamingConfig.useWebRTC) {
      this.streamingConfig.useWebRTC = APIService.isWebRTCSupported();
      console.log('[AudioRecordingService] WebRTC support checked:', this.streamingConfig.useWebRTC);
    }
  }

  /**
   * Initialize audio recording settings
   */
  public async initializeRecording(): Promise<boolean> {
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
  public setOnRecordingStatusUpdate(callback: (status: RecordingStatus) => void): void {
    this.onRecordingStatusUpdate = callback;
  }

  /**
   * Start streaming recording via WebSockets
   */
  public async startStreamingRecording(): Promise<boolean> {
    try {
      // Check if WebSocket is connected
      if (!APIService.isConnected()) {
        console.error('[AudioRecordingService] WebSocket is not connected');
        return false;
      }
      
      // Use WebRTC for streaming if enabled
      if (this.streamingConfig.useWebRTC) {
        console.log('[AudioRecordingService] Using WebRTC for audio streaming');
        return this._startWebRTCStreaming();
      }
      
      // Otherwise, use chunked WebSocket streaming
      console.log('[AudioRecordingService] Starting chunked WebSocket streaming');
      
      // Start normal recording first
      const started = await this.startRecording();
      if (!started) {
        return false;
      }
      
      // Set up streaming flags
      this.streamingEnabled = true;
      this.isStreaming = true;
      this.audioChunks = [];
      this.recordingStartTime = Date.now();
      
      // Set up streaming interval to periodically send chunks
      this._setupStreamingInterval();
      
      return true;
    } catch (error) {
      console.error('[AudioRecordingService] Error starting streaming recording:', error);
      await this.stopRecording();
      return false;
    }
  }
  
  /**
   * Setup streaming interval to send audio chunks
   */
  private _setupStreamingInterval(): void {
    if (this.streamingInterval) {
      clearInterval(this.streamingInterval);
      this.streamingInterval = null;
    }
    
    this.streamingInterval = setInterval(async () => {
      if (!this.isStreaming || !this.recording) {
        return;
      }
      
      try {
        // Get recording status for debugging
        const status = await this.recording.getStatusAsync();
        
        // Get recording URI and convert to base64 for streaming
        // Note: This is a simplified approach. In a full implementation,
        // you would need to read the file and convert the appropriate chunk to base64.
        if (status.durationMillis >= this.streamingConfig.chunkDurationMs) {
          const uri = this.recording.getURI();
          if (uri) {
            console.log('[AudioRecordingService] Sending audio chunk');
            
            // In a real implementation, you would read the file and get just the new chunk
            // For this prototype, we'll send the dummy audio data
            const dummyAudioData = 'base64audiodatawouldbehereinarealimplementation';
            
            // Send audio data to server via WebSocket
            APIService.sendAudioChunk(dummyAudioData);
            
            // For debugging
            console.log('[AudioRecordingService] Audio chunk sent, duration:', status.durationMillis);
          }
        }
      } catch (error) {
        console.error('[AudioRecordingService] Error in streaming interval:', error);
      }
    }, this.streamingConfig.chunkDurationMs) as unknown as ReturnType<typeof setInterval>;
  }
  
  /**
   * Start WebRTC streaming
   */
  private async _startWebRTCStreaming(): Promise<boolean> {
    try {
      console.log('[AudioRecordingService] Starting WebRTC stream');
      
      // Start WebRTC stream via APIService
      const started = await APIService.startWebRTCStream();
      if (!started) {
        console.error('[AudioRecordingService] Failed to start WebRTC stream');
        return false;
      }
      
      // Set flags for WebRTC streaming
      this.streamingEnabled = true;
      this.isStreaming = true;
      this.recordingStartTime = Date.now();
      
      return true;
    } catch (error) {
      console.error('[AudioRecordingService] Error starting WebRTC stream:', error);
      return false;
    }
  }

  /**
   * Start recording audio (non-streaming mode)
   */
  public async startRecording(): Promise<boolean> {
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
      await this.recording.prepareToRecordAsync(this.recordingOptions);
      
      // Set up recording status updates
      if (this.onRecordingStatusUpdate) {
        this.recording.setOnRecordingStatusUpdate(this.onRecordingStatusUpdate);
      }
      
      // Start recording
      console.log('[AudioRecordingService] Starting recording');
      await this.recording.startAsync();
      console.log('[AudioRecordingService] Recording started successfully');
      
      this.recordingStartTime = Date.now();
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
   * Stop streaming recording
   */
  public async stopStreamingRecording(): Promise<{
    success: boolean;
    duration: number;
  }> {
    const duration = Date.now() - this.recordingStartTime;
    
    // Clean up streaming interval
    if (this.streamingInterval) {
      clearInterval(this.streamingInterval);
      this.streamingInterval = null;
    }
    
    // If using WebRTC, stop the WebRTC stream
    if (this.streamingConfig.useWebRTC) {
      console.log('[AudioRecordingService] Stopping WebRTC stream');
      await APIService.stopWebRTCStream();
      
      this.streamingEnabled = false;
      this.isStreaming = false;
      
      return {
        success: true,
        duration
      };
    }
    
    // Otherwise, stop normal recording
    console.log('[AudioRecordingService] Stopping chunked WebSocket streaming');
    
    // Tell server to process the audio
    APIService.processAudio();
    
    // Stop normal recording
    await this.stopRecording();
    
    this.streamingEnabled = false;
    this.isStreaming = false;
    
    return {
      success: true,
      duration
    };
  }

  /**
   * Stop recording and return the audio URI
   */
  public async stopRecording(): Promise<{
    uri: string | null;
    duration: number;
  } | null> {
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
      console.log(`[AudioRecordingService] Recording saved to: ${uri || 'null'}`);
      
      // Clean up
      const recordingObject = this.recording;
      this.recording = null;
      
      return {
        uri: uri || null,
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
  public async getStatus(): Promise<RecordingStatus | false> {
    if (!this.recording) {
      return false;
    }
    try {
      return await this.recording.getStatusAsync() as RecordingStatus;
    } catch (error) {
      console.error('[AudioRecordingService] Error getting recording status:', error);
      return false;
    }
  }

  /**
   * Check if currently recording
   */
  public isCurrentlyRecording(): boolean {
    return !!this.recording;
  }
  
  /**
   * Check if currently streaming
   */
  public isCurrentlyStreaming(): boolean {
    return this.isStreaming;
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    // Stop any streaming
    if (this.isStreaming) {
      await this.stopStreamingRecording();
    }
    
    // Stop any recording
    if (this.recording) {
      try {
        await this.recording.stopAndUnloadAsync();
      } catch (e) {
        console.warn('[AudioRecordingService] Error cleaning up recording:', e);
      }
      this.recording = null;
    }
    
    // Clear any intervals
    if (this.streamingInterval) {
      clearInterval(this.streamingInterval);
      this.streamingInterval = null;
    }
  }
}

// Export a singleton instance
export default new AudioRecordingService(); 