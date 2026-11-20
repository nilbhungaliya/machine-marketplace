# F8 Part Requests, Seller Targeting and Availability Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. **Contracts first, in sequence (C0), then parallel lanes** (as F6 + F7): each lane in
> its own git worktree on a local lane branch, one implementer per lane doing its tasks in order, an independent review
> per lane, then the controller merges. Steps use checkbox (`- [ ]`) syntax.

**Status:** **Built** (2026-11-20: C0, waves A and B and Batch I on `develop`; I-5 is the owner's, listed in `docs/PROJECT_STATUS.md` Open items). Push of the close-out: the controller's.

**Goal:** A signed-in business posts a structured part or machine requirement; the 15 best-fitting eligible sellers are
told, every eligible seller can answer with up to 3 real listings (or a new listing delivered when it goes live), every
listing that goes live is matched against active requests under strict rules and caps, and the buyer compares replies
and matches and continues in F6's enquiry → offer → deal flow.

**Architecture:** New tables `part_requests`, `part_request_fitments`, `part_request_targets`, `part_request_replies`,
`part_request_matches`, `part_request_feedback`, `part_request_work`, `part_request_push_counts`;
`notifications.part_request_id`. One service folder `apps/api/src/services/part-requests/`. Listing writers only insert a
`part_request_work` row; the `part-request-work` job claims rows and processes each in its own transaction (targeting,
auto matches, pending-reply delivery and drops). The shared seams (eligibility predicate, request lock + status write,
reply fit, reply drops, grouped notification rows, queue insert, photo destination, every F2 / F6 hook) are built with
real bodies in C0, so the lanes never edit each other's files. App: Post a requirement, My requirements, Requirement
(buyer / seller), Compare, Reply with my listing, Buyers looking for your parts, entry points. Admin: Part requests list +
detail, Reports tab, Settings section.

**Tech stack:** Fastify 4, Drizzle 0.31 + drizzle-kit 0.22, Zod, Postgres 18 + PostGIS + `pg_trgm`, Redis, Socket.IO 4,
`sharp`, R2 via `lib/storage.ts`; Expo SDK 54, React Navigation 7, TanStack Query, Formik + Yup, i18next; Next.js 14
admin kit. No new dependency, no new native module.

**Spec:** `docs/superpowers/specs/2026-11-20-f8-part-requests-design.md` (rulings R1–R14, (my call) list §25, review
changes §26). Section numbers below (§n) refer to it. The spec is the source of truth; plan decisions where it is silent
are **D1–D18** below.

**Textile sources** (`C:\Users\Dell\Desktop\textile stock marketplace`, also `E:\textile-marketplace`; spec
`docs/superpowers/specs/2026-11-08-part2-m3-m9-search-requirements-design.md` §4, §7, §8): each task names the textile
files it follows (**Ports:**). Read them first; keep their names where the spec keeps the concept; drop the outbox,
Pro head start, seller settings / digests, Ask a question, quotes, lots (spec "Dropped from textile").

---

## Global constraints

- **Branches:** C0 on `develop`. Then lanes, each in its own worktree on a local branch (lane setup checklist below).
  **Implementers never commit or push**; each task ends with "Stage" (list the files). The controller commits per lane
  after its review, merges lanes into `develop` (`git merge --no-ff`), runs the suites once per wave, commits the fix
  wave and pushes at milestones only (after C0, after each wave, after Batch I). Owner rule: ask before each commit and
  push. The spec (committed, `0b3eec5`) and this plan are committed before C0.
- **Contracts own the schema and shared types.** Only C0 adds migrations, edits `apps/api/src/db/schema.ts` or
  `packages/shared-types`. A lane that needs a contract change stops and reports it; the controller makes it on
  `develop` and the lane merges `develop` in.
- **File ownership:** a lane edits only the files in its row of the ownership table. Every cross-lane function exists
  after C0 as its final signature with a stub body marked `// F8-STUB(<lane>)` returning the empty answer (no-op,
  `null`, `[]`, `0`, `false`), never throwing; the owning lane replaces the body and removes the marker. I-1 greps for it.
  `apps/user-app/lib/i18n/audit-allowlist.json` and `apps/user-app/lib/style-audit-allowlist.json` are append-only in lanes.
- **Lane isolation:** API lanes run tests against their own DB (`mpm_f8a1_test`, `mpm_f8a2_test`, `mpm_f8a3_test`) and
  Redis index (`redis://localhost:6381/3`, `/4`, `/5`; flush those first: they are F6's old lane DBs). App / admin lanes
  run no API tests.
- Routes: Zod `.strict()` parse → service → `{ data }`; services throw `AppError` subclasses with §15's codes. User
  routes `preHandler: fastify.requireUser`; writes add `refuseViewer` (`403 VIEWER_READ_ONLY`) except `POST
  /part-requests/:id/read`. `requireUser` does **not** check onboarding: every F8 write service (post, renew, reply,
  create-listing-with-request, not relevant, report) calls `onboardingForUser` (`409 ONBOARDING_INCOMPLETE`, §6). Admin
  `fastify.requireAdminRole('moderator', 'support')` (super_admin passes); every admin mutation writes `audit_log` via
  `writeAudit` in its transaction.
- **Visibility:** the buyer business sees its own requests; everyone else only through `eligibleSellerSql` (§6, C0-3a);
  anything else answers `404 PART_REQUEST_NOT_FOUND`. Never a 403 that leaks existence.
- **Text out:** request `name`, `note` and reply `message` pass `maskContact` on every read (buyer, seller, admin) and
  in notification params; stored text untouched. Sellers never get phone, email, pincode, address, point, industrial area
  id, or the budget when `budget_visible = false`. Distances shown or stored are snapped whole km (`snappedKmSql` rule).
- **Lock order (§9.5):** actor's own business (`FOR NO KEY UPDATE`, only where a limit is counted) → part request
  (`FOR NO KEY UPDATE` for buyer / admin / job writes, `FOR SHARE` for a reply, create-with-request, not relevant) →
  replies / targets / matches / feedback. Jobs and admin: requests in id order, never a business lock. `part_requests`
  are **never** locked `FOR UPDATE`; F8 takes no explicit listing lock. Helpers in `services/part-requests/locks.ts`.
- **Transactions with effects:** `runTx(app, fn)` / `runJobTx`; socket emits queued with `queueBusinessEmit`;
  notifications through `notify(tx, …)` / `upsertRequestNotification(tx, …)` in the same transaction.
- **Money / quantity / time:** budget `bigint` paise, a JSON number on the wire (≤ 2 147 483 647, `assertInt4Paise`);
  quantities `numeric(14,3)` as decimal strings (`fitsUnitDecimals`); IST days for daily caps and `needed_by`
  (today … today + 365); every rule uses `now()`; tests move stored timestamps back with `UPDATE` (never fake timers for
  DB-clock rules).
- **Migrations:** edit `schema.ts` → `pnpm --filter @mpm/api db:generate` (0014); CHECKs and the sequence restart in
  `drizzle-kit generate --custom` (0015). Never edit 0000–0013. Apply with `db:migrate` **and** `db:migrate:test`. No
  statement in 0014 / 0015 uses the new enum values `requests` / `part_request` (§5.10).
- After editing `packages/shared-types`: `pnpm --filter @mpm/shared-types build`; its tests live in
  `apps/api/src/lib/*-shared.test.ts`.
- **Tests: limited and important only (owner).** Step 1 lists the only cases to write: state machine, limits and caps,
  eligibility and privacy, matching correctness, queue correctness, reply lifecycle, prefill order and rollback, races
  from the spec. No tests for UI wiring, copy, layout or trivial helpers. App: pure `lib/` logic with co-located tests;
  i18n parity / audit and style audit must pass. Admin: the remove / restore dialog and the list filter query only.
- **API test fixtures:** real Postgres + Redis; unique per run; `createTestSeller({ point, state, activities, gst })`
  (C0-2 adds `state` and `activities`), `insertTestListing`, `insertTestDeal`, `addTestMember`, C0-2's
  `insertTestPartRequest` / `insertTestReply` / `insertTestMatch` / `createTestPartTree`; every limit test sets its
  settings in `app_settings` and restores them; `vitest.config.ts` raises `GROUP_RATE_LIMIT_MAX`; **every suite leaves
  the test DB with no F8 rows** (`deleteF8Rows` in `afterAll`, also called by `deleteTestBusinesses` /
  `deleteListingsOf` / `deleteTestListings` / `deleteTestUsers` before `deleteF6Rows`). Storage: `vi.mock` the storage
  calls of `services/chat/private-photo.ts`; R2 round trips only under `R2_TESTS=1`.
- **Memory is tight:** one package's tests at a time; while iterating, only the task's files
  (`pnpm --filter @mpm/api exec vitest run __tests__/<file>.test.ts`). At most three lanes at once. Admin build and
  `expo export` only in I-2.
- **App:** every string in `en`, `hi`, `gu` in the lane's own locale file (C0-5 creates and registers them); light only
  (`useTheme()` → `{ colors, shadows }`), `useType()`, the Periwinkle v2 kit, `testID` on every pressable, Indian
  amounts, part numbers in JetBrains Mono (`apps/user-app/CLAUDE.md` §1–2, §6, §8). Screens follow the mockup flow
  `requirements` in `docs/mockups/src/build-periwinkle-v2.mjs` (≈ l.587–639); screens without a mockup use the
  `frontend-design` skill in the mockup's language. Analytics: `REQUEST_EVENTS` declared once in C0-5, fired by lanes,
  ids and codes only.
- **Admin:** v2 kit and palette classes only; style audit green; English only.
- **Exact numbers (spec):** name 3–100, note ≤ 500, reply message ≤ 300, photos ≤ 3 (≤ 10 MB, re-encoded, 300 s URLs),
  fits ≤ 5, `minNameSimilarity` 0.5, targeting name floor 0.3, page size 20, ≤ 3 listings per reply call, auto-match ≤
  200 candidate requests per listing row, at-post backfill ≤ 20, targets ≤ 2 × N per request, work job 20 rows / 10 s,
  retry backoff 30 s / 2 min / 10 min / 1 h, dead letter after 5 attempts, stale claim 10 min, compare ≤ 10 columns,
  demand ids ≤ 10, home seller strip ≤ 3; rate limits (per user) post / edit / renew / close / fulfil 30 per 10 min,
  replies + withdraw 20 per 10 min, not relevant 60 per 10 min, photo presign 30 per 10 min, reports 10 a day
  (`REPORT_LIMIT`); settings defaults §16.
- **Every task ends green** for its own tests, typecheck of the packages it touched, lint for admin.
- Windows: Bash is Git Bash; paths relative to the repo root.

## Plan decisions (D1–D18, where the spec is silent or loose)

- **D1. Lanes.** §19's sketch (four API lanes) is folded into three disjoint ones: **A1** request CRUD + lifecycle +
  buyer reads + seller reads + not relevant + report + home + badge count; **A2** queue job + targeting + auto matches +
  caps + demand + the whole reply lifecycle (options, send, withdraw, `POST /listings { partRequestId }` prefill,
  delivery, drops on listing change); **A3** jobs (expiry, reminder, retention) + notification texts + push tag + fulfil
  prompt + admin API + reports widening. Wave B: **B1** admin, **B2** app buyer, **B3** app seller. No C1: every F2 /
  F6 hook is a few lines and goes into C0-4a with real bodies.
- **D2. Route files per lane:** `routes/part-requests.ts` (A1), `routes/part-request-replies.ts` (A2: reply routes and
  `GET /listings/:id/part-request-demand`), `routes/admin/part-requests.ts` (A3). Fastify registers both user files
  under the same paths; no two lanes edit one route file. F2's `routes/listings.ts` changes once, in C0-4a.
- **D3. `GET /part-requests/:id`:** the buyer view when the reader's business owns the request, else the seller view
  when eligible (§6), else 404. Dispatch is A1's; the seller's `myReplies` comes from C0's `sellerReplyViews`.
- **D4. `ListingOwnerView.partRequestId` / `pendingRequestReply`** come from the listing's one `pending` reply (only
  create-with-request makes pending replies, so there is at most one); both null when there is none. No listings column.
- **D5. `notify()` actor rule:** `notify` has no actor filter today (callers choose the recipient business, F6 P14), so
  "actor exemption" needs no parameter: F8 callers never address the actor's own business, except
  `part_request_fulfil_prompt`, which always addresses the buyer business (§10.1, review Q2).
- **D6. `push: false`** on `notify` writes the rows and no `notification_deliveries`. In `upsertRequestNotification`
  `version` is bumped and a delivery queued **only** when `push` is true (§10.2).
- **D7. `POST /part-requests/:id/read`** marks the **reading user's** two grouped rows read; `buyer_viewed_at` (replies),
  `seen_at` (matches) and `buyer_seen_at` (request) are per request, set for the business. Any buyer member, viewers too.
- **D8. Counting rules:** open limit = the business's `active` requests, verified = `'gst' = ANY(verification_levels)`;
  posts per day = requests created by the business this IST day, any status; replies per day = reply rows created by the
  seller business this IST day, any status; per-request cap = `pending` + `delivered` replies of that seller on it.
- **D9. Renew `days`** must be one of the three validity settings (`400 VALIDITY_INVALID`), as on post.
- **D10. Group rate limits:** `RateGroup` gains `part_request` (post, edit, renew, close, fulfil: 30 / 600 s),
  `part_request_reply` (replies, withdraw: 20 / 600 s), `part_request_feedback` (not relevant: 60 / 600 s). Photo presign
  `perUser(30)`.
- **D11. `POST /listings { kind, partRequestId }` with a `kind` other than the request's** → `400 REPLY_LISTING_INVALID`
  `details.reasons: { draft: 'kind' }`. The draft's kind is the request's.
- **D12. Match `source`** is a pg enum `part_request_match_source` (`listing_live`, `at_post`), constant
  `PART_REQUEST_MATCH_SOURCES` in shared-types.
- **D13. Status emits:** `writeRequestStatus` queues `part_request:updated { reason: 'status' }` when the actor is
  `system` or `admin` (§11); a buyer's own action doesn't (the acting screen refetches).
- **D14. Removal actor** for `listing_changed` on a `removed` listing: the latest `listing_status_history` row with
  `to_status = 'removed'`; `actor = 'admin'` → `listing_removed_by_team`, else `listing_removed`.
- **D15. `GET /part-requests/mine` counts** `{ active, fulfilled, closed }` (`closed` = closed + expired + removed);
  `for-sellers` counts `{ forYou, all, replied }`. Cursors are sealed keyset cursors (`INVALID_CURSOR`), page 20.
- **D16. `for-sellers ?forListing=`** lists the requests `demandRequestIds` (A2) returns for that listing of the
  reader's business; A1 calls it through the C0 stub.
- **D17. Home seller strip** is non-null only for a business with the `sell` activity or a live listing (§13.2).
- **D18. Test geography:** distances come from `createTestSeller({ point })` pins (Surat ≈ 21.17 N, 72.83 E; 0.009° lat ≈
  1 km); the state test uses `state: 'Maharashtra'`. No new pincode range.

## Plan review changes (2026-11-20)

An independent reviewer checked this plan against the spec and the code. Every change below is applied in the task
it names.

| # | Change | Where |
|---|---|---|
| 1 | Targeting follows §7.3: score every eligible seller except Not relevant, take the top N; newcomers = those in that top N without a target row, capped at 2N − t. An edit changing nothing material notifies 0. | A2-2 |
| 2 | `markPartRequestRead` locks the request `FOR NO KEY UPDATE` first, then notifications, replies, matches. | A1-2 |
| 3 | `processListingChanged`: matches are inserted without request locks (`status = 'active'` re-checked in the insert's `WHERE`); then one id-sorted lock pass over only the requests with a new match or a reply change, for caps and counters. No second pass. | A2-3, A2-4 |
| 4 | `notifyFulfilPrompts(tx, { dealId, listingId, buyerBusinessId, sellerBusinessId })` (`createDealFromOffer` returns `{ dealId, ref, status, version }`). | C0-4a, A3-3 |
| 5 | `lockPartRequest(tx, id, mode, opts?: { skipLocked?: boolean }): Promise<PartRequestRow \| null>`. | C0-3a |
| 6 | `snappedKmBetweenSql(a: SQL, b: SQL)` in `services/discovery/distance.ts`, used by A1 and A2. | C0-3a |
| 7 | Test DB cleanliness: `deleteF8Rows` also deletes work rows for the passed businesses' listings; `saved-listings.test.ts` and `discovery-schema.test.ts` (direct listing deletes) delete their work rows; C0 exit runs `countF8Rows` after the full API suite. | C0-2, C0-4a, C0 exit |
| 8 | Draft prefill: `listingValues` carries `titleNorm`, `partNumberNorm`, `partNumberBase`; `applyDraftPrefill` runs before `refreshListingSearch`; `side: null` never overrides the `not_applicable` default. | C0-4a, A2-4 |
| 9 | `matchRuleSql(…, opts: { requireLive: boolean })`; demand on drafts / listings in review uses `requireLive: false`. | A2-3 |
| 10 | `insertTestTarget`, `insertTestFeedback` fixtures. | C0-2 |
| 11 | `PartRequestBuyerView.photoKeys` (buyer only); PATCH `photoKeys` is the full final list; `validityDays` removed from `PartRequestPatch` (renew owns validity). | C0-1, A1-2 |
| 12 | Post: `resolveRequestFields` + an unlocked limit pre-check before `finalizePrivatePhotos`; final copies deleted when the transaction fails. | A1-1 |
| 13 | B2 builds its own `components/part-requests/form/CategorySheet.tsx` (imports only from `lib/sell-category.ts`, allows a machine type); B3 keeps `step-category.tsx`. | B2-2, ownership |
| 14 | Enqueue also from `adminPatchListing` (category, side, fitments); `matchRelevantChange` adds the listing's own location and its `listing_machines` brand / model / year. | C0-4a |
| 15 | Compile fallout: placeholder en / hi / gu texts for the 7 new types (A3 replaces), app notifications `CATEGORY_ICONS.requests`, `notification-read.service.ts` maps `partRequestId`. | C0-1, C0-3b |
| 16 | Fulfil banner counts any non-cancelled deal (`disputed` included); retry un-claim catches `23505` → `done_at`; Posted refetch at ≈ 12 s; `GET /part-requests/options` public; Sentry strips `name` from request bodies only; duplicate settings test dropped from C0-4b; grouped-row dedupe reasoning noted; `ReplyRow` / `PartRequestColumns` in `locks.ts`; renew always locks the business first. | A1-1, A1-2, A1-3, A2-1, B2-2, C0-3a, C0-3b, C0-4b |

## Review focus

1. **A listing going live and never checked:** a path into `live` (publish auto-live, approve, resume, renew, relist,
   unhide, unreserve after a deal cancel, bulk admin unhide) that skips the enqueue, or an enqueue lost while a row is
   claimed. Pinned in C0-4a (`f8-listing-hooks.test.ts`) and A2-1 (`part-request-work.test.ts`).
2. **Spam:** a seller re-notified on an edit or renew, the seller push cap exceeded by two concurrent passes, a buyer
   pushed beyond 3 a day / 20 total, or a capped match bumping `version` so an allowed queued push is skipped as stale.
   Pinned in A2-2, A2-3, C0-3b.
3. **Buyer contact leaking:** a phone typed in Devanagari / Gujarati digits in the name, note or reply message reaching a
   seller payload, admin detail, notification text or push; a seller seeing pincode / point / private budget. Pinned in
   A1-3, A1-4, A3-2, A3-4.
4. **A pending reply delivered where it must not be, or stuck:** delivered on a closed / expired / removed request, to a
   blocked or now-ineligible buyer; left pending after the draft is deleted, rejected or removed. Pinned in A2-4, C0-4a,
   I-1.
5. **A poison queue row or lock wait:** one failing row blocking the batch, a stale claim never reclaimed, a listing
   write waiting on the job, the fulfil-prompt insert in F6 accept waiting on a job's request lock. Pinned in A2-1, A3-3,
   I-1.

---

## Lanes and ownership

| Lane | Wave | Owns (only these files; paths under `apps/api/src/` unless noted) | Assumes from C0 |
|---|---|---|---|
| **A1 API requests** | A | `services/part-requests/{request-input,request.service,request-photos,request-read.service,buyer-view,compare.service,seller-read.service,seller-view,feedback.service,request-report.service,home.service,request-counts}.ts`, `routes/part-requests.ts`, tests `apps/api/__tests__/part-requests-{post,lifecycle,buyer-read,seller-read}.test.ts` | eligibility, locks, `writeRequestStatus`, drops, queue, grouped rows, photos (C0-3); `demandRequestIds` stub (A2) |
| **A2 API matching + replies** | A | `services/part-requests/{work-job,targeting,push-caps,match-rule,auto-match,demand,reply.service,reply-options,listing-prefill,reply-delivery}.ts`, `routes/part-request-replies.ts`, tests `apps/api/__tests__/part-request-{work,targeting,matches,replies}.test.ts` | eligibility, reply fit, drops, queue, grouped rows (C0-3); C0-4a's createListing wiring |
| **A3 API jobs, notifications, admin** | A | `services/part-requests/{request-jobs,fulfil-prompt,admin.service,admin-view}.ts`, `services/notifications/text/{en,hi,gu,types}.ts`, `services/notifications/render.ts`, `services/notifications/push-sender.ts`, `services/reports/admin-reports.service.ts`, `routes/admin/part-requests.ts`, `routes/admin/reports.ts`, tests `apps/api/__tests__/{part-request-jobs,part-request-notifications,part-request-fulfil,admin-part-requests}.test.ts` | lifecycle, drops (C0-3); accept hook (C0-4a) |
| **B1 admin** | B | `apps/admin/app/(dashboard)/part-requests/**`, `apps/admin/components/part-requests/**`, `apps/admin/lib/part-requests-api.ts`, `apps/admin/app/(dashboard)/reports/page.tsx`, `apps/admin/components/conversations/use-admin-reports.ts`, `apps/admin/components/settings/marketplace-settings-form.tsx`, `apps/admin/components/businesses/business-detail.tsx` | admin types (C0-1), the A3 API |
| **B2 app buyer** | B | under `apps/user-app/`: `screens/requirements/{post-requirement,requirement-posted,my-requirements,requirement-buyer,compare-responses}.tsx`, `components/part-requests/{HomeBuyerStrip,RequestPrefillCard,ReplyCard,MatchCard,FulfilBanner,CloseSheet,RenewSheet}.tsx`, `components/part-requests/form/**` (incl. its own `CategorySheet.tsx`; imports from `lib/sell-category.ts` only, never edits it), `lib/{part-request-form,part-request-compare}.ts` + tests, `hooks/{use-my-part-requests,use-pending-request}.ts`, `screens/search/results.tsx`, `screens/listing/{other-side-block,other-side}.tsx`, `locales/*/requirements.json` | navigation, API client, query keys, display helpers, pending action, analytics, errors (C0-5) |
| **B3 app seller** | B | under `apps/user-app/`: `screens/requirements/{requirement-seller,reply-with-listing,buyers-looking}.tsx`, `components/part-requests/{HomeSellerStrip,SellerRequestRow,NotRelevantSheet,RequestReportSheet,BuyerBlock}.tsx`, `lib/reply-picker.ts` + test, `lib/sell-category.ts` + test, `hooks/use-seller-part-requests.ts`, `screens/sell/{step-category,preview,published}.tsx`, `locales/*/buyers.json` | as B2 |

**Waves.** Wave A = A1, A2, A3 (C0 fixed every seam). Wave B = B1, B2, B3 after wave A merges (so the controller can
smoke-test against a real API). If memory is short: A1 + A2, then A3; B2 + B3, then B1. Each wave: lanes reviewed one by
one, merged one by one, then the wave's suites once and a fix wave on `develop`.

**Lane setup checklist (controller, per lane, from the commit the wave starts on):**
1. `git worktree add .claude/worktrees/f8-<lane> -b lane/f8-<lane> develop`.
2. Copy the root `.env` into the worktree (never committed); API lanes set `TEST_DATABASE_URL` to `…/mpm_f8<lane>_test`
   and `TEST_REDIS_URL` to `redis://localhost:6381/<3|4|5>` (`redis-cli -p 6381 -n <n> flushdb` first).
3. API lanes: `docker exec mpm-postgres-1 createdb -U mpm mpm_f8<lane>_test`.
4. In the worktree: `pnpm install --offline`, `pnpm --filter @mpm/shared-types build`, API lanes
   `pnpm --filter @mpm/api db:migrate:test`.
5. Hand the implementer the worktree path, the lane's tasks, its ownership row and the base commit.
6. After the merge: `git worktree remove`, `dropdb` the lane DB, delete the lane branch.

---

## File map

```
packages/shared-types/src/index.ts                        constants, transitions, pure fns, settings, views (C0-1)
apps/api/src/lib/f8-shared.test.ts                        pure fn tests (C0-1)
apps/admin/lib/status.ts                                   part-request tones for the new statuses (C0-1, compile)
apps/api/src/db/schema.ts, infra/migrations/0014_f8_part_requests_tables.sql, 0015_f8_checks.sql (+ meta)   (C0-2)
apps/api/__tests__/_helpers/test-part-requests.ts (+ test-listings.ts, test-users.ts, test-businesses.ts hooks)  (C0-2)
apps/api/src/services/part-requests/{categories,eligibility,locks,lifecycle,reply-fit}.ts                    (C0-3a)
apps/api/src/services/part-requests/{work-queue,reply-drops,emit,reply-views}.ts,
  services/notifications/{notify,request-rows}.ts, services/chat/private-photo.ts, lib/group-limit.ts       (C0-3b)
apps/api/src/services/listings/{listing-lifecycle,listing-write,listing-view}.service.ts, routes/listings.ts,
  services/business/profile.service.ts, services/offers/accept.service.ts, services/part-requests/listing-hooks.ts (C0-4a)
apps/api/src/routes/{part-requests,part-request-replies,badges}.ts, routes/admin/part-requests.ts, app.ts,
  jobs/index.ts, lib/sentry.ts, services/admin/business-admin.service.ts, lane stub files                   (C0-4b)
apps/user-app/navigation/*, screens/requirements/* placeholders + requirement.tsx, components/part-requests/*
  placeholders, lib/{part-requests-api,part-request-display,socket-part-requests,f8-errors,notification-links,
  pending-action,sign-in-gate,analytics-events,error-reporting,query-keys,listing-api}.ts, hooks/{useSocket,use-saved,
  use-part-request-home,use-pending-request}.ts, screens/tabs/{post,home}.tsx, screens/profile.tsx, locales/*      (C0-5)
lanes: see the ownership table
docs/PROJECT_STATUS.md, CLAUDE.md, apps/user-app/CLAUDE.md, apps/admin/CLAUDE.md, docs/product-scope.md, F2 spec note (I-4)
```

---

# Batch C0 — Contracts (sequential, on `develop`)

### C0-1: Shared types and pure functions

**Ports:** textile `packages/shared-types` requirement section.

**Files:** Modify `packages/shared-types/src/index.ts`, `apps/admin/lib/status.ts` (+ `status.test.ts` if it lists
part-request statuses); Create `apps/api/src/lib/f8-shared.test.ts`.

**Contents (§5.11, §9.1, §15, §16):**
- `PART_REQUEST_STATUSES = ['active','fulfilled','closed','expired','removed']` (`matched` dropped).
  `PART_REQUEST_ACTIONS = ['post','edit','renew','fulfil','close','expire','remove','restore']`;
  `PART_REQUEST_TRANSITIONS: Record<PartRequestAction, { actor: 'buyer' | 'system' | 'admin'; from: readonly
  PartRequestStatus[] }>` per §9.1 (`remove` from every status but `removed`); `partRequestTransition(from:
  PartRequestStatus | null, action: PartRequestAction, opts?: { returnStatus?: PartRequestStatus | null; pastExpiry?:
  boolean }): PartRequestStatus | null` (`post` from null → `active`; `edit` → same; `restore` → `returnStatus`, but
  `'expired'` when `returnStatus === 'active' && pastExpiry`; illegal → null).
- `PART_REQUEST_KINDS = ['part','machine']`, `PART_REQUEST_REACHES = ['radius_50','radius_200','state','all_india']`,
  `PART_REQUEST_REACH_KM = { radius_50: 50, radius_200: 200 }`, `PART_REQUEST_AUDIENCES = ['verified_only','any_seller']`,
  `PART_REQUEST_CLOSE_REASONS = ['found_elsewhere','no_longer_needed','posted_by_mistake','other']`,
  `PART_REQUEST_REPLY_STATUSES = ['pending','delivered','withdrawn','dropped']`, `PART_REQUEST_DROP_REASONS` (the nine of
  §5.4, in that order), `PART_REQUEST_MATCH_TIERS = ['part_number','name_fit','name','machine_fit']`,
  `PART_REQUEST_MATCH_SOURCES = ['listing_live','at_post']` (D12), `PART_REQUEST_FEEDBACK_REASONS =
  ['dont_sell_this','too_far','wrong_category','other']`, `PART_REQUEST_REPORT_REASONS =
  ['spam','fake','contact_details','prohibited','other']`, `PART_REQUEST_WORK_KINDS = ['target_request',
  'listing_changed']`, `REPLY_FIT_REASONS = ['kind','category','side','condition','replied']`.
- `PART_REQUEST_LIMITS = { nameMin: 3, nameMax: 100, noteMax: 500, messageMax: 300, photosMax: 3, fitsMax: 5,
  minNameSimilarity: 0.5, listingsPageSize: 20, replyListingsPerCall: 3, compareMax: 10, demandIdsMax: 10,
  homeSellerItems: 3, backfillMax: 20, matchCandidatesMax: 200 } as const`.
- `requestSideAccepts(requestSide: PartSide | null, listingSide: PartSide | null): boolean` (Left ← Left / Pair; Right ←
  Right / Pair; Pair ← Pair; null ← anything; a Left / Right / Pair request never accepts a null or `not_applicable`
  listing side); `isMatched(v: { deliveredReplyCount: number; matchCount: number }): boolean`;
  `partRequestDaysLeft(expiresAt: string | Date, now: Date): number` (whole days rounded up, ≥ 0).
- `REPORT_TARGETS` + `part_request`; `NOTIFICATION_CATEGORIES` + `requests`; `NOTIFICATION_TYPES` + `part_request_new`,
  `part_request_reply`, `part_request_expiring`, `part_request_expired`, `part_request_fulfil_prompt`,
  `part_request_removed`, `part_request_reply_dropped`; `notificationCategory()` maps every `part_request_*` and
  `part_match` → `requests` (`booking_update`, `listing_status` stay `deals`). `RateGroup` lives in the API (C0-3b).
- `PART_REQUEST_ERROR_CODES` = §15's new codes (for the app's error copy test).
- `APP_SETTINGS` + the 14 keys of §16 with defaults, ranges, labels, help (`part_request_reach_n` 15 1–50,
  `part_request_open_limit_unverified` 3 1–50, `part_request_open_limit_verified` 15 1–200,
  `part_request_posts_per_day` 5 1–100, `part_request_validity_days_1/_2/_3` 7 / 15 / 30 1–90,
  `part_request_max_days` 90 7–365, `part_request_expiring_notice_hours` 24 1–72,
  `part_request_seller_push_daily_cap` 10 0–100, `part_request_match_push_daily_cap` 3 0–20,
  `part_request_match_push_total_cap` 20 0–200, `part_request_reply_listings_max` 3 1–10,
  `part_request_replies_per_day` 20 1–500); `validateSettings` cross-checks `_1 < _2`, `_2 < _3`, `_3 ≤ max_days`,
  `expiring_notice_hours < _1 × 24`, `match_push_daily_cap ≤ match_push_total_cap`.
- Views (fields as §12.2 / §12.3 / §14 list them; key names fixed here):
  `PartRequestFitInput { brandId; modelId?: string | null; yearFrom?: number | null; yearTo?: number | null }`;
  `PartRequestInput { kind; categoryId; name; partNumber?; side?; fits?; specs?; quantity: string; unitId?;
  conditionIds?; budgetPerUnitPaise?; budgetVisible?; neededBy?: string; urgent?; reach; audience; validityDays;
  photoKeys?; note? }`; `PartRequestPatch = { version: number } & Partial<Omit<PartRequestInput, 'kind' |
  'validityDays'>>` (renew owns validity; `photoKeys`, when sent, is the full final list: kept final keys plus new
  uploads);
  `PartRequestPrefill = Partial<Pick<PartRequestInput, 'kind' | 'categoryId' | 'name' | 'partNumber' | 'side' | 'fits'
  | 'quantity' | 'unitId'>> & { source: 'no_results' | 'other_side' | 'post_tab' | 'copy'; categorySeedId?: string }`
  (`categorySeedId`: a machine category that only opens the picker there, §13.2);
  `PartRequestOptions { validityDays: number[]; defaultValidityDays; reachN; openLimit: number | null; openCount:
  number | null; postsLeftToday: number | null; maxDays }` (the three nulls for a guest); `PartRequestFitView { brandId; brandName; modelId: string | null; modelName: string | null; yearFrom;
  yearTo }`; base `PartRequestCommon { id; ref; kind; status; matched; categoryId; categoryPath: { id; name }[]; name;
  partNumber; side; fits: PartRequestFitView[]; specs; quantity; unit: { id; key; label }; conditionIds; neededBy;
  urgent; reach; audience; city; state; note; noteFlagged; photoCount; daysLeft; expiresAt; firstPostedAt; createdAt }`;
  `PartRequestBuyerView extends PartRequestCommon { role: 'buyer'; version; photoKeys: string[] (the buyer's own final
  keys, for the edit form; never in a seller or admin view); budgetPerUnitPaise; budgetVisible;
  validityDays; closeReason; fulfilledDealId; counts: { replies; matches; newReplies; newMatches }; targetedCount;
  fulfilPrompt: { dealId; businessName } | null; renewableUntil: string }`; `PartRequestSellerView extends
  PartRequestCommon { role: 'seller'; budgetPerUnitPaise: number | null; buyer: PartRequestBuyerBlock; distanceKm:
  number | null; inReach; targeted; notRelevant; replyCount; hasMatchingStock; myReplies: SellerReplyView[]; canReply;
  slotsLeft }`; `PartRequestBuyerBlock { tradeName; city; verified; memberSince: number }`; `PartRequestView =
  PartRequestBuyerView | PartRequestSellerView`; `MyPartRequestRow { id; name; kind; side; quantity; unitLabel;
  firstFit: string | null; status; matched; replyCount; matchCount; newCount; daysLeft; createdAt }`;
  `SellerPartRequestRow { id; name; kind; side; quantity; unitLabel; firstFit; conditionIds; budgetPerUnitPaise: number
  | null; neededBy; urgent; daysLeft; city; distanceKm; inReach; replyCount; targeted; hasMatchingStock; photoCount;
  buyer: PartRequestBuyerBlock; note; noteFlagged; myReplyCount; createdAt }`; `PartRequestReplyItem { replyId; card:
  ListingCard; seller: { businessId; name; verified; score: SellerScore | null }; message; messageFlagged; live;
  deliveredAt; viewed }`; `PartRequestMatchItem { listingId; card: ListingCard; tier; distanceKm; seen; createdAt }`;
  `CompareColumn { listingId; source: 'reply' | 'match'; title; pricePerUnitPaise: number | null; priceOnRequest;
  availableQuantity: string | null; unitLabel; side; conditionLabel: string | null; distanceKm: number | null; rating:
  number | null; reviewCount; verified; lowestPrice; contactAction: 'offer' | 'buy' | 'ask_price' | 'enquire' }`;
  `ReplyOption { listingId; card: ListingCard; fit: boolean; reason: ReplyFitReason | null }`; `SellerReplyView { id;
  listingId; listingTitle; status; dropReason; message; deliveredAt; withdrawnAt; droppedAt; seenByBuyer; createdAt }`;
  `PartRequestHome { buyer: { partRequestId; name; side; newCount; nearestKm: number | null } | null; seller: {
  newCount; items: SellerPartRequestRow[] } | null }`; `PartRequestDemand { count; partRequestIds: string[] }`;
  `AdminPartRequestRow { id; ref; name; kind; categoryPath: string; buyer: { businessId; name }; city; status;
  targetedCount; replyCount; matchCount; openReports; createdAt; expiresAt }`; `AdminPartRequestDetail` (the buyer
  view's fields without `role` / `fulfilPrompt`, plus `buyer: { businessId; name }` (no phone field),
  `eligibleNow: number`, `targets: { businessId; name; rank; score: string; pushed; notifiedAt; openedAt; replied;
  notRelevant }[]`, `replies: { id; listingId; listingTitle; seller: { businessId; name }; status; dropReason; message;
  createdAt }[]`, `matches: { listingId; listingTitle; seller: { businessId; name }; tier; distanceKm; pushed; createdAt
  }[]`, `reports: AdminReportRow[]`, `removedAt`, `removedReason`, `returnStatus`).
- Changed: `ListingOwnerView` + `partRequestId: string | null`, `pendingRequestReply: { partRequestId: string; name:
  string } | null` (D4); `CreateListingRequest` + `partRequestId?: string`; `Badges` + `requestsForYou: number`;
  `NotificationRow` + `partRequestId: string | null`; `AdminReportRow.target` + `'part_request'` (and
  `partRequestId?` / masked `partRequestName?` on such rows); `AdminBusinessDetail` + `partRequestCount: number`.

- [x] **Step 1: Failing tests** (`f8-shared.test.ts`): `partRequestTransition` — every row of §9.1 legal, a sample of
  illegal ones null (`fulfil` from `expired`, `edit` from `closed`, `remove` from `removed`, `restore` from `active`),
  `restore` with `returnStatus: 'active'` and `pastExpiry: true` → `'expired'`, with `'fulfilled'` → `'fulfilled'`;
  `requestSideAccepts` full table (`left`×{left ✓, right ✗, pair ✓, null ✗, not_applicable ✗}, `right` mirror, `pair` ←
  pair only, `null` ← each ✓); `partRequestDaysLeft` (23 h → 1, 0 → 0, past → 0); `notificationCategory` for the 7 new
  types and `part_match` → `requests`; `validateSettings` refuses each of the five cross-checks and accepts the
  defaults.
- [x] **Step 2:** FAIL. **Step 3:** Implement; `pnpm --filter @mpm/shared-types build`; make every consumer compile
  (`toOwnerView` returns `partRequestId: null, pendingRequestReply: null` until C0-4a; badges route `requestsForYou: 0`
  until C0-4b; admin `lib/status.ts` tones: active brand, fulfilled green, closed / expired gray, removed red; app
  fixtures; placeholder en / hi / gu title and body for the 7 new types in `apps/api/src/services/notifications/text/
  {en,hi,gu}.ts` (A3-2 replaces them); `apps/user-app/screens/notifications/notifications.tsx` `CATEGORY_ICONS` +
  `requests`). **Step 4:** PASS; `pnpm typecheck`. **Step 5: Stage.**

### C0-2: Schema, migrations, fixtures

**Files:** Modify `apps/api/src/db/schema.ts`; Create `infra/migrations/0014_f8_part_requests_tables.sql`,
`infra/migrations/0015_f8_checks.sql` (+ meta); Create `apps/api/__tests__/_helpers/test-part-requests.ts`; Modify
`__tests__/_helpers/test-listings.ts` (`createTestSeller` opts `state?: string`, `activities?: BusinessActivity[]`),
`test-users.ts` (`deleteListingsOf`, `deleteTestListings`, `deleteTestUsers`) and `test-businesses.ts`
(`deleteTestBusinesses`) to call `deleteF8Rows` before `deleteF6Rows`; Test `apps/api/__tests__/f8-schema.test.ts`.

**Contents (§5.1–§5.10):** enums `part_request_kind`, `part_request_status`, `part_request_reach`,
`part_request_audience`, `part_request_close_reason`, `part_request_reply_status`, `part_request_drop_reason`,
`part_request_match_tier`, `part_request_match_source`, `part_request_feedback_reason`, `part_request_work_kind`;
`notification_category` + `requests`, `report_target` + `part_request` (generated `ALTER TYPE … ADD VALUE`, unused by
0014 / 0015). Tables exactly as §5.1–§5.8 (Drizzle names `partRequests`, `partRequestFitments`, `partRequestTargets`,
`partRequestReplies`, `partRequestMatches`, `partRequestFeedback`, `partRequestWork`, `partRequestPushCounts`;
`part_requests.ref` bigserial; `point` `geography(Point,4326)` via the existing custom type); `notifications.part_request_id`
→ `part_requests` null. **Every index in `schema.ts`**, partial ones with `.where(sql\`…\`)`: §5.1's five (incl. partial
`(kind, category_id) WHERE status = 'active'`, partial `(expires_at) WHERE status = 'active'`, GiST `(point) WHERE status
= 'active'`); fitments `(part_request_id)`; targets `(business_id, notified_at DESC)`; replies unique `(part_request_id,
listing_id)`, `(part_request_id, status)`, partial `(listing_id) WHERE status = 'pending'`, `(seller_business_id,
created_at)`; matches `(listing_id)`; work partial unique `part_request_work_unclaimed_uq (kind, subject_id) WHERE
claimed_at IS NULL`, partial `(next_attempt_at) WHERE claimed_at IS NULL`, partial `(claimed_at) WHERE done_at IS NULL
AND failed_at IS NULL AND claimed_at IS NOT NULL`; `notifications_open_request_row` unique `(user_id, part_request_id,
type) WHERE type IN ('part_match','part_request_reply') AND read_at IS NULL`. Custom 0015 only: CHECKs
`part_requests_quantity_positive`, `part_requests_budget_positive` (null or > 0), `part_requests_note_len` (≤ 500),
`part_requests_photos_max` (`cardinality(photo_keys) <= 3`), `part_requests_machine_shape` (`kind = 'machine'` ⇒ `side
IS NULL AND part_number IS NULL`), `part_requests_closed_reason`, `part_requests_removed_at`,
`part_request_replies_message_len` (≤ 300), `part_request_fitments_years` (from ≤ to);
`ALTER SEQUENCE part_requests_ref_seq RESTART WITH 300001`.

