import { DISCOVERY_RADII_KM, type CategoryIcon, type DiscoveryRadiusKm, type HomeView, type ListingKind } from '@mpm/shared-types';

// Home (F4 + F5 spec §8.3, R15): the tiles row, where each tile goes, and the empty state. Pure, so the rules are
// tested without React; `screens/tabs/home.tsx` draws them.

/** The three kind shortcuts, always first and in this order (R15). */
export const HOME_KIND_TILES = ['part', 'machine', 'machine_rental'] as const satisfies readonly ListingKind[];

export type HomeTile =
  | { type: 'kind'; kind: ListingKind; count: number | null }
  | { type: 'category'; id: string; name: string; icon: CategoryIcon | null };

/** Kind tiles (Spare parts, Machinery, For rent) with their counts when known, then the root categories in admin order. */
export function homeTiles(view: Pick<HomeView, 'kindTiles' | 'rootCategories'> | null | undefined): HomeTile[] {
  const counts = new Map((view?.kindTiles ?? []).map((k) => [k.kind, k.count]));
  const kinds: HomeTile[] = HOME_KIND_TILES.map((kind) => ({ type: 'kind', kind, count: counts.get(kind) ?? null }));
  const roots: HomeTile[] = (view?.rootCategories ?? []).map((c) => ({ type: 'category', id: c.id, name: c.name, icon: c.icon }));
  return [...kinds, ...roots];
}

/**
 * Where a press goes. A kind tile opens search results with that kind (and no words); a category tile opens the
 * Search tab's Browse at that node. The Search screens read the radius from the shared origin store.
 */
export type HomeTarget =
  | { screen: 'SearchResults'; params: { filters: { kinds: ListingKind[] } } }
  | { screen: 'Main'; params: { screen: 'Search'; params: { browseNodeId?: string; focus?: boolean } } };

export function tileTarget(tile: HomeTile): HomeTarget {
  if (tile.type === 'kind') return { screen: 'SearchResults', params: { filters: { kinds: [tile.kind] } } };
  return { screen: 'Main', params: { screen: 'Search', params: { browseNodeId: tile.id } } };
}

/** "See all" under Top items near you: the same kinds (parts and machines for sale), no words (§7). */
export function seeAllTarget(): HomeTarget {
  return { screen: 'SearchResults', params: { filters: { kinds: ['part', 'machine'] } } };
}

/** The search bar: the Search tab with the box focused. */
export function searchBarTarget(): HomeTarget {
  return { screen: 'Main', params: { screen: 'Search', params: { focus: true } } };
}

/** The next radius out: 10 → 25 → 50 → 100 → 200 → All India (null). */
export function widerRadius(radiusKm: DiscoveryRadiusKm): DiscoveryRadiusKm | null {
  return DISCOVERY_RADII_KM.find((r) => r > radiusKm) ?? null;
}

export type HomeEmpty =
  /** Nothing within the radius: offer the next radius out (`null` = All India). */
  | { kind: 'radius'; km: DiscoveryRadiusKm; widenTo: DiscoveryRadiusKm | null }
  /** Nothing anywhere (or no place to measure from): the "Sell a part" prompt. */
  | { kind: 'none' };

/**
 * Home's empty state, or null when either section has cards. Uses the radius the server **applied** (`view.radiusKm`,
 * null when it searched All India, including when there was no origin), so the copy never names a radius that wasn't used.
 */
export function homeEmpty(view: Pick<HomeView, 'radiusKm' | 'topNearYou' | 'rentNearby'>): HomeEmpty | null {
  if (view.topNearYou.length > 0 || view.rentNearby.length > 0) return null;
  if (view.radiusKm === null) return { kind: 'none' };
  return { kind: 'radius', km: view.radiusKm, widenTo: widerRadius(view.radiusKm) };
}
