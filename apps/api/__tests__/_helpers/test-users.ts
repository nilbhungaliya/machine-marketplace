import { eq, inArray } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { businesses, users } from '../../src/db/schema.js';

/**
 * Integration tests share one test database (TEST_DATABASE_URL), so every suite must delete what it
 * creates (in afterAll). Phones are UNIQUE: mint them from a timestamp, never a
 * short random suffix, or a fuller table makes runs collide and fail by chance.
 */
let seq = 0;
export function uniqueTestPhone(): string {
  // +91 9 + 9 digits from the clock and a per-process counter.
  const n = (Date.now() % 1e7) * 100 + (seq++ % 100);
  return `+919${String(n).padStart(9, '0').slice(-9)}`;
}

/**
 * Removes test users and the businesses they created, deepest foreign key first.
 * Extend this as tables that reference users are added (listings, enquiries, offers, deals…).
 */
export async function deleteTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const rows = await db.select({ businessId: users.businessId }).from(users).where(inArray(users.id, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  for (const { businessId } of rows) {
    if (businessId) await db.delete(businesses).where(eq(businesses.id, businessId));
  }
}
