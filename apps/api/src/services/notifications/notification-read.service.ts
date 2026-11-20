import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Language, NotificationRow, NotificationsPage } from '@mpm/shared-types';
import type { Db, Tx } from '../../db/index.js';
import { notifications, users } from '../../db/schema.js';
import { AppError, ValidationError } from '../../lib/errors.js';
import { queueUserEmit } from '../../lib/tx-effects.js';
import { notificationUnreadOf } from './notify.js';
import { renderNotification } from './render.js';

/**
 * The in-app notification list, its read state, the push switch and the server-side language (F6 + F7 spec §11.4,
 * §11.6, §12.2; ported from textile `notification.service.ts`). L4-3 owns this file. Every route is per-user state, so
 * viewers use them too. Text is rendered on read in `users.language` (never stored as a sentence).
 */

type Conn = Db | Tx;

const PAGE_SIZE = 20;

const notificationNotFound = () => new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');

/** Unread in-app notifications of the user (the bell badge). */
export async function notificationUnreadCount(conn: Conn, userId: string): Promise<number> {
  return notificationUnreadOf(conn as Tx, userId);
}

async function languageOf(conn: Conn, userId: string): Promise<Language> {
  const [u] = await conn.select({ language: users.language }).from(users).where(eq(users.id, userId));
  return u?.language ?? 'en';
}

type Row = typeof notifications.$inferSelect;

export function toNotificationRow(n: Row, language: Language): NotificationRow {
  const { title, body } = renderNotification(n.type, n.params, language, n.unreadCount);
  return {
    id: n.id,
    type: n.type,
    category: n.category,
    title,
    body,
    threadId: n.threadId,
    offerId: n.offerId,
    dealId: n.dealId,
    reviewId: n.reviewId,
    partRequestId: n.partRequestId,
    rentalBookingId: n.rentalBookingId,
    unreadCount: n.unreadCount,
    read: n.readAt !== null,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

function decodeCursor(raw: string): { t: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { t?: unknown; id?: unknown };
    if (typeof parsed.t === 'string' && typeof parsed.id === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.id) && !Number.isNaN(Date.parse(parsed.t))) {
      return { t: parsed.t, id: parsed.id };
    }
  } catch {
    // falls through
  }
  throw new ValidationError('Invalid cursor', undefined, 'INVALID_CURSOR');
}

/**
 * `GET /notifications`: newest activity first (a bumped grouped chat row moves to the top, §11.2), 20 a page, rendered
 * in the reader's language.
 */
export async function listNotifications(conn: Conn, userId: string, cursor?: string): Promise<NotificationsPage> {
  const conditions: SQL[] = [eq(notifications.userId, userId)];
  if (cursor) {
    const c = decodeCursor(cursor);
    conditions.push(sql`(${notifications.updatedAt}, ${notifications.id}) < (${c.t}::timestamptz, ${c.id}::uuid)`);
  }
  const rows = await conn
    .select({ n: notifications, sortAt: sql<string>`${notifications.updatedAt}::text` })
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.updatedAt), desc(notifications.id))
    .limit(PAGE_SIZE + 1);
  const language = await languageOf(conn, userId);
  const unreadCount = await notificationUnreadCount(conn, userId);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => toNotificationRow(r.n, language)),
    nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(JSON.stringify({ t: last.sortAt, id: last.n.id })).toString('base64url') : null,
    unreadCount,
  };
}

/** `POST /notifications/:id/read`: the user's own row only (`404 NOTIFICATION_NOT_FOUND`); repeating it is harmless. */
export async function markNotificationRead(tx: Tx, userId: string, id: string): Promise<{ unreadCount: number }> {
  const [row] = await tx.select({ id: notifications.id, readAt: notifications.readAt }).from(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  if (!row) throw notificationNotFound();
  if (row.readAt === null) await tx.update(notifications).set({ readAt: sql`now()` }).where(eq(notifications.id, id));
  const unreadCount = await notificationUnreadOf(tx, userId);
  queueUserEmit(tx, userId, 'notification:new', { unreadCount });
  return { unreadCount };
}

/** `POST /notifications/read-all`. */
export async function markAllNotificationsRead(tx: Tx, userId: string): Promise<{ unreadCount: number }> {
  await tx.update(notifications).set({ readAt: sql`now()` }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  queueUserEmit(tx, userId, 'notification:new', { unreadCount: 0 });
  return { unreadCount: 0 };
}

/** `GET` / `PUT /notifications/preferences`: one push switch (`users.push_enabled`, review change 29). In-app rows are always written. */
export async function getPushPreference(conn: Conn, userId: string): Promise<{ push: boolean }> {
  const [u] = await conn.select({ push: users.pushEnabled }).from(users).where(eq(users.id, userId));
  return { push: u?.push ?? true };
}

export async function setPushPreference(conn: Conn, userId: string, push: boolean): Promise<{ push: boolean }> {
  await conn.update(users).set({ pushEnabled: push, updatedAt: sql`now()` }).where(eq(users.id, userId));
  return { push };
}

/** `PUT /users/me/language`: server-rendered text (list and push) follows the app's language. */
export async function setUserLanguage(conn: Conn, userId: string, language: Language): Promise<{ language: Language }> {
  await conn.update(users).set({ language, updatedAt: sql`now()` }).where(eq(users.id, userId));
  return { language };
}
