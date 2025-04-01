import { Audio } from 'expo-av';
import { Platform } from 'react-native';

// Define interfaces for type safety
interface PlaybackOptions {
  shouldPlay: boolean;
  volume: number;
  progressUpdateIntervalMillis?: number;
}

interface PlaybackStatus {
  isLoaded: boolean;
  isPlaying: boolean;
  didJustFinish: boolean;
  positionMillis: number;
  durationMillis: number;
  error?: string;
}

type PlaybackStatusCallback = (status: PlaybackStatus) => void;

class AudioPlaybackService {
  private sound: Audio.Sound | null;
  private isPlaying: boolean;
  private audioCache: Map<string, Audio.Sound>;
  private maxCacheSize: number;
  private onPlaybackComplete: (() => void) | null;
  private streamingMode: boolean;
  private streamingBuffer: string[];
  private isInitialized: boolean;

  constructor() {
    this.sound = null;
    this.isPlaying = false;
    this.audioCache = new Map();
    this.maxCacheSize = 10;
    this.onPlaybackComplete = null;
    this.streamingMode = false;
    this.streamingBuffer = [];
    this.isInitialized = false;
  }

  /**
   * Initialize audio playback settings
   */
  public async initializePlayback(): Promise<void> {
    try {
      if (this.isInitialized) {
        return;
      }
      
      console.log('[AudioPlaybackService] Initializing audio playback mode');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeIOS: 1, // Audio.InterruptionModeIOS.DoNotMix
        shouldDuckAndroid: false,
        interruptionModeAndroid: 1, // Audio.InterruptionModeAndroid.DoNotMix
        playThroughEarpieceAndroid: false,
      });
      
