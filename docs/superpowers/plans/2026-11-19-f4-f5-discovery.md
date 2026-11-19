# F4 + F5 Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. **Batch by batch, one at a time, on `develop`** (owner, 2026-11-19: no parallel lanes, no
> worktrees, no lane branches for this feature). One implementer per batch does its tasks in order; the batch is
> reviewed and fixed before the next batch is dispatched. Steps use checkbox (`- [ ]`) syntax.

**Status:** **Approved by the owner 2026-11-19.**

**Spec:** `docs/superpowers/specs/2026-11-19-f4-f5-discovery-design.md` (with review changes §16, §16.1, §16.2). Section
numbers below (§n) refer to it.

**Goal:** Buyers (guests included) find parts, machines and rentals by name, part number, brand, model, side or `#ref`,
near them by GPS, with M3's filters, sorts, facets and a Left / Right / Pair side filter; Home shows top items and
rentals nearby; Browse walks the catalogue with live counts; buyers save listings and see recently viewed; the category
manager maintains synonyms and watches zero-result and trending searches.

**Architecture:** New columns on `listings` (`search_title_text`, `search_text`, `search_point`, `search_refreshed_at`)
and `brands.chip_needs_context`; new tables `search_synonyms`, `search_queries`, `search_trending_hidden`,
`saved_listings`, `search_refresh_jobs`. All rules in `apps/api/src/services/discovery/*`: `search-text.ts` is the only
writer of the search columns; `query-reader.ts` is pure; `search.service.ts` builds one read-only transaction per search
(`set_config` for the trigram threshold, then items, count, facets sequentially). Shared request / response types and
`cleanFilters()` in `packages/shared-types`. Public routes in `routes/discover.ts` (`optionalUser`), saved in
`routes/saved-listings.ts`, admin in `routes/admin/search.ts`. App: guest navigation, a discovery origin hook, Home,
Search (start, browse, results, filters), Saved. Admin: Search synonyms, Search insights.

**Tech stack:** Fastify 4, Drizzle 0.31 + drizzle-kit 0.22, Zod, PostGIS, `pg_trgm`, Node `crypto` (AES-256-GCM),
Redis (reader version key, rate limits); Expo SDK 54, React Navigation 7, TanStack Query (`useInfiniteQuery`),
`expo-location` (installed with F1), AsyncStorage; Next.js 14 admin kit.

---

## Global constraints

- **Branches:** everything on `develop`, batches in order (B0 → B7). **Implementers never commit or push**; each task
  ends with "Stage" (list the files). The controller commits after a batch passes review and pushes at milestones only
  (owner: not after every step).
- **B0 owns the contracts** (migrations, `schema.ts`, shared-types, env, error codes). A later batch that needs a
  contract change makes it in its own batch, says so in the batch report, and keeps every earlier test green.
- Routes: Zod-parse → service → `{ data }`. Services throw `AppError` subclasses with the codes of §10. Public discovery
  routes `preHandler: fastify.optionalUser`; saved routes `fastify.requireUser`; admin
  `fastify.requireAdminRole('category_manager')` (super_admin passes). Every admin mutation writes `audit_log` via
  `writeAudit` (`search_synonym.create / update / delete`, `search_trending.hide / unhide`, brand edits as today).
- **Visibility:** every discovery query starts from `publicListingWhere()` plus §R7's kind rule through one helper,
  `discoveryWhere()` (B0). Never hand-write the status list.
- **Migrations:** edit `schema.ts` → `pnpm --filter @mpm/api db:generate`; what Drizzle can't express (GIN trigram
  opclass if needed, `mpm_normalize_search`) in one `drizzle-kit generate --custom` migration. Never edit existing
  migrations. Apply with `db:migrate` **and** `db:migrate:test`.
- After editing `packages/shared-types`: `pnpm --filter @mpm/shared-types build`; its tests live in
  `apps/api/src/lib/*-shared.test.ts`.
- **API tests:** real `mpm_test`; fixtures unique per run (`createTestSeller`, `insertTestListing` from
  `__tests__/_helpers/`; pincode rows for this feature in `990021`–`990029`); **`mpm_test` has no listings, synonyms,
  search queries, saved rows, refresh jobs or trending-hidden rows after a run** (each suite deletes what it inserts in
  `afterAll`; synonym suites use terms prefixed `zzt-<runId>`). Redis keys used by tests carry the `DISCOVERY_REDIS_PREFIX` the vitest env sets per worker (incl. the reader version key) and are deleted. Fake
  clocks (`vi.useFakeTimers`) for every time-based assertion (reader version check, cursor `asOf`, trending days).
- **Memory is tight: run one package at a time** (`pnpm --filter @mpm/api test`, `pnpm --filter admin test`,
  `pnpm --filter user-app test`); while iterating, run only the task's own test files.
- **App:** every string in `en`, `hi`, `gu` (new areas `locales/<lang>/discover.json`, `saved.json`; additions to
  `auth.json`, `profile.json`), registered in `locales/index.ts`; parity, audit and style-audit tests stay green; light
  only (`useTheme()` → `{ colors, shadows }`); component contract `apps/user-app/CLAUDE.md` §2.1; `testID` on every
  pressable; analytics events declared in `lib/analytics-events.ts`, never query text, pincode or coordinates. Each app
  task registers only its own screens. No new native module (expo-location is already in the build).
