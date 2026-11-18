import { BRANDS } from './brands.js';
import { MASTER } from './master.js';
import { CATEGORIES } from './tree.js';
import type { CatalogSeed } from './types.js';

/** The starter catalogue loaded by `db:seed:catalog` (spec §10). */
export const catalogSeed: CatalogSeed = { categories: CATEGORIES, brands: BRANDS, master: MASTER };