      this.isInitialized = true;
      console.log('[AudioPlaybackService] Audio playback mode initialized');
    } catch (error) {
      console.error('[AudioPlaybackService] Error initializing playback mode:', error);
      throw error;
    }
  }

  /**
   * Set callback for playback completion
   */
  public setOnPlaybackComplete(callback: () => void): void {
    this.onPlaybackComplete = callback;
  }

  /**
   * Enable streaming mode for receiving audio chunks
   */
  public enableStreamingMode(): void {
    this.streamingMode = true;
    this.streamingBuffer = [];
    console.log('[AudioPlaybackService] Streaming mode enabled');
  }

  /**
   * Disable streaming mode
   */
  public disableStreamingMode(): void {
    this.streamingMode = false;
    this.streamingBuffer = [];
    console.log('[AudioPlaybackService] Streaming mode disabled');
  }

  /**
   * Receive and handle an audio chunk in streaming mode
   */
  public receiveAudioChunk(audioChunk: string): void {
    if (!this.streamingMode) {
      console.warn('[AudioPlaybackService] Received audio chunk but streaming mode is disabled');
      return;
    }

    console.log('[AudioPlaybackService] Received audio chunk');
    
    // Add to buffer and play if this is the first chunk
    this.streamingBuffer.push(audioChunk);
    
    // If not currently playing, start playing the buffer
    if (!this.isPlaying && this.streamingBuffer.length > 0) {
      this._playStreamingBuffer();
    }
  }

  /**
   * Play the streaming buffer
   */
  private async _playStreamingBuffer(): Promise<void> {
    if (this.streamingBuffer.length === 0) {
      console.log('[AudioPlaybackService] No audio chunks in buffer');
      return;
    }

    try {
      // Take the first chunk from the buffer
      const audioChunk = this.streamingBuffer.shift();
      if (!audioChunk) return;
      
      console.log('[AudioPlaybackService] Playing audio chunk from streaming buffer');
      
      // Play this chunk
      await this.playAudio(audioChunk);
      
      // If there are more chunks, continue playing
      if (this.streamingBuffer.length > 0) {
        this._playStreamingBuffer();
      }
    } catch (error) {
      console.error('[AudioPlaybackService] Error playing streaming buffer:', error);
    }
  }

  /**
   * Simple string hashing function for audio caching
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  /**
   * Play audio from base64 string
   */
  public async playAudio(audioBase64: string): Promise<void> {
    if (!audioBase64) {
      console.error('[AudioPlaybackService] No audio data provided');
      return;
    }
    
    try {
      console.log('[AudioPlaybackService] Starting playback');
      
      await this.initializePlayback();
      await this.stopPlayback();

      const audioHash = this.hashString(audioBase64);

      if (this.audioCache.has(audioHash)) {
        console.log('[AudioPlaybackService] Using cached audio');
        this.sound = this.audioCache.get(audioHash) || null;
      } else {
        console.log('[AudioPlaybackService] Creating new sound object');
        try {
          const { sound } = await Audio.Sound.createAsync(
            { uri: `data:audio/mp3;base64,${audioBase64}` },
            { shouldPlay: false, volume: 1.0, progressUpdateIntervalMillis: 100 }
          );
          this.sound = sound;
          this.audioCache.set(audioHash, sound);
          console.log('[AudioPlaybackService] Sound object created');

          // Manage cache size
          if (this.audioCache.size > this.maxCacheSize) {
            const oldestKey = this.audioCache.keys().next().value;
            if (oldestKey) {
              const oldestSound = this.audioCache.get(oldestKey);
              if (oldestSound) {
                await oldestSound.unloadAsync();
                this.audioCache.delete(oldestKey);
              }
            }
          }
        } catch (error) {
          console.error('[AudioPlaybackService] Error creating sound:', error);
          throw error;
        }
      }

      if (!this.sound) {
        throw new Error('Sound object not created properly');
      }

      try {
        await this.sound.setVolumeAsync(1.0);
        const status = await this.sound.getStatusAsync();
        
        if (!status.isLoaded) {
          throw new Error('Sound not loaded properly');
        }

        console.log('[AudioPlaybackService] Starting playback');
        await this.sound.playAsync();
        this.isPlaying = true;

        return new Promise<void>((resolve, reject) => {
          let hasResolved = false;
          let timeoutId: NodeJS.Timeout | null = null;
          let subscription: { remove: () => void } | null = null;
          
          const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (subscription) subscription.remove();
            this.isPlaying = false;
          };

          if (this.sound) {
            // Create a wrapper object with a remove method
            const updateFunction = (status: any) => {
              console.log('[AudioPlaybackService] Status update:', {
                isPlaying: status.isPlaying,
                didJustFinish: status.didJustFinish,
                error: status.error,
                positionMillis: status.positionMillis,
                durationMillis: status.durationMillis
              });

              if (status.didJustFinish && !hasResolved) {
                hasResolved = true;
                cleanup();
                console.log('[AudioPlaybackService] Playback completed');
                resolve();
                if (this.onPlaybackComplete) {
                  this.onPlaybackComplete();
                }
              } else if (status.error && !hasResolved) {
                hasResolved = true;
                cleanup();
                console.error('[AudioPlaybackService] Playback error:', status.error);
                reject(new Error(`Playback error: ${status.error || 'Unknown error'}`));
              }
            };
            
            // Create a subscription object with a remove method
            this.sound.setOnPlaybackStatusUpdate(updateFunction);
            subscription = {
              remove: () => {
                if (this.sound) {
                  this.sound.setOnPlaybackStatusUpdate(null);
                }
              }
            };
          }

          timeoutId = setTimeout(() => {
            if (!hasResolved) {
              hasResolved = true;
              cleanup();
              console.log('[AudioPlaybackService] Playback timeout');
              resolve();
            }
          }, 8000); // Fixed timeout of 8 seconds
        });
      } catch (error) {
        console.error('[AudioPlaybackService] Playback error:', error);
        throw error;
      }
    } catch (error) {
      console.error('[AudioPlaybackService] Error:', error);
      this.isPlaying = false;
      throw error;
    }
  }

  /**
   * Stop current playback
   */
  public async stopPlayback(): Promise<void> {
    if (this.sound && this.isPlaying) {
      try {
        console.log('[AudioPlaybackService] Stopping playback');
        await this.sound.stopAsync();
        this.isPlaying = false;
        console.log('[AudioPlaybackService] Playback stopped successfully');
      } catch (error) {
        console.error('[AudioPlaybackService] Error stopping playback:', error);
      }
    }
  }

  /**
   * Clear audio cache
   */
  public async clearCache(): Promise<void> {
    console.log('[AudioPlaybackService] Clearing audio cache');
    try {
      // Use Array.from to avoid iteration issues
      const entries = Array.from(this.audioCache.entries());
      for (const [key, sound] of entries) {
        try {
          await sound.unloadAsync();
          this.audioCache.delete(key);
          console.log('[AudioPlaybackService] Cleared cache entry:', key);
        } catch (error) {
          console.error('[AudioPlaybackService] Error clearing cache entry:', key, error);
        }
      }
    } catch (error) {
      console.error('[AudioPlaybackService] Error clearing cache:', error);
    }
  }

  /**
   * Check if currently playing
   */
  public isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    console.log('[AudioPlaybackService] Starting cleanup');
    await this.stopPlayback();
    await this.clearCache();
    this.sound = null;
    this.streamingBuffer = [];
    this.isInitialized = false;
    console.log('[AudioPlaybackService] Cleanup completed');
  }
}

// Export a singleton instance
export default new AudioPlaybackService(); 