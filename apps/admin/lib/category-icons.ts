import {
  Cog, Droplets, Factory, Footprints, Layers, Microscope, Package, Printer, Scissors, Shirt, WashingMachine, Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { CategoryIcon } from '@mpm/shared-types';

/** The fixed machine-category icon keys (lucide kebab-case names) as components. */
export const CATEGORY_ICON_COMPONENTS: Record<CategoryIcon, LucideIcon> = {
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
};
