import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

// API URL - use your computer's IP address for physical devices
const API_URL = 'http://144.38.136.80:5001/api/openai';

class OpenAIVoiceService {
  constructor() {
    this.sound = null;
    this.recording = null;
    this.isListening = false;
    this.onTranscriptReceived = null;
    this.onError = null;
    this.onListeningChange = null;
    this.recordingInterval = null;
    this.isProcessingAudio = false;
    this.audioFilePath = null;
    this.voicePreference = 'alloy'; // OpenAI voice options: alloy, echo, fable, onyx, nova, shimmer
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
    
    // Cache for audio playback
    this.audioCache = new Map();
    
    // Set up audio mode once at startup rather than repeatedly
    this.initializeAudio();
  }
  
  /**
   * Initialize audio settings
   */
  async initializeAudio() {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
        interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      console.log('[OpenAIVoiceService] Audio mode initialized');
    } catch (error) {
      console.error('[OpenAIVoiceService] Error initializing audio mode:', error);
    }
  }

  /**
   * Set the voice to use for TTS
   */
  setVoice(voice) {
    this.voicePreference = voice;
  }

  /**
   * Request microphone permissions
   */
  async requestMicrophonePermission() {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('[OpenAIVoiceService] Error requesting microphone permission:', error);
      return false;
    }
  }

  /**
   * Start recording audio
   */
  async startListening() {
    if (this.isListening) {
      console.log('[OpenAIVoiceService] Already listening');
      return;
    }

    try {
      // Request microphone permission
      const permission = await this.requestMicrophonePermission();
      if (!permission) {
        throw new Error('Microphone permission not granted');
      }

      // Configure audio settings
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        interruptionModeIOS: 1, // Audio.InterruptionModeIOS.DoNotMix
        interruptionModeAndroid: 1, // Audio.InterruptionModeAndroid.DoNotMix
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      // Prepare recording options
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
        // Add metering for auto silence detection
        android: {
          ...this.recordingOptions?.android,
          progressUpdateIntervalMillis: 100,
        },
        ios: {
          ...this.recordingOptions?.ios,
          progressUpdateIntervalMillis: 100,
        },
      };

      // Create and start recording
      this.recording = new Audio.Recording();
      await this.recording.prepareToRecordAsync(recordingOptions);
      
      // Set up auto silence detection
      this.silenceDetectionStartTime = null;
      this.recording.setOnRecordingStatusUpdate(status => {
        // Check if we have metering data
        if (status.metering !== undefined) {
          const silenceThreshold = -50; // dB threshold for silence
          const silenceMinDuration = 1500; // ms of silence before stopping
          
          if (status.metering < silenceThreshold) {
            // If we detect silence and haven't started counting yet
            if (!this.silenceDetectionStartTime) {
              this.silenceDetectionStartTime = Date.now();
            } else {
              // Check if we've had enough silence to stop
              const silenceDuration = Date.now() - this.silenceDetectionStartTime;
              if (silenceDuration >= silenceMinDuration && this.isListening) {
                console.log(`[OpenAIVoiceService] Silence detected for ${silenceDuration}ms, auto-stopping`);
                this.stopListening();
              }
            }
          } else {
            // Reset silence timer if we hear something
            this.silenceDetectionStartTime = null;
          }
        }
      });
      
      await this.recording.startAsync();

      this.isListening = true;
      console.log('[OpenAIVoiceService] Started recording');

      if (this.onListeningChange) {
        this.onListeningChange(true);
      }

    } catch (error) {
      console.error('[OpenAIVoiceService] Error starting recording:', error);
      
      if (this.onError) {
        this.onError(error.message || 'Failed to start recording');
      }
      
      await this.stopListening(false); // Clean up without processing
    }
  }

  /**
   * Stop recording and process the audio
   * @param {boolean} shouldProcess - Whether to process the audio after stopping
   */
  async stopListening(shouldProcess = true) {
    if (!this.isListening || !this.recording) {
      console.log('[OpenAIVoiceService] Not listening or no recording');
      return;
    }

    try {
      console.log('[OpenAIVoiceService] Stopping recording');
      await this.recording.stopAndUnloadAsync();
      
      // Update listening state
      this.isListening = false;
      if (this.onListeningChange) {
        this.onListeningChange(false);
      }

      // Get the recording URI
      const uri = this.recording.getURI();
      this.audioFilePath = uri;
      
      console.log(`[OpenAIVoiceService] Recording saved to: ${uri}`);
      
      // Reset recording object
      this.recording = null;

      // Process the audio for transcription if requested
      if (shouldProcess && uri) {
        console.log(`[OpenAIVoiceService] Will process audio file: ${uri}`);
        try {
          const transcript = await this.processAudio(uri);
          console.log(`[OpenAIVoiceService] Processing complete, transcript: "${transcript}"`);
          return transcript;
        } catch (processingError) {
          console.error('[OpenAIVoiceService] Error during audio processing:', processingError);
          if (this.onError) {
            this.onError(processingError.message || 'Failed to process audio');
          }
        }
      } else {
        console.log('[OpenAIVoiceService] Audio processing skipped');
      }
      
    } catch (error) {
      console.error('[OpenAIVoiceService] Error stopping recording:', error);
      
      if (this.onError) {
        this.onError(error.message || 'Failed to stop recording');
      }
      
      // Reset state
      this.isListening = false;
      this.recording = null;
      
      if (this.onListeningChange) {
        this.onListeningChange(false);
      }
    }
  }

  /**
   * Process recorded audio file with OpenAI Whisper API
   */
  async processAudio(audioUri) {
    if (!audioUri) {
      console.error('[OpenAIVoiceService] No audio URI provided');
      return null;
    }

    try {
      console.log(`[OpenAIVoiceService] Processing audio file: ${audioUri}`);
      
      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(audioUri);
      console.log(`[OpenAIVoiceService] Audio file size: ${fileInfo.size} bytes`);
      
      if (!fileInfo.exists || fileInfo.size === 0) {
        throw new Error('Audio file is empty or does not exist');
      }

      // Skip very small files - likely just background noise
      if (fileInfo.size < 10000) {
        console.log('[OpenAIVoiceService] Audio file too small, likely no speech content');
        return null;
      }

      // Convert to base64 for sending to API
      console.log('[OpenAIVoiceService] Reading file as base64...');
      const base64Audio = await FileSystem.readAsStringAsync(audioUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      console.log(`[OpenAIVoiceService] Successfully read file as base64, length: ${base64Audio.length} chars`);
      
      if (!base64Audio || base64Audio.length === 0) {
        throw new Error('Failed to read audio file as base64');
      }
      
      console.log(`[OpenAIVoiceService] Sending audio data to server at ${API_URL}/transcribe`);
      
      // Set a timeout for the fetch request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      // Send to our backend for processing by OpenAI Whisper
      const response = await fetch(`${API_URL}/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio_data: base64Audio,
          file_format: 'wav',
        }),
        signal: controller.signal
      });
      
      // Clear the timeout
      clearTimeout(timeoutId);

      console.log(`[OpenAIVoiceService] Server response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error (${response.status}): ${errorText}`);
      }

      const responseData = await response.json();
      console.log('[OpenAIVoiceService] Server response:', JSON.stringify(responseData));
      
      if (!responseData.success) {
        throw new Error(responseData.error || 'Transcription failed');
      }

      const transcript = responseData.text;
      console.log(`[OpenAIVoiceService] Transcription: "${transcript}"`);
      
      // Filter out likely background noise or "can you hear me" type phrases
      if (this.isLikelyNoise(transcript)) {
        // Disabled - we're now processing all transcripts
        // console.log('[OpenAIVoiceService] Transcription appears to be background noise or test phrases, ignoring');
        // return null;
      }
      
      // Call the callback with the transcription
      if (this.onTranscriptReceived && transcript) {
        console.log('[OpenAIVoiceService] Calling onTranscriptReceived callback');
        this.onTranscriptReceived(transcript);
      }
      
      // Clean up the audio file in the background
      this.cleanupAudioFile(audioUri);
      
      return transcript;
      
    } catch (error) {
      console.error('[OpenAIVoiceService] Error processing audio:', error);
      
      if (this.onError) {
        this.onError(error.message || 'Failed to process audio');
      }
      
      // Clean up the audio file even on error
      this.cleanupAudioFile(audioUri);
      
      return null;
    }
  }
  
  /**
   * Clean up audio file in the background
   */
  async cleanupAudioFile(audioUri) {
    try {
      await FileSystem.deleteAsync(audioUri);
      console.log('[OpenAIVoiceService] Deleted audio file');
    } catch (e) {
      console.log('[OpenAIVoiceService] Error deleting audio file:', e);
    }
  }

  /**
   * Check if transcript is likely just background noise or test phrases
   */
  isLikelyNoise(transcript) {
    // Disable noise filtering - always return false
    return false;
    
    // Original noise filtering code below is now disabled
    /*
    if (!transcript) return true;
    
    // Convert to lowercase for easier matching
    const text = transcript.toLowerCase().trim();
    
    // Common test phrases or background noise patterns
    const noisePatterns = [
      'can you hear me',
      'hello?',
      'testing',
      'check',
      '1234',
      '1040',
      'mic test',
      'test test',
      'uh',
      'um'
    ];
    
    // If the transcript is very short, it might be noise
    if (text.split(' ').length < 3) {
      console.log('[OpenAIVoiceService] Transcript too short, likely noise');
      return true;
    }
    
    // Check if the transcript contains common test phrases
    for (const pattern of noisePatterns) {
      if (text.includes(pattern)) {
        console.log(`[OpenAIVoiceService] Transcript contains noise pattern: "${pattern}"`);
        return true;
      }
    }
    
    // Check for repetition which often indicates background noise or testing
    const words = text.split(' ');
    const uniqueWords = new Set(words);
    if (words.length > 5 && uniqueWords.size < words.length / 2) {
      console.log('[OpenAIVoiceService] Transcript has too much repetition, likely noise');
      return true;
    }
    
    // Check if there's a meaningful question or command
    const meaningfulPhrases = [
      'what', 'how', 'why', 'when', 'where', 'who', 'tell me', 
      'can you', 'help', 'need', 'want', 'please', 'thank'
    ];
    
    for (const phrase of meaningfulPhrases) {
      if (text.includes(phrase)) {
        console.log(`[OpenAIVoiceService] Transcript contains meaningful phrase: "${phrase}"`);
        return false; // This is probably a real question or command
      }
    }
    
    // If no meaningful phrases found in a longer transcript, it might still be noise
    if (words.length > 10) {
      console.log('[OpenAIVoiceService] Long transcript without meaningful phrases, might be conversation not directed at assistant');
      return true;
    }
    
    return false;
    */
  }

  /**
   * Get a response to user input from OpenAI
   */
  async getResponse(userInput) {
    try {
      console.log(`[OpenAIVoiceService] Getting response for: "${userInput}"`);
      
      // Set a timeout for the fetch request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userInput,
          voice: this.voicePreference,
        }),
        signal: controller.signal
      });
      
      // Clear the timeout
      clearTimeout(timeoutId);
      
      console.log(`[OpenAIVoiceService] Chat response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OpenAIVoiceService] Error response: ${errorText}`);
        throw new Error(`Server error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      console.log('[OpenAIVoiceService] Chat response:', JSON.stringify(data));
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to get response');
      }
      
      // Play the response audio
      if (data.audio) {
        console.log('[OpenAIVoiceService] Playing response audio');
        await this.playAudio(data.audio);
        console.log('[OpenAIVoiceService] Response audio playback completed');
      } else {
        console.log('[OpenAIVoiceService] No audio in response');
      }
      
      return data.text;
    } catch (error) {
      console.error('[OpenAIVoiceService] Error getting response:', error);
      
      // Check if this was an abort error
      if (error.name === 'AbortError') {
        console.error('[OpenAIVoiceService] Request timed out');
        throw new Error('Request timed out. The server might be busy or unreachable.');
      }
      
      throw error;
    }
  }

  /**
   * Generate speech from text using OpenAI TTS
   */
  async textToSpeech(text) {
    try {
      console.log(`[OpenAIVoiceService] Generating speech for: "${text}"`);
      
      const response = await fetch(`${API_URL}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          voice: this.voicePreference,
        }),
      });

      const responseData = await response.json();
      
      if (!responseData.success) {
        throw new Error(responseData.error || 'Text-to-speech failed');
      }

      // Play the audio
      await this.playAudio(responseData.audio);
      
      return {
        audio: responseData.audio,
      };
      
    } catch (error) {
      console.error('[OpenAIVoiceService] Error generating speech:', error);
      throw error;
    }
  }

  /**
   * Play audio from base64 string, with caching for repeated phrases
   */
  async playAudio(base64Audio) {
    if (!base64Audio) {
      console.error('[OpenAIVoiceService] No audio data provided');
      return;
    }
    
    try {
      console.log('[OpenAIVoiceService] Starting audio playback');
      
      // Stop any existing audio
      if (this.sound) {
        console.log('[OpenAIVoiceService] Unloading previous audio');
        try {
          await this.sound.unloadAsync();
        } catch (e) {
          console.log('[OpenAIVoiceService] Error unloading previous audio:', e);
        }
        this.sound = null;
      }

      // Set audio mode for playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
        interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      // Create a new sound object
      const soundObject = new Audio.Sound();
      
      // Convert base64 to URI
      const uri = `data:audio/mp3;base64,${base64Audio}`;
      
      // Load the audio
      console.log('[OpenAIVoiceService] Loading audio');
      await soundObject.loadAsync({ uri }, { shouldPlay: false });
      console.log('[OpenAIVoiceService] Audio loaded successfully');
      
      // Set volume to maximum
      await soundObject.setVolumeAsync(1.0);
      
      // Get and log duration
      const status = await soundObject.getStatusAsync();
      const durationMs = status.durationMillis || 5000;
      console.log(`[OpenAIVoiceService] Audio duration: ${durationMs}ms`);
      
      // Play the audio
      console.log('[OpenAIVoiceService] Starting audio playback');
      await soundObject.playAsync();
      
      // Keep track of the sound object
      this.sound = soundObject;
      
      // Return a promise that resolves when playback is done
      return new Promise((resolve, reject) => {
        let isResolved = false;
        
        // Function to resolve only once
        const safeResolve = async () => {
          if (!isResolved) {
            isResolved = true;
            console.log('[OpenAIVoiceService] Resolving playback promise');
            
            // Reset audio mode for recording after playback
            try {
              await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                staysActiveInBackground: true,
                interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
                interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
              });
            } catch (e) {
              console.warn('[OpenAIVoiceService] Error resetting audio mode:', e);
            }
            
            resolve();
          }
        };
        
        // Set up status monitoring
        soundObject.setOnPlaybackStatusUpdate((status) => {
          if (status.didJustFinish) {
            console.log('[OpenAIVoiceService] Audio playback finished naturally');
            setTimeout(safeResolve, 300);
          } else if (status.error) {
            console.error('[OpenAIVoiceService] Audio playback error:', status.error);
            reject(new Error(`Playback error: ${status.error}`));
          }
        });
        
        // Safety timeout based on audio duration + buffer
        const safetyTimeoutMs = Math.max(durationMs * 1.2, durationMs + 2000);
        setTimeout(() => {
          console.log(`[OpenAIVoiceService] Safety timeout reached after ${safetyTimeoutMs}ms`);
          safeResolve();
        }, safetyTimeoutMs);
      });
      
    } catch (error) {
      console.error('[OpenAIVoiceService] Error playing audio:', error);
      throw error;
    }
  }
  
  /**
   * Simple string hashing function for audio caching
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  }

  /**
   * Start a conversation with the assistant
   */
  async startConversation() {
    try {
      console.log('[OpenAIVoiceService] Starting conversation');
      
      // Ensure audio mode is properly set
      await this.initializeAudio();
      
      // Add timeout to the fetch request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      console.log(`[OpenAIVoiceService] Making request to ${API_URL}/start`);
      const response = await fetch(`${API_URL}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          voice: this.voicePreference,
        }),
        signal: controller.signal
      });
      
      // Clear the timeout
      clearTimeout(timeoutId);
      
      console.log(`[OpenAIVoiceService] Start conversation response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OpenAIVoiceService] Server error: ${errorText}`);
        throw new Error(`Server error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      console.log('[OpenAIVoiceService] Start conversation response:', JSON.stringify(data));
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to start conversation');
      }
      
      // Play the greeting audio
      if (data.audio) {
        console.log('[OpenAIVoiceService] Playing greeting audio');
        try {
          await this.playAudio(data.audio);
          console.log('[OpenAIVoiceService] Greeting playback completed');
        } catch (playbackError) {
          console.error('[OpenAIVoiceService] Error playing greeting:', playbackError);
          // Don't throw here, just log the error
        }
      } else {
        console.log('[OpenAIVoiceService] No greeting audio in response');
      }
      
      // Set a flag to prevent premature ending
      this.isConversationActive = true;
      
      return data.text;
      
    } catch (error) {
      console.error('[OpenAIVoiceService] Error starting conversation:', error);
      this.isConversationActive = false;
      throw error;
    }
  }

  /**
   * End the current conversation
   */
  async endConversation() {
    if (!this.isConversationActive) {
      console.log('[OpenAIVoiceService] No active conversation to end');
      return;
    }

    try {
      console.log('[OpenAIVoiceService] Ending conversation');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(`${API_URL}/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          voice: this.voicePreference,
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      console.log('[OpenAIVoiceService] End conversation response:', JSON.stringify(data));
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to end conversation');
      }
      
      // Play the farewell audio
      if (data.audio) {
        console.log('[OpenAIVoiceService] Playing farewell audio');
        await this.playAudio(data.audio);
        console.log('[OpenAIVoiceService] Farewell playback completed');
      } else {
        console.log('[OpenAIVoiceService] No farewell audio in response');
      }
      
      // Clear the active conversation flag
      this.isConversationActive = false;
      
      return data.text;
      
    } catch (error) {
      console.error('[OpenAIVoiceService] Error ending conversation:', error);
      this.isConversationActive = false;
      throw error;
    }
  }

  /**
   * Set callback for transcript reception
   */
  setOnTranscriptReceived(callback) {
    this.onTranscriptReceived = callback;
  }

  /**
   * Set callback for errors
   */
  setOnError(callback) {
    this.onError = callback;
  }

  /**
   * Set callback for listening state changes
   */
  setOnListeningChange(callback) {
    this.onListeningChange = callback;
  }
}

// Export a singleton instance
export default new OpenAIVoiceService(); 