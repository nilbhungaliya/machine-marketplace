import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { ListingStatus, MyListingsGroup } from '@mpm/shared-types';
import type { FormMode } from '@/lib/onboarding-step';
import type { SellStep } from '@/lib/sell-steps';

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

  // F2 + F3 listings (spec §15.1). Types only: each app task registers its own screens in root-navigator.tsx.
  /** The sell wizard: one route pushed per step, so Back works naturally (Task 23; `preview` is Task 25). `mode: 'edit'` = a step opened from the Edit listing menu, with Save. */
  Sell: { listingId: string; step: SellStep; mode?: 'create' | 'edit' };
  /** After publish (Task 25): `outcome` is where it landed, `live` or `pending_review`. */
  SellPublished: { listingId: string; outcome: ListingStatus };
  /** The drafts list (Task 25), from the Post tab's "Drafts (n)" and My listings. */
  MyDrafts: undefined;
  /** The listing page (Task 26). */
  Listing: { listingId: string };
  /** Full-screen photo / video viewer of a listing, opened at `index` (Task 26). */
  ListingMedia: { listingId: string; index: number };
  /** A seller's public listings (Task 26). */
  SellerListings: { businessId: string };
  /** My listings (Task 27), opened on `group` (default `live`). */
  MyListings: { group?: MyListingsGroup } | undefined;
  /** The "Edit listing" menu of a published listing (Task 27). */
  ListingEditMenu: { listingId: string };
  /** Listings an admin removed in the last 30 days, read-only with the reason (Task 27). */
  RemovedByTeam: undefined;
  /** Other side matches (Task 28): from the listing page or from the seller's own listing (Published, manage sheet). */
  OtherSide: { listingId: string; from: 'listing' | 'mine' };
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
