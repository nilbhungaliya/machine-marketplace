import { describe, expect, it } from 'vitest';
import { validateSeed } from '../../seed-catalog/load.js';
import { DROPPED, MERGED, PART_ITEMS, PROCESS_PART_GROUPS } from './cleaning.js';
import { F2F_MACHINERY } from './f2f-machinery.js';
import { CATEGORIES } from './tree.js';
import type { SeedMachineType, SeedPartGroup } from './types.js';

const nameOf = (node: SeedMachineType | SeedPartGroup) => (typeof node === 'string' ? node : node.name);
const partGroupNames = (mt: SeedMachineType) => (typeof mt === 'string' ? [] : (mt.partGroups ?? []).map(nameOf));

const machineTypes = CATEGORIES.flatMap((c) => c.machineTypes.map((mt) => ({ category: c.name, name: nameOf(mt), node: mt })));
const placedNames = new Set(machineTypes.map((t) => t.name));

function typeNamed(name: string) {
  const matches = machineTypes.filter((t) => t.name === name);
  expect(matches, `machine type "${name}"`).toHaveLength(1);
  return matches[0]!;
}

describe('F2F coverage', () => {
  it('has the 465 F2F names verbatim, each once', () => {
    expect(F2F_MACHINERY).toHaveLength(465);
    expect(new Set(F2F_MACHINERY).size).toBe(465);
    expect(F2F_MACHINERY[0]).toBe('Accessories for Compact Spinning Machines');
    expect(F2F_MACHINERY[464]).toBe('Yarn Testing Machine');
    expect(F2F_MACHINERY).toContain('Chennile Machine');
    expect(F2F_MACHINERY).toContain('Measuringand Rolling and Folding Machine For Woven Fabrics');
  });

  it('accounts for every F2F name in exactly one place', () => {
    const where = (name: string) =>
      [
        name in DROPPED && 'DROPPED',
        name in MERGED && 'MERGED',
        name in PART_ITEMS && 'PART_ITEMS',
        name in PROCESS_PART_GROUPS && 'PROCESS_PART_GROUPS',
        placedNames.has(name) && 'placed',
      ].filter(Boolean);
    const wrong = F2F_MACHINERY.map((name) => ({ name, where: where(name) })).filter((n) => n.where.length !== 1);
    expect(wrong).toEqual([]);
  });

  it('lists only real F2F names in the cleaning lists', () => {
    const f2f = new Set(F2F_MACHINERY);
    const keys = [...Object.keys(DROPPED), ...Object.keys(MERGED), ...Object.keys(PART_ITEMS), ...Object.keys(PROCESS_PART_GROUPS)];
    expect(keys.filter((k) => !f2f.has(k))).toEqual([]);
  });

  it('merges and attaches part items only to placed machine types', () => {
    expect(Object.values(MERGED).filter((name) => !placedNames.has(name))).toEqual([]);
    expect(Object.values(PART_ITEMS).flatMap((p) => p.machineTypes).filter((name) => !placedNames.has(name))).toEqual([]);
    expect(Object.values(PROCESS_PART_GROUPS).flatMap((p) => p.except).filter((name) => !placedNames.has(name))).toEqual([]);
  });
});

describe('CATEGORIES', () => {
  it('has the 10 categories in order, without Pre-owned Machinery', () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual([
      'Spinning',
      'Weaving',
      'Knitting',
      'Dyeing',
      'Printing & Finishing',
      'Testing & Inspection',
      'Sewing, Embroidery & Garments',
      'Laundry',
      'Leather & Footwear Machinery',
      'Equipment & Accessories',
    ]);
  });

  it('is a valid seed on its own', () => {
    expect(validateSeed({ categories: CATEGORIES, brands: [], master: { units: [], conditions: [] } })).toEqual([]);
  });

  it('has about 250 machine types, none of them dropped names, catch-alls or typos', () => {
    expect(machineTypes.length).toBeGreaterThanOrEqual(230);
    expect(machineTypes.length).toBeLessThanOrEqual(270);
    const names = machineTypes.map((t) => t.name);
    for (const banned of ['Others', 'Beauty Equipment', 'Sports Equipment', 'Carpets and Rugs']) expect(names).not.toContain(banned);
    expect(names.filter((n) => /Chennile|machinary/.test(n))).toEqual([]);
  });

  it('places the key machine types', () => {
    expect(typeNamed('Water Jet Loom').category).toBe('Weaving');
    expect(typeNamed('Multi Head Embroidery Machine').category).toBe('Sewing, Embroidery & Garments');
    expect(typeNamed('Shuttle (Schiffli) Embroidery Machine').category).toBe('Sewing, Embroidery & Garments');
    expect(typeNamed('Two for One Twister (TFO)').category).toBe('Spinning');
    expect(typeNamed('Stenter Machine').category).toBe('Printing & Finishing');
  });

  it('gives every machine type at least one part group', () => {
    expect(machineTypes.filter((t) => partGroupNames(t.node).length === 0).map((t) => t.name)).toEqual([]);
  });

  it('appends the process-wide part group last, except on types with a full set', () => {
    expect(partGroupNames(typeNamed('Rapier Loom').node).at(-1)).toBe('Weaving machinery parts');
    expect(partGroupNames(typeNamed('Circular Knitting Machine').node)).toContain('Textile machine parts');
    expect(partGroupNames(typeNamed('Bale Opener').node)).toEqual(['Spinning machinery parts']);
    expect(partGroupNames(typeNamed('Water Jet Loom').node)).not.toContain('Weaving machinery parts');
    expect(partGroupNames(typeNamed('Multi Head Embroidery Machine').node)).not.toContain('Sewing machine parts & accessories');
  });

  it('attaches F2F part items to the machine types they serve, once each', () => {
    expect(partGroupNames(typeNamed('Carding Machine').node)).toEqual(['Card clothing', 'Feeding devices', 'Cans', 'Spinning machinery parts']);
    expect(partGroupNames(typeNamed('Rapier Loom').node)).toContain('Weft feelers & sensors');
    expect(partGroupNames(typeNamed('Direct Warping Machine').node)).toEqual(['Beams & flanges', 'Weaving machinery parts']);
    const sewing = partGroupNames(typeNamed('Industrial Sewing Machine').node);
    expect(sewing).toEqual(['Needles', 'Bobbins & bobbin cases', 'Sewing machine parts & accessories']);
  });
});
