# F2 + F3 + A3 · Listings: sell wizard, listing page, lifecycle, Left / Right / Pair matching, moderation: design

Date: 2026-11-18 · Status: **Draft — awaiting the owner's review** (not approved; the implementation plan is written only after approval) · Scope IDs: **F2** (sell parts and machinery), **F3** (Left /
Right / Pair matching), **A3** (listing management) in `docs/product-scope.txt`; feeds F4/F5 (search, browse), F6
(enquiries and offers), F7 (deals, rentals), F8 (part requests). Spec modules in `docs/product-scope.md`: **M5** sell
wizard, **M6** listing page, **M7** listing lifecycle, **M8** Left / Right / Pair matching, admin **AD3** listing
moderation; touches M4 (fitment), M14 (rental listing fields), M17 (My listings), M19 (reports, sanity checks), AD6
(settings).

**Follows textile:** the rule is to start from textile's matching spec and code (`E:\textile-marketplace`: its M4
listing wizard and M6 lifecycle). **That repository is not on this machine** (checked 2026-11-18: `E:\textile-marketplace`
does not exist), so this design works from this repo: the F1 + A2 spec and code for structure and depth
(`docs/superpowers/specs/2026-11-18-f1-a2-business-profile-verification-design.md`, `lib/storage.ts`,
`services/verification/gst-documents.service.ts`, the `incoming-…/` upload lifecycle, `writeAudit`, admin RBAC), the A4
spec and code for the catalogue it reads (`docs/superpowers/specs/2026-11-18-a4-machine-catalogue-design.md`,
`services/catalog/validate-specs.ts`, `read.service.ts`), and the Periwinkle v2 brief plus its re-skin spec
(`docs/superpowers/specs/2026-11-18-periwinkle-v2-reskin-design.md` §7, the component kit the listing screens use).

**Labels:** **[Owner]** decided by the owner (2026-11-18). **[Scope]** from `docs/product-scope.md`, the client PDF or an
approved spec. **[Claude]** the author's call; every one that the owner might want to change is a numbered ruling
(**Rn**) collected in §18.

---

## 1. Intent

The marketplace has a catalogue (A4) and verified business profiles (F1 + A2) but nothing to buy. This build lets a
business put a **spare part, a machine for sale or a machine for rent** online in a few minutes, with the structure
buyers will filter on later (category, specs from the category's template, fitment, **side**, condition, quantity,
price, location), lets the team **moderate** it, keeps listings **fresh** (expiry and renew), and shows the marketplace's
signature: on a left or right part, **"the other side is available from these sellers"**.

**Success check (without R2 keys):** with `LISTING_MEDIA_OPTIONAL=true` in dev, a new seller lists a left temple part
in a part group that has sides, sees the side step with the convention diagram, previews and publishes; the listing
goes to **pending review** (first listing); a moderator approves it in the admin panel; a second seller lists the right
side of the same part number; on the first listing the **Other side** block shows the second seller with the distance.
The seller pauses, resumes and marks it sold from **My listings**; an admin hides it; the expiry job expires a listing
whose `refreshed_at` is older than the setting. **With R2 keys** (§6) the same run uses real photos and a 60-second
video, played back on the listing page. Until the owner adds the keys, media endpoints answer `503 STORAGE_UNAVAILABLE`
(tested) and the media step shows "Photo upload isn't available yet".

---

## 2. Goals, non-goals, anti-goals

### Goals
- **Sell wizard (M5)** for three kinds: spare part, machine for sale, **machine for rent** (rates per hour / day / week /
  month, terms, availability). **[Owner]** Server-side **autosaved drafts**, a **preview** that is the buyer's view, a
  **listing score** with nudges, **sanity checks** on price, unit and quantity. **[Scope M5]**
- **Photos and videos:** 1–10 photos, **up to 2 videos of ≤ 60 s**, public media storage on R2. **[Owner, Scope]**
- **Listing page (M6)** with gallery and video playback, side / condition / stock, price or rental rates, **Fits** block
  with "Check my machine", **Other side** block, specs, delivery and area, seller card, more from this seller, Report.
- **Lifecycle (M7)** as one server-side state machine: review, live, paused, sold, unavailable, rented, expired,
  hidden, removed; **first 3 listings reviewed** **[Owner]**; **expiry after 60 days without an update**, a 7-day
  "Still available?" reminder and one-tap **Renew**, both **admin-configurable** **[Owner]**.
- **Left / Right / Pair (M8):** side step (only where the category has sides), side on every part listing, the
  **Other side** query and the **"You have the left side, these sellers have the right one"** screen. **[Scope F3]**
- **My listings** with actions: edit, update quantity, pause, resume, mark sold, mark unavailable, mark rented / back
  available, renew, relist, remove, duplicate, find the other side.
- **Admin (AD3):** moderation queue (review, reported), review screen, approve / ask for changes / reject / edit
  category, fit and side / hide / unhide / remove / delete a photo, reports resolution, all-listings table with filters
  and bulk hide / remove, and a **Marketplace settings** page. Every mutation audit-logged. **[Scope, Owner]**
- **Reports** on listings (the M19 "Report listing" sheet) into the moderation queue.
- The **catalogue guards** A4 left for M5 (refuse deleting / moving catalogue rows that listings reference).

### Not in this build

| Left out | Comes with |
|---|---|
| Enquiries, chat, offers, "Request more photos" | **F6**. The contact buttons are shown and say "Coming soon" (R6) |
| Deals, `reserved`, quantity reduced by deals, reviews | **F7** (the `reserved` transitions are defined, unused) |
| Rental **bookings** (request / confirm, calendar, on site, returned) | **M14 bookings**. A rental listing's action is Enquire **[Owner]** |
| Requirements, availability alerts, "N buyers are looking for this part", "Post a requirement" on the Other side block | **F8** |
| Push / in-app notifications ("listing approved", "expiring") | **F9**. Now: status, reason and banners in My listings (R12) |
| Search, browse tree with counts, filters (including the side filter), home feed, similar parts nearby | **F4 / F5** (indexes they need are created now, §13.3) |
| Save, share, follow, price drop, recently viewed | **M12 / M2**, and public web pages for share links |
| Seller dashboard numbers (views, enquiries), reply time, rating, deals done | **M17 / M13 / M15** |
| Verified fitment, mirror part numbers, cross-references, serial ranges, "either side", My machines | **M4 / M8 P2** |
| Bulk upload (CSV + photo zip), AI title / category from a photo, perceptual-hash duplicate photos | **P2** |
| Test report and Chartered Engineer certificate attachments on machines | **P2** |
| "Request a missing model" and "Suggest a category" queues | **AD4** later; "Other" text is stored now (R18) |
| Reports on users, messages, reviews; the AD6 reports page | **AD6** (the `reports` table is generic, §13) |
| Virus scanning of uploads | Before launch, for documents first (R32) |
| Purging media of removed listings | DPDP deletion work (R40) |

### Anti-goals: this fails even if it technically works when
- A stranger (or a guest) can read a draft, paused, hidden, removed or rejected listing, a machine's serial number, a
  godown's address line or a listing's exact point. **[Scope: exact address only after a deal]**
- A listing goes live with specs that fail its category's template, a side on a category without sides, no side on a
  category with sides, or (outside the dev switch) no photo. **[Scope]**
- A moderator approves content the seller changed after the moderator opened it. **[Claude]**
- A seller moves a listing out of `hidden` or `removed`, or any client moves a status the state machine doesn't allow. **[Scope]**
- An uploaded file that isn't an image or a video is served from the public media domain, or a seller attaches a file
  another business uploaded. **[Claude]**
- A suspended or blocked seller's listings stay visible to buyers. **[Claude]**
- The catalogue lets an admin delete or move a node, brand, model or unit that listings use. **[Scope A4]**
- The app shows English text in Hindi or Gujarati mode. **[Scope: i18n parity tests]**

---

## 3. Decisions made with the owner (2026-11-18)

1. **Machines for rent are included now.** The wizard lists spare parts, machines for sale and machines for rent.
   Rental pricing uses the shared-types rental periods; deposit and the M14 terms are fields; availability is a date and
   a note (R25). **Bookings are not in this build**: a rental listing's action is Enquire (which is "Coming soon" until
   F6, R6).
2. **Video upload is included:** up to 2 videos per listing, ≤ 60 s each, uploaded like photos. Cap, poster and playback:
   §6.5 (R9).
3. **A new seller's first 3 listings go to admin review** (`pending_review`); later listings go live directly unless
   flagged. The count is a setting (§12).
4. **Listings expire after 60 days without an update**, with a **7-day "Still available?" reminder** and one-tap
   **Renew**; all admin-configurable, audit-logged, in a small `app_settings` table with an admin page (§12), which also
   holds the first-N review count and the unverified-seller cap.

Standing rules: work on `develop`; spec and plan before code; textile first (not on this machine, see "Follows").

---

## 4. The listing

### 4.1 Kinds
`LISTING_KINDS` stays as built in `packages/shared-types`: **`part`**, **`machine`** (for sale), **`machine_rental`**
(R1). Kind is chosen first and **never changes** (`400 KIND_IMMUTABLE`).

| Kind | Category level (A4) | Template kind (`validateSpecs`) | Side | Fitment | Price |
|---|---|---|---|---|---|
| `part` | part group | `part` | when the node's effective `has_sides` | 0–20 rows | price model + price per unit |
| `machine` | machine type | `machine` | — | — | price model + price per unit |
| `machine_rental` | machine type | `machine` | — | — | rates per period (§4.5) |

### 4.2 Fields every listing has

