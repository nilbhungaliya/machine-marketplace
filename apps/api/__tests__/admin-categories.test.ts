import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { AdminCategoryDetail, CategoryNode } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog, categories, machineModels, brands, templateFields } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestCatalog, deleteTestCatalog } from './_helpers/test-catalog.js';

describe('admin category nodes API', () => {
  let app: FastifyInstance;
  let manager: { id: string; token: string };
  let moderator: { id: string; token: string };
  /** Every root this suite created (through the API or the fixture): deleted with its whole subtree. */
  const rootIds: string[] = [];
  const brandIds: string[] = [];
  let seq = 0;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    manager = await createTestAdmin('category_manager');
    moderator = await createTestAdmin('moderator');
  });

  afterAll(async () => {
    // Before app.close(): closing the app ends the shared pg pool.
    for (const id of rootIds) await deleteTestCatalog(id); // also deletes machine models of its types
    for (const id of brandIds) await db.delete(brands).where(eq(brands.id, id));
    await deleteTestAdmins([manager?.id, moderator?.id].filter((id): id is string => !!id));
    await app?.close();
  });

  function call(method: InjectOptions['method'], url: string, body?: unknown, token = manager.token) {
    return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: body as InjectOptions['payload'] });
  }

  async function create(body: Record<string, unknown>): Promise<CategoryNode> {
    const res = await call('POST', '/admin/categories', body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as CategoryNode;
  }

  /** A fresh machine category with a timestamped slug, registered for cleanup. */
  async function createRoot(): Promise<CategoryNode> {
    const slug = `test-cat-${Date.now()}${seq++}`;
    const node = await create({ parentId: null, name: `Test Cat ${slug}`, slug, icon: 'factory' });
    rootIds.push(node.id);
    return node;
  }

  async function fixture() {
    const cat = await createTestCatalog();
    rootIds.push(cat.categoryId);
    return cat;
  }

  async function row(id: string) {
    const [r] = await db.select().from(categories).where(eq(categories.id, id));
    return r!;
  }

  async function addField(
    categoryId: string,
    f: { key: string; appliesTo: 'parts' | 'machines' | 'both'; highlightRank?: number; status?: 'active' | 'retired' },
  ) {
    await db.insert(templateFields).values({
      categoryId,
      key: f.key,
      label: f.key,
      type: 'text',
      appliesTo: f.appliesTo,
      highlightRank: f.highlightRank ?? null,
      status: f.status ?? 'active',
    });
  }

  async function nodeDetail(id: string) {
    return (await call('GET', `/admin/categories/${id}`)).json().data as AdminCategoryDetail;
  }

  it('creates category → machine type → part group with derived levels and paths', async () => {
    const root = await createRoot();
    expect(root).toMatchObject({ level: 'machine_category', parentId: null, icon: 'factory', path: root.slug, isActive: true });

    const type = await create({ parentId: root.id, name: 'Water Jet Loom' });
    expect(type).toMatchObject({
      level: 'machine_type',
      parentId: root.id,
      slug: 'water-jet-loom',
      path: `${root.slug}/water-jet-loom`,
      icon: null,
      sortOrder: 0,
    });

    const group = await create({ parentId: type.id, name: 'Temples' });
    expect(group).toMatchObject({ level: 'part_group', slug: 'temples', path: `${root.slug}/water-jet-loom/temples`, sortOrder: 0 });

    const second = await create({ parentId: type.id, name: "Men's Motors", hasSides: false, sideConvention: '  Seen from the front  ' });
    expect(second).toMatchObject({ slug: 'mens-motors', sortOrder: 1, hasSides: false, sideConvention: 'Seen from the front' });
  });

  it('child of a part group → 400 INVALID_PARENT; icon on a machine type → 400 FIELD_INVALID', async () => {
    const root = await createRoot();
    const type = await create({ parentId: root.id, name: 'Loom' });
    const group = await create({ parentId: type.id, name: 'Temples' });

    const deep = await call('POST', '/admin/categories', { parentId: group.id, name: 'Too deep' });
    expect(deep.statusCode).toBe(400);
    expect(deep.json().code).toBe('INVALID_PARENT');

    const icon = await call('POST', '/admin/categories', { parentId: root.id, name: 'Iconic', icon: 'cog' });
    expect(icon.statusCode).toBe(400);
    expect(icon.json().code).toBe('FIELD_INVALID');

    const patchIcon = await call('PATCH', `/admin/categories/${type.id}`, { icon: 'cog' });
    expect(patchIcon.statusCode).toBe(400);
    expect(patchIcon.json().code).toBe('FIELD_INVALID');
  });

  it('same slug twice under one parent → 409 SLUG_TAKEN, also when two requests race', async () => {
    const root = await createRoot();
    await create({ parentId: root.id, name: 'Loom' });
    const dup = await call('POST', '/admin/categories', { parentId: root.id, name: 'Loom' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('SLUG_TAKEN');

    const knitting = await create({ parentId: root.id, name: 'Knitting' });
    const patch = await call('PATCH', `/admin/categories/${knitting.id}`, { slug: 'loom' });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().code).toBe('SLUG_TAKEN');

    const results = await Promise.all([
      call('POST', '/admin/categories', { parentId: root.id, name: 'Dobby' }),
      call('POST', '/admin/categories', { parentId: root.id, name: 'Dobby' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('SLUG_TAKEN');
  });

  it('moderator can GET but POST → 403 FORBIDDEN', async () => {
    const get = await call('GET', '/admin/categories', undefined, moderator.token);
    expect(get.statusCode).toBe(200);
    expect(Array.isArray(get.json().data)).toBe(true);

    const post = await call('POST', '/admin/categories', { parentId: null, name: `Nope ${Date.now()}` }, moderator.token);
    if (post.statusCode === 201) rootIds.push(post.json().data.id); // never leave a stray row
    expect(post.statusCode).toBe(403);
    expect(post.json().code).toBe('FORBIDDEN');

    const anon = await app.inject({ method: 'GET', url: '/admin/categories' });
    expect(anon.statusCode).toBe(401);
  });

  it('GET /admin/categories includes inactive nodes; detail has own and inherited fields', async () => {
    const cat = await fixture();
    const off = await call('PATCH', `/admin/categories/${cat.motorsGroupId}`, { isActive: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().data.isActive).toBe(false);

    const tree = (await call('GET', '/admin/categories')).json().data as CategoryNode[];
    const root = tree.find((n) => n.id === cat.categoryId)!;
    expect(root.children[0]!.children.find((n) => n.id === cat.motorsGroupId)?.isActive).toBe(false);

    const detail = await nodeDetail(cat.partGroupId);
    expect(detail.node).toMatchObject({ effectiveHasSides: true, effectiveSideConvention: 'Seen by the weaver' });
    expect(detail.ownFields.map((f) => f.key)).toEqual(['temple_type']);
    expect(detail.inheritedFields.map((f) => f.key).sort()).toEqual(['frame_width', 'loom_part_note', 'old_note', 'reed_space']);
    expect(detail.ownFields[0]!.options.map((o) => o.key)).toEqual(['ring', 'roller']);
    // Ancestor order: the category's retired field first, then the machine type's.
    expect(detail.inheritedFields[0]!.key).toBe('old_note');
  });

  it('renaming a category slug rewrites every descendant path', async () => {
    const root = await createRoot();
    const type = await create({ parentId: root.id, name: 'Loom' });
    const group = await create({ parentId: type.id, name: 'Temples' });
    const newSlug = `${root.slug}-renamed`;

    const res = await call('PATCH', `/admin/categories/${root.id}`, { slug: newSlug, name: 'Renamed' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toMatchObject({ slug: newSlug, path: newSlug, name: 'Renamed' });
    expect((await row(type.id)).path).toBe(`${newSlug}/loom`);
    expect((await row(group.id)).path).toBe(`${newSlug}/loom/temples`);

    // A machine type slug change rewrites only its own subtree.
    const other = await create({ parentId: root.id, name: 'Knitting' });
    const renamed = await call('PATCH', `/admin/categories/${type.id}`, { slug: 'weaving' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect((await row(group.id)).path).toBe(`${newSlug}/weaving/temples`);
    expect((await row(other.id)).path).toBe(`${newSlug}/knitting`);
  });

  it('moving a machine type rewrites its subtree paths; category and bad targets → 400 MOVE_NOT_ALLOWED', async () => {
    const from = await createRoot();
    const to = await createRoot();
    const keep = await create({ parentId: to.id, name: 'Existing' });
    const type = await create({ parentId: from.id, name: 'Water Jet Loom' });
    const group = await create({ parentId: type.id, name: 'Temples' });

    const res = await call('POST', `/admin/categories/${type.id}/move`, { parentId: to.id });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toMatchObject({ parentId: to.id, path: `${to.slug}/water-jet-loom`, sortOrder: keep.sortOrder + 1 });
    expect((await row(group.id)).path).toBe(`${to.slug}/water-jet-loom/temples`);
    expect((await row(group.id)).parentId).toBe(type.id);

    // A category never moves; a machine type needs a category; a part group needs a machine type.
    for (const [id, parentId] of [
      [from.id, to.id],
      [type.id, keep.id],
      [group.id, to.id],
    ] as const) {
      const bad = await call('POST', `/admin/categories/${id}/move`, { parentId });
      expect(bad.statusCode, `${id}`).toBe(400);
      expect(bad.json().code).toBe('MOVE_NOT_ALLOWED');
    }
    // Unknown destination.
    const missing = await call('POST', `/admin/categories/${type.id}/move`, { parentId: '00000000-0000-4000-8000-000000000000' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe('MOVE_NOT_ALLOWED');

    // Same slug at the destination → 409 SLUG_TAKEN, nothing changed.
    const clone = await create({ parentId: from.id, name: 'Water Jet Loom' });
    const taken = await call('POST', `/admin/categories/${clone.id}/move`, { parentId: to.id });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().code).toBe('SLUG_TAKEN');
    expect((await row(clone.id)).path).toBe(`${from.slug}/water-jet-loom`);
    expect((await row(clone.id)).parentId).toBe(from.id);
  });

  it('moving a part group: key on the destination → 409 KEY_TAKEN; ranks respect appliesTo overlap', async () => {
    const cat = await fixture();
    const dest = await create({ parentId: cat.categoryId, name: 'Dest Type' });
    const clean = await create({ parentId: cat.categoryId, name: 'Clean Type' });
    const typeMachines = await create({ parentId: cat.categoryId, name: 'Type Machines' });
    const typeBoth = await create({ parentId: cat.categoryId, name: 'Type Both' });
    const group = await create({ parentId: clean.id, name: 'Group G' });

    // Key clash against the destination type's own field, whatever its status or appliesTo.
    await addField(dest.id, { key: 'dest_key', appliesTo: 'machines', status: 'retired' });
    await addField(group.id, { key: 'dest_key', appliesTo: 'parts' });
    const clash = await call('POST', `/admin/categories/${group.id}/move`, { parentId: dest.id });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().code).toBe('KEY_TAKEN');
    expect((await row(group.id)).parentId).toBe(clean.id);
    expect((await row(group.id)).path).toBe(`${cat.categorySlug}/clean-type/group-g`);

    // Rank 1, parts-only, under a machines-only rank-1 field: allowed. Under a both rank-1 field: refused.
    await db.delete(templateFields).where(and(eq(templateFields.categoryId, group.id), eq(templateFields.key, 'dest_key')));
    await addField(group.id, { key: 'g_rank', appliesTo: 'parts', highlightRank: 1 });
    await addField(typeMachines.id, { key: 'm_rank', appliesTo: 'machines', highlightRank: 1 });
    await addField(typeBoth.id, { key: 'b_rank', appliesTo: 'both', highlightRank: 1 });
    const ok = await call('POST', `/admin/categories/${group.id}/move`, { parentId: typeMachines.id });
    expect(ok.statusCode, ok.body).toBe(200);
    const refused = await call('POST', `/admin/categories/${group.id}/move`, { parentId: typeBoth.id });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('RANK_TAKEN');
    expect((await row(group.id)).parentId).toBe(typeMachines.id);
  });

  it('moving a machine type checks its groups against the destination category fields', async () => {
    const dest = await fixture(); // its category owns old_note (retired) and nothing at rank 1
    const free = await createRoot();
    const type = await create({ parentId: free.id, name: 'Free Type' });
    const group = await create({ parentId: type.id, name: 'Free Group' });
    await addField(group.id, { key: 'old_note', appliesTo: 'parts' });

    const res = await call('POST', `/admin/categories/${type.id}/move`, { parentId: dest.categoryId });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('KEY_TAKEN');
    expect((await row(type.id)).parentId).toBe(free.id);
    expect((await row(group.id)).path).toBe(`${free.slug}/free-type/free-group`);

    // A rank on the moved type's own field vs an active category-level rank on the destination.
    await db.update(templateFields).set({ key: 'renamed_note' }).where(eq(templateFields.categoryId, group.id));
    await addField(dest.categoryId, { key: 'cat_rank', appliesTo: 'both', highlightRank: 3 });
    await addField(type.id, { key: 'type_rank', appliesTo: 'machines', highlightRank: 3 });
    const rank = await call('POST', `/admin/categories/${type.id}/move`, { parentId: dest.categoryId });
    expect(rank.statusCode).toBe(409);
    expect(rank.json().code).toBe('RANK_TAKEN');
  });

  it('two moves in opposite directions between the same two categories both succeed (roots locked in id order, no deadlock)', async () => {
    const a = await createRoot();
    const b = await createRoot();
    for (let round = 0; round < 3; round++) {
      const fromA = await create({ parentId: a.id, name: `From A ${round}` });
      const fromB = await create({ parentId: b.id, name: `From B ${round}` });
      await create({ parentId: fromA.id, name: 'Group' });
      const [ab, ba] = await Promise.all([
        call('POST', `/admin/categories/${fromA.id}/move`, { parentId: b.id }),
        call('POST', `/admin/categories/${fromB.id}/move`, { parentId: a.id }),
      ]);
      expect(ab.statusCode, ab.body).toBe(200);
      expect(ba.statusCode, ba.body).toBe(200);
      expect((await row(fromA.id)).path).toBe(`${b.slug}/from-a-${round}`);
      expect((await row(fromB.id)).path).toBe(`${a.slug}/from-b-${round}`);
    }
  });

  it('hasSides null after true makes the node inherit again; a moved part group takes its new parent sides', async () => {
    const cat = await fixture();
    const noSides = await create({ parentId: cat.categoryId, name: 'No Sides Type', hasSides: false });
    const group = await create({ parentId: noSides.id, name: 'Group H' });
    expect(group).toMatchObject({ hasSides: null, effectiveHasSides: false });

    const on = await call('PATCH', `/admin/categories/${group.id}`, { hasSides: true, sideConvention: 'Own rule' });
    expect(on.json().data).toMatchObject({ hasSides: true, effectiveHasSides: true, effectiveSideConvention: 'Own rule' });
    const off = await call('PATCH', `/admin/categories/${group.id}`, { hasSides: null, sideConvention: '   ' });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().data).toMatchObject({ hasSides: null, sideConvention: null, effectiveHasSides: false });

    // Moves under the loom (hasSides true, own convention): the group inherits both.
    const moved = await call('POST', `/admin/categories/${group.id}/move`, { parentId: cat.machineTypeId });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().data).toMatchObject({ effectiveHasSides: true, effectiveSideConvention: 'Seen by the weaver' });
    expect((await nodeDetail(group.id)).node.effectiveHasSides).toBe(true);
  });

  it('reorder with the exact sibling ids sets order; a missing or extra id → 409 STALE_ORDER and order unchanged', async () => {
    const root = await createRoot();
    const a = await create({ parentId: root.id, name: 'Alpha' });
    const b = await create({ parentId: root.id, name: 'Beta' });
    const c = await create({ parentId: root.id, name: 'Gamma' });
    const orderOf = () => Promise.all([a, b, c].map(async (n) => (await row(n.id)).sortOrder));

    const ok = await call('POST', '/admin/categories/reorder', { parentId: root.id, orderedIds: [c.id, a.id, b.id] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await orderOf()).toEqual([1, 2, 0]);

    for (const orderedIds of [[c.id, a.id], [c.id, a.id, b.id, root.id], [c.id, c.id, a.id]]) {
      const stale = await call('POST', '/admin/categories/reorder', { parentId: root.id, orderedIds });
      expect(stale.statusCode, JSON.stringify(orderedIds)).toBe(409);
      expect(stale.json().code).toBe('STALE_ORDER');
    }
    expect(await orderOf()).toEqual([1, 2, 0]);
  });

  it('delete a leaf part group → 200; a node with children, fields or models → 409 NODE_IN_USE', async () => {
    const root = await createRoot();
    const type = await create({ parentId: root.id, name: 'Loom' });
    const group = await create({ parentId: type.id, name: 'Temples' });
    const withFields = await create({ parentId: type.id, name: 'With Fields' });
    await addField(withFields.id, { key: 'old_field', appliesTo: 'parts', status: 'retired' });
    const lonely = await create({ parentId: root.id, name: 'Lonely Type' });
    const [brand] = await db
      .insert(brands)
      .values({ key: `test_brand_${Date.now()}`, name: 'Test Brand', slug: `test-brand-${Date.now()}` })
      .returning({ id: brands.id });
    brandIds.push(brand!.id);
    await db.insert(machineModels).values({ key: 'm1', brandId: brand!.id, machineTypeId: lonely.id, name: 'M1' });

    for (const id of [root.id, type.id, withFields.id, lonely.id]) {
      const res = await call('DELETE', `/admin/categories/${id}`);
      expect(res.statusCode, id).toBe(409);
      expect(res.json().code).toBe('NODE_IN_USE');
    }

    const del = await call('DELETE', `/admin/categories/${group.id}`);
    expect(del.statusCode, del.body).toBe(200);
    expect((await db.select().from(categories).where(eq(categories.id, group.id))).length).toBe(0);
    expect((await call('DELETE', `/admin/categories/${group.id}`)).statusCode).toBe(404);
  });

  it('every mutation writes an audit row', async () => {
    const root = await createRoot();
    const to = await createRoot();
    const from = await create({ parentId: root.id, name: 'Audit From' });
    await call('PATCH', `/admin/categories/${from.id}`, { name: 'Audit Renamed' });
    await call('POST', `/admin/categories/${from.id}/move`, { parentId: to.id });
    await call('POST', '/admin/categories/reorder', { parentId: to.id, orderedIds: [from.id] });
    const leaf = await create({ parentId: from.id, name: 'Leaf' });
    await call('DELETE', `/admin/categories/${leaf.id}`);

    const audit = (action: string, entityId: string) =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.adminId, manager.id), eq(auditLog.action, action), eq(auditLog.entityId, entityId)));

    const [created] = await audit('category.create', from.id);
    expect(created).toMatchObject({ entityType: 'category', before: null });
    expect(created!.after).toMatchObject({ name: 'Audit From', path: `${root.slug}/audit-from` });

    const [updated] = await audit('category.update', from.id);
    expect(updated!.before).toMatchObject({ name: 'Audit From' });
    expect(updated!.after).toMatchObject({ name: 'Audit Renamed' });

    const [moved] = await audit('category.move', from.id);
    expect(moved!.before).toMatchObject({ path: `${root.slug}/audit-from` });
    expect(moved!.after).toMatchObject({ path: `${to.slug}/audit-from` });

    const [reordered] = await audit('category.reorder', to.id);
    expect(reordered!.after).toEqual([from.id]);

    const [deleted] = await audit('category.delete', leaf.id);
    expect(deleted).toMatchObject({ after: null });
    expect(deleted!.before).toMatchObject({ name: 'Leaf' });
  });
});
