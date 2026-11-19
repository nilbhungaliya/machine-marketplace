# F6 + F7 Enquiries, Chat, Offers, Deals, Reviews and Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. **Contracts first, in sequence (C0, then C1), then parallel lanes** (owner, 2026-11-19:
> as F2): each lane in its own git worktree on a local lane branch, one implementer per lane doing its tasks in order,
> an independent review per lane, then the controller merges. Steps use checkbox (`- [ ]`) syntax.

**Status:** **Built** (2026-11-20: C0, C1, waves A and B and Batch I on `develop`; I-5 is the owner's). Approved for build
on the owner's instruction 2026-11-19; reviewed, see Plan review changes.

**Spec:** `docs/superpowers/specs/2026-11-19-f6-f7-enquiries-chat-offers-deals-design.md` (with §26 our calls and §27
review changes). Section numbers below (§n) refer to it. The spec is the source of truth: rulings R1–R26 and §26 are
not reopened here. Plan decisions where the spec is silent are **P1–P15** below; the independent plan review's fixes
are listed in **Plan review changes (2026-11-19)** at the end.

**Goal:** A buyer enquires, chats (text and photos), offers, counters or buys at the asking price, a seller quotes on
price-on-request listings, and an accepted offer becomes a shared deal that holds the stock and runs handed over →
received (or auto-completes), with cancels, disputes for support, blind reviews, per-reader phone masking until both
sides share their number after a deal, and in-app notifications plus FCM push.

**Architecture:** New tables (§5): `chat_threads`, `chat_messages`, `chat_thread_user_state`, `business_blocks`,
`contact_share_consents`, `offers`, `stock_holds`, `deals`, `deal_events`, `deal_disputes`, `deal_reviews`,
`notifications`, `notification_deliveries`, `user_devices`, `idempotency_keys`; new columns `listings.held_quantity`,
`businesses.contact_phone*`, `users.push_enabled`. One service folder per state machine: `services/chat`,
`services/offers`, `services/deals`, `services/reviews`, `services/notifications`, `services/consent`. The seams every
lane shares (after-commit emits, per-reader emit, system lines, turn columns, `notify(tx)`, holds, `syncReservation`,
masking, idempotency) are built in C0 / C1 so the lanes never edit each other's files. App: Chats, Thread, offer
sheets, Deals, Deal record, reviews, bell + notification list, push. Admin: Enquiries & offers, Deals, Disputes,
Conversations, Reports & flags.

**Tech stack:** Fastify 4, Drizzle 0.31 + drizzle-kit 0.22, Zod, Postgres 18, Redis, Socket.IO 4, `sharp` (new),
`firebase-admin` (new), R2 via `lib/storage.ts`; Expo SDK 54, React Navigation 7, TanStack Query, Formik + Yup,
i18next, `expo-notifications` (new native module); Next.js 14 admin kit.

**Textile sources** (`C:\Users\Dell\Desktop\textile stock marketplace`, plan
`docs/superpowers/plans/2026-11-07-m7-m8-m12-offers-chat-deals.md`, decisions D1–D20): each task names the textile
files it ports. Read them before writing; keep their names where the spec keeps the concept, drop lots, bales,
samples, payment-term steps, dispatch and consumed stock (spec "Dropped from textile").

---

## Global constraints

- **Branches:** C0 and C1 on `develop`, in order. Then lanes, each in its own worktree on a local branch, set up by
  the **lane setup checklist** (below the ownership table). **Implementers never commit or push**; each task ends with
  "Stage" (list the files). The controller commits on the lane branch after the lane's review, merges lanes into
  `develop` (`git merge --no-ff`), runs the suites once per wave, commits the fix wave and pushes at milestones only
  (after C0 + C1, after each wave, after close-out). Owner rule: ask before each commit and push.
- **The spec and this plan are committed before C0** (owner rule: spec + plan before code). `docs/product-scope.md`
  has uncommitted edits in the working tree: leave them; I-4 builds on them.
- **Contracts own the schema.** Only C0 adds migrations and edits `schema.ts`; only C0 / C1 edit
  `packages/shared-types`. A lane that needs a contract change stops and reports it; the controller makes the change
  on `develop` (a small "contracts fix" commit with its own migration if needed), and the lane merges `develop` in.
- **File ownership (lanes):** a lane edits only the files in its row of the ownership table (§ Lanes). Everything a
  lane calls in another lane's area exists in C0 as a signature with a stub body marked `// F6F7-STUB(<lane>)`; the
  owning lane replaces the body in place and removes the marker. I-1 greps for the marker. The two allowlists
  (`apps/user-app/lib/i18n/audit-allowlist.json`, `apps/user-app/lib/style-audit-allowlist.json`) are **append-only**
  in lanes; the controller resolves their merges.
- **Lane isolation:** each lane runs its API tests against its **own test database** (`mpm_l1_test` … `mpm_l8_test`;
  names must end in `_test` for the vitest guard) and its own Redis test DB index (`TEST_REDIS_URL=
  redis://localhost:6381/<2 + lane number>`, DBs 3–10). Lanes never share `mpm_test`; steps in the lane setup
  checklist.
- Routes: Zod-parse → service → `{ data }`; services throw `AppError` subclasses with the codes of §18. User routes
  `preHandler: fastify.requireUser` (onboarding gate: no business → `409 ONBOARDING_INCOMPLETE`, as
  `listing-write.service.ts` does); public reviews
  `fastify.optionalUser`; admin `fastify.requireAdminRole(...)` per §16.1 (super_admin passes). Every admin mutation and
  every admin thread read writes `audit_log` via `writeAudit` in the same transaction.
- **Party checks** read membership from the database (`users.business_id` + `member_role`), never the token alone;
  outsiders get `404` (`THREAD_NOT_FOUND`, `OFFER_NOT_FOUND`, `DEAL_NOT_FOUND`, `REVIEW_NOT_FOUND`); `viewer` →
  `403 VIEWER_READ_ONLY` on every write except reading, marking read and archiving (§12, P15).
- **Text out:** every party-facing text goes through `visibleText(text, reader, thread)` (C0-4a). Listing titles and
  business names in strips, previews and notifications go through `maskContact` always. Socket events with text are
  built per reader and sent to `userRoom`; business rooms and admin rooms carry ids only (R10, textile D2).
- **Lock order (§8.5):** buyer business (`FOR NO KEY UPDATE`, only where a limit is counted) → listing (`FOR UPDATE`) →
  deal → offer(s) in id order → thread. Deal routes and jobs read `listing_id` unlocked first. **F6 / F7 code never
  locks the seller business**: the system transitions `sell_out`, `reserve` and `unreserve` always run with
  `lockBusiness: false` (like `expire`). Work spanning several listings (block, owner suspension) locks them in id
  order before any of their offers. Helpers in `services/deals/locks.ts` (C0-4a); never lock out of order.
- **Money:** paise. `price_per_unit_paise`, `total_paise`, `advance_paise` are `bigint` columns. On the wire
  `pricePerUnitPaise` is a JSON number (safe integer ≤ 2 147 483 647, as F2's listing price) and `totalPaise`,
  `advancePaise` are decimal strings (P4). Never JS floats for money. Quantities are `numeric(14,3)`, decimal strings
  on the wire, `bigint` thousandths in code (`quantityToMilli`, C0-1).
- **Time:** every rule uses the database clock (`now()`); services never call `Date.now()` for a rule. Tests move a
  stored timestamp back with `UPDATE` and then run the code (P10); pure functions take `now` as an argument.
- **Jobs (§14):** added in C0-4b to `src/jobs/index.ts` (bodies in the owning lane's file). Each reads candidate ids
  unlocked, then per row in its own savepoint locks listing → row `FOR UPDATE SKIP LOCKED`, re-checks the status
  filter in the `UPDATE`, and is safe to run twice and concurrently. Jobs run their writes through `runJobTx` so they
  queue emits and notifications like routes.
- **Migrations:** edit `schema.ts` → `pnpm --filter @mpm/api db:generate`; what Drizzle can't express in one
  `drizzle-kit generate --custom` migration. Never edit existing migrations (0000–0011). Apply with `db:migrate` **and**
  `db:migrate:test`. §5.17: no migration statement uses the new `report_target` value `'review'`; the quantity CHECK is
  relaxed to `>= 0`; `deals_ref_seq` restarts at 500001; the consent table is append-only by trigger; the grouped chat
  notification row has a partial unique index.
- After editing `packages/shared-types`: `pnpm --filter @mpm/shared-types build`; its tests live in
  `apps/api/src/lib/*-shared.test.ts`.
- **Tests: limited and important only (R26, owner).** Step 1 of each task lists the only cases to write: state
  machines, money / quantity / holds, masking and consent, permissions and roles, limits, locks and races where cheap,
  jobs. **No tests for UI wiring, timing, copy or layout.** App: pure logic in `lib/` with co-located tests; i18n
  parity, audit and style-audit tests must pass. Admin: only the three dialog tests §20 names, plus nav roles.
- **API tests:** real `mpm_test` + Redis DB 1; fixtures unique per run (`createTestSeller`, `insertTestListing`,
  `createTestBusinessUser`, C0-2's `insertTestThread` / `insertTestOffer` / `insertTestDeal` / `addTestMember`);
  **fixture buyers are GST-verified by default** (so the verified limits apply); every limit test sets the settings it
  relies on explicitly in `app_settings` and restores them; `vitest.config.ts` raises `GROUP_RATE_LIMIT_MAX` (as
  `RATE_LIMIT_MAX`), and a limit test lowers it only on its own app instance; pincodes `990031`–`990039` for this
  feature; **every suite leaves `mpm_test` with none of this feature's rows**
  (`deleteF6Rows` in `afterAll`, called by `deleteTestBusinesses` / `deleteListingsOf` too). Storage: tests that need
  R2 run only under `R2_TESTS=1`; others `vi.mock` the storage calls of `services/chat/private-photo.ts` only. Socket
  tests use `socket.io-client` against `setupSocketIO` as `socket.test.ts` does.
- **Memory is tight:** one package's tests at a time (`pnpm --filter @mpm/api test`, `pnpm --filter admin test`,
  `pnpm --filter user-app test`); while iterating run only the task's own files
  (`pnpm --filter @mpm/api exec vitest run __tests__/<file>.test.ts`). At most four lanes at once (two if the machine
  struggles). Admin build and `expo export` only in I-2.
- **App:** every string in `en`, `hi`, `gu` in the lane's own locale areas (C0-5 creates and registers every new area,
  so lanes never edit `locales/index.ts`); light only (`useTheme()` → `{ colors, shadows }`), `useType()`, the v2 kit,
  `testID` on every pressable, amounts in Indian format, part numbers in JetBrains Mono (`apps/user-app/CLAUDE.md`
  §1–2, §6, §8). Screens follow the Periwinkle v2 mockup screens in §15.1; screens without a mockup use the
  `frontend-design` skill in the mockup's language. Analytics events are declared once in C0-5 (§15.4) and only fired
  by lanes: ids, kinds, counts, reason codes; never text, notes, numbers, amounts or names.
- **Admin:** v2 kit and palette classes only; style audit green; nav entries mirror the API roles of §16.1.
- **Push is opt-in** (as Sentry): with no `FIREBASE_SERVICE_ACCOUNT_B64` the API starts; outside production a send is
  recorded `sent_dev` and logged without content; in production it logs one warning at boot and records `skipped`
  (§11.5). `expo-notifications` needs a new dev-client build: owner item (I-5).
- **Exact numbers (spec):** messages ≤ 2 000 chars, enquiry / offer / deal notes ≤ 500, reject / cancel / handover
  notes ≤ 300, reply ≤ 300, review text ≤ 1 000, dispute description 10–1 000, message to parties ≤ 500, photos ≤ 5
  per message / dispute, photo ≤ 10 MB, re-encode long edge ≤ 2 048 px, JPEG quality 80, signed URLs 300 s; rate limits
  messages 30 / min, offer actions 20 / min, deal actions 20 / min (per user, across the group's routes, P8), photo
  presign 30 / 10 min, reports 10 / day, new enquiries per business per day 10 unverified / 40 verified (settings);
  pages: inbox 20, messages 30; `MAX_COUNTER_ROUNDS` 5; viewing key 45 s, client refresh 20 s; push job every 3 s,
  batch 100, backoff 15 s / 1 min / 5 min / 30 min then `failed`; foreground dedupe keeps the last 100 keys;
  notifications deleted after 90 days; idempotency keys after 24 h; admin read window 30 days after resolution;
  settings defaults §17.
- **Every task ends green** for its own tests, typecheck of the packages it touched, and lint for admin.
- Windows: Bash is Git Bash; paths relative to the repo root.

## Plan decisions (P1–P15, where the spec is silent)

- **P1. Lane split.** §21's sketch is refined: its L2 is split into **L2 API offers** and **L3 API deals**; reviews +
  notifications become **L4**; admin is **L5**; the app is split into **L6 chat**, **L7 offers + deals**, **L8 reviews,
  notifications, push**. Holds, `syncReservation`, the listing transition changes and every listing-writer hook (§8,
  §22) move into a sequential **C1** after C0, because L2 and L3 both need them working, not stubbed.
- **P2. After-commit effects.** `runTx(app, fn)` (`lib/tx-effects.ts`) opens the transaction, registers an effects
  queue for that `tx` in a `WeakMap`, and flushes queued socket emits after commit (dropped on rollback). Nested
  transactions (savepoints, `tx.transaction(...)`) get a child queue that merges into the parent on release and is
  discarded on rollback, so a job's per-row savepoint loses only that row's emits. Services call
  `queueUserEmit(tx, …)` / `queueAdminEmit(tx, …)`. Queuing on a `tx` with no queue **throws under tests**
  (`NODE_ENV === 'test'`), so a missed `runTx` is caught, and is dropped with a warning log otherwise; the flush is a
  no-op when `app.io` is unset (`buildApp` without sockets). F2 service signatures stay, except `bulkListingAction` and
  `adminDeleteMedia`, which open their own transactions and so take a `TxApp` instead of a `Db` (C1-2).
- **P3. Stubs.** Cross-lane functions exist in C0 with a stub body and `// F6F7-STUB(<lane>)`; stubs return the empty
  answer (no-op, `false`, `0`, `null`, `[]`), never throw, so every lane's tests run before the others merge.
- **P4. Money on the wire:** price per unit as a number (same bound as listings, `assertInt4Paise`), totals and
  advances as decimal strings.
- **P5. Consent purge.** The append-only trigger refuses UPDATE and DELETE unless the transaction ran
  `SET LOCAL mpm.consent_purge = 'on'`; only the test cleanup (and later the DPDP deletion work) sets it.
- **P6. Withdraw triggers.** No route changes a business owner or the owner's phone today (team management is P2), so
  `withdrawContactConsents(tx, businessId, phone, reason)` is exported, tested, and called by the contact-number
  remove / replace routes now; owner change and phone change call it when those routes exist (Open item).
- **P7. Firebase env.** `FIREBASE_SERVICE_ACCOUNT_B64` (§11.5) replaces the three placeholder variables
  `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` in `.env.example`.
- **P8. Group rate limits.** "Offer actions 20 / min" and "deal actions 20 / min" are one bucket across the group's
  routes: `groupRateLimit(group, max, windowSeconds)` (`lib/group-limit.ts`, a `preHandler` doing Redis `INCR` +
  `EXPIRE` on `${prefix}rl:<group>:<userId>`, `429 RATE_LIMITED`). Messages use it too (group `message`, 30 / 60 s).
- **P9. Admin reports** (`GET /admin/reports`, `POST /admin/reports/:id/resolve`) serve both targets from one route
  file owned by L1; review hide / unhide / hide-reply live in L4's `routes/admin/reviews.ts`.
- **P10. Clocks in tests:** shift stored timestamps; never `vi.useFakeTimers` for DB-clock rules.
- **P11. `Idempotency-Key`** is optional on the wire (no key → no dedupe); the app creates one uuid per tap and reuses
  it on retry. A handler's **returned** result is stored with its status (incl. accept's committed backup + 409);
  thrown errors roll back and store nothing. As textile: the key is serialised by `pg_advisory_xact_lock` under a short
  `lock_timeout`, so a concurrent second use waits and then replays the stored reply, or answers `409
  REQUEST_IN_PROGRESS` when the first still holds the lock at the timeout. Routes that finalize photos before their
  transaction check for a stored reply first (`readStoredResponse`) so a replay never touches storage.
- **P12. Route files:** `POST /listings/:id/enquiry` lives in `routes/threads.ts` and `POST /listings/:id/offers` in
  `routes/offers.ts`, so no lane edits F2's `routes/listings.ts`.
- **P13. `% below asking`** rounds down (never overstates); `percentBelowAsking` returns null at or above asking.
- **P14. Notification recipients:** §11.1's rule "never the actor's own business for the actor's own action" wins over
  §11.3's "Both" when a party caused the event (buyer's confirm received → `deal_completed` to the seller only);
  system and support events (auto-complete, dispute resolved, agreed reminder) go to both. Consequence: the buyer who
  confirmed gets "Rate this deal" from the Deal record's review card (L7-3, opening L8's review screen), not a push.
- **P15. Viewers may archive** (controller ruling 2026-11-19): archive is per-user state, so `PUT` / `DELETE
  /threads/:id/archive` are allowed for `viewer`; one-line note added to spec §12.

## Review focus

1. **A number leaking outside chat text:** an offer note, reject note, deal notes, handover note, dispute description,
   inbox preview, socket payload, push text, or another user's idempotent replay, in Devanagari or Gujarati digits,
   read by a `viewer` after reveal or by anyone before it. Pinned in L1-4 (`chat-privacy.test.ts`), L4-3 (render).
2. **Stock drift:** `held_quantity` ≠ the sum of active holds after cancel, completion, dispute close or admin remove; a
   listing stuck `reserved` with stock free, or `live` with none; a sell-out on a hidden listing lost. Pinned in C1-1
   (`holds.test.ts`, invariant helper called after every case in L2-3, L3-2, L3-3, I-1).
3. **Accept races and retries:** two accepts for the last units, accept vs withdraw, accept vs pause, a retried tap after
   a lost response. Pinned in L2-3 (`offers-accept.test.ts`).
4. **A deal that can't finish:** blocked pair, suspended party, listing removed or hidden, dispute resumed, cancel
   request pending when auto-complete fires. Pinned in L3-2, L3-4, I-1.
