import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Welcome: undefined;
  Auth: NavigatorScreenParams<AuthStackParamList> | undefined;
  Name: undefined;
  Main: NavigatorScreenParams<TabParamList> | undefined;
  Profile: undefined;
};

export type AuthStackParamList = {
  Phone: undefined;
  /** devCode: returned by the API outside production, shown so dev sign-in needs no SMS. */
  OTP: { phone: string; resendAfter: number; devCode?: string };
};

/** Five tabs (scope "App navigation map"); Profile sits behind the avatar. */
export type TabParamList = {
  Home: undefined;
  Search: undefined;
  Post: undefined;
  Chats: undefined;
  Deals: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;

export type AuthStackScreenProps<T extends keyof AuthStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<AuthStackParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;
