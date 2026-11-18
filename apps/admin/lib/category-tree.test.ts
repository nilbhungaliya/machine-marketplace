import { describe, expect, it } from 'vitest';
import { DEFAULT_SIDE_CONVENTION, type CatalogLevel, type CategoryNode } from '@mpm/shared-types';
import { ancestorsOf, filterTree, findNode, machineTypeChoices, siblingsOf } from './category-tree';

function node(id: string, name: string, level: CatalogLevel, children: CategoryNode[] = []): CategoryNode {
  return {
    id, parentId: null, level, name, slug: id, path: id, icon: null, sortOrder: 0, isActive: true,
    hasSides: null, sideConvention: null, effectiveHasSides: false, effectiveSideConvention: DEFAULT_SIDE_CONVENTION,
    children: children.map((c) => ({ ...c, parentId: id })),
  };
}

const tree: CategoryNode[] = [
  node('sewing', 'Sewing & Embroidery', 'machine_category', [
    node('multi', 'Multi Head Embroidery Machine', 'machine_type', [
      node('hooks', 'Rotary Hooks', 'part_group'),
      node('needles', 'Needles', 'part_group'),
    ]),
    node('lock', 'Lockstitch Machine', 'machine_type', [node('feed', 'Feed Dogs', 'part_group')]),
  ]),
  node('weaving', 'Weaving', 'machine_category', [
    node('waterjet', 'Water Jet Loom', 'machine_type', [node('nozzles', 'Nozzles', 'part_group')]),
  ]),
];

const names = (nodes: CategoryNode[]): unknown[] => nodes.map((n) => (n.children.length ? [n.name, names(n.children)] : n.name));

describe('filterTree', () => {
  it('keeps the ancestors of a matching part group and drops non-matching branches', () => {
    expect(names(filterTree(tree, 'hooks'))).toEqual([['Sewing & Embroidery', [['Multi Head Embroidery Machine', ['Rotary Hooks']]]]]);
  });

  it('matches case-insensitively', () => {
    expect(names(filterTree(tree, 'NOZZLES'))).toEqual([['Weaving', [['Water Jet Loom', ['Nozzles']]]]]);
  });

  it('returns the input unchanged for an empty or blank query', () => {
    expect(filterTree(tree, '')).toBe(tree);
    expect(filterTree(tree, '   ')).toBe(tree);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterTree(tree, 'tractor')).toEqual([]);
  });

  it('keeps the whole subtree of a matching node', () => {
    expect(names(filterTree(tree, 'lockstitch'))).toEqual([['Sewing & Embroidery', [['Lockstitch Machine', ['Feed Dogs']]]]]);
  });
});

describe('findNode / siblingsOf / ancestorsOf', () => {
  it('finds a node at any depth, or null', () => {
    expect(findNode(tree, 'needles')?.name).toBe('Needles');
    expect(findNode(tree, 'weaving')?.name).toBe('Weaving');
    expect(findNode(tree, 'nope')).toBeNull();
  });

  it('returns the full sibling list, the node included', () => {
    expect(siblingsOf(tree, 'needles').map((n) => n.id)).toEqual(['hooks', 'needles']);
    expect(siblingsOf(tree, 'weaving').map((n) => n.id)).toEqual(['sewing', 'weaving']);
    expect(siblingsOf(tree, 'nope')).toEqual([]);
  });

  it('returns the chain from the category down to the node', () => {
    expect(ancestorsOf(tree, 'needles').map((n) => n.id)).toEqual(['sewing', 'multi', 'needles']);
    expect(ancestorsOf(tree, 'nope')).toEqual([]);
  });
});

describe('machineTypeChoices', () => {
  it('lists every machine type with its category, in tree order', () => {
    expect(machineTypeChoices(tree).map((c) => [c.id, c.label])).toEqual([
      ['multi', 'Sewing & Embroidery › Multi Head Embroidery Machine'],
      ['lock', 'Sewing & Embroidery › Lockstitch Machine'],
      ['waterjet', 'Weaving › Water Jet Loom'],
    ]);
  });
});
