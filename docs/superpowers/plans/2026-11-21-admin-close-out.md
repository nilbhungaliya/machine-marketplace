# Admin close-out (AD1 dashboard, AD6 reports / fraud signals / exports, AD7 admin users + audit log) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. **Contracts first, in sequence (C0), then parallel lanes** (as F6 + F7, F8 and M14): each
> lane in its own git worktree on a local lane branch, one implementer per lane doing its tasks in order, an independent
> review per lane, then the controller merges. Steps use checkbox (`- [ ]`) syntax.

**Status:** Draft, awaiting the owner's review.

**Goal:** Every admin opens a dashboard that answers "what waits on me, how is the marketplace now, and how did this
period compare with the last"; super admins grow and shrink the team themselves (invite links, roles, deactivation,
resets) with every change taking effect on the admin's next request; super admins read the audit log masked by default;
a job turns five behaviours into advisory fraud signals reviewed in Reports & flags, which now shows every report target;
users report a business from the app; staff export five lists as CSV with the list's filters.

**Architecture:** New tables `admin_password_tokens`, `fraud_signals`, `install_sightings`, `contact_sightings`,
`fraud_scan_state`; `admin_users` gains `token_version` and five columns, `password_hash` becomes nullable; indexes on
`audit_log` and the dashboard's period columns. Admin auth loads the admin row on every request and socket handshake
(`loadActiveAdmin`, token `tv`), built in C0 so every lane runs on it. Dashboard numbers are SQL on read, one builder per
metric, cached 60 s in Redis. Fraud signals come from one job over per-rule watermarks (2-minute margin) holding a
session advisory lock. Exports share one runner (count → cap → audit → keyset stream). The shared seams (sessions,
export runner, report attribution, open counts, audit labels, admin rate limit, route stubs with their roles) have real
bodies in C0, so lanes never edit each other's files.

**Tech stack:** Fastify 4, Drizzle 0.31 + drizzle-kit 0.22, Zod, Postgres 18, Redis, Socket.IO 4, `bcryptjs`, Node
`crypto` (HMAC-SHA-256, SHA-256, `randomBytes`); Next.js 14 admin kit with Recharts and sonner; Expo SDK 54 app. No new
dependency, no new native module.

**Spec:** `docs/superpowers/specs/2026-11-21-admin-close-out-design.md` (rulings R1–R18 + R9a, (my call) list §24,
build order §19). Section numbers below (§n) refer to it. The spec is the source of truth; plan decisions where it is
silent or loose are **D1–D18** below.

**Sources (textile first, owner rule; the repo is `C:\Users\Dell\Desktop\textile stock marketplace` on this machine):**
dashboard `apps/api/src/services/admin-insights/dashboard.ts` + `routes/admin/dashboard.ts`; audit viewer
`services/admin-insights/{audit-log,audit-labels}.ts` + `routes/admin/audit-log.ts`; flags
`services/trust/{flags.service,flags.consumer}.ts` (`raiseOrAppendFlag`, the evidence key) + `routes/admin/flags.ts`;
business reports `services/reports/business-report.service.ts`, `all-reports.service.ts`; its specs
`docs/superpowers/specs/2026-11-11-part5-m8-admin-dpdp-design.md` §7.3–§7.4 and `2026-11-08-part3-m19-m11-m10-design.md`
§4.2, §4.5, §4.7, and their plans. Ours (no textile counterpart): admin users and sessions follow `loadActiveUser`
(`apps/api/src/plugins/auth.ts`); exports follow `lib/csv.ts`; masking `lib/mask-contact.ts`; settings the registry.

---

## Global constraints

- **Branches (owner):** work on `develop` only. C0 on `develop`; then lanes, each in its own worktree on a local branch
  (checklist below), merged by the controller (`git merge --no-ff`). **Implementers never commit or push**; each task
  ends with "Stage" (list the files). The controller commits per lane after its review, commits the wave fix, and pushes
  at milestones only (spec + plan approved, after C0, after each wave, after Batch I). The spec and this plan are
  committed together before C0.
- **Contracts own the schema and shared types.** Only C0 adds migrations, edits `apps/api/src/db/schema.ts` or
  `packages/shared-types`. A lane needing a contract change stops and reports; the controller makes it on `develop` and
  the lane merges `develop` in.
- **File ownership:** a lane edits only the files in its row of the ownership table. Every cross-lane function exists
  after C0 with its final signature; stub bodies are marked `// AC-STUB(<lane>)` and return the empty answer (no-op,
  `[]`, `0`, `'skipped'`), never throw; stub routes answer `501 NOT_IMPLEMENTED` with the marker. The owning lane
  replaces the body and removes the marker; I-1 greps for it. `apps/user-app/lib/i18n/audit-allowlist.json`,
  `lib/style-audit-allowlist.json` and admin `AUDIT_EXEMPT` are append-only in lanes.
- **Lane isolation:** API lanes test against their own DB (`mpm_aca1_test` … `mpm_aca4_test`) and Redis index (`/3` …
  `/6`; `flushdb` first). Admin and app lanes run no API tests.
- **Routes:** Zod `.strict()` parse → service → `{ data }`; services throw `AppError` subclasses with §14's codes (plus
  D-codes below). Admin routes `preHandler: fastify.requireAdmin` or `requireAdminRole(...)` exactly as §6.3, §7.2,
  §8.3, §10, §11.2; **every admin mutation writes `audit_log` via `writeAudit` in its transaction** (reads write none,
  except `audit.reveal`, `thread.read` and `export.create`). User routes `preHandler: fastify.requireUser`.
- **Admin sessions (R13):** after C0-3 no code path trusts the role in an admin JWT; `request.admin.role` and the socket
  room come from the row. Any new admin route uses the plugin's guards, never `verifyAdminToken` directly.
- **Privacy:** no raw phone number, message text, PAN, street or site address in a signal, an export by default, an
  audit row written by this feature, a log line or Sentry. Phones become HMAC-SHA-256 with `SIGNAL_HASH_KEY`; install
  ids SHA-256. Password and link token values never in `audit_log`, logs or Sentry (redact `password`, `current`,
  `token`); the stored link is SHA-256 hex only. **Privacy assertions** plant a known number (`9876543210`) and check
  that neither its ASCII nor its Devanagari form (`९८७६५४३२१०`) appears, never a generic `\d{10}` match.
- **Time:** IST days and Monday weeks from `apps/api/src/lib/ist.ts` (`IST_TODAY`, `istToday`, `addDays`); DB-clock
  rules use `now()`; tests move stored timestamps with `UPDATE`, never fake timers for DB-clock rules; pure functions
  take `today` as a parameter.
- **Money:** integer paise in the API (`bigint` sums cast to JSON numbers); rupees with two decimals only in CSV cells.
- **Migrations:** edit `schema.ts` → `pnpm --filter @mpm/api db:generate` (**0018**); CHECKs in
  `pnpm --filter @mpm/api exec drizzle-kit generate --custom` (**0019**). Never hand-edit a generated file, never touch
  0000–0017. Apply with `db:migrate` **and** `db:migrate:test`.
- After editing `packages/shared-types`: `pnpm --filter @mpm/shared-types build`; its pure-function tests live in
  `apps/api/src/lib/ac-shared.test.ts`.
- **Tests: limited and important only (owner).** Step 1 lists the only cases to write: business rules, security and
  privacy (RBAC, admin sessions / token version, masking, PII in exports and audit values), data integrity (watermarks,
  last super admin, one open signal), money. **No UI wiring tests.** Admin tests: only the four of §18's last paragraph.
  App: locale parity / audit and style audit must pass; no new app test.
- **Running tests (memory is tight):** one test process at a time; a lane runs only its new test files plus the existing
  suites it touches (`pnpm --filter @mpm/api exec vitest run __tests__/<file>.test.ts …`). **The full API suite runs
  only twice:** after the wave A merge and in I-2. At most three lanes at once. Admin build and `expo export` only in
  I-2.
- **API test fixtures:** real Postgres + Redis; unique per run (`createTestAdmin`, `createTestSeller`,
  `createTestBusinessUser`, `insertTestListing`, C0-2's helpers); every suite leaves its rows gone (`deleteCloseOutRows`
  runs inside `deleteTestBusinesses` / `deleteTestUsers`, and `deleteTestAdmins` clears the admin references). Suites
  run in parallel on one test DB, so **dashboard tests always filter by a city / area / category unique to the run**,
  work-count tests assert keys and `≥` their own rows, rate-limit tests build their own app without
  `GROUP_RATE_LIMIT_MAX` (as the existing limit tests do), and only `fraud-job.test.ts` and I-1 call `runFraudSignals`
  (with `{ wait: true }`, saving and restoring `fraud_scan_state`); other fraud tests call the per-rule functions on
  their own businesses.
- **Admin:** English only; Periwinkle v2 kit and palette classes only (charts take colours from `lib/palette.ts`, never a
  literal); style audit green; loading / empty / error states on every page; destructive actions through `useConfirm()`
  `variant: 'danger'`; filters in the URL (`use-url-state`).
- **App:** every string in `en`, `hi`, `gu`; light only (`useTheme()`), `useType()`, the v2 kit, `testID` on every
  pressable (`apps/user-app/CLAUDE.md` §1–2, §6, §8).
- **Exact numbers (spec):** dashboard custom range ≤ 366 days, trend daily ≤ 31 days else weekly, cache 60 s, top 10
  breakdown rows, top 50 cities; passwords 12–128, bcrypt cost 12, links 32 bytes / 48 h / single use / newest wins,
  lockout 5 failures per email in 15 min for 15 min, inspect / set 10 per min per IP; reveal 30 per hour per admin;
  exports ≤ 10 000 rows, pages of 1 000, 10 per 10 min per admin; evidence ≤ 50 items; scan margin 2 min, first run
  30 days back, ≤ 5 000 messages a run; job every 10 min; retention: sightings 90 days, closed signals 1 year, tokens
  7 days after use / expiry, batches of 1 000; settings defaults §12; business report details ≤ 500, 10 reports per
  user per 24 h; audit / signal pages 25 / 50 / 100.
- **Every task ends green** for its own tests, typecheck of the packages it touched, lint for admin.
- Windows: Bash is Git Bash; paths relative to the repo root.

## Plan decisions (D1–D18, where the spec is silent or loose)

- **D1. Lanes.** §19's sketch with A3 split in two, because exports touch five list services and would make one lane
  the critical path: **A1** dashboard; **A2** AD7 (admin users, password links, lockout, audit viewer + export);
  **A3** fraud signals (detectors, sightings, scan, rules, job, retention, signals API, reader gate); **A4** business
  reports, Reports queue targets and count, business detail additions, exports. Wave B: **B1** dashboard page +
  `StatCard` delta + Analytics removal; **B2** admin users, set / change password, session end, audit log pages,
  settings section; **B3** Reports & flags tabs, signals, business detail panels, export buttons; **B4** the app's
  Report this business (its own small lane: it shares no file with an admin lane, and keeping it apart keeps B3's
  reviewer in one codebase). The admin session change is C0 (C0-3), not A2.
- **D2. Session seam (C0-3, real bodies):** `signAdminToken({ adminId, role, tv })`; `verifyAdminToken(token):
  { adminId: string; role: AdminRole; tv: number }` (a token without `tv` → `tv = -1`, so every pre-feature token ends);
  `loadActiveAdmin(db, adminId, tv): Promise<AdminTokenPayload>` (non-UUID, missing, `is_active = false`,
  `password_hash IS NULL` or `token_version ≠ tv` → `401 ADMIN_SESSION_ENDED`; role from the row);
  `services/admin-users/sessions.ts`: `endAdminSessions(tx: Tx, adminId: string): Promise<number>` (bumps
  `token_version`, returns the new value, queues the socket end); `lib/tx-effects.ts` `queueAdminSessionEnd(tx,
  adminId, tv)` (after commit: emit `admin:session_ended { tv }` with the new version to `adminUserRoom(id)`, then
  `disconnectSockets(true)` on that room). A client signs out only when the event's `tv` is greater than its own
  token's `tv` (B2-1), so the tab that changed its own password keeps its session.
