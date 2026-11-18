import { asc, eq, max } from 'drizzle-orm';
import { CATALOG_KEY_REGEX, type Condition, type Unit } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { conditions, units } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { isCheckViolation, isUniqueViolation } from '../../lib/pg-errors.js';
import { writeAudit } from '../audit.service.js';
import { listingsUseUnit } from './listing-uses.js';
import { assertExactSet } from './reorder.js';

// Admin writes on master data (spec §7): units and conditions. Keys never change; rows are deactivated, never deleted.
// Each function runs in one transaction and writes one audit_log row with it.

type UnitRow = typeof units.$inferSelect;
type ConditionRow = typeof conditions.$inferSelect;

/** Decimal places a quantity in this unit may have (CHECK units_decimals_range). */
export type UnitDecimals = 0 | 1 | 2 | 3;

const UNIT_KEY_CONSTRAINT = 'units_key_unique';
const CONDITION_KEY_CONSTRAINT = 'conditions_key_unique';
const UNIT_DECIMALS_CHECK = 'units_decimals_range';

/**
 * The unique indexes are the backstop for a key already in use; the CHECK on units.decimals is the backstop for a
 * value the route should already have refused (a 400, not a 500).
 */
async function mapConstraintErrors<T>(keyConstraint: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isUniqueViolation(err, keyConstraint)) throw new ConflictError('This key is already in use', 'KEY_TAKEN');
    if (isCheckViolation(err, UNIT_DECIMALS_CHECK)) throw new ValidationError('Decimals must be 0, 1, 2 or 3');
    throw err;
  }
}

function checkKey(key: string): void {
  if (!CATALOG_KEY_REGEX.test(key)) throw new ValidationError('Key must be snake_case: a letter, then 1–39 of a-z, 0-9, _');
}

/** Next sortOrder at the end of a list: 0 for an empty list. */
function nextOrder(last: { value: number | null } | undefined): number {
  return last?.value === null || last?.value === undefined ? 0 : last.value + 1;
}

// ---- Units ----

function toUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    decimals: row.decimals,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    isMachineUnit: row.isMachineUnit,
  };
}

async function lockUnit(tx: Tx, id: string): Promise<UnitRow> {
  const [row] = await tx.select().from(units).where(eq(units.id, id)).for('update');
  if (!row) throw new NotFoundError('Unit');
  return row;
}

export interface CreateUnitInput {
  key: string;
  label: string;
  decimals: UnitDecimals;
}

/** The new unit goes last. */
export async function createUnit(db: Db, adminId: string, input: CreateUnitInput): Promise<Unit> {
  checkKey(input.key);
  return mapConstraintErrors(UNIT_KEY_CONSTRAINT, () =>
    db.transaction(async (tx) => {
      const [last] = await tx.select({ value: max(units.sortOrder) }).from(units);
      const [row] = await tx
        .insert(units)
        .values({ key: input.key, label: input.label, decimals: input.decimals, sortOrder: nextOrder(last) })
        .returning();
      const unit = toUnit(row!);
      await writeAudit(tx, { adminId, action: 'unit.create', entityType: 'unit', entityId: unit.id, before: null, after: unit });
      return unit;
    }),
  );
}

export interface UpdateUnitPatch {
  label?: string;
  decimals?: UnitDecimals;
  isActive?: boolean;
  /** Machines and rentals use the first active unit with this flag (F2 spec §4.2, R48). */
  isMachineUnit?: boolean;
}

