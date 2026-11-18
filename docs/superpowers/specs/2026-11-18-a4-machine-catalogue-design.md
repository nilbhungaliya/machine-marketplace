# A4 · Machine catalogue (categories, machine types, part groups, brands, models, fields, master data): design

Date: 2026-11-18 · Status: **approved 2026-11-18** · Scope IDs: **A4** (admin), feeds F2, F3, F4, F8 ·
Spec modules: M4 (catalogue), AD4 (admin) in `docs/product-scope.md`.

**Follows textile:** `E:\textile-marketplace\docs\superpowers\specs\2026-11-02-categories-templates-master-data-design.md`,
its plan `docs/superpowers/plans/2026-11-02-categories-templates-master-data.md`, and the code it produced:
`apps/api/src/services/catalog/*` (read, category-admin, field-admin, master-admin, export, reorder, template-clash,
validate-specs), `apps/api/src/services/audit.service.ts`, `apps/api/src/routes/catalog.ts`,
`apps/api/src/routes/admin/catalog-*.ts`, `apps/api/src/db/seed-catalog*`, `apps/api/src/db/seed-data/catalog/`, and
the admin pages `/categories` and `/master-data`. Copy their structure, naming, edit rules and tests; this document
lists only what is different for machine parts.

## 1. Intent

This marketplace is for **textile machines and their parts**, plus F2F's adjacent machinery categories (leather &
footwear, laundry), kept to mirror F2F: an embroidery machine and the hooks, needles and boards
that go into it; a water-jet loom and its nozzles, pumps and temples. Buyers are textile units whose machine is down;
sellers hold spare, surplus or used parts, or whole machines. (The client's scope names Fibre2Fashion **Machinery**, a
textile-machinery marketplace, as its model. Earlier drafts of `docs/product-scope.md` and the mockups used tractor,
truck and earthmoving examples; those are wrong and are corrected in a separate follow-up, §13.)

Every later feature reads this catalogue: the sell wizard builds its form from it, search filters come from it, "fits
my machine" and Left / Right / Pair matching depend on it, and requirements reuse it. So it is built first, before any
listing exists.

Who does what (as in textile): we build the catalogue features (API + admin) and prepare starter data; the client
reviews the starter data through a CSV export and, after launch, the client's category manager changes **everything**
in the admin panel without a developer.

## 2. Goals, non-goals, anti-goals

**Goals**
- A 3-level tree: **Machine category › Machine type › Part group**, every level admin-editable.
- **Brands and models.** A model belongs to one brand and one machine type. Fitment is **brand + model only** (no
  years, no variants; decided with the owner).
- Spec fields on any level, inherited downwards, with a per-field "applies to" (parts, machines, or both).
- Per-node **"parts here have sides"** switch and **side-convention text**, inherited downwards (powers F3).
- Master data the admin manages: units, conditions.
- Admin pages on the four existing nav entries, `category_manager` (and `super_admin`) only; every change audit-logged.
- Public read API for the app; a spec validator that the sell wizard (M5) will call.
- Starter data for a **Surat launch**: embroidery machines and water-jet looms in full, other textile machine
  categories as outlines. CSV export for client review.

**Non-goals (later modules)**
- App screens that use the catalogue (browse, filters, sell wizard): M2, M3, M5.
- Fitment rows on listings, the "fits your machine" badge, "Request a missing model" and "Suggest a category" queues:
  M5 (they need listings and the sell wizard).
- Merge tools for duplicate nodes, brands or models: when listings exist (M5 or later).
- Search synonyms: M3. Live listing counts on nodes: M2 (no listings yet).
- Translating catalogue names into Hindi and Gujarati: later, as textile did in its Part 6.
- Spreadsheet import or bulk edit. Export only.
- Restyling the whole admin panel to Periwinkle v2 (separate task). A4's pages use the existing admin kit.

**Anti-goals: it fails even if it "works" when**
- Re-running the seed overwrites anything the client edited in the admin panel.
- Renaming a node, field, option, brand, model, unit or condition breaks data that stores it.
- Something that is (or later will be) referenced can be deleted.
- App or API code hard-codes a machine category, machine type, part group, brand, model, unit or condition list
  instead of reading the database (CLAUDE.md business rule 10).