- **Admin:** v2 kit and palette classes only; style audit green; nav entries mirror the API roles.
- **Exact numbers (spec):** page size 20; radii 10 / 25 / 50 / 100 / 200 / All India, default 50; suggest ≥ 2 chars, max
  8, 250 ms debounce; count-only debounce 300 ms; recent searches 10; recently viewed 20; saved cap 500; cards ≤ 20 ids;
  words ≤ 10; part numbers ≤ 3; reader version check ≤ every 5 s; suggest counts cached 90 s; trending ≥ 3 distinct days
  and ≥ 5 searches over 7 days; zero results top 50 over 30 days; log retention 90 days; refresh job every 30 s, batches
  of 200, max 5 attempts; trigram threshold 0.6 (suggest 0.5); rate limits search 120, count (`/discover/search/count`) 240, suggest 240,
  other 120 per minute per user / install id, outer 1 200 per minute per IP; GPS cache 10 minutes, phone rounds to 3
  decimals, server snaps to 0.01°; relevance weights §6.1; match weights §5.5.
- **Every task ends green** for its own tests, typecheck of the packages it touched, and lint for admin.
- Windows: Bash is Git Bash; paths relative to the repo root.

## Review focus

1. **Visibility leaks:** a draft / paused / hidden / sold / expired listing, a restricted business's listing, a
   `rented` listing under Parts or Machines for sale, or a non-public listing in suggest counts, browse counts, home,
   cards or saved (saved shows it as unavailable, no card). (B0 `discoveryWhere`, B1, B2.)
2. **Privacy:** coordinates or pincode in any reply, log, analytics event or URL; a personal-data query in
   `search_queries` (check runs on the **raw** input); `saved` exposed for another user. (B0 origin, B1 log, B4.)
3. **Order contract:** under Left every Left before every Pair, and every available rental before every rented one, in
   every sort; nearest ties by relevance; page 2 stable after a renewal or a GPS refresh. (B0 cursor, B1.)
4. **Index use:** trigram and part-number indexes used (`EXPLAIN` tests, both planner settings); threshold set in the
   transaction, not inherited. (B1.)
5. **Stale search text:** a listing write path that forgets `refreshListingSearch`; a catalogue change that forgets its
   refresh job or the reader version bump. (B1, B2, B0 hooks.)
6. **Guest gating:** a guest reaching a signed-in-only screen or API; a pending save lost or run twice; onboarding
   gating broken for a signed-in user without a business. (B4.)

---

## File map

```
packages/shared-types/src/index.ts                         discovery constants, types, cleanFilters, ListingCard saved/tags (B0-1)
apps/api/src/lib/discovery-shared.test.ts                  cleanFilters + constants tests (B0-1)
apps/api/src/db/schema.ts + infra/migrations/00NN..        columns, tables, enums, indexes, mpm_normalize_search (B0-2)
apps/api/src/env.ts, .env.example, apps/api/vitest.config.ts   DISCOVERY_CURSOR_SECRET (B0-2)
apps/api/__tests__/_helpers/{test-listings,test-discovery}.ts  fixtures + cleanup (B0-2)
apps/api/src/services/discovery/{visibility,origin,distance,ranking,cursor,reader-version,rate-key}.ts   shared core (B0-3)
apps/api/src/services/listings/{other-side,listing-view}.service.ts   distance move, loadCards signature (B0-3)
apps/api/src/routes/discover.ts, routes/saved-listings.ts, routes/admin/search.ts, app.ts   route stubs (B0-3)
apps/api/src/services/discovery/{normalize,search-text,query-reader,reader-dictionary,matching,filters,facets,
  search.service,suggest.service,trending.service,search-log.service,refresh-jobs}.ts   (B1)
apps/api/src/db/backfill-search.ts, package.json script db:backfill:search, src/jobs/index.ts   (B1)
apps/api/src/services/listings/{listing-write,listing-lifecycle,listing-admin}.service.ts   refresh hooks (B1-2)
apps/api/src/services/catalog/*-admin.service.ts           refresh-job rows + version bump (B1-2)
apps/api/src/services/discovery/{home,browse,cards,saved,synonym-admin,insights}.service.ts,
  db/seed-search.ts + db/seed-data/search-synonyms.ts, routes/catalog.ts (?depth=1)   (B2)
apps/admin/lib/search-api.ts, lib/nav.ts, components/search/*, app/(dashboard)/search-{synonyms,insights}/page.tsx,
  components/catalog/brand-dialog (chip_needs_context checkbox)   (B3)
apps/user-app/lib/{install-id,discovery-origin,discover-api,saved-api,recent-searches,recently-viewed,search-filters,
  pending-action}.ts + tests, hooks/{use-discovery-origin,use-require-sign-in,use-discover,use-saved}.ts,
  store/authSlice.ts, navigation/*, components/{GridCard,MiniCard,SaveButton,FilterChipRow,LocationChip,SignInSheet,
  LocationSheet}.tsx, components/ListingCard.tsx, screens/welcome.tsx, screens/profile.tsx   (B4)
apps/user-app/screens/tabs/search.tsx, screens/search/{results,filters,brand,sort-sheet}.tsx   (B5)
apps/user-app/screens/tabs/home.tsx, screens/saved.tsx, screens/listing/* (heart, recently viewed)   (B6)
apps/user-app/locales/{en,hi,gu}/{discover,saved,auth,profile}.json, locales/index.ts   (B4–B6)
docs/PROJECT_STATUS.md, apps/user-app/CLAUDE.md, CLAUDE.md (if commands change)   (Close-out)
```

---

# Batch B0 — Contracts

### B0-1: Shared types

**Files:** Modify `packages/shared-types/src/index.ts`; Test `apps/api/src/lib/discovery-shared.test.ts`.