- **D3. Shared seams with real bodies in C0-4:** the export runner, report attribution, open counts, audit labels, the
  admin rate limit (interfaces in C0-4). Only three stubs cross lanes: `openSignalsForBusiness` (A3, used by A4),
  `runFraudSignals` / `runAdminRetention` (A3, registered as jobs), `recordInstallSighting` (A3, wired into the OTP and
  devices routes in C0).
- **D4. Route files per lane** (created and registered in C0-4 with their final guards): `routes/admin/dashboard.ts`
  (A1), `routes/admin/admin-users.ts`, `routes/admin/audit-log.ts`, `routes/admin/auth.ts` additions (A2),
  `routes/admin/fraud-signals.ts` (A3), `routes/admin/exports.ts`, `routes/admin/reports.ts` (`/count`),
  `POST /businesses/:id/reports` in `routes/businesses.ts` (A4).
- **D5. Open counts:** an open report is status `open` or `reviewing`, any target (listing included); an open signal is
  status `open`. `GET /admin/reports/count` → `{ reports, signals }`; the nav badge `reportsOpen` shows their sum.
- **D6. Dashboard breakdown switch:** `GET /admin/dashboard` takes `breakdown=city|industrial_area|category` (default
  `city`, part of the cache key); the response carries the one breakdown asked for.
- **D7. Admin rate groups:** `adminRateLimit('admin_export', 10, 600)` shared by the five sheets and the audit export
  (one Redis counter per admin), `adminRateLimit('admin_reveal', 30, 3600)`; keyed by `request.admin.adminId` under the
  discovery Redis prefix; `GROUP_RATE_LIMIT_MAX` overrides as for user groups; over the limit → `429 RATE_LIMITED` as
  `groupRateLimit`.
- **D8. Business report limits:** the 10-per-24-h count is on `reports.reporter_user_id` across every target (as
  listing reports, `REPORTS_PER_DAY`), serialised by the same advisory lock key `listing-report:<userId>`. Reason
  `other` **requires details** (`400 VALIDATION_ERROR`, field `details`), as F2's `something_else`.
- **D9. Fraud job entry:** `runFraudSignals(app: TxApp, opts?: { wait?: boolean }): Promise<'ran' | 'skipped'>` on a
  dedicated pool client (`pg_try_advisory_lock(hashtext('fraud-signals'))`, or `pg_advisory_lock` when `wait`), unlock in
  `finally`. Per-rule functions exported for tests (A3-2, A3-3 interfaces). **Watermarks advance only after the run's
  evaluation succeeded** (one final transaction); a run that fails anywhere leaves them, so the next run reads the same
  window, and re-reading is idempotent (unique `contact_sightings(message_id, phone_hmac)` + `ON CONFLICT DO NOTHING`;
  evidence keys dedupe).
- **D10. Export cap testing:** `runCsvExport` takes `cap` (default `EXPORT_ROW_CAP`); the unit test uses `cap: 2`; the
  route-level cap test is the audit export over 10 001 `audit_log` rows inserted with `generate_series` for a test admin.
- **D11. Admin users list** is unpaged (a team is small), newest first. `POST …/password-link` on a deactivated admin →
  `409 ADMIN_DEACTIVATED` (new code); inspecting or setting a link whose admin is deactivated → `400
  PASSWORD_LINK_INVALID`. The link's purpose is `invite` while the admin's status is `invited`, else `reset`.
- **D12. Last-super-admin guard (R14):** inside `pg_advisory_xact_lock(hashtext('admin_users'))`, after applying the
  change, count admins with `role = 'super_admin' AND is_active AND password_hash IS NOT NULL`; zero → roll back with
  `409 ADMIN_LAST_SUPER_ADMIN`. Applies to role change, deactivate and reset.
- **D13. Link URL:** the API returns `{ token, expiresAt }`; the admin panel builds
  `${window.location.origin}/set-password#t=<token>`. No new env variable.
- **D14. Login lockout:** Redis key `<discovery prefix>admin-login:<sha256(lowercased email)>`, incremented on every
  failed login (unknown email included), TTL 15 min set on the first failure and reset to 15 min on the 5th; at ≥ 5 the
  login answers `429
  TOO_MANY_ATTEMPTS` (`details.retryAt`) **before** bcrypt; a success deletes the key. Without Redis (tests with
  `infra: false`) no lockout.
- **D15. Audit rows of this feature:** entity types `admin_user` (`admin_user.create|update|deactivate|reactivate|
  password_link|sign_out|password_set|password_change`), `audit_log` (`audit.reveal`: `after: { action }`), `export`
  (`export.create`: `entityId` = sheet, `after: { filters, rowCount, includeContacts }`, string filter values through
  `maskContact` first), `fraud_signal`
  (`fraud_signal.review`), `report` (`report.resolve`, existing). `before` / `after` never hold `password_hash`, tokens
  or token hashes; the `admin_user` snapshot is `{ name, email, role, isActive }`.
- **D16. Evidence keys (dedupe):** `device:<groupId>:<otherBusinessId>`, `phone:<messageId>`, `pay:<messageId>`,
  `burst:<threadOrReplyId>`, `report:<reportId>`; `groupId` = first 8 hex of the phone HMAC or install hash.
- **D17. App entry points:** the listing page's seller block has no menu today, so it gets a ghost **Report this
  business** button (a new optional `onReportBusiness` slot of `ListingView`, absent in Preview and on one's own
  listing); Seller reviews gets a header "more" `IconButton` → `ActionSheet` with the one row (hidden for one's own
  business). Both open the listing report sheet generalised to a `target`.
- **D18. Account menu:** the admin has no top-bar account menu; **Change password** and **Sign out everywhere** go in
  the sidebar's account footer beside Sign out (`components/layout/sidebar.tsx`).

## Review focus

1. **A path that still trusts the token:** a route, the `/admin` socket, `/admin/auth/me` or the idempotency key using
   the JWT's role or skipping the row lookup, so a deactivated or demoted admin keeps acting. Pinned in C0-3
   (`admin-sessions.test.ts`) and C0-4 (`ac-routes-rbac.test.ts`: every new route with a stale `tv` → 401).
2. **Zero super admins through a race or a reset:** two super admins demoting / deactivating / resetting each other at
   once, or a reset counted as still able to sign in. Pinned in A2-1 (`Promise.all` cases for each action, D12).
3. **Watermark gaps and doubles:** a run that advances past rows it didn't process (a failed evaluation, the 5 000 cut
   mid-run, a scan jumping past a row still inside the margin), a late-committing message lost or scanned twice, the
   first run reading all history. Pinned in
   A3-2 (`fraud-scan.test.ts`).
4. **A raw identifier stored or shipped:** a phone in `contact_sightings`, signal evidence or summaries, a token or hash
   in an `admin_user.*` audit row, contacts in a businesses CSV for a non-super admin, a snapshot column in the audit
   export. Pinned in A3-2, A3-3, A2-2, A4-3, A2-3 (each with a planted-number / "no `token`" assertion).