**Helpers (`test-part-requests.ts`):** `createTestPartTree(opts?: { hasSides?: boolean }): Promise<{ machineCategory;
machineType; partGroup; cleanup }>` (each `{ id; path }`; reuse `test-catalog.ts` if it already builds one);
`insertTestPartRequest(o: { businessId; userId; categoryId; kind?; name?; partNumber?; side?; fits?:
PartRequestFitInput[]; conditionIds?; quantity?; unitId?; reach?; audience?; status?; point?: Point | null; state?;
expiresAt?; firstPostedAt?; budgetPerUnitPaise?; budgetVisible?; note? }, conn?): Promise<PartRequestRow>` (norms via
the shared-types normalisers); `insertTestReply(o: { partRequestId; sellerBusinessId; listingId; userId; status?;
message? })`; `insertTestMatch(o: { partRequestId; listingId; sellerBusinessId; tier?; distanceKm?; source? })`;
`insertTestTarget(o: { partRequestId; businessId; score?; rank?; pass?; bestListingId?; pushed?; openedAt? })`;
`insertTestFeedback(o: { partRequestId; businessId; userId; reason? })`;
`countF8Rows(conn): Promise<Record<string, number>>` (for the "left clean" checks); `deleteF8Rows(conn, { businessIds;
userIds?; listingIds?; partRequestIds? })` in FK order: deliveries + notifications with those `part_request_id`s, reports
targeting those requests, work rows by subject id (the requests, the listings passed **and every listing of the
businesses passed**), push counts by business, feedback, matches, replies (also by listing id and seller business),
targets, fitments, requests.

