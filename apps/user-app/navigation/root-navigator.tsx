import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '@/hooks/useAuth';
import WelcomeScreen from '@/screens/welcome';
import NameScreen from '@/screens/auth/name';
import ProfileScreen from '@/screens/profile';
import AuthStack from './auth-stack';
import TabNavigator from './tab-navigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { isAuthenticated, isNewUser, loadToken } = useAuth();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    loadToken().finally(() => setIsReady(true));
  }, [loadToken]);

  if (!isReady) return null;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated && isNewUser ? (
        <Stack.Screen name="Name" component={NameScreen} />
      ) : isAuthenticated ? (
        <>
          <Stack.Screen name="Main" component={TabNavigator} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
        </>
      ) : (
        <>
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Auth" component={AuthStack} />
        </>
      )}
    </Stack.Navigator>
  );
}
