import { eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import {
  CHAT_LIMITS,
  enquiryStatus,
  type InboxFilter,
  type InboxPage,
  type InboxPill,
  type InboxRow,
  type ListingKind,
  type MessageKind,
  type PartySide,
  type SystemLineCode,
} from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { chatThreadUserState, users } from '../../db/schema.js';
import { ValidationError } from '../../lib/errors.js';
import { publicUrl } from '../../lib/media-url.js';
import { queueUserEmit } from '../../lib/tx-effects.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { publicListingWhere } from '../listings/public-where.service.js';
import { markChatNotificationRead } from '../notifications/chat-rows.js';
import { lockThread } from '../deals/locks.js';
import { publicText, visibleText } from './chat-view.js';
import { getThreadForParty, type ChatReader } from './members.js';

/**
 * The Chats inbox (F6 + F7 spec §5.3, §6.10, R9; ported from textile `thread.service.ts` `listThreads`, `markRead`,
 * `archive.ts`). Unread is a column comparison (the other side's last seq > my `last_read_seq`); the exact count is
 * taken only for the page's unread rows. "Your turn" is the stored `buyer_turn` / `seller_turn`. Archive and read are
 * per-user state (viewers included, P15). Every text through `visibleText`; names and titles masked always.
 */

type Conn = Db | Tx;

interface Cursor {
  t: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof c.t === 'string' && typeof c.id === 'string' && /^[0-9a-f-]{36}$/i.test(c.id) && !Number.isNaN(Date.parse(c.t))) {
      return { t: c.t, id: c.id };
    }
  } catch {
    // falls through
  }
  throw new ValidationError('Invalid cursor', undefined, 'INVALID_CURSOR');
}

type RawRow = {
  id: string;
  listing_id: string;
  buyer_business_id: string;
  seller_business_id: string;
  listing_kind: ListingKind;
  sort_at: string;
  my_side: PartySide;
  your_turn: boolean;
  deal_count: number;
  first_seller_reply_at: string | null;
  contact_unlocked_at: string | null;
  archived: boolean;
  unread: number;
  m_kind: MessageKind | null;
  m_text: string | null;
  m_photo_count: number | null;
  m_system_code: SystemLineCode | null;
  m_sender_side: PartySide | null;
  m_at: string | null;
  o_price: string | null;
  o_unit_label: string | null;
  listing_title: string | null;
  deal_title: string | null;
  thumb_key: string | null;
  listing_public: boolean;
  has_open: boolean;
  blocked: boolean;
  active_deal: boolean;
  cp_name: string;
  cp_gst: boolean;
};

const PUBLIC_L = publicListingWhere({ status: sql`l.status` as unknown as AnyColumn, businessId: sql`l.business_id` as unknown as AnyColumn });

/** Inbox rows for one user (`user` + `businessId`) with the given extra condition, newest first. */
async function queryRows(conn: Conn, reader: { userId: string; businessId: string }, where: SQL, limit: number): Promise<RawRow[]> {
  const me = reader.businessId;
  const mySide = sql`(CASE WHEN t.buyer_business_id = ${me} THEN 'buyer' ELSE 'seller' END)`;
  const lastRead = sql`coalesce(s.last_read_seq, 0)`;
  const otherSeq = sql`(CASE WHEN t.buyer_business_id = ${me} THEN t.last_seller_seq ELSE t.last_buyer_seq END)`;
  const { rows } = await conn.execute<RawRow>(sql`
    SELECT t.id, t.listing_id, t.buyer_business_id, t.seller_business_id, t.listing_kind,
           to_json(t.last_message_at)#>>'{}' AS sort_at,
           ${mySide} AS my_side,
           (CASE WHEN t.buyer_business_id = ${me} THEN t.buyer_turn ELSE t.seller_turn END) AS your_turn,
           t.deal_count,
           to_json(t.first_seller_reply_at)#>>'{}' AS first_seller_reply_at,
           to_json(t.contact_unlocked_at)#>>'{}' AS contact_unlocked_at,
           (s.archived_at IS NOT NULL) AS archived,
           (CASE WHEN ${otherSeq} > ${lastRead} THEN (
              SELECT count(*)::int FROM chat_messages um
              WHERE um.thread_id = t.id AND um.seq > ${lastRead}
                AND (um.sender_side IS NULL OR um.sender_side::text <> ${mySide})
            ) ELSE 0 END) AS unread,
           m.kind AS m_kind, m.text AS m_text, coalesce(cardinality(m.photo_keys), 0) AS m_photo_count,
           m.system_code AS m_system_code, m.sender_side AS m_sender_side, to_json(m.created_at)#>>'{}' AS m_at,
           o.price_per_unit_paise::text AS o_price, ou.label AS o_unit_label,
           l.title AS listing_title,
           (SELECT d.listing_title FROM deals d WHERE d.thread_id = t.id ORDER BY d.accepted_at DESC, d.id DESC LIMIT 1) AS deal_title,
           (SELECT lm.thumb_key FROM listing_media lm WHERE lm.listing_id = l.id AND lm.type = 'photo' ORDER BY lm.sort_order, lm.created_at LIMIT 1) AS thumb_key,
           ${PUBLIC_L} AS listing_public,
           EXISTS (SELECT 1 FROM offers oo WHERE oo.thread_id = t.id AND oo.status IN ('pending', 'backup')) AS has_open,
           EXISTS (SELECT 1 FROM business_blocks bb
                   WHERE (bb.blocker_business_id = t.buyer_business_id AND bb.blocked_business_id = t.seller_business_id)
                      OR (bb.blocker_business_id = t.seller_business_id AND bb.blocked_business_id = t.buyer_business_id)) AS blocked,
           EXISTS (SELECT 1 FROM deals ad WHERE ad.thread_id = t.id AND ad.status IN ('agreed', 'handed_over', 'disputed')) AS active_deal,
           cp.trade_name AS cp_name, (cp.verification_levels ? 'gst') AS cp_gst
    FROM chat_threads t
    JOIN listings l ON l.id = t.listing_id
    JOIN businesses cp ON cp.id = (CASE WHEN t.buyer_business_id = ${me} THEN t.seller_business_id ELSE t.buyer_business_id END)
    LEFT JOIN chat_thread_user_state s ON s.thread_id = t.id AND s.user_id = ${reader.userId}
    LEFT JOIN chat_messages m ON m.thread_id = t.id AND m.seq = t.last_message_seq
    LEFT JOIN offers o ON o.id = m.offer_id
    LEFT JOIN units ou ON ou.id = o.unit_id
    WHERE (t.buyer_business_id = ${me} OR t.seller_business_id = ${me}) AND ${where}
    ORDER BY t.last_message_at DESC, t.id DESC
    LIMIT ${limit}`);
  return rows;
}