export async function updateUnit(db: Db, adminId: string, id: string, patch: UpdateUnitPatch): Promise<Unit> {
  return mapConstraintErrors(UNIT_KEY_CONSTRAINT, () =>
    db.transaction(async (tx) => {
      const before = await lockUnit(tx, id);
      // M5 (F2 spec §16): lowering decimals would leave listed quantities with more decimals than the unit allows;
      // deactivating stays allowed (A4 spec §7). The unit row is locked above, so a listing write waits for us.
      if (patch.decimals !== undefined && patch.decimals < before.decimals && (await listingsUseUnit(tx, id))) {
        throw new ConflictError('Listings use this unit; its decimals cannot be lowered', 'UNIT_IN_USE');
      }
      const [after] = await tx
        .update(units)
        .set({
          label: patch.label,
          decimals: patch.decimals,
          isActive: patch.isActive,
          isMachineUnit: patch.isMachineUnit,
          updatedAt: new Date(),
        })
        .where(eq(units.id, id))
        .returning();
      await writeAudit(tx, { adminId, action: 'unit.update', entityType: 'unit', entityId: id, before: toUnit(before), after: toUnit(after!) });
      return toUnit(after!);
    }),
  );
}

/** `orderedIds` must be exactly all units (active and inactive). */
export async function reorderUnits(db: Db, adminId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await tx.select({ id: units.id }).from(units).orderBy(asc(units.sortOrder), asc(units.createdAt));
    assertExactSet(current, orderedIds, 'units');

    for (const [index, id] of orderedIds.entries()) {
      await tx.update(units).set({ sortOrder: index, updatedAt: new Date() }).where(eq(units.id, id));
    }
    await writeAudit(tx, {
      adminId,
      action: 'unit.reorder',
      entityType: 'unit',
      entityId: null,
      before: current.map((r) => r.id),
      after: orderedIds,
    });
  });
}

// ---- Conditions ----

function toCondition(row: ConditionRow): Condition {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}

async function lockCondition(tx: Tx, id: string): Promise<ConditionRow> {
  const [row] = await tx.select().from(conditions).where(eq(conditions.id, id)).for('update');
  if (!row) throw new NotFoundError('Condition');
  return row;
}

export interface CreateConditionInput {
  key: string;
  label: string;
  description?: string | null;
}

/** The new condition goes last. */
export async function createCondition(db: Db, adminId: string, input: CreateConditionInput): Promise<Condition> {
  checkKey(input.key);
  return mapConstraintErrors(CONDITION_KEY_CONSTRAINT, () =>
    db.transaction(async (tx) => {
      const [last] = await tx.select({ value: max(conditions.sortOrder) }).from(conditions);
      const [row] = await tx
        .insert(conditions)
        .values({ key: input.key, label: input.label, description: input.description ?? null, sortOrder: nextOrder(last) })
        .returning();
      const condition = toCondition(row!);
      await writeAudit(tx, { adminId, action: 'condition.create', entityType: 'condition', entityId: condition.id, before: null, after: condition });
      return condition;
    }),
  );
}

export interface UpdateConditionPatch {
  label?: string;
  description?: string | null;
  isActive?: boolean;
}

export async function updateCondition(db: Db, adminId: string, id: string, patch: UpdateConditionPatch): Promise<Condition> {
  return db.transaction(async (tx) => {
    const before = await lockCondition(tx, id);
    const [after] = await tx
      .update(conditions)
      .set({ label: patch.label, description: patch.description, isActive: patch.isActive, updatedAt: new Date() })
      .where(eq(conditions.id, id))
      .returning();
    await writeAudit(tx, {
      adminId,
      action: 'condition.update',
      entityType: 'condition',
      entityId: id,
      before: toCondition(before),
      after: toCondition(after!),
    });
    return toCondition(after!);
  });
}

/** `orderedIds` must be exactly all conditions (active and inactive). */
export async function reorderConditions(db: Db, adminId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const current = await tx
      .select({ id: conditions.id })
      .from(conditions)
      .orderBy(asc(conditions.sortOrder), asc(conditions.createdAt));
    assertExactSet(current, orderedIds, 'conditions');

    for (const [index, id] of orderedIds.entries()) {
      await tx.update(conditions).set({ sortOrder: index, updatedAt: new Date() }).where(eq(conditions.id, id));
    }
    await writeAudit(tx, {
      adminId,
      action: 'condition.reorder',
      entityType: 'condition',
      entityId: null,
      before: current.map((r) => r.id),
      after: orderedIds,
    });
  });
}
