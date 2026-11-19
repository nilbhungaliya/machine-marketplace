import type { Redis } from 'ioredis';
import { eq, isNull, max, sql } from 'drizzle-orm';
import type { AdminCategoryDetail, CategoryIcon, CategoryNode, CatalogLevel } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { categories, machineModels, templateFields } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isForeignKeyViolation, isUniqueViolation } from '../../lib/pg-errors.js';
import { slugify } from '../../lib/slug.js';
import { writeAudit } from '../audit.service.js';
import { listingsUseNodes } from './listing-uses.js';
import { lockCatalogRoots } from './locks.js';
import { loadFieldsFor, toNode } from './read.service.js';
import { assertExactSet } from './reorder.js';
import { resolveSides, type EffectiveSides } from './side-settings.js';
import { assertNoClash } from './template-clash.js';
import { afterCatalogCommit, queueSearchRefresh } from '../discovery/refresh-jobs.js';

// Admin writes on the category tree. Each function runs in one transaction and writes one audit_log row with it.
// Everything that reads paths or templates takes the root lock first (locks.ts), then reads.

type CategoryRow = typeof categories.$inferSelect;

const CHILD_LEVEL: Record<CatalogLevel, CatalogLevel | null> = {
  machine_category: 'machine_type',
  machine_type: 'part_group',
  part_group: null,
};
/** The level a node of this level may be moved under. */
const MOVE_PARENT_LEVEL: Partial<Record<CatalogLevel, CatalogLevel>> = {
  machine_type: 'machine_category',
  part_group: 'machine_type',
};

const PATH_CONSTRAINT = 'categories_path_unique';
const SLUG_MAX = 80;

async function findRow(db: Db | Tx, id: string): Promise<CategoryRow | undefined> {
  const [row] = await db.select().from(categories).where(eq(categories.id, id));
  return row;
}

async function getRow(db: Db | Tx, id: string): Promise<CategoryRow> {
  const row = await findRow(db, id);
  if (!row) throw new NotFoundError('Category');
  return row;
}

/** The ancestors of a row, root first. */
async function ancestorsOf(db: Db | Tx, row: CategoryRow): Promise<CategoryRow[]> {
  const chain: CategoryRow[] = [];
  for (let parentId = row.parentId; parentId !== null; ) {
    const parent = await getRow(db, parentId);
    chain.unshift(parent);
    parentId = parent.parentId;
  }
  return chain;
}

/** Row to API node with its effective side settings resolved down the ancestor chain (children left empty). */
async function nodeOf(db: Db | Tx, row: CategoryRow): Promise<CategoryNode> {
  let parent: EffectiveSides | null = null;
  for (const a of await ancestorsOf(db, row)) parent = resolveSides(a, parent);
  return toNode(row, parent);
}

/** The audit snapshot of a node: the API shape without children. */
async function snapshot(db: Db | Tx, row: CategoryRow): Promise<Omit<CategoryNode, 'children'>> {
  const { children: _children, ...rest } = await nodeOf(db, row);
  return rest;
}

/** Path is unique, so a clash means a sibling already uses the slug. */
async function mapSlugTaken<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isUniqueViolation(err, PATH_CONSTRAINT)) {
      throw new ConflictError('Another category under the same parent already uses this slug', 'SLUG_TAKEN');
    }
    throw err;
  }
}

function childrenOf(parentId: string | null) {
  return parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId);
}

async function nextSortOrder(tx: Tx, parentId: string | null): Promise<number> {
  const [r] = await tx.select({ value: max(categories.sortOrder) }).from(categories).where(childrenOf(parentId));
  return r?.value === null || r?.value === undefined ? 0 : r.value + 1;
}

