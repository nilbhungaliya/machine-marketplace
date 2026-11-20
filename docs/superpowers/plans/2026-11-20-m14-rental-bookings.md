# M14 Machinery Rental Bookings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. **Contracts first, in sequence (C0), then parallel lanes** (as F6 + F7 and F8): each lane
> in its own git worktree on a local lane branch, one implementer per lane doing its tasks in order, an independent
> review per lane, then the controller merges. Steps use checkbox (`- [ ]`) syntax.

**Status:** Draft plan (2026-11-20), reviewed before C0.

**Goal:** A signed-in renter sees a rental listing's availability and requests a booking for dates; the owner confirms,
declines or proposes a change; a confirmed booking takes capacity on the listing's calendar (never over-committed);
both sides follow one Booking record through on site → returned → completed with notes, disputes and reviews; the
listing's `rented` status follows the calendar by itself; search filters "free on my dates"; admins see and cancel
bookings and resolve booking problems in Disputes.

**Architecture:** New tables `rental_bookings`, `rental_booking_versions`, `rental_booking_events`, `rental_blocks`;
nullable `rental_booking_id` on `deal_reviews`, `deal_disputes`, `chat_messages`, `notifications` (exactly one subject
per review / dispute). One service folder `apps/api/src/services/rentals/`. Capacity has one definition
(`services/rentals/capacity.ts`) and every capacity writer locks the listing `FOR UPDATE` first. `syncRentalStatus`
runs after every capacity change, from `afterListingStatusWrite`, and from a job. A booking lives in the listing's F6
chat thread (a `booking` card + system lines); a confirmed booking counts as a deal for share-my-number. Reviews and
disputes gain a **subject** (`deal | rental`) helper so every existing reader works for both. The shared seams
(capacity, locks, status sync, booking status write, event / line / notify / emit helpers, subject helper, every F2 /
F6 hook) are built with real bodies in C0, so the lanes never edit each other's files.

**Tech stack:** Fastify 4, Drizzle 0.31 + drizzle-kit 0.22, Zod, Postgres 18 + PostGIS, Redis, Socket.IO 4, `sharp`,
R2 via `lib/storage.ts`; Expo SDK 54, React Navigation 7, TanStack Query, Formik + Yup, i18next; Next.js 14 admin kit.
No new dependency, no new native module.

**Spec:** `docs/superpowers/specs/2026-11-20-m14-rental-bookings-design.md` (rulings R1–R16, (my call) list §24, review
changes §25, reader table §5.5a, listing-state table §7.2). Section numbers below (§n) refer to it. The spec is the
source of truth; plan decisions where it is silent are **D1–D16** below.

**Sources (no textile counterpart, spec header):** each task names the F2 / F6 / F8 files it follows (**Follows:**).
Read them first and keep their patterns: F6 `services/deals/{deal.service,deal-actions,deal-cancel,deal-jobs,
deal-view,deal-read.service,locks,holds}.ts`, `services/chat/{thread-lines,open-thread,message.service}.ts`,
`services/consent/contact-consent.service.ts`, `services/reviews/*`, `services/deals/dispute.service.ts`; F8
`services/part-requests/{locks,request-jobs,admin.service}.ts`; F2 `services/listings/{listing-lifecycle,
listing-write,listing-admin,listing-jobs}.service.ts`.

---

## Global constraints

- **Branches:** C0 on `develop`. Then lanes, each in its own worktree on a local branch (lane setup checklist below).
  **Implementers never commit or push**; each task ends with "Stage" (list the files). The controller commits per lane
  after its review, merges lanes into `develop` (`git merge --no-ff`), runs the suites once per wave, commits the fix
  wave and pushes at milestones only (after C0, after each wave, after Batch I). The spec and this plan are committed
  together before C0.
- **Contracts own the schema and shared types.** Only C0 adds migrations, edits `apps/api/src/db/schema.ts` or
  `packages/shared-types`. A lane that needs a contract change stops and reports it; the controller makes it on
  `develop` and the lane merges `develop` in.
- **File ownership:** a lane edits only the files in its row of the ownership table. Every cross-lane function exists
  after C0 with its final signature and a stub body marked `// M14-STUB(<lane>)` returning the empty answer (no-op,
  `null`, `[]`, `0`, `false`), never throwing; the owning lane replaces the body and removes the marker. I-1 greps for
  it. `apps/user-app/lib/i18n/audit-allowlist.json` and `lib/style-audit-allowlist.json` are append-only in lanes.
- **Lane isolation:** API lanes test against their own DB (`mpm_m14a1_test`, `mpm_m14a2_test`, `mpm_m14a3_test`) and
  Redis index (`/3`, `/4`, `/5`; `flushdb` first). App / admin lanes run no API tests.
- Routes: Zod `.strict()` parse → service → `{ data }`; services throw `AppError` subclasses with §17's codes. User
  routes `preHandler: fastify.requireUser`; writes add `refuseViewer` (`403 VIEWER_READ_ONLY`). Every booking write
  service calls `onboardingForUser` (`409 ONBOARDING_INCOMPLETE`). Admin `requireAdminRole('operations', 'support')`
  for rentals, `requireAdminRole('support')` for disputes (unchanged); every admin mutation writes `audit_log` via
  `writeAudit` in its transaction.
- **Visibility:** a booking is visible to members of its renter and owner businesses only; anyone else gets
  `404 RENTAL_BOOKING_NOT_FOUND`, never 403. Owner views omit `site_address` before `confirmed_at` and mask it until
  the thread's `contact_unlocked_at` (§8); viewers never see an unmasked address.
- **Text out:** version `message`, `notes_text`, `damage_note`, `final_amount_note`, `cancel_note`, `site_address` pass
  `maskContact` on every read (renter, owner, admin) and in notification params; stored text untouched. Notes and
  messages carry the F6 scam flag (`looksLikeScam`, `chat/scam-patterns.ts:33`) at write.
- **Lock order (§6.7):** renter business `FOR NO KEY UPDATE` (only on request, where limits are counted) → **listing
  `FOR UPDATE`** (every capacity writer and `syncRentalStatus`) → booking `FOR NO KEY UPDATE` → thread `FOR UPDATE`.
  Bookings are never locked `FOR UPDATE` outside jobs' `SKIP LOCKED` claims. Helpers in `services/rentals/locks.ts`.
  The seller's listing PATCH path already takes business → listing (`lockBusinessThenListing`).
- **Transactions with effects:** `runTx(app, fn)` / `runJobTx`; socket emits queued with `queueBusinessEmit` /
  `queueAdminEmit`; notifications through `notify(tx, …)` in the same transaction.
- **Money / time:** integer paise (`bigint`, JSON numbers ≤ 10¹⁰ checked); dates are IST calendar dates
  `YYYY-MM-DD` from `lib/ist.ts` (C0-2); every DB-clock rule uses `now()` / `IST_TODAY`; tests move stored timestamps
  and dates with `UPDATE` (never fake timers for DB-clock rules); pure functions take `today` as a parameter.
- **Migrations:** edit `schema.ts` → `pnpm --filter @mpm/api db:generate` (0016); CHECKs, partial uniques and the
  sequence restart in `drizzle-kit generate --custom` (0017). Never edit 0000–0015. Apply with `db:migrate` **and**
  `db:migrate:test`. **No statement in 0016 / 0017 compares against a new enum value as an enum literal** (`booking`,
  `rentals`): cast to text (§5.6).
- After editing `packages/shared-types`: `pnpm --filter @mpm/shared-types build`; its tests live in
  `apps/api/src/lib/*-shared.test.ts`.
- **Tests: limited and important only (owner).** Step 1 lists the only cases to write: capacity and races, the state
  machine, money, listing status sync and listing write rules, reveal and privacy, F6 regressions of the generalised
  readers, jobs. No tests for UI wiring, copy, layout or trivial helpers. App: pure `lib/` logic with co-located tests;
  i18n parity / audit and style audit must pass. Admin: the list filter query and the cancel dialog only.
- **API test fixtures:** real Postgres + Redis; unique per run; `createTestSeller({ point, gst })`,
  `insertTestListing`, `addTestMember`, C0-2's `insertTestRentalListing` / `insertTestBooking` / `insertTestBlock`;
  every limit test sets its settings in `app_settings` and restores them; **every suite leaves the test DB with no M14
  rows** (`deleteM14Rows` in `afterAll`, also called by `deleteTestBusinesses` / `deleteListingsOf` /
  `deleteTestListings` / `deleteTestUsers` before `deleteF6Rows`). Storage: `vi.mock` the storage calls of
  `services/chat/private-photo.ts`.
- **Memory is tight:** one package's tests at a time; while iterating, only the task's files
  (`pnpm --filter @mpm/api exec vitest run __tests__/<file>.test.ts`). At most three lanes at once. Admin build and
  `expo export` only in I-2.
- **App:** every string in `en`, `hi`, `gu` in the lane's own locale file (C0-5 creates and registers them); light only
  (`useTheme()` → `{ colors, shadows }`), `useType()`, the Periwinkle v2 kit, `testID` on every pressable, Indian
  amounts (`formatPaise`), refs and hour meters in JetBrains Mono (`apps/user-app/CLAUDE.md` §1–2, §6, §8). Screens
  follow the mockup flow `rental` in `docs/mockups/src/build-periwinkle-v2.mjs` (≈ l.641–671); screens without a mockup
  (owner calendar, sheets) use the `frontend-design` skill in the mockup's language. Analytics `RENTAL_EVENTS` declared
  once in C0-5, ids and codes only.
- **Admin:** v2 kit and palette classes only; style audit green; English only.
- **Exact numbers (spec):** counts hours 1–24, days 1–90, weeks 1–26, months 1–6; machines 1 … listing quantity
  (≤ 1000); start today … today + `rental_advance_days`; month = 30 calendar days; operator days hour 1 / day n /
  week 6n / month n × `month_days`; transport × 2 × machines; message ≤ 300, note ≤ 500 on a request version (the
  request note is the version message: ≤ 500 for `seq = 1`, ≤ 300 after), notes text ≤ 500, damage note ≤ 500, cancel
  / final notes ≤ 300, site address ≤ 200, block note ≤ 200, block range ≤ 366 days; photos ≤ 3 per step; hour meter
  0 … 1 000 000; availability window ≤ 92 days (default 30), "Free on" range ≤ 90 days; page size 20; refs from
  700001; on site not before `start_date − 1`; rate limits D6; settings defaults §16.
- **Every task ends green** for its own tests, typecheck of the packages it touched, lint for admin.
- Windows: Bash is Git Bash; paths relative to the repo root.

## Plan decisions (D1–D16, where the spec is silent or loose)

- **D1. Lanes.** §20's sketch: **A1** bookings core (request, estimate, every booking action, notes, photos, reads,
  views, badges count, thread card / turns / inbox, reveal generalisation); **A2** calendar and listing side
  (availability, owner calendar, blocks, discovery "Free on", the four jobs, overrun clash); **A3** reviews + disputes
  generalisation, notification texts and push tag, admin API. Wave B: **B1** admin, **B2** app renter + Booking record,
  **B3** app owner (sheets, calendar, My listings). The listing write rules of §7.2 and `syncRentalStatus` are C0 (real
  bodies): every lane depends on them.
- **D2. Route files per lane:** `routes/rentals.ts` (A1: `POST /rentals/estimate`, `POST /listings/:id/bookings`,
  `/rental-bookings/*`), `routes/rental-calendar.ts` (A2: availability, calendar, blocks), `routes/admin/rentals.ts`
  (A3); `routes/admin/disputes.ts` and `routes/reviews.ts` changes are A3's. Fastify registers them in C0-4.
