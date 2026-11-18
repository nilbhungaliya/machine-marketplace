import type { SeedBrand } from './types.js';

// Starter brands and models (spec §6, §10). Drafts from public sources: every brand and model loads with
// `needsReview: true` for the client to confirm. Model `machineType` paths are the slugs tree.ts produces.

const MULTI_HEAD = 'sewing-embroidery-and-garments/multi-head-embroidery-machine';
const SINGLE_HEAD = 'sewing-embroidery-and-garments/single-head-embroidery-machine';
const SCHIFFLI = 'sewing-embroidery-and-garments/shuttle-schiffli-embroidery-machine';
const WATER_JET = 'weaving/water-jet-loom';

export const BRANDS: SeedBrand[] = [
  // Machines and parts.
  {
    key: 'tajima', name: 'Tajima', makesMachines: true, makesParts: true,
    models: [
      { key: 'tmar_kc', name: 'TMAR-KC', machineType: MULTI_HEAD },
      { key: 'tmez_sc', name: 'TMEZ-SC', machineType: MULTI_HEAD },
      { key: 'tfmx_iic', name: 'TFMX-IIC', machineType: MULTI_HEAD },
      { key: 'sai', name: 'SAI', machineType: SINGLE_HEAD },
    ],
  },
  {
    key: 'barudan', name: 'Barudan', makesMachines: true, makesParts: true,
    models: [
      { key: 'bevt_z', name: 'BEVT-Z', machineType: MULTI_HEAD },
      { key: 'beks_s', name: 'BEKS-S', machineType: MULTI_HEAD },
      { key: 'bext_s1501cii', name: 'BEXT-S1501CII', machineType: SINGLE_HEAD },
    ],
  },
  {
    key: 'zsk', name: 'ZSK', makesMachines: true, makesParts: true,
    models: [
      { key: 'racer_2', name: 'Racer 2', machineType: MULTI_HEAD },
      { key: 'challenge', name: 'Challenge', machineType: MULTI_HEAD },
      { key: 'sprint_6', name: 'Sprint 6', machineType: SINGLE_HEAD },
    ],
  },
  {
    key: 'happy', name: 'Happy', makesMachines: true, makesParts: true,
    models: [
      { key: 'hcr3', name: 'HCR3', machineType: MULTI_HEAD },
      { key: 'hcs3', name: 'HCS3', machineType: SINGLE_HEAD },
    ],
  },
  {
    key: 'swf', name: 'SWF', makesMachines: true, makesParts: true,
    models: [
      { key: 'k_uk', name: 'K-UK', machineType: MULTI_HEAD },
      { key: 'mas_12', name: 'MAS-12', machineType: SINGLE_HEAD },
    ],
  },
  {
    key: 'saurer', name: 'Saurer', makesMachines: true, makesParts: true,
    models: [{ key: 'epoca_7', name: 'Epoca 7', machineType: SCHIFFLI }],
  },
  {
    key: 'toyota', name: 'Toyota', makesMachines: true, makesParts: true,
    models: [
      { key: 'lwt710', name: 'LWT710', machineType: WATER_JET },
      { key: 'lwt810', name: 'LWT810', machineType: WATER_JET },
    ],
  },
  {
    key: 'tsudakoma', name: 'Tsudakoma', makesMachines: true, makesParts: true,
    models: [
      { key: 'zw408', name: 'ZW408', machineType: WATER_JET },
      { key: 'zw8100', name: 'ZW8100', machineType: WATER_JET },
    ],
  },
  // Machines only, no models yet: Lässer (Schiffli), Nissan (water-jet).
  { key: 'lasser', name: 'Lässer', makesMachines: true, makesParts: false },
  { key: 'nissan', name: 'Nissan', makesMachines: true, makesParts: false },
  // Parts only: needles (Groz-Beckert, Organ Needles, Schmetz) and hooks (Hirose).
  { key: 'groz_beckert', name: 'Groz-Beckert', makesMachines: false, makesParts: true },
  { key: 'organ_needles', name: 'Organ Needles', makesMachines: false, makesParts: true },
  { key: 'schmetz', name: 'Schmetz', makesMachines: false, makesParts: true },
  { key: 'hirose', name: 'Hirose', makesMachines: false, makesParts: true },
];
