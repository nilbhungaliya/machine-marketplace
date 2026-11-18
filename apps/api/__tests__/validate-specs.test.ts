import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { categories } from '../src/db/schema.js';
import { NotFoundError } from '../src/lib/errors.js';
import { validateSpecs } from '../src/services/catalog/validate-specs.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';

describe('validateSpecs', () => {
  let cat: TestCatalog;

  beforeAll(async () => {
    cat = await createTestCatalog();
  });

  afterAll(async () => {
    if (cat) await deleteTestCatalog(cat.categoryId);
  });

  it('accepts part specs that match the part template', async () => {
    expect(await validateSpecs(db, cat.partGroupId, 'part', { frame_width: 190, temple_type: 'ring' })).toEqual({ ok: true });
  });

  it('rejects a retired option', async () => {
    const result = await validateSpecs(db, cat.partGroupId, 'part', { frame_width: 190, temple_type: 'roller' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.temple_type).toBe('retired');
  });

  it('treats a machine-only field as unknown on a part', async () => {
    const result = await validateSpecs(db, cat.partGroupId, 'part', { reed_space: 190 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.reed_space).toBe('unknown_field');
  });

  it('accepts machine specs at the machine type', async () => {
    expect(await validateSpecs(db, cat.machineTypeId, 'machine', { reed_space: 190 })).toEqual({ ok: true });
  });

  it('passes a retired value unchanged from the previous specs', async () => {
    const specs = { temple_type: 'roller' };
    expect(await validateSpecs(db, cat.partGroupId, 'part', specs, specs)).toEqual({ ok: true });
  });

  it('throws NotFoundError at the wrong level or for an unknown id', async () => {
    await expect(validateSpecs(db, cat.machineTypeId, 'part', {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(validateSpecs(db, cat.partGroupId, 'machine', {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(validateSpecs(db, randomUUID(), 'part', {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a deactivated part group unless allowInactive (editing a listing already on it)', async () => {
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, cat.partGroupId));
    try {
      await expect(validateSpecs(db, cat.partGroupId, 'part', { temple_type: 'ring' })).rejects.toBeInstanceOf(NotFoundError);
      expect(
        await validateSpecs(db, cat.partGroupId, 'part', { temple_type: 'ring' }, undefined, { allowInactive: true }),
      ).toEqual({ ok: true });
    } finally {
      await db.update(categories).set({ isActive: true }).where(eq(categories.id, cat.partGroupId));
    }
  });

  it('rejects a part group under a deactivated machine type, and the machine type itself', async () => {
    await db.update(categories).set({ isActive: false }).where(eq(categories.id, cat.machineTypeId));
    try {
      await expect(validateSpecs(db, cat.partGroupId, 'part', {})).rejects.toBeInstanceOf(NotFoundError);
      await expect(validateSpecs(db, cat.machineTypeId, 'machine', {})).rejects.toBeInstanceOf(NotFoundError);
      expect(await validateSpecs(db, cat.machineTypeId, 'machine', { reed_space: 190 }, undefined, { allowInactive: true })).toEqual({
        ok: true,
      });
    } finally {
      await db.update(categories).set({ isActive: true }).where(eq(categories.id, cat.machineTypeId));
    }
  });
});
