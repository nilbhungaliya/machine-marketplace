import { describe, expect, it } from 'vitest';
import type { CategoryNode } from '@mpm/shared-types';
import {
  categoryLevelFor, findNode, hasSidesFor, machineTypeIdOf, nodePath, pushRecent, recentNodes,
  requestScopeTypeId, scopedPartGroups, searchCategories,
} from './sell-category';

const node = (over: Partial<CategoryNode> & Pick<CategoryNode, 'id' | 'level' | 'name'>): CategoryNode => ({
  parentId: null, slug: over.id, path: over.id, icon: null, sortOrder: 0, isActive: true, hasSides: null,
  sideConvention: null, effectiveHasSides: false, effectiveSideConvention: 'default', children: [], ...over,
});

const tree: CategoryNode[] = [
  node({
    id: 'weaving', level: 'machine_category', name: 'Weaving',
    children: [
      node({
        id: 'rapier', parentId: 'weaving', level: 'machine_type', name: 'Rapier loom',
        children: [
          node({ id: 'temple', parentId: 'rapier', level: 'part_group', name: 'Temple rollers', effectiveHasSides: true }),
          node({ id: 'gears', parentId: 'rapier', level: 'part_group', name: 'Gears' }),
        ],
      }),
      node({ id: 'airjet', parentId: 'weaving', level: 'machine_type', name: 'Air-jet loom', children: [] }),
    ],
  }),
  node({
    id: 'embroidery', level: 'machine_category', name: 'Embroidery',
    children: [
      node({
        id: 'multihead', parentId: 'embroidery', level: 'machine_type', name: 'Multi-head embroidery',
        children: [node({ id: 'hooks', parentId: 'multihead', level: 'part_group', name: 'Rotary hooks' })],
      }),
    ],
  }),
];

describe('sell-category', () => {
  it('picks part groups for parts and machine types for machines and rentals', () => {
    expect(categoryLevelFor('part')).toBe('part_group');
    expect(categoryLevelFor('machine')).toBe('machine_type');
    expect(categoryLevelFor('machine_rental')).toBe('machine_type');
  });

  it('finds a node and its path from the root', () => {
    expect(findNode(tree, 'temple')?.name).toBe('Temple rollers');
    expect(findNode(tree, 'nope')).toBeNull();
    expect(nodePath(tree, 'temple').map((n) => n.id)).toEqual(['weaving', 'rapier', 'temple']);
    expect(nodePath(tree, 'nope')).toEqual([]);
  });

  it("gives a part group's machine type, and a machine type itself", () => {
    expect(machineTypeIdOf(tree, 'temple')).toBe('rapier');
    expect(machineTypeIdOf(tree, 'rapier')).toBe('rapier');
    expect(machineTypeIdOf(tree, 'weaving')).toBeNull();
    expect(machineTypeIdOf(tree, null)).toBeNull();
  });

  it('reads sides from the node, else from a side already set (a node no longer in the active tree)', () => {
    expect(hasSidesFor(tree, { categoryId: 'temple', side: null })).toBe(true);
    expect(hasSidesFor(tree, { categoryId: 'gears', side: null })).toBe(false);
    expect(hasSidesFor(tree, { categoryId: 'gone', side: 'left' })).toBe(true);
    expect(hasSidesFor(tree, { categoryId: 'gone', side: 'not_applicable' })).toBe(false);
    expect(hasSidesFor(tree, { categoryId: null, side: null })).toBe(false);
  });

  it('searches only the level of the kind, every word anywhere in the path', () => {
    expect(searchCategories(tree, 'part', 'rapier').map((r) => r.node.id)).toEqual(['temple', 'gears']);
    expect(searchCategories(tree, 'part', 'temple rapier').map((r) => r.node.id)).toEqual(['temple']);
    expect(searchCategories(tree, 'machine', 'loom').map((r) => r.node.id)).toEqual(['rapier', 'airjet']);
    expect(searchCategories(tree, 'part', '  ')).toEqual([]);
    const [hit] = searchCategories(tree, 'part', 'hooks');
    expect(hit?.path).toEqual(['Embroidery', 'Multi-head embroidery']);
  });

  it('ranks names that start with the query first', () => {
    expect(searchCategories(tree, 'machine', 'air').map((r) => r.node.id)).toEqual(['airjet']);
    expect(searchCategories(tree, 'part', 'ro').map((r) => r.node.id)).toEqual(['hooks', 'temple']);
  });

  it('keeps the last 5 picks, newest first, without repeats', () => {
    expect(pushRecent(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd']);
    expect(pushRecent([], 'a')).toEqual(['a']);
  });

  it('shows recent picks still in the tree at the right level', () => {
    expect(recentNodes(tree, 'part', ['hooks', 'gone', 'rapier', 'temple']).map((n) => n.id)).toEqual(['hooks', 'temple']);
  });
});

describe('scopedPartGroups (F8 §9.3)', () => {
  it("returns only the machine type's part groups, and every part group without a type", () => {
    expect(scopedPartGroups(tree, 'rapier').map((n) => n.id)).toEqual(['temple', 'gears']);
    expect(scopedPartGroups(tree, 'airjet')).toEqual([]);
    expect(scopedPartGroups(tree, null).map((n) => n.id)).toEqual(['temple', 'gears', 'hooks']);
    expect(scopedPartGroups(tree, 'nope').map((n) => n.id)).toEqual(['temple', 'gears', 'hooks']);
  });

  it('scopes only a part request on a machine type', () => {
    expect(requestScopeTypeId(tree, { kind: 'part', categoryId: 'rapier' })).toBe('rapier');
    expect(requestScopeTypeId(tree, { kind: 'part', categoryId: 'temple' })).toBeNull();
    expect(requestScopeTypeId(tree, { kind: 'machine', categoryId: 'rapier' })).toBeNull();
    expect(requestScopeTypeId(tree, null)).toBeNull();
  });
});
