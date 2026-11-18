import type { CatalogLevel, CategoryNode } from '@mpm/shared-types';

/**
 * Nodes whose name contains `query` (case-insensitive), each with all its ancestors so it
 * stays reachable. A matching node keeps its whole subtree (searching a machine type shows
 * its part groups); a non-matching node keeps only its matching descendants, and is
 * dropped when it has none. A blank query returns `nodes` as is.
 */
export function filterTree(nodes: CategoryNode[], query: string): CategoryNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const walk = (list: CategoryNode[]): CategoryNode[] =>
    list.flatMap((n) => {
      if (n.name.toLowerCase().includes(q)) return [n];
      const children = walk(n.children);
      return children.length ? [{ ...n, children }] : [];
    });
  return walk(nodes);
}

export function findNode(nodes: CategoryNode[], id: string): CategoryNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** The list the node sits in (itself included), in display order; [] when not found. */
export function siblingsOf(nodes: CategoryNode[], id: string): CategoryNode[] {
  if (nodes.some((n) => n.id === id)) return nodes;
  for (const n of nodes) {
    const hit = siblingsOf(n.children, id);
    if (hit.length) return hit;
  }
  return [];
}

/** Category → … → the node itself; [] when not found. */
export function ancestorsOf(nodes: CategoryNode[], id: string): CategoryNode[] {
  for (const n of nodes) {
    if (n.id === id) return [n];
    const below = ancestorsOf(n.children, id);
    if (below.length) return [n, ...below];
  }
  return [];
}

export const LEVEL_LABELS: Record<CatalogLevel, string> = {
  machine_category: 'Category',
  machine_type: 'Machine type',
  part_group: 'Part group',
};

export const LEVEL_PLURALS: Record<CatalogLevel, string> = {
  machine_category: 'Categories',
  machine_type: 'Machine types',
  part_group: 'Part groups',
};

/** The level of a child of this level; null for part groups (they have no children). */
export function childLevel(level: CatalogLevel): CatalogLevel | null {
  if (level === 'machine_category') return 'machine_type';
  if (level === 'machine_type') return 'part_group';
  return null;
}

/** The level a node of this level can move under; null for categories (they never move). */
export function moveParentLevel(level: CatalogLevel): CatalogLevel | null {
  if (level === 'machine_type') return 'machine_category';
  if (level === 'part_group') return 'machine_type';
  return null;
}

export interface NodeChoice {
  id: string;
  /** The node's name after its ancestors' names, e.g. "Sewing › Lockstitch Machine". */
  label: string;
  isActive: boolean;
}

/** Every node of `level`, in tree order, labelled with its path of names. */
export function nodesAtLevel(nodes: CategoryNode[], level: CatalogLevel): NodeChoice[] {
  const out: NodeChoice[] = [];
  const walk = (list: CategoryNode[], names: string[], parentActive: boolean) => {
    for (const n of list) {
      const path = [...names, n.name];
      const active = parentActive && n.isActive;
      if (n.level === level) out.push({ id: n.id, label: path.join(' › '), isActive: active });
      else walk(n.children, path, active);
    }
  };
  walk(nodes, [], true);
  return out;
}

/** The machine types a model can belong to, labelled "Category › Machine type". */
export const machineTypeChoices = (nodes: CategoryNode[]): NodeChoice[] => nodesAtLevel(nodes, 'machine_type');