5. **Notification spam or loss:** a job notifying twice, two grouped chat rows for one thread, a revived offer missing
   its own "expiring soon", a push sent while the user reads the thread. Pinned in L2-5, L4-3, L4-4.

---

## Lanes and ownership

| Lane | Wave | Owns (only these files) | Assumes from contracts |
|---|---|---|---|
| **L1 API chat** | A | `services/chat/{thread.service,enquiry.service,message.service,inbox.service,block.service,conversation-report.service,admin-read.service,message-emit}.ts` (`message-emit.ts`: the C0-4a stub `emitMessageNew`, filled by L1), `services/consent/contact-consent.service.ts`, `services/business/contact-phone.service.ts`, `services/reports/admin-reports.service.ts`, `routes/{threads,blocks,contact-phone,badges}.ts`, `routes/admin/{conversations,reports}.ts`, `socket/setup.ts`, tests `chat-*.test.ts`, `admin-conversations.test.ts` | seams (C0-4a), masking / photos / idempotency (C0-3), `insertTestDeal` |
| **L2 API offers** | A | `services/offers/{offer-rules,offer.service,offer-view,accept.service,reconcile,offer-jobs,admin-enquiries.service}.ts`, `services/deals/deal-create.ts`, `services/admin/user-status.service.ts`, `routes/admin/users.ts` (suspend / block through `runTx`), `routes/offers.ts`, `routes/admin/enquiries.ts`, tests `offers-*.test.ts`, `offer-jobs.test.ts`, `admin-enquiries.test.ts` | holds + `syncReservation` (C1-1), `maybeReveal` stub (L1) |
| **L3 API deals** | A | `services/deals/{deal-read.service,deal-actions,deal-view,deal.service,deal-cancel,dispute.service,deal-jobs,deal-admin.service}.ts`, `routes/deals.ts`, `routes/admin/{deals,disputes}.ts`, tests `deals-*.test.ts`, `deal-jobs.test.ts`, `admin-deals.test.ts` | holds (C1-1), `reconcileOffersForListing` stub (L2), `insertTestDeal` |
| **L4 API reviews + notifications** | A | `services/reviews/*`, `services/notifications/*` except `notify.ts`, `routes/{reviews,notifications,devices}.ts`, `routes/admin/reviews.ts`, `apps/api/package.json` + lockfile (`firebase-admin`), `.env.example` Firebase lines, tests `reviews-*.test.ts`, `notifications.test.ts`, `push.test.ts` | `notify(tx)` (C0-4a), `insertTestDeal` |
| **L5 admin pages** | B | `apps/admin/app/(dashboard)/{enquiries,deals,disputes,chats,reports}/**`, `apps/admin/components/{enquiries,deals,disputes,conversations,reviews}/**`, `apps/admin/lib/{enquiries-api,deals-api,disputes-api,conversations-api,reviews-admin-api}.ts`, `lib/nav.ts`, `lib/nav-badges.ts`, `lib/businesses-api.ts`, `components/businesses/business-detail.tsx`, `components/settings/marketplace-settings-form.tsx` | admin view types (C0-1), the admin APIs merged in wave A |
| **L6 app chat** | B | `screens/tabs/chats.tsx`, `screens/chat/**`, `screens/profile/{contact-number,blocked-businesses}.tsx`, `components/chat/**` except `OfferCard.tsx` / `DealCard.tsx`, `components/contact/ShareNumberSheet.tsx`, `lib/{chat-api,chat-format,chat-composer,socket-chat}.ts` + tests, `hooks/use-chat.ts`, `locales/*/chats.json` | navigation, placeholders, query keys, analytics, error copy (C0-5) |
| **L7 app offers + deals** | B | `components/chat/{OfferCard,DealCard}.tsx`, `components/{offers,deals}/**`, `screens/deals/**`, `screens/tabs/deals.tsx`, `screens/listing/{listing,listing-view}.tsx`, `lib/{offers-api,deals-api,offer-form,deal-display,listing-page,socket-deals}.ts` + tests, `hooks/{use-offers,use-deals,use-pending-contact}.ts`, `locales/*/{offers,deals,listing}.json` | as L6; `EnquireSheet` and `ShareNumberSheet` props, `openPendingContact` stub (C0-5) |
| **L8 app reviews, notifications, push, My listings** | B | `screens/reviews/**`, `screens/notifications/**`, `screens/my-listings/**`, `screens/profile.tsx`, `screens/tabs/home.tsx`, `navigation/tab-navigator.tsx`, `navigation/floating-tab-bar.tsx` (badges), `locales/*/holds.json`, `lib/{reviews-api,notifications-api,review-form,push,push-dedupe,push-ask,notification-links,socket-notifications,my-listings-holds}.ts` + tests, `hooks/{use-badges,use-notifications,use-push}.ts`, `screens/sell/published.tsx` (one call), `App.tsx`, `app.json`, `app.config.ts`, `apps/user-app/package.json` + lockfile (`expo-notifications`), `locales/*/{reviews,notifications,profile,home}.json` | as L6 |