function toInboxRow(r: RawRow, reader: Pick<ChatReader, 'memberRole'>): InboxRow {
  const thread = { contactUnlockedAt: r.contact_unlocked_at ? new Date(r.contact_unlocked_at) : null };
  const status = enquiryStatus({
    dealCount: Number(r.deal_count),
    firstSellerReplyAt: r.first_seller_reply_at,
    hasOpenNegotiation: r.has_open,
    listingPublic: r.listing_public,
    blocked: r.blocked,
  });
  const pill: InboxPill = r.your_turn ? 'your_turn' : r.active_deal ? 'deal' : status;
  const counterpartId = r.my_side === 'buyer' ? r.seller_business_id : r.buyer_business_id;
  return {
    threadId: r.id,
    side: r.my_side,
    counterpart: { businessId: counterpartId, name: publicText(r.cp_name) ?? '', gstVerified: r.cp_gst },
    listing: {
      listingId: r.listing_id,
      kind: r.listing_kind,
      title: publicText(r.deal_title ?? r.listing_title ?? '') ?? '',
      thumbUrl: publicUrl(r.thumb_key),
    },
    lastMessage:
      r.m_kind === null || r.m_at === null
        ? null
        : {
            kind: r.m_kind,
            // An enquiry's note is its text; system lines and cards carry none.
            text: r.m_kind === 'text' || r.m_kind === 'photos' || r.m_kind === 'enquiry' ? visibleText(r.m_text, reader, thread) : null,
            photoCount: Number(r.m_photo_count ?? 0),
            systemCode: r.m_system_code,
            offer: r.o_price !== null ? { pricePerUnitPaise: Number(r.o_price), unitLabel: r.o_unit_label } : null,
            isMine: r.m_sender_side !== null && r.m_sender_side === r.my_side,
            at: new Date(r.m_at).toISOString(),
          },
    unread: Number(r.unread),
    yourTurn: r.your_turn,
    enquiryStatus: status,
    pill,
    archived: r.archived,
  };
}

