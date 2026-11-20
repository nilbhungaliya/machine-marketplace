import { asc, eq, inArray, sql } from 'drizzle-orm';
import { ADMIN_READ_WINDOW_DAYS, type AdminRole, type AdminThreadRead } from '@mpm/shared-types';
import type { Tx } from '../../db/index.js';
import { businesses, chatMessages, chatThreads, listings, users } from '../../db/schema.js';
import { adminText } from '../../lib/admin-text.js';
import { AppError, ForbiddenError } from '../../lib/errors.js';
import { writeAudit } from '../audit.service.js';
import { threadNotFound } from './members.js';
import { signPhotos } from './message.service.js';

/**
 * Reading a conversation as staff (F6 + F7 spec §16.3, R23): `POST /admin/threads/:id/read { reason }`. Allowed only
 * while the thread has a `conversation` report that is `open` / `reviewing` or was resolved within the last 30 days,
 * or (for `support` and `super_admin`) a deal or a rental booking in it (M14 R12) has an `open` dispute or one resolved
 * within the last 30 days;
 * otherwise `403 ADMIN_READ_NOT_ALLOWED`. Every read writes `audit_log` `thread.read` (admin, thread, reason, the report
 * or dispute it rests on) in the same transaction. Messages as stored (the reader is staff), photos as 300 s signed
 * URLs, never the revealed contact numbers.
 */

const WINDOW = sql`now() - make_interval(days => ${ADMIN_READ_WINDOW_DAYS}::int)`;

export async function adminReadThread(
  tx: Tx,
  admin: { adminId: string; role: AdminRole },
  threadId: string,
  rawReason: string,
): Promise<AdminThreadRead> {
  const reason = adminText(rawReason);
  const [thread] = await tx.select().from(chatThreads).where(eq(chatThreads.id, threadId));
  if (!thread) throw threadNotFound();

  const { rows: reportRows } = await tx.execute<{ id: string }>(sql`
    SELECT r.id FROM reports r
    WHERE r.target_type = 'conversation' AND r.target_id = ${threadId}
      AND (r.status IN ('open', 'reviewing') OR (r.resolved_at IS NOT NULL AND r.resolved_at > ${WINDOW}))
    ORDER BY r.created_at DESC LIMIT 1`);
  const reportId = reportRows[0]?.id ?? null;
  let disputeId: string | null = null;
  if (!reportId && (admin.role === 'support' || admin.role === 'super_admin')) {
    const { rows } = await tx.execute<{ id: string }>(sql`
      SELECT dd.id FROM deal_disputes dd
      LEFT JOIN deals d ON d.id = dd.deal_id
      LEFT JOIN rental_bookings rb ON rb.id = dd.rental_booking_id
      WHERE coalesce(d.thread_id, rb.thread_id) = ${threadId}
        AND (dd.status = 'open' OR (dd.resolved_at IS NOT NULL AND dd.resolved_at > ${WINDOW}))
      ORDER BY dd.created_at DESC LIMIT 1`);
    disputeId = rows[0]?.id ?? null;
  }
  if (!reportId && !disputeId) {
    throw new ForbiddenError('This conversation can be read only for a report or a dispute', 'ADMIN_READ_NOT_ALLOWED');
  }

  await writeAudit(tx, {
    adminId: admin.adminId,
    action: 'thread.read',
    entityType: 'thread',
    entityId: threadId,
    before: null,
    after: { reason, reportId, disputeId },
  });

  const [listing] = await tx.select({ id: listings.id, ref: listings.ref, title: listings.title }).from(listings).where(eq(listings.id, thread.listingId));
  const names = await tx
    .select({ id: businesses.id, name: businesses.tradeName })
    .from(businesses)
    .where(inArray(businesses.id, [thread.buyerBusinessId, thread.sellerBusinessId]));
  const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? '';
  const rows = await tx
    .select({ m: chatMessages, senderName: users.name })
    .from(chatMessages)
    .leftJoin(users, eq(users.id, chatMessages.senderUserId))
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(asc(chatMessages.seq));

  const messages = await Promise.all(
    rows.map(async ({ m, senderName }) => ({
      id: m.id,
      seq: String(m.seq),
      kind: m.kind,
      senderSide: m.senderSide,
      senderName: senderName ?? null,
      text: m.kind === 'enquiry' ? null : m.text,
      photos: await signPhotos(m.photoKeys),
      scamFlag: m.scamFlag,
      system: m.kind === 'system' && m.systemCode ? { code: m.systemCode, values: m.systemValues ?? {} } : null,
      enquiry:
        m.kind === 'enquiry'
          ? { quick: m.quickOptions ?? [], quantity: m.enquiryQuantity, note: m.text, machine: m.fitMachine ?? null }
          : null,
      offerId: m.offerId,
      dealId: m.dealId,
      createdAt: m.createdAt.toISOString(),
    })),
  );
  if (!listing) throw new AppError('Listing not found', 404, 'LISTING_NOT_FOUND');
  return {
    threadId,
    listing: { id: listing.id, ref: listing.ref, title: listing.title ?? '' },
    buyer: { businessId: thread.buyerBusinessId, name: nameOf(thread.buyerBusinessId) },
    seller: { businessId: thread.sellerBusinessId, name: nameOf(thread.sellerBusinessId) },
    messages,
  };
}
