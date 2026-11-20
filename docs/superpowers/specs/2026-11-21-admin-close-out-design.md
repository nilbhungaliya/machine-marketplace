# Admin close-out: AD1 dashboard, AD6 reports / fraud signals / exports, AD7 admin users + audit log — design

Date: 2026-11-21. Status: **draft for review** (owner delegated every design decision, as for F6 + F7, F8 and M14).
The builder check's eight answers (2026-11-21) are folded in (R8, R9, R9a, §5, §6.2, §7, §8, §11, §13, §18, §24 #23–#30).
Rulings R1–R18 are final in substance unless the review changes them; smaller calls are marked **(my call)** and
listed in §24.

Scope IDs: **A1** (dashboard), **A6** (reports and controls: user / business reports, listing reports, fraud / abuse
flags, activity reports, marketplace performance), the "Manage reported users" line of **A2**, flow **U4** in
`docs/product-scope.txt`; modules **AD1** (dashboard), **AD6** (reports and controls, MVP basic) and **AD7** (settings,
roles and audit log) in `docs/product-scope.md`. AD5 was finished by M14. Out of AD6 here: featured / promotional
listings (M18), notification broadcast (P2), quiet hours (digests, F8 open item).

**Textile first (owner rule).** The textile project (`C:\Users\Dell\Desktop\textile stock marketplace` on this
machine; the `E:\textile-marketplace` path in `CLAUDE.md` doesn't exist here) built the same
pieces for one admin account; this spec ports them and adds what a multi-role team needs. Followed, by source:
- `docs/superpowers/specs/2026-11-11-part5-m8-admin-dpdp-design.md` §7.3 (dashboard: "Today's work", "Right now", "In
  the selected period" against the previous period, trend, compare by city / section; India days and weeks; Analytics
  page folded into the dashboard) and §7.4 (audit log viewer: filters, before / after with changed keys, phones and
  emails masked by default, a per-entry "Show" that is itself audit-logged, read-only). Code:
  `apps/api/src/services/admin-insights/dashboard.ts`, `audit-log.ts`, `audit-labels.ts`,
  `apps/api/src/routes/admin/dashboard.ts`, `audit-log.ts`.
- `docs/superpowers/specs/2026-11-08-part3-m19-m11-m10-design.md` §4.2 (business reports: reasons, one open per
  reporter, the reported side never told, no automatic effect), §4.5 (advisory fraud flags: one open per business and
  kind, evidence appended, `open` → reviewed / actioned with a note, raised by a job never in the request), §4.7 (one
  Reports and fraud page with tabs). Code: `services/trust/flags.service.ts` (`raiseOrAppendFlag`, the evidence key
  and `acrossClosed`), `services/trust/flags.consumer.ts`, `services/reports/business-report.service.ts`,
  `routes/admin/flags.ts`.
- Textile has **no** admin-user management (one account, §7.1 there), no activity exports and no device or phone
  signals: AD7's admin users, the exports and three of the five signal kinds are ours, built on our own patterns
  (`loadActiveUser` per request, F1 + A2 R5; `lib/csv.ts`; `lib/mask-contact.ts`; the settings registry).

---

## 1. Why

The admin panel runs every queue but cannot answer "how is the marketplace doing?" (the dashboard tiles say "—"), the
team can't be grown (accounts are created on the server by the seed script, and a removed staff member's token keeps
working for 12 hours), nobody can read the audit log that every mutation has written since A4, a scammer running three
accounts from one phone or pasting UPI handles into every chat is visible only by luck, there is no way for a user to
report a business, and the client can't take data out for a meeting. This feature closes the last MVP admin modules so
the team can launch with a working control room.

## 2. Goals, non-goals, anti-goals

**Goals**
1. **AD1:** one dashboard every admin opens each morning: what waits on *their* role today, the marketplace right now,
   and the selected period against the one before, with charts (enquiries → offers → deals, deal value, rental
   bookings) and a breakdown by city, industrial area and machine category; filters for date range, city, industrial
   area and machine category.
2. **AD6 reports:** one Reports & flags page that shows every report target (businesses, listings, conversations,
   reviews, part requests) and the fraud signals; users can **report a business** from the app.
3. **AD6 fraud signals:** a job turns four behaviours into advisory signals per business (many accounts on one phone,
   one phone number spread across businesses or chats, payment / bank details in chat, a new account contacting many
   businesses at once) plus "reported by many", each with masked evidence and an open → dismissed / actioned review.
4. **AD6 exports:** CSV of businesses, listings, deals, rental bookings and part requests with the list page's
   filters; role-gated, capped, streamed, audit-logged, contact details excluded by default.
5. **AD7:** super admins invite admins, change roles, deactivate / reactivate, reset passwords and sign admins out;
   every change takes effect on the admin's **next request**. Every admin can change their own password.
6. **AD7 audit log viewer:** filter, read before / after with the changed fields, follow a link to the target, export
   the list (without snapshots); sensitive values masked until an audit-logged "Show".

**Non-goals:** promotions and plans (M18), notification broadcast (P2), quiet hours, DPDP data export / deletion
(launch hardening), admin two-step login (open item §23, strongly recommended before launch), email delivery of
invites (no provider), sanctions ladders or automatic penalties, per-record history panels for non-super roles,
rollup tables, IP-based signals.

**Anti-goals (a failure even if it works):**
- A signal that hides, limits or penalises a user by itself, or tells the reported side anything.
- A raw phone number, message text, PAN or street address in a signal, an export by default, or the audit viewer's
  first view.
- A deactivated or demoted admin still acting with an old token.
- The last active super admin locked out (demoted, deactivated or reset with no other super admin).
- A dashboard number whose definition differs between the tile, the chart and the breakdown.
- An export that silently truncates.

## 3. Approaches

