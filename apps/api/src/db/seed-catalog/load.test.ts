import { describe, expect, it } from 'vitest';
import type { CatalogSeed, SeedCategory } from '../seed-data/catalog/types.js';
import { validateSeed } from './load.js';

/** A small valid seed; each test breaks one thing in a fresh copy. */
function fixture(): CatalogSeed {
  return {
    categories: [
      {
        name: 'Fixture Cat',
        icon: 'cog',
        fields: [{ key: 'gauge', label: 'Gauge', type: 'number', unit: 'mm', min: 1, max: 10, highlightRank: 1 }],
        machineTypes: [
          {
            name: 'Fixture Type',
            hasSides: true,
            sideConvention: 'Left and right as seen by the weaver.',
            fields: [
              { key: 'heads', label: 'Heads', type: 'number', appliesTo: 'machines', min: 1, max: 60, required: true, highlightRank: 2 },
              {
                key: 'shedding',
                label: 'Shedding',
                type: 'single_select',
                appliesTo: 'machines',
                highlightRank: 3,
                options: [
                  { key: 'cam', label: 'Cam' },
                  { key: 'dobby', label: 'Dobby' },
                ],
              },
            ],
            partGroups: [
              'Temples',
              {
                name: 'Needles',
                hasSides: false,
                fields: [
                  // Rank 2 is also used by `heads`, but parts and machines don't overlap.
                  { key: 'needle_size', label: 'Needle size', type: 'number', appliesTo: 'parts', unit: 'Nm', highlightRank: 2 },
                  { key: 'needle_system', label: 'Needle system', type: 'single_select', appliesTo: 'parts', options: [{ key: 'dbxk5', label: 'DBxK5' }] },
                ],
              },
            ],
          },
          'Plain Type',
        ],
      },
      { name: 'Second Cat', slug: 'second', icon: 'wrench', machineTypes: ['Boiler'] },
    ],
    brands: [
      { key: 'acme', name: 'Acme', makesMachines: true, makesParts: true, models: [{ key: 'ax_100', name: 'AX-100', machineType: 'fixture-cat/fixture-type' }] },
      { key: 'needle_co', name: 'Needle Co', makesMachines: false, makesParts: true },
    ],
    master: {
      units: [
        { key: 'pcs', label: 'Pieces', decimals: 0 },
        { key: 'kg', label: 'Kilograms', decimals: 3 },
      ],
      conditions: [{ key: 'used', label: 'Used', description: 'Removed from a working machine' }],
    },
  };
}

function problems(mutate: (seed: CatalogSeed) => void): string[] {
  const seed = fixture();
  mutate(seed);
  return validateSeed(seed);
}

const cat = (seed: CatalogSeed): SeedCategory => seed.categories[0]!;
type MachineTypeObject = Exclude<SeedCategory['machineTypes'][number], string>;
const type = (seed: CatalogSeed) => cat(seed).machineTypes[0] as MachineTypeObject;
const needles = (seed: CatalogSeed) => type(seed).partGroups![1] as { name: string; fields: NonNullable<MachineTypeObject['fields']> };
const acme = (seed: CatalogSeed) => seed.brands[0]!;