/** Ids of the node at `path` and of all its descendants. */
async function subtreeIds(tx: Tx, path: string, opts: { lock?: boolean } = {}): Promise<string[]> {
  const query = tx
    .select({ id: categories.id })
    .from(categories)
    .where(sql`${categories.path} = ${path}::text OR starts_with(${categories.path}, ${path}::text || '/')`);
  const rows = opts.lock ? await query.for('update') : await query;
  return rows.map((r) => r.id);
}

/**
 * Rewrites the path of the node at `oldPath` and of every descendant (prefix match with
 * `starts_with`, as subtreeIds does, so no pattern characters are ever interpreted).
 */
async function rewritePaths(tx: Tx, oldPath: string, newPath: string): Promise<void> {
  await tx.execute(sql`
    UPDATE categories
    SET path = ${newPath}::text || substr(path, length(${oldPath}::text) + 1), updated_at = now()
    WHERE path = ${oldPath}::text OR starts_with(path, ${oldPath}::text || '/')
  `);
}

/** Blank becomes null; otherwise trimmed. */
function cleanConvention(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  return value.trim() === '' ? null : value.trim();
}

function iconInvalid(): ValidationError {
  return new ValidationError('Only machine categories have an icon', undefined, 'FIELD_INVALID');
}

export interface CreateCategoryInput {
  parentId: string | null;
  name: string;
  slug?: string;
  icon?: CategoryIcon;
  hasSides?: boolean | null;
  sideConvention?: string | null;
}

/** Level comes from the parent: none, machine category, machine type, part group. */
export async function createCategory(db: Db, adminId: string, input: CreateCategoryInput, redis?: Redis | null): Promise<CategoryNode> {
  const result = await mapSlugTaken(() =>
    db.transaction(async (tx) => {
      // A parent that moves or is renamed while we insert would leave our path stale.
      if (input.parentId !== null) await lockCatalogRoots(tx, [input.parentId]);
      let parent: CategoryRow | undefined;
      if (input.parentId !== null) {
        parent = await findRow(tx, input.parentId);
        if (!parent) throw new ValidationError('Parent category not found', undefined, 'INVALID_PARENT');
      }
      const level = parent ? CHILD_LEVEL[parent.level] : 'machine_category';
      if (!level) throw new ValidationError('A part group cannot have children', undefined, 'INVALID_PARENT');
      if (input.icon !== undefined && level !== 'machine_category') throw iconInvalid();

      const slug = input.slug ?? slugify(input.name);
      if (!slug) throw new ValidationError('The name gives an empty slug; pass a slug');
      if (slug.length > SLUG_MAX) throw new ValidationError(`Slug is longer than ${SLUG_MAX} characters; pass a shorter slug`);

      const [row] = await tx
        .insert(categories)
        .values({
          parentId: parent?.id ?? null,
          level,
          name: input.name,
          slug,
          path: parent ? `${parent.path}/${slug}` : slug,
          icon: input.icon ?? null,
          hasSides: input.hasSides ?? null,
          sideConvention: cleanConvention(input.sideConvention) ?? null,
          sortOrder: await nextSortOrder(tx, parent?.id ?? null),
        })
        .returning();

      const after = await snapshot(tx, row!);
      await writeAudit(tx, { adminId, action: 'category.create', entityType: 'category', entityId: row!.id, before: null, after });
      return { ...after, children: [] };
    }),
  );
  await afterCatalogCommit(redis);
  return result;
}

export interface UpdateCategoryPatch {
  name?: string;
  slug?: string;
  icon?: CategoryIcon | null;
  isActive?: boolean;
  hasSides?: boolean | null;
  sideConvention?: string | null;
}

