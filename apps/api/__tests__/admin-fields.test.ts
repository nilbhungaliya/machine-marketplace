import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { AdminCategoryDetail, CategoryNode, EffectiveTemplate, FieldOption, TemplateField } from '@mpm/shared-types';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { auditLog } from '../src/db/schema.js';
import { createTestAdmin, deleteTestAdmins } from './_helpers/test-admins.js';
import { createTestCatalog, deleteTestCatalog, type TestCatalog } from './_helpers/test-catalog.js';

describe('admin template fields and options API', () => {
  let app: FastifyInstance;
  let manager: { id: string; token: string };
  let moderator: { id: string; token: string };
  /** Every root this suite created: deleted with its whole subtree. */
  const rootIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    manager = await createTestAdmin('category_manager');
    moderator = await createTestAdmin('moderator');
  });

  afterAll(async () => {
    // Before app.close(): closing the app ends the shared pg pool.
    for (const id of rootIds) await deleteTestCatalog(id);
    await deleteTestAdmins([manager?.id, moderator?.id].filter((id): id is string => !!id));
    await app?.close();
  });

  function call(method: InjectOptions['method'], url: string, body?: unknown, token = manager.token) {
    return app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: body as InjectOptions['payload'] });
  }

  async function fixture(): Promise<TestCatalog> {
    const cat = await createTestCatalog();
    rootIds.push(cat.categoryId);
    return cat;
  }

  async function createField(categoryId: string, body: Record<string, unknown>): Promise<TemplateField> {
    const res = await call('POST', `/admin/categories/${categoryId}/fields`, body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as TemplateField;
  }

  async function createNode(body: Record<string, unknown>): Promise<CategoryNode> {
    const res = await call('POST', '/admin/categories', body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as CategoryNode;
  }

  async function detail(id: string): Promise<AdminCategoryDetail> {
    return (await call('GET', `/admin/categories/${id}`)).json().data as AdminCategoryDetail;
  }

  async function template(nodeId: string, kind: 'part' | 'machine'): Promise<EffectiveTemplate> {
    const res = await app.inject({ method: 'GET', url: `/categories/${nodeId}/template?kind=${kind}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data as EffectiveTemplate;
  }

  it('creates a number field on a machine type with unit, range and appliesTo', async () => {
    const cat = await fixture();
    const field = await createField(cat.machineTypeId, {
      key: 'nozzle_count',
      label: 'Nozzle count',
      helpText: 'Main and relay nozzles',
      type: 'number',
      appliesTo: 'machines',
      unit: 'pcs',
      min: 1,
      max: 120.5,
      required: true,
      filterable: true,
      highlightRank: 3,
    });
    expect(field).toMatchObject({
      categoryId: cat.machineTypeId,
      key: 'nozzle_count',
      label: 'Nozzle count',
      helpText: 'Main and relay nozzles',
      type: 'number',
      appliesTo: 'machines',
      unit: 'pcs',
      min: 1,
      max: 120.5,
      required: true,
      filterable: true,
      highlightRank: 3,
      status: 'active',
      options: [],
    });
    // The loom already owns reed_space (0), frame_width (1) and loom_part_note (2): the new field goes last.
    expect(field.sortOrder).toBe(3);
    expect((await detail(cat.machineTypeId)).ownFields.map((f) => f.key)).toEqual(['reed_space', 'frame_width', 'loom_part_note', 'nozzle_count']);

    // Defaults when optional values are left out: appliesTo both, no unit/range/rank, not required.
    const plain = await createField(cat.machineTypeId, { key: 'finish_note', label: 'Finish note', type: 'text' });
    expect(plain).toMatchObject({ appliesTo: 'both', unit: null, min: null, max: null, required: false, filterable: false, highlightRank: null, helpText: null });

    // Blank help text is stored as null, on create and on update.
    const blank = await createField(cat.machineTypeId, { key: 'blank_help', label: 'Blank help', type: 'text', helpText: '   ' });
    expect(blank.helpText).toBeNull();
    const cleared = await call('PATCH', `/admin/fields/${field.id}`, { helpText: ' \t ' });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().data.helpText).toBeNull();

    // A machines-only field shows on the machine template, not on the part template.
    expect((await template(cat.machineTypeId, 'machine')).fields.map((f) => f.key)).toContain('nozzle_count');
    expect((await template(cat.partGroupId, 'part')).fields.map((f) => f.key)).not.toContain('nozzle_count');
  });

  it('unit on a text field, min > max, a machines-only field on a part group → 400 FIELD_INVALID', async () => {
    const cat = await fixture();
    const loom = cat.machineTypeId;

    const unit = await call('POST', `/admin/categories/${loom}/fields`, { key: 'finish', label: 'Finish', type: 'text', unit: 'cm' });
    expect(unit.statusCode).toBe(400);
    expect(unit.json().code).toBe('FIELD_INVALID');

    const range = await call('POST', `/admin/categories/${loom}/fields`, { key: 'width', label: 'Width', type: 'number', min: 60, max: 40 });
    expect(range.statusCode).toBe(400);
    expect(range.json().code).toBe('FIELD_INVALID');

    // It could never show: a part group's fields reach part templates only.
    const machinesOnGroup = await call('POST', `/admin/categories/${cat.partGroupId}/fields`, {
      key: 'head_count',
      label: 'Heads',
      type: 'number',
      appliesTo: 'machines',
    });
    expect(machinesOnGroup.statusCode).toBe(400);
    expect(machinesOnGroup.json().code).toBe('FIELD_INVALID');

    // PATCH checks the merged values: min above a stored max.
    expect((await call('PATCH', `/admin/fields/${cat.fieldIds.reedSpace}`, { max: 200 })).statusCode).toBe(200);
    const patch = await call('PATCH', `/admin/fields/${cat.fieldIds.reedSpace}`, { min: 300 });
    expect(patch.statusCode).toBe(400);
    expect(patch.json().code).toBe('FIELD_INVALID');

    // Bad key shape, out-of-range rank and an unknown appliesTo are input errors.
    for (const body of [
      { key: 'Bad Key', label: 'X', type: 'text' },
      { key: 'ok_key', label: 'X', type: 'text', highlightRank: 7 },
      { key: 'ok_key', label: 'X', type: 'text', appliesTo: 'everything' },
    ]) {
      const res = await call('POST', `/admin/categories/${loom}/fields`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }

    expect((await detail(loom)).ownFields.map((f) => f.key)).toEqual(['reed_space', 'frame_width', 'loom_part_note']);
    expect((await detail(cat.partGroupId)).ownFields.map((f) => f.key)).toEqual(['temple_type']);
  });

  it('key frame_width on Test Temples → 409 KEY_TAKEN; key temple_type on Test Loom → 409 KEY_TAKEN', async () => {
    const cat = await fixture();

    // Ancestor clash (whatever appliesTo); a retired key (old_note, on the category) is still taken.
    for (const [key, appliesTo] of [
      ['frame_width', 'parts'],
      ['reed_space', 'parts'],
      ['old_note', 'both'],
    ] as const) {
      const res = await call('POST', `/admin/categories/${cat.partGroupId}/fields`, { key, label: 'X', type: 'text', appliesTo });
      expect(res.statusCode, key).toBe(409);
      expect(res.json().code).toBe('KEY_TAKEN');
    }

    // Descendant clash: Test Temples owns temple_type; the loom and the category are both refused.
    for (const nodeId of [cat.machineTypeId, cat.categoryId]) {
      const res = await call('POST', `/admin/categories/${nodeId}/fields`, { key: 'temple_type', label: 'X', type: 'text', appliesTo: 'machines' });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('KEY_TAKEN');
    }
    // The loom's reed_space blocks the category too.
    const reed = await call('POST', `/admin/categories/${cat.categoryId}/fields`, { key: 'reed_space', label: 'X', type: 'text' });
    expect(reed.json().code).toBe('KEY_TAKEN');

    // Same key on the same node.
    const same = await call('POST', `/admin/categories/${cat.partGroupId}/fields`, { key: 'temple_type', label: 'X', type: 'text' });
    expect(same.json().code).toBe('KEY_TAKEN');

    // A sibling part group has its own effective template: temple_type on Test Motors is fine.
    await createField(cat.motorsGroupId, { key: 'temple_type', label: 'Temple type', type: 'text', appliesTo: 'parts' });
  });

  it('rank 1 parts-only on Test Temples is allowed beside reed_space (machines, rank 1); rank 2 parts-only → 409 RANK_TAKEN (frame_width is both, rank 2)', async () => {
    const cat = await fixture();

    const rank1 = await createField(cat.partGroupId, { key: 'temple_width', label: 'Temple width', type: 'number', appliesTo: 'parts', highlightRank: 1 });
    expect(rank1).toMatchObject({ appliesTo: 'parts', highlightRank: 1 });

    const rank2 = await call('POST', `/admin/categories/${cat.partGroupId}/fields`, {
      key: 'temple_rings',
      label: 'Rings',
      type: 'number',
      appliesTo: 'parts',
      highlightRank: 2,
    });
    expect(rank2.statusCode).toBe(409);
    expect(rank2.json().code).toBe('RANK_TAKEN');

    // Descendants count too: a both rank-1 field on the category would sit beside temple_width in the part template.
    const onCategory = await call('POST', `/admin/categories/${cat.categoryId}/fields`, { key: 'cat_rank', label: 'X', type: 'text', highlightRank: 1 });
    expect(onCategory.statusCode).toBe(409);
    expect(onCategory.json().code).toBe('RANK_TAKEN');
    // ...but a machines-only rank 3 on the category is free (reed_space is 1, frame_width 2).
    await createField(cat.categoryId, { key: 'cat_machines', label: 'X', type: 'text', appliesTo: 'machines', highlightRank: 3 });

    // A rank change on PATCH is checked too: temple_type (parts) → rank 2 meets frame_width (both).
    const patchRank = await call('PATCH', `/admin/fields/${cat.fieldIds.templeType}`, { highlightRank: 2 });
    expect(patchRank.statusCode).toBe(409);
    expect(patchRank.json().code).toBe('RANK_TAKEN');

    // Retiring frame_width frees rank 2.
    const retire = await call('PATCH', `/admin/fields/${cat.fieldIds.frameWidth}`, { status: 'retired' });
    expect(retire.statusCode, retire.body).toBe(200);
    expect(retire.json().data).toMatchObject({ status: 'retired', highlightRank: 2 });
    const moved = await call('PATCH', `/admin/fields/${cat.fieldIds.templeType}`, { highlightRank: 2 });
    expect(moved.statusCode, moved.body).toBe(200);

    // Reactivating frame_width would put rank 2 twice in Test Temples' part template.
    const reactivate = await call('PATCH', `/admin/fields/${cat.fieldIds.frameWidth}`, { status: 'active' });
    expect(reactivate.statusCode).toBe(409);
    expect(reactivate.json().code).toBe('RANK_TAKEN');
    // ...but reactivating with the rank cleared works.
    const cleared = await call('PATCH', `/admin/fields/${cat.fieldIds.frameWidth}`, { status: 'active', highlightRank: null });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().data).toMatchObject({ status: 'active', highlightRank: null });
  });

  it('PATCH with appliesTo, key or type → 400', async () => {
    const cat = await fixture();
    for (const body of [{ appliesTo: 'parts' }, { key: 'reed' }, { type: 'text' }, { label: 'Reed', appliesTo: 'both' }, {}]) {
      const res = await call('PATCH', `/admin/fields/${cat.fieldIds.reedSpace}`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    const ok = await call('PATCH', `/admin/fields/${cat.fieldIds.reedSpace}`, { label: 'Reed space (nominal)', unit: 'mm', min: 0, required: true });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data).toMatchObject({
      key: 'reed_space',
      type: 'number',
      appliesTo: 'machines',
      label: 'Reed space (nominal)',
      unit: 'mm',
      min: 0,
      max: null,
      required: true,
      highlightRank: 1,
    });

    // Unit on a select field via PATCH is refused like on create.
    const unit = await call('PATCH', `/admin/fields/${cat.fieldIds.templeType}`, { unit: 'cm' });
    expect(unit.statusCode).toBe(400);
    expect(unit.json().code).toBe('FIELD_INVALID');

    const missing = await call('PATCH', '/admin/fields/00000000-0000-4000-8000-000000000000', { label: 'X' });
    expect(missing.statusCode).toBe(404);
  });

  it('creating the same field twice in parallel → one 201, one 409 KEY_TAKEN (never 500)', async () => {
    const cat = await fixture();
    const body = { key: 'temple_dia', label: 'Diameter', type: 'number', appliesTo: 'parts' };
    const results = await Promise.all([
      call('POST', `/admin/categories/${cat.partGroupId}/fields`, body),
      call('POST', `/admin/categories/${cat.partGroupId}/fields`, body),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('KEY_TAKEN');

    // Same key on a node and its parent at once: the root lock orders them, so the second still sees the first.
    const pair = await Promise.all([
      call('POST', `/admin/categories/${cat.machineTypeId}/fields`, { key: 'gauge', label: 'Gauge', type: 'text' }),
      call('POST', `/admin/categories/${cat.motorsGroupId}/fields`, { key: 'gauge', label: 'Gauge', type: 'text', appliesTo: 'parts' }),
    ]);
    expect(pair.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(pair.find((r) => r.statusCode === 409)!.json().code).toBe('KEY_TAKEN');
  });

  it('a field create racing a move of its part group under a clashing machine type: exactly one wins', async () => {
    const cat = await fixture();
    const other = await fixture(); // another root: the move locks both
    const dest = await createNode({ parentId: other.categoryId, name: 'Dest Loom' });
    await createField(dest.id, { key: 'race_key', label: 'Race key', type: 'text' });

    for (let round = 0; round < 3; round++) {
      const group = await createNode({ parentId: cat.machineTypeId, name: `Race Group ${round}` });
      const [create, move] = await Promise.all([
        call('POST', `/admin/categories/${group.id}/fields`, { key: 'race_key', label: 'Race key', type: 'text', appliesTo: 'parts' }),
        call('POST', `/admin/categories/${group.id}/move`, { parentId: dest.id }),
      ]);
      // One of them succeeded, the other was refused with KEY_TAKEN (never both, never a 500 deadlock).
      const won = { create: create.statusCode === 201, move: move.statusCode === 200 };
      expect(Number(won.create) + Number(won.move), `${create.body} | ${move.body}`).toBe(1);
      const refused = won.create ? move : create;
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().code).toBe('KEY_TAKEN');

      // Whatever the order, the group's template holds race_key once.
      const groupNow = await detail(group.id);
      expect([...groupNow.inheritedFields, ...groupNow.ownFields].filter((f) => f.key === 'race_key').length).toBe(1);
      expect(groupNow.node.parentId).toBe(won.create ? cat.machineTypeId : dest.id);
    }
  });

  it('retire then reactivate a field and an option', async () => {
    const cat = await fixture();
    const temples = cat.partGroupId;

    const before = await template(temples, 'part');
    expect(before.fields.map((f) => f.key)).toEqual(['frame_width', 'loom_part_note', 'temple_type']);
    expect(before.fields.find((f) => f.key === 'temple_type')!.options.map((o) => o.key)).toEqual(['ring']);

    expect((await call('PATCH', `/admin/fields/${cat.fieldIds.frameWidth}`, { status: 'retired' })).statusCode).toBe(200);
    const optRetire = await call('PATCH', `/admin/options/${cat.optionIds.ring}`, { status: 'retired' });
    expect(optRetire.statusCode, optRetire.body).toBe(200);
    expect(optRetire.json().data).toMatchObject({ key: 'ring', status: 'retired' });

    const hidden = await template(temples, 'part');
    expect(hidden.fields.map((f) => f.key)).toEqual(['loom_part_note', 'temple_type']);
    expect(hidden.fields.find((f) => f.key === 'temple_type')!.options).toEqual([]);

    // The admin detail still shows them, retired.
    const d = await detail(temples);
    expect(d.inheritedFields.find((f) => f.key === 'frame_width')!.status).toBe('retired');
    expect(d.ownFields[0]!.options.map((o) => [o.key, o.status])).toEqual([
      ['ring', 'retired'],
      ['roller', 'retired'],
    ]);

    expect((await call('PATCH', `/admin/fields/${cat.fieldIds.frameWidth}`, { status: 'active' })).statusCode).toBe(200);
    const optBack = await call('PATCH', `/admin/options/${cat.optionIds.ring}`, { status: 'active', label: 'Ring temple' });
    expect(optBack.statusCode).toBe(200);
    // roller was retired by the fixture: reactivate it too.
    expect((await call('PATCH', `/admin/options/${cat.optionIds.roller}`, { status: 'active' })).statusCode).toBe(200);

    const back = await template(temples, 'part');
    expect(back.fields.map((f) => f.key)).toEqual(['frame_width', 'loom_part_note', 'temple_type']);
    expect(back.fields.find((f) => f.key === 'temple_type')!.options.map((o) => [o.key, o.label])).toEqual([
      ['ring', 'Ring temple'],
      ['roller', 'Roller'],
    ]);

    // PATCH /admin/options with nothing, or with a key → 400.
    for (const body of [{}, { key: 'ring2' }]) {
      expect((await call('PATCH', `/admin/options/${cat.optionIds.ring}`, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('option on a number field → 400 FIELD_INVALID; duplicate option key → 409 KEY_TAKEN; options reorder', async () => {
    const cat = await fixture();

    const onNumber = await call('POST', `/admin/fields/${cat.fieldIds.reedSpace}/options`, { key: 'wide', label: 'Wide' });
    expect(onNumber.statusCode).toBe(400);
    expect(onNumber.json().code).toBe('FIELD_INVALID');

    // roller is retired but its key is still taken.
    for (const key of ['ring', 'roller']) {
      const dup = await call('POST', `/admin/fields/${cat.fieldIds.templeType}/options`, { key, label: 'Again' });
      expect(dup.statusCode, key).toBe(409);
      expect(dup.json().code).toBe('KEY_TAKEN');
    }

    // Two at once: one 201, one 409 KEY_TAKEN.
    const race = await Promise.all([
      call('POST', `/admin/fields/${cat.fieldIds.templeType}/options`, { key: 'needle', label: 'Needle' }),
      call('POST', `/admin/fields/${cat.fieldIds.templeType}/options`, { key: 'needle', label: 'Needle' }),
    ]);
    expect(race.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(race.find((r) => r.statusCode === 409)!.json().code).toBe('KEY_TAKEN');
    const needle = race.find((r) => r.statusCode === 201)!.json().data as FieldOption;
    expect(needle).toMatchObject({ key: 'needle', label: 'Needle', status: 'active', sortOrder: 2 });

    const reorder = await call('POST', `/admin/fields/${cat.fieldIds.templeType}/options/reorder`, {
      orderedIds: [needle.id, cat.optionIds.roller, cat.optionIds.ring],
    });
    expect(reorder.statusCode, reorder.body).toBe(200);
    const order = async () => (await detail(cat.partGroupId)).ownFields[0]!.options.map((o) => o.key);
    expect(await order()).toEqual(['needle', 'roller', 'ring']);

    const stale = await call('POST', `/admin/fields/${cat.fieldIds.templeType}/options/reorder`, { orderedIds: [cat.optionIds.ring] });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('STALE_ORDER');
    expect(await order()).toEqual(['needle', 'roller', 'ring']);
  });

  it('reorder fields with a stale list → 409 STALE_ORDER and order unchanged', async () => {
    const cat = await fixture();
    const { reedSpace, frameWidth, loomPartNote, templeType } = cat.fieldIds;
    const order = async () => (await detail(cat.machineTypeId)).ownFields.map((f) => f.key);

    for (const orderedIds of [[reedSpace], [frameWidth, reedSpace, templeType], [frameWidth, frameWidth]]) {
      const res = await call('POST', `/admin/categories/${cat.machineTypeId}/fields/reorder`, { orderedIds });
      expect(res.statusCode, JSON.stringify(orderedIds)).toBe(409);
      expect(res.json().code).toBe('STALE_ORDER');
    }
    expect(await order()).toEqual(['reed_space', 'frame_width', 'loom_part_note']);

    const ok = await call('POST', `/admin/categories/${cat.machineTypeId}/fields/reorder`, { orderedIds: [frameWidth, reedSpace, loomPartNote] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await order()).toEqual(['frame_width', 'reed_space', 'loom_part_note']);
  });

  it('moderator cannot write fields or options → 403', async () => {
    const cat = await fixture();
    const res = await call('POST', `/admin/categories/${cat.machineTypeId}/fields`, { key: 'nope', label: 'Nope', type: 'text' }, moderator.token);
    expect(res.statusCode).toBe(403);
    const patch = await call('PATCH', `/admin/options/${cat.optionIds.ring}`, { label: 'Nope' }, moderator.token);
    expect(patch.statusCode).toBe(403);
    expect((await detail(cat.machineTypeId)).ownFields.map((f) => f.key)).toEqual(['reed_space', 'frame_width', 'loom_part_note']);
  });

  it('audit rows for field.create (after.appliesTo set) and option.update (after.status retired)', async () => {
    const cat = await fixture();
    const field = await createField(cat.partGroupId, { key: 'audit_me', label: 'Audit me', type: 'single_select', appliesTo: 'parts' });
    const option = await call('POST', `/admin/fields/${field.id}/options`, { key: 'opt_a', label: 'Opt A' });
    expect(option.statusCode).toBe(201);
    expect((await call('PATCH', `/admin/fields/${field.id}`, { label: 'Audited' })).statusCode).toBe(200);
    expect((await call('POST', `/admin/categories/${cat.partGroupId}/fields/reorder`, { orderedIds: [field.id, cat.fieldIds.templeType] })).statusCode).toBe(200);
    expect((await call('PATCH', `/admin/options/${cat.optionIds.ring}`, { status: 'retired' })).statusCode).toBe(200);
    expect((await call('POST', `/admin/fields/${cat.fieldIds.templeType}/options/reorder`, { orderedIds: [cat.optionIds.roller, cat.optionIds.ring] })).statusCode).toBe(200);

    const audit = (action: string, entityId: string) =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.adminId, manager.id), eq(auditLog.action, action), eq(auditLog.entityId, entityId)));

    const [created] = await audit('field.create', field.id);
    expect(created).toMatchObject({ entityType: 'field', before: null });
    expect(created!.after).toMatchObject({ key: 'audit_me', label: 'Audit me', appliesTo: 'parts', categoryId: cat.partGroupId });

    const [updated] = await audit('field.update', field.id);
    expect(updated!.before).toMatchObject({ label: 'Audit me' });
    expect(updated!.after).toMatchObject({ label: 'Audited' });

    const [optCreated] = await audit('option.create', option.json().data.id);
    expect(optCreated!.after).toMatchObject({ key: 'opt_a', fieldId: field.id });

    const [retired] = await audit('option.update', cat.optionIds.ring);
    expect(retired).toMatchObject({ entityType: 'option' });
    expect(retired!.before).toMatchObject({ key: 'ring', status: 'active' });
    expect(retired!.after).toMatchObject({ key: 'ring', status: 'retired' });

    const [fieldsReordered] = await audit('field.reorder', cat.partGroupId);
    expect(fieldsReordered!.after).toEqual([field.id, cat.fieldIds.templeType]);
    const [optionsReordered] = await audit('option.reorder', cat.fieldIds.templeType);
    expect(optionsReordered!.after).toEqual([cat.optionIds.roller, cat.optionIds.ring]);
  });
});
