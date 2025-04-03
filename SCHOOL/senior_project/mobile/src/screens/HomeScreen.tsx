import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Animated, Modal, ScrollView } from 'react-native';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import VoiceStateManager, { VoiceState } from '../services/VoiceStateManager';
import APIService, { WS_EVENTS } from '../services/APIService';
import AudioRecordingService from '../services/AudioRecordingService';
import * as FileSystem from 'expo-file-system';

// Types
type Message = {
  id: string;
  text: string;
  isUser: boolean;
  hasAudio?: boolean;
  audio?: string | null;
  timestamp: string;
};

type HomeScreenProps = {
  navigation: DrawerNavigationProp<any>;
};

// Audio recording result type
type AudioRecordingResult = {
  uri: string;
  duration: number;
  recording?: any;
};

// Socket event types
type TranscriptionResponse = {
  text: string;
};

type LLMResponse = {
  text: string;
  audio?: string;
  type?: string;
};

type ProcessingStatus = {
  stage: string;
  message: string;
};

type ChunkData = {
  chunk_index: number;
  total_chunks: number;
  progress: number;
};

type ChunksCompleteData = {
  stats: any;
};

type AudioReceivedData = {
  message: string;
  chunk_size: number;
};

export default function HomeScreen({ navigation }: HomeScreenProps) {
  // State - maintain original state for backward compatibility
  const [state, setState] = useState<typeof VoiceState[keyof typeof VoiceState]>(VoiceState.IDLE);
  const [error, setError] = useState<Error | null>(null);
  
  // New states for enhanced functionality
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [appReady, setAppReady] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);
  const [isConnecting, setIsConnecting] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [silenceDetectionEnabled, setSilenceDetectionEnabled] = useState(true);
  const [silenceThreshold, setSilenceThreshold] = useState(2000); // 2 seconds
  const [isContinuousMode, setIsContinuousMode] = useState(false);
  
  // Animation values for the pulsing dots
  const dot1Animation = useRef(new Animated.Value(0)).current;
  const dot2Animation = useRef(new Animated.Value(0)).current;
  const dot3Animation = useRef(new Animated.Value(0)).current;
  
  // Animation value for button pulse
  const buttonPulseAnimation = useRef(new Animated.Value(1)).current;
  
  // Animation values for waveform
  const waveforms = Array.from({ length: 7 }, (_, i) => useRef(new Animated.Value(0.3)).current);
  
  // Reference to manage audio playback
  const responseSound = useRef<Audio.Sound | null>(null);
  
  // Reference for memoized callback to avoid dependency loop
  const initializeSocketRef = useRef<() => Promise<void>>();
  
  // Animation style calculations
  const dot1Style = {
    transform: [{
      scale: dot1Animation.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, 1.5, 1]
      })
    }],
    opacity: dot1Animation.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.6, 1, 0.6]
    })
  };
  
  const dot2Style = {
    transform: [{
      scale: dot2Animation.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, 1.5, 1]
      })
    }],
    opacity: dot2Animation.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.6, 1, 0.6]
    })
  };
  
  const dot3Style = {
    transform: [{
      scale: dot3Animation.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [1, 1.5, 1]
      })
    }],
    opacity: dot3Animation.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.6, 1, 0.6]
    })
  };
  
  // Add state for tracking processing start time
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const MAX_PROCESSING_TIME = 30000; // 30 seconds max for processing
  
  // Add log function
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`${timestamp}: ${message}`, ...prev].slice(0, 100));
    console.log(`[Home] ${message}`);
  };
  
  // Initialize socket connection
  const initializeSocket = useCallback(async () => {
    try {
      addLog('Initializing API service and connecting to server...');
      
      // Register for connection status changes
      APIService.on(WS_EVENTS.CONNECT, () => {
        addLog('Connected to server');
        setIsConnected(true);
        setError(null);
      });
      
      APIService.on(WS_EVENTS.DISCONNECT, (reason: string) => {
        addLog(`Disconnected from server: ${reason}`);
        setIsConnected(false);
        
        // If we're in continuous conversation mode, automatically try to reconnect
        if (isContinuousMode) {
          addLog('Attempting to automatically reconnect...');
          
          // Attempt to reconnect after a short delay
          setTimeout(() => {
            if (!isConnected && isContinuousMode) {
              addLog('Auto-reconnecting to server...');
              APIService.connect();
            }
          }, 3000);
        }
      });
      
      // Register for connection error
      APIService.on(WS_EVENTS.ERROR, (error: any) => {
        const errorMsg = typeof error === 'object' ? JSON.stringify(error) : error;
        addLog(`Connection error: ${errorMsg}`);
        
        // Don't set error state here, just log it
        // This prevents showing alerts for transient connection issues
        
        // Attempt to reconnect for connection errors
        if (isContinuousMode) {
          setTimeout(() => {
            if (isContinuousMode) {
              addLog('Attempting to reconnect after error...');
              APIService.connect();
            }
          }, 3000);
        }
      });
      
      // Register for transcription results
      APIService.on(WS_EVENTS.TRANSCRIPTION, (transcription: string | TranscriptionResponse) => {
        const transcriptionText = typeof transcription === 'string' ? transcription : transcription.text;
        addLog(`Received transcription: ${transcriptionText}`);
        
        // Add to conversation as user message
        addToConversation(transcriptionText, true);
        
        // Process the transcription to get AI response
        try {
          APIService.processTranscription(transcriptionText);
          addLog('Sent transcription to LLM for processing');
        } catch (error) {
          const err = error as Error;
          addLog(`Error processing transcription: ${err.message}`);
        }
      });
      
      // Register for LLM response
      APIService.on(WS_EVENTS.RESPONSE, (response: LLMResponse) => {
        try {
          const responseText = response.text || 'No response text';
          const responseAudio = response.audio || null;
          const responseType = response.type || 'text';
          
          addLog(`Received LLM response: ${responseText} (type: ${responseType})`);
          if (responseAudio) {
            addLog(`Response includes audio data of length: ${responseAudio.length}`);
          } else {
            addLog('Response does not include audio data');
          }
          
          setResponseText(responseText);
          
          // Add to conversation as AI message with audio if available
          addToConversation(responseText, false, responseAudio);
          
          // Automatically play audio if available
          if (responseAudio) {
            addLog('Audio response received, playing...');
            playAudioResponse(responseAudio);
          } else {
            // If no audio, make sure we're transitioning to idle state
            setIsProcessing(false);
            setIsPlaying(false);
            VoiceStateManager.setState(VoiceState.IDLE);
            addLog('No audio in response, returning to idle state');
            
            // Start recording again after a short delay if in continuous mode
            if (isContinuousMode) {
              setTimeout(() => {
                if (!isRecording && !isProcessing && !isPlaying) {
                  addLog('Auto-restarting recording cycle after text-only response...');
                  startRecording();
                }
              }, 2000);
            }
          }
        } catch (error) {
          const err = error as Error;
          addLog(`Error handling LLM response: ${err.message}`);
          console.error('Error handling LLM response:', error);
          setIsProcessing(false);
          setIsPlaying(false);
          VoiceStateManager.setState(VoiceState.IDLE);
        }
      });
      
      // Register for processing status updates
      APIService.on('processing_status', (status: ProcessingStatus) => {
        addLog(`Processing status: ${status.stage} - ${status.message}`);
      });
      
      // Register for chunk acknowledgments
      APIService.on('chunk_received', (data: ChunkData) => {
        addLog(`Chunk ${data.chunk_index + 1}/${data.total_chunks} received (${data.progress.toFixed(1)}%)`);
      });
      
      APIService.on('chunks_complete', (data: ChunksCompleteData) => {
        addLog(`All chunks complete: ${JSON.stringify(data.stats)}`);
      });
      
      // Register for audio received acknowledgment
      APIService.on('audio_received', (data: AudioReceivedData) => {
        addLog(`Audio received: ${data.message}, size: ${data.chunk_size}KB`);
      });
      
      // Connect to the server
      APIService.connect();
      addLog('API service connection initiated');
    } catch (error) {
      const err = error as Error;
      addLog(`Error initializing API service: ${err.message}`);
      console.error('Error initializing API service:', error);
      setError(err);
    }
  }, [isContinuousMode]);

  // Setup a separate connection checker
  useEffect(() => {
    let lastReconnectAttempt = 0;
    const MIN_RECONNECT_INTERVAL = 10000; // 10 seconds between reconnect attempts
    
    // Add a periodic connection checker to detect ghost connections
    const connectionCheckInterval = setInterval(async () => {
      if (isContinuousMode) {
        const now = Date.now();
        
        // Check if we're actually connected
        if (!isConnected) {
          // Only attempt reconnection if it's been at least MIN_RECONNECT_INTERVAL since last attempt
          if (now - lastReconnectAttempt > MIN_RECONNECT_INTERVAL) {
            console.log('[Home] Connection appears down, checking backend availability');
            lastReconnectAttempt = now;
            
            try {
              const restAvailable = await APIService.checkBackendAvailability();
              if (restAvailable) {
                console.log('[Home] Backend available via REST, reconnecting socket');
                APIService.connect();
              } else {
                console.log('[Home] Backend not available via REST');
              }
            } catch (error) {
              console.log('[Home] Error checking backend availability:', error);
            }
          } else {
            console.log('[Home] Skipping reconnect attempt (too soon since last attempt)');
          }
        }
      }
    }, 15000); // Check every 15 seconds instead of 10 seconds

    // Clean up the interval when component unmounts
    return () => {
      clearInterval(connectionCheckInterval);
    };
  }, [isContinuousMode, isConnected]);

  // Store the current version of the callback in a ref
  useEffect(() => {
    initializeSocketRef.current = initializeSocket;
  }, [initializeSocket]);

  // Initialize app
  useEffect(() => {
    // Initialize audio playback
    const setupAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });
        addLog('Audio playback configured');
      } catch (error) {
        const err = error as Error;
        addLog(`Error setting up audio playback: ${err.message}`);
        setError(err);
      }
    };
    
    const initializeApp = async () => {
      try {
        setIsConnecting(true);
        
        // Setup audio
        await setupAudio();
        
        // Initialize API service and socket connection
        if (initializeSocketRef.current) {
          await initializeSocketRef.current();
        }
        
        // Initialize audio recording service
        await AudioRecordingService.initializeRecording();
        
        // Configure silence detection
        const threshold = silenceDetectionEnabled ? silenceThreshold : 0;
        AudioRecordingService.configureSilenceDetection(silenceDetectionEnabled, -30, threshold);
        addLog(`Silence detection ${silenceDetectionEnabled ? 'enabled' : 'disabled'} with threshold of ${threshold}ms`);
        
        // Set up silence detection callback
        AudioRecordingService.setOnSilenceDetected(handleSilenceDetected);
        
        // For backward compatibility
        await VoiceStateManager.activate();
        
        setAppReady(true);
      } catch (error) {
        console.error('Failed to initialize app:', error);
        const err = error as Error;
        setError(err);
        Alert.alert(
          'Connection Error',
          'Failed to connect to the server. Please make sure the server is running and try again.',
          [
            {
              text: 'Retry',
              onPress: () => {
                setIsConnecting(true);
                initializeApp();
              }
            }
          ]
        );
      } finally {
        setIsConnecting(false);
      }
    };

    initializeApp();

    // Set up state listener for backward compatibility
    const handleStateChange = (newState: typeof VoiceState[keyof typeof VoiceState], newError: Error | null) => {
      setState(newState);
      setError(newError);
    };

    VoiceStateManager.addListener(handleStateChange);

    // Cleanup
    return () => {
      if (isRecording) {
        AudioRecordingService.stopRecording();
      }
      
      // Clean up audio playback
      if (responseSound.current) {
        responseSound.current.unloadAsync();
      }
      
      // Clean up event listeners
      APIService.off(WS_EVENTS.CONNECT);
      APIService.off(WS_EVENTS.DISCONNECT);
      APIService.off(WS_EVENTS.TRANSCRIPTION);
      APIService.off(WS_EVENTS.RESPONSE);
      APIService.off(WS_EVENTS.ERROR);
      APIService.off('processing_status');
      APIService.off('chunk_received');
      APIService.off('chunks_complete');
      APIService.off('audio_received');
      
      // Backward compatibility
      VoiceStateManager.removeListener(handleStateChange);
      VoiceStateManager.deactivate();
    };
  }, []);
  
  // Callback for when silence is detected
  const handleSilenceDetected = async (result: AudioRecordingResult) => {
    addLog('Silence detected, recording stopped automatically');
    setIsRecording(false);
    
    // Process the recording
    await processRecording(result);
  };
  
  // Process recording result
  const processRecording = async (result: AudioRecordingResult) => {
    try {
      setIsProcessing(true);
      
      if (!result || !result.uri) {
        throw new Error('No audio recorded');
      }
      
      addLog(`Processing recording: ${result.uri}`);
      
      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(result.uri);
      if (!fileInfo.exists) {
        throw new Error('Audio file does not exist');
      }
      
      // TypeScript doesn't know about the size property
      const fileSize = (fileInfo as any).size;
      addLog(`File size: ${fileSize} bytes, duration: ${result.duration}ms`);
      
      // Read file as base64
      const audioData = await FileSystem.readAsStringAsync(result.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      addLog(`Audio data encoded, size: ${audioData.length} bytes`);
      
      // Send to server for transcription
      addLog('Sending audio to server for transcription...');
      
      // Get file format from URI extension
      let fileFormat = 'wav'; // Default to wav now that we're using wav format
      if (result.uri.endsWith('.m4a')) {
        fileFormat = 'm4a';
      } else if (result.uri.endsWith('.mp3')) {
        fileFormat = 'mp3';
      } else if (result.uri.endsWith('.wav')) {
        fileFormat = 'wav';
      }
      addLog(`File format detected: ${fileFormat}`);
      
      try {
        await APIService.sendAudioForTranscription(audioData, fileFormat);
        addLog('Audio sent successfully, waiting for transcription...');
      } catch (sendError) {
        const err = sendError as Error;
        addLog(`Error sending audio: ${err.message}`);
        setError(err);
        throw sendError;
      }
    } catch (error) {
      const err = error as Error;
      addLog(`Error processing recording: ${err.message}`);
      console.error('Error processing recording:', error);
      setIsProcessing(false);
      setError(err);
      
      Alert.alert(
        'Recording Error',
        `Failed to process recording: ${err.message}`,
        [{ text: 'OK' }]
      );
    }
  };
  
  const startRecording = async () => {
    try {
      // Ensure we're connected before recording
      if (!isConnected) {
        addLog('Not connected to server. Attempting to reconnect...');
        
        // Show reconnecting status to user
        setIsProcessing(true);
        
        // Wait briefly to establish connection
        APIService.connect();
        addLog('Reconnection initiated, waiting for connection...');
        
        // Try pinging the server directly to check connection
        try {
          const isAvailable = await APIService.checkBackendAvailability();
          if (isAvailable) {
            addLog('Backend is available via REST API');
            setIsConnected(true);
          } else {
            addLog('Backend not available via REST API');
          }
        } catch (error) {
          addLog('Error checking backend availability');
        }
        
        // Wait for connection to establish (with timeout)
        let connectionTimeout = 0;
        while (!isConnected && connectionTimeout < 5) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          connectionTimeout++;
          addLog(`Waiting for connection... (${connectionTimeout}s)`);
        }
        
        // If still not connected after timeout, throw error
        if (!isConnected) {
          setIsProcessing(false);
          throw new Error('Could not connect to server. Please try again later.');
        }
      }
      
      // Don't start recording if already recording or playing audio
      if (isRecording || isPlaying) {
        addLog('Cannot start recording: Already recording or playing audio');
        return;
      }
      
      // Reset processing state if it was set during reconnection
      setIsProcessing(false);
      addLog('Starting audio recording...');
      setIsRecording(true);
      
      // For compatibility with old VoiceStateManager
      VoiceStateManager.setState(VoiceState.LISTENING);
      
      // Configure silence detection before starting
      AudioRecordingService.configureSilenceDetection(
        silenceDetectionEnabled, 
        -30, 
        silenceThreshold
      );
      
      // Try multiple times to start recording if needed
      let retries = 0;
      let started = false;
      
      while (!started && retries < 3) {
        try {
          started = await AudioRecordingService.startRecording();
          if (started) {
            addLog('Recording started successfully');
            startDotAnimation();
            break;
          } else {
            throw new Error('Failed to start recording');
          }
        } catch (recordingError) {
          retries++;
          addLog(`Recording start failed (attempt ${retries}/3): ${(recordingError as Error).message}`);
          
          // Wait a moment before retrying
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Reinitialize recording if needed
          if (retries < 3) {
            addLog('Reinitializing recording service...');
            await AudioRecordingService.initializeRecording();
          }
        }
      }
      
      if (!started) {
        throw new Error(`Failed to start recording after ${retries} attempts`);
      }
    } catch (error) {
      const err = error as Error;
      addLog(`Error starting recording: ${err.message}`);
      console.error('Error starting recording:', error);
      setIsRecording(false);
      setIsProcessing(false);
      setError(err);
      stopDotAnimation();
      
      // Alert the user about the error
      Alert.alert('Recording Error', err.message, [
        { 
          text: 'Try Again', 
          onPress: () => {
            // Only try to reconnect if we're in continuous mode
            if (isContinuousMode) {
              setTimeout(() => startRecording(), 2000);
            }
          } 
        },
        {
          text: 'Cancel',
          onPress: () => setIsContinuousMode(false),
          style: 'cancel'
        }
      ]);
    }
  };
  
  // Listen to connection changes
  useEffect(() => {
    if (isConnected && isContinuousMode && !isRecording && !isProcessing && !isPlaying) {
      // If we're in continuous mode, connected, and not doing anything else,
      // automatically start recording
      addLog('Connection restored, auto-restarting recording...');
      startRecording();
    }
  }, [isConnected, isContinuousMode, isRecording, isProcessing, isPlaying]);
  
  const stopRecording = async () => {
    try {
      addLog('Manually stopping recording...');
      setIsRecording(false);
      stopDotAnimation();
      
      // For compatibility with old VoiceStateManager
      VoiceStateManager.setState(VoiceState.PROCESSING);
      
      // Stop recording and get the audio file
      let result = null;
      try {
        result = await AudioRecordingService.stopRecording();
      } catch (recordingError) {
        addLog(`Error in AudioRecordingService.stopRecording: ${(recordingError as Error).message}`);
        // Continue processing - we may still have a valid recording despite the error
      }
      
      // Process the recording if we have a result
      if (result) {
        addLog(`Recording stopped successfully, processing result`);
        await processRecording(result as AudioRecordingResult);
      } else {
        // If no result, try to reinitialize the recording service
        addLog('No recording result returned, reinitializing recording service');
        setIsProcessing(false);
        
        // Try to reinitialize for next time
        try {
          await AudioRecordingService.initializeRecording();
          addLog('Recording service reinitialized successfully');
        } catch (initError) {
          addLog(`Failed to reinitialize recording service: ${(initError as Error).message}`);
        }
        
        throw new Error('No recording result returned');
      }
    } catch (error) {
      const err = error as Error;
      addLog(`Error stopping recording: ${err.message}`);
      console.error('Error stopping recording:', error);
      setIsProcessing(false);
      setError(err);
      
      // If we're in continuous mode, try to restart recording after a pause
      if (isContinuousMode) {
        addLog('Attempting to recover from recording error in continuous mode');
        setTimeout(() => {
          if (isContinuousMode && !isRecording && !isProcessing && !isPlaying) {
            addLog('Restarting recording after error recovery pause');
            startRecording();
          }
        }, 3000);
      }
    }
  };

  const toggleHistory = async () => {
    if (!showHistory) {
      // Use the conversation history we've built
      setShowHistory(true);
    } else {
      setShowHistory(false);
    }
  };

  const clearConversationHistory = () => {
    Alert.alert(
      "Clear Conversation History",
      "Are you sure you want to clear all conversation history?",
      [
        {
          text: "Cancel",
          style: "cancel"
        },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            setConversationHistory([]);
            addLog('Conversation history cleared');
          }
        }
      ]
    );
  };

  const startDotAnimation = () => {
    dot1Animation.setValue(0);
    dot2Animation.setValue(0);
    dot3Animation.setValue(0);
    
    Animated.sequence([
      Animated.timing(dot1Animation, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true
      }),
      Animated.timing(dot2Animation, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true
      }),
      Animated.timing(dot3Animation, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true
      })
    ]).start(() => {
      if (isRecording) {
        startDotAnimation();
      }
    });
  };

  const stopDotAnimation = () => {
    dot1Animation.stopAnimation();
    dot2Animation.stopAnimation();
    dot3Animation.stopAnimation();
  };

  // Start waveform animation
  const startWaveformAnimation = () => {
    // Create separate animation for each bar
    waveforms.forEach((anim, index) => {
      const randomDuration = 700 + Math.random() * 500;
      const randomHeight = 0.3 + Math.random() * 0.7;
      
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: randomHeight,
            duration: randomDuration,
            useNativeDriver: false,
          }),
          Animated.timing(anim, {
            toValue: 0.3,
            duration: randomDuration,
            useNativeDriver: false,
          }),
        ])
      ).start();
    });
  };

  // Stop waveform animation
  const stopWaveformAnimation = () => {
    waveforms.forEach(anim => anim.stopAnimation());
  };

  const reconnect = async () => {
    try {
      addLog('Manually reconnecting to server...');
      APIService.connect();
      addLog('Reconnection initiated');
    } catch (error) {
      const err = error as Error;
      addLog(`Error reconnecting: ${err.message}`);
      console.error('Error reconnecting:', error);
      setError(err);
    }
  };
  
  // Start button pulse animation
  const startButtonPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(buttonPulseAnimation, {
          toValue: 1.05,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(buttonPulseAnimation, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  // Stop button pulse animation
  const stopButtonPulse = () => {
    buttonPulseAnimation.stopAnimation();
    buttonPulseAnimation.setValue(1);
  };

  // Handle panic button press
  const handlePanicButtonPress = async () => {
    try {
      if (isPlaying) {
        // Stop audio playback
        await stopPlayback();
        // Also reset the continuous conversation state
        addLog('Conversation cycle ended by user');
        setIsContinuousMode(false);
      } else if (isRecording) {
        // Stop recording
        await stopRecording();
        // Also reset the continuous conversation state
        addLog('Conversation cycle ended by user');
        setIsContinuousMode(false);
      } else if (isProcessing) {
        // Do nothing, wait for processing to complete
        addLog('Processing in progress, please wait...');
      } else {
        // Start recording and continuous conversation mode
        addLog('Starting continuous conversation mode');
        setIsContinuousMode(true);
        await startRecording();
      }
    } catch (error) {
      console.error('Error handling button press:', error);
      setError(error as Error);
      Alert.alert('Error', 'Failed to process voice command');
    }
  };

  // Get button text based on state
  const getPanicButtonText = () => {
    if (isPlaying) {
      return 'STOP';
    } else if (isRecording) {
      return 'STOP';
    } else if (isProcessing) {
      return 'WAIT';
    } else {
      return isContinuousMode ? 'STOP' : 'TALK';
    }
  };

  // Get button color based on state
  const getPanicButtonColor = () => {
    if (isRecording || isPlaying || isContinuousMode) {
      return '#FF6B6B'; // Red when active
    } else {
      return '#8189E3'; // Default purple
    }
  };

  // Update animations based on state
  useEffect(() => {
    if (isRecording) {
      stopButtonPulse();
      startDotAnimation();
      stopWaveformAnimation();
    } else if (isPlaying) {
      startButtonPulse();
      stopDotAnimation();
      startWaveformAnimation();
    } else if (isProcessing) {
      startButtonPulse();
      stopDotAnimation();
      stopWaveformAnimation();
    } else {
      stopButtonPulse();
      stopDotAnimation();
      stopWaveformAnimation();
    }
  }, [isRecording, isPlaying, isProcessing]);

  // Add message to conversation
  const addToConversation = (text: string, isUser: boolean = true, audio: string | null = null) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      text,
      isUser,
      hasAudio: !!audio,
      audio,
      timestamp: new Date().toLocaleTimeString()
    };
    setConversationHistory(prev => [...prev, newMessage]);
  };
  
  // Play audio response
  const playAudioResponse = async (base64Audio: string) => {
    try {
      addLog('Preparing to play audio response...');
      
      // For compatibility with old VoiceStateManager
      VoiceStateManager.setState(VoiceState.RESPONDING);
      
      // Stop any existing playback
      if (responseSound.current) {
        await responseSound.current.unloadAsync();
        responseSound.current = null;
      }
      
      // Write base64 audio to a temporary file
      const tempAudioFile = `${FileSystem.cacheDirectory}temp_response_${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(tempAudioFile, base64Audio, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      addLog(`Audio data written to temp file: ${tempAudioFile}`);
      
      // Check that file exists
      const fileInfo = await FileSystem.getInfoAsync(tempAudioFile);
      if (!fileInfo.exists || fileInfo.size === 0) {
        throw new Error('Audio file not created or empty');
      }
      
      addLog(`Audio file size: ${fileInfo.size} bytes`);
      
      // Create and load the sound
      const { sound } = await Audio.Sound.createAsync(
        { uri: tempAudioFile },
        { shouldPlay: false } // Load first, play separately
      );
      
      responseSound.current = sound;
      setIsPlaying(true);
      // Reset processing state now that we're playing
      setIsProcessing(false);
      
      // Start waveform animation when playing
      startWaveformAnimation();
      
      // Handle playback status updates
      sound.setOnPlaybackStatusUpdate((status) => {
        if ('didJustFinish' in status && status.didJustFinish) {
          setIsPlaying(false);
          // Ensure processing state is false when finished
          setIsProcessing(false);
          addLog('Audio response playback finished');
          stopWaveformAnimation();
          
          // For compatibility with old VoiceStateManager
          VoiceStateManager.setState(VoiceState.IDLE);
          
          // After playback finishes, check connection and wait a moment before restarting
          setTimeout(async () => {
            // Double-check connection status before restarting
            if (isContinuousMode && !isRecording && !isProcessing && !isPlaying) {
              // Check if backend is available first
              try {
                const available = await APIService.checkBackendAvailability();
                if (available) {
                  addLog('Backend is available, ensuring socket connection');
                  
                  // Force reconnect if needed by reinitializing the socket
                  if (!isConnected) {
                    addLog('Socket appears disconnected, reconnecting...');
                    APIService.disconnect(); // Clean slate by disconnecting first
                    await new Promise(resolve => setTimeout(resolve, 500));
                    APIService.connect();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                  }
                  
                  // Now restart recording
                  addLog('Auto-restarting recording cycle...');
                  startRecording();
                } else {
                  addLog('Backend not available, cannot restart recording');
                  // Show error to user
                  Alert.alert(
                    'Connection Error',
                    'Could not connect to the server. Please try again later.',
                    [
                      {
                        text: 'Try Again',
                        onPress: () => {
                          APIService.connect();
                          setTimeout(() => startRecording(), 2000);
                        }
                      },
                      {
                        text: 'Cancel',
                        onPress: () => setIsContinuousMode(false),
                        style: 'cancel'
                      }
                    ]
                  );
                }
              } catch (error) {
                addLog(`Error checking backend: ${(error as Error).message}`);
                Alert.alert(
                  'Connection Error',
                  'Could not verify server connection. Please try again.',
                  [
                    {
                      text: 'Try Again',
                      onPress: () => {
                        APIService.connect();
                        setTimeout(() => startRecording(), 2000);
                      }
                    },
                    {
                      text: 'Cancel',
                      onPress: () => setIsContinuousMode(false),
                      style: 'cancel'
                    }
                  ]
                );
              }
            }
          }, 1000);
        }
      });
      
      // Start playing
      addLog('Playing audio response...');
      await sound.playAsync();
    } catch (error) {
      const err = error as Error;
      addLog(`Error playing audio response: ${err.message}`);
      console.error('Error playing audio response:', error);
      setIsPlaying(false);
      // Ensure processing state is reset on error
      setIsProcessing(false);
      stopWaveformAnimation();
      
      // Reset VoiceStateManager state
      VoiceStateManager.setState(VoiceState.IDLE);
      
      // Clean up if there was an error
      if (responseSound.current) {
        try {
          await responseSound.current.unloadAsync();
          responseSound.current = null;
        } catch (cleanupError) {
          console.error('Error cleaning up sound:', cleanupError);
        }
      }
      
      // Try to continue with recording if playback fails
      setTimeout(async () => {
        if (isContinuousMode && !isRecording && !isProcessing && !isPlaying) {
          // Check backend availability directly
          try {
            const available = await APIService.checkBackendAvailability();
            if (available) {
              addLog('Backend available, restarting after playback error');
              APIService.connect(); // Ensure we're connected
              await new Promise(resolve => setTimeout(resolve, 1000));
              startRecording();
            } else {
              addLog('Backend unavailable, cannot restart');
              Alert.alert(
                'Connection Error',
                'Could not connect to the server after playback error.',
                [
                  {
                    text: 'Try Again',
                    onPress: () => {
                      APIService.connect();
                      setTimeout(() => startRecording(), 2000);
                    }
                  },
                  {
                    text: 'Cancel',
                    onPress: () => setIsContinuousMode(false),
                    style: 'cancel'
                  }
                ]
              );
            }
          } catch (error) {
            addLog(`Error checking backend after playback error: ${(error as Error).message}`);
            setIsContinuousMode(false);
          }
        }
      }, 2000);
    }
  };
  
  // Play audio from conversation
  const playMessageAudio = async (message: Message) => {
    if (!message.hasAudio || !message.audio) {
      addLog('No audio available for this message');
      return;
    }
    
    try {
      await playAudioResponse(message.audio);
    } catch (error) {
      const err = error as Error;
      addLog(`Error playing message audio: ${err.message}`);
    }
  };
  
  // Stop audio playback
  const stopPlayback = async () => {
    if (responseSound.current) {
      try {
        await responseSound.current.stopAsync();
        addLog('Audio playback stopped');
        setIsPlaying(false);
        stopWaveformAnimation();
      } catch (error) {
        const err = error as Error;
        addLog(`Error stopping playback: ${err.message}`);
      }
    }
  };

  // Effect to set processing start time when processing state changes
  useEffect(() => {
    if (isProcessing) {
      // Record when processing started
      setProcessingStartTime(Date.now());
    } else {
      // Clear processing start time when not processing
      setProcessingStartTime(null);
    }
  }, [isProcessing]);

  // Effect to check for stuck processing state
  useEffect(() => {
    if (!isProcessing || processingStartTime === null) {
      return; // Not processing or no start time recorded
    }

    // Set up timer to check for stuck states
    const stuckCheckInterval = setInterval(() => {
      const now = Date.now();
      const processingDuration = now - processingStartTime;
      
      // If processing for too long, reset the state
      if (processingDuration > MAX_PROCESSING_TIME) {
        addLog(`Processing stuck for ${processingDuration/1000}s, resetting state...`);
        
        // Reset all states
        setIsProcessing(false);
        setIsRecording(false);
        setIsPlaying(false);
        
        // Reset VoiceStateManager
        VoiceStateManager.setState(VoiceState.IDLE);
        
        // If in continuous mode, try to restart after a delay
        if (isContinuousMode) {
          addLog('Auto-restarting after stuck state recovery...');
          setTimeout(() => {
            // Create a fresh connection before attempting to restart
            APIService.disconnect();
            APIService.connect();
            
            // Try to restart recording after a brief delay
            setTimeout(() => {
              if (isContinuousMode && !isRecording && !isProcessing && !isPlaying) {
                startRecording();
              }
            }, 2000);
          }, 1000);
        }
      }
    }, 5000); // Check every 5 seconds

    return () => {
      clearInterval(stuckCheckInterval);
    };
  }, [isProcessing, processingStartTime, isContinuousMode]);

  if (!appReady || isConnecting) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8189E3" />
          <Text style={styles.loadingText}>
            {isConnecting ? 'Connecting to server...' : 'Loading...'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.openDrawer()}
          style={styles.menuButton}
        >
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <View style={styles.headerTextContainer}>
          <Text style={styles.headerTitle}>Welcome Back!</Text>
        </View>
      </View>

      {/* Connection status indicator */}
      {!isConnected && (
        <View style={styles.connectionAlert}>
          <Text style={styles.connectionAlertText}>
            Connection lost. Attempting to reconnect...
          </Text>
          <ActivityIndicator size="small" color="#fff" style={{ marginLeft: 8 }} />
        </View>
      )}

      <View style={styles.quoteContainer}>
        <Text style={styles.quoteText}>
          "There's two buttons I never like to hit: that's panic and snooze"
        </Text>
        <Text style={styles.quoteAuthor}>— Ted Lasso</Text>
      </View>
      
      <View style={styles.buttonContainer}>
        <Animated.View style={{
          transform: [{ scale: buttonPulseAnimation }]
        }}>
        <TouchableOpacity
          style={[
            styles.panicButton,
              { backgroundColor: getPanicButtonColor() }
          ]}
            onPress={handlePanicButtonPress}
            disabled={isProcessing && !isRecording && !isPlaying}
        >
            <Text style={styles.panicButtonText}>
              {getPanicButtonText()}
            </Text>
        </TouchableOpacity>
        </Animated.View>
        
        {isRecording && (
          <View style={styles.assistantStatusContainer}>
              <Text style={styles.assistantStatusText}>Listening...</Text>
              <View style={styles.listeningIndicator}>
                <Animated.View style={[styles.dot, dot1Style]} />
                <Animated.View style={[styles.dot, dot2Style]} />
                <Animated.View style={[styles.dot, dot3Style]} />
              </View>
          </View>
        )}
        
        {isProcessing && !isRecording && !isPlaying && (
          <View style={styles.assistantStatusContainer}>
              <Text style={styles.assistantStatusText}>
                {!isConnected ? "Reconnecting..." : "Processing..."}
              </Text>
              <ActivityIndicator size="small" color="#8189E3" style={styles.processingIndicator} />
          </View>
        )}
        
        {isPlaying && (
          <View style={styles.assistantStatusContainer}>
              <Text style={styles.assistantStatusText}>Playing response...</Text>
              <View style={styles.waveformContainer}>
                {waveforms.map((anim, index) => (
                  <Animated.View
                    key={index}
                    style={[
                      styles.waveformBar,
                      {
                        height: anim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [5, 40],
                        }),
                      },
                    ]}
                  />
                ))}
              </View>
          </View>
        )}
      </View>

      <View style={styles.bottomButtons}>
        <TouchableOpacity style={styles.assistButton} onPress={() => navigation.navigate('Breathe')}>
          <View style={styles.assistButtonIcon}>
            <Text style={styles.assistButtonIconText}>🌿</Text>
          </View>
          <Text style={styles.assistButtonText}>Breathe with me</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.assistButton} onPress={() => navigation.navigate('Grounding')}>
          <View style={styles.assistButtonIcon}>
            <Text style={styles.assistButtonIconText}>🧭</Text>
          </View>
          <Text style={styles.assistButtonText}>Grounding techniques</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.assistButton} onPress={toggleHistory}>
          <View style={styles.assistButtonIcon}>
            <Text style={styles.assistButtonIconText}>💬</Text>
          </View>
          <Text style={styles.assistButtonText}>View Conversation History</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showHistory}
        animationType="slide"
        transparent={true}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Conversation History</Text>
            {conversationHistory.length === 0 ? (
              <View style={styles.emptyHistoryContainer}>
                <Text style={styles.emptyHistoryText}>No conversations yet.</Text>
                <Text style={styles.emptyHistorySubtext}>Your conversations will appear here.</Text>
              </View>
            ) : (
              <>
                <ScrollView style={styles.historyScroll}>
                  {conversationHistory.map((message, index) => (
                    <TouchableOpacity 
                      key={index} 
                      style={[
                        styles.messageContainer,
                        message.isUser ? styles.userMessage : styles.assistantMessage
                      ]}
                      onPress={() => message.hasAudio ? playMessageAudio(message) : null}
                      activeOpacity={message.hasAudio ? 0.7 : 1}
                    >
                      <View style={styles.messageHeader}>
                        <Text style={styles.messageRole}>{message.isUser ? 'You' : 'Assistant'}</Text>
                        {message.hasAudio && (
                          <Text style={styles.audioIndicator}>🔊</Text>
                        )}
                      </View>
                      <Text style={styles.messageText}>{message.text}</Text>
                      <Text style={styles.messageTimestamp}>{message.timestamp}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                
                <TouchableOpacity 
                  style={styles.clearButton}
                  onPress={clearConversationHistory}
                >
                  <Text style={styles.clearButtonText}>Clear History</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity 
              style={styles.closeButton}
              onPress={() => setShowHistory(false)}
            >
              <Text style={styles.buttonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f4f9',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 60,
    marginBottom: 16,
  },
  menuButton: {
    padding: 8,
    paddingTop: 4,
  },
  menuIcon: {
    fontSize: 40,
    color: '#8189E3',
  },
  headerTextContainer: {
    marginLeft: 16,
  },
  headerTitle: {
    fontSize: 36,
    color: '#8189E3',
    fontWeight: 'bold',
  },
  quoteContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  quoteText: {
    color: '#333333',
    fontSize: 18,
    lineHeight: 24,
  },
  quoteAuthor: {
    color: '#8E8E93',
    fontSize: 16,
    marginTop: 8,
  },
  buttonContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  panicButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#8189E3',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
  },
  panicButtonText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  assistantStatusContainer: {
    marginTop: 24,
    alignItems: 'center',
    width: '100%',
  },
  assistantStatusText: {
    color: '#8189E3',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  listeningIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#8189E3',
    margin: 5,
    opacity: 0.6,
  },
  bottomButtons: {
    gap: 12,
    marginBottom: 32,
  },
  assistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  assistButtonIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0f4f9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  assistButtonIconText: {
    fontSize: 20,
  },
  assistButtonText: {
    color: '#333333',
    fontSize: 16,
    fontWeight: '500',
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#8189E3',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
  },
  button: {
    backgroundColor: '#8189E3',
    padding: 15,
    borderRadius: 12,
    marginTop: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
    color: '#8189E3',
  },
  historyScroll: {
    maxHeight: 400,
  },
  messageContainer: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  userMessage: {
    backgroundColor: '#E8EAFF',
    alignSelf: 'flex-end',
    maxWidth: '80%',
    borderBottomRightRadius: 4,
  },
  assistantMessage: {
    backgroundColor: '#F5F5F5',
    alignSelf: 'flex-start',
    maxWidth: '80%',
    borderBottomLeftRadius: 4,
  },
  messageRole: {
    fontSize: 12,
    color: '#8189E3',
    marginBottom: 5,
    fontWeight: '600',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  closeButton: {
    backgroundColor: '#8189E3',
    padding: 15,
    borderRadius: 12,
    marginTop: 15,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  continuousModeIndicator: {
    color: '#8189E3',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 4,
    textAlign: 'center',
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    marginTop: 8,
  },
  waveformBar: {
    width: 4,
    backgroundColor: '#8189E3',
    marginHorizontal: 2,
    borderRadius: 2,
  },
  processingIndicator: {
    marginTop: 8,
  },
  connectionAlert: {
    backgroundColor: '#FF6B6B',
    padding: 8,
    borderRadius: 8,
    marginVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionAlertText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  emptyHistoryContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyHistoryText: {
    fontSize: 18,
    color: '#8189E3',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptyHistorySubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  messageTimestamp: {
    fontSize: 10,
    color: '#999',
    marginTop: 5,
    alignSelf: 'flex-end',
  },
  clearButton: {
    marginTop: 15,
    padding: 10,
    alignItems: 'center',
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FF6B6B',
  },
  clearButtonText: {
    color: '#FF6B6B',
    fontWeight: 'bold',
    fontSize: 14,
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  audioIndicator: {
    fontSize: 12,
    color: '#8189E3',
  },
}); 