**Waves.** Wave A = L1, L2, L3, L4 (API, independent services; seams fixed in C0 / C1). Wave B = L5, L6, L7, L8 (they
need only C0's types to compile, but run after wave A merges so the controller can smoke-test them against a real API).
If memory is short: A1 = L1 + L2, A2 = L3 + L4, B1 = L5 + L6, B2 = L7 + L8. Each wave: lanes reviewed one by one,
merged into `develop` one by one, then the wave's suites once and a fix wave on `develop`.

**Lane setup checklist (controller, per lane, from the commit the wave starts on):**
1. `git worktree add .claude/worktrees/f6-<lane> -b lane/f6-<lane> develop`.
2. Copy the root `.env` into the worktree root (never committed); in that copy set `TEST_DATABASE_URL` to
   `…/mpm_<lane>_test` (e.g. `mpm_l1_test`) and `TEST_REDIS_URL` to `redis://localhost:6381/<2 + lane number>`
   (wave B: the app lanes run no API tests; L5 likewise; give them a DB only if they run the API suite).
3. `docker exec mpm-postgres-1 createdb -U mpm mpm_<lane>_test` (once; the name must end in `_test`).
4. In the worktree: `pnpm install --offline`, `pnpm --filter @mpm/shared-types build`,
   `pnpm --filter @mpm/api db:migrate:test` (against the lane's DB).
5. Hand the implementer the worktree path, the lane's rows of this plan, the ownership row and the base commit.
6. After the merge: `git worktree remove`, `dropdb` the lane's test DB, delete the lane branch.

---

## File map

```
packages/shared-types/src/index.ts                       constants, pure fns, views, settings, transitions (C0-1, C1-1)
apps/api/src/lib/f6-shared.test.ts                       pure fn tests (C0-1)
apps/api/src/db/schema.ts, infra/migrations/0012_*, 0013_* tables, enums, columns, partial indexes; custom CHECKs/trigger/sequence (C0-2)
apps/api/__tests__/_helpers/test-deals.ts (+ test-users.ts, test-businesses.ts hooks)   fixtures, cleanup (C0-2)
apps/api/src/lib/{tx-effects,mask-contact}.ts, services/chat/{scam-patterns,private-photo}.ts   (C0-3)
apps/api/src/plugins/idempotency.ts, services/idempotency.service.ts                     (C0-3)
apps/api/src/lib/group-limit.ts, apps/api/vitest.config.ts (GROUP_RATE_LIMIT_MAX)        (C0-4a)
apps/api/src/services/chat/{members,chat-view,chat-emit,thread-lines,open-thread,viewing}.ts   (C0-4a)
apps/api/src/services/deals/locks.ts, services/notifications/notify.ts                   (C0-4a)
apps/api/src/routes/{threads,offers,deals,reviews,notifications,devices,blocks,contact-phone,badges}.ts,
  routes/admin/{enquiries,deals,disputes,conversations,reports,reviews}.ts, app.ts, jobs/index.ts, socket/rooms.ts,
  lib/per-user-limit.ts, lib/sentry.ts, services/admin/business-admin.service.ts, stub files   (C0-4b)
apps/user-app/navigation/*, screens placeholders, locales/{en,hi,gu}/{offers,reviews,notifications,holds}.json,
  locales/index.ts, lib/{analytics-events,pending-action,sign-in-gate,f6-errors,share-listing,query-keys,push-ask}.ts,
  hooks/{useSocket,use-saved,use-pending-contact}.ts, components/SocketProvider.tsx, lib/error-reporting.ts,
  locales/*/{errors,auth}.json                                                           (C0-5)
apps/api/src/services/deals/holds.ts, services/listings/*, services/discovery/*          (C1)
lanes: see the ownership table
docs/PROJECT_STATUS.md, CLAUDE.md, apps/user-app/CLAUDE.md, apps/admin/CLAUDE.md, .env.example,
  apps/user-app/.env.example, docs/product-scope.md, F4 spec §2 / §8.3 note              (I-4)
```

---

# Batch C0 — Contracts (sequential, on `develop`)

### C0-1: Shared types and pure functions

**Files:** Modify `packages/shared-types/src/index.ts`; Create `apps/api/src/lib/f6-shared.test.ts`.

**Contents (§5.16, §7.2, §7.4, §6.2, §6.10, §9.2, §10.3, §17):**
- Constants: `QUICK_ENQUIRIES` + `price_request` (keep the existing six keys and order); `OFFER_STATUSES` + `backup`,
  `closed`; `OFFER_KINDS = ['offer','buy_now','quote']`; `OFFER_CLOSE_REASONS = ['listing_unavailable',
  'listing_changed','blocked','account_inactive']`; `PARTY_SIDES = ['buyer','seller']`; `MESSAGE_KINDS = ['text',
  'photos','enquiry','offer','deal','system']`; `MAX_COUNTER_ROUNDS` comment "then accept or reject only";
  `DEAL_STATUSES = ['agreed','handed_over','completed','cancelled','disputed']`; `DEAL_COMPLETED_HOW =
  ['buyer_confirmed','auto','support']`; `DEAL_CANCELLED_BY = ['buyer','seller','both','system']`;
  `DEAL_CANCEL_REASONS_BUYER` / `_SELLER` / `_SYSTEM` (§5.16); `DEAL_PAYMENT_METHODS = ['bank','upi','cash','credit']`;
  `DEAL_FULFILMENT = ['pickup','delivery']`; `DEAL_EVENT_CODES` (§5.9); `DEAL_ACTOR_SIDES = ['buyer','seller','system',
  'support']`; `HOLD_STATUSES = ['active','converted','released']`; `DISPUTE_CATEGORIES`, `DISPUTE_STATUSES =
  ['open','resolved']`, `DISPUTE_OUTCOMES = ['completed','cancelled','resumed']`; `REVIEW_FACETS = { buyer:
  ['matched_listing','communication','on_time'], seller: ['communication','payment','pickup'] } as const`;
  `REVIEW_REPORT_REASONS`, `CONVERSATION_REPORT_REASONS`; `REPORT_TARGETS` + `review`; `NOTIFICATION_TYPES` + the 11 of
  §5.16 and `review_waiting` (category `reviews`: §10.3 "the other side is notified it has until then"); `NOTIFICATION_CATEGORIES = ['chat','offers','deals','reviews']` and `notificationCategory(type)`;
  `DELIVERY_STATES = ['queued','sent','sent_dev','failed','skipped']`; `DEVICE_PLATFORMS = ['android','ios']`;
  `SYSTEM_LINE_CODES` (§6.9, 19 codes); `CONSENT_KINDS = ['grant','withdraw']`, `CONSENT_WITHDRAW_REASONS =
  ['number_removed','number_replaced','owner_changed']`, `CONSENT_PHONE_SOURCES = ['business_contact','owner_phone']`,
  `CONSENT_WORDING_VERSION = 1`; `CHAT_LIMITS` (§5.16) and `DEAL_LIMITS` (every text and photo bound in Global
  constraints); `ADMIN_READ_WINDOW_DAYS = 30`.
- `APP_SETTINGS` gains the 15 keys of §17 with defaults, ranges, labels and help; `validateSettings` gains the five
  cross-checks of §17 (`offer_validity_hours_1 < _2 < _3`; `offer_expiring_notice_hours < _1`;
  `deal_problem_window_days < deal_auto_complete_days`; `review_blind_days ≤ review_window_days`;
  `offer_backup_max_days × 24 ≥ offer_validity_hours_3`).
- Pure functions: `quantityToMilli(q: string): bigint` (≤ 3 decimals, else throws), `milliToQuantity(m: bigint): string`
  (trailing zeros trimmed), `fitsUnitDecimals(q: string, decimals: number): boolean`; `totalPaise(pricePerUnitPaise:
  number | bigint, quantity: string): bigint` = `(price × milli + 500n) / 1000n`; `percentBelowAsking(price, asking):
  number | null` (P13); `counterBounds({ by: PartySide, buyerLatestPaise: number | null, sellerLatestPaise: number }):
  { minPaise: number; maxPaise: number }` (inclusive integers: buyer `min = B ?? 1`, `max = S − 1`; seller
  `min = B + 1`, `max = S`; §7.4); `enquiryStatus({ dealCount, firstSellerReplyAt, hasOpenNegotiation, listingPublic,
  blocked }): EnquiryStatus` (§6.2 table, first match wins); `threadTurns({ openTurn: PartySide | null,
  enquiryOpen: boolean, deals: { status: DealStatus; cancelRequestedSide: PartySide | null }[] }): { buyer: boolean;
  seller: boolean }` (§6.10); `dealYourTurn(deal, side): boolean` (§9.2 last bullet); `reviewWindowEnd(completedAt,
  windowDays): Date`; `publishDueAt(submittedAt, completedAt, blindDays, windowDays): Date` (min rule §10.3).
- Views: `InboxRow`, `ThreadDetail` (incl. `listingStrip` with `noLongerListed`, `contact: { mine: boolean; theirs:
  boolean; revealed: boolean; number: string | null; canTick: boolean; ownerOnlyHint: boolean }`, `canWrite`,
  `blockState`, `openNegotiation: OfferView | null`, `deals: DealListRow[]`), `ThreadMessage` (photos as
  `{ url: string; expiresAt: string }[]`, `scamWarning: boolean` only for the other side, `system: { code, values }`,
  `enquiry`, `offer: OfferView | null`, `deal: { id, ref, status, totalPaise } | null`), `OfferView` (incl. `actions:
  ('accept'|'reject'|'counter'|'withdraw'|'reconfirm')[]`, `bounds` for the turn side, `round`, `roundsLeft`,
  `needsReconfirm`), `DealView` (terms, notes, timeline, `actions`, contact block, `dispute`, `review`), `DealListRow`,
  `ReviewState`, `PublicReview`, `SellerScore`, `NotificationRow`, `Badges`, `OffersOptions`; admin
  `AdminEnquiryRow`, `AdminEnquiryDetail` (chain without text), `AdminDealRow`, `AdminDealDetail` (structured notes, no
  `notes_text`), `AdminDisputeRow`, `AdminDisputeDetail`, `AdminThreadRead`, `AdminReportRow` (target `conversation` |
  `review`), `AdminBusinessDealHistory`; `AdminBusinessDetail` gains `dealHistory: AdminBusinessDealHistory` and
  `sellerScore: SellerScore | null`; `ListingCard` gains `availableQuantity: string | null`; `ListingDetail` gains
  `availableQuantity`, `myThreadId: string | null`, `openNegotiation: { offerId, status, turn, pricePerUnitPaise } |
  null`, `seller.score: SellerScore | null`; `ListingOwnerView` gains `heldQuantity: string`.

- [ ] **Step 1: Failing tests** (`f6-shared.test.ts`): `totalPaise` half-up table (`(5,'0.1')→1n`, `(3,'0.1')→0n`,
  `(333,'1.5')→500n`, `(2147483647,'99999999999.999')` exact, `(3400000,'2.500')→8500000n`); `quantityToMilli` refuses 4
  decimals; `fitsUnitDecimals`; `percentBelowAsking` (`(90,100)→10`, `(66667,100000)→33`, at / above asking → null);
  `counterBounds` table: buyer after a quote (`B` null), buyer with B, seller with B, after three counters; `enquiryStatus`
  every row incl. ordering (converted beats closed); `threadTurns` (pending turn seller; open enquiry; `agreed`;
  `handed_over`; cancel request by buyer → seller's turn); `dealYourTurn`; `publishDueAt` picks the earlier bound;
  `validateSettings` refuses each of the five cross-checks and accepts the defaults.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; build shared-types; fix every consumer of `ListingCard` /
  `ListingDetail` / `ListingOwnerView` to compile (API mappers return `availableQuantity: quantity`, `myThreadId: null`,
  `openNegotiation: null`, `seller.score: null`, `heldQuantity: '0'` until C1-3; app fixtures). **Step 4:** PASS;
  `pnpm typecheck`. **Step 5: Stage.**

### C0-2: Schema, migrations, fixtures

**Files:** Modify `apps/api/src/db/schema.ts`; Create `infra/migrations/0012_<generated>.sql`,
`infra/migrations/0013_f6_checks_triggers.sql` (+ meta); Create `apps/api/__tests__/_helpers/test-deals.ts`; Modify
`__tests__/_helpers/test-users.ts` (`deleteListingsOf`, `deleteTestListings(conn, ids)`, `deleteTestUsers`),
`test-businesses.ts` (`deleteTestBusinesses`) to call `deleteF6Rows` first (so thread / deal FKs never block a listing
delete); Test `apps/api/__tests__/f6-schema.test.ts`.

**Contents (§5.1–§5.15, §5.17):** enums `message_kind`, `party_side`, `offer_kind`, `offer_status`, `hold_status`,
`deal_status`, `deal_completed_how`, `deal_cancelled_by`, `deal_payment_method`, `deal_fulfilment`, `deal_actor_side`,
`dispute_status`, `dispute_outcome`, `consent_kind`, `notification_category`, `delivery_state`, `device_platform`;
`report_target` gains `review` (the generated `ALTER TYPE … ADD VALUE`; nothing in 0012 / 0013 uses it). Every table
and index of §5 with the exact columns there; `deals.ref` and `chat_messages.seq` bigserial; `listings.held_quantity
numeric(14,3) NOT NULL DEFAULT 0`; `businesses.contact_phone`, `contact_phone_verified_at`; `users.push_enabled`.
**Partial indexes are declared in `schema.ts`** with `.where(sql\`…\`)` (drizzle-kit emits the `WHERE`, as F2's
`reports_one_open_uq`): unique `offers_one_open_per_thread` (`status IN ('pending','backup')`),
`notifications_open_chat_row` (`(user_id, thread_id) WHERE type = 'message_new' AND read_at IS NULL`),
`deal_disputes_one_open`; plain partial indexes for Your turn ×2, open deals per listing, pending offers by expiry,
handed-over deals by `auto_complete_at`, unpublished reviews, published-visible reviews, unread notifications.
Custom 0013 (only what Drizzle can't express): CHECKs `chat_messages_shape` (per kind), `chat_messages_photos_max` (≤ 5), `deal_disputes_photos_max`,
`deal_reviews_shape` (facets per side, seller-side text null), `deals_advance_le_total`,
`listings_held_quantity_range` (`0 ≤ held_quantity ≤ quantity`, `quantity IS NULL` → held 0),
`chat_threads_parties_differ`; `listings_quantity_positive` dropped and recreated as `quantity IS NULL OR quantity >=
0`; `ALTER SEQUENCE deals_ref_seq RESTART WITH 500001`; trigger `contact_share_consents_append_only` (BEFORE UPDATE OR
DELETE, raises unless `current_setting('mpm.consent_purge', true) = 'on'`, P5).

**Helpers (`test-deals.ts`):** `addTestMember(businessId, role: MemberRole): Promise<{ userId; token }>`;
`insertTestThread({ listingId, buyerBusinessId, buyerUserId })`; `insertTestOffer({ threadId, …, status, turn, round,
kind, pricePerUnitPaise, quantity })`; `insertTestDeal({ listing, buyer, quantity, pricePerUnitPaise, status? })`
(thread + accepted offer + deal + active hold + `held_quantity` in one transaction, raw SQL consistent with the
invariant; `status: 'handed_over'` sets both timers; `status: 'completed'` sets `completed_at` and converts the hold —
quantity down, `held_quantity` back, hold `converted`); `assertHeldInvariant(listingId)` (held = Σ active holds,
`0 ≤ held ≤ quantity`); `deleteF6Rows(conn, { businessIds, userIds, listingIds? })` (FK order: deliveries,
notifications, devices, reports on `conversation` / `review` targets of those threads / reviews, reviews, disputes,
deal events, holds, messages, deals, offers, thread user state, threads, blocks, idempotency keys whose scope ends in a
user id; the consents are deleted first **in a transaction of their own** that runs `SET LOCAL mpm.consent_purge =
'on'`, since `SET LOCAL` lasts only for its transaction).

- [ ] **Step 1: Failing tests** (`f6-schema.test.ts`): a second `pending` offer in a thread refused, a `pending` after
  an `accepted` allowed; second unread `message_new` row for the same user + thread refused, allowed once the first is
  read; second open dispute per deal refused; shape CHECKs, three cases only (a `text` message with `offer_id`, 6 photo
  keys, a seller review with text); advance > total refused; `held_quantity` > quantity and < 0 refused; listing
  quantity 0 accepted, −1 refused; the first deal's `ref` ≥ 500001; consent UPDATE and DELETE refused, DELETE allowed
  under the purge setting; `report_target` has `review`; a second thread for the same listing + buyer refused;
  `deleteF6Rows` leaves no row behind for a fixture with one of everything, and `deleteTestListings` then succeeds.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; `db:generate`; `drizzle-kit generate --custom` for 0013; `db:migrate`;
  `db:migrate:test`. **Step 4:** PASS; the F2 schema suite (`schema-f2.test.ts`) still passes. **Step 5: Stage.**

### C0-3: Masking, scam check, private photos, idempotency

**Ports:** textile `apps/api/src/lib/mask-contact.ts`, `services/chat/scam-patterns.ts`, `services/chat/private-photo.ts`,
`plugins/idempotency.ts`, `services/idempotency.service.ts`.

**Files:** Create `apps/api/src/lib/tx-effects.ts`, `apps/api/src/lib/mask-contact.ts` + `mask-contact.test.ts`,
`apps/api/src/services/chat/scam-patterns.ts` + `scam-patterns.test.ts`, `apps/api/src/services/chat/private-photo.ts`,
`apps/api/src/plugins/idempotency.ts`, `apps/api/src/services/idempotency.service.ts`; Modify `apps/api/src/app.ts`
(register the idempotency plugin after auth), `apps/api/package.json` (+ `sharp`); Test
`apps/api/__tests__/private-photo.test.ts`, `apps/api/__tests__/idempotency.test.ts`.

**Interfaces:**
- `maskPhones(text)`, `maskEmails(text)`, `maskContact(text)` (§6.5: +91 / 91 / 0 and 10 digits starting 6–9,
  Devanagari U+0966–096F and Gujarati U+0AE6–0AEF digits, separators space / hyphen / dot / parentheses, longer digit runs
  left alone; `••••••••••` and `•••@•••`; a handle without a dot after `@` is not an email).
- `looksLikeScam(text): boolean` (§6.7; the phrase set: en `advance`, `advance payment`, `token amount`, `pay first`,
  `booking amount`; Latin-typed `pehle payment`, `pehle paise`, `advance bhejo`, `token bhejo`; hi `एडवांस`, `अग्रिम`,
  `पहले पैसे`, `पहले पेमेंट`, `टोकन राशि`; gu `એડવાન્સ`, `પહેલા પૈસા`, `પહેલાં પેમેન્ટ`, `ટોકન રકમ`; UPI `upi://`, `pay?pa=`,
  handles `@ok(axis|hdfcbank|icici|sbi)`, `@ybl`, `@paytm`, `@ibl`, `@axl`, `@upi`; hosts `rzp.io`, `razorpay.me`,
  `paytm.me`, `phon.pe`, `gpay.app.goo.gl`, `pay.google.com`).
- `presignPrivatePhoto(businessId, contentType, contentLength): Promise<{ url; key; expiresAt }>` → key
  `incoming-chat/<businessId>/<uuid>` (300 s; `400 PHOTO_INVALID` for another type or > 10 MB);
  `finalizePrivatePhotos(businessId, keys: string[], dest: { kind: 'chat'; threadId } | { kind: 'deal'; dealId }):
  Promise<string[]>` (prefix check first → `400 PHOTO_KEY_INVALID`; read ≤ 10 MB; `sniffMedia` JPEG / PNG / WebP; re-encode;
  write `chat/<threadId>/<uuid>.jpg` or `deal/<dealId>/<uuid>.jpg`; delete the upload; any failure → `400 PHOTO_INVALID`,
  finals already written are deleted); `reencodeToJpeg(bytes: Uint8Array): Promise<Buffer>` (`sharp().rotate()
  .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 })`, no
  `withMetadata`); `privatePhotoUrl(key): Promise<{ url; expiresAt }>` (`presignPrivateGet`, 300 s).
- After-commit effects (P2), `lib/tx-effects.ts`: `runTx<T>(app: TxApp, fn: (tx: Tx) => Promise<T>): Promise<T>`,
  `runJobTx` (same, for jobs), `queueUserEmit(tx, userId, event, payload)`, `queueAdminEmit(tx, role: AdminRole,
  event, payload)`, `effectsTx(tx, fn)` (a savepoint whose child queue merges into the parent on release and is
  discarded on rollback); `TxApp = Pick<FastifyInstance, 'db' | 'io' | 'log'>`. Queuing on a `tx` without a queue
  throws when `NODE_ENV === 'test'`, else logs a warning and drops; the flush is a no-op when `app.io` is unset (P2).
  Built here because idempotency needs it.
- Idempotency (textile `idempotency.service.ts`): route option `config: { idempotent: true }`; `runIdempotent(request,
  reply, app, fn: (tx) => Promise<{ status: number; body: unknown }>)` runs `fn` inside `runTx`: first
  `pg_advisory_xact_lock(hashtext('idem:' || scope || ':' || key))` under `lock_timeout` (2 s; a timeout →
  `409 REQUEST_IN_PROGRESS`), then reads the stored row (replay with `Idempotent-Replay: true`; another request hash →
  `422 IDEMPOTENCY_KEY_REUSED`), else runs `fn` and stores `{ status, body }` under scope `${routeId}:${userId}` + key
  in the same transaction; `readStoredResponse(conn, scope, key)` for routes that must check before work outside the
  transaction (photo finalize, P11); `sweepIdempotencyKeys(db)` deletes keys older than 24 h. Stored bodies are never
  logged (§19).

- [ ] **Step 1: Failing tests:** `mask-contact.test.ts` — textile's cases plus `+91 98765 43210`, `09876543210`,
  `(98765) 43210`, Devanagari `९८७६५४३२१०`, Gujarati `૯૮૭૬૫૪૩૨૧૦`, mixed separators; a 12-digit part number and a GSTIN
  unchanged; `rahul@gmail.com` masked; `rocky@okaxis` not an email. `scam-patterns.test.ts` — every phrase / handle /
  host above true (one per script), five ordinary enquiry sentences false. `private-photo.test.ts` — a JPEG built in the
  test with sharp `withMetadata` + GPS EXIF re-encodes to `jpegHeaderStatus(out) === 'clean'` with no `Exif` APP1; a
  4 000 px PNG becomes a ≤ 2 048 px JPEG; WebP in → JPEG out; random bytes → `PHOTO_INVALID`; a key under another
  business → `PHOTO_KEY_INVALID` with no storage call (spy); under `R2_TESTS=1`: presign → PUT → finalize → the upload is
  gone and a second finalize of the same key → `PHOTO_KEY_INVALID`. `idempotency.test.ts` (a test-only route registered
  in the file) — replay returns the same body, the handler ran once, header set; different body → 422; two concurrent
  first uses → the handler runs once and both answer the same body (the second a replay); with a slow handler (longer
  than a 100 ms test `lock_timeout`) the second answers `409 REQUEST_IN_PROGRESS`; another user's same key runs fresh;
  a thrown error stores nothing; sweep deletes a 25-hour-old key only. `tx-effects` (same file) — `runTx` flushes a
  queued emit after commit only and drops it on rollback; an `effectsTx` savepoint that rolls back loses only its own
  emits, one that releases keeps them; queuing outside `runTx` throws under tests; no `app.io` → flush is a no-op.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; `pnpm --filter @mpm/api add sharp`. **Step 4:** PASS. **Step 5: Stage.**

### C0-4a: API seams (real bodies)

**Ports:** textile `services/chat/{chat-view,chat-emit,archive}.ts`, `message.service.ts` (`insertMessage`,
`addSystemMessage`, `addCardMessage`), `thread.service.ts` (`readerOf`, `assertCanWrite`, `getThreadForMember`),
`services/notifications/{notification.service,recipients,viewing}.ts` (row creation only).

**Files:** Create `apps/api/src/lib/group-limit.ts`, `services/chat/{members,chat-view,chat-emit,
thread-lines,open-thread,viewing}.ts`, `services/deals/locks.ts`, `services/notifications/notify.ts`; Modify
`apps/api/vitest.config.ts` (`GROUP_RATE_LIMIT_MAX: '1000000'`, as `RATE_LIMIT_MAX`); Test
`apps/api/__tests__/f6-seams.test.ts`.

**Interfaces (used by every lane; names are final):**
- `runTx`, `runJobTx`, `queueUserEmit`, `queueAdminEmit` from C0-3.
- `open-thread.ts` (shared by L1's enquiry and L2's offers): `openOrGetThread(tx, user: UserTokenPayload, listingId):
  Promise<{ thread; reader; created: boolean }>` — §6.1 refusals in order (`404 LISTING_NOT_FOUND` via
  `publicListingWhere`, `409 OWN_LISTING`, `403 VIEWER_READ_ONLY`, `403 BUSINESS_BLOCKED`), `lockBuyerBusiness`, then
  for a new thread the daily limit (threads created today in IST by the business vs
  `enquiry_new_per_day_{unverified,verified}` → `429 ENQUIRY_LIMIT`), `INSERT … ON CONFLICT (listing_id,
  buyer_business_id) DO NOTHING` then read; seller copied from the listing.
- `groupRateLimit(group: 'message' | 'offer' | 'deal', max: number, windowSeconds: number)` → preHandler (P8);
  `GROUP_RATE_LIMIT_MAX`, when set, replaces every group's max (read when the app is built: the vitest config sets
  1 000 000; a limit test builds its own app with it set low).
- `members.ts`: `type ChatReader = { userId; businessId; memberRole: MemberRole; side: PartySide }`;
  `getThreadForParty(conn, user: UserTokenPayload, threadId, opts?: { lock?: boolean }): Promise<{ thread; reader }>`
  (`404 THREAD_NOT_FOUND` for outsiders); `assertCanWrite(reader)` (`403 VIEWER_READ_ONLY`); `threadMembers(conn,
  thread): Promise<ChatReader[]>` (active users of both businesses); `businessMembers(conn, businessId)`.
- `chat-view.ts`: `canSeeContact(thread, reader)`, `visibleText(text, reader, thread)` (§6.5).
- `chat-emit.ts`: `emitToThreadMembers(tx, thread, event, build: (reader: ChatReader) => unknown | Promise<unknown>)`
  (built inside the transaction, queued per member to `userRoom`); `emitToBusinesses(tx, businessIds, event,
  payload)` for id-only events (`deal:updated`).
- `thread-lines.ts` (the only writer of `chat_messages`): `insertMessage(tx, thread, values): Promise<MessageRow>`
  (sets `last_message_seq/at`, `last_buyer_seq` / `last_seller_seq` by side, system lines raise both, clears
  `archived_at` for the receiving business's members, §5.3; sets `first_seller_reply_at` on the first seller-sent row
  — a seller's reject, which writes only a system line, sets it in L2-2); `insertSystemLine(tx, threadId, code: SystemLineCode,
  values: Record<string, string | number>)`; `insertCardMessage(tx, threadId, { kind: 'offer' | 'deal', offerId?,
  dealId?, senderSide, senderUserId })`; `recomputeTurns(tx, threadId)` (reads the open negotiation, enquiry status and
  the thread's deals, writes `buyer_turn` / `seller_turn` from `threadTurns`).
- `viewing.ts`: `viewingKey(userId)` = `${prefix}viewing:${userId}`, TTL 45 s; `setViewing(redis, userId, threadId |
  null)`, `isViewing(redis, userId, threadId): Promise<boolean>`.
- `locks.ts`: `lockBuyerBusiness(tx, businessId)` (`FOR NO KEY UPDATE`), `lockListingsInOrder(tx, ids)` (id order, for
  block and owner suspension), `lockDeal(tx, dealId)`, `lockOffers(tx, ids)` (id order), `lockThread(tx, threadId)`;
  its doc comment states the §8.5 order and that **F6 / F7 code never locks the seller business** (only F2's seller and
  admin writers do, business → listing, which is compatible); single-listing locks reuse `lockListingOnly` from
  `services/listings/locks.ts`.
- `notify.ts`: `notify(tx, { type, recipientBusinessId, params, destination: { threadId?, offerId?, dealId?,
  reviewId? }, dedupeKey })` → one `notifications` row per active member (viewers included; `ON CONFLICT (user_id,
  dedupe_key) DO NOTHING`), one `notification_deliveries` row `queued` per device of each recipient with
  `push_enabled`, queues `notification:new { unreadCount }`. Dedupe keys `<type>:<entityId>[:<qualifier>]`. `params`
  hold ids and safe values only (business name, listing title, price per unit, quantity, deal ref).

- [ ] **Step 1: Failing tests:** `f6-seams.test.ts` — `emitToThreadMembers` emits once per active member of both
  businesses, a viewer's payload built with `memberRole: 'viewer'`, a suspended member skipped; `visibleText` matrix
  (unlocked × owner / sales / viewer); `openOrGetThread` — two concurrent first calls → one thread, own listing 409,
  block 403, viewer 403, a non-public listing 404; `insertMessage` sequence and per-side seq columns, system line raises
  both, archive cleared for the receiving business only, `first_seller_reply_at` set by the first seller row only;
  `recomputeTurns` for the five `threadTurns` cases on real rows; `notify` — one row per active member incl. a viewer,
  none for the other business, repeat dedupe key no-op, deliveries only for devices of `push_enabled` users, emit
  queued; `getThreadForParty` 404 for a third business, `assertCanWrite` 403 for a viewer; `groupRateLimit` — on an app
  built in the test with `GROUP_RATE_LIMIT_MAX` lowered to 3, the 4th `offer` call across two test routes is 429.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### C0-4b: Stubs, route stubs, RBAC, jobs, Sentry, admin business detail

**Files:** stub files (P3) for every cross-lane function below; route stubs `routes/{threads,offers,deals,reviews,
notifications,devices,blocks,contact-phone,badges}.ts`, `routes/admin/{enquiries,deals,disputes,conversations,reports,
reviews}.ts`; Modify `app.ts` (register all), `jobs/index.ts`, `socket/rooms.ts` (remove `threadRoom`),
`lib/per-user-limit.ts` (`perUser(max, timeWindow = '10 minutes')`), `lib/sentry.ts` (redaction keys §19),
`services/admin/business-admin.service.ts` (`getBusinessDetail` adds `dealHistory: await businessDealHistory(...)`,
`sellerScore: await sellerScore(...)`); Test `apps/api/__tests__/f6-routes.test.ts`.

- Stubs (P3), bodies replaced by the owning lane: L1 `maybeReveal(tx, threadId): Promise<boolean>`,
  `validConsent(conn, threadId, businessId): Promise<boolean>` (`services/consent/contact-consent.service.ts`),
  `unreadThreadCount(conn, user): Promise<number>` (`services/chat/inbox.service.ts`);
  L2 `reconcileOffersForListing(tx, listingId)`, `closeChainsBetween(tx, businessA, businessB)`,
  `closeChainsForInactiveOwner(tx, businessId)` (`services/offers/reconcile.ts`), `expireOffers(app)`,
  `notifyExpiringOffers(app)` (`services/offers/offer-jobs.ts`); L3 `cancelAgreedDealsForRemovedListing(tx, listingId,
  adminId)` (`services/deals/deal-cancel.ts`), `dealsYourTurnCount(conn, user)`, `businessDealHistory(conn,
  businessId)` (`services/deals/deal-read.service.ts`), `autoCompleteDeals(app)`, `remindAgreedDeals(app)`
  (`services/deals/deal-jobs.ts`); L4 `sellerScore(conn, businessId): Promise<SellerScore | null>`
  (`services/reviews/review-scores.ts`), `publishDueReviews(app)` (`services/reviews/review-jobs.ts`),
  `upsertChatNotification(tx, { thread, recipientBusinessId, senderBusinessName, seq })`, `markChatNotificationRead(tx,
  userId, threadId)` (`services/notifications/chat-rows.ts`), `notificationUnreadCount(conn, userId)`
  (`services/notifications/notification-read.service.ts`), `sendDuePushes(app)` (`services/notifications/push-sender.ts`),
  `deleteOldNotifications(db)` (`services/notifications/retention.ts`).
- Route stubs: every route of §12.2 and §16.2 registered in its file, handler `throw new AppError(501,
  'NOT_IMPLEMENTED')`, with its final preHandler, Zod-free for now, `config: { idempotent: true }` on the **I** routes,
  rate limits wired now: `groupRateLimit('message', 30, 60)` on message send; `groupRateLimit('offer', 20, 60)` on
  offer send, quote, accept, counter, reject, withdraw and reconfirm; `groupRateLimit('deal', 20, 60)` on every deal
  write; `perUser(30)` on both photo presigns. **Archive** (`PUT` / `DELETE /threads/:id/archive`) and **read**
  (`POST /threads/:id/read`) don't check the member role (P15); every other user write refuses a `viewer`. Admin roles
  per §16.1: enquiries and deals `support`, `operations`; disputes `support`; conversations and reports `moderator`,
  `support`; review hide / unhide / hide-reply `moderator`.
- Jobs in `jobs/index.ts` with the §14 intervals, each calling the function above (`sweepIdempotencyKeys` real now).

- [ ] **Step 1: Failing tests:** `f6-routes.test.ts` — table over every new route: 401 without a token; every admin
  route 403 for a role outside §16.1 and not 403 for `super_admin`; settings PATCH breaking a §17 cross-check → 400;
  Sentry `redact` drops each §19 key.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `pnpm --filter @mpm/api typecheck`. **Step 5: Stage.**

### C0-5: App contracts

**Files (`apps/user-app`):** Modify `navigation/types.ts`, `navigation/root-navigator.tsx` (register every new screen);
Create placeholder screens (a title and `testID` only, replaced by lanes): `screens/chat/thread.tsx` (L6),
`screens/profile/{contact-number,blocked-businesses}.tsx` (L6), `screens/deals/{deal-record,report-problem}.tsx` (L7),
`screens/reviews/{review-deal,seller-reviews,my-reviews}.tsx` (L8), `screens/notifications/{notifications,
notification-settings,permission-explainer}.tsx` (L8); placeholder components with final props:
`components/chat/EnquireSheet.tsx` (L6) `{ listing: ListingDetail; visible: boolean; preset?: 'ask_price'; onClose;
onSent?: (threadId: string) => void }`, `components/contact/ShareNumberSheet.tsx` (L6) `{ threadId: string;
counterpartName: string; visible: boolean; onClose }`, `components/offers/OfferSheet.tsx` (L7) `{ mode: 'offer' | 'buy' |
'counter' | 'quote'; listing?: ListingDetail; threadId?: string; offer?: OfferView; visible: boolean; onClose; onSent?:
(r: { threadId: string }) => void }`, `components/chat/OfferCard.tsx` (L7) `{ offer: OfferView; thread: ThreadDetail }`,
`components/chat/DealCard.tsx` (L7) `{ message: ThreadMessage; thread: ThreadDetail }`; Create
`lib/query-keys.ts` (`qk.threads(filter, archived)`, `qk.thread(id)`, `qk.messages(id)`, `qk.deals(tab, side)`,
`qk.deal(id)`, `qk.reviewState(dealId)`, `qk.sellerReviews(businessId)`, `qk.myReviews()`, `qk.notifications()`,
`qk.badges()`, `qk.offersOptions()`), `lib/socket-{chat,deals,notifications}.ts` (handler stubs `handle…(queryClient,
event, data)`), `lib/f6-errors.ts` + test (every §18 code → an `errors.*` key), `lib/push-ask.ts` (stub `askPushOnce(trigger:
'enquiry' | 'offer' | 'publish' | 'chats'): Promise<void>`, body by L8; L6 calls it on Chats open and enquiry sent, L7
on offer sent, L8 on the sell wizard's Published screen), `lib/share-listing.ts` (`shareMessage(listing, baseUrl?)`:
title, price, `#ref`, `${baseUrl}/l/<ref>` only when set, §6.13; no test); **one socket for the signed-in user**:
Create `components/SocketProvider.tsx`, mounted once in `navigation/root-navigator.tsx` around the signed-in stack
(guests get none), built on `hooks/useSocket.ts` and exposing `useSocketEmit()` (`emit(event, data)`, used by L6 for
`thread:viewing`) and `useOnReconnect(fn)` (lanes refetch their queries); Modify `hooks/useSocket.ts` (route events by
prefix: `message:` / `offer:` / `thread:` → chat, `deal:` → deals, `notification:` → notifications);
`navigation/types.ts` `Listing: { listingId: string; openSheet?: 'enquire' | 'offer' | 'buy' | 'ask_price' }`;
`lib/pending-action.ts` + test (`PendingAction` gains `{ type: 'enquire' | 'offer' | 'buy' | 'ask_price'; listingId }`;
`pendingToRun` returns them like `save`); `hooks/use-saved.ts` (`runPendingAction` handles only `save` and hands every
other type to `openPendingContact`, so a pending Enquire is never saved); Create `hooks/use-pending-contact.ts`
(stub `openPendingContact(pending): void`, L7 fills it: navigate to `Listing` with `openSheet`);
`lib/sign-in-gate.ts` + test (`SIGN_IN_REASONS` + `enquire`, `offer`),
`lib/analytics-events.ts` (`CHAT_EVENTS`, `OFFER_EVENTS`, `DEAL_EVENTS`, `REVIEW_EVENTS`, `NOTIFICATION_EVENTS`
exactly as §15.4; `SCREEN_PARAM_ALLOWLIST` + `threadId`), `lib/error-reporting.ts` (redaction keys §19); Create
`locales/{en,hi,gu}/{offers,reviews,notifications,holds}.json` (one `title` key each; `holds` is L8's area for the My
listings holds copy, since `listing.json` is L7's), register them in `locales/index.ts`;
Modify `locales/*/errors.json` (copy for every §18 code, three languages), `locales/*/auth.json` (the two sign-in
reasons), `.env.example` (`EXPO_PUBLIC_SHARE_BASE_URL=`).

- [ ] **Step 1: Failing tests (pure):** `pendingToRun` returns each of the four new types (with its listing id) once
  sign-in + onboarding are done and nothing before; the pending runner's dispatch sends `save` to the save path and the
  four contact types to `openPendingContact`, never to save (pure dispatch helper `pendingRoute(pending)`); sign-in
  reasons include `enquire` and `offer`; every §18 code has a key present in en / hi / gu (`f6-errors.test.ts`); i18n
  parity and audit pass.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; app typecheck; style audit. **Step 5: Stage.**

**C0 exit:** typecheck, lint; API, admin, app suites green one package at a time; `mpm_test` clean; review (focus:
schema matches §5 column for column, migration 0012 never uses `'review'`, every stub marked, route RBAC table);
controller commits.

---

# Batch C1 — Holds and listing integration (sequential, on `develop`)

### C1-1: Holds, `syncReservation`, listing transitions

**Files:** Create `apps/api/src/services/deals/holds.ts`; Modify `packages/shared-types/src/index.ts`
(`LISTING_TRANSITIONS`, `HIDEABLE`, `EDITABLE_LISTING_STATUSES`, `SYSTEM_LISTING_ACTIONS` + `sell_out`),
`services/listings/listing-lifecycle.service.ts` (system `sell_out`, `reserve`, `unreserve` through
`applySystemTransition`; leaving `reserved` stores `return_status = 'live'`); Modify
`apps/api/src/lib/listing-shared.test.ts`; Test `apps/api/__tests__/holds.test.ts`.

**Interfaces (§8.1, §8.2):** `placeHold(tx, listing: ListingRow, dealId, quantity: string): Promise<void>` (refuses
quantity > available with `409 QUANTITY_NOT_AVAILABLE`); `releaseHold(tx, dealId)`; `convertHold(tx, dealId)`
(quantity −= held, `held_quantity` −= held, `min_order_qty` lowered to the new quantity when above it, null at 0);
`syncReservation(tx, listingId)` (§8.2 table incl. `return_status = 'sold'` on `hidden` / `pending_review` /
`rejected`, `removed` untouched); `availableOf(listing): string`. Each locks nothing itself: callers hold the listing
lock (§8.5). `holds.ts` is the only writer of `stock_holds`, `held_quantity` and the completion decrement.
`syncReservation` applies `sell_out`, `reserve` and `unreserve` through `applySystemTransition(tx, listing, action,
{ lockBusiness: false })`; `applySystemTransition` **refuses `lockBusiness: true`** for these three (as it does for
`expire`, `listing-lifecycle.service.ts:142`), so no F6 / F7 path ever takes the seller business lock after a listing
lock.
**Where the hook lives (no recursion):** the post-write hook is one function, `afterListingStatusWrite(tx, listingId)`
in `services/deals/holds.ts` (`syncReservation` then `reconcileOffersForListing`). It is called by the **callers** of
the F2 writers (C1-2), never from inside `applySystemTransition`; `syncReservation`'s own transitions call
`applySystemTransition` directly and do not call the hook, so they never recurse. `syncReservation` is idempotent
(a second call is a no-op).
Transitions (§8.3): `pause` and `mark_unavailable` from `reserved`; `hide` / `photos_removed` / `back_to_review` from
`reserved`; `sell_out` (system) from `live`, `reserved`, `paused`, `unavailable`, `expired` → `sold`; `reserved` in
`EDITABLE_LISTING_STATUSES`; `expire` unchanged.

- [ ] **Step 1: Failing tests:** `listing-shared.test.ts` — the new rows of the transition table; `holds.test.ts` —
  place on 3 of 5 leaves `live`, available 2; place the rest → `reserved`; release → `live`; convert 2 of 5 → quantity 3,
  held 0; convert the whole quantity → `sold` via `sell_out`, `min_order_qty` null, quantity 0 stored; convert with
  `min_order_qty` 4 and quantity left 2 → `min_order_qty` 2; sell-out while `hidden` → status `hidden`,
  `return_status = 'sold'`; on `paused` → `sold`; on `removed` → stays; pause / mark unavailable / hide / back_to_review
  from `reserved` store `return_status = 'live'`, and unhide of a hidden listing with nothing available lands `reserved`
  after `syncReservation`; placing more than available → 409; `applySystemTransition` with `sell_out` / `reserve` /
  `unreserve` and `lockBusiness: true` throws; `assertHeldInvariant` after every case.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `listings-lifecycle.test.ts` still passes.
  **Step 5: Stage.**

### C1-2: Every listing writer reconciles and syncs; holds guards

**Files:** Modify `services/listings/{listing-lifecycle,listing-write,listing-admin,listing-media,listing-jobs}.service.ts`,
`apps/api/src/jobs/index.ts` (listing expiry through `runJobTx`; its per-row savepoint becomes `effectsTx`),
`routes/listings.ts`, `routes/admin/listings.ts`, `routes/admin/listing-media.ts` (wrap in `runTx` so queued emits
flush); `bulkListingAction(app: TxApp, …)` and `adminDeleteMedia(app: TxApp, …)` take a `TxApp` instead of a `Db`
(they open their own transactions, through `runTx`; per-listing savepoints in the bulk action via `effectsTx`), their
routes and tests updated; Test `apps/api/__tests__/listings-holds.test.ts`.

**Rules (§8.3, §22):** after every status write (`applySystemTransition` called by F2 code, `applySellerAction`,
`applyAdminTransition`, `publishListing` from `rejected`, `runListingExpiry`, `adminListingAction`,
`bulkListingAction`, `adminDeleteMedia` → `photos_removed`) the caller calls `afterListingStatusWrite(tx, listingId)`
(C1-1: `syncReservation` when it lands on `live` / `reserved`, then `reconcileOffersForListing`);
`patchListing` and `adminPatchListing`: quantity below `held_quantity` → `409 QUANTITY_BELOW_HELD`; a unit change with
an active hold or a `pending` / `backup` offer → `409 UNIT_LOCKED`; quantity or price-model change → `syncReservation` +
reconcile; seller `mark_sold` / `remove` with `held_quantity > 0` → `409 LISTING_HAS_OPEN_DEALS` with `details:
{ dealIds }` (open = `agreed`, `handed_over`, `disputed`); admin `remove` calls `cancelAgreedDealsForRemovedListing`
before the status write; `relist` from `sold` with quantity 0 → `400 QUANTITY_REQUIRED`; seller / admin input of
quantity 0 still `400` (Zod and gate unchanged).

- [ ] **Step 1: Failing tests:** `vi.mock` of `services/offers/reconcile.js` and `services/deals/deal-cancel.js`
  records calls; a table over every writer above asserts one reconcile call for the listing; quantity edit below held
  → 409, equal → 200 and `reserved`; `reserved` listing's price and description editable; unit change with a hold and
  with a backup offer → `UNIT_LOCKED`; price-model change → reconcile called; seller `mark_sold` / `remove` with a hold
  → `LISTING_HAS_OPEN_DEALS` with the deal id; admin `remove` calls the cancel stub; relist at 0 → `QUANTITY_REQUIRED`;
  seller PATCH quantity 0 → 400; the expiry job doesn't expire a `reserved` listing and expires a `live` one with a
  hold (its deal untouched). The `confirm-received` vs quantity-`PATCH` race (business → listing from F2 against
  listing-only from F6) is added by L3-1 once that route exists (C1 has no deal routes).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; the F2 listing suites (`listings-*.test.ts`,
  `listing-expiry.test.ts`, `admin-listings.test.ts`, `listing-media.test.ts`) still pass. **Step 5: Stage.**

### C1-3: Available quantity in discovery and the listing page

**Files:** Modify `services/listings/{listing-view,listing-read}.service.ts`, `services/discovery/{filters,facets,
search.service}.ts`; Test `apps/api/__tests__/discovery-available.test.ts`.

**Rules (§8.4, §12.2):** `ListingCard.availableQuantity = quantity − held_quantity` everywhere cards are built
(`loadCards`); search `minQty` and facet counts use available; `ListingDetail.availableQuantity`; `myThreadId` and
`openNegotiation` for a signed-in viewer whose business has a thread on the listing (null for guests, other
businesses, the owner); `seller.score = await sellerScore(...)` (stub null until L4); owner view `heldQuantity`.

- [ ] **Step 1: Failing tests:** card and search result show available after a hold; `minQty` 3 excludes a listing
  with quantity 5 and held 3; the condition facet count drops it too; detail `myThreadId` set for the thread's buyer
  only; `openNegotiation` shows the pending offer's turn and price; owner view `heldQuantity`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `discovery-search.test.ts`, `listings-read.test.ts`
  still pass. **Step 5: Stage.**

**C1 exit:** API suite once (`pnpm --filter @mpm/api test`), typecheck, lint; `mpm_test` clean; review (focus: every
§22 writer covered, lock order, no status write outside `listing-lifecycle.service.ts`); controller commits and
pushes (milestone: contracts). Controller then creates the wave A worktrees from this commit.

---

# Wave A — API lanes (parallel: L1, L2, L3, L4)

## Lane L1 — API chat

### L1-1: Threads, enquiries, text messages

**Ports:** textile `services/chat/{thread.service,message.service}.ts` (`openThread`, `sendMessage`, `listMessages`).

**Files:** Create `services/chat/{thread.service,enquiry.service,message.service}.ts`; Modify `routes/threads.ts`
(`POST /listings/:id/enquiry`, `GET /threads/:id`, `GET /threads/:id/messages`, `POST /threads/:id/messages`); Test
`apps/api/__tests__/chat-threads.test.ts`.

**Rules (§6.1–§6.4, §6.9, §12.2):** the enquiry route calls C0-4a's `openOrGetThread` (refusals, daily limit, one
thread per pair). Enquiry card: ≥ 1 quick option or a note, `quantity` for
`best_price` / `price_request` (default `min_order_qty`, else 1), `fit` resolved server-side to names + `checkFit()`
verdict; `enquiry_new` notification to the seller (dedupe `enquiry_new:<messageId>`), `recomputeTurns`. Messages:
1–2 000 chars after trim (`400 MESSAGE_EMPTY`), `scam_flag` from `looksLikeScam`, `client_message_id` retry returns the
stored message, `upsertChatNotification` for the other business, `message:new` per reader with the reader's
`InboxRow`. `GET /threads/:id` builds `ThreadDetail` (listing strip whatever the listing's status; latest deal's
title snapshot and `noLongerListed` when not public; contact block from L1-4). Messages page 30 by `seq` keyset.

- [ ] **Step 1: Failing tests** (thread refusals are C0-4a's): two concurrent first enquiries → one thread, two cards;
  the 11th new thread of the day for an unverified business 429
  (`enquiry_new_per_day_unverified` lowered to 2 in `app_settings` for the test and restored), an enquiry in an existing
  thread allowed; `fit` with a model that the listing's fitments cover → verdict `fits`, otherwise `not_listed`, client
  names ignored; a third business 404 on detail, messages and send; the 31st message in a minute 429; the same
  `clientMessageId` twice → one row, same id; a scam phrase sets `scamWarning` for the reader on the other side only.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L1-2: Chat photos

**Files:** Modify `services/chat/message.service.ts`, `routes/threads.ts` (`POST /threads/:id/photos/presign`, photos in
`POST /threads/:id/messages`, `GET /threads/:id/messages/:messageId/photos`); Test
`apps/api/__tests__/chat-photos.test.ts`.

**Rules (§6.8):** presign for a party non-viewer (`perUser(30)` per 10 min); send with 1–5 keys
(`400 TOO_MANY_PHOTOS`) and an optional caption: with an `Idempotency-Key`, `readStoredResponse` first (a replay
answers the stored reply and never touches storage, P11), then `finalizePrivatePhotos` **before** the transaction; any
failure → nothing sent; photo URLs signed per request for members only.

- [ ] **Step 1: Failing tests (storage mocked):** 6 keys → `TOO_MANY_PHOTOS`; a key of another business →
  `PHOTO_KEY_INVALID` and no message row; a third business 404 on the photo URL route; a viewer gets URLs but 403 on
  presign; a photo send retried with the same key replays (one message, `finalizePrivatePhotos` called once).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L1-3: Inbox, read, archive, badges, viewing

**Files:** Create `services/chat/inbox.service.ts` (replaces the `unreadThreadCount` stub); Modify `routes/threads.ts`
(`GET /threads`, `POST /threads/:id/read`, `PUT` / `DELETE /threads/:id/archive`), `routes/badges.ts`
(`GET /users/me/badges` from `unreadThreadCount`, `dealsYourTurnCount`, `notificationUnreadCount`), `socket/setup.ts`
(`thread:viewing` → party check in the DB → `setViewing`); Test `apps/api/__tests__/chat-inbox.test.ts`.

**Rules (§5.3, §6.10, §13):** filters `all | buying | selling | your_turn`, `archived`, keyset (`last_message_at`, `id`),
20 a page, `counts.yourTurn`; unread = other side's last seq > my `last_read_seq`, exact count only for the page's
unread rows; preview per reader (masked text, photo count, system code, offer price); pill (Your turn / Deal / enquiry
status via `enquiryStatus`); read never moves backwards, marks the grouped chat notification read
(`markChatNotificationRead`), emits `thread:read` to the reader's own room; archive per user, **viewers included** (P15: archive is per-user
state).

- [ ] **Step 1: Failing tests:** unread after the other side's message, not after my own, not after reading; read with
  a lower seq doesn't move back; archive hides the thread for me only and a new message from the other side brings it
  back; `your_turn` filter and count follow `seller_turn` / `buyer_turn`; preview of a phone-number message is masked for
  the reader; a viewer archives the thread in its own inbox (200, hidden for the viewer only) and still gets 403 on
  photo presign and message send; `thread:viewing` for a thread of another business sets nothing (socket test).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L1-4: Masking end to end, share my number, reveal, contact number

**Ports:** textile `services/consent/contact-consent.service.ts`, `__tests__/chat-privacy.test.ts`,
`deal-contact.test.ts`.

**Files:** Create `services/consent/contact-consent.service.ts` (replaces `maybeReveal`),
`services/business/contact-phone.service.ts`; Modify `routes/threads.ts` (`POST /threads/:id/share-contact`, contact
block in `ThreadDetail`), `routes/contact-phone.ts` (`POST /businesses/me/contact-phone/otp/send`, `…/verify`,
`DELETE /businesses/me/contact-phone`); Test `apps/api/__tests__/chat-privacy.test.ts`.

**Interfaces (§5.5, §6.6, §5.12):** `currentContactNumber(conn, businessId): Promise<{ phone; source }>` (verified
contact number, else the owner's phone); `validConsent(conn, threadId, businessId): Promise<boolean>`;
`shareContact(tx, reader, thread)` (owner only when the source is `owner_phone` → `403 OWNER_CONSENT_REQUIRED`; needs a
deal in the thread; idempotent while valid; writes a `grant` row with the wording version; then `maybeReveal`);
`maybeReveal(tx, threadId)` (both valid + a deal → sets `contact_unlocked_at` once, `contact_shared` line + deal event on
the latest deal, `thread:read`-style refetch event to every member; returns true when it revealed now);
`withdrawContactConsents(tx, businessId, phone, reason)` (P6); contact phone: owner only (`403 OWNER_ONLY`), E.164
(`400 CONTACT_PHONE_INVALID`), F1 OTP service and limits, verify sets the number and, when it replaces one, withdraws
the old (`number_replaced`); delete withdraws (`number_removed`).

- [ ] **Step 1: Failing tests (REST and a real socket client):** before a deal, a buyer's `+91 98765 43210`, the same in
  Devanagari and Gujarati digits and an email reach the seller masked in messages, inbox preview and `message:new`; the
  stored text is unchanged; with a deal (`insertTestDeal`) and one tick still masked; after both ticks the seller owner
  reads old and new messages unmasked (REST and socket) while a seller `viewer` in the same thread still reads them
  masked and gets `number: null`; after the deal is cancelled (status set directly) the text stays unmasked; on the
  owner-phone fallback a `sales` member's tick → `OWNER_CONSENT_REQUIRED` and `canTick` false; a consent UPDATE is
  refused; replacing the contact number writes `withdraw`, the thread's number block shows nothing for that side until
  a new tick, the message text stays unmasked; a non-owner on the contact-phone routes → `OWNER_ONLY`; a third business
  404 on share-contact.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L1-5: Block, report a conversation, admin reports and conversation reads

**Files:** Create `services/chat/{block.service,conversation-report.service,admin-read.service}.ts`,
`services/reports/admin-reports.service.ts`; Modify `routes/threads.ts` (`POST /threads/:id/block`,
`POST /threads/:id/report`), `routes/blocks.ts` (`GET /users/me/blocks`, `DELETE /users/me/blocks/:businessId`),
`routes/admin/reports.ts` (`GET /admin/reports?target=&status=`, `POST /admin/reports/:id/resolve`),
`routes/admin/conversations.ts` (`POST /admin/threads/:id/read`); Test `apps/api/__tests__/chat-block-report.test.ts`,
`apps/api/__tests__/admin-conversations.test.ts`.

**Rules (§6.11, §6.12, §16.2, §16.3):** block by a non-viewer (`400 BLOCK_SELF` never reachable from a thread but
guarded); lock order (§8.5, I7): the listings of every thread between the pair (both directions) via
`lockListingsInOrder` in id order, then `closeChainsBetween` (stub until L2; it locks the offers in id order), then the
thread, and the `blocked` line is written **last**; composer state in `ThreadDetail`; deals continue. Report: reason + details (required for `other`, ≤ 500), `REPORT_EXISTS`, 10 a day per user (`REPORT_LIMIT`,
counted as F2), optional block in the same transaction, `report:new` to `moderator` and `support` rooms. Admin reports
list both targets (target filter), resolve `actioned | dismissed` with a note, audit `report.resolve`. Admin read:
allowed while a `conversation` report on the thread is open / reviewing / resolved ≤ 30 days ago, or a deal in it has
an open dispute or one resolved ≤ 30 days ago; reason `ADMIN_REASON_MIN`–`MAX`; audit `thread.read` on every read;
messages as stored with signed photo URLs; never contact numbers.

- [ ] **Step 1: Failing tests:** a blocked pair can't start a thread, message or enquire (403) either way; unblock
  restores; the `blocked` line exists and is the thread's last line; a block racing an offer accept on the same listing
  (`Promise.all`) settles both with no `40P01`; report twice → `REPORT_EXISTS`; 11th report of the day → `REPORT_LIMIT`; report
  with `block: true` blocks too; admin read refused with no report (`ADMIN_READ_NOT_ALLOWED`), allowed with an open
  report, allowed 29 days after resolution and refused at 31 (resolved_at moved back), same for a dispute; each read
  writes one `audit_log` row with the reason; the read returns a phone number in message text unmasked but no contact
  number field; RBAC (operations 403 on reads, moderator and support 200).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

**L1 exit:** the lane's test files and `pnpm --filter @mpm/api typecheck` green; review (focus: every text path goes
through `visibleText`, socket payloads per reader, 404 for outsiders, consent validity by current number); controller
commits on `lane/f6-L1`.

## Lane L2 — API offers

### L2-1: Send an offer or buy now, quotes, options, limits

**Ports:** textile `services/offers/{offer-terms,offer.service,offer-view}.ts` (`sendOffer`, `offerActions`,
`toOfferView`; drop payment terms, delivery and samples).

**Files:** Create `services/offers/{offer-rules,offer.service,offer-view}.ts`; Modify `routes/offers.ts`
(`POST /listings/:id/offers`, `POST /threads/:id/quote`, `GET /offers/options`); Test
`apps/api/__tests__/offers-send.test.ts`.

**Interfaces:** `validateOfferInput(listing, input, opts: { kind; available: bigint }): ResolvedOffer` (pure; §7.2:
`PRICE_ABOVE_ASKING`, `buy_now` price set by the server, `QUANTITY_BELOW_MINIMUM` except exactly the whole remainder
when `0 < available < min_order_qty`, `QUANTITY_NOT_AVAILABLE`, `QUANTITY_DECIMALS`, validity one of the three
settings, note ≤ 500); `sendOffer(tx, user, listingId, input)` (§7.1: rental → `409 OFFERS_NOT_FOR_RENTALS`, model
mismatch → `409 PRICE_MODEL_MISMATCH`, open chain → `409 NEGOTIATION_OPEN`; `lockBuyerBusiness` → limit → listing lock
→ thread via C0-4a's `openOrGetThread` (same refusals and daily new-thread limit as an enquiry) → row 0 with `asking_price_paise`, unit and
GST snapshots, `turn = seller`; card; `offer_new`; `recomputeTurns`; `offer:updated` per reader); `sendQuote(tx, user,
threadId, input)` (seller member, `on_request` only else `409 QUOTE_NOT_ALLOWED`, no open chain, `asking_price_paise`
null, `turn = buyer`, `first_seller_reply_at`, `offer_quote`); `toOfferView(row, reader, thread)` with `actions` and
`bounds`; limit (§7.8): open = chains started by the buyer business (`offer` / `buy_now`) whose latest row is `pending`,
backups excluded, vs `offer_open_limit_{unverified,verified}` → `409 OFFER_LIMIT_REACHED { limit }`.

- [ ] **Step 1: Failing tests:** offer above asking 400; `buy_now` stores the asking price whatever the body says; a
  rental 409; `buy_now` on a negotiable listing and `offer` on a fixed one → `PRICE_MODEL_MISMATCH`; a second chain in
  the thread → `NEGOTIATION_OPEN`; quantity below minimum 400, the whole remainder below minimum accepted; quantity above
  available 409; 1.5 on a 0-decimal unit 400; quote on a negotiable listing → `QUOTE_NOT_ALLOWED`; the 4th open chain of
  an unverified buyer → `OFFER_LIMIT_REACHED`, with a quote and a counter in flight not counted, a backup not counted;
  two concurrent first offers at the limit → one 200, one 409 (business lock); a viewer 403; offer notes masked for the
  other side (`visibleText`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L2-2: Counter, reject, withdraw, reconfirm

**Files:** Modify `services/offers/offer.service.ts`, `routes/offers.ts` (`POST /offers/:id/{counter,reject,withdraw,
reconfirm}`); Test `apps/api/__tests__/offers-chain.test.ts`.

**Rules (§7.4, §7.5):** every action locks listing → offer, refuses unless `pending` (`OFFER_NOT_OPEN`), unexpired by
`now()` (`OFFER_EXPIRED`), actor's side = `turn` (`NOT_YOUR_TURN`); counter: rounds left (`COUNTER_LIMIT` after 5),
not on `buy_now` (`COUNTER_NOT_ALLOWED`), `counterBounds` (`COUNTER_OUT_OF_BOUNDS { min, max }`), unchanged price and
quantity → `COUNTER_UNCHANGED`, quantity within minimum and available; old row `countered`, new row round + 1, turn
swapped, fresh validity; reject (note ≤ 300) ends the chain, `offer_rejected` line; withdraw by the sender before an
answer (`pending`) or by the buyer business on a `backup`; reconfirm by the seller on `needs_reconfirm` → turn buyer,
fresh validity, `offer_reconfirmed` line. Seller's first answer sets `first_seller_reply_at`. Each writes its line /
card update, notification (§11.3), `recomputeTurns`, `offer:updated`.

- [ ] **Step 1: Failing tests:** the §7.5 rows that change money or turn: counter by each side swaps the turn and
  creates round + 1; bounds table on real rows (buyer after a quote may go to 1 paisa and to S − 1; seller's counter
  equal to B refused; equal to own latest with a new quantity allowed, same quantity → `COUNTER_UNCHANGED`); after the
  5th counter → `COUNTER_LIMIT` and actions accept / reject only; `buy_now` counter → `COUNTER_NOT_ALLOWED`; the sender
  can't accept or counter its own row; withdraw after an answer refused; reconfirm by the buyer refused; reject ends the
  chain and a new offer is then allowed; an expired row (expires_at moved back) → `OFFER_EXPIRED`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L2-3: Accept → deal + hold

**Ports:** textile `offer.service.ts` `acceptOffer`, `deal.service.ts` `createDealFromOffer` (D3).

**Files:** Create `services/offers/accept.service.ts`, `services/deals/deal-create.ts`; Modify `routes/offers.ts`
(`POST /offers/:id/accept`); Test `apps/api/__tests__/offers-accept.test.ts`.

**Rules (§7.6):** lock listing → offer; refusals (`NOT_YOUR_TURN`, `OFFER_NOT_OPEN`, `OFFER_EXPIRED`,
`OFFER_NEEDS_RECONFIRM`, listing public and `live` / `reserved`); too little available → move this offer to `backup`,
commit, return `{ status: 409, body: QUANTITY_NOT_AVAILABLE }` (P11: stored for a retry); else `createDealFromOffer` (deal
row with snapshots, then `placeHold`), `syncReservation`, `reconcileOffersForListing`, thread `deal_count += 1`, deal
card + `deal_agreed` line, `maybeReveal`, `recomputeTurns`, `offer_accepted` notification, `offer:updated` and
`deal:updated`. Reply `{ offer, dealId }`.

- [ ] **Step 1: Failing tests:** accept leaves the deal's price, quantity and total equal to the offer's and
  `totalPaise` correct for a 2.5 quantity; a listing price edit after the offer doesn't change the deal; two accepts for
  the last units (two buyers, `Promise.all`) → one deal, the other 409 and its offer `backup`, listing `reserved`,
  `assertHeldInvariant`; accept vs withdraw at once → exactly one wins and state matches it; accept after a pause →
  refused, no deal; the same `Idempotency-Key` retried → same `dealId`, one deal; a retry of the 409-with-backup answer
  returns the stored 409; a viewer 403; a third business 404.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L2-4: Reconcile, backups, revive, block and suspension closes

**Ports:** textile `services/offers/reconcile.ts` (`reconcileOffersForLot`, `closeOffersBetween`,
`closeOffersForSanction`).

**Files:** Modify `services/offers/reconcile.ts` (replace the three stubs), `services/admin/user-status.service.ts`
(suspend / block of an **owner** → lock the business's listings in id order (`lockListingsInOrder`), reconcile each,
then `closeChainsForInactiveOwner` (its buyer chains: their listings locked in id order before the offers); other
members change nothing; takes a `TxApp`), `routes/admin/users.ts` (suspend / block / reinstate / unblock through
`runTx` so the queued emits flush); Test `apps/api/__tests__/offers-reconcile.test.ts`, `apps/api/__tests__/suspension-offers.test.ts`.

**Rules (§7.7, §7.5 last row):** one function reading the listing as it is: not `live` / `reserved` or failing
`publicListingWhere` → every `pending` / `backup` row `closed` (`listing_unavailable`), one `offers_closed` line per
thread; price model no longer fits the chain's opening kind → `closed` (`listing_changed`); `pending` rows above
available (and not the whole remainder) → `backup` (`backup_since`, `expires_at` null, `offer_backup` line, notification
to the buyer); `backup` rows that fit → `pending`, turn seller, fresh validity of the original length,
`needs_reconfirm` when the row is the seller's, `offer_revived` line and notification to the seller. Safe to call twice.
`closeChainsBetween` → `closed` (`blocked`); `closeChainsForInactiveOwner` → buyer chains `closed`
(`account_inactive`).

- [ ] **Step 1: Failing tests:** listing of 5, offers A 3, B 2, C 4 from three buyers: accept A → B pending, C backup;
  `releaseHold` of A's deal + reconcile → C revives with turn seller and a fresh `expires_at`; a revived **seller** row
  (counter) has `needsReconfirm` and the buyer's accept → `OFFER_NEEDS_RECONFIRM`, then reconfirm and accept succeed;
  reconcile twice changes nothing the second time; pause closes pending and backups for good (stay closed after
  resume); price model negotiable → fixed closes the `offer` chain `listing_changed`; `closeChainsBetween` closes both
  directions; suspending the seller's owner closes the listing's chains and that business's buyer chains, suspending a
  `sales` member changes nothing, reinstating reopens nothing, an `agreed` deal of that business is untouched; the
  owner's suspension racing a buyer's offer on one of its listings (`Promise.all`) settles both with no `40P01`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `account-status.test.ts` still passes.
  **Step 5: Stage.**

### L2-5: Offer jobs and the admin enquiries API

**Ports:** textile `services/offers/offer-jobs.ts`.

**Files:** Modify `services/offers/offer-jobs.ts` (replace stubs); Create `services/offers/admin-enquiries.service.ts`;
Modify `routes/admin/enquiries.ts` (`GET /admin/enquiries`, `GET /admin/enquiries/:threadId`); Test
`apps/api/__tests__/offer-jobs.test.ts`, `apps/api/__tests__/admin-enquiries.test.ts`.

**Rules (§7.9, §16.1, §16.2):** `expireOffers`: `pending` past `expires_at` → `expired`; `backup` older than
`offer_backup_max_days` → `expired`; line, card update, notification to both sides (P14 doesn't apply: system);
`notifyExpiringOffers`: `pending` expiring within `offer_expiring_notice_hours` → `offer_expiring` to the turn side,
dedupe `offer_expiring:<offerId>:<expires_at ISO>`. Admin list: threads with listing, parties, kind, enquiry status,
open negotiation summary, deals count, created, last activity, filters; detail: the chain (prices, quantities,
statuses, who, when). **No message or note text** in either.

- [ ] **Step 1: Failing tests:** expiry by the DB clock (moved back) expires only due rows, twice and concurrently
  (two calls at once) gives one `expired` and one line; a backup at 15 days expires, at 13 doesn't; expiring-soon sends
  once per `expires_at` and again for a revived offer's new `expires_at`; admin list and detail carry no `note` /
  `text` fields (JSON scan for a planted phrase); RBAC (moderator 403, support / operations 200).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

**L2 exit:** lane tests and typecheck green; review (focus: lock order, accept race, the committed backup + 409,
reconcile idempotent, limits under the business lock); controller commits on `lane/f6-L2`.

## Lane L3 — API deals

### L3-1: Deal reads and actions per side

**Ports:** textile `services/deals/deal-view.ts` (`getDeal`, `listDeals`, `dealActions`).

**Files:** Create `services/deals/{deal-read.service,deal-actions,deal-view}.ts` (replaces `dealsYourTurnCount`,
`businessDealHistory` stubs); Modify `routes/deals.ts` (`GET /deals`, `GET /deals/:id`); Test
`apps/api/__tests__/deals-read.test.ts`.

**Interfaces:** `dealActions(deal, side, role, now): DealAction[]` (pure; §9.2: seller `hand_over`, `cancel` on
`agreed`; buyer `confirm_received`, `report_problem` until `problem_deadline_at` on `handed_over`; seller
`report_problem` until completion; `request_cancel` / `accept_cancel_request` / `clear_cancel_request`;
`edit_notes` on `agreed` / `handed_over`; none for a viewer or on final statuses). `GET /deals` tabs `active` (`agreed`,
`handed_over`, `disputed`) / `completed` / `cancelled`, sides, counts; `DealView` with timeline from `deal_events`,
notes masked per reader, contact block (`revealed` from the thread; a side's number only while
`validConsent` holds for it — C0 stub returns false until L1 merges), dispute summary, review state (null until L4).

- [ ] **Step 1: Failing tests:** `dealActions` table per status × side × role (pure); a third business 404 on
  `GET /deals/:id`; a viewer sees the deal with no actions; tab counts; `dealsYourTurnCount` counts `agreed` for the
  seller and `handed_over` for the buyer.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L3-2: Notes, hand over, confirm received, cancel and cancel requests

**Ports:** textile `services/deals/deal.service.ts` (step and cancel transactions, without payments, dispatch or stock
return).

**Files:** Create `services/deals/{deal.service,deal-cancel}.ts` (replaces `cancelAgreedDealsForRemovedListing`);
Modify `routes/deals.ts` (`PATCH /deals/:id/notes`, `POST /deals/:id/photos/presign`, `…/hand-over`,
`…/confirm-received`, `…/cancel`, `…/cancel-request`, `…/cancel-request/accept`, `…/cancel-request/clear`); Test
`apps/api/__tests__/deals-steps.test.ts`.

**Rules (§9.1–§9.5, §8.1):** every action reads `listing_id` unlocked → locks listing → deal → re-checks status
(`409 DEAL_TRANSITION_NOT_ALLOWED`), side and role; notes: `version` match else `409 DEAL_STALE`, advance ≤ total,
text ≤ 500 masked and scam-checked, `deal_notes_changed` line naming fields; hand over (seller, optional photo through
`finalizePrivatePhotos` with `{ kind: 'deal' }` — run only after `readStoredResponse` finds no stored reply, P11 —
note ≤ 300): `handed_over`, `problem_deadline_at = now() +
deal_problem_window_days`, `auto_complete_at = now() + deal_auto_complete_days`; confirm (buyer): `completed`
(`buyer_confirmed`), `convertHold`, `syncReservation`, reconcile; cancel on `agreed` (either side, reason from its
side's list, note ≤ 300): `cancelled`, `releaseHold`, `syncReservation`, reconcile; on `handed_over` a request
(`CANCEL_REQUEST_EXISTS`), the other side's accept → `cancelled` (`both`) + release, clear by either
(`NO_CANCEL_REQUEST`); every action: deal event, system line, `recomputeTurns`, notifications (§11.3 with P14),
`deal:updated` to both businesses. `cancelAgreedDealsForRemovedListing`: `agreed` deals → `cancelled`
(`listing_removed`, system), holds released; `handed_over` / `disputed` untouched.

- [ ] **Step 1: Failing tests:** each §9.2 row from `agreed` / `handed_over`: hand over sets both timers 48 h / 72 h
  from the DB clock; confirm converts the hold (quantity down, sell-out at 0) with `assertHeldInvariant`; cancel on
  `agreed` by either side releases the hold and the listing returns to `live`; buyer can't hand over, seller can't
  confirm; cancel on `handed_over` refused, request + other side's accept cancels and releases, the requester can't
  accept its own request, clear by either; stale notes `version` → `DEAL_STALE` while hand over with any version works;
  advance > total 400; notes text with a phone number masked for the other side; a viewer 403 on every action; retried
  hand over with the same key → one event; retried hand over **with a photo** and the same key → replay, one event,
  `finalizePrivatePhotos` called once; admin-removal cancel cancels only `agreed` deals; **lock-order race (C1):** the
  buyer's `confirm-received` and the seller's quantity `PATCH /listings/:id` on the same listing in `Promise.all` →
  both settle (each 200 or a clean 409), no `40P01`, `assertHeldInvariant` holds.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L3-3: Disputes and the admin deals and disputes APIs

**Ports:** textile `services/deals/{deal-problems.service,deal-admin.service}.ts`, D12 / D17 / D18.

**Files:** Create `services/deals/{dispute.service,deal-admin.service}.ts`; Modify `routes/deals.ts`
(`POST /deals/:id/problem`), `routes/admin/deals.ts` (`GET /admin/deals`, `GET /admin/deals/:id`),
`routes/admin/disputes.ts` (`GET /admin/disputes`, `/count`, `/:id`, `POST /admin/disputes/:id/resolve`); Test
`apps/api/__tests__/deals-disputes.test.ts`, `apps/api/__tests__/admin-deals.test.ts`.

**Rules (§9.6, §16):** report a problem: buyer until `problem_deadline_at` (`PROBLEM_WINDOW_CLOSED`), seller until
completion; category, description 10–1 000, ≤ 5 photos (`readStoredResponse` before `finalizePrivatePhotos`, P11); status `disputed`, timers stopped, dispute row, line,
`deal_problem` notification, `dispute:new` to `adminRoleRoom('support')`. Resolve (support): `completed` → convert;
`cancelled` + `stockReturned` required → release (true) or convert (false), reason `support_closed`; `resumed` →
`handed_over` with both timers restarted; internal note required (audit only), message to parties ≤ 500 in the
`deal_dispute_resolved` line; `DISPUTE_NOT_OPEN`; audit `deal.dispute_resolve` with before / after; notification to
both. Admin deals: tabs, search, detail with structured notes (no `notes_text`), timeline, hold state, review state,
dispute link; read-only.

- [ ] **Step 1: Failing tests:** buyer's report after the window → `PROBLEM_WINDOW_CLOSED`, seller's allowed; a
  disputed deal is skipped by `autoCompleteDeals` (stub replaced in L3-4; here: status check in `completeDeal`); resolve
  `completed` converts; `cancelled` + `stockReturned: true` releases and the listing returns to `live`; `cancelled` +
  `false` converts (quantity down); `cancelled` without `stockReturned` 400; `resumed` restarts both timers from the
  resolve time; a second resolve → `DISPUTE_NOT_OPEN`; each resolve writes one audit row with before / after; RBAC
  (operations 403 on resolve, support 200; deals list support / operations 200, moderator 403); admin deal detail has no
  free-text notes; `assertHeldInvariant` after each outcome.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L3-4: Deal jobs

**Ports:** textile `services/deals/deal-jobs.service.ts`.

**Files:** Modify `services/deals/deal-jobs.ts` (replace stubs); Test `apps/api/__tests__/deal-jobs.test.ts`.

**Rules (§9.3, §14):** `autoCompleteDeals`: candidate ids unlocked; per deal own savepoint, lock listing, then deal
`FOR UPDATE SKIP LOCKED`, re-check `status = 'handed_over' AND auto_complete_at <= now()`, complete (`auto`) through the
same function as confirm; `remindAgreedDeals`: `agreed` older than `deal_agreed_reminder_days`, `agreed_reminded_at`
null or older than that period → `deal_agreed_reminder` to both, stamp `agreed_reminded_at`.

- [ ] **Step 1: Failing tests:** `auto_complete_at` moved back → `completed` (`auto`), hold converted; not yet due →
  untouched; disputed → untouched; two concurrent runs → one completion, one event; a pending cancel request lapses on
  auto-complete; the reminder sends once per period (second run same day sends nothing, after moving
  `agreed_reminded_at` back 8 days sends again).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

**L3 exit:** lane tests and typecheck green; review (focus: every deal transition re-checks status under the lock,
holds only through `holds.ts`, no deal can get stuck, P14 recipients); controller commits on `lane/f6-L3`.

## Lane L4 — API reviews and notifications

### L4-1: Review submit, blind publishing, publish job

**Ports:** textile `services/reviews/{eligibility,review.service,review-state}.ts` (drop photos, sample facts and
dispute shifts).

**Files:** Create `services/reviews/{review.service,review-state}.ts`, `services/reviews/review-jobs.ts` (replaces
`publishDueReviews`); Modify `routes/reviews.ts` (`GET /deals/:id/review`, `POST /deals/:id/review`); Test
`apps/api/__tests__/reviews.test.ts`.

**Rules (§10.1–§10.3):** completed deals only (`REVIEW_NOT_ELIGIBLE`), within `completed_at + review_window_days`
(`REVIEW_WINDOW_CLOSED`), one per side (`REVIEW_EXISTS`), non-viewer member; ratings exactly the side's facets, whole 1–5,
text only on the buyer side ≤ 1 000 (`REVIEW_ANSWERS_INVALID`), text masked always and scam-checked; first submit
sets `publish_due_at` (shared `publishDueAt`) and notifies the other side with `review_waiting` (dedupe
`review_waiting:<dealId>`, params: business name, deal ref, due date); second submit before it publishes both in
the transaction; job publishes due single reviews (`SKIP LOCKED`), after which the other side can't review; buyer →
seller publish sends `review_received`; state shows the author's own review, never the other's before publishing.

- [ ] **Step 1: Failing tests:** cancelled deal → `REVIEW_NOT_ELIGIBLE`; after 14 days → `REVIEW_WINDOW_CLOSED`; twice →
  `REVIEW_EXISTS`; seller review with text, missing facet, 4.5 stars → 400; blind: after the first submit the other side's
  state has `theirsSubmitted: true` and no ratings; second submit publishes both; single review with `publish_due_at`
  moved back published by the job, twice and concurrently once; first submit on day 10 → due at completion + 14 d, not
  + 17; the first submit writes one `review_waiting` row per member of the other business and none for the author's;
  a viewer 403; a third business 404.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L4-2: Scores, public reviews, reply, report, moderation

**Ports:** textile `services/reviews/{review-scores,review-reports.service}.ts` (`sellerReviewSummary`, `postReply`,
`reportReview`, `hideReviewContent`).

**Files:** Modify `services/reviews/review-scores.ts` (replace `sellerScore`); Create
`services/reviews/review-moderation.service.ts`; Modify `routes/reviews.ts` (`POST /reviews/:id/reply`,
`POST /reviews/:id/report`, `GET /businesses/:id/reviews`, `GET /users/me/reviews`), `routes/admin/reviews.ts`
(`POST /admin/reviews/:id/hide`, `/unhide`, `/hide-reply`); Test `apps/api/__tests__/reviews-public.test.ts`.

**Rules (§10.4–§10.6):** score from published, not hidden buyer → seller reviews; overall = mean of all facet ratings,
facet % = mean ÷ 5 whole %; null below `review_min_published`; public list newest first with replies (hidden replies
omitted); reply once by a non-viewer of the reviewed seller (`REPLY_EXISTS`, `REVIEW_NOT_PUBLISHED`), ≤ 300, masked;
report by any signed-in user (`REPORT_EXISTS`, `REPORT_LIMIT`, `report:new` to moderators); moderator hide / unhide /
hide-reply with reason, audit `review.hide` / `review.unhide` / `review.hide_reply`; a hidden review leaves the score
at once and shows to its author as hidden. Seller → buyer reviews never appear in any public reply (§10.4).

- [ ] **Step 1: Failing tests:** 2 published reviews → score null, 3 → score with the right mean and facet %; hiding one
  drops it back to null; unpublished and seller → buyer reviews never in `GET /businesses/:id/reviews`; reply twice →
  `REPLY_EXISTS`; reply to an unpublished review → `REVIEW_NOT_PUBLISHED`; RBAC on hide (support 403, moderator 200) and
  an audit row each; guests can read the public list.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L4-3: Notification text, list, grouped chat rows, preferences, language

**Ports:** textile `services/notifications/{notification.service,chat-rows,render}.ts`, `text/`.

**Files:** Create `services/notifications/{render,notification-read.service}.ts`, `services/notifications/text/{en,hi,
gu}.ts`; Modify `services/notifications/chat-rows.ts` (replace both stubs); Modify `routes/notifications.ts`
(`GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`,
`GET` / `PUT /notifications/preferences`), `routes/devices.ts` (`PUT /users/me/language`); Test
`apps/api/__tests__/notifications.test.ts`.

**Rules (§11.2–§11.4, §11.6):** `renderNotification(type, params, language)` → `{ title, body }` for every type of
§11.3, names and titles through `maskContact`, never message text, notes, numbers, emails, review text; `GET` list
renders in `users.language`; grouped chat row with `INSERT … ON CONFLICT ON CONSTRAINT`-equivalent on the partial
unique index (`ON CONFLICT (user_id, thread_id) WHERE type = 'message_new' AND read_at IS NULL DO UPDATE SET
unread_count = unread_count + 1, last_seq = excluded.last_seq, version = version + 1, updated_at = now()`) plus a
delivery row per device for the new version; read of the thread marks it read; preferences = `users.push_enabled`;
language route writes `users.language`.

- [ ] **Step 1: Failing tests:** `message_new`, `offer_new` and `deal_handed_over` rendered with a business name and a
  listing title containing `+91 98765 43210` and an email show neither (all three languages), and every type of §11.3
  renders a non-empty title and body in en / hi / gu; `enquiry_new` body is the masked listing
  title; two concurrent `upsertChatNotification` calls for one user + thread leave one row with `unread_count` 2 and
  `version` 2; after `markChatNotificationRead` the next message makes a new row; `notify` twice with one dedupe key → one
  row; `push_enabled = false` → rows but no deliveries; `PUT /users/me/language` 'hi' → list renders Hindi; read-all
  zeroes the count; another user's notification id → 404.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L4-4: Push delivery, devices, retention

**Ports:** textile `services/notifications/{push-provider,fcm-provider,push-sender,devices.service,viewing}.ts`.

**Files:** Create `services/notifications/{push-provider,fcm-provider,devices.service,retention}.ts`; Modify
`services/notifications/push-sender.ts` (replace stub), `routes/devices.ts` (`PUT /users/me/devices`,
`DELETE /users/me/devices/:installId`), `apps/api/package.json` (`firebase-admin`), `src/index.ts` (boot warning in
production without keys), `.env.example` (P7); Test `apps/api/__tests__/push.test.ts`.

**Rules (§11.5, §11.6):** `PushProvider { send(msg): Promise<PushResult> }`; `pushProviderFromEnv()` → FCM when
`FIREBASE_SERVICE_ACCOUNT_B64` is set, else the dev stub (`sent_dev`, logs ids only) outside production, else a
`skipped` provider; `sendDuePushes(app)`: claim ≤ 100 `queued` due deliveries `FOR UPDATE SKIP LOCKED`, render, skip a
chat push while `isViewing(userId, threadId)` (state `skipped`, row read), payload `notification` + `data` with
`deliveryKey = <notificationId>:<version>`, Android `tag` `thread:<id>` for chat else the notification id; transient
error → backoff 15 s / 1 min / 5 min / 30 min then `failed`; `unregistered` / `invalid-argument` → device deleted;
devices: one account per `install_id` (moved from any other user), delete on sign-out; retention deletes notifications
> 90 days and their deliveries in batches.

- [ ] **Step 1: Failing tests (provider injected):** dev stub records `sent_dev`; a viewing user's chat delivery is
  `skipped` and its row read, a non-chat one is sent; a transient error retries with `next_attempt_at` +15 s, the fifth
  failure → `failed`; an invalid token deletes the device; two concurrent runs send each delivery once; the same install
  registered by a second user moves to them; retention deletes a 91-day row only; the provider payload contains no
  message text for a message with a phone number.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; `pnpm --filter @mpm/api add firebase-admin`. **Step 4:** PASS.
  **Step 5: Stage.**

**L4 exit:** lane tests and typecheck green; review (focus: no text in pushes, grouped row race, blind rule, scores
exclude hidden and unpublished); controller commits on `lane/f6-L4`.

## Wave A merge (controller)

- [ ] Merge `lane/f6-L1`, `L2`, `L3`, `L4` into `develop` one at a time (`--no-ff`); resolve nothing by hand in a
  lane's files without the lane's reviewer.
- [ ] `grep -rn "F6F7-STUB" apps/api/src` lists none from L1–L4; `pnpm --filter @mpm/shared-types build`; `pnpm
  typecheck`; `pnpm --filter @mpm/api test` once; `mpm_test` clean (`deleteF6Rows` leaves nothing: a SQL count over the
  new tables is 0).
- [ ] Fix wave on `develop` for anything the merge breaks; commit; push (milestone: API).
- [ ] Lane cleanup (setup checklist step 6): worktrees removed, `mpm_l1_test` … `mpm_l4_test` dropped, lane branches
  deleted; the allowlist JSON files merged by the controller (append-only in lanes).

---

# Wave B — Admin and app lanes (parallel: L5, L6, L7, L8)

## Lane L5 — Admin pages

### L5-1: API clients, nav, Enquiries & offers

**Files:** Create `apps/admin/lib/{enquiries-api,deals-api,disputes-api,conversations-api,reviews-admin-api}.ts`,
`components/enquiries/{enquiries-table,offer-chain}.tsx`, `app/(dashboard)/enquiries/page.tsx` (replace placeholder),
`app/(dashboard)/enquiries/[threadId]/page.tsx`; Modify `lib/nav.ts` (Disputes item in Queues, `roles: ['support']`,
`badgeKey: 'disputesOpen'`), `lib/nav-badges.ts` (`disputesOpen` from `GET /admin/disputes/count`, refetched on
`dispute:new`); Test `lib/nav.test.ts` (extend).

- [ ] **Step 1: Failing tests:** nav shows Disputes to support and super_admin only; Enquiries & offers and Deals to
  support / operations. **Step 2:** FAIL. **Step 3:** Implement (filters per §16.1, read-only, no text columns).
  **Step 4:** PASS; lint; style audit. **Step 5: Stage.**

### L5-2: Deals list and detail

**Files:** Create `components/deals/{deals-table,deal-detail,deal-timeline}.tsx`, `app/(dashboard)/deals/page.tsx`
(replace placeholder), `app/(dashboard)/deals/[id]/page.tsx`.

- [ ] **Step 1:** none (read-only display; no tests per R26). **Step 3:** Implement status tabs (Agreed, Handed over,
  Disputed, Completed, Cancelled), business search, date, totals in Indian format; detail: terms, structured notes,
  timeline, hold state, review state, dispute link. **Step 4:** typecheck, lint, style audit. **Step 5: Stage.**

### L5-3: Disputes queue, resolve, conversation read

**Files:** Create `components/disputes/{disputes-table,dispute-detail,resolve-dialog}.tsx`,
`components/conversations/{read-reason-dialog,conversation-view}.tsx`, `app/(dashboard)/disputes/page.tsx`,
`app/(dashboard)/disputes/[id]/page.tsx`; Tests `components/disputes/resolve-dialog.test.tsx`,
`components/conversations/read-reason-dialog.test.tsx`.

**Rules (§9.6, §16.3):** resolve dialog: outcome; for `cancelled` the required "Did the goods go back to the seller?"
(yes / no, nothing preselected); internal note required; optional message ≤ 500; danger submit. Read dialog: reason
`ADMIN_REASON_MIN`–`MAX` before `POST /admin/threads/:id/read`; the result kept in component state only (no React
Query cache, no storage).

- [ ] **Step 1: Failing tests:** resolve dialog won't submit `cancelled` without the goods answer, sends
  `stockReturned` true / false, requires the internal note; read dialog won't call the API without a valid reason and
  sends it. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; lint; style audit. **Step 5: Stage.**

### L5-4: Conversations, Reports & flags, business detail, settings section

**Files:** Create `components/conversations/conversation-reports-table.tsx` (shared by both pages),
`components/reviews/{review-reports-table,review-hide-dialog}.tsx`, `app/(dashboard)/chats/page.tsx` (replace
placeholder), `app/(dashboard)/reports/page.tsx` (replace placeholder; tabs Conversations, Reviews); Modify
`components/businesses/business-detail.tsx` (deals by status, disputes with outcomes, seller score),
`lib/businesses-api.ts` (types), `components/settings/marketplace-settings-form.tsx` (section "Negotiation, deals and
reviews" for the §17 keys; cross-check messages from `validateSettings`); Test
`components/reviews/review-hide-dialog.test.tsx`.

- [ ] **Step 1: Failing tests:** hide dialog requires a reason and sends hide vs hide-reply as chosen.
  **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; existing `business-detail.test.tsx` and
  `marketplace-settings-form.test.tsx` still pass; lint; style audit. **Step 5: Stage.**

**L5 exit:** `pnpm --filter admin test`, lint, typecheck green; review (focus: no message or note text outside the
reason-gated read, roles match the API); controller commits on `lane/f6-L5`.

## Lane L6 — App chat

### L6-1: Chat API client, pure formatting, socket handler

**Ports:** textile app `lib/{chat-format,chat-composer}.ts`, `hooks/use-chat.ts`.

**Files:** Create `lib/{chat-api,chat-format,chat-composer}.ts` + `chat-format.test.ts`, `chat-composer.test.ts`,
`hooks/use-chat.ts`; Modify `lib/socket-chat.ts` (replace stub).

**Interfaces:** `previewFor(row: InboxRow, t)` (text, "2 photos", system code, "Offer ₹34,000 /pc"); `pillFor(row)`
(`your_turn` | `deal` | enquiry status); `systemLineParams(code, values)` (values → i18n params, amounts in Indian
format, side and reason codes to keys); `composerState(detail: ThreadDetail)` (`canWrite`, blocked-by-me /
blocked-by-them copy key, viewer copy key); `nextClientMessageId()` reused on retry; socket handler patches
`qk.threads(…)`, `qk.messages(id)`, `qk.thread(id)` on `message:new` / `offer:updated` / `thread:read` and invalidates on
reconnect.

- [ ] **Step 1: Failing tests (pure):** preview per kind; pill order (Your turn beats Deal beats status); system line
  params for every `SYSTEM_LINE_CODES` entry produce a key present in en / hi / gu; composer state for viewer, blocked
  either way, writable. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L6-2: Chats tab (inbox)

**Files:** Modify `screens/tabs/chats.tsx`; Create `components/chat/{ThreadRow,InboxSegments}.tsx`; Modify
`locales/*/chats.json`.

- [ ] **Step 1:** none (UI). **Step 3:** Implement per mockup negotiate · "Enquiries inbox": segments All / Buying /
  Selling / Your turn n, rows (counterpart, GST badge, thumb, masked title, preview, time, unread, pill), infinite
  scroll, Archived link at the bottom, pull to refresh; calls `askPushOnce('chats')` on focus (C0-5 stub, L8 body). **Step 4:** typecheck; parity / audit / style audit. **Step 5: Stage.**

### L6-3: Thread screen

**Files:** Modify `screens/chat/thread.tsx`; Create `components/chat/{MessageBubble,PhotoGrid,SystemLine,ScamWarning,
ListingStrip,Composer,ThreadMenu,ReportConversationSheet,MaskedNumberNotice,ContactBanner}.tsx`; Modify
`locales/*/chats.json`.

**Rules (§15.1 Thread):** messages page (30, older on scroll), photos via `expo-image-picker` + `expo-image-manipulator`
(≤ 2 048 px) → presign → PUT → send with keys (≤ 5, caption); refetch the page when a photo URL expires; system lines
via `systemLineParams`; scam warning under the other side's flagged messages; listing strip with available quantity
and "No longer listed"; machine listings show the inspection tip; offer and deal cards render L7's `OfferCard` /
`DealCard`; counter / quote open L7's `OfferSheet` (modes `counter` / `quote`); contact banner with the share tick
(opens `ShareNumberSheet`) once a deal exists; call button (`tel:`) only when revealed with a number; menu: share
(`shareMessage`), report (sheet with reasons, details, "Also block"), block (confirm), archive (shown to viewers too,
P15; report and block hidden for viewers); `thread:viewing` every 20 s while focused through `useSocketEmit()` (C0-5),
`null` on blur; refetch on `useOnReconnect`; marks read on focus and on new messages while focused.

- [ ] **Step 1:** none (UI; logic is in L6-1). **Step 3:** Implement. **Step 4:** typecheck; parity / audit / style
  audit. **Step 5: Stage.**

### L6-4: Enquire sheet, share-my-number sheet, contact number, blocked businesses

**Files:** Modify `components/chat/EnquireSheet.tsx`, `components/contact/ShareNumberSheet.tsx`,
`screens/profile/{contact-number,blocked-businesses}.tsx`; Modify `locales/*/chats.json`.

**Rules (§6.3, §6.6, §5.12):** Enquire sheet: quick option chips (Ask price preselects `price_request`), quantity for
best price / price please (default min order, else 1), note ≤ 500, the stored Check my machine choice sent as `fit` when
"Will it fit my machine?" is ticked, then navigate to the thread; fires `CHAT_EVENTS.chatEnquirySent` and
`askPushOnce('enquiry')`. Share sheet:
consent wording v1 (three languages, says unmasked text can't be taken back), owner-only hint when `ownerOnlyHint`.
Contact number: owner only; OTP via the F1 `OtpCells`; remove with confirm. Blocked businesses: list + unblock.

- [ ] **Step 1:** none (UI). **Step 3:** Implement. **Step 4:** typecheck; parity / audit / style audit.
  **Step 5: Stage.**

**L6 exit:** `pnpm --filter user-app test`, typecheck green; review (focus: no text in analytics, viewer can't write,
masked strings never re-built client-side); controller commits on `lane/f6-L6`.

## Lane L7 — App offers and deals

### L7-1: Offer form logic, offer sheet, offer card

**Ports:** textile app `lib/offer-form.ts`, `screens/offers/make-offer.tsx`, `components/chat/OfferCard.tsx`.

**Files:** Create `lib/{offers-api,offer-form}.ts` + `offer-form.test.ts`, `hooks/use-offers.ts`; Modify
`components/offers/OfferSheet.tsx`, `components/chat/OfferCard.tsx`; Create `locales/*/offers.json` content.

**Interfaces:** `offerFormState({ mode, listing?, offer?, options })` → defaults (quantity = min order else 1,
validity = default), `validateOfferForm(values, ctx)` → field errors (price required > 0; offer ≤ asking; buy locks
price; quantity ≥ min (or the whole remainder) and ≤ available, unit decimals; counter within `counterBounds`, not
unchanged), `offerTotals(values, gstMode)` → `{ totalPaise, percentBelow, gstLabelKey }`, `roundLabel(offer)` ("Round n
of 5"). Sheet in four modes (§15.1), bounds hint on counters, Idempotency-Key per tap, `askPushOnce('offer')` after a
send. Card: buttons only for the turn
side (`offer.actions`), backup and reconfirm states, "Keep talking here, or accept or reject" after round 5.

- [ ] **Step 1: Failing tests (pure):** totals for 2.5 units half-up, "+ GST" / "incl. GST"; % below on negotiable only;
  every validation error per mode; counter bounds hint equals `counterBounds`; buy mode ignores a typed price.
  **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L7-2: Listing page and guest pending actions

**Files:** Modify `lib/listing-page.ts` + `listing-page.test.ts` (`contactActions` per §7.1: fixed → `enquire` +
`buy`), `screens/listing/{listing,listing-view}.tsx` (reads `route.params.openSheet` and opens that sheet once),
`hooks/use-pending-contact.ts` (replace C0-5's stub: navigate to `Listing` with `{ listingId, openSheet }`),
`locales/*/listing.json`.

**Rules (§7.1, §8.4, §15.2, R24):** buttons per kind and price model; Make offer / Buy disabled with "All on hold in
deals" at available 0; "Open chat" when `myThreadId`; "2 of 3 pcs available"; seller stars + count + link to Seller
reviews when `seller.score`; owner "On hold in deals: n" → Deals tab; guests: `requireSignIn('enquire' | 'offer')`
with `PendingAction`, and after sign-in + onboarding the runner (C0-5) calls `openPendingContact`, which reopens the
listing with the sheet open (never sends). My listings moved to L8-4.

- [ ] **Step 1: Failing tests (pure):** `contactActions` for each kind × price model; disabled state at available 0
  (`pendingToRun` is tested in C0-5). **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### L7-3: Deals tab, Deal record, deal card, deal sheets

**Ports:** textile app `lib/deal-display.ts`, `screens/deals/deal-details.tsx`, `components/deals/*`.

**Files:** Create `lib/{deals-api,deal-display}.ts` + `deal-display.test.ts`, `hooks/use-deals.ts`,
`components/deals/{DealRow,Timeline,NotesCard,NotesSheet,ContactBlock,HandoverSheet,CancelSheet,CancelRequestBanner}.tsx`;
Modify `screens/tabs/deals.tsx`, `screens/deals/{deal-record,report-problem}.tsx`, `components/chat/DealCard.tsx`,
`lib/socket-deals.ts` (replace stub), `locales/*/deals.json`.

**Interfaces:** `dealActionButtons(view: DealView)` (from `view.actions`, primary / secondary order); `timelineRows(events,
t)`; `deadlineCopy(deal, now)` → "completes on Thu 21 Nov, 16:40" in IST and the report-window end;
`cancelReasonsFor(side)`; `balanceOf(totalPaise, advancePaise)`.

- [ ] **Step 1: Failing tests (pure):** buttons per status × side incl. a pending cancel request from each side;
  deadline copy in IST across midnight; balance = total − advance as strings; cancel reasons per side.
  **Step 2:** FAIL. **Step 3:** Implement per mockups deals · "My deals", "Deal record", "Handed over" (segments Active /
  Completed / Cancelled, Buying / Selling; notes edit sheet with `version` and a `DEAL_STALE` refetch; contact block with
  the share tick via `ShareNumberSheet`; hand over with optional photo; report a problem screen with category,
  description, ≤ 5 photos; on a completed deal a review card from `view.review` — "Rate this deal" opening L8's
  `ReviewDeal` screen while the window is open, "Waiting for their review" / "Published" otherwise: this is how the
  buyer who confirmed is asked, P14). **Step 4:** PASS; parity / audit / style audit. **Step 5: Stage.**

**L7 exit:** `pnpm --filter user-app test`, typecheck green; review (focus: money as strings, no amounts in analytics,
buttons from server actions only); controller commits on `lane/f6-L7`.

## Lane L8 — App reviews, notifications, push, My listings

### L8-1: Reviews

**Files:** Create `lib/{reviews-api,review-form}.ts` + `review-form.test.ts`; Modify
`screens/reviews/{review-deal,seller-reviews,my-reviews}.tsx`, `locales/*/reviews.json`.

- [ ] **Step 1: Failing tests (pure):** `validateReview(side, values)` requires exactly the side's facets as whole
  1–5, text only for the buyer side ≤ 1 000; `scoreDisplay(score)` (one decimal half-up, "New seller" when null).
  **Step 2:** FAIL. **Step 3:** Implement per mockup deals · "Review" ("published when both have reviewed, or 7 days
  after the first"), Seller reviews (score, facet bars, list with replies), Profile › Reviews with Reply.
  **Step 4:** PASS. **Step 5: Stage.**

### L8-2: Notifications list, bell, badges, settings, links

**Files:** Create `lib/{notifications-api,notification-links}.ts` + `notification-links.test.ts`,
`hooks/{use-notifications,use-badges}.ts`; Modify `screens/notifications/{notifications,notification-settings}.tsx`,
`screens/tabs/home.tsx` (bell with unread count), `navigation/tab-navigator.tsx` + `navigation/floating-tab-bar.tsx`
(the icon-only bar draws the badges: Chats = `unreadThreads`, Deals = `dealsYourTurn`; badges refetch on
`useOnReconnect`), `lib/socket-notifications.ts` (replace stub), `screens/profile.tsx` (rows: Reviews, Contact
number, Blocked businesses, Notification settings; language change also calls `PUT /users/me/language`),
`locales/*/{notifications,profile,home}.json`.

- [ ] **Step 1: Failing tests (pure):** `notificationLink(row)` → screen + params for every type of §11.3 (thread,
  deal record, reviews). **Step 2:** FAIL. **Step 3:** Implement per mockup account · "Notifications" (rows, unread dot,
  Mark all as read, infinite scroll; tap marks read and opens). **Step 4:** PASS. **Step 5: Stage.**

### L8-3: Push registration, explainer, foreground dedupe

**Ports:** textile app `lib/{push,push-dedupe}.ts`, `screens/notifications/permission-explainer.tsx`.

**Files:** Create `lib/{push,push-dedupe}.ts` + `push-dedupe.test.ts`, `hooks/use-push.ts`; Modify `lib/push-ask.ts`
(replace stub: opens `PushExplainer` once, then the OS prompt), `screens/sell/published.tsx` (`askPushOnce('publish')`),
`screens/notifications/permission-explainer.tsx`, `App.tsx` (listeners), `app.json` / `app.config.ts`
(`expo-notifications` plugin; `android.googleServicesFile` only when `google-services.json` exists),
`apps/user-app/package.json` (`npx expo install expo-notifications`).

**Rules (§11.5, §11.6):** explainer then the Android 13 prompt at first enquiry / offer / publish / Chats open, never at
start; `PUT /users/me/devices` after sign-in, on token refresh and app start; `DELETE` on sign-out; foreground: skip a
push whose `deliveryKey` is in the last 100 (AsyncStorage); tap marks read and opens `notificationLink`; fires
`NOTIFICATION_EVENTS`. Works without Firebase config (no token → no registration, no crash).

- [ ] **Step 1: Failing tests (pure):** dedupe keeps 100 keys, drops the oldest, says "seen" for a repeat; the
  permission-ask decision (`shouldAskPush({ asked, trigger })`) for each trigger and never on start. **Step 2:** FAIL.
  **Step 3:** Implement. **Step 4:** PASS; `npx expo install --check`. **Step 5: Stage.**

### L8-4: My listings with holds (moved from L7, the heaviest lane)

**Files:** Modify `screens/my-listings/{manage-sheet,quantity-sheet,edit-menu,my-listings}.tsx`, `lib/my-listings.ts`
(if present; else create `lib/my-listings-holds.ts`) + test, `locales/*/holds.json` (C0-5 area; `listing.json` stays
L7's).

**Rules (§8.3, §8.4, §15.2):** `reserved` shown as "On hold in deals" with available / held; `LISTING_HAS_OPEN_DEALS`
sheet with links to the deals (`details.dealIds`); quantity sheet refuses below held (client check + the server's
`QUANTITY_BELOW_HELD`); pause confirmation warns about open offers and backups when the listing has any; `UNIT_LOCKED`
message on the edit menu's unit change; `reserved` listings keep Edit.

- [ ] **Step 1: Failing tests (pure):** the quantity sheet's minimum is the held quantity; the manage-sheet actions for
  a `reserved` listing (no Mark sold / Remove while held). **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS;
  parity / audit / style audit. **Step 5: Stage.**

**L8 exit:** `pnpm --filter user-app test`, typecheck green; review (focus: no permission prompt at start, no text in
analytics or logs, app runs without Firebase files); controller commits on `lane/f6-L8`.

## Wave B merge (controller)

- [ ] Merge `lane/f6-L5`, `L6`, `L7`, `L8` into `develop` one at a time; `grep -rn "F6F7-STUB" apps` is empty; `pnpm
  typecheck`; `pnpm lint`; `pnpm --filter admin test`; `pnpm --filter user-app test`; fix wave; commit; push. Lane
  cleanup as in wave A (worktrees, any lane test DBs, branches); allowlist merges resolved by the controller.

---

# Batch I — Integration and close-out (sequential, on `develop`)

### I-1: Cross-lane tests and stub sweep

**Files:** Create `apps/api/__tests__/f6-core-loop.test.ts`.

- [x] **Step 1: Failing tests (the cases no single lane could write):** enquiry → offer → counter ×2 → accept (deal +
  hold) → second buyer's offer becomes backup → buyer cancels the `agreed` deal → backup revives, seller reconfirms,
  buyer accepts → hand over → `auto_complete_at` moved back → `autoCompleteDeals` → both reviews → published;
  `assertHeldInvariant` after each step; notifications rows of the right types exist for each step and the rendered
  texts carry no phone number planted in a message; accept after both ticks reveals in the same transaction (`maybeReveal`
  from L2's accept); a block closes the pair's open offers and their `agreed` deal can still be handed over and
  confirmed; an admin `remove` cancels the `agreed` deal (hold released) and leaves a `handed_over` one to complete;
  suspending the seller's owner closes chains, the deal continues and the buyer can cancel it; the Deal record
  (`GET /deals/:id`) shows each side's number only after both ticks and hides it again after one side withdraws;
  `confirm-received` racing `autoCompleteDeals` on the same deal (`Promise.all`) → exactly one completion and one hold
  conversion (quantity down once, `assertHeldInvariant`).
- [x] **Step 2:** run; fix in the owning lane's files on `develop`. **Step 3:** `grep -rn "F6F7-STUB\|NOT_IMPLEMENTED"
  apps/api/src apps/user-app apps/admin` is empty. **Step 4:** PASS. **Step 5: Stage.**

### I-2: Full checks and builds

- [ ] One package at a time: `pnpm typecheck`, `pnpm lint`, `pnpm --filter @mpm/api test`, `pnpm --filter admin test`,
  `pnpm --filter user-app test`; a SQL count shows no rows left in the new tables of `mpm_test`; `pnpm --filter admin
  build`; `CI=1 npx expo export --platform android` in `apps/user-app`; `npx expo install --check`; if Docker is
  available, `docker build -f apps/api/Dockerfile .` (checks `sharp` on Alpine, §23), else an owner item.
- [x] Dev DB: `db:migrate` (0012, 0013).
  *(2026-11-20: all done except `expo export` (stopped by the machine running low on memory), `npx expo install
  --check` and the Docker build: still to run; see PROJECT_STATUS.)*

### I-3: Agent walk-through on the dev DB

- [x] Scripted two-business API walk-through (§20 close-out): enquiry with a machine → offer → counter ×2 → accept →
  backup → cancel → revive → reconfirm → accept → hand over (photo only if R2 is set) → auto-complete with
  `auto_complete_at` moved back → reviews → publish (`review-publish` with `publish_due_at` moved back or both
  submitted); plus a quote on a price-on-request listing and a "Buy at this price"; share-my-number on both sides →
  revealed; a dispute resolved by a support admin; admin pages by page loads (`/enquiries`, `/deals`, `/disputes`,
  `/chats`, `/reports` 200) and API calls (Chrome only if the extension is connected). Push: dev stub rows `sent_dev`.
  Delete all walk-through data afterwards (catalogue, seeds, settings unchanged; audit rows kept).

### I-4: Docs

- [x] `docs/PROJECT_STATUS.md`: What's built (F6 + F7 row, tables, routes, jobs, app and admin screens), How to run
  (`FIREBASE_SERVICE_ACCOUNT_B64`, `google-services.json`, new dev-client build, R2 lifecycle for `incoming-chat/`),
  Open items (§25 list; P6 owner-change / phone-change withdraw wiring; Socket.IO Redis adapter; chat retention), D6 settled by R6, Suggested build order (item 5 done), session log line.
- [x] `CLAUDE.md` (services list: chat, offers, deals, reviews, notifications, consent; `runTx` / after-commit emits;
  idempotency; push opt-in), `apps/user-app/CLAUDE.md` (chat / deals / push modules, query keys, socket handlers,
  `expo-notifications` build note), `apps/admin/CLAUDE.md` (new pages, reason-gated reads), `.env.example` (P7),
  `apps/user-app/.env.example` (`EXPO_PUBLIC_SHARE_BASE_URL`).
- [x] `docs/product-scope.md` per §22 (M9 / M15 pointers answered; M13 "business days" → calendar days; M10 sharing →
  both sides tick after a deal); F4 spec §2 / §8.3: the bell and the Enquire / Offer sign-in reasons now exist.
- [ ] Controller commits and pushes `develop` (milestone).

### I-5: Owner checklist (not for an implementer subagent)

- Firebase: create the project, add the Android app (`com.machineparts.app`), put the service-account JSON (base64) in
  `.env` as `FIREBASE_SERVICE_ACCOUNT_B64` and `google-services.json` in `apps/user-app/`, then **rebuild the dev
  client** (`pnpm android`).
- On two devices (buyer and seller businesses): enquiry with "Will it fit my machine?" → chat with a photo (check it
  has no location data when opened) → offer → counter → accept → share my number on both sides → number shows, call
  button works → handed over with a photo → received → review on both sides → published.
- Push on a device: new enquiry, message (none while the thread is open), offer, accepted, handed over, completed;
  tapping opens the right screen; a repeat doesn't show twice.
- Masking: a number typed in Hindi / Gujarati digits stays hidden before the deal and for a viewer member after it.
- Hindi and Gujarati copy (scam warning, consent wording, system lines) checked by a native speaker.
- R2 lifecycle rule: delete `incoming-chat/` after 1 day.
- Confirm with the client: buyer reviews visible to nobody yet, dispute outcomes not public, auto-complete after 3 days.

---

## Coverage (spec section → tasks)

| Spec | Tasks |
|---|---|
| Header, follows textile, settled items | Global constraints; each task's **Ports** line |
| §1 Goals | 1: L1-1, L6-4 · 2: L2-1–L2-3, L7-1 · 3: C1-1, L2-3, L2-4 · 4: L3-1–L3-4, L7-3 · 5: C0-3, C0-4a, L1-4 · 6: L4-1, L4-2, L8-1 · 7: C0-4a, L4-3, L4-4, L8-2, L8-3 · 8: L1-5, L3-3, L5-3, L5-4 |
| §2 Non-goals | Nothing built for them (I-1 review); §24 list kept in PROJECT_STATUS (I-4) |
| §3 Approaches | Approach 1 is the plan (Ports lines) |
| §4 Rulings R1–R26 | R1 L1-1 · R2 L2-1 · R3 C0-4a, L1-1 · R4 L1-1 · R5 L1-1, C0-1 · R6 C0-3, L1-4 · R7 C0-3, L1-1 · R8 C0-3, L1-2 · R9 C0-4a, L1-3, L6-1 · R10 C0-4a, L1-3 · R11 L2-1, L2-2 · R12 L2-1 · R13 L2-1 · R14 C0-1, L2-2 · R15 L2-3–L2-5, C0-3 · R16 C1-1, C1-2 · R17 L3-2 · R18 L3-2, L3-4 · R19 L3-2 · R20 L3-3, L5-3 · R21 L3-2, L3-4 · R22 L4-1, L4-2 · R23 L1-5, L5-1–L5-4 · R24 C0-5, L7-2, L8-4 · R25 L4-3, L4-4, L8-2, L8-3 · R26 Global constraints |
| §5.1–§5.15 Data model | C0-2 (all); §5.7 C1-1; §5.12 L1-4; §5.13 C0-4a, L4-3, L4-4; §5.14 C0-3; §5.15 C0-2, L1-5, L4-2, L4-3 |
| §5.16 Shared types | C0-1 |
| §5.17 Migrations | C0-2 |
| §6.1–§6.4 Threads, enquiry, messages | L1-1 |
| §6.5 Masking | C0-3, C0-4a, L1-4 |
| §6.6 Share my number | L1-4, L6-4, L7-3 |
| §6.7 Scam warning | C0-3, L1-1, L6-3 |
| §6.8 Photos | C0-3, L1-2, L3-2, L3-3, L6-3 |
| §6.9 System lines | C0-1, C0-4a, L6-1 |
| §6.10 Inbox | C0-1, C0-4a, L1-3, L6-2 |
| §6.11 Block | L1-5, L2-4, L6-3 |
| §6.12 Report a conversation | L1-5, L6-3 |
| §6.13 Share to WhatsApp | C0-5, L6-3, L7-2 |
| §7.1 Buttons | L7-2, L2-1 |
| §7.2 Fields and money | C0-1, L2-1, L7-1 |
| §7.3 Quotes | L2-1 |
| §7.4 Counter bounds | C0-1, L2-2, L7-1 |
| §7.5 Offer state machine | L2-1–L2-5 |
| §7.6 Accept | L2-3 |
| §7.7 Backups, reconfirm, suspension | L2-4, I-1 |
| §7.8 Limits | L2-1 |
| §7.9 Expiry and reminders | L2-5 |
| §8.1–§8.2 Holds, `syncReservation` | C1-1 |
| §8.3 Transition and edit changes | C1-1, C1-2, L8-4 |
| §8.4 Available quantity | C1-3, L7-2, L8-4 |
| §8.5 Lock order | C0-4a, C1-1, Global constraints, L1-5, L2-1, L2-4, L3-2 |
| §9.1 Deal record, notes | L3-1, L3-2, L7-3 |
| §9.2 Deal state machine | L3-1, L3-2, L3-3 |
| §9.3 Timers | L3-2, L3-4, L7-3 |
| §9.4 Completion | L3-2, L3-4 |
| §9.5 Cancelling | L3-2, L7-3 |
| §9.6 Disputes | L3-3, L5-3, L7-3 |
| §10.1–§10.3 Reviews, blind | C0-1 (`review_waiting`), L4-1, L7-3 (review card), L8-1 |
| §10.4–§10.6 Scores, reply, moderation | L4-2, L5-4, L8-1 |
| §11.1–§11.2 Rows, grouped chat rows | C0-4a, L4-3 |
| §11.3 What gets a notification | L1-1, L2-1–L2-5, L3-2–L3-4, L4-1, L4-3 (P14) |
| §11.4 Text | L4-3 |
| §11.5 Push delivery | L4-4, L8-3 |
| §11.6 Devices, preferences, permission, list | L4-3, L4-4, L8-2, L8-3 |
| §12 API conventions, §12.1 rate limits | C0-3, C0-4a, C0-4b, L1-1, L1-3 (viewer archive, P15), L1-5 |
| §12.2 Routes | C0-4b (stubs); L1-1–L1-5, L2-1–L2-3, L3-1–L3-3, L4-1–L4-4; `ListingView` C1-3 |
| §13 Sockets | C0-4a, C0-4b (`threadRoom`), C0-5 (one socket), L1-1, L1-3, L6-1, L6-3, L7-3, L8-2 |
| §14 Jobs | C0-4b, L2-5, L3-4, L4-1, L4-4, C0-3 (idempotency cleanup) |
| §15.1 Screens | L6-2–L6-4, L7-1–L7-3, L8-1–L8-4 |
| §15.2 Changes to existing screens | C0-5 (pending runner, socket), L7-2, L8-2, L8-4 |
| §15.3 Foundation | C0-5, L6-1, L7-1, L7-3, L8-1–L8-4 |
| §15.4 Analytics | C0-5 (declared), lanes fire |
| §16.1 Admin pages and roles | C0-4b (RBAC), L5-1–L5-4 |
| §16.2 Admin API | L1-5, L2-5, L3-3, L4-2 |
| §16.3 Reading a conversation | L1-5, L5-3 |
| §17 Settings | C0-1, L5-4 |
| §18 Errors | C0-5 (copy), each task's refusals |
| §19 Privacy and security | C0-3, C0-4b (Sentry), L1-4, L4-3, C0-5 (app redaction), I-4 (DPDP open items) |
| §20 Testing 1–17 | 1 C0-1, L2-1, L2-2 · 2 L2-3 · 3 C1-1, C1-2, L2-4, I-1 · 4 C0-1, L2-3 · 5 L3-2–L3-4 · 6 C0-3, L1-4 · 7 L1-1, L1-2, L2-1, L3-1, L4-1, I-1 · 8 L1-1, L2-1 · 9 L2-5, L3-4, L4-1 · 10 L4-1, L4-2 · 11 C0-4a, L4-3, L4-4 · 12 C0-3, L1-2 · 13 L1-5, L3-3, C0-4b · 14 C0-3, L2-3 · 15 L2-4, I-1 · 16 L1-5 · 17 L2-1; app tests L6-1, L7-1–L7-3, L8-1–L8-4, C0-5; admin tests L5-1, L5-3, L5-4; close-out I-2, I-3 |
| §21 Build order | Lanes and ownership (P1) |
| §22 Changes to earlier code and docs | C0-1, C0-4b (`threadRoom`, business detail), C1-1–C1-3, L2-4 (user-status, admin users route), L5-1 (nav), L7-2, L8-4, I-4 (docs) |
| §23 Risks | I-2 (`sharp` Docker build), I-5 (Firebase, device), Open items in I-4 |
| §24 Deferred | I-4 (PROJECT_STATUS) |
| §25 Open items | I-4, I-5 |
| §26 Our calls | Applied in the tasks named by their sections |
| §27 Review changes | 1–2 C1-1 · 3 L2-1, C1-1 · 4 C1-2, L2-4 · 5 L2-4 · 6 L2-5, L3-4 · 7 L3-3 · 8 L1-1 · 9 C1-1 · 10 C0-1, C1-3 · 11 L4-1, L4-2 · 12 L1-4, L6-4 · 13 L1-4 · 14 L2-1, C0-4a · 15 L3-4 · 16 L1-5 · 17 C0-4a, L1-3 · 18 C0-2, L4-3 · 19 L3-2 · 20 C0-3 · 21 C1-2, L8-4 · 22 C0-2 · 23 C0-2 · 24 C1-2 · 25 L2-3 · 26 C0-5 · 27 C0-1 · 28 none to build · 29 L4-3 · 30 L3-2 |

---

## Plan review changes (2026-11-19)

An independent reviewer checked this plan against the code; every fix below is applied above. One spec line changed
(I4).

| # | Fix | Where |
|---|---|---|
| C1 | `sell_out`, `reserve`, `unreserve` always run with `lockBusiness: false`; `applySystemTransition` refuses `true` for them (as `expire`); `deals/locks.ts` documents that F6 never locks the seller business; the post-write hook is `afterListingStatusWrite` in `holds.ts`, called by the F2 writers' callers, never by `syncReservation`'s own transitions (no recursion); race test `confirm-received` vs quantity `PATCH` → no `40P01` | Global constraints (lock order), C0-4a `locks.ts`, C1-1, C1-2, L3-2 |
| I1 | After-commit queue supports savepoints (`effectsTx`: child merges on release, discarded on rollback); `bulkListingAction` and `adminDeleteMedia` take `TxApp`; `routes/admin/users.ts` (suspend → reconcile) owned by L2; queuing outside `runTx` throws in tests; flush no-op without `app.io` | P2, C0-3, C1-2, ownership table, L2-4 |
| I2 | Lane isolation: root `.env` copied into each worktree, own test DB `mpm_<lane>_test` (`createdb` + `db:migrate:test`), own Redis DB index; lane setup checklist; cleanup after merge | Global constraints, Lanes (setup checklist), Wave A merge |
| I3 | `GROUP_RATE_LIMIT_MAX` env override raised in `vitest.config.ts`; the limit test lowers it on its own app; fixture buyers GST-verified by default; limit tests set their settings explicitly | Global constraints (tests), C0-4a |
| I4 | Viewers may archive (controller ruling, P15): archive routes skip the role check, test (viewer archives, still 403 on presign / send), C0 route preHandlers, L6-3 menu shows Archive to viewers, removed from I-4's open items. **Spec note:** §12's viewer sentence now reads "except reading, marking read and archiving" | P15, Global constraints, C0-4b, L1-3, L6-3, I-4, spec §12 |
| I5 | C0-5 app seams: one socket (`SocketProvider` in `root-navigator`, `useSocketEmit`, `useOnReconnect`); non-`save` pending actions go to the `openPendingContact` stub (`hooks/use-pending-contact.ts`, L7 fills), the runner never saves a pending Enquire; `Listing` params gain `openSheet?`; `pendingToRun` test moved from L7-2 to C0-5; `floating-tab-bar.tsx` (badges) to L8; P14 consequence: the buyer's "Rate this deal" comes from the Deal record's review card | P14, C0-5, ownership table, L6-3, L7-2, L7-3, L8-2 |
| I6 | Notification type `review_waiting` (other side told after the first review, §10.3) added in C0-1, sent and tested in L4-1 | C0-1, L4-1 |
| I7 | Block and owner suspension lock the affected listings in id order (`lockListingsInOrder`) before their offers; the `blocked` line is written last; race tests | Global constraints, C0-4a `locks.ts`, L1-5, L2-4 |
| I8 | C0-4 split into C0-4a (seams with real bodies + `f6-seams.test.ts`) and C0-4b (stubs, route stubs, RBAC table, jobs, Sentry, business-admin change + `f6-routes.test.ts`) | C0, File map, Coverage |
| m1 | Onboarding gate is `409 ONBOARDING_INCOMPLETE` (as `listing-write.service.ts`), not `403 BUSINESS_REQUIRED` | Global constraints |
| m2 | Idempotency follows textile: `pg_advisory_xact_lock` under `lock_timeout`; concurrent same key → one handler run, the second replays (or `409 REQUEST_IN_PROGRESS` past the timeout); test expectation fixed | P11, C0-3 |
| m3 | Photo routes (message photos, hand over, problem) check `readStoredResponse` before `finalizePrivatePhotos`; hand-over-with-photo retry case (and a photo-message retry case) | P11, C0-3, L1-2, L3-2, L3-3 |
| m4 | `deleteF6Rows` deletes consents in a transaction of their own (`SET LOCAL`); `deleteTestListings(conn, ids)` hooked too | C0-2 |
| m5 | `insertTestDeal({ status: 'completed' })` sets `completed_at` and converts the hold | C0-2 |
| m6 | Partial indexes declared in `schema.ts` (drizzle-kit emits `WHERE`, as `reports_one_open_uq`); custom 0013 only for CHECKs, the trigger and the sequence | C0-2, File map |
| m7 | `AdminBusinessDetail` gains `dealHistory` and `sellerScore` in C0-1 | C0-1 |
| m8 | `lib/i18n/audit-allowlist.json`, `lib/style-audit-allowlist.json`: append-only in lanes; controller resolves merges | Global constraints, Wave A merge |
| m9 | I-1 adds: Deal record shows the number after both ticks and hides it after a withdraw; `confirm-received` racing auto-complete → exactly one conversion | I-1 |
| m10 | C0-5's `shareMessage` test cut; `f6-schema.test.ts` keeps three per-kind shape cases | C0-2, C0-5 |
| m11 | `screens/my-listings/**` moved from L7 to L8 (new task L8-4, locale area `holds`); ownership table and coverage updated | Ownership table, C0-5, L7-2, L8-4, Coverage |
