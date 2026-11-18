import { desc, eq, sql } from 'drizzle-orm';
import type { AdminGstHistory, VerificationLevel } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businessVerifications, gstChecks, gstRepresentativeProofs } from '../../db/schema.js';

/**
 * A business's GST history for the admin pages (F1 + A2 spec §8.1 "previous checks and decisions", §8.2 "GST
 * history"; textile `gst-claims.service.ts` `getBusinessGstHistory`). Never a lookup's details (a `held` lookup stores
 * another business's registration) and never a document key.
 */

const HISTORY_LIMIT = 50;

export async function gstHistory(conn: Db | Tx, businessId: string): Promise<AdminGstHistory> {
  const checks = await conn
    .select({
      id: gstChecks.id,
      gstin: gstChecks.gstin,
      source: gstChecks.source,
      result: gstChecks.result,
      gstStatus: gstChecks.gstStatus,
      createdAt: gstChecks.createdAt,
    })
    .from(gstChecks)
    .where(eq(gstChecks.businessId, businessId))
    .orderBy(desc(gstChecks.createdAt), desc(gstChecks.id))
    .limit(HISTORY_LIMIT);
  const proofs = await conn
    .select({
      id: gstRepresentativeProofs.id,
      gstin: gstRepresentativeProofs.gstin,
      method: gstRepresentativeProofs.method,
      status: gstRepresentativeProofs.status,
      documentTypes: sql<AdminGstHistory['proofs'][number]['documentTypes']>`coalesce((
        SELECT jsonb_agg(d->>'type') FROM jsonb_array_elements(${gstRepresentativeProofs.documents}) AS d
      ), '[]'::jsonb)`,
      officerMessage: gstRepresentativeProofs.officerMessage,
      reason: gstRepresentativeProofs.reason,
      lookupAtApproval: gstRepresentativeProofs.lookupAtApproval,
      createdAt: gstRepresentativeProofs.createdAt,
      decidedAt: gstRepresentativeProofs.decidedAt,
    })
    .from(gstRepresentativeProofs)
    .where(eq(gstRepresentativeProofs.businessId, businessId))
    .orderBy(desc(gstRepresentativeProofs.createdAt), desc(gstRepresentativeProofs.id))
    .limit(HISTORY_LIMIT);
  const verifications = await conn
    .select()
    .from(businessVerifications)
    .where(eq(businessVerifications.businessId, businessId))
    .orderBy(desc(sql`coalesce(${businessVerifications.revokedAt}, ${businessVerifications.verifiedAt})`), desc(businessVerifications.id))
    .limit(HISTORY_LIMIT);

  return {
    checks: checks.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
    proofs: proofs.map((p) => ({ ...p, createdAt: p.createdAt.toISOString(), decidedAt: p.decidedAt?.toISOString() ?? null })),
    verifications: verifications.map((v) => ({
      id: v.id,
      level: v.level as VerificationLevel,
      method: v.method,
      status: v.status,
      verifiedAt: v.verifiedAt.toISOString(),
      revokedAt: v.revokedAt?.toISOString() ?? null,
      revokeReason: v.revokeReason,
    })),
  };
}
