import { and, asc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  CategoryIcon,
  CategoryNode,
  EffectiveTemplate,
  FieldAppliesTo,
  FieldOption,
  MasterData,
  TemplateField,
  TemplateKind,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { categories, conditions, templateFieldOptions, templateFields, units } from '../../db/schema.js';
import { NotFoundError } from '../../lib/errors.js';
import { resolveSides } from './side-settings.js';

// The catalogue is small (hundreds of nodes): load whole tables and assemble in memory.

type CategoryRow = typeof categories.$inferSelect;
type FieldRow = typeof templateFields.$inferSelect;
type OptionRow = typeof templateFieldOptions.$inferSelect;

/** pg returns `numeric` as a string. */
function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** Row → API node (children empty, effective sides filled in by the caller). Exported for the admin service. */
export function toNode(row: CategoryRow, parent: { effectiveHasSides: boolean; effectiveSideConvention: string } | null = null): CategoryNode {
  return {
    id: row.id,
    parentId: row.parentId,
    level: row.level,
    name: row.name,
    slug: row.slug,
    path: row.path,
    icon: row.icon as CategoryIcon | null,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    hasSides: row.hasSides,
    sideConvention: row.sideConvention,
    ...resolveSides(row, parent),
    children: [],
  };
}

function bySortOrder<T extends { sortOrder: number; name?: string }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder || (a.name ?? '').localeCompare(b.name ?? '');
}

/**
 * Machine categories → machine types → part groups, each level sorted by sortOrder, effective side settings filled top-down.
 * Without includeInactive, an inactive node and its whole subtree are left out.
 */
export async function getCategoryTree(db: Db, opts: { includeInactive: boolean }): Promise<CategoryNode[]> {
  const rows = await db.select().from(categories);
  const byParent = new Map<string | null, CategoryRow[]>();
  for (const row of rows) {
    if (!opts.includeInactive && !row.isActive) continue;
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }

  const build = (parentId: string | null, parent: CategoryNode | null): CategoryNode[] =>
    (byParent.get(parentId) ?? [])
      .map((row) => {
        const node = toNode(row, parent);
        node.children = build(row.id, node);
        return node;
      })
      .sort(bySortOrder);

  return build(null, null);
}

/** Exported for the admin field service. */
export function toOption(row: OptionRow): FieldOption {
  return { id: row.id, key: row.key, label: row.label, sortOrder: row.sortOrder, status: row.status };
}

/** Exported for the admin field service. */
export function toField(row: FieldRow, options: FieldOption[]): TemplateField {
  return {
    id: row.id,
    categoryId: row.categoryId,
    key: row.key,
    label: row.label,
    helpText: row.helpText,
    type: row.type,
    appliesTo: row.appliesTo,
    unit: row.unit,
    min: toNumber(row.min),
    max: toNumber(row.max),
    required: row.required,
    filterable: row.filterable,
    highlightRank: row.highlightRank,
    sortOrder: row.sortOrder,
    status: row.status,
    options,
  };
}

/** Fields (with options, sorted) of the given nodes, all statuses. Exported for admin reads. */
export async function loadFieldsFor(db: Db | Tx, categoryIds: string[]): Promise<TemplateField[]> {
  if (categoryIds.length === 0) return [];
  const fieldRows = await db
    .select()
    .from(templateFields)
    .where(inArray(templateFields.categoryId, categoryIds))
    .orderBy(asc(templateFields.sortOrder), asc(templateFields.createdAt));
  const optionRows = fieldRows.length
    ? await db
        .select()
        .from(templateFieldOptions)
        .where(inArray(templateFieldOptions.fieldId, fieldRows.map((f) => f.id)))
        .orderBy(asc(templateFieldOptions.sortOrder), asc(templateFieldOptions.createdAt))
    : [];

  const optionsByField = new Map<string, FieldOption[]>();
  for (const o of optionRows) {
    const list = optionsByField.get(o.fieldId) ?? [];
    list.push(toOption(o));
    optionsByField.set(o.fieldId, list);
  }
  return fieldRows.map((f) => toField(f, optionsByField.get(f.id) ?? []));
}

