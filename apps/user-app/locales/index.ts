import enCommon from './en/common.json';
import hiCommon from './hi/common.json';
import guCommon from './gu/common.json';
import enAuth from './en/auth.json';
import hiAuth from './hi/auth.json';
import guAuth from './gu/auth.json';
import enNav from './en/nav.json';
import hiNav from './hi/nav.json';
import guNav from './gu/nav.json';
import enHome from './en/home.json';
import hiHome from './hi/home.json';
import guHome from './gu/home.json';
import enSearch from './en/search.json';
import hiSearch from './hi/search.json';
import guSearch from './gu/search.json';
import enPost from './en/post.json';
import hiPost from './hi/post.json';
import guPost from './gu/post.json';
import enChats from './en/chats.json';
import hiChats from './hi/chats.json';
import guChats from './gu/chats.json';
import enDeals from './en/deals.json';
import hiDeals from './hi/deals.json';
import guDeals from './gu/deals.json';
import enProfile from './en/profile.json';
import hiProfile from './hi/profile.json';
import guProfile from './gu/profile.json';
import enErrors from './en/errors.json';
import hiErrors from './hi/errors.json';
import guErrors from './gu/errors.json';
import enComponents from './en/components.json';
import hiComponents from './hi/components.json';
import guComponents from './gu/components.json';
import enOnboarding from './en/onboarding.json';
import hiOnboarding from './hi/onboarding.json';
import guOnboarding from './gu/onboarding.json';
import enVerification from './en/verification.json';
import hiVerification from './hi/verification.json';
import guVerification from './gu/verification.json';
import enSell from './en/sell.json';
import hiSell from './hi/sell.json';
import guSell from './gu/sell.json';
import enListing from './en/listing.json';
import hiListing from './hi/listing.json';
import guListing from './gu/listing.json';
import enSaved from './en/saved.json';
import hiSaved from './hi/saved.json';
import guSaved from './gu/saved.json';
import enDiscover from './en/discover.json';
import hiDiscover from './hi/discover.json';
import guDiscover from './gu/discover.json';
// F6 + F7 (C0-5)
import enOffers from './en/offers.json';
import hiOffers from './hi/offers.json';
import guOffers from './gu/offers.json';
import enReviews from './en/reviews.json';
import hiReviews from './hi/reviews.json';
import guReviews from './gu/reviews.json';
import enNotifications from './en/notifications.json';
import hiNotifications from './hi/notifications.json';
import guNotifications from './gu/notifications.json';
import enHolds from './en/holds.json';
import hiHolds from './hi/holds.json';
import guHolds from './gu/holds.json';
// F8 (C0-5)
import enRequirements from './en/requirements.json';
import hiRequirements from './hi/requirements.json';
import guRequirements from './gu/requirements.json';
import enBuyers from './en/buyers.json';
import hiBuyers from './hi/buyers.json';
import guBuyers from './gu/buyers.json';

// One import per language per area. A new area: add its JSON in en/, hi/ and gu/, then register it here.
export const resources = {
  en: {
    translation: {
      common: enCommon,
      auth: enAuth,
      nav: enNav,
      home: enHome,
      search: enSearch,
      post: enPost,
      chats: enChats,
      deals: enDeals,
      profile: enProfile,
      errors: enErrors,
      components: enComponents,
      onboarding: enOnboarding,
      verification: enVerification,
      sell: enSell,
      listing: enListing,
      saved: enSaved,
      discover: enDiscover,
      offers: enOffers,
      reviews: enReviews,
      notifications: enNotifications,
      holds: enHolds,
      requirements: enRequirements,
      buyers: enBuyers,
    },
  },
  hi: {
    translation: {
      common: hiCommon,
      auth: hiAuth,
      nav: hiNav,
      home: hiHome,
      search: hiSearch,
      post: hiPost,
      chats: hiChats,
      deals: hiDeals,
      profile: hiProfile,
      errors: hiErrors,
      components: hiComponents,
      onboarding: hiOnboarding,
      verification: hiVerification,
      sell: hiSell,
      listing: hiListing,
      saved: hiSaved,
      discover: hiDiscover,
      offers: hiOffers,
      reviews: hiReviews,
      notifications: hiNotifications,
      holds: hiHolds,
      requirements: hiRequirements,
      buyers: hiBuyers,
    },
  },
  gu: {
    translation: {
      common: guCommon,
      auth: guAuth,
      nav: guNav,
      home: guHome,
      search: guSearch,
      post: guPost,
      chats: guChats,
      deals: guDeals,
      profile: guProfile,
      errors: guErrors,
      components: guComponents,
      onboarding: guOnboarding,
      verification: guVerification,
      sell: guSell,
      listing: guListing,
      saved: guSaved,
      discover: guDiscover,
      offers: guOffers,
      reviews: guReviews,
      notifications: guNotifications,
      holds: guHolds,
      requirements: guRequirements,
      buyers: guBuyers,
    },
  },
} as const;