**Contents (§4.7):** `DISCOVERY_RADII_KM`, `DEFAULT_RADIUS_KM`, `SEARCH_SORTS`, `MIN_QTY_STEPS`, `SYNONYM_TARGETS`,
`SEARCH_SCRIPTS`, `REMOVABLE_CHIPS`, `DISCOVERY_LIMITS` (every number in Global constraints that the app and API both
need); types `DiscoveryOrigin` (incl. `fallback`), `OriginEcho` (source incl. `out_of_range`), `SearchFilters` (§5.7
incl. `hasVideo`), `SearchRequest`, `QueryReading` (`ref`, `brand`, `model`, `category`, `partNumbers`, `side`,
`words`), `SearchFacets`, `SearchPage` (`partial`, `widen`, `refSuggestion`), `CountOnlyResult { total, partialTotal }`,
`HomeView`, `BrowseView`, `BrandBrowseView`, `Suggestion` (incl. `listing`), `SavedListingItem`, `SearchSynonym`,
`TrendingRow`, `ZeroResultRow`, `ListingCardTag`; `ListingCard` gains `saved: boolean | null` and `tags`. Pure
`cleanFilters(filters)` (drops empty arrays, nulls, false toggles, empty spec entries; stable key order).

- [ ] **Step 1: Failing tests:** `cleanFilters` drops empties and orders keys (same output for permuted input); radii and
  sorts constants; `DISCOVERY_LIMITS` values match the spec.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; build shared-types; fix every consumer of `ListingCard` (API card mapper
  returns `saved: null, tags: []` for now; app fixtures). **Step 4:** PASS; `pnpm typecheck`. **Step 5: Stage.**

### B0-2: Schema, migrations, env, fixtures

**Files:** Modify `apps/api/src/db/schema.ts`; new migrations in `infra/migrations/`; Modify `apps/api/src/env.ts`,
`.env.example`, `apps/api/vitest.config.ts`, dev `.env` (fresh secret, never committed); Modify
`__tests__/_helpers/test-listings.ts`, Create `__tests__/_helpers/test-discovery.ts`; Test
`apps/api/__tests__/discovery-schema.test.ts`.