/** A slug change rewrites the path of the node and all its descendants. */
export async function updateCategory(db: Db, adminId: string, id: string, patch: UpdateCategoryPatch, redis?: Redis | null): Promise<CategoryNode> {
  const result = await mapSlugTaken(() =>
    db.transaction(async (tx) => {
      // A slug change works from this node's and its parent's paths: read them after the lock.
      if (patch.slug !== undefined) await lockCatalogRoots(tx, [id]);
      const before = await getRow(tx, id);

      if (patch.icon !== undefined && patch.icon !== null && before.level !== 'machine_category') throw iconInvalid();

      await tx
        .update(categories)
        .set({
          name: patch.name,
          slug: patch.slug,
          icon: patch.icon,
          isActive: patch.isActive,
          hasSides: patch.hasSides,
          sideConvention: cleanConvention(patch.sideConvention),
          updatedAt: new Date(),
        })
        .where(eq(categories.id, id));

      if (patch.slug !== undefined && patch.slug !== before.slug) {
        const parent = before.parentId ? await getRow(tx, before.parentId) : undefined;
        await rewritePaths(tx, before.path, parent ? `${parent.path}/${patch.slug}` : patch.slug);
      }
      // F4 + F5 §5.2: a rename changes the category path names in listings' search text (rebuilt in the background).
      if (patch.name !== undefined && patch.name !== before.name) await queueSearchRefresh(tx, 'category', id, adminId);

      const after = await getRow(tx, id);
      const node = await nodeOf(tx, after);
      await writeAudit(tx, {
        adminId,
        action: 'category.update',
        entityType: 'category',
        entityId: id,
        before: await snapshot(tx, before),
        after: await snapshot(tx, after),
      });
      return node;
    }),
  );
  await afterCatalogCommit(redis);
  return result;
}

function moveNotAllowed(message: string): ValidationError {
  return new ValidationError(message, undefined, 'MOVE_NOT_ALLOWED');
}

/**
 * Moves a machine type to another machine category, or a part group to another machine type; a machine category never
 * moves. The node goes last among its new siblings and takes its new parent's effective side settings and inherited
 * fields. Refused with KEY_TAKEN / RANK_TAKEN when a field in the moved subtree clashes with one on the destination's
 * ancestor chain.
 */
export async function moveCategory(db: Db, adminId: string, id: string, newParentId: string, redis?: Redis | null): Promise<CategoryNode> {
  const result = await mapSlugTaken(() =>
    db.transaction(async (tx) => {
      // Before every read below: the clash check and the new paths both depend on them.
      await lockCatalogRoots(tx, [id, newParentId]);
      const before = await getRow(tx, id);
      const wantedParentLevel = MOVE_PARENT_LEVEL[before.level];
      if (!wantedParentLevel) throw moveNotAllowed('A machine category cannot be moved');
      const target = await findRow(tx, newParentId);
      if (!target || target.level !== wantedParentLevel) {
        throw moveNotAllowed(
          wantedParentLevel === 'machine_category' ? 'A machine type moves under a machine category' : 'A part group moves under a machine type',
        );
      }
      if (target.id === before.parentId) return nodeOf(tx, before);
      // M5 (F2 spec §16): refused while any listing (drafts too) sits in the subtree. The subtree rows are locked first,
      // so a listing write referencing one of them waits for this transaction.
      const movedIds = await subtreeIds(tx, before.path, { lock: true });
      if (await listingsUseNodes(tx, movedIds)) {
        throw moveNotAllowed('Listings use this node or a node under it; it cannot be moved');
      }

      // Keys (any status) and active highlight ranks stay unique across the new effective templates.
      const ancestorIds = [...(await ancestorsOf(tx, target)).map((a) => a.id), target.id];
      await assertNoClash(tx, { ancestorIds, subtreeIds: movedIds });

      await tx
        .update(categories)
        .set({ parentId: target.id, sortOrder: await nextSortOrder(tx, target.id), updatedAt: new Date() })
        .where(eq(categories.id, id));
      await rewritePaths(tx, before.path, `${target.path}/${before.slug}`);
      await queueSearchRefresh(tx, 'category', id, adminId);

      const after = await getRow(tx, id);
      const node = await nodeOf(tx, after);
      await writeAudit(tx, {
        adminId,
        action: 'category.move',
        entityType: 'category',
        entityId: id,
        before: await snapshot(tx, before),
        after: await snapshot(tx, after),
      });
      return node;
    }),
  );
  await afterCatalogCommit(redis);
  return result;
}