| Field | Rule |
|---|---|
| Category | Part group (parts) or machine type (machines, rentals), **active** with active ancestors (`400 CATEGORY_INVALID`). Changing it drops spec keys not in the new node's template (any status) and, for parts, resets `side` when the new node has no sides **[Claude]** |
| Title | 3–100 chars, trimmed. Parts: the **part name**, prefilled with the part group's name. Machines: prefilled "`<machine type>`, `<brand> <model>`" (R28) |
| Description | Optional, ≤ 1500 chars |
| Specs | JSONB, validated by `validateSpecs(nodeId, kind, specs, previousSpecs, { allowInactive })` (A4 §5). On a **draft** PATCH every error except `required` is refused (`400 SPECS_INVALID`, details = the validator's errors); `required` is checked at publish |
| Quantity | Decimal string `^\d{1,7}(\.\d{1,3})?$`, > 0, ≤ 1 000 000, no more decimals than the unit allows (`400 UNIT_DECIMALS`). Machines and rentals: whole number 1–1000 |
| Unit | Active unit from master data (A4). Price is **per this unit** |
| Condition | Active condition from master data; **not asked for rentals** (R25). Condition note optional, ≤ 300 |
| Location | §4.6 |
| Delivery | One or more of `DELIVERY_OPTIONS = ['pickup', 'ship', 'local_delivery']` (Buyer picks up · I can ship · Local delivery) |
| Media | 1–10 photos, 0–2 videos (§6) |

### 4.3 Part fields

| Field | Rule |
|---|---|
| Part number | Optional ("strongly encouraged"), ≤ 40 chars of `[A-Za-z0-9 ./-]`. Stored raw and **normalised** (`normalizePartNumber`: upper-case, every non `[A-Z0-9]` removed). A normalised number shorter than 3 is stored but never matched (§9) |
| Part brand | Optional; an active brand with `makes_parts` (A4 §6) (`400 BRAND_INVALID`) |
| Side | `PART_SIDES`: `left`, `right`, `pair`, `not_applicable` ("No side"). **Required** when the node's effective `has_sides` is true (`400 SIDE_REQUIRED` at publish); **forced to `not_applicable`** when it's false (a sent side other than that → `400 SIDE_NOT_ALLOWED`) |
| Min order | Optional, > 0, ≤ quantity, same decimals rule |
| Fitment | 0–20 rows (`400 FITMENT_INVALID` with the row index): machine **brand** (active, `makes_machines`) required; **model** optional — an active model of that brand, or "Other" text ≤ 60, or neither = "all models of this brand" (R37); **year from / to** optional, 1950 … next year, from ≤ to; **note** optional ≤ 80 ("with hydraulic tensioner"). `source` is `seller` (or `admin` after an admin edit). Rows of an inactive brand or model stay on existing listings and show their names |

### 4.4 Machine fields (`machine` and `machine_rental`)

| Field | Rule |
|---|---|
| Make (brand) | An active brand with `makes_machines`, **or** "Other" text 2–60 (`400 BRAND_INVALID`); one of them required at publish (R18) |
| Model | Optional: an active model of that brand **and of the listing's machine type**, or "Other" text 1–60 |
| Year of manufacture | Optional, 1950 … this year |
| Hours run / hour meter | Optional, integer 0 … 1 000 000 |
| Serial number | Optional, ≤ 60. **Private**: owner and admins only, never in a public payload **[Scope M5]** |
| Can be seen running (`under_power`) | Boolean, default false |
| Inspection by appointment | Boolean, default false |
| Reason for sale | Optional, ≤ 200 (`machine` only) |

### 4.5 Rental fields (`machine_rental`, M14 "Rental listing fields")

| Field | Rule |
|---|---|
| Rates | `rate_hour_paise`, `rate_day_paise`, `rate_week_paise`, `rate_month_paise`: each optional, integer 1 … 10¹⁰ paise (₹10 crore); **at least one** at publish (`400 RATE_REQUIRED`). Periods are `RENTAL_PERIODS` (R25) |
| Shift hours | 1–24, default 8 ("a day = an 8-hour shift") |
| Minimum | Optional `min_duration` 1–365 with a `min_duration_period` from `RENTAL_PERIODS` ("4 hours", "1 day") |
| Operator | `included` · `optional` · `not_available` · `mandatory`; operator rate per day optional (paise) when `optional` or `mandatory` |
| Fuel | `client` (default, "client supplies diesel") · `included` · `per_litre` |
| Transport | `owner_delivers` · `renter_picks_up` · `either`; transport charge optional (paise, "each way") |
| Works within | Optional service radius 1–2000 km of the listing's location |
| Security deposit | Optional, paise 1 … 10¹¹ |
| Available from | Optional date (today or later when set; null = available now) and an availability note ≤ 200 |

### 4.6 Price (`part`, `machine`)

| Field | Rule |
|---|---|
| Price model | `PRICE_MODELS`: `fixed` · `negotiable` · `on_request` (required at publish) |
| Price | Integer paise 100 … 10¹¹ (₹1 … ₹100 crore) per unit; **required unless `on_request`** (`400 PRICE_REQUIRED`); cleared when the model becomes `on_request` |
| GST | `GST_PRICE_MODES`: `included` · `extra` (required unless `on_request`) |

Money is integer paise everywhere (CLAUDE.md); the app converts typed rupees with a tested parser (§15.4).

### 4.7 Location
- **Source** `business` (default) or `godown` ("Another godown"). **[Scope M5]**
- `business`: the listing copies the business's pincode, city, state, industrial area (id or Other) and point. **When
  the business location changes, every listing with source `business` is updated in the same transaction**
  (`setMyLocation`) (R19).
- `godown`: pincode (6 digits) → city and state from the pincode directory (editable, as F1 §4.2), optional industrial
  area (an area matching the pincode's district and state, `400 AREA_MISMATCH`, or Other ≤ 80), optional address line
  ≤ 200 (**private**), optional pin (lat / lng).
- **Point** (`geography(Point,4326)`): source `business` → the business's pin; source `godown` → the godown pin; in
  either case, with no pin, the **centroid of the listing's pincode's post offices**
  (`ST_Centroid(ST_Collect(point::geometry))::geography` from `pincode_offices`), else null (distance unknown, sorted
  last). Distances only in PostGIS. **[Scope; Claude R19]**
- **Public payload:** industrial area name, city, state and, when the viewer's point is known, the distance in km
  (rounded to whole km). Never the address line, the pincode or the point. **[Scope M6]**

### 4.8 Reference, freshness and housekeeping fields
- `ref`: a number from a sequence starting at 100001, shown as **#100001** (phone and WhatsApp follow-ups; M3) (R35).
- `refreshed_at`: set on publish, approve, renew, resume, relist, end of rental and **every seller edit** of a
  non-draft listing; drives expiry (§7.4) and "Updated 3 days ago".
- `version`: integer, +1 on every content change (seller or admin edit, media change); admin decisions send it (§11.3).
- `flags`, `review_reasons`, `moderation_outcome`, `moderation_note`, `status_reason`, timestamps: §13.

---

## 5. Sell wizard (M5)

### 5.1 Who can sell
- A signed-in user (`requireUser`; suspended / blocked refused as everywhere) whose business has **finished onboarding**
  (`onboardingStep = 'done'`: profile and location). Else `409 ONBOARDING_INCOMPLETE` on create and publish. **The
  business's activities are not checked**: a buyer who decides to sell isn't blocked (R5).
- **GST verification is not required to publish** (R3): the scope's role table lets an unverified business "list up to
  3 items (each reviewed)". An unverified business (no `gst` in `verification_levels`) may hold at most
  **`unverified_listing_cap`** (default 3) **open** listings — every status except `draft`, `sold` and `removed`
  (R36); publishing beyond it → `409 UNVERIFIED_LISTING_CAP` (details `{ cap }`), and the app shows "Verify your GST
  to list more" with a button to the GST flow. Existing listings stay when GST is later revoked.
- Drafts: at most **20** per business (`409 DRAFT_LIMIT`).

### 5.2 Steps per kind
Step lists come from one pure function, `wizardSteps(kind, hasSides)` (app, tested). The bar is the kit's **Steps**
(`Step 3 of 8`). The Post tab picks the kind ("What are you listing?", the mockup's first screen).

| # | Part | Machine for sale | Machine for rent |
|---|---|---|---|
| 1 | **Category** (part group) | **Category** (machine type) | **Category** (machine type) |
| 2 | **Part details**: part name, part number, template fields | **Machine**: make, model, year, title, template fields, hours, serial, running, inspection, reason | **Machine**: as for sale, without reason for sale |
| 3 | **Quantity and condition** (+ condition note) | **Quantity and condition** | **Rates and terms** (§4.5) |
| 4 | **Brand and fit** (part brand, fitment rows) | **Photos and video** | **Photos and video** |
| 5 | **Which side?** (only when `effectiveHasSides`) | **Price** | **Where is the machine?** (+ works within, delivery) |
| 6 | **Photos and video** | **Where is the stock?** (+ delivery) | — |
| 7 | **Price** (model, price per unit, min order, GST) | — | — |
| 8 | **Where is the stock?** (location, delivery) | — | — |
| → | **Preview** → Publish | Preview → Publish | Preview → Publish |

- **Category step:** a search box over the cached `GET /categories` tree (part groups for parts, machine types for
  machines) showing the breadcrumb, plus a drill-down list (machine category → machine type → part group) as the
  mockup's tree rows. **Recent categories first**: the last 5 the seller picked, kept on the device (AsyncStorage) (R28).
- **Side step:** title "Is this a left, right or pair?"; four **SideToken** `xl` options (Left only, Right only, Pair
  (both sides), No side); the **convention**: the node's `effectiveSideConvention` text, and the mockup's diagram
  (`sideDiagram()`: operator figure, machine, L / R markers) **only when that text is the default convention**
  (`DEFAULT_SIDE_CONVENTION`), because a custom text may describe a different viewpoint (R38b); the Notice "Buyers
  who have the right side will see your left one as a match". Skipped entirely when the node has no sides.
- **Fit step:** fitment rows as removable chips ("JCB … 2012–2020 ×"); "+ Add machine" opens a sheet: brand (machine
  brands, filtered to those with models of the listing's machine type first), model (models of that brand and the
  listing's machine type, plus "Other model…" and "All models"), years from / to, note.
- **Template fields** render by type (A4 §5): `single_select` → Chips (radio), `multi_select` → Chips (checkbox),
  `number` → Input with the unit as suffix and min / max hints, `text` → Input, `date` → date input; `required` marked;
  `help_text` as the Field hint.
- **Location step:** two choice cards, "My business address" (shows the industrial area and city) and "Another godown"
  (pincode → city / state, industrial area list for the pincode as F1, address line, "Use my current location" pin);
  delivery chips (multi). Rentals add "Works within N km".

### 5.3 Drafts and autosave (server-side)
- **Create:** the Post tab's choice calls `POST /listings { kind }` → a `draft` row owned by the business, and the
  wizard opens step 1 with its id.
- **Autosave:** each step's **Next** sends that step's fields in `PATCH /listings/:id`. A draft PATCH validates types,
  limits and references (§4) but not completeness. The app also saves on leaving a step with Back.
- **Resume:** My listings shows "Drafts (n)" (§10); opening a draft goes to `firstIncompleteStep(listing)` (pure, app).
- **Delete:** `DELETE /listings/:id` only for drafts: the row, its children and its media rows are deleted in one
  transaction, then its media objects (R27).
- **Duplicate** (`POST /listings/:id/duplicate`, any status except `removed`): a new draft with every field copied
  except media, status, flags, moderation fields, reports and history (R26). Counts against the draft cap.

### 5.4 Preview, listing score, sanity checks
- **Preview** renders the same `ListingView` as the listing page from the owner view of the draft, with the note "This
  is how buyers will see it" (mockup "Preview") and the checklist below.
- **Listing score** (`listingScore(listing)` in shared-types, 0–100, with the missing items as nudges; shown on the
  preview and on My listings cards as "Add a video"):

  | Item | Part | Machine / rental |
  |---|---|---|
  | 3 or more photos | 20 | 20 |
  | A video | 15 | 20 |
  | Part number | 15 | — |
  | At least one fitment row | 20 | — |
  | Year of manufacture | — | 15 |
  | Hours run | — | 10 |
  | Every optional template field filled | 15 | 15 |
  | Description of 40+ characters | 15 | 20 |

- **Sanity checks** (`sanityFlags(listing)` in shared-types; the app warns on the preview with "Is ₹4 per piece right?"
  and the seller confirms; publishing a flagged listing sends it to review, §5.5):

  | Flag | When |
  |---|---|
  | `price_check` | Part price per unit < ₹5 or > ₹50 lakh; machine price < ₹10 000 or > ₹50 crore; rental day rate < ₹200 or > ₹5 lakh (or the hour rate × shift hours outside the same range when only hourly) |
  | `unit_check` | A part listed in the unit with key `machines`; a machine or rental in a unit that allows decimals |
  | `quantity_check` | Quantity > 100 000 (parts) or > 50 (machines, rentals) |

  Thresholds are constants in shared-types (`SANITY_LIMITS`), so app and API agree; making them settings is later (R17).

### 5.5 Publish and the review rule
`POST /listings/:id/publish`, in one transaction **[Claude]**:
1. Lock the **business** row (`FOR NO KEY UPDATE`, as F1) and the listing (`FOR UPDATE`); the listing must be the
   caller's (`404 LISTING_NOT_FOUND` otherwise) and `draft` or `rejected` (`409 LISTING_TRANSITION_NOT_ALLOWED`).
2. Onboarding done (`409 ONBOARDING_INCOMPLETE`).
3. **Completeness** (`checkPublishable`): every rule of §4 for the kind, specs with `required`, ≥ 1 photo (unless the
   dev switch, R31), side rules, price or rate. All problems at once: `400 LISTING_INCOMPLETE` with
   `details.problems: [{ field, code }]` (spec errors as `{ field: 'specs.<key>', code }`).
4. **Unverified cap** (§5.1), only when publishing from `draft`.
5. `flags = sanityFlags(listing)`.
6. **Review rule (R4):** the listing goes to `pending_review` when **any** of:
   - it is a resubmission (`rejected` → always reviewed) — reason `resubmitted`;
   - the business has fewer than **`listing_review_first_n`** (default 3) listings that **ever went live**
     (`first_live_at IS NOT NULL`, any status) — reason `first_listings`;
   - `flags` is not empty — reasons = the flags.
   Otherwise it goes **`live`** at once.
7. Write `status`, `review_reasons`, `flags`, `published_at` (first time), `refreshed_at = now()`, `status_changed_at`,
   `first_live_at` (when live and still null), `title_norm`, `part_number_norm`; one `listing_status_history` row
   (actor `seller`).
8. Return the owner view and `outcome: 'live' | 'pending_review'`.

The business lock makes two concurrent publishes count each other (first-N and the cap). The **Published** screen says
"Your listing is live" or "Listing sent for review" ("Our team checks your first listings; you'll see the result in
My listings"), plus "Find the other side" for a left / right part and "List another".

---

## 6. Media

### 6.1 Storage design (public media) (R7)
- **Two R2 buckets.** The existing **private** bucket (`AWS_S3_PRIVATE_BUCKET`) receives every upload under
  `incoming-listing/<businessId>/<listingId>/<uuid>.<ext>`; a new **public** bucket (`AWS_S3_PUBLIC_BUCKET`) holds the
  checked files under `listings/<listingId>/<mediaId>/<role>.<ext>` (`role` = `full`, `thumb`, `video`, `poster`).
- **Public reads** go through `MEDIA_PUBLIC_BASE_URL` (a custom domain connected to the public bucket in R2, e.g.
  `https://media.<domain>`, cached by Cloudflare; for dev the bucket's `r2.dev` URL, which R2 rate-limits and which must
  not be used in production). URLs are built at read time from stored keys; **the database stores keys only**.
- **Why not upload straight into the public bucket:** an object there is readable the moment it lands, before the
  server has sniffed it. Uploading to the private `incoming-listing/` prefix and copying only checked files keeps
  unchecked bytes off the public domain. R2's CopyObject works across buckets of one account, so no bytes pass through
  the API.
- Copies are written with the **sniffed** `Content-Type` and `Cache-Control: public, max-age=31536000, immutable`
  (keys are never reused). **[Claude]**
- **Draft media are public by unguessable URL** (UUID keys, never listed anywhere): the preview needs real URLs, and
  promoting files at publish would double the copy work. Drafts are never served by listing endpoints to others. (R7)
- Configured = the five private variables **plus** `AWS_S3_PUBLIC_BUCKET` and `MEDIA_PUBLIC_BASE_URL`
  (`isMediaStorageConfigured()`, read on every call). Unconfigured → media endpoints `503 STORAGE_UNAVAILABLE`
  ("Photo upload isn't available yet"); everything else works, and tests pass without keys.

### 6.2 Upload flow (as F1 §6, adapted)
1. `POST /listings/:id/media/presign` with `{ type: 'photo' | 'video', files: [{ role, contentType, size }] }` — a
   photo sends `full` + `thumb`, a video sends `video` + `poster`. Checks: storage configured; the listing is the
   caller's and editable (§7.3); type and size limits (§6.3); **the media count**: photos already attached < 10, videos
   < 2 (`409 MEDIA_LIMIT`). Returns `{ uploadId, files: [{ role, key, url, expiresAt }] }`, PUTs signed for 300 s with
   `Content-Type` and `Content-Length` (the existing `presignSignedPut`).
2. The app PUTs each file.
3. `POST /listings/:id/media` with `{ type, uploadId, keys: { full, thumb } | { video, poster }, durationMs? }`. Before
   any transaction: every key must match `incoming-listing/<businessId>/<listingId>/<uploadId>/<uuid>.<ext>` for **this**
   business and listing (`400 MEDIA_KEY_INVALID`, checked before storage is touched); **head** each object (missing →
   `400 MEDIA_MISSING`; over its role's cap → `413 MEDIA_TOO_LARGE`); **sniff** the first 16 bytes (§6.3,
   `400 MEDIA_TYPE`); copy each to the public bucket. Then one transaction: lock the listing, re-check editability and
   the count (`409 MEDIA_LIMIT`; the lock serialises two concurrent attaches), insert the `listing_media` row (next
   `sort_order`), bump `version`, and `refreshed_at` for a non-draft listing. After commit: delete the incoming objects.
   If the transaction fails: delete the public copies; the incoming objects are left for the lifecycle rule. A failed
   delete is logged, never thrown (F1's `deleteKeys`).
4. **Reorder:** `PUT /listings/:id/media/order { ids }` — the full list of the listing's media ids; the first photo is
   the **cover** (`400 MEDIA_ORDER_INVALID` if the set differs). The app offers "Make cover" and delete on each tile;
   drag-reorder is later (R8).
5. **Delete:** `DELETE /listings/:id/media/:mediaId` — refused when it is the last photo of a non-draft listing
   (`409 MEDIA_LAST_PHOTO`, unless the dev switch); the row is deleted, then the public objects after commit.
6. **Leftovers:** an R2 lifecycle rule on the private bucket deletes `incoming-listing/` objects after **1 day** (§6.6).

### 6.3 Limits and checks

| Role | Types (sniffed) | Max bytes | Notes |
|---|---|---|---|
| `full` (photo) | JPEG, PNG, WebP | **10 MB** (10 485 760) | The app sends ~1600 px JPEG (~0.3–0.8 MB); the cap allows an unresized fallback |
| `thumb` (photo) | JPEG, PNG, WebP | **1 MB** (1 048 576) | 480 px long edge |
| `video` | MP4 / QuickTime (`ftyp` box at byte 4) | **50 MB** (52 428 800) | ≤ 60 s (§6.5) |
| `poster` | JPEG, PNG, WebP | **1 MB** | Frame at 1 s, ~720 px |

- Sniffing: `sniffImage` = F1's `sniffDocument` without PDF; `sniffVideo`: bytes 4–8 are `ftyp`; major brand `qt  ` →
  `mov` / `video/quicktime`, any other brand → `mp4` / `video/mp4`. The stored key's extension and the served type follow
  the sniff, never the client's claim.
- **Duration:** the app checks it (picker `duration`) and sends `durationMs`; the server refuses `durationMs` > 60 500
  (`400 VIDEO_TOO_LONG`) and stores it for display. The server doesn't parse the MP4 (the `moov` box can sit at the end
  of the file); the 50 MB cap is the hard limit (R9).
- Per listing: **photos 1–10** (≥ 1 at publish), **videos 0–2** (`LISTING_PHOTOS_MAX`, `LISTING_VIDEOS_MAX` in shared-types).

### 6.4 Photos on the device (R8)
No server image processing (no `sharp`): the app resizes with `expo-image-manipulator` to a **1600 px** long edge, JPEG
quality 0.8 (`full`) and a **480 px** long edge, quality 0.7 (`thumb`) before upload. Cards and the admin queue load
`thumb`; the gallery loads `full`. Camera or library (`expo-image-picker`, multiple selection up to the remaining
count). EXIF location isn't kept: the manipulator writes a new JPEG without metadata. **[Claude]**

### 6.5 Video: cap, poster, playback (R9)
- **Compression on the device:** `react-native-compressor` (`Video.compress`, `compressionMethod: 'auto'`) turns the
  picked video into **H.264 MP4, ~720p**, which every Android and iOS player decodes (an iPhone records HEVC MOV, a phone
  camera records 1080p at 15–20 Mbit/s ≈ 110–150 MB a minute). At 720p a 60 s clip is typically 15–30 MB.
- **Cap 50 MB**: 60 s at up to ~6.5 Mbit/s, enough headroom for the compressor's output; it keeps a buyer's playback on
  mobile data reasonable. R2 has no egress fee, so the cap is about the buyer, not cost.
- **Duration ≤ 60 s:** the camera is opened with `videoMaxDuration: 60`; a library video longer than 60.5 s is refused
  in the app ("Videos can be up to 60 seconds"); no trimming UI in this build.
- **Poster:** the app takes a frame at 1 s with `expo-video-thumbnails` and uploads it as the `poster` role with the
  video. Cards never show a video; the gallery tile shows the poster with a play badge.
- **Playback:** `expo-video` (`useVideoPlayer(url)` + `VideoView` with native controls) streams the public MP4 by
  progressive download over HTTP range requests (R2 and the CDN serve ranges). The poster shows until the player is
  ready. No server transcoding, no HLS. Admin plays it in an HTML `<video controls poster>`.
- **Uploads** stream from disk with `expo-file-system` (`createUploadTask`, binary PUT, progress shown on the tile)
  rather than reading the file into memory as the GST picker does.
- **Fallback** if `react-native-compressor` won't build on SDK 54 / New Architecture: no compression, the same 50 MB
  cap, and the app says "This video is too large. Record a shorter clip or at a lower quality." (the orchestrator
  decides; no other library is substituted without the owner).
- New native modules (`expo-image-manipulator`, `expo-video`, `expo-video-thumbnails`, `react-native-compressor`) need
  a **new dev build** (`pnpm android`).

### 6.6 What the owner sets (env and R2)
New variables (`.env.example` documents them, marked for the owner):

| Variable | Value |
|---|---|
| `AWS_S3_PUBLIC_BUCKET` | Name of the new public media bucket, e.g. `mpm-media` |
| `MEDIA_PUBLIC_BASE_URL` | `https://media.<domain>` (custom domain on that bucket); dev may use `https://pub-<id>.r2.dev` |
| `LISTING_MEDIA_OPTIONAL` | Dev only: `true` lets a listing publish without photos while R2 isn't set up; **ignored when `NODE_ENV=production`** (R31) |

Plus the existing five private-bucket variables. R2 settings: (1) create the public bucket and connect the custom
domain (or enable `r2.dev` for dev only); (2) a **lifecycle rule on the private bucket**: delete objects with prefix
`incoming-listing/` after 1 day (next to F1's `incoming-verification/` rule); (3) the API token needs **Object Read &
Write on both buckets** (a cross-bucket copy reads one and writes the other); (4) **no CORS** is needed: uploads come
from the native app (no browser origin) and public reads are plain GETs from `<img>` / `<video>`.

---

## 7. Lifecycle (M7)

### 7.1 Statuses
`LISTING_STATUSES` gains **`hidden`** (taken down by a moderator, reversible) and **`expired`** (not refreshed in time)
(R2): `draft · pending_review · rejected · live · paused · reserved · sold · rented · unavailable · expired · hidden ·
removed`.

**Public statuses** (served to anyone, listed later by search): `live`, `reserved`, `rented` ("On rent"). Every other
status is visible only to the owner and admins; anyone else gets `404 LISTING_NOT_FOUND` (R20). A listing whose
business has a **suspended or blocked user** is treated as not public, whatever its status (status unchanged, so
reinstating brings it back). One SQL helper (`publicListingWhere`) is the only definition of "public". **[Claude]**

### 7.2 Transitions (the only ways a status changes)
The table is data in shared-types (`LISTING_TRANSITIONS`, with `listingTransition(from, action, kind)` and
`sellerActions(status, kind)` for the app's buttons); **one service, `listing-lifecycle.service.ts`, is the only writer
of `status`**, and every write is `UPDATE … WHERE id = $1 AND status = $from` under a row lock, with one
`listing_status_history` row. **[Scope; Claude]**

| Action | Actor | From | To | Also |
|---|---|---|---|---|
| `publish` | seller | `draft` | `pending_review` or `live` | §5.5 |
| `publish` (resubmit) | seller | `rejected` | `pending_review` | reason `resubmitted` |
| `approve` | moderator | `pending_review` | `live` | version must match; clears flags and review reasons; `first_live_at`, `refreshed_at` |
| `ask_for_changes` | moderator | `pending_review` | `rejected` | message required; outcome `changes_requested` |
| `reject` | moderator | `pending_review` | `rejected` | reason required; outcome `rejected` (R13) |
| `pause` | seller | `live` | `paused` | |
| `resume` | seller | `paused` | `live` | refresh |
| `renew` | seller | `live`, `expired` | `live` | refresh ("Still available? Renew") |
| `mark_sold` | seller | `live`, `paused`, `expired`, `unavailable` | `sold` | |
| `mark_unavailable` | seller | `live`, `paused`, `expired` | `unavailable` | optional note |
| `relist` | seller | `sold`, `unavailable` | `live` | refresh; no review |
| `mark_rented` | seller | `live` (`machine_rental` only) | `rented` | |
| `end_rental` | seller | `rented` | `live` | refresh ("Available again") |
| `remove` | seller | every status but `draft`, `removed` | `removed` | optional reason; terminal |
| (delete) | seller | `draft` | row deleted | §5.3 |
| `expire` | system | `live` | `expired` | job, §7.4 |
| `back_to_review` | system | `live`, `paused` | `pending_review` | §7.3 edit rules |
| `hide` | moderator | `live`, `paused`, `expired`, `unavailable`, `sold`, `rented` | `hidden` | reason required |
| `unhide` | moderator | `hidden` | the status before `hide` (from history) | (R14) |
| `remove` (admin) | moderator | every status but `draft`, `removed` | `removed` | reason required |
| `reserve` / `unreserve` | system (F7) | `live` ↔ `reserved` | | defined, unused until F7 |

Anything else → `409 LISTING_TRANSITION_NOT_ALLOWED` (`details: { from, action }`), nothing written. A seller can't
touch `hidden` except to remove it.

### 7.3 Edits
- **Editable statuses:** `draft`, `pending_review`, `rejected`, `live`, `paused`, `expired`, `unavailable`, `sold`,
  `rented`. Not `hidden`, `removed`, `reserved` (`409 LISTING_NOT_EDITABLE`). Kind never changes.
- A **non-draft** PATCH validates the **merged** listing as publishable (§5.5 step 3): a published listing never becomes
  incomplete (`400 LISTING_INCOMPLETE`). Quantity can't be set to 0 (Mark sold instead, R41).
- Every content change bumps `version`; a seller edit of a non-draft listing sets `refreshed_at`.
- **Back to review (R16)**, for a `live` or `paused` listing: an edit that changes **category, side or fitment while the
  listing has an open report** (reason `edited_after_report`), or an edit that adds a **sanity flag** it didn't have
  (reason `edit_flagged`), moves it to `pending_review` in the same transaction (`back_to_review`). The owner view
  carries `reviewOnEdit: true` while a report is open, and the app warns "Changes to category, side or fit will be
  checked by our team" without mentioning the report. Price, quantity, photos and other edits go live at once **[Scope M7]**.
- Edits to a `pending_review` listing keep it there (version bumps, so a moderator's stale approval fails, §11.3).

### 7.4 Freshness: expiry and the reminder (R11)
- **Expires** when `status = 'live'` and `refreshed_at < now() − listing_expiry_days` (setting, default 60). Only `live`
  listings expire; paused ones wait (resume refreshes them).
- **Reminder** when `status = 'live'`, `refreshed_at < now() − (listing_expiry_days − listing_expiry_reminder_days)`
  (default 7) and `expiry_reminded_at` is null or older than `refreshed_at`: the job stamps `expiry_reminded_at = now()`.
  With no notifications yet (F9), the stamp is the hook F9's push will use; the app's **"Still available?"** banner and
  the **Expiring soon** chip come from the owner view's `expiresAt` and `expiringSoon`, computed by the server from the
  same settings.
- The settings are read on every run and every read, so **changing them applies at once to every live listing**.
- **Jobs** (`src/jobs/index.ts`, `JobSpec`): `listing-expiry` and `listing-expiry-reminder`, **every hour**, first run
  after 1 minute; each selects up to **200** rows `ORDER BY refreshed_at … FOR UPDATE SKIP LOCKED`, writes them in that
  transaction (status + history for expiry, the stamp for reminders), and repeats up to **10** batches per run. The
  expiry update keeps `AND status = 'live'`, so a renew that commits first wins. The job functions are exported and
  called directly by tests (jobs don't start in `buildApp`).

### 7.5 History and "notify the seller"
- Every status change writes `listing_status_history` (from, to, action, actor `seller` | `admin` | `system`, user or
  admin id, reason). Admin actions also write `audit_log` (§11.6).
- **Notifications are F9 (R12).** Now: the owner view returns the status, `moderation` (`outcome`, `note`, `at`),
  `statusReason` (hide / remove reason) and `expiresAt`; My listings shows them (review group with the moderator's
  message; a "Hidden by our team" notice with the reason). No socket events in this build; My listings refetches on focus.

---

## 8. Listing page (M6)

### 8.1 Blocks (in the order of the scope, mockups "Part listing", "Machine listing", "Rental listing")
1. **Gallery:** full-width pager of photos and videos (cover first), "1 / 9" counter, video badge; tap opens the
   full-screen viewer (photos, and videos playing with `expo-video`). Save and share icons are **not shown** (R6).
2. **Tags row:** SideToken + side label (parts with a side), condition chip, quantity "14 pcs"; rentals "For rent",
   operator, year.
3. **Title and price:** price per unit with model and GST note ("₹420 /pc · negotiable · GST extra"), or "Price on
   request"; rentals: rate cards per period (mockup `.rates`) and the terms (§4.5) as a specs list.
4. **Fits** (parts with fitment): machine chips ("Mahindra … 2012–2020"), and **Check my machine** (§8.3).
5. **Other side** (parts with `left` / `right`): the mockup's three options row — this listing's side, the
   complementary side ("8 pcs, 18 km" from the best match, or "Not listed"), and Pair ("3 pairs, 41 km" or "Not
   listed"); a line "Right side also available, 8 pcs from <business>, <city>" and **See all** → Other side screen (§9).
   With no match: "No right side listed yet". The "Post a requirement" link waits for F8 (R22).
6. **Specifications:** template fields in template order with labels and units (retired fields still labelled), then
   part number (JetBrains Mono), part brand, reference `#100234`; machines add year, hours, running, inspection.
7. **Delivery and location:** delivery chips, industrial area, city, distance ("2 km away" when known).
8. **Seller card:** business display name (F1 `displayName`), industrial area and city, **GST verified** StatusChip,
   "On MPM since Nov 2026", live listings count, **View all listings** → seller listings screen. No rating, deals done or
   reply time until M13 / M15 / M10 — they're **left out, not shown as zeros** (R24).
9. **More from this seller:** up to 6 of the seller's other public listings (cards). "Similar parts nearby" waits for
   F4 (R23).
10. **Report listing** (link; signed-in users, not on one's own listing) → the sheet (§8.4).

"Updated 3 days ago" sits under the title. The machine listing shows the tip "Never pay before inspecting a used
machine" (M19) as a Notice.

### 8.2 Actions (FooterBar)
- **Buyer:** `fixed` → **Enquire**; `negotiable` → **Enquire** + **Make offer**; `on_request` → **Ask price**; rental →
  **Enquire**. **They are shown and enabled; a tap shows the "Coming soon" toast** and tracks
  `listing_contact_tapped { action, kind }` (R6). Hidden buttons would leave a dead-end page and disabled ones look
  broken; the event measures demand for F6, which replaces the handlers.
- **Owner** (own listing): **Manage** (the manage sheet, §10) and **Edit**.

### 8.3 "Check my machine" (MVP, R21)
My machines (M4) isn't built, so: a sheet with machine brand → model (of any machine type) → year (optional); the
answer from the listing's fitment rows through `checkFit(fitments, { brandId, modelId, year })` (shared-types):
**"Seller says it fits"** (a row with that brand and either the same model or "all models", and the year inside its
range when both are given) or **"Not listed by the seller"**. Every row is seller-declared now, so the green "Fits your
machine" badge (verified or catalogue rows only, M4) never shows yet. The last choice is remembered on the device and
pre-selected next time. Tracked as `listing_fit_checked { result }`.

### 8.4 Report listing (R15)
- Reasons (`LISTING_REPORT_REASONS`): `stock_photos` (Stock photos, not the real part), `wrong_side_or_fit`,
  `wrong_price_or_quantity`, `already_sold`, `advance_payment` (Asked for advance payment), `something_else`; details
  optional ≤ 500 (required for `something_else`).
- `POST /listings/:id/reports`: public listings only; not one's own (`403 REPORT_OWN_LISTING`); one **open** report per
  reporting business and listing (`409 REPORT_EXISTS`); at most **10 reports per user per 24 h** (`429 REPORT_LIMIT`,
  counted on the table).
- Reports **never hide a listing automatically** (a competitor could abuse it); they put it in the moderation queue's
  **Reported** tab (§11.1) and turn on the edit-goes-to-review rule (§7.3).

---

## 9. Left / Right / Pair matching (M8)

### 9.1 The query: `findOtherSide(listingId, viewer)`
For a public (or own) **part** listing with side `left` or `right` (else an empty result):
- `want = complementarySide(side)`; candidates are **public** part listings, other than this one, with side **`want` or
  `pair`** (scope: "a pair satisfies a need for either side"). The same seller's listings are included (R22).
- **Tier 1 — same part:** both normalised part numbers have ≥ 3 characters and are equal.
- **Tier 2 — same part by name and fit:** same part group (`category_id`), `similarity(title_norm, :title_norm) ≥ 0.5`
  (`pg_trgm`), and **fitment overlap** — they share a machine model (or a brand where either row is "all models") with
  overlapping year ranges (open ends overlap) — or at least one of the two has no fitment rows.
- `title_norm` = `normalizePartName(title)`: lower-case, punctuation to spaces, **side words removed** (left, right,
  lh, rh, l h, r h, l/h, r/h, लेफ्ट, राइट, बायाँ, दायाँ, ડાબું, જમણું, લેફ્ટ, રાઇટ), spaces collapsed (R38).
- **Ranking:** tier 1 before tier 2; then exact side before `pair`; then **distance** (`ST_Distance` from the viewer's
  business point when signed in and known, else from this listing's point; nulls last); then `refreshed_at` newest.
- **Limit 20**; the result carries `complement`, `total` (up to 20) and cards with distance.
- `GET /listings/:id/other-side` (public; owner may call it on a non-public own listing, which is how "Find the other
  side" works from My listings).

### 9.2 Where it shows
- **Listing page:** the Other side block (§8.1 item 5), from the first result of each side.
- **Other side screen** ("Right side for this part", mockup "Complementary side"): the pairing header (this side's
  thumbnail + the needed side as SideToken `need`) and the list. From My listings (the seller holds one side) the line
  reads **"You have the left side. These sellers have the right one."**; from the listing page "Right side for this
  part". Empty: "No right side listed yet. We'll show it here when one is listed." (F8 alerts later.)
- **Published screen:** "Find the other side" for a left or right part.
- **Deferred:** the side **filter** and side words in search (F4), requirement and alert matching on side (F8), home
  side-match strip (M2), mirror numbers, "either", two-seller pair suggestions (P2).

---

## 10. My listings (seller)

- Reached from **Profile** (a "My listings" row with the live count, above Business profile), the **Post** tab ("My
  listings" link under the four choices) and the Published screen. (The M17 dashboard under Deals comes later.)
- **SegmentedControl** with four groups and counts, as the mockup: **Live** (`live`, `reserved`, `rented`), **In
  review** (`pending_review`, `rejected`), **Paused** (`paused`, `expired`, `unavailable`, `hidden`), **Sold** (`sold`).
  **Drafts** are a Card row above the control ("2 drafts · Continue") opening a drafts list (R29). Removed listings
  aren't shown.
- **Cards:** the shared ListingCard (thumbnail, title, side, condition, quantity, price) with a StatusChip, "Updated 3
  days ago" or "Expires in 5 days" (`expiringSoon` → `warn` chip), the moderator's message on rejected ones, and the
  top score nudge ("Add a video").
- **Manage sheet** (mockup "Manage a listing"): only the actions `sellerActions(status, kind)` allows, plus **Edit**
  (editable statuses), **Update quantity** (a small sheet), **Duplicate**, **Find the other side** (left / right parts).
  Destructive ones (Remove, Mark sold) confirm through `useConfirm`. A "Still available?" banner on cards inside the
  reminder window with **Renew** in one tap.
- **Edit** opens an "Edit listing" menu (ListRows per section, the same step screens in edit mode with **Save**), not the
  linear wizard.

---

## 11. Admin (AD3)

### 11.1 Moderation queue (`/moderation`, `moderator` + `super_admin`)
Two panes as the mockup "Listing moderation" and the verification page: queue left, review right; URL state
`?tab=&id=`.
- **Review** (`pending_review`, oldest `status_changed_at` first) with pills from `review_reasons`: First listing,
  Resubmitted, Price check, Unit check, Quantity check, Edited after report, Edit flagged; plus "Unverified seller".
- **Reported** (listings in any status but `removed` with ≥ 1 open report, most reports first, then oldest report).
- **Decided** (approve / ask for changes / reject / hide / remove in the last 90 days, newest first).
- Nav badge `moderationWaiting` = Review + Reported counts (`GET /admin/moderation/counts`), polled like
  `verificationWaiting`. Page size 50.

### 11.2 Review screen (shared by `/moderation` and `/listings/[id]`)
Header (cover, title, kind, ref, status, side pill); photos grid with the image lightbox; videos (`<video controls
poster>`); a specs table (category breadcrumb, condition, quantity + unit, min order, side + the node's convention,
fits, price / rates and terms, part number, part brand, machine make / model / year / hours / **serial number**,
"Other" brand or model texts highlighted); location (**address line, pincode, map link to the point** — admins see
them); delivery; listing score and flags; **seller panel** (business name linking to `/businesses/:id`, GST status,
account status, member since, listings by status, how many ever went live); open and closed **reports**; **status
history**; the actions bar.

### 11.3 Actions
All take the listing's **`version`** as loaded; a mismatch → `409 LISTING_CHANGED` and the page shows the stale
warning with Reload (the seller edited meanwhile). Status preconditions as §7.2 (`409 LISTING_TRANSITION_NOT_ALLOWED`).
Reasons and messages: `ADMIN_REASON_MIN`–`ADMIN_REASON_MAX` (3–500).

| Action | Endpoint | Notes |
|---|---|---|
| Approve | `POST /admin/listings/:id/approve` | `pending_review` → `live` |
| Ask for changes | `…/ask-for-changes` `{ message }` | → `rejected`, outcome `changes_requested` |
| Reject | `…/reject` `{ reason }` | → `rejected`, outcome `rejected`; the seller may still fix and resubmit (scope M7); Remove is the final action (R13) |
| Edit category / side / fit | `PATCH /admin/listings/:id` `{ version, categoryId?, side?, fitments? }` | The merged listing must be publishable; a new category is allowed only when the existing specs validate under it (`400 SPECS_INVALID`, R33); edited fitment rows get `source = 'admin'`; version + 1; status unchanged |
| Hide | `…/hide` `{ reason }` | §7.2 |
| Unhide | `…/unhide` | back to the status before hide |
| Remove | `…/remove` `{ reason }` | terminal |
| Delete a photo or video | `DELETE /admin/listings/:id/media/:mediaId` `{ reason }` | for abusive media; allowed even when it's the last photo (the listing then needs a photo before any seller edit passes); objects deleted after commit |
| Resolve reports | `POST /admin/listings/:id/reports/resolve` `{ outcome: 'dismissed' \| 'actioned', note? }` | closes **all** open reports of the listing |
| Bulk hide / remove | `POST /admin/listings/bulk` `{ action, ids (1–50), reason }` | one transaction per listing, skipped ones reported back (`{ done: [], skipped: [{ id, code }] }`), one audit row per listing (R34) |

### 11.4 All listings (`/listings`, read: `moderator`, `support`; actions: `moderator`)
Server-side paged table (25 / 50 / 100): ref, thumbnail, title, kind, status, category (machine category › type),
city, side, seller, price, updated. Filters in the URL: status (multi), kind, machine category, city, side, flags, has
open reports; search `q` over title, part number (normalised), `#ref` and business name. Row → `/listings/[id]` (the
review screen). Checkbox selection with bulk Hide / Remove (moderators). The "sold / unavailable monitor" of A3 is the
status filter.

### 11.5 Marketplace settings (`/settings`, `super_admin`)
The placeholder page becomes **Settings**, its first section **Marketplace** (§12): a form (React Hook Form + Zod) with
the four settings, their defaults and ranges, Save → `PATCH /admin/settings`. The roles part of AD7 stays a placeholder
section. Edit is super-admin only (R30).

### 11.6 RBAC and audit
- API: moderation reads and actions `requireAdminRole('moderator')` (super_admin passes); `/admin/listings` list and
  detail also `support` (read only); settings `requireAdminRole()` with no extra role (super_admin only). `lib/nav.ts`
  already lists these roles for `/moderation` and `/listings`; `/settings` stays super-admin only.
- `audit_log` for every mutation, `entity_type = 'listing'` (or `'setting'`), before / after of the changed fields:
  `listing.approve`, `listing.ask_for_changes`, `listing.reject`, `listing.edit`, `listing.hide`, `listing.unhide`,
  `listing.remove`, `listing_media.delete`, `listing_reports.resolve`, `setting.update`.

---

## 12. Settings (`app_settings`)
- A small key / value table: `key text primary key`, `value jsonb not null`, `updated_by_admin_id`, `updated_at`. **The
  registry is code** (`APP_SETTINGS` in shared-types: key, type, default, min, max, label, help); a missing row means
  the default, so nothing needs seeding. **[Owner: real but minimal; Claude: shape]** (R10)
- Settings now:

  | Key | Default | Range | Meaning |
  |---|---|---|---|
  | `listing_expiry_days` | 60 | 7–365 | A live listing expires this long after its last update |
  | `listing_expiry_reminder_days` | 7 | 1–30, **less than** the expiry | "Still available?" this long before expiry |
  | `listing_review_first_n` | 3 | 0–50 | A business's first N listings are reviewed (0 = none) |
  | `unverified_listing_cap` | 3 | 1–1000 | Open listings a business without GST verification may hold |

- `getSettings(db)` reads all rows once per call (one small query, no cache, so tests and changes apply at once);
  `updateSettings(db, adminId, patch)` validates against the registry and the cross-field rule (`400 SETTING_INVALID`
  with the key), upserts, and writes one `setting.update` audit row with before / after maps. Later settings (requirement
  seller cap, quiet hours, offer validity) join the registry without a migration.
- Catalogue master data is for admin-managed **lists**; scalar marketplace rules don't fit there.

---

## 13. Data model (new migrations from `0008`; never edit 0000–0007)

### 13.1 Enums
`listing_kind` (`LISTING_KINDS`), `listing_status` (`LISTING_STATUSES`, with `hidden`, `expired`), `part_side`
(`PART_SIDES`), `price_model` (`PRICE_MODELS`), `gst_price_mode` (`included`, `extra`), `rental_period`
(`RENTAL_PERIODS`), `rental_operator` (`included`, `optional`, `not_available`, `mandatory`), `rental_fuel` (`client`,
`included`, `per_litre`), `rental_transport` (`owner_delivers`, `renter_picks_up`, `either`), `listing_location_source`
(`business`, `godown`), `media_type` (`photo`, `video`), `moderation_outcome` (`approved`, `changes_requested`,
`rejected`), `history_actor` (`seller`, `admin`, `system`), `fitment_source` (`seller`, `admin`), `report_target`
(`REPORT_TARGETS`), `report_status` (`REPORT_STATUSES`).

### 13.2 Tables
- **`listings`**: `id` uuid pk · `ref` bigserial unique (sequence restarted at 100001) · `business_id` → businesses ·
  `created_by_user_id` → users · `kind` · `status` default `draft` · `category_id` → categories (null in a draft) ·
  `title` · `title_norm` · `description` · `part_number` · `part_number_norm` · `part_brand_id` → brands · `side` ·
  `specs` jsonb default `{}` · `quantity` numeric(14,3) · `unit_id` → units · `min_order_qty` numeric(14,3) ·
  `condition_id` → conditions · `condition_note` · `price_model` · `price_paise` bigint · `gst_mode` ·
  `location_source` default `business` · `pincode`, `city`, `state`, `industrial_area_id` → industrial_areas,
  `industrial_area_other`, `address_line` (godown only), `point` geography · `delivery` text[] default `{}` · `flags`
  text[] default `{}` · `review_reasons` text[] default `{}` · `moderation_outcome`, `moderation_note`, `moderated_at`,
  `moderated_by` → admin_users · `status_reason` · `version` int default 1 · `published_at`, `first_live_at`,
  `refreshed_at`, `expiry_reminded_at`, `status_changed_at`, `created_at`, `updated_at`.
- **`listing_machines`** (1 : 1, machine kinds): `listing_id` pk → listings · `brand_id` → brands · `brand_other` ·
  `model_id` → machine_models · `model_other` · `year` smallint · `hours_run` int · `serial_number` · `under_power` bool
  · `inspection_by_appointment` bool · `reason_for_sale`.
- **`listing_rentals`** (1 : 1, `machine_rental`): `listing_id` pk · `rate_hour_paise`, `rate_day_paise`,
  `rate_week_paise`, `rate_month_paise` bigint · `shift_hours` smallint default 8 · `min_duration` smallint ·
  `min_duration_period` · `operator` · `operator_rate_day_paise` · `fuel` default `client` · `transport` ·
  `transport_charge_paise` · `service_radius_km` smallint · `deposit_paise` · `available_from` date ·
  `availability_note`.
- **`listing_fitments`**: `id` · `listing_id` → listings · `brand_id` → brands (not null) · `model_id` → machine_models
  · `model_other` · `year_from`, `year_to` smallint · `note` · `source` default `seller` · `sort_order`.
- **`listing_media`**: `id` · `listing_id` → listings · `type` · `key` · `thumb_key` (photo thumb or video poster) ·
  `content_type` · `size_bytes` int · `duration_ms` int · `sort_order` int · `created_at`.
- **`listing_status_history`**: `id` · `listing_id` · `from_status` (null for the first) · `to_status` · `action` text ·
  `actor` · `user_id` → users · `admin_id` → admin_users · `reason` · `created_at`.
- **`reports`** (generic, A6-ready): `id` · `target_type` · `target_id` uuid · `reporter_user_id` → users ·
  `reporter_business_id` → businesses · `reason` text · `details` · `status` default `open` · `resolved_by` → admin_users
  · `resolved_at` · `resolution_note` · `created_at`.
- **`app_settings`** (§12).

No `ON DELETE CASCADE` (as A4): draft deletion and test cleanup delete children first.

### 13.3 Constraints and indexes
- CHECKs (custom migration; drizzle-kit 0.22 can't emit them): quantity > 0 and min order > 0 when set; `price_paise`
  > 0 when set; rental rates and money > 0 when set; `year_from <= year_to`; machine `brand_id` and `brand_other` not
  both, `model_id` and `model_other` not both; fitment `model_id` and `model_other` not both; listing
  `industrial_area_id` and `industrial_area_other` not both; `shift_hours` 1–24; `ALTER SEQUENCE listings_ref_seq
  RESTART WITH 100001`.
- Partial unique: `reports_one_open_uq` on (`reporter_business_id`, `target_type`, `target_id`) WHERE `status IN
  ('open','reviewing')`.
- Indexes for this build and for F4 later (not search itself): GiST on `listings.point`; (`status`, `kind`,
  `category_id`); (`business_id`, `status`, `updated_at`); (`category_id`) for catalogue guards; `part_number_norm`
  WHERE not null; (`status`, `refreshed_at`) for the jobs; `listing_fitments` (`listing_id`), (`model_id`),
  (`brand_id`); `listing_media` (`listing_id`, `sort_order`); `listing_machines` (`brand_id`), (`model_id`);
  `listing_status_history` (`listing_id`, `created_at`); `reports` (`target_type`, `target_id`, `status`). F4 adds the
  text-search columns and trigram / full-text indexes.

### 13.4 Shared types (`packages/shared-types`)
`LISTING_STATUSES` (+ `hidden`, `expired`), `PUBLIC_LISTING_STATUSES`, `EDITABLE_LISTING_STATUSES`,
`OPEN_LISTING_STATUSES`, `DELIVERY_OPTIONS`, `GST_PRICE_MODES`, `RENTAL_OPERATOR_OPTIONS`, `RENTAL_FUEL_OPTIONS`,
`RENTAL_TRANSPORT_OPTIONS`, `LISTING_LOCATION_SOURCES`, `MEDIA_TYPES`, `MEDIA_ROLES`, `LISTING_FLAGS`,
`REVIEW_REASONS`, `MODERATION_OUTCOMES`, `LISTING_REPORT_REASONS`, `SELLER_LISTING_ACTIONS`, `ADMIN_LISTING_ACTIONS`,
`LISTING_TRANSITIONS` + `listingTransition()` + `sellerActions()`, limits (`LISTING_TITLE_MIN/MAX`,
`LISTING_PHOTOS_MAX = 10`, `LISTING_VIDEOS_MAX = 2`, `LISTING_VIDEO_MAX_MS = 60_500`, `MEDIA_MAX_BYTES` per role,
`LISTING_FITMENTS_MAX = 20`, `LISTING_DRAFTS_MAX = 20`, …), `SANITY_LIMITS`, `APP_SETTINGS`, helpers
`normalizePartNumber`, `normalizePartName`, `sanityFlags`, `listingScore`, `checkFit`, and the payload interfaces
(`ListingCard`, `ListingDetail`, `ListingOwnerView`, `ListingPatch`, `ListingMediaItem`, `Fitment`, `MachineDetails`,
`RentalTerms`, `OtherSideResult`, `MyListingsView`, `AdminListingRow`, `AdminListingDetail`, `AdminModerationRow`,
`AppSettingsView`).

---

## 14. API

Thin routes (Zod → service → `{ data }`), services under `src/services/listings/` (`listing-write`, `listing-lifecycle`,
`listing-read`, `listing-media`, `other-side`, `listing-reports`, `listing-admin`, `listing-jobs`) and
`src/services/settings.service.ts`.

**Public (no login; an optional user token makes `isOwner` and the viewer's point known):** `GET /listings/:id`,
`GET /listings/:id/other-side`, `GET /businesses/:id/listings?limit=&exclude=` (public listings of one seller, newest
first, ≤ 50).

**User (`requireUser`):** `POST /listings` `{ kind }` · `GET /listings/mine?group=live|review|paused|sold|drafts&page=`
(counts per group + the page) · `GET /listings/:id/owner` (owner view, any status) · `PATCH /listings/:id` ·
`DELETE /listings/:id` (drafts) · `POST /listings/:id/publish` · `POST /listings/:id/actions` `{ action, note? }`
(seller actions of §7.2) · `POST /listings/:id/duplicate` · `POST /listings/:id/media/presign` ·
`POST /listings/:id/media` · `PUT /listings/:id/media/order` · `DELETE /listings/:id/media/:mediaId` ·
`POST /listings/:id/reports`.

**Admin:** `GET /admin/moderation/queue?tab=review|reported|decided&page=` · `GET /admin/moderation/counts` ·
`GET /admin/listings?…` · `GET /admin/listings/:id` · `PATCH /admin/listings/:id` · `POST /admin/listings/:id/approve
| ask-for-changes | reject | hide | unhide | remove` · `DELETE /admin/listings/:id/media/:mediaId` ·
`POST /admin/listings/:id/reports/resolve` · `POST /admin/listings/bulk` · `GET /admin/settings` ·
`PATCH /admin/settings`.

**Rate limits** (per signed-in user, 10 minutes, the F1 `perUser` pattern, on top of the global limit) (R39): create
30 · PATCH 240 (autosave) · publish 30 · actions 60 · duplicate 20 · media presign 60 · media attach 60 · reports 10 per
24 h (table count). Public reads: the global limit.

**Error codes** (stable; added to the shared list): `LISTING_NOT_FOUND` 404 · `KIND_IMMUTABLE` 400 ·
`FIELD_NOT_FOR_KIND` 400 · `CATEGORY_INVALID` 400 · `SPECS_INVALID` 400 · `SIDE_REQUIRED` 400 · `SIDE_NOT_ALLOWED` 400
· `UNIT_DECIMALS` 400 · `PRICE_REQUIRED` 400 · `RATE_REQUIRED` 400 · `BRAND_INVALID` 400 · `MODEL_INVALID` 400 ·
`FITMENT_INVALID` 400 · `AREA_MISMATCH` 400 (existing) · `LISTING_INCOMPLETE` 400 · `ONBOARDING_INCOMPLETE` 409 ·
`DRAFT_LIMIT` 409 · `UNVERIFIED_LISTING_CAP` 409 · `LISTING_NOT_EDITABLE` 409 · `LISTING_TRANSITION_NOT_ALLOWED` 409 ·
`LISTING_CHANGED` 409 · `MEDIA_LIMIT` 409 · `MEDIA_LAST_PHOTO` 409 · `MEDIA_KEY_INVALID` 400 · `MEDIA_MISSING` 400 ·
`MEDIA_TYPE` 400 · `MEDIA_TOO_LARGE` 413 (existing) · `MEDIA_ORDER_INVALID` 400 · `VIDEO_TOO_LONG` 400 ·
`STORAGE_UNAVAILABLE` 503 (existing) · `REPORT_OWN_LISTING` 403 · `REPORT_EXISTS` 409 · `REPORT_LIMIT` 429 ·
`SETTING_INVALID` 400 · catalogue: `NODE_IN_USE`, `MOVE_NOT_ALLOWED`, `BRAND_IN_USE` (existing), `MODEL_IN_USE`,
`UNIT_IN_USE` 409 (new). Someone else's listing is `404 LISTING_NOT_FOUND`, never 403, so ids don't leak existence.

---

## 15. App (Expo)

### 15.1 Navigation (root stack, `navigation/types.ts`)
`Sell: { listingId; step: SellStep; mode?: 'create' | 'edit' }` (one route, pushed per step, so Back works naturally) ·
`SellPublished: { listingId; outcome }` · `ListingEditMenu: { listingId }` · `Listing: { listingId }` ·
`ListingMedia: { listingId; index }` (full-screen viewer) · `OtherSide: { listingId; from: 'listing' | 'mine' }` ·
`MyListings: { group? }` · `MyDrafts` · `SellerListings: { businessId }`. The Post tab's first three cards create a
draft and push `Sell` step 1; "A requirement" stays "Coming soon".

### 15.2 Components (from the v2 kit, re-skin spec §7) and new ones
Screens use **Card, ListRow, Chip, SegmentedControl, Steps, SideToken, FooterBar, StatusChip, IconButton, Header,
Field, Input, Notice, EmptyState, Skeleton, ConfirmSheet**. New shared components: **ListingCard** (the mockup's
`.listing` row), **ActionSheet** (bottom-sheet list of ListRows, `use-sheet-animation`; the manage sheet and report
reasons), **SideDiagram** (`react-native-svg` port of `sideDiagram()`), **MediaTile** (photo / video tile with progress,
error and retry), **PriceText** (rupees with Indian grouping, per-unit suffix and model). The listing screens start only
after the Periwinkle v2 re-skin's components are merged (the plan, written after approval, will order its batches that way).

### 15.3 Native modules
`expo-image-manipulator`, `expo-video`, `expo-video-thumbnails`, `react-native-compressor` via `npx expo install`; the
image picker's camera / microphone permission strings in `app.json` (en). **A new dev build is required** (`pnpm android`).

### 15.4 Pure, tested helpers (`lib/`)
`sell-wizard.ts` (`wizardSteps`, `nextStep`, `prevStep`, `firstIncompleteStep`, `stepFields`), `money.ts`
(`parseRupees(text)` → paise or null, accepting Hindi / Gujarati digits via `toAsciiDigits`, `,` grouping, up to 2
decimals; `formatRupees(paise)` en-IN grouping ₹1,23,456), `quantity.ts` (parse and format with the unit's decimals),
`listing-format.ts` (price line, rate headline, fits line, distance, "Updated 3 days ago" through `format-date`),
`my-listings.ts` (status → group), `media-prepare.ts` (resize targets, size / duration checks, file naming),
`spec-form.ts` (template field → form control and Yup rule).

### 15.5 Copy, analytics, privacy
- New i18n areas `sell` and `listing` in en / hi / gu; parity and audit tests pass. Enum values sent to the API stay
  English; labels come from translations (price models, rental periods, delivery, side, report reasons) or the server
  (category, condition, unit labels — admin data, English until catalogue translations exist).
- `LISTING_EVENTS` in `lib/analytics-events.ts`: `sell_started`, `sell_step_completed`, `sell_media_upload_failed`,
  `listing_published` (`outcome`), `listing_publish_failed` (`reason`), `listing_action_done` (`action`),
  `listing_contact_tapped`, `listing_fit_checked`, `listing_other_side_opened`, `listing_reported`. Ids, kinds and codes
  only — no titles, part numbers, prices or addresses.

---

## 16. Catalogue guards (A4's "M5 adds the check" points)
In the A4 services, each marked `// M5:` comment becomes a check inside the existing transaction:
- **Delete node / move node:** refused when any listing (any status, drafts included) has `category_id` in the node's
  subtree (`409 NODE_IN_USE` for delete with `listings` in the uses list; `400 MOVE_NOT_ALLOWED` for move).
- **Delete brand:** refused when a listing references it as part brand, machine make or fitment brand (`409 BRAND_IN_USE`).
- **Move or delete model:** refused when a listing's machine model or a fitment row references it (`409 MODEL_IN_USE`).
- **Lower a unit's decimals:** refused when any listing uses the unit (`409 UNIT_IN_USE`); deactivating stays allowed.
- Deactivating any of them stays allowed; existing listings keep working (edits on a listing whose node was deactivated
  since pass `allowInactive: true` to `validateSpecs`, A4 §5).

---

## 17. Constraints and testing
- Stack and patterns as CLAUDE.md: routes → services, `AppError` codes, Drizzle (raw SQL only for PostGIS and
  `pg_trgm`), migrations via `db:generate` plus `--custom` for CHECKs and the sequence restart, money in paise, PostGIS
  for every distance, admin RBAC on the API and mirrored in `lib/nav.ts`, every admin mutation in `audit_log`.
- API tests against the real test database, cleaning up everything they insert (`deleteTestBusinesses` deletes
  listings and children first). Media tests: the `503` path, key checks and sniffing without R2; round trips
  `describe.skipIf(!isMediaStorageConfigured())` with "R2 keys not set: media round-trip tests skipped". Listing
  fixtures insert `listing_media` rows with fake keys directly, so publish and lifecycle tests never need R2.
- The app works on Android first; all copy translated; light and dark.
- The build's final report names the variables and R2 settings of §6.6.

---

## 18. Rulings (Claude's calls; the owner may change any)
1. **R1** Kinds keep the built names `part`, `machine`, `machine_rental` (not `machine_sale` / `machine_rent`).
2. **R2** `LISTING_STATUSES` gains `hidden` (moderator take-down) and `expired` (freshness).
3. **R3** GST verification isn't required to publish; an unverified business may hold `unverified_listing_cap` (3) open
   listings (scope role table), and is prompted to verify for more.
4. **R4** Review rule: resubmissions, a business's first `listing_review_first_n` (3) listings that ever went live, and
   flagged listings go to review; everything else goes live. With both settings at 3, an unverified seller's listings
   are in practice all reviewed (scope), while a verified seller's later ones go live (owner decision 3).
5. **R5** Selling needs finished onboarding (profile + location); the business's activities aren't checked.
6. **R6** Enquire / Make offer / Ask price are shown and enabled and answer "Coming soon" (tracked) until F6; save,
   share and "request more photos" are hidden.
7. **R7** Public media: uploads into the private bucket's `incoming-listing/`, sniffed, copied to a separate public
   bucket served from `MEDIA_PUBLIC_BASE_URL` with immutable caching; draft media are public by unguessable URL.
8. **R8** Images are resized on the device (1600 px + 480 px thumbnail); no server image processing; "Make cover"
   instead of drag-reorder.
9. **R9** Videos: compressed on the device to H.264 720p MP4 (`react-native-compressor`), ≤ 50 MB, ≤ 60 s checked in the
   app and by the reported duration; poster from `expo-video-thumbnails`; playback with `expo-video` by progressive
   download. Fallback without the compressor: same cap, "record a shorter clip".
10. **R10** Settings live in an `app_settings` key / value table with a code registry; no cache.
11. **R11** Expiry counts from `refreshed_at` (publish, approve, renew, resume, relist, end of rental, any seller edit)
    against the current setting; only `live` expires; the reminder job stamps `expiry_reminded_at` for F9 while the app
    banner reads `expiresAt`.
12. **R12** No notifications or socket events in this build; My listings shows status, reasons and banners.
13. **R13** Ask for changes and Reject both lead to `rejected` (the seller can fix and resubmit, as M7); they differ in
    outcome and wording; Remove is the final action.
14. **R14** Hide is reversible; Unhide restores the status the listing had when hidden.
15. **R15** Reports: generic `reports` table, listing target only; never auto-hide; one open report per business and
    listing; 10 per user per 24 h; not on one's own listing.
16. **R16** Category / side / fitment edits on a listing with an open report, and edits that add a sanity flag, send a
    live or paused listing back to review; the seller is warned without being told about the report.
17. **R17** Sanity thresholds are shared-types constants (§5.4), not settings yet.
18. **R18** Machine make and model: catalogue or "Other" text; fitment rows need a catalogue brand, the model may be
    catalogue, "Other" or "all models".
19. **R19** Listing point: the source's pin (business or godown), else the pincode's centroid; business-sourced listings follow the
    business's location changes; buyers see area, city and distance only.
20. **R20** Public statuses `live`, `reserved`, `rented`; listings of a business with a suspended or blocked user are not
    public.
21. **R21** "Check my machine" is an on-device brand / model / year picker answered from seller-declared rows ("Seller
    says it fits" / "Not listed"); the last choice is remembered on the device.
22. **R22** Other side: tier 1 normalised part number, tier 2 same part group + name similarity ≥ 0.5 + fitment overlap
    (or no fitment on one side); pairs count as complements; same seller included; distance from the viewer's business,
    else the listing; "Post a requirement" waits for F8.
23. **R23** "Similar parts nearby" waits for F4; "More from this seller" (6) and a seller listings screen instead.
24. **R24** Seller card shows no rating, deals or reply time until those modules exist (not zeros).
25. **R25** Rentals: rates per hour / day / week / month (≥ 1), M14 terms as fields, availability = available-from date
    + note (no calendar until bookings); condition isn't asked.
26. **R26** Duplicate copies everything except media, status, moderation, reports and history.
27. **R27** Drafts are deleted for good (with media); at most 20 per business; no draft purge job.
28. **R28** Part name prefilled with the part group's name, machine title with type + make + model; recent categories
    on the device; title suggestions from other listings wait for F4.
29. **R29** My listings: four segments (Live, In review, Paused, Sold) plus a Drafts row.
30. **R30** Moderation and listing actions: `moderator`; listings read: + `support`; settings: `super_admin` only.
31. **R31** `LISTING_MEDIA_OPTIONAL=true` (dev only, ignored in production) allows publishing without photos before R2 is set up.
32. **R32** No virus scanning for listing media (images and videos are sniffed and served from a separate domain with a
    fixed type); scanning stays an open item before launch, for documents first.
33. **R33** An admin may change a listing's category only when its specs validate under the new node; admin-edited
    fitment rows are marked `admin`.
34. **R34** Bulk hide / remove: up to 50 listings, one reason, one audit row each, skipped ones reported.
35. **R35** Listing reference `#100001…` from a sequence.
36. **R36** "Open" listings for the cap: every status except `draft`, `sold`, `removed`.
37. **R37** Fitment years 1950 … next year, open ends allowed; a row with no model means all models of the brand.
38. **R38** Part names are normalised for matching by removing side words in English, Hindi and Gujarati.
    **R38b** The side diagram is drawn only for the default convention; a custom convention shows its text alone.
39. **R39** Rate limits as §14.
40. **R40** Media of removed listings stay in storage until DPDP deletion work; admins can delete a single item at once.
41. **R41** Quantity can't be edited to 0; Mark sold instead.

---

## 19. Open items for the owner and the client (don't block building)
- **R2:** public bucket, custom media domain, the `incoming-listing/` lifecycle rule, token access to both buckets (§6.6).
- **D3 side convention** and which part groups have sides (A4 seed): the side step and matching depend on them.
- **D4** first-listing review count and the unverified cap (now settings).
- **Virus scanning** before launch (carried from F1).
- **Data residency** for media (R2 has no India region), as the scope's open question.
- Whether "Reject" should be final (no resubmission) rather than R13.

## 20. Left to the builder
Exact component and file names (the plan, written after this spec is approved, sets the file map), query shapes, the step screens' layout within the v2 kit,
copy wording within the meanings above, the admin review screen's panel layout (following the verification page), and
test layout.
