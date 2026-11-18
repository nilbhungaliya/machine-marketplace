# A4 Machine Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin-managed machine catalogue (Machine category › Machine type › Part group, brands and models, inherited spec fields, side settings, units and conditions), its public read API, a spec validator, four admin pages, CSV export, and a Surat starter seed taken from Fibre2Fashion Machinery.

**Architecture:** Port textile's catalogue (same files, rules and tests) and extend it: a 3-level tree with per-node side settings, fields with `applies_to`, and a separate brands / machine-models list. New Drizzle tables in `apps/api/src/db/schema.ts`; all rules in `services/catalog/*.ts`; thin routes (`routes/catalog.ts` public, `routes/admin/catalog-*.ts` admin); insert-only seed in `src/db/seed-data/catalog/`. The admin replaces four placeholder pages.

**Tech Stack:** Fastify 4, Drizzle + drizzle-kit, Zod, Vitest, Next.js 14 + Tailwind + React Hook Form + Zod, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-18-a4-machine-catalogue-design.md` (read it before any task).

**Follows:** textile's plan `E:\textile-marketplace\docs\superpowers\plans\2026-11-02-categories-templates-master-data.md` and the code it produced (`E:\textile-marketplace\apps\api\src\services\catalog\*`, `services/audit.service.ts`, `lib/{pg-errors,slug,csv,spec-check}.ts`, `routes/catalog.ts`, `routes/admin/catalog-*.ts`, `db/seed-catalog*`, `__tests__/_helpers/{test-admins,test-catalog}.ts`, admin `components/catalog/*`, `lib/{catalog-api,category-tree,section-icons}.ts`). **Each task names the textile file it ports; open it first and keep its structure and names unless this plan says otherwise.** Replace `@tsm/` with `@mpm/`.

## Global Constraints

- Work on branch `feat/a4-catalogue` from `develop`. Stage only the files each task names (`git add <paths>`). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Routes: Zod-parse → service → `{ data }`. No business logic in routes. Services throw `AppError` subclasses from `src/lib/errors.ts` with stable codes.
- Public routes need no auth. Admin reads: `preHandler: fastify.requireAdmin`. Admin writes: `preHandler: fastify.requireAdminRole('category_manager')` (super_admin passes automatically).
- Every admin mutation writes one `audit_log` row via `writeAudit` (Task 3). Action strings `'<entity>.<verb>'`: `category.create|update|move|reorder|delete`, `field.create|update|reorder`, `option.create|update|reorder`, `brand.create|update|reorder|delete`, `model.create|update|move|reorder|delete`, `unit.*`, `condition.*`.
- Catalogue text is **English only**; no translation columns. Admin UI is English.
- Keys (field, option, brand, model, unit, condition) are **immutable after creation** and match `^[a-z][a-z0-9_]{1,39}$`.
- Fields and options are **never deleted**, only `status: 'retired'`. Nodes, brands, models, units and conditions are deactivated (`is_active = false`); delete only when nothing references them.
- `highlight_rank` is 1–6 or null; unique among **active** fields of an effective template whose `applies_to` overlap (`both` overlaps everything; `parts` and `machines` don't overlap each other). Ranks 1–4 show on cards.
- Default side convention (exact copy): `Left and right as seen by the operator standing at the front of the machine, facing it.`
- Migrations: edit `schema.ts`, then `pnpm --filter @mpm/api db:generate`; never hand-edit `infra/migrations/`. Apply with `db:migrate` **and** `db:migrate:test`.
- Tests run against the local Docker `mpm_test` database: every suite deletes what it inserts in `afterAll`, fixtures are unique per run (timestamp in slugs/keys/emails), tests never modify seeded catalogue rows.
- After editing `packages/shared-types`, run `pnpm --filter @mpm/shared-types build`.
- Listings don't exist yet: wherever a rule depends on references from listings, leave a `// M5: refuse when listings reference this …` comment at the check site.

## Review Focus

1. Moving a machine type to another category (or a part group to another machine type) must rewrite the `path` of the whole moved subtree, and must be refused with 409 `KEY_TAKEN` / `RANK_TAKEN` when a field in the moved subtree clashes with a field on the destination's ancestors. (Tests in Task 6.)
2. Creating the same node, field, option, brand, model, unit or condition twice (double-click, two admins) returns 409 with a stable code, never a 500 from a unique index. (Tests in Tasks 6, 7, 8, 9.)
3. Deactivating a machine type hides its subtree from `GET /categories`, makes its template 404, and removes its models from `GET /models` and the brand from `GET /brands?machineTypeId=` when that brand has no other active model of that type. (Tests in Tasks 4 and 8.)
4. Clearing a node's own side setting (`hasSides: null`) makes it inherit again, and a moved part group takes its new parent's effective side settings. (Test in Task 6.)
5. A reorder request whose id list no longer matches the current siblings is rejected with 409 `STALE_ORDER` and changes nothing. (Tests in Tasks 6, 7, 8, 9.)

---

## File map

```
packages/shared-types/src/index.ts                         catalogue types + constants (Task 1)
apps/api/src/db/schema.ts, src/db/index.ts                 tables, Tx type (Tasks 2, 3)
apps/api/src/services/audit.service.ts                     writeAudit (Task 3)
apps/api/src/lib/pg-errors.ts                              isUniqueViolation (Task 3)
apps/api/__tests__/_helpers/test-admins.ts                 (Task 3)
apps/api/__tests__/_helpers/test-catalog.ts                (Task 4; brand/model in Task 8)
apps/api/src/services/catalog/read.service.ts              tree, template, master data (Task 4)
apps/api/src/services/catalog/side-settings.ts             resolveSides (Task 4)
apps/api/src/routes/catalog.ts                             public routes (Tasks 4, 8)
apps/api/src/lib/spec-check.ts                             checkSpecs (Task 5)
apps/api/src/services/catalog/validate-specs.ts            validateSpecs (Task 5)
apps/api/src/lib/slug.ts                                   slugify (Task 6)
apps/api/src/services/catalog/locks.ts                     lockCatalogRoots (Task 6)
apps/api/src/services/catalog/template-clash.ts            clash checks (Tasks 6, 7)
apps/api/src/services/catalog/category-admin.service.ts    nodes (Task 6)
apps/api/src/routes/admin/catalog-categories.ts            (Task 6)
apps/api/src/services/catalog/field-admin.service.ts       fields + options (Task 7)
apps/api/src/routes/admin/catalog-fields.ts                (Task 7)
apps/api/src/services/catalog/brand-read.service.ts        public brand/model reads (Task 8)
apps/api/src/services/catalog/brand-admin.service.ts       brand/model writes (Task 8)
apps/api/src/routes/admin/catalog-brands.ts                (Task 8)
apps/api/src/services/catalog/master-admin.service.ts      units, conditions (Task 9)
apps/api/src/routes/admin/catalog-master.ts                (Task 9)
apps/api/src/lib/csv.ts, services/catalog/export.service.ts, routes/admin/catalog-export.ts   (Task 10)
apps/api/src/db/seed-data/catalog/types.ts                 seed types (Task 11)
apps/api/src/db/seed-catalog/load.ts, src/db/seed-catalog.ts   loader + CLI (Task 11)
apps/api/src/db/seed-data/catalog/f2f-machinery.ts         F2F's 465 names verbatim (Task 12)
apps/api/src/db/seed-data/catalog/cleaning.ts              drops, merges, part items (Task 12)
apps/api/src/db/seed-data/catalog/tree.ts                  categories + placement (Task 12)
apps/api/src/db/seed-data/catalog/embroidery.ts, water-jet.ts, brands.ts, master.ts   (Task 13)
apps/admin/lib/catalog-api.ts, lib/category-tree.ts, lib/category-icons.ts   (Task 14)
apps/admin/components/catalog/*                            (Tasks 14–17)
apps/admin/app/(dashboard)/{categories,listing-fields,brands-models,master-data}/page.tsx   (Tasks 14–17)
```

---

### Task 1: Shared catalogue types

Ports textile Task 1.

**Files:**
- Modify: `packages/shared-types/src/index.ts`

**Interfaces:**
- Produces (all exported from `@mpm/shared-types`, under a `// ─── catalogue ───` heading):
  - `CATALOG_LEVELS = ['machine_category','machine_type','part_group'] as const`, `type CatalogLevel`
  - `FIELD_TYPES = ['single_select','multi_select','number','text','date'] as const`, `type FieldType`
  - `CATALOG_STATUSES = ['active','retired'] as const`, `type CatalogStatus`
  - `FIELD_APPLIES_TO = ['parts','machines','both'] as const`, `type FieldAppliesTo`
  - `TEMPLATE_KINDS = ['part','machine'] as const`, `type TemplateKind` (`machine` covers for-sale and for-rent listings)
  - `CATEGORY_ICONS` — lucide kebab names that exist in **both** `lucide-react@0.359` (admin) and `lucide-react-native` (app): start from `'cog','factory','scissors','shirt','layers','droplets','printer','microscope','washing-machine','footprints','wrench','package'` and drop any missing from either package; `type CategoryIcon`
  - `MAX_HIGHLIGHT_RANK = 6`, `CARD_HIGHLIGHT_COUNT = 4`, `CATALOG_KEY_REGEX = /^[a-z][a-z0-9_]{1,39}$/`
  - `DEFAULT_SIDE_CONVENTION` = the exact copy in Global Constraints
  - `interface CategoryNode { id: string; parentId: string | null; level: CatalogLevel; name: string; slug: string; path: string; icon: CategoryIcon | null; sortOrder: number; isActive: boolean; hasSides: boolean | null; sideConvention: string | null; effectiveHasSides: boolean; effectiveSideConvention: string; children: CategoryNode[] }`
  - `interface FieldOption { id: string; key: string; label: string; sortOrder: number; status: CatalogStatus }`
  - `interface TemplateField { id: string; categoryId: string; key: string; label: string; helpText: string | null; type: FieldType; appliesTo: FieldAppliesTo; unit: string | null; min: number | null; max: number | null; required: boolean; filterable: boolean; highlightRank: number | null; sortOrder: number; status: CatalogStatus; options: FieldOption[] }`
  - `interface EffectiveTemplate { nodeId: string; kind: TemplateKind; fields: TemplateField[] }` (category fields, then machine type, then part group; each group by `sortOrder`)
  - `interface Brand { id: string; key: string; name: string; slug: string; makesMachines: boolean; makesParts: boolean; needsReview: boolean; sortOrder: number; isActive: boolean }`
  - `interface MachineModel { id: string; key: string; brandId: string; machineTypeId: string; name: string; needsReview: boolean; sortOrder: number; isActive: boolean }`
  - `interface Unit { id: string; key: string; label: string; decimals: number; sortOrder: number; isActive: boolean }`
  - `interface Condition { id: string; key: string; label: string; description: string | null; sortOrder: number; isActive: boolean }`
  - `interface MasterData { units: Unit[]; conditions: Condition[] }`
  - `type SpecValue = string | string[] | number`, `type Specs = Record<string, SpecValue>`
  - `SPEC_ERROR_CODES = ['required','unknown_field','invalid_option','not_a_number','below_min','above_max','invalid_date','invalid_text','retired','unsupported_type'] as const`, `type SpecErrorCode`
  - `interface AdminCategoryDetail { node: CategoryNode; ownFields: TemplateField[]; inheritedFields: TemplateField[] }` (node `children` is `[]`; fields include retired ones)
- Removes: `UNITS`, `CONDITIONS` and their types (nothing imports them; the lists move to the DB). Keeps `PART_SIDES`, `complementarySide`, `PRICE_MODELS`, `RENTAL_PERIODS`, and `ROOT_CATEGORIES` (add `/** Replaced by GET /categories in M2. */`; `apps/user-app/screens/tabs/home.tsx` uses it).

- [ ] **Step 1:** Add the constants and types above; remove the two constants.
- [ ] **Step 2:** Run `pnpm --filter @mpm/shared-types build` then `pnpm typecheck`. Expected: zero errors.
- [ ] **Step 3:** Commit `packages/shared-types/src/index.ts` — `feat(shared-types): catalogue types for machine categories, brands, models and master data`.

---

### Task 2: Database schema and migration

Ports textile Task 2.

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `infra/migrations/0002_*.sql` (generated)

**Interfaces:**
- Consumes: Task 1 constants.
- Produces Drizzle tables (TS names → SQL names); timestamps `createdAt`/`updatedAt` on every table; **no `ON DELETE CASCADE`** (deletes are guarded in services):
  - pgEnums: `catalogLevel` `catalog_level`, `fieldType` `field_type`, `catalogStatus` `catalog_status`, `fieldAppliesTo` `field_applies_to`.
  - `units`: `id` uuid pk, `key` unique, `label`, `decimals` smallint default 0 (CHECK `units_decimals_range` 0–3), `sortOrder` int default 0, `isActive` bool default true.
  - `conditions`: `id`, `key` unique, `label`, `description` text null, `sortOrder`, `isActive`.
  - `categories`: `id`, `parentId` → `categories.id` null, `level`, `name`, `slug`, `path` **unique**, `icon` text null, `sortOrder`, `isActive`, `hasSides` boolean **null**, `sideConvention` text null. Index on `parent_id`.
  - `templateFields`: textile's columns + `appliesTo` `fieldAppliesTo` not null default `'both'`. Unique (`category_id`,`key`).
  - `templateFieldOptions`: textile's. Unique (`field_id`,`key`).
  - `brands`: `id`, `key` unique, `name`, `slug` unique, `makesMachines` bool default true, `makesParts` bool default false, `needsReview` bool default false, `sortOrder`, `isActive`.
  - `machineModels` → `machine_models`: `id`, `key`, `brandId` → brands, `machineTypeId` → categories, `name`, `needsReview` bool default false, `sortOrder`, `isActive`. Unique (`brand_id`,`key`) `machine_models_brand_key_uq`; **case-insensitive** unique index `machine_models_brand_type_name_uq` on (`brand_id`, `machine_type_id`, `lower(name)`) via `uniqueIndex(...).on(t.brandId, t.machineTypeId, sql\`lower(${t.name})\`)`; index on `machine_type_id`. After `db:generate`, check the SQL contains `lower("name")`; if this drizzle-kit version can't emit it, generate a `drizzle-kit generate --custom` migration with the `CREATE UNIQUE INDEX` instead.

- [ ] **Step 1:** Add the enums and tables to `schema.ts` (declare `units` and `brands` before tables that reference them).
- [ ] **Step 2:** Run `pnpm --filter @mpm/api db:generate`. Expected: one new `infra/migrations/0002_*.sql` creating 7 tables and 4 enums, touching no existing table.
- [ ] **Step 3:** Run `pnpm --filter @mpm/api db:migrate` and `pnpm --filter @mpm/api db:migrate:test`. Expected: both apply cleanly.
- [ ] **Step 4:** Run `pnpm --filter @mpm/api typecheck`. Expected: zero errors.
- [ ] **Step 5:** Commit `apps/api/src/db/schema.ts infra/migrations/` — `feat(api): catalogue tables (categories, fields, brands, models, units, conditions)`.

---

### Task 3: Audit helper, unique-violation helper, test admins

Ports textile Task 3 unchanged (textile `services/audit.service.ts`, `lib/pg-errors.ts`, `__tests__/_helpers/test-admins.ts`, `__tests__/audit.test.ts`). **The `audit_log` table already exists** (checked 2026-11-18): `infra/migrations/0001_base_schema.sql`, `apps/api/src/db/schema.ts` `auditLog` with `admin_id`, `action`, `entity_type`, `entity_id`, `before`, `after`, `created_at`. Only the helper is new; Task 2 doesn't touch the table.

**Files:**
- Create: `apps/api/src/services/audit.service.ts`, `apps/api/src/lib/pg-errors.ts`, `apps/api/__tests__/_helpers/test-admins.ts`
- Modify: `apps/api/src/db/index.ts` (export `type Tx`, the Drizzle transaction type)
- Test: `apps/api/__tests__/audit.test.ts`

**Interfaces:**
- Produces:
  - `writeAudit(db: Db | Tx, entry: { adminId: string; action: string; entityType: string; entityId: string | null; before: unknown; after: unknown }): Promise<void>`
  - `isUniqueViolation(err: unknown, constraint?: string): boolean` — pg code `23505`, optionally matching the constraint name.
  - `createTestAdmin(role: AdminRole): Promise<{ id: string; token: string }>` (email `test-admin-<ts>-<n>@example.test`, token via `signAdminToken` from `src/plugins/auth.ts`), `deleteTestAdmins(ids: string[]): Promise<void>` (deletes their `audit_log` rows first).

- [ ] **Step 1: Write the failing test** `__tests__/audit.test.ts`: `writeAudit stores who, what and before/after` (row by `adminId` has `action 'test.write'`, `before {a:1}`, `after {a:2}`); `isUniqueViolation` true for `{ code: '23505' }`, false for `{ code: '23503' }` and `new Error()`.
- [ ] **Step 2:** Run `pnpm --filter @mpm/api test -- audit`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the three files and the `Tx` export.
- [ ] **Step 4:** Run again. Expected: PASS, no leftover `test.write` rows.
- [ ] **Step 5:** Commit the five files — `feat(api): audit log helper and test admin fixtures`.

---

### Task 4: Public read API (tree, template, master data)

Ports textile Task 4 (`services/catalog/read.service.ts`, `routes/catalog.ts`, `_helpers/test-catalog.ts`).

**Files:**
- Create: `apps/api/src/services/catalog/side-settings.ts`, `apps/api/src/services/catalog/read.service.ts`, `apps/api/src/routes/catalog.ts`, `apps/api/__tests__/_helpers/test-catalog.ts`
- Modify: `apps/api/src/app.ts` (register `catalogRoutes` inside `if (infra)`)
- Test: `apps/api/src/services/catalog/side-settings.test.ts`, `apps/api/__tests__/catalog-public.test.ts`

**Interfaces:**
- Produces:
  - `resolveSides(own: { hasSides: boolean | null; sideConvention: string | null }, parent: { effectiveHasSides: boolean; effectiveSideConvention: string } | null): { effectiveHasSides: boolean; effectiveSideConvention: string }` — own value wins when not null; else the parent's; a root with null gets `false` and `DEFAULT_SIDE_CONVENTION`. A blank (whitespace-only) convention counts as null.
  - `getCategoryTree(db: Db, opts: { includeInactive: boolean }): Promise<CategoryNode[]>` — roots by `sortOrder`, children nested and sorted, effective side settings filled top-down. With `includeInactive: false`, an inactive node **and its subtree** are omitted.
  - `loadTemplate(db: Db | Tx, nodeId: string, kind: TemplateKind, opts: { includeRetired: boolean }): Promise<EffectiveTemplate>` — `kind 'part'` requires a `part_group` (reads category → type → part group, keeps `appliesTo` `parts|both`); `kind 'machine'` requires a `machine_type` (reads category → type, keeps `machines|both`). Wrong level, unknown id, or (when `includeRetired` false) the node or an ancestor inactive → `NotFoundError('Part group')` / `NotFoundError('Machine type')`. Retired options dropped from active fields when `includeRetired` false.
  - `getMasterData(db: Db, opts: { includeInactive: boolean }): Promise<MasterData>`.
  - Routes (Swagger tag `Catalogue`): `GET /categories`; `GET /categories/:id/template?kind=part|machine` (Zod: `id` uuid, `kind` enum, required); `GET /master-data`.
  - `createTestCatalog(): Promise<TestCatalog>` inserts directly with Drizzle: category `Test Machines <ts>` (slug `test-machines-<ts>`, `hasSides` null); machine type `Test Loom` with `hasSides: true`, `sideConvention: 'Seen by the weaver'`, fields `reed_space` (number, `cm`, `appliesTo 'machines'`, rank 1) and `frame_width` (number, `appliesTo 'both'`, rank 2); part group `Test Temples` (`hasSides` null) with field `temple_type` (single_select, `parts`, options `ring`, `roller` — `roller` retired); part group `Test Motors` with `hasSides: false`; a retired category field `old_note` (text); one unit `test_unit_<ts>` and one condition `test_cond_<ts>`. Returns all ids. `deleteTestCatalog(categoryId)` removes everything it made in FK order (options → fields → models of its types → part groups → types → category; then its unit and condition).

- [ ] **Step 1: Unit test** `side-settings.test.ts`: own `true` beats parent `false`; own `null` inherits parent; root `null` → `false` + default convention; own convention `'  '` inherits. Run → FAIL; implement; → PASS.
- [ ] **Step 2: Write the failing integration tests** `__tests__/catalog-public.test.ts` (`buildApp({ logger: false })`, `createTestCatalog` in `beforeAll`):
  - `GET /categories nests category → type → part groups in order with effective sides` — `Test Temples.effectiveHasSides === true` and `effectiveSideConvention === 'Seen by the weaver'`; `Test Motors.effectiveHasSides === false`; the category's `effectiveHasSides === false`.
  - `part template at Test Temples` — keys `['frame_width','temple_type']`; `reed_space` and `old_note` absent; `temple_type.options` keys `['ring']`.
  - `machine template at Test Loom` — keys `['reed_space','frame_width']`.
  - `kind=part at the machine type → 404`, `kind=machine at a part group → 404`, `missing kind → 400`, `non-uuid id → 400`.
  - `inactive machine type hides its subtree and 404s its templates` — set `isActive=false` directly; tree has the category with no children; both templates 404; restore after.
  - `GET /master-data lists the test unit and condition`.
- [ ] **Step 3:** Run `pnpm --filter @mpm/api test -- catalog-public`. Expected: FAIL.
- [ ] **Step 4:** Implement (load rows in a few queries and assemble in memory, as textile does), routes, registration.
- [ ] **Step 5:** Run. Expected: PASS.
- [ ] **Step 6:** Commit the seven files — `feat(api): public catalogue endpoints (tree with sides, templates by kind, master data)`.

---

### Task 5: Spec validator

Ports textile Task 5 (`lib/spec-check.ts` unchanged, its unit tests unchanged).

**Files:**
- Create: `apps/api/src/lib/spec-check.ts`, `apps/api/src/services/catalog/validate-specs.ts`
- Test: `apps/api/src/lib/spec-check.test.ts`, `apps/api/__tests__/validate-specs.test.ts`

**Interfaces:**
- Consumes: `loadTemplate` (Task 4).
- Produces:
  - `checkSpecs(template: EffectiveTemplate, specs: Specs, previousSpecs?: Specs): { ok: true } | { ok: false; errors: Record<string, SpecErrorCode> }` — textile's rules exactly.
  - `validateSpecs(db: Db, nodeId: string, kind: TemplateKind, specs: Specs, previousSpecs?: Specs)` — `loadTemplate(db, nodeId, kind, { includeRetired: true })` then `checkSpecs`. Wrong level propagates the `NotFoundError`.

- [ ] **Step 1:** Port textile's `spec-check.test.ts` (rename the in-memory template's `productTypeId` to `nodeId`, add `kind: 'part'`, add `appliesTo: 'both'` to its fields). Run `pnpm --filter @mpm/api test -- spec-check` → FAIL; port `spec-check.ts`; → PASS.
- [ ] **Step 2: Integration test** `__tests__/validate-specs.test.ts` with `createTestCatalog`: part at Test Temples `{ frame_width: 190, temple_type: 'ring' }` → ok; `{ frame_width: 190, temple_type: 'roller' }` → `errors.temple_type === 'retired'`; `{ reed_space: 190 }` as part → `errors.reed_space === 'unknown_field'` (machine-only field); machine at Test Loom `{ reed_space: 190 }` → ok. Run → FAIL; implement `validateSpecs`; → PASS.
- [ ] **Step 3:** Commit the four files — `feat(api): spec validator by listing kind`.

