import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import APIService, { WS_EVENTS } from '../services/APIService';
import WebRTCService, { WEBRTC_EVENTS } from '../services/WebRTCService';

const WebRTCDemoScreen: React.FC = () => {
  const [socketConnected, setSocketConnected] = useState(false);
  const [webrtcReady, setWebrtcReady] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const scrollViewRef = useRef<ScrollView>(null);

  // Add log entry
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    
    setLogs(prev => [...prev, logEntry]);
    
    // Auto-scroll to bottom
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  useEffect(() => {
    // Initial log
    addLog('WebRTC Demo Screen initialized');
    
    // Check if socket is already connected
    if (APIService.connected) {
      setSocketConnected(true);
      addLog('Socket already connected');
    } else {
      addLog('Connecting to server...');
      APIService.connect();
    }
    
    // Socket event handlers
    const handleConnect = () => {
      setSocketConnected(true);
      addLog('Socket connected successfully');
    };
    
    const handleDisconnect = (reason: string) => {
      setSocketConnected(false);
      setWebrtcReady(false);
      setStreaming(false);
      addLog(`Socket disconnected: ${reason}`);
    };
    
    const handleError = (error: Error) => {
      addLog(`Error: ${error.message}`);
      Alert.alert('Error', error.message);
    };
    
    const handleWebRTCReady = () => {
      setWebrtcReady(true);
      setStreaming(true);
      addLog('WebRTC stream ready');
    };
    
    const handleWebRTCClosed = () => {
      setWebrtcReady(false);
      setStreaming(false);
      addLog('WebRTC stream closed');
    };
    
    // Register event handlers
    APIService.on(WS_EVENTS.CONNECT, handleConnect);
    APIService.on(WS_EVENTS.DISCONNECT, handleDisconnect);
    APIService.on(WS_EVENTS.ERROR, handleError);
    APIService.on(WS_EVENTS.WEBRTC_READY, handleWebRTCReady);
    APIService.on(WS_EVENTS.WEBRTC_CLOSED, handleWebRTCClosed);
    
    // WebRTC specific handlers
    const handleWebRTCError = (error: Error) => {
      addLog(`WebRTC Error: ${error.message}`);
    };
    
    const handleICEStateChange = (state: string) => {
      addLog(`ICE Connection State: ${state}`);
    };
    
    const handleConnectionStateChange = (state: string) => {
      addLog(`Connection State: ${state}`);
    };
    
    WebRTCService.on(WEBRTC_EVENTS.ERROR, handleWebRTCError);
    WebRTCService.on(WEBRTC_EVENTS.ICE_STATE_CHANGE, handleICEStateChange);
    WebRTCService.on(WEBRTC_EVENTS.CONNECTION_STATE_CHANGE, handleConnectionStateChange);
    
    // Cleanup on unmount
    return () => {
      // Stop streaming if active
      if (streaming) {
        stopStream();
      }
      
      // Unregister event handlers
      APIService.off(WS_EVENTS.CONNECT, handleConnect);
      APIService.off(WS_EVENTS.DISCONNECT, handleDisconnect);
      APIService.off(WS_EVENTS.ERROR, handleError);
      APIService.off(WS_EVENTS.WEBRTC_READY, handleWebRTCReady);
      APIService.off(WS_EVENTS.WEBRTC_CLOSED, handleWebRTCClosed);
      
      WebRTCService.off(WEBRTC_EVENTS.ERROR, handleWebRTCError);
      WebRTCService.off(WEBRTC_EVENTS.ICE_STATE_CHANGE, handleICEStateChange);
      WebRTCService.off(WEBRTC_EVENTS.CONNECTION_STATE_CHANGE, handleConnectionStateChange);
    };
  }, [streaming]);
  
  const startStream = async () => {
    try {
      addLog('Starting WebRTC stream...');
      
      if (!socketConnected) {
        addLog('Cannot start stream: Socket not connected');
        Alert.alert('Error', 'Socket not connected. Please reconnect first.');
        return;
      }
      
      const success = await APIService.startWebRTCStream();
      
      if (success) {
        addLog('WebRTC stream started successfully');
        setStreaming(true);
      } else {
        addLog('Failed to start WebRTC stream');
      }
    } catch (error) {
      addLog(`Error starting stream: ${error instanceof Error ? error.message : String(error)}`);
      Alert.alert('Error', `Failed to start stream: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  const stopStream = () => {
    try {
      if (streaming) {
        addLog('Stopping WebRTC stream...');
        APIService.stopWebRTCStream();
        setStreaming(false);
        setWebrtcReady(false);
        addLog('WebRTC stream stopped');
      }
    } catch (error) {
      addLog(`Error stopping stream: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  
  const reconnect = () => {
    try {
      addLog('Reconnecting to server...');
      APIService.disconnect();
      
      // Small delay before reconnecting
      setTimeout(() => {
        APIService.connect();
      }, 500);
    } catch (error) {
      addLog(`Error reconnecting: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>WebRTC Demo</Text>
      </View>
      
      <View style={styles.statusBar}>
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>Socket:</Text>
          <View style={[styles.statusIndicator, socketConnected ? styles.statusActive : styles.statusInactive]} />
        </View>
        
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>WebRTC:</Text>
          <View style={[styles.statusIndicator, webrtcReady ? styles.statusActive : styles.statusInactive]} />
        </View>
        
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>Streaming:</Text>
          <View style={[styles.statusIndicator, streaming ? styles.statusActive : styles.statusInactive]} />
        </View>
      </View>
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, socketConnected ? styles.buttonDisabled : styles.buttonPrimary]}
          disabled={socketConnected}
          onPress={reconnect}
        >
          <Text style={styles.buttonText}>Connect</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.button, !socketConnected || streaming ? styles.buttonDisabled : styles.buttonPrimary]}
          disabled={!socketConnected || streaming}
          onPress={startStream}
        >
          <Text style={styles.buttonText}>Start Stream</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.button, !streaming ? styles.buttonDisabled : styles.buttonDanger]}
          disabled={!streaming}
          onPress={stopStream}
        >
          <Text style={styles.buttonText}>Stop Stream</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.logContainer}>
        <Text style={styles.logTitle}>Event Log:</Text>
        <ScrollView
          ref={scrollViewRef}
          style={styles.logScroll}
          contentContainerStyle={styles.logContent}
        >
          {logs.map((log, index) => (
            <Text key={`log-${index}`} style={styles.logText}>{log}</Text>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#4a4afc',
    paddingVertical: 15,
    alignItems: 'center',
  },
  headerText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'white',
    padding: 10,
    marginVertical: 10,
    marginHorizontal: 15,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    elevation: 2,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusLabel: {
    marginRight: 5,
    fontSize: 14,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusActive: {
    backgroundColor: '#4CD964',
  },
  statusInactive: {
    backgroundColor: '#FF3B30',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 10,
    marginHorizontal: 15,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 5,
    minWidth: 100,
    alignItems: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#4a4afc',
  },
  buttonDanger: {
    backgroundColor: '#FF3B30',
  },
  buttonDisabled: {
    backgroundColor: '#cccccc',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  logContainer: {
    flex: 1,
    margin: 15,
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    elevation: 2,
  },
  logTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  logScroll: {
    flex: 1,
  },
  logContent: {
    paddingBottom: 5,
  },
  logText: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginVertical: 2,
  },
});

export default WebRTCDemoScreen; 