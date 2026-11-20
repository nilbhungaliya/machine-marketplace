import { createHash } from 'node:crypto';
import { inArray, or, sql, type SQL } from 'drizzle-orm';
import type { PartySide } from '@mpm/shared-types';
import { db, type Db, type Tx } from '../../src/db/index.js';
import {
  chatMessages,
  chatThreads,
  contactSightings,
  fraudScanState,
  fraudSignals,
  installSightings,
} from '../../src/db/schema.js';

// Admin close-out fixtures (plan C0-2). Rows are written directly (no services), so fraud tests start from any state.
// Cleanup: `deleteCloseOutRows` runs first in `deleteTestBusinesses` and `deleteTestUsers` (a fraud run in one suite
// may raise signals on another suite's businesses); `countCloseOutRows` is the "left clean" check.

type Conn = Db | Tx;
type ScanStateRow = typeof fraudScanState.$inferSelect;

/** A `text` chat message in a thread (the sender's side and user as given). Returns its id and global `seq`. */
export async function insertTestMessage(
  o: { threadId: string; senderUserId: string; senderSide: PartySide; text: string; createdAt?: Date },
  conn: Conn = db,
): Promise<{ id: string; seq: number }> {
  const [m] = await conn
    .insert(chatMessages)
    .values({
      threadId: o.threadId,
      kind: 'text',
      senderSide: o.senderSide,
      senderUserId: o.senderUserId,
      text: o.text,
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    })
    .returning({ id: chatMessages.id, seq: chatMessages.seq });
  return { id: m!.id, seq: Number(m!.seq) };
}

/** The stored form of an install id (SHA-256 hex), as the sightings writer stores it. */
export function testInstallHash(installId: string): string {
  return createHash('sha256').update(installId).digest('hex');
}

/** An `install_sightings` row for the install (hashed) and user; `lastSeenAt` defaults to now (first seen the same). */
export async function insertTestSighting(
  o: { installId: string; userId: string; lastSeenAt?: Date },
  conn: Conn = db,
): Promise<void> {
  const at = o.lastSeenAt ?? new Date();
  await conn
    .insert(installSightings)
    .values({ installHash: testInstallHash(o.installId), userId: o.userId, firstSeenAt: at, lastSeenAt: at });
}

/** Every `fraud_scan_state` row, to restore after a test that runs the whole job (`restoreScanState`). */
export async function saveScanState(conn: Conn = db): Promise<ScanStateRow[]> {
  return conn.select().from(fraudScanState);
}

/** Puts `fraud_scan_state` back exactly as saved (rows added since are deleted). */
export async function restoreScanState(rows: ScanStateRow[], conn: Conn = db): Promise<void> {
  await conn.delete(fraudScanState);
  if (rows.length) await conn.insert(fraudScanState).values(rows);
}

/** Thread ids of the businesses (buyer or seller side) and message ids sent by the users or in those threads. */
async function scopeIds(conn: Conn, o: { businessIds: string[]; userIds: string[] }) {
  const threadIds = o.businessIds.length
    ? (
        await conn
          .select({ id: chatThreads.id })
          .from(chatThreads)
          .where(or(inArray(chatThreads.buyerBusinessId, o.businessIds), inArray(chatThreads.sellerBusinessId, o.businessIds)))
      ).map((r) => r.id)
    : [];
  const messageWhere: SQL[] = [];
  if (threadIds.length) messageWhere.push(inArray(chatMessages.threadId, threadIds));
  if (o.userIds.length) messageWhere.push(inArray(chatMessages.senderUserId, o.userIds));
  const messageIds = messageWhere.length
    ? (await conn.select({ id: chatMessages.id }).from(chatMessages).where(or(...messageWhere))).map((r) => r.id)
    : [];
  return { threadIds, messageIds };
}

function sightingWhere(o: { businessIds: string[] }, s: { threadIds: string[]; messageIds: string[] }): SQL | null {
  const where: SQL[] = [];
  if (o.businessIds.length) where.push(inArray(contactSightings.businessId, o.businessIds));
  if (s.threadIds.length) where.push(inArray(contactSightings.threadId, s.threadIds));
  if (s.messageIds.length) where.push(inArray(contactSightings.messageId, s.messageIds));
  return where.length ? or(...where)! : null;
}

/** This feature's rows of the businesses and users: their signals, contact sightings and install sightings. */
export async function countCloseOutRows(
  conn: Conn,
  o: { businessIds: string[]; userIds: string[] },
): Promise<{ fraudSignals: number; contactSightings: number; installSightings: number }> {
  const s = await scopeIds(conn, o);
  const count = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const n = sql<number>`count(*)::int`;
  const cs = sightingWhere(o, s);
  return {
    fraudSignals: o.businessIds.length
      ? await count(conn.select({ n }).from(fraudSignals).where(inArray(fraudSignals.businessId, o.businessIds)))
      : 0,
    contactSightings: cs ? await count(conn.select({ n }).from(contactSightings).where(cs)) : 0,
    installSightings: o.userIds.length
      ? await count(conn.select({ n }).from(installSightings).where(inArray(installSightings.userId, o.userIds)))
      : 0,
  };
}

/**
 * Deletes this feature's rows of the businesses and users: signals of the businesses, contact sightings by those
 * businesses or in a thread / message of theirs, install sightings of the users. Runs before the F6 cleanup (sightings
 * reference threads and messages). No-op for empty lists.
 */
export async function deleteCloseOutRows(conn: Conn, o: { businessIds: string[]; userIds: string[] }): Promise<void> {
  if (o.businessIds.length === 0 && o.userIds.length === 0) return;
  const s = await scopeIds(conn, o);
  const cs = sightingWhere(o, s);
  if (cs) await conn.delete(contactSightings).where(cs);
  if (o.businessIds.length) await conn.delete(fraudSignals).where(inArray(fraudSignals.businessId, o.businessIds));
  if (o.userIds.length) await conn.delete(installSightings).where(inArray(installSightings.userId, o.userIds));
}
