import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import HomeScreen from '@/screens/tabs/home';
import SearchScreen from '@/screens/tabs/search';
import PostScreen from '@/screens/tabs/post';
import ChatsScreen from '@/screens/tabs/chats';
import DealsScreen from '@/screens/tabs/deals';
import { TAB_ICONS, type LucideIcon } from '@/lib/icons';
import { fonts, useTheme } from '@/lib/theme';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

function tabIcon(Icon: LucideIcon) {
  return function Rendered({ color, size }: { color: string; size: number }) {
    return <Icon size={size} color={color} />;
  };
}

export default function TabNavigator() {
  // Labels resolve here, so a language switch re-renders the tab bar.
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen}
        options={{ tabBarIcon: tabIcon(TAB_ICONS.home), tabBarLabel: t('nav.tabs.home') }} />
      <Tab.Screen name="Search" component={SearchScreen}
        options={{ tabBarIcon: tabIcon(TAB_ICONS.search), tabBarLabel: t('nav.tabs.search') }} />
      <Tab.Screen name="Post" component={PostScreen}
        options={{ tabBarIcon: tabIcon(TAB_ICONS.post), tabBarLabel: t('nav.tabs.post') }} />
      <Tab.Screen name="Chats" component={ChatsScreen}
        options={{ tabBarIcon: tabIcon(TAB_ICONS.chats), tabBarLabel: t('nav.tabs.chats') }} />
      <Tab.Screen name="Deals" component={DealsScreen}
        options={{ tabBarIcon: tabIcon(TAB_ICONS.deals), tabBarLabel: t('nav.tabs.deals') }} />
    </Tab.Navigator>
  );
}
