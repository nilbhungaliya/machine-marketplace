import React, { useEffect, useRef, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { showSuspendedToast, useAuth } from '@/hooks/useAuth';
import { appEntry } from '@/lib/onboarding-step';
import { onSessionEnded } from '@/lib/session-events';
import WelcomeScreen from '@/screens/welcome';
import ProfileScreen from '@/screens/profile';
import YourBusinessScreen from '@/screens/onboarding/your-business';
import WhereAreYouScreen from '@/screens/onboarding/where-are-you';
import GstIntroScreen from '@/screens/verification/gst-intro';
import GstStartScreen from '@/screens/verification/gst-start';
import GstFoundScreen from '@/screens/verification/gst-found';
import GstDeclareScreen from '@/screens/verification/gst-declare';
import GstCodeScreen from '@/screens/verification/gst-code';
import GstReviewFormScreen from '@/screens/verification/gst-review-form';
import GstStatusScreen from '@/screens/verification/gst-status';
import AuthStack from './auth-stack';
import TabNavigator from './tab-navigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Gating (F1 spec §7): signed out → Welcome; onboarding `profile` → Your business; `location` → Where are you?;
 * `done` → the tabs. Each group has its own `navigationKey`, so moving between them drops the previous group's screens
 * even where a name repeats (Your business and Where are you? also open from Profile, in edit mode).
 *
 * The GST intro: when a group mounts, every route of the previous one is gone, and React Navigation opens the first
 * screen listed (`StackRouter.getStateForRouteNamesChange` falls back to `routeNames[0]`; `initialRouteName` would
 * be frozen at the navigator's first render, so it isn't used). So while `gstIntro` is set, `GstIntro` is listed
 * first in the `app` group (`appEntry`); otherwise it comes after the tabs. Re-ordering later keeps the routes on the
 * stack, so clearing the flag on Verify / Skip doesn't move anyone.
 *
 * A suspended or blocked account (F1 spec §8.2): any API call refused with `403 ACCOUNT_SUSPENDED` signs out here,
 * with the same message the sign-in screen shows.
 */
export default function RootNavigator() {
  const { isAuthenticated, onboarding, gstIntro, loadToken, logout } = useAuth();
  const [isReady, setIsReady] = useState(false);
  const signedIn = useRef(isAuthenticated);
  signedIn.current = isAuthenticated;
  const ending = useRef(false);

  useEffect(() => {
    if (isAuthenticated) ending.current = false;
  }, [isAuthenticated]);

  // Several calls can fail at once: sign out and say why once. Signed out (sign-in, boot) is left to those screens.
  useEffect(
    () =>
      onSessionEnded(() => {
        if (!signedIn.current || ending.current) return;
        ending.current = true;
        showSuspendedToast();
        void logout();
      }),
    [logout],
  );

  useEffect(() => {
    loadToken().finally(() => setIsReady(true));
  }, [loadToken]);

  if (!isReady) return null;

  const introFirst = appEntry(gstIntro).screen === 'GstIntro';
  const intro = <Stack.Screen key="GstIntro" name="GstIntro" component={GstIntroScreen} options={{ gestureEnabled: false }} />;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isAuthenticated ? (
        <Stack.Group navigationKey="signed-out">
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Auth" component={AuthStack} />
        </Stack.Group>
      ) : onboarding === 'profile' ? (
        <Stack.Group navigationKey="onboarding-profile">
          <Stack.Screen name="YourBusiness" component={YourBusinessScreen} initialParams={{ mode: 'onboarding' }} />
        </Stack.Group>
      ) : onboarding === 'location' ? (
        <Stack.Group navigationKey="onboarding-location">
          <Stack.Screen name="WhereAreYou" component={WhereAreYouScreen} initialParams={{ mode: 'onboarding' }} />
        </Stack.Group>
      ) : (
        <Stack.Group navigationKey="app">
          {introFirst ? intro : null}
          <Stack.Screen name="Main" component={TabNavigator} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="YourBusiness" component={YourBusinessScreen} initialParams={{ mode: 'edit' }} />
          <Stack.Screen name="WhereAreYou" component={WhereAreYouScreen} initialParams={{ mode: 'edit' }} />
          {introFirst ? null : intro}
          <Stack.Screen name="GstStart" component={GstStartScreen} />
          <Stack.Screen name="GstFound" component={GstFoundScreen} />
          <Stack.Screen name="GstDeclare" component={GstDeclareScreen} />
          <Stack.Screen name="GstCode" component={GstCodeScreen} />
          <Stack.Screen name="GstReviewForm" component={GstReviewFormScreen} />
          <Stack.Screen name="GstStatus" component={GstStatusScreen} />
        </Stack.Group>
      )}
    </Stack.Navigator>
  );
}
