import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { SessionsScreen } from '../screens/SessionsScreen';
import { SessionDetailScreen } from '../screens/SessionDetailScreen';

const Stack = createStackNavigator();

export const SessionsNavigator = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen 
        name="SessionsList" 
        component={SessionsScreen}
      />
      <Stack.Screen 
        name="SessionDetail" 
        component={SessionDetailScreen}
      />
    </Stack.Navigator>
  );
}; 