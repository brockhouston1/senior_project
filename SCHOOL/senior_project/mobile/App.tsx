import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { DrawerNavigator } from './src/navigation/DrawerNavigator';
import { StatusBar } from 'expo-status-bar';
import 'react-native-gesture-handler';

const LightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#f0f4f9',
    text: '#333333',
    border: '#e1e1e8',
    card: '#FFFFFF',
    primary: '#8189E3',
  },
};

export default function App() {
  return (
    <>
      <StatusBar style="dark" />
      <NavigationContainer theme={LightTheme}>
        <DrawerNavigator />
      </NavigationContainer>
    </>
  );
}
