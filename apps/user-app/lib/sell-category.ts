import type { CatalogLevel, CategoryNode, ListingKind, PartSide } from '@mpm/shared-types';

// The sell wizard's category step (F2 spec §5.2, R28): which level a kind picks, search over the cached `GET
// /categories` tree with breadcrumbs, the recent picks kept on the device, and the node facts the other steps need
// (sides, the machine type of a part group). Pure: the AsyncStorage read / write lives in the screen.

/** Parts pick a part group; machines and rentals a machine type. */
export function categoryLevelFor(kind: ListingKind): CatalogLevel {
  return kind === 'part' ? 'part_group' : 'machine_type';
}

/** The nodes from the root down to `id` (empty when it isn't in the tree). */
export function nodePath(tree: readonly CategoryNode[], id: string | null | undefined): CategoryNode[] {
  if (!id) return [];
  for (const n of tree) {
    if (n.id === id) return [n];
    const below = nodePath(n.children, id);
    if (below.length > 0) return [n, ...below];
  }
  return [];
}

export function findNode(tree: readonly CategoryNode[], id: string | null | undefined): CategoryNode | null {
  return nodePath(tree, id).at(-1) ?? null;
}

/**
 * The machine type a listing's category belongs to: a part group's parent type, or the machine type itself. The fit
 * step lists that type's brands and models first.
 */
export function machineTypeIdOf(tree: readonly CategoryNode[], id: string | null | undefined): string | null {
  return nodePath(tree, id).find((n) => n.level === 'machine_type')?.id ?? null;
}

/**
 * Whether the listing's part group has sides (the side step is shown): the node's effective setting, or — when the
 * node isn't in the active tree any more (deactivated) — whether a side is already set (grandfathered, §7.3).
 */
export function hasSidesFor(
  tree: readonly CategoryNode[], listing: { categoryId: string | null; side: PartSide | null },
): boolean {
  const n = findNode(tree, listing.categoryId);
  if (n) return n.effectiveHasSides;
  return listing.side === 'left' || listing.side === 'right' || listing.side === 'pair';
}

function nodesAt(tree: readonly CategoryNode[], level: CatalogLevel, path: string[] = []): { node: CategoryNode; path: string[] }[] {
  const out: { node: CategoryNode; path: string[] }[] = [];
  for (const n of tree) {
    if (n.level === level) out.push({ node: n, path });
    else out.push(...nodesAt(n.children, level, [...path, n.name]));
  }
  return out;
}

const SEARCH_LIMIT = 40;

/**
 * Nodes of the kind's level whose path (ancestors + name) holds every word of `query`, case-insensitive; names that
 * start with the query first, then tree order. `path` is the breadcrumb above the node.
 */
export function searchCategories(
  tree: readonly CategoryNode[], kind: ListingKind, query: string,
): { node: CategoryNode; path: string[] }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const hits = nodesAt(tree, categoryLevelFor(kind)).filter(({ node, path }) => {
    const hay = [...path, node.name].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const starts = (h: { node: CategoryNode }) => (h.node.name.toLowerCase().startsWith(q) ? 0 : 1);
  return hits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => starts(a.h) - starts(b.h) || a.i - b.i)
    .slice(0, SEARCH_LIMIT)
    .map(({ h }) => h);
}

export const RECENT_CATEGORIES_MAX = 5;

/** The device's recent picks with `id` added: newest first, no repeats, at most 5. */
export function pushRecent(ids: readonly string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, RECENT_CATEGORIES_MAX);
}

/** Recent picks still in the active tree at the kind's level, in order. */
export function recentNodes(tree: readonly CategoryNode[], kind: ListingKind, ids: readonly string[]): CategoryNode[] {
  const level = categoryLevelFor(kind);
  return ids.map((id) => findNode(tree, id)).filter((n): n is CategoryNode => !!n && n.level === level);
}