/**
 * Effective template of a node for one listing kind. `part` needs a part group (category, machine type and part group fields that
 * apply to parts); `machine` needs a machine type (category and machine type fields that apply to machines). Each group by sortOrder.
 * Wrong level or unknown id → NotFoundError; so is the node or an ancestor being inactive, unless `allowInactive`, which defaults
 * to includeRetired. Without includeRetired, retired fields and options are dropped.
 */
export async function loadTemplate(
  db: Db | Tx,
  nodeId: string,
  kind: TemplateKind,
  opts: { includeRetired: boolean; allowInactive?: boolean },
): Promise<EffectiveTemplate> {
  const notFound = () => new NotFoundError(kind === 'part' ? 'Part group' : 'Machine type');
  const type = alias(categories, 'machine_type_node');
  const category = alias(categories, 'category_node');

  let chain: CategoryRow[];
  if (kind === 'part') {
    const [row] = await db
      .select({ group: categories, type, category })
      .from(categories)
      .innerJoin(type, eq(type.id, categories.parentId))
      .innerJoin(category, eq(category.id, type.parentId))
      .where(and(eq(categories.id, nodeId), eq(categories.level, 'part_group')));
    if (!row) throw notFound();
    chain = [row.category, row.type, row.group];
  } else {
    const [row] = await db
      .select({ type: categories, category })
      .from(categories)
      .innerJoin(category, eq(category.id, categories.parentId))
      .where(and(eq(categories.id, nodeId), eq(categories.level, 'machine_type')));
    if (!row) throw notFound();
    chain = [row.category, row.type];
  }
  const allowInactive = opts.allowInactive ?? opts.includeRetired;
  if (!allowInactive && chain.some((n) => !n.isActive)) throw notFound();

  const all = await loadFieldsFor(db, chain.map((n) => n.id));
  const level = new Map(chain.map((n, i) => [n.id, i]));
  const applies: FieldAppliesTo[] = kind === 'part' ? ['parts', 'both'] : ['machines', 'both'];
  // Stable sort keeps loadFieldsFor's (sortOrder, createdAt) order within each level.
  const ordered = all
    .filter((f) => level.has(f.categoryId) && applies.includes(f.appliesTo))
    .sort((a, b) => level.get(a.categoryId)! - level.get(b.categoryId)!);

  const fields = opts.includeRetired
    ? ordered
    : ordered
        .filter((f) => f.status === 'active')
        .map((f) => ({ ...f, options: f.options.filter((o) => o.status === 'active') }));

  return { nodeId, kind, fields };
}

/** Units and conditions by sortOrder. Without includeInactive, inactive rows are left out. */
export async function getMasterData(db: Db, opts: { includeInactive: boolean }): Promise<MasterData> {
  const [unitRows, conditionRows] = await Promise.all([
    db.select().from(units).orderBy(asc(units.sortOrder), asc(units.createdAt)),
    db.select().from(conditions).orderBy(asc(conditions.sortOrder), asc(conditions.createdAt)),
  ]);
  const visible = (active: boolean) => opts.includeInactive || active;

  return {
    units: unitRows
      .filter((u) => visible(u.isActive))
      .map((u) => ({
        id: u.id,
        key: u.key,
        label: u.label,
        decimals: u.decimals,
        sortOrder: u.sortOrder,
        isActive: u.isActive,
        isMachineUnit: u.isMachineUnit,
      })),
    conditions: conditionRows
      .filter((c) => visible(c.isActive))
      .map((c) => ({
        id: c.id,
        key: c.key,
        label: c.label,
        description: c.description,
        sortOrder: c.sortOrder,
        isActive: c.isActive,
      })),
  };
}
