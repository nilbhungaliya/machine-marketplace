import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { AdminRole } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog } from '../src/db/schema.js';
import { changedKeys } from '../src/services/admin-insights/audit-mask.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';

// Admin close-out A2-3 (§11.3, R16, D10): super admins read the audit log masked by default (phones in any script and
// emails inside strings, whole values under sensitive keys, anchored so `company` / `expand` stay); "Show" returns the
// entry as stored and writes `audit.reveal` (no values), 30 an hour; the CSV export has no snapshot column or value and
// refuses more than 10 000 rows. This file's app keeps the real admin rate limits (no GROUP_RATE_LIMIT_MAX): each case
// uses its own admin, so only the reveal limit case reaches a limit.

let app: FastifyInstance;
const adminIds: string[] = [];
const ASCII = '9876543210';
const DEVANAGARI = '९८७६५४३२१०';

async function admin(role: AdminRole) {
  const a = await createTestAdmin(role);
  adminIds.push(a.id);
  return a;
}

const call = (method: 'GET' | 'POST', url: string, token: string) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(method === 'POST' ? { payload: {} } : {}) });

/** An entry by `adminId` whose `after` holds a planted number, a PAN and an address. */
async function plant(adminId: string): Promise<string> {
  const [row] = await db
    .insert(auditLog)
    .values({
      adminId,
      action: 'business.update',
      entityType: 'business',
      entityId: randomUUID(),
      before: { note: 'old', company: 'Acme Gears' },
      after: {
        note: `call ${DEVANAGARI}`,
        ownerPan: 'ABCDE1234F',
        gstin: '24AAACC1206D1ZM',
        address: { line1: '12 Ring Road' },
        company: 'Acme Gears',
        expand: 'yes',
        items: [{ contactPhone: `+91${ASCII}` }],
      },
    })
    .returning({ id: auditLog.id });
  return row!.id;
}

beforeAll(async () => {
  const saved = process.env.GROUP_RATE_LIMIT_MAX;
  delete process.env.GROUP_RATE_LIMIT_MAX;
  app = await buildApp({ logger: false });
  process.env.GROUP_RATE_LIMIT_MAX = saved;
});

afterAll(async () => {
  await deleteTestAdmins(adminIds);
  await app.close();
});

describe('masking (R16)', () => {
  it('masks numbers in both scripts and sensitive keys, leaving company and expand', async () => {
    const s = await admin('super_admin');
    const id = await plant(s.id);
    const res = await call('GET', `/admin/audit-log/${id}`, s.token);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.masked).toBe(true);
    expect(res.body).not.toContain(ASCII);
    expect(res.body).not.toContain(DEVANAGARI);
    expect(res.body).not.toContain('ABCDE1234F');
    expect(res.body).not.toContain('12 Ring Road');
    expect(d.after.ownerPan).toBe('•••');
    expect(d.after.address).toBe('•••');
    expect(d.after.gstin).toBe('•••');
    expect(d.after.items[0].contactPhone).toBe('•••');
    expect(d.after.company).toBe('Acme Gears');
    expect(d.after.expand).toBe('yes');
    expect(d.changedKeys).toEqual(['address', 'expand', 'gstin', 'items', 'note', 'ownerPan']);
    expect(d).toMatchObject({ action: 'business.update', label: expect.any(String), admin: { id: s.id } });
  });

  it('lists changed top-level keys', () => {
    expect(changedKeys({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })).toEqual(['b', 'c']);
  });
});

describe('reveal (R16, §17)', () => {
  it('returns the entry as stored and writes audit.reveal with its action only', async () => {
    const s = await admin('super_admin');
    const id = await plant(s.id);
    const res = await call('POST', `/admin/audit-log/${id}/reveal`, s.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.masked).toBe(false);
    expect(res.json().data.after.ownerPan).toBe('ABCDE1234F');
    expect(res.json().data.after.note).toBe(`call ${DEVANAGARI}`);
    const rows = await db
      .select({ before: auditLog.before, after: auditLog.after, entityType: auditLog.entityType })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'audit.reveal'), eq(auditLog.entityId, id)));
    expect(rows).toEqual([{ before: null, after: { action: 'business.update' }, entityType: 'audit_log' }]);
  });

  it('refuses the 31st reveal in an hour', async () => {
    const s = await admin('super_admin');
    const id = await plant(s.id);
    for (let i = 0; i < 30; i++) expect((await call('POST', `/admin/audit-log/${id}/reveal`, s.token)).statusCode).toBe(200);
    const res = await call('POST', `/admin/audit-log/${id}/reveal`, s.token);
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('RATE_LIMITED');
  });
});

describe('list and export (R16, R12, D10)', () => {
  it('filters the list and exports it with no snapshot column or value', async () => {
    const s = await admin('super_admin');
    const author = await admin('support');
    const id = await plant(author.id);

    const list = await call('GET', `/admin/audit-log?adminId=${author.id}&action=business.&pageSize=25`, s.token);
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    expect(list.json().data.rows[0]).toMatchObject({ id, admin: { id: author.id }, href: expect.stringMatching(/^\/businesses\//) });
    expect(list.body).not.toContain('ABCDE1234F');

    const res = await call('GET', `/admin/audit-log/export?adminId=${author.id}`, s.token);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const [header, ...lines] = res.body.replace(/^﻿/, '').trim().split('\r\n');
    expect(header).toBe('Time (IST),Admin,Action,Label,Entity type,Entity id,Entity label,Link');
    expect(header!.toLowerCase()).not.toMatch(/before|after/);
    expect(lines).toHaveLength(1);
    for (const planted of [ASCII, DEVANAGARI, 'ABCDE1234F', '12 Ring Road', 'Acme Gears', 'call']) {
      expect(res.body).not.toContain(planted);
    }
    const [audit] = await db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.adminId, s.id), eq(auditLog.action, 'export.create')));
    expect(audit!.after).toMatchObject({ rowCount: 1, filters: { adminId: author.id } });
  });

  it('refuses an export over 10 000 rows with the count', async () => {
    const s = await admin('super_admin');
    const bulk = await admin('support');
    await db.execute(sql`
      INSERT INTO audit_log (admin_id, action, entity_type, entity_id)
      SELECT ${bulk.id}::uuid, 'test.bulk', 'test', g::text FROM generate_series(1, 10001) g`);
    const res = await call('GET', `/admin/audit-log/export?adminId=${bulk.id}`, s.token);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('EXPORT_TOO_LARGE');
    expect(res.json().details.total).toBe(10001);
  });
});

describe('roles (R16)', () => {
  it('gives a moderator 403 on every audit route', async () => {
    const m = await admin('moderator');
    const id = randomUUID();
    const routes: Array<['GET' | 'POST', string]> = [
      ['GET', '/admin/audit-log'],
      ['GET', '/admin/audit-log/facets'],
      ['GET', '/admin/audit-log/export'],
      ['GET', `/admin/audit-log/${id}`],
      ['POST', `/admin/audit-log/${id}/reveal`],
    ];
    for (const [method, url] of routes) expect((await call(method, url, m.token)).statusCode, url).toBe(403);
  });
});
