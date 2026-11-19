// One place for icons: screens import from here, never from lucide directly,
// so swapping a glyph is a one-line change. Adding one here? Add it to
// __mocks__/lucide-react-native.ts too, or tests that import it will fail.
import type { LucideIcon } from 'lucide-react-native';
import type { CategoryIcon } from '@mpm/shared-types';
import {
  ChevronLeft, ChevronRight, Home, Search, Plus, MessageCircle, Handshake, User, Package,
  ClipboardList, MapPin, Globe, Sun, LogOut, Check, ShieldCheck, CircleCheck, TriangleAlert, Info, Wrench, Factory,
  CalendarClock, BellRing, Cog, Scissors, Shirt, Layers, Droplets, Printer, Microscope, WashingMachine, Footprints,
  LocateFixed, Camera, Images, FileText, X, Clock, ShieldAlert, Building2, Square, SquareCheck,
  // F2 listings (C0, for the app lanes): media tiles, sell steps, listing page, manage sheet, other side.
  Play, Pause, Pencil, RefreshCw, Tag, Flag, Star, Video, ImagePlus, EllipsisVertical, ArrowLeftRight, Truck, RotateCcw, CircleX, Ban, Inbox, Trash, Eye, Gauge,
  // F4 + F5 discovery (B4): the heart, the location chip, the filter row.
  Heart, ChevronDown, SlidersHorizontal,
} from 'lucide-react-native';

export type { LucideIcon };
export {
  ChevronLeft, ChevronRight, Search, Package, ClipboardList, MapPin, Globe, Sun, LogOut, Check, ShieldCheck, User,
  CircleCheck, TriangleAlert, Info, Wrench, Factory, CalendarClock, BellRing, LocateFixed, Camera, Images, FileText, X,
  Clock, ShieldAlert, Building2, Square, SquareCheck,
  Play, Pause, Pencil, RefreshCw, Tag, Flag, Star, Video, ImagePlus, EllipsisVertical, ArrowLeftRight, Truck, RotateCcw, CircleX, Ban, Inbox, Trash, Eye, Gauge,
  Heart, ChevronDown, SlidersHorizontal,
};

export const TAB_ICONS = {
  home: Home,
  search: Search,
  post: Plus,
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