| # | Question | Options | Verdict |
|---|---|---|---|
| A | Dashboard numbers | **(a) SQL aggregates on read + 60 s Redis cache**; (b) a nightly `dashboard_daily` rollup table; (c) materialized views refreshed by a job | **(a)**, as textile. Volumes are small at launch; one definition per metric lives in one SQL builder; nothing to backfill or drift. (b) when a 90-day query passes ~500 ms or `listings` passes ~100 k rows (open item). (c) needs `REFRESH … CONCURRENTLY` plumbing for no gain over (b). |
| B | Fraud signals | **(a) a scheduled job over watermarks and two small "sightings" tables**; (b) inline checks in the message / sign-in write paths; (c) an event consumer (textile's `trust-flags` on its outbox) | **(a).** We have no outbox; (b) would put work and new failure modes into F6's send path and reopen its tests; a 10-minute delay is fine for advisory signals. |
| C | Ending admin sessions | **(a) load the admin row on every request (active, role, `token_version` = the token's `tv`)**; (b) short JWT + refresh tokens; (c) a Redis denylist | **(a)**, the user-side pattern already in production (`loadActiveUser`, F1 + A2 R5): one primary-key lookup, role changes and deactivation apply at once, no new token kind. |
| D | Inviting admins without email | **(a) a one-time set-password link the super admin copies and sends**; (b) a temporary password shown once; (c) wait for an email provider | **(a):** the inviter never knows the password, the link is single-use and expires, and the same mechanism serves resets. |
| E | Listing reports | (a) move them into Reports & flags; **(b) show them there read-only, resolve stays in Listing moderation**; (c) leave them out | **(b):** AD6 wants one place to see every report, but F2's review screen (photos, specs, history, `edited_after_report`) is where a listing report is decided; no F2 code moves. |

## 4. Rulings

| # | Ruling |
|---|---|
| R1 | **Dashboard access:** every admin role sees the dashboard, money tiles included (aggregates hold no personal data). "Today's work" shows only the queues the role can open (nav rules), each a link. **(my call: no money restriction)** |
| R2 | **One definition per number (§6.2).** Listing-side numbers (listings, enquiries, offers, deals, bookings, sold / closed) take city, industrial area and machine category from the **listing**; requirement numbers from the **request**; business numbers from the **business** (category = the business's `categories` contains the machine category). Days and weeks are IST (`lib/ist.ts`), weeks start Monday. |
| R3 | **Periods:** 7 / 30 / 90 days ending today, or custom (≤ 366 days); each period number is shown with the same-length period just before it (count delta in %, rate delta in points). Trend granularity: daily up to 31 days, weekly beyond **(my call)**. |
| R4 | **Computed on read, cached 60 s in Redis** per filter combination (role-independent); `generatedAt` in the response and on the page. "Today's work" is not cached. Rollups later (§3 A). |
| R5 | **The Analytics placeholder goes:** the dashboard is AD1 and "Activity & KPIs" (`/analytics`) is removed from the nav; the route redirects to `/` (textile §7.3). Promotions and Notifications placeholders stay (M18 / P2). |
| R6 | **Report a business (app):** from the listing page's seller block and the seller reviews screen; reasons `fake_business`, `scam_or_advance_payment`, `abusive`, `impersonation`, `other`; details ≤ 500; uses the existing `reports` table (`target_type` `business`, already in the enum: no migration), the existing one-open-per-reporter index (`409 REPORT_EXISTS`) and daily limit; a business can't report itself (`400 CANNOT_REPORT_SELF`); the reported side is never told; **no automatic effect** (textile §4.2). The unused `user` target stays unused: the business is the unit until teams (P2). |
| R7 | **Reports & flags** gets tabs **Fraud signals, Businesses, Listings, Conversations, Reviews, Part requests**. Listings is read-only and each row opens the listing's moderation review, where resolve stays (§3 E). The nav item gets a badge: open reports (all targets) + open signals. |
| R8 | **Fraud signals are advisory** (textile §4.5): one open signal per business and kind (partial unique index), new evidence appended (≤ 50 items, oldest dropped), statuses `open` → `dismissed` or `actioned` with a note (audit-logged). They never change what users see. Acting (suspend, remove a listing, hide a review) uses the existing tools, linked from the signal. **Closing consumes the evidence (quiet reading):** once a signal is dismissed or actioned, everything seen up to its `reviewed_at` is spent; a new signal of the same business and kind needs the **full threshold again** from evidence seen after that close. **(my call)** |
| R9 | **Signal kinds (§8):** `shared_device` (≥ 3 **distinct businesses** signed in on one install in 30 days; two staff of one business on one phone are fine), `repeated_phone` (one phone number posted in chat by ≥ 2 businesses, or by one business in ≥ 10 threads, in 30 days; **the sender's own phones never count**: their login phone, their business's contact phone and every member's login phone), `payment_details` (≥ 2 chat messages from the business with a UPI link / handle, payment link, advance ask or bank details in 30 days), `new_account_burst` (a business ≤ 7 days old that contacted ≥ 8 distinct businesses in any 24 h), `reports_against` (≥ 3 reports with status `open`, `reviewing` or `actioned`, never `dismissed`, from distinct businesses in 30 days against the business or anything it owns; a conversation report counts against **the other business in the thread**, never the reporter). Thresholds are settings (§12). |
| R9a | **Scan windows:** every rule reads only rows created before `now() − 2 minutes` (commit-lag margin) from a per-rule watermark in `fraud_scan_state` (`last_seq` for chat messages, `last_at` for the others); a watermark advances only to the highest row actually taken, so a transaction committing late within the margin is still seen, once. The first run starts **30 days back** (bounded backfill), not at the beginning of history. **(my call)** |
| R10 | **No raw identifiers are stored for signals:** phone numbers as HMAC-SHA-256 with `SIGNAL_HASH_KEY` (a plain hash is reversible over 10-digit numbers, textile §8.2), install ids as SHA-256 (random UUIDs, not personal). Without `SIGNAL_HASH_KEY` the phone rule is off and the job logs it once (opt-in like Sentry / push) **(my call: not a start-up requirement)**. Evidence never holds message text: it holds kind of match, time, thread / message refs and counts. |
| R11 | **Reading an evidence thread:** the F6 conversation reader's gate gains one source: an **open fraud signal whose evidence cites the thread** (moderator, support; reason required; the `thread.read` audit row names the signal). Nothing else in the gate changes. |
| R12 | **Exports:** you can export what you can list (same role as the list route), with the list's filters; ≤ 10 000 rows, else `400 EXPORT_TOO_LARGE` with the count (never silent truncation); streamed CSV (`lib/csv.ts` cell rules: BOM, formula neutralised); 10 exports per 10 min per admin; every export writes `export.create` (sheet, filters, row count, contacts flag; never data). **Contact details** (owner phone, email) only in the businesses sheet, only for `super_admin`, only with `includeContacts=1`; PAN, street addresses, notes, messages, private budgets and site addresses never **(my call)**. |
| R13 | **Admin sessions (AD7):** the admin JWT carries `tv`; `requireAdmin` / `requireAdminRole` and the `/admin` socket handshake load the row on every request: missing, inactive or `token_version ≠ tv` → `401 ADMIN_SESSION_ENDED`; the **role comes from the row**, not the token. Deactivate, reset password, password change, role change and "sign out" bump `token_version` and drop the admin's sockets (same-process limit as users, open item). |
| R14 | **Admin users (super_admin only):** invite (name, email, role) → a set-password link valid 48 h; change name / role; deactivate / reactivate (reason); reset password (clears the password, bumps the version, new link); sign out everywhere. **Never** on yourself (role, deactivate, reset: `409 ADMIN_SELF_ACTION`), and never leaving zero active super admins (`409 ADMIN_LAST_SUPER_ADMIN`, serialised by an advisory lock). Admin rows are never deleted (audit references). |
| R15 | **Passwords:** 12–128 characters, not the email; bcrypt cost 12 for new hashes; links are 32 random bytes, stored as SHA-256, single-use, the newest one per admin wins; the token travels in the URL fragment (`/set-password#t=…`) and a POST body, never a query string or a log line. Login: after 5 failures for one email in 15 min, `429 TOO_MANY_ATTEMPTS` for 15 min (also for unknown emails, so nothing is probed) **(my call)**. |
| R16 | **Audit log viewer: super_admin only** (textile: the one account), read-only, no route edits or deletes. Snapshot values are masked in the detail by default (`maskContact` on strings + whole-value masking of sensitive keys: phone, email, PAN, address, GST address, site address); "Show hidden values" returns the entry unmasked and writes `audit.reveal` (entry id, action; no values). CSV export of the filtered list carries **no snapshots**. |
| R17 | **New-account limits (AD6 setting line) already exist:** every new account is unverified until GST, and the unverified limits are in the registry (`unverified_listing_cap`, `offer_open_limit_unverified`, `enquiry_new_per_day_unverified`, `part_request_open_limit_unverified`, `rental_open_limit_unverified`). No new limit; the Settings page groups them under a "New accounts (unverified)" note **(my call)**. Listing expiry and the requirement seller cap are already settings. |
| R18 | **Testing (limited, important):** session ending and the super-admin guards under races, password links, dashboard definitions at IST boundaries and filter attribution, each signal rule at and below its threshold and the job's idempotence / watermark, no raw phone stored, export role / cap / contact rules, audit masking and reveal, business report rules. Not chart wiring. |

---

## 5. Data model

One generated migration (**0018**) and one `--custom` migration (**0019**: CHECKs, the lowercase-email CHECK). No
change to `reports` (the `business` target exists).

### 5.1 `admin_users` (changed)
`password_hash` becomes **nullable** (an invited admin has none until the link is used; login refuses null with the
generic error) **(my call)**; new columns `token_version int NOT NULL DEFAULT 0`, `password_set_at timestamptz`,
`last_login_at timestamptz`, `deactivated_at timestamptz`, `deactivated_by_admin_id uuid → admin_users`,
`created_by_admin_id uuid → admin_users`. Status is derived (`ADMIN_USER_STATUSES`): `deactivated` (`is_active =
false`); `invited` (`password_hash IS NULL` and `last_login_at IS NULL`: never signed in); `reset_pending`
(`password_hash IS NULL` and `last_login_at` set: a reset link is out); else `active`. The seed sets `password_set_at`. 0019: `CHECK (email = lower(email))` (the
seed and login already lowercase).

### 5.2 `admin_password_tokens`
`id`, `admin_id → admin_users`, `token_hash text UNIQUE` (SHA-256 hex), `purpose` (`invite` | `reset`, text + CHECK),
`expires_at`, `used_at`, `created_by_admin_id → admin_users`, `created_at`. Issuing a link sets `used_at = now()` on
the admin's other unused tokens (newest wins). Deleted 7 days after use or expiry (§9).

### 5.3 `fraud_signals`
`id`, `business_id → businesses`, `kind fraud_signal_kind`, `status fraud_signal_status` (`open` | `dismissed` |
`actioned`, default `open`), `evidence jsonb` (array of `FraudEvidence`, ≤ 50, CHECK in 0019), `evidence_count int`
(all ever appended, so "12 pieces, 50 shown"), `first_seen_at`, `last_seen_at`, `reviewed_by_admin_id`, `reviewed_at`,
`note`, `created_at`, `updated_at`. Partial unique `(business_id, kind) WHERE status = 'open'`; index
`(status, last_seen_at DESC)`. `FraudEvidence = { key, at, summary, refs: { threadId?, messageId?, businessIds?,
userIds?, reportIds?, groupId? } }`: `key` dedupes (textile's evidence key), `groupId` is the first 8 hex characters of
the phone HMAC or install hash so an admin can see two signals are about the same phone / install, never the value.

### 5.4 Sightings and the scan watermark
- `install_sightings`: `install_hash text`, `user_id → users`, `first_seen_at`, `last_seen_at`, PK `(install_hash,
  user_id)`. Written (upsert) on a successful OTP sign-in and on `PUT /users/me/devices`, from the `X-Install-Id`
  header the app already sends on every request (`apps/user-app/lib/api.ts`); a missing or non-UUID header writes
  nothing. Needed because `user_devices.install_id` is unique and **moves** to the latest user (F6 §11.6), so it can't
  show history.
- `contact_sightings`: `id bigserial`, `phone_hmac text`, `business_id → businesses` (the sender's), `thread_id →
  chat_threads`, `message_id → chat_messages`, `seen_at`. Index `(phone_hmac, seen_at)`, `(business_id, seen_at)`.
- `fraud_scan_state`: one row per rule source (`rule text PK`: `chat_messages`, `install_sightings`,
  `new_account_burst`, `reports_against`), `last_seq bigint` (chat messages, over `chat_messages.seq`) or `last_at
  timestamptz` (the others; CHECK exactly one set, 0019), `updated_at`. A missing row means "start 30 days back"
  (R9a).
- `fraud_signals` closed rows keep `reviewed_at`: the rules read evidence only after the latest close of that
  business and kind (R8).
- Sightings are deleted after 90 days (§9).

### 5.5 `audit_log` (indexes only)
`(created_at DESC, id DESC)`, `(entity_type, entity_id)`, `(admin_id, created_at DESC)`. `admin_id IS NULL` means
**System** (none today; ready for jobs).

### 5.6 Dashboard indexes (only those missing)
Btree on the period columns the dashboard scans: `chat_threads(created_at)`, `offers(created_at) WHERE round = 0`,
`deals(accepted_at)`, `rental_bookings(confirmed_at)`, `listing_status_history(to_status, created_at)`,
`part_requests(first_posted_at)`, `businesses(created_at)`. C0 checks each against the schema and adds only the
missing ones.

### 5.7 Shared types (`packages/shared-types`, section "Admin close-out")
`DASHBOARD_RANGES`, `AdminDashboardQuery`, `AdminDashboard` (`snapshot`, `period` metrics as `{ value, previous }`,
`trend[]`, `breakdown`), `AdminWorkCounts`, `DashboardOptions`; `ADMIN_USER_STATUSES`, `AdminUserRow`,
`ADMIN_PASSWORD_MIN = 12`, `ADMIN_PASSWORD_MAX = 128`, `ADMIN_LINK_HOURS = 48`; `AuditLogRow`, `AuditLogDetail`
(`changedKeys`, `masked`), `AuditLogPage`, `AuditLogFacets`; `FRAUD_SIGNAL_KINDS`, `FRAUD_SIGNAL_STATUSES`,
`FraudEvidence`, `FraudSignalRow`, `FraudSignalDetail`; `BUSINESS_REPORT_REASONS`; `AdminReportTarget` gains
`business` and `listing`; `EXPORT_SHEETS = ['businesses', 'listings', 'deals', 'rental_bookings', 'part_requests']`,
`EXPORT_ROW_CAP = 10_000`; the 8 settings (§12); the error codes (§14).

## 6. AD1 dashboard

### 6.1 Page sections (top to bottom)
1. **Filters:** range segmented control (7 days / 30 days / 90 days / Custom with two dates), City, Industrial area,
   Machine category; chips with clear; all in the URL (`use-url-state`).
2. **Today's work** (`GET /admin/dashboard/work`, role-filtered, live counts, each a link): listings to review (+
   reported), verification waiting, open disputes, open reports, open fraud signals. A role with none sees no row.
3. **Right now** (snapshot; the date range doesn't apply, the place / category filters do): businesses (onboarded,
   subline "n GST-verified · m users"), active listings, parts available, machines for rent ("n machines out today"), open
   requirements.
4. **In the period** (tiles with value, previous and delta): new businesses, new enquiries, offers, deals (count,
   subline agreed value), deals completed, rental bookings (confirmed, subline agreed value), sold / closed listings,
   requirements posted (subline match rate), median requirement fulfilment, reply rate within 24 h (subline median
   first reply).
5. **Charts** (Recharts, palette colours only): "Enquiries → offers → deals" (three lines per day / week), "Deal value"
   (bars, ₹ in lakh / crore), "Rental bookings" (bars).
6. **Breakdown** table with a switch **City / Industrial area / Machine category**: top 10 by active listings, columns
   active listings, new listings, enquiries, deals, deal value, change in deals; a row click sets that filter (textile
   §7.3 "Compare").

`StatCard` gains `delta` (`+12%` / `−3 pts`) with a tone: green up, red down, grey flat or no previous; every period
KPI is "up is good" (closes the PROJECT_STATUS item "give `StatCard` a tone").

### 6.2 Definitions (one SQL builder per metric, `services/admin-insights/dashboard.ts`)

| Metric | Definition |
|---|---|
| Businesses | businesses with a trade name and an `active` owner; verified = `gst` in `verification_levels`; users = `active` users |
| Active listings | status `live`, `reserved` or `rented` |
| Parts available | kind `part`, status `live`, `quantity − held_quantity > 0` |
| Machines for rent | kind `machine_rental`, status `live` or `rented`; **out today** = Σ `machines` over bookings `on_rent`, or `disputed` from `on_rent`, whose counted span (M14 §5.7: earlier of start and on-site day → later of end and today) covers IST today; never a count of `rented` listings **(my call)** |
| Open requirements | part requests `active` |
| New businesses | businesses created in the period that have a trade name |
| New enquiries | `chat_threads` created in the period (a thread opened by a booking request counts) |
| Offers | first offers (`round = 0`, buy-at-price included) created in the period |
| Deals | deals with `accepted_at` in the period; value = Σ `total_paise` of those not `cancelled` ("agreed, paid outside the app") |
| Deals completed | deals with `completed_at` in the period |
| Rental bookings | bookings with `confirmed_at` in the period; value = Σ `agreed_total_paise` of those not `cancelled` |
| Sold / closed | distinct listings with a `listing_status_history` row to `sold` (sold) or `unavailable` (closed) in the period |
| Requirements posted | `first_posted_at` in the period; match rate = share with ≥ 1 delivered reply or a match |
| Fulfilment | median hours from `first_posted_at` to `fulfilled_at`, requests fulfilled in the period |
| Reply rate | threads created in the period and at least 24 h old: share with `first_seller_reply_at ≤ created_at + 24 h`; median first reply over those answered |

City / area / category attribution per R2 (machine category = the root of the listing's or request's category path:
`c.path = root.path OR c.path LIKE root.path || '/%'`). Rental bookings use the listing's city (the machine's base),
not the site **(my call)**.

### 6.3 Routes (any admin; reads, no audit row)
- `GET /admin/dashboard?range=7d|30d|90d|custom&from&to&city&industrialAreaId&categoryId` → `AdminDashboard`
  (cached 60 s; `400 DASHBOARD_RANGE_INVALID` for a bad custom range).
- `GET /admin/dashboard/work` → `AdminWorkCounts` for the caller's role (keys the role can't open are absent).
- `GET /admin/dashboard/options` → cities (top 50 by active listings), active industrial areas, machine categories
  (roots).

## 7. AD6 reports

### 7.1 Report a business (app + API)
`POST /businesses/:id/reports` (user JWT, onboarded) `{ reason, details? }`. **A `viewer` member may report a
business:** listing reports allow viewers while conversation, review and part-request reports refuse them; business
reports follow listings, since reporting is a safety action **(my call)**. Returns `{ data: { reportId } }`. Rules per R6; the daily limit is listing reports' (10 per user
per 24 h, `429 REPORT_LIMIT`, `listing-reports.service.ts`); the target must be an onboarded business (`404
BUSINESS_NOT_FOUND`); a block between the two doesn't stop a report. App: a "Report this business" row in the seller
block's menu on the listing page and in the seller reviews screen's header menu; a sheet reusing the listing report
sheet (`screens/listing/report-sheet.tsx`) with the business reasons; a guest gets the sign-in sheet (no pending
action, **my call**); copy in en / hi / gu.

### 7.2 Admin queue (`services/reports/admin-reports.service.ts`)
`ADMIN_REPORT_TARGETS` gains `business` and `listing`. A business row: business name (link to its admin page),
reporter, reason, details as stored (staff, as review reports), age, status; resolve `actioned` / `dismissed` with a
note (existing `report.resolve`). A listing row: listing ref and title, seller, reason, age; **Open review** goes to the
listing's moderation review; `POST /admin/reports/:id/resolve` on a listing report → `409 REPORT_RESOLVE_ELSEWHERE`.
`GET /admin/reports/count` → `{ reports, signals }` (open) for the nav badge (`reportsOpen`, polled like the others).
Roles unchanged: `moderator`, `support`.

### 7.3 Business detail additions
"Reports (n)" (open and reviewing reports against the business itself and its listings, part requests and reviews
it wrote, plus conversation reports filed by **the other business** in a thread it is in (its own reports of others
never count against it), counted per target with links to the filtered tabs) and "Fraud signals (n)" (open signals
inline, with a link to each).

## 8. AD6 fraud signals

### 8.1 Detection (`services/fraud/`)
| Kind | Source | Rule (window = `fraud_window_days`, default 30) | Evidence item |
|---|---|---|---|
| `shared_device` | `install_sightings` | an install hash with ≥ `fraud_device_accounts` (3) **distinct businesses** (users joined to their business) seen in the window: a signal on **each** of them; several members of one business on one phone count once | the other businesses and users (names, links), `groupId`, first / last seen |
| `repeated_phone` | `contact_sightings` | one `phone_hmac` from ≥ `fraud_phone_businesses` (2) businesses (signal on each), or from one business in ≥ `fraud_phone_threads` (10) threads; **own phones excluded**: a sighting whose HMAC equals the sender business's contact phone or the login phone of any of its members is not stored (the sender's own number leaking before a deal is masking's job, not fraud) | thread refs, the other businesses, `groupId`, counts; never the number |
| `payment_details` | chat messages | ≥ `fraud_payment_messages` (2) of the business's messages match: `looksLikeScam` (UPI link / handle, pay host, advance ask) or **bank details** (an IFSC `[A-Z]{4}0[A-Z0-9]{6}` or an account-number phrase + 9–18 digits) | message + thread ref, match kind (`upi_link`, `upi_handle`, `pay_host`, `advance_ask`, `bank_details`), time |
| `new_account_burst` | threads, part-request replies | a business created ≤ `fraud_new_account_days` (7) ago that started threads with or replied to requests of ≥ `fraud_burst_contacts` (8) distinct businesses in any 24 h | the 24 h window, the count, the first thread refs |
| `reports_against` | `reports` | ≥ `fraud_reports_against` (3) reports with status `open`, `reviewing` or `actioned` (never `dismissed`) from distinct businesses in the window, against the business itself, its listings or part requests, reviews it wrote, or a conversation it is in (a conversation report counts against **the other business in the thread**, never the reporter) | report refs and targets |

Phone extraction: `findPhones(text)` in `lib/mask-contact.ts` (the same `PHONE` pattern, so the masking detector and
the signal never disagree), digits normalised to ASCII (Devanagari / Gujarati), prefix stripped, the last 10 digits
HMAC-ed. Bank details: a new `paymentDetailKinds(text)` beside `looksLikeScam` in `services/chat/scam-patterns.ts`;
the user-facing scam warning is **not** changed by this feature (F6 behaviour untouched; widening it is an open item).
Only user messages (`sender_side` set, text present) are scanned; offer, deal and rental notes, request notes and reply
messages are later (§22).

### 8.2 The `fraud-signals` job (every 10 min)
1. Takes a session advisory lock (`pg_try_advisory_lock(hashtext('fraud-signals'))`); if held elsewhere, skips the
   run, so two API instances never run it at once **(my call; this job is multi-instance safe from day one)**.
2. **Scan (R9a):** chat messages with `seq > last_seq` **and** `created_at <= now() − 2 min`, up to 5 000 in `seq`
   order; inserts `contact_sightings` (own phones skipped) and collects payment matches; advances `last_seq` to the
   highest `seq` taken, in the same transaction as the inserts. A message from a transaction that committed late
   (a lower `seq` than one already visible) is still above the watermark if it lands within the 2-minute margin, so it
   is scanned once; nothing is scanned twice. The other sources (`install_sightings` by `last_seen_at`, threads and
   replies of young businesses by `created_at`, `reports` by `created_at`) use their own `last_at` watermark with the
   same margin. A missing watermark row starts 30 days back.
3. **Evaluate** each rule for the businesses touched since the last run (new sightings, new payment matches, new
   threads / replies by young businesses, new reports); one short transaction per business and kind. The rule counts
   only evidence seen **after the latest close** (`reviewed_at`) of a signal of that business and kind (R8, quiet
   reading), so a new signal needs the full threshold again; then `INSERT … ON CONFLICT (business_id, kind) WHERE
   status = 'open' DO UPDATE` appends evidence whose `key` is not already on the open signal. No business row lock
   (signals are their own rows; no lock-order interaction with F6 / F8 / M14).
4. A failed business is logged and retried on the next run (evaluation is idempotent).

### 8.3 Admin (`moderator`, `support`; Reports & flags → Fraud signals)
- `GET /admin/fraud-signals?status&kind&businessId&page&pageSize` (default open, newest evidence first; server-paged
  25 / 50 / 100), `GET /admin/fraud-signals/:id` (evidence resolved to names and links; message refs open the
  conversation reader with the reason dialog, R11), `POST /admin/fraud-signals/:id/review` `{ outcome: 'dismissed' |
  'actioned', note }` (`409 FRAUD_SIGNAL_NOT_OPEN`; audit `fraud_signal.review` with before / after status). The
  review dialog says that closing spends the evidence: the next signal of this kind needs the full threshold again
  (R8).
- The detail links to the business page (suspend, block), its listings and requests; "actioned" asks what was done in
  the note (no sanction table in MVP).

## 9. Jobs (`src/jobs/index.ts`)
| Job | Every | Work |
|---|---|---|
| `fraud-signals` | 10 min | §8.2 (per-rule watermarks with a 2-minute margin; the first run reads 30 days back) |
| `admin-retention` | daily (first run after 15 min) | delete `install_sightings` / `contact_sightings` older than 90 days, `dismissed` / `actioned` signals reviewed > 1 year ago (textile "fraud flags 1 year"), password tokens used or expired > 7 days ago; batches of 1 000 with `FOR UPDATE SKIP LOCKED` |

The dashboard needs no job (R4).

## 10. AD6 exports

- `GET /admin/exports/:sheet?<the list's filters>&includeContacts=1` with `sheet` in `EXPORT_SHEETS`. Each sheet
  reuses its list route's Zod filter schema (moved to a shared module per list, minus `page` / `pageSize`) and its
  list service's `WHERE` builder, so the export is exactly the filtered list. Roles: businesses → `support`,
  `verification_officer`, `moderator`; listings → `moderator`, `support`; deals → `support`, `operations`;
  rental_bookings → `operations`, `support`; part_requests → `moderator`, `support` (R12).
- Flow: count → over `EXPORT_ROW_CAP` → `400 EXPORT_TOO_LARGE` (`details.total`); else write the `export.create` audit
  row, then stream keyset pages of 1 000 (`created_at, id`) as CSV (`text/csv; charset=utf-8`, `attachment;
  filename="<sheet>-YYYY-MM-DD.csv"`). Money in rupees with two decimals (`total_inr`), times as IST
  `YYYY-MM-DD HH:mm`, enums as their admin labels.
- Columns (no notes, messages, photos, street or site addresses, PAN, private budgets anywhere):
  - **businesses:** id, trade name, legal name, GSTIN, verification, city, state, pincode, industrial area,
    activities, categories, owner name, owner status, listings (live / all), deals as buyer / seller, created; plus
    owner phone and email for super_admin with `includeContacts=1`.
  - **listings:** ref, kind, status, title, category path, brand, part number, side, condition, quantity, available,
    unit, price model, price, city, industrial area, seller, open reports, created, first live, refreshed.
  - **deals:** ref, status, listing ref and title, buyer, seller, quantity, unit, price per unit, total, agreed,
    handed over, completed, cancelled (+ reason code).
  - **rental_bookings:** ref, status, listing ref and title, renter, owner, start, end, period, count, machines,
    agreed total, final amount, site city / state, confirmed, completed, cancelled.
  - **part_requests:** ref, status, kind, name (masked with `maskContact`), category path, side, quantity, unit, city,
    reach, audience, posted, expires, replies, matches, fulfilled.
- Admin: an **Export CSV** button on Users & businesses, Parts & machinery, Deals, Rental bookings and Part requests
  (current URL filters; fetched with the bearer token and saved as a blob; the "too large" error shows the count and
  asks to narrow the filters). Businesses shows "Include phone and email" only to a super admin.

## 11. AD7 admin users, sessions and the audit log

### 11.1 Sessions (`plugins/auth.ts`, `socket/setup.ts`)
`signAdminToken({ adminId, role, tv })`; `loadActiveAdmin(db, adminId, tv)` (PK lookup) in `requireAdmin`,
`requireAdminRole` and the `/admin` handshake (R13). `request.admin.role` comes from the row. Login sets
`last_login_at`. The three existing tests that sign tokens for random admin ids get real rows (`test-admins.ts`).

### 11.2 Routes
| Route | Who | Notes |
|---|---|---|
| `GET /admin/admin-users` | super_admin | name, email, role, status (`active` / `invited` / `reset_pending` / `deactivated`, §5.1), last sign-in, created, created by |
| `POST /admin/admin-users` `{ name, email, role }` | super_admin | `409 ADMIN_EMAIL_TAKEN`; returns the row + `{ link: { token, expiresAt } }` once; audit `admin_user.create` |
| `PATCH /admin/admin-users/:id` `{ name?, role? }` | super_admin | role change bumps `tv`; self role change and the last super admin refused; audit `admin_user.update` |
| `POST /admin/admin-users/:id/deactivate` `{ reason }` / `reactivate` | super_admin | deactivate bumps `tv`, drops sockets; self and last super admin refused; audit |
| `POST /admin/admin-users/:id/password-link` | super_admin | invite resend or reset: clears `password_hash` (reset), bumps `tv`, new link; self refused (use change password); audit `admin_user.password_link` (no token) |
| `POST /admin/admin-users/:id/sign-out` | super_admin | bumps `tv`, drops sockets; audit |
| `POST /admin/auth/password/inspect` `{ token }` | public, 10 / min / IP | `{ name, email, purpose }` or `400 PASSWORD_LINK_INVALID` (unknown, used or expired) |
| `POST /admin/auth/password/set` `{ token, password }` | public, 10 / min / IP | sets hash + `password_set_at`, marks the token used, bumps `tv`; audit `admin_user.password_set` by that admin |
| `POST /admin/auth/password/change` `{ current, password }` | any admin | `400 PASSWORD_WRONG` / `PASSWORD_TOO_WEAK`; bumps `tv`, returns a fresh token; audit |
| `POST /admin/auth/sign-out-everywhere` | any admin | bumps own `tv` |
| `GET /admin/audit-log?from&to&adminId&actor&action&entityType&entityId&q&page&pageSize` | super_admin | server-paged 25 / 50 / 100, newest first; `action` exact or a prefix ending in `.` (`listing.`) |
| `GET /admin/audit-log/facets` | super_admin | actions and entity types present, admins (for the filters) |
| `GET /admin/audit-log/:id` | super_admin | masked detail with `changedKeys` |
| `POST /admin/audit-log/:id/reveal` | super_admin | unmasked; writes `audit.reveal`; 30 / hour per admin |
| `GET /admin/audit-log/export?<filters>` | super_admin | CSV: time, admin, action, label, entity type, id, label, href; no snapshots; cap and audit as R12 |

Guards (R14) run inside one transaction holding `pg_advisory_xact_lock(hashtext('admin_users'))`, so two super admins
demoting each other at once leave one.

### 11.3 Audit log reading (`services/admin-insights/audit-log.ts`, `audit-labels.ts`, ported)
One `BASE` query joining the admin's name and an entity label per type (listing `#ref title`, business trade name,
deal / rental booking `#ref`, part request `#ref`, category / brand / model name, admin user name; others none);
`auditLabel(action)` plain words for every action in the code today (≈ 60, the C0 list) with the code shown for an
unknown one; `auditHref(entityType, id)` to the admin page where one exists. Masking per R16 (`maskSnapshot` recursive:
strings through `maskContact`; keys matching `phone|email|pan|address|gstAddress|siteAddress` replaced whole with
`•••`). `changedKeys` = top-level keys whose JSON differs.

## 12. Settings (`APP_SETTINGS`, int, admin section "Fraud signals")

| Key | Default | Range | Meaning |
|---|---|---|---|
| `fraud_window_days` | 30 | 7–90 | Look-back for every rule but the burst. |
| `fraud_device_accounts` | 3 | 2–20 | Accounts on one install. |
| `fraud_phone_businesses` | 2 | 2–20 | Businesses posting one number. |
| `fraud_phone_threads` | 10 | 3–200 | Threads one business posts one number in. |
| `fraud_payment_messages` | 2 | 1–50 | Payment / bank-detail messages from one business. |
| `fraud_new_account_days` | 7 | 1–30 | How long an account counts as new. |
| `fraud_burst_contacts` | 8 | 3–100 | Distinct businesses a new account contacts in 24 h. |
| `fraud_reports_against` | 3 | 2–50 | Reports from distinct businesses. |

A change applies from the next job run; it never re-evaluates closed signals. The Settings page loses its "Admin
accounts and roles" placeholder panel (a link to Admin users instead) and shows the R17 note.

## 13. Admin pages and nav

- **Nav (`lib/nav.ts`):** Insights & growth loses "Activity & KPIs"; System becomes **Settings** (super_admin),
  **Admin users** (new, super_admin, `/admin-users`), **Audit log** (super_admin). Reports & flags gets the
  `reportsOpen` badge. `/analytics` redirects to `/`.
- **Dashboard** (`app/(dashboard)/page.tsx`, §6.1): `components/dashboard/` (filters, work row, KPI grid, three
  charts, breakdown table); `lib/dashboard-api.ts`; loading skeletons, empty ("No activity in this period"), error with
  retry.
- **Admin users** (`/admin-users`): table (name, email, role, status pill **Active / Invited / Reset pending / Deactivated** (§5.1), last sign-in,
  created); **Invite admin**
  dialog → a "Copy link" panel shown once ("Send this link yourself; it works once, for 48 hours"); a row menu: Change
  role, Rename, Reset password (danger confirm → link panel), Sign out everywhere, Deactivate (reason, danger) /
  Reactivate; actions on yourself hidden, and the API refuses them anyway.
- **Set password** (`app/set-password/page.tsx`, outside the auth guard): reads `#t=`, inspects, shows the name and
  email, two password fields, then "Sign in". **Change password** in the top bar's account menu (dialog); on success
  the new token replaces the stored one.
- **Audit log** (`/audit-log`, `/audit-log/[id]`): filters in the URL (date range, admin or System, action, target
  type, target id or label search), table (time IST, who, what, target with link); detail with before / after side by
  side, changed keys highlighted, "Show hidden values" (confirm; then a notice "Shown values are logged"), Export CSV.
- **Reports & flags:** six tabs (R7); Fraud signals table (business, kind, evidence count, first / last seen, status)
  and detail drawer (evidence list, links, Dismiss / Mark actioned dialogs with a note); Businesses tab with the resolve
  dialog (`ReportResolveDialog` takes `target: 'business'`); Listings tab read-only.
- **Business detail:** Reports (n) and Fraud signals (n) panels (§7.3).
- **Export CSV** buttons (§10).
- Labels and tones in `lib/status.ts` (signal statuses, admin user statuses); every colour from the palette (style
  audit).

## 14. Errors (new codes)

`ADMIN_SESSION_ENDED` (401), `ADMIN_SELF_ACTION` (409), `ADMIN_LAST_SUPER_ADMIN` (409), `ADMIN_EMAIL_TAKEN` (409),
`PASSWORD_LINK_INVALID` (400), `PASSWORD_TOO_WEAK` (400), `PASSWORD_WRONG` (400), `TOO_MANY_ATTEMPTS` (429),
`DASHBOARD_RANGE_INVALID` (400), `EXPORT_TOO_LARGE` (400), `CANNOT_REPORT_SELF` (400), `BUSINESS_NOT_FOUND` (404, if
not already defined), `REPORT_RESOLVE_ELSEWHERE` (409), `FRAUD_SIGNAL_NOT_OPEN` (409). `REPORT_EXISTS` reused. App
error keys for the business report in the existing report locale namespace.

## 15. Sockets

`admin:session_ended` to `adminUserRoom(id)` just before its sockets are dropped (the panel shows "You were signed
out" and goes to login). No new user events. Signals and reports use the 60 s badge poll.

## 16. Privacy and security (DPDP Act 2023)

- **Phones:** never stored for signals (HMAC only, key outside the database); evidence carries a group id, not the
  number; rotating `SIGNAL_HASH_KEY` breaks matching across the rotation (accepted).
- **Messages:** signals never copy text; reading an evidence thread needs the reason dialog and writes `thread.read`
  (R11).
- **Exports:** minimal columns, contacts only for a super admin on request, every export audit-logged with its filters;
  files are never stored server-side; the CSV is the admin's responsibility once downloaded (a line on the button's
  dialog).
- **Audit log:** super admin only; masked by default; reveals logged; snapshots kept as stored (accountability record),
  not exported. Answers the PROJECT_STATUS DPDP note on `gst.release` before / after (masked in the viewer; retention
  still with the DPDP work).
- **Admin auth:** tokens end on deactivation / reset / role change at the next request; links hashed, single-use,
  never logged (fragment + POST body); password and token values never in audit rows, Sentry or logs (Sentry redaction
  adds `password`, `current`, `token`).
- **Retention:** sightings 90 days, closed signals 1 year, password tokens 7 days after use / expiry; added to the DPDP
  inventory with the deletion work (a deleted account's sightings go with it).
- Signals are a fraud-prevention purpose (legitimate use); nothing is shown to users.

## 17. Limits

Exports 10 per 10 min per admin, ≤ 10 000 rows; reveal 30 per hour per admin; login 10 / min per IP (existing) + the
per-email lockout (R15); password inspect / set 10 / min per IP; business reports per R6; dashboard cache 60 s; the job
scans ≤ 5 000 messages a run (= 720 000 a day; raise if a backlog appears).

## 18. Testing (limited, important; API integration on real Postgres + Redis, fixtures removed in `afterAll`)

1. **Sessions:** a deactivated admin's token → `401 ADMIN_SESSION_ENDED` on the next request and at the socket
   handshake; role change applies at once (a demoted moderator gets 403 on a moderator route with the old token);
   reset, password change, sign-out end old tokens; login refuses an invited (no password) and a deactivated admin;
   the derived status reads `invited` before the first sign-in and `reset_pending` after a reset of an admin who has
   signed in.
2. **Guards under races:** two super admins demoting / deactivating each other concurrently → one refused
   (`ADMIN_LAST_SUPER_ADMIN`); every self action refused; non-super roles get 403 on every admin-user and audit route.
3. **Password links:** single use, expiry, newest wins, raw token absent from `admin_password_tokens` and `audit_log`;
   weak password refused; lockout after 5 failures (unknown email too).
4. **Dashboard definitions:** one fixture per metric with rows at 23:59 and 00:01 IST on the period edges; previous
   period; cancelled deals excluded from value; reply rate's 24 h boundary and the "at least 24 h old" rule; match rate
   and median; city / area / category attribution (a deal counts for the listing's city, not the buyer's; business
   numbers by the business's city and categories); machines out today counts an `on_rent` booking past its end date
   and a `disputed`-from-`on_rent` one, not a `rented` listing with no booking, nor a booking that starts tomorrow.
5. **Signals:** each rule raises at its threshold and not one below; a re-run appends nothing; after a dismiss, one
   new piece of evidence raises nothing and a full threshold of new evidence opens a new signal (quiet reading);
   watermark across two batches (none twice, none skipped); a message committed late within the 2-minute margin
   (lower `seq` than one already visible) is scanned exactly once; a row younger than the margin waits for the next
   run; the first run ignores rows older than 30 days; the sender's own login, contact and member phones create no
   sighting; two members of one business on one install don't count as two for `shared_device`; a dismissed report
   and a conversation report filed *by* the business don't count for `reports_against`; a Devanagari-digit number and a spaced number give the same HMAC; no 10-digit run in `contact_sightings` or
   `fraud_signals`; the advisory lock skips a concurrent run; without `SIGNAL_HASH_KEY` the phone rule is off and the
   others run.
6. **Exports:** each sheet's role gate; filters equal the list's (same ids); cap refusal with the count; no phone /
   email unless super admin + `includeContacts`; formula neutralised; the audit row; no notes, addresses or private
   budget columns.
7. **Audit viewer:** a phone in Devanagari digits and a PAN / address key masked; reveal unmasks and writes
   `audit.reveal`; the export has no snapshot columns.
8. **Business reports:** self refused, one open, daily limit, a `viewer` member allowed, shows in the queue, resolve; listing report resolve via
   the queue → 409; the conversation reader allowed from an open signal citing the thread, refused once dismissed.

Admin (Vitest + Testing Library): admin-users row menu hides self actions; audit detail highlights changed keys;
`StatCard` delta tone; export button's "too large" message. App: locale parity for the new keys.

## 19. Build order (sketch; the plan details it)

**C0 contracts** (shared types, schema + 0018 / 0019, settings registry and validation, error codes, audit label list,
route stubs with roles, nav, locale keys) → **wave A, API lanes:** **A1** dashboard (definitions, cache, work counts,
options); **A2** AD7 (sessions in auth plugin + socket, admin users, password links, lockout, audit log viewer +
export); **A3** AD6 (business reports route, queue targets + count, sightings writers, `findPhones` /
`paymentDetailKinds`, `fraud-signals` + `admin-retention` jobs, signals admin API, reader gate source, exports) →
**wave B:** **B1** admin dashboard page + `StatCard` delta + analytics removal; **B2** admin users, set / change
password, audit log pages, settings section; **B3** Reports & flags tabs, signals, business detail panels, export
buttons, and the app's Report this business sheet → **Batch I** core-loop test (invite → set password → act → audit
row → reveal; a scripted fraud scenario raising every kind; an export per sheet), walk-through on the dev DB, docs.

## 20. Changes to earlier documents and code

- `docs/product-scope.md` AD1 / AD6 / AD7 built notes (AD6 settings line: R17; quiet hours and broadcast still open);
  release plan unchanged.
- F6 + F7 spec §16.3 (the reader gate's new source, R11); F2 spec §11 (listing reports also shown read-only in Reports
  & flags); F1 + A2 spec (admin sessions follow R13).
- `CLAUDE.md` (Admin RBAC: role and session read from the row per request, token version; fraud signals and exports
  under Architecture), `apps/admin/CLAUDE.md` (dashboard, admin users, set password, audit log, exports, signals, nav),
  `apps/user-app/CLAUDE.md` (business report), `docs/PROJECT_STATUS.md` (What's built, How to run:
  `SIGNAL_HASH_KEY`, migrations 0018–0019; Open items answered: StatCard tone, the `gst.release` DPDP note in part).
- `.env.example`: `SIGNAL_HASH_KEY` (≥ 32 characters, optional).

## 21. What exists today (checked on `develop` at `b710cda`)

- `apps/admin/app/(dashboard)/page.tsx`: eight placeholder tiles ("—"); `analytics`, `audit-log`, `notifications`,
  `promotions` are `ModulePlaceholder` pages; Settings has an "Admin accounts and roles" placeholder panel.
- `plugins/auth.ts`: admin tokens are verified by signature only (12 h), role from the token; no route manages admin
  users (`db/seed.ts` creates the first super admin). → R13 is a security fix, not only a feature.
- `audit_log` has no index besides the primary key; ≈ 60 action codes written (`writeAudit`).
- `reports.target_type` already allows `user` and `business`; no route writes them. Listing reports have F2's own
  queue; Reports & flags covers conversation, review and part request.
- `chat_messages.scam_flag` (UPI / pay host / advance ask) exists per message; `maskContact`'s `PHONE` pattern is the
  only phone detector; `user_devices.install_id` is unique and moves between users; the app sends `X-Install-Id` on
  every request.
- `lib/csv.ts` (BOM, formula neutralising) serves the catalogue export only.

## 22. Deferred (P2 and later)

Admin two-step login (textile §7.2: TOTP, backup codes); invite / reset by email; per-record history panels for
moderators and support; rollup tables; scanning offer / deal / rental notes, request notes and reply messages;
matching posted numbers against other accounts' login phones; widening the user-facing scam warning to bank details;
duplicate-photo and blocked-often signals (textile kinds); a sanctions ladder; IP and device-model signals; audit log
retention job (3 years, with the DPDP work); scheduled exports; notification broadcast; quiet hours.

## 23. Open items (for the owner and client)

- **Admin two-step login before launch:** now that several staff accounts exist, a password alone guards every power;
  recommend TOTP as textile did (its own small feature).
- Client: are the signal thresholds (§12) sensible for launch volumes? (All are settings.)
- Client: should anyone besides super admins read the audit log (e.g. support reading a business's history)?
- Owner: put a value in `SIGNAL_HASH_KEY` in `.env` and production to switch the phone rule on.
- The admin socket `session_ended` drop reaches only the same API process (as the user suspension note): add the
  Socket.IO Redis adapter before a second instance (HTTP requests are refused everywhere regardless).

## 24. Decisions marked (my call)

1. Every admin sees the dashboard including money tiles (R1).
2. Trend daily up to 31 days, weekly beyond (R3).
3. Rental bookings attributed to the listing's city, not the site (§6.2).
4. A thread opened by a booking request counts as an enquiry; buy-at-price counts as an offer (§6.2).
5. `SIGNAL_HASH_KEY` optional: the phone rule is off without it (R10).
6. The `fraud-signals` job holds an advisory lock, safe across instances (§8.2).
7. `repeated_phone` has two triggers (businesses ≥ 2, or one business in ≥ 10 threads) in one kind (R9).
8. Bank details count for signals only; the user-facing scam warning is unchanged (§8.1).
9. Contacts in exports only for super admins with `includeContacts`; never PAN, addresses, notes, budgets (R12).
10. Exports over 10 000 rows are refused, not truncated (R12).
11. Invited admins have a null password hash until the link is used (§5.1).
12. Reset clears the password at once; issuing a link signs the admin out (§11.2).
13. A role change bumps the token version so the panel's menu matches (R13).
14. Login lockout after 5 failures per email in 15 min, unknown emails included (R15).
15. Audit log viewer for super admins only; reveal capped at 30 an hour (R16).
16. Audit export without snapshots (R16).
17. Listing reports shown read-only in Reports & flags; resolve stays in moderation (R7).
18. No new "new-account limits": the unverified limits are them (R17).
19. Business report details shown to staff as stored, as review reports (§7.2); viewers may report.
20. A guest tapping Report this business gets the sign-in sheet with no pending action (§7.1).
21. Signals live in a Reports & flags tab, not their own nav item; the nav badge counts reports + signals (R7).
22. Bcrypt cost 12 for new admin hashes (R15).

Builder check answers (2026-11-21):

23. Every rule scans with a 2-minute commit-lag margin from per-rule watermarks (`last_seq` for chat messages,
    `last_at` for the others), advanced only to the highest row taken (R9a, §8.2).
24. The first run is a bounded backfill starting 30 days back (R9a).
25. Closing a signal spends its evidence; a new signal needs the full threshold from evidence seen after the close
    (quiet reading, R8).
26. `repeated_phone` never counts the sender's own login, contact or member phones (R9, §8.1).
27. `shared_device` counts distinct businesses on one install, not users (R9, §8.1).
28. A conversation report counts against the other business in the thread; `reports_against` counts `open`,
    `reviewing` and `actioned` reports, never `dismissed` ones (R9, §7.3, §8.1).
29. "Machines out today" is Σ machines on `on_rent` (and `disputed`-from-`on_rent`) bookings covering IST today, not
    `rented` listings (§6.2).
30. A `viewer` member may report a business, as with listings; conversation, review and part-request reports refuse
    viewers (§7.1). Admin status adds `reset_pending` (no password, signed in before) beside `invited` (§5.1, §13).
