import { asc, eq, max } from 'drizzle-orm';
import {
  CATALOG_KEY_REGEX,
  MAX_HIGHLIGHT_RANK,
  type CatalogStatus,
  type FieldAppliesTo,
  type FieldOption,
  type FieldType,
  type TemplateField,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { categories, templateFieldOptions, templateFields } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { writeAudit } from '../audit.service.js';
import { lockCatalogRoots } from './locks.js';
import { toField, toOption } from './read.service.js';
import { assertExactSet } from './reorder.js';
import { assertClaimFree, templateRelatedIds, type FieldClaim } from './template-clash.js';

// Admin writes on template fields and their options (spec §5). Fields and options are never deleted, only retired;
// key, type and appliesTo never change. Each function runs in one transaction and writes one audit_log row with it.
// A write that can clash takes the root lock (locks.ts) before it reads the node's path or any template.

type CategoryRow = typeof categories.$inferSelect;
type FieldRow = typeof templateFields.$inferSelect;
type OptionRow = typeof templateFieldOptions.$inferSelect;

const FIELD_KEY_CONSTRAINT = 'template_fields_category_key_uq';
const OPTION_KEY_CONSTRAINT = 'template_field_options_field_key_uq';
const SELECT_TYPES: readonly FieldType[] = ['single_select', 'multi_select'];

function fieldInvalid(message: string): ValidationError {
  return new ValidationError(message, undefined, 'FIELD_INVALID');
}

function keyTaken(what: 'field' | 'option'): ConflictError {
  return new ConflictError(
    what === 'field' ? 'This key is already used in a template this field belongs to' : 'This field already has an option with this key',
    'KEY_TAKEN',
  );
}

/** The unique indexes are the race backstop for a key on the same node / field. */
async function mapKeyTaken<T>(what: 'field' | 'option', work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isUniqueViolation(err, what === 'field' ? FIELD_KEY_CONSTRAINT : OPTION_KEY_CONSTRAINT)) throw keyTaken(what);
    throw err;
  }
}

/** The audit snapshot of a field: the API shape without options. */
function fieldSnapshot(row: FieldRow): Omit<TemplateField, 'options'> {
  const { options: _options, ...rest } = toField(row, []);
  return rest;
}

function optionSnapshot(row: OptionRow): FieldOption & { fieldId: string } {
  return { ...toOption(row), fieldId: row.fieldId };
}

async function getCategory(db: Db | Tx, id: string): Promise<CategoryRow> {
  const [row] = await db.select().from(categories).where(eq(categories.id, id));
  if (!row) throw new NotFoundError('Category');
  return row;
}

async function getFieldRow(db: Db | Tx, id: string): Promise<FieldRow> {
  const [row] = await db.select().from(templateFields).where(eq(templateFields.id, id));
  if (!row) throw new NotFoundError('Field');
  return row;
}

async function getOptionRow(db: Db | Tx, id: string): Promise<OptionRow> {
  const [row] = await db.select().from(templateFieldOptions).where(eq(templateFieldOptions.id, id));
  if (!row) throw new NotFoundError('Option');
  return row;
}

async function loadOptions(db: Db | Tx, fieldId: string): Promise<FieldOption[]> {
  const rows = await db
    .select()
    .from(templateFieldOptions)
    .where(eq(templateFieldOptions.fieldId, fieldId))
    .orderBy(asc(templateFieldOptions.sortOrder), asc(templateFieldOptions.createdAt));
  return rows.map(toOption);
}

function checkKey(key: string): void {
  if (!CATALOG_KEY_REGEX.test(key)) throw fieldInvalid('Key must be snake_case: a letter, then 1–39 of a-z, 0-9, _');
}

/** Rules on the field's final values (after a patch is merged). */
function checkFieldValues(v: { type: FieldType; unit: string | null; min: number | null; max: number | null; highlightRank: number | null }): void {
  if (v.type !== 'number' && (v.unit !== null || v.min !== null || v.max !== null)) {
    throw fieldInvalid('Unit, min and max apply only to number fields');
  }
  if (v.min !== null && v.max !== null && v.min > v.max) throw fieldInvalid('Min must not be greater than max');
  if (v.highlightRank !== null && (!Number.isInteger(v.highlightRank) || v.highlightRank < 1 || v.highlightRank > MAX_HIGHLIGHT_RANK)) {
    throw fieldInvalid(`Highlight rank must be 1–${MAX_HIGHLIGHT_RANK} or empty`);
  }
}

const numericOrNull = (n: number | null | undefined) => (n === undefined ? undefined : n === null ? null : String(n));
const storedNumber = (s: string | null) => (s === null ? null : Number(s));