- [x] **Step 1: Failing tests** (`f8-schema.test.ts`): second unclaimed work row for the same `(kind, subject_id)`
  refused, allowed once the first has `claimed_at`; second reply for the same request + listing refused; second unread
  `part_match` row for the same user + request refused, allowed once the first is read, and a `part_request_reply` row
  alongside allowed; a machine request with a side refused; `closed` without `close_reason` refused; 4 photo keys
  refused; message of 301 chars refused; first `ref` ≥ 300001; `report_target` has `part_request` and
  `notification_category` has `requests`; `deleteF8Rows` leaves `countF8Rows` all 0 for a fixture with one of
  everything, and `deleteTestBusinesses` then succeeds.
- [x] **Step 2:** FAIL. **Step 3:** Implement; `db:generate`; `drizzle-kit generate --custom` for 0015; `db:migrate`;
  `db:migrate:test`. **Step 4:** PASS; `f6-schema.test.ts` still passes. **Step 5: Stage.**

### C0-3a: Eligibility, categories, locks, status write, reply fit

**Ports:** textile `services/requirements/eligibility.ts`, `requirement.service.ts` (status write), `reply.service.ts`
(fit check).

**Files:** Create `apps/api/src/services/part-requests/{categories,eligibility,locks,lifecycle,reply-fit}.ts`; Modify
`apps/api/src/services/discovery/distance.ts` (`snappedKmBetweenSql`); Test `apps/api/__tests__/f8-eligibility.test.ts`.

**Interfaces (final names; used by every lane):**
- `categories.ts`: `subtreeSql(node: SQL, root: SQL): SQL` (`node.path = root.path OR node.path LIKE root.path || '/%'`);
  `categoryAncestorIds(conn, categoryId): Promise<string[]>` (ids of every node on the path, the node included);
  `machineCategoryOf(conn, categoryId): Promise<{ id; path } | null>`; `requestCategoryNode(conn, categoryId, kind):
  Promise<{ id; level; path; hasSides: boolean } | null>` (active chain; parts: `part_group` or `machine_type`; machines:
  `machine_type`; effective `has_sides`).
