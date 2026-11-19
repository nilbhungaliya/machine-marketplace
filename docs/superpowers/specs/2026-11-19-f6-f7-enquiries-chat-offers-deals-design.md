# F6 + F7 enquiries, chat, offers, deals, reviews (+ push notifications) — design

Date: 2026-11-19. Status: **approved for build** (owner's instruction 2026-11-19: build after an independent spec review and plan review, both done; see §27 and the plan's review changes).

Scope IDs: **F6** (enquiry, chat and negotiation), **F7** (deal and transaction management, reviews), the push and in-app
half of **F9** for these events, **A5** (enquiries, offers and deals) and the conversation / review part of **A6**, flows
**U1** / **U2** (seller and buyer) in `docs/product-scope.txt`; modules **M9** (enquiry, offers and negotiation), **M10**
(chat, calls and sharing), **M13** (deals and history), **M15** (reviews), the matching part of **M16** (notifications)
and of **M19** (scam warnings, hidden numbers, report / block, rate limits), admin **AD5** and part of **AD6** in
`docs/product-scope.md`. Rentals stay Enquire only (R2); bookings are M14, later.

Follows the textile project (`C:\Users\Dell\Desktop\textile stock marketplace`, also `E:\textile-marketplace`):
- Specs: `docs/superpowers/specs/2026-11-07-m7-m8-m12-offers-chat-deals-design.md` (threads, masking, scam warning,
  offers with turns, rounds, backups and reconfirm, accept → deal + hold, cancelling, support's closes) and its plan
  `docs/superpowers/plans/2026-11-07-m7-m8-m12-offers-chat-deals.md` decisions **D2** (no thread room: per-reader emits to
  each member's `userRoom`), **D3** (deal first, then its hold; hold found by its deal), **D4** (one reconcile function
  for offers), **D8** (private photos re-encoded with `sharp`, metadata and GPS dropped), **D9** (who sees what), **D10**
  (consent asked by a banner, not by a refused accept), **D16** (settings names, 30 messages a minute), **D17** (support's
  cancel reason); `docs/superpowers/specs/2026-11-07-part1-m1-m14-m15-design.md` **§4** (reviews: one per side, facets,
  double-blind, reply, scores after 3, reports) and **§5** (notifications: rows before pushes, at-least-once push with
  replace keys, grouped chat rows, devices, dev stub, `thread:viewing`).
- Code: API `lib/mask-contact.ts`; `services/chat/{thread.service,message.service,chat-view,chat-emit,scam-patterns,
  private-photo,archive}.ts`; `services/offers/{offer.service,reconcile,offer-jobs,offer-view}.ts`;
  `services/deals/{deal.service,deal-jobs.service,deal-problems.service,deal-admin.service,deal-view}.ts`;
  `services/consent/contact-consent.service.ts`; `services/reviews/{eligibility,review.service,review-state,
  review-scores,review-reports.service}.ts`; `services/notifications/{notification.service,chat-rows,render,recipients,
  push-sender,push-provider,fcm-provider,devices.service,viewing,reminders}.ts`; `services/idempotency.service.ts` +
  `plugins/idempotency.ts`. App `screens/chat/thread.tsx`, `screens/offers/make-offer.tsx`, `screens/deals/*`,
  `screens/notifications/{notifications,notification-settings,permission-explainer}.tsx`, `lib/{chat-composer,
  chat-format,offer-form,deal-display,review-form,push,push-dedupe,notification-links}.ts`.
- **Kept from textile:** one thread per listing and buyer business, created by the first message; per-reader text
  (masking depends on the thread *and* the reader; `viewer` never unmasked); scam warning decided at write time, never a
  block; system lines stored as code + values; offers as a chain of rows with `turn` and `needs_reconfirm`; one open
  negotiation per thread; accept → deal + hold in one transaction; backups and one reconcile function; private photos
  re-encoded; consent rows with the wording version; support's three closes; review blind publishing; notification rows
  first, pushes as delivery rows, grouped chat rows, `thread:viewing`, dev push stub; idempotency keys for retried taps.
- **Dropped from textile:** lots, bales, estimated quantities and quantity confirmation, samples and sample deadlines,
  payment-term step orders, payment marks and confirmations, UTR and screenshots, dispatch and LR / AWB details,
  `goods_loaded_at`, consumed stock, stock-return settling, refund records, reply rate, `proven_seller`, packing-list
  grants, the outbox (§11.1), quiet hours (§11.6), voice notes and PDFs, masked calls.
- **Changed from textile:** steps are a fixed handed over → received with timers (TI style, owner's ruling R20), not
  per payment terms; the number is revealed only when both sides tick "share my number" *in that thread* (R6), not at
  acceptance; seller **quotes** answer Ask price on price-on-request listings (R13); "Buy at this price" on fixed
  listings (R12); counter bounds (R14); stock holds are a small table of their own (R16) because listings have no stock
  ledger.

Built on F2 + F3 + A3 (`docs/superpowers/specs/2026-11-18-f2-f3-listings-design.md`: listing statuses and
`LISTING_TRANSITIONS` with the system `reserve` / `unreserve` it reserved for F7, `publicListingWhere()`, `reports`,
`app_settings`, the private bucket and `lib/storage.ts`, the "Coming soon" contact buttons, R6) and F4 + F5
(`docs/superpowers/specs/2026-11-19-f4-f5-discovery-design.md`: guest browsing, the sign-in sheet and pending action,
`X-Install-Id`, `ListingCard`). F1's business profile gains a contact number (§5.12).

**Settled here** (the scope document points at "F6 + F7 spec" for these): how reserved quantity works (§8), how counter
bounds work after the first counter (§7.4), whether and how unverified buyers chat (R4, §12.1), the exact blind review
rules (§10.3). M13's "2 business days / 3 business days" become **plain calendar days** (R21).

---

## 1. Goals

1. A buyer asks about a listing in one tap (quick options, a note, their machine) and the seller answers in a thread tied
   to that listing.
2. Price is agreed through structured offers, counters, quotes and "Buy at this price", never lost in text; every deal
   comes from an accepted offer.
3. Accepting holds exactly the agreed quantity; the listing never shows stock that is promised to someone else, and a
   cancelled deal gives it back.
4. Both sides share one deal record (price, quantity, total, notes) even though payment happens outside the app, with a
   short handed over → received path that cannot get stuck.
5. Phone numbers and emails stay hidden until a deal exists and both sides agree to share; nothing leaks through REST,
   sockets, pushes, analytics or logs.
6. After a completed deal both sides review each other, blind; scores show once they mean something.
7. People hear about enquiries, messages, offers and deal steps by push and in an in-app list, without the app open.
8. Support and moderators can act on disputes, reported conversations and reported reviews, with every read and
   decision audit-logged.

## 2. Non-goals (deferred, see §24)

Rental bookings (dates, deposits, on rent, return: M14); masked calls (Exotel); PDF, voice and video messages; saved
replies, quotation PDF, labels and reminders; seller auto-accept / auto-decline; "send offer to people who saved this";
enquiry basket; GST invoice from the deal; payments through the platform (M20); quiet hours and SMS / WhatsApp
channels; chat search; post-completion claims; buyer reliability badges and trust scores beyond review stars; team
management screens (members exist in the data model, `MEMBER_ROLES`, but adding members is P2).

## 3. Approaches

| # | Approach | Verdict |
|---|---|---|
| 1 | **Port textile's M7 / M8 / M12 + M14 / M15 modules, adapted to machine parts** (threads, masking, scam warning, per-reader emits, offer chain with backups and reconcile, consent rows, system codes, private photo pipeline, review publishing, notification rows + push deliveries), dropping lots, bales, samples, payment-term step orders, dispatch LR, consumed quantity and refunds. | **Chosen** (owner-approved). Proven on the same stack and conventions; the hard parts (per-reader masking, accept races, backup revival, push dedupe) are already solved and tested there. |
| 2 | A fresh, smaller build: one thread room, offers as a status on the thread, no backups. | Rejected: a shared thread room sends one payload to every member, so masking for `viewer` members and before reveal leaks through sockets; without backups a cancelled deal strands the other buyers. |
| 3 | A hosted chat service (Stream, Sendbird, CometChat) for threads, our API for offers and deals. | Rejected: no per-reader masking of stored text; message data stored outside India (DPDP); per-user cost; a second user system to sync with suspensions and team roles; offer and deal cards would live in two systems. |

## 4. Rulings

Owner's rulings are R1–R26 (settled; not reopened here). Smaller calls made in this document are marked **(our call)**
where they appear and listed in §26.

| # | Ruling |
|---|---|
| R1 | **One thread per buyer business + listing.** Created by the first enquiry, offer or Ask price, never by opening a screen. A business can't open a thread on its own listing. The seller never starts a thread. |
| R2 | **Rentals are Enquire only** in this build (chat, no offers, no deals). The seller's manual Mark rented / End rental from F2 stays. Bookings are M14. |
| R3 | **Team access:** every member of the buyer and seller businesses sees the thread. `owner`, `listing_manager` and `sales` write and act; **`viewer` reads only** and never sees an unmasked number or email. |
| R4 | **Unverified buyers chat** in threads they open, under rate limits (§12.1): 30 messages a minute per user; new enquiries per business per day 10 unverified / 40 verified **(our numbers)**. |
| R5 | **The enquiry is the thread's first message:** a card with the quick options, an optional note and the buyer's last "Check my machine" choice (brand / model / year, sent by the app). Enquiry status (open / replied / converted / closed) is **derived** from the thread (§6.2). |
| R6 | **Phone numbers (D6):** masked (en / hi / gu digits incl. Devanagari and Gujarati, and emails) in every REST and socket output **until a deal exists in the thread AND both sides have ticked "share my number"** in it. Each tick is a consent row with a timestamp (DPDP). Stored text is never altered. Reveal is permanent, even if the deal is cancelled. `viewer` members never see unmasked numbers. The revealed number is the business's optional **contact number** (§5.12), else the owner's phone. |
| R7 | **Scam warning:** a UPI id, payment link or advance-payment phrase (en / hi / gu) is detected when the message is written, stored on it and shown to the other side as a warning; never blocked. |
| R8 | **Chat media: photos only**, ≤ 5 per message, private bucket, **re-encoded with `sharp`** (EXIF / XMP / GPS dropped; textile D8), read through 300 s signed URLs. PDF / voice / video later. |
| R9 | **System lines** are stored as a code + values and rendered in the reader's language. **Unread is per user.** Inbox filters **All / Buying / Selling / Your turn**; archive; report and block from the thread; share the listing to WhatsApp. |
| R10 | **Sockets:** per-reader emits to each member's `userRoom` (no thread room, textile D2); events `message:new`, `offer:updated`, `deal:updated`, `notification:new`, client `thread:viewing`; clients refetch on reconnect. |
| R11 | **Offers (Negotiable):** price per unit, quantity (≥ minimum order, ≤ available), validity (24 h / 48 h / 7 d, admin settings), note; the app shows the total and "% below asking". The buyer starts; the seller accepts / rejects / counters; then the buyer; **at most 5 counters**, then accept or reject only. **One open negotiation per thread.** |
| R12 | **Fixed price:** "Buy at this price" = an offer at the asking price, which the seller accepts or rejects (no counters). |
| R13 | **Price on request:** "Ask price" opens a thread with an enquiry; the seller replies with a **quote** = the seller's opening offer, which the buyer accepts, rejects or counters. **Every deal comes from an accepted offer.** |
| R14 | **Counter bounds:** each counter lies between the two sides' latest prices; for the buyer's first offer before any counter, the bounds are that offer and the asking price (§7.4). |
| R15 | **Accept** creates the deal and holds the quantity. Other buyers' open offers whose quantity no longer fits become **backups** ("quantity no longer available"). When a deal is cancelled, backups that fit revive and **the seller must re-confirm** before one can be accepted (textile reconcile). An expiry job closes offers. Open-offer limits: **unverified 3, verified 20** at a time; counters don't count; limits are admin settings. Retried taps are idempotent. |
| R16 | **Stock holds:** a `stock_holds` row per deal; available = quantity − active holds; accept creates a hold; completion turns it into a quantity decrease (sold at 0); cancel releases it; the listing shows `reserved` only when available reaches 0 (system `reserve` / `unreserve`). With holds the seller can still edit price and photos, pause, and mark the rest unavailable; removing the listing or marking it sold outside the app first asks to cancel the open deals. |
| R17 | **The deal record:** price per unit, quantity, total (paise), plus optional notes both sides can edit: payment method (bank / UPI / cash / credit; advance + balance allowed), pickup or delivery, expected date. Notes, not steps. |
| R18 | **Deal steps:** seller marks **handed over** (optional photo) → buyer **confirms received** (completes) or **reports a problem within 2 days**; with no action the deal **auto-completes 3 days after handover**. |
| R19 | **Cancel:** either side alone before handover (releases the hold); after handover both must agree. |
| R20 | **Disputes:** a reported problem freezes the deal into an admin **Disputes** queue for `support`, who reads the thread with an audit-logged reason and closes it **completed** (stock leaves), **cancelled** (stock returns) or **resumed** (timers restart). The outcome is recorded on both businesses' history. |
| R21 | **Plain calendar days** for every timer (2 days = 48 h, 3 days = 72 h from the handover time), not business days. |
| R22 | **Reviews:** only completed deals; each side rates the other on three facets 1–5 (buyer → seller: matched the listing, communication, on time; seller → buyer: communication, payment, pickup) + optional text. **Blind:** once one side submits the other has **7 days**, then both publish; if the other never submits, the single review publishes when its 7 days run out; everything within **14 days** of completion. Scores show after **3** reviews; the seller replies once; reviews can be reported and hidden by moderators. (Review change 11: in MVP seller → buyer reviews store the stars only, §10.2.) |
| R23 | **Admin reads chat only for a reported conversation or a dispute,** every read audit-logged with a reason. Pages: Enquiries & offers (monitor), Deals (list, detail, steps), Disputes, Conversations (reported only), review moderation. RBAC per `lib/nav.ts`; every mutation audit-logged. |
| R24 | **Guests:** Enquire, Make offer, Buy at this price and Ask price are sign-in reasons with pending actions that continue after sign-in (as Save in F4). |
| R25 | **Push now (F9 subset):** FCM via `firebase-admin` in the API, `expo-notifications` in the app (new dev-client build, owner-supplied Firebase keys), device tokens, an in-app notification list (bell). Events: new enquiry, new message, offer received / quote / countered / accepted / expiring soon, deal handed over / completed / problem reported / dispute resolved, review received. **No message text in pushes** (§11.4). |
| R26 | **Testing:** limited, important tests only: state machines, money and quantity, masking and privacy, permissions, jobs. Not UI wiring. |

---

## 5. Data model

One Drizzle migration plus one `--custom` migration (CHECKs, partial unique indexes Drizzle can't express, sequence
starts). Every table below is new unless marked. Money is `bigint` paise; quantities are `numeric(14,3)` (as
`listings.quantity`) and travel as decimal strings ("2", "2.500").

### 5.1 `chat_threads`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `listing_id` | uuid → `listings` | |
| `buyer_business_id`, `seller_business_id` | uuid → `businesses` | CHECK they differ. Seller copied from the listing at creation. |
| `listing_kind` | `listing_kind` | Copied, for the inbox and admin filters. |
| `created_by_user_id` | uuid → `users` | The buyer who started it. |
| `last_message_seq` | bigint | Of the newest message (inbox order, unread). |
| `last_message_at` | timestamptz | |
| `first_seller_reply_at` | timestamptz null | First seller message, quote or offer answer (enquiry status, §6.2). |
| `deal_count` | int default 0 | Deals ever made in the thread (status `converted`). |
| `buyer_turn`, `seller_turn` | bool default false | Whether each side must act (open negotiation's turn, an unanswered enquiry for the seller, a deal waiting on that side, §6.10); recomputed by every transaction that changes one of those inputs. |
| `last_buyer_seq`, `last_seller_seq` | bigint default 0 | Newest message from each side (system lines raise both); unread = the other side's last seq > my `last_read_seq` (§5.3). |
| `contact_unlocked_at` | timestamptz null | Set once, never cleared (R6, §6.6). |
| `created_at`, `updated_at` | | |

Unique (`listing_id`, `buyer_business_id`). Indexes (`buyer_business_id`, `last_message_at` DESC, `id`) and
(`seller_business_id`, `last_message_at` DESC, `id`); partial (`buyer_business_id`) WHERE `buyer_turn` and
(`seller_business_id`) WHERE `seller_turn` for the Your turn filter and count.

### 5.2 `chat_messages`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `thread_id` | uuid → `chat_threads` | |
| `seq` | bigserial | Global order; pages and unread use it. |
| `kind` | enum `message_kind` (`text`, `photos`, `enquiry`, `offer`, `deal`, `system`) | |
| `sender_side` | enum `party_side` (`buyer`, `seller`) null | Null for `system`. |
| `sender_user_id` | uuid → `users` null | |
| `text` | text null | ≤ 2 000 (text, photo caption), ≤ 500 (enquiry note). Stored as written. |
| `quick_options` | text[] null | `QuickEnquiry[]` on an enquiry card. |
| `enquiry_quantity` | numeric(14,3) null | "Best price for N" / quantity asked. |
| `fit_machine` | jsonb null | `{ brandId, brandName, modelId, modelName, year, verdict }`: snapshot of the buyer's Check my machine choice; `verdict` from shared-types `checkFit()` against the listing's fitments at send time (`fits` / `not_listed`). |
| `photo_keys` | text[] null | ≤ 5 final private keys (§6.8). CHECK cardinality ≤ 5. |
| `offer_id` | uuid → `offers` null | `offer` card. |
| `deal_id` | uuid → `deals` null | `deal` card. |
| `system_code`, `system_values` | text, jsonb | `system` lines (§6.9). |
| `scam_flag` | bool default false | R7, decided at insert. |
| `client_message_id` | uuid null | The app's id for a retried send; unique (`sender_user_id`, `client_message_id`). |
| `created_at` | | |

CHECK `chat_messages_shape`: the fields each kind needs are set and the others null. Index (`thread_id`, `seq` DESC).
Messages are never edited or deleted (DPDP deletion comes with the privacy work).

### 5.3 `chat_thread_user_state`

PK (`thread_id`, `user_id`); `last_read_seq` bigint default 0; `archived_at` timestamptz null; `updated_at`. A thread is unread for a reader when the other side's last seq (`last_seller_seq` for a buyer member,
`last_buyer_seq` for a seller member) > `last_read_seq`: a column comparison, no count over messages. The exact
number is counted only for the unread rows of the page the inbox returns (≤ 20, index (`thread_id`, `seq`)). A new message from the other side
clears `archived_at` for every member of the receiving business **(our call)**.

### 5.4 `business_blocks`

PK (`blocker_business_id`, `blocked_business_id`), `created_by_user_id`, `created_at`. §6.11.

### 5.5 `contact_share_consents` (append-only, DPDP record)

`id`, `kind` (`CONSENT_KINDS`: `grant`, `withdraw`; textile's consent events), `thread_id` (null on a business-wide
`withdraw`), `business_id`, `user_id` (null for a withdraw the system writes), `phone_shown` (E.164: the number granted
or withdrawn), `phone_source` (`business_contact` \| `owner_phone`), `wording_version` smallint, `reason` null
(`number_removed`, `number_replaced`, `owner_changed` on a withdraw), `created_at`. Indexes (`thread_id`,
`business_id`, `created_at` DESC) and (`business_id`, `phone_shown`, `created_at` DESC). **Append-only:** a trigger
refuses UPDATE and DELETE (custom migration); withdrawing is a new row. A consent is **valid** while it is a `grant`
in the thread whose `phone_shown` equals the business's current number (§6.6) and no later `withdraw` names that
number.

### 5.6 `offers`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `thread_id`, `listing_id` | uuid | |
| `buyer_business_id`, `seller_business_id` | uuid | Copied from the thread (limit counting, admin). |
| `negotiation_id` | uuid | The first row's id; every counter carries it. |
| `previous_offer_id` | uuid → `offers` null | The row this counters. |
| `round` | smallint | 0 for the opening row; +1 per counter (≤ `MAX_COUNTER_ROUNDS`). |
| `kind` | enum `offer_kind` (`offer`, `buy_now`, `quote`) | Opening row's kind; counters keep `offer`. |
| `sender_side` | `party_side` | |
| `sender_user_id` | uuid → `users` | |
| `turn` | `party_side` | Who must act now (open rows only). |
| `needs_reconfirm` | bool default false | A revived backup the seller must reconfirm (§7.7). |
| `price_per_unit_paise` | bigint | > 0. |
| `quantity` | numeric(14,3) | > 0, unit decimals. |
| `total_paise` | bigint | `totalPaise(price, quantity)` (§7.2). |
| `asking_price_paise` | bigint null | The listing's price when the negotiation opened (bounds and "% below asking"); null for a quote. |
| `unit_id` | uuid → `units` | Snapshot. |
| `gst_mode` | `gst_price_mode` null | Snapshot. |
| `validity_hours` | smallint | One of the three settings values. |
| `expires_at` | timestamptz null | Null while `backup`. |
| `backup_since` | timestamptz null | When the row last became `backup` (`offer_backup_max_days`, §7.7). |
| `note` | text null | ≤ 500, stored as written, masked per reader. |
| `status` | enum `offer_status` | `OFFER_STATUSES` (§7.5). |
| `close_reason` | text null | `listing_unavailable`, `listing_changed`, `blocked`, `account_inactive` (`OFFER_CLOSE_REASONS`). |
| `answered_at`, `answered_by_user_id` | | |
| `reject_note` | text null | ≤ 300. |
| `created_at`, `updated_at` | | |

Partial unique `offers_one_open_per_thread` on (`thread_id`) WHERE `status IN ('pending','backup')`. Indexes
(`listing_id`, `status`), (`status`, `expires_at`) WHERE `status = 'pending'`, (`buyer_business_id`, `status`).

### 5.7 `stock_holds` and `listings.held_quantity` (R16)

`stock_holds`: `id`, `listing_id`, `deal_id` unique → `deals`, `quantity` numeric(14,3), `status` enum `hold_status`
(`active`, `converted`, `released`), `created_at`, `settled_at`. Index (`listing_id`) WHERE `status = 'active'`. As
textile D3: the deal is inserted first, then its hold.

`listings` (new column): `held_quantity numeric(14,3) NOT NULL DEFAULT 0`, CHECK `0 ≤ held_quantity ≤ quantity`
(custom). Written only by `services/deals/holds.ts` in the same transaction as the hold row, so available =
`quantity − held_quantity` is one column read for cards, search's `minQty` and offers **(our call: a maintained column
rather than a sum per read)**. A test asserts it always equals the sum of active holds.

The custom migration also relaxes F2's `listings_quantity_positive` (migration 0009) from `quantity > 0` to
`quantity IS NULL OR quantity >= 0`, so a sell-out can store 0. Seller and admin input still refuse 0 (the routes'
Zod schemas and the go-live gate are unchanged).

### 5.8 `deals`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `ref` | bigserial | Shown as "Deal #500001" (sequence starts at 500001) **(our call)**. |
| `thread_id`, `listing_id`, `offer_id` (unique) | uuid | |
| `buyer_business_id`, `seller_business_id` | uuid | |
| `listing_title`, `unit_id`, `unit_label`, `gst_mode` | | Snapshots at accept. |
| `price_per_unit_paise`, `quantity`, `total_paise` | | The accepted offer's terms; never change. |
| `status` | enum `deal_status` | `DEAL_STATUSES` (§9.2). |
| `accepted_at`, `accepted_by_user_id` | | |
| `handed_over_at`, `handed_over_by_user_id`, `handover_photo_key`, `handover_note` | | Note ≤ 300. |
| `problem_deadline_at`, `auto_complete_at` | timestamptz null | Set at handover and on a resume (R18, R21). |
| `completed_at`, `completed_how` | | `completed_how`: `buyer_confirmed`, `auto`, `support`. |
| `cancelled_at`, `cancelled_by_side`, `cancel_reason`, `cancel_note` | | `cancelled_by_side`: `buyer`, `seller`, `both`, `system`. |
| `cancel_requested_side`, `cancel_requested_at`, `cancel_requested_reason`, `cancel_requested_by_user_id` | | After handover (§9.5). |
| `payment_method` | enum (`bank`, `upi`, `cash`, `credit`) null | Notes (R17). |
| `advance_paise` | bigint null | Advance agreed; balance = total − advance (shown, not stored). CHECK 0 ≤ advance ≤ total. |
| `fulfilment` | enum (`pickup`, `delivery`) null | |
| `expected_on` | date null | |
| `notes_text` | text null | ≤ 500, masked per reader. |
| `notes_updated_at`, `notes_updated_by_user_id` | | |
| `version` | int | +1 on every change; only a notes edit sends it back (`409 DEAL_STALE`, §9.2). |
| `agreed_reminded_at` | timestamptz null | Last "still to hand over?" nudge (§9.3). |
| `created_at`, `updated_at` | | |

Indexes (`buyer_business_id`, `status`, `updated_at` DESC), (`seller_business_id`, …), (`status`, `auto_complete_at`) WHERE `status = 'handed_over'`, (`listing_id`) WHERE `status IN ('agreed',
'handed_over', 'disputed')` (a listing's open deals: `LISTING_HAS_OPEN_DEALS`, admin removal).

### 5.9 `deal_events` (timeline)

`id`, `deal_id`, `code` (`agreed`, `notes_changed`, `handed_over`, `received`, `auto_completed`, `cancel_requested`,
`cancel_request_withdrawn`, `cancelled`, `problem_reported`, `dispute_resolved`, `contact_shared`), `actor_side`
(`buyer` / `seller` / `system` / `support`), `actor_user_id`, `actor_admin_id`, `values` jsonb, `created_at`. Feeds the
Deal record timeline and the admin detail; each also posts a system line in the thread.

### 5.10 `deal_disputes`

`id`, `deal_id`, `opened_by_side`, `opened_by_user_id`, `category` (`DISPUTE_CATEGORIES`: `not_as_described`,
`damaged`, `short_quantity`, `not_received`, `payment_not_received`, `other`), `description` (10–1 000),
`photo_keys` text[] (≤ 5), `status` (`open`, `resolved`), `outcome` (`completed`, `cancelled`, `resumed`) null,
`message_to_parties` text null (≤ 500, shown in the thread), `internal_note` (audit only), `resolved_by_admin_id`,
`stock_returned` bool null (asked when support closes as cancelled, §9.6), `resolved_at`, `created_at`. Partial
unique: one `open` per deal; index (`status`, `created_at`) for the queue. This table is the businesses' dispute history (R20).

### 5.11 `deal_reviews`

| Column | Notes |
|---|---|
| `id`, `deal_id` | Unique (`deal_id`, `reviewer_side`). |
| `reviewer_side` | `buyer` (reviews the seller) or `seller` (reviews the buyer). |
| `reviewer_business_id`, `reviewed_business_id`, `reviewer_user_id` | |
| `r_matched_listing`, `r_communication`, `r_on_time`, `r_payment`, `r_pickup` | smallint null, CHECK 1–5; CHECK shape: buyer side sets matched_listing, communication, on_time; seller side sets communication, payment, pickup. |
| `text` | ≤ 1 000, optional; buyer side only (CHECK: null on the seller side, §10.2). |
| `submitted_at`, `publish_due_at`, `published_at` | §10.3. |
| `hidden_at`, `hidden_by_admin_id`, `hidden_reason` | Moderation. |
| `reply_text` (≤ 300), `reply_user_id`, `reply_at`, `reply_hidden_at` | Seller's one reply to a buyer → seller review. |

Index (`reviewed_business_id`, `reviewer_side`) WHERE `published_at IS NOT NULL AND hidden_at IS NULL`;
(`publish_due_at`) WHERE `published_at IS NULL`. Scores are computed on read from that index (no stored aggregate yet)
**(our call)**.

### 5.12 `businesses` (new columns)

`contact_phone` text null (E.164), `contact_phone_verified_at` timestamptz null. Set by the owner only, OTP-verified
through the existing OTP service **(our call: an unverified number could point at someone else)**. Used only as the
revealed number (R6); never public.

### 5.13 Notifications

- `notifications`: `id`, `user_id`, `business_id`, `type` (`NOTIFICATION_TYPES`), `category` (`chat`, `offers`, `deals`,
  `reviews`), `params` jsonb (ids and safe values: business name, listing title, price per unit), `thread_id`,
  `offer_id`, `deal_id`, `review_id` (destinations), `dedupe_key` (unique per user), `unread_count` smallint (grouped
  chat rows), `last_seq` bigint (grouped chat rows), `version` int (push delivery key), `read_at`, `created_at`,
  `updated_at`. Index (`user_id`, `created_at` DESC); partial (`user_id`) WHERE `read_at IS NULL`; partial unique
  `notifications_open_chat_row` on (`user_id`, `thread_id`) WHERE `type = 'message_new' AND read_at IS NULL`, so the
  grouped chat row is written with `INSERT … ON CONFLICT DO UPDATE` (§11.2).
- `notification_deliveries`: `id`, `notification_id`, `version`, `device_id`, `state` (`queued`, `sent`, `sent_dev`,
  `failed`, `skipped`), `attempts`, `next_attempt_at`, `provider_message_id`, `last_error`, `created_at`; unique
  (`notification_id`, `version`, `device_id`); index (`state`, `next_attempt_at`).
- `user_devices`: `id`, `user_id`, `install_id` (unique: one account per install), `fcm_token`, `platform`
  (`android`, `ios`), `app_version`, `last_seen_at`, `created_at`.
- `users` (new column): `push_enabled bool NOT NULL DEFAULT true`, one switch for every push (category switches are
  P2, §11.6).

### 5.14 `idempotency_keys` (textile)

`scope` (route + user id), `key`, `request_hash`, `status_code`, `response` jsonb, `created_at`; PK (`scope`, `key`).
Deleted after 24 h by a job. Ported with `plugins/idempotency.ts` and `services/idempotency.service.ts`.

### 5.15 Existing tables

- `reports`: `REPORT_TARGETS` gains `review` (`ALTER TYPE report_target ADD VALUE 'review'`, §5.17); `target_id` is
  the thread id for `conversation`. New reason lists (§6.12,
  §10.6). The one-open-report-per-business index already covers both.
- `users`: no change; `language` (exists) is now written by `PUT /users/me/language` (§12) so server-rendered
  notification text follows the app's language.

### 5.16 Shared types (`packages/shared-types`)

- `QUICK_ENQUIRIES` + `price_request` (Ask price) **(our call)**.
- `OFFER_STATUSES` = `pending`, `countered`, `accepted`, `rejected`, `expired`, `withdrawn`, `backup`, `closed`;
  `OFFER_KINDS`, `OFFER_CLOSE_REASONS`, `PARTY_SIDES`; `MAX_COUNTER_ROUNDS` comment fixed ("then accept or reject only").
- `DEAL_STATUSES` = `agreed`, `handed_over`, `completed`, `cancelled`, `disputed` (**`handed_over` added, our call**: a
  status reads better than a step flag and keeps the state table total); `DEAL_CANCEL_REASONS_BUYER` (`no_longer_needed`,
  `found_elsewhere`, `seller_not_responding`, `other`), `_SELLER` (`buyer_not_responding`, `payment_not_received`,
  `stock_problem`, `other`), `_SYSTEM` (`listing_removed`, `support_closed`) **(our call)**; `DEAL_PAYMENT_METHODS`,
  `DEAL_FULFILMENT`, `DISPUTE_CATEGORIES`, `DISPUTE_OUTCOMES`.
- `REVIEW_FACETS` per side, `REVIEW_REPORT_REASONS` (`abusive`, `false`, `personal_information`, `other`),
  `CONVERSATION_REPORT_REASONS` (`spam`, `scam_or_advance_payment`, `abusive`, `fake_listing`, `other`).
- `NOTIFICATION_TYPES` + `offer_quote`, `offer_expiring`, `offer_backup`, `offer_revived`, `deal_handed_over`,
  `deal_cancel_requested`, `deal_cancelled`, `deal_problem`, `deal_dispute_resolved`, `deal_agreed_reminder`,
`review_received` (existing
  `enquiry_new`, `message_new`, `offer_new`, `offer_countered`, `offer_accepted`, `offer_rejected`, `deal_completed`
  kept).
- `SYSTEM_LINE_CODES` (§6.9), `CONSENT_KINDS` (`grant`, `withdraw`), `CHAT_LIMITS` (`messageMax` 2 000, `noteMax` 500, `photosPerMessage` 5,
  `messagesPerMinute` 30, `photoMaxBytes` 10 MB), `totalPaise()`, `percentBelowAsking()`, `counterBounds()`,
  `enquiryStatus()`, `dealYourTurn()`, `reviewApplicable()` as pure functions both API and app use.
- Interfaces: `InboxRow`, `ThreadDetail`, `ThreadMessage`, `OfferView`, `DealView`, `DealListRow`, `ReviewState`,
  `PublicReview`, `SellerScore`, `NotificationRow`, `Badges`, admin views.
- Listing changes in §8.3; `ListingCard` keeps `quantity` and gains `availableQuantity` (§8.4); `APP_SETTINGS` keys in
  §17.

### 5.17 Migrations

1. **Generated** (`db:generate`): the new enums, tables and columns of §5.1–§5.15.
2. **`report_target` gains `review`** with `ALTER TYPE report_target ADD VALUE 'review'`. Drizzle applies pending
   migrations in one transaction and Postgres refuses to *use* a new enum value in the transaction that adds it
   (textile plan D1), so **no migration statement uses `'review'`** (no default, backfill or partial index on it); only
   runtime code does.
3. **Custom** (`drizzle-kit generate --custom`): the CHECKs (message shape, ≤ 5 photos, review shape and seller-side
   text null, `advance_paise ≤ total_paise`, `0 ≤ held_quantity ≤ quantity`); F2's `listings_quantity_positive` relaxed
   to `quantity IS NULL OR quantity >= 0` (§5.7); `deals_ref_seq` restarted at 500001; the append-only trigger on
   `contact_share_consents` (refuses UPDATE and DELETE; withdrawals are rows); the partial unique indexes
   (`offers_one_open_per_thread`, `notifications_open_chat_row`, one open dispute per deal) and partial indexes
   (Your turn, open deals per listing, unpublished reviews) Drizzle can't express.
4. Run `db:migrate` and `db:migrate:test` after each.

---

## 6. Threads, enquiries and chat

### 6.1 Starting a thread

`POST /listings/:id/enquiry` (Enquire, Ask price) and `POST /listings/:id/offers` (Make offer, Buy at this price)
create the thread if the buyer business has none for the listing, then add the card, in one transaction (unique index
on (`listing_id`, `buyer_business_id`) makes two first taps one thread). Refused when:
- the listing isn't public (`publicListingWhere()`; `404 LISTING_NOT_FOUND`, F2's code);
- the actor's business owns it (`409 OWN_LISTING`);
- the actor is a `viewer` (`403 VIEWER_READ_ONLY`), has no business yet (onboarding gate), or a block exists either way
  between the two businesses (`403 BUSINESS_BLOCKED`);
- the business is over its daily new-enquiry limit (`429 ENQUIRY_LIMIT`, R4; an existing thread never counts).

An enquiry on a listing that already has a thread appends a new enquiry card to it **(our call)**; the listing page's
Enquire button reads "Open chat" when a thread exists, with the quick options as chips above the composer.

### 6.2 Derived enquiry status (R5)

`enquiryStatus(thread, listing, block)` in shared-types, used by the inbox, the seller dashboard later (M17) and admin:

| Status | When (first match wins) |
|---|---|
| `converted` | `deal_count > 0`. |
| `closed` | A block exists between the two businesses, or the listing is no longer public **and** the thread has no open negotiation. |
| `replied` | `first_seller_reply_at` is set (a seller message, quote, counter, accept or reject). |
| `open` | Otherwise. |

No status column: nothing can drift **(our call)**.

### 6.3 Enquiry card

Quick options (`QUICK_ENQUIRIES`: Is it still available? · Send more photos · Send a video · Full specifications · Will
it fit my machine? · Best price for N · Price please (Ask price)), at least one option or a note; `best_price` and
`price_request` take a quantity (default the minimum order, else 1). The app sends the stored Check my machine choice
(`listing.fitCheck.machine`) when "Will it fit my machine?" is ticked; the server resolves names and the verdict
(§5.2) so the seller sees "Buyer's machine: JCB 3DX Super, 2018 · listed as fitting" without trusting client text.
Ask price preselects `price_request`; the seller's reply to it is a quote (§7.3).

### 6.4 Messages

Text (1–2 000 chars after trim) and photos (1–5, with an optional caption) by any non-viewer member of either party.
A message is refused when the actor is a `viewer` (`403`), the businesses block each other (`403 BUSINESS_BLOCKED`), or
the sender is over 30 a minute (`429`). Threads stay writable whatever the listing's status (a deal may need talking
through after a sale or removal), except under a block. `client_message_id` makes a retried send return the stored
message.

