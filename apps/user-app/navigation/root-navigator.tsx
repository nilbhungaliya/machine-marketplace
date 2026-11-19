import React, { useEffect, useRef, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { showSuspendedToast, useAuth } from '@/hooks/useAuth';
import { appEntry } from '@/lib/onboarding-step';
import { onSessionEnded } from '@/lib/session-events';
import { shouldRestoreGuest } from '@/lib/sign-in-gate';
import WelcomeScreen from '@/screens/welcome';
import ProfileScreen from '@/screens/profile';
import SavedScreen from '@/screens/saved';
import YourBusinessScreen from '@/screens/onboarding/your-business';
import WhereAreYouScreen from '@/screens/onboarding/where-are-you';
import GstIntroScreen from '@/screens/verification/gst-intro';
import GstStartScreen from '@/screens/verification/gst-start';
import GstFoundScreen from '@/screens/verification/gst-found';
import GstDeclareScreen from '@/screens/verification/gst-declare';
import GstCodeScreen from '@/screens/verification/gst-code';
import GstReviewFormScreen from '@/screens/verification/gst-review-form';
import GstStatusScreen from '@/screens/verification/gst-status';
// F2 sell (L5)
import SellStepScreen from '@/screens/sell/sell-step';
import SellPublishedScreen from '@/screens/sell/published';
import MyDraftsScreen from '@/screens/my-listings/drafts';
// F2 listing (L6)
import ListingScreen from '@/screens/listing/listing';
import MediaViewerScreen from '@/screens/listing/media-viewer';
import SellerListingsScreen from '@/screens/listing/seller-listings';
import OtherSideScreen from '@/screens/listing/other-side';
import MyListingsScreen from '@/screens/my-listings/my-listings';
import EditMenuScreen from '@/screens/my-listings/edit-menu';
import RemovedByTeamScreen from '@/screens/my-listings/removed-by-team';
// F4 + F5 search (B5)
import SearchResultsScreen from '@/screens/search/results';
import SearchFiltersScreen from '@/screens/search/filters';
import SearchBrandScreen from '@/screens/search/brand';
// F6 + F7 (C0-5 placeholders; each lane replaces its screens)
import ThreadScreen from '@/screens/chat/thread';
import ContactNumberScreen from '@/screens/profile/contact-number';
import BlockedBusinessesScreen from '@/screens/profile/blocked-businesses';
import DealRecordScreen from '@/screens/deals/deal-record';
import ReportProblemScreen from '@/screens/deals/report-problem';
import ReviewDealScreen from '@/screens/reviews/review-deal';
import SellerReviewsScreen from '@/screens/reviews/seller-reviews';
import MyReviewsScreen from '@/screens/reviews/my-reviews';
import NotificationsScreen from '@/screens/notifications/notifications';
import NotificationSettingsScreen from '@/screens/notifications/notification-settings';
import PermissionExplainerScreen from '@/screens/notifications/permission-explainer';
import SocketProvider from '@/components/SocketProvider';
import { usePendingActionRunner } from '@/hooks/use-saved';
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
 * Guests (F4 + F5 spec §8.1): Welcome's "Browse first" opens the `guest` group (remembered for the next cold start);
 * sign-in is asked at the moment of intent through the sign-in sheet, and a pending action (Save) runs once after OTP
 * and onboarding (`usePendingActionRunner`).
 *
 * A suspended or blocked account (F1 spec §8.2): any API call refused with `403 ACCOUNT_SUSPENDED` signs out here,
 * with the same message the sign-in screen shows.
 */
export default function RootNavigator() {
  const { isAuthenticated, guest, onboarding, gstIntro, loadToken, restoreGuest, logout } = useAuth();
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
    loadToken()
      // A refused saved session goes to Welcome; only "nothing saved" may reopen the guest tabs.
      .then((boot) => (shouldRestoreGuest(boot) ? restoreGuest() : undefined))
      .finally(() => setIsReady(true));
  }, [loadToken, restoreGuest]);

  // A guest's Save (or another pending action) finishes here, once, after sign-in and onboarding.
  usePendingActionRunner();

  if (!isReady) return null;

  const introFirst = appEntry(gstIntro).screen === 'GstIntro';
  const intro = <Stack.Screen key="GstIntro" name="GstIntro" component={GstIntroScreen} options={{ gestureEnabled: false }} />;

  return (
    // One /user socket for the signed-in user with a business (F6 + F7 §13); guests and onboarding get none. Enabled
    // only once onboarding is done, so the socket connects after the business exists and joins its business room.
    <SocketProvider enabled={isAuthenticated && onboarding === 'done'}>
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isAuthenticated && guest ? (
        // Guests browse (F4 + F5 spec §8.1, R12): the tabs, the listing pages and the auth screens, pushed when needed.
        // Same `navigationKey` as the signed-in group, so a returning user who signs in from a listing stays on it
        // (only `Auth` is dropped); a new user goes through onboarding first.
        <Stack.Group navigationKey="app">
          <Stack.Screen name="Main" component={TabNavigator} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="Listing" component={ListingScreen} />
          <Stack.Screen name="ListingMedia" component={MediaViewerScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="SellerListings" component={SellerListingsScreen} />
          <Stack.Screen name="OtherSide" component={OtherSideScreen} />
          {/* F4 + F5 search (B5): guests search too. */}
          <Stack.Screen name="SearchResults" component={SearchResultsScreen} />
          <Stack.Screen name="SearchFilters" component={SearchFiltersScreen} />
          <Stack.Screen name="SearchBrand" component={SearchBrandScreen} />
          {/* F6 + F7: a seller's public reviews, from the listing page. */}
          <Stack.Screen name="SellerReviews" component={SellerReviewsScreen} />
          <Stack.Screen name="Auth" component={AuthStack} />
        </Stack.Group>
      ) : !isAuthenticated ? (
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
          <Stack.Screen name="Saved" component={SavedScreen} />
          <Stack.Screen name="YourBusiness" component={YourBusinessScreen} initialParams={{ mode: 'edit' }} />
          <Stack.Screen name="WhereAreYou" component={WhereAreYouScreen} initialParams={{ mode: 'edit' }} />
          {introFirst ? null : intro}
          <Stack.Screen name="GstStart" component={GstStartScreen} />
          <Stack.Screen name="GstFound" component={GstFoundScreen} />
          <Stack.Screen name="GstDeclare" component={GstDeclareScreen} />
          <Stack.Screen name="GstCode" component={GstCodeScreen} />
          <Stack.Screen name="GstReviewForm" component={GstReviewFormScreen} />
          <Stack.Screen name="GstStatus" component={GstStatusScreen} />
          {/* F2 sell (L5) */}
          <Stack.Screen name="Sell" component={SellStepScreen} />
          <Stack.Screen name="SellPublished" component={SellPublishedScreen} />
          <Stack.Screen name="MyDrafts" component={MyDraftsScreen} />
          {/* F2 listing (L6) */}
          <Stack.Screen name="Listing" component={ListingScreen} />
          <Stack.Screen name="ListingMedia" component={MediaViewerScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="SellerListings" component={SellerListingsScreen} />
          <Stack.Screen name="OtherSide" component={OtherSideScreen} />
          <Stack.Screen name="MyListings" component={MyListingsScreen} />
          <Stack.Screen name="ListingEditMenu" component={EditMenuScreen} />
          <Stack.Screen name="RemovedByTeam" component={RemovedByTeamScreen} />
          {/* F4 + F5 search (B5) */}
          <Stack.Screen name="SearchResults" component={SearchResultsScreen} />
          <Stack.Screen name="SearchFilters" component={SearchFiltersScreen} />
          <Stack.Screen name="SearchBrand" component={SearchBrandScreen} />
          {/* F6 + F7 (L6 chat, L7 deals, L8 reviews and notifications) */}
          <Stack.Screen name="Thread" component={ThreadScreen} />
          <Stack.Screen name="ContactNumber" component={ContactNumberScreen} />
          <Stack.Screen name="BlockedBusinesses" component={BlockedBusinessesScreen} />
          <Stack.Screen name="DealRecord" component={DealRecordScreen} />
          <Stack.Screen name="ReportProblem" component={ReportProblemScreen} />
          <Stack.Screen name="ReviewDeal" component={ReviewDealScreen} />
          <Stack.Screen name="SellerReviews" component={SellerReviewsScreen} />
          <Stack.Screen name="MyReviews" component={MyReviewsScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
          <Stack.Screen name="PermissionExplainer" component={PermissionExplainerScreen} options={{ presentation: 'modal' }} />
        </Stack.Group>
      )}
    </Stack.Navigator>
    </SocketProvider>
  );
}