5. **One number, two definitions:** the trend or the breakdown counting a deal, enquiry or booking differently from the
   tile (cancelled value, the buyer's city instead of the listing's, a UTC instead of IST day, a Sunday week start).
   Pinned in A1-2 (trend sums and breakdown sums equal the tiles for the run's city).

---

## Lanes and ownership

| Lane | Wave | Owns (only these files; paths under `apps/api/src/` unless noted) | Assumes from C0 |
|---|---|---|---|
| **A1 API dashboard** | A | `services/admin-insights/{period,dashboard-scope,dashboard,dashboard-trend,work,options}.ts`, `routes/admin/dashboard.ts`, tests `apps/api/__tests__/admin-dashboard{,-trend}.test.ts` | counts (C0-4), route stubs, shared types |
| **A2 API AD7** | A | `services/admin-users/{admin-users.service,password-links,lockout}.ts` (not `sessions.ts`), `services/admin-auth.service.ts`, `services/admin-insights/{audit-log,audit-mask}.ts`, `routes/admin/{admin-users,audit-log,auth}.ts`, tests `apps/api/__tests__/admin-{users,passwords,audit-log}.test.ts` | sessions (C0-3), export runner, audit labels, admin rate limit (C0-4) |
| **A3 API fraud** | A | `lib/mask-contact.ts` (+ test), `services/chat/scam-patterns.ts` (+ test), `services/fraud/**`, `services/chat/admin-read.service.ts`, `routes/admin/fraud-signals.ts`, tests `apps/api/__tests__/fraud-{hash,scan,rules,job,admin}.test.ts` | schema, report attribution, settings, stubs it owns (C0-4) |
| **A4 API reports + exports** | A | `services/reports/{business-report.service,admin-reports.service}.ts`, `services/admin/business-admin.service.ts`, `services/listings/listing-admin.service.ts`, `services/deals/deal-admin.service.ts`, `services/rentals/admin.service.ts`, `services/part-requests/admin.service.ts` (list `WHERE` builders only, plus business detail), `routes/admin/{list-filters,exports,reports,businesses,listings,deals,rentals,part-requests}.ts` (filter schemas only), `routes/businesses.ts` (the report route), `services/exports/{businesses,listings,deals,rental-bookings,part-requests}.ts`, tests `apps/api/__tests__/{business-reports,admin-reports-ac,admin-business-signals,admin-exports}.test.ts` | export runner + format, attribution, counts (C0-4); `openSignalsForBusiness` stub (A3) |
| **B1 admin dashboard** | B | under `apps/admin/`: `app/(dashboard)/page.tsx`, `app/(dashboard)/analytics/page.tsx`, `components/dashboard/**`, `components/stat-card.tsx` (+ new `stat-card.test.tsx`), `lib/dashboard-api.ts`, `lib/dashboard-format.ts` | nav (C0-5), A1 API |
| **B2 admin AD7** | B | under `apps/admin/`: `app/(dashboard)/admin-users/**`, `components/admin-users/**`, `lib/admin-users-api.ts`, `app/set-password/page.tsx`, `app/login/page.tsx` (lockout line), `components/layout/sidebar.tsx` (account footer), `components/account/**`, `lib/auth-context.tsx`, `lib/socket.ts`, `lib/api.ts` (retry once on 401), `app/(dashboard)/audit-log/**`, `components/audit-log/**`, `lib/audit-log-api.ts`, `app/(dashboard)/settings/page.tsx`, `components/settings/marketplace-settings-form.tsx` (+ test) | nav, status tones (C0-5), A2 API |
| **B3 admin AD6** | B | under `apps/admin/`: `app/(dashboard)/reports/page.tsx`, `components/fraud/**`, `components/reports/**`, `components/conversations/{report-resolve-dialog,use-admin-reports}.ts(x)`, `lib/reports-api.ts` (extends C0's), `lib/fraud-api.ts`, `lib/exports-api.ts`, `components/export-button.tsx` (+ test), `components/businesses/business-detail.tsx` (+ test), the five list pages `app/(dashboard)/{businesses,listings,deals,rentals,part-requests}/page.tsx` (the Export button only) | nav badge, status tones (C0-5), A3 + A4 API |
| **B4 app** | B | under `apps/user-app/`: `screens/listing/{report-sheet,listing-view,listing}.tsx`, `screens/reviews/seller-reviews.tsx`, `lib/{business-report,listing-api,listing-errors,analytics-events}.ts`, `hooks/use-listing.ts`, `locales/{en,hi,gu}/listing.json` | shared types (C0-1), A4 API |

**Waves.** Wave A = A1–A4, at most three at once: start A3, A4, A2 (the longer lanes), then A1 when one finishes.
Wave B = B1–B4 after the wave A merge (B4 any time after A4 merges). Each wave: lanes reviewed one by one, merged one
by one, then the wave's checks once and a fix wave on `develop`.

**Lane setup checklist (controller, per lane):**
1. `git worktree add .claude/worktrees/ac-<lane> -b lane/ac-<lane> develop`.
2. Copy the root `.env` into the worktree (never committed); API lanes set `TEST_DATABASE_URL` to
   `…/mpm_ac<lane>_test` and `TEST_REDIS_URL` to `redis://localhost:6381/<3|4|5|6>` (`redis-cli -p 6381 -n <n>
   flushdb` first).
3. API lanes: `docker exec mpm-postgres-1 createdb -U mpm mpm_ac<lane>_test`.
4. In the worktree: `pnpm install --offline`, `pnpm --filter @mpm/shared-types build`; API lanes
   `pnpm --filter @mpm/api db:migrate:test`.
5. Hand the implementer the worktree path, the lane's tasks, its ownership row, the Global constraints and the base
   commit.
6. After the merge: `git worktree remove`, `dropdb` the lane DB, delete the lane branch.

---

## File map

```
packages/shared-types/src/index.ts, apps/api/src/lib/ac-shared.test.ts, apps/admin/lib/status.ts (+ test)      (C0-1)
apps/api/src/db/schema.ts, infra/migrations/0018_admin_close_out.sql, 0019_admin_close_out_checks.sql (+ meta),
  apps/api/src/db/seed.ts, __tests__/_helpers/{test-admins,test-fraud,test-businesses,test-users}.ts           (C0-2)
apps/api/src/plugins/auth.ts, socket/setup.ts, lib/tx-effects.ts, services/admin-users/sessions.ts,
  services/admin-auth.service.ts (tv, last_login_at, null hash), routes/admin/auth.ts (/me),
  __tests__/{socket,discovery-core}.test.ts (real admin rows), __tests__/admin-sessions.test.ts                (C0-3)
apps/api/src/lib/{csv,group-limit,sentry}.ts, services/exports/{run-export,format}.ts,
  services/reports/report-subject.ts, services/admin-insights/{counts,audit-labels}.ts, the route stub files (D4),
  services/fraud/{job,retention,sightings,admin.service}.ts stubs, routes/{auth-otp,devices}.ts (sighting call),
  app.ts, jobs/index.ts, .env.example, __tests__/{ac-seams,ac-routes-rbac}.test.ts                              (C0-4)
apps/admin/lib/{nav,nav-badges,reports-api}.ts (+ nav.test.ts)                                                 (C0-5)
lanes: see the ownership table
docs/PROJECT_STATUS.md, CLAUDE.md, apps/{admin,user-app}/CLAUDE.md, docs/product-scope.md, F1/F2/F6 spec notes  (I-4)
```

---

# Batch C0 — Contracts (sequential, on `develop`)

### C0-1: Shared types, settings, errors, status tones

**Files:** Modify `packages/shared-types/src/index.ts` (section "Admin close-out"), `apps/admin/lib/status.ts` (+ its
test's status lists), `apps/admin/lib/conversations-api.ts` (its `AdminReportTarget` re-points at the shared type; B3
only consumes it); Create `apps/api/src/lib/ac-shared.test.ts`; compile fallout: `AdminReportTarget` moves here from
`services/reports/admin-reports.service.ts` (which re-exports it); `components/conversations/report-resolve-dialog.tsx`
gets placeholder `COPY` entries for `business` / `listing` (B3 writes the copy); `getBusinessDetail` returns
`reports: { open: 0, byTarget: {} }, fraudSignals: []` (A4 fills them) and `business-detail.test.tsx`'s fixture gains
the two fields; `src/lib/listing-shared.test.ts`'s settings count 40 → 48 (+ an 8 for `fraud_`).

**Contents (§5.7, §12, §14):**
- Dashboard: `DASHBOARD_RANGES = ['7d','30d','90d','custom']`, `DASHBOARD_CUSTOM_MAX_DAYS = 366`,
  `DASHBOARD_BREAKDOWNS = ['city','industrial_area','category']`; `AdminDashboardQuery { range; from?; to?; city?;
  industrialAreaId?; categoryId?; breakdown? }`; `PeriodCount = { value: number; previous: number }`; `PeriodRate =
  { value: number | null; previous: number | null }` (rates 0–1, medians in hours); `AdminDashboard { generatedAt;
  period: { from; to; prevFrom; prevTo; granularity: 'day' | 'week' }; snapshot: { businesses; verifiedBusinesses;
  activeUsers; activeListings; partsAvailable; machinesForRent; machinesOutToday; openRequirements }; metrics: {
  newBusinesses; enquiries; offers; deals; dealValuePaise; dealsCompleted; rentalBookings; rentalValuePaise;
  soldListings; closedListings; requirementsPosted: PeriodCount; requirementMatchRate; fulfilmentMedianHours;
  replyRate24h; firstReplyMedianHours: PeriodRate }; trend: { bucket: string; enquiries; offers; deals; dealValuePaise;
  rentalBookings }[]; breakdown: { by: DashboardBreakdown; rows: { key; label; activeListings; newListings; enquiries;
  deals; dealValuePaise; dealsPrevious }[] } }` (every unlisted metric a `PeriodCount`); `AdminWorkCounts =
  Partial<{ listingsToReview; listingsReported; verificationWaiting; disputesOpen; reportsOpen; signalsOpen: number }>`;
  `DashboardOptions { cities: string[]; industrialAreas: { id; name; city }[]; categories: { id; name }[] }`.
- Admin users: `ADMIN_USER_STATUSES = ['active','invited','reset_pending','deactivated']`; `adminUserStatus(r: {
  isActive: boolean; hasPassword: boolean; lastLoginAt: string | Date | null }): AdminUserStatus` (§5.1);
  `ADMIN_PASSWORD_MIN = 12`, `ADMIN_PASSWORD_MAX = 128`, `ADMIN_LINK_HOURS = 48`; `adminPasswordProblem(password: string,
  email: string): 'too_short' | 'too_long' | 'is_email' | null` (`is_email` compares trimmed, case-insensitive);
  `AdminUserRow { id; name; email; role; status; lastLoginAt; createdAt; createdBy: { id; name } | null; deactivatedAt }`;
  `AdminPasswordLink { token; expiresAt }`; `AdminUserCreateResult { admin: AdminUserRow; link: AdminPasswordLink }`;
  `PasswordLinkInfo { name; email; purpose: 'invite' | 'reset' }`.
- Audit: `AUDIT_PAGE_SIZES = [25, 50, 100]`; `AuditLogRow { id; at; admin: { id; name } | null; action; label;
  entityType; entityId; entityLabel: string | null; href: string | null }`; `AuditLogDetail = AuditLogRow & { before:
  unknown; after: unknown; changedKeys: string[]; masked: boolean }`; `AuditLogPage { rows; total; page; pageSize }`;
  `AuditLogFacets { actions: { action; label }[]; entityTypes: string[]; admins: { id; name }[] }`.
- Fraud: `FRAUD_SIGNAL_KINDS = ['shared_device','repeated_phone','payment_details','new_account_burst',
  'reports_against']`; `FRAUD_SIGNAL_STATUSES = ['open','dismissed','actioned']`; `PAYMENT_MATCH_KINDS = ['upi_link',
  'upi_handle','pay_host','advance_ask','bank_details']`; `FRAUD_EVIDENCE_MAX = 50`; `FraudEvidence` exactly §5.3;
  `FraudSignalRow { id; business: { id; name }; kind; status; evidenceCount; firstSeenAt; lastSeenAt; reviewedAt;
  reviewedBy: { id; name } | null; note }`; `FraudEvidenceView { key; at; summary; groupId: string | null; threadId:
  string | null; messageId: string | null; businesses: { id; name }[]; users: { id; name; businessId }[]; reportIds:
  string[] }`; `FraudSignalDetail = FraudSignalRow & { evidence: FraudEvidenceView[] }`; `FraudSignalPage { rows;
  total; page; pageSize }`.
- Reports: `BUSINESS_REPORT_REASONS = ['fake_business','scam_or_advance_payment','abusive','impersonation','other']`,
  `BUSINESS_REPORT_DETAILS_MAX = 500`, `BusinessReportRequest { reason; details?: string | null }`;
  `ADMIN_REPORT_TARGETS = ['business','listing','conversation','review','part_request']`, `AdminReportTarget`;
  `AdminReportRow.target: AdminReportTarget` + `business?: { id; name }` + `listing?: { id; ref; title; seller:
  AdminPartyRef }`; `AdminReportCounts { reports; signals }`; `AdminBusinessDetail.reports: { open: number; byTarget:
  Partial<Record<AdminReportTarget, number>> }` and `AdminBusinessDetail.fraudSignals: FraudSignalRow[]`.
- Exports: `EXPORT_SHEETS = ['businesses','listings','deals','rental_bookings','part_requests']`,
  `EXPORT_ROW_CAP = 10_000`, `EXPORT_PAGE_SIZE = 1_000`, `EXPORT_SHEET_ROLES: Record<ExportSheet, AdminRole[]>`
  (businesses `support`, `verification_officer`, `moderator`; listings `moderator`, `support`; deals `support`,
  `operations`; rental_bookings `operations`, `support`; part_requests `moderator`, `support`).
- `APP_SETTINGS` + the 8 `fraud_*` keys of §12 (defaults, ranges, labels and help as §12's "Meaning").
- `ADMIN_CLOSE_OUT_ERROR_CODES` = §14's codes + `ADMIN_DEACTIVATED` (D11).
- `apps/admin/lib/status.ts`: signal tones `open` amber, `dismissed` gray, `actioned` green; admin user tones `active`
  green, `invited` / `reset_pending` amber, `deactivated` gray; labels "Active / Invited / Reset pending / Deactivated".

- [ ] **Step 1: Failing tests** (`ac-shared.test.ts`): `adminUserStatus` → `deactivated` for `isActive: false` with a
  password; `invited` for no password and `lastLoginAt: null`; `reset_pending` for no password and a `lastLoginAt`;
  `active` otherwise. `adminPasswordProblem('short', 'a@b.in')` → `too_short`; 129 chars → `too_long`;
  `'Admin@Example.com '` for `admin@example.com` → `is_email`; a 12-char password → null. `validateSettings` refuses
  `fraud_device_accounts: 1` and `fraud_window_days: 91`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; `pnpm --filter @mpm/shared-types build`; make every consumer compile.
  **Step 4:** PASS; `pnpm typecheck`. **Step 5: Stage.**

### C0-2: Schema, migrations, seed, fixtures

**Files:** Modify `apps/api/src/db/schema.ts`, `apps/api/src/db/seed.ts`; Create `infra/migrations/0018_*.sql`,
`0019_*.sql` (+ meta) via the commands; Create `apps/api/__tests__/_helpers/test-fraud.ts`; Modify
`__tests__/_helpers/{test-admins,test-businesses,test-users}.ts`; Test `apps/api/__tests__/ac-schema.test.ts`.

**Contents (§5):** `admin_users`: `password_hash` nullable; `token_version int NOT NULL DEFAULT 0`, `password_set_at`,
`last_login_at`, `deactivated_at`, `deactivated_by_admin_id`, `created_by_admin_id` (self FKs). Tables
`admin_password_tokens` (Drizzle `adminPasswordTokens`, §5.2, `token_hash` unique, index `(admin_id, created_at)`),
enums `fraud_signal_kind` / `fraud_signal_status`, `fraud_signals` (`fraudSignals`, §5.3, partial unique
`fraud_signals_one_open` on `(business_id, kind) WHERE status = 'open'` and index `(status, last_seen_at DESC)`),
`install_sightings`, `contact_sightings` (+ unique `contact_sightings_message_phone_uq` on `(message_id, phone_hmac)`),
`fraud_scan_state` (§5.4 with their indexes); `chat_messages(seq)` index; `audit_log` indexes §5.5; the
seven dashboard indexes of §5.6 (all missing today: `chat_threads(created_at)`, `offers(created_at) WHERE round = 0`,
`deals(accepted_at)`, `rental_bookings(confirmed_at)`, `listing_status_history(to_status, created_at)`,
`part_requests(first_posted_at)`, `businesses(created_at)`). **0019** (`--custom`): `admin_users_email_lower` `CHECK
(email = lower(email))`; `admin_password_tokens_purpose` `CHECK (purpose IN ('invite','reset'))`;
`fraud_signals_evidence_shape` `CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 50)`;
`fraud_signals_review_shape` `CHECK ((status = 'open') = (reviewed_at IS NULL))`; `fraud_scan_state_one_mark` `CHECK
(num_nonnulls(last_seq, last_at) = 1)`. `seed.ts`: bcrypt cost 12, sets `password_set_at`.

**Helpers:** `createTestAdmin(role, opts?: { password?: string /* hashed at cost 4 */; invited?: boolean }): Promise<{
id; email; token }>` (token carries the row's `token_version`); `deleteTestAdmins(ids)` also deletes their
`admin_password_tokens` (by `admin_id` or `created_by_admin_id`), sets `created_by_admin_id` / `deactivated_by_admin_id`
/ `fraud_signals.reviewed_by_admin_id` referencing them to null, then the existing deletes. `test-fraud.ts`:
`insertTestMessage(o: { threadId; senderUserId; senderSide: PartySide; text; createdAt?: Date }): Promise<{ id; seq }>`;
`insertTestSighting(o: { installId; userId; lastSeenAt?: Date })`; `saveScanState(): Promise<Row[]>` /
`restoreScanState(rows)`; `countCloseOutRows(conn, { businessIds; userIds })`; `deleteCloseOutRows(conn, { businessIds;
userIds })` (signals of the businesses, contact sightings by business or by a thread / message of theirs, install
sightings of the users), called first in `deleteTestBusinesses` and `deleteTestUsers` (a fraud run in one suite may
raise signals on another suite's businesses).

- [ ] **Step 1: Failing tests** (`ac-schema.test.ts`): a second `open` signal for the same business and kind refused,
  allowed once the first is `dismissed` (with `reviewed_at`); an `open` signal with `reviewed_at` refused; evidence of
  51 items refused; a scan-state row with both or neither mark refused; a second sighting of the same message and
  HMAC refused; `deleteCloseOutRows` leaves `countCloseOutRows` all 0 and `deleteTestBusinesses` then succeeds.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; `pnpm --filter @mpm/api db:generate`; `pnpm --filter @mpm/api exec
  drizzle-kit generate --custom` for 0019; `db:migrate`; `db:migrate:test`. **Step 4:** PASS; `pnpm --filter @mpm/api
  typecheck` (fallout of the nullable hash is fixed in C0-3). **Step 5: Stage.**

### C0-3: Admin sessions (R13, §11.1) and the test-helper fix

**Follows:** `loadActiveUser` and the `/user` handshake (`plugins/auth.ts`, `socket/setup.ts`).

**Files:** Modify `apps/api/src/plugins/auth.ts`, `socket/setup.ts`, `lib/tx-effects.ts`,
`services/admin-auth.service.ts`, `routes/admin/auth.ts` (`/me` returns the row's role); Create
`services/admin-users/sessions.ts`; Modify `__tests__/socket.test.ts` (the two `adminId: 'a1'` tokens → `createTestAdmin`
rows), `__tests__/discovery-core.test.ts` (`:474` support token → `createTestAdmin('support')`; `:373` only gains
`tv: 0`: the rate key never reads the DB), `__tests__/optional-user.test.ts` (`:71` gains `tv: 0`),
`__tests__/_helpers/test-admins.ts` (signs with the row's version): the `signAdminToken` callers that need `tv`; Test
`apps/api/__tests__/admin-sessions.test.ts`.

**Interfaces (final):** per D2. `requireAdmin` / `requireAdminRole` call `loadActiveAdmin(fastify.db, claims.adminId,
claims.tv)`; a bad signature or `typ` stays `401 UNAUTHORIZED`. The `/admin` handshake refuses with
`new Error('ADMIN_SESSION_ENDED')` and joins rooms from the row's role. `loginAdmin`: null hash or inactive → the
generic `401` ("Invalid email or password"), success sets `last_login_at = now()` and signs `tv = token_version`.

- [ ] **Step 1: Failing tests** (`admin-sessions.test.ts`): a token after `UPDATE admin_users SET is_active = false` →
  `401` with code `ADMIN_SESSION_ENDED` on `GET /admin/auth/me`; after `token_version = token_version + 1` → the old
  token 401, a new token 200; a moderator row changed to `support` by SQL (no bump) → the old token gets 403 on the
  moderator-only `POST /admin/listings/:id/approve` and `/me` reports `support`; a token
  without `tv` → 401; the socket handshake with an ended token rejects `ADMIN_SESSION_ENDED`; `endAdminSessions` in a
  `runTx` → the connected admin socket receives `admin:session_ended { tv }` with the new version and is disconnected after commit, and nothing
  happens when the transaction rolls back; login refuses an invited admin (null hash) and a deactivated one with the same
  401 body as a wrong password; login sets `last_login_at`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; then, one at a time, `socket.test.ts`,
  `discovery-core.test.ts`, `optional-user.test.ts` and `__tests__/admin-*.test.ts` still pass. **Step 5: Stage.**

### C0-4: API seams, route stubs, jobs, limits, redaction

**Files:** Modify `lib/csv.ts` (`CSV_BOM`, `csvRow(cells: CsvCell[]): string`; `toCsv` unchanged in behaviour),
`lib/group-limit.ts`, `lib/sentry.ts` (redact `password`, `current`, `token`), `app.ts`, `jobs/index.ts`,
`routes/auth-otp.ts` + `routes/devices.ts` (call `recordInstallSighting` after a successful sign-in / register, never
failing the request), `routes/admin/reports.ts` (`/count` stub), `routes/businesses.ts` (report stub),
`routes/admin/auth.ts` (four stubs), `.env.example` (`SIGNAL_HASH_KEY=` with a comment: ≥ 32 characters, optional, the
phone rule is off without it); Create `services/exports/{run-export,format}.ts`, `services/reports/report-subject.ts`,
`services/admin-insights/{counts,audit-labels}.ts`, the stub route files of D4, `services/fraud/{job,retention,
sightings,admin.service}.ts` (stubs); Test `apps/api/__tests__/ac-seams.test.ts`, `ac-routes-rbac.test.ts`.

**Interfaces (final; real bodies unless marked):**
- `runCsvExport<C>(app: TxApp, reply: FastifyReply, spec: { adminId: string; sheet: ExportSheet | 'audit_log';
  filters: Record<string, unknown>; includeContacts?: boolean; header: string[]; count(): Promise<number>; page(after:
  C | null): Promise<{ rows: CsvCell[][]; next: C | null }>; cap?: number }): Promise<void>` — count; `> cap` → `400
  EXPORT_TOO_LARGE` (`details.total`, no audit row); else `writeAudit` `export.create` (D15; string filter values
  through `maskContact`) in its own transaction,
  headers `text/csv; charset=utf-8` and `attachment; filename="<sheet>-<istToday>.csv"`, stream `CSV_BOM` + header +
  pages until `next` is null (`Readable.from`).
- `format.ts`: `istMinute(d: Date | string): string` (`YYYY-MM-DD HH:mm` IST), `rupees(paise: number | bigint | null):
  string` (`'1234.50'`, empty for null).
- `report-subject.ts`: `reportAgainstSql(alias = 'r'): SQL` — the business a report is against: `business` → target id;
  `listing` → the listing's business; `part_request` → the request's business; `review` → the review's
  `reviewer_business_id`; `conversation` → the thread's party that is **not** `reporter_business_id`; `user` → null.
- `counts.ts`: `countOpenReports(conn): Promise<number>`, `countOpenSignals(conn): Promise<number>` (D5).
- `audit-labels.ts` (ported from textile): `KNOWN_AUDIT_ACTIONS: readonly string[]` (every action written in `src/`
  today — grep `action: '…'` and the template literals `listing.${…}`, `review.${…}`, `user.${…}` expanded — plus D15's);
  `AUDIT_LABELS: Record<string, string>`; `auditLabel(action): string` (the code for an unknown one);
  `auditHref(entityType, entityId): string | null` (listing, business, deal, rental_booking, part_request, admin_user,
  category / brand / model pages that exist in the admin).
- `lib/group-limit.ts`: `AdminRateGroup = 'admin_export' | 'admin_reveal'`; `adminRateLimit(group, max, windowSeconds)`
  (D7).
- Stubs: A3 `services/fraud/sightings.ts` `recordInstallSighting(conn: Db, userId: string, installIdHeader: unknown):
  Promise<void>`; `services/fraud/job.ts` `runFraudSignals(app, opts?)` (D9) → `'skipped'`;
  `services/fraud/retention.ts` `runAdminRetention(app: TxApp): Promise<void>`; `services/fraud/admin.service.ts`
  `openSignalsForBusiness(conn, businessId): Promise<FraudSignalRow[]>` → `[]`.
- Jobs: `{ name: 'fraud-signals', everyMs: 600_000, run }`, `{ name: 'admin-retention', everyMs: 86_400_000,
  firstRunMs: 900_000, run }`.
- Route stubs with final guards: §6.3 (`requireAdmin`), §11.2 (super_admin via `requireAdminRole()`; inspect / set
  public with `rateLimit { max: 10, timeWindow: '1 minute' }`; change / sign-out-everywhere `requireAdmin`), §8.3
  (`moderator`, `support`), `GET /admin/exports/:sheet` (`requireAdmin` + a real check of `EXPORT_SHEET_ROLES` →
  `403 FORBIDDEN`, unknown sheet `400`), `GET /admin/reports/count` (`moderator`, `support`), `POST
  /businesses/:id/reports` (`requireUser`); export and reveal routes carry `adminRateLimit` (D7).

- [ ] **Step 1: Failing tests.** `ac-seams.test.ts`: `runCsvExport` with `cap: 2` and 3 rows → `400 EXPORT_TOO_LARGE`,
  `details.total === 3`, no `export.create` row; with 2 rows → body starts with one BOM, a cell `=1+1` comes out
  `'=1+1`, the audit row has `{ filters, rowCount: 2, includeContacts: false }` and no cell value; with `filters: { search:
  '98765 43210' }` the audit row holds neither the planted digits nor their Devanagari form; `istMinute('2026-11-20T18:31:00Z')` → `'2026-11-21 00:01'`; `reportAgainstSql` resolves one report per
  target to the expected business, and a conversation report filed **by** business X resolves to the other party, never
  X.
  `ac-routes-rbac.test.ts`: for every new admin route — no token → 401; a role outside its list → 403; an allowed role
  and super_admin → neither 401 nor 403; a stale-`tv` token → 401 `ADMIN_SESSION_ENDED`; inspect / set without a token
  → not 401; sign-out-everywhere and password change each use a fresh admin (they end the caller's token); each export sheet's roles per `EXPORT_SHEET_ROLES`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `pnpm --filter @mpm/api typecheck`; `account-status.test.ts` and
  `f6-routes.test.ts` (OTP sign-in, devices) still pass. **Step 5: Stage.**

### C0-5: Admin contracts

**Files (`apps/admin`):** Modify `lib/nav.ts` (+ `nav.test.ts` pins), `lib/nav-badges.ts`; Create `lib/reports-api.ts`
(`fetchReportsOpenCount(): Promise<number>` = `reports + signals` from `GET /admin/reports/count`).

**Rules (§13, R5, R7):** Insights & growth loses "Activity & KPIs"; System = **Settings** (`/settings`, `roles: []`),
**Admin users** (`/admin-users`, `UserCog`, `roles: []`), **Audit log** (`roles: []`); Reports & flags gets `badgeKey:
'reportsOpen'`; `NavBadgeKey` + `reportsOpen` with its fetcher.

- [ ] **Step 1: Failing test** (`nav.test.ts`): `/analytics` has no item; `canSee(adminUsers, 'support') === false`,
  `canSee(adminUsers, 'super_admin') === true`; Reports & flags has `badgeKey 'reportsOpen'`. **Step 2:** FAIL.
  **Step 3:** Implement. **Step 4:** PASS; admin typecheck, lint, style audit. **Step 5: Stage.**

**C0 exit:** `pnpm typecheck`, `pnpm lint`; the C0 test files plus the suites named in C0-3 / C0-4 Step 4 (one at a
time, not the full suite); `pnpm --filter admin test`; `countCloseOutRows` on `mpm_test` all 0; the controller commits
C0 and pushes.

---

# Wave A — API lanes (A1, A2, A3, A4)

## Lane A1 — Dashboard (AD1)

### A1-1: Period, scope and definitions

**Follows:** textile `services/admin-insights/dashboard.ts` (period pairs, `to_char` IST buckets).

**Files:** Create `services/admin-insights/{period,dashboard-scope,dashboard}.ts`; Test
`apps/api/__tests__/admin-dashboard.test.ts`.

**Interfaces:** `resolveDashboardPeriod(q: AdminDashboardQuery, today: string): { from: string; to: string; prevFrom:
string; prevTo: string; days: number; granularity: 'day' | 'week' }` (7d = today − 6 … today; custom: both dates, `from
≤ to ≤ today`, ≤ 366 days, else `400 DASHBOARD_RANGE_INVALID`; granularity `day` when `days ≤ 31`);
`dashboardScope(q): { listing(alias): SQL; request(alias): SQL; business(alias): SQL }` (R2: city
case-insensitive, `industrial_area_id`, category = root path match `c.path = root.path OR c.path LIKE root.path || '/%'`
for listings and requests, `businesses.categories ? categoryId` for businesses); `snapshotMetrics(conn, q)` and
`periodMetrics(conn, q, period)` — one SQL builder per metric of §6.2, each run for the period and the previous period
with the same builder.

- [ ] **Step 1: Failing tests** (all with a run-unique city; the IST edges are computed from `istToday()`): a deal
  `accepted_at` at `from` 00:01 IST counts in the 7-day value and one at `from − 1` 23:59 IST counts in `previous`; a
  `cancelled` deal counts in `deals` but not in `dealValuePaise`; a deal on a listing in the run's city by a buyer from
  elsewhere counts, and a deal by a buyer from the run's city on a listing elsewhere doesn't; `newBusinesses` counts a
  business in the run's city with a trade name and not one without; category filter: a listing in a part group under the
  root counts, one under another root doesn't; a business counts for a category only when `categories` holds it;
  `replyRate24h`: a thread created 25 h ago answered at 23 h counts answered, at 25 h unanswered, a thread created 2 h ago
  is left out; `firstReplyMedianHours` of 1 h, 3 h, 5 h replies → 3; `requirementMatchRate` 1 of 2 (one with a delivered
  reply) → 0.5; `fulfilmentMedianHours` 10 h and 30 h → 20; `soldListings` counts a listing with two `sold` history rows
  once; `machinesOutToday` = Σ machines of an `on_rent` booking past its end date (2) and a `disputed` from `on_rent`
  one (1) = 3, not a `rented` listing with no booking, nor a `confirmed` booking starting tomorrow; `partsAvailable`
  leaves out a `live` part with `held_quantity = quantity`; custom range of 367 days → 400 `DASHBOARD_RANGE_INVALID`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A1-2: Trend, breakdown, cache, work counts, options, routes

**Files:** Create `services/admin-insights/{dashboard-trend,work,options}.ts`; Modify `services/admin-insights/
dashboard.ts` (`getAdminDashboard`), `routes/admin/dashboard.ts`; Test `apps/api/__tests__/admin-dashboard-trend.test.ts`.

**Interfaces:** `getAdminDashboard(deps: { db: Db; redis?: Redis }, q: AdminDashboardQuery, opts?: { today?: string }):
Promise<AdminDashboard>` (Redis key `<prefix>dashboard:<today>:<sha1 of the normalised query>`, TTL 60 s; no Redis → no
cache); `dashboardTrend(conn, q, period)` (buckets `YYYY-MM-DD`, a week labelled by its Monday, every bucket present even
when zero); `dashboardBreakdown(conn, q, period, by)` (top 10 by active listings; `label` = city / area name / category
name); `workCounts(conn, role: AdminRole): Promise<AdminWorkCounts>` (keys by nav rules: listings → moderator;
verification → verification_officer; disputes → support; reports / signals → moderator, support; super_admin all; uses
`countOpenReports` / `countOpenSignals`); `dashboardOptions(conn): Promise<DashboardOptions>`.

- [ ] **Step 1: Failing tests:** for the run's city over 7 days, Σ trend `enquiries` / `deals` / `dealValuePaise` /
  `rentalBookings` equal the tiles' values; a 32-day custom range gives weekly buckets starting on Mondays and a 31-day
  one daily buckets; with `breakdown=industrial_area` the run's area row's `deals` equals the tile for that area filter;
  a second call within 60 s returns the same `generatedAt`, a different filter a fresh one; `GET /admin/dashboard/work`
  for `category_manager` returns `{}`, for `moderator` exactly the keys `listingsToReview`, `listingsReported`,
  `reportsOpen`, `signalsOpen`, for super_admin all six.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

**A1 exit:** lane tests and typecheck green; review (focus: one definition per metric, IST and Monday buckets, filters
applied to every number); controller commits on `lane/ac-a1`.

## Lane A2 — Admin users, passwords, audit log (AD7)

### A2-1: Admin users and the guards

**Files:** Create `services/admin-users/{admin-users.service,password-links}.ts` (`password-links.ts` with
`createPasswordLink` only; A2-2 adds the rest); Modify `routes/admin/admin-users.ts`; Test
`apps/api/__tests__/admin-users.test.ts`.

**Interfaces:** `listAdminUsers(conn): Promise<AdminUserRow[]>`; `inviteAdmin(app, actor, { name, email, role }):
Promise<AdminUserCreateResult>` (`409 ADMIN_EMAIL_TAKEN`); `updateAdmin(app, actor, id, { name?, role? })` (role change
→ `endAdminSessions`); `deactivateAdmin(app, actor, id, { reason })` (sets `deactivated_at`, `deactivated_by_admin_id`,
`endAdminSessions`) / `reactivateAdmin(app, actor, id, { reason })`; `issuePasswordLink(app, actor, id):
Promise<AdminPasswordLink>` (D11; reset clears `password_hash`; always `endAdminSessions`); `signOutAdmin(app, actor,
id)`. Each runs in `runTx` with `pg_advisory_xact_lock(hashtext('admin_users'))` first, self actions (role, deactivate,
reset, sign-out) → `409 ADMIN_SELF_ACTION`, D12's guard after the change, the D15 audit row. Links come from `createPasswordLink` (signature in A2-2).

- [ ] **Step 1: Failing tests:** invite returns a link once and the row reads `invited`; a second invite with the
  same email in another case → `409 ADMIN_EMAIL_TAKEN`; super admins A and B, `Promise.all` of A demoting B and B
  demoting A → exactly one 200 and one `409 ADMIN_LAST_SUPER_ADMIN`, and one super admin remains; the same race with
  deactivate, and with reset (password-link); self role / deactivate / reset / sign-out → `409 ADMIN_SELF_ACTION`;
  deactivating a moderator → their next request 401 `ADMIN_SESSION_ENDED`; demoting a moderator to support, a reset and
  a sign-out → the old token 401 each (version bumped); a reset of an admin who signed in before reads `reset_pending`; a password link for a
  deactivated admin → `409 ADMIN_DEACTIVATED`; every action writes its `admin_user.*` row and no audit `before` / `after`
  contains `password`, `hash` or the token; `support` gets 403 on every admin-user route.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A2-2: Password links, change password, sign out everywhere, lockout

**Files:** Create `services/admin-users/lockout.ts`; Modify `services/admin-users/password-links.ts`,
`services/admin-auth.service.ts`,
`routes/admin/auth.ts`; Test `apps/api/__tests__/admin-passwords.test.ts`.

**Interfaces:** `createPasswordLink(tx, adminId, purpose, createdBy): Promise<AdminPasswordLink>` (32 random bytes
base64url; stores SHA-256 hex; `expires_at = now() + 48 h`; other unused tokens of the admin get `used_at = now()`);
`inspectPasswordLink(conn, token): Promise<PasswordLinkInfo>`; `setPasswordFromLink(app, { token, password }):
Promise<{ email }>` (token row `FOR UPDATE`, unused, unexpired, admin active, else `400 PASSWORD_LINK_INVALID`;
`adminPasswordProblem` → `400 PASSWORD_TOO_WEAK`; bcrypt 12; `password_set_at`; `used_at`; `endAdminSessions`; audit
`admin_user.password_set` by that admin); `changePassword(app, admin, { current, password }): Promise<{ token: string;
user: AdminUser }>` (`400 PASSWORD_WRONG` / `PASSWORD_TOO_WEAK`; bump; fresh token; audit `admin_user.password_change`);
`signOutEverywhere(app, admin)`; `checkLoginLockout(redis, email)` / `recordLoginFailure` / `clearLoginFailures` (D14),
called from `loginAdmin`.

- [ ] **Step 1: Failing tests:** a link sets the password once, a second use → `400 PASSWORD_LINK_INVALID`; an expired
  link (`expires_at` moved back) → 400; issuing a second link makes the first invalid; the raw token appears in no
  `admin_password_tokens` column and no `audit_log` row (`::text LIKE '%<token>%'` is false); `'short'` → `400
  PASSWORD_TOO_WEAK`, the email as password → 400; after set, the old token 401 and login works; change password with a
  wrong current → `400 PASSWORD_WRONG`, with the right one → a new token that works while the old one gets 401;
  sign-out-everywhere ends the caller's token; 5 wrong passwords for one email → the 6th attempt with the right password
  → `429 TOO_MANY_ATTEMPTS`; 5 attempts at an unknown email → 429 too; a success after 4 failures resets the count; inspect and set on a link of an admin deactivated after it was issued →
  `400 PASSWORD_LINK_INVALID`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A2-3: Audit log viewer, reveal, export

**Follows:** textile `services/admin-insights/audit-log.ts` (`BASE` query, `listAuditLog`, `revealAuditEntry`).

**Files:** Create `services/admin-insights/{audit-log,audit-mask}.ts`; Modify `routes/admin/audit-log.ts`; Test
`apps/api/__tests__/admin-audit-log.test.ts`.

**Interfaces:** `listAuditLog(conn, q: { from?; to?; adminId?; actor?: 'system'; action?; entityType?; entityId?; q?;
page; pageSize }): Promise<AuditLogPage>` (dates are IST days; `action` exact, or a prefix when it ends in `.`; `q`
matches the entity label or id; newest first by `(created_at, id)`); `auditFacets(conn)`; `getAuditEntry(conn, id):
Promise<AuditLogDetail>` (masked); `revealAuditEntry(app, adminId, id)` (unmasked + `audit.reveal` row);
`maskSnapshot(v: unknown): unknown` (strings through `maskContact`; a key masked whole (`'•••'`, recursive) when it is
`phone` / `email` / `pan` / `address`, ends in `Phone` / `Email` / `Pan` / `Address`, or starts with one of the four
followed by a capital (`/^(phone|email|pan|address)$|(Phone|Email|Pan|Address)$|^(phone|email|pan|address)[A-Z]/`), so
`company` and `expand` stay); `changedKeys(before, after):
string[]`; the export through `runCsvExport` (columns time IST, admin, action, label, entity type, entity id, entity
label, href).

- [ ] **Step 1: Failing tests:** an entry whose `after` has `{ note: 'call ९८७६५४३२१०', ownerPan: 'ABCDE1234F',
  address: { line1: '12 Ring Road' } }` reads masked (the planted digits absent in both scripts, `ownerPan` and `address`
  are `'•••'`, a `company` key and an `expand` key unmasked) with `masked: true`; reveal returns them as stored and writes `audit.reveal` with `after: { action }` and no values; the 31st
  reveal in an hour → 429; `changedKeys({ a: 1, b: 2 }, { a: 1, b: 3,
  c: 4 })` → `['b','c']`; the export's header has no before / after column and its rows hold no snapshot value; the
  export over 10 001 generated rows of a test admin → `400 EXPORT_TOO_LARGE` with `details.total 10001` (D10); a
  `moderator` gets 403 on every audit route.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

**A2 exit:** lane tests and typecheck green; review (focus: guards under the lock, no token / hash in rows or logs,
masking recursion); controller commits on `lane/ac-a2`.

## Lane A3 — Fraud signals (AD6)

### A3-1: Detectors and hashing

**Files:** Modify `lib/mask-contact.ts` (+ `mask-contact.test.ts`), `services/chat/scam-patterns.ts` (+
`scam-patterns.test.ts`); Create `services/fraud/hash.ts`; Test `apps/api/__tests__/fraud-hash.test.ts`.

**Interfaces:** `findPhones(text: string): string[]` (the same `PHONE` regex; each match → ASCII digits, `+91` / `91` /
`0` prefix stripped, last 10 digits; deduped); `phoneKey(e164OrDigits: string): string | null` (last 10 ASCII digits);
`paymentDetailKinds(text: string): PaymentMatchKind[]` (the `looksLikeScam` parts split by kind + `bank_details`: an IFSC
`/\b[A-Z]{4}0[A-Z0-9]{6}\b/` or an account-number phrase (`a/c`, `account no`, `acct`, `खाता`, `ખાતા`) followed within
20 characters by 9–18 digits); `looksLikeScam` unchanged. `hash.ts`: `signalHashKey(): string | null` (`SIGNAL_HASH_KEY`
≥ 32 characters, else null, logged once); `hmacPhone(digits10: string, key: string): string` (hex);
`installHash(installId: string): string` (SHA-256 hex of the lowercased UUID); `groupIdOf(hex: string): string` (first
8).

- [ ] **Step 1: Failing tests:** `findPhones('call +91 98765 43210 or ९८७६५४३२१०')` → `['9876543210']` (both the
  same); `findPhones('part 6205-2RS, GSTIN 24AAACC0000C1ZY')` → `[]`; `paymentDetailKinds('IFSC HDFC0001234')` →
  `['bank_details']`; `'A/c no 123456789012'` → `['bank_details']`; `'account number 12345678'` → `[]`;
  `'pay to shop@okaxis'` → `['upi_handle']`; `'advance bhejo'` → `['advance_ask']`; `looksLikeScam('IFSC
  HDFC0001234') === false` (warning unchanged); `hmacPhone` of a spaced and a Devanagari-digit form of one number are
  equal and differ under another key.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A3-2: Sightings and the scan

**Files:** Modify `services/fraud/sightings.ts`; Create `services/fraud/scan.ts`; Test
`apps/api/__tests__/fraud-scan.test.ts`.

**Interfaces:** `recordInstallSighting` (D3; a non-UUID or missing header writes nothing; upsert `(install_hash,
user_id)` bumping `last_seen_at`); `scanChatMessages(app: TxApp, opts: { key: string | null; limit?: number /* 5000 */
}): Promise<{ scanned: number; touched: Set<string> /* sender business ids */; mark: { lastSeq: number } | null }>` —
reads `seq > last_seq ORDER BY seq LIMIT n` (first run: `last_seq` = the highest `seq` older than 30 days, else 0) and
**takes only the unbroken run below the first row whose `created_at > now() − interval '2 minutes'`** (stops there,
never jumps past it); only `sender_side` set with text; inserts contact sightings for `findPhones` hits that are not the
sender business's `contact_phone` or any member's `users.phone` (`ON CONFLICT (message_id, phone_hmac) DO NOTHING`);
adds a sender to `touched` for a sighting or a `paymentDetailKinds` hit; returns the highest `seq` taken as `mark` and
**does not advance** (D9); no key → no sightings, payment senders still touched. `scanSince(conn, rule:
'install_sightings' | 'new_account_burst' | 'reports_against'): Promise<{ from: Date; rows; mark: Date | null }>`
(`created_at` / `last_seen_at > last_at AND ≤ now() − 2 min`, first run 30 days back; `mark` = the **max timestamp
actually taken**, null when nothing was) and `advanceScan(tx, rule, mark)` (writes `last_seq` / `last_at`; called by the
job after evaluation).

- [ ] **Step 1: Failing tests:** two batches with `limit: 3` over 5 messages (advancing between them) → each message
  scanned once, none skipped; a lower-`seq` row still inside the margin with a higher-`seq` row older than the margin →
  neither is taken (the higher one isn't taken past it), and after the lower row ages past the margin the next run
  takes both, once; a `last_at` scan whose newest row is 10 minutes old marks that row's timestamp, not the window end;
  re-scanning the same window (no advance) inserts no second sighting; with no `fraud_scan_state` row a 31-day-old
  message is ignored; the sender's login phone, its business's contact phone and another member's login phone create no
  `contact_sightings` row; a planted `9876543210` (sent in ASCII and in Devanagari digits) appears in no
  `contact_sightings` column in either form; without `SIGNAL_HASH_KEY` no sighting is written and a UPI sender is still
  touched; `X-Install-Id: not-a-uuid` on OTP sign-in writes no `install_sightings` row, a UUID writes one.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A3-3: Rules, signals, the job, retention

**Follows:** textile `services/trust/flags.service.ts` (`raiseOrAppendFlag`, evidence key, append without duplicates).

**Files:** Create `services/fraud/{rules,signals}.ts`; Modify `services/fraud/{job,retention}.ts`; Test
`apps/api/__tests__/fraud-rules.test.ts`, `fraud-job.test.ts`.

**Interfaces:** `raiseOrAppend(tx, businessId, kind, items: FraudEvidence[]): Promise<{ signalId: string; added:
number } | null>` (`INSERT … ON CONFLICT (business_id, kind) WHERE status = 'open' DO UPDATE`: append items whose `key`
is new, keep the newest 50, `evidence_count += added`, `last_seen_at`); `closedCutoff(conn, businessId, kind):
Promise<Date | null>` (latest `reviewed_at`); one evaluator per kind, each `(app, businessIds: string[], settings,
key?) => Promise<void>` running one short transaction per business and kind, counting only evidence after
`closedCutoff`: `evaluateSharedDevice` (distinct businesses per install hash ≥ `fraud_device_accounts`),
`evaluateRepeatedPhone` (≥ `fraud_phone_businesses` businesses per HMAC, or one business in ≥ `fraud_phone_threads`
threads), `evaluatePaymentDetails` (re-reads the business's own user messages in the window after its `closedCutoff`
and runs `paymentDetailKinds` on them; ≥ `fraud_payment_messages` matching; no in-memory map, no new table), `evaluateNewAccountBurst` (business created ≤
`fraud_new_account_days` ago; threads it started as buyer plus replies to requests, distinct counterpart businesses in
any 24 h window ≥ `fraud_burst_contacts`), `evaluateReportsAgainst` (`reportAgainstSql`, statuses open / reviewing /
actioned, distinct reporter businesses ≥ `fraud_reports_against`); evidence per §8.1 with D16 keys, summaries built from
counts only. `runFraudSignals` (D9): lock → scans (A3-2) → evaluators for the touched businesses → when every evaluation
succeeded, one transaction `advanceScan` for each rule's `mark`; a failing business is logged and the run returns
without advancing. `runAdminRetention`: §9's deletes in batches of 1 000 (`FOR UPDATE SKIP LOCKED`).

- [ ] **Step 1: Failing tests** (`fraud-rules.test.ts`, default settings): 3 businesses on one install → a
  `shared_device` signal on each; 2 → none; 2 members of business A + 1 of B → none; one number from 2 businesses → a
  `repeated_phone` signal on each; one business, 9 threads → none, 10 → one; 2 payment messages → `payment_details`
  with `matchKind`s, 1 → none; a 3-day-old business contacting 8 businesses within 24 h → `new_account_burst`, 7 →
  none, an 8-day-old one with 8 → none; 3 reports from distinct businesses → `reports_against`, 2 + 1 `dismissed` →
  none, a conversation report filed by the business itself → doesn't count; re-running an evaluator appends nothing;
  after a dismiss one new piece of evidence raises nothing and a full threshold of new evidence opens a new signal;
  evidence capped at 50 with `evidence_count` 55; no `fraud_signals` text holds the planted number (ASCII or Devanagari)
  or a message's words.
  (`fraud-job.test.ts`): `runFraudSignals({ wait: true })` over a scripted chat raises the expected signals once and a
  second run adds nothing; an evaluator made to throw once → no watermark moved, and the next run reads the same window
  and raises the signal once with no duplicate sighting; with the lock held by another connection `runFraudSignals()` → `'skipped'`; without
  `SIGNAL_HASH_KEY` no `repeated_phone` and the other kinds still raise; retention deletes a 91-day sighting, a signal
  dismissed 366 days ago and a token used 8 days ago, and keeps their younger twins.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A3-4: Signals admin API and the reader gate

**Files:** Modify `services/fraud/admin.service.ts`, `routes/admin/fraud-signals.ts`,
`services/chat/admin-read.service.ts`; Test `apps/api/__tests__/fraud-admin.test.ts`.

**Interfaces:** `listFraudSignals(conn, q: { status?; kind?; businessId?; page; pageSize }): Promise<FraudSignalPage>`
(default `open`, `last_seen_at DESC`); `getFraudSignal(conn, id): Promise<FraudSignalDetail>` (refs resolved to names);
`reviewFraudSignal(app, admin, id, { outcome: 'dismissed' | 'actioned'; note })` (`FOR NO KEY UPDATE`; not open → `409
FRAUD_SIGNAL_NOT_OPEN`; note via `adminText`; audit `fraud_signal.review` with before / after status);
`openSignalsForBusiness` (real). Reader gate (R11): when no report / dispute allows the read, an `open` signal whose
evidence has `refs.threadId = :id` allows it for `moderator` / `support`; the `thread.read` row's `after` gains
`signalId`.

- [ ] **Step 1: Failing tests:** review → `dismissed` with `reviewed_at`, audit row,
  a second review → 409; an `operations` admin → 403; the conversation reader allowed from an open signal citing the
  thread (`thread.read` names `signalId`), refused `403 ADMIN_READ_NOT_ALLOWED` once the signal is dismissed.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `admin-conversations.test.ts` still passes. **Step 5:
  Stage.**

**A3 exit:** lane tests and typecheck green; review (focus: watermark and margin, quiet reading, no raw identifiers, the
lock); controller commits on `lane/ac-a3`.

## Lane A4 — Business reports, Reports queue, exports (AD6)

### A4-1: Report a business and the queue

**Follows:** textile `services/reports/business-report.service.ts`; ours `listing-reports.service.ts`.

**Files:** Create `services/reports/business-report.service.ts`; Modify `services/reports/admin-reports.service.ts`,
`routes/businesses.ts`, `routes/admin/reports.ts`; Test `apps/api/__tests__/business-reports.test.ts`,
`admin-reports-ac.test.ts`.

**Interfaces:** `reportBusiness(tx, user, businessId, input: BusinessReportRequest): Promise<{ reportId: string }>`
(onboarded reporter else `409 ONBOARDING_INCOMPLETE`; viewers allowed; target onboarded else `404
BUSINESS_NOT_FOUND`; own → `400 CANNOT_REPORT_SELF`; D8 limit and lock; one open → `409 REPORT_EXISTS`; no notification,
no emit to the reported side); admin queue: `ADMIN_REPORT_TARGETS` from shared types; business rows (business, reporter,
reason, details as stored, status) and listing rows (ref, title, seller) in `listAdminReports`; `resolveAdminReport` on a
listing report → `409 REPORT_RESOLVE_ELSEWHERE`; `adminReportCounts(conn): Promise<AdminReportCounts>` (in
`admin-reports.service.ts`, from C0's `countOpenReports` / `countOpenSignals`).

- [ ] **Step 1: Failing tests:** report → `200 { data: { reportId } }`, the row `target_type 'business'`; own business →
  `400 CANNOT_REPORT_SELF`; second open → `409 REPORT_EXISTS`; the 11th report in 24 h across listings and businesses →
  `429 REPORT_LIMIT`; a `viewer` member → allowed; reason `other` without details → 400; an unknown or not onboarded
  business → `404 BUSINESS_NOT_FOUND`; a block between the two doesn't stop it; no notification row for the reported
  business's users. Queue: `GET /admin/reports?target=business` shows it, resolve `actioned` writes `report.resolve`;
  `target=listing` lists a listing report and resolving it → `409 REPORT_RESOLVE_ELSEWHERE`; `GET /admin/reports/count`
  counts the open business and listing reports and an open signal.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `admin-conversations.test.ts`, `admin-part-requests.test.ts`
  and `listing-reports.test.ts` still pass. **Step 5: Stage.**

### A4-2: Business detail: Reports (n) and Fraud signals (n)

**Files:** Modify `services/admin/business-admin.service.ts` (`getBusinessDetail`); Test
`apps/api/__tests__/admin-business-signals.test.ts`.

**Rules (§7.3):** `reports.open` and `byTarget` = reports with status `open` / `reviewing` where `reportAgainstSql` is
the business; `fraudSignals` = `openSignalsForBusiness`.

- [ ] **Step 1: Failing test:** a business with one open report on itself, one on its listing, one `reviewing` on its
  review, one conversation report filed by the other party and one filed by the business itself → `open 4`, `byTarget`
  `{ business: 1, listing: 1, review: 1, conversation: 1 }`; a dismissed report not counted. **Step 2:** FAIL. **Step
  3:** Implement. **Step 4:** PASS; `admin-businesses.test.ts` still passes. **Step 5: Stage.**

### A4-3: Exports

**Files:** Create `routes/admin/list-filters.ts` (the five list query schemas moved here, minus `page` / `pageSize`,
plus a `paged()` extender the list routes use), `services/exports/{businesses,listings,deals,rental-bookings,
part-requests}.ts`; Modify the five admin list routes (import the moved schemas), the five list services (export their
`WHERE` builder: `businessListWhere(q)`, `adminListingWhere(f)`, `adminDealWhere(q)`, `adminRentalWhere(q)`,
`adminPartRequestWhere(f)`, each returning the `FROM … WHERE` fragment the list already used; no behaviour change),
`routes/admin/exports.ts`; Test `apps/api/__tests__/admin-exports.test.ts`.

**Interfaces:** one `exportSheet(sheet, filters, role)` per file returning the `runCsvExport` spec (header + keyset
`page` over `(created_at, id) <` newest first + `count`), columns exactly §10 (money `rupees`, times `istMinute`, enums by
admin label, part request names through `maskContact`); businesses add owner phone and email only when the admin is
super_admin **and** `includeContacts=1` (else `includeContacts` is ignored and recorded false).

- [ ] **Step 1: Failing tests:** each sheet filtered to the run's rows → the CSV's ids equal the list route's ids for
  the same filters; `support` exporting listings → 200, `operations` → 403; businesses with `includeContacts=1` as
  `support` → no phone / email columns and the audit row says `includeContacts: false`, as super_admin → both columns;
  a planted owner phone appears in no businesses CSV for a non-super admin (ASCII or Devanagari); a trade name `=HYPERLINK("x")` comes out prefixed
  `'`; no sheet's header names notes, messages, address, PAN or budget; each export writes one `export.create` row with
  its filters and row count; the 11th export in 10 minutes → 429.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; the five admin list suites (`admin-businesses`,
  `admin-listings`, `admin-deals`, `rental-admin`, `admin-part-requests`) still pass. **Step 5: Stage.**

**A4 exit:** lane tests and typecheck green; review (focus: export = list, contacts rule, the reported side never told);
controller commits on `lane/ac-a4`.

## Wave A merge (controller)

- [ ] Merge `lane/ac-a3`, `a4`, `a2`, `a1` one at a time; `grep -rn "AC-STUB" apps/api/src` is empty;
  `pnpm --filter @mpm/api typecheck`; **the full API suite (run 1 of 2)**; `countCloseOutRows` on `mpm_test` all 0; fix
  wave on `develop`; commit; push. Lane cleanup.

---

# Wave B — Admin and app lanes (B1, B2, B3, B4)

## Lane B1 — Dashboard page

### B1-1: `StatCard` delta and dashboard client

**Files:** Modify `apps/admin/components/stat-card.tsx`; Create `components/stat-card.test.tsx`,
`lib/dashboard-format.ts`, `lib/dashboard-api.ts`.

**Interfaces:** `StatCard` gains `delta?: { text: string; tone: 'up' | 'down' | 'flat' }` (green up, red down, grey
flat); `periodDelta(v: PeriodCount | PeriodRate, kind: 'count' | 'rate'): { text: string; tone } | null` (count: whole
% with sign, `−` minus; rate: points with one decimal at most, `' pts'`; null only for a null previous: a count from previous 0 reads
`'+n'` (the absolute rise, `up`) or `'0%'` (`flat`) when both are 0); `formatLakhCrore
(paise)`; `fetchDashboard(q)`, `fetchWorkCounts()`, `fetchDashboardOptions()`, `dashboardQueryString(q)`.

- [ ] **Step 1: Failing test** (`stat-card.test.tsx`, the spec's): `periodDelta({ value: 112, previous: 100 },
  'count')` → `{ text: '+12%', tone: 'up' }`; `{ value: 0.47, previous: 0.5 }` rate → `'−3 pts'`, `down`; `{ value: 4,
  previous: 0 }` count → `'+4'`, `up`; previous null → null; `StatCard` with a `down` delta renders the red text class. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:**
  PASS; style audit. **Step 5: Stage.**

### B1-2: Dashboard page and the Analytics redirect

**Files:** Modify `app/(dashboard)/page.tsx`, `app/(dashboard)/analytics/page.tsx` (server component `redirect('/')`);
Create `components/dashboard/{dashboard-filters,work-row,kpi-grid,trend-charts,breakdown-table}.tsx`.

**Rules (§6.1):** sections in §6.1's order; filters and breakdown switch in the URL; Today's work links per key
(`/moderation`, `/moderation?tab=reported`, `/verification`, `/disputes`, `/reports`, `/reports?tab=signals`), row hidden
when `{}`; Right now and In the period tiles with sublines per §6.1 and `generatedAt` ("Updated hh:mm"); three Recharts
charts with `lib/palette.ts` values, ₹ axis in lakh / crore; breakdown row click sets that filter; skeleton, empty ("No
activity in this period"), error with retry.

- [ ] **Step 1:** none (wiring). **Step 3:** Implement. **Step 4:** typecheck, lint, style audit. **Step 5: Stage.**

**B1 exit:** `pnpm --filter admin test`, lint, typecheck; review; controller commits on `lane/ac-b1`.

## Lane B2 — Admin users, passwords, audit log, settings

### B2-1: Admin users, set password, change password, session end

**Files:** Create `app/(dashboard)/admin-users/page.tsx`, `components/admin-users/{admin-users-table,invite-dialog,
link-panel,row-menu,role-dialog,deactivate-dialog}.tsx`, `components/admin-users/row-menu.test.tsx`,
`lib/admin-users-api.ts`, `app/set-password/page.tsx`, `components/account/change-password-dialog.tsx`; Modify
`components/layout/sidebar.tsx` (D18), `lib/auth-context.tsx` (`replaceToken(token, user)`; `tokenVersion(token)` reads
the JWT's `tv`), `lib/socket.ts` (`admin:session_ended { tv }` → when `tv` > the stored token's `tv`: toast "You were
signed out" → `logout()`; while this tab's own password change is in flight the event waits for the response, which
stores the fresh token **before** the socket reconnects), `lib/api.ts` (a 401 on a request sent with a token that has
since been replaced is retried once with the stored token, then bounces as today), `app/login/page.tsx` (`TOO_MANY_ATTEMPTS` line
"Too many attempts. Try again in 15 minutes.").

**Rules (§13):** table name, email, role, status pill (`lib/status.ts`), last sign-in, created; Invite (name, email,
role) → link panel shown once, built per D13, "Send this link yourself; it works once, for 48 hours", Copy link; row
menu Change role, Rename, Reset password (danger confirm → link panel), Sign out everywhere, Deactivate (reason, danger)
/ Reactivate — self actions hidden; Set password page reads `#t=`, inspects, shows name and email, two password fields
with `adminPasswordProblem`, then "Sign in" to `/login`; Change password dialog replaces the stored token.

- [ ] **Step 1: Failing test** (`row-menu.test.tsx`, the spec's): the row of the signed-in admin shows no Change role,
  Reset password, Deactivate or Sign out everywhere item; another admin's row shows them, and Reactivate only when
  deactivated. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; lint; style audit. **Step 5: Stage.**

### B2-2: Audit log pages

**Files:** Modify `app/(dashboard)/audit-log/page.tsx`; Create `app/(dashboard)/audit-log/[id]/page.tsx`,
`components/audit-log/{audit-filters,audit-table,audit-detail,snapshot-diff}.tsx`,
`components/audit-log/snapshot-diff.test.tsx`, `lib/audit-log-api.ts`.

**Rules (§13):** filters in the URL (IST date range, admin or System, action, target type, target id / label search),
server-paged 25 / 50 / 100, time IST, who, what (label), target with link; detail before / after side by side, changed
keys highlighted, "Show hidden values" (confirm) → unmasked + notice "Shown values are logged"; Export CSV (an
`EXPORT_TOO_LARGE` error shows its count in a toast).

- [ ] **Step 1: Failing test** (`snapshot-diff.test.tsx`, the spec's): with `changedKeys: ['b']` the `b` rows carry the
  highlight class and `a` doesn't. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; lint; style audit. **Step
  5: Stage.**

### B2-3: Settings section

**Files:** Modify `app/(dashboard)/settings/page.tsx` (the "Admin accounts and roles" panel becomes a link to Admin
users), `components/settings/marketplace-settings-form.tsx` (section "Fraud signals" for `fraud_*` keys, excluded from
"Listings"; the R17 note "New accounts (unverified)" naming the five unverified limits).

- [ ] **Step 1:** none; `marketplace-settings-form.test.tsx` still passes. **Step 3:** Implement. **Step 4:** typecheck,
  lint, style audit. **Step 5: Stage.**

**B2 exit:** `pnpm --filter admin test`, lint, typecheck; review (focus: self actions hidden, the link shown once and
never logged to the console, token replaced on change); controller commits on `lane/ac-b2`.

## Lane B3 — Reports & flags, business detail, exports

### B3-1: Reports & flags tabs and fraud signals

**Files:** Modify `app/(dashboard)/reports/page.tsx` (tabs Fraud signals, Businesses, Listings, Conversations, Reviews,
Part requests; `?tab=` values `signals`, `businesses`, `listings`, `conversations`, `reviews`, `part_requests`; default
`signals`), `components/conversations/{report-resolve-dialog.tsx,use-admin-reports.ts}` (`target: 'business'`),
`lib/reports-api.ts`; Create `components/fraud/{signals-table,signal-drawer,signal-review-dialog}.tsx`,
`components/reports/{business-reports-table,listing-reports-table}.tsx`, `lib/fraud-api.ts`.

**Rules (§8.3, §13, R7):** signals table (business, kind label, evidence count "12 pieces, 50 shown", first / last seen,
status) with status / kind filters in the URL; drawer with evidence (summary, time, `groupId` in mono, links to
businesses, users' business pages, reports; a message ref opens the conversation reader's reason dialog); Dismiss /
Mark actioned dialogs with a note and the line "Closing spends this evidence: the next signal of this kind needs the
full threshold again."; Businesses tab with the resolve dialog; Listings tab read-only, row → `/moderation?tab=reported&id=<listingId>` review
with "Resolve in Listing moderation"; `refreshNavBadges()` after a decision.

- [ ] **Step 1:** none (wiring). **Step 3:** Implement. **Step 4:** typecheck, lint, style audit; existing
  `read-reason-dialog` and conversations tests still pass. **Step 5: Stage.**

### B3-2: Business detail panels and export buttons

**Files:** Modify `components/businesses/business-detail.tsx` (+ its test's fixture), the five list pages; Create
`components/export-button.tsx` + `components/export-button.test.tsx`, `lib/exports-api.ts` (`exportPath(sheet,
params)`, `downloadExport(sheet, params, includeContacts)` via `api.download`).

**Rules (§7.3, §10):** "Reports (n)" with per-target counts linking to the filtered tabs; "Fraud signals (n)" listing
open signals with links; `ExportButton { sheet; params }` visible only to roles in `EXPORT_SHEET_ROLES` (super_admin
always), a small dialog with the line "The file is yours to keep safe once downloaded." and, on businesses for a super
admin, "Include phone and email"; `EXPORT_TOO_LARGE` → "Too many rows (n). Narrow the filters to 10,000 or fewer."

- [ ] **Step 1: Failing test** (`export-button.test.tsx`, the spec's): an `ApiError` with code `EXPORT_TOO_LARGE` and
  `details.total 12345` shows "Too many rows (12,345)…"; the contacts checkbox renders for super_admin on businesses
  only. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `business-detail.test.tsx`; lint; style audit.
  **Step 5: Stage.**

**B3 exit:** `pnpm --filter admin test`, lint, typecheck; review; controller commits on `lane/ac-b3`.

## Lane B4 — App: Report this business

### B4-1: Report sheet, entry points, copy

**Files (`apps/user-app`):** Modify `screens/listing/report-sheet.tsx` (props `target: { kind: 'listing'; id; title } |
{ kind: 'business'; id; name }`; business reasons from `BUSINESS_REPORT_REASONS`), `screens/listing/listing-view.tsx`
(`onReportBusiness` slot, D17), `screens/listing/listing.tsx` (passes it unless own listing; a guest gets the sign-in
sheet with no pending action), `screens/reviews/seller-reviews.tsx` (header more → action sheet), `lib/listing-api.ts`
(`reportBusiness(id, body)`), `hooks/use-listing.ts` (`useReportBusiness`), `lib/listing-errors.ts`
(`CANNOT_REPORT_SELF`, `BUSINESS_NOT_FOUND`, `REPORT_EXISTS` business wording, `REPORT_LIMIT`), `lib/analytics-events.ts`
(`business_reported { reason }`); Create `lib/business-report.ts` (`businessReportProblem(reason, details)` per D8,
`businessReportBody`); `locales/{en,hi,gu}/listing.json` (`businessReport.*`: title, the five reasons, details hint,
send, sent "Thanks. Our team will look into it.", errors).

- [ ] **Step 1:** none (locale parity / audit and style audit are the checks). **Step 3:** Implement. **Step 4:** app
  typecheck; `pnpm --filter user-app test` (parity, audit, style audit). **Step 5: Stage.**

**B4 exit:** review (focus: hidden on own business, guest gate, copy in three languages); controller commits on
`lane/ac-b4`.

## Wave B merge (controller)

- [ ] Merge `lane/ac-b1` … `b4` one at a time; `grep -rn "AC-STUB" apps` is empty; `pnpm typecheck`; `pnpm lint`;
  admin and app suites; allowlist merges resolved; fix wave; commit; push. Lane cleanup.

---

# Batch I — Integration and close-out (sequential, on `develop`)

### I-1: Core loop and races

**Files:** Create `apps/api/__tests__/admin-close-out-core.test.ts`.

- [ ] **Step 1: Failing tests (cases no single lane could write):** (a) a super admin invites a moderator → inspect →
  set password → login → the moderator resolves a business report → the audit log lists `admin_user.create`,
  `admin_user.password_set`, `report.resolve`; the super admin opens the `report.resolve` entry masked, reveals it,
  `audit.reveal` appears; the super admin deactivates the moderator → the moderator's next request 401 and their socket
  gets `admin:session_ended`; Today's work for that moderator's role shows `reportsOpen` and `signalsOpen`. (b) A scripted
  fraud scenario through the API: three businesses sign in by OTP with one `X-Install-Id`; two businesses post one
  number in chat; one posts two UPI messages; a 2-day-old business enquires on 8 businesses' listings; three businesses
  report a fourth → one `runFraudSignals({ wait: true })` (with `SIGNAL_HASH_KEY` set) → open signals of all five kinds;
  the reader opens a thread cited by `repeated_phone`, the signal is dismissed, the read is refused. (c) One export per
  sheet over the run's businesses → row counts equal the list totals; no CSV holds a planted phone (ASCII or Devanagari) except a
  super admin's businesses export with contacts. Races: two super admins deactivate each other with `Promise.all` → one 409; two
  `runFraudSignals()` at once → one `'skipped'`; `countCloseOutRows` all 0 after cleanup.
- [ ] **Step 2:** run; fix in the owning files on `develop`. **Step 3:** `grep -rn "AC-STUB\|NOT_IMPLEMENTED"
  apps/api/src apps/admin apps/user-app` returns only `OTP_NOT_IMPLEMENTED`. **Step 4:** PASS. **Step 5: Stage.**

### I-2: Full checks and builds

- [ ] One package at a time: `pnpm typecheck`, `pnpm lint`, **the full API suite (run 2 of 2)**
  `pnpm --filter @mpm/api test`, `pnpm --filter admin test`, `pnpm --filter user-app test`; `countCloseOutRows` on
  `mpm_test` all 0; `pnpm --filter admin build`; in `apps/user-app`: `CI=1 npx expo export --platform android` and
  `npx expo install --check`.
- [ ] Dev DB: `pnpm --filter @mpm/api db:migrate` (0018, 0019).

### I-3: Agent walk-through on the dev DB

- [ ] Snapshot row counts. Dev API with jobs on and a `SIGNAL_HASH_KEY` in the shell only: the seeded super admin
  invites an operations admin → set password through the link → sign in → dashboard, work and options answer 200 for
  7d / 30d / custom and each breakdown; change role to support → the old token 401; a user reports a business from the
  API; two test businesses chat with a shared number and a UPI handle; after one job run the signals show in `GET
  /admin/fraud-signals`; dismiss one; export each sheet (counts match the lists); audit log list / detail / reveal /
  export; admin pages by page loads (`/`, `/admin-users`, `/set-password`, `/audit-log`, `/audit-log/<id>`,
  `/reports?tab=signals`, `/settings`, `/analytics` → `/`). Delete every walk-through row and the invited admin's tokens
  (audit rows and the admin row kept: admins are never deleted); row counts match the snapshot except `audit_log` and
  `admin_users`.

### I-4: Docs

- [ ] `docs/PROJECT_STATUS.md`: What's built (admin close-out row: tables, routes, jobs, pages, the app sheet), How to
  run (0018 / 0019, `SIGNAL_HASH_KEY` optional, the seed's cost 12), Open items (§23, the device and browser passes, the
  multi-instance socket note now covering `admin:session_ended`), answered items (StatCard tone; the `gst.release` DPDP
  note in part), Suggested build order (A1 / A5 / A6 done; next M12 + M17), session log line.
- [ ] `CLAUDE.md` (Admin RBAC: role and session read from the row per request, `token_version`; fraud signals and
  exports under Architecture; `/admin/admin-users`, `/admin/audit-log`, `/admin/fraud-signals`, `/admin/exports`
  prefixes), `apps/admin/CLAUDE.md` (dashboard, admin users, set password, audit log, exports, signals, nav),
  `apps/user-app/CLAUDE.md` (business report), `.env.example` checked.
- [ ] `docs/product-scope.md` AD1 / AD6 / AD7 built notes; F6 + F7 spec §16.3, F2 spec §11, F1 + A2 spec notes per §20;
  spec and this plan marked built. Controller commits and pushes `develop` (milestone).

### I-5: Owner checklist (not for an implementer subagent)

- Admin pages in a browser: dashboard filters and charts, invite → link → set password in a private window, role change
  signing the other tab out, audit reveal, Reports & flags tabs, a signal review, each Export CSV.
- Device pass: Report this business from a listing and from seller reviews, en / hi / gu; Hindi and Gujarati of the new
  strings checked by a native speaker.
- Put a value in `SIGNAL_HASH_KEY` (dev and production) to switch the phone rule on.
- Client (§23): signal thresholds for launch, who besides super admins reads the audit log; admin two-step login before
  launch.

---

## Coverage (spec section → tasks)

| Spec | Tasks |
|---|---|
| §1–§3 Why, goals, approaches | Goal 1: A1-1, A1-2, B1 · 2: A4-1, B3-1, B4-1 · 3: A3-1–A3-4, B3-1 · 4: C0-4, A4-3, B3-2 · 5: C0-3, A2-1, A2-2, B2-1 · 6: A2-3, B2-2 · approaches A–E: A1, A3-3, C0-3, A2-2, A4-1 |
| §4 Rulings | R1 A1-2 · R2 A1-1 · R3 A1-1, A1-2 · R4 A1-2 · R5 C0-5, B1-2 · R6 A4-1, B4-1 · R7 A4-1, C0-5, B3-1 · R8 A3-3, A3-4 · R9 A3-3 · R9a A3-2 · R10 A3-1, A3-2 · R11 A3-4 · R12 C0-4, A4-3 · R13 C0-3 · R14 A2-1 (D12) · R15 A2-2 · R16 A2-3 · R17 B2-3 · R18 every Step 1 |
| §5 Data model, shared types | C0-1, C0-2 |
| §6 Dashboard | A1-1 (§6.2), A1-2 (§6.3), B1 (§6.1) |
| §7 Reports | A4-1 (§7.1, §7.2), A4-2 (§7.3), B4-1, B3-1, B3-2 |
| §8 Fraud signals | A3-1 (detectors), A3-2 (§8.2 scan), A3-3 (§8.1 rules, §8.2 job), A3-4 (§8.3), B3-1 |
| §9 Jobs | C0-4 (registration), A3-3 |
| §10 Exports | C0-4 (runner, roles), A4-3, A2-3 (audit export), B3-2 |
| §11 Admin users, sessions, audit | C0-3 (§11.1), A2-1, A2-2 (§11.2), A2-3 (§11.3), C0-4 (labels) |
| §12 Settings | C0-1, B2-3 |
| §13 Admin pages and nav | C0-5, B1, B2, B3 |
| §14 Errors | C0-1; raised in A1–A4; app copy B4-1 |
| §15 Sockets | C0-3 (`admin:session_ended`), B2-1 (client) |
| §16 Privacy | C0-3, C0-4 (Sentry), A2-2, A2-3, A3-1–A3-3, A4-3 |
| §17 Limits | C0-4 (D7), A2-2, A2-3, A4-1, A4-3, A3-2 |
| §18 Testing 1–8 | 1 C0-3, A2-1 · 2 A2-1, C0-4 · 3 A2-2 · 4 A1-1, A1-2 · 5 A3-1–A3-3 · 6 A4-3, C0-4 · 7 A2-3 · 8 A4-1, A3-4 · admin tests B1-1, B2-1, B2-2, B3-2 · app parity B4-1 |
| §19 Build order | this plan's batches (D1) |
| §20 Earlier documents and code | C0-4 (`.env.example`), I-4 |
| §21 What exists today | checked while writing this plan (D2, D4, D17, D18) |
| §22–§23 Deferred, open items | I-4, I-5 |
| §24 (my call) list | 1 A1-2 · 2 A1-1 · 3–4 A1-1 · 5 A3-1 · 6 D9 · 7–8 A3-1, A3-3 · 9–10 A4-3 · 11–13 C0-2, A2-1 · 14 A2-2 · 15–16 A2-3 · 17 A4-1 · 18 B2-3 · 19 A4-1 · 20 B4-1 · 21 C0-5, B3-1 · 22 A2-2 · 23–24 A3-2 · 25 A3-3 · 26 A3-2 · 27–28 A3-3 · 29 A1-1 · 30 A4-1, C0-1 |
