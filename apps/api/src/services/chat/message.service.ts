import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { CHAT_LIMITS, type OfferView, type RentalBookingCardView, type SignedPhoto, type ThreadMessage } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { businesses, chatMessages, deals } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import type { UserTokenPayload } from '../../plugins/auth.js';
import { upsertChatNotification } from '../notifications/chat-rows.js';
import { bookingCardViews } from '../rentals/booking-view.js';
import { publicText, visibleText } from './chat-view.js';
import { assertCanWrite, getThreadForParty, type ChatReader, type ThreadRow } from './members.js';
import { privatePhotoUrl } from './private-photo.js';
import { looksLikeScam } from './scam-patterns.js';
import { insertMessage, recomputeTurns, type MessageRow } from './thread-lines.js';
import { assertNotBlocked, offerViewsFor, otherBusinessId } from './thread.service.js';

/**
 * Messages (F6 + F7 spec §6.4–§6.9, §12.2; ported from textile `services/chat/message.service.ts` `listMessages`,
 * `sendMessage`). Every message leaves the API through `toThreadMessages`, built per reader: text through
 * `visibleText`, the scam warning for the other side only, photos as 300 s signed URLs, offer cards as the reader's
 * `OfferView`.
 */

type Conn = Db | Tx;

const trimQty = (q: string | null): string | null =>
  q === null ? null : q.includes('.') ? q.replace(/0+$/, '').replace(/\.$/, '') : q;

/** Signed URLs for a message's photos (members only: callers check the party first). */
export async function signPhotos(keys: string[] | null): Promise<SignedPhoto[]> {
  if (!keys || keys.length === 0) return [];
  return Promise.all(keys.map((k) => privatePhotoUrl(k)));
}

/** Messages as one reader sees them. */
export async function toThreadMessages(conn: Conn, rows: MessageRow[], reader: ChatReader, thread: ThreadRow): Promise<ThreadMessage[]> {
  const offerIds = [...new Set(rows.flatMap((r) => (r.offerId ? [r.offerId] : [])))];
  const offerViews = offerIds.length ? await offerViewsFor(conn, offerIds, reader, thread) : new Map<string, OfferView>();
  const dealIds = [...new Set(rows.flatMap((r) => (r.dealId ? [r.dealId] : [])))];
  const dealRows = dealIds.length
    ? await conn
        .select({ id: deals.id, ref: deals.ref, status: deals.status, totalPaise: deals.totalPaise })
        .from(deals)
        .where(inArray(deals.id, dealIds))
    : [];
  const dealsById = new Map(dealRows.map((d) => [d.id, d]));
  const bookingIds = rows.flatMap((r) => (r.kind === 'booking' && r.rentalBookingId ? [r.rentalBookingId] : []));
  const bookingViews = bookingIds.length
    ? await bookingCardViews(conn, bookingIds, reader, thread)
    : new Map<string, RentalBookingCardView>();
  return Promise.all(
    rows.map(async (row): Promise<ThreadMessage> => {
      const deal = row.dealId ? dealsById.get(row.dealId) : undefined;
      const mine = row.senderSide !== null && row.senderSide === reader.side;
      return {
        id: row.id,
        threadId: row.threadId,
        seq: String(row.seq),
        kind: row.kind,
        senderSide: row.senderSide,
        isMine: mine,
        // The app's own retry id, only on the sender's rows.
        clientMessageId: row.senderUserId === reader.userId ? row.clientMessageId : null,
        text: row.kind === 'enquiry' ? null : visibleText(row.text, reader, thread),
        photos: await signPhotos(row.photoKeys),
        scamWarning: row.scamFlag && row.senderSide !== null && !mine,
        system: row.kind === 'system' && row.systemCode ? { code: row.systemCode, values: row.systemValues ?? {} } : null,
        enquiry:
          row.kind === 'enquiry'
            ? {
                quick: row.quickOptions ?? [],
                quantity: trimQty(row.enquiryQuantity),
                note: visibleText(row.text, reader, thread),
                machine: row.fitMachine ?? null,
              }
            : null,
        offer: row.offerId ? (offerViews.get(row.offerId) ?? null) : null,
        deal: deal ? { id: deal.id, ref: deal.ref, status: deal.status, totalPaise: deal.totalPaise.toString() } : null,
        // M14 §8: the booking card as the reader sees it (version message masked per reader).
        booking: row.rentalBookingId && row.kind === 'booking' ? (bookingViews.get(row.rentalBookingId) ?? null) : null,
        createdAt: row.createdAt.toISOString(),
      };
    }),
  );
}

/** `GET /threads/:id/messages?before=<seq>`: newest first, 30 a page; page back with the last item's `seq`. */
export async function listMessages(conn: Conn, user: UserTokenPayload, threadId: string, before?: number): Promise<ThreadMessage[]> {
  const { thread, reader } = await getThreadForParty(conn, user, threadId);
  const rows = await conn
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.threadId, thread.id), before === undefined ? undefined : lt(chatMessages.seq, before)))
    .orderBy(desc(chatMessages.seq))
    .limit(CHAT_LIMITS.messagesPageSize);
  return toThreadMessages(conn, rows, reader, thread);
}

