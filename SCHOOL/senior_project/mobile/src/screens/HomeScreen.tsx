import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Animated, Modal, ScrollView } from 'react-native';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import VoiceStateManager, { VoiceState } from '../services/VoiceStateManager';
import APIService from '../services/APIService';
import AudioPlaybackService from '../services/AudioPlaybackService';
import AudioRecordingService from '../services/AudioRecordingService';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type HomeScreenProps = {
  navigation: DrawerNavigationProp<any>;
};

export default function HomeScreen({ navigation }: HomeScreenProps) {
  const [state, setState] = useState<typeof VoiceState[keyof typeof VoiceState]>(VoiceState.IDLE);
  const [error, setError] = useState<Error | null>(null);
  const [responseText, setResponseText] = useState('');
  const [appReady, setAppReady] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);
  const [isConnecting, setIsConnecting] = useState(true);
  
  // Animation values for the pulsing dots
  const dot1Animation = useRef(new Animated.Value(0)).current;
  const dot2Animation = useRef(new Animated.Value(0)).current;
  const dot3Animation = useRef(new Animated.Value(0)).current;
  
  // Animation value for button pulse
  const buttonPulseAnimation = useRef(new Animated.Value(1)).current;
  
  // Initialize app
  useEffect(() => {
    const initializeApp = async () => {
      try {
        setIsConnecting(true);
        await VoiceStateManager.activate();
      setAppReady(true);
      } catch (error) {
        console.error('Failed to initialize app:', error);
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

    // Set up state listener
    const handleStateChange = (newState: typeof VoiceState[keyof typeof VoiceState], newError: Error | null) => {
      setState(newState);
      setError(newError);
    };

    VoiceStateManager.addListener(handleStateChange);

    // Cleanup
    return () => {
      VoiceStateManager.removeListener(handleStateChange);
      VoiceStateManager.deactivate();
    };
  }, []);
  
  const toggleHistory = async () => {
    if (!showHistory) {
      // Get the current history from APIService
      setConversationHistory(APIService.conversationHistory);
    }
    setShowHistory(!showHistory);
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
      if (VoiceStateManager.state === VoiceState.LISTENING) {
        startDotAnimation();
      }
    });
  };

  const stopDotAnimation = () => {
    dot1Animation.stopAnimation();
    dot2Animation.stopAnimation();
    dot3Animation.stopAnimation();
  };

  const toggleVoiceAssistant = async () => {
    try {
      if (VoiceStateManager.state === VoiceState.IDLE) {
        await VoiceStateManager.activate();
      } else {
        await VoiceStateManager.deactivate();
      }
    } catch (error) {
      console.error('Error toggling voice assistant:', error);
      Alert.alert('Error', 'Failed to toggle voice assistant');
    }
  };
  
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
  };

  // Get button text based on state
  const getPanicButtonText = () => {
    switch (state) {
      case VoiceState.IDLE:
      case VoiceState.ERROR:
        return 'PANIC';
      case VoiceState.LISTENING:
        return 'STOP';
      case VoiceState.PROCESSING:
      case VoiceState.RESPONDING:
        return 'PANIC';
      default:
        return 'PANIC';
    }
  };

  // Get button color based on state
  const getPanicButtonColor = () => {
    // Only change color when starting or ending the call
    if (state === VoiceState.IDLE || state === VoiceState.ERROR) {
      return '#8189E3'; // Default purple
    } else {
      return '#FF6B6B'; // Red when active
    }
  };

  // Handle button press
  const handlePanicButtonPress = async () => {
    try {
      if (state === VoiceState.IDLE || state === VoiceState.ERROR) {
        // Start the assistant
        await VoiceStateManager.startAssistant();
      } else if (state === VoiceState.LISTENING) {
        // When in LISTENING state, button press should stop listening
        console.log('[HomeScreen] Stopping listening');
        await VoiceStateManager.stopListening();
      } else if (state === VoiceState.RESPONDING) {
        // Stop current response
        await AudioPlaybackService.stopPlayback();
        VoiceStateManager.setState(VoiceState.IDLE);
      } else if (state === VoiceState.PROCESSING) {
        // End the call
        await VoiceStateManager.deactivate();
      }
    } catch (error) {
      console.error('Error handling button press:', error);
      Alert.alert('Error', 'Failed to process voice command');
    }
  };

  // Update animations based on state
  useEffect(() => {
    if (state === VoiceState.LISTENING) {
      stopButtonPulse();
      startDotAnimation();
    } else if (state === VoiceState.RESPONDING || state === VoiceState.PROCESSING) {
      startButtonPulse();
      stopDotAnimation();
    } else {
      stopButtonPulse();
      stopDotAnimation();
    }
  }, [state]);

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
            disabled={state === VoiceState.PROCESSING}
        >
            <Text style={styles.panicButtonText}>
              {getPanicButtonText()}
            </Text>
        </TouchableOpacity>
        </Animated.View>
        
        {state === VoiceState.LISTENING && (
          <View style={styles.assistantStatusContainer}>
              <View style={styles.listeningIndicator}>
                <Animated.View style={[styles.dot, dot1Style]} />
                <Animated.View style={[styles.dot, dot2Style]} />
                <Animated.View style={[styles.dot, dot3Style]} />
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
      </View>

      <TouchableOpacity 
        style={styles.button}
        onPress={toggleHistory}
      >
        <Text style={styles.buttonText}>View Conversation History</Text>
      </TouchableOpacity>

      <Modal
        visible={showHistory}
        animationType="slide"
        transparent={true}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Conversation History</Text>
            <ScrollView style={styles.historyScroll}>
              {conversationHistory.map((message, index) => (
                <View key={index} style={[
                  styles.messageContainer,
                  message.role === 'user' ? styles.userMessage : styles.assistantMessage
                ]}>
                  <Text style={styles.messageRole}>{message.role}</Text>
                  <Text style={styles.messageText}>{message.content}</Text>
                </View>
              ))}
            </ScrollView>
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
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    marginTop: 20,
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
    borderRadius: 10,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  historyScroll: {
    maxHeight: 400,
  },
  messageContainer: {
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  userMessage: {
    backgroundColor: '#E3F2FD',
    alignSelf: 'flex-end',
    maxWidth: '80%',
  },
  assistantMessage: {
    backgroundColor: '#F5F5F5',
    alignSelf: 'flex-start',
    maxWidth: '80%',
  },
  messageRole: {
    fontSize: 12,
    color: '#666',
    marginBottom: 5,
  },
  messageText: {
    fontSize: 16,
  },
  closeButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    marginTop: 15,
    alignItems: 'center',
  },
}); 