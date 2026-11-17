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
    },
  },
} as const;