## 3. Decisions made with the owner

| Decision | Detail |
|---|---|
| Domain | Textile machines and their parts, plus F2F's adjacent categories (leather & footwear, laundry), kept to mirror F2F. No tractors, trucks or earthmoving. |
| Launch focus | Surat. **Embroidery machines** and **water-jet looms** filled in fully; other categories as outlines. |
| Everything editable | Machine categories, machine types, part groups, brands, models, fields, options, units, conditions and side settings: add, edit, rename, reorder, deactivate in the admin panel. |
| Fitment | Brand + model is enough. No year ranges, no variants. A configuration (e.g. 12 heads) can be its own model. |
| Tree follows Fibre2Fashion Machinery | Machine categories and machine types come from F2F's textile-machinery taxonomy (its 12 sub-categories and 465 product types, `docs/research/2026-11-16-fibre2fashion-machines.md`; the owner supplied the same list on 2026-11-18), cleaned and placed by us, as textile did with F2F's textile taxonomy. **Mirror F2F:** all of its categories are kept, including Leather & Footwear Machinery, Laundry and Testing & Inspection, and its grouping is kept (embroidery inside "Sewing, Embroidery & Garments"). The admin can switch off or split anything later. |
| Parts for every machine type | Copy F2F: its process-wide parts entries ("Spinning machinery parts", "Weaving machinery parts", "Sewing machine parts & accessories", "Textile machine parts") become a part group under every machine type of that process, so every machine type can take part listings from launch (§4.1). Decided 2026-11-18. |
| Approach | Textile's design extended: one fixed 3-level tree; part groups belong to (and repeat under) each machine type; brands and models are a separate list; each model belongs to a brand and a machine type. Chosen over a shared part-group list (two axes per listing) and an any-depth tree. |

## 4. The tree

| Level | Examples | Used by |
|---|---|---|
| Machine category | F2F's machinery sub-categories, 12 reduced to 10 (numbered list in §4.1) | Browse root; machine and part listings |
| Machine type | F2F's product types placed under a category: Multi Head Embroidery Machine, Single Head Embroidery Machine, Shuttle (Schiffli) Embroidery Machine; Water Jet Loom, Rapier Loom, Air Jet Loom, Projectile Loom, Jacquard Loom | **Machine listings (for sale and for rent) stop here**; models attach here |
| Part group | Rotary hooks & bobbin cases, Needles, Control boards; Nozzles & water pumps, Temples, Heald frames | **Part listings stop here** |

### 4.1 Taking the tree from Fibre2Fashion

F2F's machinery section has 12 sub-categories and a flat A-Z list of 465 product types, with no published mapping
between them (the mapping endpoint is blocked; see the research note). We build our first two levels from it the way
textile built its tree from F2F's textile taxonomy:

- **Machine categories = F2F's sub-categories.** F2F has 12 (exact names):

  | # | F2F sub-category | Here |
  |---|---|---|
  | 1 | Spinning | Spinning |
  | 2 | Weaving | Weaving |
  | 3 | Knitting | Knitting |
  | 4 | Dyeing | Dyeing |
  | 5 | Printing & Finishing | Printing & Finishing |
  | 6 | Testing & Inspection | Testing & Inspection |
  | 7 | Sewing, Embroidery & Garments | Sewing, Embroidery & Garments |
  | 8 | Laundry | Laundry |
  | 9 | Leather & Footwear Machinery | Leather & Footwear Machinery |
  | 10 | Pre-owned Machinery | **Dropped**: it is the listing's condition ("used"), not a kind of machine |
  | 11 | Equipments | merged with 12 into **Equipment & Accessories** (plant utilities: compressors, boilers, humidification, effluent treatment, conveyors, trolleys, cans) |
  | 12 | Accessories & Equipments | merged into Equipment & Accessories; its spare-part items become part groups (below) |

  **12 → 10 categories.** F2F has no separate spare-parts sub-category; its spare-part product types are spread across
  the list and become part groups (below).
