import type { Db, Tx } from '../db/index.js';
import { auditLog } from '../db/schema.js';

export interface AuditEntry {
  adminId: string;
  /** '<entity>.<verb>', e.g. 'category.create', 'field.update'. */
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
}

/** Writes one audit_log row. Pass the transaction so the audit commits with the change. */
export async function writeAudit(db: Db | Tx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    adminId: entry.adminId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
