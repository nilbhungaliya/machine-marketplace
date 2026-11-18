# F1 + A2 Business Profile and GST Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A complete business profile with pincode location and an admin-managed industrial-area list; GST verification
that is instant through a provider (lookup + registered-contact code) with admin review plus documents as the fallback;
admin pages for the verification queue, users & businesses (suspend / block / revoke) and industrial areas.

**Architecture:** Port textile's verification module (`services/verification/*`, `lib/storage.ts`, `db/seed-locations*`),
trimmed to the spec (no claims, re-checks, PAN/Udyam, contact number). New Drizzle tables in `apps/api/src/db/schema.ts`;
rules in `services/{business,locations,verification,storage}/`; thin routes; admin pages in `apps/admin`; onboarding,
profile and GST screens in `apps/user-app`. One switch, `getGstMode()`, decides instant vs review everywhere.

**Tech Stack:** Fastify 4, Drizzle + drizzle-kit, Zod, PostGIS, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
(R2), Vitest; Next.js 14 + Tailwind + React Hook Form + Zod; Expo 54 + React Navigation 7 + React Query + Formik/Yup +
i18next, `expo-location`, `expo-document-picker`, `expo-image-picker`, `react-native-maps`.

**Spec:** `docs/superpowers/specs/2026-11-18-f1-a2-business-profile-verification-design.md` (approved 2026-11-18). Read
it before any task; section numbers below (§) refer to it.

**Follows:** textile's plan `E:\textile-marketplace\docs\superpowers\plans\2026-11-07-part1-m1-m14-m15.md` (its M1 tasks)
and the files the spec's "Follows textile" paragraph names. Each task names the textile files to start from.

## Global Constraints

- **Work on `develop`** (no feature branch, no worktree). **Never commit or push**: the owner commits after review. Each
  task ends with "Stage" (list the files) instead of a commit.
- Routes: Zod-parse → service → `{ data }`. Services throw `AppError` subclasses (`src/lib/errors.ts`) with stable codes.
  Add to `errors.ts`: `TooManyRequestsError(message, code)` (429), `ServiceUnavailableError(message, code)` (503),
  `PayloadTooLargeError(message, code, details?)` (413).
- User routes: `preHandler: fastify.requireUser`. Admin reads/writes: `fastify.requireAdminRole(...roles)` with the
  roles in §8 (super_admin always passes).
- Every admin mutation writes one `audit_log` row via `writeAudit` (`services/audit.service.ts`). Action strings:
  `gst_review.approve|reject|ask_for_more`, `gst.revoke|release`, `gst_document.view`, `user.suspend|reinstate|block|unblock`,
  `industrial_area.create|update|reorder|delete|adopt`.
- Migrations: edit `schema.ts` → `pnpm --filter @mpm/api db:generate`; data changes and CHECKs Drizzle can't express go
  in `drizzle-kit generate --custom` migrations. Never edit `0000`–`0003`. Apply with `db:migrate` **and** `db:migrate:test`.
- Tests: real `mpm_test` database; every suite deletes what it inserts in `afterAll`; fixtures unique per run
  (`uniqueTestPhone()`, timestamped names). GST tests use the stub (`setStubGstin` / `resetStubGstins`) and
  `setGstProvider` / `resetGstProvider` for live-mode cases.
