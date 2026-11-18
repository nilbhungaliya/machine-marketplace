import type { CategoryIcon, FieldAppliesTo, FieldType } from '@mpm/shared-types';

// Shape of the starter catalogue (spec §10). Loaded once by `db:seed:catalog`; after go-live the
// database is the source of truth and these files are history.

export interface SeedOption {
  key: string;
  label: string;
}

export interface SeedField {
  key: string;
  label: string;
  type: FieldType;
  /** Defaults to 'both'. Never 'machines' on a part-group field. */
  appliesTo?: FieldAppliesTo;
  helpText?: string;
  /** Number fields only. */
  unit?: string;
  min?: number;
  max?: number;
  required?: boolean;
  filterable?: boolean;
  /** 1–6, unique among fields of an effective template whose `appliesTo` overlap. */
  highlightRank?: number;
  /** Select fields only. */
  options?: SeedOption[];
}

/** A plain name, or a name with settings of its own. `slug` defaults to slugify(name). */
export type SeedPartGroup = string | { name: string; slug?: string; hasSides?: boolean; fields?: SeedField[] };

/** A plain name, or a name with settings, fields and part groups. `slug` defaults to slugify(name). */
export type SeedMachineType =
  | string
  | {
      name: string;
      slug?: string;
      hasSides?: boolean;
      sideConvention?: string;
      fields?: SeedField[];
      partGroups?: SeedPartGroup[];
    };

export interface SeedCategory {
  name: string;
  /** Defaults to slugify(name). */
  slug?: string;
  icon: CategoryIcon;
  hasSides?: boolean;
  sideConvention?: string;
  fields?: SeedField[];
  machineTypes: SeedMachineType[];
}

export interface SeedModel {
  key: string;
  name: string;
  /** Machine type path, e.g. 'weaving/water-jet-loom'. */
  machineType: string;
}

/** Brand slug is slugify(name). */
export interface SeedBrand {
  key: string;
  name: string;
  makesMachines: boolean;
  makesParts: boolean;
  models?: SeedModel[];
}

export interface SeedMaster {
  /** `decimals`: fraction digits a quantity may have, 0–3. */
  /** `isMachineUnit`: machines and rentals use the first active flagged unit (F2 spec §4.2, R48). */
  units: { key: string; label: string; decimals: number; isMachineUnit?: boolean }[];
  conditions: { key: string; label: string; description: string }[];
}

export interface CatalogSeed {
  categories: SeedCategory[];
  brands: SeedBrand[];
  master: SeedMaster;
}
