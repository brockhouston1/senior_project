import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import HomeScreen from '../screens/HomeScreen';
import { SessionsScreen } from '../screens/SessionsScreen';
import { MeditateScreen } from '../screens/MeditateScreen';
import { BreathingScreen } from '../screens/BreathingScreen';
import { GroundingScreen } from '../screens/GroundingScreen';
import WebRTCDemoScreen from '../screens/WebRTCDemoScreen';
import TestAudioScreen from '../screens/TestAudioScreen';
import TranscriptionTestScreen from '../screens/TranscriptionTestScreen';

const Drawer = createDrawerNavigator();

export const DrawerNavigator = () => {
  return (
    <Drawer.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: false,
        drawerStyle: {
          backgroundColor: '#FFFFFF',
          width: 240,
        },
        drawerLabelStyle: {
          color: '#333333',
          fontSize: 16,
        },
        drawerActiveBackgroundColor: '#f0f4f9',
        drawerActiveTintColor: '#8189E3',
        drawerInactiveTintColor: '#8E8E93',
      }}
    >
      <Drawer.Screen 
        name="Home" 
        component={HomeScreen}
        options={{
          drawerLabel: 'Voice Assistant',
        }}
      />
      <Drawer.Screen 
        name="Sessions" 
        component={SessionsScreen}
        options={{
          drawerLabel: 'Sessions',
        }}
      />
      <Drawer.Screen 
        name="Meditate" 
        component={MeditateScreen}
        options={{
          drawerLabel: 'Meditate',
        }}
      />
      <Drawer.Screen 
        name="Breathe" 
        component={BreathingScreen}
        options={{
          drawerLabel: 'Breathe',
        }}
      />
      <Drawer.Screen 
        name="Grounding" 
        component={GroundingScreen}
        options={{
          drawerLabel: 'Grounding',
        }}
      />
      <Drawer.Screen 
        name="WebRTCDemo" 
        component={WebRTCDemoScreen}
        options={{
          drawerLabel: 'WebRTC Demo',
        }}
      />
      <Drawer.Screen 
        name="TestAudio" 
        component={TestAudioScreen}
        options={{
          drawerLabel: 'Test Audio',
        }}
      />
      <Drawer.Screen 
        name="TranscriptionTest" 
        component={TranscriptionTestScreen}
        options={{
          drawerLabel: 'Transcription Test',
        }}
      />
    </Drawer.Navigator>
  );
}; 