/**
 * Locks the root machine category of `categoryId` and returns the node read after the lock, so its path (and every
 * template read from it) can't change under the clash check that follows.
 */
async function lockNode(tx: Tx, categoryId: string): Promise<CategoryRow> {
  await lockCatalogRoots(tx, [categoryId]);
  return getCategory(tx, categoryId);
}

/**
 * Throws KEY_TAKEN / RANK_TAKEN when the claim clashes with any effective template the node's fields take part in:
 * fields on the node itself, its ancestors and its descendants (keys of any status and appliesTo; active ranks whose
 * appliesTo overlap). Call after lockNode.
 */
async function assertFieldFree(tx: Tx, node: CategoryRow, claim: FieldClaim, check: { key: boolean }): Promise<void> {
  await assertClaimFree(tx, await templateRelatedIds(tx, node.path), claim, check);
}

export interface CreateFieldInput {
  key: string;
  label: string;
  helpText?: string | null;
  type: FieldType;
  appliesTo?: FieldAppliesTo;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
  required?: boolean;
  filterable?: boolean;
  highlightRank?: number | null;
}

/** Adds a field to any node (machine category, machine type or part group); it goes last among the node's fields. */
export async function createField(db: Db, adminId: string, categoryId: string, input: CreateFieldInput): Promise<TemplateField> {
  checkKey(input.key);
  const values = {
    type: input.type,
    appliesTo: input.appliesTo ?? 'both',
    unit: input.unit ?? null,
    min: input.min ?? null,
    max: input.max ?? null,
    highlightRank: input.highlightRank ?? null,
  };
  checkFieldValues(values);

  return mapKeyTaken('field', () =>
    db.transaction(async (tx) => {
      const node = await lockNode(tx, categoryId);
      // A part group's fields reach part templates only: a machines-only field there could never show.
      if (node.level === 'part_group' && values.appliesTo === 'machines') {
        throw fieldInvalid('A part group field applies to parts or both, never machines only');
      }
      await assertFieldFree(
        tx,
        node,
        { key: input.key, status: 'active', appliesTo: values.appliesTo, highlightRank: values.highlightRank },
        { key: true },
      );

      const [last] = await tx
        .select({ value: max(templateFields.sortOrder) })
        .from(templateFields)
        .where(eq(templateFields.categoryId, categoryId));
      const sortOrder = last?.value === null || last?.value === undefined ? 0 : last.value + 1;

      const [row] = await tx
        .insert(templateFields)
        .values({
          categoryId,
          key: input.key,
          label: input.label,
          helpText: input.helpText ?? null,
          type: input.type,
          appliesTo: values.appliesTo,
          unit: values.unit,
          min: numericOrNull(values.min),
          max: numericOrNull(values.max),
          required: input.required ?? false,
          filterable: input.filterable ?? false,
          highlightRank: values.highlightRank,
          sortOrder,
        })
        .returning();

      await writeAudit(tx, { adminId, action: 'field.create', entityType: 'field', entityId: row!.id, before: null, after: fieldSnapshot(row!) });
      return toField(row!, []);
    }),
  );
}

export interface UpdateFieldPatch {
  label?: string;
  helpText?: string | null;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
  required?: boolean;
  filterable?: boolean;
  highlightRank?: number | null;
  status?: CatalogStatus;
}

/** Key, type and appliesTo never change. The rank is re-checked when it changes or the field is reactivated. */
export async function updateField(db: Db, adminId: string, fieldId: string, patch: UpdateFieldPatch): Promise<TemplateField> {
  return db.transaction(async (tx) => {
    // A field never changes node, so its categoryId is safe to read before the lock; the rest is read after it.
    const { categoryId } = await getFieldRow(tx, fieldId);
    const node = await lockNode(tx, categoryId);
    const before = await getFieldRow(tx, fieldId);

    const merged = {
      type: before.type,
      unit: patch.unit !== undefined ? patch.unit : before.unit,
      min: patch.min !== undefined ? patch.min : storedNumber(before.min),
      max: patch.max !== undefined ? patch.max : storedNumber(before.max),
      highlightRank: patch.highlightRank !== undefined ? patch.highlightRank : before.highlightRank,
    };
    checkFieldValues(merged);

    const status = patch.status ?? before.status;
    const rankNowActive =
      status === 'active' && merged.highlightRank !== null && (merged.highlightRank !== before.highlightRank || before.status === 'retired');
    if (rankNowActive) {
      await assertFieldFree(
        tx,
        node,
        { id: before.id, key: before.key, status: 'active', appliesTo: before.appliesTo, highlightRank: merged.highlightRank },
        { key: false },
      );
    }

    const [after] = await tx
      .update(templateFields)
      .set({
        label: patch.label,
        helpText: patch.helpText,
        unit: patch.unit,
        min: numericOrNull(patch.min),
        max: numericOrNull(patch.max),
        required: patch.required,
        filterable: patch.filterable,
        highlightRank: patch.highlightRank,
        status: patch.status,
        updatedAt: new Date(),
      })
      .where(eq(templateFields.id, fieldId))
      .returning();

    await writeAudit(tx, {
      adminId,
      action: 'field.update',
      entityType: 'field',
      entityId: fieldId,
      before: fieldSnapshot(before),
      after: fieldSnapshot(after!),
    });
    return toField(after!, await loadOptions(tx, fieldId));
  });
}