### 6.5 Masking (R6)

`lib/mask-contact.ts` (ported from textile): phones with an optional +91 / 91 / 0 and 10 digits starting 6–9,
Devanagari and Gujarati digits included, separators allowed (space, hyphen, dot, parenthesis), longer digit runs left
alone; emails (a UPI handle without a dot after `@` is not an email; the scam check flags it). Masked digits become
`••••••••••` and an email `•••@•••`.

`visibleText(text, reader, thread)` (`services/chat/chat-view.ts`) is the **only** way text leaves the API for a party:
unmasked only when `thread.contact_unlocked_at` is set **and** the reader is not a `viewer`. It covers messages,
enquiry notes, offer notes, reject notes, deal notes, handover notes, dispute descriptions shown to the other party,
inbox previews and socket payloads. Listing titles and business names in thread strips and notifications are masked
always (they are user-written and public). Stored text is never altered. Numbers written as words or shown in photos
aren't caught (accepted, as in textile and F2).

### 6.6 Share my number and reveal (R6)

- **The tick:** "Share my number with [business] for this deal" (consent wording version 1, three languages), offered
  **only** on the Deal record and as a thread banner once a deal exists in the thread (review change 12: not on the
  offer or accept sheets). Ticking writes a `grant` row with `phone_shown` = the business's current number: its
  verified contact number, else the owner's phone.
