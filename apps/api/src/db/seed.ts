import '../env.js';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, pool } from './index.js';
import { adminUsers } from './schema.js';

/** Creates the first super admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. Idempotent. */
async function main() {
  // Lowercased: loginAdmin looks the address up lowercased.
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env');

  const existing = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, email));
  if (existing.length > 0) {
    console.log(`Admin ${email} already exists — skipped`);
    return;
  }
  await db.insert(adminUsers).values({
    name: 'Super Admin',
    email,
    // Admin close-out §11.2: bcrypt cost 12, as every password the panel sets.
    passwordHash: await bcrypt.hash(password, 12),
    passwordSetAt: new Date(),
    role: 'super_admin',
  });
  console.log(`Seeded super admin ${email}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
