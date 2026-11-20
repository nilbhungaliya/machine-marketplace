# M14 machinery rental bookings — design

Date: 2026-11-20. Status: **built** (2026-11-21, on `develop`; plan Batch I done, the owner's device pass and the
client's §23 answers open). Reviewed (owner delegated every design decision, as for F6 + F7 and F8; independent
review applied, §25; the plan follows). Rulings R1–R16 are final in substance; smaller calls are marked **(my call)** and listed in §24.

Scope IDs: **F5** (machinery rental: rates, availability), the rental half of **F7** (bookings recorded, "Mark machinery
as rented", reviews), the booking rows of **F9**, flow **U1 / U2** for rentals in `docs/product-scope.txt`; module **M14**
(machinery rental, MVP basic) in `docs/product-scope.md`, with the rental rows of **M15** (reviews), **M16**
(notifications: booking request, confirmed, on site, returned), **M17** ("bookings to confirm"), **M13** (deals and
history) and admin **AD5** (rentals) and **AD6** (settings). Client decision **D7** (payments and rental money) stays
open: money is recorded, never collected (R12).

**No textile counterpart.** The textile project (`C:\Users\Dell\Desktop\textile stock marketplace`, also
`E:\textile-marketplace`) has no rentals (checked: its `docs/superpowers/specs/` has no rental or booking spec). M14
therefore builds on **our own** F6 + F7 and F8 code, which were themselves ported from textile's M7 / M8 / M12 / M14 /
M15 modules, and on the rental research in `docs/research/2026-11-16-india-b2b-rental-and-parts-fitment.md` §B and
"Rental model (recommendation)" (DOZR, EquipmentShare, Yard Club, TransRentals, RNTL, AUEQI). Patterns reused, by
source:
- F2 + F3 (`2026-11-18-f2-f3-listings-design.md`): `machine_rental` listings and `listing_rentals` terms (§4.5), the
  GST-verified-only rule (decision 7), `writeStatus` as the only listing status write, the system transitions
  `reserve` / `unreserve` (the model for `rent_out` / `rent_back`, §8), the go-live gate, `reports`.
- F4 + F5 (`2026-11-19-f4-f5-discovery-design.md`): filters, the `on_rent` card tag, available-before-rented ranking tier,
  rental rate display, sign-in sheet with pending actions.
- F6 + F7 (`2026-11-19-f6-f7-enquiries-chat-offers-deals-design.md`): one thread per business + listing (R1), system
  lines (R9), share-my-number after a deal (R6), the deal record's notes (R17), handover → confirm / problem → auto
  complete timers (R18, R21), cancel rules (R19), disputes (R20), blind reviews (R22), `notify` + push, `runTx`
  after-commit emits, `Idempotency-Key`, lock order, `refuseViewer`, private photo pipeline, `maskContact`.
- F8 (`2026-11-20-f8-part-requests-design.md`): settings registry sections cross-checked, jobs with `FOR UPDATE SKIP
  LOCKED` and one transaction per row, the IST day helpers.

---

## 1. Why

Rental is one of the three listing kinds, and owners can list an idle excavator or forklift today, but the only thing a
renter can do is Enquire and the owner flips "Rented" by hand. Nobody can see whether a machine is free on the days they
need it, the agreed dates and price live only in chat, and a finished rental leaves no record and no review. M14 turns
a rental listing into something a contractor can **book for dates** and an owner can **run as a small fleet**: one
request with dates, quantity, site and operator; the owner confirms, declines or proposes a change; both sides follow
the same record from "confirmed" to "on site" to "returned"; the calendar keeps itself; and the rental ends with a review
on both sides, like a deal.

## 2. Goals, non-goals, anti-goals

**Goals**
1. A signed-in renter checks a rental listing's **availability** for the coming weeks and sends a **booking request**:
   start date, charged by (a period the listing prices), how many periods, how many machines, site, operator choice,
   note. The app shows the server's estimate (rate × periods × machines + operator + transport) before sending.
2. The owner **confirms**, **declines** or **proposes a change** (dates, periods, machines, total); the renter accepts,
   declines or sends a changed request back. A request nobody answers expires.
3. A confirmed booking **reserves capacity** on the listing's calendar: two confirmed bookings can never put more
   machines out than the listing has on any day. Owners **block dates** (maintenance, booked outside the app) on the
   same calendar.
4. Both sides follow one **Booking record**: confirmed → machine on site (opening hour meter, photos) → returned
   (closing hour meter, final amount, damage note) → completed (renter confirms, or automatically after the window), with
   cancel and report-a-problem branches, notes for payment / advance / deposit recorded off the app, and reviews on both
   sides with rental facets.
5. The listing's **"On rent"** status follows the calendar by itself; search can filter **"free on my dates"**.
6. Admins see every booking (AD5), resolve booking problems in the existing **Disputes** queue, and set the rental
   numbers in Settings.

**Non-goals** (later, §22): payments, advances or deposits collected through the app (M20 / D7); extensions and
scheduled off-rent as one-tap flows (P2: today the owner marks returned when it comes back, early or late; a longer
rental is a new booking); daily logsheets (P2); per-acre rates and hour-level calendars (P2: an hourly booking takes its
whole day on the calendar); rental requirements in F8 (P2, "A rental" segment of the mockup stays hidden); telematics;
insurance checks; partial-quantity return; re-sourcing when an owner declines; A1 KPI tiles (A1 work).

**Anti-goals — M14 has failed, even if it works, when:**
- **double booking:** a confirmation, accepted change or block ever commits more machines than the listing has on any
  day, under any race (two confirms, confirm vs block, confirm vs quantity edit); and a clash caused by a machine
  kept past its end date goes unflagged (it can't be prevented, only surfaced at once to the owner, §6.4);
- **the calendar lies:** a listing shows "On rent" when every machine is free today, or "Available" while all are out,
  for longer than one job cycle;
- **numbers leak early:** a phone, email or exact site address reaches the other side before F6's reveal rule (a
  confirmed booking now counts as a deal for it), or reaches a push, log or analytics;
- **money is invented:** any total computed in floating point or on the client, or a final amount that silently differs
  from what both sides saw.

## 3. Approaches

| # | Approach | Verdict |
|---|---|---|
| A | **A new `rental_bookings` entity with its own state machine**, living in the listing's existing chat thread, and **reusing** F6's shared pieces: system lines, share-my-number (a confirmed booking counts as a deal), notes, `notify` + push, `runTx`, idempotency, the private photo pipeline, and **generalised** `deal_reviews` / `deal_disputes` (a row belongs to a deal **or** a booking). Owner counters are a field on the booking (a proposal + whose turn), not F6 offers. | **Chosen.** A rental is time-based capacity, not stock: no holds, no backups, no counter bounds, a different timeline (on site → returned) and different review facets. Reusing the generic plumbing keeps one inbox, one Deals tab, one Disputes queue and one review system. |
| B | **Bookings as a kind of deal** (`deals.kind = rental`, booking columns on `deals`, requests as `offers`), as `docs/product-scope.md` M13 first sketched ("an accepted offer (or a confirmed rental booking) creates a deal"). | Rejected: `deals` requires an accepted `offers` row (`offer_id` NOT NULL UNIQUE), a stock hold and stock semantics (a dispute closed as cancelled with "goods not returned" **converts** the hold and would sell the machine out through `syncReservation`); its timeline has no on-site → returned step. Every F6 rule would need a rental branch and the just-finished F6 tests would be reopened. The scope line is updated (§21). |
| C | **Calendar only**: an availability calendar the owner keeps, with chat and manual Mark rented for the rest. | Rejected: leaves M14's MVP list (booking request and confirmation, on rent / returned, reviews) undone, and the calendar would drift from reality with nothing tying it to bookings. |

## 4. Rulings

| # | Ruling |
|---|---|
| R1 | **The request:** start date (IST, today … today + `rental_advance_days`, default 180), **charged by** one of the periods the listing prices (`hour` / `day` / `week` / `month`), a **count** of periods (hours 1–24 on one day; days 1–90; weeks 1–26; months 1–6), **machines** 1 … listing quantity, **operator** (asked only when the listing's operator is `optional`: with / without; `included` / `mandatory` → with; `not_available` or unset → without), **transport** (asked only when the listing says `either`: owner delivers / I pick up), **site** (pincode required → city / state; site address line optional, private until confirmed), note ≤ 500 (masked, scam-checked). The listing's minimum duration is enforced (`400 BELOW_MINIMUM`). The **end date** follows: hour → the start date; day → start + n − 1; week → start + 7n − 1; month → start + 30n − 1 **(my call: a month is 30 days on the calendar; the listing's `month_days` stays the price definition)**. |
| R2 | **Money (server-computed, integer paise, shared function `rentalEstimate()`):** rate × count × machines + (operator `optional` and chosen) operator day rate × **operator days** × machines + (owner delivers) transport charge × 2 (each way) × machines **(review change: each machine travels)**. Operator days follow `rentalDayEquivalent`'s definitions: hour booking → 1; day → count; week → count × 6; month → count × the listing's `month_days`. Fuel, overtime, deposit and GST are shown as terms, not added. The **estimate** is stored with each version; the **agreed total** is the total of the version that gets confirmed (an owner's change may set its own total); the **final amount** is entered by the owner at return (R6). All three are shown side by side on the Booking record. |
| R3 | **Negotiation:** a request is the renter's proposal; the owner **confirms** it, **declines** it (reason) or **proposes a change** (start, count, machines, operator, transport and a total of its own); the renter **accepts** the change (→ confirmed), **declines** it (→ declined) or **sends a changed request** (back to the owner). At most **5 changes** in all (setting), then confirm / accept or decline only. One open proposal at a time, stored on the booking with whose turn it is; every version is kept in `rental_booking_versions` **(approach A: not F6 offers)**. |
| R4 | **Expiry and withdraw:** a request or change unanswered for **24 h** (setting `rental_reply_hours`), or whose start date has passed (IST), expires (job). The renter may withdraw while `requested` or `countered`. |
| R5 | **Capacity and the calendar:** capacity on day *d* = listing quantity − Σ machines of `confirmed` / `on_rent` / `disputed`-before-return bookings covering *d* − Σ machines of owner **blocks** covering *d*. An `on_rent` booking covers from the earlier of its start date and the day it went on site, to the later of its end date and today, until it is returned. Requests **don't** hold capacity (availability is "indicative until the owner confirms", DOZR). Confirm, accept-a-change, block create / edit and a quantity decrease check capacity **under the listing lock** (`409 RENTAL_DATES_TAKEN`, `409 RENTAL_QUANTITY_BOOKED`). A request or change whose dates are already full is refused at send (`409 RENTAL_DATES_TAKEN`). |
| R6 | **Lifecycle:** `requested` (owner's turn) ⇄ `countered` (renter's turn) → `confirmed` → `on_rent` (either side marks **On site**: optional opening hour meter, ≤ 3 photos) → `returned` (owner marks **Returned**: closing hour meter, **final amount** (default the agreed total; a different amount needs a reason), damage note, ≤ 3 photos) → `completed` (renter **confirms**, or automatically **2 days** after return; setting). Exits: `declined`, `withdrawn`, `expired`, `cancelled` (either side alone before on site, reason; admin any time before completion), `disputed` (either side from `on_rent` or `returned`; support resolves). No cancel once on site: an early return is a return. |
| R7 | **Listing status follows bookings:** `rented` becomes **system-only**: `syncRentalStatus(tx, listingId)` (the `syncReservation` pattern) moves `live` → `rented` when today's capacity is 0 and back when it isn't, on every booking / block / quantity write, **after every listing status write** (`afterListingStatusWrite`) and in a job that fixes any mismatch. The seller's manual **Mark rented / End rental are retired** (an offline rental becomes a block "Booked outside the app"). What each listing status means for requests and bookings is one table (§7.2). |
| R8 | **Who:** any signed-in, onboarded business other than the owner may request (renting needs no GST; the owner is GST-verified by F2 decision 7); `viewer` members read only (`403 VIEWER_READ_ONLY`). A block between the businesses refuses a request (`403 BUSINESS_BLOCKED`) and declines open requests, as F6 closes offers; confirmed bookings continue. Open requests per renter business **3 unverified / 15 verified**, **5 requests a day** (settings). Guests: Request booking is a sign-in reason with a pending action (F4 pattern). |
| R9 | **Thread and contact:** a booking lives in the listing's chat thread with the renter business (F6 R1: a request opens the thread if none); the request is a **booking card** message and each step a system line. A **confirmed** booking counts as "a deal in the thread" for share-my-number (F6 R6): both ticks reveal the numbers, permanently. The site address line reaches the owner only once the booking is confirmed; before that the owner sees city, pincode and the distance from the machine's base. |
| R10 | **Notes (F6 R17):** either side's non-viewer edits payment method, advance paid, deposit paid, expected on-site time and a short text (masked, scam-checked) while `confirmed` / `on_rent` / `returned`; version guard (`409 RENTAL_BOOKING_STALE`). Everything is "recorded; paid outside the app". |
| R11 | **Reviews (F6 R22 with rental facets):** after `completed`; blind; 7 / 14 days; scores after 3; one reply. The renter is the `buyer` side and the owner the `seller` side (`PartySide` reused). Renter → owner: **machine as described** (`matched_listing`), **communication**, **on time** (the buyer facets, so the **seller score** counts rental reviews with no change to its formula) + text; owner → renter: **communication**, **paid as agreed**, **care of the machine** (new `care` facet in place of `pickup`; stars stored, not shown, as F6's buyer score). `deal_reviews` gains a nullable `rental_booking_id` and an `r_care` column (exactly one of deal / booking, CHECK). |
| R12 | **Disputes (F6 R20):** report a problem from `on_rent` or `returned` (categories: not as described, breakdown, damage, hours / amount, no-show, other); support resolves **completed** (the final amount stands, or the agreed total if never returned), **cancelled**, or **resumed** (back to where it was: `on_rent`, or `returned` with a fresh 2-day window). `deal_disputes` gains a nullable `rental_booking_id` (exactly one, CHECK); the Disputes queue lists both. |
| R13 | **Discovery:** rental search gets a **"Free on"** date-range filter (from / to, ≤ 90 days) keeping listings with capacity ≥ 1 on every day of the range; the listing page shows a **30-day availability strip** (free / partly booked / full per day, never who) and **Request booking** as its main button with Enquire beside it. `rented` keeps its "On rent" tag and the available-first ranking tier. |
| R14 | **Notifications (new category `rentals`):** owner: new request, changed request, withdrawn, change accepted, renter declined the change; renter: change proposed, confirmed, declined, expired, returned (check the final amount); both: cancelled, on site, starts tomorrow, due back today, completed with the review prompt, problem reported, dispute resolved; review received reuses F6's. Push per F6's rules: no message text and **no amounts in a push** **(my call)**. |
| R15 | **Admin (AD5, `operations` + `support`; every mutation audit-logged):** Rental bookings list (filters status, dates, business, listing; search by ref) and detail (terms, versions, timeline, notes, hour meters, photos, dispute), admin **cancel** with a reason (both told), bookings on a business's and a listing's detail, a Settings section **"Rentals"**. Booking problems use the existing **Disputes** queue (`support`). |
| R16 | **Testing (limited, important):** capacity under races (two confirms, confirm vs block, confirm vs quantity edit), the state machine, `rentalEstimate`, `syncRentalStatus` incl. the midnight job, reveal after a confirmed booking, site address privacy, the review / dispute generalisation not breaking F6, jobs. Not UI wiring. |

---

## 5. Data model

One Drizzle migration (**0016**) and one `--custom` migration (**0017**: CHECKs, the exclusion-free capacity indexes,
the reference sequence, enum values Drizzle can't add in a transaction if needed). Money `bigint` paise; machines a
whole number (`smallint`, 1–1000, as rental listing quantities); dates are IST calendar dates (`date`).

### 5.1 `rental_bookings`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `ref` | bigserial unique | shown `#700001…` (sequence restarted at 700001 in 0017; listings 100001, part requests 300001, deals 500001) **(my call)** |
| `listing_id` | uuid FK listings | a `machine_rental` listing |
| `thread_id` | uuid FK chat_threads | the listing's thread with the renter business (F6 R1) |
| `renter_business_id`, `owner_business_id` | uuid FK businesses | owner = the listing's business at request time |
| `created_by_user_id` | uuid FK users | |
| `status` | enum `rental_booking_status` | `RENTAL_BOOKING_STATUSES` (§5.8) |
| `turn` | enum `rental_booking_turn` `owner` / `renter`, nullable | whose answer the open proposal waits for; null outside `requested` / `countered` |
| `current_version_id` | uuid FK rental_booking_versions, nullable | the open or the agreed version (set right after version 1 is inserted; the two tables reference each other) |
| `change_count` | smallint, default 0 | proposals after the first (R3 cap) |
| `start_date`, `end_date` | date | copied from the current version (capacity reads these) |
| `period` | enum `rental_period` | as listing rates |
| `period_count` | smallint | |
| `machines` | smallint | |
| `with_operator`, `owner_delivers` | boolean | |
| `agreed_total_paise` | bigint, nullable | set at confirm / accept-change |
| `final_amount_paise` | bigint, nullable | set at return |
| `final_amount_reason` | text, nullable | `RENTAL_FINAL_REASONS` when ≠ agreed |
| `final_amount_note` | text, nullable | ≤ 300, masked |
| `site_pincode`, `site_city`, `site_state` | text | from the pincode directory |
| `site_address` | text, nullable | ≤ 200; private: renter always, owner only from `confirmed` on (R9) |
| `site_point` | geography(Point), nullable | pincode centroid; for distance only, never served |
| `listing_title`, `unit_snapshot` | text / jsonb | title and rates / terms snapshot at request (`RentalTermsSnapshot`: rates, shift hours, operator, operator rate, fuel, transport, transport charge, deposit) |
| `reply_due_at` | timestamptz, nullable | `requested` / `countered`: now + `rental_reply_hours` |
| `confirmed_at`, `on_site_at`, `returned_at`, `completed_at`, `cancelled_at` | timestamptz | |
| `on_site_by_side` | `party_side`, nullable | |
| `hour_meter_start`, `hour_meter_end` | integer, nullable | 0 … 1 000 000; end ≥ start when both set |
| `on_site_photo_keys`, `return_photo_keys` | text[] ≤ 3 each | private keys (`rental/<id>/…`) |
| `damage_note` | text, nullable | ≤ 500, masked |
| `auto_complete_at` | timestamptz, nullable | `returned_at + rental_complete_days` |
| `completed_how` | enum `renter_confirmed` / `auto` / `support` | |
| `cancelled_by_side` | enum `renter` / `owner` / `admin` / `system` | |
| `cancel_reason`, `cancel_note` | text | reasons per side (§5.8); note ≤ 300, masked |
| `decline_reason` | text, nullable | `RENTAL_DECLINE_REASONS` |
| `disputed_from` | `rental_booking_status`, nullable | `on_rent` or `returned` while `disputed` (capacity and resume) |
| `payment_method`, `advance_paise`, `deposit_paise`, `deposit_returned` | notes (R10) | `DEAL_PAYMENT_METHODS`; advance ≤ agreed total (CHECK) |
| `expected_on_site_time` | text, nullable | `HH:MM` |
| `notes_text`, `notes_scam_flag`, `notes_updated_at`, `notes_updated_by_user_id` | | as deals |
| `start_reminded_at`, `due_reminded_at`, `overdue_reminded_at`, `not_started_reminded_at` | timestamptz | each reminder once |
| `version` | integer, default 1 | +1 on every change; only a notes edit checks it |
| `created_at`, `updated_at` | timestamptz | |

Indexes: `(listing_id, status)` partial `WHERE status IN ('confirmed','on_rent','disputed')` with `(start_date,
end_date)` (capacity); `(renter_business_id, status, updated_at DESC)`, `(owner_business_id, status, updated_at DESC)`
(lists); `(status, reply_due_at)` partial on `requested` / `countered`; `(status, auto_complete_at)` partial on
`returned`; `(thread_id)`. CHECKs (0017): `end_date ≥ start_date`; `machines` 1–1000; `period_count` ≥ 1; `turn` set
iff status in (`requested`, `countered`); `site_address` length; `advance_paise ≤ agreed_total_paise`;
`hour_meter_end ≥ hour_meter_start`; photo arrays ≤ 3.

### 5.2 `rental_booking_versions` (every proposal, R3)

`id`, `booking_id` FK, `seq` smallint (1 = the request; unique with `booking_id`), `proposed_by_side` (`renter` /
`owner`), `start_date`, `end_date`, `period`, `period_count`, `machines`, `with_operator`, `owner_delivers`,
`estimate_paise` (server, R2), `total_paise` (= estimate for a renter version; the owner's own total for an owner
version, ≥ 0), `message` (≤ 300, masked; the note on a request, the owner's reason for a change), `created_by_user_id`,
`created_at`. Never updated. The booking row copies the open / agreed version's fields.

### 5.3 `rental_booking_events` (timeline, the `deal_events` pattern)

`id`, `booking_id`, `code` (`RENTAL_EVENT_CODES`: `requested`, `changed_by_owner`, `changed_by_renter`, `confirmed`,
`change_accepted`, `declined`, `withdrawn`, `expired`, `on_site`, `returned`, `return_confirmed`, `auto_completed`,
`cancelled`, `problem_reported`, `dispute_resolved`, `notes_changed`, `contact_shared`), `actor_side`
(`renter` / `owner` / `system` / `admin`), `actor_user_id`, `actor_admin_id`, `values` jsonb (ids, dates, codes, totals; never text a user typed), `created_at`.

### 5.4 `rental_blocks` (owner calendar blocks, R5)

`id`, `listing_id` FK, `start_date`, `end_date`, `machines` (1 … quantity), `reason` (`maintenance` /
`booked_outside` / `other`), `note` ≤ 200 (owner only, never public), `created_by_user_id`, `created_at`,
`updated_at`. Hard-deleted when the owner removes it. Index `(listing_id, start_date, end_date)`. CHECK `end ≥ start`,
range ≤ 366 days.

### 5.5 Changed tables

| Table | Change |
|---|---|
| `deal_reviews` | `deal_id` nullable; `rental_booking_id` uuid FK nullable; CHECK exactly one; unique `(rental_booking_id, reviewer_side)` partial; `r_care` smallint; `deal_reviews_shape` rewritten in 0017 per subject × side (deal buyer: matched / communication / on_time; deal seller: communication / payment / pickup; rental buyer: matched / communication / on_time; rental seller: communication / payment / care) |
| `deal_disputes` | `deal_id` nullable; `rental_booking_id` FK nullable; CHECK exactly one; `deal_disputes_one_open` becomes two partial unique indexes (per deal, per booking) |
| `chat_messages` | `message_kind` gains `booking`; `rental_booking_id` FK nullable; `chat_messages_shape` gains the `booking` branch (booking id set, no offer / deal id) |
| `notifications` | `rental_booking_id` FK nullable (destination); `notification_category` gains `rentals`; `type` is a `text` column, so the new types need no migration |
| `listings` | none (status `rented` stays; only who writes it changes, R7) |

### 5.5a Readers that assume `deal_id` (review change: every one changes in C0 / A3)

A **subject helper** (`services/reviews/subject.ts`: `{ kind: 'deal' | 'rental', id }` → title, ref, parties,
completed-at, and the right lock: `lockDeal` or `lockRentalBooking`) replaces the direct deal reads below:

| Reader | Today | Change |
|---|---|---|
| `reviews/review.service.ts:255, 293` (public list, one review) | `INNER JOIN deals` for the title | `LEFT JOIN` deals and bookings, `coalesce` the title; a rental review must appear wherever it counts in the score |
| `review.service.ts:315-317` (`postReply`), `review-moderation.service.ts:119-121` (hide) | `lockDeal(dealId)` | the subject's lock |
| `review-jobs.ts:39-43` (publish job) | looks up the deal for `notifyPublished` | the subject; destination `{ rentalBookingId, reviewId }` |
| `review-state.ts` (`dealForParty`, `reviewStateFor`, `COLUMN`, `ratingsOf`) | deal only, `REVIEW_FACETS[side]` | subject + `REVIEW_FACETS[subject][side]`, `care → r_care` |
| `admin-reports.service.ts:159` | five `r_*` columns | plus `r_care` |
| `deals/deal-admin.service.ts:54, 188, 245, 273` (disputes queue, list, detail) | `INNER JOIN deals` | `LEFT JOIN` both; row carries the subject |
| `deal-read.service.ts:159` (dispute history), `deal-view.ts:161` | deal | include booking disputes in the business history |
| `dispute.service.ts:126-145` (resolve) | deal + stock outcome | branch by subject; a booking resolve never touches stock |
| `chat/admin-read.service.ts:41` (read a conversation from a dispute) | `deal_disputes ⋈ deals` | either subject's thread |
| `consent/contact-consent.service.ts:70-143` (`latestDealId`, `maybeReveal`, `contactState`, `shareContact`) | deal | `threadAgreement` (§8) |
| `chat/thread-lines.ts` `insertCardMessage`, `recomputeTurns`; `message.service.ts:34-74`; `inbox.service.ts:121,146` | offer / deal | booking card and turns (§8) |
| `admin/user-status.service.ts:60-88` (`closeChainsForInactiveOwner`), `business-admin.service.ts:255` (`revokeGst`) | F6 offers only | also the rental system exits of §6.1 |
| app `ReviewDeal`, `ReportProblem`, `reviews-api.ts`, admin `conversations-api.ts` `SYSTEM_LINE_LABELS` (exhaustive) | deal | subject; new labels |

### 5.6 Migrations

0016 (generated): the four new tables and enums, the changed columns above, `message_kind` + `booking` and
`notification_category` + `rentals`. 0017 (custom): CHECKs, partial unique indexes, the sequence restart. Drizzle's
migrator runs all pending migrations in **one transaction**, and Postgres refuses a new enum value used in the
transaction that added it: so no SQL in 0016 / 0017 may compare against the new values as enum literals. The
rewritten `chat_messages_shape` CHECK compares `"kind"::text` (`CASE "kind"::text WHEN 'booking' …`), and no partial
index filters on a new value (the 0013 header and the note at shared-types `index.ts:281` record the same trap). Run `db:migrate` and
`db:migrate:test`. No backfill: dev has no rental bookings; listings currently `rented` by hand flip back to `live`
on the first `rental-status-sync` run (no production data, pre-launch) **(my call)**.

### 5.7 Capacity, one definition (`services/rentals/capacity.ts`)

```sql
-- machines out on each day of [from, to] for one listing
WITH days AS (SELECT d::date FROM generate_series($from, $to, interval '1 day') d)
SELECT days.d,
  COALESCE((SELECT sum(b.machines) FROM rental_bookings b
            WHERE b.listing_id = $id
              AND (b.status IN ('confirmed','on_rent') OR (b.status = 'disputed' AND b.disputed_from = 'on_rent'))
              AND days.d BETWEEN LEAST(b.start_date, COALESCE((b.on_site_at AT TIME ZONE 'Asia/Kolkata')::date, b.start_date))
                  AND CASE WHEN b.status IN ('on_rent','disputed') THEN GREATEST(b.end_date, $today) ELSE b.end_date END), 0)
+ COALESCE((SELECT sum(k.machines) FROM rental_blocks k
            WHERE k.listing_id = $id AND days.d BETWEEN k.start_date AND k.end_date), 0) AS out
FROM days
```

`free(d) = listings.quantity − out(d)`. `$today` is `IST_TODAY` from a new shared `lib/ist.ts` (the scattered
`Asia/Kolkata` helpers move there **(my call)**). A booking writer checks `max(out) + machines ≤ quantity` over its
range (excluding the booking itself) **after** `lockListingOnly` (`FOR UPDATE`): every writer that changes capacity
locks the listing first, so the check can't race. Free capacity only drops on a day where a booking or block **starts** (or on today, for overruns), so
"enough machines on every day of [from, to]" is checked on `from` plus each start date inside the range, not on every
day: the discovery filter (§10) uses that form as a `NOT EXISTS` against the partial capacity index, and the
writers may use it too (one helper, `maxOutInRange`, both forms tested equal).

### 5.8 Shared types (`packages/shared-types`)

- `RENTAL_BOOKING_STATUSES` = `requested, countered, confirmed, on_rent, returned, completed, declined, withdrawn,
  expired, cancelled, disputed` (replaces the placeholder; admin `lib/status.ts` tones follow); `OPEN_RENTAL_STATUSES`
  (`requested`, `countered`); `ACTIVE_RENTAL_STATUSES` (`confirmed`, `on_rent`, `returned`, `disputed`).
- `rentalBookingTransition(status, action, side)` (the server's table, §6.1) and `rentalBookingActions(view, side,
  role)` for clients; `rentalYourTurn(booking, side, today)` (§6.6).
- `rentalEndDate(start, period, count)`, `rentalEstimate(terms, request)` → `{ endDate, days, rentPaise,
  operatorPaise, transportPaise, totalPaise }` (integers; `rentalDayEquivalent` untouched), `meetsRentalMinimum(terms,
  period, count)` (§6.2).
- Reasons: `RENTAL_DECLINE_REASONS` (`dates_unavailable`, `site_too_far`, `terms`, `other`),
  `RENTAL_CANCEL_REASONS_RENTER` (`plans_changed`, `found_another`, `owner_not_responding`, `other`),
  `RENTAL_CANCEL_REASONS_OWNER` (`machine_unavailable`, `breakdown`, `renter_not_responding`, `other`),
  `RENTAL_CANCEL_REASONS_SYSTEM` (`listing_removed`, `blocked`, `owner_inactive`, `owner_gst`, `renter_inactive`,
  `support_closed`, `admin`), `RENTAL_FINAL_REASONS`
  (`extra_time`, `overtime`, `fuel`, `transport`, `damage`, `discount`, `other`), `RENTAL_BLOCK_REASONS`,
  `RENTAL_DISPUTE_CATEGORIES` (`not_as_described`, `breakdown`, `damage`, `hours_or_amount`, `no_show`, `other`).
- `REVIEW_FACETS` becomes `REVIEW_FACETS[subject][side]` with `subject: 'deal' | 'rental'` (`care` added);
  `SellerScore` unchanged.
- Views: `RentalBookingView` (renter / owner variants by reader), `RentalBookingListRow`, `RentalBookingsPage`,
  `RentalAvailabilityDay` (`date`, `state: free | partial | full`; the owner's view adds `out`, `free`, bookings and
  blocks), `RentalEstimateResult`, `AdminRentalBookingRow` / `AdminRentalBookingView`, `Badges.rentalsYourTurn`.
- `SYSTEM_LINE_CODES` gain `booking_requested`, `booking_changed`, `booking_confirmed`, `booking_declined`,
  `booking_withdrawn`, `booking_expired`, `booking_on_site`, `booking_returned`, `booking_completed`,
  `booking_cancelled`, `booking_problem`, `booking_dispute_resolved`; `MESSAGE_KINDS` gains `booking`.
- Settings (§16), error codes (§17), notification types (§11), `RENTAL_LIMITS` (counts, lengths, photo max 3,
  availability window 90 days, advance window).

---

## 6. Bookings

### 6.1 State machine (`rentalBookingTransition`, server-enforced)

| From | Action | Who | To | Effect |
|---|---|---|---|---|
| — | **request** | renter (non-viewer) | `requested` (turn owner) | version 1; thread opened if none; booking card; `reply_due_at` |
| `requested` | **confirm** | owner | `confirmed` | capacity check (R5); `agreed_total = version total`; reveal eligibility; `syncRentalStatus` |
| `requested` | **propose change** | owner | `countered` (turn renter) | new version (owner total allowed); `change_count + 1`; capacity check of the new dates |
| `requested` | **decline** (reason) | owner | `declined` | |
| `requested` / `countered` | **withdraw** | renter | `withdrawn` | |
| `countered` | **accept** | renter | `confirmed` | capacity check; agreed = owner version total |
| `countered` | **send changed request** | renter | `requested` (turn owner) | new version (renter's, estimate = total); `change_count + 1` |
| `countered` | **decline** | renter | `declined` | |
| `requested` / `countered` | `reply_due_at` passed, or `start_date < today` | job | `expired` | |
| `requested` / `countered` | block between the businesses; owner business's owner suspended; owner loses GST | system | `declined` (`blocked` / `owner_inactive` / `owner_gst`) | (review change) |
| `requested` / `countered` | renter business's owner suspended | system | `withdrawn` (`renter_inactive`) | |
| `requested` / `countered` / `confirmed` | listing removed by an admin, rejected after `back_to_review`, or removed / sold / made unavailable by the seller (open requests only: confirmed ones block those seller actions) | system | `cancelled` (`listing_removed`) | §7.2 |
| `confirmed` | **on site** (hour meter, ≤ 3 photos) | either side, from `start_date − 1` | `on_rent` | `syncRentalStatus` |
| `confirmed` | **cancel** (reason, note) | either side alone | `cancelled` | `syncRentalStatus` |
| `on_rent` | **returned** (hour meter, final amount + reason if ≠ agreed, damage note, ≤ 3 photos) | owner | `returned` | `auto_complete_at`; `syncRentalStatus` |
| `returned` | **confirm return** | renter | `completed` (`renter_confirmed`) | reviews open |
| `returned` | `auto_complete_at` passed | job | `completed` (`auto`) | reviews open |
| `on_rent` / `returned` | **report a problem** | either side (renter on `returned` until `auto_complete_at`) | `disputed` (`disputed_from`) | timers stop; dispute row |
| `disputed` | resolve **completed** / **cancelled** / **resumed** | support | `completed` (`support`) / `cancelled` (`support_closed`) / `disputed_from` (resumed `returned` gets a fresh `auto_complete_at`) | `syncRentalStatus` |
| `requested` / `countered` / `confirmed` | **admin cancel** (reason) | operations / support | `cancelled` (`admin`) | both told; audit. Once on site, only the dispute path settles a booking (review change) |

Final: `completed`, `declined`, `withdrawn`, `expired`, `cancelled`. Every action checks side, role (`viewer` →
`403 VIEWER_READ_ONLY`) and status (`409 RENTAL_TRANSITION_NOT_ALLOWED`); write routes take an `Idempotency-Key`;
only the notes edit checks `version` (`409 RENTAL_BOOKING_STALE`). Proposal actions name the version they answer
(`versionSeq`): answering an older one → `409 RENTAL_BOOKING_STALE` (two owner members racing). Each action writes an
event, a system line and notifications, and emits `rental:updated` (ids, status, version) to both businesses.

### 6.2 Request and change validation

- Listing: `machine_rental`, `live` or `rented` (`404 LISTING_NOT_FOUND` otherwise, as offers), not the renter's own
  (`409 OWN_LISTING`). The owner business must **still hold GST**, checked explicitly at request, change, confirm and
  accept (`403 RENTAL_NEEDS_GST`): `publicListingWhere` doesn't check GST and `revokeGst` doesn't touch listings
  (review change). The block between the businesses is re-checked **after** the listing lock (F6's final-review
  pattern).
- The thread: a request opens the thread through `openOrGetThread` **without** the enquiry daily new-thread cap
  (rental limits apply instead; the cap is skipped by an option) **(review change)**.
- Period must be priced by the listing (`400 RENTAL_PERIOD_NOT_OFFERED`); counts per R1 (`400 RENTAL_COUNT_INVALID`);
  machines ≤ listing quantity (`400 RENTAL_MACHINES_INVALID`); start date today … today + `rental_advance_days`
  (`400 RENTAL_DATES_INVALID`).
- **Minimum** (`meetsRentalMinimum`): a listing minimum in hours is met by any day / week / month request or an hour
  request with count ≥ the minimum; a minimum in days / weeks / months is never met by an hour request and otherwise
  compares calendar days (day 1, week 7, month 30) ≥ minimum × the same factor (`400 BELOW_MINIMUM`).
- Operator / transport choices only where the listing offers a choice (else forced, R1).
- Site pincode must exist in `pincode_offices` (`400 PINCODE_UNKNOWN`); distance from the listing's point to the
  pincode centroid is computed server-side; beyond `service_radius_km` the estimate and the request carry
  `beyondServiceRadius: true` (a warning, not a refusal: the owner decides) **(my call)**; the renter never gets the
  distance itself (§13.2).
- Limits (R8): open (`requested` + `countered`) requests of the renter business 3 unverified / 15 verified
  (`409 RENTAL_OPEN_LIMIT`), 5 new requests a day IST (`429 RENTAL_DAILY_LIMIT`), one open request per thread
  (`409 RENTAL_REQUEST_OPEN`: change the open one instead) **(my call)**; `change_count` ≤ `rental_max_changes`
  (`409 RENTAL_CHANGE_LIMIT`).
- Dates full for the asked machines → `409 RENTAL_DATES_TAKEN` (R5).

### 6.3 Owner's total on a change

The owner's version carries its own `total_paise` (0 … 10¹⁰), shown with the server estimate for the same terms and
"% vs. estimate" so a discount or surcharge is visible; the message (reason) is optional. A renter's version has
`total = estimate` (renters don't type money).

### 6.4 On site and return

- **On site:** either side, not before `start_date − 1` (`409 RENTAL_TOO_EARLY`), optional opening hour meter and ≤ 3
  photos (private pipeline: the deal photo presign + `finalizePrivatePhotos` destination `{ kind: 'rental',
  bookingId }` → `rental/<id>/<uuid>.jpg`, limit 3). Recorded side shows on the timeline ("Marked on site by the owner").
- **Returned:** owner only, from `on_rent` (also before `end_date`: an early return; also after it: late). Final
  amount required (prefilled with the agreed total); a different amount requires a `RENTAL_FINAL_REASONS` reason and
  allows a note. Closing hour meter ≥ opening when both set (`400 HOUR_METER_INVALID`). Damage note optional. Sets
  `auto_complete_at = now + rental_complete_days × 24 h`.
- **Confirm return:** renter; completes. Disagreeing → report a problem (`hours_or_amount`, `damage`…).
- **On site never checks capacity** (the machine is physically there). **Overrun clash:** when an `on_rent` booking
  is past its end date and the listing's `out` today or tomorrow exceeds its quantity (it collides with a confirmed
  booking starting then), the owner gets `rental_booking_clash` once per clash (naming both refs) and both Booking
  records show "Machine still out from #700012": the owner marks the first returned, or cancels / talks to the next
  renter. No automatic cancel **(review change, my call)**. A confirm never goes over capacity: the overrun is counted
  up to today, and a booking starting later than today can still collide only if the overrun continues; that is what
  the clash notice is for.
- Confirmed bookings past `start_date` that were never marked on site get no auto-cancel: a reminder (§9) asks both to
  mark on site or cancel; their dates keep counting until then **(my call, as F6's stale `agreed` deals)**.

### 6.5 Cancel and decline

Before on site, either side cancels alone with a reason (+ note); after on site there is no cancel (return or problem).
Decline is the owner's (or the renter's, of a change) answer to a proposal. Admin cancel (any non-final status) needs a
reason; both sides told. Cancellations are on the record and admin's business history, not scored **(as F6)**.

### 6.6 Whose turn (`rentalYourTurn`, Deals tab badge `Badges.rentalsYourTurn`)

Owner: `requested`; `confirmed` from `start_date` on (mark on site); `on_rent` from `end_date` on (mark returned).
Renter: `countered`; `returned` (confirm or report). The Deals tab badge sums `dealsYourTurn + rentalsYourTurn`.

### 6.7 Lock order (`services/rentals/locks.ts`)

renter business `FOR NO KEY UPDATE` (only on request, where the open limit is counted) → **listing `FOR UPDATE`**
(every capacity writer: request, change, confirm, accept, on site, return, cancel, resolve, blocks, quantity edits,
`syncRentalStatus`) → booking `FOR NO KEY UPDATE` → thread `FOR UPDATE`. Blocks and the listing PATCH path already
lock business → listing (`lockBusinessThenListing`); a booking write that needs the owner business doesn't lock it.
Jobs read candidate ids without locks, then per row (own savepoint): listing, then booking `FOR UPDATE SKIP LOCKED`,
re-check, act (the `deal-auto-complete` pattern).

---

## 7. Listing status and the owner's calendar

### 7.1 `syncRentalStatus(tx, listingId)` (R7)

Called with the listing locked: after every capacity change, from **`afterListingStatusWrite`** (`services/deals/holds.ts`,
which every status-writing caller already runs) for `machine_rental` listings, so publish, approve, unhide, resume,
renew, relist and `back_to_review` all land on the right status **(review change)**, and by the `rental-status-sync`
job. If the listing is `live` and `free(today) = 0` → system transition `rent_out` (`live` → `rented`); if `rented`
and `free(today) > 0` → `rent_back` (`rented` → `live`, **no gate**, as `unreserve`). Any other status: nothing. Both
go through `applySystemTransition` (`rent_out` / `rent_back` join `SystemTransitionAction` and
`LISTING_ONLY_ACTIONS`), which writes the status and its history row; search reads status live, so no refresh is
needed; `refreshed_at` untouched **(my call: an "available again" isn't a bump)**. The sync's own transition must not
re-enter the sync (a guard flag on the call).

Listing transitions (`LISTING_TRANSITIONS`):
- `mark_rented` and `end_rental` (seller) **removed** (with `GateAction 'end_rental'` and its `GATED_ACTIONS` entry);
  `rent_out` / `rent_back` (system) added. Admin history labels for the old actions stay (old rows carry them).
- `pause`, `renew` and `mark_unavailable` gain `rented` in their `from` list (an owner whose machines are all out can
  still pause or renew).
- `mark_sold` gets `kinds: ['part', 'machine']`: a rental is removed or made unavailable, never "sold"; the app's
  manage sheet stops offering it on rentals.
- `expire` keeps `live` / `rented`, but the listing-expiry job **skips** rental listings with a `confirmed` /
  `on_rent` / `returned` / `disputed` booking, and a confirmation bumps `refreshed_at` (a booked machine is an active
  listing) **(review change)**. `back_to_review` keeps `rented`.

### 7.2 Listing writes that meet bookings

One table for what each listing state means **(review change: replaces the scattered rules)**. "Active" bookings are
`confirmed` / `on_rent` / `returned` / `disputed`.

| Listing state or write | New requests | Open requests (`requested` / `countered`) | Confirm / accept a change | Active bookings |
|---|---|---|---|---|
| `live`, `rented` | yes | answered normally | yes | continue |
| `paused` (seller) | no | stay; the owner can still answer | yes | continue |
| `pending_review` (`back_to_review`) | no | stay | no (`409 LISTING_NOT_BOOKABLE`) | continue |
| `expired` | no | stay until their reply window | no | continue (expiry skips listings with active bookings, §7.1) |
| `hidden` (admin hide, reversible) | no | stay | no | continue: **hide never cancels** (bulk hide must not mass-cancel) |
| `rejected` after `back_to_review`, `removed` by an admin | — | cancelled `listing_removed` | — | `confirmed` cancelled `listing_removed` (both told); `on_rent` / `returned` / `disputed` continue to their end |
| Seller remove / mark unavailable | — | cancelled `listing_removed` in the same transaction | — | **refused** while any `confirmed` / `on_rent` / `returned` / `disputed` booking exists → `409 LISTING_HAS_OPEN_BOOKINGS` |
| Seller quantity decrease (`patchListing`; the admin patch has no quantity field) | | | | refused when any day from today on would have `out` > new quantity → `409 RENTAL_QUANTITY_BOOKED` |
| Rates / terms edit | | | | never touch existing bookings (snapshot) |

On site, return, confirm-return, cancel, notes, problems and reviews work in **every** listing state.

### 7.3 Owner calendar (`GET /listings/:id/calendar`, blocks)

Owner members (viewers read) see a month view per listing: each day's machines out / free, the bookings covering it
(ref, renter trade name, status, machines) and blocks. Blocks: add (dates, machines, reason, note), edit, delete;
create / edit check capacity against confirmed bookings (`409 RENTAL_DATES_TAKEN`); then `syncRentalStatus`. Opened
from My listings (manage sheet "Calendar") and from a booking. `available_from` / `availability_note` (F2) stay as
display text **(my call)**.

---

## 8. Thread, contact and notes

- **Booking card** (`message_kind = booking`, `rental_booking_id`): inserted on request; renders the current version,
  status and the reader's actions (as the offer card). Later steps are system lines (`booking_*` codes with ref,
  dates, reason codes and totals; never text a user typed).
- `recomputeTurns` gains bookings: owner's turn on `requested`, renter's on `countered` (thread "Your turn" filter).
  A confirmation increments `chat_threads.deal_count` (enquiry status `converted`) and the inbox pill reads active
  bookings like active deals **(my call)**.
- **Reveal (R9):** `latestDealId` becomes `threadAgreement(conn, threadId)` → the newest of a deal or a booking in
  `confirmed` / `on_rent` / `returned` / `completed` / `disputed` (or ever confirmed, since the reveal is permanent:
  any booking with `confirmed_at` set). `maybeReveal` writes `contact_shared` to whichever it found (deal event or
  booking event) and emits `deal:updated` or `rental:updated`; `contactState` and `shareContact` use the same helper
  (`NO_DEAL_IN_THREAD` keeps its name; its copy says "deal or confirmed booking"). App: the thread's contact banner
  shows when `detail.deals.length > 0 || detail.bookings.some(confirmedAt)`.
- **Site address:** served to the renter always; to owner members (not viewers) once `confirmed_at` is set, and then
  through `maskContact` until the thread's numbers are revealed (a number typed into the address must not beat the
  reveal, review change); never in
  notifications or admin lists; the admin booking detail shows it to `operations` / `support`, like a deal's details
  **(my call)**.
- **Notes** (R10): `PATCH /rental-bookings/:id/notes` with `version`; `notes_changed` event naming fields, not values.

---

## 9. Jobs (`src/jobs/index.ts`)

| Job | Every | Work |
|---|---|---|
| `rental-booking-expiry` | 5 min | `requested` / `countered` with `reply_due_at ≤ now` or `start_date < today` → `expired`; both told (renter: "No answer"; owner: "Request expired") |
| `rental-booking-auto-complete` | 5 min | `returned` with `auto_complete_at ≤ now` → `completed` (`auto`), review prompts |
| `rental-booking-reminders` | 1 h | `rental_booking_starts_tomorrow` (confirmed, start = tomorrow, once, both); `rental_booking_due_back` (on_rent, end = today, once, both); `rental_booking_overdue` (on_rent, end < today, once, owner: "Mark it returned"); confirmed with start < today and not on site: once, both ("Mark on site or cancel") |
| `rental-status-sync` | 15 min | rental listings whose status disagrees with today's capacity (`status = 'rented'` ≠ `free(today) = 0`, `live` / `rented` only): lock, `syncRentalStatus`; also detects overrun clashes (§6.4) |

All: candidate ids without locks, per row a savepoint, listing then booking `FOR UPDATE SKIP LOCKED`, re-check, act.
Each reminder stamps its `*_reminded_at` column so a re-run sends nothing twice.

---

## 10. Discovery (R13)

- `SearchFilters.rentalDates?: { from, to }` (IST dates, `to − from` ≤ 89 days, from ≥ today): applies to
  `machine_rental` only; keeps listings whose `free(d) ≥ 1` on every day (lateral capacity subquery, §5.7); the count
  path, facets and the "free on your dates" result line use it; a `rented` listing can pass (free on future days)
  and then ranks in the available tier for that search **(my call)**. App: a "Dates" chip on the rentals results
  (mockup "21–23 Nov"), a date-range sheet.
- Cards keep the headline rate (F4); the rate-per-chosen-period display is P2 **(my call: the card stays the F4 card)**.
- `GET /listings/:id/availability?from=&to=` (public, ≤ 92 days, default today + 29): `RentalAvailabilityDay[]`
  (`free` / `partial` / `full`); the listing page's 30-day strip and the request form's date picker read it.
- Listing page (`contactActions` for `machine_rental`): **Request booking** (primary) + **Enquire** (secondary); a
  guest gets the sign-in sheet with a pending `request_booking`; the owner sees **Calendar** and **Bookings** instead.

---

## 11. Notifications (category `rentals`)

`NOTIFICATION_TYPES` drops the placeholder `booking_update` (unused; its F8 test pin moves) and gains:

| Type | To | When |
|---|---|---|
| `rental_booking_requested` | owner members | request, changed request |
| `rental_booking_changed` | renter members | owner proposed a change |
| `rental_booking_confirmed` | renter (owner confirmed) / owner (renter accepted a change) | |
| `rental_booking_declined` | the other side | |
| `rental_booking_withdrawn` | owner | |
| `rental_booking_expired` | both | |
| `rental_booking_cancelled` | the other side; both on admin / system cancel | |
| `rental_booking_on_site` | the other side | |
| `rental_booking_returned` | renter | "Check the final amount" |
| `rental_booking_completed` | both (auto) / owner (renter confirmed) | with the review prompt |
| `rental_booking_starts_tomorrow`, `rental_booking_due_back`, `rental_booking_overdue`, `rental_booking_not_started` | per §9 | |
| `rental_booking_clash` | owner members | an overrun collides with the next booking (§6.4); once per pair |
| `rental_booking_problem` | the other side | |
| `rental_booking_dispute_resolved` | both | |

`review_received` / `review_waiting` reuse F6's types with destination `{ rentalBookingId, reviewId }`. Destination
column `notifications.rental_booking_id`; `notify` input, row view, push data (`type`, `rentalBookingId`) and push tag
(`rental:<id>`, so a booking's updates replace each other on the device **(my call)**), app `notificationLink` →
`BookingRecord`. Texts in `services/notifications/text/{en,hi,gu}.ts` with params ref, listing title (masked), dates
(IST, short); **no amounts and no message text in pushes** (R14). Dedupe per event and user (F6).

## 12. Sockets

`rental:updated` `{ bookingId, threadId, status, version }` to both businesses' members (after commit, `runTx`);
`thread:updated` as F6 when lines are added; admin `dispute:new` reuses F6's with `{ disputeId, rentalBookingId }`;
admin `rental:updated` to `operations` / `support` rooms for the list's live refresh.

---

## 13. API

### 13.1 Rate limits

Group `rental_booking` (request + change: 20 / 10 min per user), `rental_booking_action` (60 / 10 min per user),
`rental_estimate` (60 / min per user or install id, plus the per-IP cap), availability (public, the discovery limiter).

### 13.2 Routes (`routes/rentals.ts`, `routes/admin/rentals.ts`; **I** = takes `Idempotency-Key`)

| Route | Who | Notes |
|---|---|---|
| `GET /listings/:id/availability?from&to` | public | §10 |
| `POST /rentals/estimate` | public | `{ listingId, startDate, period, count, machines, withOperator?, ownerDelivers?, sitePincode? }` → `RentalEstimateResult` (end date, days, parts, total, `free`, `beyondServiceRadius`, minimum met). **No distance:** probing pincodes would reveal the machine's point (review change); the owner sees the distance (floored km) on the request instead |
| `POST /listings/:id/bookings` **I** | user, non-viewer | request (§6.2) → `RentalBookingView` |
| `GET /rental-bookings?tab=active\|completed\|cancelled&side=all\|renter\|owner&cursor=` | user | keyset `(updated_at, id)`, 20; tabs: active = open + active statuses, completed, cancelled = declined / withdrawn / expired / cancelled |
| `GET /rental-bookings/:id` | party members | reader's view, actions, versions, timeline, contact block, review state |
| `POST /rental-bookings/:id/{confirm,decline,change,accept,withdraw,on-site,returned,confirm-return,cancel,problem}` **I** | per §6.1 | bodies per action; proposal actions carry `versionSeq` |
| `POST /rental-bookings/:id/photos/presign` | party, non-viewer | the deal presign, limit 3 |
| `PATCH /rental-bookings/:id/notes` **I** | party, non-viewer | `version` |
| `GET /rental-bookings/:id/review`, `POST /rental-bookings/:id/review` **I** | party | F6 review rules with rental facets; reply / report / hide use F6's review routes by review id |
| `GET /listings/:id/calendar?from&to` | owner members | §7.3 |
| `POST /listings/:id/rental-blocks`, `PATCH /rental-blocks/:id`, `DELETE /rental-blocks/:id` | owner, non-viewer | §7.3 |
| `GET /admin/rental-bookings` | operations, support | filters status, from / to (start date), business id, listing id, search ref; paged 25 / 50 / 100 |
| `GET /admin/rental-bookings/:id` | operations, support | everything incl. versions, events, photos (300 s URLs), dispute; site address |
| `POST /admin/rental-bookings/:id/cancel` | operations, support | reason (required); audit `rental_booking.cancel` |
| `/admin/disputes*` | support | list / detail / resolve accept booking disputes; resolve for a booking takes no `stockReturned` (`400` if sent) |

`GET /users/me/badges` gains `rentalsYourTurn`. `GET /listings/:id` (owner view) gains `bookingSummary`
(open requests, active bookings, out today, next booking) and `GET /listings/mine` cards gain `rentalLine`; the public
view gains nothing beyond what availability serves.

---

## 14. App

### 14.1 Screens (mockup flow `rental`, `build-periwinkle-v2.mjs` l.641–671; new screens without a mockup follow the
v2 kit and the `frontend-design` skill)

| Screen | Route | Notes |
|---|---|---|
| Rental listing page | existing `Listing` | rates block, terms (works within, minimum, diesel, transport), **30-day availability strip**, footer **Request booking** + Enquire; owner: Calendar, Bookings |
| Request booking | `RequestBooking { listingId, prefill? }` | start date (calendar sheet with busy days greyed), charged by (segmented: the listing's periods), count stepper, machines stepper (when quantity > 1), operator / transport chips when offered, site pincode (+ "Use my business location") and optional address, note; live estimate card ("3 days · ₹28,800 + transport ₹5,000 · diesel by you") from `POST /rentals/estimate`; warnings (beyond radius, dates full); Send request |
| Booking record | `BookingRecord { bookingId }` | header (dates, machines, operator, status chip), proposal card with the reader's actions (Confirm / Propose change / Decline; Accept / Change / Decline), money block (estimate → agreed → final), timeline, notes, contact block, hour meters and photos, site, review card, Message (opens the thread), Report a problem, Cancel |
| Propose a change | sheet | dates, period, count, machines, options, total (owner) with "% vs estimate", message |
| On site / Returned | sheets | hour meter, photos (≤ 3), final amount with reason, damage note |
| Owner calendar | `RentalCalendar { listingId }` | month grid with out / free per day, bookings and blocks list, Add block sheet |
| Deals tab | existing | a top **Deals / Rentals** switch **(my call: a separate list, low risk, §3 seam map)**; Rentals list uses the same Active / Completed / Cancelled segments with side chips All / Renting / Renting out; `BookingRow` |
| Thread | existing | `booking` card case; booking system lines; contact banner rule (§8) |
| Search results | existing | "Dates" chip + date-range sheet for rentals; "N machines free on your dates" line |
| Review / Report a problem | existing `ReviewDeal`, `ReportProblem` | take `{ subject: 'deal' \| 'rental', id }`; rental facet labels; rental dispute categories |
| Notifications | existing | `rentals` category icon (calendar); links to `BookingRecord` |

My listings manage sheet: **Mark rented / Available again** removed; **Calendar** and **Bookings (n)** added for
rentals; the card shows "On rent" / "3 of 5 out today".

### 14.2 Foundation

`lib/rentals-api.ts`, `hooks/use-rental-booking.ts` (socket `rental:` prefix → refetch), `lib/rental-display.ts`
(pure: periods, estimate lines, statuses → chips, actions, whose turn; tested), `lib/rental-request-form.ts` (Yup
schema mirroring §6.2; tested), locales `rentals.json` (en / hi / gu, parity tests), analytics `RENTAL_EVENTS`
(`rental_request_started`, `rental_request_sent`, `rental_booking_action` with `action`, `rental_block_saved`; ids
only), navigation types, pending sign-in action `request_booking`.

---

## 15. Admin (R15)

- **Rental bookings** (`/rentals`, replaces the placeholder; nav roles change from `operations` only to
  `operations`, `support`, matching Deals): table (ref, listing,
  renter, owner, dates, machines, status, agreed total, updated), filters in the URL, live refresh on `rental:updated`;
  detail (`/rentals/[id]`): terms snapshot, versions, timeline, notes, hour meters, photos (lightbox), site, contact
  state, dispute link, reviews; **Cancel booking** (reason dialog, danger).
- **Disputes:** list and detail show the subject (deal or booking) with a link; resolve dialog hides "Did the goods
  go back?" for bookings and explains the three outcomes for a rental.
- **Business detail:** "Rental bookings (n)" link (as owner and as renter); **listing detail**: bookings and blocks.
- **Settings:** section **"Rentals"** (`rental_` keys, §16).
- `lib/status.ts`: tones for the new statuses. Admin conversation labels gain the `booking_*` system codes.

---

## 16. Settings (`APP_SETTINGS`, int, admin section "Rentals")

| Key | Default | Range | Meaning |
|---|---|---|---|
| `rental_reply_hours` | 24 | 1–168 | A request or change expires unanswered after this. |
| `rental_max_changes` | 5 | 0–20 | Proposals after the first request. |
| `rental_open_limit_unverified` | 3 | 1–50 | Open requests, renter business without GST. |
| `rental_open_limit_verified` | 15 | 1–200 | Open requests, GST-verified renter. |
| `rental_requests_per_day` | 5 | 1–100 | New requests a renter business sends a day (IST). |
| `rental_complete_days` | 2 | 1–14 | Days after return before it completes by itself. |
| `rental_advance_days` | 180 | 7–365 | How far ahead a start date may be. |

`validateSettings`: `open_limit_unverified ≤ open_limit_verified`. Count maxima per period (R1) stay code.

## 17. Errors (new codes)

`RENTAL_PERIOD_NOT_OFFERED`, `RENTAL_COUNT_INVALID`, `RENTAL_MACHINES_INVALID`, `RENTAL_DATES_INVALID`,
`BELOW_MINIMUM`, `PINCODE_UNKNOWN` (if not already defined by F1), `RENTAL_DATES_TAKEN`, `RENTAL_QUANTITY_BOOKED`,
`RENTAL_OPEN_LIMIT`, `RENTAL_DAILY_LIMIT`, `RENTAL_REQUEST_OPEN`, `RENTAL_CHANGE_LIMIT`, `RENTAL_TRANSITION_NOT_ALLOWED`,
`RENTAL_BOOKING_STALE`, `RENTAL_TOO_EARLY`, `HOUR_METER_INVALID`, `FINAL_REASON_REQUIRED`,
`LISTING_HAS_OPEN_BOOKINGS`, `LISTING_NOT_BOOKABLE`, `RENTAL_BOOKING_NOT_FOUND` (404 for anyone not a party);
`RENTAL_NEEDS_GST` (F2's) reused. `OFFERS_NOT_FOR_RENTALS`
stays. App error keys in `rentals.json`.

## 18. Privacy and security (DPDP Act 2023)

- Site address: renter + owner members (non-viewers) after confirmation + admin detail; never in lists, notifications,
  push, logs, analytics or Sentry (redaction adds `siteAddress`, `notesText`, `damageNote`, `message`).
- Masking (`maskContact`) on version messages, notes, damage and final-amount notes, cancel notes, for every reader
  (viewers too) and in notification params; scam flag on notes and messages (F6 R7).
- Photos: private bucket, re-encoded, 300 s URLs to party members and admin.
- Availability is public as free / partial / full only; who booked is the owner's alone.
- Retention: bookings, versions, events, blocks and photos join the DPDP export / deletion list (open item with chat
  retention).

## 19. Testing (limited, important)

API integration (real Postgres + Redis, fixtures deleted in `afterAll`):
1. **Capacity races:** two concurrent confirms on a 1-machine listing for overlapping dates → one `409
   RENTAL_DATES_TAKEN`; confirm vs block create; confirm vs quantity decrease; a 3-machine listing takes 3 overlapping
   bookings of 1, refuses the 4th; an `on_rent` booking past its end date keeps blocking today; disputed-from-on-rent
   counts, disputed-from-returned doesn't.
2. **State machine:** every row of §6.1 incl. stale `versionSeq`, change cap, viewer refused on every write, owner
   can't request own listing, renter can't confirm.
3. **Money:** `rentalEstimate` (each period, operator optional / included, transport either / owner delivers,
   integer paise, minimum rules) — shared-types unit tests; final amount ≠ agreed needs a reason.
4. **Listing status:** `syncRentalStatus` → `rented` when all machines out today, back when one returns; pause → resume
   (and approve, unhide, renew) with every machine out lands `rented`; the job fixes a mismatch at the IST date
   change (fake `today`); removed transitions refused; `mark_sold` refused on a rental; expiry skips a listing with
   active bookings; suspension and GST revoke exits of §6.1; remove / unavailable refused with open
   bookings; admin removal cancels confirmed, keeps on-rent.
5. **Reveal and privacy:** share-my-number refused before confirmation, works after (both ticks); permanent after a
   cancel; site address absent from the owner's view before confirmation and from viewer / notification payloads; a
   Devanagari number in a version message masked.
6. **Generalisation regressions:** F6 review, dispute and reveal tests still pass; a rental review counts in the
   seller score **and** appears in the public review list; reply and hide work on a rental review; the publish job
   notifies for one; a booking dispute shows in the queue, opens its conversation and resolves; rental review shape (care facet) enforced by the CHECK; a booking dispute resolves without touching
   stock.
7. **Jobs:** expiry (reply window and start date passed), auto-complete, reminders once each, sync; each re-run is a
   no-op; `SKIP LOCKED` under two runs.
8. **Discovery:** "Free on" keeps a listing with one free machine, drops a fully booked one, respects blocks.

App: `lib/rental-display.ts`, `lib/rental-request-form.ts`, locale parity. Admin: rentals list filters and the cancel
dialog; disputes resolve dialog for a booking.

## 20. Build order (sketch; the plan details it)

**C0 contracts** (shared types, schema + 0016 / 0017, `lib/ist.ts`, settings, error codes, notification types and texts
skeleton, route stubs, nav, locale skeleton) → **wave A, API lanes:** **A1** bookings core (request, estimate,
state machine, capacity, locks, notes, thread card + lines, reveal generalisation, notifications, sockets); **A2**
calendar + listing side (availability, calendar, blocks, `syncRentalStatus`, listing transitions and write rules,
discovery "Free on", jobs); **A3** reviews + disputes generalisation and the admin API → **wave B:** **B1** admin pages
(Rental bookings, disputes subject, business / listing detail, settings section); **B2** app renter (listing page,
request booking, booking record, Deals tab Rentals, thread card, search dates, review / problem subject); **B3** app
owner (proposal actions and sheets, on site / returned, calendar and blocks, My listings changes) → **Batch I**
integration test of the loop, walk-through on the dev DB, docs.

## 21. Changes to earlier documents and code

- `docs/product-scope.md` M13 ("an accepted offer (or a confirmed rental booking) creates a deal") → "an accepted
  offer creates a deal; a confirmed rental booking is its own record (M14)"; M14 status list → §6.1's; M15 rental
  facets; M16 booking rows built; AD5 rentals built; open question "Align `RENTAL_BOOKING_STATUSES`" settled.
- F2 spec §7 (`mark_rented` / `end_rental` retired, `rent_out` / `rent_back` system); F6 spec R2 note ("bookings are
  M14" → built), R6 (a confirmed booking counts as a deal), §10.2 rental facets; F4 spec (rental dates filter).
- `PROJECT_STATUS.md`, `CLAUDE.md` (bookings in the state-machine list, the capacity rule), `apps/user-app/CLAUDE.md`,
  `apps/admin/CLAUDE.md`.
- **Retired `mark_rented` / `end_rental`** (review M3): shared `LISTING_TRANSITIONS`, `GateAction 'end_rental'` and
  `GATED_ACTIONS` (`listing-gate.service.ts:100-115`), the seller-action route enum; tests
  `src/lib/listing-shared.test.ts:245-308`, `__tests__/listings-lifecycle.test.ts:49-188`,
  `__tests__/listings-publish.test.ts:404`, app `lib/my-listings.test.ts:75-101`; app
  `screens/my-listings/manage-sheet.tsx:51-52`, `lib/my-listings.ts`, the three `listing.json` locales (≈ l.413–434).
  Admin history labels (`admin/lib/listings-api.ts:275`) stay for old rows.

## 22. Deferred (P2 and later)

One-tap extension and scheduled off-rent; partial-quantity return; daily logsheets; per-acre and hour-level calendars;
payments, advances and deposits through the app (M20, D7); insurance check; rental requirements in F8; the card's
rate for the chosen period; owner reply-rate and cancellation scores; calendar sync (Rental Pro, M18); telematics;
re-sourcing a declined request.

## 23. Open items (for the owner and client)

- Client: is 24 h the right reply window, and 2 days to complete after return? Should an unverified renter be able
  to book at all (today yes, with limits)?
- D7: deposits and advances stay recorded-only until payments.
- Device pass on a dev build (no new native module expected).

## 24. Decisions marked (my call)

1. A month is 30 days on the calendar (R1).
2. `#700001` booking references (§5.1).
3. Dev listings marked `rented` by hand flip back to `live` on the first sync (§5.6).
4. One shared IST helper `lib/ist.ts` (§5.7).
5. A request beyond the service radius warns, never refuses (§6.2).
6. One open request per thread (§6.2).
7. Confirmed bookings past their start that never went on site get reminders, not auto-cancel (§6.4).
8. `rent_back` doesn't bump `refreshed_at` (§7.1).
9. `available_from` / `availability_note` stay display text (§7.3).
10. A confirmation counts as a conversion for the enquiry status and the inbox pill (§8).
11. Admin booking detail shows the site address to operations / support (§8).
12. A `rented` listing can pass a future "Free on" filter (§10).
13. Cards keep F4's headline rate (§10).
14. No amounts in pushes; push tag `rental:<id>` (§11).
15. Deals tab: a Deals / Rentals switch rather than one merged list (§14.1).
16. The placeholder `booking_update` type is dropped (§11).
17. Transport is charged per machine, each way; operator days follow `rentalDayEquivalent` (R2).
18. Overrun clashes are flagged to the owner, never auto-cancelled; on site never checks capacity (§6.4).
19. Hide never cancels bookings; admin removal and rejection cancel confirmed ones (§7.2).
20. Suspended owner → its open requests declined; suspended renter → withdrawn; GST lost → declined; active
    bookings always continue (§6.1).
21. Expiry skips rental listings with active bookings; a confirmation bumps `refreshed_at` (§7.1).
22. Admin cancel only before on site; afterwards only the dispute path (§6.1).

## 25. Review changes (2026-11-20)

An independent reviewer checked the draft against the code (`develop` at `6c503f7`). Every finding was taken:

| # | Finding | Change |
|---|---|---|
| C1 | `rented` drifted after resume / renew / relist / approve / unhide / `back_to_review`; the job's candidate set missed those listings | `syncRentalStatus` from `afterListingStatusWrite`; the job selects every mismatch (§7.1, §9) |
| C2 | `mark_sold` open on rentals; `pause` / `renew` / `mark_unavailable` not allowed from `rented`; expiry silently expired booked machines | `mark_sold` kinds part / machine; those three gain `rented`; expiry skips listings with active bookings, confirm bumps `refreshed_at` (§7.1) |
| C3 | Generalising reviews / disputes broke the readers that join or lock deals | subject helper and the reader table §5.5a; tests §19 #6 |
| I1 | 0017's CHECK used the new `booking` enum value in the migrator's single transaction; `notification_type` isn't an enum | text-cast CHECK, no new-value literals; `type` is text (§5.5, §5.6) |
| I2 | Owner GST isn't enforced by the public listing filter; suspensions and blocks had no rental exits | explicit GST check at request / change / confirm / accept; system exits for suspension and GST revoke; block re-checked after the listing lock (§6.1, §6.2) |
| I3 | Hide vs remove and "no longer public" rules contradicted each other | one state table (§7.2): hide never cancels |
| I4 | Overruns and early on-site weren't counted | `on_rent` covers from the earlier of start and on-site day; clash notice (§5.7, §6.4); anti-goal reworded |
| I5 | Admin cancel of disputed / on-rent bookings left an open dispute or freed a machine still out | admin cancel only before on site (§6.1) |
| I6 | Public estimate's distance could locate the machine; a number in the site address beat the reveal | no distance in the estimate; site address masked until the reveal (§8, §13.2) |
| M1 | `writeStatus` is private | `rent_out` / `rent_back` through `applySystemTransition` (§7.1) |
| M2 | A request would hit the enquiry daily thread cap | the cap is skipped for booking requests (§6.2) |
| M3 | Retired `mark_rented` / `end_rental` code | inventory in §21 |
| M4 | Admin patch has no quantity; nav roles; R1 hard-coded 180 days | fixed (§7.2, §15, R1) |
| M5 | Discovery per-day `generate_series` too costly | check `from` + start dates only, `NOT EXISTS` on the partial index (§5.7) |

Builder questions, answered **(my calls)**: overrun clash → flag, never auto-cancel (#18); suspension / GST → #20;
listing off view → §7.2's table (#19); money → #17; always-booked listings → #21; admin cancel → #22.