- **Who sees the tick:** any non-viewer member when the business has a contact number. When the number would be the
  owner's personal phone, **only the owner** sees it; other members see "Your owner can share the business's number"
  instead. The tick never fails or blocks another action (the API still answers `403 OWNER_CONSENT_REQUIRED` if a
  non-owner calls it directly).
- **Per thread:** a tick shares with this counterpart only **(our call)**. It is idempotent while valid.
- **Withdraw:** removing or replacing the business contact number, or an owner change (another user becomes owner, or
  the owner's phone changes while it is the fallback), writes a business-wide `withdraw` row for the old number (with
  its reason). That number then stops showing in every thread until a side ticks again, which grants the new number.
- **Reveal:** in the transaction that makes the second condition true (accept, or the second side's valid tick),
  `contact_unlocked_at` is set, a `contact_shared` system line and deal event are written, and every member's open
  thread refetches. Only **valid** consents count (§5.5: a `grant` whose `phone_shown` equals the current number).
  From then on non-viewers read every message of the thread unmasked, old ones included.
- **Showing the number:** the Deal record and the thread header (call button, `tel:`) show a side's number only while
  that side's consent in this thread is valid, read at request time. A cancelled deal keeps the thread unlocked.
- **Permanent text:** unmasked message text can't be taken back after a withdraw or a cancel (the tick's wording says
  so); only the number block depends on a valid consent.

### 6.7 Scam warning (R7)

`services/chat/scam-patterns.ts` (ported): `upi://`, `pay?pa=`, a handle like `name@okaxis` / `@ybl` / `@paytm`,
payment-link hosts (`rzp.io`, `paytm.me`, `phon.pe`, `gpay`…), and advance-money phrases in English, Hindi and
Gujarati in their scripts and as typed in Latin ("advance", "token amount", "pehle payment", "एडवांस", "पहले पैसे",
"એડવાન્સ", "પહેલા પૈસા"…; the plan lists the set). Checked on message text and offer / deal notes at write time
(`scam_flag`). The **other side** sees a warning under the message: "Be careful with advance payments. Pay only after
you have checked the part or machine; we can't recover money paid outside the app." Never blocked. Machine listings
also show the "never pay before inspecting a used machine" tip in the thread strip (M19).

### 6.8 Photos (R8)

1. `POST /threads/:id/photos/presign` `{ contentType: image/jpeg|png|webp, contentLength ≤ 10 MB }` → a signed PUT to
   `incoming-chat/<businessId>/<uuid>` (300 s), per-user limit 30 / 10 min.
2. The app uploads (it already resizes to ≤ 2 048 px with `expo-image-manipulator`), then sends the message with the
   keys.
3. Before the message transaction, the API checks each key is this business's, unconsumed upload, reads it (≤ 10 MB),
   sniffs JPEG / PNG / WebP (`lib/sniff-media.ts`), **re-encodes to JPEG with `sharp`** (long edge ≤ 2 048 px, quality
   80, `rotate()` for orientation, no `withMetadata`, so EXIF / XMP / ICC-extras / GPS are dropped), writes
   `chat/<threadId>/<uuid>.jpg` to the private bucket and deletes the upload. Any failure → `400 PHOTO_INVALID` and
   nothing is sent.
4. Reads: each photo in a message payload carries a `presignPrivateGet` URL (300 s) built per request; the app refetches
   the message page when a URL has expired. Only the thread's members (and admins under §16.3) get URLs.

Unlike F2's listing photos (refused when they carry EXIF, F2 §6), chat photos are **stripped**, because chat is quick and a
refusal would be confusing (textile D8; owner's preference). Adds `sharp` to the API (prebuilt `linuxmusl` binaries
work on the `node:22-alpine` image). The same pipeline serves the handover photo and dispute photos
(`deal/<dealId>/…`). The private bucket's lifecycle rule must delete `incoming-chat/` after a day (Open items).

### 6.9 System lines (R9)

Stored as `system_code` + `system_values`; the app renders them with `t('chat.system.<code>', values)` in en / hi / gu.
Codes: `offer_withdrawn`, `offer_rejected`, `offer_expired`, `offer_backup`, `offer_revived`, `offer_reconfirmed`,
`offers_closed`, `deal_agreed`, `deal_notes_changed`, `deal_handed_over`, `deal_completed`, `deal_auto_completed`,
`deal_cancel_requested`, `deal_cancel_request_withdrawn`, `deal_cancelled`, `deal_problem_reported`,
`deal_dispute_resolved`, `contact_shared`, `blocked`. Values are ids, amounts, quantities, side and reason codes and a
business name (masked) — never free text, except `deal_dispute_resolved`'s support message (shown as written, written
by staff).

### 6.10 Inbox (R9)

