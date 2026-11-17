// One place for icons: screens import from here, never from lucide directly,
// so swapping a glyph is a one-line change. Adding one here? Add it to
// __mocks__/lucide-react-native.ts too, or tests that import it will fail.
import type { LucideIcon } from 'lucide-react-native';
import {
  ChevronLeft, ChevronRight, Home, Search, PlusCircle, MessageCircle, Handshake, User, Package,
  ClipboardList, MapPin, Globe, Sun, LogOut, Check, ShieldCheck, CircleCheck, TriangleAlert, Info, Wrench, Factory,
  CalendarClock, BellRing,
} from 'lucide-react-native';

export type { LucideIcon };
export {
  ChevronLeft, ChevronRight, Search, Package, ClipboardList, MapPin, Globe, Sun, LogOut, Check, ShieldCheck, User,
  CircleCheck, TriangleAlert, Info, Wrench, Factory, CalendarClock, BellRing,
};

export const TAB_ICONS = {
  home: Home,
  search: Search,
  post: PlusCircle,
  chats: MessageCircle,
  deals: Handshake,
} satisfies Record<string, LucideIcon>;
