import { describe, expect, it } from 'vitest';
import { slugify } from '../../../lib/slug.js';
import { validateSeed } from '../../seed-catalog/load.js';
import { catalogSeed } from './index.js';
import type { SeedField, SeedMachineType, SeedPartGroup } from './types.js';

type TypeObject = Exclude<SeedMachineType, string>;
type GroupObject = Exclude<SeedPartGroup, string>;

const asType = (mt: SeedMachineType): TypeObject => (typeof mt === 'string' ? { name: mt } : mt);
const asGroup = (pg: SeedPartGroup): GroupObject => (typeof pg === 'string' ? { name: pg } : pg);

const types = catalogSeed.categories.flatMap((c) => c.machineTypes.map((mt) => ({ category: c, type: asType(mt), path: `${slugify(c.name)}/${slugify(asType(mt).name)}` })));

function typeNamed(name: string) {
  const found = types.find((t) => t.type.name === name);
  if (!found) throw new Error(`no machine type "${name}"`);
  return found;
}

const groupsOf = (name: string) => (typeNamed(name).type.partGroups ?? []).map(asGroup);
const fieldKeys = (fields: SeedField[] | undefined) => (fields ?? []).map((f) => f.key);
const field = (fields: SeedField[] | undefined, key: string) => (fields ?? []).find((f) => f.key === key);

const EMBROIDERY = ['Multi Head Embroidery Machine', 'Single Head Embroidery Machine', 'Shuttle (Schiffli) Embroidery Machine', 'Sequin Machine', 'Chenille Machine'];
const MULTI_HEAD_GROUPS = [
  'Needles',
  'Needle Bars & Presser Feet',
  'Rotary Hooks & Bobbin Cases',
  'Thread Take-ups & Tension',
  'Trimmers & Cutters',
  'Frames, Pantograph & Hoops',
  'Control Boards & Electronics',
  'Motors & Drives',
  'Sequin & Cording Devices',
  'Belts, Bearings & General Spares',
];

describe('catalogSeed', () => {
  it('is valid', () => {
    expect(validateSeed(catalogSeed)).toEqual([]);
  });

  it('gives no part-group field appliesTo machines, and every detailed part-group field appliesTo parts', () => {
    const groupFields = types.flatMap((t) => (t.type.partGroups ?? []).flatMap((pg) => asGroup(pg).fields ?? []));
    expect(groupFields.length).toBeGreaterThan(0);
    expect(groupFields.filter((f) => f.appliesTo !== 'parts')).toEqual([]);
  });
});

