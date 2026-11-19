import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import HomeScreen from '@/screens/tabs/home';
import SearchScreen from '@/screens/tabs/search';
import PostScreen from '@/screens/tabs/post';
import ChatsScreen from '@/screens/tabs/chats';
import DealsScreen from '@/screens/tabs/deals';
import { GuestChatsTab, GuestDealsTab, GuestPostTab } from '@/screens/tabs/guest-gate';
import { useRequireSignIn } from '@/hooks/use-require-sign-in';
import { gatedTabScreens, tabSignInReason } from '@/lib/sign-in-gate';
import { TAB_ICONS, type LucideIcon } from '@/lib/icons';
import FloatingTabBar from './floating-tab-bar';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

function tabIcon(Icon: LucideIcon, strokeWidth = 2) {
  return function Rendered({ color, size }: { color: string; size: number }) {
    return <Icon size={size} color={color} strokeWidth={strokeWidth} />;
  };
}

export default function TabNavigator() {
  // Labels resolve here, so a language switch re-renders the tab bar. The bar is icon-only (Ruling R9): the names are
  // the tabs' accessibility labels; `tabBarLabel` stays for the labelled variant.
  const { t } = useTranslation();
  // Guests (F4 + F5 spec §8.1): Post, Chats and Deals open the sign-in sheet instead of switching tab; a guest who
  // reaches one anyway sees its guest gate, never the signed-in screen.
  const { signedIn, requireSignIn } = useRequireSignIn();
  const guard = ({ route }: { route: { name: keyof TabParamList } }) => ({
    tabPress: (e: { preventDefault: () => void }) => {
      const reason = tabSignInReason(route.name, signedIn);
      if (!reason) return;
      e.preventDefault();
      requireSignIn({ reason });
    },
  });
  const gated = gatedTabScreens(signedIn, {
    Post: { member: PostScreen, guest: GuestPostTab },
    Chats: { member: ChatsScreen, guest: GuestChatsTab },
    Deals: { member: DealsScreen, guest: GuestDealsTab },
  });
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} />}>
      <Tab.Screen name="Home" component={HomeScreen}
        options={{
          tabBarIcon: tabIcon(TAB_ICONS.home), tabBarLabel: t('nav.tabs.home'),
          tabBarAccessibilityLabel: t('nav.tabs.home'), tabBarButtonTestID: 'Tab-home',
        }} />
      <Tab.Screen name="Search" component={SearchScreen}
        options={{
          tabBarIcon: tabIcon(TAB_ICONS.search), tabBarLabel: t('nav.tabs.search'),
          tabBarAccessibilityLabel: t('nav.tabs.search'), tabBarButtonTestID: 'Tab-search',
        }} />
      <Tab.Screen name="Post" component={gated.Post} listeners={guard}
        options={{
          tabBarIcon: tabIcon(TAB_ICONS.post, 2.4), tabBarLabel: t('nav.tabs.post'),
          tabBarAccessibilityLabel: t('nav.tabs.post'), tabBarButtonTestID: 'Tab-post',
        }} />
      <Tab.Screen name="Chats" component={gated.Chats} listeners={guard}
        options={{
          tabBarIcon: tabIcon(TAB_ICONS.chats), tabBarLabel: t('nav.tabs.chats'),
          tabBarAccessibilityLabel: t('nav.tabs.chats'), tabBarButtonTestID: 'Tab-chats',
        }} />
      <Tab.Screen name="Deals" component={gated.Deals} listeners={guard}
        options={{
          tabBarIcon: tabIcon(TAB_ICONS.deals), tabBarLabel: t('nav.tabs.deals'),
          tabBarAccessibilityLabel: t('nav.tabs.deals'), tabBarButtonTestID: 'Tab-deals',
        }} />
    </Tab.Navigator>
  );
}
