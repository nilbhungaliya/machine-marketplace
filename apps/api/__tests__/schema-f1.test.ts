import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { uniqueTestPhone } from './_helpers/test-users.js';

// F1 + A2 data model (spec 2026-11-18-f1-a2 §9): the constraints the services rely on. Raw SQL on purpose: these
// tests check what the database itself refuses, whatever the service layer does.

const stamp = `${Date.now()}`;
const businessIds: string[] = [];
const userIds: string[] = [];
let areaId = '';
let businessId = '';
let userId = '';

async function rowsOf<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

async function insertBusiness(name: string): Promise<string> {
  const [row] = await rowsOf<{ id: string }>(sql`INSERT INTO businesses (trade_name) VALUES (${name}) RETURNING id`);
  businessIds.push(row!.id);
  return row!.id;
}

async function insertWaitingProof(): Promise<void> {
  await db.execute(sql`
    INSERT INTO gst_representative_proofs (business_id, user_id, gstin, declaration_version, method, status)
    VALUES (${businessId}, ${userId}, '24AAACC0000C1ZY', 1, 'documents', 'waiting')`);
}

async function insertActiveGstVerification(): Promise<void> {
  await db.execute(sql`
    INSERT INTO business_verifications (business_id, level, method, reason)
    VALUES (${businessId}, 'gst', 'provider_otp', 'schema test')`);
}

beforeAll(async () => {
  const [area] = await rowsOf<{ id: string }>(
    sql`INSERT INTO industrial_areas (name, city, state) VALUES (${`Schema Test Estate ${stamp}`}, 'Surat', 'Gujarat') RETURNING id`,
  );
  areaId = area!.id;
  businessId = await insertBusiness(`Schema Test Works ${stamp}`);
  const [user] = await rowsOf<{ id: string }>(
    sql`INSERT INTO users (phone, business_id) VALUES (${uniqueTestPhone()}, ${businessId}) RETURNING id`,
  );
  userId = user!.id;
  userIds.push(userId);
});

afterAll(async () => {
  // Deepest foreign key first.
  if (businessIds.length > 0) {
    const ids = sql.join(businessIds.map((id) => sql`${id}`), sql`, `);
    await db.execute(sql`DELETE FROM business_verifications WHERE business_id IN (${ids})`);
    await db.execute(sql`DELETE FROM gst_representative_proofs WHERE business_id IN (${ids})`);
  }
  for (const id of userIds) await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
  for (const id of businessIds) await db.execute(sql`DELETE FROM businesses WHERE id = ${id}`);
  if (areaId) await db.execute(sql`DELETE FROM industrial_areas WHERE id = ${areaId}`);
});

describe('F1 + A2 schema', () => {
  it('refuses a business with both an industrial area and an "Other" text', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO businesses (trade_name, industrial_area_id, industrial_area_other)
        VALUES (${`Schema Test Both ${stamp}`}, ${areaId}, 'Somewhere else')`),
    ).rejects.toMatchObject({ code: '23514', constraint: 'businesses_area_one_of' });
  });

  it('accepts either an industrial area or an "Other" text on its own', async () => {
    const [withArea] = await rowsOf<{ id: string }>(sql`
      INSERT INTO businesses (trade_name, industrial_area_id) VALUES (${`Schema Test Area ${stamp}`}, ${areaId}) RETURNING id`);
    businessIds.push(withArea!.id);
    const [withOther] = await rowsOf<{ id: string; activities: string[] }>(sql`
      INSERT INTO businesses (trade_name, industrial_area_other) VALUES (${`Schema Test Other ${stamp}`}, 'Kim')
      RETURNING id, activities`);
    businessIds.push(withOther!.id);
    expect(withOther!.activities).toEqual([]);
  });

  it('allows only one open review per business', async () => {
    await insertWaitingProof();
    await expect(insertWaitingProof()).rejects.toMatchObject({ code: '23505', constraint: 'gst_proofs_one_open_review_uq' });
  });

  it('allows only one active GST verification per business', async () => {
    await insertActiveGstVerification();
    await expect(insertActiveGstVerification()).rejects.toMatchObject({
      code: '23505',
      constraint: 'business_verifications_active_uq',
    });
  });

  it('dropped the old role and industrial_area columns', async () => {
    const cols = await rowsOf<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name IN ('role', 'industrial_area')`);
    expect(cols).toEqual([]);
  });

  it('keeps industrial area names unique per city and state, ignoring case', async () => {
    await expect(
      db.execute(sql`INSERT INTO industrial_areas (name, city, state) VALUES (${`SCHEMA TEST ESTATE ${stamp}`}, 'surat', 'Gujarat')`),
    ).rejects.toMatchObject({ code: '23505', constraint: 'industrial_areas_name_city_state_uq' });
  });
});