describe('embroidery', () => {
  it('gives each embroidery type its part groups', () => {
    expect(groupsOf('Multi Head Embroidery Machine').map((g) => g.name)).toEqual(MULTI_HEAD_GROUPS);
    expect(groupsOf('Single Head Embroidery Machine').map((g) => g.name)).toEqual(MULTI_HEAD_GROUPS);
    expect(groupsOf('Shuttle (Schiffli) Embroidery Machine').map((g) => g.name)).toEqual([
      'Needles',
      'Shuttles & Bobbins',
      'Borers & Cutters',
      'Pattern Control & Electronics',
      'Motors & Drives',
      'Frames & Structure',
      'General Spares',
    ]);
    expect(groupsOf('Sequin Machine').map((g) => g.name)).toEqual(['Sequin Feeders & Cutters', 'Needles', 'Motors & Drives', 'General Spares']);
    expect(groupsOf('Chenille Machine').map((g) => g.name)).toEqual(['Chenille Heads & Loopers', 'Needles', 'Motors & Drives', 'General Spares']);
  });

  it('gives each embroidery type its machine fields, all for machines', () => {
    const keys = (name: string) => fieldKeys(typeNamed(name).type.fields);
    expect(keys('Multi Head Embroidery Machine')).toEqual(['heads', 'needles_per_head', 'max_embroidery_area', 'head_interval', 'controller', 'attachments']);
    expect(keys('Single Head Embroidery Machine')).toEqual(['needles_per_head', 'max_embroidery_area', 'attachments', 'controller']);
    expect(keys('Shuttle (Schiffli) Embroidery Machine')).toEqual(['machine_length', 'repeat', 'controller']);
    expect(keys('Sequin Machine')).toEqual(['heads', 'needles_per_head', 'controller']);
    expect(keys('Chenille Machine')).toEqual(['heads', 'needles_per_head', 'controller']);
    for (const name of EMBROIDERY) expect((typeNamed(name).type.fields ?? []).every((f) => f.appliesTo === 'machines'), name).toBe(true);
  });

  it('matches the brief on key machine fields', () => {
    const multi = typeNamed('Multi Head Embroidery Machine').type.fields;
    expect(field(multi, 'heads')).toMatchObject({ type: 'number', unit: 'heads', min: 1, max: 60, required: true, filterable: true, highlightRank: 1 });
    expect(field(multi, 'head_interval')).toMatchObject({ type: 'number', unit: 'mm', min: 200, max: 600 });
    expect(field(multi, 'max_embroidery_area')).toMatchObject({ type: 'text', highlightRank: 3, helpText: 'e.g. 500 × 1200 mm' });
    expect(field(multi, 'attachments')).toMatchObject({ type: 'multi_select', filterable: true, highlightRank: 4 });
    expect(field(multi, 'attachments')!.options!.map((o) => o.key)).toEqual(['sequin', 'cording', 'chenille', 'boring', 'taping', 'laser', 'other']);
    const single = typeNamed('Single Head Embroidery Machine').type.fields;
    expect([field(single, 'needles_per_head')?.highlightRank, field(single, 'max_embroidery_area')?.highlightRank, field(single, 'attachments')?.highlightRank]).toEqual([1, 2, 3]);
    const schiffli = typeNamed('Shuttle (Schiffli) Embroidery Machine').type.fields;
    expect(field(schiffli, 'machine_length')).toMatchObject({ type: 'number', unit: 'yards', min: 5, max: 25, required: true, filterable: true, highlightRank: 1 });
    expect(field(schiffli, 'repeat')!.options!.map((o) => o.label)).toEqual(['4/4', '6/4', '8/4', 'Other']);
  });

  it('puts max_embroidery_area on Multi Head and Single Head, never on the category', () => {
    expect(fieldKeys(typeNamed('Multi Head Embroidery Machine').type.fields)).toContain('max_embroidery_area');
    expect(fieldKeys(typeNamed('Single Head Embroidery Machine').type.fields)).toContain('max_embroidery_area');
    const category = typeNamed('Multi Head Embroidery Machine').category;
    expect(category.name).toBe('Sewing, Embroidery & Garments');
    expect(fieldKeys(category.fields)).toEqual([]);
  });

  it('gives every embroidery part group except Needles an item select ending in other', () => {
    for (const name of EMBROIDERY) {
      for (const group of groupsOf(name)) {
        const item = field(group.fields, 'item');
        if (group.name === 'Needles') {
          expect(item, `${name} > Needles`).toBeUndefined();
          continue;
        }
        expect(item, `${name} > ${group.name}`).toMatchObject({ type: 'single_select', required: true, filterable: true, highlightRank: 1 });
        expect(item!.options!.length).toBeGreaterThanOrEqual(3);
        expect(item!.options!.length).toBeLessThanOrEqual(6);
        expect(item!.options!.at(-1)!.key).toBe('other');
      }
    }
    const hooks = groupsOf('Multi Head Embroidery Machine').find((g) => g.name === 'Rotary Hooks & Bobbin Cases')!;
    expect(field(hooks.fields, 'item')!.options!.map((o) => o.key)).toEqual(['hook', 'jumbo_hook', 'bobbin_case', 'bobbin', 'other']);
  });

  it('gives the extra part fields', () => {
    const multi = groupsOf('Multi Head Embroidery Machine');
    const group = (name: string) => multi.find((g) => g.name === name)!.fields;
    expect(field(group('Frames, Pantograph & Hoops'), 'size')).toMatchObject({ type: 'text', highlightRank: 2 });
    expect(field(group('Control Boards & Electronics'), 'board_code')).toMatchObject({ type: 'text', required: true, highlightRank: 2 });
    expect(field(group('Motors & Drives'), 'power')).toMatchObject({ type: 'number', unit: 'W', highlightRank: 2 });
    const schiffli = groupsOf('Shuttle (Schiffli) Embroidery Machine');
    expect(field(schiffli.find((g) => g.name === 'Pattern Control & Electronics')!.fields, 'board_code')).toMatchObject({ type: 'text', required: true });
  });

  it('uses a needle-system select for multi and single head, and text for the other three', () => {
    for (const name of ['Multi Head Embroidery Machine', 'Single Head Embroidery Machine']) {
      const needles = groupsOf(name).find((g) => g.name === 'Needles')!.fields;
      expect(field(needles, 'needle_system')).toMatchObject({ type: 'single_select', required: true, filterable: true, highlightRank: 1 });
      expect(field(needles, 'needle_system')!.options!.map((o) => o.label)).toEqual(['DBxK5', 'DBxK5 SES', 'DBx1', 'Other']);
      expect(field(needles, 'needle_size')).toMatchObject({ type: 'number', unit: 'Nm', min: 55, max: 140, filterable: true, highlightRank: 2 });
    }
    for (const name of ['Shuttle (Schiffli) Embroidery Machine', 'Sequin Machine', 'Chenille Machine']) {
      const needles = groupsOf(name).find((g) => g.name === 'Needles')!.fields;
      expect(field(needles, 'needle_system')).toMatchObject({ type: 'text', required: true, filterable: true, highlightRank: 1, helpText: 'e.g. Schiffli needle system and size as on the packet' });
      expect(field(needles, 'needle_system')!.options).toBeUndefined();
      expect(field(needles, 'needle_size')).toMatchObject({ type: 'number', unit: 'Nm', min: 55, max: 200, filterable: true, highlightRank: 2 });
    }
  });

  it('gives no embroidery node sides', () => {
    for (const name of EMBROIDERY) {
      expect(typeNamed(name).type.hasSides, name).toBeUndefined();
      expect(groupsOf(name).filter((g) => g.hasSides !== undefined), name).toEqual([]);
    }
  });
});