- **Machine types = F2F's product types**, each placed under one category by us (e.g. Water Jet Loom → Weaving; Multi
  Head Embroidery Machine → Sewing, Embroidery & Garments; Two for One Twister → Spinning; Sectional Warping Machine and
  Sizing Machine → Weaving, following F2F's top nav of Spinning / Weaving / Knitting).
- **Cleaned as textile did:** near-duplicates merged (the five stenter / tenter names become "Stenter Machine"; "Two For
  One Twister" and "Two for One Twisting machine (T.F.O)" become one), typos fixed ("Chennile" → "Chenille",
  "machinary" → "machinery"), non-machinery entries dropped ("Carpets and Rugs", "Beauty Equipment", "Sports
  Equipment"), no "Others" catch-all, and generic umbrella entries ("Spinning Machine", "Weaving Machine", "Processing
  Machine") dropped where specific types exist.
- **F2F's spare-part and consumable product types are not machine types.** They become **part-group names** under the
  machine types they serve (e.g. "Sewing needles" and "Bobbins & Bobbins Case" → part groups under embroidery and sewing
  types; "Weft feelers" and "Cutting devices for weaving Machines" → part groups under looms; "Card Clothings" and
  "Pressure Rollers Cots Aprons and Condensors" → part groups under spinning types).
- **F2F's process-wide parts entries become a part group under every machine type of that process** (owner: copy F2F),
  so every machine type can take part listings from launch: "Spinning machinary parts" → **Spinning machinery parts**
  under every Spinning type; "Weaving Machinary Parts" → **Weaving machinery parts** under every Weaving type except
  Water Jet Loom (it has its full set); "Sewing Machine parts and accessories" → **Sewing machine parts & accessories**
  under every Sewing, Embroidery & Garments type except the five embroidery types (full sets); "Textile Machine parts"
  → **Textile machine parts** under every machine type in the other seven categories.
- Every placement is a draft the client reviews in the export.

**Node rules** (as textile §4): English `name`, `slug` (unique among siblings, editable), stored unique `path`
(`sewing-embroidery-and-garments/multi-head-embroidery-machine/rotary-hooks`), `sort_order`, `is_active`. Machine categories also have an `icon`
(key from a fixed lucide list). Deactivating hides the node and its subtree from the app and sellers; existing
references keep working. Delete only when nothing references it (no children, fields, models, and later listings,
requirements); otherwise the admin is told to deactivate.

**Moving:** a part group can move to another machine type, and a machine type to another machine category. Inherited
fields and side settings change with the move, so a move is allowed only while nothing references the node or its
subtree (no listings exist yet; M5 adds that check). This is wider than textile (which allowed moves only within a
section) because textile machine families are less settled and the client will reorganise the outlines.

**Side settings** (new; replaces textile's MOQ-style inherited node setting):
- `has_sides`: `true`, `false`, or unset. Unset inherits the nearest ancestor's value; a machine category that is unset
  counts as `false`. Effective value is what the sell wizard (M5) uses to show or skip the Left / Right / Pair step,
  and what search uses to show the side filter.
- `side_convention`: text, or unset to inherit. A built-in default applies when no ancestor sets it (§11 call 1):
  *"Left and right as seen by the operator standing at the front of the machine, facing it."* Shown in the wizard's
  side step and on listings.
- The side codes themselves (`left`, `right`, `pair`, `not_applicable`) stay fixed in `packages/shared-types`
  (`PART_SIDES`, `complementarySide()`); matching logic depends on them.

## 5. Spec fields (templates)

A node's **effective template for a listing kind** = the machine category's fields, then the machine type's, then the
part group's (parts only), keeping only fields whose `applies_to` matches the kind:

| Listing | Levels read | Fields kept |
|---|---|---|
| Part | category → type → part group | `applies_to` = `parts` or `both` |
| Machine for sale, machine for rent | category → type | `applies_to` = `machines` or `both` |

Example: "Number of heads" and "Needles per head" sit on *Multi Head Embroidery Machine* with `applies_to =
machines`, so a hook listing under that type never asks for them. "Hook type" sits on the *Rotary hooks* part group.

Field properties are textile's (`key` immutable snake_case unique in the effective template, `label`, `help_text`,
`type` in `single_select | multi_select | number | text | date`, `unit` and `min`/`max` for numbers, `required`,
`filterable`, `highlight_rank` 1–6 unique in the effective template ("shown on cards" = ranks 1–4), `sort_order`,
`status` active/retired) **plus `applies_to`** (`parts | machines | both`, default `both`). Options are textile's (`key`
immutable, `label`, `sort_order`, `status`).

