import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type {
  DiscoveryOrigin, DiscoveryRadiusKm, ListingKind, ListingStatus, MyListingsGroup, PartRequestPrefill, RequestBookingParams,
  SearchFacets,
} from '@mpm/shared-types';
import type { FormMode } from '@/lib/onboarding-step';
import type { SellStep } from '@/lib/sell-steps';
import type { ResultsRequest } from '@/lib/search-request';
import type { SearchTabParams } from '@/lib/search-start';
import type { PushAskTrigger } from '@/lib/push-ask';

/** The sheet a listing page opens on arrival (F6 + F7 §15.2). */
export type ListingSheet = 'enquire' | 'offer' | 'buy' | 'ask_price';

export type RootStackParamList = {
  Welcome: undefined;
  Auth: NavigatorScreenParams<AuthStackParamList> | undefined;
  /** Onboarding step 1, or the Profile row "Business profile" with `mode: 'edit'`. Defaults to onboarding. */
  YourBusiness: { mode: FormMode } | undefined;
  /** Onboarding step 2, or the Profile row "Location" with `mode: 'edit'`. Defaults to onboarding. */
  WhereAreYou: { mode: FormMode } | undefined;
  Main: NavigatorScreenParams<TabParamList> | undefined;
  Profile: undefined;
  /** Saved listings (F4 + F5 spec §8.5), from Profile's "Saved (n)" row. Signed-in only. */
  Saved: undefined;
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
  /**
   * The listing page (Task 26). `openSheet` (F6 + F7 §15.2): a guest's pending Enquire / Offer / Buy / Ask price reopens
   * the listing with that sheet after sign-in and onboarding (never sending anything by itself).
   */
  Listing: { listingId: string; openSheet?: ListingSheet };
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

  // F4 + F5 search (B5). Registered in the guest group too: guests search.
  /**
   * Search results (spec §8.4). The params are the list's request (words, filters, removed chips, sort): the screen
   * changes them with `setParams`, the Filters screen returns with `popTo`. `fitLabel` names the fits-machine filter on
   * its chip ("JCB 3DX") when the brand view or Filters set it.
   */
  SearchResults: (ResultsRequest & { fitLabel?: string }) | undefined;
  /**
   * The Filters screen (spec §8.4): the list's request, its **frozen** origin (the live count uses it, R18), the
   * origin's label, and page 1's facets for the counts beside the options.
   */
  SearchFilters: {
    request: ResultsRequest;
    origin: DiscoveryOrigin;
    originLabel: string | null;
    facets: SearchFacets | null;
    fitLabel?: string;
  };
  /**
   * The brand view (`POST /discover/browse/brand`), from Browse's "Popular brands here". `radiusKm` (null = All India,
   * from Browse's "Show all India") replaces the location sheet's radius for the view and the results it opens.
   */
  SearchBrand: { brandId: string; brandName: string; kinds?: ListingKind[]; radiusKm?: DiscoveryRadiusKm | null };

  // F6 + F7 (spec §15.1). Signed-in only, except SellerReviews (public reviews; guests too). C0-5 registers
  // placeholders; each lane replaces its screens.
  /** A chat thread (L6). */
  Thread: { threadId: string };
  /** Profile › Contact number, with the OTP check (L6). */
  ContactNumber: undefined;
  /** Profile › Blocked businesses (L6). */
  BlockedBusinesses: undefined;
  /** The deal record (L7). */
  DealRecord: { dealId: string };
  /**
   * Report a problem with a handed-over deal (L7) or, since M14, a rental booking on rent / returned (B2-4):
   * `id` is the deal's or the booking's id, by `subject`.
   */
  ReportProblem: ReviewSubjectParams;
  /** Rate a completed deal (L8) or, since M14, a completed rental booking (B2-4). */
  ReviewDeal: ReviewSubjectParams;
  /** A seller's public reviews (L8). */
  SellerReviews: { businessId: string };
  /** Profile › Reviews: my seller score and the reviews I received (L8). */
  MyReviews: undefined;
  /** The notifications list (L8). */
  Notifications: undefined;
  /** Profile › Notification settings (L8). */
  NotificationSettings: undefined;
  /** The push permission explainer shown before the system prompt (L8). */
  PermissionExplainer: { trigger: PushAskTrigger };

  // F8 part requests (spec §13.1). Signed-in only. C0-5 registers placeholders (B2 buyer, B3 seller); `Requirement`
  // is real and picks the buyer or seller view by the API's `role`.
  /** Post (or edit, or copy) a requirement (B2). */
  PostRequirement: { prefill?: PartRequestPrefill; editId?: string; copyFromId?: string };
  /** "Requirement posted": how many live listings already matched (B2). */
  RequirementPosted: { partRequestId: string; backfill: number };
  /** Profile / Post › My requirements (B2). */
  MyRequirements: undefined;
  /** One request: the buyer's page (replies, matches) or the seller's (reply with a listing). */
  Requirement: { partRequestId: string; tab?: 'replies' | 'matches' };
  /** Compare responses side by side (B2). */
  CompareResponses: { partRequestId: string };
  /** The seller's reply picker (B3). */
  ReplyWithListing: { partRequestId: string };
  /** Buyers looking: requests for this seller, optionally for one listing (B3). */
  BuyersLooking: { forListing?: string };

  // M14 rental bookings (spec §14.1, plan C0-5). Signed-in only. C0-5 registers placeholders (B2 renter and the
  // Booking record, B3 the owner calendar).
  /**
   * Request booking (B2): `prefill` from the listing page or a Booking record; `change` mode answers that booking's
   * open version (`POST /rental-bookings/:id/change` with `versionSeq`) instead of sending a new request.
   */
  RequestBooking: RequestBookingParams;
  /** One rental booking, for either side (B2). */
  BookingRecord: { bookingId: string };
  /** The owner's calendar of one rental listing: bookings and blocks (B3). */
  RentalCalendar: { listingId: string };
};

/** What a review or a problem report is about (M14 plan C0-5): a deal (F6 + F7) or a rental booking. */
export type ReviewSubjectParams = { subject: 'deal' | 'rental'; id: string };

/** The Deals tab's top switch (plan D15) and an optional listing filter for Rentals (My listings › Bookings (n)). */
export type DealsTabParams = { segment?: 'deals' | 'rentals'; listingId?: string };

export type AuthStackParamList = {
  Phone: undefined;
  /** devCode: returned by the API outside production, shown so dev sign-in needs no SMS. */
  OTP: { phone: string; resendAfter: number; devCode?: string };
};

/** Five tabs (scope "App navigation map"); Profile sits behind the avatar. */
export type TabParamList = {
  Home: undefined;
  /** `browseNodeId`: Browse at that node (Home's category tiles); `focus`: the search box focused (Home's search bar). */
  Search: SearchTabParams | undefined;
  Post: undefined;
  Chats: undefined;
  Deals: DealsTabParams | undefined;
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