describe('water-jet loom', () => {
  const loom = () => typeNamed('Water Jet Loom');

  it('has 11 part groups, the side ones with sides, each with an item select', () => {
    const groups = groupsOf('Water Jet Loom');
    expect(groups.map((g) => g.name)).toEqual([
      'Nozzles & Water Pumps',
      'Weft Measuring & Feeders',
      'Shedding (Cams, Dobby, Heald Frames)',
      'Reed & Beat-up',
      'Take-up & Let-off',
      'Temples & Selvedge',
      'Cutters',
      'Electronics & Sensors',
      'Motors & Clutch-brake',
      'Side Frames & Structure',
      'Bearings, Gears & Belts',
    ]);
    expect(groups.filter((g) => g.hasSides).map((g) => g.name)).toEqual(['Temples & Selvedge', 'Side Frames & Structure']);
    for (const group of groups) {
      const item = field(group.fields, 'item');
      expect(item, group.name).toMatchObject({ type: 'single_select', appliesTo: 'parts', required: true, filterable: true, highlightRank: 1 });
      expect(item!.options!.length).toBeGreaterThanOrEqual(3);
      expect(item!.options!.length).toBeLessThanOrEqual(6);
      expect(item!.options!.at(-1)!.key).toBe('other');
    }
  });

  it("has the weaver's side convention and its machine fields", () => {
    expect(loom().type.sideConvention).toBe('Left and right as seen by the weaver standing at the front of the loom, facing it.');
    const fields = loom().type.fields;
    expect(fieldKeys(fields)).toEqual(['reed_space', 'nozzles', 'shedding', 'rpm']);
    expect(field(fields, 'reed_space')).toMatchObject({ type: 'number', appliesTo: 'machines', unit: 'cm', min: 150, max: 400, required: true, filterable: true, highlightRank: 1 });
    expect(field(fields, 'nozzles')!.options!.map((o) => o.key)).toEqual(['single', 'double', 'triple']);
    expect(field(fields, 'shedding')!.options!.map((o) => o.key)).toEqual(['crank', 'cam', 'dobby', 'electronic_dobby']);
    expect(field(fields, 'rpm')).toMatchObject({ type: 'number', appliesTo: 'machines', min: 300, max: 1500, filterable: true, highlightRank: 4 });
  });
});

