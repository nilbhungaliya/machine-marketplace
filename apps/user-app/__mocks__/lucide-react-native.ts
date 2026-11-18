// Vitest stub for lucide-react-native: it renders through react-native-svg, which
// cannot run in Node. Unit tests only check icon identity, never render, so a named
// function per icon is enough. Keep in sync with lib/icons.ts.

export type LucideIcon = (...args: unknown[]) => null;

function makeIcon(name: string): LucideIcon {
  const fn = () => null;
  (fn as unknown as { displayName: string }).displayName = name;
  return fn as unknown as LucideIcon;
}

export const ChevronLeft = makeIcon('ChevronLeft');
export const ChevronRight = makeIcon('ChevronRight');
export const Home = makeIcon('Home');
export const Search = makeIcon('Search');
export const PlusCircle = makeIcon('PlusCircle');
export const MessageCircle = makeIcon('MessageCircle');
export const Handshake = makeIcon('Handshake');
export const User = makeIcon('User');
export const Package = makeIcon('Package');
export const ClipboardList = makeIcon('ClipboardList');
export const MapPin = makeIcon('MapPin');
export const Globe = makeIcon('Globe');
export const Sun = makeIcon('Sun');
export const LogOut = makeIcon('LogOut');
export const Check = makeIcon('Check');
export const ShieldCheck = makeIcon('ShieldCheck');
export const CircleCheck = makeIcon('CircleCheck');
export const TriangleAlert = makeIcon('TriangleAlert');
export const Info = makeIcon('Info');
export const Wrench = makeIcon('Wrench');
export const Factory = makeIcon('Factory');
export const CalendarClock = makeIcon('CalendarClock');
export const BellRing = makeIcon('BellRing');
export const Cog = makeIcon('Cog');
export const Scissors = makeIcon('Scissors');
export const Shirt = makeIcon('Shirt');
export const Layers = makeIcon('Layers');
export const Droplets = makeIcon('Droplets');
export const Printer = makeIcon('Printer');
export const Microscope = makeIcon('Microscope');
export const WashingMachine = makeIcon('WashingMachine');
export const Footprints = makeIcon('Footprints');
export const LocateFixed = makeIcon('LocateFixed');
export const Camera = makeIcon('Camera');
export const Images = makeIcon('Images');
export const FileText = makeIcon('FileText');
export const X = makeIcon('X');
export const Clock = makeIcon('Clock');
export const ShieldAlert = makeIcon('ShieldAlert');
export const Building2 = makeIcon('Building2');
export const Square = makeIcon('Square');
export const SquareCheck = makeIcon('SquareCheck');
