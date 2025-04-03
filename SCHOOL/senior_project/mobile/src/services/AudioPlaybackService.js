import { Audio } from 'expo-av';

class AudioPlaybackService {
  constructor() {
    this.sound = null;
    this.isPlaying = false;
    this.audioCache = new Map();
    this.maxCacheSize = 10;
    this.onPlaybackComplete = null;
  }

  /**
   * Initialize audio playback settings
   */
  async initializePlayback() {
    try {
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
      console.log('[AudioPlaybackService] Audio playback mode initialized');
    } catch (error) {
      console.error('[AudioPlaybackService] Error initializing playback mode:', error);
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
      hash = hash & hash;
    }
    return hash.toString();
  }

  /**
   * Play audio from base64 string
   */
  async playAudio(audioBase64) {
    if (!audioBase64) {
      console.error('[AudioPlaybackService] No audio data provided');
      return;
    }
    
    try {
      console.log('[AudioPlaybackService] Starting playback');
      console.log('[AudioPlaybackService] Audio data length:', audioBase64.length, 'characters');
      
      // Log a sample of the audio data to verify it's valid base64
      if (audioBase64.length > 50) {
        console.log('[AudioPlaybackService] Audio data sample:', audioBase64.substring(0, 50) + '...');
      }
      
      await this.initializePlayback();
      await this.stopPlayback();

      const audioHash = this.hashString(audioBase64);

      if (this.audioCache.has(audioHash)) {
        console.log('[AudioPlaybackService] Using cached audio');
        this.sound = this.audioCache.get(audioHash);
      } else {
        console.log('[AudioPlaybackService] Creating new sound object');
        try {
          // Explicitly log the URI we're trying to load
          const uri = `data:audio/mp3;base64,${audioBase64}`;
          console.log('[AudioPlaybackService] Creating audio URI (starts with):', uri.substring(0, 30) + '...');
          
          // Verify the base64 data looks valid (should start with certain patterns for MP3)
          // First few bytes of MP3 files often start with ID3 or MPEG frame sync
          const validStart = audioBase64.startsWith('/') || 
                            audioBase64.startsWith('SUQz') || // 'ID3' in base64
                            audioBase64.startsWith('//vs'); // Common MPEG frame sync in base64
                            
          if (!validStart) {
            console.warn('[AudioPlaybackService] Warning: Audio data may not be valid MP3 base64 format');
          }
          
          console.log('[AudioPlaybackService] Creating sound object from URI');
          const { sound } = await Audio.Sound.createAsync(
            { uri },
            { shouldPlay: false, progressUpdateIntervalMillis: 100 }
          );
          this.sound = sound;
          this.audioCache.set(audioHash, sound);
          console.log('[AudioPlaybackService] Sound object created successfully');

          if (this.audioCache.size > this.maxCacheSize) {
            const oldestKey = this.audioCache.keys().next().value;
            const oldestSound = this.audioCache.get(oldestKey);
            await oldestSound.unloadAsync();
            this.audioCache.delete(oldestKey);
          }
        } catch (error) {
          console.error('[AudioPlaybackService] Error creating sound:', error.message || error);
          console.error('[AudioPlaybackService] Audio format may be invalid or unsupported');
          
          // Try alternate base64 format
          try {
            console.log('[AudioPlaybackService] Trying alternate format: data:audio/mpeg;base64');
            const alternateUri = `data:audio/mpeg;base64,${audioBase64}`;
            const { sound } = await Audio.Sound.createAsync(
              { uri: alternateUri },
              { shouldPlay: false, progressUpdateIntervalMillis: 100 }
            );
            this.sound = sound;
            this.audioCache.set(audioHash, sound);
            console.log('[AudioPlaybackService] Alternate format worked!');
          } catch (alternateError) {
            console.error('[AudioPlaybackService] Alternate format also failed:', alternateError.message || alternateError);
            throw error; // Throw the original error
          }
        }
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

        return new Promise((resolve, reject) => {
          let hasResolved = false;
          let timeoutId = null;
          let subscription = null;
          
          const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (subscription) subscription.remove();
            this.isPlaying = false;
          };

          subscription = this.sound.setOnPlaybackStatusUpdate(status => {
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
              reject(new Error(`Playback error: ${status.error}`));
            }
          });

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
        console.error('[AudioPlaybackService] Playback error:', error.message);
        throw error;
      }
    } catch (error) {
      console.error('[AudioPlaybackService] Error:', error.message);
      this.isPlaying = false;
      throw error;
    }
  }

  /**
   * Stop current playback
   */
  async stopPlayback() {
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
  async clearCache() {
    console.log('[AudioPlaybackService] Clearing audio cache');
    try {
      for (const [key, sound] of this.audioCache.entries()) {
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
   * Clean up resources
   */
  async cleanup() {
    console.log('[AudioPlaybackService] Starting cleanup');
    await this.stopPlayback();
    await this.clearCache();
    this.sound = null;
    console.log('[AudioPlaybackService] Cleanup completed');
  }
}

// Export a singleton instance
export default new AudioPlaybackService(); 