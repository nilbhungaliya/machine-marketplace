// One place for icons: screens import from here, never from lucide directly,
// so swapping a glyph is a one-line change. Adding one here? Add it to
// __mocks__/lucide-react-native.ts too, or tests that import it will fail.
import type { LucideIcon } from 'lucide-react-native';
import type { CategoryIcon } from '@mpm/shared-types';
import {
  ChevronLeft, ChevronRight, Home, Search, PlusCircle, MessageCircle, Handshake, User, Package,
  ClipboardList, MapPin, Globe, Sun, LogOut, Check, ShieldCheck, CircleCheck, TriangleAlert, Info, Wrench, Factory,
  CalendarClock, BellRing, Cog, Scissors, Shirt, Layers, Droplets, Printer, Microscope, WashingMachine, Footprints,
  LocateFixed, Camera, Images, FileText, X, Clock, ShieldAlert, Building2, Square, SquareCheck,
} from 'lucide-react-native';

export type { LucideIcon };
export {
  ChevronLeft, ChevronRight, Search, Package, ClipboardList, MapPin, Globe, Sun, LogOut, Check, ShieldCheck, User,
  CircleCheck, TriangleAlert, Info, Wrench, Factory, CalendarClock, BellRing, LocateFixed, Camera, Images, FileText, X,
  Clock, ShieldAlert, Building2, Square, SquareCheck,
};

export const TAB_ICONS = {
  home: Home,
  search: Search,
  post: PlusCircle,
  chats: MessageCircle,
  deals: Handshake,
} satisfies Record<string, LucideIcon>;

/** A4's machine-category icons (`CATEGORY_ICONS`, lucide kebab-case names) as components. */
export const CATEGORY_ICON_COMPONENTS = {
  cog: Cog,
  factory: Factory,
  scissors: Scissors,
  shirt: Shirt,
  layers: Layers,
  droplets: Droplets,
  printer: Printer,
  microscope: Microscope,
  'washing-machine': WashingMachine,
  footprints: Footprints,
  wrench: Wrench,
  package: Package,
} satisfies Record<CategoryIcon, LucideIcon>;