---

### Task 6: Admin category nodes (create, edit, side settings, move, reorder, delete)

Ports textile Task 6 (`lib/slug.ts`, `services/catalog/category-admin.service.ts`, `template-clash.ts`, `reorder.ts`, `routes/admin/catalog-categories.ts`), widening moves and adding side settings.

**Files:**
- Create: `apps/api/src/lib/slug.ts`, `apps/api/src/services/catalog/locks.ts`, `apps/api/src/services/catalog/template-clash.ts`, `apps/api/src/services/catalog/category-admin.service.ts`, `apps/api/src/routes/admin/catalog-categories.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/lib/slug.test.ts`, `apps/api/__tests__/admin-categories.test.ts`

**Interfaces:**
- Consumes: `writeAudit`, `isUniqueViolation`, `getCategoryTree`, `resolveSides`, test helpers.
- Produces:
  - `slugify(name: string): string` — textile's: `slugify('Sewing, Embroidery & Garments') === 'sewing-embroidery-and-garments'`, `slugify("Men's Wear") === 'mens-wear'`, `slugify('Shuttle (Schiffli) Embroidery Machine') === 'shuttle-schiffli-embroidery-machine'`, `slugify('  Water Jet Loom  ') === 'water-jet-loom'`.
  - `lockCatalogRoots(tx: Tx, nodeIds: string[]): Promise<void>` — resolves each node's root machine category and `SELECT … FOR UPDATE`s those category rows **in ascending id order** (no deadlock between two moves). Used by node moves (source and destination roots) and by every field write that can clash (Task 7).
  - `assertNoClash(tx: Tx, params: { ancestorIds: string[]; subtreeIds: string[] }): Promise<void>` in `template-clash.ts` — throws `ConflictError` `KEY_TAKEN` if any field key (any status) on `ancestorIds` also exists on `subtreeIds`; `RANK_TAKEN` if an **active** field on `ancestorIds` and an active field on `subtreeIds` share a `highlightRank` and their `appliesTo` overlap. Also exports `appliesToOverlap(a: FieldAppliesTo, b: FieldAppliesTo): boolean`.
  - Service functions take `(db: Db, adminId: string, …)`, run in one transaction, audit, and return the updated `CategoryNode` unless stated:
    - `createCategory(db, adminId, input: { parentId: string | null; name: string; slug?: string; icon?: CategoryIcon; hasSides?: boolean | null; sideConvention?: string | null })` — level from parent (none → `machine_category`, `machine_category` → `machine_type`, `machine_type` → `part_group`, `part_group` → `ValidationError` code `INVALID_PARENT`); `icon` only on machine categories (`ValidationError` `FIELD_INVALID` otherwise); `slug` defaults to `slugify(name)`; `path` = parent path + `/` + slug; `sortOrder` = max sibling + 1; unique violation on `path` → `ConflictError` `SLUG_TAKEN`.
    - `updateCategory(db, adminId, id, patch: { name?; slug?; icon?: CategoryIcon | null; isActive?; hasSides?: boolean | null; sideConvention?: string | null })` — slug change rewrites the `path` of the node and every descendant (textile's SQL); `sideConvention` trimmed, blank → null.
    - `moveCategory(db, adminId, id, newParentId: string)` — `machine_type` → new parent must be a `machine_category`; `part_group` → a `machine_type`; a `machine_category` never moves; anything else → `ValidationError` `MOVE_NOT_ALLOWED`. Locks both roots, runs `assertNoClash` with the destination's ancestor chain vs the moved subtree, rewrites paths (`SLUG_TAKEN` on collision), sets `sortOrder` = max sibling + 1. `// M5: refuse when listings reference this node or its subtree`.
    - `reorderSiblings(db, adminId, parentId: string | null, orderedIds: string[]): Promise<void>` — exact-set check → `ConflictError` `STALE_ORDER`.
    - `deleteCategory(db, adminId, id): Promise<void>` — `ConflictError` `NODE_IN_USE` when it has children, any template fields (any status), or (machine types) any machine models.
    - `getAdminCategoryDetail(db, id): Promise<AdminCategoryDetail>` — own and inherited fields (all statuses, with options); node carries effective sides.
  - Routes (Swagger tag `Admin Catalogue`): `GET /admin/categories` (requireAdmin) → `getCategoryTree({ includeInactive: true })`; `GET /admin/categories/:id` (requireAdmin); `POST /admin/categories`, `PATCH /admin/categories/:id`, `POST /admin/categories/:id/move` `{ parentId }`, `POST /admin/categories/reorder` `{ parentId: string | null, orderedIds: string[] }`, `DELETE /admin/categories/:id` (all `requireAdminRole('category_manager')`).
  - Zod: `name` trimmed 1–120; `slug` `^[a-z0-9]+(-[a-z0-9]+)*$` max 80; `icon` `z.enum(CATEGORY_ICONS)`; `sideConvention` max 300; `hasSides` `z.boolean().nullable()`.

- [ ] **Step 1: Unit test** `slug.test.ts` with the four examples. Run → FAIL; implement; → PASS.
- [ ] **Step 2: Write the failing integration tests** `__tests__/admin-categories.test.ts` (admins: one `category_manager`, one `moderator`; slugs carry a timestamp; `afterAll` → `deleteTestCatalog` for every created root, then `deleteTestAdmins`):
  - `creates category → machine type → part group with derived levels and paths` (part group path `test-cat-<ts>/water-jet-loom/temples`).
  - `child of a part group → 400 INVALID_PARENT`; `icon on a machine type → 400 FIELD_INVALID`.
  - `same slug twice under one parent → 409 SLUG_TAKEN` (Review Focus 2).
  - `moderator can GET but POST → 403 FORBIDDEN`.
  - `renaming a category slug rewrites every descendant path`.
  - `moving a machine type to another category rewrites its subtree paths; moving a category → 400 MOVE_NOT_ALLOWED; part group to a category → 400 MOVE_NOT_ALLOWED` (Review Focus 1).
  - `moving a part group whose field key exists on the destination machine type → 409 KEY_TAKEN; a parts-only rank-1 field moved under a machines-only rank-1 field → allowed; under a both rank-1 field → 409 RANK_TAKEN` (Review Focus 1).
  - `hasSides: null after true makes the node inherit again; a part group moved under a type with hasSides true becomes effectiveHasSides true` (Review Focus 4).
  - `reorder with the exact sibling ids sets order; with a missing or extra id → 409 STALE_ORDER and order unchanged` (Review Focus 5).
  - `delete a leaf part group → 200; a category with children → 409 NODE_IN_USE`.
  - `every mutation writes an audit row` (`category.create` with `entity_id` and `after.name`; `category.move` with before/after paths).
- [ ] **Step 3:** Run `pnpm --filter @mpm/api test -- admin-categories`. Expected: FAIL.
- [ ] **Step 4:** Implement service, lock and clash helpers, routes, registration.
- [ ] **Step 5:** Run. Expected: PASS.
- [ ] **Step 6:** Commit the eight files — `feat(api): admin endpoints to manage the machine catalogue tree`.

---

### Task 7: Admin template fields and options

Ports textile Task 7 (`field-admin.service.ts`, `routes/admin/catalog-fields.ts`), adding `appliesTo`.

**Files:**
- Create: `apps/api/src/services/catalog/field-admin.service.ts`, `apps/api/src/routes/admin/catalog-fields.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/__tests__/admin-fields.test.ts`

**Interfaces:**
- Consumes: `lockCatalogRoots`, `assertNoClash`, `appliesToOverlap` (Task 6).
- Produces (transactional, audited, return `TemplateField` / `FieldOption`):
  - `createField(db, adminId, categoryId, input: { key; label; helpText?; type: FieldType; appliesTo?: FieldAppliesTo; unit?; min?; max?; required?; filterable?; highlightRank?: number | null })` — textile's checks (`FIELD_INVALID` for unit/min/max on non-number, `min <= max`, rank 1–6) plus: `appliesTo 'machines'` on a `part_group` → `ValidationError` `FIELD_INVALID` (it could never show). Locks the root; key clash against ancestors **and** descendants (any status, any `appliesTo`) → `KEY_TAKEN`; rank clash against ancestors and descendants (active, overlapping `appliesTo`) → `RANK_TAKEN`.
  - `updateField(db, adminId, fieldId, patch: { label?; helpText?; unit?; min?; max?; required?; filterable?; highlightRank?: number | null; status?: CatalogStatus })` — `key`, `type`, `appliesTo` rejected (Zod `.strict()` → 400). Rank re-checked on rank change or reactivation.
  - `reorderFields(db, adminId, categoryId, orderedIds)`, `createOption(db, adminId, fieldId, { key; label })` (select fields only → else `FIELD_INVALID`; duplicate → `KEY_TAKEN`), `updateOption(db, adminId, optionId, { label?; status? })`, `reorderOptions(db, adminId, fieldId, orderedIds)` — textile's.
  - Routes: textile's (`POST /admin/categories/:id/fields`, `PATCH /admin/fields/:id`, `POST /admin/categories/:id/fields/reorder`, `POST /admin/fields/:id/options`, `PATCH /admin/options/:id`, `POST /admin/fields/:id/options/reorder`).

- [ ] **Step 1: Write the failing tests** `__tests__/admin-fields.test.ts` — textile's cases adapted to `createTestCatalog`, plus:
  - `machines-only field on a part group → 400 FIELD_INVALID`.
  - `rank 1 parts-only on Test Temples is allowed beside reed_space (machines, rank 1) on Test Loom; rank 2 parts-only on Test Temples → 409 RANK_TAKEN (frame_width is both, rank 2)`.
  - `key frame_width on Test Temples → 409 KEY_TAKEN; key temple_type on Test Loom → 409 KEY_TAKEN`.
  - `PATCH with appliesTo → 400`.
  - `creating the same field twice in parallel → one 201, one 409 KEY_TAKEN` (Review Focus 2).
  - `reorder fields with a stale list → 409 STALE_ORDER` (Review Focus 5).
  - `audit rows for field.create (after.appliesTo set) and option.update (after.status 'retired')`.
- [ ] **Step 2:** Run `pnpm --filter @mpm/api test -- admin-fields`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit the four files — `feat(api): admin endpoints for spec fields and options`.

---

### Task 8: Brands and models (public reads, admin writes)

New (no textile counterpart); follow the structure of textile's master-data service and routes.

**Files:**
- Create: `apps/api/src/services/catalog/brand-read.service.ts`, `apps/api/src/services/catalog/brand-admin.service.ts`, `apps/api/src/routes/admin/catalog-brands.ts`
- Modify: `apps/api/src/routes/catalog.ts`, `apps/api/src/app.ts`, `apps/api/__tests__/_helpers/test-catalog.ts` (add `createTestBrand`, cleaned up by `deleteTestCatalog`'s caller via `deleteTestBrands(ids)`)
- Test: `apps/api/__tests__/catalog-brands.test.ts`

**Interfaces:**
- Produces:
  - `listBrands(db, opts: { includeInactive: boolean; machineTypeId?: string; role?: 'machines' | 'parts' }): Promise<Brand[]>` — ordered by `sortOrder`, name. Public (`includeInactive: false`): only active brands; `role` filters by flag; with `machineTypeId`, only brands with ≥1 active model of that type whose type and ancestors are active.
  - `listModels(db, opts: { includeInactive: boolean; brandId?: string; machineTypeId?: string }): Promise<MachineModel[]>` — public hides inactive models, models of inactive brands, and models whose machine type or an ancestor is inactive.
  - Admin writes (transactional, audited):
    - `createBrand(db, adminId, { key; name; slug?; makesMachines: boolean; makesParts: boolean })` — at least one flag true (`ValidationError` `FIELD_INVALID`); dup key → `KEY_TAKEN`; dup slug → `SLUG_TAKEN`.
    - `updateBrand(db, adminId, id, { name?; slug?; makesMachines?; makesParts?; needsReview?; isActive? })` — `makesMachines` cannot become false while the brand has models (`ConflictError` `BRAND_IN_USE`).
    - `reorderBrands(db, adminId, orderedIds)` (all brands; `STALE_ORDER`); `deleteBrand(db, adminId, id)` — refused with `BRAND_IN_USE` when it has models.
    - `createModel(db, adminId, { brandId; machineTypeId; key; name })` — machine type must be level `machine_type` (`ValidationError` `NOT_A_MACHINE_TYPE`); brand must make machines (`ValidationError` `BRAND_NOT_MACHINE_MAKER`); key dup per brand → `KEY_TAKEN`; name dup per brand + type, **case-insensitive** (query before insert, plus the unique index) → `ConflictError` `NAME_TAKEN`.
    - `updateModel(db, adminId, id, { name?; needsReview?; isActive? })` (name re-checked); `moveModel(db, adminId, id, { brandId?; machineTypeId? })` (same checks; `// M5: refuse when listings reference this model`); `reorderModels(db, adminId, brandId, orderedIds)`; `deleteModel(db, adminId, id)` (`// M5: refuse when listings reference this model`).
  - Public routes in `routes/catalog.ts`: `GET /brands?machineTypeId=&role=`, `GET /models?brandId=&machineTypeId=` (uuid / enum via Zod).
  - Admin routes: `GET /admin/brands` (requireAdmin; brands with their models, inactive included), `POST /admin/brands`, `PATCH /admin/brands/:id`, `POST /admin/brands/reorder`, `DELETE /admin/brands/:id`, `POST /admin/models`, `PATCH /admin/models/:id`, `POST /admin/models/:id/move`, `POST /admin/brands/:id/models/reorder`, `DELETE /admin/models/:id` (writes `requireAdminRole('category_manager')`).

- [ ] **Step 1: Write the failing tests** `__tests__/catalog-brands.test.ts` (with `createTestCatalog`; brand keys and slugs timestamped):
  - `creates a machine brand and a model under Test Loom; GET /models?machineTypeId lists it; GET /brands?machineTypeId lists the brand`.
  - `model under a part group → 400 NOT_A_MACHINE_TYPE`; `model for a parts-only brand → 400 BRAND_NOT_MACHINE_MAKER`; `brand with both flags false → 400`.
  - `same model name in another case under the same brand and type → 409 NAME_TAKEN; same name under another machine type → 201` (§11 call 5).
  - `duplicate brand key → 409 KEY_TAKEN` (Review Focus 2).
  - `deactivating Test Loom removes its models from GET /models and the brand from GET /brands?machineTypeId` (Review Focus 3).
  - `delete a brand with models → 409 BRAND_IN_USE`; `makesMachines false while it has models → 409 BRAND_IN_USE`.
  - `reorder models with a stale list → 409 STALE_ORDER` (Review Focus 5).
  - `moving a model to another brand that already has its key → 409 KEY_TAKEN; to a brand + type that already has its name (other case) → 409 NAME_TAKEN`.
  - `the case-insensitive name index holds under a race: two parallel creates of "TMAR-KC" and "tmar-kc" → one 201, one 409 NAME_TAKEN` (Review Focus 2).
  - `moderator write → 403`; `audit rows for brand.create and model.move`.
- [ ] **Step 2:** Run `pnpm --filter @mpm/api test -- catalog-brands`. Expected: FAIL.
- [ ] **Step 3:** Implement services, routes, helper, registration.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit the six files — `feat(api): brands and machine models (public reads, admin writes)`.

---

### Task 9: Admin master data (units, conditions)

Ports textile Task 8 for two keyed lists (no reasons, defects or grades).

**Files:**
- Create: `apps/api/src/services/catalog/master-admin.service.ts`, `apps/api/src/routes/admin/catalog-master.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/__tests__/admin-master-data.test.ts`

**Interfaces:**
- Produces (transactional, audited): `createUnit(db, adminId, { key; label; decimals: 0|1|2|3 })`, `updateUnit(db, adminId, id, { label?; decimals?; isActive? })`, `reorderUnits(db, adminId, orderedIds)`; `createCondition(db, adminId, { key; label; description? })`, `updateCondition(db, adminId, id, { label?; description?; isActive? })`, `reorderConditions(db, adminId, orderedIds)`. Dup key → `KEY_TAKEN`; stale reorder → `STALE_ORDER`; keys not accepted on update.
- Routes: `GET /admin/master-data` (requireAdmin) → `getMasterData({ includeInactive: true })`; `POST /admin/master-data/units`, `PATCH /admin/master-data/units/:id`, `POST /admin/master-data/units/reorder`; the same three for `/conditions`.

- [ ] **Step 1: Write the failing tests:** per list — create, rename, deactivate (public `/master-data` hides it), duplicate key → 409 `KEY_TAKEN` (Review Focus 2), stale reorder → 409 `STALE_ORDER` (Review Focus 5), `decimals 4` → 400, moderator write → 403, audit rows for `unit.create` and `condition.update` with before/after. Keys timestamped; `afterAll` deletes them.
- [ ] **Step 2:** Run `pnpm --filter @mpm/api test -- admin-master-data`. Expected: FAIL.
- [ ] **Step 3:** Implement (one generic keyed-list helper is fine).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit the four files — `feat(api): admin endpoints for units and conditions`.

---

### Task 10: CSV export for client review

Ports textile Task 9 (`lib/csv.ts` and its test unchanged).

**Files:**
- Create: `apps/api/src/lib/csv.ts`, `apps/api/src/services/catalog/export.service.ts`, `apps/api/src/routes/admin/catalog-export.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/lib/csv.test.ts`, `apps/api/__tests__/admin-export.test.ts`

**Interfaces:**
- Produces:
  - `toCsv(rows)` — textile's (RFC 4180, CRLF, UTF-8 BOM).
  - `exportSheet(db, sheet: 'tree' | 'fields' | 'brands-models' | 'master-data'): Promise<string>`:
    - `tree`: `Machine category,Machine type,Part group,Path,Active,Active (own),Has sides (own),Has sides (effective),Side convention (effective)` (Active = effective: the node and all its ancestors active) — one row per part group, plus one row for each category or type with no children, tree order; own `Has sides` blank when inherited.
    - `fields`: `Level,Category path,Field key,Label,Type,Applies to,Unit,Min,Max,Required,Filterable,Highlight rank,Status,Options` — options `key=label` joined by `; `, retired suffixed ` (retired)`.
    - `brands-models`: `Brand,Brand key,Makes machines,Makes parts,Brand active,Brand needs review,Model,Model key,Machine type path,Model active,Model needs review` — one row per model; brands without models get one row with blank model columns.
    - `master-data`: `List,Key,Label,Description,Decimals,Active` — units then conditions.
  - Route `GET /admin/catalog/export/:sheet` (requireAdmin) → `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="catalogue-<sheet>-<YYYY-MM-DD>.csv"`; unknown sheet → 400.

- [ ] **Step 1:** Port `csv.test.ts`; run → FAIL; port `toCsv`; → PASS.
- [ ] **Step 2: Integration test** `admin-export.test.ts` (with `createTestCatalog` and one test brand + model): `tree` has a `Test Temples` row with effective `Yes` and `Seen by the weaver`; `fields` has `reed_space` with `machines` and `roller=… (retired)`; `brands-models` has the test model with its machine type path; unknown sheet → 400; content-type `text/csv`.
- [ ] **Step 3:** Implement; run both tests → PASS.
- [ ] **Step 4:** Commit the six files — `feat(api): CSV export of the catalogue for client review`.

---

### Task 11: Seed loader (validate, load, reset)

Ports textile Task 10 (`db/seed-data/catalog/types.ts`, `db/seed-catalog/load.ts`, `db/seed-catalog.ts`).

**Files:**
- Create: `apps/api/src/db/seed-data/catalog/types.ts`, `apps/api/src/db/seed-data/catalog/index.ts` (empty seed), `apps/api/src/db/seed-catalog/load.ts`, `apps/api/src/db/seed-catalog.ts`
- Modify: `apps/api/package.json` (`"db:seed:catalog": "tsx src/db/seed-catalog.ts"`)
- Test: `apps/api/src/db/seed-catalog/load.test.ts` (pure), `apps/api/__tests__/seed-catalog.test.ts` (DB, rolled back)

**Interfaces:**
- Produces:
  - Seed types:
    ```ts
    export interface SeedOption { key: string; label: string }
    export interface SeedField {
      key: string; label: string; type: FieldType; appliesTo?: FieldAppliesTo; helpText?: string; unit?: string;
      min?: number; max?: number; required?: boolean; filterable?: boolean; highlightRank?: number; options?: SeedOption[];
    }
    export type SeedPartGroup = string | { name: string; slug?: string; hasSides?: boolean; fields?: SeedField[] };
    export type SeedMachineType = string | {
      name: string; slug?: string; hasSides?: boolean; sideConvention?: string;
      fields?: SeedField[]; partGroups?: SeedPartGroup[];
    };
    export interface SeedCategory {
      name: string; slug?: string; icon: CategoryIcon; hasSides?: boolean; sideConvention?: string;
      fields?: SeedField[]; machineTypes: SeedMachineType[];
    }
    export interface SeedModel { key: string; name: string; machineType: string /* machine type path, e.g. 'weaving/water-jet-loom' */ }
    export interface SeedBrand { key: string; name: string; makesMachines: boolean; makesParts: boolean; models?: SeedModel[] }
    export interface SeedMaster {
      units: { key: string; label: string; decimals: number }[];
      conditions: { key: string; label: string; description: string }[];
    }
    export interface CatalogSeed { categories: SeedCategory[]; brands: SeedBrand[]; master: SeedMaster }
    ```
  - `validateSeed(seed: CatalogSeed): string[]` — textile's problems (sibling slug clash, names slugifying alike, key clash in an effective template, rank out of 1–6 or clashing among overlapping `appliesTo`, select without options, options on non-select, unit/min/max on non-number, bad key) plus: `appliesTo 'machines'` on a part-group field; duplicate brand keys or slugs; a model whose `machineType` path is unknown or not a machine type; a model on a brand with `makesMachines: false`; duplicate model keys per brand; model names equal case-insensitively per brand + type; a brand with both flags false; unit `decimals` outside 0–3.
  - `loadCatalog(tx: Tx, seed: CatalogSeed, opts: { reset: boolean }): Promise<{ categories: number; machineTypes: number; partGroups: number; fields: number; options: number; brands: number; models: number; units: number; conditions: number }>` — throws on `validateSeed` problems; if `categories` is non-empty and `reset` false → throws `'Catalogue already loaded. The database is the source of truth; use --reset only before go-live.'`; with `reset`, deletes options → fields → models → brands → part groups → machine types → categories → units → conditions (`// M5: refuse --reset when listings exist`). Inserts in seed order (`sortOrder` = index), slugs via `slugify` unless given, **every brand and model with `needsReview: true`**.
  - CLI `seed-catalog.ts`: textile's (reads `--reset`, runs in `db.transaction`, prints counts, closes the pool). `index.ts` exports `catalogSeed` (empty here; Tasks 12–13 fill it).

- [ ] **Step 1: Pure tests** `load.test.ts`: a valid fixture (two categories, one with a type, part groups, fields, a brand with a model) → `[]`; one `it` per problem above, each message naming the offending path/key.
- [ ] **Step 2:** Run → FAIL; implement `validateSeed`; → PASS.
- [ ] **Step 3: DB test** `__tests__/seed-catalog.test.ts`, each case inside `db.transaction(async (tx) => { …; throw ROLLBACK })`. Safe because API test files never run in parallel: `apps/api/vitest.config.ts` sets `fileParallelism: false` (checked 2026-11-18, same as textile); keep it that way. Cases: loads the fixture into an emptied catalogue (path `fixture-cat/fixture-type/temples`, model `needsReview === true`); refuses when not empty and `reset` false; reset replaces rows.
- [ ] **Step 4:** Run → FAIL; implement `loadCatalog`, CLI, script; → PASS. Confirm the real catalogue tables are unchanged afterwards.
- [ ] **Step 5:** Commit the six files — `feat(api): insert-only catalogue seed loader with validation`.

---

### Task 12: Seed data — the tree from Fibre2Fashion

Ports the approach of textile Task 11 (F2F names, cleaned and placed).

**Files:**
- Create: `apps/api/src/db/seed-data/catalog/f2f-machinery.ts`, `apps/api/src/db/seed-data/catalog/cleaning.ts`, `apps/api/src/db/seed-data/catalog/tree.ts`
- Modify: `apps/api/src/db/seed-data/catalog/index.ts`
- Test: `apps/api/src/db/seed-data/catalog/tree.test.ts`

**Interfaces:**
- Produces:
  - `F2F_MACHINERY: readonly string[]` — the 465 product-type names **verbatim** (typos included) from `docs/research/2026-11-16-fibre2fashion-machines.md` §2 (the semicolon-separated list), in that order.
  - `cleaning.ts`: `DROPPED: Record<string, string>` (F2F name → reason), `MERGED: Record<string, string>` (F2F name → canonical machine-type name), `PART_ITEMS: Record<string, { partGroup: string; machineTypes: string[] }>` (F2F name → part group created under each listed canonical machine type), `PROCESS_PART_GROUPS: Record<string /* F2F name */, { partGroup: string; categories: string[]; except: string[] /* machine type names */ }>` (F2F's process-wide parts entry → part group under every machine type of those categories, minus `except`).
  - `tree.ts`: `CATEGORIES: SeedCategory[]` built from `PLACEMENT: Record<string /* category name */, string[] /* canonical machine types, in display order */>`; part groups from `PART_ITEMS` are attached to their machine types (deduplicated by name), then the `PROCESS_PART_GROUPS` group is appended **last** under each machine type it covers; full details for embroidery and water-jet types come from Task 13 (`tree.ts` merges them in by machine-type name).

**Categories, in order** (icon from `CATEGORY_ICONS`, implementer's pick): Spinning · Weaving · Knitting · Dyeing · Printing & Finishing · Testing & Inspection · Sewing, Embroidery & Garments · Laundry · Leather & Footwear Machinery · Equipment & Accessories.

**Canonical names:** F2F's wording with the first letter of each word capitalised; typos fixed (`Chennile` → `Chenille`, `machinary` → `machinery`, `Equipmnets` → `Equipment`, `Measuringand` → `Measuring and`, `Wrap & Weft` → `Warp & Weft`, `Woolen` → `Woollen`). "Aliases" below are F2F names that go into `MERGED` pointing at the canonical name; a canonical name that is itself an F2F name is placed, not merged.

**DROPPED** (reason in brackets): non-machinery or listings — Beauty Equipment, Sports Equipment, Carpets and Rugs, Ceramic and Porcelain accessories, Leather accessories, Cotton Vending Machine, Complete Blanket manufacturing unit avaialble, Running Blanket Manufacturing unit availble, Dyeing and Knitting machines for Immediate Sale, Others; umbrella or ambiguous — Accessories for Machine, Auxiliary Equipment, Auxiliary Machine, Bearing, Breaker, Complete Plant, Condenser, Cutting Equipments, Detector, Direct, Sectional, Beam Warper and Slasher Sizing M/cs, Dyeing Machine, Embroidery Equipment, Embroidery Machine, Fabric Dyeing Machine, Fibre Spinning Preparatory Machine, Finishing Machine, Finishing Plant, Flat and Circular, Handling Equipment, Industrial Textile Equipment, Knitting Equipment, Knitting Machine, Knitting Plant, Looms, Man made fibre spinning, Measuring Equipment, Non Woven and Braiding Machines, Non woven Equipment, Preparatory Machine, Printing Equipment, Printing Line, Printing Machine, Processing Equipment, Processing Machine, Rubber Tube, Sewing Equipment, Sewing Machine, Shuttle Less Loom, Spinning Equipment, Spinning Machine, Spinning Plant, Stitch Machine, Tester, Testing Equipment, Warping Equipment, Warping Machine, Washing Equipment, Water Pump Bearing (covered by Water Jet Loom's Bearings, Gears & Belts), Weaving Equipment, Weaving Loom, Weaving Machine, Weaving Plant, Yarn Raising Machine.

**PROCESS_PART_GROUPS** (owner: copy F2F; every machine type can take part listings from launch):
- Spinning machinary parts → "Spinning machinery parts" under every Spinning machine type
- Weaving Machinary Parts → "Weaving machinery parts" under every Weaving machine type except Water Jet Loom
- Sewing Machine parts and accessories → "Sewing machine parts & accessories" under every Sewing, Embroidery & Garments machine type except Multi Head Embroidery Machine, Single Head Embroidery Machine, Shuttle (Schiffli) Embroidery Machine, Sequin Machine, Chenille Machine
- Textile Machine parts → "Textile machine parts" under every machine type in Knitting, Dyeing, Printing & Finishing, Testing & Inspection, Laundry, Leather & Footwear Machinery, Equipment & Accessories

**PART_ITEMS** (F2F name → part group under machine types):
- Accessories for Compact Spinning Machines → "Compact spinning accessories" under Ring Spinning Frame
- Drafting systems → "Drafting systems" under Ring Spinning Frame
- Pressure Rollers Cots Aprons and Condensors → "Cots, aprons & pressure rollers" under Ring Spinning Frame, Roving Frame, Draw Frame
- Card Clothings, Flexible card clothing → "Card clothing" under Carding Machine
- Feeding Devices For Carding Machine → "Feeding devices" under Carding Machine
- Textile Can → "Cans" under Carding Machine, Draw Frame
- Opening rollers for rotor spinning Machines → "Opening rollers" under Rotor Spinning Machine
- Spinning and Discharge and Lubrication Pumps → "Spinning pumps" under Melt Spinning Line
- Filters For Cleaning Of Polymer → "Polymer filters" under Extrusion Line
- Yarn Break Detectors → "Yarn break detectors" under Two for One Twister (TFO), Twisting Machine
- Cones, tubes and pirns for weaving, Paper Cones & Tubes → "Cones, tubes & pirns" under Cone & Cheese Winder
- Beams and Flanges, Sectional beams → "Beams & flanges" under Direct Warping Machine, Sectional Warping Machine
- Beams for Narrow Fabrics → "Beams & flanges" under Needle Loom
- Cutting devices for weaving Machines → "Cutters" under Rapier Loom, Air Jet Loom, Projectile Loom
- Weft feelers → "Weft feelers & sensors" under Rapier Loom, Air Jet Loom, Projectile Loom, Automatic Loom, Power Loom (Non-Automatic)
- Hydroentangling jets → "Hydroentangling jets" under Non-woven Line
- Conveyor belts and cross lapper belts → "Conveyor & lapper belts" under Non-woven Line
- Dye beams, Dyeing Spindles & Dyeing Tubes & Cones → "Dye beams, tubes & spindles" under Jet Dyeing Machine, Overflow Dyeing Machine
- Ink-jet Printing Heads → "Print heads" under Digital Textile Printer
- Printing rollers → "Printing rollers" under Rotary Screen Printing Machine
- Screens for printing → "Screens" under Rotary Screen Printing Machine, Flat Screen Printing Machine
- Calendar Bowls and Rollers → "Bowls & rollers" under Calender
- Flexible clothing for raising Machines → "Raising clothing" under Raising Machine
- Knives & Blades, Scissor → "Knives & blades" under Garment Cutting Machine
- Needle, Sewing needles → "Needles" under Industrial Sewing Machine, Household Sewing Machine, Overlock Machine, Interlocking Machine
- Bobbins & Bobbins Case → "Bobbins & bobbin cases" under Industrial Sewing Machine, Household Sewing Machine

**PLACEMENT** (canonical name, aliases in brackets):
- **Spinning:** Bale Opener (Bale Breaker, Bale breaker / pluckers, Bale Plucker, Plucking Machine); Bale Cutter; Blow Room Line (Blow room machinary, Blow Room Machinery, Blowing Line); Opening & Cleaning Machine (Opening & Cleaning and Blending Machine, Opening Line, Opening Machine, Cleaning Line, Cleaning Machine); Blending Machine (Blender, Blending Hoppers, Blending Line); Hopper Feeder (Feeder); Carding Machine (Cards & Carding Equipment); Card Grinding & Polishing Machine (Card Grinding & Polishing); Card Clothing Mounting Machine (Mounting Machines for flexible card clothing and metallic card wire, Mounting Equipment, Mounting Machine); Card Winding Machine; Lapper; Comber (Combing Machine, Lap Former and Comber); Draw Frame (Draw Line, Drawing Machine); Gill Box; Roving Frame (Flyer Frame, Flyer Machine, Roving Frame/ Flyer Frame, Speed Frame); Ring Spinning Frame (Ring Spinning Line, Spinning Frame); Automatic Doffing and Piecing Systems (Automatic doffing and piecing systems); Rotor Spinning Machine (Open End/Rotor Spinning Machine); Air Jet Spinning Machine (Air Jet Spinning Frame); Friction Spinning Machine (Friction Spinning); Fancy Yarn Spinning Machine; Woollen & Worsted Card (Woolen Cards, Worsted Cards, Semi Worsted Cards); Woollen Ring Spinning Frame (Woolen Ring Spinning Frames, Semi Worsted Ring Spinning Frames); Wool Processing Line; Wool Scouring Line (Wool Scouring Lines); Cotton Wool Processing Line; Jute Processing Machine; Textile Recycling Line (Recycling Line); Tearing Machine (Tearing Line); Melt Spinning Line (Melt Spinning); Dry Spinning Line (Dry Spinning); Wet Spinning Line (Wet Spinning); Electro-Spinning Machine (Electro-Spinning); Extrusion Line (Extruder); Polymerisers; Stretch Breaking Machine; Crimping Machine; Texturising Machine (Texturing Machine, Texturizing Machines); Air Texturing Machine; Bulking Machine; Air Covering Machine; Covering Machine; Autoconer; Cone & Cheese Winder (Cone Winder, Cheese Winder, Precision Cone & Cheese Winders, Winding Machine); Doubling Machine; Two for One Twister (TFO) (Two For One Twister, Two for One Twisting machine (T.F.O)); Twisting Machine (Twisting Frame, Twisting Plant, Winder & Twisters); Ring Twisting Machine; Reeling Machine; Balling Winder (Balling Winders); Yarn Singeing Machine; Yarn Conditioning Machine (Conditioning Machine); Autoclave.
- **Weaving:** Water Jet Loom; Rapier Loom (Rapier Looms); Air Jet Loom (Air Jet Looms, Air Jet Weaving Looms); Projectile Loom (Projectile Looms, Sulzer Looms); Jacquard Loom (Jacquard Looms); Jacquard Machine (Jacquard Plant); Automatic Loom; Power Loom (Non-Automatic) (Non-Automatic Power Loom); Multi Phase Weaving Machine; Circular Loom (Circular Looms); Carpet Loom; Carpet Making Machine; Terry Weaving Machine (Terry woven plant); Label Loom (Label Machine); Needle Loom (Needle Looms); Ribbon Basing Machine; Sample Weaving Machine (Sample weaving Machines); Weft Insertion Machine; Tufting Machine; Direct Warping Machine (Beam Warping Machine); Sectional Warping Machine; Sizing Machine (Slasher); Beaming Machine; Warp Tying & Knotting Machine (Tying Machine, Knotting Machine, Labelling and Knotting M/cs); Warp & Weft Winding Machine (Wrap & Weft Winding Machine); Batcher; Non-woven Line (Non-Woven Line, Non-Woven Machine, Forming Line, Forming Machine); Needle Punching Line (Needle Line); Bonding Machine (Bonding Line); Braiding Machine (Braiding Plant).
- **Knitting:** Circular Knitting Machine; Flat Knitting Machine; Single Cylinder Knitting Machine; Double Cylinder Knitting Machine; Socks Knitting Machine; Hosiery Machine; Warp Knitting Machine; Raschel Machine; Tricot Machine; Crochet Knitting Machine; Lace Machine; Boarding Machine for Knitwear (Boarding Machine For Knitwear).
- **Dyeing:** Jet Dyeing Machine; Overflow Dyeing Machine; Jigger Dyeing Machine (Jiggers, Jigger Dyeing and Padbatch); Hank Dyeing Machine; Centrifugal Dyeing Machine; Knitwear and Hosiery Dyeing Machine (Knitwear And Hosiery Dyeing Machine); Continuous Dyeing Range (Continuous Dyeing Machine, Dyeing Line); Dyeing Apparatus; Dyeing Auxiliary Machine (Auxiliary Machine for Dyeing); Package Dryer (Package Dryers); Bleaching Range (Bleaching Line, Bleaching Machine); Desizing Machine; Scouring Machine; Singeing Machine; Mercerising Range (Mercerising Line, Mercerizing Machines); Open-Width Washing Range (Open-Width Washing Machine, Washing Line); Padding Mangle (Padder, Padding And Impregnating Machine, Padding Mangles Machine); Steaming Machine; Continuous Steamer & Dryer (Continuous Steamers And Dryers); Colour Dispensing System (Colour Dispensing Systems); Colour Mixing Machine; Dosing Machine; Dipping Machine.
- **Printing & Finishing:** Rotary Screen Printing Machine; Flat Screen Printing Machine (Flat Printing Machine); Digital Textile Printer (Digital Printer, Textile Printer, Jet Printing Machine); Heat Transfer Machine (Auxiliary Machine for Transfer Printing); Label Printing Machine; Engraving System for Rotary Screens (Engraving Systems For Rotary Screens); Stenter Machine (Stenter Frame, Stenter Machine/ Tenter Machine, Stenter Range, Tenter Frame, Tenter Machine); Compacting Machine (Compacting Machinery); Sanforizing Machine (Sanforizing Line, Shrinking Machine); Calender (Calender Machines); Raising Machine (Napper); Emerizing & Sueding Machine (Emerizing Machine, Sueding Machine); Shearing Machine (Shearing Line); Brushing Machine; Embossing Machine; Flocking Machine; Coating & Laminating Machine (Coating and Laminating Machines, Coating Line, Coating Machine, Combining and Laminating Machine, Laminating Machine); Decatising Machine; Crabbing Machine; Felting Machine; Finish Breaking Machine; Polishing Machine; Curing Oven (Oven); Fabric Dryer (Dryer, Drying Line, Drying Machine); Drum Drying Machine; High Frequency Dryer (High Frequency Dryers); Infrared Dryer (Infrared Dryers); Fabric Measuring, Rolling and Folding Machine (Fabric Folding Machine, Folding Machine, Rolling and folding Machine, Measuringand Rolling and Folding Machine For Knitted Fabrics, Measuringand Rolling and Folding Machine For Woven Fabrics, Measuring Machine); Crossfolder; Slitting Machine (Slitter); Wadding Machine.
- **Testing & Inspection:** Fabric Inspection Machine (Inspection Frame, Inspection Line, Inspection Machine, Inspection Table); Fabric Testing Machine; Yarn Testing Machine; Fibre Testing Machine; Colour Measuring Instrument (Colour Measuring Instruments Machine); Fault Detection System; Online Monitoring System (Online Monitoring System Machine); Needle Detector Machine; Textile Scale.
- **Sewing, Embroidery & Garments:** Multi Head Embroidery Machine; Single Head Embroidery Machine; Shuttle (Schiffli) Embroidery Machine (Shuttle Embroidery Machine); Sequin Machine; Chenille Machine (Chennile Machine, Chennile Plant); Industrial Sewing Machine; Household Sewing Machine; Overlock Machine; Interlocking Machine; Multifunction Sewing Machine; Denim Sewing Machine; Heavy Fabrics Sewing Machine; End-to-End Sewing Machine (End-To-End Sewing Machine); Bag Stitching Machine; Seaming Machine; Hemming Machine; Buttonhole Machine; Button Attaching Machine (Button Sewer Machine); Button Covering Machine; Button Making Machine; Pocket Attaching Machine; Pocket Welting Machine (Pocket Welting Equipments); Taping Machine; Fusing Machine; Garment Cutting Machine (Cutting Machine, Cutting Machine for Garments, Hand Operated Cutting Machine); Fabric Spreading Machine (Spreading Machine, Cloth Spreading Machine, Cloth Laying Machine); Cloth Unrolling Machine; Marking Machine; Pleating Machine; Quilting and Mattress Machine (Quilting And Mattress Machine); Pillow Filling Machine; Fringeing Machine; Stapling Machine; Trimming Machine; Garment Folding Machine (Folding Machine For Ready Made Textiles And Garments); Sewing Thread Winding Machine.
- **Laundry:** Industrial Washing Machine (Laundry Machine, Washing Machine); Hydro Extractor (Centrifugal Hydro-Extractors Machine, Extractor Machine, Water Extraction Machine); Tumble Dryer (Tumbler, Tumbler Dryers); Dry Cleaning Machine (Dry Cleaning Line); Ironing & Pressing Machine (Iron & Ironing equipments, Ironing Machine, Pressing Machine, Finishing Presses); Laser Machine for Garments (Laser Machine for Garment); Spraying Machine.
- **Leather & Footwear Machinery:** Leather Brushing Machine; Leather Cutting Machine; Leather Drying Machine; Leather Dyeing Machine; Leather Finishing Machine; Leather Marking Machine; Leather Plating & Ironing Machine; Leather Polishing Machine; Leather Pressing Machine; Leather Printing Machine; Leather Trimming Machine; Fleshing Machine; Splitting Machine; Buffing Machine; Milling Machine; Vulcanizing Machine; Perforating Machine; Punching Machine; Shoe Making Machine (Shoes Making Machine); Multifunction Shoe Machine; Footwear Sewing Machine; Backpart Moulding Machine; Counter Moulding Machine; Insole Moulding Machine; Cementing Machine; Heel Nailing Machine; Sole Jointing & Electing Moulding Machine (Sole Jointing & Electing Molding Machine); EVA Foaming Injection Moulding Machine (Eva Foaming Injection Molding Machine); Plastic Shoe Automatic Injection Moulding Machine (Plastic Shoe Automatic Injection Molding Machine); Turning Machine; Leather and Shoe Auxiliary Machine (Auxiliary Machine for Leather and Shoe Machine).
- **Equipment & Accessories:** Humidification Plant (Air Humidifiers Machine, Textile Humidification Machine); Air Conditioning Plant (Air Conditioning Plants); Boiler; Compressor; Generator; Effluent Treatment Plant (Effluent Treatment Plants & Equipmnets); Conveying System (Conveyers, Conveying Systems, Automatic Conveying and Handling Equipment); Baling Press (Bale Press, Baling Machine); Bale Wrapping System; Packing Machine (Packing Line, Packaging Equipment, Wrapping Machine); Trolley; Tank; A-Frame; Mixer; Grinding Machine; Adhesive Machine.

- [ ] **Step 1: Write the failing test** `tree.test.ts` (pure):
  - `F2F_MACHINERY` has 465 entries; **every entry is in exactly one of** `DROPPED`, `MERGED`, `PART_ITEMS`, `PROCESS_PART_GROUPS`, or is itself a placed canonical name.
  - **Every machine type has at least one part group**; `Rapier Loom`'s last part group is `Weaving machinery parts`; `Circular Knitting Machine` has `Textile machine parts`; `Water Jet Loom` has no `Weaving machinery parts`; `Multi Head Embroidery Machine` has no `Sewing machine parts & accessories`.
  - `validateSeed` on `{ categories: CATEGORIES, brands: [], master: { units: [], conditions: [] } }` returns `[]`.
  - Category names in the order above; 10 categories; no category named `Pre-owned Machinery`.
  - Machine types total between 230 and 270 (the placement lists add up to about 249); no machine type named `Others`, `Beauty Equipment`, `Sports Equipment` or `Carpets and Rugs`; no name contains `Chennile` or `machinary`.
  - `Water Jet Loom` under Weaving; `Multi Head Embroidery Machine` and `Shuttle (Schiffli) Embroidery Machine` under Sewing, Embroidery & Garments; `Two for One Twister (TFO)` under Spinning; `Stenter Machine` appears once (under Printing & Finishing).
  - `Card clothing` is a part group of `Carding Machine`; `Weft feelers & sensors` is a part group of `Rapier Loom`; `Needles` and `Sewing machine parts & accessories` are part groups of `Industrial Sewing Machine`.
- [ ] **Step 2:** Run `pnpm --filter @mpm/api test -- tree.test`. Expected: FAIL.
- [ ] **Step 3:** Write `f2f-machinery.ts`, `cleaning.ts`, `tree.ts`; export `CATEGORIES` through `index.ts`. If the coverage test reports an F2F name these lists miss, place it under the best-fitting category (or `DROPPED` with a reason if it isn't a machine) and name it in the commit message so the client review sees it.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit the four files — `feat(api): machine catalogue tree from Fibre2Fashion (10 categories, ~250 machine types)`.

---

### Task 13: Seed data — embroidery and water-jet in full, brands, models, master data

**Files:**
- Create: `apps/api/src/db/seed-data/catalog/embroidery.ts`, `water-jet.ts`, `brands.ts`, `master.ts`
- Modify: `apps/api/src/db/seed-data/catalog/tree.ts`, `index.ts`
- Test: `apps/api/src/db/seed-data/catalog/catalog.test.ts`

**Interfaces:**
- Produces: `EMBROIDERY_DETAILS: Record<string /* machine type name */, Omit<Exclude<SeedMachineType, string>, 'name'>>`, `WATER_JET_DETAILS` (same shape), `BRANDS: SeedBrand[]`, `MASTER: SeedMaster`; `index.ts` exports `catalogSeed: CatalogSeed = { categories: CATEGORIES, brands: BRANDS, master: MASTER }`.

**Content** (keys fixed here; `#n` rank, `req` required, `filt` filterable; `parts` / `machines` = `appliesTo`; every part-group field is `parts`):
- **Embroidery machine fields** (machines; repeated on each embroidery type, never on the category, §11 call 14):
  - Multi Head: `heads` number `heads` 1–60 req filt `#1`; `needles_per_head` number 1–20 req filt `#2`; `max_embroidery_area` text `#3` (help "e.g. 500 × 1200 mm"); `head_interval` number `mm` 200–600; `controller` text; `attachments` multi_select filt `#4` (sequin, cording, chenille, boring, taping, laser, other).
  - Single Head: `needles_per_head` `#1`, `max_embroidery_area` `#2`, `attachments` `#3`, `controller`.
  - Shuttle (Schiffli): `machine_length` number `yards` 5–25 req filt `#1`; `repeat` single_select filt `#2` (4/4, 6/4, 8/4, other); `controller` text.
  - Sequin Machine and Chenille Machine: `heads` `#1`, `needles_per_head` `#2`, `controller`.
- **Embroidery part groups** (Multi Head and Single Head share this list): Needles (`needle_system` single_select req filt `#1`: DBxK5, DBxK5 SES, DBx1, other; `needle_size` number `Nm` 55–140 filt `#2`); Needle Bars & Presser Feet; Rotary Hooks & Bobbin Cases; Thread Take-ups & Tension; Trimmers & Cutters; Frames, Pantograph & Hoops (+ `size` text `#2`); Control Boards & Electronics (`board_code` text req `#2`); Motors & Drives (+ `power` number `W` `#2`); Sequin & Cording Devices; Belts, Bearings & General Spares. Schiffli: Needles; Shuttles & Bobbins; Borers & Cutters; Pattern Control & Electronics (+ `board_code`); Motors & Drives; Frames & Structure; General Spares. Sequin Machine: Sequin Feeders & Cutters; Needles; Motors & Drives; General Spares. Chenille Machine: Chenille Heads & Loopers; Needles; Motors & Drives; General Spares. Every embroidery part group except Needles gets `item` single_select req filt `#1` with 3–6 options naming the parts it holds, ending `other` (e.g. Rotary Hooks & Bobbin Cases: hook, jumbo hook, bobbin case, bobbin, other). The Needles groups under Schiffli, Sequin Machine and Chenille Machine use different needle systems, so they get `needle_system` as **text** req filt `#1` (help "e.g. Schiffli needle system and size as on the packet") and `needle_size` number `Nm` 55–200 filt `#2`, no option list. No embroidery node has sides.
- **Water Jet Loom:** `sideConvention: 'Left and right as seen by the weaver standing at the front of the loom, facing it.'`; machine fields (machines): `reed_space` number `cm` 150–400 req filt `#1`; `nozzles` single_select req filt `#2` (single, double, triple); `shedding` single_select req filt `#3` (crank, cam, dobby, electronic dobby); `rpm` number 300–1500 filt `#4`. Part groups, each with an `item` single_select req filt `#1` (3–6 options ending `other`): Nozzles & Water Pumps; Weft Measuring & Feeders; Shedding (Cams, Dobby, Heald Frames); Reed & Beat-up; Take-up & Let-off; **Temples & Selvedge (`hasSides: true`)**; Cutters; Electronics & Sensors; Motors & Clutch-brake; **Side Frames & Structure (`hasSides: true`)**; Bearings, Gears & Belts.
- **Brands** (all loaded with `needsReview: true`; model `machineType` paths from Task 12's slugs):
  - Machines + parts: Tajima — TMAR-KC, TMEZ-SC, TFMX-IIC (Multi Head), SAI (Single Head); Barudan — BEVT-Z, BEKS-S (Multi Head), BEXT-S1501CII (Single Head); ZSK — Racer 2, Challenge (Multi Head), Sprint 6 (Single Head); Happy — HCR3 (Multi Head), HCS3 (Single Head); SWF — K-UK (Multi Head), MAS-12 (Single Head); Saurer — Epoca 7 (Shuttle (Schiffli)); Toyota — LWT710, LWT810 (Water Jet Loom); Tsudakoma — ZW408, ZW8100 (Water Jet Loom).
  - Machines only, no models yet: Lässer (Schiffli), Nissan (water-jet).
  - Parts only: Groz-Beckert, Organ Needles, Schmetz (needles), Hirose (hooks).
- **Master:** units — pcs "Pieces" 0, pairs "Pairs" 0, sets "Sets" 0, kg "Kilograms" 3, m "Metres" 2, litres "Litres" 2, boxes "Boxes" 0, machines "Machines" 0; conditions — new "New" ("Never used, in original packing"), unused "Unused" ("Never fitted; packing may be open"), used "Used" ("Removed from a working machine"), excess "Excess" ("Surplus stock from a mill or dealer").

- [ ] **Step 1: Write the failing test** `catalog.test.ts` (pure, imports `index.ts`):
  - `validateSeed(catalogSeed)` returns `[]`.
  - Each of the five embroidery types has its part groups (Multi Head: 10) and machine fields; `max_embroidery_area` exists on Multi Head and Single Head and **not** on the Sewing, Embroidery & Garments category.
  - Water Jet Loom has 11 part groups; `Temples & Selvedge` and `Side Frames & Structure` have `hasSides: true`; its `sideConvention` is the loom copy above.
  - No part-group field has `appliesTo 'machines'`.
  - `TMAR-KC` model points at the Multi Head path; `LWT710` at the Water Jet Loom path; Groz-Beckert has `makesMachines: false`.
  - 8 units, 4 conditions with the keys above.
- [ ] **Step 2:** Run `pnpm --filter @mpm/api test -- catalog.test`. Expected: FAIL.
- [ ] **Step 3:** Write the four files; merge details into `tree.ts` by machine-type name; update `index.ts`.
- [ ] **Step 4:** Run (and Task 12's `tree.test`). Expected: PASS.
- [ ] **Step 5:** Commit the six files — `feat(api): embroidery and water-jet catalogue detail, brands, models, units, conditions`.

---

### Task 14: Admin categories page — tree, node details, side settings

Ports textile Task 12 (`lib/catalog-api.ts`, `lib/category-tree.ts`, `lib/section-icons.ts` → `category-icons.ts`, `components/catalog/{category-tree,node-details,node-form-dialog}.tsx`).

**Files:**
- Create: `apps/admin/lib/catalog-api.ts`, `apps/admin/lib/category-tree.ts`, `apps/admin/lib/category-tree.test.ts`, `apps/admin/lib/category-icons.ts`, `apps/admin/lib/category-icons.test.ts`, `apps/admin/components/catalog/category-tree.tsx`, `apps/admin/components/catalog/category-tree.test.tsx`, `apps/admin/components/catalog/node-details.tsx`, `apps/admin/components/catalog/node-form-dialog.tsx`, `apps/admin/components/catalog/side-settings-form.tsx`, `apps/admin/components/catalog/side-settings-form.test.tsx`
- Modify: `apps/admin/app/(dashboard)/categories/page.tsx`, `apps/admin/lib/api.ts` (add `download`)

**Interfaces:**
- Consumes: routes from Tasks 6 and 10; Task 1 types.
- Produces:
  - `api.download(path, filename)`, `filterTree`, `findNode`, `siblingsOf` — textile's.
  - `catalog-api.ts`: `fetchAdminTree()`, `fetchCategoryDetail(id)`, `createCategory(input)`, `updateCategory(id, patch)`, `moveCategory(id, parentId)`, `reorderSiblings(parentId, orderedIds)`, `deleteCategory(id)` (Tasks 15–17 add theirs).
  - `CATEGORY_ICON_COMPONENTS: Record<CategoryIcon, LucideIcon>`.
  - `<CategoryTree nodes selectedId onSelect query />` — textile's, levels labelled "Category / Machine type / Part group"; a part group whose effective side setting is on shows an "L | R" badge; each row has **Move up / Move down** buttons (disabled at the ends) that call `reorderSiblings(parentId, <full sibling id list with the two swapped>)` and refresh the tree. The sibling list always comes from the **unfiltered** tree (`siblingsOf(fullTree, id)`), and "the ends" and "the neighbour" are decided in that full list, so a search never sends a partial list; a 409 `STALE_ORDER` shows "Someone changed this list; reloaded" and reloads.
  - `<SideSettingsForm node onSave />` — "Parts here have sides": Inherit (showing the effective value and where it comes from) / Yes / No; "Side convention": Inherit (showing the effective text) / Own text (textarea). Saves `{ hasSides, sideConvention }` with `null` for Inherit.
  - `<NodeDetails id />` — textile's minus MOQ, plus `<SideSettingsForm>`; **Move** for machine types (select of categories) and part groups (select of machine types, searchable); **Add child** for categories and machine types; Delete → `NODE_IN_USE` toast "Switch it off instead".
  - Page `/categories`: `PageHeader` with search and **Export** (Tree CSV); tree left (~360px), details right.

- [ ] **Step 1: Failing tests:** `category-tree.test.ts` (filterTree keeps ancestors of a matching part group; case-insensitive; empty query unchanged); `category-icons.test.ts` (every `CATEGORY_ICONS` key maps to a component); `category-tree.test.tsx` (renders category names; expanding shows machine types; an inactive node shows "Off"; a sided part group shows "L | R"; clicking Move down on the first of three siblings calls `reorderSiblings` with `[second, first, third]`; Move up is disabled on the first row; with a search that hides the second sibling, Move down on the first still sends all three ids `[second, first, third]`); `side-settings-form.test.tsx` (Inherit shows the effective value; choosing Inherit submits `hasSides: null`; own convention submits trimmed text).
- [ ] **Step 2:** Run `pnpm --filter admin test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm --filter admin test`, `pnpm --filter admin typecheck`, `pnpm --filter admin lint`. Expected: pass, zero warnings.
- [ ] **Step 5:** Commit the listed files — `feat(admin): machine catalogue tree editor with side settings`.

---

### Task 15: Admin specifications & fields page with seller-form preview

Ports textile Task 13 (`fields-panel`, `field-form-dialog`, `options-editor`, `spec-form-preview`), on its own page.

**Files:**
- Create: `apps/admin/components/catalog/fields-panel.tsx`, `field-form-dialog.tsx`, `field-form-dialog.test.tsx`, `options-editor.tsx`, `spec-form-preview.tsx`, `spec-form-preview.test.tsx`
- Modify: `apps/admin/app/(dashboard)/listing-fields/page.tsx`, `apps/admin/lib/catalog-api.ts`

**Interfaces:**
- Consumes: Task 7 routes, `AdminCategoryDetail`, `<CategoryTree>` (Task 14).
- Produces:
  - `catalog-api.ts`: `createField`, `updateField`, `reorderFields`, `createOption`, `updateOption`, `reorderOptions` — textile's.
  - `<FieldsPanel detail onChanged />` — textile's, rows also show an "Applies to" badge (Parts / Machines / Both).
  - `<FieldFormDialog mode field? nodeLevel />` — textile's plus an **Applies to** select in create mode only; on a part group the "Machines" choice is absent.
  - `<SpecFormPreview fields kind />` — textile's, filtering by `appliesTo` for `kind`.
  - Page `/listing-fields`: tree left; right: `<FieldsPanel>` and a preview with a **Parts / Machines** toggle (part groups preview Parts; machine types preview Machines and also Parts with a note "Part forms under this type include these fields"); **Export** (Fields CSV).

- [ ] **Step 1: Failing tests:** `spec-form-preview.test.tsx` — given a machines-only field and a parts-only field, `kind 'part'` renders only the parts field; required `*`; rank 1 shows "On card"; retired option hidden. `field-form-dialog.test.tsx` — unit/min/max hidden until `number`; edit mode has no key, type or applies-to inputs; on a part group the applies-to select has no "Machines"; `Bad Key` blocks submit.
- [ ] **Step 2:** Run `pnpm --filter admin test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests, typecheck, lint. Expected: pass, zero warnings.
- [ ] **Step 5:** Commit the listed files — `feat(admin): specifications and fields editor with seller-form preview`.

---

### Task 16: Admin brands, models & fit page

New; built from the existing kit (`DataTable`, `FormDialog`, `useConfirm`, `PageHeader`).

**Files:**
- Create: `apps/admin/components/catalog/brands-table.tsx`, `brand-form-dialog.tsx`, `models-panel.tsx`, `model-form-dialog.tsx`, `brands-table.test.tsx`, `model-form-dialog.test.tsx`
- Modify: `apps/admin/app/(dashboard)/brands-models/page.tsx`, `apps/admin/lib/catalog-api.ts`

**Interfaces:**
- Consumes: Task 8 admin routes; `fetchAdminTree()` for machine-type pickers.
- Produces:
  - `catalog-api.ts`: `fetchAdminBrands()`, `createBrand`, `updateBrand`, `reorderBrands`, `deleteBrand`, `createModel`, `updateModel`, `moveModel`, `reorderModels`, `deleteModel`.
  - `<BrandsTable brands selectedId onSelect />` — columns: name, key, Makes machines / Makes parts badges, model count, "Needs review" badge, **Active switch** (calls `updateBrand(id, { isActive })`), **Move up / Move down** (calls `reorderBrands` with the full brand id list swapped; `STALE_ORDER` reloads; **disabled while any filter is on**, with the tooltip "Clear filters to reorder", so a hidden brand is never swapped); filters: machine type (models of that type), Needs review only. Edit opens `<BrandFormDialog>` (name, slug, flags, needs review; key read-only after create).
  - `<ModelsPanel brand />` — models of the selected brand with machine type path, needs-review checkbox (clears the flag), active switch, up/down, Move (brand and/or machine type), Delete.
  - `<ModelFormDialog />` — key (create only), name, machine type (searchable select of machine types only); API `NAME_TAKEN` / `KEY_TAKEN` shown under the field.
  - Page `/brands-models`: brands left, models right; **Export** (Brands & models CSV).

- [ ] **Step 1: Failing tests:** `brands-table.test.tsx` (flags render as badges; "Needs review only" filter hides reviewed brands; toggling Active calls `updateBrand` with `{ isActive: false }`; Move down on the first brand calls `reorderBrands` with the first two swapped; with "Needs review only" on, the move buttons are disabled); `model-form-dialog.test.tsx` (machine-type select lists only machine types; key read-only in edit mode; a 409 `NAME_TAKEN` response shows under Name).
- [ ] **Step 2:** Run `pnpm --filter admin test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests, typecheck, lint. Expected: pass, zero warnings.
- [ ] **Step 5:** Commit the listed files — `feat(admin): brands and models editor`.

---

### Task 17: Admin units, conditions & sides page

Ports textile Task 14 (`keyed-list-editor`), without grades.

**Files:**
- Create: `apps/admin/components/catalog/keyed-list-editor.tsx`, `keyed-list-editor.test.tsx`, `fixed-lists.tsx`
- Modify: `apps/admin/app/(dashboard)/master-data/page.tsx`, `apps/admin/lib/catalog-api.ts`

**Interfaces:**
- Consumes: Task 9 routes, Task 10 export.
- Produces:
  - `catalog-api.ts`: `fetchAdminMasterData()`, unit and condition create/update/reorder.
  - `<KeyedListEditor />` — textile's; Units add a Decimals column (0–3 select); Conditions add a Description column.
  - `<FixedLists />` — read-only cards for Sides (`PART_SIDES` with labels Left, Right, Pair, Not applicable), Price models (`PRICE_MODELS`), Rental periods (`RENTAL_PERIODS`), each with the note "Fixed in the app because offers, rentals and matching work differently for each. Their names are translated in the app."
  - Page `/master-data`: `PageHeader` + **Export** (master-data CSV) + `Tabs`: Units · Conditions · Fixed lists.

- [ ] **Step 1: Failing test** `keyed-list-editor.test.tsx` — textile's cases (order, "Off", read-only key in edit, `Bad Key` rejected) plus the Decimals column for units.
- [ ] **Step 2:** Run `pnpm --filter admin test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests, typecheck, lint. Expected: pass, zero warnings.
- [ ] **Step 5:** Commit the listed files — `feat(admin): units, conditions and fixed lists page`.

---

### Task 18: Load the seed and verify end to end

Ports textile Task 15.

**Files:**
- Modify: `docs/PROJECT_STATUS.md` (What's built, Suggested build order, session log)

- [ ] **Step 1:** Run `pnpm typecheck`, `pnpm lint`, `pnpm test`. Expected: all green, zero warnings; `GET /categories` on the test DB shows no `test-*` roots.
- [ ] **Step 2:** Run `pnpm --filter @mpm/api db:seed:catalog`. Expected: prints 10 categories, ~250 machine types, ~330 part groups, ~80 fields, the option count, 14 brands, 19 models, 8 units and 4 conditions.
- [ ] **Step 3:** Run it again. Expected: refuses with "Catalogue already loaded", exit code ≠ 0.
- [ ] **Step 4:** With `pnpm dev:api`: `GET /categories` has 10 categories; `GET /categories/<Temples & Selvedge id>/template?kind=part` returns `item`; the node has `effectiveHasSides: true`; `GET /categories/<Water Jet Loom id>/template?kind=machine` returns `reed_space, nozzles, shedding, rpm`; `GET /models?machineTypeId=<Water Jet Loom id>` returns LWT710, LWT810, ZW408, ZW8100.
- [ ] **Step 5:** In the admin (`pnpm dev:admin`, `admin@example.com`): search "water jet" on `/categories`, check Temples & Selvedge shows "L | R"; preview Multi Head Embroidery Machine (Machines) on `/listing-fields`; filter "Needs review" on `/brands-models`; download all four CSVs and open one in Excel (UTF-8 names intact).
- [ ] **Step 6:** Update `docs/PROJECT_STATUS.md`; commit it — `docs: A4 machine catalogue built and seeded`.
- [ ] **Step 7:** Use superpowers:finishing-a-development-branch to merge `feat/a4-catalogue` into `develop`.
