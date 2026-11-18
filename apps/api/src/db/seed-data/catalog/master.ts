import type { SeedMaster } from './types.js';

// Starter units and conditions (spec §7). Global lists; the admin manages them after go-live.
export const MASTER: SeedMaster = {
  units: [
    { key: 'pcs', label: 'Pieces', decimals: 0 },
    { key: 'pairs', label: 'Pairs', decimals: 0 },
    { key: 'sets', label: 'Sets', decimals: 0 },
    { key: 'kg', label: 'Kilograms', decimals: 3 },
    // The spec's key is "m", but keys need two or more characters (CATALOG_KEY_REGEX).
    { key: 'metres', label: 'Metres', decimals: 2 },
    { key: 'litres', label: 'Litres', decimals: 2 },
    { key: 'boxes', label: 'Boxes', decimals: 0 },
    // Machines and rentals are listed in this unit (F2 spec §4.2, R48).
    { key: 'machines', label: 'Machines', decimals: 0, isMachineUnit: true },
  ],
  conditions: [
    { key: 'new', label: 'New', description: 'Never used, in original packing' },
    { key: 'unused', label: 'Unused', description: 'Never fitted; packing may be open' },
    { key: 'used', label: 'Used', description: 'Removed from a working machine' },
    { key: 'excess', label: 'Excess', description: 'Surplus stock from a mill or dealer' },
  ],
};
