import { sql } from 'drizzle-orm';
import type { PartRequestWorkKind } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';

/**
 * The F8 work queue (spec §5.7, plan D2): `target_request` (a request to target sellers for) and `listing_changed` (a
 * listing to match against active requests, deliver pending replies for, or re-check matches of). Written in the
 * caller's transaction, so the work exists exactly when its cause commits; the `request-work` job claims rows
 * (`FOR UPDATE SKIP LOCKED`, sets `claimed_at`) and runs them.
 *
 * `part_request_work_unclaimed_uq` is unique on (`kind`, `subject_id`) **only while unclaimed**: a second enqueue before
 * the job claims the row is a no-op, and an enqueue while the job holds a claimed row inserts a new row without
 * waiting on it (the claimed row is outside the index), so the change made during the run is picked up next pass.
 */
export async function enqueuePartRequestWork(tx: Tx, kind: PartRequestWorkKind, subjectId: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO part_request_work (kind, subject_id) VALUES (${kind}, ${subjectId})
    ON CONFLICT (kind, subject_id) WHERE claimed_at IS NULL DO NOTHING`);
}

/** `listing_changed` for several listings in one insert (same conflict rule). Duplicates in the input are collapsed. */
export async function enqueueListingsChanged(tx: Tx, listingIds: string[]): Promise<void> {
  const ids = [...new Set(listingIds)];
  if (ids.length === 0) return;
  const values = sql.join(
    ids.map((id) => sql`('listing_changed'::part_request_work_kind, ${id}::uuid)`),
    sql`, `,
  );
  await tx.execute(sql`
    INSERT INTO part_request_work (kind, subject_id) VALUES ${values}
    ON CONFLICT (kind, subject_id) WHERE claimed_at IS NULL DO NOTHING`);
}