/** `GET /threads?filter=&archived=&cursor=` (§6.10): 20 a page, keyset on (`last_message_at`, `id`), `counts.yourTurn`. */
export async function listThreads(
  conn: Conn,
  user: UserTokenPayload,
  opts: { filter: InboxFilter; archived: boolean; cursor?: string },
): Promise<InboxPage> {
  if (!user.businessId) return { items: [], nextCursor: null, counts: { yourTurn: 0 } };
  const me = user.businessId;
  const [member] = await conn.select({ memberRole: users.memberRole }).from(users).where(eq(users.id, user.userId));
  const reader = { memberRole: member?.memberRole ?? ('viewer' as const) };
  const conds: SQL[] = [];
  if (opts.filter === 'buying') conds.push(sql`t.buyer_business_id = ${me}`);
  if (opts.filter === 'selling') conds.push(sql`t.seller_business_id = ${me}`);
  if (opts.filter === 'your_turn') {
    conds.push(sql`((t.buyer_business_id = ${me} AND t.buyer_turn) OR (t.seller_business_id = ${me} AND t.seller_turn))`);
  }
  conds.push(opts.archived ? sql`s.archived_at IS NOT NULL` : sql`s.archived_at IS NULL`);
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    conds.push(sql`(t.last_message_at, t.id) < (${c.t}::timestamptz, ${c.id}::uuid)`);
  }
  const size = CHAT_LIMITS.inboxPageSize;
  const rows = await queryRows(conn, { userId: user.userId, businessId: me }, sql.join(conds, sql` AND `), size + 1);
  const page = rows.slice(0, size);
  const last = page[page.length - 1];

  const { rows: counted } = await conn.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM chat_threads t
    LEFT JOIN chat_thread_user_state s ON s.thread_id = t.id AND s.user_id = ${user.userId}
    WHERE ((t.buyer_business_id = ${me} AND t.buyer_turn) OR (t.seller_business_id = ${me} AND t.seller_turn))
      AND s.archived_at IS NULL`);

  return {
    items: page.map((r) => toInboxRow(r, reader)),
    nextCursor: rows.length > size && last ? encodeCursor({ t: last.sort_at, id: last.id }) : null,
    counts: { yourTurn: counted[0]?.n ?? 0 },
  };
}

/** One thread's inbox row for one reader (the `row` of `message:new`). */
export async function inboxRowFor(conn: Conn, reader: ChatReader, threadId: string): Promise<InboxRow | null> {
  const [row] = await queryRows(conn, reader, sql`t.id = ${threadId}`, 1);
  return row ? toInboxRow(row, reader) : null;
}

/** Threads with unread messages for this user (the Chats tab badge); archived threads don't count. */
export async function unreadThreadCount(conn: Db | Tx, user: UserTokenPayload): Promise<number> {
  if (!user.businessId) return 0;
  const me = user.businessId;
  const { rows } = await conn.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM chat_threads t
    LEFT JOIN chat_thread_user_state s ON s.thread_id = t.id AND s.user_id = ${user.userId}
    WHERE s.archived_at IS NULL
      AND ((t.buyer_business_id = ${me} AND t.last_seller_seq > coalesce(s.last_read_seq, 0))
        OR (t.seller_business_id = ${me} AND t.last_buyer_seq > coalesce(s.last_read_seq, 0)))`);
  return rows[0]?.n ?? 0;
}

/**
 * `POST /threads/:id/read { seq }` (§5.3): moves my read position forward only (never past the thread's newest
 * message), marks the grouped chat notification read and tells the user's other devices (`thread:read`).
 */
export async function markRead(tx: Tx, user: UserTokenPayload, threadId: string, seq: number): Promise<{ unread: number }> {
  const { thread, reader } = await getThreadForParty(tx, user, threadId);
  const target = Math.min(seq, thread.lastMessageSeq);
  const [state] = await tx
    .insert(chatThreadUserState)
    .values({ threadId: thread.id, userId: reader.userId, lastReadSeq: target })
    .onConflictDoUpdate({
      target: [chatThreadUserState.threadId, chatThreadUserState.userId],
      set: { lastReadSeq: sql`greatest(${chatThreadUserState.lastReadSeq}, excluded.last_read_seq)`, updatedAt: sql`now()` },
    })
    .returning({ lastReadSeq: chatThreadUserState.lastReadSeq });
  const readSeq = state!.lastReadSeq;
  await markChatNotificationRead(tx, reader.userId, thread.id);
  queueUserEmit(tx, reader.userId, 'thread:read', { threadId: thread.id, seq: String(readSeq) });
  const { rows } = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM chat_messages m
    WHERE m.thread_id = ${thread.id} AND m.seq > ${readSeq}
      AND (m.sender_side IS NULL OR m.sender_side <> ${reader.side}::party_side)`);
  return { unread: rows[0]?.n ?? 0 };
}

/**
 * `PUT` / `DELETE /threads/:id/archive` (§6.10, P15): per user, any member (viewers included). Takes the thread's lock
 * first so an archive can't land after a concurrent new message un-archived the thread.
 */
export async function setArchived(tx: Tx, user: UserTokenPayload, threadId: string, archived: boolean): Promise<{ archived: boolean }> {
  const { thread, reader } = await getThreadForParty(tx, user, threadId);
  await lockThread(tx, thread.id);
  await tx
    .insert(chatThreadUserState)
    .values({ threadId: thread.id, userId: reader.userId, archivedAt: archived ? sql`now()` : null })
    .onConflictDoUpdate({
      target: [chatThreadUserState.threadId, chatThreadUserState.userId],
      set: {
        archivedAt: archived ? sql`coalesce(${chatThreadUserState.archivedAt}, now())` : null,
        updatedAt: sql`now()`,
      },
    });
  return { archived };
}