Edit rules are textile's: labels rename freely; fields and options are never deleted, only retired; type and
`applies_to` cannot change after creation (retire and add a new field); a newly required field applies to new and
edited listings only; adding a field whose key or rank clashes anywhere in an affected effective template is rejected.

**Spec validator** (service only, no route until M5): `validateSpecs(nodeId, kind, specs, previousSpecs?)`, textile's
rules plus: `nodeId` must be a part group for `kind = part`, a machine type for machine kinds. Unchanged retired values
pass when `previousSpecs` is given.

Fields never repeat the tree or the catalogue: no "machine type", "brand" or "model" fields (the tree and the brand /
model lists already say that). Part brand (e.g. a needle maker) is covered by §6, not a field.

**Not fields either: attributes every machine listing has.** Year of manufacture, condition, quantity, price, location
and "can be seen running" belong on the listing itself as fixed columns, because search sorts and filters on them across
all categories (M3, M5). M5 adds them. A4 seeds only **category- and type-specific** machine fields (e.g. heads,
needles per head, maximum embroidery area; reed width, nozzle count, shedding type), so outline categories with no fields
still get complete machine listings.

## 6. Brands and models

**Brand:** `key` (immutable), `name`, `slug`, `sort_order`, `is_active`, and two flags: **makes machines** and **makes
parts** (a needle maker such as Groz-Beckert makes parts only; Tajima makes machines and parts). M5 offers
machine-making brands for fitment and part-making brands for "part brand".

**Model:** belongs to one **brand** and one **machine type**; `key` (immutable), `name` (e.g. "TMAR-KC", "LWT710"),
`sort_order`, `is_active`. The name is **unique per brand and machine type** (the same name under two machine types is
two models, §11 call 5), so a move that would collide is rejected. A model can move to another machine type or brand
only while nothing references it (M5 adds the check). Fitment rows (M5) store model ids, so renaming never breaks them.

**Review flag:** brands and models have a stored `needs_review` boolean. The seed sets it to `true` on every brand and
model it loads; anything an admin creates starts `false`; the admin clears it from the edit form once the client has
confirmed the row. It has no effect in the app; the brands-and-models page can filter by it and the export prints it.

Deactivating a brand hides it and its models from new listings and from the app's pickers; existing references keep
working. Delete only when unreferenced.

## 7. Master data

| List | Shape | Starter data |
|---|---|---|
| Units | global; `key`, `label`, `decimals` (0–3, as textile), `sort_order`, `is_active` | pcs, pairs, sets, kg, m, litres, boxes, machines |
| Conditions | global; `key`, `label`, `description` (the one-line definition shown in the wizard), `sort_order`, `is_active` | new, unused, used, excess, with the scope's definitions |

Keys immutable, labels editable, deactivate rather than delete once referenced.

**Not admin lists:** price models (`fixed`, `negotiable`, `on_request`) and rental periods (`hour`, `day`, `week`,
`month`) stay fixed in `packages/shared-types`, because offers and rental pricing behave differently per code. Their
labels come from the app's translations (en / hi / gu). The admin Master data page shows them read-only with that
explanation.

`packages/shared-types`: `UNITS` and `CONDITIONS` stop being the source of truth (the database is); remove them unless
something still imports them, as textile did. `ROOT_CATEGORIES` stays until the home screen reads the tree (M2), since
`apps/user-app/screens/tabs/home.tsx` uses it. `PART_SIDES`, `PRICE_MODELS`, `RENTAL_PERIODS` stay.

## 8. API

Thin routes → services, Zod input, `{ data }` responses, `AppError` codes, as in CLAUDE.md and textile.