describe('brands', () => {
  const brand = (name: string) => catalogSeed.brands.find((b) => b.name === name)!;
  const modelPath = (brandName: string, modelName: string) => brand(brandName).models!.find((m) => m.name === modelName)!.machineType;

  it('points models at the right machine type paths', () => {
    expect(modelPath('Tajima', 'TMAR-KC')).toBe(typeNamed('Multi Head Embroidery Machine').path);
    expect(modelPath('Tajima', 'SAI')).toBe(typeNamed('Single Head Embroidery Machine').path);
    expect(modelPath('Saurer', 'Epoca 7')).toBe(typeNamed('Shuttle (Schiffli) Embroidery Machine').path);
    expect(modelPath('Toyota', 'LWT710')).toBe('weaving/water-jet-loom');
  });

  it('lists the brief brands with their flags', () => {
    expect(catalogSeed.brands.map((b) => [b.name, b.makesMachines, b.makesParts, (b.models ?? []).map((m) => m.name).join(', ')])).toEqual([
      ['Tajima', true, true, 'TMAR-KC, TMEZ-SC, TFMX-IIC, SAI'],
      ['Barudan', true, true, 'BEVT-Z, BEKS-S, BEXT-S1501CII'],
      ['ZSK', true, true, 'Racer 2, Challenge, Sprint 6'],
      ['Happy', true, true, 'HCR3, HCS3'],
      ['SWF', true, true, 'K-UK, MAS-12'],
      ['Saurer', true, true, 'Epoca 7'],
      ['Toyota', true, true, 'LWT710, LWT810'],
      ['Tsudakoma', true, true, 'ZW408, ZW8100'],
      ['Lässer', true, false, ''],
      ['Nissan', true, false, ''],
      ['Groz-Beckert', false, true, ''],
      ['Organ Needles', false, true, ''],
      ['Schmetz', false, true, ''],
      ['Hirose', false, true, ''],
    ]);
  });

  it('slugs Lässer without the umlaut', () => {
    expect(slugify(brand('Lässer').name)).toBe('lasser');
  });
});

describe('master data', () => {
  it('has the 8 units and 4 conditions', () => {
    expect(catalogSeed.master.units.map((u) => [u.key, u.label, u.decimals])).toEqual([
      ['pcs', 'Pieces', 0],
      ['pairs', 'Pairs', 0],
      ['sets', 'Sets', 0],
      ['kg', 'Kilograms', 3],
      // The brief's key "m" is one character; CATALOG_KEY_REGEX needs two or more, so the key is "metres".
      ['metres', 'Metres', 2],
      ['litres', 'Litres', 2],
      ['boxes', 'Boxes', 0],
      ['machines', 'Machines', 0],
    ]);
    expect(catalogSeed.master.conditions).toEqual([
      { key: 'new', label: 'New', description: 'Never used, in original packing' },
      { key: 'unused', label: 'Unused', description: 'Never fitted; packing may be open' },
      { key: 'used', label: 'Used', description: 'Removed from a working machine' },
      { key: 'excess', label: 'Excess', description: 'Surplus stock from a mill or dealer' },
    ]);
  });
});