- `eligibility.ts`: `eligibleSellerSql(sellerBusinessId: string | SQL, r: PartRequestColumns = partRequests): SQL` — the
  six conditions of §6 exactly as its SQL shape (seller `pincode IS NOT NULL` and no suspended / blocked owner; seller ≠
  `r.business_id`; buyer owners not suspended / blocked; no `business_blocks` row either way; audience / `gst`; 5a
  `S.categories @> jsonb_build_array(root.id::text) AND 'sell' = ANY(S.activities)` or 5b a live public listing in
  `r.category_id`'s subtree; `r.status = 'active'` or a reply by S on r). `isEligibleSeller(conn, requestId,
  sellerBusinessId): Promise<boolean>`; `eligibleSellerCount(conn, requestId): Promise<number>`; `requestRoleFor(conn,
  requestId, businessId): Promise<'buyer' | 'seller' | null>`.
- `distance.ts`: `snappedKmBetweenSql(a: SQL, b: SQL): SQL<number | null>` — snapped whole km between two geography
  expressions (same snapping rule as `snappedKmSql`, null when either is null); the only distance A1 and A2 show or
  store.
- `locks.ts`: `type PartRequestRow = typeof partRequests.$inferSelect`; `type ReplyRow = typeof
  partRequestReplies.$inferSelect`; `type PartRequestColumns = typeof partRequests` (alias-able table for SQL builders);
  `partRequestNotFound(): NotFoundError` (`PART_REQUEST_NOT_FOUND`); `lockPartRequest(tx, id, mode: 'no_key_update' |
  'share', opts?: { skipLocked?: boolean }): Promise<PartRequestRow | null>` (null when missing or, with `skipLocked`,
  taken; callers turn null into `partRequestNotFound()` or a skip);
  `lockPartRequestsInOrder(tx, ids: string[]): Promise<PartRequestRow[]>` (`FOR NO KEY UPDATE`, id order);
  `lockOwnBusiness(tx, businessId)` (re-exports `lockBuyerBusiness`). Doc comment states §9.5 and "never `FOR UPDATE`".
- `lifecycle.ts`: `writeRequestStatus(tx, row: PartRequestRow, action: PartRequestAction, set?: Partial<typeof
  partRequests.$inferInsert>): Promise<PartRequestRow>` — the **only** writer of `part_requests.status`; target from
  `partRequestTransition` (restore uses `row.return_status` and `expires_at < now()`); conditional `UPDATE … WHERE id
  AND status = row.status`; 0 rows or illegal → `409 PART_REQUEST_TRANSITION_NOT_ALLOWED { from, action }`; sets
  `updated_at`; `remove` stores `return_status = from`, `removed_at`; queues `part_request:updated { partRequestId,
  reason: 'status' }` for system / admin actions (D13).
- `reply-fit.ts`: `replyFitReason(req: { kind; side; conditionIds: string[]; rootPath: string }, listing: { kind; side;
  conditionId: string | null; categoryPath: string | null }): Exclude<ReplyFitReason, 'replied'> | null` (pure: kind,
  category under the request's machine category root, `requestSideAccepts`, condition in list or list empty);
  `replyFitReasons(conn, request: PartRequestRow, listingIds: string[]): Promise<Map<string, ReplyFitReason | null>>`
  (adds `replied` for a pending / delivered / withdrawn reply on the request).

- [x] **Step 1: Failing tests** (`f8-eligibility.test.ts`, through `isEligibleSeller` on real rows; a baseline
  eligible seller, then one change per case): seller without pincode → false; seller owner suspended → false; own
  business → false; buyer owner suspended → false and back to true on reinstatement; block buyer → seller and seller →
  buyer → false; `verified_only` + unverified seller → false, `any_seller` → true; profile category with `buy` only
  activity and no listing → false, with `sell` → true; no profile category but a live listing in a **child** part group
  of the request's machine type → true, a listing under a sibling machine type → false, a paused listing → false;
  request `closed` → false, but true for a seller with a reply on it; `eligibleSellerCount` equals the number of true
  cases among the fixtures; `requestRoleFor` buyer / seller / null; `writeRequestStatus` refuses a second `close`
  (`PART_REQUEST_TRANSITION_NOT_ALLOWED`) and a stale row (status changed underneath); `replyFitReason` returns each of
  `kind`, `category`, `side`, `condition`, and null.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### C0-3b: Queue insert, grouped rows, drops, photos, emits

**Ports:** textile `services/requirements/reply-view.ts`, `services/alerts/alert-rows.ts`; F6
`services/notifications/chat-rows.ts`.

**Files:** Create `apps/api/src/services/part-requests/{work-queue,reply-drops,emit,reply-views}.ts`,
`apps/api/src/services/notifications/request-rows.ts`; Modify `services/notifications/notify.ts`,
`services/notifications/notification-read.service.ts` (maps `partRequestId` onto `NotificationRow`),
`services/chat/private-photo.ts`, `lib/group-limit.ts`; Test `apps/api/__tests__/f8-seams.test.ts`.

**Interfaces:**
- `work-queue.ts`: `enqueuePartRequestWork(tx, kind: PartRequestWorkKind, subjectId: string): Promise<void>` (one
  `INSERT … ON CONFLICT DO NOTHING` on `part_request_work_unclaimed_uq`); `enqueueListingsChanged(tx, listingIds:
  string[]): Promise<void>` (one multi-row insert, same conflict rule).
- `notify.ts`: `NotifyInput.destination.partRequestId?: string`; `NotifyInput.push?: boolean` (default true; false → rows
  without deliveries, D6); writes `notifications.part_request_id`.
- `request-rows.ts`: `upsertRequestNotification(tx, input: { type: 'part_match' | 'part_request_reply'; partRequestId:
  string; recipientBusinessId: string; params: Record<string, string | number | null>; eventKey: string; push: boolean
  }): Promise<void>` — per active member: `INSERT … (dedupe_key = eventKey) ON CONFLICT (user_id, part_request_id,
  type) WHERE type IN ('part_match','part_request_reply') AND read_at IS NULL DO UPDATE SET unread_count + 1, params =
  excluded.params, updated_at = now(), version = version + (push ? 1 : 0)`; callers call it only for an event that
  happened once (a match row just inserted with `RETURNING`, a reply whose conditional `pending → delivered` / insert
  just succeeded), and the `(user_id, dedupe_key)` unique on the row's first key stops a repeat of the opening event
  from starting a second row after the first was read; a delivery `queued` per device of a
  push-enabled user only when `push`; `notification:new` queued. `markRequestNotificationsRead(tx, userId,
  partRequestId): Promise<void>`.
- `reply-drops.ts`: `dropReply(tx, reply: ReplyRow, reason: PartRequestDropReason, opts: { notifySeller: boolean }):
  Promise<void>` (`status = 'dropped'`, `drop_reason`, `dropped_at`, conditional on `status = 'pending'`; when
  `notifySeller`, `part_request_reply_dropped` to the seller business, dedupe `part_request_reply_dropped:<replyId>`,
  params `{ requestTitle (masked), reason }`); `dropPendingRepliesForRequest(tx, request: PartRequestRow, reason:
  'request_closed' | 'request_expired' | 'request_removed'): Promise<number>` (each seller told).
- `emit.ts`: `emitRequestUpdated(tx, request: { id: string; businessId: string }, reason: 'reply' | 'match' | 'status'):
  void` (`queueBusinessEmit(tx, businessId, 'part_request:updated', { partRequestId, reason })`).
- `reply-views.ts`: `sellerReplyViews(conn, partRequestId, sellerBusinessId): Promise<SellerReplyView[]>` (message
  masked; `seenByBuyer = buyer_viewed_at IS NOT NULL`); `maskedRequestName(name: string): string`.
- `private-photo.ts`: `PhotoDestination` + `{ kind: 'part_request'; partRequestId: string }` →
  `part-request/<id>/<uuid>.jpg`; `finalizePrivatePhotos(businessId, keys, dest, opts?: { max?: number })` — default max
  per destination (chat `CHAT_LIMITS.photosPerMessage`, deal as today); `TOO_MANY_PHOTOS` details carry the max used.
- `group-limit.ts`: `RateGroup` + `'part_request' | 'part_request_reply' | 'part_request_feedback'` (D10).

- [x] **Step 1: Failing tests** (`f8-seams.test.ts`): two `enqueuePartRequestWork` for one listing → one row; after
  setting `claimed_at` on it, a third call inserts a new row and returns within 1 s while another transaction holds the
  claimed row `FOR UPDATE` (`SET LOCAL lock_timeout = '1s'`); `notify({ push: false })` → rows, zero deliveries;
  `upsertRequestNotification` — first event one row per member with `unread_count` 1, version 1, one delivery per
  push-enabled device; second event with `push: true` → count 2, version 2, a delivery for version 2; third event with
  `push: false` → count 3, version still 2, no new delivery; after `markRequestNotificationsRead`, the **first** event's
  key again → no new row (dedupe reasoning: the open row stores only its opening event's key; grouping is by the
  partial unique index, so later events' repeats are prevented upstream, where each event is a one-time row change — the
  A2-3 / A2-4 tests pin that), and a new event key starts a new row; category `requests`; `dropPendingRepliesForRequest`
  drops pending only (delivered untouched) and writes one `part_request_reply_dropped` per pending reply;
  `finalizePrivatePhotos` with 4 keys and `{ max: 3 }` → `TOO_MANY_PHOTOS` before any storage call (spy), chat with 5
  still passes the count check.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `f6-seams.test.ts`, `private-photo.test.ts` still pass.
  **Step 5: Stage.**

### C0-4a: Listing and F6 hooks (real bodies)

**Files:** Create `apps/api/src/services/part-requests/listing-hooks.ts`; Modify
`services/listings/listing-lifecycle.service.ts` (`writeStatus`), `services/listings/listing-write.service.ts`
(`createListing`, `patchListing`, `deleteDraft`), `services/listings/listing-admin.service.ts` (`adminPatchListing`),
`services/listings/listing-view.service.ts` (`toOwnerView`), `routes/listings.ts` (`createBody`),
`services/business/profile.service.ts` (`setMyLocation`), `services/offers/accept.service.ts`,
`apps/api/__tests__/{saved-listings,discovery-schema}.test.ts` (their direct listing deletes first delete the listings'
`part_request_work` rows, or call `deleteF8Rows`); stub files `services/part-requests/listing-prefill.ts` (A2) and
`services/part-requests/fulfil-prompt.ts` (A3); Test `apps/api/__tests__/f8-listing-hooks.test.ts`.

**Rules (§8.1, §9.3, §9.4, §20):**
- `writeStatus`: after the history insert, when `to ∈ {live, removed, rejected}` and `listing.kind !== 'machine_rental'`
  → `enqueuePartRequestWork(tx, 'listing_changed', listing.id)`. Nothing else in the listing write.
- `listing-hooks.ts`: `matchRelevantChange(before: ListingRow, after: ListingRow, fitmentsTouched: boolean): boolean`
  (title, `part_number_norm`, side, `category_id`, `condition_id`, the listing's own location (`search_point` / point,
  state), fitments, its `listing_machines` brand / model / year, or available quantity rising from 0); `fitmentsTouched`
  covers both child tables; `patchListing` **and `adminPatchListing`** (category, side, fitments) call it when
  `after.status === 'live'` and enqueue; `setMyLocation` enqueues the business's `live` part / machine listings whose
  location source is the business, via `enqueueListingsChanged`.
- `deleteDraft`: deletes the draft's `part_request_replies` rows first (silent, §9.3).
- `toOwnerView`: `partRequestId` and `pendingRequestReply` from the listing's pending reply (D4), name masked.
- `routes/listings.ts`: `createBody = z.object({ kind: z.enum(LISTING_KINDS), partRequestId: z.string().uuid().optional()
  }).strict()`. `createListing(tx, user, input: { kind: ListingKind; partRequestId?: string })`: after the business lock
  and the onboarding check, `const prep = await preparePendingReply(tx, { userId, businessId }, input.partRequestId,
  input.kind)` (checks 1–2 of §9.3), **then** F2's `DRAFT_LIMIT`, then the insert with `prep?.listingValues` spread over
  the defaults, then `await applyDraftPrefill(tx, prep, row)` (fitments / machine row / pending reply), **then** F2's
  existing `refreshListingSearch(tx, [row.id])` (moved after the prefill so the search text sees it). Stubs (A2,
  `listing-prefill.ts`): `interface PendingReplyPrep { request: PartRequestRow; listingValues: { kind: ListingKind;
  title: string; titleNorm: string; partNumber: string | null; partNumberNorm: string | null; partNumberBase: string |
  null; side?: PartSide; categoryId: string | null } }` (`side` present only for Left / Right / Pair: a `side: null`
  never overrides the part default `not_applicable`);
  `preparePendingReply(tx, seller: { userId: string; businessId: string }, partRequestId: string | undefined, kind:
  ListingKind): Promise<PendingReplyPrep | null>` (stub: null); `applyDraftPrefill(tx, prep: PendingReplyPrep | null,
  listing: ListingRow): Promise<void>` (stub: no-op).
- `acceptOffer`: after `createDealFromOffer` (returns `{ dealId, ref, status, version }`), `await
  notifyFulfilPrompts(tx, { dealId: deal.dealId, listingId: offer.listingId, buyerBusinessId: offer.buyerBusinessId,
  sellerBusinessId: offer.sellerBusinessId })` — stub (A3, `fulfil-prompt.ts`): `notifyFulfilPrompts(tx, d: { dealId:
  string; listingId: string; buyerBusinessId: string; sellerBusinessId: string }): Promise<void>`.

- [x] **Step 1: Failing tests** (`f8-listing-hooks.test.ts`; each case starts with no work row for the listing and
  ends with exactly one unclaimed `listing_changed` row): publish that goes straight live; admin approve; resume;
  renew; relist; admin unhide; unreserve after an F6 deal cancel (`insertTestDeal` on the whole quantity, then the
  cancel path that releases the hold and calls `syncReservation`); seller remove; admin remove; moderation reject;
  bulk admin unhide of two listings → one row each; a `machine_rental` going live → none; pause → none; a live
  listing's PATCH of the title → one, of the description → none, of quantity from fully held to more → one, of its own
  location → one; an admin PATCH of a live listing's side → one; a machine listing's `listing_machines` model change →
  one;
  `setMyLocation` → one row per live listing of the business, none for its drafts; publish then resume before any claim
  → still one row; `deleteDraft` of a draft with a pending reply → reply row gone, draft gone; `toOwnerView` of that
  draft before deletion shows `pendingRequestReply` with the masked name.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `listings-*.test.ts`, `listings-holds.test.ts`,
  `offers-accept.test.ts` still pass. **Step 5: Stage.**

### C0-4b: Stubs, route stubs, RBAC, jobs, Sentry, badges, admin business count

**Files:** stub files for every cross-lane function below; route stubs `routes/part-requests.ts`,
`routes/part-request-replies.ts`, `routes/admin/part-requests.ts`; Modify `app.ts` (register the three),
`jobs/index.ts`, `routes/badges.ts`, `lib/sentry.ts` (`SECRET_KEYS` + `message`; `name` stripped only from request
bodies of `/part-requests` routes, not through the global key list, so other events keep their names),
`services/admin/business-admin.service.ts` (`partRequestCount`: one count query); Test
`apps/api/__tests__/f8-routes.test.ts`.

- **Stubs (`// F8-STUB(<lane>)`):** A1 `requestsForYouCount(conn, user: UserTokenPayload): Promise<number>`
  (`services/part-requests/request-counts.ts`); A2 `runPartRequestWork(app: TxApp): Promise<{ processed: number }>`
  (`work-job.ts`), `demandRequestIds(conn, listingId: string, sellerBusinessId: string): Promise<string[]>`
  (`demand.ts`); A3 `expirePartRequests(app: TxApp): Promise<{ expired: number }>`,
  `notifyExpiringPartRequests(app: TxApp): Promise<{ notified: number }>`, `deletePartRequestHistory(db: Db):
  Promise<number>` (`request-jobs.ts`); plus C0-4a's.
- **Route stubs** (handler `throw new AppError(501, 'NOT_IMPLEMENTED')`, final preHandlers, `config: { idempotent:
  true }` on the **I** routes of §12.2, rate limits wired now): A1 file — `GET /part-requests/options` (**public**: `fastify.optionalUser`, no `requireUser`; settings only, so the
  guest No results card can read `reachN`; `openCount` / `postsLeftToday` / `openLimit` are null for a guest), `POST
  /part-requests/photos/presign` (`perUser(30)`), `POST /part-requests` **I**, `PATCH /part-requests/:id` **I**,
  `POST /part-requests/:id/renew` **I**, `…/close` **I**, `…/fulfil` **I** (these five `groupRateLimit('part_request',
  30, 600)`), `POST /part-requests/:id/read` (no viewer refusal), `GET /part-requests/mine`, `GET /part-requests/home`,
  `GET /part-requests/for-sellers`, `GET /part-requests/:id`, `GET /part-requests/:id/replies`, `…/matches`,
  `…/compare`, `…/photos`, `POST` + `DELETE /part-requests/:id/not-relevant` (`groupRateLimit('part_request_feedback',
  60, 600)`), `POST /part-requests/:id/report`; A2 file — `GET /part-requests/:id/reply-options`, `POST
  /part-requests/:id/replies` **I**, `POST /part-requests/:id/replies/:replyId/withdraw` **I** (both
  `groupRateLimit('part_request_reply', 20, 600)`), `GET /listings/:id/part-request-demand`; A3 file — `GET
  /admin/part-requests`, `GET /admin/part-requests/:id`, `GET /admin/part-requests/:id/photos`, `POST
  /admin/part-requests/:id/remove`, `POST /admin/part-requests/:id/restore`, all `requireAdminRole('moderator',
  'support')`. Every user write except `read` carries `refuseViewer`.
- **Jobs** in `jobs/index.ts`: `part-request-work` every 10 000 ms → `runPartRequestWork(app)`; `part-request-expiry`
  3 600 000 → `expirePartRequests(app)`; `part-request-expiring-soon` 3 600 000 → `notifyExpiringPartRequests(app)`;
  `part-request-retention` 86 400 000 (`firstRunMs` 1 200 000) → `deletePartRequestHistory(app.db)`.
- `routes/badges.ts`: `requestsForYou: await requestsForYouCount(conn, user)`.

- [x] **Step 1: Failing tests** (`f8-routes.test.ts`): table over every new route — 401 without a token (except the
  public `GET /part-requests/options`, 200 for a guest); each admin route 403 for `operations` and `category_manager`,
  not 403 for `moderator`, `support`, `super_admin`; a viewer gets `403 VIEWER_READ_ONLY` on every user write except
  `POST /part-requests/:id/read`; `redact` drops `note`, `message`, `photoKeys`, and `name` only inside a
  `/part-requests` request body (a `name` elsewhere survives). (The settings cross-checks are tested once, in C0-1.)
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `pnpm --filter @mpm/api typecheck`. **Step 5: Stage.**

### C0-5: App contracts