**Public (no login; guests browse):**
- `GET /categories`: the active tree with id, level, name, slug, path, icon, order, and effective side settings.
- `GET /categories/:id/template?kind=part|machine`: the effective active template.
- `GET /brands?machineTypeId=&role=machines|parts`: active brands (for a machine type: brands with at least one active
  model of that type).
- `GET /models?brandId=&machineTypeId=`: active models.
- `GET /master-data`: units, conditions.

**Admin (`/admin/...`; reads `requireAdmin`, writes `requireAdminRole('category_manager')`):** textile's category,
field, option and master-data endpoints, plus side settings on nodes, plus brands (CRUD, reorder, deactivate) and
models (CRUD, reorder, deactivate, move). Exports: CSV for the tree (with side settings), fields and options, brands and
models, master data. Every mutation writes `audit_log` through a shared `writeAudit` helper (none exists yet in this
repo; port textile's `audit.service.ts`).

## 9. Admin panel

Replaces the placeholders on the four existing nav entries (role `category_manager`, `apps/admin/lib/nav.ts`):

| Page | Contents |
|---|---|
| **Categories & machine types** (`/categories`) | Searchable tree (inactive nodes greyed). Selected node: details (name, slug and path, icon for categories, active, move, delete when allowed), **side settings** (has sides: inherit / yes / no, convention text: inherit / own, with the effective values shown), add child, reorder siblings. |
| **Specifications & fields** (`/listing-fields`) | Same tree picker. Selected node: inherited fields read-only above the node's own; add / edit field dialog with options editor; retire / reactivate; **preview** of the seller form for parts and for machines at that node. |
| **Brands, models & fit** (`/brands-models`) | Brands table (flags, active, reorder); per brand its models with machine type, add / edit / move / deactivate. Filter by machine type. |
| **Units, conditions & sides** (`/master-data`) | Tabs: Units, Conditions (editable); Sides, Price models, Rental periods (read-only, with why). |

Export buttons on each page. Desktop-first, English, existing admin kit (data table, dialogs, confirm, toasts).

## 10. Starter data (seed)

Textile's two-phase seed exactly: TypeScript files in `apps/api/src/db/seed-data/catalog/`, an insert-only
`db:seed:catalog` that refuses a non-empty catalogue, and `--reset` (wipe and reload) that refuses once anything
references the catalogue. Before go-live the files are the source of truth and client corrections go into them; after
go-live the admin panel is.

Contents (draft for client review; sources: `docs/research/2026-11-16-fibre2fashion-machines.md`, F2F's machinery list
cleaned of duplicates, typos, non-machinery and "Others"):
- **All machine categories and machine types from F2F** (§4.1): 10 categories and, after cleaning, about 250 machine
  types.
- **Embroidery, in full:** F2F's embroidery machine types (multi head, single head, shuttle / Schiffli, plus sequin and
  chenille machines) with their part groups (e.g. needles; needle bars & presser feet; rotary hooks & bobbin cases; thread take-ups & tension; trimmers &
  cutters; frames, pantograph & hoops; control boards & electronics; motors & drives; sequin & cording devices; belts,
  bearings & general spares), machine and part fields, brands and models. No embroidery node has sides (no left / right
  parts are listed for these machines; the admin can switch sides on later).
- **Water-jet loom, in full:** part groups (e.g. nozzles & water pumps; weft measuring & feeders; shedding: cams, dobby,
  heald frames; reed & beat-up; take-up & let-off; temples & selvedge; cutters; electronics & sensors; motors &
  clutch-brake; side frames & structure; bearings, gears & belts), fields, side settings (e.g. temples and side frames
  have sides), brands and models.
- **Everything else as outlines:** every other machine type exists (from F2F) with F2F's process-wide parts group
  (§4.1) and, where F2F lists a spare-part type for it (needles, card clothing, cots and aprons, weft feelers), that part
  group too; no fields, brands or models yet.
- Every brand and model is marked in the export as **draft, to verify with the client** (model names drafted from
  public sources may be incomplete or wrong).

## 11. Calls made by Claude (not discussed; check these)