/** The sender's stored message for a retried `clientMessageId`, or undefined. */
export async function findRetriedMessage(conn: Conn, userId: string, clientMessageId: string): Promise<MessageRow | undefined> {
  const [row] = await conn
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.senderUserId, userId), eq(chatMessages.clientMessageId, clientMessageId)));
  return row;
}

/**
 * The text of a message or a photo caption, trimmed: `MESSAGE_EMPTY` with neither text nor photos, at most
 * `CHAT_LIMITS.messageMax` characters. Checked before photos are finalized too, so a bad caption consumes no upload.
 */
export function checkMessageText(raw: string | null | undefined, photoCount: number): string | null {
  const text = raw?.trim() || null;
  if (text === null && photoCount === 0) throw new ValidationError('Write a message', undefined, 'MESSAGE_EMPTY');
  if (text !== null && text.length > CHAT_LIMITS.messageMax) {
    throw new ValidationError('This message is too long', { max: CHAT_LIMITS.messageMax }, 'VALIDATION_ERROR');
  }
  return text;
}

/**
 * The checks a photo send passes **before** its photos are finalized (outside the transaction): party (`404`), not a
 * viewer, no block. Returns the stored message when this `clientMessageId` was already sent (a retry finalizes nothing).
 */
export async function precheckSend(
  conn: Conn,
  user: UserTokenPayload,
  threadId: string,
  clientMessageId: string,
): Promise<{ thread: ThreadRow; reader: ChatReader; retried: MessageRow | undefined }> {
  const { thread, reader } = await getThreadForParty(conn, user, threadId);
  assertCanWrite(reader);
  await assertNotBlocked(conn, thread);
  const retried = await findRetriedMessage(conn, user.userId, clientMessageId);
  if (retried && retried.threadId !== thread.id) throw new ConflictError('This message id was used in another conversation', 'CLIENT_MESSAGE_ID_REUSED');
  return { thread, reader, retried };
}

export interface SendMessageInput {
  clientMessageId: string;
  text?: string | null;
  /** Final private keys from `finalizePrivatePhotos`. */
  photoKeys?: string[];
}

/**
 * `POST /threads/:id/messages` (§6.4): text (1–2 000 after trim) or 1–5 photos with an optional caption, by a
 * non-viewer member of either party, refused under a block. The thread is locked (last in §8.5); a retried
 * `clientMessageId` returns the stored message. Scam flag decided here, once (§6.7). The other business gets its
 * grouped chat notification (§11.2); `message:new` goes to every member per reader (`insertMessage`).
 */
export async function sendMessage(tx: Tx, user: UserTokenPayload, threadId: string, input: SendMessageInput): Promise<ThreadMessage> {
  const { thread, reader } = await getThreadForParty(tx, user, threadId, { lock: true });
  assertCanWrite(reader);
  await assertNotBlocked(tx, thread);

  const retried = await findRetriedMessage(tx, user.userId, input.clientMessageId);
  if (retried) {
    if (retried.threadId !== thread.id) throw new ConflictError('This message id was used in another conversation', 'CLIENT_MESSAGE_ID_REUSED');
    return (await toThreadMessages(tx, [retried], reader, thread))[0]!;
  }

  const photoKeys = input.photoKeys ?? [];
  if (photoKeys.length > CHAT_LIMITS.photosPerMessage) {
    throw new ValidationError('Too many photos', { max: CHAT_LIMITS.photosPerMessage }, 'TOO_MANY_PHOTOS');
  }
  const text = checkMessageText(input.text, photoKeys.length);

  const row = await insertMessage(tx, thread, {
    kind: photoKeys.length > 0 ? 'photos' : 'text',
    senderSide: reader.side,
    senderUserId: reader.userId,
    text,
    photoKeys: photoKeys.length > 0 ? photoKeys : null,
    scamFlag: text !== null && looksLikeScam(text),
    clientMessageId: input.clientMessageId,
  });

  const [sender] = await tx.select({ name: businesses.tradeName }).from(businesses).where(eq(businesses.id, reader.businessId));
  await upsertChatNotification(tx, {
    thread,
    recipientBusinessId: otherBusinessId(thread, reader),
    senderBusinessName: publicText(sender?.name ?? '') ?? '',
    seq: row.seq,
  });
  // The seller's first message answers an open enquiry (§6.2), which moves the turn.
  await recomputeTurns(tx, thread.id);
  return (await toThreadMessages(tx, [row], reader, thread))[0]!;
}

/** `GET /threads/:id/messages/:messageId/photos`: fresh signed URLs, members only (§6.8). */
export async function messagePhotos(conn: Conn, user: UserTokenPayload, threadId: string, messageId: string): Promise<SignedPhoto[]> {
  const { thread } = await getThreadForParty(conn, user, threadId);
  const [row] = await conn
    .select({ photoKeys: chatMessages.photoKeys })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.threadId, thread.id)));
  if (!row) throw new NotFoundError('Message');
  return signPhotos(row.photoKeys);
}