/**
 * Sets sortOrder = index. `orderedIds` must be exactly the current children of `parentId`
 * (null = machine categories); anything else means the admin's view is stale.
 */
export async function reorderSiblings(db: Db, adminId: string, parentId: string | null, orderedIds: string[], redis?: Redis | null): Promise<void> {
  await db.transaction(async (tx) => {
    if (parentId !== null) await getRow(tx, parentId);
    const siblings = await tx
      .select({ id: categories.id, sortOrder: categories.sortOrder })
      .from(categories)
      .where(childrenOf(parentId))
      .orderBy(categories.sortOrder, categories.name);

    assertExactSet(siblings, orderedIds, 'categories');

    for (const [index, oid] of orderedIds.entries()) {
      await tx.update(categories).set({ sortOrder: index, updatedAt: new Date() }).where(eq(categories.id, oid));
    }

    await writeAudit(tx, {
      adminId,
      action: 'category.reorder',
      entityType: 'category',
      entityId: parentId,
      before: siblings.map((s) => s.id),
      after: orderedIds,
    });
  });
  await afterCatalogCommit(redis);
}

/** Deletes a node only when nothing references it; otherwise the admin deactivates it instead. */
export async function deleteCategory(db: Db, adminId: string, id: string, redis?: Redis | null): Promise<void> {
  await db.transaction(async (tx) => {
    await lockCatalogRoots(tx, [id]);
    const row = await getRow(tx, id);
    const exists = async (query: Promise<unknown[]>) => (await query).length > 0;
    const uses: string[] = [];

    if (await exists(tx.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id)).limit(1))) uses.push('children');
    if (await exists(tx.select({ id: templateFields.id }).from(templateFields).where(eq(templateFields.categoryId, id)).limit(1))) {
      uses.push('template_fields');
    }
    if (row.level === 'machine_type') {
      if (await exists(tx.select({ id: machineModels.id }).from(machineModels).where(eq(machineModels.machineTypeId, id)).limit(1))) {
        uses.push('machine_models');
      }
    }
    // M5 (F2 spec §16): any listing in the subtree, drafts included.
    if (await listingsUseNodes(tx, await subtreeIds(tx, row.path, { lock: true }))) uses.push('listings');
    if (uses.length) {
      throw new ConflictError(`Category is in use (${uses.join(', ')}); deactivate it instead`, 'NODE_IN_USE', { uses });
    }

    const before = await snapshot(tx, row);
    try {
      await tx.delete(categories).where(eq(categories.id, id));
    } catch (err) {
      // A reference committed after the checks above.
      if (isForeignKeyViolation(err)) throw new ConflictError('Category is in use; deactivate it instead', 'NODE_IN_USE');
      throw err;
    }
    await queueSearchRefresh(tx, 'category', id, adminId);
    await writeAudit(tx, { adminId, action: 'category.delete', entityType: 'category', entityId: id, before, after: null });
  });
  await afterCatalogCommit(redis);
}

/** A node with its own fields and its ancestors' fields (root first), every status, with options. */
export async function getAdminCategoryDetail(db: Db, id: string): Promise<AdminCategoryDetail> {
  const row = await getRow(db, id);
  const ancestors = await ancestorsOf(db, row);

  const [ownFields, inherited] = await Promise.all([loadFieldsFor(db, [id]), loadFieldsFor(db, ancestors.map((a) => a.id))]);
  const depth = new Map(ancestors.map((a, i) => [a.id, i]));
  // Stable sort keeps loadFieldsFor's (sortOrder, createdAt) order within each level.
  const inheritedFields = [...inherited].sort((a, b) => depth.get(a.categoryId)! - depth.get(b.categoryId)!);

  return { node: await nodeOf(db, row), ownFields, inheritedFields };
}