describe('validateSeed', () => {
  it('accepts a valid seed', () => {
    expect(validateSeed(fixture())).toEqual([]);
  });

  it('flags duplicate category slugs', () => {
    expect(problems((s) => (s.categories[1]!.slug = 'fixture-cat'))).toEqual([
      expect.stringMatching(/^categories: duplicate slug "fixture-cat" \("Fixture Cat" and "Second Cat"\)/),
    ]);
  });

  it('flags machine-type names that slugify to the same slug under one category', () => {
    expect(problems((s) => cat(s).machineTypes.push('Plain  type!'))).toEqual([
      expect.stringMatching(/^fixture-cat: duplicate slug "plain-type" .*"Plain  type!"/),
    ]);
  });

  it('flags part-group slugs that repeat under one machine type', () => {
    expect(problems((s) => type(s).partGroups!.push({ name: 'Other Temples', slug: 'temples' }))).toEqual([
      expect.stringMatching(/^fixture-cat\/fixture-type: duplicate slug "temples"/),
    ]);
  });

  it('allows the same machine-type name under different categories', () => {
    expect(problems((s) => s.categories[1]!.machineTypes.push('Plain Type'))).toEqual([]);
  });

  it('flags a slug outside [a-z0-9-] and a name that gives an empty slug', () => {
    const result = problems((s) => {
      s.categories[1]!.slug = 'Second_Cat';
      cat(s).machineTypes.push('!!!');
      type(s).partGroups!.push({ name: 'Hooks', slug: 'hooks%' });
    });
    expect(result).toEqual([
      'categories: invalid slug "Second_Cat" for "Second Cat"',
      'fixture-cat: invalid slug "" for "!!!"',
      'fixture-cat/fixture-type: invalid slug "hooks%" for "Hooks"',
    ]);
  });

  it('flags a field key repeated within one node', () => {
    expect(problems((s) => cat(s).fields!.push({ key: 'gauge', label: 'Again', type: 'text' }))).toEqual([
      expect.stringMatching(/^fixture-cat: field key "gauge" appears twice/),
    ]);
  });

  it('flags a field key repeated across levels of an effective template, whatever its appliesTo', () => {
    expect(problems((s) => needles(s).fields.push({ key: 'heads', label: 'Heads', type: 'text', appliesTo: 'parts' }))).toEqual([
      expect.stringMatching(/^fixture-cat\/fixture-type\/needles: field key "heads" appears twice/),
    ]);
  });

  it.each([0, 7, 1.5])('flags highlight rank %s', (rank) => {
    expect(problems((s) => (cat(s).fields![0]!.highlightRank = rank))).toEqual([
      expect.stringMatching(new RegExp(`^fixture-cat > gauge: highlight rank ${rank} is outside 1–6`)),
    ]);
  });

  it('flags a highlight rank used twice among overlapping appliesTo', () => {
    expect(problems((s) => (type(s).fields![0]!.highlightRank = 1))).toEqual([
      expect.stringMatching(/^fixture-cat\/fixture-type: highlight rank 1 is used twice/),
    ]);
  });

  it('flags a part-group field with appliesTo both that takes a machine field rank', () => {
    expect(problems((s) => (needles(s).fields[0]!.appliesTo = 'both'))).toEqual([
      expect.stringMatching(/^fixture-cat\/fixture-type\/needles: highlight rank 2 is used twice/),
    ]);
  });

  it('flags a select field without options', () => {
    expect(problems((s) => (type(s).fields![1]!.options = []))).toEqual([
      expect.stringMatching(/^fixture-cat\/fixture-type > shedding: select field has no options/),
    ]);
  });

  it('flags options on a non-select field', () => {
    expect(problems((s) => (cat(s).fields![0]!.options = [{ key: 'x1', label: 'X' }]))).toEqual([
      expect.stringMatching(/^fixture-cat > gauge: options are only for select fields/),
    ]);
  });

  it('flags unit, min or max on a non-number field', () => {
    expect(
      problems((s) => {
        type(s).fields![1]!.unit = 'cm';
        type(s).fields![1]!.max = 3;
      }),
    ).toEqual([expect.stringMatching(/^fixture-cat\/fixture-type > shedding: unit\/min\/max are only for number fields/)]);
  });

  it('flags field and option keys that do not match the catalogue key format, and duplicate option keys', () => {
    const result = problems((s) => {
      needles(s).fields[0]!.key = 'Needle-Size';
      type(s).fields![1]!.options![0]!.key = '1cam';
      type(s).fields![1]!.options!.push({ key: 'dobby', label: 'Dobby again' });
    });
    expect(result).toEqual(
      expect.arrayContaining([
        'fixture-cat/fixture-type > shedding: invalid option key "1cam"',
        'fixture-cat/fixture-type > shedding: duplicate option key "dobby"',
        'fixture-cat/fixture-type/needles > Needle-Size: invalid key "Needle-Size"',
      ]),
    );
    expect(result).toHaveLength(3);
  });

  it("flags appliesTo 'machines' on a part-group field", () => {
    expect(problems((s) => (needles(s).fields[1]!.appliesTo = 'machines'))).toEqual([
      "fixture-cat/fixture-type/needles > needle_system: appliesTo 'machines' on a part-group field",
    ]);
  });

  it('flags duplicate and invalid brand keys', () => {
    const result = problems((s) => {
      s.brands[1]!.key = 'acme';
      s.brands.push({ key: 'Bad Key', name: 'Bad', makesMachines: false, makesParts: true });
    });
    expect(result).toEqual(['brands: duplicate key "acme"', 'brands: invalid key "Bad Key"']);
  });

  it('flags brand names that slugify alike, and one that gives an empty slug', () => {
    const result = problems((s) => {
      s.brands.push({ key: 'acme_two', name: 'ACME!', makesMachines: false, makesParts: true });
      s.brands.push({ key: 'nameless', name: '***', makesMachines: false, makesParts: true });
    });
    expect(result).toEqual(['brands: duplicate slug "acme" ("Acme" and "ACME!")', 'brands: invalid slug "" for "***"']);
  });

  it('flags a brand that makes neither machines nor parts', () => {
    expect(problems((s) => (s.brands[1]!.makesParts = false))).toEqual(['brands > needle_co: makes neither machines nor parts']);
  });

  it('flags a model whose machine type path is unknown', () => {
    expect(problems((s) => (acme(s).models![0]!.machineType = 'fixture-cat/no-such-type'))).toEqual([
      'brands > acme > ax_100: unknown machine type "fixture-cat/no-such-type"',
    ]);
  });

  it.each(['fixture-cat', 'fixture-cat/fixture-type/needles'])('flags a model whose path %s is not a machine type', (path) => {
    expect(problems((s) => (acme(s).models![0]!.machineType = path))).toEqual([`brands > acme > ax_100: "${path}" is not a machine type`]);
  });

  it('flags models on a brand that does not make machines', () => {
    expect(problems((s) => (s.brands[1]!.models = [{ key: 'nx_1', name: 'NX-1', machineType: 'second/boiler' }]))).toEqual([
      'brands > needle_co: has models but makesMachines is false',
    ]);
  });

  it('flags duplicate and invalid model keys within a brand', () => {
    const result = problems((s) => {
      acme(s).models!.push({ key: 'ax_100', name: 'AX-200', machineType: 'fixture-cat/plain-type' });
      acme(s).models!.push({ key: 'AX', name: 'AX-300', machineType: 'fixture-cat/plain-type' });
    });
    expect(result).toEqual(['brands > acme models: duplicate key "ax_100"', 'brands > acme models: invalid key "AX"']);
  });

  it('allows the same model key under different brands', () => {
    const result = problems((s) => {
      s.brands.push({ key: 'other', name: 'Other', makesMachines: true, makesParts: false, models: [{ key: 'ax_100', name: 'AX-100', machineType: 'fixture-cat/fixture-type' }] });
    });
    expect(result).toEqual([]);
  });

  it('flags model names equal ignoring case for one brand and machine type', () => {
    expect(problems((s) => acme(s).models!.push({ key: 'ax_100b', name: 'ax-100', machineType: 'fixture-cat/fixture-type' }))).toEqual([
      'brands > acme > ax_100b: model name "ax-100" repeats for machine type "fixture-cat/fixture-type"',
    ]);
  });

  it('allows one model name under two machine types of a brand', () => {
    expect(problems((s) => acme(s).models!.push({ key: 'ax_100b', name: 'AX-100', machineType: 'fixture-cat/plain-type' }))).toEqual([]);
  });

  it.each([4, -1, 1.5])('flags unit decimals %s', (decimals) => {
    expect(problems((s) => s.master.units.push({ key: 'x_unit', label: 'X', decimals }))).toEqual([`units: invalid decimals "${decimals}" for "x_unit"`]);
  });

  it.each([0, 1, 2, 3])('accepts unit decimals %s', (decimals) => {
    expect(problems((s) => s.master.units.push({ key: 'x_unit', label: 'X', decimals }))).toEqual([]);
  });

  it('flags duplicate and invalid unit and condition keys', () => {
    const result = problems((s) => {
      s.master.units.push({ key: 'kg', label: 'Again', decimals: 0 });
      s.master.conditions.push({ key: 'Used', label: 'Used', description: 'x' });
      s.master.conditions.push({ key: 'used', label: 'Used again', description: 'x' });
    });
    expect(result).toEqual(['units: duplicate key "kg"', 'conditions: invalid key "Used"', 'conditions: duplicate key "used"']);
  });
});