**Files (`apps/user-app`):** Modify `navigation/types.ts`, `navigation/root-navigator.tsx` (register every screen);
Create placeholder screens (title + `testID` only): `screens/requirements/{post-requirement,requirement-posted,
my-requirements,requirement-buyer,compare-responses}.tsx` (B2), `screens/requirements/{requirement-seller,
reply-with-listing,buyers-looking}.tsx` (B3); placeholder components with final props:
`components/part-requests/HomeBuyerStrip.tsx` (B2) `{ data: NonNullable<PartRequestHome['buyer']> }`,
`HomeSellerStrip.tsx` (B3) `{ data: NonNullable<PartRequestHome['seller']> }`; Create (real bodies):
`screens/requirements/requirement.tsx` (fetches `GET /part-requests/:id`; loading skeleton; 404 → "This requirement is no
longer open" state; renders `RequirementBuyer { view: PartRequestBuyerView; tab? }` or `RequirementSeller { view:
PartRequestSellerView }` by `role`), `lib/part-requests-api.ts` (one typed function per route of §12.2 incl.
`fetchReplyOptions`, `sendReplies`, `withdrawReply`, `fetchDemand`; every write passes an `Idempotency-Key` uuid made per
tap), `lib/query-keys.ts` (`qk.partRequestsMine(status)`, `qk.partRequest(id)` = `['part-request', id]`,
`qk.partRequestReplies(id)`, `qk.partRequestMatches(id)`, `qk.partRequestCompare(id)`,
`qk.partRequestsForSellers(tab, kind, forListing)`, `qk.partRequestHome()`, `qk.partRequestOptions()`,
`qk.replyOptions(id)`, `qk.partRequestDemand(listingId)`; list keys start `['part-requests', …]`),
`lib/socket-part-requests.ts` (`handlePartRequestEvent(queryClient, event, data)` invalidates `['part-request', id]` and
`['part-requests']`), `hooks/useSocket.ts` (route `part_request:` prefix), `hooks/use-part-request-home.ts`
(`usePartRequestHome()`), `lib/part-request-display.ts` + test (`requestStatusTone(status)`, `requestStatusKey(status)`,
`matchedBadge(v)`, `daysLeftKey(days)`, `sideAcceptKeys(side)`), `lib/f8-errors.ts` + test (every
`PART_REQUEST_ERROR_CODES` code → an `errors.*` key), `lib/notification-links.ts` (+ test: every `part_*` type →
`{ screen: 'Requirement', params: { partRequestId, tab } }`, tab `replies` for `part_request_reply`, `matches` for
`part_match`, none otherwise; `NotificationTarget` + `partRequestId`; `parsePushData` reads `data.partRequestId`, so a
push tap opens the same screen), `lib/pending-action.ts` + test (`PendingAction` +
`{ type: 'post_request'; prefill: PartRequestPrefill }`; `pendingRoute` → `'request'`; `isPendingAction` validates it),
`hooks/use-saved.ts` (`runPendingAction` hands `request` to `openPendingRequest`), `hooks/use-pending-request.ts` (stub
`openPendingRequest(prefill: PartRequestPrefill): void`, B2 fills: navigate to `PostRequirement { prefill }`, never
posts), `lib/sign-in-gate.ts` + test (`SIGN_IN_REASONS` + `request`), `lib/analytics-events.ts` (`REQUEST_EVENTS`
exactly as §13.3), `lib/error-reporting.ts` (redaction keys `note`, `message`, `name`, `photoKeys`), `lib/listing-api.ts`
(`createListing(kind, partRequestId?)`); Modify `screens/tabs/post.tsx` ("A requirement" card → `PostRequirement {
prefill: { source: 'post_tab' } }` replacing the toast; row "My requirements"), `screens/tabs/home.tsx` (mounts the two
strips when `usePartRequestHome()` returns them), `screens/profile.tsx` (rows "My requirements · n active" from
`GET /part-requests/options` `openCount`, "Buyers looking for your parts · n new" from `Badges.requestsForYou`);
Create `locales/{en,hi,gu}/{requirements,buyers}.json` (one `title` key each), register them in `locales/index.ts`;
Modify `locales/*/errors.json` (§15 new codes, three languages), `locales/*/auth.json` (reason `request`),
`locales/*/{post,profile,home}.json` (the card, rows and strip headers above).

`navigation/types.ts`: `PostRequirement: { prefill?: PartRequestPrefill; editId?: string; copyFromId?: string }`,
`RequirementPosted: { partRequestId: string; backfill: number }`, `MyRequirements: undefined`, `Requirement: {
partRequestId: string; tab?: 'replies' | 'matches' }`, `CompareResponses: { partRequestId: string }`,
`ReplyWithListing: { partRequestId: string }`, `BuyersLooking: { forListing?: string }`. Preview is a step inside
`PostRequirement`, not a route.

- [x] **Step 1: Failing tests (pure):** `notificationLink` for the 8 types; `pendingToRun` returns `post_request` with
  its prefill only after sign-in + onboarding and `pendingRoute` sends it to `request`, never to save; `SIGN_IN_REASONS`
  has `request`; every `PART_REQUEST_ERROR_CODES` code has a key in en / hi / gu; `requestStatusTone` covers the five
  statuses; i18n parity and audit pass.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; app typecheck; style audit. **Step 5: Stage.**

**C0 exit:** typecheck, lint; API, admin, app suites green one package at a time; **after the full API suite**
`countF8Rows` on `mpm_test` is all zeros (work rows included); review (focus: schema matches §5 column for column, 0014 never uses the new enum values, every stub
marked, eligibility SQL against §6, hook coverage of §8.1, route RBAC table); controller commits and pushes
(milestone: contracts), then creates the wave A worktrees.

---

# Wave A — API lanes (parallel: A1, A2, A3)

## Lane A1 — API requests

### A1-1: Post, options, photos

**Ports:** textile `services/requirements/{requirement-input,requirement.service}.ts`, `routes/requirements.ts`.

**Files:** Create `services/part-requests/{request-input,request.service,request-photos,buyer-view}.ts`; Modify
`routes/part-requests.ts` (`GET /options`, `POST /photos/presign`, `POST /`); Test
`apps/api/__tests__/part-requests-post.test.ts`.

**Interfaces:**
- `partRequestInputSchema` (Zod, strict; `PartRequestInput`; name 3–100 after trim, partNumber ≤ 60, fits ≤ 5,
  conditionIds ≤ 10, note ≤ 500, photoKeys ≤ 3, `neededBy` `YYYY-MM-DD`, `budgetPerUnitPaise` int 1 … 2 147 483 647) and
  `partRequestPatchSchema` (`version` int ≥ 1 + every field but `kind` optional; a `kind` key → `400 KIND_IMMUTABLE`).
- `resolveRequestFields(conn, input: PartRequestInput | PartRequestPatch, current: PartRequestRow | null):
  Promise<ResolvedRequestFields>` — category (`requestCategoryNode`, `400 CATEGORY_INVALID`; on edit another machine
  category root → `409 CATEGORY_LOCKED`), side (`SIDE_REQUIRED` / `SIDE_NOT_ALLOWED`, never `not_applicable`), part
  number (parts only; norm + base via `normalizePartNumber` / `partNumberBase`), specs (only on a node at the kind's
  template level; `checkSpecs` with `required` errors dropped; `400 SPECS_INVALID`), unit (parts: active unit,
  `UNIT_INVALID`, `UNIT_DECIMALS`; machines: the machine unit, quantity default 1), conditions (`CONDITION_INVALID`),
  fits (`BRAND_INVALID` active + `makes_machines`, `MODEL_INVALID` of the brand and, for machines, of the request's
  type, `FITMENT_INVALID` years), `needed_by` in today … today + 365 IST, `name_norm = normalizePartName(name)`,
  `note_flagged = looksLikeScam(note)`, validity in the three settings (`VALIDITY_INVALID`).
- `createPartRequest(app: TxApp, user: UserTokenPayload, input: PartRequestInput): Promise<PartRequestBuyerView>` —
  before any storage work: `readStoredResponse` (idempotent replay), `onboardingForUser`, `resolveRequestFields`, and an
  **unlocked** pre-check of the open and daily limits (so a refused post never copies photos); then generate the uuid
  and `finalizePrivatePhotos(businessId, keys, { kind: 'part_request', partRequestId }, { max: 3 })`; then `runTx`:
  `lockOwnBusiness`, the limits again under the lock (`409 PART_REQUEST_OPEN_LIMIT { limit }`, `429
  PART_REQUEST_DAILY_LIMIT`), insert with the location snapshot (`businessPointSql`, city, state, pincode, area),
  fitments, `expires_at = now() + days`, `enqueuePartRequestWork(tx, 'target_request', id)`. If the transaction throws,
  the final photo copies are deleted (best-effort, logged) before the error is rethrown. Same pattern for PATCH with new
  photos.
- `presignRequestPhoto(user, body: { contentType; contentLength })` → `presignPrivatePhoto(businessId, …)`.
- `getPartRequestOptions(conn, user: UserTokenPayload | null): Promise<PartRequestOptions>` (public route; the
  business counts null for a guest).
- `buyerView(conn, row: PartRequestRow): Promise<PartRequestBuyerView>` (name and note masked; `counts`, `targetedCount`,
  `fulfilPrompt`: any non-cancelled deal (`agreed`, `handed_over`, `disputed`, `completed`) of the buyer business on a
  delivered-reply or match listing while `active`; `photoKeys` (buyer only); `renewableUntil = first_posted_at +
  max_days`).

- [x] **Step 1: Failing tests:** 4th active request for an unverified business → `PART_REQUEST_OPEN_LIMIT`, 16th for a
  verified one (settings lowered to 2 / 3 for speed and restored; assert the boundary, not the default); 6th post of the
  IST day → `PART_REQUEST_DAILY_LIMIT` (setting lowered); a part on a node with sides without side → `SIDE_REQUIRED`,
  with a side on a node without → `SIDE_NOT_ALLOWED`; a machine request with `partNumber` → 400; a spec left empty on a
  required field accepted, an invalid option → `SPECS_INVALID`; machine request gets the machine unit and quantity 1;
  6 fits → 400; a model of another brand → `MODEL_INVALID`; `validityDays` 10 → `VALIDITY_INVALID`; onboarding not done
  → `ONBOARDING_INCOMPLETE`; viewer → 403; created row has `point` from the business pin and one `target_request` work
  row; a scam note sets `noteFlagged`; a photo key of another business → `PHOTO_KEY_INVALID` and no request row; the
  same `Idempotency-Key` twice → one row, same body, `finalizePrivatePhotos` called once (spy); a post refused by the
  open limit or by `SIDE_REQUIRED` never calls `finalizePrivatePhotos` (spy); a transaction failure after finalizing
  (forced) deletes the final keys (storage mock records the deletes); response `name` masks `+91 98765 43210`.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A1-2: Edit, renew, close, fulfil, read

**Files:** Modify `services/part-requests/request.service.ts`, `routes/part-requests.ts` (`PATCH /:id`, `/renew`,
`/close`, `/fulfil`, `/read`); Test `apps/api/__tests__/part-requests-lifecycle.test.ts`.

**Interfaces:** `editPartRequest(app, user, id, patch: PartRequestPatch)` (request lock only; `active` else
`PART_REQUEST_TRANSITION_NOT_ALLOWED`; `version` mismatch → `409 PART_REQUEST_STALE`; `version + 1`; location
snapshot refreshed; `photoKeys`, when present, is the **full final list**: keys already stored on the request are kept,
`incoming-chat/` uploads are finalised (before the tx, A1-1's pattern), stored keys left out are removed from the row
(their objects deleted after commit, best-effort), anything else → `PHOTO_KEY_INVALID`; a `validityDays` key → 400
(strict schema: renew owns validity); a change of a matching field (category, name, part
number, side, fits, conditions, reach, audience, quantity / unit) → `target_request`; delivered replies and matches
untouched); `renewPartRequest(app, user, id, body: { days: number })` (always `lockOwnBusiness` first, then the
request; from `expired` the open limit; `expires_at = max(now, expires_at) + days` ≤ `first_posted_at + max_days` → else `409
PART_REQUEST_MAX_DAYS`; resets `expiring_notified_at`; from `expired` enqueues `target_request`); `closePartRequest(app,
user, id, body: { reason: PartRequestCloseReason })`; `fulfilPartRequest(app, user, id, body: { dealId?: string })`
(`dealId` must be a deal whose buyer is this business, else `400 DEAL_INVALID`; sets `fulfilled_deal_id`,
`fulfilled_at`); close and fulfil call `dropPendingRepliesForRequest(tx, row, 'request_closed')`;
`markPartRequestRead(app, user, id)` (buyer business only, else 404; D7; locks the request `FOR NO KEY UPDATE` first,
then marks the notifications, replies and matches, then sets `buyer_seen_at`). All return `PartRequestBuyerView` except read
(`{ ok: true }`). Zod bodies: `{ days: z.number().int() }`, `{ reason: z.enum(PART_REQUEST_CLOSE_REASONS) }`,
`{ dealId: z.string().uuid().optional() }`.

- [x] **Step 1: Failing tests:** each buyer row of §9.1 through the routes (edit, renew from `active` and from `expired`,
  fulfil, close) and the refused ones (edit / close / fulfil on `closed`, renew on `fulfilled`) →
  `PART_REQUEST_TRANSITION_NOT_ALLOWED`; PATCH with an old `version` → `PART_REQUEST_STALE`; edit moving the category to
  another machine category → `CATEGORY_LOCKED`; renew past 90 days from `first_posted_at` (moved back 80 days, renew 15)
  → `PART_REQUEST_MAX_DAYS`; renew from `expired` with the open limit full → `PART_REQUEST_OPEN_LIMIT`, with room →
  `active` + a `target_request` row; an edit of the name enqueues, an edit of the note doesn't; PATCH `photoKeys` with
  one kept key and one new upload → the row holds exactly those two and the dropped key's object is deleted after
  commit; PATCH with `validityDays` → 400; fulfil with another
  business's deal → `DEAL_INVALID`; close with one pending and one delivered reply → pending `dropped`
  (`request_closed`) and the seller has one `part_request_reply_dropped`, delivered untouched; `read` by a buyer
  member marks that user's grouped rows read, sets `buyer_seen_at`, `buyer_viewed_at` on delivered replies and `seen_at`
  on matches; `read` by a seller → 404.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A1-3: Buyer reads: mine, detail, replies, matches, compare, photos, home

**Ports:** textile `services/requirements/{requirement-view,reply-view}.ts`, compare in `requirement.service.ts`.

**Files:** Create `services/part-requests/{request-read.service,compare.service,home.service}.ts`; Modify
`routes/part-requests.ts` (`GET /mine`, `GET /:id` dispatch (D3, seller branch from A1-4), `GET /:id/replies`,
`/matches`, `/compare`, `/photos`, `GET /home`); Test `apps/api/__tests__/part-requests-buyer-read.test.ts`.

**Interfaces:** `listMyPartRequests(conn, user, q: { status: 'active' | 'fulfilled' | 'closed'; cursor?: string }):
Promise<{ items: MyPartRequestRow[]; nextCursor: string | null; counts: { active; fulfilled; closed } }>` (D15);
`listReplies(conn, user, id): Promise<{ items: PartRequestReplyItem[] }>` (delivered only, not withdrawn, sellers not
blocked either way, public listings first; `loadCards` with the public mapper; `SellerScore` via `sellerScore`);
`listMatches(conn, user, id): Promise<{ items: PartRequestMatchItem[] }>`; `compareColumns(conn, user, id): Promise<{
columns: CompareColumn[] }>` (public replies then matches, deduped by listing, ≤ 10, distance from the request point
by `snappedKmBetweenSql`, `lowestPrice` on the lowest fixed
or negotiable price per unit, `contactAction` from the listing's price model: fixed → `buy`, negotiable → `offer`,
on request → `ask_price`, not public → `enquire`); `requestPhotoUrls(conn, user, id): Promise<{ photos: { url;
expiresAt }[] }>` (buyer or eligible seller; 300 s); `partRequestHome(conn, user): Promise<PartRequestHome>` (buyer
strip: the active request with the most recent unseen item, tie newest request; `newCount` = unseen matches + unseen
delivered replies created after `buyer_seen_at`; `nearestKm` the nearest of those; seller strip from A1-4's
`listForSellers(…, 'matched')` top 3 and `requestsForYouCount`, null per D17).

- [x] **Step 1: Failing tests:** `GET /:id` for the buyer: `role: 'buyer'`, budget present, `name` / `note` with
  `९८७६५४३२१०` and `૯૮૭૬૫૪૩૨૧૦` masked; `fulfilPrompt` set with an `agreed` deal on a delivered-reply listing, null
  after the deal is cancelled; replies list hides `pending`, `withdrawn`, `dropped` and a reply whose seller the buyer
  blocked, and masks the message; `fulfilPrompt` also set while that deal is `disputed`; compare dedupes a listing that is both reply and match, caps at 10 (12 fixtures),
  marks the lowest price; `mine` tabs and counts (`closed` tab includes `expired` and `removed`), cursor paging of 21
  rows; photos 404 for an ineligible business; home: two active requests, the one with the newer unseen match is
  chosen, `newCount` counts only items after `buyer_seen_at`, `nearestKm` is the stored snapped km.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A1-4: Seller reads, not relevant, report, badge count

**Ports:** textile `services/requirements/{eligibility,requirement-reports.service}.ts` (seller list), app seller list
ordering from `screens/requirements/seller-requirements.tsx`.

**Files:** Create `services/part-requests/{seller-read.service,seller-view,feedback.service,request-report.service,
request-counts}.ts` (replaces the `requestsForYouCount` stub); Modify `routes/part-requests.ts` (`GET /for-sellers`,
the seller branch of `GET /:id`, `POST` / `DELETE /:id/not-relevant`, `POST /:id/report`); Test
`apps/api/__tests__/part-requests-seller-read.test.ts`.

**Interfaces:** `listForSellers(conn, user, q: { tab: 'matched' | 'all' | 'replied'; kind?: PartRequestKind;
forListing?: string; cursor?: string }): Promise<{ items: SellerPartRequestRow[]; nextCursor; counts: { forYou; all;
replied } }>` (§12.3: `matched` = targeted or `hasMatchingStock`; not-relevant hidden from `matched` / `all`; order:
targeted by newest notice, then in reach by `hasMatchingStock` then newest, then outside the reach; distance between the
request point and the seller's business point by `snappedKmBetweenSql`; `forListing` via `demandRequestIds`, D16); `sellerView(conn, user, row):
Promise<PartRequestSellerView>` (sets `part_request_targets.opened_at` once; buyer block = trade name masked, city,
verified, `created_at` year; budget null when private; `myReplies` from `sellerReplyViews`; `canReply` = active,
non-viewer, `slotsLeft > 0`); `setNotRelevant(app, user, id, body: { reason?: PartRequestFeedbackReason })` /
`clearNotRelevant(app, user, id)` → `{ notRelevant: boolean }` (seller business lock → request `FOR SHARE`; eligible;
`active` else `409 PART_REQUEST_NOT_ACTIVE`; onboarding); `reportPartRequest(app, user, id, body: { reason:
PartRequestReportReason; details?: string })` → `{ reported: true }` (eligible sellers only; details required for
`other`, ≤ 500; `REPORT_EXISTS`; 10 a day per user `REPORT_LIMIT` as F2; `report:new` to `moderator` and `support`
rooms); `requestsForYouCount(conn, user)` (targeted, request active, `opened_at` null, no reply by the business, not
dismissed).

- [x] **Step 1: Failing tests:** the seller view and every `for-sellers` row carry no `phone`, `pincode`, `point`,
  `address`, `industrialAreaId` key (JSON key scan) and `budgetPerUnitPaise: null` when private, the value when
  visible; buyer trade name with a phone number masked; `GET /:id`, `/photos`, `not-relevant` and `report` answer 404
  for an ineligible business (a `verified_only` request read by an unverified seller, a blocked pair) and for a third
  business; `matched` tab holds the targeted and stock-holding sellers' requests, `all` adds the profile-only one;
  ordering targeted → in reach with stock → in reach → outside; not relevant hides from `matched` and `all`, the direct
  `GET /:id` still answers with `notRelevant: true`, `DELETE` undoes; not relevant on a closed request the seller replied
  to → `PART_REQUEST_NOT_ACTIVE`; report twice → `REPORT_EXISTS`; `requestsForYouCount` drops after the seller opens
  the request, after a reply, after not relevant.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

**A1 exit:** lane test files and `pnpm --filter @mpm/api typecheck` green; review (focus: every seller read through
`eligibleSellerSql`, 404 for outsiders, masking on every text path, no business lock after a request lock); controller
commits on `lane/f8-a1`.

## Lane A2 — API matching and replies

### A2-1: Work job

**Ports:** textile `jobs/requirement-jobs.ts` (batching), F6 `services/offers/offer-jobs.ts` (`runJobTx` per row),
F4 `services/discovery/refresh-jobs.ts` (queue table).

**Files:** Create `services/part-requests/work-job.ts` (replaces the stub); Test
`apps/api/__tests__/part-request-work.test.ts`.

**Interfaces:** `runPartRequestWork(app: TxApp, opts?: { batch?: number; handlers?: Partial<WorkHandlers> }):
Promise<{ processed: number; failed: number }>` — claim (one short committed tx): `UPDATE part_request_work SET
claimed_at = now(), attempts = attempts + 1 WHERE id IN (SELECT id … WHERE (claimed_at IS NULL AND next_attempt_at <=
now()) OR (claimed_at < now() - interval '10 minutes' AND done_at IS NULL AND failed_at IS NULL) ORDER BY
next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING *`; then per row `runJobTx`: handler + `done_at = now()` in
the same tx; on error, in its own tx: `attempts < 5` → if a newer unclaimed row for the same `(kind, subject_id)` exists
→ `done_at`, else `claimed_at = NULL`, `next_attempt_at = now() + [30 s, 2 min, 10 min, 1 h][attempts - 1]`,
`last_error = code` (an `AppError` code or `'internal'`); a `23505` on that un-claim (a newer unclaimed row arrived after
the check) is caught and the row gets `done_at` instead; `attempts = 5` → `failed_at`, logged with id and code only.
`interface WorkHandlers { target_request(tx: Tx, requestId: string): Promise<void>; listing_changed(tx: Tx, listingId:
string): Promise<void> }`, defaults `processTargetRequest` (`targeting.ts`) and `processListingChanged`
(`reply-delivery.ts`), created here as empty functions and filled by A2-2 and A2-4 (tests here inject handlers).

- [x] **Step 1: Failing tests** (handlers injected): three rows, the middle handler throws → rows 1 and 3 `done_at`,
  row 2 released with `next_attempt_at` ≈ now + 30 s and `last_error` set, and row 1's writes committed; a row failing
  for the 5th time → `failed_at`, and a new enqueue for the same subject inserts a fresh row; a failing row with a newer
  unclaimed row present → `done_at` instead of a retry; the same when the newer row is inserted between the check and
  the un-claim (the failing handler inserts it from another connection before throwing) → `done_at`, no error escapes;
  a row claimed 11 minutes ago with no `done_at` is reclaimed, one
  claimed 2 minutes ago isn't; two `runPartRequestWork` calls at once process each row once (`SKIP LOCKED`); an enqueue
  for a subject while its row is being processed (handler waits on a promise) inserts a second row immediately.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A2-2: Targeting and seller push caps

**Ports:** textile `services/requirements/matching.ts` (scoring, notified set), `matching.consumer.ts`.

**Files:** Create `services/part-requests/{targeting,push-caps}.ts`; Test `apps/api/__tests__/part-request-targeting.test.ts`.

**Interfaces:** `TARGET_WEIGHTS` (code constants exactly §7.2: part number 40 / base 30; category 15 / profile 5; name 15
× similarity when ≥ 0.3; fit 12 / no fit rows 3 / none 0; side 8; condition 5; quantity 5 (partial 5 × available /
wanted, other unit 2.5); distance 10 × max(0, 1 − d / D) with D 50 / 200 / 500 / 2 000, urgent 20; verified 5);
`topCandidatesSql(request: PartRequestRow, n: number): SQL` (one statement, §7.3: CTEs `cands` (every eligible seller
except Not relevant, **already-targeted sellers included**), `ls` (live public listings of the kind in the subtree with
listing scores), `best` `DISTINCT ON (business_id)`, profile-only `LEFT JOIN`, reach gate on best listing
`search_point` else business point, `ORDER BY score DESC, verified DESC, distance ASC, created_at ASC, business_id ASC
LIMIT n`; each row says whether a target row exists); `processTargetRequest(tx, requestId): Promise<void>` (request
lock `no_key_update`; skip if not `active`; take the top N; **newcomers** = those of the top N with no target row, in
rank order, capped at `2N − t` (t = target rows so far); insert them `ON CONFLICT DO NOTHING` with score, rank, pass,
`best_listing_id`; `allowSellerPushes`; one
`part_request_new` `notify` per new target (dedupe `part_request_new:<id>`, `push` from the cap, params
`requestTitle`, `side`, `quantity`, `unitLabel`, `city`); `target_pass + 1`, `targeted_at`; then
`backfillAtPost(tx, request)` from A2-3); `allowSellerPushes(tx, businessIds: string[], cap: number):
Promise<Set<string>>` (cap 0 → empty set, no insert; else ids sorted, one `INSERT … ON CONFLICT (business_id, day) DO
UPDATE SET pushes = pushes + 1 WHERE pushes < cap RETURNING business_id`, IST day).

- [x] **Step 1: Failing tests:** 20 eligible sellers, N = 15 → 15 targets ranked by score; a seller with an exact
  part-number listing ranks above a profile-only seller nearer by; two sellers equal on every term → the older business
  first (determinism); a seller outside `radius_50` not targeted, inside it targeted; `state` reach targets only
  same-state sellers; running `processTargetRequest` twice → no new targets, one notification per target; an edit that
  changes nothing material (same top N) notifies 0 sellers; an edit pass after two higher-scoring sellers appear adds
  exactly those two (the top N's newcomers), notifies only them, and a seller who dropped out of the top N keeps its row
  and is never re-notified; the stored set never exceeds 2N (N = 3, three passes each bringing 3 new top sellers → 6
  rows); a request no longer `active` → nothing; a seller already at 10 pushes today gets the `part_request_new` row
  with no delivery; cap 0 → no delivery and no `part_request_push_counts` row; two concurrent passes for two requests
  targeting the same seller with cap 1 → exactly one delivery; feedback (not relevant) excludes the seller.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A2-3: Auto matches, buyer caps, at-post backfill, demand

**Ports:** textile `services/alerts/{alerts.consumer,alert-rows}.ts` (match on going live, grouped row).

**Files:** Create `services/part-requests/{match-rule,auto-match,demand}.ts` (replaces `demandRequestIds`); Modify
`routes/part-request-replies.ts` (`GET /listings/:id/part-request-demand`); Test
`apps/api/__tests__/part-request-matches.test.ts`.

**Interfaces:** `matchRuleSql(listing: SQL alias, request: SQL alias, opts: { requireLive: boolean }): SQL` — §7.4
rules 2–7 (`requireLive: true` adds public + `live`; `false` for demand on a draft or a listing in review; available ≥ 1,
`requestSideAccepts` as SQL, part number norm / base ≥ 3 chars or (`similarity(l.title_norm, r.name_norm) ≥ 0.5` and (no
fits or fit overlap)); machines: fits → `listing_machines` overlap else name ≥ 0.5; reach (`ST_DWithin` raw metres,
state, all India; no point → only `state` / `all_india`); condition; audience, blocks, own business, public; not
already a pending / delivered reply); `insertNewMatches(tx, listing: ListingRow): Promise<NewMatch[]>` with `NewMatch
= { partRequestId: string; tier: PartRequestMatchTier; distanceKm: number | null }` — **no request lock**: one
`INSERT … SELECT … WHERE r.status = 'active' AND r.kind = l.kind AND r.category_id = ANY(categoryAncestorIds) AND
matchRuleSql(…, { requireLive: true })` over the 200 newest candidates (`ORDER BY r.created_at DESC LIMIT 200`),
`source = 'listing_live'`, tier, `distance_km` by `snappedKmBetweenSql(r.point, l.search_point)`, `ON CONFLICT DO
NOTHING RETURNING` (the FK takes only `KEY SHARE` on the request, compatible with every F8 request lock);
`notifyNewMatch(tx, request: PartRequestRow, listing: ListingRow, match: NewMatch): Promise<void>` — called by A2-4's
`processListingChanged` with the request **already locked**; skips when the request is no longer `active`; the buyer
cap (§7.5: reset `match_push_day_count` on a new IST day; push while day < daily cap and total < total cap, then
increment), `upsertRequestNotification(tx, { type: 'part_match', eventKey: 'part_match:<requestId>:<listingId>', push,
params })`, `emitRequestUpdated(…, 'match')`; `backfillAtPost(tx, request: PartRequestRow): Promise<number>` (the 20
best currently-live listings, nearest first, `requireLive: true`, `source = 'at_post'`, no notification); `demandRequestIds(conn, listingId,
sellerBusinessId): Promise<string[]>` and `listingDemand(conn, user, listingId): Promise<PartRequestDemand>` (owner
only, else `404 LISTING_NOT_FOUND`; any listing status, so `requireLive: false`; eligibility of this seller applied;
ids ≤ 10).

- [x] **Step 1: Failing tests:** side table on real rows (Left request ← Left and Pair listings match, Right listing
  doesn't; Pair request ← Pair only; request without side ← any); part-number match across separators (`AB-123/X` vs
  `ab 123 x`); a base match (a Left request `AB-123-L` matches a Pair listing numbered `AB123`, while a Right listing
  `AB123R` is refused by the side rule); a 2-character norm never matches; name ≥ 0.5
  with no fits matches, the same name with fits and no overlap doesn't, with overlap does; machine request with a fit
  matches a `listing_machines` brand + model overlap; reach: 40 km in `radius_50` ✓, 60 km ✗, `state` other state ✗,
  `all_india` ✓; a condition outside the list ✗; fully held listing ✗; `verified_only` + unverified seller ✗, blocked
  pair ✗, own business ✗; `insertNewMatches` completes while another transaction holds the request `FOR NO KEY UPDATE`
  (`lock_timeout = '1s'`); a request closed after the insert and before the lock pass keeps the match row but gets no
  notification; publish → pause → resume → renew → a title PATCH: one match row and one notification event in all; at-post backfill inserts `at_post` matches and no notification; buyer caps: with daily cap 2 three matches in a
  day push twice, the third updates the grouped row (count 3) without a version bump and a still-queued delivery for
  version 2 is sent by `sendDuePushes` (not skipped as stale); total cap reached → no push the next day; 201 candidate
  requests → 200 checked, the oldest left out; demand counts the requests a draft and a `pending_review` listing would
  match (`requireLive: false`) and 404s a non-owner.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A2-4: Replies: options, send, withdraw, new listing, delivery, drops

**Ports:** textile `services/requirements/{reply.service,replies.consumer}.ts`, app `reply-with-lot.tsx` (options).

**Files:** Create `services/part-requests/{reply.service,reply-options,listing-prefill,reply-delivery}.ts` (replaces
`preparePendingReply`, `applyDraftPrefill`); Modify `routes/part-request-replies.ts` (`GET /part-requests/:id/reply-options`,
`POST /part-requests/:id/replies`, `POST /part-requests/:id/replies/:replyId/withdraw`); Test
`apps/api/__tests__/part-request-replies.test.ts`.

**Interfaces:**
- `replyOptions(conn, user, id): Promise<{ listings: ReplyOption[]; slotsLeft: number; dailyLeft: number }>` (the
  seller's live listings of the request's kind, fitting first, each with `replyFitReasons`).
- `sendReplies(app, user, id, body: { listingIds: string[]; message?: string })` → `{ replies: SellerReplyView[] }` —
  Zod `{ listingIds: z.array(z.string().uuid()).min(1).max(3), message: z.string().max(300).optional() }`; onboarding;
  `lockOwnBusiness` → `lockPartRequest(…, 'share')`; eligible else 404; `active` else `PART_REQUEST_NOT_ACTIVE`; each
  listing own, live, public and fitting, else `400 REPLY_LISTING_INVALID { reasons: { [listingId]: reason } }`
  (`replied` → `409 REPLY_EXISTS`); per-request cap (`409 REPLY_LIMIT`), daily cap under the business lock (`429
  REPLY_DAILY_LIMIT`, D8); insert `delivered` with masked-on-read `message`, `message_flagged = looksLikeScam`;
  `upsertRequestNotification(type: 'part_request_reply', eventKey: 'part_request_reply:<requestId>:<replyId>', push:
  true, params { businessName, requestTitle })`; `emitRequestUpdated('reply')`; no stock hold, no thread.
- `withdrawReply(app, user, id, replyId)` → `SellerReplyView` (the replying business, non-viewer; `pending` /
  `delivered` → `withdrawn`, else `409 REPLY_NOT_OPEN`; other business → `404 REPLY_NOT_FOUND`).
- `preparePendingReply(tx, seller, partRequestId, kind)` (§9.3 order: request visible + eligible + `active` → caps;
  request locked `FOR SHARE` after the business lock createListing already holds; D11; builds `listingValues` with
  `titleNorm`, `partNumberNorm`, `partNumberBase` computed by the F2 normalisers, and `side` only when Left / Right /
  Pair, so the part default `not_applicable` is never overwritten by null) and `applyDraftPrefill(tx, prep, listing)`
  (identity prefill only: part-group category or null for a machine type, fitments → `listing_fitments`, a machine
  request's first fit → `listing_machines` brand + model; then the `pending` reply; runs before createListing's
  `refreshListingSearch`).
- `processListingReplies(tx, listing: ListingRow, locked: Map<string, PartRequestRow>): Promise<void>` — listing
  `live`: each pending reply re-checks its (locked) request's status (`request_closed` / `request_expired` /
  `request_removed`), blocks (`blocked`), `isEligibleSeller` (`not_eligible`), `replyFitReason` (`no_longer_fits`); all
  pass → conditional `pending → delivered` + `part_request_reply` grouped row + emit; `removed` → `listing_removed`
  silently or `listing_removed_by_team` with the seller told (D14); `rejected` → `listing_rejected`, seller told;
  anything else → nothing.
- `processListingChanged(tx, listingId): Promise<void>` (`reply-delivery.ts`, the work job's `listing_changed`
  handler), in this order: read the listing unlocked; when `live`, `insertNewMatches` (no request locks; a pending reply
  on L already excludes its request by §7.4 rule 7); then **one** `lockPartRequestsInOrder` pass over only the requests
  that got a new match or have a pending reply on L; then `processListingReplies` and `notifyNewMatch` for each new
  match under those locks. No second lock pass.

- [x] **Step 1: Failing tests:** send 2 listings → 2 delivered, buyer grouped row count 2; a 4th listing for the same
  request → `REPLY_LIMIT` (cap 3); daily cap lowered to 2 → 3rd → `REPLY_DAILY_LIMIT`; a listing on another machine
  category → `REPLY_LISTING_INVALID` with reason `category`, a Right listing on a Left request → `side`; same listing
  twice → `REPLY_EXISTS`; ineligible seller → 404; viewer → 403; two concurrent sends at the cap (slots 1) → one 200,
  one `REPLY_LIMIT`; withdraw → `withdrawn` and gone from the buyer's list, withdraw again → `REPLY_NOT_OPEN`;
  `POST /listings { kind: 'part', partRequestId }` on a part-group request → draft with that category, title, part
  number, side and fitments + one `pending` reply; on a machine-type request → `categoryId` null; machine request →
  `listing_machines` from the first fit; the draft's `title_norm`, `part_number_norm`, `part_number_base` and search
  text are filled, and a side-less request leaves `side = 'not_applicable'`; each failing check rolls back both (request closed → `PART_REQUEST_NOT_ACTIVE`,
  ineligible → 404, reply cap full → `REPLY_LIMIT`, drafts full → `DRAFT_LIMIT`: no listing and no reply row); kind
  mismatch → `REPLY_LISTING_INVALID`; the draft approved → job → `delivered` + notified; the buyer blocks the seller
  first → `dropped` `blocked`; audience flipped to `verified_only` with an unverified seller → `not_eligible`; seller
  owner suspended → `not_eligible`; seller removes the listing → `listing_removed`, no seller notification; admin
  removes → `listing_removed_by_team` + seller notified; moderation reject → `listing_rejected` + notified; request
  closed before approval → `request_closed` (dropped by close, nothing delivered later).
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

**A2 exit:** lane test files and typecheck green; review (focus: one tx per work row, matching SQL against §7.4 line by
line, caps atomic, lock order request → listing (KEY SHARE via FK) → child rows, prefill rollback); controller commits
on `lane/f8-a2`.

## Lane A3 — API jobs, notifications, fulfil prompt, admin

### A3-1: Expiry, reminder and retention jobs

**Ports:** textile `jobs/requirement-jobs.ts`, `services/notifications/reminders.ts`.

**Files:** Create `services/part-requests/request-jobs.ts` (replaces the three stubs); Test
`apps/api/__tests__/part-request-jobs.test.ts`.

**Interfaces:** `expirePartRequests(app)` (candidate ids `active AND expires_at <= now()` read unlocked; one `runJobTx`
per request: `lockPartRequest(tx, id, 'no_key_update', { skipLocked: true })` (null → skip), status re-checked,
`writeRequestStatus(…, 'expire')`, `dropPendingRepliesForRequest(…, 'request_expired')`, `part_request_expired` to the
buyer, dedupe `part_request_expired:<id>:<expires epoch>`); `notifyExpiringPartRequests(app)` (`active`, `expires_at -
part_request_expiring_notice_hours <= now()`, `expiring_notified_at IS NULL`; per request `lockPartRequest(…, { skipLocked: true })`;
`part_request_expiring`, dedupe `part_request_expiring:<id>:<expires epoch>`; sets the column);
`deletePartRequestHistory(db)` (done work rows and push-count rows older than 7 days, failed rows older than 30 days).

- [x] **Step 1: Failing tests:** an `active` request past `expires_at` → `expired`, its pending reply dropped
  `request_expired` with the seller told, one buyer notification; running the job twice → still one notification; a
  request locked by another transaction is skipped, not waited on (the job returns while the lock is held); expiry and a
  renew at once (`Promise.all`) → either renewed and `active` or expired, never `expired` with the renewed
  `expires_at`; the reminder fires once inside 24 h and again after a renew (column reset); retention deletes an 8-day-old
  done row, keeps a 2-day-old one and a 10-day-old failed one.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A3-2: Notification texts and push tag

**Files:** Modify `services/notifications/text/{types,en,hi,gu}.ts`, `services/notifications/render.ts` (params
`requestTitle` masked, `side` localised key, `distanceKm`, `city`), `services/notifications/push-sender.ts` (tag
`part_request:<partRequestId>:<type>` for `part_match` / `part_request_reply`; push `data.partRequestId`); Test
`apps/api/__tests__/part-request-notifications.test.ts`.

**Texts:** English exactly §10.3; Hindi and Gujarati translations of the same lines (grouped variants with `{count}`).
Params never include the note, message, budget, phone, pincode or address.

- [x] **Step 1: Failing tests:** each of the 8 types renders a non-empty title and body in en / hi / gu (grouped
  `part_match` with count 3 uses the grouped line); a `requestTitle` param containing `+91 98765 43210` and
  `૯૮૭૬૫૪૩૨૧૦` renders masked; `distanceKm` renders as the stored integer; the push built for a `part_match` row carries
  tag `part_request:<id>:part_match` and `data.partRequestId`.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `notifications.test.ts`, `push.test.ts` still pass.
  **Step 5: Stage.**

### A3-3: Fulfilment prompt in F6 accept

**Files:** Create `services/part-requests/fulfil-prompt.ts` (replaces the stub); Test
`apps/api/__tests__/part-request-fulfil.test.ts`.

**Interfaces:** `notifyFulfilPrompts(tx, d: { dealId: string; listingId: string; buyerBusinessId: string;
sellerBusinessId: string })` (C0-4a passes it from the offer and `createDealFromOffer`'s `{ dealId, ref, status,
version }`) — read-only on F8 rows, no F8 lock: the buyer business's `active` requests where `d.listingId` is a delivered
reply or a match → `notify` `part_request_fulfil_prompt` to the
buyer business (always, D5), dedupe `part_request_fulfil_prompt:<requestId>:<dealId>`, params `{ businessName (seller),
requestTitle }`, destination `{ partRequestId, dealId }`.

- [x] **Step 1: Failing tests:** accept (through `POST /offers/:id/accept`) on a delivered-reply listing → one prompt
  row per buyer member; the same when a **buyer** member accepts the seller's counter; a match listing → prompt; an
  unrelated listing → none; a `closed` request → none; accepting while a job transaction holds the request
  `FOR NO KEY UPDATE` completes without waiting (`lock_timeout = '1s'`).
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `offers-accept.test.ts` still passes. **Step 5: Stage.**

### A3-4: Admin API and reports widening

**Ports:** textile `routes/admin/requirements.ts`, `services/requirements/requirement-reports.service.ts`.

**Files:** Create `services/part-requests/{admin.service,admin-view}.ts`; Modify `routes/admin/part-requests.ts`,
`services/reports/admin-reports.service.ts` (`AdminReportTarget = 'conversation' | 'review' | 'part_request'`, list
filter, row mapping with masked request name + id, `resolveReport` accepts it), `routes/admin/reports.ts` (query schema
target enum); Test `apps/api/__tests__/admin-part-requests.test.ts`.

**Interfaces:** `listAdminPartRequests(conn, q: { status?; kind?; machineCategoryId?; reported?: boolean; businessId?;
from?; to?; q?: string; cursor? }): Promise<{ items: AdminPartRequestRow[]; nextCursor }>` (active first, then
`created_at DESC`; `q` matches business name or owner phone); `getAdminPartRequest(conn, id):
Promise<AdminPartRequestDetail>` (note / name / messages masked; `eligibleNow` via `eligibleSellerCount`);
`adminRequestPhotos(conn, id)`; `removePartRequest(app, admin, id, body: { reason })` (request lock; `writeRequestStatus
(…, 'remove', { removed_by_admin_id, removed_reason })`; `dropPendingRepliesForRequest(…, 'request_removed')`; open
`part_request` reports → `actioned`; `part_request_removed` to the buyer, dedupe `part_request_removed:<id>:<removed
epoch>`; audit `part_request.remove` before / after status); `restorePartRequest(app, admin, id, body: { reason })`
(`writeRequestStatus(…, 'restore')`; no notification, no open-limit check, no enqueue; audit `part_request.restore`).
Reasons `ADMIN_REASON_MIN`–`ADMIN_REASON_MAX` (`lib/admin-text.ts`).

- [x] **Step 1: Failing tests:** list filters (status, reported, businessId) and active-first order; detail masks a
  Devanagari phone in the note and a reply message, has no phone key, and `eligibleNow` matches the fixture; remove of
  an `active` request → `removed`, `return_status = 'active'`, its pending reply dropped `request_removed`, its open
  report `actioned`, one buyer notification, one audit row; remove of a `removed` one →
  `PART_REQUEST_TRANSITION_NOT_ALLOWED`; restore → `active` with no notification and no work row; restore when
  `expires_at` has passed → `expired`; a short reason → 400; `GET /admin/reports?target=part_request` lists the
  request's report and `POST /admin/reports/:id/resolve` resolves it with an audit row; the conversation and review
  report suites still pass.
- [x] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

**A3 exit:** lane test files and typecheck green; review (focus: per-request job transactions with `SKIP LOCKED`, no
`FOR UPDATE` on requests, every admin mutation audited, texts free of PII); controller commits on `lane/f8-a3`.

## Wave A merge (controller)

- [x] Merge `lane/f8-a1`, `a2`, `a3` into `develop` one at a time (`--no-ff`).
- [x] `grep -rn "F8-STUB" apps/api/src` is empty; `pnpm --filter @mpm/shared-types build`; `pnpm typecheck`;
  `pnpm --filter @mpm/api test` once; `countF8Rows` on `mpm_test` all 0.
- [x] Fix wave on `develop`; commit; push (milestone: API). Lane cleanup (checklist step 6).

---

# Wave B — Admin and app lanes (parallel: B1, B2, B3)

## Lane B1 — Admin pages

### B1-1: Part requests list, detail, remove / restore

**Ports:** textile admin `app/(dashboard)/requirements/page.tsx` + `[id]`.

**Files:** Create `apps/admin/lib/part-requests-api.ts` (+ `part-requests-api.test.ts`),
`components/part-requests/{part-requests-table,part-request-detail,targets-table,remove-restore-dialog}.tsx`,
`app/(dashboard)/part-requests/page.tsx` (replace the placeholder), `app/(dashboard)/part-requests/[id]/page.tsx`; Test
`components/part-requests/remove-restore-dialog.test.tsx`.

**Rules (§14):** table columns ref, name, kind, category path, buyer business, city, status (`lib/status.ts` tones),
targeted, replies, matches, open reports, created, expires; filters status, kind, machine category, reported, date,
search; URL state (`use-url-state`), `?businessId=` filter. Detail: fields as sellers see them plus budget and
audience; masked note; photos in `image-lightbox` (300 s URLs fetched on open); eligible-now count; targets table
(rank, score, pushed, opened, replied, not relevant); replies (listing link, seller, status, drop reason, message);
matches (listing, seller, tier, km, pushed); reports; Remove (non-`removed`) / Restore (`removed`) with a reason dialog
(danger submit).

- [x] **Step 1: Failing tests:** `adminPartRequestsQuery(filters)` builds the query string (status, kind,
  machineCategoryId, reported, businessId, dates, q; empty ones dropped); the dialog won't submit a reason shorter than
  `ADMIN_REASON_MIN` and sends `{ reason }` to remove or restore by mode. **Step 2:** FAIL. **Step 3:** Implement.
  **Step 4:** PASS; lint; style audit. **Step 5: Stage.**

### B1-2: Reports tab, settings section, business link

**Files:** Modify `app/(dashboard)/reports/page.tsx` (tab **Part requests**), `components/conversations/use-admin-reports.ts`
(target `part_request`), `components/settings/marketplace-settings-form.tsx` (section "Part requests" for the 14
`part_request_*` keys, excluded from "listing rules"), `components/businesses/business-detail.tsx` ("Part requests (n)"
→ `/part-requests?businessId=`).

- [x] **Step 1:** none (display wiring; no tests per owner rule). **Step 3:** Implement (report rows show the masked
  name and link to `/part-requests/[id]`; resolve uses the existing dialog). **Step 4:** typecheck, lint, style audit;
  `marketplace-settings-form.test.tsx` still passes. **Step 5: Stage.**

**B1 exit:** `pnpm --filter admin test`, lint, typecheck; review; controller commits on `lane/f8-b1`.

## Lane B2 — App buyer

### B2-1: Form logic and prefill builders

**Ports:** textile app `screens/requirements/post-need.tsx` (form shape), `lib/requirement-form.ts` if present.

**Files:** Create `apps/user-app/lib/part-request-form.ts` + test, `lib/part-request-compare.ts` + test.

**Interfaces:** `requestFormSchema(t)` (Yup; name 3–100, side required when the node has sides, quantity decimals per
unit, note ≤ 500, photos ≤ 3, ≤ 5 fits, needed-by within a year); `toPartRequestInput(values: RequestFormValues):
PartRequestInput`; `fromBuyerView(view: PartRequestBuyerView): RequestFormValues` (edit) and `copyOf(view):
PartRequestPrefill` (Post again, `source: 'copy'`); `prefillFromReading(reading: QueryReading, rawQuery: string):
PartRequestPrefill` (§13.2: category if part group / machine type, a machine category only seeds the picker
(`categorySeedId`), first part number, side, brand + model → one fit, name = reading words else the raw query,
`source: 'no_results'`); `prefillFromOtherSide(listing: ListingDetail): PartRequestPrefill` (category, title, part
number **base**, `complementarySide(side)`, fits, `source: 'other_side'`); `reachChoices(state: string | null)`;
`compareRows(columns: CompareColumn[]): CompareRow[]` (row order price, available, side, condition, distance, rating,
verified; lowest price flagged).

- [x] **Step 1: Failing tests:** `prefillFromReading` for "left tie rod end toyota lwt710" with a reading carrying side
  Left, a brand + model chip and a part-group category → side `left`, one fit, category id, name = reading words; a
  reading with only a machine category → `categoryId` unset and the seed set; a query with a part number → first part
  number; `prefillFromOtherSide` of a Left listing with part number `AB-123-L` → side `right`, part number base,
  fits copied; a Pair listing → no side; `toPartRequestInput` drops empty optionals and keeps quantity as a string;
  schema refuses a side-less part on a node with sides and 4 photos; `compareRows` flags the lowest price only among
  priced columns. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### B2-2: Post a requirement (steps 1–2, preview, posted, edit)

**Files:** Modify `screens/requirements/{post-requirement,requirement-posted}.tsx`; Create
`components/part-requests/form/{StepNeed,StepDetails,RequestPreview,PhotoPicker,CategorySheet}.tsx`;
`locales/*/requirements.json`.

**Rules (§13.1):** step 1 kind segments (A part / A machine; no rental), category picker in B2's own
`form/CategorySheet.tsx` (imports only the pure helpers of `lib/sell-category.ts`, never `screens/sell/step-category.tsx`,
which stays B3's; unlike the sell wizard it lets a part request stop at a machine type, §25 item 3), name, part number (mono), side picker with the convention diagram only when the node has sides,
quantity + unit (machines none), fits rows (sell's `fit-row-sheet`, "Make and model" for machines); step 2 conditions
(all on), budget + Show to sellers, needed by + Urgent, Deliver to (read-only business place), reach chips with the
business state, Who can reply, Specifications (collapsed, optional), photos ≤ 3 (presign → PUT, chat upload pattern),
note, Valid for (options), fine print with `reachN`; limit reached → notice with the open count instead of Post.
Preview as sellers see it → `POST /part-requests` with an `Idempotency-Key` → `RequirementPosted { partRequestId,
backfill }` ("We're telling up to {n} sellers now", "{k} listings already match" refetched once after about 12 s, so
the first work-job tick at 10 s has run). Edit mode
(`editId`) loads the buyer view, sends `PATCH` with `version`; `409 PART_REQUEST_STALE` → reload sheet. Analytics
`request_post_started`, `request_posted`, `request_post_failed`, `request_edited`.

- [x] **Step 1:** none (UI). **Step 3:** Implement. **Step 4:** app typecheck; parity / audit / style audit.
  **Step 5: Stage.**

### B2-3: My requirements, Requirement (buyer), Compare, sheets, Home buyer strip

**Files:** Modify `screens/requirements/{my-requirements,requirement-buyer,compare-responses}.tsx`,
`components/part-requests/HomeBuyerStrip.tsx`; Create `components/part-requests/{ReplyCard,MatchCard,FulfilBanner,
CloseSheet,RenewSheet}.tsx`, `hooks/use-my-part-requests.ts`.

**Rules (§13.1, §9.4):** My requirements segments Active / Fulfilled / Closed with counts, rows (side token, name,
quantity + fit, "3 replies, 2 matches" / "Waiting for replies"), + New, empty state. Requirement (buyer): header (name,
side, quantity, fits, status chip, Matched badge, "Sent to n sellers", days left), fulfil banner (shown from the view's
`fulfilPrompt`, i.e. any non-cancelled deal incl. `disputed`; Mark fulfilled sends
`dealId`; Not yet hides it on this device: AsyncStorage key `fulfil-prompt-dismissed:<requestId>:<dealId>`, try/catch),
segments Replies / Auto matches, cards open `Listing { listingId }`, "Compare n", menu Edit / Renew / Mark fulfilled /
Close / Post again (copy for closed / expired / fulfilled); calls `read` on open and on `part_request:` events. Compare:
columns scroll horizontally beyond 3, lowest price marked, button per column opens `Listing { listingId, openSheet }` by
`contactAction`. Home buyer strip (mockup `.sidematch`). Analytics `request_renewed`, `request_closed`,
`request_fulfilled`, `request_compare_opened`, `request_response_opened`.

- [x] **Step 1:** none (UI; logic in B2-1). **Step 3:** Implement. **Step 4:** app typecheck; parity / audit / style
  audit. **Step 5: Stage.**

### B2-4: Entry points and guest pending action

**Files:** Modify `screens/search/results.tsx` (prefill card under the No results empty state), `screens/listing/
{other-side-block,other-side}.tsx` ("Need the other side? Post a requirement"), `hooks/use-pending-request.ts`
(replaces the stub); Create `components/part-requests/RequestPrefillCard.tsx`.

**Rules (§13.2):** the card "Post this as a requirement / Tell up to {n} sellers" builds `prefillFromReading`; a guest
taps → sign-in sheet with reason `request` and `PendingAction { type: 'post_request', prefill }`; after sign-in and
onboarding the form opens prefilled and never posts by itself; the Other side link builds `prefillFromOtherSide`.

- [x] **Step 1:** none (wiring; prefill logic tested in B2-1, pending dispatch in C0-5). **Step 3:** Implement.
  **Step 4:** app typecheck; `pnpm --filter user-app test`; parity / audit / style audit. **Step 5: Stage.**

**B2 exit:** app suite and typecheck green; review (focus: no text in analytics, prefill never posts, Idempotency-Key
reused on retry); controller commits on `lane/f8-b2`.

## Lane B3 — App seller

### B3-1: Buyers looking for your parts, Home seller strip

**Files:** Modify `screens/requirements/buyers-looking.tsx`, `components/part-requests/HomeSellerStrip.tsx`; Create
`components/part-requests/{SellerRequestRow,BuyerBlock}.tsx`, `hooks/use-seller-part-requests.ts`; `locales/*/buyers.json`.

**Rules (§13.1, §12.3):** lead "Matched to your categories and stock."; segments For you / All / Replied with counts;
rows (name, side token, quantity + unit, first fit, conditions, budget or "Private", needed by + urgent, days left,
city + km, buyer block, reply count, "Reply" button) infinite scroll; `forListing` param filters; empty state "No buyers
looking right now" with the eligibility explainer (sell activity, categories, GST verification); refetch on focus.

- [x] **Step 1:** none (UI). **Step 3:** Implement. **Step 4:** typecheck; parity / audit / style audit. **Step 5: Stage.**

### B3-2: Requirement (seller), Reply with my listing, Not relevant, Report

**Files:** Modify `screens/requirements/{requirement-seller,reply-with-listing}.tsx`; Create
`components/part-requests/{NotRelevantSheet,RequestReportSheet}.tsx`, `lib/reply-picker.ts` + test.

**Interfaces / rules:** `pickerRows(options: ReplyOption[], slotsLeft: number, selected: string[]): PickerRow[]` (fitting
first, others greyed with the reason key, selection capped at `min(slotsLeft, 3)`). Seller requirement page: card
(§12.3), photos (signed URLs on open), my replies with status lines ("Pending: goes when your listing is live", "Seen by
buyer", dropped reason), Withdraw, **Reply with my listing**, **Not relevant** (reason sheet, Undo when set), Report
(reason sheet; details for `other`); no "Send a quote". Reply screen: picker, message ≤ 300, Send (`Idempotency-Key`);
**Create a new listing** → `createListing(kind, partRequestId)` → the sell wizard on the new draft. Analytics
`request_reply_sent { listings, created }`, `request_reply_withdrawn`, `request_not_relevant`, `request_reported`.

- [x] **Step 1: Failing tests:** `pickerRows` orders fitting first, greys `side` / `replied` with their keys, refuses a
  4th selection and a selection beyond `slotsLeft`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS;
  typecheck; parity / audit / style audit. **Step 5: Stage.**

### B3-3: Sell wizard prefill scope, Preview and Published lines

**Files:** Modify `screens/sell/step-category.tsx`, `lib/sell-category.ts` + test, `screens/sell/{preview,published}.tsx`.

**Rules (§9.3, §13.2):** when the draft has `partRequestId` and no category, the category step loads the request
(`GET /part-requests/:id`) and scopes the part-group picker to its machine type; Preview and Published show "Goes to the
buyer when your listing is live" from `pendingRequestReply`; Published shows "{n} buyers are looking for this part"
from `GET /listings/:id/part-request-demand` ("We will tell them when it goes live" in review, "We've told them" when
live) with "See their requirements" → `BuyersLooking { forListing }`, hidden at 0.

- [x] **Step 1: Failing tests:** `scopedPartGroups(tree, machineTypeId)` returns only that type's part groups and the
  whole list when no type is given. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; typecheck; parity /
  audit / style audit. **Step 5: Stage.**

**B3 exit:** app suite and typecheck green; review (focus: viewer can't reach reply / not relevant actions, no buyer
contact rendered, wizard scope); controller commits on `lane/f8-b3`.

## Wave B merge (controller)

- [x] Merge `lane/f8-b1`, `b2`, `b3` into `develop` one at a time; `grep -rn "F8-STUB" apps` is empty; `pnpm typecheck`;
  `pnpm lint`; `pnpm --filter admin test`; `pnpm --filter user-app test`; allowlist merges resolved; fix wave; commit;
  push. Lane cleanup.

---

# Batch I — Integration and close-out (sequential, on `develop`)

### I-1: Core loop and races

**Files:** Create `apps/api/__tests__/f8-core-loop.test.ts`.

- [x] **Step 1: Failing tests (cases no single lane could write):** buyer posts a Left part request → `runPartRequestWork`
  → top-N targets notified (one seller over its push cap gets the row without delivery) and an at-post match for an
  already-live Pair listing (no notification) → a targeted seller replies with an existing listing (delivered, grouped
  row) and another creates a new listing with `partRequestId` → admin approves → job → delivered → a third seller
  publishes a matching Left listing → job → `part_match` grouped row → buyer `read` resets both rows → compare lists 3
  columns → buyer enquires and offers on the match listing, the seller accepts → `part_request_fulfil_prompt` → buyer
  fulfils with that `dealId` → status `fulfilled`, nothing pending; close racing a reply send (`Promise.all`) → the reply
  is refused (`PART_REQUEST_NOT_ACTIVE`) or dropped `request_closed`, never `delivered` on a closed request; close racing
  the job delivering a pending reply → same rule; two `runPartRequestWork` and one `expirePartRequests` concurrently
  over the same rows → no deadlock (`40P01`) and each row processed once; rendered texts of every notification created
  in the loop carry no phone number planted in the request note and name; `countF8Rows` all 0 after cleanup.
- [x] **Step 2:** run; fix in the owning lane's files on `develop`. **Step 3:** `grep -rn "F8-STUB\|NOT_IMPLEMENTED"
  apps/api/src apps/user-app apps/admin` returns only F6's `OTP_NOT_IMPLEMENTED`. **Step 4:** PASS. **Step 5: Stage.**

### I-2: Full checks and builds

- [x] One package at a time: `pnpm typecheck`, `pnpm lint`, `pnpm --filter @mpm/api test`, `pnpm --filter admin test`,
  `pnpm --filter user-app test`; `countF8Rows` on `mpm_test` all 0; `pnpm --filter admin build`; in `apps/user-app`:
  `CI=1 npx expo export --platform android` and `npx expo install --check`.
- [x] Dev DB: `pnpm --filter @mpm/api db:migrate` (0014, 0015).

### I-3: Agent walk-through on the dev DB

- [x] Scripted API walk-through (three businesses by phone OTP: buyer, verified seller with a live Pair listing,
  unverified seller): post a Left part request (`verified_only`) → work job (or wait one tick) → the verified seller
  sees it under For you, the unverified one gets 404; at-post match listed; verified seller replies with a new listing
  → approve → delivered; a Left listing by the verified seller → match + push recorded `sent_dev`; compare; enquire →
  offer → accept → fulfil prompt → fulfil; a second request closed with a pending reply → dropped and seller notified;
  admin list / detail / remove / restore and a part-request report resolved; admin pages by page loads
  (`/part-requests`, `/part-requests/<id>`, `/reports`, `/settings` 200). Delete all walk-through data afterwards
  (catalogue, seeds, settings unchanged; audit rows kept).

### I-4: Docs

- [x] `docs/PROJECT_STATUS.md`: What's built (F8 row: tables, routes, jobs, app and admin screens), How to run (0014 /
  0015, no new env), Open items (§23 list; queue backlog note §21), Suggested build order item 6 (F8 done; F9 push
  categories later), session log line.
- [x] `CLAUDE.md` (services list + `part-requests`, the work queue and `writeStatus` enqueue rule, `/part-requests/*`
  route prefix), `apps/user-app/CLAUDE.md` (requirements screens, query keys, `part_request:` socket prefix, pending
  action `post_request`), `apps/admin/CLAUDE.md` (Part requests pages, Reports tab, Settings section).
- [x] `docs/product-scope.md` per §20 (M11 "matched" derived badge, quotes P2 / rental requests M14, who-can-reply
  default verified only, D5 = `part_request_reach_n`); F2 spec R22 note: the Other side "Post a requirement" link exists;
  spec and this plan marked built.
- [ ] Controller commits and pushes `develop` (milestone).

### I-5: Owner checklist (not for an implementer subagent)

- Device pass: post from No results as a guest → sign in → posted; seller push and the daily cap; match push; reply with
  a new listing → delivered on approval; compare → offer; Home strips; en / hi / gu.
- Hindi and Gujarati copy of every new string checked by a native speaker.
- Admin pages in a browser (list filters, detail, remove / restore, Reports tab, Settings section).
- Confirm with the client: D5 reach 15; default "verified sellers only" vs launch supply; budget private by default.
- Quiet hours (M16) wait for the digest work; request photo retention with the DPDP / chat retention decision.

---

## Coverage (spec section → tasks)

| Spec | Tasks |
|---|---|
| §1–§3 Why, goals, approach A | Goals 1: A1-1, B2-2, B2-4 · 2: A2-2, A1-4, B3-1 · 3: A2-4, B3-2, B3-3 · 4: C0-4a, A2-1, A2-3 · 5: A1-3, B2-3 · 6: A1-2, A3-1, A3-4 |
| §4 Rulings | R1 A1-1 · R2 A2-4 · R3 C0-1, C0-3a, A1-2, A3-3 · R4 A1-1 · R5 A1-2, A3-1 · R6 C0-3a, A1-4 · R7 A2-2 · R8 C0-4a, A2-1, A2-3 · R9 C0-3b, A1-3, A1-4, A3-2 · R10 A1-3, B2-3 · R11 C0-5, B2, B3 · R12 C0-3b, A3-2 · R13 A3-4, B1 · R14 C0-4b, A1-1, A2-4 |
| §5 Data model, migrations, shared types | C0-1, C0-2 |
| §6 Eligibility | C0-3a; used in A1-3, A1-4, A2-2, A2-3, A2-4, A3-4 |
| §7 Matching, caps, performance | A2-2 (§7.2–§7.3, §7.5 sellers), A2-3 (§7.4, §7.5 buyers), A2-1 (§7.6) |
| §8 Queue and jobs | C0-3b, C0-4a (§8.1), A2-1, A3-1 (§8.2), C0-4b (registration) |
| §9 Lifecycle, replies, fulfil, locks | C0-3a (§9.1), A1-2, A2-4 (§9.2–§9.3), A3-3 (§9.4), Global constraints + I-1 (§9.5) |
| §10 Notifications | C0-3b (§10.1–§10.2), A3-2 (§10.3), A2-2, A2-3, A2-4, A3-1, A3-3, A3-4 (senders) |
| §11 Sockets | C0-3a / C0-3b (`emitRequestUpdated`), C0-5 (client) |
| §12 API | C0-4b (stubs, limits), A1-1–A1-4, A2-3, A2-4, A3-4; `POST /listings` C0-4a + A2-4; badges C0-4b + A1-4 |
| §13 App | C0-5, B2-1–B2-4, B3-1–B3-3 |
| §14 Admin | A3-4, B1-1, B1-2 |
| §15 Errors | C0-1 (`PART_REQUEST_ERROR_CODES`), C0-5 (copy), raised in A1–A3 |
| §16 Settings | C0-1, B1-2 |
| §17 Privacy | C0-3b (photos), C0-4b (Sentry), C0-5 (app redaction), A1-3, A1-4, A3-2, A3-4 |
| §18 Testing 1–10 | 1 C0-1, A1-2, A3-4 · 2 A1-1, A2-4, C0-4b · 3 C0-3a, A1-3, A1-4, A3-2 · 4 A2-2 · 5 A2-3 · 6 C0-4a, A2-1 · 7 A2-4 · 8 A3-3 · 9 A2-4, A3-1, I-1 · 10 C0-3b, A1-2 |
| §19 Build order | this plan's batches (D1) |
| §20 Earlier documents and code | C0-1, C0-3b, C0-4a, C0-4b, A3-4, B3-3, I-4 |
| §21–§23 Risks, deferred, open items | I-4 (PROJECT_STATUS), I-5 |
| §26 Review changes | 1 A2-1 · 2 A2-2 · 3 Global constraints, A3-3 · 4 A2-3 · 5 C0-3a · 6 Global constraints · 7 A3-1 · 8 A3-4 · 9 C0-2 · 10 C0-4a · 11 C0-4a, A2-4 · 12 C0-3b, A1-1 · 13 A2-2 · 14 A2-3, A3-2 · Q1 C0-3b · Q2 A3-3 · Q3 C0-4a, A2-4 · Q4 A2-4, B3-3 · Q5 A1-2, A2-4 · Q6 A1-3 · Q7 A2-4 · Q8 A3-4 |
