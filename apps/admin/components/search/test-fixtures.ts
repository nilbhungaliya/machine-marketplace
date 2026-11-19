import { DEFAULT_SIDE_CONVENTION, type BrandWithModels, type CatalogLevel, type CategoryNode, type SearchSynonym } from '@mpm/shared-types';

// Fixtures for the F4 + F5 admin search tests.

export function synonym(over: Partial<SearchSynonym> & Pick<SearchSynonym, 'id' | 'term'>): SearchSynonym {
  return {
    termNorm: over.term.toLowerCase(),
    script: 'latin',
    targetKind: 'word',
    targetId: null,
    targetSide: null,
    targetWord: null,
    targetName: null,
    isActive: true,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-19T10:00:00.000Z',
    ...over,
  };
}

export function node(id: string, name: string, level: CatalogLevel, children: CategoryNode[] = [], isActive = true): CategoryNode {
  return {
    id, parentId: null, level, name, slug: id, path: id, icon: null, sortOrder: 0, isActive,
    hasSides: null, sideConvention: null, effectiveHasSides: false, effectiveSideConvention: DEFAULT_SIDE_CONVENTION,
    children: children.map((c) => ({ ...c, parentId: id })),
  };
}

export const tree: CategoryNode[] = [
  node('11111111-1111-4111-8111-111111111111', 'Construction', 'machine_category', [
    node('22222222-2222-4222-8222-222222222222', 'Backhoe Loader', 'machine_type', [
      node('33333333-3333-4333-8333-333333333333', 'Gears', 'part_group'),
      node('44444444-4444-4444-8444-444444444444', 'Old Hooks', 'part_group', [], false),
    ]),
  ]),
];

export const brands: BrandWithModels[] = [
  {
    id: '55555555-5555-4555-8555-555555555555', key: 'jcb', name: 'JCB', slug: 'jcb', makesMachines: true, makesParts: true,
    needsReview: false, sortOrder: 0, isActive: true, chipNeedsContext: false,
    models: [{
      id: '66666666-6666-4666-8666-666666666666', key: '3dx', brandId: '55555555-5555-4555-8555-555555555555',
      machineTypeId: '22222222-2222-4222-8222-222222222222', name: '3DX', needsReview: false, sortOrder: 0, isActive: true,
    }],
  },
  {
    id: '77777777-7777-4777-8777-777777777777', key: 'retired', name: 'Retired Co', slug: 'retired', makesMachines: true,
    makesParts: false, needsReview: false, sortOrder: 1, isActive: false, chipNeedsContext: false, models: [],
  },
];