- **Storage is R2 only** (§6): no MinIO, no local fallback. Configured = `AWS_S3_ENDPOINT`, `AWS_REGION`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_PRIVATE_BUCKET` all non-empty. Unconfigured → `503 STORAGE_UNAVAILABLE`.
  Tests that need real R2 are `describe.skipIf(!isStorageConfigured())` with the message
  `R2 keys not set: storage round-trip tests skipped`.
- Exact numbers (§5.2): 5 lookups per business per calendar day in India time (business lookups only; officer lookups
  and `failed` results don't count); codes: 3 sends per proof, 30 s between sends, 5 wrong tries;
  confirm within 30 minutes of the lookup's `resolved_at`; documents 2–5 files, each ≤ 10 MB (10 485 760 bytes), JPEG / PNG
  / WebP / PDF; presigned PUT and GET 300 s; stub code `123456`.
- After editing `packages/shared-types`: `pnpm --filter @mpm/shared-types build`.
- App copy: every string through i18n in `en`, `hi`, `gu` (`apps/user-app/locales/<lang>/*.json`); the parity test must
  pass. Admin is English only.
- Before handing back a task: `pnpm typecheck`, `pnpm lint`, and the task's tests green.

## Review Focus

1. **A revoked business tries the instant path again** (stale app screen, direct API call): lookup, declare and
   code-send all answer `409 GST_REVIEW_ONLY` and the stub records no code send. (Task 8.)
2. **Two businesses race for one GSTIN** (both reach confirm / approve at once): exactly one wins, the other gets
   `409 GSTIN_TAKEN`, never a 500 from the unique index. (Tasks 8 and 10.)
3. **A suspended user's open app keeps calling the API** with a valid token: the very next request is `403
   ACCOUNT_SUSPENDED`, and a socket reconnect is refused. (Task 6.)
4. **A document upload that isn't what it claims** (a `.pdf` name with PNG bytes is fine; HTML bytes named `.pdf` is
   not): refused with `400 DOCUMENT_TYPE` and nothing stored on the proof. (Task 9 — pure sniff tests run without R2.)
5. **Officer double-click / two officers on one review**: the second decision gets `409 STALE_REVIEW` and writes no
   second audit row. (Task 10.)

---

## File map

```
packages/shared-types/src/index.ts                          profile, location, GST types + helpers (Task 1)
apps/api/src/lib/errors.ts                                   429 / 503 / 413 errors (Task 1)
apps/api/src/db/schema.ts + infra/migrations/0004..          tables, enums, data mapping, CHECK (Task 2)
infra/seed/pincode-directory.csv.gz, infra/seed/README.md    copied from textile (Task 3)
apps/api/src/db/seed-locations.ts, seed-locations/{parse,load}.ts   (Task 3)
apps/api/src/services/locations/{pincode,industrial-areas}.service.ts   (Tasks 3, 4)
apps/api/src/routes/locations.ts                             public location routes (Task 3)
apps/api/src/db/seed-data/industrial-areas.ts, src/db/seed-industrial-areas.ts   (Task 4)
apps/api/src/services/locations/industrial-area-admin.service.ts, routes/admin/industrial-areas.ts   (Task 4)
apps/api/src/services/business/profile.service.ts, routes/businesses.ts   (Task 5)
apps/api/src/services/user.service.ts                        sign-in returns `onboarding` (Task 5)
apps/api/src/plugins/auth.ts, src/socket/setup.ts            status checks (Task 6)
apps/api/src/services/admin/user-status.service.ts, routes/admin/users.ts   (Task 6)
apps/api/src/services/verification/{gst-provider,gst-stub,gst-mode,gstin}.ts   (Task 7)
apps/api/src/services/verification/{gst-state,gst-instant,gst-grant}.service.ts, routes/gst.ts   (Task 8)
apps/api/src/lib/storage.ts, src/services/verification/gst-documents.service.ts   (Task 9)
apps/api/src/services/verification/gst-review.service.ts, routes/admin/verification.ts   (Task 10)
apps/api/src/services/admin/business-admin.service.ts, routes/admin/businesses.ts   (Task 11)
apps/api/__tests__/_helpers/test-businesses.ts               (Task 5; extended in 8, 10)
apps/admin/lib/{verification-api,businesses-api,industrial-areas-api}.ts   (Tasks 12–14)
apps/admin/app/(dashboard)/{verification,businesses,industrial-areas}/...   (Tasks 12–14)
apps/admin/lib/nav.ts                                        (Tasks 13, 14)
apps/user-app/lib/{business-api,gst-api,gstin}.ts, hooks/use-business.ts   (Task 15)
apps/user-app/screens/onboarding/{your-business,where-are-you}.tsx, navigation/*   (Task 15)
apps/user-app/app.config.ts (replaces app.json values)        maps key (Task 15)
apps/user-app/screens/verification/*, screens/profile.tsx    (Task 16)
.env.example, docs/PROJECT_STATUS.md                          (Tasks 9, 17)
```

---

### Task 1: Shared types and error classes

Start from textile `packages/shared-types/src/index.ts` (`normalizeGstin`, `isValidGstin`, `GstDetails`, `GST_STATUSES`).

**Files:**
- Modify: `packages/shared-types/src/index.ts`, `apps/api/src/lib/errors.ts`
- Test: `apps/api/src/lib/gstin-shared.test.ts` (imports the helpers from `@mpm/shared-types`; that package has no
  test runner, so its tests live in the API), `apps/api/src/lib/errors.test.ts`

**Interfaces:**
- Produces (shared-types):
  - `BUSINESS_ACTIVITIES = ['buy','sell','rent_out']`, `EMPLOYEE_RANGES = ['1-10','11-50','51-200','200+']`,
    `ONBOARDING_STEPS = ['profile','location','done']`, `CONSTITUTIONS = ['proprietorship','partnership','llp',
    'private_limited','public_limited','huf','trust_society','government','other']`, each with its `type`.
  - `GST_MODES = ['live','stub','review']`, `GST_STATUSES = ['active','cancelled','suspended','inactive']`,
    `GST_CHECK_RESULTS = ['found','held','status_refused','not_found','failed']`,
    `GST_PROOF_STATUSES = ['declared','code_sent','passed','waiting','needs_more','approved','rejected','spent']`,
    `GST_STATES = ['none','found','code_sent','under_review','needs_more','rejected','verified','revoked']`,
    `GST_DOCUMENT_TYPES = ['gst_certificate','id_proof','authorisation_letter']`, `ACCOUNT_STATUSES = ['active','suspended','blocked']`.
  - `normalizeGstin(input: string): string` (upper-case, strip whitespace); `isValidGstin(gstin: string): boolean`
    (format `^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` + checksum, textile's algorithm); `panFromGstin(gstin): string`
    (chars 3–12); `stateCodeFromGstin(gstin): string` (chars 1–2).
  - `interface GstDetails { legalName: string; tradeName: string | null; address: { line: string; city: string; state: string; pincode: string }; constitution: string; natureOfBusiness: string | null; registeredOn: string | null; status: GstStatus }`.
  - `interface GstStateView { mode: GstMode; state: GstState; instantAllowed: boolean; storageAvailable: boolean; expired?: boolean; held?: boolean; providerUnavailable?: boolean; statusRefused?: GstStatus; gstin?: string; details?: GstDetails; checkId?: string; proofId?: string; hint?: string; resendAvailableAt?: string; officerMessage?: string; reason?: string; verifiedAt?: string }`
    (`held`, `providerUnavailable`, `statusRefused` describe the latest lookup's outcome when `state` is `none`).
  - `interface PincodeInfo { pincode: string; city: string; district: string; state: string; offices: string[] }`,
    `interface IndustrialArea { id: string; name: string; city: string; state: string; isActive: boolean; sortOrder: number }`.
  - `interface BusinessProfile` — `id, tradeName, legalName, displayName, nameLocked, activities, categories (string[]),
    email, yearEstablished, employees, location: { pincode, city, state, industrialAreaId, industrialAreaName,
    industrialAreaOther, addressLine, lat, lng } (fields nullable), gstin, constitution, gstRegisteredOn, gstAddress,
    verificationLevels, verificationStatus, verifiedAt, onboarding: OnboardingStep, completion: { name: boolean;
    activities: boolean; location: boolean; gst: boolean }`.
  - Remove `BUSINESS_ROLES` / `BusinessRole`; fix any import (only `schema.ts` uses it; Task 2 removes that use).
- Produces (errors.ts): `TooManyRequestsError`, `ServiceUnavailableError`, `PayloadTooLargeError` as in Global Constraints.

- [ ] **Step 1: Write the failing tests.** `gstin-shared.test.ts`: `isValidGstin('24AAACC0000C1ZY')` true (textile's stub
  GSTIN); flipping its last char → false; lower-case input false until normalised; `normalizeGstin(' 24aaacc0000c1zy ')
  === '24AAACC0000C1ZY'`; `panFromGstin(...) === 'AAACC0000C'`; `stateCodeFromGstin(...) === '24'`; 14 chars → false.
  `errors.test.ts`: each new class has the right `statusCode` and `code`.
- [ ] **Step 2:** Run `pnpm --filter @mpm/api exec vitest run src/lib/gstin-shared.test.ts src/lib/errors.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement; build shared-types.
- [ ] **Step 4:** Run both. Expected: PASS. `pnpm typecheck` passes except `schema.ts`'s `BUSINESS_ROLES` import,
  which Task 2 fixes (do Tasks 1 and 2 in the same batch).
- [ ] **Step 5: Stage** the four files (+ package.json if a test script was added).

---

### Task 2: Database schema and migrations

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create (generated): `infra/migrations/0004_*.sql`, `0005_*.sql` (custom), `0006_*.sql`, `0007_*.sql` (custom), meta snapshots
- Test: `apps/api/__tests__/schema-f1.test.ts`

**Interfaces:**
- Produces (Drizzle exports): `industrialAreas`, `pincodeOffices`, `gstChecks`, `gstRepresentativeProofs`,
  `businessVerifications`; enums `employeesRange`, `gstStatus`, `gstCheckResult`, `gstProofStatus`, `gstProofMethod`
  (`provider_otp | documents`), `verificationMethod` (`provider_otp | officer_review`), `revocationSource` (`officer`).
- `businesses` new columns: `activities text[] not null default '{}'`, `email`, `yearEstablished int`, `employees`,
  `industrialAreaId uuid → industrial_areas`, `industrialAreaOther`, `constitution`, `gstRegisteredOn date`,
  `gstAddress jsonb`; index `(city, industrial_area_id)`. Removed later: `role`, `industrial_area`.
- `industrial_areas`: `id, name, city, state, is_active (true), sort_order (0), created_at, updated_at`; unique index
  `industrial_areas_name_city_state_uq` on `(lower(name), lower(city), state)`.
- `pincode_offices`: as textile (`id, pincode, office_name, district, state, point geography`), btree on pincode, GiST on point.
- `gst_checks`: `id, business_id, user_id (nullable), gstin, source ('business'|'officer', enum `gstCheckSource`),
  admin_id (nullable → admin_users), result, provider_ref, gst_status, details jsonb (GstDetails), resolved_at,
  created_at`; index `(business_id, created_at)`. Officer lookups at approval are `source 'officer'` with `admin_id`.
- `users.status` already allows `blocked` (checked 2026-11-18: `account_status` enum is `active | suspended | blocked`),
  so no migration change is needed for Task 6.
- `gst_representative_proofs`: `id, check_id (nullable → gst_checks), business_id, user_id, gstin, declaration_version int,
  declared_at, method, status, otp_ref, otp_hint, otp_sends int 0, otp_attempts int 0, last_otp_sent_at, passed_at,
  entered jsonb ({ legalName, tradeName, address, constitution } | null), documents jsonb ([{ key, type }]) default [],
  officer_id, officer_message, decided_at, reason, approved_details jsonb, lookup_at_approval text ('active'|'unavailable'|'none'),
  created_at, updated_at`; indexes `(status, created_at)`, `(business_id, created_at)`; partial unique index
  `gst_proofs_one_open_review_uq` on `(business_id) WHERE status IN ('waiting','needs_more')`.
- `business_verifications`: as textile minus `evidence`; `method verificationMethod`, `status text ('active'|'revoked')`,
  `verified_by_admin_id`, `verified_at`, `revoked_by_admin_id`, `revoked_at`, `revoke_reason`, `revocation_source`,
  `verified_by_proof_id`; partial unique `business_verifications_active_uq` on `(business_id, level) WHERE status = 'active'`.

- [ ] **Step 1: Write the failing test** `schema-f1.test.ts`: inserting a business with both `industrial_area_id` and
  `industrial_area_other` fails with pg code `23514`; a second `waiting` proof for the same business fails `23505`;
  a second active `gst` verification fails `23505`; the existing `role` column is gone (`information_schema.columns`).
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Add columns and tables** (keep `role` and `industrial_area` for now) → `db:generate` (0004).
- [ ] **Step 4: Data mapping** → `drizzle-kit generate --custom` (0005):
  `UPDATE businesses SET activities = CASE role WHEN 'buy' THEN '{buy}' WHEN 'sell' THEN '{sell}' ELSE '{buy,sell}' END;`
  and `UPDATE businesses SET industrial_area_other = industrial_area WHERE industrial_area IS NOT NULL;`
- [ ] **Step 5: Drop** `role` (and the `business_role` enum) and `industrial_area` from `schema.ts` → `db:generate` (0006).
- [ ] **Step 6: CHECK** → custom (0007): `ALTER TABLE businesses ADD CONSTRAINT businesses_area_one_of CHECK (industrial_area_id IS NULL OR industrial_area_other IS NULL);`
- [ ] **Step 7:** `db:migrate` and `db:migrate:test`; run the test. Expected: PASS. Typecheck passes.
- [ ] **Step 8: Stage** `schema.ts`, the four migrations, meta files, the test.

---

### Task 3: Pincode directory and public location API

Start from textile `infra/seed/{pincode-directory.csv.gz,README.md}`, `db/seed-locations.ts`, `db/seed-locations/{parse,load}.ts`
(+ `parse.test.ts`), `routes/pincodes.ts`, `services/lots/location.service.ts` (`lookupPincode`). Drop market cities.

**Files:**
- Create: `infra/seed/pincode-directory.csv.gz` (byte copy; sha256 must match textile README), `infra/seed/README.md`
  (pincode section only, `@tsm` → `@mpm`), `apps/api/src/db/seed-locations.ts`, `apps/api/src/db/seed-locations/{parse,load}.ts`,
  `apps/api/src/services/locations/pincode.service.ts`, `apps/api/src/routes/locations.ts`
- Modify: `apps/api/package.json` (script `db:seed:locations`), `apps/api/src/app.ts` (register `locationRoutes` in `if (infra)`), `apps/api/Dockerfile` (copy `infra/seed` and set `SEED_DATA_DIR`, as textile)
- Test: `apps/api/src/db/seed-locations/parse.test.ts`, `apps/api/__tests__/locations.test.ts`

**Interfaces:**
- Produces:
  - `pincodeDistrict(db: Db | Tx, pincode: string): Promise<{ district: string; state: string; city: string } | null>` —
    **the one place a pincode's district is decided**: among that pincode's offices, the (district, state) with the
    most offices, ties broken by district then state alphabetically; `city` = `titleCase(district)` (textile's helper).
    Also exported as a SQL fragment / CTE builder `pincodeDistrictSql()` so set-based queries (Task 4) use the same rule.
    Used by `lookupPincode`, `areasForPincode`, `setMyLocation` (Task 5), `listOtherValues` and `adoptOtherValue` (Task 4).
  - `lookupPincode(db: Db | Tx, pincode: string): Promise<PincodeInfo | null>` — `district`, `state`, `city` from
    `pincodeDistrict`; `offices` = all office names of the pincode, sorted.
  - `nearestPincode(db: Db, lat: number, lng: number): Promise<PincodeInfo | null>` — the office with the least
    `ST_Distance(point, ST_MakePoint(lng, lat)::geography)` among offices within 50 km (`ST_DWithin`); null beyond.
  - `areasForPincode(db: Db | Tx, pincode: string): Promise<IndustrialArea[]>` — active `industrial_areas` whose
    `lower(city) = lower(city)` and `state = state` from `pincodeDistrict(pincode)`, by `sort_order, name`;
    `[]` for an unknown pincode. (Lives in `industrial-areas.service.ts`, created here, used by Task 5.)
  - Routes (tag `Locations`, public): `GET /locations/pincodes/:pincode` (`^[1-9]\d{5}$`; unknown → 404),
    `GET /locations/nearest-pincode?lat=&lng=` (lat −90..90, lng −180..180; none → 404),
    `GET /locations/industrial-areas?pincode=`.
  - Seed CLI as textile: refuses when `pincode_offices` isn't empty; `--reset` replaces it.

- [ ] **Step 1: Failing tests.** `parse.test.ts` ported. `locations.test.ts` inserts its own offices with a test pincode
  `999xxx`-style value that no real row uses (pick `990001`–`990009`, delete in `afterAll`), with points; checks lookup,
  title-casing (`SURAT` → `Surat`), 404 for unknown and 400 for `012345`, nearest within 50 km returns the closer of two
  offices, beyond 50 km 404, and `industrial-areas?pincode=` returns only active areas of that district/state;
  **a pincode with two offices in district A and one in district B always resolves to A**, and a 1–1 tie resolves to
  the alphabetically first district, through `lookupPincode` and `areasForPincode` alike.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Copy/port files; implement services and routes.
- [ ] **Step 4:** Run. PASS. Then load the real directory into dev: `pnpm --filter @mpm/api db:seed:locations` (prints
  offices / pincodes / pointsMissing).
- [ ] **Step 5: Stage** the files.

---

### Task 4: Industrial areas — seed and admin API

**Files:**
- Create: `apps/api/src/db/seed-data/industrial-areas.ts`, `apps/api/src/db/seed-industrial-areas.ts`,
  `apps/api/src/services/locations/industrial-area-admin.service.ts`, `apps/api/src/routes/admin/industrial-areas.ts`
- Modify: `apps/api/package.json` (`db:seed:industrial-areas`), `apps/api/src/app.ts`
- Test: `apps/api/__tests__/admin-industrial-areas.test.ts`

**Interfaces:**
- Seed data: `SURAT_INDUSTRIAL_AREAS` — exactly the 14 names of §4.3, city `Surat`, state `Gujarat`, `sort_order` 10,
  20, … in that order. CLI refuses when `industrial_areas` isn't empty.
- Produces (`category_manager` role):
  - `listAreas(db, { city?, state?, includeInactive: true })`, `createArea(tx, adminId, { name, city, state })`,
    `updateArea(tx, adminId, id, { name?, isActive? })`, `reorderAreas(tx, adminId, { city, state, ids })`
    (`409 STALE_ORDER` when ids ≠ current set), `deleteArea(tx, adminId, id)` (`409 AREA_IN_USE` when any business
    references it); duplicates → `409 NAME_TAKEN` via `isUniqueViolation`.
  - `listOtherValues(db): Promise<Array<{ text: string; district: string; state: string; count: number; adoptable: boolean }>>`
    — distinct `lower(trim(industrial_area_other))` grouped by the **pincode's district and state** (via
    `pincodeDistrictSql()`, Task 3), most-typed first. Businesses whose pincode is unknown to the directory are listed
    under their typed city and state with **`adoptable: false`** (Add to list can't link them; the page says
    "Unknown pincode — can't be linked").
  - `adoptOtherValue(tx, adminId, { text, district, state, name })` — creates the area (`city` = `titleCase(district)`),
    then sets `industrial_area_id` and clears `industrial_area_other` on every business whose pincode resolves (by
    `pincodeDistrictSql()`) to that district/state and whose `lower(trim(other)) = lower(trim(text))`; returns
    `{ areaId, linked }`; one audit row.
  - Routes: `GET/POST /admin/industrial-areas`, `PATCH/DELETE /admin/industrial-areas/:id`,
    `POST /admin/industrial-areas/reorder`, `GET /admin/industrial-areas/other`, `POST /admin/industrial-areas/other/adopt`.

- [ ] **Step 1: Failing tests:** create, duplicate name (case-insensitive) → 409 `NAME_TAKEN`, rename, deactivate hides
  it from `GET /locations/industrial-areas`, reorder with a stale list → 409, delete in use → 409, moderator → 403;
  `other` groups two businesses that typed "Kosad Estate" / "kosad estate " under one row with count 2 even when one
  typed city "Surat City"; adopt links both and clears their other text; a business with an unknown pincode appears
  with `adoptable: false` and adopt leaves it unlinked; audit rows exist.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; run `db:seed:industrial-areas` on dev.
- [ ] **Step 5: Stage.**

---

### Task 5: Business profile API and onboarding step

**Files:**
- Create: `apps/api/src/services/business/profile.service.ts`, `apps/api/src/routes/businesses.ts`,
  `apps/api/__tests__/_helpers/test-businesses.ts`
- Modify: `apps/api/src/services/user.service.ts`, `apps/api/src/routes/users.ts` (unchanged contract), `apps/api/src/app.ts`
- Test: `apps/api/__tests__/business-profile.test.ts`

**Interfaces:**
- Produces:
  - `createTestBusinessUser(opts?: { activities?: BusinessActivity[]; pincode?: string }): Promise<{ userId; businessId; token; phone }>`
    (signs in through `signInWithPhone` + `completeProfile`), `deleteTestBusinesses(businessIds: string[])` (deletes
    proofs, checks, verifications, then users, then businesses).
  - `onboardingStep(b: BusinessRow, userName: string | null): OnboardingStep` — `'profile'` unless name, trade name,
    ≥1 activity and ≥1 category are set; else `'location'` unless pincode, city, state and an industrial area (id or
    other) are set; else `'done'`.
  - `getMyBusiness(db, userId): Promise<BusinessProfile>` — `displayName` = GST trade name, else legal name, when a
    `gst` verification is active; else `trade_name`. `nameLocked` = active gst verification. Category ids filtered
    to active level-1 nodes (A4 `categories` table, `level = 'machine_category'`). `completion` per §4.1.
  - `updateMyProfile(db, userId, patch: { name?, businessName?, activities?, categories?, email?, yearEstablished?, employees? })`
    — `businessName` refused with `409 NAME_LOCKED` when `nameLocked`; categories validated (unknown / inactive /
    not level 1 → `400 INVALID_CATEGORY`); activities non-empty subset; `yearEstablished` 1900..current year.
  - `setMyLocation(db, userId, body: { pincode; city; state; industrialAreaId? ; industrialAreaOther?; addressLine?; lat?; lng? })`
    — exactly one of id / other (`400 VALIDATION_ERROR`); id must be in `areasForPincode(pincode)` (so the district comes
    from `pincodeDistrict`, Task 3) else `400 AREA_MISMATCH`;
    `lat`/`lng` together or neither → `location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography`.
  - `signInWithPhone` adds `onboarding: OnboardingStep` (`'profile'` for a new user); `isNewUser` kept.
  - Routes: `GET /businesses/me`, `PATCH /businesses/me`, `PUT /businesses/me/location` (all `requireUser`).

- [ ] **Step 1: Failing tests:** new sign-in → `onboarding 'profile'`; after `PATCH` with activities + one seeded-in-test
  category (use `createTestCatalog`) → `'location'`; after `PUT location` → `'done'` and `completion.location true`;
  both area id and other → 400; area of another district → 400 `AREA_MISMATCH`; unknown pincode + other → OK;
  inactive category → 400; `businessName` change after a test-inserted active gst verification → 409 `NAME_LOCKED`
  and `displayName` equals the GST trade name; lat without lng → 400.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

---

### Task 6: Account status — immediate suspension and admin user actions

**Files:**
- Modify: `apps/api/src/plugins/auth.ts` (`requireUser`), `apps/api/src/socket/setup.ts`
- Create: `apps/api/src/services/admin/user-status.service.ts`, `apps/api/src/routes/admin/users.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/__tests__/account-status.test.ts`

**Interfaces:**
- `requireUser`: after verifying the JWT, `SELECT status FROM users WHERE id = $1`; missing → 401; not `active` →
  `ForbiddenError('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED')`.
- Socket `/user` middleware: same lookup; non-active → `next(new Error('ACCOUNT_SUSPENDED'))`.
- Produces:
  - `suspendUser(tx, admin: { id; role }, userId, reason)` (`active` → `suspended`; else `409 USER_NOT_ACTIVE`),
    `reinstateUser(...)` (`suspended` → `active`; blocked → `409 USER_BLOCKED`; active → `409 USER_NOT_SUSPENDED`),
    `blockUser(...)` (`active|suspended` → `blocked`), `unblockUser(...)` (`blocked` → `active`; else `409 USER_NOT_BLOCKED`).
    Reason required (3–500 chars). Each writes audit and, after commit, disconnects the user's sockets:
    `io.of('/user').in(userRoom(userId)).disconnectSockets(true)` (skip when `fastify.io` is absent in tests).
  - Routes: `POST /admin/users/:id/suspend|reinstate` (`verification_officer`, `moderator`), `/block|unblock` (`super_admin` only).

- [ ] **Step 1: Failing tests:** a user token works on `GET /businesses/me`; after `suspend` the same token gets 403
  `ACCOUNT_SUSPENDED`; reinstate → works again; block by a moderator → 403; block by super admin → 403 for the user;
  reinstate on a blocked user → 409 `USER_BLOCKED`; unblock → works; missing reason → 400; audit rows for each.
  **Socket tests** (start the app on an ephemeral port with Socket.IO attached, connect with `socket.io-client` — add it
  as an API dev dependency, same major as the server): a suspended user's `/user` handshake fails with
  `ACCOUNT_SUSPENDED`; an active user's open socket receives `disconnect` within 2 s of `POST /admin/users/:id/suspend`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS (and every existing API suite still passes:
  `pnpm --filter @mpm/api test`). **Step 5: Stage.**

---

### Task 7: GST provider, stub, mode and GSTIN parsing

Start from textile `services/verification/{gst-provider,gst-stub}.ts` and `gst.service.ts` `parseGstin`.

**Files:**
- Create: `apps/api/src/services/verification/{gst-provider,gst-stub,gst-mode,gstin}.ts`
- Test: `apps/api/src/services/verification/gst-mode.test.ts`, `gst-stub.test.ts`

**Interfaces:**
- `GstProvider`, `GstLookup`, `setGstProvider`, `getGstProvider`, `resetGstProvider` as textile. **`getGstProvider()`
  picks by mode**: `live` → the registered provider; `stub` → the stub (even when a provider is registered, so a
  developer with an adapter but no key never calls the real service); `review` → `unconfigured` (every call throws
  503 `GST_UNAVAILABLE`).
- `getGstMode(): GstMode` — `live` when a provider is registered **and** `GST_API_KEY` non-empty; else `stub` when
  `NODE_ENV !== 'production'` and `GST_PROVIDER` is unset/empty or `stub`; else `review`.
- Stub: textile's, with `STUB_GSTIN_CANCELLED`, `STUB_GSTIN_NOT_FOUND`, `STUB_GSTIN_UNAVAILABLE`, code `123456`, hint
  `98•••••36`; `setStubGstin`, `resetStubGstins`; records sends in `stubSentCodes(): string[]` (GSTINs), reset by `resetStubGstins`.
- `parseGstin(input: string): string` — normalise + `isValidGstin`, else `ValidationError('Enter a valid 15-character GSTIN', undefined, 'GSTIN_INVALID')`.

- [ ] **Step 1: Failing tests** (set and restore `process.env` per test): no provider + `NODE_ENV=test` + no
  `GST_PROVIDER` → `stub`; `GST_PROVIDER=off` → `review`; `GST_PROVIDER=acme` without key → `review`;
  `NODE_ENV=production` + `GST_PROVIDER=stub` → `review`; registered provider + key → `live` and `getGstProvider()` is
  the registered one; **registered provider, no key, `NODE_ENV=test`, `GST_PROVIDER` unset → `stub`, and
  `getGstProvider()` is the stub (a spy on the registered provider records no call)**; registered, no key,
  `GST_PROVIDER=acme` → `review`; registered, no key, production → `review`; `review` mode → `getGstProvider().lookup()`
  rejects with 503 `GST_UNAVAILABLE`.
  Stub: valid GSTIN → found active with details built from it; the three fixed GSTINs → cancelled / not_found /
  unavailable; `verifyContactOtp(ref,'123456')` true, other false; `parseGstin` rejects bad checksum.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

---

### Task 8: GST instant path (state, lookup, declare, code, confirm)

Start from textile `gst.service.ts` (`lockGstin`, `assertLookupAllowance`, `holderOf`, `recordCheck`, `lookupGst`,
`grantGst`, `confirmGst`, `getGstState`), `gst-proof.service.ts` (`declare`, `sendGstOtp`, `verifyGstOtp`), `routes/gst.ts`.

**Files:**
- Create: `apps/api/src/services/verification/{gst-state,gst-instant,gst-grant}.service.ts`, `apps/api/src/routes/gst.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/__tests__/_helpers/test-businesses.ts` (`grantTestGst`, `revokeTestGst`)
- Test: `apps/api/__tests__/gst-instant.test.ts`

**Interfaces:**
- `DECLARATION_VERSION = 1` and its English text (§5.2 step 4) exported for the app copy check.
- `getGstState(db, businessId): Promise<GstStateView>` per §5.5 (incl. `instantAllowed`, `storageAvailable:
  isStorageConfigured()` — Task 9 creates `lib/storage.ts`; until then import a local `() => false` stub and switch in
  Task 9 — stale `found` / `code_sent` → `none` + `expired: true` after 30 min from `resolved_at`).
- `hasOfficerRevocation(db | tx, businessId): Promise<boolean>` — any `business_verifications` row with
  `revocation_source = 'officer'`.
- `assertMayStartInstant(tx, businessId)` — in order: mode `review` or officer revocation → `409 GST_REVIEW_ONLY`;
  active gst verification → `409 GST_ALREADY_VERIFIED`; open review → `409 GST_REVIEW_OPEN`. Called first by lookup,
  declare and code-send, **before any provider call**.
- `lookupGst(db, actor: { userId; businessId }, input)` — `parseGstin`; **lookup limit: 5 per business per calendar
  day in India time** (`Asia/Kolkata`; count rows with `source = 'business'` and `result <> 'failed'` whose
  `created_at` falls on today's IST date), so officer lookups and provider outages never use up a business's lookups;
  over the limit → `429 GST_LOOKUP_LIMIT` "You've used today's 5 lookups. Try again tomorrow." with
  `details.retryAt` = next IST midnight; rows written `source 'business'`. Held by another business → check row
  `held`, response state `none` + `held: true` (no details); provider `unavailable` → row `failed`, response
  `providerUnavailable: true`; not active → `status_refused`.
- `declare(db, actor, checkId)` → proof `declared` (check must be this business's, `found`, fresh).
- `sendGstCode(db, actor, proofId)` → limits (3 sends, 30 s since `last_otp_sent_at` → `429 GST_OTP_TOO_SOON` with
  `details.retryAt`), stores `otp_ref`, `otp_hint`, status `code_sent`.
- `verifyGstCode(db, actor, proofId, code)` → in one transaction that **locks the business row first**, then refuses
  with `409 GST_REVIEW_OPEN` while the business has a
  review `waiting` or `needs_more`, and with `409 GST_PROOF_CLOSED` when the proof isn't `code_sent` (e.g. spent by a
  review submission, Task 10); wrong code increments attempts (`400 GST_OTP_INVALID`; 5th wrong → status `spent`,
  `409 GST_OTP_LIMIT`); right code → `grantGst`.
- `grantGst(tx, input: { businessId; gstin; details: GstDetails; method: 'provider_otp' | 'officer_review'; proofId; adminId?: string; replaceHeld: boolean })`
  — `pg_advisory_xact_lock(hashtext('gstin:' || gstin))` + business row lock; another holder → `409 GSTIN_TAKEN`
  (also map a unique violation on `businesses.gstin` to it); writes the GST fields + `pan`, `verification_levels` ∪
  `gst`, `verification_status 'approved'`, `verification_note null`, `verified_at now()`; inserts the verification
  row; proof → `passed` (instant) / `approved` (officer). Instant confirm additionally checks freshness (30 min) and
  `!hasOfficerRevocation` (`409 GST_REVIEW_ONLY`) before calling it.
- Routes (`requireUser`, rate limit `{ max: 20, timeWindow: '10 minutes' }` on lookup and otp/send):
  `GET /businesses/me/gst`, `POST /businesses/me/gst/lookup|declare|otp/send|otp/verify`.

- [ ] **Step 1: Failing tests:** happy path (lookup → declare → send → verify `123456`) ends `verified`, business has
  GSTIN, PAN, legal name, `verification_levels` contains `gst`, `verified_at` set; 6th lookup in a day → 429; cancelled
  stub GSTIN → `status_refused` message state; 5 `failed` (unavailable stub GSTIN) lookups don't block a 6th real
  lookup; officer-source rows (inserted directly) don't count; a lookup row dated yesterday IST doesn't count;
  held GSTIN (another test business verified on it) → `held: true` and no
  `details` in the body; unavailable → `providerUnavailable`; resend within 30 s → 429; 4th send → 409; 5 wrong codes →
  `spent`; confirm 31 minutes after lookup (update `resolved_at` in the test) → `409 GST_LOOKUP_EXPIRED` and state reads
  `expired`; **revoked business: lookup, declare, otp/send → 409 `GST_REVIEW_ONLY` and `stubSentCodes()` unchanged**;
  verified business lookup → 409 `GST_ALREADY_VERIFIED`; `GST_PROVIDER=off` → lookup 409 `GST_REVIEW_ONLY`;
  **race:** two businesses verify the same GSTIN concurrently (`Promise.allSettled` of both verify calls) → one 200,
  one 409 `GSTIN_TAKEN`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

---

### Task 9: R2 storage and document uploads

Start from textile `lib/storage.ts` (keep: client setup, timeouts, `presignSignedPut`, `presignPrivateGet`,
`headObject`, `getObjectBytes`, `copyObject`, `deleteObject`, `isStorageConfigured`; private bucket only) and
`services/uploads/admin-documents.ts` (`sniffDocument`).

**Files:**
- Create: `apps/api/src/lib/storage.ts`, `apps/api/src/lib/sniff-document.ts`, `apps/api/src/services/verification/gst-documents.service.ts`
- Modify: `apps/api/package.json` (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, same versions as textile), `.env.example`
- Test: `apps/api/src/lib/sniff-document.test.ts`, `apps/api/__tests__/gst-documents.test.ts`

**Interfaces:**
- `isStorageConfigured(): boolean` — the five variables in Global Constraints.
- `sniffDocument(bytes: Buffer): 'jpg' | 'png' | 'webp' | 'pdf' | null`.
- `presignDocumentUpload(db, actor, input: { proofId?: string; contentType: string; size: number }): Promise<{ url; key; expiresAt; uploadId }>`
  — 503 `STORAGE_UNAVAILABLE` first; type not in the four → `400 DOCUMENT_TYPE`; size > 10 MB → `413 MEDIA_TOO_LARGE`;
  key `incoming-verification/<businessId>/<uploadId>/<uuid>.<ext>` (`uploadId` = proofId when adding files, else a new
  uuid the app sends back on submit).
- `stageDocuments(input: { businessId; uploadId; proofId; files: Array<{ key; type: GstDocumentType }> }): Promise<{ copied: Array<{ key; type }>; incoming: string[] }>`
  — **runs before the database transaction opens** (no `tx` parameter): each key must start with
  `incoming-verification/<businessId>/<uploadId>/`; `headObject` size ≤ 10 MB; first 16 bytes sniffed (`getObjectBytes`
  with a `Range` of 0–15) else `400 DOCUMENT_TYPE`; `copyObject` to `verification/<businessId>/<proofId>/<uuid>.<ext>`.
  If any file fails, the copies already made are deleted before throwing.
- The caller's order (Task 10): generate the proof id → `stageDocuments` → open the transaction and save the proof with
  `copied` keys → **on commit** `deleteKeys(incoming)`; **on rollback or error** `deleteKeys(copied.map(k => k.key))`
  (the incoming files stay for the 1-day lifecycle rule). `deleteKeys` logs failures, never throws.
- `presignDocumentRead(key): Promise<string>` (300 s).
- `.env.example`: R2 block with `AWS_S3_ENDPOINT=` (comment: `https://<account-id>.r2.cloudflarestorage.com`),
  `AWS_REGION=auto`, `AWS_ACCESS_KEY_ID=`, `AWS_SECRET_ACCESS_KEY=`, `AWS_S3_PRIVATE_BUCKET=`, and a line
  `# The owner fills these in after the build; until then document uploads answer 503 STORAGE_UNAVAILABLE.`;
  `GST_PROVIDER=` (comment: `stub` default outside production, `off` to try admin review locally) next to `GST_API_KEY`.
- Route (in `routes/gst.ts`): `POST /businesses/me/gst/documents/presign`.

- [ ] **Step 1: Failing tests:** `sniff-document.test.ts` — JPEG, PNG, WebP, PDF magic bytes recognised; `<html>` and
  empty buffers → null. `gst-documents.test.ts` (no R2 needed): with storage variables cleared, presign → 503
  `STORAGE_UNAVAILABLE`; `text/html` → 400 `DOCUMENT_TYPE`; 10 485 761 bytes → 413; a key under another business's
  prefix → 400. **`describe.skipIf(!isStorageConfigured())`** block: real presign + PUT of a tiny PDF, `stageDocuments`
  copies it to `verification/…`, the incoming object is gone after `deleteKeys(incoming)`; a forced rollback after
  staging leaves no `verification/…` object; HTML bytes uploaded as `application/pdf` → 400 `DOCUMENT_TYPE` and no copy
  left; cleans up its objects.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS (R2 block reports skipped). **Step 5: Stage.**

---

### Task 10: Review path — submit, officer decisions

Start from textile `gst-proof.service.ts` `submitRepresentativeDocuments`, `gst-claims.service.ts`
`decideRepresentativeProof`, `listRepresentativeProofs`, `getRepresentativeProofDetail`, `routes/admin/gst.ts`.

**Files:**
- Create: `apps/api/src/services/verification/gst-review.service.ts`, `apps/api/src/routes/admin/verification.ts`
- Modify: `apps/api/src/routes/gst.ts`, `apps/api/src/app.ts`
- Test: `apps/api/__tests__/gst-review.test.ts`

**Interfaces:**
- `submitReview(db, actor, body: { gstin: string; checkId?: string; entered?: { legalName; tradeName?; address: { line; city; state; pincode }; constitution }; declarationVersion: number; uploadId: string; files: Array<{ key; type }> })`
  — `GST_ALREADY_VERIFIED` / `GST_REVIEW_OPEN` refusals (§5.3); GSTIN parsed and held-by-another → 409 `GSTIN_TAKEN`
  with the "already linked" message; `entered` required iff no `checkId`; files 2–5 with at least one
  `gst_certificate` and one `id_proof` or `authorisation_letter` → else `400 DOCUMENTS_REQUIRED`; then
  `stageDocuments` (Task 9, outside the transaction), and in one transaction that **first locks the business row
  (`SELECT … FOR UPDATE`), the same lock `verifyGstCode` / `grantGst` take**: **marks every `declared` or `code_sent`
  proof of the business `spent`** (so a late code can't verify while the review waits), creates the proof
  (`method 'documents'`, status `waiting`) with the copied keys, sets `verification_status 'pending'`, clears note;
  after commit / on failure, the Task 9 cleanup order.
- `addReviewFiles(db, actor, proofId, { files })` — only on `needs_more`; same file rules (total ≤ 5); **same order as
  `submitReview`**: `stageDocuments` before the transaction, save the copied keys and set `waiting` inside it (business
  row locked), delete the incoming files after commit, delete the copies on failure.
- `listReviews(db, status: 'waiting' | 'needs_more' | 'decided')` (decided = approved/rejected in the last 90 days),
  `getReviewDetail(db, id)` (entered vs lookup details, documents with types, mismatch flags on legal name and pincode,
  previous checks and decisions of the business, `providerAvailable: getGstMode() !== 'review'`).
- `approveReview(tx, adminId, id, edits?: { legalName?; tradeName?; address?; constitution? })` — table in §5.3:
  status must be `waiting` (`409 STALE_REVIEW` via `UPDATE … WHERE status='waiting' RETURNING`); active verification
  → `409 GST_ALREADY_VERIFIED`; provider available → fresh `lookup` (`active` else `409 GST_NOT_ACTIVE`; `unavailable`
  → falls back to the officer's details and records `lookup_at_approval 'unavailable'`; the officer's lookup is a
  `gst_checks` row with **`source 'officer'`** and `admin_id`, so it never counts toward the business's daily limit);
  details = fresh lookup, else
  entered/lookup values overlaid with `edits`; `grantGst(..., method 'officer_review', adminId, replaceHeld: true)`
  (releases a different held GSTIN); stores `approved_details`; audit.
- `rejectReview(tx, adminId, id, reason)` and `askForMore(tx, adminId, id, message)` — `STALE_REVIEW` rule; reason /
  message 3–500 chars; `verification_status` / note per §5.4a.
- `documentUrl(tx, adminId, proofId, index)` → `presignDocumentRead`, audit `gst_document.view`.
- Routes: user `POST /businesses/me/gst/review`, `POST /businesses/me/gst/review/files`; admin
  (`verification_officer`): `GET /admin/verification/reviews?status=`, `GET /admin/verification/reviews/:id`,
  `POST /admin/verification/reviews/:id/approve|reject|ask-for-more`, `GET /admin/verification/documents/:proofId/:index/url`.
- Tests can't upload without R2: the test helper `insertTestReview(businessId, opts)` inserts a `waiting` proof with fake
  `verification/...` keys directly, so officer-side tests run without R2; `submitReview`'s validation runs before
  `stageDocuments`, so its refusal tests run too. To test the proof-spending step without R2, the service takes an
  optional `stage` function (default `stageDocuments`) that tests replace with one returning fake copied keys.

- [ ] **Step 1: Failing tests:** submit refusals (verified → 409; open review → 409; no `entered` without check → 400;
  one file → 400 `DOCUMENTS_REQUIRED`; storage unset → 503); approve in mode `review` with an edited legal name →
  verified with the edited name, `method 'officer_review'`, `verified_at` set; approve in `stub` mode on a cancelled
  stub GSTIN → 409 `GST_NOT_ACTIVE`; unavailable stub GSTIN → approved with `lookup_at_approval 'unavailable'`;
  **double approve → second 409 `STALE_REVIEW`, one audit row**; reject → `verification_status 'rejected'` + note;
  ask-for-more → `pending` + message, state `needs_more`; a revoked business's review approved → verified (revocation
  doesn't block officers) and `instantAllowed` still false afterwards; review for a different GSTIN after revoke →
  approval replaces `gstin`; **race:** approving two reviews of different businesses for one GSTIN concurrently →
  one 200, one 409 `GSTIN_TAKEN`; support role → 403; document URL with storage unset → 503;
  **late code:** lookup → declare → send code, then submit a review (fake `stage`) → the old proof is `spent`, and
  `otp/verify` with `123456` → 409 `GST_REVIEW_OPEN`, business still unverified; **officer lookups don't count:** after
  two approval attempts with a fresh lookup (the first refused for a cancelled stub GSTIN), the business still has 5
  lookups left today.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

---

### Task 11: Admin businesses API — list, detail, revoke, release

Start from textile `services/verification/verification.service.ts` (`listBusinesses`, `getBusiness`,
`revokeVerification`) and `routes/admin/businesses.ts`.

**Files:**
- Create: `apps/api/src/services/admin/business-admin.service.ts`, `apps/api/src/routes/admin/businesses.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/__tests__/admin-businesses.test.ts`

**Interfaces:**
- `listBusinesses(db, q: { search?; city?; industrialAreaId?; verification?: 'not_submitted'|'pending'|'approved'|'rejected'; status?: AccountStatus; page; pageSize (≤ 100) })`
  — search matches trade/legal name (ILIKE), owner phone (digits), GSTIN (prefix); returns `{ rows, total }` with
  owner name/phone/status, city, area name, verification status, created.
- `getBusinessDetail(db, id)` — profile (as `BusinessProfile`), users, GST history (checks, proofs without document
  keys, verifications), last 50 audit rows with `entity_id` = business id or its users' ids.
- `revokeGst(tx, adminId, businessId, reason)` — active gst row → `revoked`, `revocation_source 'officer'`, who/when/
  reason; `gst` removed from levels; status `rejected`, note = reason, `verified_at null`; name unlocks (derived);
  GST fields kept. No active row → `409 GST_NOT_VERIFIED`.
- `releaseGstin(tx, adminId, businessId, reason)` — open review → `409 GST_REVIEW_OPEN`; active verification →
  `409 GST_ALREADY_VERIFIED` (revoke first); clears `gstin`, `pan`, `legal_name`, `constitution`, `gst_registered_on`,
  `gst_address`; status `not_submitted`, note = reason, `verified_at null`.
- Routes: `GET /admin/businesses`, `GET /admin/businesses/:id` (`support`, `verification_officer`, `moderator`);
  `POST /admin/businesses/:id/gst/revoke|release` (`verification_officer`).

- [ ] **Step 1: Failing tests:** search by phone digits, by GSTIN prefix, by name; filter by verification; paging
  total; detail has GST history without document keys; revoke → levels lack `gst`, state `revoked`, then lookup → 409
  `GST_REVIEW_ONLY`; release while a review waits → 409 `GST_REVIEW_OPEN`; release after revoke clears GSTIN so a second
  business can verify it via the stub; moderator revoke → 403.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

---

### Task 12: Admin page — Business verification

Follow A4's admin pages (`components/catalog/*`, `lib/catalog-api.ts`) and the v2 brief's "Business verification" frame.

**Files:**
- Create: `apps/admin/lib/verification-api.ts`, `apps/admin/components/verification/{review-queue,review-detail,approve-dialog,decision-dialog,document-viewer}.tsx`
- Modify: `apps/admin/app/(dashboard)/verification/page.tsx` (replaces the placeholder), `apps/admin/lib/nav.ts` (Waiting
  count badge via a `badge` fetch, as the nav supports; if it doesn't, add an optional `badgeKey` and render it)
- Test: `apps/admin/components/verification/review-detail.test.tsx`, `approve-dialog.test.tsx`

**Behaviour:** tabs Waiting / Needs more / Decided (URL state); left queue, right detail; detail shows "From the
business" vs "From the GST lookup" with mismatches highlighted, documents (images in the existing `image-lightbox`, PDFs
open the presigned URL in a new tab), a "Search on the GST portal" link to `https://services.gst.gov.in/services/searchtp`,
history. Approve dialog shows editable legal name / trade name / address / constitution **only when** the detail has no
lookup or `providerAvailable` is false; Reject and Ask for more require text (3–500). `409 STALE_REVIEW` → toast
"Someone already decided this review" and refetch.

- [ ] **Step 1: Failing tests:** approve dialog hides the edit fields when a lookup is attached and provider available,
  shows them otherwise; reject button disabled until 3 chars; mismatch row highlighted when legal names differ.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + `pnpm --filter admin lint`. **Step 5: Stage.**

---

### Task 13: Admin page — Users & businesses

**Files:**
- Create: `apps/admin/lib/businesses-api.ts`, `apps/admin/components/businesses/{business-table,business-detail,status-action-dialog}.tsx`,
  `apps/admin/app/(dashboard)/businesses/[id]/page.tsx`
- Modify: `apps/admin/app/(dashboard)/businesses/page.tsx`, `apps/admin/lib/nav.ts` (`/businesses` roles add `moderator`)
- Test: `apps/admin/components/businesses/business-detail.test.tsx`

**Behaviour:** `data-table` + `filter-kit` (search, verification, account status), pagination; detail page: profile,
location (Google Maps link `https://www.google.com/maps?q=<lat>,<lng>` when a pin exists), activities, machine
categories (names from `GET /categories`), users with status chips, GST history, audit list. Buttons by role (from the
admin session): Suspend / Reinstate (officer, moderator, super admin), Block / Unblock (super admin), Revoke GST /
Release GSTIN (officer, super admin); every action asks for a reason in `status-action-dialog`.

- [ ] **Step 1: Failing tests:** a moderator sees Suspend but not Block or Revoke GST; a super admin sees Unblock on a
  blocked user and not Reinstate; Release is disabled with a hint while a review is open.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + lint. **Step 5: Stage.**

---

### Task 14: Admin page — Industrial areas

**Files:**
- Create: `apps/admin/lib/industrial-areas-api.ts`, `apps/admin/app/(dashboard)/industrial-areas/page.tsx`,
  `apps/admin/components/industrial-areas/{areas-list,other-values}.tsx`
- Modify: `apps/admin/lib/nav.ts` (item "Industrial areas", icon `Factory` or `MapPin`, roles `['category_manager']`,
  in the group with "Units, conditions & sides")
- Test: `apps/admin/components/industrial-areas/other-values.test.tsx`

**Behaviour:** city/state picker (from the areas list), list with rename, active switch, drag/arrow reorder, delete
(disabled message on `AREA_IN_USE`); "Typed as Other" table with count and **Add to list** (prefilled name = the text
title-cased, editable) → toast "Added and linked N businesses". Reuse A4's `keyed-list-editor` patterns where they fit.

Rows with `adoptable: false` show "Unknown pincode — can't be linked" and no Add to list button.

- [ ] **Step 1: Failing tests:** Add to list posts `{ text, district, state, name }` and shows the linked count; a row
  with `adoptable: false` has no Add to list button.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + lint. **Step 5: Stage.**

---

### Task 15: App — onboarding (Your business, Where are you?) and gating

Start from textile `apps/user-app` (`app.config.ts` maps key handling, its location screen) and the v2 mockup screens
"Business profile" and "Location and industrial area".

**Files:**
- Create: `apps/user-app/lib/business-api.ts`, `apps/user-app/hooks/use-business.ts`,
  `apps/user-app/screens/onboarding/{your-business,where-are-you}.tsx`, `apps/user-app/lib/onboarding-step.ts`,
  `apps/user-app/app.config.ts` (reads `app.json`, adds `android.config.googleMaps.apiKey` only when
  `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` is set; exposes `extra.mapsEnabled`)
- Modify: `apps/user-app/package.json` — add the native modules with **`npx expo install react-native-maps
  expo-document-picker`** (run in `apps/user-app`) so the versions match Expo SDK 54; don't pin textile's versions by hand,
  `store/authSlice.ts` (`onboarding: OnboardingStep` replaces `isNewUser` in state; `setAuth` takes it),
  `hooks/useAuth.ts`, `navigation/{root-navigator,types}.tsx`, `screens/auth/otp.tsx` (pass `onboarding`),
  remove `screens/auth/name.tsx` (its fields move into Your business), `locales/{en,hi,gu}/onboarding.json`, `locales/index.ts`
- Test: `apps/user-app/lib/onboarding-step.test.ts`, `store/authSlice.test.ts` (update)

**Behaviour:**
- Root navigator: `onboarding 'profile'` → YourBusiness; `'location'` → WhereAreYou; `'done'` → Main. Cold start
  re-reads `GET /businesses/me` (replaces the `ONBOARDING_PENDING_KEY` flag).
- Both screens take a route param `mode: 'onboarding' | 'edit'`. Onboarding: Next / Save moves to the next step.
  **Edit** (opened from the Profile rows, Task 16): fields prefilled from `GET /businesses/me`, header back button,
  "Save changes" returns to Profile, no GST intro; a locked business name shows read-only with "From your GST
  registration".
- Your business: name, business name, activity chips (multi), machine-category chips from `GET /categories` (roots,
  icons from A4), Next → `PATCH /businesses/me`.
- Where are you?: pincode field (6 digits) → `GET /locations/pincodes/:p` fills city/state (editable); "Use my current
  location" (expo-location foreground) → `nearest-pincode`; map only when `extra.mapsEnabled` (draggable pin); industrial
  area searchable list from `industrial-areas?pincode=` + "Other" text; address line; Save → `PUT /businesses/me/location`
  → GST intro (Task 16) once, then Main. **"Once" is remembered on the device** in AsyncStorage under
  `gst_intro_seen:<userId>` (set when the intro is shown, whether the user verifies or taps Skip for now); a reinstall
  shows it again, which is harmless. Helpers `hasSeenGstIntro(userId)` / `markGstIntroSeen(userId)` in
  `lib/onboarding-step.ts`, reads and writes wrapped in try/catch (a storage failure counts as seen, so it never
  blocks reaching Main). `AREA_MISMATCH` → refetch areas and show "Pick your industrial area again".
- After a new dev build is required (native modules): note in the report; tests are pure logic.

- [ ] **Step 1: Failing tests:** `onboarding-step.test.ts` — `nextScreen('profile')==='YourBusiness'`, etc.; Yup schema:
  pincode `012345` invalid, `395010` valid; exactly one of area id / other; authSlice stores `onboarding`;
  `hasSeenGstIntro` is false for a new user id, true after `markGstIntroSeen`, true when AsyncStorage throws
  (AsyncStorage mocked).
- [ ] **Step 2:** FAIL. **Step 3:** Implement screens, navigation, i18n (en/hi/gu). **Step 4:** PASS
  (`pnpm --filter user-app test`, includes i18n parity) + typecheck. **Step 5: Stage.**

---

### Task 16: App — GST verification screens and Profile

Start from textile `screens/verification/{verification,gst-step,prove-representative}.tsx` and the v2 "GST verification" screen.

**Files:**
- Create: `apps/user-app/lib/gst-api.ts`, `apps/user-app/lib/gstin.ts` (re-exports shared `normalizeGstin`/`isValidGstin`),
  `apps/user-app/lib/gst-flow.ts` (pure: which screen for a `GstStateView`), `apps/user-app/screens/verification/{gst-start,gst-found,gst-declare,gst-code,gst-review-form,gst-status}.tsx`
- Modify: `apps/user-app/screens/profile.tsx` (business card, completion meter, GST badge, rows Business profile /
  Location / GST verification), `navigation/*`, `locales/{en,hi,gu}/verification.json`, `locales/index.ts`
- Test: `apps/user-app/lib/gst-flow.test.ts`

**Behaviour:**
- `gst-flow`: `instantAllowed` false → review form; `none` → GSTIN entry; `found` → found card; `code_sent` → code
  screen (resend countdown from `resendAvailableAt`); `under_review` / `needs_more` / `rejected` / `verified` /
  `revoked` → status screen; `expired` → GSTIN entry with "Your lookup expired. Look it up again."
- Code screen has "Can't get the code?" → review form with `checkId`.
- Review form: typed details only when no `checkId`; constitution picker from `CONSTITUTIONS`; document picker
  (camera / gallery via `expo-image-picker`, PDF via `expo-document-picker`) with a type per file; uploads via presign
  + PUT; **on `503 STORAGE_UNAVAILABLE` from presign, or state `storageAvailable: false`, show "Document upload isn't
  available yet" and disable submit.**
- Needs more: officer message + add files. Rejected: reason + Start again (→ `gst-flow` decides instant vs review).
- Profile: completion meter (4 segments from `completion`), GST chip from state. **The rows open the onboarding
  screens in edit mode** (Task 15's `mode: 'edit'`): Business profile → YourBusiness, Location → WhereAreYou; GST
  verification → the screen `gst-flow` picks. A missing meter segment's prompt opens the same screen.

- [ ] **Step 1: Failing tests:** `gst-flow.test.ts` covers every state, `instantAllowed false` overrides `none`,
  `expired` handling, `checkId` passes to the review form; `isValidGstin` used before lookup; `profileRowTarget('location')`
  → `{ screen: 'WhereAreYou', params: { mode: 'edit' } }` (and the same for the business row).
- [ ] **Step 2:** FAIL. **Step 3:** Implement + i18n. **Step 4:** PASS + typecheck. **Step 5: Stage.**

---

### Task 17: End-to-end verification and docs

**Files:**
- Modify: `docs/PROJECT_STATUS.md` (What's built, Database row, How to run: `db:seed:locations`,
  `db:seed:industrial-areas`; session log line), `docs/superpowers/specs/...` only if a ruling changed behaviour (note it)

- [ ] **Step 1:** `pnpm typecheck`, `pnpm lint`, `pnpm test` — all green; record counts.
- [ ] **Step 2:** Dev DB: migrations applied, `db:seed:locations` and `db:seed:industrial-areas` loaded (second run
  refuses).
- [ ] **Step 3: Live API walk-through** against `pnpm dev:api` with the stub: sign in (dev OTP) → profile → location
  with pincode `395010` and an area from the list → GST instant with a valid GSTIN and code `123456` → `verified`;
  second business: `GST_PROVIDER=off` restart → review submit refused with `503 STORAGE_UNAVAILABLE` (expected without
  R2 keys) → insert a review via the test helper approach or SQL, approve from the admin API → `verified`; suspend the
  first user → its next request 403.
- [ ] **Step 4: Admin pages** smoke-tested in a browser against dev data (queue, detail, approve; business list,
  suspend; industrial areas add / Other adopt).
- [ ] **Step 5: Final report** names exactly: the `.env` variables to set (§6 list + `GST_PROVIDER`), and the R2 bucket
  settings: private bucket (no public access), an API token scoped to it with Object Read & Write, the lifecycle rule
  "delete objects with prefix `incoming-verification/` after 1 day", and CORS (not needed for the app's native PUT or
  for officers opening presigned links; needed only if a browser ever uploads directly — state which applies).
- [ ] **Step 6: Stage** the docs. Hand back for the owner's review and commit.