- **D3. Service files:** `services/rentals/` — C0: `capacity.ts`, `locks.ts`, `status-sync.ts`, `booking-write.ts`
  (status write + event + line + notify + emit helpers), `listing-hooks.ts`, `system-exits.ts`, `estimate.ts` (thin
  wrapper over the shared `rentalEstimate` with the listing's terms), `thread-agreement.ts`; A1: `request-input.ts`,
  `request.service.ts`, `proposal.service.ts`, `steps.service.ts`, `notes.service.ts`, `booking-read.service.ts`,
  `booking-view.ts`, `booking-photos.ts`; A2: `availability.service.ts`, `calendar.service.ts`, `blocks.service.ts`,
  `rental-jobs.ts`, `clash.ts`; A3: `admin.service.ts`, `admin-view.ts`; `services/reviews/subject.ts` (C0) and the
  review / dispute files listed in §5.5a (A3).
- **D4. Views:** one builder `toBookingView(row, version rows, events, reader: { side: 'renter' | 'owner'; role;
  unlocked: boolean })` in `booking-view.ts`; list rows from `toBookingListRows`. The admin view is A3's.
- **D5. Proposal answers** carry `versionSeq: number` (the open version's `seq`); a mismatch → `409
  RENTAL_BOOKING_STALE`. Notes carry `version`.
- **D6. Group rate limits:** `RateGroup` gains `rental_booking` (request, change: 20 / 600 s), `rental_booking_action`
  (every other booking write and block writes: 60 / 600 s); `POST /rentals/estimate` `perUser(60)` per 60 s plus the
  discovery per-IP cap (guests by `X-Install-Id`); availability uses the discovery limiter; photo presign `perUser(30)`.
- **D7. Counting:** open = the renter business's bookings in `requested` / `countered`; verified = `'gst' =
  ANY(verification_levels)`; per day = bookings the renter business created this IST day, any status; one open per
  thread = a `requested` / `countered` booking on the same `thread_id`.
- **D8. Photos:** `POST /rental-bookings/:id/photos/presign` (party, non-viewer) reuses `presignPrivatePhoto`
  (`incoming-chat/<businessId>/` uploads); `PhotoDestination` gains `{ kind: 'rental'; bookingId; step: 'on_site' |
  'return' }` → `rental/<bookingId>/<uuid>.jpg`, limit 3, finalised **before** the transaction with `keepUploads: true`
  (F8's pattern: the route deletes finals when the transaction fails, uploads once it settled).
- **D9. Thread:** a request calls `openOrGetThread(tx, user, listingId, { skipDailyCap: true })` (C0-3a adds the 4th
  argument; the cap is F6's enquiry cap) and `insertCardMessage(tx, threadId, { kind: 'booking', rentalBookingId,
  senderSide: 'buyer', senderUserId })` (C0-3a extends the card object). The enquiry card is **not** inserted for a
  booking-opened thread; the booking card is the first message.
- **D10. Turns:** the thread's stored turns follow only **open** bookings (`requested` → owner's turn, `countered` →
  renter's turn), so they never go stale at midnight; the date-dependent turns of `rentalYourTurn` (on site, return)
  live only in the Deals-tab badge and list, computed on read. C0-3a adds the input to `recomputeTurns`.
- **D11. IST helper `apps/api/src/lib/ist.ts`:** `IST_TODAY: SQL` (`(now() AT TIME ZONE 'Asia/Kolkata')::date`),
  `IST_MIDNIGHT: SQL`, `istToday(now?: Date): string`, `istDateOf(d: Date): string`, `addDays(date: string, n:
  number): string`. Existing helpers (`part-requests/push-caps.ts`, `discovery/search-log.service.ts`,
  `chat/open-thread.ts`, `part-requests/reply-options.ts`, `listings/listing-validate.service.ts`) re-export from it in
  C0-2 (no behaviour change).
- **D12. Status emits:** `writeBookingStatus` queues `rental:updated { bookingId, threadId, status, version }` to both
  businesses and `rental:updated { bookingId }` to admin rooms `operations` and `support` on every status change.
- **D13. Clash dedupe:** `rental_booking_clash` is deduped per (owner user, overrunning booking id, colliding booking
  id) via the `notify` dedupe key `clash:<a>:<b>`.
- **D14. Listing view fields:** `ListingOwnerView.bookingSummary: { openRequests: number; activeBookings: number;
  outToday: number; nextBooking: { id; ref; startDate; endDate; machines } | null } | null` (rentals only; the name
  `rental` is taken by `ListingDetail.rental: RentalTerms`); `MyListingCard.rentalLine: { quantity: number; outToday:
  number; activeBookings: number } | null` for My listings (`GET /listings/mine`); both filled in C0-3b
  (`owner-summary.ts`). The public view gains nothing.
- **D15. Deals tab:** a `SegmentedControl` **Deals / Rentals** above the existing tabs; the Rentals list keeps
  Active / Completed / Cancelled and side chips All / Renting / Renting out; the tab badge sums `dealsYourTurn +
  rentalsYourTurn`.
- **D16. Test geography:** pins from `createTestSeller({ point })` (Surat ≈ 21.17 N, 72.83 E). The test DB has no
  pincode directory: site pincodes come from `insertTestPincodeOffices` (`test-discovery.ts:72`, range 990021–990029)
  or `createTestSeller({ pincodeOffices })` (990011–990019), placed near and ≈ 230 km from the pin as each test needs.

## Plan review changes

An independent review (2026-11-20) checked the plan against the spec and the code; all findings applied:

| # | Finding | Change |
|---|---|---|
| 1 | Capacity hooks needed the booking write helper defined after them | C0-3a is now the write helpers + locks, C0-3b capacity / sync / hooks |
| 2 | `ListingOwnerView.rental` clashes with `ListingDetail.rental`; My listings reads `MyListingCard` | `bookingSummary` + `MyListingCard.rentalLine`, filled in C0-3b (`owner-summary.ts`) |
| 3 | A3 can't build A1's view | `reportBookingProblem` returns `{ bookingId }`; A1's route rereads |
| 4 | No contract for notification params | `notifyBooking` builds stored params from the row; `TextParams` + `bookingRef`, `dates` |
| 5 | Wrong signatures (`openOrGetThread`, `insertCardMessage`, `applySystemTransition`, `detectScam`) | Real signatures; no re-entry guard |
| 6 | System exits locking listings inside the suspension's ordered listing locks | Exits lock booking → thread only |
| 7 | Unowned files (`thread.service`, `listing-admin`, `business-admin`, `search-request`, `ranking`) | Added to lane rows and tasks |
| 8 | Duplicate review routes; unnamed stub files | Review routes stubbed in `reviews.ts`; stub files named per lane |
| 9 | Cross-lane race tests | Block vs confirm moved to I-1 |
| 10 | Schema gaps (not-started stamp, circular FK, Drizzle index split, nullable `deal_id` fallout) | C0-2 covers each |
| 11 | No pincode directory in the test DB | D16 uses the 9900xx test pincodes |
| 12 | Stored thread turns stale at midnight | Thread turns follow open bookings only (D10) |
| 13–15 | Problem photos, `DateRangeSheet` ownership, change mode, listing filter, tab badge, param readers | D8 step `problem`; C0-5 placeholder + params; `listingId` filter |

## Review focus

1. **Over-committed calendar:** two confirms / accept-change / block writes racing on one listing, or a capacity
   writer that skips the listing lock (block edit, quantity PATCH, admin cancel then reconfirm). Pinned in C0-3b
   (`m14-capacity.test.ts`) and A1-2 (`rental-proposals.test.ts`).
2. **`rented` drifting:** a listing path into `live` / `rented` that skips `syncRentalStatus` (publish, approve,
   unhide, resume, renew, relist, `back_to_review` then approve, pause → resume while all out), or the job missing a
   mismatch after the IST date changes. Pinned in C0-3b (`m14-listing-hooks.test.ts`) and A2-3.
3. **Contact leaking early:** a phone in the site address, a version message or notes (Devanagari / Gujarati digits)
   reaching the owner before the reveal, a viewer, a notification or push; the estimate leaking distance. Pinned in
   A1-4 and A3-3.
4. **F6 regressions from generalising:** a deal review / dispute / reveal path that breaks or a rental one that
   silently disappears (public list INNER JOIN, reply lock, publish job, disputes queue, conversation read). Pinned in
   A3-1, A3-2, A1-5.
5. **IST boundaries:** a booking starting "today" checked against the UTC date; on site allowed a day early by UTC;
   reminders sent twice across midnight; the status job flipping at UTC midnight. Pinned in C0-2 (`ist.test.ts`) and
   A2-3.

---

## Lanes and ownership

| Lane | Wave | Owns (only these files; paths under `apps/api/src/` unless noted) | Assumes from C0 |
|---|---|---|---|
| **A1 API bookings** | A | `services/rentals/{request-input,request.service,proposal.service,steps.service,notes.service,booking-read.service,booking-view,booking-photos}.ts` (`booking-read.service.ts` exists after C0-4 with the stub), `services/consent/contact-consent.service.ts`, `services/chat/{message.service,inbox.service,thread.service}.ts`, `routes/rentals.ts`, tests `apps/api/__tests__/rental-{requests,proposals,steps,reads,reveal}.test.ts` | locks, `writeBookingStatus` + helpers, thread agreement, system exits (C0-3a); capacity, status sync, owner summary (C0-3b); `reportBookingProblem` stub (A3) |
| **A2 API calendar + jobs** | A | `services/rentals/{availability.service,calendar.service,blocks.service,rental-jobs,clash}.ts` (`rental-jobs.ts` exists after C0-4 with stubs), `services/discovery/{filters,search.service,ranking}.ts` (the `rentalDates` filter and its `rentTier` rule only), `routes/rental-calendar.ts`, tests `apps/api/__tests__/rental-{calendar,discovery,jobs}.test.ts` | capacity, `clashWithFor`, status sync (C0-3b); locks, `writeBookingStatus` (C0-3a) |
| **A3 API reviews, disputes, notifications, admin** | A | `services/reviews/{review-state,review.service,review-jobs,review-moderation.service,rental-review.service}.ts`, `services/rentals/{rental-disputes,admin.service,admin-view}.ts`, `services/deals/{dispute.service,deal-admin.service,deal-read.service,deal-view}.ts` (dispute parts), `services/chat/admin-read.service.ts`, `services/reports/admin-reports.service.ts`, `services/admin/business-admin.service.ts` (`rentalBookingCount` only), `services/listings/listing-admin.service.ts` (`adminListingDetail` rental block only), `services/notifications/text/{en,hi,gu}.ts`, `services/notifications/{render,push-sender}.ts`, `routes/reviews.ts` (rental review routes), `routes/admin/{rentals,disputes}.ts`, tests `apps/api/__tests__/rental-{reviews,disputes,notifications,admin}.test.ts` | subject helper, `writeBookingStatus`, `TextParams` (C0-3a); capacity, status sync (C0-3b) |
| **B1 admin** | B | `apps/admin/app/(dashboard)/rentals/**`, `apps/admin/components/rentals/**`, `apps/admin/lib/rentals-api.ts`, `apps/admin/app/(dashboard)/disputes/**`, `apps/admin/components/disputes/**`, `apps/admin/lib/disputes-api.ts`, `apps/admin/components/settings/marketplace-settings-form.tsx`, `apps/admin/components/businesses/business-detail.tsx`, `apps/admin/app/(dashboard)/listings/[id]/**` (bookings block) | admin types (C0-1), nav (C0-4), the A3 API |
| **B2 app renter + record** | B | under `apps/user-app/`: `screens/rentals/{request-booking,booking-record}.tsx`, `components/rentals/{AvailabilityStrip,EstimateCard,BookingCard,BookingRow,BookingTimeline,BookingMoney,BookingNotesSheet,RenterAnswerBar,CancelBookingSheet,DateRangeSheet}.tsx` (`DateRangeSheet` exists after C0-5 as a placeholder with final props), `lib/{rental-request-form,rental-dates,search-request}.ts` + tests, `hooks/{use-rental-booking,use-rental-bookings}.ts`, `screens/tabs/deals.tsx`, `screens/listing/listing.tsx` (rental block + footer), `screens/chat/thread.tsx` (`booking` case), `screens/search/{results,filters}.tsx` (dates chip), `screens/reviews/review-deal.tsx`, `screens/deals/report-problem.tsx` (rental categories; the subject param readers are C0-5's), `locales/*/rentals.json` | navigation, API client, query keys, display helpers, sheet props of B3's components, pending action, analytics, errors, the tab badge sum (C0-5) |
| **B3 app owner** | B | under `apps/user-app/`: `screens/rentals/rental-calendar.tsx`, `components/rentals/{OwnerAnswerBar,ProposeChangeSheet,DeclineSheet,OnSiteSheet,ReturnSheet,BlockSheet,CalendarMonth}.tsx`, `lib/{rental-calendar,rental-return}.ts` + tests, `hooks/use-rental-calendar.ts`, `screens/my-listings/manage-sheet.tsx`, `lib/my-listings.ts` + test, `components/my-listings/**` (rental line), `locales/*/rentals-owner.json`; imports `DateRangeSheet` (B2's, placeholder from C0-5) | as B2 |

**Waves.** Wave A = A1, A2, A3. Wave B = B1, B2, B3 after wave A merges. If memory is short: A1 + A2, then A3; B2 +
B3, then B1. Each wave: lanes reviewed one by one, merged one by one, then the wave's suites once and a fix wave on
`develop`.

**Lane setup checklist (controller, per lane):**
1. `git worktree add .claude/worktrees/m14-<lane> -b lane/m14-<lane> develop`.
2. Copy the root `.env` into the worktree (never committed); API lanes set `TEST_DATABASE_URL` to
   `…/mpm_m14<lane>_test` and `TEST_REDIS_URL` to `redis://localhost:6381/<3|4|5>` (`redis-cli -p 6381 -n <n>
   flushdb` first).
3. API lanes: `docker exec mpm-postgres-1 createdb -U mpm mpm_m14<lane>_test`.
4. In the worktree: `pnpm install --offline`, `pnpm --filter @mpm/shared-types build`, API lanes
   `pnpm --filter @mpm/api db:migrate:test`.
5. Hand the implementer the worktree path, the lane's tasks, its ownership row and the base commit.
6. After the merge: `git worktree remove`, `dropdb` the lane DB, delete the lane branch.

---

## File map

```
packages/shared-types/src/index.ts                         constants, transitions, pure fns, settings, views (C0-1)
apps/api/src/lib/m14-shared.test.ts                         pure fn tests (C0-1)
apps/api/src/db/schema.ts, infra/migrations/0016_m14_rental_bookings.sql, 0017_m14_checks.sql (+ meta)   (C0-2)
apps/api/src/lib/ist.ts (+ ist.test.ts), __tests__/_helpers/test-rentals.ts (+ test-listings/users/businesses hooks) (C0-2)
apps/api/src/services/rentals/{capacity,locks,status-sync,listing-hooks}.ts,
  services/listings/{listing-lifecycle,listing-write,listing-admin,listing-jobs,listing-gate}.service.ts,
  services/deals/holds.ts (afterListingStatusWrite)                                                       (C0-3b)
apps/api/src/services/rentals/{booking-write,system-exits,estimate,thread-agreement}.ts,
  services/reviews/subject.ts, services/chat/{thread-lines,open-thread}.ts, services/chat/private-photo.ts,
  services/notifications/notify.ts, services/admin/user-status.service.ts,
  services/admin/business-admin.service.ts (revokeGst), services/chat/block.service.ts  (C0-3a)
apps/api/src/routes/{rentals,rental-calendar,badges}.ts, routes/admin/rentals.ts, app.ts, jobs/index.ts,
  lib/sentry.ts, lib/group-limit.ts, lane stub files, apps/admin/lib/{nav,status}.ts                       (C0-4)
apps/user-app/navigation/*, screens/rentals/* placeholders, components/rentals/* placeholders (final props),
  lib/{rentals-api,rental-display,notification-links,pending-action,sign-in-gate,analytics-events,query-keys,
  listing-page,error-reporting,m14-errors}.ts, hooks/useSocket.ts, screens/notifications/notifications.tsx,
  screens/my-listings/manage-sheet.tsx (retired actions only), locales/*                                  (C0-5)
lanes: see the ownership table
docs/PROJECT_STATUS.md, CLAUDE.md, apps/user-app/CLAUDE.md, apps/admin/CLAUDE.md, docs/product-scope.md, F2 / F6 / F4 spec notes (I-4)
```

---

# Batch C0 — Contracts (sequential, on `develop`)

### C0-1: Shared types and pure functions

**Files:** Modify `packages/shared-types/src/index.ts`, `apps/admin/lib/status.ts` (+ test if it lists statuses);
Create `apps/api/src/lib/m14-shared.test.ts`; compile fallout in `apps/api`, `apps/user-app`, `apps/admin`.

**Contents (§5.8, §6.1, §6.6, §7.1, §11, §16, §17):**
- `RENTAL_BOOKING_STATUSES = ['requested','countered','confirmed','on_rent','returned','completed','declined',
  'withdrawn','expired','cancelled','disputed']`; `OPEN_RENTAL_STATUSES = ['requested','countered']`;
  `ACTIVE_RENTAL_STATUSES = ['confirmed','on_rent','returned','disputed']`; `FINAL_RENTAL_STATUSES`.
  `RENTAL_BOOKING_ACTIONS = ['request','confirm','change','accept','decline','withdraw','expire','on_site','return',
  'confirm_return','auto_complete','cancel','problem','resolve_completed','resolve_cancelled','resume','admin_cancel',
  'system_decline','system_withdraw','system_cancel']`; `rentalBookingTransition(from: RentalBookingStatus | null,
  action: RentalBookingAction, side: 'renter' | 'owner' | 'system' | 'admin' | 'support', opts?: { disputedFrom?:
  RentalBookingStatus | null }): RentalBookingStatus | null` — exactly §6.1 (`change` from `requested` by owner →
  `countered`, from `countered` by renter → `requested`; `decline` owner on `requested`, renter on `countered`;
  `resume` → `disputedFrom`; `admin_cancel` from requested / countered / confirmed only; illegal → null).
- `RentalTurn = 'owner' | 'renter'`; `rentalYourTurn(b: { status; startDate; endDate; turn }, side: 'renter' |
  'owner', today: string): boolean` (§6.6); `rentalBookingActions(v: RentalBookingView, today: string):
  RentalBookingActionKey[]` (the buttons a client shows: by side, role `viewer` → `[]`, status, `today ≥ startDate − 1`
  for on site).
- `rentalEndDate(start: string, period: RentalPeriod, count: number): string` (§R1); `rentalCountLimits:
  Record<RentalPeriod, { min: 1; max: number }>` (hour 24, day 90, week 26, month 6); `operatorDays(period, count,
  monthDays): number`; `meetsRentalMinimum(terms: { minDuration: number | null; minDurationPeriod: RentalPeriod |
  null }, period, count): boolean` (§6.2); `rentalEstimate(terms: RentalTermsSnapshot, req: { period; count; machines;
  withOperator: boolean; ownerDelivers: boolean }): { days: number; rentPaise: number; operatorPaise: number;
  transportPaise: number; totalPaise: number } | null` (null when the period isn't priced; integers only; rent =
  rate × count × machines; operator only when `terms.operator === 'optional' && withOperator`; transport only when
  `ownerDelivers` and a charge is set, × 2 × machines); `resolveRentalChoices(terms, req): { withOperator; ownerDelivers }`
  (forces per R1: `included` / `mandatory` → true; `not_available` / null → false; transport `owner_delivers` → true,
  `renter_picks_up` / null → false, `either` → the request's choice).
- `RentalTermsSnapshot` (rates, `shiftHours`, `monthDays`, `operator`, `operatorRateDayPaise`, `fuel`, `transport`,
  `transportChargePaise`, `depositPaise`, `minDuration`, `minDurationPeriod`, `serviceRadiusKm`).
- Reasons (§5.8): `RENTAL_DECLINE_REASONS`, `RENTAL_CANCEL_REASONS_RENTER`, `RENTAL_CANCEL_REASONS_OWNER`,
  `RENTAL_CANCEL_REASONS_SYSTEM` (incl. `owner_inactive`, `owner_gst`, `renter_inactive`), `RENTAL_FINAL_REASONS`,
  `RENTAL_BLOCK_REASONS = ['maintenance','booked_outside','other']`, `RENTAL_DISPUTE_CATEGORIES`,
  `RENTAL_EVENT_CODES` (§5.3).
- `RENTAL_LIMITS = { messageMax: 300, requestNoteMax: 500, notesMax: 500, damageNoteMax: 500, shortNoteMax: 300,
  siteAddressMax: 200, blockNoteMax: 200, blockRangeMaxDays: 366, photosMax: 3, hourMeterMax: 1_000_000,
  availabilityMaxDays: 92, availabilityDefaultDays: 30, freeOnMaxDays: 90, pageSize: 20, refStart: 700001 } as const`.
- **Listing transitions (§7.1):** remove `mark_rented` and `end_rental` from `LISTING_TRANSITIONS` and
  `SELLER_LISTING_ACTIONS` (or the seller action enum); add system `rent_out` (`live` → `rented`) and `rent_back`
  (`rented` → `live`); `pause`, `renew`, `mark_unavailable` gain `rented` in `from`; `mark_sold` gets `kinds: ['part',
  'machine']`.
- **Reviews:** `REVIEW_SUBJECTS = ['deal','rental']`; `REVIEW_FACETS` becomes `{ deal: { buyer: [matched_listing,
  communication, on_time], seller: [communication, payment, pickup] }, rental: { buyer: [matched_listing,
  communication, on_time], seller: [communication, payment, care] } }`; `ReviewFacet` gains `care`; `ReviewState` gains
  `subject: { kind: ReviewSubjectKind; id: string }` (keep `dealId: string | null` for compatibility).
- **Disputes:** `DisputeSubject = { kind: 'deal'; dealId } | { kind: 'rental'; rentalBookingId }`; admin dispute rows
  and detail gain `subject` and `rentalBookingRef`; resolve input `stockReturned` optional (required only for deals).
- **Chat:** `MESSAGE_KINDS` + `booking`; `SYSTEM_LINE_CODES` + the 12 `booking_*` codes (§5.8); `ThreadMessage` gains
  `booking: RentalBookingCardView | null`; `ThreadDetail.bookings: { id; status; confirmedAt: string | null }[]`.
- **Notifications:** `NOTIFICATION_CATEGORIES` + `rentals`; `NOTIFICATION_TYPES` − `booking_update` + the types of
  §11 (incl. `rental_booking_clash`); `notificationCategory` maps every `rental_booking_*` → `rentals`;
  `NotificationRow.rentalBookingId: string | null`.
- `APP_SETTINGS` + the 7 keys of §16 (defaults, ranges, labels, help); `validateSettings` cross-check
  `rental_open_limit_unverified ≤ rental_open_limit_verified`.
- `RENTAL_ERROR_CODES` = §17's codes.
- Views (key names fixed here): `RentalRequestInput { startDate; period; count; machines; withOperator?;
  ownerDelivers?; sitePincode; siteAddress?; note? }`; `RentalChangeInput { versionSeq; startDate; period; count;
  machines; withOperator?; ownerDelivers?; totalPaise? (owner only); message? }`; `RentalEstimateRequest =
  RentalRequestInput-like + listingId` minus site address / note; `RentalEstimateResult { endDate; days; rentPaise;
  operatorPaise; transportPaise; totalPaise; free: boolean; minimumMet: boolean; beyondServiceRadius: boolean | null;
  withOperator; ownerDelivers }`; `RentalVersionView { seq; proposedBy: 'renter' | 'owner'; startDate; endDate;
  period; count; machines; withOperator; ownerDelivers; estimatePaise; totalPaise; message; messageFlagged; createdAt }`;
  `RentalBookingView { id; ref; side: 'renter' | 'owner'; role; status; turn; listing: { id; title; thumbUrl: string
  | null; kind: 'machine_rental' }; counterpart: { businessId; tradeName; verified; city }; current: RentalVersionView;
  versions: RentalVersionView[]; changeCount; changesLeft; replyDueAt; agreedTotalPaise; finalAmountPaise;
  finalAmountReason; finalAmountNote; terms: RentalTermsSnapshot; site: { pincode; city; state; address: string |
  null; distanceKm: number | null /* owner only */; beyondServiceRadius: boolean | null }; onSite: { at; bySide;
  hourMeter; photoCount } | null; returned: { at; hourMeter; damageNote; photoCount } | null; autoCompleteAt;
  completedAt; completedHow; cancelled: { at; bySide; reason; note } | null; declineReason; notes: { paymentMethod;
  advancePaise; depositPaise; depositReturned; expectedOnSiteTime; text; textFlagged; updatedAt; version } ;
  timeline: { code; actorSide; at; values }[]; contact: ContactState; review: ReviewState | null; dispute: { id;
  status; outcome } | null; threadId; clashWith: { id; ref } | null; actions: RentalBookingActionKey[] }`;
  `RentalBookingCardView` (id, ref, status, turn, current version, listing title); `RentalBookingListRow { id; ref;
  side; status; yourTurn; listingTitle; thumbUrl; counterpartName; startDate; endDate; machines; totalPaise: number |
  null; updatedAt }`; `RentalBookingsPage { items; nextCursor; counts: { active; completed; cancelled }; yourTurn }`;
  `RentalAvailabilityDay { date; state: 'free' | 'partial' | 'full' }`; `RentalCalendarDay { date; out; free }`;
  `RentalCalendar { listingId; quantity; days: RentalCalendarDay[]; bookings: { id; ref; status; startDate; endDate;
  machines; renterName }[]; blocks: RentalBlockView[] }`; `RentalBlockView { id; startDate; endDate; machines; reason;
  note }`; `RentalBlockInput { startDate; endDate; machines; reason; note? }`; `AdminRentalBookingRow { id; ref;
  listing: { id; title }; renter: { businessId; name }; owner: { businessId; name }; startDate; endDate; machines;
  status; agreedTotalPaise; updatedAt }`; `AdminRentalBookingDetail` (the owner view's fields with the site address,
  plus `versions`, `events` with admin actors, `photos: { onSite: string[]; returned: string[] }` keys, `dispute`,
  `reviews`); `Badges.rentalsYourTurn: number`; `ListingOwnerView.bookingSummary` and
  `MyListingCard.rentalLine` (D14); `SearchFilters.rentalDates?: { from; to }`; `AdminBusinessDetail.rentalBookingCount:
  { asOwner; asRenter }`; `AdminListingDetail.rental: { bookings: AdminRentalBookingRow[]; blocks: RentalBlockView[] }
  | null`; `RentalBookingsQuery { tab; side; listingId?; cursor? }`.
- App navigation params (C0-5 uses them): `RequestBooking { listingId; prefill?: Partial<RentalRequestInput>;
  change?: { bookingId: string; versionSeq: number } }` (change mode sends `POST /rental-bookings/:id/change`).

- [ ] **Step 1: Failing tests** (`m14-shared.test.ts`): `rentalBookingTransition` — every row of §6.1 legal; illegal
  samples null (renter `confirm`, owner `accept`, `on_site` from `requested`, `return` by renter, `admin_cancel` from
  `on_rent`, `change` from `confirmed`); `resume` returns `disputedFrom`. `rentalEndDate('2026-11-21','day',3)` →
  `'2026-11-23'`, week 2 → `'2026-12-04'`, month 1 → `'2026-12-20'`, hour 6 → same day. `rentalEstimate` with day rate
  ₹9,600 (960000 paise), 3 days, 2 machines, operator `optional` at ₹800 / day chosen, transport ₹2,500 owner
  delivers → rent 5 760 000, operator 480 000, transport 1 000 000, total 7 240 000; week 1 operator days 6; month 1
  with `monthDays` 26 operator days 26; a period without a rate → null; `operator: 'included'` adds no operator money.
  `meetsRentalMinimum`: min 4 hours vs hour 3 ✗ / hour 4 ✓ / day 1 ✓; min 2 days vs hour 24 ✗ / day 1 ✗ / week 1 ✓.
  `rentalYourTurn` for each §6.6 case. `notificationCategory('rental_booking_clash') === 'rentals'`. Listing transitions:
  `mark_rented` absent; `pause` from `rented` → `paused`; `mark_sold` refused for `machine_rental`. `validateSettings`
  refuses unverified > verified.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; `pnpm --filter @mpm/shared-types build`; make every consumer compile:
  the F2 seller-action route enum and `GATED_ACTIONS` / `GateAction 'end_rental'` drop the retired actions
  (`listing-gate.service.ts:100-115`); retired-action tests deleted or rewritten (`src/lib/listing-shared.test.ts:
  245-308`, `__tests__/listings-lifecycle.test.ts:49-188` → keep the cases for other actions, `__tests__/
  listings-publish.test.ts:404`, app `lib/my-listings.test.ts:75-101`); app `lib/my-listings.ts` and
  `screens/my-listings/manage-sheet.tsx:51-52` stop offering `mark_rented` / `end_rental` (and `mark_sold` on rentals);
  the three `listing.json` locales lose the retired keys (≈ l.413–434); admin `lib/listings-api.ts:275` history labels
  **kept**; review code reads `REVIEW_FACETS.deal[side]` (A3 generalises); `booking_update` texts removed from
  `services/notifications/text/{en,hi,gu}.ts` and placeholder texts added for the new types (A3-3 replaces);
  `f8-shared.test.ts:92`'s `booking_update` pin moved to the new types; app `CATEGORY_ICONS.rentals`; admin
  `conversations-api.ts` `SYSTEM_LINE_LABELS` gains the `booking_*` labels; admin `lib/status.ts` tones (requested /
  countered amber, confirmed / on_rent / returned brand, completed green, declined / withdrawn / expired / cancelled
  gray, disputed red). **Step 4:** PASS; `pnpm typecheck`. **Step 5: Stage.**

### C0-2: Schema, migrations, IST helper, fixtures

**Files:** Modify `apps/api/src/db/schema.ts`; Create `infra/migrations/0016_m14_rental_bookings.sql`,
`0017_m14_checks.sql` (+ meta), `apps/api/src/lib/ist.ts` + `ist.test.ts`,
`apps/api/__tests__/_helpers/test-rentals.ts`; Modify the existing IST helpers to re-export (D11) and
`__tests__/_helpers/{test-listings,test-users,test-businesses}.ts` to call `deleteM14Rows` before `deleteF6Rows`; Test
`apps/api/__tests__/m14-schema.test.ts`.

**Contents (§5.1–§5.6):** enums `rental_booking_status`, `rental_booking_turn`, `rental_completed_how`,
`rental_actor_side` (`renter`, `owner`, `system`, `admin`), `rental_block_reason`; `message_kind` + `booking`,
`notification_category` + `rentals`. Tables exactly §5.1–§5.4 (Drizzle names `rentalBookings`,
`rentalBookingVersions`, `rentalBookingEvents`, `rentalBlocks`; `site_point` `geography(Point,4326)`;
`unit_snapshot` → name it `terms_snapshot` jsonb typed `RentalTermsSnapshot`; add `not_started_reminded_at` next to
the other reminder stamps; **`current_version_id` is nullable** (the booking is inserted first, then version 1, then
the pointer is set: the two tables reference each other)). Changed: `deal_reviews.deal_id` nullable +
`rental_booking_id` + `r_care`; `deal_disputes.deal_id` nullable + `rental_booking_id`, and the Drizzle index
`deal_disputes_one_open` (`schema.ts:1206`) split **in `schema.ts`** into `deal_disputes_one_open_deal` /
`deal_disputes_one_open_rental`; `chat_messages.rental_booking_id`; `notifications.rental_booking_id`. **Compile
fallout of the two nullable `deal_id`s** (≈ 15 typed reads in `services/reviews/*`, `services/deals/{dispute.service,
deal-admin.service,deal-read.service,deal-view}.ts`, `services/chat/admin-read.service.ts`): C0-2 makes them compile
with the narrowest change (a non-null assertion where only deal rows can reach today, marked `// M14: A3 generalises`)
and runs the API typecheck; A3 replaces them with the subject helper. Indexes in `schema.ts` (§5.1; partial ones with
`.where(sql\`…\`)` comparing **text** for new values never needed here: statuses are a new enum created in the same
migration, which is fine — only `booking` / `rentals` added to **existing** enums are the trap). 0017: CHECKs of §5.1,
§5.4, `deal_reviews_subject_one` / `deal_disputes_subject_one` (`num_nonnulls(deal_id, rental_booking_id) = 1`),
`deal_reviews_shape` rewritten per subject × side (drop + add), `deal_reviews_rental_side_uq` and
`deal_disputes_one_open` split into per-deal and per-booking partial uniques, `chat_messages_shape` rewritten with
`CASE "kind"::text … WHEN 'booking' THEN rental_booking_id IS NOT NULL AND offer_id IS NULL AND deal_id IS NULL`,
`ALTER SEQUENCE rental_bookings_ref_seq RESTART WITH 700001`.

**Helpers (`test-rentals.ts`):** `insertTestRentalListing(o: { businessId; userId; quantity?: number; status?;
rates?: Partial<RentalRates>; operator?; operatorRateDayPaise?; transport?; transportChargePaise?; minDuration?;
minDurationPeriod?; serviceRadiusKm?; point? }): Promise<{ listingId }>` (a `machine_rental` with `listing_machines`
and `listing_rentals`); `insertTestBooking(o: { listingId; renterBusinessId; ownerBusinessId; userId; threadId?;
status?; startDate; endDate?; period?; count?; machines?; totalPaise?; onSiteAt?; confirmedAt? })` (also version 1 and
the thread when absent); `insertTestBlock(o: { listingId; userId; startDate; endDate; machines?; reason? })`;
`countM14Rows(conn)`; `deleteM14Rows(conn, { businessIds; listingIds?; bookingIds? })` in FK order (notification
deliveries + notifications with those booking ids, reviews / disputes by booking id, chat messages with a booking id,
events, **`UPDATE rental_bookings SET current_version_id = NULL`**, versions, bookings, blocks of the listings and of
every listing of the businesses).

`lib/ist.ts` per D11.

- [ ] **Step 1: Failing tests** (`m14-schema.test.ts`, `ist.test.ts`): a review with both or neither subject refused;
  a rental review with `r_pickup` set refused, with `r_care` accepted; second open dispute per booking refused; a
  `booking` message without `rental_booking_id` refused; first booking `ref` ≥ 700001; `end_date < start_date`
  refused; `advance_paise > agreed_total_paise` refused; 4 photo keys refused; existing F6 deal review insert still
  passes the rewritten CHECK; `deleteM14Rows` leaves `countM14Rows` all 0 and `deleteTestBusinesses` then succeeds.
  `istToday(new Date('2026-11-20T19:00:00Z'))` → `'2026-11-21'`; `istToday(new Date('2026-11-20T18:29:00Z'))` →
  `'2026-11-20'`; `addDays('2026-11-30', 1)` → `'2026-12-01'`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; `db:generate`; `drizzle-kit generate --custom` for 0017; `db:migrate`;
  `db:migrate:test` (the run applies 0016 + 0017 in one transaction: proves the enum-literal rule). **Step 4:** PASS;
  `f6-schema.test.ts` and `f8-schema.test.ts` still pass. **Step 5: Stage.**

### C0-3a: Booking write helpers, locks, thread, notify, system exits, subject

**Follows:** F6 `deal.service.ts` recipe (lines 39–49: `updateDeal`, `recordEvent`, `dealLine`, `notifyDealSide`,
`afterDealChange`), `chat/thread-lines.ts`, `chat/open-thread.ts`, `admin/user-status.service.ts`
(`closeChainsForInactiveOwner`).

**Files:** Create `services/rentals/{locks,booking-write,system-exits,estimate,thread-agreement}.ts`,
`services/reviews/subject.ts`; Modify `services/chat/{thread-lines,open-thread,private-photo}.ts`,
`services/notifications/notify.ts` (+ `notification-read.service.ts` row mapping), `services/notifications/text/
types.ts` (`TextParams` + `bookingRef`, `dates`), `services/admin/user-status.service.ts`,
`services/admin/business-admin.service.ts` (`revokeGst`), `services/chat/block.service.ts` (`blockFromThread`); Test
`apps/api/__tests__/m14-write-helpers.test.ts`.

**Interfaces (final):**
- `locks.ts`: `lockListingForRental(tx, listingId): Promise<ListingRow>` (`FOR UPDATE`, kind check → `404
  LISTING_NOT_FOUND`); `lockRenterBusiness(tx, businessId)` (`FOR NO KEY UPDATE`); `lockRentalBooking(tx, id, opts?:
  { skipLocked?: boolean }): Promise<RentalBookingRow | null>` (always `FOR NO KEY UPDATE`, `SKIP LOCKED` for jobs).
- `writeBookingStatus(tx, b: RentalBookingRow, action: RentalBookingAction, actor: { side: RentalActorSide; userId?:
  string; adminId?: string }, patch?: Partial<RentalBookingColumns>, opts?: { event?: { code: RentalEventCode;
  values?: Record<string, string | number | boolean | null> }; line?: { code: SystemLineCode; values? }; notify?:
  BookingNotify[] }): Promise<RentalBookingRow>` — checks `rentalBookingTransition` (→ `409
  RENTAL_TRANSITION_NOT_ALLOWED`), writes status + patch + `version + 1` + `updated_at`, the event, the system line,
  the notifications, queues `rental:updated` (D12), calls `recomputeTurns(tx, threadId)`. Every status change in every
  lane goes through it.
- `recordBookingEvent(tx, bookingId, code, actor, values?)`, `bookingLine(tx, threadId, code, values, actorSide)`,
  `notifyBooking(tx, b, n: BookingNotify)` where `BookingNotify = { to: 'renter' | 'owner' | 'both'; type:
  NotificationType; dedupeKey?: string }` (resolves members — callers pick the side; destination `{ rentalBookingId,
  threadId }`). **`notifyBooking` builds the stored params itself from the booking row** — `{ bookingRef, listingId,
  startDate, endDate, businessId }` (the counterpart of the recipient) — so A1 / A2 senders pass no params and A3's
  `render.ts` resolves the listing title, business name and `dates` (IST short range) from them; `TextParams` gains
  `bookingRef` and `dates`.
- `openOrGetThread(tx, user, listingId, opts?: { skipDailyCap?: boolean })` (a 4th argument; D9);
  `insertCardMessage(tx, threadId, card)` keeps its card object and gains `kind: 'booking'` + `rentalBookingId`
  (`senderSide`, `senderUserId` as today; offer / deal callers unchanged); `recomputeTurns` reads the thread's
  `requested` / `countered` bookings only (owner's turn / renter's turn; D10).
- `PhotoDestination` + `{ kind: 'rental'; bookingId; step: 'on_site' | 'return' | 'problem' }` (D8; limit 3, problem 5).
- `notify` input `destination.rentalBookingId`; the row view maps it.
- `threadAgreement(conn, threadId): Promise<{ kind: 'deal'; id: string } | { kind: 'rental'; id: string } | null>`
  (newest by agreed / confirmed time among deals and bookings with `confirmed_at` set) — **real body here**; A1-5
  switches the consent service to it.
- `estimate.ts`: `termsSnapshotOf(tx, listingId): Promise<RentalTermsSnapshot>`; `estimateFor(conn, listingId, req):
  Promise<RentalEstimateResult>` (shared `rentalEstimate` + `resolveRentalChoices` + `maxOutInRange` for `free` +
  `ST_Distance` from the listing point to the pincode centroid for `beyondServiceRadius`; never returns the distance).
- `system-exits.ts`: `exitBookingsForSuspendedBusiness(tx, businessId)` (as owner: open → `system_decline`
  `owner_inactive`; as renter: open → `system_withdraw` `renter_inactive`; active untouched),
  `exitBookingsForGstLoss(tx, businessId)` (open as owner → `system_decline` `owner_gst`),
  `exitBookingsForBlock(tx, businessA, businessB)` (open between them → `system_decline` `blocked`). Wired into
  `user-status.service.ts` next to `closeChainsForInactiveOwner`, `revokeGst`, and `blockFromThread`, each in the
  caller's transaction. **The exits take no listing lock** (declining / withdrawing an open request changes no
  capacity): they lock each booking → its thread, bookings in id order, after the caller's own locks (the suspension
  path already holds the user row and its own listings; a listing lock here would break its single
  `lockListingsInOrder` order).
- `services/reviews/subject.ts`: `ReviewSubjectRef = { kind: 'deal' | 'rental'; id: string }`; `subjectOf(row: {
  dealId: string | null; rentalBookingId: string | null }): ReviewSubjectRef`; `loadSubject(conn, ref): Promise<{ ref;
  title; displayRef: number; buyerBusinessId; sellerBusinessId; threadId; status; completedAt: Date | null } | null>`;
  `lockSubject(tx, ref)` (`lockDeal` or `lockRentalBooking` no-key-update); `subjectDestination(ref)` → `{ dealId }` or
  `{ rentalBookingId }`.

- [ ] **Step 1: Failing tests** (`m14-write-helpers.test.ts`): `writeBookingStatus` refuses an illegal action
  (`RENTAL_TRANSITION_NOT_ALLOWED`) and on a legal one writes status, `version + 1`, one event, one system line and the
  thread's turns; a booking card inserts with the new CHECK; suspending the owner's owner declines an open request
  (`owner_inactive`) and leaves a confirmed booking `confirmed`; suspending the renter withdraws; GST revoke declines
  open requests; a block declines open requests between the two businesses; `threadAgreement` returns null for a
  thread with only an open request and the booking once confirmed; `estimateFor` never includes a distance key and
  sets `beyondServiceRadius` for a site 230 km away with `serviceRadiusKm` 60.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; F6 suites touching thread lines, user status and
  blocks still pass (`chat-*.test.ts`, `account-status.test.ts`, `chat-block-report.test.ts`, `f6-seams.test.ts`,
  `chat-privacy.test.ts`). **Step 5: Stage.**

### C0-3b: Capacity, status sync, listing hooks (after C0-3a)

**Follows:** F6 `services/deals/{holds,locks}.ts` (`syncReservation`, `afterListingStatusWrite`), F2
`listing-lifecycle.service.ts` (`applySystemTransition`), `listing-jobs.service.ts` (expiry).

**Files:** Create `apps/api/src/services/rentals/{capacity,status-sync,listing-hooks,owner-summary}.ts`; Modify
`services/deals/holds.ts` (`afterListingStatusWrite` calls the sync for rentals), `services/listings/
{listing-lifecycle,listing-write,listing-admin,listing-jobs,listing-view,listing-read}.service.ts`; Test
`apps/api/__tests__/m14-capacity.test.ts`, `m14-listing-hooks.test.ts`.

**Interfaces (final; used by every lane):**
- `outByDaySql(listingId: string, from: string, to: string, opts?: { excludeBookingId?: string }): SQL` and
  `maxOutInRange(conn, listingId, from, to, opts?): Promise<number>` — §5.7 (`on_rent` / `disputed`-from-`on_rent`
  from `LEAST(start_date, on-site IST date)` to `GREATEST(end_date, IST_TODAY)`; blocks; checks `from` plus each start
  **effective** start inside the range (`LEAST(start_date, on-site IST date)` for bookings, `start_date` for blocks);
  a pure-SQL `generate_series` twin `maxOutInRangeSlow` used only by the test to prove equality).
- `freeToday(conn, listingId): Promise<number>`; `assertCapacity(tx, listing: { id; quantity: number }, range: {
  from; to }, machines: number, opts?: { excludeBookingId?: string }): Promise<void>` (throws `409
  RENTAL_DATES_TAKEN`; the caller must hold `lockListingForRental` — documented, proven by the race test).
- `clashWithFor(conn, bookingId): Promise<{ id: string; ref: number } | null>` (the overrun clash of §6.4 for one
  booking; used by A1-4's view and A2-3's job).
- `syncRentalStatus(tx, listing: ListingRow): Promise<'rent_out' | 'rent_back' | null>` (§7.1; calls
  `applySystemTransition(tx, listing, 'rent_out' | 'rent_back')` (it takes the **row**, lifecycle:159), which gains
  both actions in `SystemTransitionAction` and `LISTING_ONLY_ACTIONS`; `applySystemTransition` doesn't call
  `afterListingStatusWrite`, so no re-entry guard is needed).
- `owner-summary.ts`: `rentalOwnerSummary(conn, listingId)` → `ListingOwnerView.bookingSummary` (D14), called from
  `listing-view.service.ts`; `rentalCardLine(conn, listingIds)` → `MyListingCard.rentalLine` for `GET /listings/mine`
  (`listing-read.service.ts`).
- `listing-hooks.ts`: `assertNoActiveBookings(tx, listingId)` (`409 LISTING_HAS_OPEN_BOOKINGS`),
  `assertQuantityCoversBookings(tx, listingId, newQuantity)` (`409 RENTAL_QUANTITY_BOOKED`, today onward),
  `cancelBookingsForListingOff(tx, listingId, scope: 'open' | 'open_and_confirmed', reason: 'listing_removed')`
  (calls C0-3a's `writeBookingStatus` per booking in id order; notifies both).
- Wiring (§7.2): seller `remove` / `mark_unavailable` on a rental → `assertNoActiveBookings` then
  `cancelBookingsForListingOff('open')`; seller `patchListing` quantity decrease → `assertQuantityCoversBookings`;
  **any admin transition into `removed` or `rejected`** (remove, reject, ask for changes, photos removed; a listing
  that never went live has no bookings, so no `return_status` check is needed) →
  `cancelBookingsForListingOff('open_and_confirmed')` (each booking: lock booking → thread; the listing is already
  locked by the admin path); admin hide / pause / expire → nothing. `listing-jobs.service.ts` expiry skips `machine_rental` listings with an active booking
  (`NOT EXISTS`). Every capacity change and `afterListingStatusWrite` for `machine_rental` → `syncRentalStatus`.

- [ ] **Step 1: Failing tests.** `m14-capacity.test.ts`: `maxOutInRange` equals `maxOutInRangeSlow` over 20 random
  layouts of bookings and blocks; an `on_rent` booking past its end keeps today counted; an on-site-early booking counts
  from its on-site date; disputed-from-`returned` not counted; two concurrent `assertCapacity` + insert transactions
  (each locking the listing) for the last machine → one throws `RENTAL_DATES_TAKEN`. `m14-listing-hooks.test.ts`: a
  1-machine rental with an `on_rent` booking covering today → `syncRentalStatus` → `rented`; returned → `live`; pause
  then resume while all out → lands `rented` (via the gate + hook); admin hide then unhide while all out → `rented`;
  `back_to_review` from `rented` then approve → `rented`; seller remove with a confirmed booking → `409
  LISTING_HAS_OPEN_BOOKINGS`; with only a `requested` one → removed and the request `cancelled` (`listing_removed`);
  admin remove cancels `confirmed`, keeps `on_rent`; quantity 3 → 1 with 2 booked tomorrow → `409
  RENTAL_QUANTITY_BOOKED`; expiry job skips a rental with a confirmed booking and expires one without.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; F2 listing suites (`listings-*.test.ts`) still pass.
  **Step 5: Stage.**

### C0-4: Stubs, route stubs, RBAC, jobs, Sentry, settings UI hook, badges

**Files:** the stub files below; route files `routes/rentals.ts` (A1: estimate, request, every `/rental-bookings/*`
route **except** review), `routes/rental-calendar.ts` (A2), `routes/admin/rentals.ts` (A3), and the two rental review
routes stubbed **in `routes/reviews.ts`** (A3) — registered in `app.ts`, every stub route answering `501
NOT_IMPLEMENTED` with an `M14-STUB` marker; `jobs/index.ts`; `lib/sentry.ts`; `lib/group-limit.ts`;
`routes/badges.ts`; `apps/admin/lib/nav.ts` (`/rentals` roles `operations`, `support`) + its `nav.test.ts` pin;
admin `lib/listings-api.ts` `historyActionLabel` + `rent_out` ("On rent (calendar)") / `rent_back` ("Available again
(calendar)").

**Stubs (final signatures, in the file the owning lane keeps):** A1 `services/rentals/booking-read.service.ts`:
`countRentalsYourTurn(conn, businessId): Promise<number>` (badges); A2 `services/rentals/rental-jobs.ts`:
`runRentalBookingExpiry(app)`, `runRentalAutoComplete(app)`, `runRentalReminders(app)`, `runRentalStatusSync(app)`;
A3 `services/rentals/rental-disputes.ts`: `reportBookingProblem(app, user, bookingId, input: { category:
RentalDisputeCategory; description: string; photoKeys: string[] /* final keys: A1's route finalises them with step
'problem' */ }): Promise<{ bookingId: string }>` (A1's `/problem` route calls it, then rereads with
`getRentalBooking`); A3 `services/reviews/rental-review.service.ts`: `submitRentalReview(app, user, bookingId,
input)`, `getRentalReviewState(conn, user, bookingId)`. Lanes "Modify" these files.

**Jobs:** `rental-booking-expiry` 5 min, `rental-booking-auto-complete` 5 min, `rental-booking-reminders` 1 h,
`rental-status-sync` 15 min (§9). **Sentry:** redact `siteAddress`, `notesText`, `damageNote`, `message`, `note` in
rental routes. **Rate groups** per D6. **Badges:** `rentalsYourTurn` from the stub.

- [ ] **Step 1:** none beyond compile (registration). **Step 3:** Implement. **Step 4:** `pnpm typecheck`; API boots
  (`buildApp({ infra: false })` smoke in an existing test). **Step 5: Stage.**

### C0-5: App contracts

**Files (`apps/user-app`):** Modify `navigation/types.ts` + `navigation/root-navigator.tsx` (register `RequestBooking`
(params as in C0-1), `BookingRecord { bookingId: string }`, `RentalCalendar { listingId: string }`; the Deals tab
gains params `{ segment?: 'deals' | 'rentals'; listingId?: string }`; `ReviewDeal` and `ReportProblem` params become
`{ subject: 'deal' | 'rental'; id: string }` with **every reader and caller updated** (`review-deal.tsx:39`,
`report-problem.tsx:33`, `deal-record.tsx:190` and `:323`, `notification-links.ts:50`)); Create `lib/rentals-api.ts` (every route of §13.2 typed), `lib/rental-display.ts` +
test, `lib/m14-errors.ts` (error code → key), placeholder `screens/rentals/{request-booking,booking-record,
rental-calendar}.tsx`, placeholder `components/rentals/{OwnerAnswerBar,ProposeChangeSheet,DeclineSheet,OnSiteSheet,
ReturnSheet}.tsx` (B3) and `components/rentals/DateRangeSheet.tsx` (B2; props `{ visible; mode: 'single' | 'range';
value; busy?: Set<string>; onClose; onPick(v: { start: string; end?: string }) }`) with final props (below); Modify `lib/query-keys.ts` (`rentals.*`), `hooks/useSocket.ts`
(`rental:` prefix → invalidate `rentals.booking(id)`, `rentals.list`, `badges`), `lib/notification-links.ts`
(`rentalBookingId` → `BookingRecord`; the Deals tab badge at `:98` sums `dealsYourTurn + rentalsYourTurn`),
`screens/notifications/notifications.tsx` (`CATEGORY_ICONS.rentals`),
`lib/pending-action.ts` + `lib/sign-in-gate.ts` (`request_booking`), `lib/listing-page.ts` (`contactActions` for
`machine_rental` → `['request_booking', 'enquire']`), `lib/analytics-events.ts` (`RENTAL_EVENTS`),
`lib/error-reporting.ts` (redaction keys), locales `rentals.json` and `rentals-owner.json` (en / hi / gu, registered,
empty but parity-valid).

**Display helpers (`rental-display.ts`, tested):** `bookingStatusChip(status, side)` → `{ tone; key }`;
`periodLabelKey(period)`; `estimateLines(e: RentalEstimateResult | RentalVersionView)` → `{ key; paise }[]`;
`moneySteps(v: RentalBookingView)` → `{ estimate; agreed; final }` with a `changed` flag; `bookingActionsFor(v,
today)` (re-exports `rentalBookingActions`); `dateRangeLabel(start, end, lang)`.

**Sheet props (final, B3 implements, B2 imports):** `OwnerAnswerBar { view: RentalBookingView; onDone(): void }`;
`ProposeChangeSheet { view; visible; onClose; onSent(v: RentalBookingView) }`; `DeclineSheet { bookingId;
versionSeq; visible; onClose; onDone }`; `OnSiteSheet { view; visible; onClose; onDone }`; `ReturnSheet { view;
visible; onClose; onDone }`.

- [ ] **Step 1: Failing tests** (`rental-display.test.ts`): `moneySteps` marks `changed` when the final differs from
  agreed; `bookingStatusChip('countered','renter')` is the "your answer" tone; `estimateLines` omits zero parts.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; app typecheck; parity / audit / style audit.
  **Step 5: Stage.**

**C0 exit:** `pnpm typecheck`, `pnpm lint`; API, admin, app suites green one package at a time; after the full API
suite `countM14Rows` on `mpm_test` all 0; controller commits C0 and pushes.

---

# Wave A — API lanes (parallel: A1, A2, A3)

## Lane A1 — API bookings

### A1-1: Estimate and request

**Follows:** F6 `offers/offer.service.ts` (`makeOffer`: limits, thread open, card), F8 `request-input.ts` (limit
pre-checks, `onboardingForUser`).

**Files:** Create `services/rentals/{request-input,request.service}.ts`; Modify `routes/rentals.ts` (`POST
/rentals/estimate`, `POST /listings/:id/bookings`); Test `apps/api/__tests__/rental-requests.test.ts`. **Every A1
write route** (request, confirm, change, accept, decline, withdraw, on site, return, confirm return, cancel, notes,
problem) has `config: { idempotent: true }` and runs through `runIdempotent`, as F6's deal routes.

**Interfaces:** `parseRentalRequest(listing, terms, input: RentalRequestInput, today): ResolvedRequest` (§6.2 checks
in order: period offered, counts, machines, dates, minimum, pincode; returns resolved choices, end date, estimate);
`requestBooking(app, user, listingId, input): Promise<RentalBookingView>` — in one `runTx`: `onboardingForUser`;
`lockRenterBusiness`; open / daily limits (D7, settings); `lockListingForRental` (public statuses `live` / `rented`;
own listing → `409 OWN_LISTING`; owner GST → `403 RENTAL_NEEDS_GST`; block re-check → `403 BUSINESS_BLOCKED`); one open
per thread (`409 RENTAL_REQUEST_OPEN`); `assertCapacity` (refuse full dates); insert booking (`requested`, turn owner,
`reply_due_at`), version 1, thread (D9), card, event `requested`, line `booking_requested`, notify owner
`rental_booking_requested`, emits. `estimateRental(conn, input)` → `estimateFor`.

- [ ] **Step 1: Failing tests:** request on a 1-machine listing → `requested`, version 1 with server estimate, card
  message, owner notified, thread created without an enquiry card and despite the enquiry daily cap at its limit;
  period not priced → `400 RENTAL_PERIOD_NOT_OFFERED`; below minimum → `400 BELOW_MINIMUM`; start beyond
  `rental_advance_days` → `400 RENTAL_DATES_INVALID`; dates already fully confirmed → `409 RENTAL_DATES_TAKEN`; own
  listing → 409; owner without GST → `403 RENTAL_NEEDS_GST`; blocked pair → 403; 4th open request unverified → `409
  RENTAL_OPEN_LIMIT`; 6th of the day → `429 RENTAL_DAILY_LIMIT`; second open request in the same thread → `409
  RENTAL_REQUEST_OPEN`; viewer → 403; operator forced `included` ignores the client's false; estimate route as a guest
  returns no distance key.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A1-2: Proposals: confirm, change, accept, decline, withdraw

**Files:** Create `services/rentals/proposal.service.ts`; Modify `routes/rentals.ts`; Test
`apps/api/__tests__/rental-proposals.test.ts`.

**Interfaces:** `confirmBooking(app, user, id, { versionSeq })`, `proposeChange(app, user, id, input:
RentalChangeInput)`, `acceptChange(app, user, id, { versionSeq })`, `declineBooking(app, user, id, { versionSeq;
reason })`, `withdrawBooking(app, user, id)` — each: lock listing → booking → thread; party + side + role checks;
`versionSeq` = current `seq` else `409 RENTAL_BOOKING_STALE`; owner GST at confirm / accept / change; block re-check;
listing state per §7.2 (`409 LISTING_NOT_BOOKABLE` for confirm / accept on `pending_review` / `expired` / `hidden`);
`assertCapacity` (exclude self) on confirm, accept and change; change cap (`409 RENTAL_CHANGE_LIMIT`); owner change
total 0 … 10¹⁰ (renter version total = estimate); on confirm / accept: `agreed_total_paise`, `confirmed_at`,
`deal_count + 1`, `refreshed_at` bump on the listing, `syncRentalStatus`; notifications per §11.

- [ ] **Step 1: Failing tests:** owner confirm → `confirmed`, agreed = version total; owner change with its own total →
  `countered`, renter accept → `confirmed` at the owner's total; renter changed request → `requested`; 6th change →
  `409 RENTAL_CHANGE_LIMIT`; stale `versionSeq` → 409; renter confirm → `RENTAL_TRANSITION_NOT_ALLOWED`; **two
  concurrent confirms** of overlapping requests on a 1-machine listing (`Promise.all`) → one `confirmed`, one `409
  RENTAL_DATES_TAKEN`; confirm racing a seller `PATCH` quantity decrease (`Promise.all`) → never a confirmed booking
  above the new quantity; confirm while the listing is hidden
  → `409 LISTING_NOT_BOOKABLE`, while paused → allowed; withdraw from `countered` ok; viewer refused.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A1-3: Steps: on site, returned, confirm return, cancel, notes, photos, problem route

**Follows:** F6 `deals/deal-actions.ts`, `deal-cancel.ts`, notes in `deal.service.ts`.

**Files:** Create `services/rentals/{steps.service,notes.service,booking-photos}.ts`; Modify `routes/rentals.ts`; Test
`apps/api/__tests__/rental-steps.test.ts`.

**Interfaces:** `markOnSite(app, user, id, { hourMeter?: number; photoKeys?: string[] })` (either side; `today ≥
start − 1` else `409 RENTAL_TOO_EARLY`; no capacity check; `syncRentalStatus`); `markReturned(app, user, id, {
hourMeter?; finalAmountPaise; finalReason?; finalNote?; damageNote?; photoKeys? })` (owner; reason required when final
≠ agreed → `400 FINAL_REASON_REQUIRED`; hour meter ≥ start → `400 HOUR_METER_INVALID`; `auto_complete_at`;
`syncRentalStatus`); `confirmReturn(app, user, id)` (renter → `completed`, `renter_confirmed`); `cancelBooking(app,
user, id, { reason; note? })` (either side, `confirmed` only; reasons per side; `syncRentalStatus`); `editNotes(app,
user, id, patch & { version })` (statuses `confirmed` / `on_rent` / `returned`; advance ≤ agreed; scam flag; event
naming fields); `presignBookingPhoto(...)` (D8, steps `on_site` / `return` / `problem`); the `/problem` route
finalises its upload keys with step `problem` (≤ 5) **in the route**, as F6's `deals.ts:199-204`, calls A3's
`reportBookingProblem` with the final keys, deletes the finals if it throws, then rereads with `getRentalBooking`.

- [ ] **Step 1: Failing tests:** on site the day before start ok, two days before → 409; renter can mark on site;
  returned with a different final and no reason → 400, with a reason ok and `auto_complete_at` = now + 2 days;
  closing meter below opening → 400; confirm return → `completed`; owner can't confirm return; cancel from `on_rent`
  → 409; cancel `confirmed` frees capacity (a second request for the same dates can then be confirmed) and flips the
  listing back to `live` when it was `rented`; notes stale version → `409 RENTAL_BOOKING_STALE`; advance > agreed →
  400; a Devanagari phone number in notes is masked for the other side.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A1-4: Reads: list, detail, views, badge count

**Files:** Create `services/rentals/{booking-read.service,booking-view}.ts`; Modify `routes/rentals.ts`, the A1 stub
`countRentalsYourTurn`; Test `apps/api/__tests__/rental-reads.test.ts`.

**Interfaces:** `listRentalBookings(conn, user, q: { tab: 'active' | 'completed' | 'cancelled'; side: 'all' |
'renting' | 'renting_out'; cursor? }): Promise<RentalBookingsPage>` (keyset `(updated_at, id)`, sealed cursor, counts,
`yourTurn` via `rentalYourTurn` in SQL); `getRentalBooking(conn, user, id): Promise<RentalBookingView>` (404 for
non-parties; D4 builder; site address rules §8; owner `distanceKm` floored; photos as counts, URLs via `GET
/rental-bookings/:id/photos` (300 s signed, party only); `clashWith` from C0-3b's `clashWithFor`);
`countRentalsYourTurn(conn, businessId)` (replaces the C0-4 stub in the same file); the list accepts `listingId`
(owner side: one listing's bookings, for My listings "Bookings (n)").

- [ ] **Step 1: Failing tests:** a stranger and a third business get 404; the owner's view before confirmation has
  `site.address = null`; after confirmation it is masked until both share their numbers, then plain; a viewer member
  never sees it unmasked; the renter always sees their own address; list tabs and side filters put each status in the
  right tab; badges count owner-turn `requested` and renter-turn `countered` / `returned`; owner `distanceKm` is a
  whole number and the renter view has none.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A1-5: Thread and reveal generalisation

**Files:** Modify `services/consent/contact-consent.service.ts` (`latestDealId` → `threadAgreement`; `maybeReveal`
writes a booking event + `rental:updated` for a booking agreement; `contactState`; `shareContact`),
`services/chat/{message.service,inbox.service,thread.service}.ts` (booking card views batch-loaded; the inbox pill
counts active bookings like active deals; `ThreadDetail.bookings` built in `thread.service.ts:156`); Test `apps/api/__tests__/rental-reveal.test.ts`.

- [ ] **Step 1: Failing tests:** share-my-number in a thread with only an open request → `409 NO_DEAL_IN_THREAD`;
  after confirmation both ticks reveal the numbers and write `contact_shared` on the booking; still revealed after the
  booking is cancelled; the F6 deal reveal test still passes; a thread message list returns the booking card view;
  the inbox shows the "deal" pill for a thread with a confirmed booking.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; F6 `chat-*` and `consent*` suites still pass.
  **Step 5: Stage.**

**A1 exit:** lane test files and `pnpm --filter @mpm/api typecheck` green; review (focus: lock order on every write,
capacity under races, site-address privacy, `writeBookingStatus` used for every status change); controller commits on
`lane/m14-a1`.

## Lane A2 — API calendar, discovery, jobs

### A2-1: Availability, owner calendar, blocks

**Files:** Create `services/rentals/{availability.service,calendar.service,blocks.service}.ts`; Modify
`routes/rental-calendar.ts`; Test `apps/api/__tests__/rental-calendar.test.ts`.

**Interfaces:** `getAvailability(conn, listingId, q: { from?; to? }): Promise<RentalAvailabilityDay[]>` (public;
public listing only else 404; window ≤ 92 days; `full` when free 0, `partial` when 0 < free < quantity);
`getRentalCalendar(conn, user, listingId, q)` (owner members; bookings `confirmed` / `on_rent` / `returned` /
`disputed` + open requests flagged; blocks); `createBlock(app, user, listingId, input: RentalBlockInput)`,
`updateBlock(app, user, blockId, input)`, `deleteBlock(app, user, blockId)` (owner non-viewer; listing lock;
`assertCapacity` against bookings for create / widen; range ≤ 366; `syncRentalStatus`).

- [ ] **Step 1: Failing tests:** availability shows `full` on a day all machines are confirmed, `partial` on a
  3-machine listing with 1 out, never booking ids or names; a non-owner gets 404 on the calendar; a block over a fully
  confirmed day → `409 RENTAL_DATES_TAKEN`; a block covering today on a 1-machine listing → `rented`, deleting it →
  `live`; two concurrent block creates for the last machine → one `409 RENTAL_DATES_TAKEN` (block vs confirm races
  are I-1's: they need A1's code).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A2-2: Discovery "Free on"

**Files:** Modify `services/discovery/filters.ts`, `services/discovery/search.service.ts` (parse
`filters.rentalDates`; count path and facets use the same where), `services/discovery/ranking.ts` (`rentTier` :83:
with `rentalDates` set, a `rented` listing free on the range ranks in the available tier, spec §10); Test `apps/api/__tests__/rental-discovery.test.ts`.

**Rules (§10):** applies only to `machine_rental` rows; `from ≥ today`, `to − from ≤ 89` (`400 RENTAL_DATES_INVALID`);
`NOT EXISTS` over §5.7's check-points (from + booking / block starts in range) where `out ≥ quantity`; a `rented`
listing passes when free on the range and ranks with the available ones.

- [ ] **Step 1: Failing tests:** a 1-machine listing booked on day 2 of the range is dropped; a 2-machine listing with
  one booked stays; a block counts; a listing `rented` today but free next week passes a next-week range; the count
  endpoint agrees with the result total.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; discovery suites still pass. **Step 5: Stage.**

### A2-3: Jobs and overrun clash

**Follows:** F6 `deals/deal-jobs.ts` (candidates unlocked, per-row `runJobTx`, re-check), F8 `request-jobs.ts`.

**Files:** Modify `services/rentals/rental-jobs.ts` (replace the four C0-4 stubs), Create `services/rentals/clash.ts`;
claims use `lockRentalBooking(tx, id, { skipLocked: true })` (`FOR NO KEY UPDATE SKIP LOCKED`), listings
`FOR UPDATE SKIP LOCKED` in `runRentalStatusSync`, and a claimed booking's listing is locked **before** the booking
(re-read the booking under the listing lock); Test
`apps/api/__tests__/rental-jobs.test.ts`.

**Interfaces:** `runRentalBookingExpiry(app)` (§9: reply due or start passed → `expire`; both told);
`runRentalAutoComplete(app)` (`returned` and `auto_complete_at ≤ now()` → `auto_complete`; review prompts);
`runRentalReminders(app)` (starts tomorrow, due back today, overdue, not started; each stamps its own column: `start_reminded_at`, `due_reminded_at`, `overdue_reminded_at`,
`not_started_reminded_at`);
`runRentalStatusSync(app)` (candidates = rental listings in `live` / `rented` where `(status = 'rented') <>
(free today = 0)`; per listing lock + `syncRentalStatus`; then `detectClashes(tx, listingId)`, which uses C0-3b's `clashWithFor`); `detectClashes(tx,
listingId)` (an overdue `on_rent` booking and `out` today or tomorrow > quantity → `rental_booking_clash` to the owner,
deduped D13).

- [ ] **Step 1: Failing tests:** a request with `reply_due_at` in the past → `expired`; one whose `start_date` is
  yesterday (IST) → `expired`; a `returned` booking with `auto_complete_at` past → `completed` (`auto`); each reminder
  sent once across two runs; status sync: a booking starting today (rows inserted with `start_date = IST_TODAY`) flips
  a `live` listing to `rented`, and back after its end passes (move dates with `UPDATE`); overdue booking + a
  confirmed one starting tomorrow on a 1-machine listing → one `rental_booking_clash`, not two on a re-run; two
  concurrent runs of each job → each row once (`SKIP LOCKED`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

**A2 exit:** lane tests and typecheck green; review (focus: every capacity writer locks the listing, IST dates in
jobs, discovery query plan uses the partial index — `EXPLAIN` in the review); controller commits on `lane/m14-a2`.

## Lane A3 — API reviews, disputes, notifications, admin

### A3-1: Reviews for both subjects

**Follows:** F6 `services/reviews/*` (§10 of the F6 spec).

**Files:** Modify `services/reviews/{review-state,review.service,review-jobs,review-moderation.service,
rental-review.service}.ts` (the last holds the C0-4 stubs `submitRentalReview`, `getRentalReviewState`),
`services/reports/admin-reports.service.ts` (`r_care`), `routes/reviews.ts` (`GET/POST /rental-bookings/:id/review`
stubbed there in C0-4); Test
`apps/api/__tests__/rental-reviews.test.ts`.

**Rules (§5.5a, R11):** every deal-only read goes through `subject.ts`; the public list and single review `LEFT JOIN`
deals and bookings and `coalesce` the title; reply and hide lock the subject; the publish job loads the subject for
`notifyPublished` (destination per subject); `REVIEW_FACETS[subject][side]`; `care` ↔ `r_care`; window and blind rules
unchanged (from `completed_at`).

- [ ] **Step 1: Failing tests:** a completed booking's renter review (matched / communication / on time) and owner
  review (communication / payment / care) both accepted; owner review with `pickup` → `400 REVIEW_ANSWERS_INVALID`;
  review before completion → `409 REVIEW_NOT_ELIGIBLE`; blind publish of a rental pair; the seller score counts the
  rental review **and** the public list returns it with the listing title; the owner replies once; a moderator hides
  it; the publish job notifies with `rentalBookingId`; the existing F6 review suite passes unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `reviews*.test.ts` all green. **Step 5: Stage.**

### A3-2: Disputes for both subjects

**Files:** Modify `services/deals/{dispute.service,deal-admin.service,deal-read.service,deal-view}.ts` (dispute
parts), `services/chat/admin-read.service.ts`, `routes/admin/disputes.ts`, `services/rentals/rental-disputes.ts` (replace the `reportBookingProblem` stub; returns `{
bookingId }`);
Test `apps/api/__tests__/rental-disputes.test.ts`.

**Interfaces:** `reportBookingProblem(app, user, bookingId, input)` (either side from `on_rent`; renter on `returned`
until `auto_complete_at`, owner on `returned` any time before completion; `RENTAL_DISPUTE_CATEGORIES`; photos ≤ 5 as
**final keys** (A1's route finalises them with step `problem`); `disputed_from`; `writeBookingStatus` `problem`; admin `dispute:new { disputeId,
rentalBookingId }`); resolve for a booking: `completed` (final amount, else agreed), `cancelled` (`support_closed`),
`resumed` (back to `disputed_from`; `returned` gets a fresh `auto_complete_at`) — the resolve **locks the listing
first** (`lockListingForRental`), then booking → dispute, and calls `syncRentalStatus` after; `stockReturned` sent for a booking →
`400`; queue / detail / count / business history `LEFT JOIN` both subjects; admin conversation read allowed from a
booking dispute.

- [ ] **Step 1: Failing tests:** problem on `on_rent` → `disputed`, capacity still counted; resolve `resumed` → back
  to `on_rent`; problem on `returned` then resolve `completed` → `completed` (`support`) with the final amount; resolve
  `cancelled` touches no listing quantity; the queue lists a booking dispute with its ref, the count includes it, the
  conversation read from it is allowed and audit-logged; `stockReturned` on a booking → 400; the F6 dispute suite
  passes unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A3-3: Notification texts and push tag

**Files:** Modify `services/notifications/text/{types,en,hi,gu}.ts`, `services/notifications/render.ts`,
`services/notifications/push-sender.ts`; Test `apps/api/__tests__/rental-notifications.test.ts`.

**Texts (§11):** English (title / body) — requested: "New booking request" / "{business} wants {listing}, {dates}";
changed: "Booking change proposed" / "{business} proposed new terms for {listing}"; confirmed: "Booking confirmed" /
"{listing}, {dates}"; declined: "Booking declined" / "{listing}, {dates}"; withdrawn: "Request withdrawn" / "{business}
withdrew the request for {listing}"; expired: "Booking request expired" / "No answer in time for {listing}"; cancelled:
"Booking cancelled" / "{listing}, {dates}"; on site: "Machine on site" / "{listing} is on site"; returned: "Machine
returned" / "Check the final amount for {listing}"; completed: "Rental completed" / "Rate {business}"; starts tomorrow:
"Booking starts tomorrow" / "{listing}, {dates}"; due back: "Due back today" / "{listing}"; overdue: "Still on rent" /
"Mark {listing} returned when it's back"; not started: "Did it start?" / "Mark {listing} on site, or cancel the
booking"; clash: "Booking clash" / "{listing} is still out and #{ref} starts soon"; problem: "Problem reported" /
"On booking #{ref}"; dispute resolved: "Booking problem resolved" / "On booking #{ref}". Hindi and Gujarati of the same
lines. Params: `business` (trade name), `listing` (masked title), `dates` (IST short range), `ref`; **no amounts, no
message text**. Push tag `rental:<bookingId>` and data `{ type, rentalBookingId }`.

- [ ] **Step 1: Failing tests:** every new type renders in en / hi / gu without `{…}` leftovers; a phone number planted
  in the listing title and the renter's trade name never appears in rendered text; push tag for a booking type is
  `rental:<id>`; no rendered text contains `₹`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### A3-4: Admin API

**Follows:** F8 `services/part-requests/admin.service.ts`, F6 `deal-admin.service.ts`.

**Files:** Create `services/rentals/{admin.service,admin-view}.ts`; Modify `routes/admin/rentals.ts`,
`services/admin/business-admin.service.ts` (`rentalBookingCount`), `services/listings/listing-admin.service.ts`
(`adminListingDetail` :205 fills `AdminListingDetail.rental`: bookings and blocks); Test `apps/api/__tests__/rental-admin.test.ts`.

**Interfaces:** `listAdminRentalBookings(conn, q: { status?; from?; to?; businessId?; listingId?; q?; page; pageSize:
25 | 50 | 100 })`, `getAdminRentalBooking(conn, id)` (site address, versions, events, photo URLs 300 s, dispute,
reviews), `adminCancelBooking(app, admin, id, { reason })` (`requested` / `countered` / `confirmed` only else `409
RENTAL_TRANSITION_NOT_ALLOWED`; locks the listing first (`lockListingForRental`), then the booking → thread;
`writeBookingStatus` `admin_cancel`; `syncRentalStatus`; both told; audit `rental_booking.cancel` with
before / after).

- [ ] **Step 1: Failing tests:** `operations` and `support` read; `moderator` gets 403; filters by status, business,
  listing and date; admin cancel of `confirmed` → `cancelled` (`admin`), audit row, both notified, capacity freed;
  admin cancel of `on_rent` → 409; business detail counts as owner and as renter.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

**A3 exit:** lane tests and typecheck green; review (focus: no F6 reader left assuming `deal_id`, admin RBAC and audit,
no amounts in pushes); controller commits on `lane/m14-a3`.

## Wave A merge (controller)

- [ ] Merge `lane/m14-a1`, `a2`, `a3` one at a time; `grep -rn "M14-STUB" apps/api` lists only wave B's (none expected
  in the API); `pnpm --filter @mpm/api typecheck`; full API suite once; `countM14Rows` all 0; fix wave on `develop`;
  commit; push. Lane cleanup.

---

# Wave B — App and admin lanes (parallel: B1, B2, B3)

## Lane B1 — Admin

### B1-1: Rental bookings list and detail

**Files:** Create `apps/admin/app/(dashboard)/rentals/page.tsx` (replaces the placeholder), `rentals/[id]/page.tsx`,
`components/rentals/{rentals-table,rental-detail,cancel-booking-dialog}.tsx`, `lib/rentals-api.ts` + test.

**Rules (§15):** table columns ref, listing, renter, owner, dates, machines, status (`lib/status.ts` tones), agreed
total, updated; filters status, dates, business, listing, ref search in the URL (`use-url-state`); live refresh on
`rental:updated` (`use-live-refresh`); detail: terms snapshot, versions table, timeline, notes, hour meters, photos in
`image-lightbox`, site, contact state, dispute link, reviews; Cancel booking (danger, reason ≥ `ADMIN_REASON_MIN`) only
when status is requested / countered / confirmed.

- [ ] **Step 1: Failing tests:** `adminRentalsQuery(filters)` drops empty filters and encodes dates; the cancel dialog
  refuses a short reason and posts `{ reason }`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; lint; style
  audit. **Step 5: Stage.**

### B1-2: Disputes subject, business and listing detail, settings section

**Files:** Modify `app/(dashboard)/disputes/**`, `components/disputes/**`, `lib/disputes-api.ts` (subject column and
link; resolve dialog hides "Did the goods go back?" for bookings and explains the three outcomes), `components/
businesses/business-detail.tsx` ("Rental bookings (n)" as owner / renter → `/rentals?businessId=`),
`app/(dashboard)/listings/[id]/**` (bookings and blocks block for rentals), `components/settings/
marketplace-settings-form.tsx` (section "Rentals" for `rental_*` keys, excluded from "Listings").

- [ ] **Step 1:** none beyond the resolve dialog: a booking dispute's resolve body has no `stockReturned`. **Step 2:**
  FAIL. **Step 3:** Implement. **Step 4:** PASS; typecheck, lint, style audit; `marketplace-settings-form.test.tsx`
  still passes. **Step 5: Stage.**

**B1 exit:** `pnpm --filter admin test`, lint, typecheck; review; controller commits on `lane/m14-b1`.

## Lane B2 — App renter and Booking record

### B2-1: Request form logic and dates

**Files:** Create `apps/user-app/lib/rental-request-form.ts` + test, `lib/rental-dates.ts` + test.

**Interfaces:** `rentalRequestSchema(t, terms: RentalTermsSnapshot, quantity: number)` (Yup mirror of §6.2: period
priced, count limits, machines ≤ quantity, pincode 6 digits, address ≤ 200, note ≤ 500); `toRentalRequestInput(values)`;
`defaultPeriod(terms)` (day if priced, else the first priced of hour / week / month); `periodsOffered(terms)`;
`rangeFromStart(start, period, count)` (calls shared `rentalEndDate`); `busyDates(days: RentalAvailabilityDay[]):
Set<string>` (full days); `rangeHasFullDay(start, end, busy)`.

- [ ] **Step 1: Failing tests:** schema refuses an unpriced period, 0 machines, more machines than quantity, a 5-digit
  pincode; `defaultPeriod` picks day when priced; `rangeHasFullDay` true when a full day is inside the range, false at
  the edge just outside. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Stage.**

### B2-2: Listing page rental block and Request booking screen

**Files:** Modify `screens/listing/listing.tsx` (rental: rates block, terms, `AvailabilityStrip` (30 days), footer
**Request booking** primary + Enquire; owner: **Calendar** and **Bookings**; guest → sign-in sheet with pending
`request_booking`), `screens/rentals/request-booking.tsx`; Create `components/rentals/{AvailabilityStrip,EstimateCard,
DateRangeSheet}.tsx`; `locales/*/rentals.json`.

**Rules (§14.1, mockup "Rental listing" and "Booking request"):** start date via `DateRangeSheet` (single-date mode,
full days greyed); Charged by `SegmentedControl` of offered periods; count and machines steppers (machines only when
quantity > 1); operator / transport chips only when offered; site pincode with "Use my business location"; optional
address; note; `EstimateCard` from `POST /rentals/estimate` (debounced 400 ms) with lines rent / operator / transport,
"diesel by you" etc. from terms, warnings (beyond the owner's area, dates full, minimum); Send → `POST
/listings/:id/bookings` with an `Idempotency-Key` → `BookingRecord`. Analytics `rental_request_started` /
`rental_request_sent`.

- [ ] **Step 1:** none (screen wiring; logic tested in B2-1). **Step 3:** Implement. **Step 4:** typecheck; parity /
  audit / style audit. **Step 5: Stage.**

### B2-3: Booking record, thread card, Deals tab Rentals

**Files:** Modify `screens/rentals/booking-record.tsx`, `screens/chat/thread.tsx` (`case 'booking'` → `BookingCard`,
contact banner rule §8), `screens/tabs/deals.tsx` (D15); Create `components/rentals/{BookingCard,BookingRow,
BookingTimeline,BookingMoney,BookingNotesSheet,RenterAnswerBar,CancelBookingSheet}.tsx`, `hooks/{use-rental-booking,
use-rental-bookings}.ts`.

**Rules (§14.1, mockup "Booking updates"):** header (dates, machines, operator, status chip); the open proposal card
with the reader's actions — renter `RenterAnswerBar` (Accept / Change → `RequestBooking { prefill }` in change mode /
Decline / Withdraw), owner `OwnerAnswerBar` (B3's component); `BookingMoney` (estimate → agreed → final with reason);
timeline; notes sheet (payment method, advance, deposit, deposit returned, expected time, text) with `version`;
contact block (F6's component); on site / returned sections with hour meters and photos (300 s URLs); site; review
card → `ReviewDeal { subject: 'rental', id }`; Report a problem → `ReportProblem { subject: 'rental', id }`; Cancel
(`CancelBookingSheet`, reasons by side); Message → thread. Owner actions open B3's sheets. `clashWith` shows a
warning notice. Deals tab: `SegmentedControl` Deals / Rentals; Rentals list with tabs and side chips; badge sums.

- [ ] **Step 1:** none (wiring; `rental-display` tested in C0-5). **Step 3:** Implement. **Step 4:** typecheck; parity /
  audit / style audit. **Step 5: Stage.**

### B2-4: Search dates, reviews and problem subject

**Files:** Modify `screens/search/{results,filters}.tsx` (a **Dates** chip on rental results → `DateRangeSheet` range
mode → `filters.rentalDates`; "{n} machines free on your dates"), `screens/reviews/review-deal.tsx` (subject param;
rental facet labels incl. "Care of the machine"), `screens/deals/report-problem.tsx` (subject; rental categories).

- [ ] **Step 1: Failing test:** `lib/search-request.ts` (`rentalsOnly` :38) gains `withRentalDates(req, range)`, which sets `filters.rentalDates` only when the kinds are rentals. **Step 2:**
  FAIL. **Step 3:** Implement. **Step 4:** PASS; typecheck; parity / audit / style audit. **Step 5: Stage.**

**B2 exit:** app suite and typecheck green; review (focus: viewer sees no actions, no amounts in analytics, address
never shown to the owner before confirmation by the client either); controller commits on `lane/m14-b2`.

## Lane B3 — App owner

### B3-1: Owner answers and step sheets

**Files:** Modify the C0 placeholders `components/rentals/{OwnerAnswerBar,ProposeChangeSheet,DeclineSheet,OnSiteSheet,
ReturnSheet}.tsx`; Create `lib/rental-return.ts` + test; `locales/*/rentals-owner.json`.

**Rules:** `OwnerAnswerBar`: Confirm (confirm sheet with the total), Propose change, Decline; shows changes left and the
reply deadline. `ProposeChangeSheet`: dates, period, count, machines, options, **total** (prefilled with the server
estimate for the new terms; "% vs estimate"), message. `OnSiteSheet`: hour meter (mono), ≤ 3 photos. `ReturnSheet`:
closing hour meter, final amount (prefilled agreed), reason chips when changed, note, damage note, ≤ 3 photos.
**Interfaces:** `percentVsEstimate(total, estimate): number` (whole %, signed); `returnFormErrors(v: { finalPaise;
agreedPaise; reason; hourStart; hourEnd })`.

- [ ] **Step 1: Failing tests:** `percentVsEstimate(9000, 10000) === -10`; `returnFormErrors` requires a reason when
  final ≠ agreed and refuses an end meter below the start. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS;
  typecheck; parity / audit / style audit. **Step 5: Stage.**

### B3-2: Owner calendar and blocks

**Files:** Modify `screens/rentals/rental-calendar.tsx`; Create `components/rentals/{CalendarMonth,BlockSheet}.tsx`,
`lib/rental-calendar.ts` + test, `hooks/use-rental-calendar.ts`.

**Rules (§7.3):** month grid (swipe months, ≤ 92-day fetches) with per-day out / free (`3 of 5 out`), tap a day →
bookings and blocks on it; Add block (dates, machines, reason, note) and edit / delete; `409 RENTAL_DATES_TAKEN` shown
inline. **Interfaces:** `monthGrid(year, month, days: RentalCalendarDay[]): { date; inMonth; out; free; state }[][]`
(weeks start Monday).

- [ ] **Step 1: Failing tests:** `monthGrid(2026, 11, …)` starts on Monday 26 Oct with `inMonth: false` and has 5 or 6
  rows; a day with `free 0` has state `full`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; typecheck;
  parity / audit / style audit. **Step 5: Stage.**

### B3-3: My listings

**Files:** Modify `screens/my-listings/manage-sheet.tsx` (rentals: **Calendar**, **Bookings (n)** → Deals tab Rentals
filtered to the listing via the Deals tab params of C0-5), `lib/my-listings.ts` + test (rental line "On rent" /
"{out} of {q} out today" from `MyListingCard.rentalLine`), `components/my-listings/**`.

- [ ] **Step 1: Failing test:** `rentalLine({ quantity: 5, outToday: 3 })` → key `outOfToday` with `{ out: 3, q: 5 }`;
  `outToday === quantity` → `onRent`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; typecheck; parity /
  audit / style audit. **Step 5: Stage.**

**B3 exit:** app suite and typecheck green; review (focus: viewer can't reach owner actions, totals always integers in
paise, calendar month edges); controller commits on `lane/m14-b3`.

## Wave B merge (controller)

- [ ] Merge `lane/m14-b1`, `b2`, `b3` one at a time; `grep -rn "M14-STUB" apps` is empty; `pnpm typecheck`;
  `pnpm lint`; admin and app suites; allowlist merges resolved; fix wave; commit; push. Lane cleanup.

---

# Batch I — Integration and close-out (sequential, on `develop`)

### I-1: Core loop and races

**Files:** Create `apps/api/__tests__/m14-core-loop.test.ts`.

- [ ] **Step 1: Failing tests (cases no single lane could write):** renter requests 3 days on a 2-machine listing →
  owner proposes a change (+1 day, own total) → renter accepts → both share numbers (revealed) → second renter requests
  overlapping dates for 2 machines → refused `RENTAL_DATES_TAKEN`, for 1 → owner confirms → on start day both bookings
  on site → listing `rented` → first returned with a different final + reason → listing `live` → renter confirms →
  completed → both review (rental facets) → the owner's seller score and public list include it; the second booking
  overruns → a confirmed third booking starting tomorrow triggers one clash notice → returned → problem reported on
  `returned` → support resolves `resumed` → auto-complete job completes it. Races: owner pauses while a renter's
  confirm-accept is in flight; admin removes the listing while an owner confirms (`Promise.all`) → either confirmed
  then cancelled `listing_removed`, or refused — never a confirmed booking on a removed listing; a block create racing
  a confirm for the last machine on the same day → exactly one wins; the status job racing an on-site mark → the
  listing ends `rented`; suspension of the
  owner's owner during an open request → declined; every notification rendered in the loop has no phone number
  planted in the note / address / trade name and no `₹`; `countM14Rows` all 0 after cleanup.
- [ ] **Step 2:** run; fix in the owning files on `develop`. **Step 3:** `grep -rn "M14-STUB\|NOT_IMPLEMENTED"
  apps/api/src apps/user-app apps/admin` returns only F6's `OTP_NOT_IMPLEMENTED`. **Step 4:** PASS. **Step 5: Stage.**

### I-2: Full checks and builds

- [ ] One package at a time: `pnpm typecheck`, `pnpm lint`, `pnpm --filter @mpm/api test`, `pnpm --filter admin test`,
  `pnpm --filter user-app test`; `countM14Rows` on `mpm_test` all 0; `pnpm --filter admin build`; in `apps/user-app`:
  `CI=1 npx expo export --platform android` and `npx expo install --check`.
- [ ] Dev DB: `pnpm --filter @mpm/api db:migrate` (0016, 0017).

### I-3: Agent walk-through on the dev DB

- [ ] Scripted API walk-through (dev API with jobs on, `LISTING_MEDIA_OPTIONAL=true`): an owner (GST via the stub)
  lists a 2-machine rental (approved by the admin API); a renter (phone OTP) checks availability and the estimate,
  requests 3 days; the owner proposes a change; the renter accepts; both share numbers; a block for one machine on day
  2; a second request for 2 machines on day 2 → refused; on site → `rented` when both out; returned with a final
  amount; confirm; reviews; a booking problem → admin Disputes → resolve; admin Rental bookings list / detail / cancel
  of another confirmed booking; "Free on" search shows and hides the listing correctly; admin pages by page loads
  (`/rentals`, `/rentals/<id>`, `/disputes`, `/settings` 200). Delete all walk-through data afterwards (audit rows
  kept); row counts match the snapshot.

### I-4: Docs

- [ ] `docs/PROJECT_STATUS.md`: What's built (M14 row: tables, routes, jobs, app and admin screens), How to run (0016 /
  0017, no new env, no new native module), Open items (§23 + the device pass), Suggested build order (rentals done),
  session log line.
- [ ] `CLAUDE.md` (state machines: rental booking; the capacity rule and its lock; `syncRentalStatus`; `/rentals/*`,
  `/rental-bookings/*` route prefixes), `apps/user-app/CLAUDE.md` (rental screens, query keys, `rental:` socket prefix,
  pending action `request_booking`), `apps/admin/CLAUDE.md` (Rental bookings pages, Disputes subject, Settings
  section).
- [ ] `docs/product-scope.md` per §21 (M13 deal line, M14 statuses, M15 rental facets, M16 booking rows, AD5, the open
  question settled); F2 / F4 / F6 spec notes per §21; spec and this plan marked built.
- [ ] Controller commits and pushes `develop` (milestone).

### I-5: Owner checklist (not for an implementer subagent)

- Device pass: guest → listing → Request booking → sign in → request; owner confirm / change on a second device; on
  site with photos; returned; review; Deals tab Rentals; calendar blocks; en / hi / gu.
- Hindi and Gujarati of every new string checked by a native speaker.
- Admin pages in a browser (Rental bookings list / detail / cancel, Disputes with a booking, Settings "Rentals").
- Client: 24 h reply window, 2 days to complete, unverified renters allowed (§23); D7 deposits stay recorded-only.

---

## Coverage (spec section → tasks)

| Spec | Tasks |
|---|---|
| §1–§3 Why, goals, approach A | Goals 1: A1-1, B2-1, B2-2 · 2: A1-2, B3-1 · 3: C0-3b, A2-1, B3-2 · 4: A1-3, A1-4, A3-1, A3-2, B2-3 · 5: C0-3b, A2-2, A2-3, B2-4 · 6: A3-4, B1 |
| §4 Rulings | R1 C0-1, A1-1 · R2 C0-1, C0-3a · R3 A1-2 · R4 A1-2, A2-3 · R5 C0-3b, A1-2, A2-1 · R6 C0-1, A1-3 · R7 C0-1, C0-3b · R8 A1-1, C0-3a · R9 A1-4, A1-5 · R10 A1-3 · R11 A3-1 · R12 A3-2 · R13 A2-1, A2-2, B2-2, B2-4 · R14 A3-3 · R15 A3-4, B1 · R16 every Step 1 |
| §5 Data model, readers, migrations, capacity, shared types | C0-1, C0-2, C0-3b (§5.7), C0-3a + A3-1 / A3-2 / A1-5 (§5.5a) |
| §6 Bookings (state machine, validation, totals, steps, cancel, turns, locks) | C0-1, C0-3a, A1-1–A1-4; locks Global constraints + C0-3b |
| §7 Listing status and calendar | C0-1 (transitions), C0-3b (sync, §7.2 table), A2-1 (§7.3) |
| §8 Thread, contact, notes | C0-3a, A1-3, A1-4, A1-5 |
| §9 Jobs | C0-4 (registration), A2-3 |
| §10 Discovery | A2-1 (availability), A2-2, B2-2, B2-4 |
| §11 Notifications | C0-1, C0-3a, A3-3 (texts), senders in A1, A2-3, A3-2, A3-4 |
| §12 Sockets | C0-3a (`writeBookingStatus` emits), C0-5 (client) |
| §13 API | C0-4 (stubs, limits), A1-1–A1-4, A2-1, A2-2, A3-1, A3-2, A3-4 |
| §14 App | C0-5, B2-1–B2-4, B3-1–B3-3 |
| §15 Admin | C0-4 (nav), A3-4, B1-1, B1-2 |
| §16 Settings | C0-1, B1-2 |
| §17 Errors | C0-1, C0-5 (copy), raised in A1–A3 |
| §18 Privacy | C0-3a (estimate), C0-4 (Sentry), C0-5 (app redaction), A1-4, A3-3 |
| §19 Testing 1–8 | 1 C0-3b, A1-2, A2-1 · 2 C0-1, A1-1–A1-3 · 3 C0-1, A1-3 · 4 C0-3b, A2-3 · 5 A1-4, A1-5 · 6 A3-1, A3-2, A1-5 · 7 A2-3 · 8 A2-2 |
| §20 Build order | this plan's batches (D1) |
| §21 Earlier documents and code | C0-1 (retired actions), I-4 |
| §22–§23 Deferred, open items | I-4, I-5 |
| §25 Review changes | C1 C0-3b, A2-3 · C2 C0-1, C0-3b · C3 C0-3a, A3-1, A3-2, A1-5 · I1 C0-2 · I2 C0-3a, A1-1, A1-2 · I3 C0-3b, A1-2 · I4 C0-3b, A2-3 · I5 A3-4 · I6 C0-3a, A1-4 · M1 C0-3b · M2 C0-3a, A1-1 · M3 C0-1 · M4 C0-1, C0-4 · M5 C0-3b, A2-2 |
