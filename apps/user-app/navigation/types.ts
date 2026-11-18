import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { FormMode } from '@/lib/onboarding-step';

export type RootStackParamList = {
  Welcome: undefined;
  Auth: NavigatorScreenParams<AuthStackParamList> | undefined;
  /** Onboarding step 1, or the Profile row "Business profile" with `mode: 'edit'`. Defaults to onboarding. */
  YourBusiness: { mode: FormMode } | undefined;
  /** Onboarding step 2, or the Profile row "Location" with `mode: 'edit'`. Defaults to onboarding. */
  WhereAreYou: { mode: FormMode } | undefined;
  Main: NavigatorScreenParams<TabParamList> | undefined;
  Profile: undefined;
  /** "Get verified", once right after onboarding (Skip for now). */
  GstIntro: undefined;
  /** GST verification (F1 spec §7): which screen opens is `gstScreen(state)` in lib/gst-flow.ts. */
  GstStart: undefined;
  GstFound: undefined;
  GstDeclare: { checkId: string };
  GstCode: undefined;
  /** `checkId`: "Can't get the code?" attaches the lookup; `gstin` prefills the field. */
  GstReviewForm: { checkId?: string; gstin?: string } | undefined;
  GstStatus: undefined;
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
