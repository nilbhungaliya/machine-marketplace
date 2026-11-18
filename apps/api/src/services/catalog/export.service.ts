import type { CatalogLevel, CategoryNode, TemplateField } from '@mpm/shared-types';
import type { Db } from '../../db/index.js';
import { toCsv, type CsvCell } from '../../lib/csv.js';
import { listBrandsWithModels } from './brand-read.service.js';
import { getCategoryTree, getMasterData, loadFieldsFor } from './read.service.js';

export const EXPORT_SHEETS = ['tree', 'fields', 'brands-models', 'master-data'] as const;
export type ExportSheet = (typeof EXPORT_SHEETS)[number];

// Exports are for client review: inactive nodes, brands and models and retired fields/options are included and marked.

const yesNo = (value: boolean): string => (value ? 'Yes' : 'No');

const LEVEL_LABEL: Record<CatalogLevel, string> = {
  machine_category: 'Machine category',
  machine_type: 'Machine type',
  part_group: 'Part group',
};

/**
 * Depth-first in tree order, with the names of the node's ancestors (machine category first) and whether the node is
 * effectively active (it and every ancestor switched on).
 */
function* walk(
  nodes: CategoryNode[],
  ancestors: string[] = [],
  parentActive = true,
): Generator<{ node: CategoryNode; names: string[]; active: boolean }> {
  for (const node of nodes) {
    const names = [...ancestors, node.name];
    const active = parentActive && node.isActive;
    yield { node, names, active };
    yield* walk(node.children, names, active);
  }
}

async function treeSheet(db: Db): Promise<CsvCell[][]> {
  const tree = await getCategoryTree(db, { includeInactive: true });
  const rows: CsvCell[][] = [
    ['Machine category', 'Machine type', 'Part group', 'Path', 'Active', 'Active (own)', 'Has sides (own)', 'Has sides (effective)', 'Side convention (effective)'],
  ];
  // One row per leaf: every part group, plus any machine category or machine type with no children.
  for (const { node, names, active } of walk(tree)) {
    if (node.children.length > 0) continue;
    rows.push([
      names[0] ?? null,
      names[1] ?? null,
      names[2] ?? null,
      node.path,
      // Effective: a part group under a switched-off machine type or category is off too.
      yesNo(active),
      yesNo(node.isActive),
      // Blank: inherited from the parent.
      node.hasSides === null ? null : yesNo(node.hasSides),
      yesNo(node.effectiveHasSides),
      // Always resolved (own → inherited → default), printed even where the node has no sides.
      node.effectiveSideConvention,
    ]);
  }
  return rows;
}

function optionsCell(field: TemplateField): string {
  return field.options.map((o) => `${o.key}=${o.label}${o.status === 'retired' ? ' (retired)' : ''}`).join('; ');
}

async function fieldsSheet(db: Db): Promise<CsvCell[][]> {
  const tree = await getCategoryTree(db, { includeInactive: true });
  const nodes = [...walk(tree)];
  const fields = await loadFieldsFor(db, nodes.map((n) => n.node.id));
  const byNode = new Map<string, TemplateField[]>();
  for (const f of fields) byNode.set(f.categoryId, [...(byNode.get(f.categoryId) ?? []), f]);

  const rows: CsvCell[][] = [
    [
      'Level', 'Category path', 'Field key', 'Label', 'Type', 'Applies to', 'Unit', 'Min', 'Max', 'Required', 'Filterable',
      'Highlight rank', 'Status', 'Options',
    ],
  ];
  // Fields where they are defined (not repeated on every node that inherits them).
  for (const { node, names } of nodes) {
    for (const f of byNode.get(node.id) ?? []) {
      rows.push([
        LEVEL_LABEL[node.level],
        names.join(' > '),
        f.key,
        f.label,
        f.type,
        f.appliesTo,
        f.unit,
        f.min,
        f.max,
        yesNo(f.required),
        yesNo(f.filterable),
        f.highlightRank,
        f.status,
        optionsCell(f),
      ]);
    }
  }
  return rows;
}

async function brandsModelsSheet(db: Db): Promise<CsvCell[][]> {
  const [tree, brandList] = await Promise.all([getCategoryTree(db, { includeInactive: true }), listBrandsWithModels(db)]);
  const typePath = new Map<string, string>();
  for (const { node, names } of walk(tree)) if (node.level === 'machine_type') typePath.set(node.id, names.join(' > '));

  const rows: CsvCell[][] = [
    [
      'Brand', 'Brand key', 'Makes machines', 'Makes parts', 'Brand active', 'Brand needs review', 'Model', 'Model key',
      'Machine type path', 'Model active', 'Model needs review',
    ],
  ];
  for (const b of brandList) {
    const brandCells: CsvCell[] = [b.name, b.key, yesNo(b.makesMachines), yesNo(b.makesParts), yesNo(b.isActive), yesNo(b.needsReview)];
    // A brand without models still gets a row, so the client reviews it too.
    if (b.models.length === 0) rows.push([...brandCells, null, null, null, null, null]);
    for (const m of b.models) {
      rows.push([...brandCells, m.name, m.key, typePath.get(m.machineTypeId) ?? null, yesNo(m.isActive), yesNo(m.needsReview)]);
    }
  }
  return rows;
}

async function masterDataSheet(db: Db): Promise<CsvCell[][]> {
  const master = await getMasterData(db, { includeInactive: true });
  const rows: CsvCell[][] = [['List', 'Key', 'Label', 'Description', 'Decimals', 'Active']];
  for (const u of master.units) rows.push(['Unit', u.key, u.label, null, u.decimals, yesNo(u.isActive)]);
  for (const c of master.conditions) rows.push(['Condition', c.key, c.label, c.description, null, yesNo(c.isActive)]);
  return rows;
}

const SHEETS: Record<ExportSheet, (db: Db) => Promise<CsvCell[][]>> = {
  tree: treeSheet,
  fields: fieldsSheet,
  'brands-models': brandsModelsSheet,
  'master-data': masterDataSheet,
};

/** One sheet of the catalogue as CSV (UTF-8 with BOM). */
export async function exportSheet(db: Db, sheet: ExportSheet): Promise<string> {
  return toCsv(await SHEETS[sheet](db));
}
