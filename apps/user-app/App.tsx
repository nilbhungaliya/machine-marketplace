import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import * as SplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { Provider } from 'react-redux';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PostHogProvider } from 'posthog-react-native';
import { store } from '@/store';
import { queryClient, startAppStateFocusTracking } from '@/lib/queryClient';
import { initI18n } from '@/lib/i18n/language';
import { clearKeychainOnFreshInstall } from '@/lib/fresh-install';
import { initAnalytics, pickAllowedParams, screen } from '@/lib/analytics';
import { ThemeProvider, useTheme } from '@/lib/ThemeContext';
import AppToast from '@/components/AppToast';
import { ConfirmSheetProvider } from '@/components/ConfirmSheet';
import RootNavigator from '@/navigation/root-navigator';
import { navigationRef } from '@/navigation/navigationRef';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Module scope: the provider needs a stable client. Null without a token.
const posthog = initAnalytics();

// PostHog's captureScreens autocapture does not work with React Navigation 7,
// so screens are reported from the container's state changes instead.
function handleNavigationStateChange() {
  const route = navigationRef.getCurrentRoute();
  if (route) screen(route.name, pickAllowedParams(route.params));
}

function AppContent() {
  const { colors, isDark } = useTheme();
  const base = isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.hairline,
      primary: colors.primary,
      notification: colors.danger,
    },
  };

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <ConfirmSheetProvider>
            <NavigationContainer
              ref={navigationRef}
              theme={navTheme}
              // onStateChange does not fire for the initial route.
              onReady={handleNavigationStateChange}
              onStateChange={handleNavigationStateChange}
            >
              {posthog ? (
                <PostHogProvider
                  client={posthog}
                  autocapture={{
                    captureTouches: true,
                    captureScreens: false,
                    // testID doubles as the English analytics label (Button's phLabel).
                    // Labels only, never children: tapped text can be a phone or a price.
                    propsToCapture: ['testID'],
                  }}
                >
                  <RootNavigator />
                </PostHogProvider>
              ) : (
                // Not client={undefined}: the provider would build a live client.
                <RootNavigator />
              )}
            </NavigationContainer>
            <AppToast />
          </ConfirmSheetProvider>
        </QueryClientProvider>
      </Provider>
    </>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });
  const [bootReady, setBootReady] = useState(false);

  // Before RootNavigator mounts: the keychain purge must run before anything reads the token.
  useEffect(() => {
    void (async () => {
      try {
        await clearKeychainOnFreshInstall();
        await initI18n();
      } catch (err) {
        // Neither should throw, but a boot that never finishes is a splash forever.
        Sentry.captureException(err);
      } finally {
        setBootReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && bootReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError, bootReady]);

  // Mounted here, above the font-loading early return: one app-wide subscription.
  useEffect(() => startAppStateFocusTracking(), []);

  if ((!fontsLoaded && !fontError) || !bootReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
