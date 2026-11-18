import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { auditLog } from '../src/db/schema.js';
import { writeAudit } from '../src/services/audit.service.js';
import { isUniqueViolation } from '../src/lib/pg-errors.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';

const adminIds: string[] = [];
afterAll(async () => {
  await deleteTestAdmins(adminIds);
});

describe('writeAudit', () => {
  it('stores who, what and before/after', async () => {
    const admin = await createTestAdmin('category_manager');
    adminIds.push(admin.id);
    await writeAudit(db, {
      adminId: admin.id,
      action: 'test.write',
      entityType: 'test',
      entityId: 'x1',
      before: { a: 1 },
      after: { a: 2 },
    });
    const rows = await db.select().from(auditLog).where(eq(auditLog.adminId, admin.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('test.write');
    expect(rows[0]!.before).toEqual({ a: 1 });
    expect(rows[0]!.after).toEqual({ a: 2 });
  });
});

describe('isUniqueViolation', () => {
  it('detects pg 23505 only', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23505', constraint: 'a' }, 'a')).toBe(true);
    expect(isUniqueViolation({ code: '23505', constraint: 'a' }, 'b')).toBe(false);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(new Error())).toBe(false);
  });
});