/** `orderedIds` must be exactly the node's own fields (every status); anything else means a stale view. */
export async function reorderFields(db: Db, adminId: string, categoryId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await getCategory(tx, categoryId);
    const current = await tx
      .select({ id: templateFields.id })
      .from(templateFields)
      .where(eq(templateFields.categoryId, categoryId))
      .orderBy(asc(templateFields.sortOrder), asc(templateFields.createdAt));
    assertExactSet(current, orderedIds, 'fields');

    for (const [index, id] of orderedIds.entries()) {
      await tx.update(templateFields).set({ sortOrder: index, updatedAt: new Date() }).where(eq(templateFields.id, id));
    }
    await writeAudit(tx, {
      adminId,
      action: 'field.reorder',
      entityType: 'category',
      entityId: categoryId,
      before: current.map((r) => r.id),
      after: orderedIds,
    });
  });
}

export interface CreateOptionInput {
  key: string;
  label: string;
}

/** Only select fields have options; the new option goes last. Option keys are unique per field (retired ones too). */
export async function createOption(db: Db, adminId: string, fieldId: string, input: CreateOptionInput): Promise<FieldOption> {
  checkKey(input.key);
  return mapKeyTaken('option', () =>
    db.transaction(async (tx) => {
      const field = await getFieldRow(tx, fieldId);
      if (!SELECT_TYPES.includes(field.type)) throw fieldInvalid('Only select fields have options');

      const existing = await tx
        .select({ key: templateFieldOptions.key, sortOrder: templateFieldOptions.sortOrder })
        .from(templateFieldOptions)
        .where(eq(templateFieldOptions.fieldId, fieldId));
      if (existing.some((o) => o.key === input.key)) throw keyTaken('option');
      const sortOrder = existing.length ? Math.max(...existing.map((o) => o.sortOrder)) + 1 : 0;

      const [row] = await tx.insert(templateFieldOptions).values({ fieldId, key: input.key, label: input.label, sortOrder }).returning();

      await writeAudit(tx, { adminId, action: 'option.create', entityType: 'option', entityId: row!.id, before: null, after: optionSnapshot(row!) });
      return toOption(row!);
    }),
  );
}

export interface UpdateOptionPatch {
  label?: string;
  status?: CatalogStatus;
}

/** Relabel, retire or reactivate an option (audited as `option.update` either way). */
export async function updateOption(db: Db, adminId: string, optionId: string, patch: UpdateOptionPatch): Promise<FieldOption> {
  return db.transaction(async (tx) => {
    const before = await getOptionRow(tx, optionId);
    const [after] = await tx
      .update(templateFieldOptions)
      .set({ label: patch.label, status: patch.status, updatedAt: new Date() })
      .where(eq(templateFieldOptions.id, optionId))
      .returning();

    await writeAudit(tx, {
      adminId,
      action: 'option.update',
      entityType: 'option',
      entityId: optionId,
      before: optionSnapshot(before),
      after: optionSnapshot(after!),
    });
    return toOption(after!);
  });
}

/** `orderedIds` must be exactly the field's options (every status). */
export async function reorderOptions(db: Db, adminId: string, fieldId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await getFieldRow(tx, fieldId);
    const current = await tx
      .select({ id: templateFieldOptions.id })
      .from(templateFieldOptions)
      .where(eq(templateFieldOptions.fieldId, fieldId))
      .orderBy(asc(templateFieldOptions.sortOrder), asc(templateFieldOptions.createdAt));
    assertExactSet(current, orderedIds, 'options');

    for (const [index, id] of orderedIds.entries()) {
      await tx.update(templateFieldOptions).set({ sortOrder: index, updatedAt: new Date() }).where(eq(templateFieldOptions.id, id));
    }
    await writeAudit(tx, {
      adminId,
      action: 'option.reorder',
      entityType: 'field',
      entityId: fieldId,
      before: current.map((r) => r.id),
      after: orderedIds,
    });
  });
}