**Contents (§4):** listings columns + indexes (`listings_search_text_trgm_idx`, `listings_search_title_text_trgm_idx`,
`listings_search_point_idx`, `listings_public_refreshed_idx`); `brands.chip_needs_context`; enums `search_script`,
`synonym_target`, `search_refresh_scope`; tables `search_synonyms` (CHECK `search_synonyms_target_shape`, unique index
with text casts), `search_queries`, `search_trending_hidden`, `saved_listings`, `search_refresh_jobs`; custom migration:
GIN opclass (if Drizzle can't), `mpm_normalize_search(text)` SQL function **`IMMUTABLE`** (§5.1, exactly mirrored by
B1's TS twin; uses `normalize(…, NFKD)` / `NFC`). Already in place, no change: `pg_trgm` is enabled by
`infra/migrations/0000_extensions.sql` (`CREATE EXTENSION IF NOT EXISTS pg_trgm`), and Postgres is 18.6 (≥ 13 needed
for `normalize()`); the schema test asserts both.
`DISCOVERY_CURSOR_SECRET` required (≥ 32 chars) in `env.ts`; set in the vitest env, which also sets `DISCOVERY_REDIS_PREFIX` per worker (B0-3). Helpers: `deleteTestDiscovery(runId)`
(synonyms, queries, hidden, saved, jobs), saved rows deleted with listings in `deleteTestBusinesses`.

- [ ] **Step 1: Failing tests:** tables / columns / indexes exist (catalog queries); CHECK refuses a synonym with two
  targets; unique index refuses a duplicate; `saved_listings` cascades on listing delete; `show_trgm(
  mpm_normalize_search('बायाँ'))` and Gujarati non-empty; database ctype is UTF-8; `pg_trgm` installed and
  `server_version_num ≥ 130000`; `mpm_normalize_search` is `IMMUTABLE` (`pg_proc.provolatile = 'i'`); env refuses a
  missing secret.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; `db:generate`, custom migration, `db:migrate`, `db:migrate:test`.
  **Step 4:** PASS. **Step 5: Stage.**

### B0-3: Shared discovery core and stubs

**Files:** Create `apps/api/src/services/discovery/{visibility,origin,distance,ranking,cursor,reader-version,rate-key}.ts`;
Modify `services/listings/other-side.service.ts` (use `distance.ts`), `services/listings/listing-view.service.ts`
(`loadCards(conn, rows, { viewerUserId?, viewerBusinessId?, origin?, side? })` computes `saved`, `distanceKm`, `tags`);
Create route stubs `routes/discover.ts`, `routes/saved-listings.ts`, `routes/admin/search.ts` (registered in `app.ts`,
each handler `throw new AppError(501, 'NOT_IMPLEMENTED')` until its batch); Modify `plugins/rate-limit.ts` (route-level
key function) and **wire the limits on every `/discover/*` stub now** (search 120; count 240 on its **own path
`POST /discover/search/count`**, because `@fastify/rate-limit` runs on `onRequest`, before the body is parsed; suggest 240; home / browse / brand / cards / trending 120 per minute per
`discoveryRateKey`, plus the 1 200 per minute per-IP outer cap), so later batches inherit them; Test
`__tests__/discovery-core.test.ts`.

**Interfaces:**
- `discoveryWhere(t, { kinds })` → SQL: `publicListingWhere(t)` and `status IN ('live','reserved')` or (`status =
  'rented'` and kind `machine_rental` and kinds empty or containing it) (§R7).
- `resolveOrigin(db, origin, viewer)` → `{ point: {lat,lng} | null (snapped), echo: OriginEcho }` (§6.3: bounding box,
  fallback, pincode centroid, business, `401` for a guest `business`, `PINCODE_UNKNOWN`). Label: for `gps` and
  `pincode`, the nearest pincode office's area and city; **for `business`, the business's industrial area (or its
  "Other" text) and city**.
- `distance.ts`: `snappedKmSql(pointCol, origin)` (floor, min 1), `withinRadiusSql(pointCol, origin, r)` (`ST_DWithin`
  with r + 3 km **and** snapped km ≤ r) (§6.2).
- `ranking.ts`: `relevanceSql({ asOf, origin, radiusKm })` (§6.1, × 0.6 reserved); `tierSql({ side })` (§5.5).
- `cursor.ts`: `sealCursor(payload, aad)`, `openCursor(token, aad)` (AES-256-GCM, key from `DISCOVERY_CURSOR_SECRET`,
  `CURSOR_INVALID`); `requestHash(req)` = sha256 of canonical JSON of the request without `cursor` (origin included).
- `reader-version.ts`: key `${prefix}discovery:reader:version`, where `prefix` comes from `DISCOVERY_REDIS_PREFIX`
  (empty in dev and production; the vitest env sets `test:<runId>:` per worker, and suites delete their keys);
  `bumpReaderVersion(redis)`, `readReaderVersion(redis)`. Tests never touch the unprefixed key.
- `rate-key.ts`: `discoveryRateKey(request)` → `u:<userId>` | `i:<X-Install-Id uuid>` | `ip:<ip>`; plus the outer per-IP
  limit for `/discover/*`.

- [ ] **Step 1: Failing tests:** `discoveryWhere` (statuses, rented only with rentals in kinds, suspended owner hidden);
  `resolveOrigin` (snap, out of range → fallback + `out_of_range`, pincode centroid, unknown pincode 400, business pin,
  business pincode centroid, guest business 401, no business → null; labels: gps / pincode → office area + city,
  business → industrial area (or Other text) + city); snapped km and radius never disagree at the edge; tier values;
  relevance uses `asOf`; cursor round trip, tamper, wrong AAD; version bump / read under the test prefix; rate key for
  user / install id / ip; each `/discover/*` stub answers `429` past its limit (low limits injected in the test) and
  count-only (`/discover/search/count`) has its own bucket (exhausting search doesn't block count and vice versa); F2 other-side tests still pass; `loadCards` sets `saved` for a viewer and `tags` for a
  side.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `pnpm --filter @mpm/api test` (whole API suite once,
  B0 only). **Step 5: Stage.**

**B0 exit:** typecheck, lint, API + app + admin suites green one package at a time; review; controller commits and
pushes (milestone).

---

# Batches B1–B6 (one after another)

## Batch B1 — API search

### B1-1: Normaliser and search text

**Files:** Create `services/discovery/{normalize,search-text}.ts`; Test `__tests__/discovery-normalize.test.ts`,
`__tests__/discovery-search-text.test.ts`.

**Interfaces:** `normalizeSearchText(s)` (§5.1: NFKD → strip U+0300–036F → NFC; delete U+200C, U+200D, U+00AD;
lower-case; Indic digits → ASCII; other chars and dandas → space; collapse). `buildSearchColumns(row)` pure;
`refreshListingSearch(tx, ids)` (§4.1, §5.2: both part-number forms, category path names, part brand, fitments, machine
brand / model and `*_other`, option labels, condition label, no side words, no description; `search_point` = point or
pincode centroid).

- [ ] **Step 1: Failing tests:** 40-string twin test against `mpm_normalize_search` (accents, nukta, virama, ZWJ / ZWNJ
  inside words, three digit scripts); "AB-123/X" stored as `ab 123 x` and `ab123x`; no description, no side words;
  centroid when no pin; option label used for selects.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Stage.

### B1-2: Refresh hooks and the refresh job

**Files:** Modify `services/listings/{listing-write,listing-lifecycle,listing-admin}.service.ts`,
`services/catalog/{category-admin,brand-admin,master-admin,field-admin}.service.ts` (every catalogue mutation);
Create `services/discovery/refresh-jobs.ts`; Modify `src/jobs/index.ts`;
Create `src/db/backfill-search.ts` + `package.json` script `db:backfill:search`; Test
`__tests__/discovery-refresh.test.ts`.

**Rules:** every listing write that changes an input calls `refreshListingSearch(tx, [id])` in its transaction.
Catalogue writes, two separate rules:
- **Reader version bump (`bumpReaderVersion` after commit) on every catalogue mutation of categories, brands, models,
  conditions and template options**: create, update (any field, incl. names, parent, `is_active` / status and
  `chip_needs_context`), delete, reorder that changes the tree. A helper `afterCatalogCommit(redis)` is called from
  each service so none is missed.
- **Refresh job row** (in the same transaction) only when listings' search text can change: rename, move, delete,
  option-label or condition-label change.

Job
`search-refresh` (30 s): claim one job `FOR UPDATE SKIP LOCKED`, batches of 200 ids in id order, each its own
transaction locking listings `FOR UPDATE`, done / `last_error` + retry ≤ 5. Backfill: all listings in batches of 200,
idempotent.

- [ ] **Step 1: Failing tests:** each write path (create, patch title / specs / part number / brand / category,
  fitments, machine details, location, publish, relist, admin edit) moves `search_refreshed_at`; category rename writes
  a job and no listing lock is held by the admin transaction; the job rebuilds descendants' listings; a failing batch
  records `last_error` and retries; the version key changes after **each** catalogue mutation (table-driven over
  create / update / delete / activate / deactivate for category, brand, model, condition, option; the brand
  `chip_needs_context` toggle is tested in B2-3, where the brand admin starts accepting it); **a newly created brand becomes a chip** and **a deactivated brand stops being one**
  after the next dictionary check (fake clock); backfill twice gives the same text.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS (and the existing listings / catalogue suites still
  pass). **Step 5:** Stage.

### B1-3: Query reader and dictionary

**Files:** Create `services/discovery/{query-reader,reader-dictionary}.ts`; Test `__tests__/discovery-reader.test.ts`
(pure, no DB) and `__tests__/discovery-dictionary.test.ts`.

**Interfaces:** `readQuery(raw, dict)` → `QueryReading` (§5.3 order: `#ref`; synonym phrases; names with
`chip_needs_context` unlocked only by a model of the brand or a `machine_type`; part numbers on free tokens; side
words; stop words; ≤ 10 words, ≤ 3 part numbers). `applyRemovedChips(reading, removed)` (side words dropped; others
back to words). `loadReaderDictionary(db, redis, clock)`: in-process cache, version check at most every 5 s.

- [ ] **Step 1: Failing tests (≥ 40 cases):** `#100123` → ref; bare `100123` → words (route adds `refSuggestion`);
  `JS205`, `EX200`, `PC210` → model chips; `tata 1613 tie rod end lh` → brand + model + side left + words;
  `बायाँ टाई रॉड` and `ડાબું` → side left; "bull gear" with a Gears part group → words; "bull backhoe loader" and "bull
  <model>" → Bull chip; "TRE" synonym → tie rod end words; ambiguous model across brands → words; category tie → none;
  removed side chip drops `lh`; stop words in three languages; dictionary: a second loader sees a synonym after a fake
  5 s advance, not before.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Stage.

### B1-4: Matching, filters, order, facets, search route

**Files:** Create `services/discovery/{matching,filters,facets,search.service}.ts`; Modify `routes/discover.ts`
(`POST /discover/search`); Test `__tests__/discovery-search.test.ts`, `__tests__/discovery-search-order.test.ts`,
`__tests__/discovery-explain.test.ts`.

**Rules:** one read-only transaction: `set_config('pg_trgm.word_similarity_threshold','0.6', true)`; word hits §5.4
(`LIKE` on the column, `<%` for ≥ 5 chars without digits, whole-word for < 3); part numbers on `part_number_norm` /
`part_number_base` / compact form; full → else widen (from full matches) + partial (part numbers still required);
filters §5.7 (strict Zod, `FILTER_NOT_AVAILABLE`); order (tier, key[, relevance], id) §5.5 / §5.8 with match weights;
cursor `{ asOf, tier, key, key2, id }`, later pages `refreshed_at ≤ asOf`; `total` + facets (sequential, side facet =
returned set) on page 1; `#ref` redirect; bare-ref `refSuggestion`; `POST /discover/search/count` → `{ total, partialTotal }` (same request
builder, no cursor, no log); reply cards via
`loadCards` with viewer, origin, side.

- [ ] **Step 1: Failing tests:** typo "hydralic" finds hydraulic; partial banner case; partial ignores a missing part
  number? → no (part number required); widen from full matches shown with partial; empty + widen; every filter; every
  sort and its 400s; under Left every Left before every Pair in best match / nearest / newest / price; available rental
  before rented in every sort; rented absent under Parts / Machines for sale and present under All; nearest ties by
  relevance; facets disjunctive, side facet equals result count; radius never shows km above r; cursor tamper / sort
  swap / request swap / origin swap → `CURSOR_INVALID`; page 2 stable after a renewal between pages (fake clock);
  count-only with `partialTotal`; a role-level threshold of 0.9 doesn't change results (set in transaction);
  `EXPLAIN` with `enable_seqscan = off` (three words, a Hindi word, a part number) and with default settings on ~3 000
  seeded rows after `ANALYZE` (selective word, part number) use `listings_search_text_trgm_idx` /
  `listings_part_number_norm_idx`; seeded rows deleted in `afterAll`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Stage.

### B1-5: Suggest, trending, search log, retention

**Files:** Create `services/discovery/{suggest.service,trending.service,search-log.service}.ts`; Modify
`routes/discover.ts` (`GET /discover/suggest`, `GET /discover/trending`), `src/jobs/index.ts`
(`search-query-retention`); Test `__tests__/discovery-suggest.test.ts`, `__tests__/discovery-log.test.ts`.

**Rules:** suggest §5.12 (transaction with threshold 0.5, 90 s count map, `listing` entry for a ref); trending ≥ 3
distinct days and ≥ 5 searches over 7 days, minus hidden; log §5.13 — `isPersonalQuery(raw)` on the **raw lower-cased**
input (mobile with 0 / 91 / +91, 12-digit run — **maximal digit runs** only, `(?<!\d)…(?!\d)` after removing spaces
and dashes between digits — `@`, GSTIN, PAN), then store the normalised text; first page only, words
or part numbers only; retention deletes > 90 days in `SKIP LOCKED` batches. Rate limits per §7 via `discoveryRateKey`.

- [ ] **Step 1: Failing tests:** suggest prefix / typo / synonym / brand / model / listing entries, zero counts dropped,
  counts cached (second call within 90 s doesn't re-query: spy); trending day and count thresholds, hidden excluded
  (fake clock); log written once, never for count-only / suggest / page 2; `rahul@gmail.com`, `+91 98765 43210`,
  `09876543210`, a 12-digit run, a GSTIN, a PAN skipped; a 9-digit and an 11-digit part number logged — **the
  11-digit one must not start with `0` followed by 6–9** (that shape is a mobile with a `0` prefix and is correctly
  skipped): use e.g. `12345678901`; a **13-digit part number containing a 10-digit stretch that starts with 6–9** (e.g.
  `1987654321012`) is logged (maximal runs); retention deletes old rows only; search and suggest answer `429` past their limits
  (wired in B0-3).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Stage.

**B1 exit:** the batch's tests and typecheck green (admin: lint, style audit, build; app: parity, audit, style audit, `expo export`); review; controller commits.

## Batch B2 — API discovery, saved, admin API, seed

### B2-1: Home, browse, brand view, cards, roots

**Files:** Create `services/discovery/{home,browse,cards}.service.ts`; Modify `routes/discover.ts` (`/discover/home`,
`/discover/browse`, `/discover/browse/brand`, `/discover/cards`), `routes/catalog.ts` (`GET /categories?depth=1`); Test
`__tests__/discovery-home.test.ts`, `__tests__/discovery-browse.test.ts`.

**Rules (§7):** home top 8 parts + machines by relevance within radius, business-category restriction only when it
yields ≥ 4; rent 8 available first; kind tiles with counts; root categories. Browse: grouped count by `path` prefix,
within radius when an origin is given, zero children hidden, crumbs, 6 popular brands (part brand or fitment brand).
Brand view: models with counts + `otherCount`. Cards: public ids only, in the given order, ≤ 20. All through
`discoveryWhere`, `resolveOrigin`, `loadCards`.

- [ ] **Step 1: Failing tests:** home restriction and fallback; rentals available first; counts within radius vs All
  India; zero children hidden; popular brands; brand view counts; cards order and dropped non-public ids; `?depth=1`
  returns roots only; no reply contains a point or pincode; home, browse, brand view and cards answer `429` past 120 /
  min (limits wired in B0-3; checked here with a low injected limit).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Stage.

### B2-2: Saved listings

**Files:** Create `services/discovery/saved.service.ts`; Modify `routes/saved-listings.ts`; Test
`__tests__/saved-listings.test.ts`.

- [ ] **Step 1: Failing tests:** save public → 200, idempotent; own → `409 CANNOT_SAVE_OWN_LISTING`; non-public →
  `404 LISTING_NOT_FOUND`; 501st → `409 SAVED_LIMIT`; delete always `{ saved: false }`; list keyset (sealed cursor),
  unavailable items carry no card; `saved: true` on cards for that user only; cascade on listing delete; guest 401.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Stage.

### B2-3: Synonym and insights admin API, brand flag, seed

**Files:** Create `services/discovery/{synonym-admin,insights}.service.ts`, `src/db/seed-search.ts`,
`src/db/seed-data/search-synonyms.ts`, `package.json` script `db:seed:search`; Modify `routes/admin/search.ts`,
brand admin service + route (accept `chipNeedsContext`), catalogue seed data (flag Bull, ACE and the plan-time list:
brands whose name is an ordinary English word); Test `__tests__/admin-search.test.ts`, `__tests__/seed-search.test.ts`.

**Rules (§7.1):** CRUD with target checks (`SYNONYM_TARGET_INVALID`, `SYNONYM_EXISTS`), script derived, audit rows,
`bumpReaderVersion` after commit; preview returns `readQuery` output (B1's reader); zero-results and trending lists; hide / unhide trending (audit). Seed: side
words (§5.3 list), ~60 synonyms (TRE, fender, bush, brg, cyl, hyd, assy, gear, bearing in hi / gu, …), stop words into
`app_settings` `search.stop_words`; refuses on a filled table.

- [ ] **Step 1: Failing tests:** RBAC (moderator 403, category_manager 200, super_admin 200); create / update / delete
  with audit before / after; duplicate 409; bad target 400; version key bumped; zero-results top 50 (30 days);
  trending with hidden marked; hide / unhide audited; brand `chipNeedsContext` saved, audited and **bumps the reader
  version** — after the next dictionary check (fake clock) "bull gear" stays words with the flag on and reads the Bull
  chip with it off; seed loads once and refuses a second run.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Stage.

**B2 exit:** the batch's tests and typecheck green (admin: lint, style audit, build; app: parity, audit, style audit, `expo export`); review; controller commits.

## Batch B3 — Admin pages

### B3-1: Search synonyms page and the brand flag

**Files:** Create `apps/admin/lib/search-api.ts`, `components/search/{synonyms-table,synonym-dialog,try-search}.tsx`,
`app/(dashboard)/search-synonyms/page.tsx`; Modify `lib/nav.ts` (Catalogue › Search synonyms, Search insights,
`roles: ['category_manager']`), the brand dialog in `components/catalog/` (checkbox "Read as a brand chip only with one
of its models or a machine type"); Tests next to each.

- [ ] **Step 1: Failing tests:** table renders rows and filters by target kind; dialog validates term and target per
  kind (category tree picker, brand, model, side, words); delete confirm; "Try a search" shows chips from the preview
  call (mocked); nav entries only for category_manager / super_admin; brand checkbox sends `chipNeedsContext`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (v2 kit, palette classes). **Step 4:** PASS; style audit; lint.
  **Step 5:** Stage.

### B3-2: Search insights page

**Files:** Create `components/search/{zero-results-table,trending-table}.tsx`,
`app/(dashboard)/search-insights/page.tsx`; Tests.

- [ ] **Step 1: Failing tests:** zero-results rows with counts and last day; "Make a synonym" opens the dialog with the
  term filled; trending rows with distinct days; Hide / Unhide calls and refreshes.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; admin build. **Step 5:** Stage.

**B3 exit:** the batch's tests and typecheck green (admin: lint, style audit, build; app: parity, audit, style audit, `expo export`); review; controller commits.

## Batch B4 — App foundation

### B4-1: Install id, guest navigation, sign-in sheet, pending action

**Files:** Create `apps/user-app/lib/{install-id,pending-action}.ts` + tests, `hooks/use-require-sign-in.ts`,
`components/SignInSheet.tsx`; Modify `lib/api.ts` (send `X-Install-Id`), `store/authSlice.ts` (guest flag, `pending`),
`navigation/{root-navigator,tab-navigator,types}.tsx`, `screens/welcome.tsx` ("Browse first", `Welcome-browse`),
`screens/profile.tsx` (guest "Sign in" card; "Saved (n)" row hidden until B6), Post / Chats / Deals tab guards,
`locales/*/auth.json`, `profile.json`, `lib/analytics-events.ts`.

- [ ] **Step 1: Failing tests (pure):** install id created once and reused; pending action stored, run once after sign-in
  and onboarding, dropped on cancel; guest guard decision for each tab; i18n parity / audit for new keys.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; app typecheck; `expo export --platform android`.
  **Step 5:** Stage.

### B4-2: Discovery origin and location sheet

**Files:** Create `lib/discovery-origin.ts` + test, `hooks/use-discovery-origin.ts`, `components/{LocationSheet,
LocationChip}.tsx`; Modify `locales/*/discover.json` (new area), `locales/index.ts`, `lib/analytics-events.ts`
(declare `DISCOVERY_EVENTS.locationPermissionAnswered { granted }`, `locationChanged { source, radiusKm }`, fired here).

**Rules (§8.2):** first Home focus asks permission; granted → position cached 10 min, rounded to 3 decimals, sent with
fallback; denied / `out_of_range` → business (signed in) or saved pincode or null; never re-asks by itself; sheet
actions; radius and pincode stored, coordinates never stored; `freezeOrigin()` helper returns the origin captured for a
list (R18).

- [ ] **Step 1: Failing tests:** origin for each permission / sign-in / pincode case; `out_of_range` echo → fallback
  next time; rounding; radius / pincode storage round trip; frozen origin unchanged after the cache refreshes (fake
  clock).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Stage.

### B4-3: API clients, hooks, filters helpers, kit pieces

**Files:** Create `lib/{discover-api,saved-api,search-filters,recent-searches,recently-viewed}.ts` + tests,
`hooks/{use-discover,use-saved}.ts`, `components/{GridCard,MiniCard,SaveButton,FilterChipRow}.tsx`; Modify
`components/ListingCard.tsx` (heart, tags, distance "Under 2 km"), `lib/listing-errors.ts` (new codes), mocks in
`__mocks__/lucide-react-native.ts` for new icons, `lib/analytics-events.ts` (declare `SAVED_EVENTS.listingSaved`,
`listingUnsaved`, fired by `useSaveToggle`), `lib/listing-format.ts` or a new `lib/side-tags.ts` (side tag copy keys).

**Rules:** React Query keys under `['discover', …]`; `useSearch(request, frozenOrigin)` = `useInfiniteQuery`
(`CURSOR_INVALID` → reset); `useCountOnly(request, frozenOrigin)` (calls `POST /discover/search/count`) debounced 300 ms — **the same frozen origin as the
list** (§8.4, R18); `sideTagKey(tag)` maps `reserved`, `on_rent`, `pair_contains_left`, `pair_contains_right` to copy
keys ("Reserved", "On rent", "Pair: contains a left / right"); `useSaveToggle` optimistic, patches every cached card,
guest → `requireSignIn`; `search-filters.ts`: `countFilters`, chip summaries, radius label; recent searches (10) and
recently viewed (20, own skipped).

- [ ] **Step 1: Failing tests:** filter count and chip summary copy keys; recent / viewed list rules; save toggle cache
  patch (pure reducer); error code mapping; **side tag copy** (each tag → its key, keys present in en / hi / gu);
  count-only request built with the frozen origin, not the current one.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; style audit. **Step 5:** Stage.

**B4 exit:** the batch's tests and typecheck green (admin: lint, style audit, build; app: parity, audit, style audit, `expo export`); review; controller commits.

## Batch B5 — App search

### B5-1: Search tab start, browse, brand view, suggestions

**Files:** Modify `screens/tabs/search.tsx`; Create `screens/search/brand.tsx`; Modify navigation (register
`SearchBrand`; the Search tab route takes params **`{ browseNodeId?: string; focus?: boolean }`** — `browseNodeId` opens
Browse at that category node, used by Home's category tiles in B6-1; `focus` opens with the search box focused, used by
Home's search bar), `locales/*/discover.json`, `lib/analytics-events.ts` (declare `SEARCH_EVENTS.searchSubmitted
{ words, chips, kinds }` and `DISCOVERY_EVENTS.browseNodeOpened`, fired here).

- [ ] **Step 1: Failing tests (pure helpers):** breadcrumb builder; suggestion row mapping (category path, brand, model,
  listing); start-state from params (`browseNodeId` → Browse at that node with its crumbs; none → root).
  **Step 2:** FAIL. **Step 3:** Implement per mockup "Browse by machine" (crumbs, tree rows with counts, popular brands
  chips → brand view → results with fit filter), recent + trending, suggestions with 250 ms debounce. **Step 4:** PASS;
  typecheck. **Step 5:** Stage.

### B5-2: Results, sort sheet, filters screen, no results

**Files:** Create `screens/search/{results,filters,sort-sheet}.tsx`; Modify navigation (`SearchResults`,
`SearchFilters`), `locales/*/discover.json`, `lib/analytics-events.ts` (declare `SEARCH_EVENTS.searchResultOpened
{ position }`, `searchFiltersApplied { count }`, `searchWidened`, `searchZeroResults`, fired here).

**Rules (§8.4):** filter row (Filters n, reading chips removable, radius chip, quick chips); count line; "Listing #…"
row; `ListingCard` list (rentals-only → `GridCard` grid); infinite scroll with frozen origin; partial banner with the
widen sentence; sort sheet (machine sorts only for machine kinds); Filters screen per mockup with facet counts and the
live footer (count-only; "No exact matches · Show N close ones"; "No results" disabled); has-video chip hidden while
video is off; No results with widen button.

- [ ] **Step 1: Failing tests (pure):** footer copy selection from `{ total, partialTotal }`; banner copy from
  `{ partial, widen }`; removed-chip request builder; sort options for kinds. **Step 2:** FAIL. **Step 3:** Implement.
  **Step 4:** PASS; i18n parity / audit; style audit; `expo export`. **Step 5:** Stage.

**B5 exit:** the batch's tests and typecheck green (admin: lint, style audit, build; app: parity, audit, style audit, `expo export`); review; controller commits.

## Batch B6 — App home, saved, recently viewed

### B6-1: Home

**Files:** Modify `screens/tabs/home.tsx`, `locales/*/discover.json`, `lib/analytics-events.ts` (declare
`DISCOVERY_EVENTS.homeTileOpened { tile: 'kind' | 'category' }`, fired here).

- [ ] **Step 1: Failing tests (pure):** tile list builder (three kind tiles then roots); tile target (kind tile →
  `SearchResults` with `kinds`; category tile → Search tab with `browseNodeId`); empty-state copy with widen.
  **Step 2:** FAIL. **Step 3:** Implement per mockup "Home" (location chip + sheet, search bar → Search with `focus`, tiles, Top items
  near you grid + See all, Machines for rent nearby, Recently viewed; no bell, no side-match strip); permission ask on
  first focus via `useDiscoveryOrigin`. **Step 4:** PASS; typecheck. **Step 5:** Stage.

### B6-2: Saved screen, hearts, recently viewed recording

**Files:** Create `screens/saved.tsx`; Modify `screens/listing/*` (heart in the header, record recently viewed),
`screens/profile.tsx` ("Saved (n)" row), navigation (`Saved`), `locales/*/saved.json`, `locales/index.ts`.

- [ ] **Step 1: Failing tests (pure):** saved item mapping (available vs unavailable). **Step 2:** FAIL. **Step 3:**
  Implement per mockup "Saved" (no enquire-all bar); unavailable rows with Remove; pending save completes after a
  guest signs in. **Step 4:** PASS; parity / audit / style audit; `expo export`. **Step 5:** Stage.

**B6 exit:** the batch's tests and typecheck green (admin: lint, style audit, build; app: parity, audit, style audit, `expo export`); review; controller commits.

---

# Batch B7 — Integration and close-out

### B7-1: Integration

- [ ] Remove every `NOT_IMPLEMENTED` stub; `grep -rn NOT_IMPLEMENTED apps/api/src` is empty.
- [ ] Run, one package at a time: `pnpm typecheck`, `pnpm lint`, `pnpm --filter @mpm/api test`,
  `pnpm --filter admin test`, `pnpm --filter user-app test`; check `mpm_test` is empty of this feature's rows;
  `pnpm --filter admin build`; `CI=1 npx expo export --platform android` in `apps/user-app`.
- [ ] Dev DB: `db:migrate`, `db:backfill:search`, `db:seed:search`.

### B7-2: Agent verification and docs

- [ ] Scripted API walk-through on the dev DB: two sellers at known distances; search by part number ("AB-123/X" as
  "ab123x"), side word ("lh", "बायाँ"), typo, brand + model, `#ref`; Left with a Pair; widen; count-only; saved; home;
  browse counts; admin synonym create → reader sees it; zero-result entry appears; all data deleted afterwards.
- [ ] Admin pages in Chrome (if the extension is connected; else page loads + API calls, as F2): Search synonyms (add,
  try a search, delete), Search insights (make a synonym, hide trending), brand flag.
- [ ] Update `docs/PROJECT_STATUS.md` (What's built, How to run: `db:backfill:search`, `db:seed:search`,
  `DISCOVERY_CURSOR_SECRET`; Open items; session log), `apps/user-app/CLAUDE.md` (guest navigation, origin hook, new kit
  pieces), `.env.example`.
- [ ] Controller commits and pushes `develop` (milestone).

### B7-3: Owner checklist (not for an implementer subagent)

- GPS permission prompt on first Home open (grant, deny, blocked → settings); location sheet; radius changes.
- Browse first as a guest → search → listing → heart → sign in → saved after onboarding.
- Search on a device in en / hi / gu: side words, typo, part number, filters footer, partial banner, widen.
- Home, Search, Filters, Results, Saved against the Periwinkle v2 mockup (light).
- Review the starter synonyms and the `chip_needs_context` brand list with the client.