`GET /threads?filter=all|buying|selling|your_turn&archived=false&cursor=` (20 per page, keyset on
(`last_message_at`, `id`)). Row: counterpart business (name, GST badge), listing thumb and title (masked), last line
preview (per reader: masked text, "2 photos", the system line's code, "Offer ₹34,000 /pc"), time, unread count, a pill:
**Your turn**, **Deal**, or the enquiry status.

**Your turn** (`yourTurn(thread, readerSide)`, shared-types) is true when: an open negotiation's `turn` is the
reader's side; or the reader is the seller and the enquiry is `open`; or a deal in the thread waits on the reader
(`agreed` → seller hands over; `handed_over` → buyer confirms; a cancel request from the other side) **(our call)**.
It is stored on the thread as `buyer_turn` / `seller_turn` (§5.1), recomputed in every transaction that changes an
input, so the filter and its count are indexed reads.
The filter counts on the tab ("Your turn 3").

**Archive** is per user (§5.3); archived threads show under an "Archived" link at the bottom of the list. A badge
endpoint gives the Chats tab its unread-thread count (§12).

### 6.11 Block

From the thread menu by a non-viewer: the two businesses can't start threads with each other, send messages or
offers in existing threads (composer replaced by "You blocked …" / "You can't reply in this conversation"), and their
open offers and backups close (`blocked`). **Deals in progress continue**, and their actions (hand over, confirm,
cancel, report a problem) stay available, so no deal gets stuck **(our call)**. Unblock from Profile › Blocked
businesses. A block is not a report.

### 6.12 Report a conversation

From the thread menu: reason (`CONVERSATION_REPORT_REASONS`) + details (required for `other`, ≤ 500) → a `reports` row
(`target_type = conversation`, `target_id = thread id`), optional "Also block" in the same sheet. It opens the
conversation to admin reading (§16.3). Rate limit 10 reports a day per user.

### 6.13 Share to WhatsApp

The thread menu and the listing page share the listing: title, price, "#ref" and a link
`${EXPO_PUBLIC_SHARE_BASE_URL}/l/<ref>` when the variable is set (no public pages yet, D1), through the system share
sheet. No API change.

---

## 7. Offers

### 7.1 Which buttons a listing shows (`contactActions`, app `lib/listing-page.ts`)

| Listing | Buyer buttons | Opening row |
|---|---|---|
| `machine_rental` (any price model) | Enquire | none (R2; `409 OFFERS_NOT_FOR_RENTALS`) |
| `negotiable` | Enquire · Make offer | `offer`, buyer, price ≤ asking |
| `fixed` | Enquire · Buy at this price | `buy_now`, buyer, price = asking (server sets it) |
| `on_request` | Ask price | none from the buyer; the seller's `quote` (§7.3) |

Make offer / Buy are disabled with "All on hold in deals" when available is 0 (listing `reserved`); Enquire stays. A
price model the button doesn't fit → `409 PRICE_MODEL_MISMATCH`.

### 7.2 Fields and money

| Field | Rule |
|---|---|
| Price per unit | Rupees in the app, `moneyStringToPaise`; > 0; first `offer` ≤ asking (`400 PRICE_ABOVE_ASKING`); `buy_now` = asking. |
| Quantity | ≥ `min_order_qty` (when set, `400 QUANTITY_BELOW_MINIMUM`) — except that when `0 < available <
min_order_qty`, an offer for **exactly the whole available quantity** is allowed —, ≤ available at send (`409 QUANTITY_NOT_AVAILABLE`), the unit's decimals (`400 QUANTITY_DECIMALS`). |
| Validity | One of `offer_validity_hours_1/2/3` (24 / 48 / 168), default the middle one. |
| Note | Optional, ≤ 500, masked per reader, scam-checked. |
| Total | `totalPaise(pricePerUnitPaise, quantity)`: quantity in thousandths as an integer, `(price × milli + 500) / 1000` rounded half up, `bigint` **(our call)**; labelled "+ GST" or "incl. GST" from `gst_mode`. |
| % below asking | `percentBelowAsking(price, asking)`, whole %, shown when below, on negotiable chains only. |

### 7.3 Quotes (price on request, R13)

In a thread on an `on_request` listing with no open negotiation, a seller member sends a quote (price, quantity — default
the enquiry's quantity —, validity, note). It is round 0, `sender_side = seller`, `turn = buyer`. The buyer accepts,
rejects or counters; then the chain runs as any other. A quote on another price model → `409 QUOTE_NOT_ALLOWED`. Quotes
don't count against the buyer's open-offer limit (the seller started them) **(our call)**.

### 7.4 Counter bounds (R14)

Let **B** be the buyer's latest price in the negotiation (none before the buyer's first price) and **S** the seller's
latest price, which is the asking-price snapshot (`asking_price_paise`) until the seller counters, or the quote.

| Counter by | Allowed price `c` |
|---|---|
| Buyer | `B ≤ c < S` (with no B yet, as after a quote: `0 < c < S`) |
| Seller | `B < c ≤ S` |

So every counter lies between the two sides' latest prices, and the buyer's first offer and the asking price bound the
seller's first counter (R14). Equal to the other side's latest price is an accept, not a counter; equal to one's own
latest is allowed only with a different quantity. A counter that changes neither price nor quantity →
`400 COUNTER_UNCHANGED`; outside the bounds → `400 COUNTER_OUT_OF_BOUNDS` with `details: { min, max }`
(`counterBounds()` in shared-types, so the app's form shows the same range). Counters may change the quantity within
minimum and available. A listing price edit during a negotiation doesn't move its bounds (the snapshot).
`buy_now` chains take no counters (`409 COUNTER_NOT_ALLOWED`). After the 5th counter, only accept or reject
(`409 COUNTER_LIMIT`); the card says "Keep talking here, or accept or reject this offer".

### 7.5 Offer state machine

One row per proposal; a counter closes the row as `countered` and inserts the next row `pending` with the turn swapped.

| From | Action | Who | To | Effect |
|---|---|---|---|---|
| — | send `offer` / `buy_now` | buyer member | `pending` (turn seller) | Thread created if needed; counts toward the limit (§7.8). |
| — | send `quote` | seller member | `pending` (turn buyer) | §7.3. |
| `pending` | accept | the side whose turn it is, not `needs_reconfirm` | `accepted` | Deal + hold (§7.6). |
| `pending` | reject (optional note ≤ 300) | turn side | `rejected` | Negotiation ends. |
| `pending` | counter | turn side, rounds left, bounds | `countered` + new `pending` row | Turn swaps; new validity from the counter's choice. |
| `pending` | withdraw | the sender, before any answer | `withdrawn` | |
| `pending` | reconfirm | seller, `needs_reconfirm` | `pending` (turn buyer, fresh validity) | §7.7. |
| `pending` | validity ends (job, DB clock) | system | `expired` | |
| `pending` | quantity no longer fits (reconcile) | system | `backup` (`expires_at` null) | §7.7. |
| `backup` | fits again (reconcile) | system | `pending` (turn seller, fresh validity of its original length) | `needs_reconfirm` when the row is the seller's. |
| `backup` | withdraw | the buyer business (any non-viewer); ends the negotiation | `withdrawn` | |
| `backup` | `offer_backup_max_days` after `backup_since` (job) | system | `expired` | |
| `pending`, `backup` | listing leaves `live` / `reserved` or fails `publicListingWhere()` (`listing_unavailable`); its price model no longer fits the chain (`listing_changed`); a block (`blocked`); the buyer business's owner suspended or blocked (`account_inactive`) | system | `closed` + reason | Stays closed after a reinstatement or unblock. |

Every transition follows the global lock order (§8.5), writes a system line or updates the offer card, emits
`offer:updated` per reader and writes notifications (§11.3). All write routes take an `Idempotency-Key`.

### 7.6 Accept

In one transaction, by the turn side's non-viewer member:
1. Lock the listing `FOR UPDATE`, then the offer; refuse unless `pending`, not expired by `now()`, not
   `needs_reconfirm`, actor's side = `turn` (`409 NOT_YOUR_TURN`, `OFFER_NOT_OPEN`, `OFFER_EXPIRED`,
   `OFFER_NEEDS_RECONFIRM`), the listing passes `publicListingWhere()` and is `live` or `reserved`, and the offer's quantity ≤ `quantity −
   held_quantity`. With too little stock the offer is moved to `backup` and **that change commits**; the service
   returns a result and the route then answers `409 QUANTITY_NOT_AVAILABLE` (nothing is thrown inside the
   transaction).
2. Insert the deal (§9.1) with the offer's terms; insert its `stock_holds` row; `held_quantity += quantity`.
3. `syncReservation(listing)` (§8.2).
4. `reconcileOffersForListing(listing)`: other open offers on the listing whose quantity no longer fits → `backup`
   ("quantity no longer available" to their buyers). Offers that still fit stay open.
5. Thread: `deal_count += 1`; deal card + `deal_agreed` line; reveal check (§6.6).
6. Notifications `offer_accepted` to the other side; emits after commit.

Two accepts racing for the last units serialise on the listing lock; the second gets `QUANTITY_NOT_AVAILABLE` and its
offer becomes a backup.

### 7.7 Backups and reconfirm (R15)

`reconcileOffersForListing(tx, listingId)` (`services/offers/reconcile.ts`, textile D4) reads the listing as it is now
and moves open rows to match, so it is safe to call after any change and twice:
- listing not `live` / `reserved`, or failing `publicListingWhere()` (e.g. its owner suspended) → every `pending` and
  `backup` row `closed` (`listing_unavailable`), one `offers_closed` line per thread;
- the listing's price model no longer fits a chain's opening kind (`offer` needs negotiable, `buy_now` fixed, `quote`
  on request) → that chain `closed` (`listing_changed`);
- available = `quantity − held_quantity`; each `pending` row with quantity > available (and not the whole remainder, §7.2) → `backup` (`backup_since =
  now()`), `offer_backup` line,
  notification `offer_backup` to the buyer;
- each `backup` row with quantity ≤ available → `pending` with a fresh validity of its original length, turn **seller**,
  `needs_reconfirm = true` when the row was sent by the seller (a counter or quote: the buyer can't take a stale price
  until the seller reconfirms with Reconfirm, Counter or Reject); a buyer's row simply returns to the seller's turn, so
  the seller acts first either way. `offer_revived` line and notification to the seller.

Called by: accept, deal cancel (hold released), deal completion, listing quantity or price-model edit, every listing
status change (seller, admin, system; §22 lists the writers), block, and the suspension of a listing's owner. Lock
order per §8.5.

**Suspension (F1's admin action):** suspending or blocking a business's **owner** reconciles that business's listings
(they fail `publicListingWhere()`, so their chains close as `listing_unavailable`) and closes the chains where that
business is the buyer (`account_inactive`). Suspending any other member changes no offer. Closed offers stay closed
after reinstatement. **Deals continue**: the other side may cancel while `agreed`, timers run, and a problem goes to
support. Account deletion doesn't exist yet (DPDP work); it will need its own rule for chains and deals.

### 7.8 Limits (R15)

- Open = negotiations **started by the buyer business** (opening row `offer` or `buy_now`) whose latest row is
  `pending`. **Backups don't count** (they hold nothing and wait on stock); a backup that revives counts again, even
  above the limit (it was within the limit when sent). Counters, quotes and the seller's rows don't count.
- The count and the insert run after locking the **buyer business row `FOR NO KEY UPDATE`** (textile `sendOffer`),
  so two first offers at once can't both pass the limit; the daily new-enquiry count (§12.1) uses the same lock.
- Unverified business (no `gst` in `verification_levels`): `offer_open_limit_unverified` (3); verified:
  `offer_open_limit_verified` (20). Over it → `409 OFFER_LIMIT_REACHED` with the limit in `details`.
- Rate limit on offer actions: 20 a minute per user (§12.1).

### 7.9 Expiry and reminders

Job `offer-expiry` (every minute): `pending` rows with `expires_at ≤ now()` → `expired`, and `backup` rows with
`backup_since` older than `offer_backup_max_days` (14) → `expired`; line and card update,
notification to both sides **(our call: both)**. Job `offer-expiring-soon` (every 5 min): `pending` rows expiring within
`offer_expiring_notice_hours` (6) → one `offer_expiring` notification to the turn side (dedupe key
`offer_expiring:<offerId>:<expires_at>`, so a revived offer gets its own). Both use `FOR UPDATE SKIP LOCKED`.

---

## 8. Stock holds and listing status

### 8.1 Hold lifecycle (R16)

| Event | Hold | `held_quantity` | `listings.quantity` | Then |
|---|---|---|---|---|
| Accept | insert `active` | + deal qty | — | `syncReservation`, reconcile |
| Deal cancelled (any way) | → `released` | − deal qty | — | `syncReservation` (may unreserve), reconcile (backups revive) |
| Deal completed (any way), or a dispute closed as cancelled with the goods not back (§9.6) | → `converted` | − deal qty | − deal qty | quantity 0 → sell-out (§8.2); `min_order_qty` lowered to the new quantity when it would exceed it (null at 0, keeping F2's positive CHECK); reconcile |

All in the deal's transaction, after locking the listing. `services/deals/holds.ts` is the only writer of holds and of
`held_quantity` / the completion decrement.

### 8.2 `syncReservation(tx, listingId)`

Called after every hold change and after every listing status write that lands on `live` or `reserved`:
- `live` or `reserved` with quantity 0 → system `sell_out` → `sold`;
- `live` and available = 0 → system `reserve` → `reserved`;
- `reserved` and available > 0 → system `unreserve` → `live`;
- quantity 0 on a `paused`, `unavailable` or `expired` listing → `sell_out` → `sold`; on a `hidden`, `pending_review`
  or `rejected` listing the status stays and **`return_status = 'sold'`**, where unhide or approval lands; a `removed`
  listing stays removed.

Nothing else sets `reserved`: every write that leaves `reserved` stores `return_status = 'live'` (§8.3), and the next
`syncReservation` puts it back if nothing is available. Reserved listings stay public (F4 R7: shown, tagged Reserved,
ranked down).

### 8.3 Transition and edit changes (fixing what `reserved` lacks today)

| Change | Where |
|---|---|
| `pause` from `reserved` (→ `paused`); `resume` lands through the gate, then `syncReservation`. Pausing closes open offers **and backups for good** (reconcile); the pause confirmation says so when there are any: "Paused listings take no offers. The n open offers and backups will close." | `LISTING_TRANSITIONS`, app copy |
| `mark_unavailable` from `reserved` (→ `unavailable`): "mark the rest unavailable"; holds and deals continue. | `LISTING_TRANSITIONS` |
| `hide` and `photos_removed` from `reserved` (`HIDEABLE` gains it). Leaving `reserved` (hide, `back_to_review`, `photos_removed`) always stores `return_status = 'live'`, never `reserved`; unhide / approval land on `live`, then `syncReservation`. | `LISTING_TRANSITIONS` |
| `back_to_review` from `reserved` (an edit flagged by the sanity checks), `return_status = live`, then `syncReservation` after approval. | `LISTING_TRANSITIONS` |
| New system action **`sell_out`**: from `live`, `reserved`, `paused`, `unavailable`, `expired` → `sold`, when quantity reaches 0 (on `hidden` / `pending_review` / `rejected` only `return_status = 'sold'` is set, §8.2). | `SYSTEM_LISTING_ACTIONS`, `LISTING_TRANSITIONS` |
| A **unit** change (seller or admin) while the listing has active holds or open / backup offers → `409 UNIT_LOCKED`. A **price-model** change runs reconcile, closing chains whose kind no longer fits (`listing_changed`). | `listing-write.service.ts`, `adminPatchListing` |
| `listings_quantity_positive` relaxed to `>= 0` (§5.7); seller and admin input still refuse 0. | custom migration |
| `reserved` joins `EDITABLE_LISTING_STATUSES`: price, photos, description, specs editable; a quantity edit must stay ≥ `held_quantity` (`409 QUANTITY_BELOW_HELD`), then `syncReservation` + reconcile. Same rule on every editable status with holds. | `listing-write.service.ts` |
| Seller `mark_sold` and seller `remove` with `held_quantity > 0` → `409 LISTING_HAS_OPEN_DEALS` (`details: { dealIds }`); the app's sheet says "Cancel the open deals first" and links them. | `listing-lifecycle.service.ts` |
| Admin `remove` with open deals: deals in `agreed` are cancelled (`listing_removed`, system), holds released; `handed_over` / `disputed` deals continue as records and complete normally (the decrement still applies to the removed listing) **(our call)**. | `listing-admin.service.ts` |
| `expire` keeps `from: [live, rented]`: a `reserved` listing doesn't expire; a `live` listing with holds may expire and its deals continue. | unchanged |
| `relist` from `sold` after a sell-out needs a quantity edit > 0 first (`400 QUANTITY_REQUIRED`) **(our call)**. | `listing-lifecycle.service.ts` |

Every status change still goes through `listing-lifecycle.service.ts` (F2: the only writer of `status`) and calls
reconcile and `syncReservation` afterwards; §22 lists every writer that must.

### 8.4 Where available quantity shows

`ListingCard` keeps `quantity` and gains **`availableQuantity`**, which F4's cards and search results show; the
listing page shows available too ("2 of 3 pcs available", "All on hold in deals"); F4's `minQty`
filter and facets use `quantity − held_quantity`; the owner's My listings shows "On hold in deals: n" linking to the
Deals tab.


### 8.5 Lock order

One global order in every transaction of this module: **buyer business** (`FOR NO KEY UPDATE`, only where a limit is
counted: a first offer, a new enquiry) → **listing** (`FOR UPDATE`) → **deal** → **offer(s)** (id order) → **thread**
(system lines, turn and seq columns). Deal routes and deal jobs read the deal's `listing_id` without a lock first, then
lock the listing, then the deal, and re-check the deal's status. Accept: listing → offer → (deal and hold insert) →
thread.

---

## 9. Deals

### 9.1 The record (R17)

Created only by an accepted offer (§7.6). Shows: listing (thumb, title snapshot, link), counterpart business, price per
unit, quantity and unit, total (+ GST mode), "Payment happens outside the app" line, notes, timeline (`deal_events`),
contact block (§6.6), actions for the reader's side, review card once completed.

**Notes** (`PATCH /deals/:id/notes`, either side's non-viewer, while `agreed` or `handed_over`): payment method,
advance (≤ total; the balance is shown), pickup or delivery, expected date, a short text (masked, scam-checked). One
shared record, last write wins with `version`; each save writes a `deal_notes_changed` line naming the changed fields,
not their values **(our call)**.

### 9.2 Deal state machine (R18–R21)

| From | Action | Who | To | Effect |
|---|---|---|---|---|
| — | accept | §7.6 | `agreed` | hold `active` |
| `agreed` | **hand over** (optional photo, note ≤ 300) | seller | `handed_over` | `problem_deadline_at = now + 2 d`, `auto_complete_at = now + 3 d` |
| `agreed` | **cancel** (reason, note) | either side alone | `cancelled` | hold released; reconcile |
| `agreed` | listing removed by an admin | system | `cancelled` (`listing_removed`) | hold released |
| `handed_over` | **confirm received** | buyer | `completed` (`buyer_confirmed`) | hold converted (§8.1) |
| `handed_over` | **report a problem** | buyer until `problem_deadline_at`; seller until completion **(our call)** | `disputed` | timers stopped; dispute row |
| `handed_over` | request cancel (reason) | either side | `handed_over` (request recorded) | other side asked |
| `handed_over` | accept cancel request | the other side | `cancelled` (`both`) | hold released; reconcile |
| `handed_over` | **clear cancel request** | either side (the requester withdraws it, the other declines it) | `handed_over` | request cleared |
| `handed_over` | `auto_complete_at` passed (job) | system | `completed` (`auto`) | hold converted |
| `disputed` | resolve **completed** | support | `completed` (`support`) | hold converted |
| `disputed` | resolve **cancelled** | support | `cancelled` (`support_closed`) | `stockReturned: true` → hold released; `false` → hold **converted** (the stock left; quantity goes down, textile D12 / D18); reconcile |
| `disputed` | resolve **resumed** | support | `handed_over` | `problem_deadline_at = now + 2 d`, `auto_complete_at = now + 3 d` |

`completed` and `cancelled` are final. Every action checks the actor's side and role (`viewer` → `403`) and the status (`409 DEAL_TRANSITION_NOT_ALLOWED`);
only a notes edit checks `version` (`409 DEAL_STALE`); retried taps are covered by the idempotency key. Each action writes a deal event, a system line
and notifications; emits `deal:updated` (ids, status, version: no text) to every member of both businesses. All write
routes take an `Idempotency-Key`. Lock order per §8.5.

- A pending cancel request doesn't stop the auto-complete timer; it lapses when the deal completes or is disputed. A
  buyer who disagrees with the handover reports a problem **(our call)**.
- After a resume, either side can report again; support decides.
- A suspended party doesn't stop a deal: the other side may cancel while `agreed`, the timers run, and a problem goes
  to support (§7.7).
- `dealYourTurn(deal, side)` (shared-types): seller on `agreed`; buyer on `handed_over`; the other side of a cancel
  request. The Deals tab badge counts these.

### 9.3 Timers (R21)

Plain calendar time from the handover instant: report window `deal_problem_window_days` (2) × 24 h, auto-complete
`deal_auto_complete_days` (3) × 24 h. The app shows the end as a date and time in IST ("completes on Thu 21 Nov,
16:40"). Job `deal-auto-complete` (every 5 min) reads candidate deal ids **without locks**, then per deal (own savepoint, as F2's
expiry job) locks the listing, then the deal `FOR UPDATE SKIP LOCKED`, re-checks `status = 'handed_over' AND
auto_complete_at ≤ now()` and completes it; a disputed deal fails the re-check. Every deal job follows this pattern.

**Stale `agreed` deals:** no auto-cancel. Job `deal-agreed-reminder` (daily, same pattern) sends both sides
`deal_agreed_reminder` ("Still to hand over? Mark it handed over, or cancel the deal") for deals `agreed` longer than
`deal_agreed_reminder_days` (7), at most once per that period (`agreed_reminded_at`).

### 9.4 Completion

In one transaction: status `completed`, `completed_at`, hold converted (§8.1, `sell_out` at 0), reconcile, deal event
and line, notifications `deal_completed` to both sides with the review prompt. Reviews open (§10).

### 9.5 Cancelling (R19)

- **Before handover** (`agreed`): either side, a reason from its list + optional note (≤ 300, masked). Immediate. The
  hold is released and backups revive.
- **After handover** (`handed_over`): one side requests (reason); the other accepts, or either side clears the request (one
  action: the requester withdraws, the other declines). Accepting cancels (`cancelled_by_side = both`) and releases the hold (the goods are assumed back with the
  seller; anything else is a problem report) **(our call)**.
- **Disputed:** only support.
- Cancellations are recorded on the deal and visible to both; they are not scored in this build.

### 9.6 Disputes (R20)

- **Report a problem** sheet: category (`DISPUTE_CATEGORIES`), description (10–1 000, masked to the other side),
  up to 5 photos (§6.8 pipeline). Creates the `deal_disputes` row, status `disputed`, line, notification
  `deal_problem` to the other side and an admin socket event to `adminRoleRoom('support')`.
- **Queue** (§16.1): support opens the dispute, reads the timeline, notes and problem, and may open the conversation
  with a typed reason (audit `thread.read`, §16.3).
- **Resolve:** outcome `completed` / `cancelled` / `resumed`; for `cancelled` the form asks **"Did the goods go back
  to the seller?"** (`stockReturned`, required): yes releases the hold, no converts it (textile D12 / D18); an internal
  note (required, audit only) and an optional
  message to both parties (≤ 500, shown in the thread's `deal_dispute_resolved` line). Effects per §9.2.
  Notification `deal_dispute_resolved` to both. Audit `deal.dispute_resolve` with before / after.
- **History:** the dispute rows are the record on both businesses' history: admin business detail shows deals by
  status and disputes with outcomes; each party's Deal record shows "Problem reported · resolved: completed by support".
  Not public in this build **(our call)**.

---

## 10. Reviews

### 10.1 Who and when (R22)

Only the two businesses of a **completed** deal (any `completed_how`), one review per side (unique index). The submitter
is a non-viewer member of the reviewer business. Window: until `completed_at + review_window_days` (14 d). Outside →
`409 REVIEW_WINDOW_CLOSED`; not completed → `409 REVIEW_NOT_ELIGIBLE`; twice → `409 REVIEW_EXISTS`.

### 10.2 Facets

| Review | Given by | Ratings (1–5 whole stars, all required) | Optional |
|---|---|---|---|
| Of the seller | Buyer | Part / machine matched the listing · Communication · Handed over on time | Text ≤ 1 000, public |
| Of the buyer | Seller | Communication · Paid as agreed · Pickup on time | None in MVP: stars are stored, not shown yet (§10.4) |

Missing, extra or non-integer ratings, or text on a seller → buyer review → `400 REVIEW_ANSWERS_INVALID`. Text is masked always (it can be public) and
scam-checked. No edits or withdrawal after submitting (textile).

### 10.3 Blind publishing (R22)

| State | Rule |
|---|---|
| Neither submitted | Nothing visible. At `completed_at + 14 d` the deal can no longer be reviewed. |
| First side submits at `t` | `publish_due_at = min(t + review_blind_days (7 d), completed_at + 14 d)` on that review. The other side is notified it has until then. The review is visible only to its author. |
| Second side submits before `publish_due_at` | Both publish at once, in that transaction. |
| `publish_due_at` passes with one review | Job `review-publish` (every 15 min, `FOR UPDATE SKIP LOCKED`) publishes it; the other side can no longer review. |

Publishing a buyer → seller review sends `review_received` to the seller; a seller → buyer review publishes silently
(nothing about it shows yet).

### 10.4 Scores and where they show

- **Counted:** published, not hidden reviews.
- **Seller score** (reviews by buyers): overall stars = mean of every facet rating, rounded half up to one decimal at
  display; facet % = facet mean ÷ 5, whole %; shown only with ≥ `review_min_published` (3) reviews, else "New seller".
  On the listing page's seller block (stars, count, link) and a **Seller reviews** screen (score, facet bars, reviews
  newest first with replies). Public (guests too).
- **Buyer score** (reviews by sellers): **cut for MVP** (review change 11). The stars are stored; showing them (to
  sellers, on offer cards and in the thread header) is P2.
- Profile › Reviews: my seller score and reviews received (with Reply).

### 10.5 Reply

The reviewed seller (non-viewer member) replies once to a published review of them, ≤ 300, masked, public, no edit
(`409 REPLY_EXISTS`).

### 10.6 Reports and moderation

Any signed-in user can report a published review (`REVIEW_REPORT_REASONS` + note) → `reports` row
(`target_type = review`). Moderators hide the review or only its reply (reason required) or dismiss the report,
audit-logged; a hidden review leaves the scores at once and shows to its author as "Hidden by our team".

---

## 11. Notifications and push (F9 subset, R25)

### 11.1 Rows first, written in the change's transaction

`notify(tx, { type, recipients: businessId, exceptUserId?, params, destination, dedupeKey })`
(`services/notifications/notification.service.ts`) inserts one `notifications` row per recipient user and one `notification_deliveries` row per device of each recipient with push on (`users.push_enabled`), **inside the
transaction that made the change**. There is no outbox in this project; writing the rows in the same transaction gives
the same "exactly once per event and user" without one **(our call)**. Unique `dedupe_key` per user makes a repeat a
no-op.

**Recipients:** every active member of the business the event concerns (viewers too: they read), never the actor's
own business for the actor's own action **(our call)**.

### 11.2 Grouped chat rows (textile Part 1 §5.9)

`message_new` keeps **one unread row per thread per user** (the partial unique index of §5.13, written with
`INSERT … ON CONFLICT DO UPDATE`, so two messages at once can't make two rows): the first message creates it ("New message from Kamal
Earthmovers"), later ones bump `unread_count`, `last_seq` and `version` ("3 new messages from Kamal Earthmovers") and move
it to the top. Reading the thread (`POST /threads/:id/read`) marks that row read; the next message starts a new row.
`enquiry_new` is its own row (title: "New enquiry", body: the listing title, masked).

### 11.3 What gets a notification

| Type | Category | To | Opens |
|---|---|---|---|
| `enquiry_new` | chat | Seller business | Thread |
| `message_new` (grouped) | chat | The other party | Thread |
| `offer_new` (offer or Buy at this price) | offers | Seller | Thread, offer card |
| `offer_quote` | offers | Buyer | Thread |
| `offer_countered` | offers | The other party | Thread |
| `offer_accepted` | offers | The other party | Deal record |
| `offer_rejected` | offers | The sender's party | Thread |
| `offer_expiring` (6 h before) | offers | Turn side | Thread |
| `offer_backup`, `offer_revived` | offers | Buyer / seller | Thread |
| `deal_handed_over` | deals | Buyer | Deal record |
| `deal_cancel_requested`, `deal_cancelled` | deals | The other party | Deal record |
| `deal_completed` (with "Rate this deal") | deals | Both | Deal record |
| `deal_problem` | deals | The other party | Deal record |
| `deal_dispute_resolved` | deals | Both | Deal record |
| `deal_agreed_reminder` | deals | Both | Deal record |
| `review_received` | reviews | Reviewed seller | Reviews |

### 11.4 Text (no message text, R25)

Rows store the type and params; the API renders title and body **in the recipient's `users.language`** for the push and
for `GET /notifications` (`services/notifications/text/{en,hi,gu}.ts`). Allowed in text: business names and listing
titles (masked by `mask-contact`), amounts per unit, quantities, deal ref. **Never:** message text, notes, phone numbers,
emails, review text, OTPs, GST details. Chat pushes say "New message" / "3 new messages" with the business name only.

### 11.5 Push delivery

- **API:** `firebase-admin` (FCM HTTP v1) behind a `PushProvider` interface (`fcm-provider.ts`); credentials
  `FIREBASE_SERVICE_ACCOUNT_B64` (base64 service-account JSON) in the root `.env`. **Dev stub:** without credentials
  outside production a send is recorded `sent_dev` and logged without content. In production without credentials the
  API starts, logs a warning at boot and records `skipped` **(our call: a missing key must not stop chat)**.
- Job `notification-push` (every 3 s): claims `queued` deliveries due `FOR UPDATE SKIP LOCKED` (batch 100), renders,
  sends; retries a transient error with backoff (15 s, 1 min, 5 min, 30 min) then `failed`; FCM `unregistered` /
  `invalid-argument` token → device row deleted. **Skips a chat push** while the recipient is viewing that thread
  (Redis `viewing:<userId>` = threadId, 45 s expiry, refreshed by `thread:viewing` every 20 s) and marks the row read.
- **Payload:** `notification` (title, body) + `data` (`notificationId`, `type`, destination ids, `deliveryKey` =
  `<notificationId>:<version>`); Android `tag` = `thread:<id>` for chat, else the notification id, so a repeat or
  update replaces the shown one. The app skips a foreground push whose delivery key it already showed (last 100 in
  AsyncStorage). Tapping marks the row read and opens the destination; every destination checks access as usual.

### 11.6 Devices and preferences

- `PUT /users/me/devices` `{ installId, fcmToken, platform, appVersion }` after sign-in, on token refresh and on app
  start; the install is taken away from any other account. Sign-out deletes it (`DELETE /users/me/devices/:installId`).
- **Preferences:** one push on / off switch (`users.push_enabled`, default on) on a Notification settings screen;
  category switches are P2 (review change 29). In-app rows are always created. **No quiet hours** in this build: every event here
  is time-sensitive (P2 with the digest work).
- **Permission:** a short explainer screen, then Android 13's `POST_NOTIFICATIONS` prompt, shown the first time the
  user sends an enquiry or offer, publishes a listing, or opens Chats — never at app start **(our call)**.
- In-app list (bell, mockup "Notifications"): bell with unread count on Home's header; rows with icon, title, body,
  time, unread dot; tap opens and marks read; "Mark all as read"; infinite scroll; unread count live through
  `notification:new`. Rows older than 90 days deleted by `notification-retention` (daily).

---

## 12. API

User routes use `requireUser` (an active user with a business; onboarding gate), reply `{ data }`. Writes that a retry
could double take an `Idempotency-Key` header (marked **I**); a reused key with a different body →
`422 IDEMPOTENCY_KEY_REUSED`, a concurrent one → `409 REQUEST_IN_PROGRESS`. Party checks: the actor's business is the
thread's / deal's buyer or seller, else `404` (no existence leak). `viewer` → `403 VIEWER_READ_ONLY` on every write
except reading, marking read and archiving (archive is per-user state; plan review 2026-11-19).

### 12.1 Rate limits

Keyed by user id (F4's key function): messages 30 / min; offer actions (send, counter, accept, reject, withdraw, quote,
reconfirm) 20 / min; deal actions 20 / min; photo presign 30 / 10 min (`perUser`); reports 10 / day; new enquiries per
**business** per day: `enquiry_new_per_day_unverified` (10) / `_verified` (40) (a counted query over threads created
today, IST, after locking the buyer business row, §8.5; not a Redis bucket) **(our numbers)**; contact-phone OTP as F1's OTP limits.

### 12.2 Routes

| Route | Body / params | Reply |
|---|---|---|
| `POST /listings/:id/enquiry` **I** | `{ quick: QuickEnquiry[], quantity?, note?, fit?: { brandId, modelId?, year? } }` | `{ threadId, message }` |
| `POST /listings/:id/offers` **I** | `{ kind: 'offer'\|'buy_now', pricePerUnitPaise?, quantity, validityHours, note? }` | `{ threadId, offer }` |
| `GET /offers/options` | | `{ validityHours: [24, 48, 168], defaultValidityHours, maxCounterRounds, openLimit, openCount }` |
| `GET /threads` | `?filter=&archived=&cursor=` | `{ items: InboxRow[], nextCursor, counts: { yourTurn } }` |
| `GET /threads/:id` | | `ThreadDetail` (listing strip read whatever the listing's status: the latest deal's title
snapshot when there is one, and "No longer listed" when the listing isn't public; counterpart, my side, can-write flags, block state, open negotiation, deals in thread, contact state: `mine: consented?`, `theirs: consented?`, `revealed`, `number?`) |
| `GET /threads/:id/messages` | `?before=<seq>` (30 per page) | `ThreadMessage[]` per reader |
| `POST /threads/:id/messages` | `{ clientMessageId, text?, photoKeys? }` | `ThreadMessage` |
| `POST /threads/:id/photos/presign` | `{ contentType, contentLength }` | `{ url, key, expiresAt }` |
| `GET /threads/:id/messages/:messageId/photos` | | fresh signed URLs |
| `POST /threads/:id/read` | `{ seq }` | `{ unread: 0 }` |
| `PUT` / `DELETE /threads/:id/archive` | | |
| `POST /threads/:id/share-contact` **I** | | `{ revealed, number? }` |
| `POST /threads/:id/report` | `{ reason, details?, block? }` | `{ reported: true }` |
| `POST /threads/:id/block` | | `{ blocked: true }` |
| `GET /users/me/blocks`, `DELETE /users/me/blocks/:businessId` | | |
| `POST /threads/:id/quote` **I** | `{ pricePerUnitPaise, quantity, validityHours, note? }` | `OfferView` |
| `POST /offers/:id/accept` **I** | — | `{ offer, dealId }` |
| `POST /offers/:id/counter` **I** | `{ pricePerUnitPaise, quantity, validityHours, note? }` | `OfferView` (new row) |
| `POST /offers/:id/reject` **I** | `{ note? }` | `OfferView` |
| `POST /offers/:id/withdraw` **I**, `POST /offers/:id/reconfirm` **I** | | `OfferView` |
| `GET /deals` | `?tab=active\|completed\|cancelled&side=all\|buying\|selling&cursor=` | `{ items: DealListRow[], nextCursor, counts }` |
| `GET /deals/:id` | | `DealView` (terms, notes, timeline, actions for me, contact, dispute summary, review state) |
| `PATCH /deals/:id/notes` **I** | `{ version, paymentMethod?, advancePaise?, fulfilment?, expectedOn?, text? }` | `DealView` |
| `POST /deals/:id/photos/presign` | as threads | |
| `POST /deals/:id/hand-over` **I** | `{ photoKey?, note? }` | `DealView` |
| `POST /deals/:id/confirm-received` **I** | — | `DealView` |
| `POST /deals/:id/cancel` **I** | `{ reason, note? }` (agreed) | `DealView` |
| `POST /deals/:id/cancel-request` **I**, `…/cancel-request/accept` **I**, `…/cancel-request/clear` **I** | `{ reason? }` | `DealView` |
| `POST /deals/:id/problem` **I** | `{ category, description, photoKeys? }` | `DealView` |
| `GET /deals/:id/review` | | `ReviewState` (eligible, window end, mine, theirs submitted?, publish due) |
| `POST /deals/:id/review` **I** | `{ ratings, text? }` | `ReviewState` |
| `POST /reviews/:id/reply` **I** | `{ text }` | `PublicReview` |
| `POST /reviews/:id/report` | `{ reason, details? }` | |
| `GET /businesses/:id/reviews` (public, `optionalUser`) | `?cursor=` | `{ score: SellerScore, items: PublicReview[], nextCursor }` |
| `GET /users/me/reviews` | | my seller score and reviews received |
| `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all` | | |
| `GET` / `PUT /notifications/preferences` | `{ push: boolean }` | |
| `PUT /users/me/devices`, `DELETE /users/me/devices/:installId` | §11.6 | |
| `PUT /users/me/language` | `{ language: 'en'\|'hi'\|'gu' }` | (new: server text follows the app) |
| `GET /users/me/badges` | | `Badges { unreadThreads, dealsYourTurn, notificationsUnread }` |
| `POST /businesses/me/contact-phone/otp/send`, `…/verify`, `DELETE /businesses/me/contact-phone` | owner only | F1-style OTP |

`ListingView` (F2) gains `seller.score: SellerScore | null`, `availableQuantity`, `myThreadId` (signed-in buyer) and
`openNegotiation` summary for the buyer.

---

## 13. Sockets (R10)

No thread room (textile D2; `threadRoom` in `rooms.ts` is removed). `emitToThreadMembers(ctx, thread, build)`
(`services/chat/chat-emit.ts`) builds each member's payload for that reader (masking, side, can-act flags) and emits to
`userRoom(userId)` **after commit** (queued on the transaction context). Business rooms carry nothing with text.

| Event | Direction | Payload |
|---|---|---|
| `message:new` | server → each member | `{ threadId, message: ThreadMessage, row: InboxRow }` (per reader) |
| `offer:updated` | server → each member | `{ threadId, offer: OfferView }` (per reader: note masked, can-act) |
| `deal:updated` | server → each member of both businesses | `{ dealId, threadId, status, version }` (no text; clients refetch) |
| `thread:read` | server → the reader's own room | `{ threadId, seq }` (badges on the user's other devices) |
| `notification:new` | server → recipient | `{ unreadCount }` |
| `thread:viewing` | client → server | `{ threadId \| null }`, every 20 s while a thread is on screen; ignored unless the user's business is a party (checked in the DB). |

Clients refetch threads, the open thread and deals on reconnect and on focus; sockets are best-effort. Suspension
already disconnects sockets on the same process (F1 note on the Redis adapter stays open).

---

## 14. Jobs

Added to `src/jobs/index.ts`; each claims rows `FOR UPDATE SKIP LOCKED` in batches with a per-row savepoint, and each
row is safe to process twice (status filters in the `UPDATE`). Jobs that change offers or deals read candidate ids
unlocked, then lock the listing, then the row `SKIP LOCKED`, and re-check (§8.5). Jobs get the emit and notify
context the routes have, so their reconcile can post lines, notifications and socket events.

| Job | Every | Work |
|---|---|---|
| `offer-expiry` | 1 min | `pending` past `expires_at` → `expired`; `backup` older than `offer_backup_max_days` → `expired` (§7.9). |
| `offer-expiring-soon` | 5 min | `offer_expiring` notifications (§7.9). |
| `deal-auto-complete` | 5 min | `handed_over` past `auto_complete_at` → `completed` (§9.3). |
| `deal-agreed-reminder` | daily | Nudge both sides of deals `agreed` longer than `deal_agreed_reminder_days` (§9.3). |
| `review-publish` | 15 min | Single reviews past `publish_due_at` → published (§10.3). |
| `notification-push` | 3 s | Send queued deliveries (§11.5). |
| `notification-retention` | daily | Delete notifications > 90 days and their deliveries. |
| `idempotency-cleanup` | hourly | Delete keys > 24 h. |

---

## 15. App

All screens in the Periwinkle v2 kit, `useTheme()` (light only), `useType()`, `t()` in en / hi / gu with parity and
audit tests, `testID` on every pressable, amounts in Indian format, part numbers in JetBrains Mono (`apps/user-app/
CLAUDE.md` §1–2, §6, §8). Screens without a mockup use the `frontend-design` skill in the mockup's language.

### 15.1 Screens mapped to the mockup

| Screen | Mockup (`build-periwinkle-v2.mjs`) | Differences |
|---|---|---|
| Enquire sheet | negotiate · "Enquire" | Adds "Price please" (Ask price), quantity for Best price, the machine line when Check my machine has a choice. |
| Thread | negotiate · "Chat thread" | No call button until reveal (then `tel:`), no mic; composer: + (photos), message, send; masked-number notice; scam warning under flagged messages; listing strip with available quantity ("No longer listed" with the deal's title snapshot when the listing isn't
public); deal card; menu: share, report, block, archive. |
| Make an offer / Buy at this price / Counter / Quote | negotiate · "Make an offer" | Same sheet in four modes; bounds hint on counters ("Between ₹34,000 and ₹38,500"); "Round n of 5". Buy mode locks the price. |
| Offer card (both sides) | negotiate · "Offer received (seller)", "Counteroffer" | Buttons only for the turn side; backup and reconfirm states. |
| Chats tab (inbox) | negotiate · "Enquiries inbox" | Tab stays "Chats" (app nav); segments All / Buying / Selling / Your turn n; Archived link. |
| Deal record | deals · "Deal record" | Timeline from `deal_events`; notes card (edit sheet); contact block with the share tick; Cancel / Mark handed over (seller) or Cancel (buyer). |
| Handed over | deals · "Handed over" | Callout with the report deadline and auto-complete date; Report a problem / Confirm received. |
| Deals tab | deals · "My deals" | Segments Active / Completed / Cancelled; Buying / Selling filter; no rental rows (M14). |
| Review | deals · "Review" | Facets per side; "published when both have reviewed, or 7 days after the first". |
| Notifications | account · "Notifications" | Rows per §11.3; no part-match or booking rows yet. |
| New (no mockup) | — | Report a problem, Cancel deal / Request cancel, Share my number sheet, Report conversation, Block confirm, Seller reviews, Profile › Reviews, Notification settings, Push permission explainer, Profile › Contact number (OTP), Profile › Blocked businesses. |

### 15.2 Changes to existing screens

- **Listing page:** `contactActions` per §7.1 (fixed gets Buy at this price), replacing the "Coming soon" toast;
  "Open chat" when `myThreadId`; available quantity; seller block stars; owner view "On hold in deals: n".
- **Guests (R24):** `SIGN_IN_REASONS` + `enquire`, `offer`; `PendingAction` gains `{ type: 'enquire' | 'offer' | 'buy' |
  'ask_price', listingId }`. After sign-in and onboarding the app **reopens the listing and its sheet**, never sending
  anything by itself **(our call)**.
- **Tabs:** Chats badge = unread threads; Deals badge = deals waiting on you; Home header bell with unread count (F4
  left it out until F9).
- **My listings / manage sheet:** `LISTING_HAS_OPEN_DEALS` sheet; quantity sheet refuses below held; the pause
  confirmation warns that open offers and backups will close for good (§8.3); the unit can't change while deals or
  offers are open (`UNIT_LOCKED`).
- **Profile:** Reviews, Contact number, Blocked businesses, Notification settings rows.
- **Language change** calls `PUT /users/me/language`.

### 15.3 Foundation

`lib/chat-api.ts`, `lib/deals-api.ts`, `lib/reviews-api.ts`, `lib/notifications-api.ts`; pure logic with tests:
`lib/offer-form.ts` (totals, % below, bounds, validation), `lib/chat-format.ts` (previews, system line params, your-turn
pill), `lib/deal-display.ts` (actions per side, timeline, deadline copy), `lib/review-form.ts`, `lib/push.ts` +
`lib/push-dedupe.ts`, `lib/notification-links.ts` (type → screen). React Query keys `['threads', …]`, `['thread', id]`,
`['deals', …]`, `['deal', id]`; `useSocket` handlers patch them by event prefix. Native: **`expo-notifications`**
(config plugin, `google-services.json`): **new dev-client build** (`pnpm android`).

### 15.4 Analytics (`lib/analytics-events.ts`)

`CHAT_EVENTS` (`chat_enquiry_sent { quickCount, hasNote, hasMachine }`, `chat_message_sent { photos }`,
`chat_thread_archived`, `chat_conversation_reported { reason }`, `chat_business_blocked`, `chat_listing_shared`,
`chat_contact_shared`), `OFFER_EVENTS` (`offer_sent { kind, validityHours }`, `offer_countered { round }`,
`offer_accepted`, `offer_rejected`, `offer_withdrawn`, `offer_quote_sent`), `DEAL_EVENTS` (`deal_handed_over
{ withPhoto }`, `deal_received_confirmed`, `deal_cancelled { side, reason }`, `deal_cancel_requested`,
`deal_problem_reported { category }`, `deal_notes_saved`), `REVIEW_EVENTS` (`review_submitted { side }`,
`review_replied`, `review_reported`), `NOTIFICATION_EVENTS` (`push_permission_answered { granted }`,
`notification_opened { type }`). **Never** text, notes, phone numbers, amounts or names.

---

## 16. Admin

### 16.1 Pages and roles (`lib/nav.ts`)

| Page | Path | Roles (super_admin passes) | Content |
|---|---|---|---|
| Enquiries & offers | `/enquiries` (exists, placeholder) | `support`, `operations` | Monitor: threads with listing, buyer, seller, kind, enquiry status, open negotiation (round, last price, quantity, turn, expiry), deals count, created, last activity; filters (enquiry status, offer status, kind, date, business search). Detail: the offer chain (prices, quantities, statuses, who, when). **No message or note text.** Read-only. |
| Deals | `/deals` (exists, placeholder) | `support`, `operations` | List with status tabs (Agreed, Handed over, Disputed, Completed, Cancelled), business search, date, totals; detail: terms, structured notes (not the free text), timeline, hold state, review state, dispute link. Read-only (actions live in Disputes). |
| **Disputes** (new, Queues group, badge `disputesOpen`) | `/disputes` | `support` | Open first, oldest first; detail: deal, timeline, problem (description, photos), Read conversation (reason dialog), Resolve (outcome; "Did the goods go back to the seller?" for cancelled; internal note; message to parties). |
| Conversations | `/chats` (exists, placeholder) | `moderator`, `support` | **Reported conversations only**: report reason, reporter, status; Read conversation (reason dialog) → messages as stored with photos; resolve the report (actioned / dismissed, note). Links to the businesses' Suspend / Block actions (F1). |
| Reports & flags | `/reports` (exists, placeholder) | `moderator`, `support` | Tabs: Conversations (as above, shared component) and **Reviews** (moderator: hide review / hide reply / dismiss, reason). |
| Users & businesses (exists) | `/businesses/:id` | as today | Adds deals by status, disputes with outcomes and review scores. |
| Settings (exists) | `/settings` | super_admin | New section "Negotiation, deals and reviews" (§17). |

### 16.2 Admin API

`GET /admin/enquiries`, `GET /admin/enquiries/:threadId`; `GET /admin/deals`, `GET /admin/deals/:id`;
`GET /admin/disputes`, `GET /admin/disputes/count`, `GET /admin/disputes/:id`, `POST /admin/disputes/:id/resolve`
`{ outcome, stockReturned? (required for cancelled), internalNote, messageToParties? }`; `POST /admin/threads/:id/read` `{ reason }` → messages (§16.3);
`GET /admin/reports?target=conversation|review&status=`, `POST /admin/reports/:id/resolve` `{ outcome: actioned |
dismissed, note }`; `POST /admin/reviews/:id/hide`, `/unhide`, `/hide-reply` `{ reason }`. Every mutation writes
`audit_log` (`deal.dispute_resolve`, `report.resolve`, `review.hide`, `review.unhide`, `review.hide_reply`) with
before / after. Admin socket: `dispute:new` to `adminRoleRoom('support')`, `report:new` to moderators and support.

### 16.3 Reading a conversation (R23)

`POST /admin/threads/:id/read` (a POST because it records the read): allowed only while the thread has a
`conversation` report that is `open` or `reviewing` or was resolved within the last 30 days, or a deal in it has an
`open` dispute or one resolved within the last 30 days (`403 ADMIN_READ_NOT_ALLOWED` otherwise), with a reason
(`ADMIN_REASON_MIN`–`MAX`). Writes `audit_log` `thread.read` (admin, thread, reason, report / dispute id) **on every
read**. Returns messages as stored (unmasked: the reader is staff), photos as 300 s signed URLs, never the revealed
contact numbers. The page keeps the result in memory only (no caching in the browser).

---

## 17. Settings (`APP_SETTINGS` registry, int, admin Settings page)

| Key | Default | Range | Meaning |
|---|---|---|---|
| `offer_validity_hours_1` / `_2` / `_3` | 24 / 48 / 168 | 1–720 | The three validity choices; `_2` is the default. Must increase. |
| `offer_open_limit_unverified` | 3 | 1–50 | Open negotiations for a business without GST. |
| `offer_open_limit_verified` | 20 | 1–500 | Open negotiations for a GST-verified business. |
| `offer_expiring_notice_hours` | 6 | 1–48 | "Expiring soon" lead time; less than `_1`. |
| `enquiry_new_per_day_unverified` | 10 | 1–500 | New threads a day, unverified business. |
| `enquiry_new_per_day_verified` | 40 | 1–2 000 | New threads a day, verified business. |
| `deal_problem_window_days` | 2 | 1–30 | Buyer's report window after handover. |
| `deal_auto_complete_days` | 3 | 1–60 | Auto-complete after handover; greater than the problem window. |
| `review_window_days` | 14 | 3–90 | Reviews possible after completion. |
| `review_blind_days` | 7 | 1–30 | Time the other side has after the first review; ≤ the window. |
| `review_min_published` | 3 | 1–20 | Reviews before a score shows. |
| `offer_backup_max_days` | 14 | 1–90 | A backup waiting this long expires; at least as long as `offer_validity_hours_3`. |
| `deal_agreed_reminder_days` | 7 | 1–60 | Nudge both sides of a deal still `agreed` after this long (no auto-cancel). |

`validateSettings()` gains the cross-checks: `offer_validity_hours_1 < _2 < _3`; `offer_expiring_notice_hours <
_1`; `deal_problem_window_days < deal_auto_complete_days`; `review_blind_days ≤ review_window_days`;
`offer_backup_max_days × 24 ≥ offer_validity_hours_3`. `MAX_COUNTER_ROUNDS` (5) and the chat limits stay code constants.

---

## 18. Errors (new codes)

`OWN_LISTING`, `VIEWER_READ_ONLY`, `BUSINESS_BLOCKED`, `BLOCK_SELF`, `ENQUIRY_LIMIT`, `THREAD_NOT_FOUND`,
`PHOTO_INVALID`, `PHOTO_KEY_INVALID`, `TOO_MANY_PHOTOS`, `MESSAGE_EMPTY`, `OFFERS_NOT_FOR_RENTALS`,
`PRICE_MODEL_MISMATCH`, `QUOTE_NOT_ALLOWED`, `NEGOTIATION_OPEN`, `OFFER_NOT_FOUND`, `OFFER_LIMIT_REACHED`,
`PRICE_ABOVE_ASKING`, `QUANTITY_BELOW_MINIMUM`, `QUANTITY_NOT_AVAILABLE`, `QUANTITY_DECIMALS`, `COUNTER_OUT_OF_BOUNDS`,
`COUNTER_UNCHANGED`, `COUNTER_LIMIT`, `COUNTER_NOT_ALLOWED`, `NOT_YOUR_TURN`, `OFFER_NOT_OPEN`, `OFFER_EXPIRED`,
`OFFER_NEEDS_RECONFIRM`, `DEAL_NOT_FOUND`, `DEAL_STALE` (notes only), `DEAL_TRANSITION_NOT_ALLOWED`,
`PROBLEM_WINDOW_CLOSED`, `CANCEL_REQUEST_EXISTS`, `NO_CANCEL_REQUEST`, `LISTING_HAS_OPEN_DEALS`,
`QUANTITY_BELOW_HELD`, `QUANTITY_REQUIRED`, `UNIT_LOCKED`, `OWNER_CONSENT_REQUIRED`, `OWNER_ONLY` (contact number),
`CONTACT_PHONE_INVALID`, `REVIEW_NOT_ELIGIBLE`, `REVIEW_WINDOW_CLOSED`, `REVIEW_EXISTS`, `REVIEW_ANSWERS_INVALID`,
`REVIEW_NOT_FOUND`, `REVIEW_NOT_PUBLISHED` (reply or report before publishing), `REPLY_EXISTS`, `DISPUTE_NOT_OPEN`,
`ADMIN_READ_NOT_ALLOWED`, `IDEMPOTENCY_KEY_REUSED`, `REQUEST_IN_PROGRESS`.

Reused: F2's `LISTING_NOT_FOUND`, `REPORT_EXISTS` (a second open report by the same business on the same thread or
review), `REPORT_LIMIT`; `STORAGE_UNAVAILABLE`; the OTP service's `OTP_WRONG`, `OTP_EXPIRED`,
`OTP_TOO_MANY_ATTEMPTS`, `OTP_UNAVAILABLE` for the contact-number check. App copy for each in en / hi / gu.

## 19. Privacy and security (DPDP Act 2023)

- **Masking:** one function (`visibleText`) for every party-facing text, REST and socket; viewers always masked; reveal
  only with a deal and both ticks; stored text untouched (R6, §6.5–6.6).
- **Consent record:** `contact_share_consents` is append-only (`grant` / `withdraw` rows) with user, number, wording
  version and time. Granting is per thread; removing or replacing the number, or an owner change, writes `withdraw`
  and hides that number everywhere until a new tick. Unmasked message text can't be taken back, which the tick's
  wording says.
- **Idempotency responses:** `idempotency_keys.response` can hold a revealed number or unmasked text for up to 24 h.
  It is never returned to anyone but the same user's retry, never logged, joins the DPDP export / deletion list, and
  the hourly cleanup deletes it after 24 h.
- **Photos:** private bucket only, metadata and GPS stripped on the server, 300 s signed URLs, members and permitted
  admins only.
- **Push and in-app text:** no message text, notes, numbers, emails or review text (§11.4); names and titles masked.
- **Analytics:** ids, kinds, counts, reason codes only (§15.4).
- **Logs:** request bodies are not logged (Fastify default, keep it); never log message text, notes, FCM tokens or
  phone numbers; the push job logs ids and states only.
- **Sentry:** the app's and API's redaction lists gain `text`, `note`, `notesText`, `description`, `replyText`,
  `messageToParties`, `contactPhone`, `phone`, `number`, `fcmToken`, `photoKeys`; message routes' bodies are never
  attached.
- **Admin reads:** only with a report or dispute, reason required, every read audit-logged (§16.3).
- **Retention / deletion (open, with the DPDP work):** threads, messages, consents, deals, reviews and notifications
  join `saved_listings` in export and deletion; a chat retention rule is due before launch. Notifications are deleted
  after 90 days.
- **Authorisation:** every thread, offer, deal and review route checks party membership from the database (never the
  token's business id alone) and answers `404` to outsiders; suspended users are already refused per request (F1).

## 20. Testing (R26: limited, important)

**API (integration, real Postgres + Redis, fixtures deleted in `afterAll`):**
1. Offer state machine: every row of §7.5's table that changes money or turn; bounds (`counterBounds` table test incl.
   after a quote and after several counters); counter limit; `buy_now` takes no counter; rentals refuse offers.
2. Accept race: two accepts for the last units → one deal, one `QUANTITY_NOT_AVAILABLE` + backup; `held_quantity`
   equals the sum of active holds after every test.
3. Holds and listing: partial accept leaves the listing `live` with available reduced; last units → `reserved`; cancel →
   `live` and backups revive (only those that fit), a revived seller row needs reconfirm before the buyer can accept;
   completion decrements quantity and sells out at 0; quantity edit below held refused; seller remove / mark sold with holds refused; admin remove cancels `agreed` deals only; pause / mark unavailable / hide
   from `reserved` store `return_status = 'live'`; a sell-out on a `hidden` listing sets `return_status = 'sold'`; the
   relaxed CHECK stores 0 while seller input of 0 is still refused; an offer for the whole remainder below the minimum
   order is accepted and completion lowers `min_order_qty`; a unit change with holds or open offers →
   `UNIT_LOCKED`; a price-model change closes chains (`listing_changed`); backups don't count toward the limit and
   expire after `offer_backup_max_days`; accept with too little stock commits the backup and answers 409.
4. Money: `totalPaise` half-up with three-decimal quantities; deal totals equal the offer's.
5. Deal state machine: every row of §9.2; problem window and auto-complete with a **fake clock**; disputed deals never
   auto-complete; resume restarts both timers; cancel after handover needs both sides; stale `version` refused on notes only; a dispute closed as cancelled with
   `stockReturned: false` converts the hold.
6. Masking and reveal: Gujarati / Devanagari digit phones and emails masked in REST and socket payloads before reveal;
   unmasked for an owner after deal + both ticks; still masked for a `viewer` in the same thread (REST and socket);
   reveal permanent after cancel; owner-only tick when falling back to the owner's phone; consent rows append-only; replacing the contact number
   writes `withdraw` and hides the old number until a new tick, while the text stays unmasked.
7. Permissions: a third business gets `404` on thread, messages, offer, deal, review state and photo URLs; a `viewer`
   can't send, offer, act on a deal or review; a blocked pair can't message or offer but can finish a deal.
8. Limits: 4th open negotiation for an unverified business refused, counters and quotes don't count; 11th new enquiry of
   the day refused; message rate limit.
9. Jobs: offer expiry by the DB clock; expiring-soon once per expiry; auto-complete; review publish (single review at
   `min(t + 7 d, completed + 14 d)`, both at once on the second submission); every job safe to run twice and
   concurrently (`SKIP LOCKED`).
10. Reviews: only completed deals, one per side, window, facets per side, blind (author-only before publish), scores
    only after 3, hidden leaves scores.
11. Notifications: one row per event and user (dedupe), grouped chat row bumps and resets on read (two concurrent messages leave one row), no message text or
    number in rendered push text (a test feeds a phone number and asserts it's absent), viewing skips the chat push,
    invalid token deletes the device, dev stub records `sent_dev`.
12. Photos: re-encoded output has no EXIF / GPS (a fixture with GPS in; `jpegHeaderStatus()` from `lib/sniff-media.ts` reads `clean` on the output);
    foreign or reused keys refused.
13. Admin: dispute resolve each outcome leaves stock right and writes `audit_log`; thread read refused without a
    report or dispute and audit-logged with one; RBAC on each admin route.
14. Idempotency: a retried accept with the same key returns the same deal; a different body → 422.
15. Suspension: suspending an owner closes the chains on that business's listings and its buyer chains; suspending
    another member changes no offer; deals continue; chains stay closed after reinstatement.
16. Admin read window: allowed for an open report and 30 days after its resolution, refused on day 31; same for a
    dispute.
17. Locks: two first offers from one business at its limit → one passes (business row lock).

**App (Vitest, pure logic):** offer form (totals, % below, bounds, validation), your-turn and enquiry status, system line
params, deal actions per side and deadline copy, review form, push dedupe, notification links, pending actions; i18n
parity and audit; style audit. **Admin (Vitest + Testing Library):** dispute resolve dialog, reason dialog before a
thread read, review hide. No screen-by-screen tests.

**Close-out:** typecheck, lint, all tests once, `mpm_test` left empty, admin build, `expo export --platform android`, a
scripted two-business API walk-through on the dev DB (enquiry → offer → counter ×2 → accept → backup → cancel → revive
→ reconfirm → accept → handover → auto-complete with a shifted clock → reviews → publish), data deleted afterwards; the
owner's device pass on a new dev build with real pushes.

---

## 21. Build order (sketch; the plan details it)

Contracts first, then parallel lanes in worktrees where the work is independent (owner's preference, as F2), each lane
reviewed, then merged and integrated.

| Batch | Contents | Depends on |
|---|---|---|
| **C0 contracts** | Shared types and pure functions (§5.16, §7.4, §6.2, totals); migrations + schema (all tables of §5, listing columns, transition changes); settings keys; error codes; `lib/mask-contact.ts`, `scam-patterns.ts`; idempotency plugin + table; `chat-view.visibleText`; the emit queue + `emitToThreadMembers` signature; `insertSystemLine(tx, …)`; `notify(tx, …)` inserting rows and delivery rows; `holds.ts` + `syncReservation` + `reconcileOffersForListing` signatures; route stubs; `sharp` dependency. | — |
| **L1 API chat** | Threads, enquiry, messages, photos pipeline, reads, archive, inbox + your turn, block, report, share-contact + reveal, badges, `thread:viewing`, rate limits. | C0 |
| **L2 API offers, holds, deals** | Offer state machine, quotes, buy now, limits, reconcile, holds + listing transition changes, deals, notes, cancel / requests, disputes + admin dispute / deal / enquiry APIs, offer and deal jobs. | C0 |
| **L3 API reviews + notifications** | Reviews (submit, publish job, scores, reply, reports, admin hide), notification rendering en / hi / gu, grouped chat rows, push sender with FCM + stub, devices, preferences, list routes, language route, retention. | C0 |
| **L4 admin pages** | Enquiries & offers, Deals, Disputes, Conversations, Reports & flags (Conversations, Reviews), business detail additions, settings section. | C0 (types); integrates after L1–L3 |
| **L5 app chat** | Enquire sheet, Chats tab, thread (messages, photos, cards rendering, system lines, scam warning, menu: share / report / block / archive), share-my-number, guest pending actions, sockets. | C0; L1 for live testing |
| **L6 app offers, deals, reviews, push** | Offer sheets (4 modes), offer card actions, listing page buttons, Deals tab, Deal record, handover, cancel, problem, review, seller reviews, Profile rows, bell + list, push registration and explainer, notification settings, `expo-notifications`. | C0; L2, L3 for live testing |
| **I integration** | Merge, cross-lane review, walk-through, docs and status, owner's device build. | all |

L1, L2, L3 touch different services; their shared seams (system lines, notify, emits, reconcile) are fixed in C0.

## 22. Changes to earlier documents and code

| Where | Change |
|---|---|
| `packages/shared-types` | §5.16; `LISTING_TRANSITIONS` / `HIDEABLE` / `EDITABLE_LISTING_STATUSES` / `SYSTEM_LISTING_ACTIONS` (§8.3); `ENQUIRY_STATUSES` documented as derived; `MAX_COUNTER_ROUNDS` comment; `REPORT_TARGETS` + `review`; `APP_SETTINGS` (§17). |
| `apps/api` listings services | Holds guards, `syncReservation` + reconcile after status writes, admin remove cancels `agreed` deals, relist after sell-out. |
| `apps/api` discovery | `minQty` and facets use available; `ListingCard` keeps `quantity` and gains `availableQuantity`, which cards and results show. |
| Listing writers that must call reconcile + `syncReservation` and queue emits / notifications | `applySystemTransition`, `applySellerAction`, `applyAdminTransition`, `publishListing` from `rejected` (`listing-lifecycle.service.ts`); `runListingExpiry` (`listing-jobs.service.ts`; the job gains the emit + notify context); `adminListingAction`, `bulkListingAction`, `adminPatchListing` quantity / unit / price-model changes (`listing-admin.service.ts`); `patchListing` (`listing-write.service.ts`); `adminDeleteMedia` → `photos_removed` (`listing-media.service.ts`); F1's suspend / block of an owner (`services/admin/user-status.service.ts`). |
| `infra/migrations` | 0009's `listings_quantity_positive` relaxed to `>= 0` by this module's custom migration (§5.17). |
| `apps/api/src/socket/rooms.ts` | `threadRoom` removed (D2). |
| App `lib/listing-page.ts`, `lib/sign-in-gate.ts`, `lib/pending-action.ts`, `screens/listing/listing.tsx`, tabs | §15.2. |
| Admin `lib/nav.ts` | Disputes item (Queues, `support`, badge). |
| `docs/product-scope.md` | M9 / M15 pointers now answered here; M13's "business days" → calendar days; M10's "or either side chooses to share" → both sides tick after a deal (R6). Updated when this is approved. |
| `docs/PROJECT_STATUS.md` | Updated when built. Open decision D6 settled by R6. |
| F4 spec §2 / §8.3 | The bell and "Enquire / Offer" sign-in reasons now exist. |

## 23. Risks

- **Size:** this is the largest module so far; the lane split keeps it reviewable, and C0 must be complete before lanes
  start.
- **Push depends on the owner's Firebase project** and a new dev build; until then the stub keeps the pipeline testable
  but nobody gets pushes.
- **Self-reported steps:** handover and receipt are what the parties say; the app records, never verifies. Auto-complete
  favours the seller after 3 days; the 2-day report window is the buyer's protection.
- **Scam patterns** will have false positives and misses (a warning, not a filter).
- **Masking** misses numbers written as words or in photos (accepted).
- **Socket fan-out** per member on one process; the Socket.IO Redis adapter is still needed before more than one API
  instance (open item from F1).
- **`sharp`** adds a native dependency to the API image (prebuilt for Alpine; checked in the Docker build).
- **Scores on read** are a grouped query per seller block; store aggregates when volume grows.

## 24. Deferred (P2 and later)

Masked calls and call lines (Exotel); rental bookings with dates, deposits, on rent, return and rental reviews (M14);
PDF, voice and video messages; saved replies, "ask for more photos" quick replies for sellers, labels and reminders;
quotation PDF from the thread; seller auto-accept / auto-decline thresholds; offers to people who saved a listing;
enquiry basket (one enquiry to up to 5 sellers); GST invoice and deal export; payments, advances and deposits through the
platform (M20); "Continue on WhatsApp" after a deal; quiet hours, digests, SMS / WhatsApp / email channels; chat search;
post-completion claims; buyer reliability and cancellation-rate badges; reply rate and reply time (M17); team member management and per-role notification routing; Socket.IO Redis adapter; chat retention job; per-category
push switches; seller → buyer review text and showing buyer scores to sellers; a scam-flag count on the admin business
page; chain and deal rules for account deletion (no deletion exists yet).

## 25. Open items (for the owner)

- **Firebase:** create the project, add the Android app (`com.machineparts.app`, placeholder until D1), send the
  service-account JSON (for `FIREBASE_SERVICE_ACCOUNT_B64`) and `google-services.json`; then a new dev-client build.
  iOS push needs an APNs key later.
- **R2 lifecycle:** delete `incoming-chat/` after 1 day (with the existing `incoming-*` rules); the buckets are still
  shared with textile (key prefixes keep them apart).
- **Share link base URL** (`EXPO_PUBLIC_SHARE_BASE_URL`) waits for the domain (D1).
- **Copy:** scam warning, consent wording and system lines in Hindi and Gujarati need a native speaker's check.
- Confirm with the client: buyer reviews visible to sellers only; dispute outcomes not public; auto-complete after 3
  days favouring the seller.

## 26. Decisions marked (our call)

1. New-enquiry limits 10 / 40 per business per day; offer actions 20 / min; deal actions 20 / min; reports 10 / day.
2. Viewers read only (owner left it to us).
3. An enquiry on a listing with a thread appends a card; the button reads "Open chat".
4. Enquiry status is derived with no column (§6.2).
5. A new message un-archives the thread for the receiving business.
6. "Your turn" includes unanswered enquiries (seller) and deals waiting on the reader.
7. A block closes open offers but lets deals in progress finish.
8. The share tick is per thread, offered on the Deal record and the thread banner only; shown only to the owner when
   the number would be the owner's personal phone (changed in review).
9. The business contact number is OTP-verified.
10. `QUICK_ENQUIRIES` gains `price_request`.
11. Quotes don't count against the buyer's open-offer limit.
12. Totals round half up to the paisa from thousandths of a unit.
13. Counter bound edges: equal to the other side's latest is an accept; equal to one's own latest only with a different
    quantity.
14. Offer expiry notifies both sides.
15. `held_quantity` is a maintained column with a CHECK.
16. `handed_over` is a deal status.
17. Admin removal cancels only `agreed` deals; handed-over and disputed deals continue.
18. Relist after a sell-out needs a quantity edit first.
19. The seller may also report a problem after handover, until completion.
20. A cancel request after handover doesn't pause auto-complete; accepting it releases the hold; decline and withdraw
    are one "clear" action (changed in review).
21. Deal notes changes post a line naming fields, not values.
22. Dispute history visible to admins and the two parties, not public.
23. Seller → buyer reviews store stars only; showing a buyer score is P2 (changed in review).
24. Scores computed on read.
25. Notification rows written in the change's transaction (no outbox).
26. Recipients: every active member of the business (viewers included), never the actor's own business.
27. Push preferences: one global switch; no quiet hours this build (changed in review).
28. Production without Firebase keys starts and records `skipped`.
29. Push permission asked at first enquiry / offer / publish / Chats, after an explainer.
30. Pending actions reopen the listing and sheet; nothing is sent automatically.
31. Deal refs start at 500001 ("Deal #500001").
32. Cancel reason lists per side (§5.16).
33. ~~Admin business detail shows a count of scam-flagged messages~~: cut in review (P2).
34. Defaults `offer_backup_max_days` 14 and `deal_agreed_reminder_days` 7.
35. Withdraw reasons `number_removed`, `number_replaced`, `owner_changed`; the withdraw is business-wide.
36. The admin read window after a resolution is 30 days for reports and disputes alike.

## 27. Review changes (2026-11-19)

Independent review of the draft; every point applied.

| # | Change | Sections |
|---|---|---|
| 1 | Sell-out vs `listings_quantity_positive`: the custom migration relaxes it to `>= 0`; seller and admin input still refuse 0. | §5.7, §5.17, §8.3, §22 |
| 2 | Sell-out while `hidden` / `pending_review` / `rejected` sets `return_status = 'sold'`; `syncReservation` turns `live` / `reserved` with quantity 0 into `sold`. | §8.2, §8.3 |
| 3 | `0 < available < min_order_qty`: an offer may take exactly the whole remainder; completion lowers `min_order_qty`. | §7.2, §7.7, §8.1 |
| 4 | Unit change with holds or open offers → `409 UNIT_LOCKED`; a price-model change reconciles and closes chains (`listing_changed`). | §5.6, §7.5, §7.7, §8.3, §15.2 |
| 5 | Suspension: available only if `publicListingWhere` passes; an owner's suspension reconciles the business's listings and closes its buyer chains (`account_inactive`); other members change nothing; deals continue; offers stay closed after reinstatement; no account deletion yet. | §7.5, §7.6, §7.7, §9.2, §24 |
| 6 | Stale `agreed` deals: `deal_agreed_reminder_days` nudge, no auto-cancel. Backups expire after `offer_backup_max_days` and don't count toward the limit. | §5.6, §5.8, §7.5, §7.7, §7.8, §7.9, §9.3, §11.3, §14, §17 |
| 7 | Dispute closed as cancelled asks `stockReturned`; `false` converts the hold. | §5.10, §8.1, §9.2, §9.6, §16 |
| 8 | Thread on a removed / hidden listing: detail reads the listing whatever its status, shows the deal's title snapshot and "No longer listed". | §12.2, §15.1 |
| 9 | Leaving `reserved` always stores `return_status = 'live'`, then `syncReservation`. | §8.2, §8.3 |
| 10 | `ListingCard.quantity` unchanged; new `availableQuantity`. | §5.16, §8.4, §22 |
| 11 | Seller → buyer review text and the buyer score display cut for MVP (stars stored). | R22 note, §5.11, §10.2–§10.4, §11.3, §24, §26 |
| 12 | Share-my-number box on offer / accept sheets cut; tick on the thread banner and Deal record only; hidden for non-owners on the owner-phone fallback. | §6.6, §15.1, §26 |
| 13 | Consent kinds `grant` / `withdraw`; number removal / replacement / owner change writes `withdraw`; reveal and display use only a consent matching the current number. | §5.5, §5.16, §6.6, §19, §20 |
| 14 | Buyer business locked `FOR NO KEY UPDATE` for the offer limit and daily enquiry count; global lock order; deal routes read `listing_id` first. | §7.5, §7.8, §8.5, §9.2, §12.1 |
| 15 | Deal jobs: unlocked candidate read, then listing, then deal `SKIP LOCKED`, re-check. | §9.3, §14 |
| 16 | Admin conversation reads only while a report is open / reviewing or within 30 days of resolution, or an open dispute (+30 days). | §16.3, §20 |
| 17 | Inbox: `buyer_turn` / `seller_turn` and `last_buyer_seq` / `last_seller_seq` on threads; unread by seq comparison. | §5.1, §5.3, §6.10 |
| 18 | Grouped chat row: partial unique index + `ON CONFLICT DO UPDATE`. | §5.13, §5.17, §11.2 |
| 19 | `DEAL_STALE` / `version` only for notes edits. | §5.8, §9.2, §12.2, §18 |
| 20 | Idempotency stored responses added to the DPDP list. | §19 |
| 21 | Pausing a `reserved` listing closes backups for good: said in the pause confirmation. | §8.3, §15.2 |
| 22 | Migrations list (quantity CHECK, deal ref sequence, consent trigger, grouped-notification index, `report_target` value unused in migrations). | §5.15, §5.17 |
| 23 | Indexes `deals (listing_id)` for open deals and `deal_disputes (status, created_at)`. | §5.8, §5.10 |
| 24 | Writers that must reconcile / `syncReservation` / emit listed; jobs get the emit + notify context. | §8.3, §14, §22 |
| 25 | Accept with too little stock commits the move to backup, then answers 409. | §7.6, §20 |
| 26 | Error codes added: `UNIT_LOCKED`, `OFFER_NOT_FOUND`, `REVIEW_NOT_PUBLISHED`, `NO_CANCEL_REQUEST`, `BLOCK_SELF`, `OWNER_ONLY`, `CONTACT_PHONE_INVALID`; reused `REPORT_EXISTS`, `REPORT_LIMIT` and the OTP codes by name. | §18 |
| 27 | Settings `deal_agreed_reminder_days`, `offer_backup_max_days` with cross-checks. | §17 |
| 28 | Scam-flag count on the admin business page cut (P2). | §16.1, §24, §26 |
| 29 | Push preferences: one global switch (`users.push_enabled`). | §5.13, §11.1, §11.6, §12.2, §24, §26 |
| 30 | Cancel request after handover: decline / withdraw collapsed into one "clear" action. | §9.2, §9.5, §12.2, §18, §26 |
