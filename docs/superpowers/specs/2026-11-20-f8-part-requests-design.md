# F8 part requests, seller targeting and availability alerts — design

Date: 2026-11-20. Status: **draft, independent review applied** (§26). Owner delegated every design decision; rulings R1–R14 are final in
substance, smaller calls are marked **(my call)** and listed in §25.

Scope IDs: **F8** (part request and availability alerts) and the "new matching part" row of **F9**, flow **U3** in
`docs/product-scope.txt`; module **M11** (buyer requirements and matching), the requirement parts of **M2** (Home strips,
§201–204), **M6** (Other side "Post a requirement"), **M8** (side matching for requirements, §402–422), the requirement
alert of **M12**, the `part_match` row of **M16**, "requirements you can serve" of **M17**; admin **AD3** (requirements
queue) and **AD6** (reports, settings: requirement seller cap) in `docs/product-scope.md`; client decision **D5**
(reach 15, now a setting). Rental requests wait for M14 (R1). UI copy says "requirement"; code says `part_request`
**(my call, as the mockup)**.

Follows the textile project (`C:\Users\Dell\Desktop\textile stock marketplace`, also `E:\textile-marketplace`):
- Specs: `docs/superpowers/specs/2026-11-08-part2-m3-m9-search-requirements-design.md` **§3.6** (the bridge from no
  results), **§4.1–§4.11** (who posts, form, lifecycle, what sellers see, eligibility computed on read, matching and the
  notified set, replies as real stock with pending / dropped, compare, where things live, reports and removal), **§7**
  (admin), **§8** (tables, jobs, config, routes); `docs/superpowers/specs/2026-11-08-part3-m19-m11-m10-design.md`
  **§6.1** (saved-search alerts when a lot goes live: our availability alerts follow its "match on going live, grouped
  row per subscription" shape).
- Code: API `services/requirements/{eligibility,matching,matching.consumer,reply.service,replies.consumer,reply-view,
  requirement.service,requirement-input,requirement-reports.service,requirement-view}.ts`, `jobs/requirement-jobs.ts`,
  `routes/requirements.ts`, `routes/admin/requirements.ts`, `services/alerts/{alerts.consumer,alert-rows}.ts` (grouped
  match rows), `services/notifications/reminders.ts` (expiring reminder). App `screens/requirements/{post-need,
  my-requirements,requirement,requirement-card,seller-requirements,reply-with-lot}.tsx`. Admin
  `app/(dashboard)/requirements/page.tsx` + `[id]`.
- **Kept from textile:** live at once, no pre-moderation; open / daily posting limits; eligibility as one SQL predicate
  checked on every read and action, never stored, 404 for anything a reader can't see; targeting (notify the top N)
  separate from visibility (every eligible seller sees it); the notified set stored with score and rank, computed once;
  a per-seller daily push cap with the in-app row kept; Not relevant stored as feedback; every reply is a real listing
  with an optional short message, never a message alone; a reply on a listing not yet live is **pending** and delivered
  when it goes live, **dropped** otherwise; withdraw; at most 3 listings per seller per request and a daily reply cap;
  compare table opening the listing's own offer flow; fulfilment prompt after a deal, never automatic; extend with a
  total cap; reminder the day before expiry; admin remove with reason, buyer told; grouped buyer rows per request.
- **Dropped from textile:** the outbox and its consumers (a queue table drained by a job instead, §8.1), Pro head start
  and delayed matches, seller requirement settings (instant / daily / off) and digests, Ask a question, public "show on
  website" needs, grades / defects / quantity ranges / delivery city choice, match % on the card, the sanction provider,
  the "no longer matches" re-fit of delivered replies, a separate `requirement_reports` table (the generic `reports`
  table serves), response score and `proven_seller`.
- **Changed from textile:** the buyer picks who can reply (verified only, default, or any seller: textile allowed GST
  only); availability alerts (auto matches) are part of F8 itself and match on part number, side and fit; listings
  replace lots; "create a new listing" links the draft to the request at creation (§9.3); validity cap 90 days (textile
  60); limits 3 / 15 open (textile 2 / 10).

Built on F2 + F3 (`2026-11-18-f2-f3-listings-design.md`: `writeStatus` as the only listing status write, part number
normalisation, `title_norm`, fitments, other-side tiers, `reports`, `app_settings`), F4 + F5
(`2026-11-19-f4-f5-discovery-design.md`: query reading, No results, PostGIS distance helpers, sign-in sheet and pending
actions) and F6 + F7 (`2026-11-19-f6-f7-enquiries-chat-offers-deals-design.md`: `notify`, grouped rows, push job,
`runTx`, `business_blocks`, `refuseViewer`, private photo pipeline, `maskContact`, scam patterns, lock order, Reports &
flags, idempotency keys).

---

## 1. Why

A buyer whose machine is down often can't find the part by searching: the stock exists but isn't listed yet, or is
listed under another name, or is the other side of what's on offer. F8 lets them say once what they need and then
does two things: tells a **small, ranked set** of sellers who plausibly hold it (not a broadcast; IndiaMART's fan-out
is the anti-pattern), and **watches every listing that goes live** so the buyer hears the moment it appears. Sellers get
the "Buyers looking for your parts" list, the demand side Fibre2Fashion shows is larger than the supply side.

## 2. Goals, non-goals, anti-goals

**Goals**
1. A signed-in business posts a structured part or machine requirement in two short steps, prefilled from where it came
   from (No results, Other side, Post tab, a copy).
2. Up to N (15) best-fitting eligible sellers are told at once; every eligible seller can find and answer it.
3. Sellers answer with up to 3 of their real listings, or a new listing prefilled from the request.
4. Every listing that goes live is checked against active requests with strict rules; the buyer hears about a match.
5. The buyer compares replies and matches side by side and continues in the existing F6 enquiry → offer → deal flow.
6. Requests end cleanly: fulfilled, closed, expired or removed, with pending replies dropped and sellers told.

**Non-goals** (later, §22): quotes without a listing ("Send a quote", P2); rental requests (M14); public Wanted tab or
web pages; Ask a question; saved searches (M12); SMS / WhatsApp; quiet hours; paid early access; request reference
search; A1 KPIs; seller alert settings; spec-value matching; mirror part numbers.

**Anti-goals — F8 has failed, even if it works, when:**
- **sellers are spammed:** a seller hears about requests outside its stock or area, or more than the daily cap by push;
  a buyer gets a push per matching listing with no cap;
- **buyer contact leaks:** a phone, email or address reaches a seller through the note, name, photo metadata, a push, a
  log or analytics (only F6's deal + consent rule reveals a number);
- **matching never fires:** a listing that goes live through any path (publish, approve, resume, relist, renew, unhide,
  unreserve) is never checked, or a check silently stops on one bad row;
- **listing writes slow down:** a listing status write does more than one `INSERT … ON CONFLICT DO NOTHING` for F8.

## 3. Approaches

| # | Approach | Verdict |
|---|---|---|
| A | **Replies with listings only** (attach live listings, or a new listing that is delivered when live), plus seller targeting and availability alerts. Every reply lands on a listing page and drops into F6's enquiry → offer → deal. | **Chosen.** Reuses all of F6 unchanged; the buyer compares real stock; the reply model is one table. |
| B | Listing replies **plus standalone quotes** (price, quantity, delivery with no listing). | Rejected: every F6 thread, offer and deal belongs to a listing (`chat_threads.listing_id`, `offers.listing_id`, holds, deal snapshots). Quotes need a listing-less thread and deal path, reworking the just-finished F6. "Send a quote" is P2. |
| C | Availability alerts only, no seller targeting or replies. | Rejected: drops half of U3 / M11 ("Relevant seller / businesses can respond") and the "Buyers looking for your parts" differentiator; sellers holding unlisted stock never hear of demand. |

## 4. Rulings

| # | Ruling |
|---|---|
| R1 | **Kinds:** a **part** or a **machine** to buy (`PART_REQUEST_KINDS`; rentals with M14). Category from the A4 catalogue (§5.1); name; part number optional; side (Left / Right / Pair) required where the node has sides; fit (brand → model → year range) optional, up to 5; specs optional, each may be "any"; quantity + unit; conditions accepted (multi, default all); budget per unit optional with a show / private flag; needed-by date optional + urgent flag (urgent raises the distance weight only); location = the business location with reach 50 km / 200 km / its state / all India (default 200 km); 1–3 reference photos optional (private, re-encoded: the chat pipeline); note (masked). |
| R2 | **Replies only with a listing.** A seller replies with up to 3 of its own live listings, or starts a new listing in the sell wizard prefilled from the request; that reply stays pending and is delivered when the listing goes live (dropped if it never does or is removed). Replies can be withdrawn. Daily reply cap per business. Viewers read, never reply (`VIEWER_READ_ONLY`). |
| R3 | **Statuses:** `active` → `fulfilled` / `closed` (buyer, reason) / `expired` (job) / `removed` (admin). "Matched" is a derived badge, never stored. No pause. The buyer edits while active (version guard), renews, closes, marks fulfilled. A deal on a reply / auto-match listing of the buyer's active request prompts "Mark this requirement fulfilled?" (notification + banner), never automatic. |
| R4 | **Live at once**, no pre-moderation. Spam control: open requests 3 unverified / 15 verified, 5 posts a day (settings), masking, reports, admin remove. Posting needs sign-in at the moment of intent and finished onboarding (guest pending action). Unverified businesses post. |
| R5 | **Validity** 7 / 15 / 30 days (default 15), renewable up to 90 days from the first post; reminder the day before expiry; hourly expiry job (`FOR UPDATE SKIP LOCKED`). |
| R6 | **Who sees and replies:** the buyer picks "verified sellers only" (default) or "any seller". Eligibility (§6) is computed on read, never stored; ineligible → 404. The seller sees the buyer's trade name, city, verified badge and member-since; never the phone. |
| R7 | **Seller targeting** at post, and on edits that change matching fields (never re-notifying a seller): score eligible sellers (§7.2), notify the top N (default **15**, D5), store the targeted set with scores. Payment never buys ranking. Per-seller push cap 10 a day (in-app row beyond it). "Not relevant" hides the request for that business and is kept as feedback. Every eligible seller sees it in "Buyers looking for your parts". |
| R8 | **Availability alerts:** any listing transition into `live` queues the listing in the same transaction (one insert); a job matches it against active requests with strict rules (§7.4), stores each match once, notifies the buyer under caps (3 pushes a day, 20 total per request, grouped row), and delivers pending replies whose listing just went live. |
| R9 | **Privacy:** note, name and reply messages masked (`maskContact`) for every reader, scam patterns flagged as in chat; no PII in notifications, push, analytics, logs or Sentry; photos private with 300 s signed URLs; the buyer's phone is never revealed by F8. |
| R10 | **Buyer flow:** Requirement page with **Replies** and **Auto matches** tabs and a **Compare** table (price, available qty, side, condition, distance, seller rating, verified); each item opens the listing page → Enquire / Make offer (F6). No new chat type. |
| R11 | **App surfaces** per the mockup (§13), en / hi / gu, Periwinkle v2, analytics with ids only. |
| R12 | **Notifications** via F6 `notify` after commit, deduped: `part_request_new`, `part_request_reply` (grouped), `part_match` (grouped, capped), `part_request_expiring`, `part_request_expired`, `part_request_fulfil_prompt`, `part_request_removed`; a new `requests` category. No quiet hours (open item). |
| R13 | **Admin** (AD3; `moderator`, `support`; every mutation audit-logged): list, detail with targeted sellers, replies, matches, reports; remove / restore with reason; part-request reports in Reports & flags; an F8 settings section. A1 KPIs later. |
| R14 | **Rate limits** per user and per business on post, edit, reply, not relevant; every number above is an admin setting (§16). |

---

## 5. Data model

One generated migration and one `--custom` migration (§5.10). New tables unless marked. Money `bigint` paise;
quantities `numeric(14,3)` travelling as decimal strings (as listings). No `ON DELETE CASCADE`: test cleanup deletes in
FK order (F6 convention).

### 5.1 `part_requests`

| Column | Notes |
|---|---|
| `id` uuid PK; `ref` bigserial unique | `ref` shown as "Requirement #300001" (sequence restarted at 300001, custom migration) for support; no search by ref (non-goal) **(my call)**. |
| `business_id` → businesses, `created_by_user_id` → users | The posting (buyer) business. |
| `kind` `part_request_kind` (`part`, `machine`) | Fixed after posting (`KIND_IMMUTABLE`). |
| `status` `part_request_status`; `return_status` `part_request_status` null | `return_status` = where restore goes (§11). |
| `category_id` → categories | Parts: a **part group or a machine type** ("a part for my CNC lathe, group unknown") **(my call)**; machines: a machine type. Active chain, else `400 CATEGORY_INVALID`. An edit may move it only within the same machine category (root) (`CATEGORY_LOCKED`, F2's code) **(my call, textile §4.3)**. |
| `name` text (3–100), `name_norm` text | `name_norm = normalizePartName(name)` (side words dropped), for `pg_trgm`. |
| `part_number`, `part_number_norm`, `part_number_base` text null | Parts only. `normalizePartNumber`, `partNumberBase(norm, side)`; a norm or base under 3 characters is stored but never matched (F2 §4.3). |
| `side` `part_side` null | Left / Right / Pair, required when the node's effective sides are on (`SIDE_REQUIRED`), refused otherwise (`SIDE_NOT_ALLOWED`); machines: null (CHECK). `not_applicable` is never stored (as F2's wizard). |
| `specs` jsonb default `{}` | Only on a node at the kind's template level (part group for parts, machine type for machines); validated with `checkSpecs` **ignoring missing required fields** (every spec may be "any"); `400 SPECS_INVALID`. Shown to sellers, **not scored** (my call, §22). |
| `quantity` numeric(14,3), `unit_id` → units | Parts: any active unit, decimals per unit (`UNIT_DECIMALS`); machines: the machine unit (`is_machine_unit`), quantity default 1. CHECK `quantity > 0`. |
| `condition_ids` uuid[] default `{}` | Empty = any condition. Each id an active condition at write (`CONDITION_INVALID`). |
| `budget_per_unit_paise` bigint null; `budget_visible` bool default false | CHECK budget > 0. **Private by default** (textile's default) **(my call)**. |
| `needed_by` date null; `urgent` bool default false | `needed_by` today … today + 365 (IST). |
| `reach` `part_request_reach` (`radius_50`, `radius_200`, `state`, `all_india`) default `radius_200` | |
| `audience` `part_request_audience` (`verified_only`, `any_seller`) default `verified_only` | |
| `point` geography(Point,4326) null; `pincode`, `city`, `state` text; `industrial_area_id` → industrial_areas null; `industrial_area_other` text null | Snapshot of the business location at post, refreshed on every edit **(my call)**: the business pin, else its pincode's office centroid (`businessPointSql`). Never shown to anyone as coordinates or pincode. |
| `photo_keys` text[] default `{}` | Private `part-request/<id>/<uuid>.jpg` keys; CHECK cardinality ≤ 3. |
| `note` text null (≤ 500); `note_flagged` bool default false | `looksLikeScam(note)` at write. |
| `version` int default 1 | +1 on every edit; `PATCH` sends it (`409 PART_REQUEST_STALE`). |
| `validity_days` smallint; `first_posted_at` timestamptz default now(); `expires_at` timestamptz; `expiring_notified_at` timestamptz null | Renew resets `expiring_notified_at`. |
| `close_reason` `part_request_close_reason` null (`found_elsewhere`, `no_longer_needed`, `posted_by_mistake`, `other`); `closed_at`; `fulfilled_at`; `fulfilled_deal_id` → deals null | Codes only, no free text **(my call: no PII)**. |
| `removed_at`, `removed_by_admin_id` → admin_users, `removed_reason` text | |
| `target_pass` smallint default 0; `targeted_at` timestamptz null | Targeting passes done (§7.3). |
| `match_push_day` date null; `match_push_day_count` smallint default 0; `match_push_total` smallint default 0 | Auto-match push caps (§7.5), IST day. |
| `buyer_seen_at` timestamptz null | Last time a member of the buyer business opened the request (`POST …/read`): Home's "new" count (§12.2, review Q6). |
| `created_at`, `updated_at` | |

Indexes (all declared in `schema.ts`, so Drizzle emits them into the generated migration, partial ones included, as
`0012` does): (`business_id`, `status`, `created_at` DESC) — My requirements; partial (`kind`, `category_id`) WHERE
`status = 'active'` — auto matching; partial (`expires_at`) WHERE `status = 'active'` — expiry and reminder; GiST
(`point`) WHERE `status = 'active'`; (`status`, `created_at` DESC) — admin list.

### 5.2 `part_request_fitments`

`id`, `part_request_id`, `brand_id` → brands (active, `makes_machines`), `model_id` → machine_models null (active, of
the brand; for a machine request also of the request's machine type), `year_from`, `year_to` smallint null (CHECK from
≤ to), `sort_order`. Max `PART_REQUEST_FITS_MAX` = 5. No "Other" model text in MVP **(my call)**. Index
(`part_request_id`). Errors `BRAND_INVALID`, `MODEL_INVALID`, `FITMENT_INVALID` (F2's codes).

### 5.3 `part_request_targets` (the notified set, R7)

PK (`part_request_id`, `business_id`); `score` numeric(6,2); `rank` smallint; `pass` smallint; `best_listing_id` →
listings null; `pushed` bool; `notified_at` timestamptz; `opened_at` timestamptz null (a member of the seller business
opened the request: the badge, §12). Index (`business_id`, `notified_at` DESC).

### 5.4 `part_request_replies`

| Column | Notes |
|---|---|
| `id`, `part_request_id`, `seller_business_id`, `listing_id` → listings, `created_by_user_id` | Unique (`part_request_id`, `listing_id`): one reply per listing per request; a withdrawn listing can't be sent again **(my call)**. |
| `message` text null (≤ 300) | Masked on read; `message_flagged` bool (scam patterns). |
| `status` `part_request_reply_status` (`pending`, `delivered`, `withdrawn`, `dropped`) | |
| `drop_reason` `part_request_drop_reason` null (`listing_removed` — the seller's own removal, `listing_removed_by_team` — admin remove, `listing_rejected` — the draft was rejected in moderation, `request_closed`, `request_expired`, `request_removed`, `blocked`, `not_eligible`, `no_longer_fits`) | Review Q3, Q5, Q7. |
| `delivered_at`, `withdrawn_at`, `dropped_at`, `buyer_viewed_at`, `created_at` | |

Indexes: (`part_request_id`, `status`); partial (`listing_id`) WHERE `status = 'pending'`; (`seller_business_id`,
`created_at`) — daily cap.

### 5.5 `part_request_matches` (auto matches, R8)

PK (`part_request_id`, `listing_id`); `seller_business_id`; `tier` `part_request_match_tier` (`part_number`,
`name_fit`, `name`, `machine_fit`); `distance_km` int null; `source` (`listing_live`, `at_post`); `pushed` bool;
`seen_at` timestamptz null; `created_at`. Index (`listing_id`).

### 5.6 `part_request_feedback` (Not relevant)

PK (`part_request_id`, `business_id`); `reason` `part_request_feedback_reason` null (`dont_sell_this`, `too_far`,
`wrong_category`, `other`) **(my call)**; `user_id`; `created_at`.

### 5.7 `part_request_work` (queue, the `search_refresh_jobs` pattern)

`id`; `kind` `part_request_work_kind` (`target_request`, `listing_changed`); `subject_id` uuid (request or listing);
`created_at`; `next_attempt_at` default now(); `attempts` smallint; `last_error` text (an error code, no data);
`claimed_at`, `done_at`, `failed_at` timestamptz null. Partial unique (`kind`, `subject_id`) WHERE `claimed_at IS NULL`
(**unclaimed rows only**), so enqueueing is `INSERT … ON CONFLICT DO NOTHING`, a burst of writes before the job claims
is one row, and an event that arrives while a row is being processed makes a **new** row (never waits on the job, never
lost). A row that failed 5 times gets `failed_at` (dead letter, outside the predicate), so later enqueues still work.
Index (`next_attempt_at`) WHERE `claimed_at IS NULL`; index (`claimed_at`) WHERE `done_at IS NULL AND failed_at IS NULL
AND claimed_at IS NOT NULL` (stale claims, §8.2).

### 5.8 `part_request_push_counts`

PK (`business_id`, `day` date, IST); `pushes` smallint. The per-seller daily push cap (§7.5) as one atomic upsert.

### 5.9 Existing tables

- `notifications`: new `part_request_id` → part_requests null; partial unique `notifications_open_request_row` on
  (`user_id`, `part_request_id`, `type`) WHERE `type IN ('part_match', 'part_request_reply') AND read_at IS NULL`
  (grouped rows, §10.2; like `notifications_open_chat_row`; `type` is text, so the predicate is safe in the migration;
  declared in `schema.ts`).
- `notification_category` enum gains `requests`; `report_target` enum gains `part_request`.
- `listings`: no column. `writeStatus` enqueues (§8.1).

### 5.10 Migrations

1. **Generated** `0014_f8_part_requests_tables.sql` (`db:generate`): the enums, tables, columns and **every index of
   §5.1–§5.9, partial and partial-unique ones included** (declared in `schema.ts` with `.where(sql…)`, as `0012` shows).
   The two `ALTER TYPE … ADD VALUE` (`requests`, `part_request`) land here: **no statement in 0014 or 0015 uses the new
   values** (F6 §5.17: Postgres refuses to use an enum value in the transaction that adds it); only runtime code does.
2. **Custom** `0015_f8_checks.sql` (`drizzle-kit generate --custom`), only what Drizzle can't express: CHECKs (quantity
   > 0, budget > 0, note ≤ 500, message ≤ 300, `cardinality(photo_keys) <= 3`, `kind = 'machine' ⇒ side IS NULL AND
   part_number IS NULL`, `status = 'closed' ⇒ close_reason IS NOT NULL`, `status = 'removed' ⇒ removed_at IS NOT
   NULL`, fitment years) and `part_requests_ref_seq` restarted at 300001.
3. `db:migrate` and `db:migrate:test` after each.

### 5.11 Shared types (`packages/shared-types`)

- `PART_REQUEST_STATUSES` **changed** to `['active', 'fulfilled', 'closed', 'expired', 'removed']` (`matched` removed:
  nothing uses it; it is derived, R3). `PART_REQUEST_TRANSITIONS` + `partRequestTransition()` (§9.1).
- `PART_REQUEST_KINDS`, `PART_REQUEST_REACHES`, `PART_REQUEST_AUDIENCES`, `PART_REQUEST_CLOSE_REASONS`,
  `PART_REQUEST_REPLY_STATUSES`, `PART_REQUEST_DROP_REASONS`, `PART_REQUEST_MATCH_TIERS`,
  `PART_REQUEST_FEEDBACK_REASONS`, `PART_REQUEST_REPORT_REASONS` (`spam`, `fake`, `contact_details`, `prohibited`,
  `other`).
- `PART_REQUEST_LIMITS` (code constants): `nameMin` 3, `nameMax` 100, `noteMax` 500, `messageMax` 300, `photosMax` 3,
  `fitsMax` 5, `minNameSimilarity` 0.5, `listingsPageSize` 20.
- `requestSideAccepts(requestSide, listingSide)`: Left ← Left / Pair; Right ← Right / Pair; Pair ← Pair; null ← any
  (the one definition, §7.4); `isMatched(view)`; `partRequestDaysLeft()`.
- `REPORT_TARGETS` + `part_request`; `NOTIFICATION_CATEGORIES` + `requests`; `NOTIFICATION_TYPES` + `part_request_new`,
  `part_request_reply`, `part_request_expiring`, `part_request_expired`, `part_request_fulfil_prompt`,
  `part_request_removed`, `part_request_reply_dropped` (`part_match` exists); `notificationCategory()`: every
  `part_request_*` and `part_match` → `requests` (`booking_update`, `listing_status` stay `deals` until their modules).
- `APP_SETTINGS` entries of §16; `Badges` + `requestsForYou`; `NotificationRow` + `partRequestId`.
- Interfaces: `PartRequestInput`, `PartRequestPatch`, `PartRequestPrefill`, `PartRequestOptions`,
  `PartRequestBuyerView`, `PartRequestSellerView`, `PartRequestView` (union by `role`), `MyPartRequestRow`,
  `SellerPartRequestRow`, `PartRequestReplyItem`, `PartRequestMatchItem`, `CompareColumn`, `ReplyOption`,
  `SellerReplyView`, `PartRequestHome`, `PartRequestDemand`, `AdminPartRequestRow`, `AdminPartRequestDetail`.

---

## 6. Eligibility (R6): who may see and reply

One SQL predicate, `eligibleSellerSql(businessId)` over the request row `r` (`services/part-requests/eligibility.ts`,
textile `eligibility.ts`), used by every seller read and action, the targeting candidate set and the admin's
"eligible now" count. A business **S** is eligible for request **r** when:

1. S finished onboarding (location step done: `businesses.pincode IS NOT NULL`, the last onboarding step) and no owner
   of S is suspended or blocked (the `publicListingWhere` sub-condition);
2. S ≠ `r.business_id`, and no owner of the **posting** business is suspended or blocked (a suspended buyer's requests
   disappear and come back on reinstatement) **(my call)**;
3. no `business_blocks` row either way;
4. `r.audience = 'any_seller'` or S's `verification_levels` contains `gst`;
5. (`r`'s machine category is in `S.categories` **and** `'sell' = ANY(S.activities)`) **or** S has a `live` listing
   (`publicListingWhere`) whose category lies in `r.category_id`'s subtree. The `sell` activity is **my call** refining
   R6: a buy-only business lists its machine categories too and must not be targeted as a seller;
6. `r.status = 'active'`, or S has a reply on `r` (it can follow its reply's outcome; read-only).

**SQL shape.** `categories.path` holds **slugs** (`textile/embroidery/needles`), so subtrees are matched by path prefix,
as `discovery/filters.ts` does (`c.path = rc.path OR c.path LIKE rc.path || '/%'`), never by id arithmetic.
`businesses.categories` is a **jsonb array of category id strings**, so condition 5's first branch is
`S.categories @> jsonb_build_array(root.id::text)` where `root` is the machine-category row of `r`'s node:
```sql
JOIN categories rc   ON rc.id = r.category_id
JOIN categories root ON root.level = 'machine_category'
                    AND (rc.path = root.path OR rc.path LIKE root.path || '/%')
-- 5a: S.categories @> jsonb_build_array(root.id::text) AND 'sell' = ANY(S.activities)
-- 5b: EXISTS (SELECT 1 FROM listings l JOIN categories lc ON lc.id = l.category_id
--             WHERE l.business_id = S.id AND l.status = 'live' AND <publicListingWhere(l)>
--               AND (lc.path = rc.path OR lc.path LIKE rc.path || '/%'))
```
The root is resolved through paths on every read, never stored, so catalogue moves can't stale it. Anything not
eligible (and not the buyer's own) answers `404 PART_REQUEST_NOT_FOUND`, as a missing request. Distance is **not** part
of eligibility (R6); the seller list shows it and sorts in-reach first (§12.3).

**Onboarding:** `requireUser` doesn't check it. Every F8 write service (post, renew, reply, create-listing-with-request,
not relevant, report) calls `onboardingForUser` as `createListing` / `publishListing` do (`409 ONBOARDING_INCOMPLETE`).

## 7. Matching

### 7.1 What runs where

| Trigger | Work (queued, §8.1) | Does |
|---|---|---|
| Request posted; edit changing a matching field (category, name, part number, side, fits, conditions, reach, audience, quantity / unit); renew from `expired` | `target_request` | Targeting pass (§7.3) and the at-post auto-match backfill (§7.4). |
| Listing status write landing in `live`, `removed` or `rejected` (kinds `part`, `machine`); a **live** listing's match-relevant edit without a status change (§8.1) | `listing_changed` | Reads the listing **as it is now**: `live` → auto-match (§7.4, new matches only; an existing match is never re-notified) and deliver its pending replies (§9.3); `removed` → drop its pending replies (`listing_removed` or `listing_removed_by_team`); `rejected` → drop them (`listing_rejected`); anything else → nothing. |

### 7.2 Targeting score (R7)

Weights are **code constants** (`TARGET_WEIGHTS`, `services/part-requests/targeting.ts`), like F4's `MATCH_WEIGHTS`;
M11 doesn't ask for them admin-tunable and a wrong tune would silently break reach **(my call)**. For each eligible
seller, the **best listing** is its `live` public listing of the request's kind in the request's subtree with the
highest listing score:

| Part | Points |
|---|---|
| Part number | `part_number_norm` equal 40; `part_number_base` equal 30 (≥ 3 chars) |
| Category | best listing in the subtree 15; no such listing (profile category only) 5 |
| Name | 15 × `similarity(l.title_norm, r.name_norm)` when ≥ 0.3, else 0 |
| Fit | request has no fits 12; overlap (F2 other-side overlap rule: same brand, model equal or either "all models", years overlap; machines: `listing_machines` brand / model / year in range) 12; listing has no fit rows 3; no overlap 0 |
| Side | `requestSideAccepts` true (or request has no side) 8; else 0 |
| Condition | accepted (or request accepts all) 5 |
| Quantity | available ≥ wanted 5; less: 5 × available / wanted; another unit 2.5 |
| Distance | 10 × max(0, 1 − d / D), D = 50 / 200 km, `state` 500, `all_india` 2 000; **urgent: weight 20** |
| Verified | GST verified 5 |

A profile-only seller scores category 5 + distance (from its business point) + verified. **Reach gate:** a seller is
targeted only when its distance point (best listing's `search_point`, else business point) is inside the reach
(`ST_DWithin` for radii; same `state`; anywhere for all India) **(my call: R7's "distance inside the radius" as a
gate)**. Ties: score, verified, nearer, business `created_at`, business id — deterministic. Payment never enters (M18).

One SQL statement per request: CTE `cands` (eligible ∩ not in `part_request_targets` ∩ no Not relevant), `ls` (their
live listings in the subtree with listing scores, served by `listings_status_kind_category_idx`), `best`
(`DISTINCT ON (business_id)`), `LEFT JOIN` for profile-only, reach gate, `ORDER BY` score … `LIMIT` the slots left.

### 7.3 Targeting passes and caps

- **Pass 1** (post): top `part_request_reach_n` (15). Each gets a `part_request_targets` row and `part_request_new`
  (§10), push subject to the seller's daily cap (§7.5).
- **Later passes** (an edit of a matching field, or renew from `expired`): re-score; newcomers in the new top N are
  added and notified; already-targeted sellers are **never** notified again; the stored set never exceeds **2 × N**
  over the request's life **(my call)**.
- The pass runs under the request row lock (`FOR NO KEY UPDATE`), sets `target_pass`, `targeted_at`; a request no
  longer `active` is skipped; `ON CONFLICT DO NOTHING` on targets, so running twice notifies once.

### 7.4 Auto-match rule (R8, strict)

Listing **L** matches request **r** when all hold:
1. `r.status = 'active'`, `r.kind = L.kind`, `r.category_id` is L's category or an ancestor (by slug path:
   `rc.path = lc.path OR lc.path LIKE rc.path || '/%'`; in practice the ancestor ids are read first from L's path, then
   `r.category_id = ANY(ids)` uses the partial `(kind, category_id)` index);
2. L is public and `live`, available quantity (`quantity − held_quantity`) ≥ 1;
3. **parts:** `requestSideAccepts(r.side, L.side)`, and (part number norm / base hit **or** (`similarity(L.title_norm,
   r.name_norm) ≥ 0.5` **and** (r has no fits **or** fit overlap))). **Machines** (my call adapting R8): r has fits →
   `listing_machines` overlap; no fits → name similarity ≥ 0.5;
4. inside the reach: `ST_DWithin(r.point, L.search_point, km × 1000)` for radii (raw distance; matching isn't a shown
   number), `L.state = r.state` for `state`, anything for `all_india`; a request or listing without a point matches
   only `state` / `all_india`;
5. L's condition in `r.condition_ids` (or the list is empty);
6. L's business passes `r.audience`, isn't blocked either way with r's business, isn't r's business, and its owner
   isn't suspended (public);
7. L isn't already a pending / delivered reply on r (it shows under Replies; no double alert) **(my call)**.

Each match is inserted once (`ON CONFLICT DO NOTHING` on the PK), with tier and distance (**snapped** whole km,
discovery's `snappedKmSql` rule, the only distance stored or shown). One `listing_changed` row matches at most **200**
candidate requests, newest first (`ORDER BY r.created_at DESC LIMIT 200`), to bound the transaction (review 2). A
`listing_live` match notifies (§7.5); an `at_post` backfill (§7.1: the 20 best currently-live listings, nearest first)
never notifies: the buyer sees "2 listings already match" on the Posted screen **(my call)**. Renewing or editing a
live listing re-queues it; the PK keeps it one match, and only matches inserted by this run notify.

**Request edits** keep everything already delivered or matched: no re-check, and they still count for Matched and
Compare (review Q5). The edit's `target_request` pass only adds new targets and new at-post matches.

### 7.5 Caps (no spam)

- **Seller pushes:** when the cap is 0 nothing is inserted and nobody is pushed (the INSERT branch would otherwise count
  a first push). Else, one statement per pass with the targeted businesses **sorted by business id** (no lock-order
  inversion between two passes): `INSERT INTO part_request_push_counts (business_id, day, pushes) VALUES (…, 1) ON
  CONFLICT (business_id, day) DO UPDATE SET pushes = pushes + 1 WHERE part_request_push_counts.pushes < cap RETURNING
  business_id`: returned → push; not returned → the `part_request_new` row is written with `push: false` (in-app only).
  Atomic across processes; never locks the business row.
- **Buyer auto-match pushes:** under the request lock, reset `match_push_day_count` when `match_push_day` isn't today
  (IST); push while `day_count < part_request_match_push_daily_cap` and `total < …_total_cap`, then increment; else the
  grouped row is bumped without a delivery.
- **Replies** are bounded by reach and the 3-listing cap; their grouped row pushes on each delivery (it replaces the
  shown one, §10.2).

### 7.6 Performance

Listing writes add one queue insert. The work job claims up to 20 rows a tick and processes each **in its own
transaction**; each `listing_changed` runs one candidate query bounded by category and capped at 200 requests; each
`target_request` one scoring query plus one backfill query. `pg_trgm` similarity is computed on a category-narrowed
set, so no trigram index on `name_norm` **(my call)**.

## 8. Jobs and the queue

### 8.1 Enqueueing

All enqueues are `INSERT INTO part_request_work (kind, subject_id) VALUES (…) ON CONFLICT DO NOTHING` on the
unclaimed-row unique index, in the writer's own transaction. They never wait on the job: a claimed row is outside the
predicate.
- `writeStatus` (`listing-lifecycle.service.ts`, the only status write), when `to ∈ {live, removed, rejected}` and
  `kind ≠ 'machine_rental'`: `listing_changed`. That catches publish / approve / resume / renew / relist / unhide /
  unreserve / removal by seller or admin / rejection in one place.
- **Match-relevant edits of a live listing** without a status change (review Q3): `patchListing` when the listing is
  `live` and the patch changes the title, part number, side, category, fitments or condition, or raises the available
  quantity from 0; and `setMyLocation` when it moves the business's live listings (one row per listing, deduped by the
  index). F6's `syncReservation` `unreserve` already goes through `writeStatus`.
- `createPartRequest`, matching-field edits and renew-from-expired insert `target_request`.

### 8.2 Job list (`src/jobs/index.ts`)

| Job | Every | Work |
|---|---|---|
| `part-request-work` | 10 s | **Claim** in one short transaction: `UPDATE part_request_work SET claimed_at = now(), attempts = attempts + 1 WHERE id IN (SELECT id … WHERE claimed_at IS NULL AND next_attempt_at <= now() OR <stale claim: claimed_at < now() − 10 min, not done / failed> ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING …`, committed. Then **one transaction per row** (`runJobTx`, as `offer-jobs.ts`): run §7.1 and set `done_at` in that transaction. On error (own transaction): `attempts < 5` → `claimed_at = NULL`, `next_attempt_at` +30 s / 2 min / 10 min / 1 h, `last_error` code — if a newer unclaimed row for the same subject exists the old row is marked `done_at` instead (the newer one covers it); `attempts = 5` → `failed_at` (dead letter, logged, outside the unique predicate). |
| `part-request-expiry` | 1 h | `active` past `expires_at`: candidate ids read unlocked, then **one transaction per request** locking it `FOR NO KEY UPDATE SKIP LOCKED` with the status re-checked → `expired`, pending replies dropped (`request_expired`), `part_request_expired` to the buyer. |
| `part-request-expiring-soon` | 1 h | `active`, `expires_at − part_request_expiring_notice_hours ≤ now`, `expiring_notified_at IS NULL`: per request `FOR NO KEY UPDATE SKIP LOCKED` → `part_request_expiring` (dedupe `part_request_expiring:<id>:<expires_at epoch>`), set the column. |
| `part-request-retention` | daily | Delete done work rows and push-count rows older than 7 days (failed rows kept 30 days for inspection). |

No F8 job ever takes `FOR UPDATE` on `part_requests` (only `FOR NO KEY UPDATE`), so the `KEY SHARE` that F6's accept
takes through the fulfil-prompt notification's FK never waits on a job.

## 9. Lifecycle, replies and locks

### 9.1 State machine (`PART_REQUEST_TRANSITIONS`, server-enforced)

| Action | Actor | From | To | Side effects |
|---|---|---|---|---|
| `post` | buyer | — | `active` | limits; `target_request` queued |
| `edit` | buyer | `active` | `active` | version +1; matching fields → `target_request` |
| `renew` | buyer | `active`, `expired` | `active` | `expires_at = max(now, expires_at) + days` ≤ `first_posted_at + part_request_max_days` (`409 PART_REQUEST_MAX_DAYS`); from `expired` the open limit applies and `target_request` is queued **(my call)** |
| `fulfil` | buyer | `active` | `fulfilled` | optional `dealId` (a deal of the buyer business); pending replies dropped (`request_closed`) |
| `close` | buyer | `active` | `closed` | reason required; pending replies dropped |
| `expire` | system | `active` | `expired` | §8.2 |
| `remove` | admin | any but `removed` | `removed` | `return_status = from`; pending dropped (`request_removed`); open reports actioned; buyer told |
| `restore` | admin | `removed` | `return_status` | an `active` return past `expires_at` lands `expired`; no notification **(my call)**; no open-limit re-check, no re-targeting, no match backfill (admin decision, review Q8) |

Anything else → `409 PART_REQUEST_TRANSITION_NOT_ALLOWED` `{ from, action }`. Sellers stop seeing a request when it
leaves `active` (except their own replies' outcome). The buyer always sees every reply and match. "Matched" =
≥ 1 delivered reply or match, shown as a badge.

### 9.2 Replying with existing listings

`POST /part-requests/:id/replies { listingIds (1–3), message? }`: eligible seller, non-viewer; each listing the
seller's own, `live` and public, **fitting**: same kind, category in the request's machine category (root) **(my call:
sellers categorise differently)**, `requestSideAccepts`, condition accepted, not already replied (`409
REPLY_EXISTS`). `GET …/reply-options` lists the seller's live listings of the kind with each one's `fit` or reason
(`kind`, `category`, `side`, `condition`, `replied`), greyed in the picker. Caps: ≤ `part_request_reply_listings_max`
(3) pending + delivered per seller per request (`409 REPLY_LIMIT`); `part_request_replies_per_day` per business, IST
day, counted under the business lock (`429 REPLY_DAILY_LIMIT`). Delivered at once → `part_request_reply` to the
buyer. Replying never holds stock or opens a thread.

### 9.3 Replying with a new listing (pending)

**New work in F2's route:** `POST /listings` is `.strict() { kind }` today; its body becomes `.strict() { kind,
partRequestId?: uuid }` and `createListing` gains the prefill below (review 9, Q4). In **one transaction**, in this
order, any failure rolling back everything: (1) the request is visible to the seller, it is eligible (§6) and the
request is `active` (`404` / `409 PART_REQUEST_NOT_ACTIVE`); (2) the reply caps (§9.2); (3) F2's `DRAFT_LIMIT`; (4)
create the prefilled draft and the `pending` reply. Lock order: seller business → request `FOR SHARE` → insert listing
→ insert reply.

Prefill (identity only; **not** specs, quantity, condition or price: the listing must describe the seller's real
stock, textile §4.7): `kind` = the request's kind; title = the request's name; part number; **side** copied when it is
Left / Right / Pair; fitments copied as listing fitments (parts); **category**: a part request on a **part group** →
the draft's `category_id` = that group; on a **machine type** → `category_id` null, and the wizard scopes its
part-group picker to that machine type by loading the request; a **machine request** → its **first** fit copied into
`listing_machines` (brand, model; year left empty). `ListingOwnerView` gains `partRequestId` (so the wizard can load
the request, whose detail carries its category path) and `pendingRequestReply: { partRequestId, name } | null`, shown on
Preview and Published ("Goes to the buyer when your listing is live").

- `listing_changed` with L `live`: for each pending reply on L (requests in id order): request locked
  `FOR NO KEY UPDATE`; delivery **re-checks full eligibility** (review Q5): request `active` (else `request_closed` /
  `request_expired` / `request_removed` as its status says), blocks either way (`blocked`), audience / GST, seller
  owner not suspended, onboarding (`not_eligible`), fit of §9.2 (`no_longer_fits`); all pass → `delivered` +
  `part_request_reply`.
- L `removed`: the job reads the actor of L's latest `listing_status_history` row: `seller` → `listing_removed`, no
  notification (the seller's own act); `admin` → `listing_removed_by_team`, seller told. L `rejected` (moderation reject
  or ask-for-changes of the pending draft) → `listing_rejected`, seller told (review Q3, Q7).
- Deleting the draft (`deleteDraft`, `listing-write.service.ts`) deletes its pending reply rows first, in its
  transaction, silently (the seller's own act).
- A request leaving `active` drops its pending replies (§9.1).
- Every drop not caused by the seller sends `part_request_reply_dropped` to the seller **(my call, textile)**.

**Withdraw** (`…/replies/:replyId/withdraw`, the replying business, non-viewer): `pending` / `delivered` →
`withdrawn`; it leaves the buyer's view.

### 9.4 Fulfilment prompt (R3)

In F6's accept transaction, after `createDealFromOffer`: the buyer business's `active` requests where the deal's
listing is a delivered reply or a match → `part_request_fulfil_prompt` (dedupe `…:<requestId>:<dealId>`). Read-only on
F8 rows (no F8 lock inside accept). The Requirement page shows a banner while the request is `active` and such a
non-cancelled deal exists: **Mark fulfilled** (sends `dealId`) / **Not yet** (hidden on this device, AsyncStorage per
request + deal) **(my call)**. No `offers.part_request_id` column: derived from listing + buyer **(my call)**.

### 9.5 Lock order

F6's order stays: buyer business → listing(s) → deal → offers → thread. F8 adds:

**the actor's own business (`FOR NO KEY UPDATE`) → part request (`FOR NO KEY UPDATE` for buyer / admin / job writes,
`FOR SHARE` for a reply) → replies / targets / matches / feedback rows**

- Posting, renew from expired (limits): buyer business → (insert / lock) request. Edit, close, fulfil: request only.
- Reply, create-listing-with-request, not relevant: seller business → request `FOR SHARE`.
- Jobs and admin: request rows in id order (`FOR NO KEY UPDATE`), then reply / match / target rows; never a business
  row lock. `part_requests` are **never** locked `FOR UPDATE`.
- **Listings:** F8 takes **no explicit lock** on a listing; listing state is read unlocked and a later change is caught
  by the queue. But inserting a reply or a match **takes `KEY SHARE` on the listing row** through its FK (and target
  rows on `best_listing_id`), which waits while a listing writer holds it `FOR UPDATE`. The real order of such a job
  transaction is therefore **request (`NO KEY UPDATE`) → listing (`KEY SHARE`, FK) → reply / match / target rows**.
  It can't cycle: no listing writer holding a listing `FOR UPDATE` ever waits for a request lock. F2 / F6 writers only
  insert a `part_request_work` row (no request lock); F6 accept inserts the fulfil-prompt notification, whose
  `part_request_id` FK takes `KEY SHARE` on the request, compatible with `FOR NO KEY UPDATE` and `FOR SHARE`;
  `deleteDraft` (business → listing `FOR UPDATE` → its pending replies) only runs on a draft, which no job matches or
  delivers, and a job touches a pending reply only after its listing left `draft`. Create-listing-with-request inserts
  the listing itself before the reply (a new row nobody else can lock).
- Businesses: notification and target inserts take `KEY SHARE` on businesses through FKs, which `FOR NO KEY UPDATE`
  allows (root CLAUDE.md rule). No transaction takes a request and then a business.

## 10. Notifications (R12)

### 10.1 Rows (`notify`, in the change's transaction, deduped)

`notify()` gains `destination.partRequestId` and an option `push?: boolean` (default true; false = row without
deliveries). Category `requests` for all.

| Type | To | Dedupe | Opens | Push |
|---|---|---|---|---|
| `part_request_new` | targeted seller | `part_request_new:<id>` | Requirement (seller) | seller daily cap |
| `part_request_reply` (grouped) | buyer | grouped row | Requirement, Replies | each delivery |
| `part_match` (grouped) | buyer | grouped row | Requirement, Auto matches | request caps |
| `part_request_expiring` | buyer | `…:<id>:<expires epoch>` | Requirement (Renew) | yes |
| `part_request_expired` | buyer | `…:<id>:<expires epoch>` | Requirement | yes |
| `part_request_fulfil_prompt` | buyer | `…:<id>:<dealId>` | Requirement (banner) | yes |
| `part_request_removed` | buyer | `…:<id>:<removed epoch>` | Requirement (read-only) | yes |
| `part_request_reply_dropped` | replying seller | `…:<replyId>` | Requirement (seller) | yes |

Recipients: every active member of the business (viewers too). Never the actor's own business, **except
`part_request_fulfil_prompt`**, which always goes to the buyer business even though a buyer member may have accepted
(review Q2).

### 10.2 Grouped rows (review Q1)

`upsertRequestNotification(tx, { type, partRequestId, recipientBusinessId, params, eventKey, push })` (modelled on
`chat-rows.ts`). The first insert carries a per-event dedupe key — `part_match:<requestId>:<listingId>`,
`part_request_reply:<requestId>:<replyId>` — so a repeated event is a no-op; grouping is `INSERT … ON CONFLICT
(user_id, part_request_id, type) WHERE type IN (…) AND read_at IS NULL` on `notifications_open_request_row` (as
`notifications_open_chat_row`), `DO UPDATE SET unread_count = unread_count + 1, params = excluded.params (the latest),
updated_at = now()`, and **`version = version + 1` only when this event is pushed**, followed by a delivery for the new
version. A capped event updates count and params **without** bumping the version, so a queued, allowed push for the
current version isn't skipped as stale by `push-sender.ts` (`delivery.version < n.version`). Android tag
`part_request:<id>:<type>` (push-sender gains the case), so a pushed update replaces the shown one.
`POST /part-requests/:id/read` (buyer opens the page) marks both grouped rows read, sets `buyer_viewed_at` on delivered
replies, `seen_at` on matches and `buyer_seen_at` on the request.

### 10.3 Text (`services/notifications/text/{en,hi,gu}.ts`)

Params contract adds `requestTitle` (masked name), `side` (key, localised by the template), `distanceKm` (the
**snapped** whole km stored on the match, `snappedKmSql`'s rule: never a raw distance), `city`; plus
the existing `businessName`, `listingTitle`, `quantity` + `unitLabel`, `count`. Never the note, message, budget, phone,
pincode or address. English:
- `part_request_new`: "A buyer needs {requestTitle}" / "{side} · {quantity} · {city}".
- `part_request_reply`: "{businessName} replied to your requirement" / grouped "{count} replies for {requestTitle}".
- `part_match`: "Your {side} {requestTitle} is available" / "{listingTitle}, {distanceKm} km away. Open it to make an
  offer." / grouped "{count} new matches for {requestTitle}" (mockup "Match alert").
- `part_request_expiring`: "{requestTitle} expires tomorrow" / "Renew it to keep getting replies."
- `part_request_expired`: "{requestTitle} has expired" / "Renew it within 90 days of posting."
- `part_request_fulfil_prompt`: "Deal agreed with {businessName}" / "Mark {requestTitle} fulfilled?"
- `part_request_removed`: "Your requirement was removed" / "{requestTitle} was removed by our team."
- `part_request_reply_dropped`: "Your reply to {requestTitle} wasn't delivered" / reason line.

No quiet hours (none exist; open item). One push switch (`users.push_enabled`); category switches stay P2.

## 11. Sockets

`part_request:updated { partRequestId, reason: 'reply' | 'match' | 'status' }` to the **buyer business room**
(`queueBusinessEmit`, after commit, ids only) on a delivered reply, a new match and a status change by job or admin;
clients refetch. Sellers refetch on focus (no seller socket) **(my call)**. Admin: `report:new` (exists) for
part-request reports.

## 12. API

User routes: `requireUser` (an active user; it does **not** check onboarding: the write services call
`onboardingForUser`, §6), `{ data }`. **I** = takes `Idempotency-Key`. Writes use
`refuseViewer` (`403 VIEWER_READ_ONLY`) except `read`. Party / eligibility checks from the database; outsiders 404.

### 12.1 Rate limits (R14)

Per user (`perUser`): post / edit / renew / close / fulfil 30 per 10 min; replies and withdraw 20 per 10 min; not
relevant 60 per 10 min; photo presign 30 per 10 min; reports as F2 (10 a day, `REPORT_LIMIT`). Per business, counted
under the business lock: open requests (`PART_REQUEST_OPEN_LIMIT`), posts per IST day (`PART_REQUEST_DAILY_LIMIT`),
replies per day (`REPLY_DAILY_LIMIT`).

### 12.2 Routes

| Route | Body / query | Reply |
|---|---|---|
| `GET /part-requests/options` | | `PartRequestOptions { validityDays: [7,15,30], defaultValidityDays, reachN, openLimit, openCount, postsLeftToday, maxDays }` |
| `POST /part-requests/photos/presign` | `{ contentType, contentLength }` | `{ url, key, expiresAt }` (chat's `presignPrivatePhoto`). On create the service generates the request uuid in code **before** the transaction, runs `finalizePrivatePhotos(businessId, keys, { kind: 'part_request', partRequestId }, { max: 3 })` (§17), then inserts the row with that id. |
| `POST /part-requests` **I** | `PartRequestInput`: `{ kind, categoryId, name, partNumber?, side?, fits?: [{ brandId, modelId?, yearFrom?, yearTo? }], specs?, quantity, unitId?, conditionIds?, budgetPerUnitPaise?, budgetVisible?, neededBy?, urgent?, reach, audience, validityDays, photoKeys?, note? }` (Zod strict) | `201 PartRequestBuyerView` |
| `PATCH /part-requests/:id` **I** | `{ version, …PartRequestInput fields except kind }` | `PartRequestBuyerView` |
| `POST /part-requests/:id/renew` **I** | `{ days }` | `PartRequestBuyerView` |
| `POST /part-requests/:id/close` **I** | `{ reason }` | `PartRequestBuyerView` |
| `POST /part-requests/:id/fulfil` **I** | `{ dealId? }` | `PartRequestBuyerView` |
| `POST /part-requests/:id/read` | | `{ ok: true }` |
| `GET /part-requests/mine` | `?status=active\|fulfilled\|closed&cursor=` (`closed` = closed + expired + removed) | `{ items: MyPartRequestRow[], nextCursor, counts }` |
| `GET /part-requests/:id` | | `PartRequestView`: `{ role: 'buyer', … }` (all fields, budget, counts, `targetedCount`, `fulfilPrompt`) or `{ role: 'seller', … }` (§12.3 card, `targeted`, `notRelevant`, `myReplies: SellerReplyView[]`, `canReply`); seller read sets `opened_at` |
| `GET /part-requests/:id/replies` (buyer) | | `{ items: PartRequestReplyItem[] }` — `ListingCard` (any status, public mapper), seller block (name, verified, `SellerScore`), masked message, live state; delivered, not withdrawn, not blocked; public first |
| `GET /part-requests/:id/matches` (buyer) | | `{ items: PartRequestMatchItem[] }` (card, tier, distance, seen) |
| `GET /part-requests/:id/compare` (buyer) | | `{ columns: CompareColumn[] }` — public replies then matches, deduped by listing, ≤ 10: price per unit / on request, available qty + unit, side, condition, distance km, rating or "New seller", verified, `contactAction` |
| `GET /part-requests/:id/photos` | | `{ photos: { url, expiresAt }[] }` (buyer, eligible seller; 300 s) |
| `GET /part-requests/for-sellers` | `?tab=matched\|all\|replied&kind=&forListing=&cursor=` | `{ items: SellerPartRequestRow[], nextCursor, counts }` |
| `GET /part-requests/:id/reply-options` | | `{ listings: ReplyOption[], slotsLeft, dailyLeft }` |
| `POST /part-requests/:id/replies` **I** | `{ listingIds: uuid[1..3], message? }` | `{ replies: SellerReplyView[] }` |
| `POST /part-requests/:id/replies/:replyId/withdraw` **I** | | `SellerReplyView` |
| `POST` / `DELETE /part-requests/:id/not-relevant` | `{ reason? }` | `{ notRelevant }` |
| `POST /part-requests/:id/report` | `{ reason, details? }` | `{ reported: true }` (eligible sellers; `REPORT_EXISTS`) |
| `GET /part-requests/home` | | `PartRequestHome { buyer: { partRequestId, name, side, newCount, nearestKm } \| null, seller: { newCount, items: SellerPartRequestRow[≤3] } \| null }`. Buyer strip (review Q6): the active request with the most recent unseen item (tie: newest request); `newCount` = unseen auto matches + unseen delivered replies created after the request's `buyer_seen_at`; `nearestKm` = the nearest of those (snapped km). |
| `GET /listings/:id/part-request-demand` (owner) | | `PartRequestDemand { count, partRequestIds[≤10] }` — active requests the §7.4 rule would match (eligibility for this seller applied), any listing status |
| `POST /listings` (F2, extended: today `.strict() { kind }`) | `.strict() { kind, partRequestId? }` | `ListingOwnerView` + `partRequestId`, `pendingRequestReply` (§9.3) |
| `GET /users/me/badges` (F6, extended) | | + `requestsForYou` (targeted, active, unopened, unreplied, not dismissed) |

### 12.3 What a seller sees (`SellerPartRequestRow`, seller view)

Name, kind, side, quantity + unit, first fit line, conditions accepted, budget when visible ("Private" otherwise),
needed by + urgent, days left, city and whole km from the seller's business point (snapped), `replyCount`, `targeted`,
`hasMatchingStock` (a live listing in the subtree), photo count (photos on the detail only), the buyer block (trade
name masked, city, verified, member since = business `created_at` year), masked note with the scam warning when
flagged. Never phone, email, pincode, address, point or budget when private. Tabs: **For you** = targeted or
`hasMatchingStock`; **All** = every eligible; **Replied**. Not-relevant ones are hidden from For you and All (a direct
link still opens, with Undo). Order: targeted (newest notice), then in-reach by `hasMatchingStock` then newest, then
outside the reach.

## 13. App

Periwinkle v2 kit, `useTheme()`, `useType()`, `t()` with en / hi / gu parity and audit tests, `testID` on every
pressable, Indian amounts, part numbers in JetBrains Mono (`apps/user-app/CLAUDE.md` §1–2, §6, §8). Screens without a
mockup use `frontend-design` in the mockup's language. Rentals: the mockup's "A rental" segment is **left out** (two
segments) **(my call)**.

### 13.1 Screens (`build-periwinkle-v2.mjs` flow `requirements` ≈ l.587–639)

| Screen (route) | Mockup | Notes / states |
|---|---|---|
| Post a requirement, step 1 (`PostRequirement { prefill?, editId? }`) | "Post a requirement" | Kind segments (A part / A machine); category (sell wizard's category picker in a sheet); name; part number (optional, mono); side picker with the convention diagram (only with sides); quantity + unit (machines: none); Fits rows (sell's `fit-row-sheet`; label "Make and model" for machines). Edit mode loads the request; version conflict → reload sheet. |
| Step 2 | "Requirement details" | Conditions chips (all on); budget + "Show to sellers"; needed by + Urgent; Deliver to (read-only business place, "Change in Profile"); reach chips 50 km / 200 km / {state} / All India; Who can reply; Specifications (optional, collapsed, "Any"); photos (≤ 3); note; Valid for 7 / 15 / 30; fine print "We send it to up to {n} matching sellers. Your number stays hidden." Limit reached → notice with the open count instead of the button. |
| Preview → Posted (`RequirementPosted { partRequestId }`) | — | Preview as sellers see it; Posted: "We're telling up to {n} sellers now", "{k} listings already match" link (backfill count, refetched once after a few seconds). |
| My requirements (`MyRequirements`) | "My requirements" | Segments Active n / Fulfilled n / Closed; rows: side token or thumb, name, quantity + fit, "3 replies, 2 matches" / "Waiting for replies"; + New; empty state with Post. |
| Requirement (`Requirement { partRequestId, tab? }`), buyer role | "Replies and matches" | Header (name, side, qty, fits, status chip, Matched badge, "Sent to n sellers", days left); fulfil banner; segments Replies n / Auto matches n; reply cards (seller, verified, card, masked message, state); "Compare n"; menu Edit, Renew, Mark fulfilled, Close, Post again (copy into a new form, closed / expired / fulfilled). Calls `read` on open. |
| Compare (`CompareResponses { partRequestId }`) | "Compare replies" | Columns scroll horizontally beyond 3; lowest price marked; button per column opens `Listing { listingId, openSheet }` by its contact action (offer / buy / ask price; Enquire for none). |
| Requirement, seller role | "Seller sees a requirement" (card) | Card §12.3, photos, my replies with status ("Pending: goes when your listing is live", "Seen by buyer"), **Reply with my listing**, **Not relevant** (reason sheet), Report; no "Send a quote" (P2). Ineligible / gone → "This requirement is no longer open". |
| Reply with my listing (`ReplyWithListing { partRequestId }`) | — | Picker (fitting first, others greyed with reason), up to slots left, message (300), Send; **Create a new listing** → kind's draft via `POST /listings { kind, partRequestId }` → sell wizard. |
| Buyers looking for your parts (`BuyersLooking { forListing? }`) | "Seller sees a requirement" | Lead "Matched to your categories and stock."; segments For you / All / Replied; rows with Reply; empty: "No buyers looking right now" (+ explain eligibility: sell activity, categories, verification when `verified_only` hides most). |
| Close, Renew, Not relevant, Report sheets | — | Codes only. |

### 13.2 Changes to existing screens

- **Post tab:** "A requirement" card opens `PostRequirement` (replaces the coming-soon toast); row "My requirements".
- **Profile:** "My requirements · n active" and "Buyers looking for your parts · n new" (`requestsForYou`) rows (mockup
  account).
- **Home:** buyer side-match strip (mockup Home `.sidematch`: "2 right-side matches for your left tie rod end · From your
  part request, 6 km away") from `GET /part-requests/home`; seller strip "Buyers looking for your parts" (≤ 3 rows) for
  businesses with the `sell` activity or live listings.
- **No results** (`screens/search/results.tsx`): the mockup's prefill card "Post this as a requirement / Tell up to {n}
  sellers" under the empty state, prefilled from the query reading: category (part group / machine type; a machine
  category only seeds the picker), first part number, side, brand + model → a fit row, name = the reading's words
  (else the raw query) **(my call)**.
- **Other side block** (`other-side-block.tsx` ~l.37) and the Other side screen's callout: "Need the other side? Post a
  requirement", prefilled with the listing's category, name, part number base, `complementarySide(side)` and fits.
- **Published** (`screens/sell/published.tsx`): "{n} buyers are looking for this part" (`part-request-demand`; "We will
  tell them when it goes live" in review, "We've told them" when live) with "See their requirements" →
  `BuyersLooking { forListing }`; hidden at 0. Plus the pending-reply line (§9.3).
- **Guests:** `SIGN_IN_REASONS` + `request`; `PendingAction` + `{ type: 'post_request'; prefill: PartRequestPrefill }`;
  after sign-in and onboarding the form opens prefilled, never posting by itself.
- **Notifications:** `notificationLink` sends every `part_*` type to `Requirement { partRequestId, tab }`; push data
  carries `partRequestId`.

### 13.3 Foundation and analytics

`lib/part-requests-api.ts`; pure, tested: `lib/part-request-form.ts` (validation, prefill builders from reading / other
side / copy, reach labels), `lib/part-request-display.ts` (status chip, matched badge, days left, compare rows,
`requestSideAccepts` labels). Query keys `['part-requests', …]`, `['part-request', id]`; `part_request:` socket prefix
invalidates them. `REQUEST_EVENTS`: `request_post_started { source }`, `request_posted { kind, hasPartNumber, hasFit,
photos, reach, audience, validityDays, urgent }`, `request_post_failed { reason }`, `request_edited`, `request_renewed
{ days }`, `request_closed { reason }`, `request_fulfilled { fromPrompt }`, `request_compare_opened { columns }`,
`request_response_opened { source }`, `request_reply_sent { listings, created }`, `request_reply_withdrawn`,
`request_not_relevant { reason }`, `request_reported { reason }`. Ids and codes only; `partRequestId` is already in
`SCREEN_PARAM_ALLOWLIST`. No new native module.

## 14. Admin (R13)

| Page | Roles | Content |
|---|---|---|
| Part requests `/part-requests` (placeholder replaced) | `moderator`, `support` | Table: ref, name, kind, category path, buyer business, city, status, targeted, replies, matches, open reports, created, expires. Filters: status, kind, machine category, reported, date; search by business name / phone. Active first. |
| `/part-requests/[id]` | same | Fields as sellers see them plus budget and audience; note **masked**; photos (lightbox, 300 s); eligible-now count; targeted sellers (rank, score, pushed, opened, replied, not relevant); replies (listing link, seller, status, drop reason, masked message); matches (listing, seller, tier, km, pushed); reports; **Remove** / **Restore** with reason (danger confirm). |
| Reports & flags | `moderator`, `support` | New tab **Part requests** (shared report component; resolve actioned / dismissed). |
| Settings | super_admin | Section "Part requests" (§16). |
| Users & businesses › business | as today | "Part requests (n)" link to the filtered list. |

Admin API: `GET /admin/part-requests`, `GET /admin/part-requests/:id`, `GET /admin/part-requests/:id/photos`,
`POST /admin/part-requests/:id/remove { reason }`, `POST /admin/part-requests/:id/restore { reason }` (reasons
`ADMIN_REASON_MIN`–`MAX`); `GET /admin/reports?target=part_request` and the existing resolve. **Widening needed:**
today `AdminReportTarget` is `'conversation' | 'review'` in `services/reports/admin-reports.service.ts` (the type, the
list's target filter and `resolveReport`'s accepted targets) and in `routes/admin/reports.ts`'s query schema; all three
gain `part_request` (the row shows the request name masked and a link to its admin page). Audit
`part_request.remove`, `part_request.restore` (before / after status), `report.resolve`. `lib/status.ts` part-request
tones updated to the new statuses.

## 15. Errors (new codes)

`PART_REQUEST_NOT_FOUND`, `PART_REQUEST_STALE`, `PART_REQUEST_TRANSITION_NOT_ALLOWED`, `PART_REQUEST_NOT_ACTIVE`
(reply / not relevant on a closed one the seller can still see), `PART_REQUEST_OPEN_LIMIT`, `PART_REQUEST_DAILY_LIMIT`,
`PART_REQUEST_MAX_DAYS`, `VALIDITY_INVALID`, `UNIT_INVALID`, `CONDITION_INVALID`, `REPLY_EXISTS`, `REPLY_LIMIT`,
`REPLY_DAILY_LIMIT`, `REPLY_LISTING_INVALID` (`details.reasons` per listing), `REPLY_NOT_FOUND`, `REPLY_NOT_OPEN`,
`OWN_PART_REQUEST`, `DEAL_INVALID` (fulfil with a deal not of this buyer). Reused: `CATEGORY_INVALID`,
`CATEGORY_LOCKED`, `KIND_IMMUTABLE`, `SIDE_REQUIRED`, `SIDE_NOT_ALLOWED`, `SPECS_INVALID`, `UNIT_DECIMALS`,
`BRAND_INVALID`, `MODEL_INVALID`, `FITMENT_INVALID`, `ONBOARDING_INCOMPLETE`, `VIEWER_READ_ONLY`, `PHOTO_INVALID`,
`PHOTO_KEY_INVALID`, `TOO_MANY_PHOTOS`, `STORAGE_UNAVAILABLE`, `REPORT_EXISTS`, `REPORT_LIMIT`, `INVALID_CURSOR`,
`IDEMPOTENCY_KEY_REUSED`, `REQUEST_IN_PROGRESS`, `BUSINESS_BLOCKED` (reply to a blocked buyer reads as 404 instead:
eligibility). App copy for each in en / hi / gu.

## 16. Settings (`APP_SETTINGS`, int, admin Settings section "Part requests")

| Key | Default | Range | Meaning |
|---|---|---|---|
| `part_request_reach_n` | 15 | 1–50 | Sellers told per request (D5). |
| `part_request_open_limit_unverified` | 3 | 1–50 | Active requests, business without GST. |
| `part_request_open_limit_verified` | 15 | 1–200 | Active requests, GST-verified business. |
| `part_request_posts_per_day` | 5 | 1–100 | New requests a day (IST). |
| `part_request_validity_days_1` / `_2` / `_3` | 7 / 15 / 30 | 1–90 | Validity choices; `_2` default. |
| `part_request_max_days` | 90 | 7–365 | Open at most this long from the first post. |
| `part_request_expiring_notice_hours` | 24 | 1–72 | Reminder lead time. |
| `part_request_seller_push_daily_cap` | 10 | 0–100 | Request pushes a seller business gets a day. |
| `part_request_match_push_daily_cap` | 3 | 0–20 | Auto-match pushes per request a day. |
| `part_request_match_push_total_cap` | 20 | 0–200 | Auto-match pushes per request in all. |
| `part_request_reply_listings_max` | 3 | 1–10 | Listings per seller per request. |
| `part_request_replies_per_day` | 20 | 1–500 | Replies a seller business sends a day. |

`validateSettings()` cross-checks: `_1 < _2 < _3 ≤ part_request_max_days`; `expiring_notice_hours < _1 × 24`;
`match_push_daily_cap ≤ match_push_total_cap`. Weights, similarity thresholds and photo / fit maxima stay code.

## 17. Privacy and security (DPDP Act 2023, R9)

- **Masking:** `name`, `note`, reply `message` through `maskContact` on every read (buyer, seller, admin) and in
  notification params; stored text untouched; scam patterns flagged at write and shown as F6's warning.
- **Location:** sellers see city and whole km (snapped), never point, pincode, address line or industrial area id.
- **Photos:** private bucket, re-encoded with `sharp` (EXIF / XMP / GPS dropped: chat's `finalizePrivatePhotos`).
  `PhotoDestination` gains `{ kind: 'part_request'; partRequestId }` → `part-request/<id>/<uuid>.jpg`, and
  `finalizePrivatePhotos` takes a **per-destination limit** (chat 5, deal as today, part request 3; `TOO_MANY_PHOTOS`).
  It runs **before** the transaction (it reads and writes R2), so the request uuid is generated in code first and the
  row inserted with it; on an edit the existing id is used and keys already finalised are kept. Uploads reuse the
  `incoming-chat/<businessId>/` prefix and its 1-day lifecycle rule; 300 s signed URLs to the buyer, eligible sellers
  and moderator / support.
- **Budget** never leaves the API for sellers when private.
- **Push / analytics / logs / Sentry:** ids, codes and masked titles only; Sentry redaction adds `note`, `message`,
  `name` (request bodies), `photoKeys`; work-queue `last_error` holds error codes, not data.
- **Phone:** F8 never reveals it; contact happens only inside F6 threads.
- **Retention (open):** requests, replies, feedback and photos join the DPDP export / deletion list; photo deletion
  after closure is decided with the chat retention work.

## 18. Testing (limited, important)

API integration (real Postgres + Redis, fixtures deleted in `afterAll`, fake clock where noted):
1. **State machine:** every row of §9.1; stale version; renew cap at 90 days; renew from expired re-checks the open limit;
   restore of an `active` past expiry lands `expired`.
2. **Limits:** 4th active request unverified refused, 16th verified; 6th post of the day; reply caps (3 per request,
   daily); viewer refused on every write.
3. **Eligibility / privacy:** each §6 condition flips visibility to 404 (audience, block either way, buy-only business,
   own request, suspended buyer owner, closed); seller payloads never carry phone, pincode, point or private budget;
   note with Devanagari / Gujarati digits masked for buyer, seller and admin and in rendered notification text.
4. **Targeting:** top N by score with deterministic ties; a part-number holder outranks a profile-only seller; reach
   gate; edit pass never re-notifies and caps at 2N; running the pass twice notifies once; seller push cap → in-app row
   without delivery after 10; cap 0 → no push and no counter row.
5. **Auto matches:** side table (Left ← Left / Pair, Right ← Right / Pair, Pair ← Pair only); part number and base;
   name without fit vs with fit (no overlap → no match); machines by fit; reach (radius, state, all India); condition;
   available quantity 0 (reserved) no match; audience / block / own business; one match per pair across publish →
   pause → resume → renew → match-relevant edit (only new matches notify); at-post backfill without notification;
   daily and total push caps; a capped match updates the grouped row without bumping `version` (a queued allowed push
   still sends); the 200-request cap per listing row.
6. **Queue:** every listing path into `live` (publish auto-live, approve, resume, renew, relist, unhide, unreserve
   after a deal cancel), seller / admin remove, rejection, a live listing's match-relevant PATCH and `setMyLocation`
   enqueue exactly one unclaimed row; an enqueue while a row is claimed makes a new row and doesn't wait; a failing row
   retries in its own transaction without affecting the others and lands `failed_at` after 5 tries, after which a new
   enqueue still works; a stale claim is reclaimed.
7. **Pending replies:** `POST /listings { kind, partRequestId }` → prefilled draft (part group vs machine type → null
   category, side, fits; machine request → first fit in `listing_machines`) + pending, and each failed check (not
   eligible, caps, `DRAFT_LIMIT`) rolls back both; approve → delivered + notified after the full eligibility re-check
   (block, audience, suspended owner each drop with their reason); seller remove → dropped silently; admin remove →
   `listing_removed_by_team` + seller told; reject → `listing_rejected`; request closed first → dropped; draft deleted
   → rows gone.
8. **Fulfil prompt:** accept on a reply or match listing notifies the buyer business once (also when a buyer member
   accepted a seller's counter); on an unrelated listing nothing; inactive request nothing.
9. **Races:** two concurrent replies from one seller at the cap → one refused; close racing a reply → reply refused or
   dropped, never delivered on a closed request; expiry job and a renew concurrently; jobs run twice / concurrently
   (`SKIP LOCKED`).
10. **Notifications:** grouped rows bump and reset on `read`; dedupe; category `requests`.

App: pure `lib/` tests for form validation, prefill builders and display helpers; locale parity. Admin: list filters
and the remove dialog (Testing Library).

## 19. Build order (sketch; the plan details it)

C0 contracts (shared types, schema + migrations 0014 / 0015, settings, `notify` options and grouped rows, error codes,
route stubs) → API lanes: **L1** requests (CRUD, state machine, photos, limits, mine, options, expiry jobs); **L2**
matching (queue + `writeStatus` hook, targeting, auto matches, work job, caps, demand, home); **L3** seller side
(eligibility, for-sellers, replies incl. `POST /listings` extension and pending delivery, not relevant, reports,
fulfil prompt, badges); **L4** admin API → app lanes (buyer screens; seller screens + entry points) and admin pages →
integration walk-through and docs.

## 20. Changes to earlier documents and code

- `packages/shared-types`: `PART_REQUEST_STATUSES` (drop `matched`, add `removed`), `notificationCategory()`,
  `NOTIFICATION_CATEGORIES`, `NOTIFICATION_TYPES`, `REPORT_TARGETS`, `Badges`, `NotificationRow`, `ListingOwnerView`.
- API: `writeStatus` enqueue (live / removed / rejected); `patchListing` and `setMyLocation` enqueue for live
  listings; `POST /listings` body (`.strict() { kind, partRequestId? }`) and `createListing` prefill; `deleteDraft`
  (pending replies); `ListingOwnerView` (`partRequestId`, `pendingRequestReply`); F6 accept (fulfil prompt);
  `notify()` options (`partRequestId`, `push`, actor exemption); push-sender tag; `PhotoDestination` +
  `part_request` and the per-destination photo limit in `finalizePrivatePhotos`; admin reports (service type, list,
  resolve and route schema widened to `part_request`); F8 write services call `onboardingForUser`; settings
  validation.
- App: the sell wizard's category step scopes the part-group picker to a request's machine type when the draft has a
  `partRequestId` and no category.
- App: Post tab, Profile, Home, No results, Other side block / screen, Published, pending actions, sign-in reasons,
  notification links. Admin: nav entry unchanged (`/part-requests`), Reports tab, Settings section, `lib/status.ts`.
- `docs/product-scope.md` M11: status "matched" is a derived badge; quotes and rental requests P2 / M14; who-can-reply
  default settled (verified only); D5 is the `part_request_reach_n` setting. F2 spec R22 / Other side "Post a
  requirement" link now exists. `docs/PROJECT_STATUS.md` after the build.

## 21. Risks

- **Few verified sellers at launch:** the `verified_only` default may leave requests unanswered (open item for the client, §23).
- **Strict rules miss real matches** (names written differently, fit missing on listings); the targeting list and
  "All" tab are the safety net; tune with real data.
- **Profile-category noise:** sellers with only a profile category are targeted when stock-holders are few; the `sell`
  activity gate and Not relevant feedback limit it.
- **Catalogue moves** change subtrees under existing requests; eligibility reads paths live, so it follows.
- **Queue backlog** after bulk approvals: 20 rows / 10 s = 7 200 an hour; raise the batch if needed.

## 22. Deferred (P2 and later)

Send a quote; rental requests (M14); public Wanted tab and web pages; Ask a question; quick mode without login; paid
early access; seller alert settings (categories, radius, digest); spec-value scoring; mirror / cross-reference numbers;
quiet hours and digests; SMS / WhatsApp; request reference search; A1 KPIs (open requirements, match rate, fulfilment
time).

## 23. Open items (for the owner)

- **Client:** D5 reach 15; default "verified sellers only" vs launch supply; budget private by default.
- hi / gu copy of every new string checked by a native speaker.
- Device pass: post from No results as a guest → sign in → posted; seller push and cap; match push; reply with a new
  listing → delivered on approval; compare → offer.
- Admin pages in a browser.
- Quiet hours (M16 asks for 22:00–07:00 with urgent matches allowed) wait for the digest work.
- Request photo retention with the DPDP / chat retention decision.

## 24. Scope mapping

| ID | Where |
|---|---|
| U3 | §7 (post → active → checks new listings → sellers respond → buyer notified → listing → F6), §9.1 close / fulfil |
| F8 | request with name, specs, model, quantity, location (§5.1); Left / Right / Pair (§5.1, §7.4); active until fulfilled or closed (§9.1); new listings checked (§7.4, §8); notification (§10); open listing and contact (§13.1 Compare → F6); manage, edit, close (§9.1, §12.2) |
| F9 | "New matching part" (`part_match`), plus request notifications (§10) |
| M11 | form, matching with cap, listing replies, auto matches, alerts, compare, statuses; quotes → P2 |
| M2 / M6 / M8 / M12 / M17 | Home strips; Other side link; side rules; requirement alerts; "Buyers looking for your parts" |
| AD3 / AD6 | §14 requirements queue (post-hoc, no pre-screen), reports, settings |

## 25. Decisions marked (my call)

1. UI word "requirement", code `part_request`.
2. `ref` from #300001, display only.
3. Part requests may sit on a part group **or** a machine type.
4. Category edits stay within the machine category; kind fixed.
5. Specs validated ignoring required-missing, shown but not scored.
6. No "Other" model text in request fits; max 5 fits.
7. Location snapshot refreshed on every edit; business location only.
8. Budget private by default.
9. Close reasons are codes, no free text.
10. Eligibility: profile-category branch requires the `sell` activity; a suspended buyer's requests hide.
11. Targeting weights are code constants; reach is a gate for targeting, not for eligibility.
12. Edit passes notify newcomers only, total targets ≤ 2 × N.
13. Machine auto-match rule: fit overlap, else name similarity ≥ 0.5.
14. At-post backfill of auto matches (≤ 20) with no notification.
15. A listing already replied isn't also alerted as a match.
16. No trigram index on `name_norm` (category narrows first).
17. Reply fit = same kind, same machine category, side, condition; one reply per listing, withdraw final.
18. Pending reply created at draft creation (`POST /listings { partRequestId }`); draft prefill = identity fields only.
19. `part_request_reply_dropped` notification to sellers.
20. Renew allowed from `expired` (within 90 days), re-checking the open limit and re-targeting newcomers.
21. Restore sends no notification; restore past expiry lands `expired`.
22. Fulfil prompt "Not yet" hidden per device; no `offers.part_request_id`.
23. Not relevant reason codes; Not relevant hides from lists, direct link stays with Undo.
24. "Seen by buyer" on replies (`buyer_viewed_at`).
25. One `Requirement` route rendering buyer or seller by the API's `role`.
26. No seller socket; buyer gets `part_request:updated` on its business room.
27. Rental segment left out of the form.
28. No-results prefill name = reading words, else raw query.
29. Queue as one `part_request_work` table with two kinds; reminder and expiry as separate hourly jobs.
30. Photo uploads reuse `incoming-chat/` and the chat re-encode pipeline.

## 26. Review changes (2026-11-20)

An independent review checked this spec against the code; the coordinator's rulings on its questions are final.

| # | Change | Where |
|---|---|---|
| 1 | Work queue: claim committed in a short transaction (`claimed_at`), then **one transaction per row** (as `offer-jobs.ts`); unique predicate on unclaimed rows only, so enqueues never wait on the job and a mid-processing event makes a new row; retries release the claim (or close the row when a newer one exists); 5 failures → `failed_at` dead letter outside the predicate; stale claims reclaimed. | §5.7, §7.6, §8.1, §8.2 |
| 2 | Push-count upserts sorted by business id. | §7.5 |
| 3 | Lock order corrected: F8 takes no explicit listing lock, but reply / match / target inserts take `KEY SHARE` on listings via FKs; real order request → listing (KEY SHARE) → child rows; why it can't cycle stated. Requests never locked `FOR UPDATE`. | §8.2, §9.5 |
| 4 | One `listing_changed` row matches at most 200 requests, newest first. | §7.4, §7.6 |
| 5 | Subtrees by slug path prefix (`path LIKE`, as `discovery/filters.ts`); `businesses.categories` is a jsonb id array (`@> jsonb_build_array(root.id::text)`); eligibility SQL written out. | §6, §7.4 |
| 6 | `requireUser` doesn't check onboarding; F8 write services call `onboardingForUser`. | §6, §12 |
| 7 | Expiry and reminder jobs: per-request transactions, `FOR NO KEY UPDATE SKIP LOCKED`. | §8.2 |
| 8 | Admin reports: the service type, list, resolve and route schema all widened to `part_request`. | §14, §20 |
| 9 | Partial and partial-unique indexes declared in `schema.ts` (generated 0014); custom 0015 only CHECKs and the sequence restart. | §5.1, §5.9, §5.10 |
| 10 | Draft delete is `deleteDraft`. | §9.3, §20 |
| 11 | `POST /listings` `.strict() { kind }` → `{ kind, partRequestId? }` and the prefill specified as new work. | §9.3, §12.2, §20 |
| 12 | Photos: `PhotoDestination` + `part_request`, per-destination limit (3), uuid generated before the transaction. | §12.2, §17 |
| 13 | Push cap 0: no insert, no push. | §7.5, §18 |
| 14 | Notification text and stored match distance use snapped km (`snappedKmSql` rule). | §7.4, §10.3 |
| Q1 | Grouped rows: per-event dedupe keys; ON CONFLICT on the open-row partial unique index updating count and latest params; `version` bumped only when the event is pushed. | §10.2, §18 |
| Q2 | `part_request_fulfil_prompt` exempt from "never the actor": always to the buyer business. | §10.1, §18 |
| Q3 | Live listings' match-relevant edits (PATCH fields, quantity rising from 0, `setMyLocation`) enqueue `listing_changed`; only new matches notify. A rejected pending draft drops its reply (`listing_rejected`). | §5.4, §7.1, §8.1, §9.3 |
| Q4 | Prefill: part group → that category; machine type → null and the wizard scopes the picker via the request (`ListingOwnerView.partRequestId`); machine request → first fit into `listing_machines`; side copied; ordered checks in one transaction, all-or-nothing. | §9.3, §20 |
| Q5 | Request edits keep delivered replies and matches without re-check; delivering a pending reply re-checks full eligibility (`not_eligible` and the other reasons). | §5.4, §7.4, §9.3 |
| Q6 | Home buyer strip: the active request with the most recent unseen item; `newCount` since `buyer_seen_at` (new column). | §5.1, §10.2, §12.2 |
| Q7 | Drop reasons `listing_removed` (seller, silent) vs `listing_removed_by_team` (admin, seller told), from the latest status-history actor. | §5.4, §9.3 |
| Q8 | Admin restore: no open-limit re-check, no re-targeting, no backfill; `expired` if past `expires_at`. | §9.1 |