1. Default side convention: "as seen by the operator standing at the front of the machine, facing it" (the old
   vehicle convention, "from behind, facing forward", doesn't fit looms or embroidery machines). Editable per node.
2. `has_sides` and `side_convention` can be set on any level and inherit downwards, so the client can switch a whole
   machine type or a single part group.
3. Fields get `applies_to` (parts / machines / both) so machine-only fields don't appear on part forms.
4. Brands carry "makes machines" and "makes parts" flags instead of two separate brand lists.
5. A model belongs to exactly one machine type. If the same model name exists in two types, it is two models; names are
   unique per brand and machine type.
6. Part groups and machine types can move across parents (wider than textile), only while unreferenced.
7. Price models and rental periods stay fixed in code, labels translated in the app; units and conditions are admin
   lists.
8. Catalogue names are English only for now; translation comes later, as textile did.
9. A4's admin pages use the current admin kit; the Periwinkle v2 admin restyle is a separate task.
10. Year of manufacture, condition, quantity, price, location and "can be seen running" are fixed listing columns (M5),
    not catalogue fields; A4 seeds only category- and type-specific fields (§5).
11. Seeded brands and models carry a stored `needs_review` flag the admin clears after client confirmation (§6).
12. Pre-owned Machinery is dropped as a category; F2F's two "Equipment" catch-alls merge into one (§4.1). Featuring a
    machine type (such as embroidery) on the app's Home is not part of A4; M2 handles it.
13. Moving nodes across parents (call 6) means clash checks must cover the destination's effective templates; the plan
    handles locking for that, since textile's per-section lock no longer covers it.
14. Because embroidery stays inside "Sewing, Embroidery & Garments" (owner: mirror F2F), anything embroidery-wide
    (fields such as maximum embroidery area or head type) is set on **each embroidery machine type** (multi head, single
    head, shuttle / Schiffli, sequin, chenille), not on the category, so it never reaches sewing machines. The seed does
    this repetition. No embroidery node has sides at launch; if the client later wants sides for embroidery, the same
    rule applies (set them per embroidery type, never on the category). Splitting Embroidery into its own category is possible **only before
    launch**: moving machine types needs nothing to reference them (§4), and after embroidery listings exist it would
    need a migration tool we haven't scoped. It is a pre-launch decision for the client (§15).

## 12. Constraints

Stack and conventions from `CLAUDE.md` (Fastify + Drizzle + Zod, `db:generate` migrations never hand-edited, Next.js
admin with RHF + Zod, Vitest). Integration tests run against the local Docker `mpm_test` database and leave it exactly
as found (fixtures unique per run, deleted in `afterAll`, never touching seeded rows). Size: 10 categories, ~250
machine types, ~330 part groups (~90 specific: embroidery's groups per embroidery type, water-jet's 11, F2F's spare-part
types; plus ~245 process-wide parts groups, one per other machine type), ~80 fields, 14 brands, 19 models. About 600
nodes is still small enough to return the public tree whole (names, paths and side settings only; templates are fetched
per node, never inside the tree).

## 13. Related follow-up (separate from A4)

Correct `docs/product-scope.md` (M4 examples, D9, side convention D3) and the Periwinkle v2 mockup content to textile
machines (embroidery, water-jet looms) instead of tractors, trucks and backhoes. The design stays; only the examples
change.

## 14. Left to the builder

Table and column names, indexes; caching of public endpoints; tree component and reorder interaction; export format;
seed file layout; the icon list for machine categories; exact field lists and options per part group (within §10's
direction), all as in textile.

## 15. Open items for the client (don't block building)

1. Review every node, field, brand and model (CSV export).
2. Confirm or change the default side convention and which part groups have sides.
3. Which other categories to fill in next, and who supplies their brands and models (D9).
4. **Decide before launch:** keep embroidery inside "Sewing, Embroidery & Garments" (as F2F), or split it into its own
   category. After listings exist, a split needs a tool we haven't scoped (§11 call 14).
5. **For the client's category manager:** a machine type added in the admin panel after launch does not get a
   "… machinery parts" / "Textile machine parts" group automatically. Add at least one part group to it, or sellers
   can't list parts for that machine.
