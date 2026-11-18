# F2 + F3 + A3 · Listings: sell wizard, listing page, lifecycle, Left / Right / Pair matching, moderation: design

Date: 2026-11-18 · Status: **Approved by the owner 2026-11-18** (revision 2) · Scope IDs: **F2** (sell parts and machinery), **F3** (Left / Right / Pair
matching), **A3** (listing management) in `docs/product-scope.txt`; feeds F4/F5 (search, browse), F6 (enquiries and
offers), F7 (deals, rentals), F8 (part requests). Spec modules in `docs/product-scope.md`: **M5** sell wizard, **M6**
listing page, **M7** listing lifecycle, **M8** Left / Right / Pair matching, admin **AD3** listing moderation; touches
M4 (fitment), M14 (rental listing fields), M17 (My listings), M19 (reports, sanity checks), AD6 (settings).

> **Revision 2 (2026-11-18)** — after an independent review (no Critical findings) and four owner answers:
> - **Owner decisions 5–8 added (§3):** every listing of a business without GST verification is reviewed
>   (`unverified_seller`); virus scanning moves after F2 but before launch, for documents and media together
>   (amends F1 ruling 11; R32); **machines for rent only from GST-verified businesses** (`403 RENTAL_NEEDS_GST`, the
>   rental card disabled in the app); **Duplicate is cut** (P2). The unverified open-listing cap is **kept** (R3).
> - **One go-live gate (§5.5)** now runs on publish **and** on resume, renew, relist and end of rental (sanity flags
>   against the flags a moderator accepted, the rental GST rule; relist also the unverified review and the cap); the
>   business row is locked before the listing in every lifecycle write; `edit_flagged` covers every non-draft status.
> - **Grandfathering (§7.3, R42):** a non-draft edit checks only the fields it changes; catalogue changes never block
>   edits; deactivated categories and sides switched off are defined.
> - **Category is locked after review** for sellers (draft and rejected only; admins can still change it) (R43).
> - **Location metadata:** photos always go through the manipulator, JPEG only, and the server refuses EXIF; videos
>   only through the compressor with `preserveMetadata: false` (the library keeps GPS by default); without the
>   compressor, video upload doesn't ship (R46, R47).
> - **CDN takedown:** devices cache 1 day, the edge 1 year, and every media deletion purges the URL through the
>   Cloudflare API (new `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`) (R45).
> - **Matching:** side-stripped part numbers in tier 1 (`TP-200L` ↔ `TP-200R`), real fitment overlap when both have
>   fitment, a labelled "Possibly the other side" tier when one has none, best match per side computed separately (R22).
> - **Admin:** removed-by-team listings stay visible to the seller for 30 days with the reason; version checks only on
>   approve / ask for changes / reject / edit; deleting the last photo sends the listing to `rejected`; hide and remove
>   resolve open reports; a seller filter and a link from the business page; an expiry-impact count on the settings page.
> - **Lifecycle details:** `rented` listings expire too; `return_status` replaces reading history for unhide and
>   back-to-review; the reminder-stamping job is deferred to F9 (the banner is computed).
> - **Smaller fixes:** one upload key format, an ftyp brand allow-list, `expo-file-system/legacy`, duration rechecked
>   after compression, `full` images in moderation, higher media rate limits, a machine-unit flag on units, rental
>   overtime and month definition, the optional-token plugin, the owner-user suspension rule plus an index, error
>   plumbing (`ConflictError` details, where codes live), the `--reset` guard, i18n rules for catalogue data, and the
>   listing page's departures from the mockup (§8.5).

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

**Success check (without R2 keys):** with `LISTING_MEDIA_OPTIONAL=true` in dev, a GST-verified seller lists a left
temple part in a part group that has sides, sees the side step with the convention diagram, previews and publishes; the
listing goes to **pending review** (first listing); a moderator approves it; a second seller lists `TP-200R`, the right
side of `TP-200L`; on the first listing the **Other side** block shows the second seller with the distance. An
unverified seller's listing goes to review with "Unverified seller", and its rental card says "Verify your GST to list
rentals". The seller pauses, resumes and marks a listing sold from **My listings**; an admin hides it; the expiry job
expires a listing whose `refreshed_at` is older than the setting. **With R2 keys** (§6) the same run uses real photos
and a 60-second video, played back on the listing page. Until the owner adds the keys, media endpoints answer
`503 STORAGE_UNAVAILABLE` (tested) and the media step shows "Photo upload isn't available yet".

---

## 2. Goals, non-goals, anti-goals

### Goals
- **Sell wizard (M5)** for three kinds: spare part, machine for sale, **machine for rent** (GST-verified businesses only;
  rates per hour / day / week / month, terms, availability). **[Owner]** Server-side **autosaved drafts**, a
  **preview** that is the buyer's view, a **listing score** with nudges, **sanity checks** on price, unit and quantity.
  **[Scope M5]**
- **Photos and videos:** 1–10 photos, **up to 2 videos of ≤ 60 s**, public media storage on R2, location metadata
  removed on the device. **[Owner, Scope]**
- **Listing page (M6)** with gallery and video playback, side / condition / stock, price or rental rates, **Fits** block
  with "Check my machine", **Other side** block, specs, delivery and area, seller card, more from this seller, Report.
- **Lifecycle (M7)** as one server-side state machine: review, live, paused, sold, unavailable, rented, expired,
  hidden, removed; **every unverified seller's listing and a verified seller's first 3 listings reviewed** **[Owner]**;
  **expiry after 60 days without an update**, a "Still available?" banner 7 days before and one-tap **Renew**, both
  **admin-configurable** **[Owner]**.
- **Left / Right / Pair (M8):** side step (only where the category has sides), side on every part listing, the
  **Other side** query and the **"You have the left side, these sellers have the right one"** screen. **[Scope F3]**
- **My listings** with actions: edit, update quantity, pause, resume, mark sold, mark unavailable, mark rented / back
  available, renew, relist, remove, find the other side; listings removed by the team stay visible with the reason.
- **Admin (AD3):** moderation queue (review, reported), review screen, approve / ask for changes / reject / edit
  category, fit and side / hide / unhide / remove / delete a photo, reports resolution, all-listings table with filters
  and bulk hide / remove, and a **Marketplace settings** page. Every mutation audit-logged. **[Scope, Owner]**
- **Reports** on listings (the M19 "Report listing" sheet) into the moderation queue.
- The **catalogue guards** A4 left for M5 (refuse deleting / moving catalogue rows that listings reference, and the
  catalogue seed's `--reset` once listings exist).

### Not in this build

| Left out | Comes with |
|---|---|
| Enquiries, chat, offers, "Request more photos" | **F6**. The contact buttons are shown and say "Coming soon" (R6) |
| Deals, `reserved`, quantity reduced by deals, reviews | **F7** (the `reserved` transitions are defined, unused) |
| Rental **bookings** (request / confirm, calendar, on site, returned) | **M14 bookings**. A rental listing's action is Enquire **[Owner]** |
| Requirements, availability alerts, "N buyers are looking for this part", "Post a requirement" on the Other side block | **F8** |
| Push / in-app notifications ("listing approved", "expiring") and the reminder-stamping job | **F9**. Now: status, reason and banners in My listings (R12) |
| Search, browse tree with counts, filters (including the side filter), home feed, similar parts nearby | **F4 / F5** (indexes they need are created now, §13.3) |
| Save, share, follow, price drop, recently viewed | **M12 / M2**, and public web pages for share links |
| **Duplicate listing** | **P2**, as scoped **[Owner, decision 8]** |
| Seller dashboard numbers (views, enquiries), reply time, rating, deals done | **M17 / M13 / M15** |
| Verified fitment, mirror part numbers, cross-references, serial ranges, "either side", My machines | **M4 / M8 P2** |
| Bulk upload (CSV + photo zip), AI title / category from a photo, perceptual-hash duplicate photos | **P2** |
| Test report and Chartered Engineer certificate attachments on machines | **P2** |
| "Request a missing model" and "Suggest a category" queues | **AD4** later; "Other" text is stored now (R18) |
| Reports on users, messages, reviews; the AD6 reports page | **AD6** (the `reports` table is generic, §13) |
| Virus scanning of uploads (documents and media) | **After F2, before launch** **[Owner, decision 6]** |
| Purging media of removed listings | DPDP deletion work (R40) |
| Catalogue translations (category, brand, model, field names in hi / gu) | A4 later (§15.5) |

### Anti-goals: this fails even if it technically works when
- A stranger (or a guest) can read a draft, paused, hidden, removed or rejected listing, a machine's serial number, a
  godown's address line or a listing's exact point. **[Scope: exact address only after a deal]**
- A listing goes live with specs that fail its category's template, a side on a category without sides, no side on a
  category with sides, or (outside the dev switch) no photo — **when the listing is created or those fields are
  changed**; values that met the rules when set are grandfathered (§7.3). **[Scope; Claude R42]**
- A listing reaches `live` from any status without passing the go-live gate (§5.5). **[Claude]**
- A moderator approves content the seller changed after the moderator opened it. **[Claude]**
- A seller moves a listing out of `hidden` or `removed`, or any client moves a status the state machine doesn't allow. **[Scope]**
- An uploaded file that isn't an image or a video is served from the public media domain, a seller attaches a file
  another business uploaded, or a photo or video reaches the public bucket with GPS metadata. **[Claude]**
- A deleted photo or video stays served by the CDN after the deletion. **[Claude]**
- A business whose owner user is suspended or blocked still has listings visible to buyers. **[Claude]**
- The catalogue lets an admin delete or move a node, brand, model or unit that listings use. **[Scope A4]**
- The app shows **its own copy** in English in Hindi or Gujarati mode (catalogue names typed by the admin are the stated
  exception, §15.5). **[Scope: i18n parity tests]**

---

## 3. Decisions made with the owner (2026-11-18)

1. **Machines for rent are included now.** The wizard lists spare parts, machines for sale and machines for rent.
   Rental pricing uses the shared-types rental periods; deposit and the M14 terms are fields; availability is a date and
   a note (R25). **Bookings are not in this build**: a rental listing's action is Enquire (which is "Coming soon" until
   F6, R6).
2. **Video upload is included:** up to 2 videos per listing, ≤ 60 s each, uploaded like photos. Cap, poster, metadata
   and playback: §6.5 (R9, R47).
3. **A new seller's first 3 listings go to admin review** (`pending_review`); later listings go live directly unless
   flagged. The count is a setting (§12). Decision 5 refines this for unverified businesses.
4. **Listings expire after 60 days without an update**, with a **7-day "Still available?" reminder** and one-tap
   **Renew**; all admin-configurable, audit-logged, in a small `app_settings` table with an admin page (§12), which also
   holds the first-N review count and the unverified-seller cap.
5. **Every listing from a business that is not GST-verified goes to review** (review reason `unverified_seller`,
   independent of first-N). **GST-verified businesses:** their first N listings (setting, default 3) are reviewed, then
   they go live unless flagged. **The unverified open-listing cap is kept** (default 3, R3): the scope's role table
   gives unverified businesses "up to 3 items", and the cap bounds the review queue that unverified accounts can fill.
6. **Virus scanning moves after F2 but must be in place before launch**: one scanning step, built later, for both GST
   documents and listing media. **This amends F1 ruling 11** (which put scanning into F2's media pipeline). (R32)
7. **Only GST-verified businesses can list machines for rent.** Spare parts and machines for sale: any business with
   finished onboarding. Refusal `403 RENTAL_NEEDS_GST`; in the app the rental card is shown disabled with "Verify your
   GST to list rentals" and a link to verification (§5.1, §15.1).
8. **Duplicate listing is cut** (stays P2, as scoped): no duplicate action, endpoint or menu item.

**Media domain:** production needs a custom domain on Cloudflare for public media; the brand name (D1) is still open,
so `MEDIA_PUBLIC_BASE_URL` stays an owner setting (§6.6, §19).

Standing rules: work on `develop`; spec and plan before code; textile first (not on this machine, see "Follows").

---

## 4. The listing

### 4.1 Kinds
`LISTING_KINDS` stays as built in `packages/shared-types`: **`part`**, **`machine`** (for sale), **`machine_rental`**
(R1). Kind is chosen first and **never changes** (`400 KIND_IMMUTABLE`).

| Kind | Category level (A4) | Template kind (`validateSpecs`) | Side | Fitment | Price | Who |
|---|---|---|---|---|---|---|
| `part` | part group | `part` | when the node's effective `has_sides` | 0–20 rows | price model + price per unit | onboarded |
| `machine` | machine type | `machine` | — | — | price model + price per unit | onboarded |
| `machine_rental` | machine type | `machine` | — | — | rates per period (§4.5) | **GST-verified** |

### 4.2 Fields every listing has

| Field | Rule |
|---|---|
| Category | Part group (parts) or machine type (machines, rentals), **active** with active ancestors (`400 CATEGORY_INVALID`). **Editable only in `draft` and `rejected`** (`409 CATEGORY_LOCKED` otherwise; admins can change it, §11.3) (R43). Changing it drops spec keys not in the new node's template (any status) and, for parts, resets `side` when the new node has no sides |
| Title | 3–100 chars, trimmed. Parts: the **part name**, prefilled with the part group's name. Machines: prefilled "`<machine type>`, `<brand> <model>`" (R28) |
| Description | Optional, ≤ 1500 chars |
| Specs | JSONB, validated by `validateSpecs(nodeId, kind, specs, previousSpecs, { allowInactive })` (A4 §5). On a **draft** or **rejected** PATCH every error except `required` is refused (`400 SPECS_INVALID`, details = the validator's errors); `required` is checked at publish. Other statuses: §7.3 |
| Quantity | Decimal string `^\d{1,7}(\.\d{1,3})?$`, > 0, ≤ 1 000 000, no more decimals than the unit allows (`400 UNIT_DECIMALS`). Machines and rentals: whole number 1–1000 |
| Unit | Parts: an active unit from master data (A4); price is **per this unit**. Machines and rentals: set by the server to the first active unit flagged **`is_machine_unit`** (a new master-data flag; the seed flags `machines`) and not chosen by the seller; none flagged → `409 NO_MACHINE_UNIT` on create (R48) |
| Condition | Active condition from master data; **not asked for rentals** (R25). Condition note optional, ≤ 300 |
| Location | §4.7 |
| Delivery | One or more of `DELIVERY_OPTIONS = ['pickup', 'ship', 'local_delivery']` (Buyer picks up · I can ship · Local delivery) |
| Media | 1–10 photos, 0–2 videos (§6) |

### 4.3 Part fields

| Field | Rule |
|---|---|
| Part number | Optional ("strongly encouraged"), ≤ 40 chars of `[A-Za-z0-9 ./-]`. Stored raw, **normalised** (`normalizePartNumber`: upper-case, every non `[A-Z0-9]` removed) and as a **side-stripped base** (`partNumberBase(norm, side)`: for a `left` listing a trailing `LEFT`, `LH` or `L` is removed, for a `right` listing `RIGHT`, `RH` or `R`; only the suffix that agrees with the listing's own side; other sides keep the number). A normalised number or base shorter than 3 is stored but never matched (§9). All three are recomputed on every write that changes the number or the side |
| Part brand | Optional; an active brand with `makes_parts` (A4 §6) (`400 BRAND_INVALID`) |
| Side | `PART_SIDES`: `left`, `right`, `pair`, `not_applicable` ("No side"). **Required** when the node's effective `has_sides` is true (`400 SIDE_REQUIRED` at publish); **forced to `not_applicable`** when it's false (a sent side other than that → `400 SIDE_NOT_ALLOWED`). A side set while the node had sides is grandfathered if the admin switches sides off (§7.3) |
| Min order | Optional, > 0, ≤ quantity (`400 MIN_ORDER_ABOVE_QUANTITY`), same decimals rule |
| Fitment | 0–20 rows (`400 FITMENT_INVALID` with the row index): machine **brand** (active, `makes_machines`) required; **model** optional — an active model **of that brand, of any machine type** (a part can fit machines of several types), or "Other" text ≤ 60, or neither = "all models of this brand" (R37); **year from / to** optional, 1950 … next year, from ≤ to; **note** optional ≤ 80 ("with hydraulic tensioner"). `source` is `seller` (or `admin` after an admin edit). Rows of an inactive brand or model stay on existing listings and show their names |

### 4.4 Machine fields (`machine` and `machine_rental`)

| Field | Rule |
|---|---|
| Make (brand) | An active brand with `makes_machines`, **or** "Other" text 2–60 (`400 BRAND_INVALID`); one of them required at publish (R18) |
| Model | Optional: an active model of that brand **and of the listing's machine type**, or "Other" text 1–60 (`400 MODEL_INVALID`) |
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
| Month definition | `month_days` 1–31, default 26 ("a month = 26 working days", M14) |
| Overtime | Optional overtime rate per hour (paise) |
| Minimum | Optional `min_duration` 1–365 with a `min_duration_period` from `RENTAL_PERIODS` ("4 hours", "1 day") |
| Operator | `included` · `optional` · `not_available` · `mandatory`; operator rate per day optional (paise) when `optional` or `mandatory` |
| Fuel | `client` (default, "client supplies diesel") · `included` · `per_litre` |
| Transport | `owner_delivers` · `renter_picks_up` · `either`; transport charge optional (paise, "each way") |
| Works within | Optional service radius 1–2000 km of the listing's location |
| Security deposit | Optional, paise 1 … 10¹¹ |
| Available from | Optional date (today or later **when set or changed**; null = available now; a date that has passed reads "Available now" and is grandfathered) and an availability note ≤ 200 |

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
  the business location changes, every non-removed listing with source `business` is updated in the same transaction**
  (`setMyLocation`); each updated listing's `version` goes up (a moderator's open review then reloads), its
  `refreshed_at` doesn't (it isn't a listing edit) (R19).
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
- `refreshed_at`: set on publish, approve, renew, resume, relist, end of rental, unhide, **every seller edit** of a
  non-draft listing and **every media add or delete** on a non-draft listing; drives expiry (§7.4) and "Updated 3 days ago".
- `version`: integer, +1 on every content change (seller or admin edit, media change, business location sync);
  approve / ask for changes / reject / admin edit send it (§11.3).
- `flags` (current sanity flags), `accepted_flags` (flags a moderator approved), `review_reasons`, `return_status`
  (where `unhide` and an approval after `back_to_review` go), `moderation_outcome`, `moderation_note`, `status_reason`,
  timestamps: §13.

---

## 5. Sell wizard (M5)

### 5.1 Who can sell
- A signed-in user (`requireUser`; suspended / blocked refused as everywhere) whose business has **finished onboarding**
  (`onboardingStep = 'done'`: profile and location). Else `409 ONBOARDING_INCOMPLETE` on create and publish. **The
  business's activities are not checked**: a buyer who decides to sell isn't blocked (R5).
- **"GST-verified"** means `gst` is in the business's `verification_levels` (the stored summary F1 writes with every
  grant and revocation).
- **Parts and machines for sale:** GST verification isn't required to publish, but **every listing of an unverified
  business is reviewed** (decision 5), and an unverified business may hold at most **`unverified_listing_cap`**
  (default 3) **open** listings — every status except `draft`, `sold` and `removed` (R36). Publishing or relisting
  beyond it → `409 UNVERIFIED_LISTING_CAP` (`details: { cap }`), and the app shows "Verify your GST to list more" with
  a button to the GST flow (R3). Existing listings stay when GST is later revoked.
- **Machines for rent: GST-verified only** (decision 7). `POST /listings { kind: 'machine_rental' }`, publish and every
  go-live action of a rental listing refuse an unverified business with **`403 RENTAL_NEEDS_GST`**. A rental listing that
  went live while verified stays live after a revocation until its next go-live action; it can always be paused,
  marked rented, edited or removed. The app's Post tab shows the rental card **disabled** with "Verify your GST to list
  rentals" and a "Verify GST" link (opens `gstScreen(state)`); the app learns the state from `GET /businesses/me`.
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
- **Fit step:** fitment rows as removable chips ("Tsudakoma ZW 408 · 2012–2020 ×"); "+ Add machine" opens a sheet:
  brand (machine-making brands, those with models of the listing's machine type first), model (**the same rule as the
  server, §4.3**: models of that brand, those of the listing's machine type first, then a "Other machine types" section,
  plus "Other model…" and "All models"), years from / to, note.
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
  transaction, then its media objects (with a CDN purge, §6.1) (R27).

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
  and the seller confirms; a flag a moderator hasn't accepted sends the listing to review, §5.5):

  | Flag | When |
  |---|---|
  | `price_check` | Part price per unit < ₹5 or > ₹50 lakh; machine price < ₹10 000 or > ₹50 crore; rental **day-equivalent** rate < ₹200 or > ₹5 lakh, where the day-equivalent is the day rate, else hour rate × shift hours, else week rate ÷ 6, else month rate ÷ `month_days` (so week- or month-only rentals are checked too) |
  | `unit_check` | A part listed in a unit flagged `is_machine_unit` |
  | `quantity_check` | Quantity > 100 000 (parts) or > 50 (machines, rentals) |

  Thresholds are constants in shared-types (`SANITY_LIMITS`), so app and API agree; making them settings is later (R17).

### 5.5 Publish and the go-live gate
**The go-live gate** (`goLiveGate(tx, business, listing, action)`) decides every move into `live`: `publish` (from
`draft` or `rejected`), `resume`, `renew`, `relist`, `end_rental`. It returns `live`, or `pending_review` with review
reasons, or refuses. **[Owner decisions 3, 5, 7; Claude R4]**

| Check | publish (draft) | publish (rejected) | relist | resume, renew, end_rental |
|---|---|---|---|---|
| Rental and business not GST-verified → `403 RENTAL_NEEDS_GST` | ✓ | ✓ | ✓ | ✓ |
| Unverified business at the open-listing cap → `409 UNVERIFIED_LISTING_CAP` | ✓ | — (already counted) | ✓ (sold → open) | — (already open) |
| Business not GST-verified → review, `unverified_seller` | ✓ | ✓ | ✓ | — |
| Resubmission → review, `resubmitted` | — | ✓ | — | — |
| Verified business with fewer than **`listing_review_first_n`** (3) listings that **ever went live** (`first_live_at IS NOT NULL`, any status) → review, `first_listings` | ✓ | — | — | — |
| `sanityFlags(listing)` contains a flag not in `accepted_flags` → review, reason = that flag | ✓ | ✓ | ✓ | ✓ |

Resume, renew and end of rental put a listing that was already approved back on view, so they re-check only the rules
that can have changed since (flags after an edit, GST for rentals); relist puts a sold or unavailable listing back on
sale, which is close to a new listing, so it also runs the unverified review and the cap. A gate that answers
`pending_review` on `resume` / `renew` / `relist` / `end_rental` records `return_status = 'live'`.

`POST /listings/:id/publish`, in one transaction **[Claude]**:
1. Lock the **business** row (`FOR NO KEY UPDATE`, as F1), **then** the listing (`FOR UPDATE`); **every lifecycle write
   and every listing PATCH locks in this order**, so publishes, relists and edits of one business serialise and can't
   deadlock. The listing must be the caller's (`404 LISTING_NOT_FOUND` otherwise) and `draft` or `rejected`
   (`409 LISTING_TRANSITION_NOT_ALLOWED`).
2. Onboarding done (`409 ONBOARDING_INCOMPLETE`).
3. **Completeness** (`checkPublishable`): every rule of §4 for the kind, specs with `required`, ≥ 1 photo (unless the
   dev switch, R31), side rules, price or rate. All problems at once: `400 LISTING_INCOMPLETE` with
   `details.problems: [{ field, code }]` (spec errors as `{ field: 'specs.<key>', code }`).
4. **The gate** (above).
5. Write `status`, `review_reasons`, `flags`, `published_at` (first time), `refreshed_at = now()`, `status_changed_at`,
   `first_live_at` (when live and still null); one `listing_status_history` row (actor `seller`).
6. Return the owner view and `outcome: 'live' | 'pending_review'`.

The **Published** screen says "Your listing is live" or "Listing sent for review" ("Our team checks it; you'll see the
result in My listings"), plus "Find the other side" for a left / right part and "List another".

---

## 6. Media

### 6.1 Storage design (public media) (R7, R45)
- **Two R2 buckets.** The existing **private** bucket (`AWS_S3_PRIVATE_BUCKET`) receives every upload under **one key
  format**, `incoming-listing/<businessId>/<listingId>/<uploadId>/<uuid>.<ext>` (F1's
  `incoming-verification/<businessId>/<uploadId>/…` with the listing added); a new **public** bucket
  (`AWS_S3_PUBLIC_BUCKET`) holds the checked files under `listings/<listingId>/<mediaId>/<role>.<ext>` (`role` =
  `full`, `thumb`, `video`, `poster`).
- **Public reads** go through `MEDIA_PUBLIC_BASE_URL`: in production a **custom domain on Cloudflare** connected to the
  public bucket (the domain waits for the brand name, D1); in dev the bucket's `r2.dev` URL, which R2 rate-limits and
  which must not be used in production. URLs are built at read time from stored keys; **the database stores keys only**.
- **Why not upload straight into the public bucket:** an object there is readable the moment it lands, before the
  server has sniffed it. Uploading to the private `incoming-listing/` prefix and copying only checked files keeps
  unchecked bytes off the public domain. R2's CopyObject works across buckets of one account, so no bytes pass through
  the API.
- **Caching and takedown (R45):** copies are written with the **sniffed** `Content-Type` and
  `Cache-Control: public, max-age=86400, s-maxage=31536000` — devices and browsers keep a copy for **1 day**, the
  Cloudflare edge for a year (keys are never reused, so the edge never serves a stale version of a key). **Every media
  deletion** (seller delete, admin delete, draft delete) **purges the deleted URLs from the Cloudflare cache** through
  the API (`POST /zones/<CLOUDFLARE_ZONE_ID>/purge_cache` with `files`, token with *Zone · Cache Purge*), after the
  objects are deleted. Purging is chosen over a short edge TTL because videos and photos are re-read constantly and a
  short TTL would pull them from R2 again and again, while a takedown still has to be immediate; the 1-day device copy
  can't be purged by anyone and is the accepted limit. A failed purge is logged and reported to Sentry; the admin sees
  "Deleted. The CDN copy may take a while to clear." In dev (`r2.dev`, no zone) purging is skipped.
- **Draft media are public by unguessable URL** (UUID keys, never listed anywhere): the preview needs real URLs, and
  promoting files at publish would double the copy work. Drafts are never served by listing endpoints to others. (R7)
- Configured (`isMediaStorageConfigured()`, read on every call) = the five private variables **plus**
  `AWS_S3_PUBLIC_BUCKET` and `MEDIA_PUBLIC_BASE_URL`, **and in production also** `CLOUDFLARE_ZONE_ID` and
  `CLOUDFLARE_API_TOKEN` (a production that can't purge can't take media down). Unconfigured → media endpoints
  `503 STORAGE_UNAVAILABLE` ("Photo upload isn't available yet"); everything else works, and tests pass without keys.

### 6.2 Upload flow (as F1 §6, adapted)
1. `POST /listings/:id/media/presign` with `{ type: 'photo' | 'video', uploadId?, files: [{ role, contentType, size }] }`
   — a photo sends `full` + `thumb`, a video sends `video` + `poster`. Checks: storage configured; the listing is the
   caller's and editable (§7.3); types and sizes (§6.3); **the media count**: photos already attached < 10, videos < 2
   (`409 MEDIA_LIMIT`). Returns `{ uploadId, files: [{ role, key, url, expiresAt }] }`, PUTs signed for 300 s with
   `Content-Type` and `Content-Length` (the existing `presignSignedPut`). **The app presigns each item just before its
   PUTs, and presigns again (same `uploadId`) when it retries**, so a slow queue never meets an expired URL.
2. The app PUTs each file.
3. `POST /listings/:id/media` with `{ type, uploadId, keys: { full, thumb } | { video, poster }, durationMs? }`. Before
   any transaction: every key must match the §6.1 format for **this** business, listing and `uploadId`
   (`400 MEDIA_KEY_INVALID`, checked before storage is touched); **head** each object (missing → `400 MEDIA_MISSING`;
   over its role's cap → `413 MEDIA_TOO_LARGE`); read the first **64 KB** and **sniff** (§6.3, `400 MEDIA_TYPE`) and
   check image metadata (`400 MEDIA_METADATA`, §6.4); copy each to the public bucket. Then one transaction: lock the
   business then the listing, re-check editability and the count (`409 MEDIA_LIMIT`; the lock serialises two concurrent
   attaches), insert the `listing_media` row (next `sort_order`), bump `version`, and `refreshed_at` for a non-draft
   listing. After commit: delete the incoming objects. If the transaction fails: delete the public copies; the incoming
   objects are left for the lifecycle rule. A failed delete is logged, never thrown (F1's `deleteKeys`).
4. **Reorder:** `PUT /listings/:id/media/order { ids }` — the full list of the listing's media ids; the first photo is
   the **cover** (`400 MEDIA_ORDER_INVALID` if the set differs). The app offers "Make cover" and delete on each tile;
   drag-reorder is later (R8).
5. **Delete:** `DELETE /listings/:id/media/:mediaId` — refused when it is the last photo of a non-draft listing
   (`409 MEDIA_LAST_PHOTO`, unless the dev switch); the row is deleted (`version` + 1, `refreshed_at` for a non-draft),
   then the public objects and their CDN URLs after commit.
6. **Leftovers:** an R2 lifecycle rule on the private bucket deletes `incoming-listing/` objects after **1 day** (§6.6).

### 6.3 Limits and checks

| Role | Types (sniffed) | Max bytes | Notes |
|---|---|---|---|
| `full` (photo) | **JPEG only** | **4 MB** (4 194 304) | The app always sends a 1600 px JPEG from the manipulator (~0.3–1 MB) |
| `thumb` (photo) | JPEG only | **1 MB** (1 048 576) | 480 px long edge |
| `video` | MP4 / QuickTime with an allowed `ftyp` brand | **50 MB** (52 428 800) | ≤ 60 s (§6.5) |
| `poster` | JPEG only | **1 MB** | Frame at 1 s, ~720 px |

- **Images:** JPEG magic (`FF D8 FF`) only, because every photo and poster comes out of the manipulator as JPEG (R46).
- **Video:** bytes 4–8 are `ftyp` **and** the major brand (bytes 8–12) is on the allow-list `isom`, `iso2`, `iso4`,
  `iso5`, `iso6`, `mp41`, `mp42`, `avc1`, `M4V `, `qt  `, `3gp4`, `3gp5`, `3gp6`, `3g2a`. `qt  ` → `mov` /
  `video/quicktime`, the rest → `mp4` / `video/mp4`. HEIC (`heic`, `mif1`) and AVIF (`avif`) also use `ftyp` and are
  refused by the list. The stored key's extension and the served type follow the sniff, never the client's claim.
- **Duration:** the app checks it twice (the picker's `duration`, and the compressed file's duration from the
  compressor's `getVideoMetaData`) and sends `durationMs`; the server refuses a missing `durationMs` or one > 60 500
  (`400 VIDEO_TOO_LONG`) and stores it for display. The server doesn't parse the MP4 (the `moov` box can sit at the end
  of the file); the 50 MB cap is the hard limit (R9).
- Per listing: **photos 1–10** (≥ 1 at publish), **videos 0–2** (`LISTING_PHOTOS_MAX`, `LISTING_VIDEOS_MAX` in shared-types).

### 6.4 Photos on the device, and their metadata (R8, R46)
No server image processing (no `sharp`). **Every photo goes through `expo-image-manipulator`**, which writes a new JPEG
without the source's EXIF (so without GPS): a **1600 px** long edge at quality 0.8 (`full`) and a **480 px** long edge
at quality 0.7 (`thumb`). There is **no unresized or raw fallback**: if the manipulator fails, the photo is refused in
the app ("Couldn't prepare this photo. Try another."). Camera or library (`expo-image-picker`, multiple selection up to
the remaining count). **Server check:** a JPEG whose header segments in the first 64 KB contain an `APP1` segment
starting `Exif\0\0` is refused (`400 MEDIA_METADATA`), so a client that skipped the manipulator can't publish GPS.
That the manipulator's output carries no EXIF is **to be confirmed in the build on Android and iOS** (the server check
holds either way).

### 6.5 Video: compression, metadata, cap, poster, playback (R9, R47)
- **Compression on the device:** `react-native-compressor` **2.x** (2.0.6, 2 Nov 2026; needs `react-native-nitro-modules`
  and its Expo config plugin), `Video.compress(uri, { compressionMethod: 'auto', maxSize: 1280, preserveMetadata: false })`,
  turns the picked video into **H.264 MP4, ~720p**, which every Android and iOS player decodes (an iPhone records HEVC
  MOV, a phone camera records 1080p at 15–20 Mbit/s ≈ 110–150 MB a minute). At 720p a 60 s clip is typically 15–30 MB.
- **Location metadata:** the library's README (2.0.6) says the output **keeps the source's metadata, GPS and creation
  date included, by default** (`preserveMetadata: true`), and that `false` leaves it out and still re-encodes small
  files. The app always passes `false`. That the output really has no `©xyz` / location atom is **unverified until the
  build** (check with `ffprobe` or `exiftool` on an Android and an iOS recording made with location on).
- **Cap 50 MB**: 60 s at up to ~6.5 Mbit/s, enough headroom for the compressor's output; it keeps a buyer's playback on
  mobile data reasonable. R2 has no egress fee, so the cap is about the buyer, not cost.
- **Duration ≤ 60 s:** the camera opens with `videoMaxDuration: 60`; any video whose picker or post-compression duration
  is over 60.5 s is refused in the app ("Videos can be up to 60 seconds"); no trimming UI in this build.
- **Poster:** a frame at 1 s from **`expo-video-thumbnails`** (`getThumbnailAsync(uri, { time: 1000 })`, which returns
  a file to upload; it is current for SDK 54 — 10.0.x on npm, not deprecated), then through the manipulator to a JPEG,
  uploaded as `poster` with the video. Cards never show a video; the gallery tile shows the poster with a play badge.
- **Playback:** `expo-video` (`useVideoPlayer(url)` + `VideoView` with native controls) streams the public MP4 by
  progressive download over HTTP range requests (R2 and the CDN serve ranges). The poster shows until the player is
  ready. No server transcoding, no HLS. Admin plays it in an HTML `<video controls poster>`.
- **Uploads** stream from disk with **`createUploadTask` from `expo-file-system/legacy`** (SDK 54's `expo-file-system`
  19 moved the old API there; binary PUT, progress on the tile), rather than reading the file into memory as the GST
  picker does.
- **Without the compressor (R47):** if `react-native-compressor` won't build on SDK 54 / New Architecture, **video
  upload doesn't ship** (photos still do): an unprocessed video would keep its location metadata, and iPhone HEVC MOV
  files won't play on many Android phones. The owner then chooses between accepting both risks (raw upload with the same
  50 MB cap, iOS picker `preferredAssetRepresentationMode: 'compatible'` to get H.264 from the library) or another
  metadata-free path. No other library is substituted without the owner.
- New native modules (`expo-image-manipulator`, `expo-video`, `expo-video-thumbnails`, `react-native-compressor` +
  `react-native-nitro-modules`) need a **new dev build** (`pnpm android`).

### 6.6 What the owner sets (env, R2, Cloudflare)
New variables (`.env.example` documents them, marked for the owner):

| Variable | Value |
|---|---|
| `AWS_S3_PUBLIC_BUCKET` | Name of the new public media bucket, e.g. `mpm-media` |
| `MEDIA_PUBLIC_BASE_URL` | Production: `https://media.<domain>` (custom domain on Cloudflare, once the brand name is settled); dev: `https://pub-<id>.r2.dev` |
| `CLOUDFLARE_ZONE_ID` | The zone of that custom domain (production; required there for takedown purges) |
| `CLOUDFLARE_API_TOKEN` | A token with *Zone · Cache Purge* on that zone only |
| `LISTING_MEDIA_OPTIONAL` | Dev only: `true` lets a listing publish without photos while R2 isn't set up; **ignored when `NODE_ENV=production`** (R31) |

Plus the existing five private-bucket variables. Settings: (1) create the public bucket and connect the custom domain
(or enable `r2.dev` for dev only); (2) a **lifecycle rule on the private bucket**: delete objects with prefix
`incoming-listing/` after 1 day (next to F1's `incoming-verification/` rule); (3) the R2 API token needs **Object Read &
Write on both buckets** (a cross-bucket copy reads one and writes the other); (4) the Cloudflare cache-purge token;
(5) **no CORS**: uploads come from the native app (no browser origin) and public reads are plain GETs from `<img>` /
`<video>`.

---

## 7. Lifecycle (M7)

### 7.1 Statuses
`LISTING_STATUSES` gains **`hidden`** (taken down by a moderator, reversible) and **`expired`** (not refreshed in time)
(R2): `draft · pending_review · rejected · live · paused · reserved · sold · rented · unavailable · expired · hidden ·
removed`.

**Public statuses** (served to anyone, listed later by search): `live`, `reserved`, `rented` ("On rent"). Every other
status is visible only to the owner and admins; anyone else gets `404 LISTING_NOT_FOUND` (R20). **A business is
restricted when its owner user (`member_role = 'owner'`) has status `suspended` or `blocked`**; a restricted business's
listings are not public, whatever their status (status unchanged, so reinstating brings them back). Today every
business has exactly one user, its owner; when team members arrive (P2), suspending a member doesn't hide the
business's listings (R49). One SQL helper (`publicListingWhere`) is the only definition of "public"; a new index on
`users.business_id` keeps its `EXISTS` cheap. **[Claude]**

### 7.2 Transitions (the only ways a status changes)
The table is data in shared-types (`LISTING_TRANSITIONS`, with `listingTransition(from, action, kind)` and
`sellerActions(status, kind)` for the app's buttons); **one service, `listing-lifecycle.service.ts`, is the only writer
of `status`**, and every write locks the business then the listing and runs `UPDATE … WHERE id = $1 AND status = $from`,
with one `listing_status_history` row. **[Scope; Claude]**

| Action | Actor | From | To | Also |
|---|---|---|---|---|
| `publish` | seller | `draft` | `pending_review` or `live` | gate, §5.5 |
| `publish` (resubmit) | seller | `rejected` | `pending_review` | gate (`resubmitted`) |
| `approve` | moderator | `pending_review` | `return_status` if set, else `live` | version must match; `accepted_flags = flags`; clears review reasons and `return_status`; `first_live_at`, `refreshed_at` |
| `ask_for_changes` | moderator | `pending_review` | `rejected` | version; message required; outcome `changes_requested` |
| `reject` | moderator | `pending_review` | `rejected` | version; reason required; outcome `rejected` (R13) |
| `pause` | seller | `live` | `paused` | |
| `resume` | seller | `paused` | `live` or `pending_review` | gate; refresh |
| `renew` | seller | `live`, `expired` | `live` or `pending_review` | gate; refresh ("Still available? Renew") |
| `mark_sold` | seller | `live`, `paused`, `expired`, `unavailable` | `sold` | |
| `mark_unavailable` | seller | `live`, `paused`, `expired` | `unavailable` | optional note |
| `relist` | seller | `sold`, `unavailable` | `live` or `pending_review` | gate (incl. cap and unverified review); refresh |
| `mark_rented` | seller | `live` (`machine_rental` only) | `rented` | |
| `end_rental` | seller | `rented` | `live` or `pending_review` | gate; refresh ("Available again") |
| `remove` | seller | every status but `draft`, `removed` | `removed` | optional reason; terminal |
| (delete) | seller | `draft` | row deleted | §5.3 |
| `expire` | system | `live`, `rented` | `expired` | job, §7.4 |
| `back_to_review` | system | `live`, `rented` | `pending_review` | §7.3; `return_status = from` |
| `hide` | moderator | `live`, `paused`, `expired`, `unavailable`, `sold`, `rented` | `hidden` | reason required; `return_status = from`; resolves open reports as `actioned` |
| `unhide` | moderator | `hidden` | `return_status` | clears it; `refreshed_at` (R14) |
| `remove` (admin) | moderator | every status but `draft`, `removed` | `removed` | reason required; resolves open reports as `actioned`; seller sees it 30 days (§10) |
| `photos_removed` | system (admin deletes the last photo) | `live`, `paused`, `expired`, `unavailable`, `sold`, `rented` | `rejected` | outcome `changes_requested`, note = the delete reason (R52) |
| `reserve` / `unreserve` | system (F7) | `live` ↔ `reserved` | | defined, unused until F7 |

Anything else → `409 LISTING_TRANSITION_NOT_ALLOWED` (`details: { from, action }`), nothing written. A seller can't
touch `hidden` except to remove it.

### 7.3 Edits
- **Editable statuses:** `draft`, `pending_review`, `rejected`, `live`, `paused`, `expired`, `unavailable`, `sold`,
  `rented`. Not `hidden`, `removed`, `reserved` (`409 LISTING_NOT_EDITABLE`). Kind never changes. **Category only in
  `draft` and `rejected`** (`409 CATEGORY_LOCKED`; R43): a new category drops specs, side and fit together, which the
  section-by-section edit of a published listing can't carry; in `rejected` the seller re-runs the wizard from the
  category step and resubmits (full check then). An admin can still change any listing's category (§11.3).
- **`draft` and `rejected`:** loose validation as §4.2 (completeness at publish / resubmit).
- **Every other editable status — grandfathering (R42):** a PATCH checks **only the fields it changes** against the
  current rules; unchanged values and references are accepted as they are, so **catalogue changes never block an
  edit**: a deactivated category, brand, model, unit or condition; a brand whose `makes_parts` / `makes_machines` flag
  changed; a side set before the node's sides were switched off (or `not_applicable` on a node whose sides were switched
  on); a newly required template field; a retired field or option; a rental `available_from` that has passed. Rules per
  changed field: a changed **specs** object is validated whole against the current template with `previousSpecs` (so
  retired values that weren't touched pass, and a newly required field must be filled once specs are edited); a changed
  side must suit the node's current setting; a changed fitment list is validated row by row, except unchanged rows
  (same brand, model, other, years, note) which are grandfathered; quantity can't be set to 0 (Mark sold instead,
  R41); min order ≤ quantity on either change. A change that would remove something required (title, the last photo,
  the price of a priced model, every rate) is refused (`400 LISTING_INCOMPLETE`).
- **Nudges:** the owner view's `needsAttention: [{ field, code }]` lists what today's rules would ask for (e.g. `side` /
  `SIDE_REQUIRED` when a node switched sides on, `specs.<key>` / `required`); the edit menu marks those sections and
  routes the seller there; they never block other edits.
- **Catalogue changes and live listings (defined):** listings under a **deactivated category** stay as they are —
  public, editable (except category), matched; new listings can't pick that node; admins find them with the category
  filter and may hide them in bulk. Left / right listings under a node whose **sides are switched off** keep their side,
  show it, and keep matching (side is the listing's data); new listings there get `not_applicable`; an edit that
  changes the side must set `not_applicable`.
- Every content change bumps `version`; a seller edit of a non-draft listing sets `refreshed_at`; `title_norm`,
  `part_number_norm` and `part_number_base` are recomputed whenever title, part number or side change.
- **Flags on edit (R16):** every non-draft edit recomputes `flags`. For a **public** listing (`live`, `rented`): a flag
  not in `accepted_flags` (reason `edit_flagged`), or a **side or fitment change while the listing has an open report**
  (reason `edited_after_report`), moves it to `pending_review` in the same transaction (`back_to_review`,
  `return_status = from`). For `pending_review`: the reason is added to `review_reasons`. For `rejected`: the
  resubmission is reviewed anyway. For `paused`, `expired`, `unavailable`, `sold`: the flag is stored and **the gate
  catches it when the listing goes live again** (§5.5). So every non-draft editable status is covered. The owner view
  carries `reviewOnEdit: true` while a report is open, and the app warns "Changes to side or fit will be checked by our
  team" without mentioning the report. Price, quantity, photos and other edits go live at once **[Scope M7]**.
- Edits to a `pending_review` listing keep it there (version bumps, so a moderator's stale decision fails, §11.3).

### 7.4 Freshness: expiry and the banner (R11)
- **Expires** when `status` is `live` or `rented` and `refreshed_at < now() − listing_expiry_days` (setting, default
  60). A `rented` listing that nobody touched for 60 days is as stale as a live one. Paused and other statuses wait
  (resume, relist and renew refresh them).
- **"Still available?"**: the owner view returns `expiresAt` (`refreshed_at + listing_expiry_days`, for `live` and
  `rented`) and `expiringSoon` (within `listing_expiry_reminder_days`, default 7); My listings shows the banner and an
  **Expiring soon** chip with one-tap **Renew**. **No reminder job and no `expiry_reminded_at` column in this build**:
  the stamp is only useful to a push, so F9 adds both (R11).
- The settings are read on every run and every read, so **changing them applies at once to every live listing**; the
  settings page shows how many would expire at once (§11.5).
- **Job** (`src/jobs/index.ts`, `JobSpec`): `listing-expiry`, **every hour**, first run after 1 minute; each batch
  selects up to **200** rows `ORDER BY refreshed_at … FOR UPDATE SKIP LOCKED` in one transaction and expires them (status
  + history, actor `system`), up to **10** batches per run. The update keeps `AND status = $from`, so a renew that
  commits first wins. The job function is exported and called directly by tests (jobs don't start in `buildApp`).

### 7.5 History and "notify the seller"
- Every status change writes `listing_status_history` (from, to, action, actor `seller` | `admin` | `system`, user or
  admin id, reason). Admin actions also write `audit_log` (§11.6).
- **Notifications are F9 (R12).** Now: the owner view returns the status, `moderation` (`outcome`, `note`, `at`),
  `statusReason` (hide / remove reason) and `expiresAt`; My listings shows them (review group with the moderator's
  message; a "Hidden by our team" notice with the reason; "Removed by our team" for 30 days). No socket events in this
  build; My listings refetches on focus.

---

## 8. Listing page (M6)

### 8.1 Blocks (in the order of the scope, mockups "Part listing", "Machine listing", "Rental listing")
1. **Gallery:** full-width pager of photos and videos (cover first), "1 / 9" counter, video badge; tap opens the
   full-screen viewer (photos, and videos playing with `expo-video`). Save and share icons are **not shown** (R6).
2. **Tags row:** SideToken + side label (parts with a side), condition chip, quantity "14 pcs"; rentals "For rent",
   operator, year.
3. **Title and price:** price per unit with model and GST note ("₹420 /pc · negotiable · GST extra"), or "Price on
   request"; rentals: rate cards per period (mockup `.rates`) and the terms (§4.5) as a specs list.
4. **Fits** (parts with fitment): machine chips ("Tsudakoma ZW 408 · 2012–2020"), and **Check my machine** (§8.3).
5. **Other side** (parts with `left` / `right`): the mockup's three options row — this listing's side, the
   complementary side ("8 pcs, 18 km" from the **best match of that side**, or "Not listed"), and Pair (the **best pair
   match**, computed separately, or "Not listed"); a line "Right side also available, 8 pcs from <business>, <city>"
   (or "Possibly the other side: …" for a tier-3 match) and **See all** → Other side screen (§9). With no match: "No
   right side listed yet". The "Post a requirement" link waits for F8 (R22).
6. **Specifications:** template fields in template order with labels and units (retired fields still labelled), then
   part number (JetBrains Mono), part brand, reference `#100234`; machines add year, hours, running, inspection.
7. **Delivery and location:** delivery chips, industrial area, city, distance ("2 km away" when known).
8. **Seller card:** business display name (F1 `displayName`), industrial area and city, **GST verified** StatusChip,
   "Member since Nov 2026", live listings count, **View all listings** → seller listings screen. No rating, deals done or
   reply time until M13 / M15 / M10 — they're **left out, not shown as zeros** (R24). Copy never hard-codes the working
   name "MPM" (D1 is open).
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
  **Reported** tab (§11.1) and turn on the edit-goes-to-review rule (§7.3). An admin hide or remove resolves them as
  `actioned` (R51).

### 8.5 Where the page departs from the approved mockup (and why)
The v2 "Part listing" mockup shows segmented tabs (Details · Fits · Reviews · Questions), a quantity picker
("2 of 14 pcs"), a "Top seller" badge, the seller's rating and deals, and save / share buttons. This build uses **one
scrolling page** with the blocks of §8.1: Reviews and Questions don't exist yet (M15, F6) and a tab bar with two real
tabs would hide the specs behind a tap; Fits is a block. **No quantity picker**: it chooses the quantity of an offer
(F6). **No badge, rating or deals** (R24), **no save or share** (R6). The side-options row, the gallery, the seller
card and the FooterBar follow the mockup. When F6 / M15 arrive, the tabs can return as the mockup shows.

---

## 9. Left / Right / Pair matching (M8)

### 9.1 The query: `findOtherSide(listingId, viewer)`
For a public (or own) **part** listing with side `left` or `right` (else an empty result):
- `want = complementarySide(side)`; candidates are **public** part listings, other than this one, with side **`want` or
  `pair`** (scope: "a pair satisfies a need for either side"). The same seller's listings are included (R22).
- **Tier 1 — same part number:** the normalised numbers are equal, **or the side-stripped bases are equal**
  (`TP-200L` on a left listing and `TP-200R` on a right one both have base `TP200`); compared values ≥ 3 characters.
- **Tier 2 — same part by name and fit:** same part group (`category_id`), `similarity(title_norm, :title_norm) ≥ 0.5`
  (`pg_trgm`), and **both have fitment rows that overlap** — they share a machine model (or a brand where either row is
  "all models") with overlapping year ranges (open ends overlap).
- **Tier 3 — possibly the other side:** same part group and name similarity ≥ 0.5, but **one of the two has no fitment
  rows**. Shown, never hidden, but **labelled "Possibly the other side"** and ranked after tiers 1–2: fitment is
  optional and many sellers will skip it, so dropping these would hide most real matches, while the label stops a buyer
  from taking a name match for a fit (R54). Both have fitment but no overlap → not a match.
- `title_norm` = `normalizePartName(title)`: lower-case, punctuation to spaces, **side words removed** (left, right,
  lh, rh, l h, r h, l/h, r/h, लेफ्ट, राइट, बायाँ, दायाँ, ડાબું, જમણું, લેફ્ટ, રાઇટ), spaces collapsed (R38).
- **Ranking:** tier; then exact side before `pair`; then **distance** (`ST_Distance` from the viewer's business point
  when signed in and known, else from this listing's point; nulls last); then `refreshed_at` newest.
- **Result:** `{ complement, best: { [want]: Card | null, pair: Card | null }, counts: { [want]: n, pair: n },
  items: Card[] (≤ 20) }` — `best` and `counts` come from **one query per side** (a `ROW_NUMBER() OVER (PARTITION BY
  side …)` window), so a pair match isn't lost when 20 exact-side matches fill the list. Each card carries `tier` and
  `possible: boolean`.
- `GET /listings/:id/other-side` (public; the owner may call it on a non-public own listing, which is how "Find the other
  side" works from My listings).

### 9.2 Where it shows
- **Listing page:** the Other side block (§8.1 item 5), from `best` and `counts`.
- **Other side screen** ("Right side for this part", mockup "Complementary side"): the pairing header (this side's
  thumbnail + the needed side as SideToken `need`) and the list, tier-3 cards with the "Possibly" label. From My listings
  (the seller holds one side) the line reads **"You have the left side. These sellers have the right one."**; from the
  listing page "Right side for this part". Empty: "No right side listed yet. We'll show it here when one is listed."
  (F8 alerts later.)
- **Published screen:** "Find the other side" for a left or right part.
- **Deferred:** the side **filter** and side words in search (F4), requirement and alert matching on side (F8), home
  side-match strip (M2), mirror numbers, "either", two-seller pair suggestions (P2).

---

## 10. My listings (seller)

- Reached from **Profile** (a "My listings" row with the live count, above Business profile), the **Post** tab ("My
  listings" link under the four choices) and the Published screen. (The M17 dashboard under Deals comes later.)
- **SegmentedControl** with four groups and counts, as the mockup: **Live** (`live`, `reserved`, `rented`), **In
  review** (`pending_review`, `rejected`), **Paused** (`paused`, `expired`, `unavailable`, `hidden`), **Sold** (`sold`).
  Above the control, Card rows: **Drafts (n) · Continue** (the drafts list) and, when there are any, **Removed by our
  team (n)** — listings an admin removed in the last **30 days**, each with the reason, read-only (M19: reasons shown to
  the user) (R50). Listings the seller removed aren't shown.
- **Cards:** the shared ListingCard (thumbnail, title, side, condition, quantity, price) with a StatusChip, "Updated 3
  days ago" or "Expires in 5 days" (`expiringSoon` → `warn` chip), the moderator's message on rejected ones, the top
  score nudge ("Add a video") and a `needsAttention` nudge.
- **Manage sheet** (mockup "Manage a listing"): only the actions `sellerActions(status, kind)` allows, plus **Edit**
  (editable statuses), **Update quantity** (a small sheet) and **Find the other side** (left / right parts). No
  Duplicate (decision 8). Destructive ones (Remove, Mark sold) confirm through `useConfirm`. A "Still available?"
  banner on cards inside the reminder window with **Renew** in one tap. A go-live action that answers
  `pending_review` says "Sent to our team for a quick check".
- **Edit** opens an "Edit listing" menu (ListRows per section, the same step screens in edit mode with **Save**), not the
  linear wizard. Category isn't in the menu of a published listing (R43); a rejected listing's edit starts the wizard.

---

## 11. Admin (AD3)

### 11.1 Moderation queue (`/moderation`, `moderator` + `super_admin`)
Two panes as the mockup "Listing moderation" and the verification page: queue left, review right; URL state
`?tab=&id=`.
- **Review** (`pending_review`, oldest `status_changed_at` first) with pills from `review_reasons`: Unverified seller,
  First listing, Resubmitted, Price check, Unit check, Quantity check, Edited after report, Edit flagged.
- **Reported** (listings in any status but `removed` with ≥ 1 open report, most reports first, then oldest report).
- **Decided** (approve / ask for changes / reject / hide / remove in the last 90 days, newest first).
- Nav badge `moderationWaiting` = Review + Reported counts (`GET /admin/moderation/counts`), polled like
  `verificationWaiting`. Page size 50.

### 11.2 Review screen (shared by `/moderation` and `/listings/[id]`)
Header (cover, title, kind, ref, status, side pill); photos grid with the image lightbox, **loading the `full` image**
(a moderator must see detail, not the 480 px thumbnail); videos (`<video controls poster>`); a specs table (category
breadcrumb, condition, quantity + unit, min order, side + the node's convention, fits, price / rates and terms, part
number, part brand, machine make / model / year / hours / **serial number**, "Other" brand or model texts highlighted);
location (**address line, pincode, map link to the point** — admins see them); delivery; listing score, flags and
accepted flags; **seller panel** (business name linking to `/businesses/:id`, GST status, account status, member since,
listings by status, how many ever went live); open and closed **reports**; **status history**; the actions bar.

### 11.3 Actions
**Version checks (R53):** **approve, ask for changes, reject and edit** take the listing's `version` as loaded; a
mismatch → `409 LISTING_CHANGED` and the page shows the stale warning with Reload (the seller edited meanwhile).
**Hide, unhide, remove and media delete always apply**, whatever the version: they protect buyers and work on what is
there now, as bulk actions do. Status preconditions as §7.2 (`409 LISTING_TRANSITION_NOT_ALLOWED`). Reasons and
messages: `ADMIN_REASON_MIN`–`ADMIN_REASON_MAX` (3–500).

| Action | Endpoint | Notes |
|---|---|---|
| Approve | `POST /admin/listings/:id/approve` `{ version }` | → `return_status` or `live` |
| Ask for changes | `…/ask-for-changes` `{ version, message }` | → `rejected`, outcome `changes_requested` |
| Reject | `…/reject` `{ version, reason }` | → `rejected`, outcome `rejected`; the seller may still fix and resubmit (scope M7); Remove is the final action (R13) |
| Edit category / side / fit | `PATCH /admin/listings/:id` `{ version, categoryId?, side?, fitments? }` | The merged listing must be publishable; a new category is allowed only when the existing specs validate under it (`400 SPECS_INVALID`, R33); edited fitment rows get `source = 'admin'`; norms recomputed; version + 1; status unchanged |
| Hide | `…/hide` `{ reason }` | §7.2; resolves open reports (`actioned`) |
| Unhide | `…/unhide` | back to `return_status`, refreshed |
| Remove | `…/remove` `{ reason }` | terminal; resolves open reports (`actioned`); visible to the seller 30 days |
| Delete a photo or video | `DELETE /admin/listings/:id/media/:mediaId` `{ reason }` | for abusive media; objects deleted and CDN-purged after commit. **Deleting the last photo** of a non-draft listing also moves it to `rejected` (`photos_removed`, outcome `changes_requested`, note = the reason), so no listing is public without a photo and the seller can add one and resubmit (R52) |
| Resolve reports | `POST /admin/listings/:id/reports/resolve` `{ outcome: 'dismissed' \| 'actioned', note? }` | closes **all** open reports of the listing; `409 NO_OPEN_REPORTS` when none |
| Bulk hide / remove | `POST /admin/listings/bulk` `{ action, ids (1–50), reason }` | one transaction per listing, skipped ones reported back (`{ done: [], skipped: [{ id, code }] }`), one audit row per listing (R34) |

### 11.4 All listings (`/listings`, read: `moderator`, `support`; actions: `moderator`)
Server-side paged table (25 / 50 / 100): ref, thumbnail, title, kind, status, category (machine category › type),
city, side, seller, price, updated. Filters in the URL: status (multi), kind, machine category, city, side, flags, has
open reports, **seller (`businessId`)**; search `q` over title, part number (normalised), `#ref` and business name. Row
→ `/listings/[id]` (the review screen). Checkbox selection with bulk Hide / Remove (moderators). The "sold /
unavailable monitor" of A3 is the status filter. **AD2's business page** (`/businesses/:id`) gains a "Listings (n)"
link to `/listings?businessId=<id>`.

### 11.5 Marketplace settings (`/settings`, `super_admin`)
The placeholder page becomes **Settings**, its first section **Marketplace** (§12): a form (React Hook Form + Zod) with
the four settings, their defaults and ranges, Save → `PATCH /admin/settings`. **Lowering the expiry** shows, before
saving, how many live and rented listings would expire on the next job run (`GET /admin/settings/expiry-impact?days=N`
→ count of `live` / `rented` listings with `refreshed_at < now() − N days`), e.g. "214 listings would expire within the
hour". The roles part of AD7 stays a placeholder section. Edit is super-admin only (R30).

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
  | `listing_expiry_days` | 60 | 7–365 | A live or rented listing expires this long after its last update |
  | `listing_expiry_reminder_days` | 7 | 1–30, **less than** the expiry | "Still available?" banner this long before expiry |
  | `listing_review_first_n` | 3 | 0–50 | A **GST-verified** business's first N listings are reviewed (0 = none) |
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
  `title` · `title_norm` · `description` · `part_number` · `part_number_norm` · `part_number_base` · `part_brand_id` →
  brands · `side` · `specs` jsonb default `{}` · `quantity` numeric(14,3) · `unit_id` → units · `min_order_qty`
  numeric(14,3) · `condition_id` → conditions · `condition_note` · `price_model` · `price_paise` bigint · `gst_mode` ·
  `location_source` default `business` · `pincode`, `city`, `state`, `industrial_area_id` → industrial_areas,
  `industrial_area_other`, `address_line` (godown only), `point` geography · `delivery` text[] default `{}` · `flags`
  text[] default `{}` · `accepted_flags` text[] default `{}` · `review_reasons` text[] default `{}` · `return_status`
  (`listing_status`, nullable) · `moderation_outcome`, `moderation_note`, `moderated_at`, `moderated_by` → admin_users ·
  `status_reason` · `version` int default 1 · `published_at`, `first_live_at`, `refreshed_at`, `status_changed_at`,
  `created_at`, `updated_at`.
- **`listing_machines`** (1 : 1, machine kinds): `listing_id` pk → listings · `brand_id` → brands · `brand_other` ·
  `model_id` → machine_models · `model_other` · `year` smallint · `hours_run` int · `serial_number` · `under_power` bool
  · `inspection_by_appointment` bool · `reason_for_sale`.
- **`listing_rentals`** (1 : 1, `machine_rental`): `listing_id` pk · `rate_hour_paise`, `rate_day_paise`,
  `rate_week_paise`, `rate_month_paise` bigint · `shift_hours` smallint default 8 · `month_days` smallint default 26 ·
  `overtime_rate_hour_paise` · `min_duration` smallint · `min_duration_period` · `operator` · `operator_rate_day_paise`
  · `fuel` default `client` · `transport` · `transport_charge_paise` · `service_radius_km` smallint · `deposit_paise` ·
  `available_from` date · `availability_note`.
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
- **Changed:** `units` gains `is_machine_unit` boolean default false (A4 master data: editable on the Units tab; the
  catalogue seed sets it on `machines`, and a data migration sets it on an existing `machines` row); `users` gains an
  index on `business_id`.

No `ON DELETE CASCADE` (as A4): draft deletion and test cleanup delete children first.

### 13.3 Constraints and indexes
- CHECKs (custom migration; drizzle-kit 0.22 can't emit them): quantity > 0 and min order > 0 when set; `price_paise`
  > 0 when set; rental rates and money > 0 when set; `year_from <= year_to`; machine `brand_id` and `brand_other` not
  both, `model_id` and `model_other` not both; fitment `model_id` and `model_other` not both; listing
  `industrial_area_id` and `industrial_area_other` not both; `shift_hours` 1–24; `month_days` 1–31;
  `ALTER SEQUENCE listings_ref_seq RESTART WITH 100001`.
- Partial unique: `reports_one_open_uq` on (`reporter_business_id`, `target_type`, `target_id`) WHERE `status IN
  ('open','reviewing')`.
- Indexes for this build and for F4 later (not search itself): GiST on `listings.point`; (`status`, `kind`,
  `category_id`); (`business_id`, `status`, `updated_at`); (`category_id`) for catalogue guards; `part_number_norm` and
  `part_number_base` WHERE not null; (`status`, `refreshed_at`) for the job; `listing_fitments` (`listing_id`),
  (`model_id`), (`brand_id`); `listing_media` (`listing_id`, `sort_order`); `listing_machines` (`brand_id`),
  (`model_id`); `listing_status_history` (`listing_id`, `created_at`); `reports` (`target_type`, `target_id`,
  `status`); `users` (`business_id`). F4 adds the text-search columns and trigram / full-text indexes.

### 13.4 Shared types (`packages/shared-types`)
`LISTING_STATUSES` (+ `hidden`, `expired`), `PUBLIC_LISTING_STATUSES`, `EDITABLE_LISTING_STATUSES`,
`OPEN_LISTING_STATUSES`, `CATEGORY_EDITABLE_STATUSES`, `DELIVERY_OPTIONS`, `GST_PRICE_MODES`, `RENTAL_OPERATOR_OPTIONS`,
`RENTAL_FUEL_OPTIONS`, `RENTAL_TRANSPORT_OPTIONS`, `LISTING_LOCATION_SOURCES`, `MEDIA_TYPES`, `MEDIA_ROLES`,
`VIDEO_FTYP_BRANDS`, `LISTING_FLAGS`, `REVIEW_REASONS` (+ `unverified_seller`), `MODERATION_OUTCOMES`,
`LISTING_REPORT_REASONS`, `SELLER_LISTING_ACTIONS`, `ADMIN_LISTING_ACTIONS`, `LISTING_TRANSITIONS` +
`listingTransition()` + `sellerActions()`, limits (`LISTING_TITLE_MIN/MAX`, `LISTING_PHOTOS_MAX = 10`,
`LISTING_VIDEOS_MAX = 2`, `LISTING_VIDEO_MAX_MS = 60_500`, `MEDIA_MAX_BYTES` per role, `LISTING_FITMENTS_MAX = 20`,
`LISTING_DRAFTS_MAX = 20`, `REMOVED_BY_TEAM_DAYS = 30`, …), `SANITY_LIMITS`, `APP_SETTINGS`, helpers
`normalizePartNumber`, `partNumberBase`, `normalizePartName`, `rentalDayEquivalent`, `sanityFlags`, `listingScore`,
`checkFit`, and the payload interfaces (`ListingCard`, `ListingDetail`, `ListingOwnerView`, `ListingPatch`,
`ListingMediaItem`, `Fitment`, `MachineDetails`, `RentalTerms`, `OtherSideResult`, `MyListingsView`, `AdminListingRow`,
`AdminListingDetail`, `AdminModerationRow`, `AppSettingsView`).

---

## 14. API

Thin routes (Zod → service → `{ data }`), services under `src/services/listings/` (`listing-write`, `listing-lifecycle`,
`listing-read`, `listing-media`, `other-side`, `listing-reports`, `listing-admin`, `listing-jobs`) and
`src/services/settings.service.ts`.

**Optional user token on public routes (R55):** a new `fastify.optionalUser` preHandler in `plugins/auth.ts` sets
`request.user` when the `Authorization` header carries a valid user token of an **active** user, and otherwise leaves
it unset: no header, a malformed, expired or wrongly-signed token, an admin token, or a suspended / blocked user are all
treated as a **guest**, never `401` / `403`, so a public page never fails because of a stale session. It makes
`isOwner` and the viewer's point known.

**Public:** `GET /listings/:id`, `GET /listings/:id/other-side`, `GET /businesses/:id/listings?limit=&exclude=` (public
listings of one seller, newest first, ≤ 50).

**User (`requireUser`):** `POST /listings` `{ kind }` · `GET /listings/mine?group=live|review|paused|sold|drafts|removed_by_team&page=`
(counts per group + the page) · `GET /listings/:id/owner` (owner view, any status; `removed` only when removed by an
admin within 30 days) · `PATCH /listings/:id` · `DELETE /listings/:id` (drafts) · `POST /listings/:id/publish` ·
`POST /listings/:id/actions` `{ action, note? }` (seller actions of §7.2) · `POST /listings/:id/media/presign` ·
`POST /listings/:id/media` · `PUT /listings/:id/media/order` · `DELETE /listings/:id/media/:mediaId` ·
`POST /listings/:id/reports`.

**Admin:** `GET /admin/moderation/queue?tab=review|reported|decided&page=` · `GET /admin/moderation/counts` ·
`GET /admin/listings?…&businessId=` · `GET /admin/listings/:id` · `PATCH /admin/listings/:id` ·
`POST /admin/listings/:id/approve | ask-for-changes | reject | hide | unhide | remove` ·
`DELETE /admin/listings/:id/media/:mediaId` · `POST /admin/listings/:id/reports/resolve` · `POST /admin/listings/bulk` ·
`GET /admin/settings` · `PATCH /admin/settings` · `GET /admin/settings/expiry-impact?days=`.

**Rate limits** (per signed-in user, 10 minutes, the F1 `perUser` pattern, on top of the global limit) (R39): create
30 · PATCH 240 (autosave) · publish 30 · actions 60 · **media presign 300 · media attach 300** (10 photos and 2 videos
with retries and re-presigns fit easily) · reports 10 per 24 h (table count). Public reads: the global limit.

**Error codes.** There is **no shared error-code list** in this repo (shared-types has only `SPEC_ERROR_CODES`); as in
F1, codes are string literals thrown by the services through `AppError` subclasses, this spec is their list, and the
app maps the ones it handles in one place (`lib/listing-errors.ts`, code → i18n key, built on `lib/api-error.ts`).
`ConflictError` gains an optional `details` argument (today it takes only message and code) for
`LISTING_TRANSITION_NOT_ALLOWED` and `UNVERIFIED_LISTING_CAP`.

| Status | Codes |
|---|---|
| 400 | `KIND_IMMUTABLE`, `FIELD_NOT_FOR_KIND`, `CATEGORY_INVALID`, `SPECS_INVALID`, `SIDE_REQUIRED`, `SIDE_NOT_ALLOWED`, `UNIT_DECIMALS`, `MIN_ORDER_ABOVE_QUANTITY`, `PRICE_REQUIRED`, `RATE_REQUIRED`, `BRAND_INVALID`, `MODEL_INVALID`, `FITMENT_INVALID`, `AREA_MISMATCH` (existing), `LISTING_INCOMPLETE`, `MEDIA_KEY_INVALID`, `MEDIA_MISSING`, `MEDIA_TYPE`, `MEDIA_METADATA`, `MEDIA_ORDER_INVALID`, `VIDEO_TOO_LONG`, `SETTING_INVALID`, `MOVE_NOT_ALLOWED` (existing, a `ValidationError`) |
| 403 | `RENTAL_NEEDS_GST`, `REPORT_OWN_LISTING` |
| 404 | `LISTING_NOT_FOUND` (also for someone else's listing, so ids don't leak existence) |
| 409 | `ONBOARDING_INCOMPLETE`, `DRAFT_LIMIT`, `UNVERIFIED_LISTING_CAP`, `NO_MACHINE_UNIT`, `LISTING_NOT_EDITABLE`, `CATEGORY_LOCKED`, `LISTING_TRANSITION_NOT_ALLOWED`, `LISTING_CHANGED`, `MEDIA_LIMIT`, `MEDIA_LAST_PHOTO`, `REPORT_EXISTS`, `NO_OPEN_REPORTS`, `NODE_IN_USE` and `BRAND_IN_USE` (existing), `MODEL_IN_USE` and `UNIT_IN_USE` (new) |
| 413 | `MEDIA_TOO_LARGE` (existing) |
| 429 | `REPORT_LIMIT` |
| 503 | `STORAGE_UNAVAILABLE` (existing) |

---

## 15. App (Expo)

### 15.1 Navigation (root stack, `navigation/types.ts`)
`Sell: { listingId; step: SellStep; mode?: 'create' | 'edit' }` (one route, pushed per step, so Back works naturally) ·
`SellPublished: { listingId; outcome }` · `ListingEditMenu: { listingId }` · `Listing: { listingId }` ·
`ListingMedia: { listingId; index }` (full-screen viewer) · `OtherSide: { listingId; from: 'listing' | 'mine' }` ·
`MyListings: { group? }` · `MyDrafts` · `RemovedByTeam` · `SellerListings: { businessId }`. The Post tab: "A spare
part" and "A machine for sale" create a draft and push `Sell` step 1; **"A machine for rent" is shown disabled for a
business without GST verification** with the caption "Verify your GST to list rentals" and a "Verify GST" link (a
`403 RENTAL_NEEDS_GST` from the API shows the same); "A requirement" stays "Coming soon".

### 15.2 Components (from the v2 kit, re-skin spec §7) and new ones
Screens use **Card, ListRow, Chip, SegmentedControl, Steps, SideToken, FooterBar, StatusChip, IconButton, Header,
Field, Input, Notice, EmptyState, Skeleton, ConfirmSheet**. New shared components: **ListingCard** (the mockup's
`.listing` row), **ActionSheet** (bottom-sheet list of ListRows, `use-sheet-animation`; the manage sheet and report
reasons), **SideDiagram** (`react-native-svg` port of `sideDiagram()`), **MediaTile** (photo / video tile with progress,
error and retry), **PriceText** (rupees with Indian grouping, per-unit suffix and model). The listing screens start only
after the Periwinkle v2 re-skin's components are merged (the plan, written after approval, will order its batches that
way).

### 15.3 Native modules
`expo-image-manipulator`, `expo-video`, `expo-video-thumbnails`, `react-native-compressor` (+ `react-native-nitro-modules`)
via `npx expo install`, the compressor's config plugin, and the image picker's camera / microphone permission strings in
`app.json`. **A new dev build is required** (`pnpm android`).

### 15.4 Pure, tested helpers (`lib/`)
`sell-wizard.ts` (`wizardSteps`, `nextStep`, `prevStep`, `firstIncompleteStep`, `stepFields`), `money.ts`
(`parseRupees(text)` → paise or null, accepting Hindi / Gujarati digits via `toAsciiDigits`, `,` grouping, up to 2
decimals; `formatRupees(paise)` en-IN grouping ₹1,23,456), `quantity.ts` (parse and format with the unit's decimals),
`listing-format.ts` (price line, rate headline, fits line, distance, "Updated 3 days ago" through `format-date`),
`my-listings.ts` (status → group), `media-prepare.ts` (resize targets, size / duration checks, file naming),
`spec-form.ts` (template field → form control and Yup rule), `listing-errors.ts` (code → i18n key).

### 15.5 Copy, analytics, privacy
- New i18n areas `sell` and `listing` in en / hi / gu; parity and audit tests pass. Enum values sent to the API stay
  English; **all app copy is translated**: price models, rental periods and terms, delivery, side, report reasons,
  statuses, errors.
- **Master-data labels by key, with a fallback:** conditions and units are shown from the app's translations by their
  stable `key` (`listing.condition.<key>`, `listing.unit.<key>`; the seed's keys are translated), falling back to the
  server's label for a key the app doesn't know (an admin-added one).
- **Catalogue names stay as the admin typed them** — category, machine type, part group, brand, model and template
  field names and options — until catalogue translations exist (A4 later). This is the stated exception to the i18n
  anti-goal (§2): it's admin data, not app copy, and brand and model names aren't translated anyway.
- Copy never hard-codes the working name "MPM" (D1).
- `LISTING_EVENTS` in `lib/analytics-events.ts`: `sell_started`, `sell_step_completed`, `sell_media_upload_failed`,
  `listing_published` (`outcome`), `listing_publish_failed` (`reason`), `listing_action_done` (`action`),
  `listing_contact_tapped`, `listing_fit_checked`, `listing_other_side_opened`, `listing_reported`. Ids, kinds and codes
  only — no titles, part numbers, prices or addresses.

---

## 16. Catalogue guards (A4's "M5 adds the check" points)
In the A4 services and the catalogue seed loader, each marked `// M5:` comment becomes a check inside the existing
transaction:
- **Delete node:** refused when any listing (any status, drafts included) has `category_id` in the node's subtree
  (`409 NODE_IN_USE`, with `listings` in the uses list). **Move node:** refused the same way (`400 MOVE_NOT_ALLOWED`,
  the existing `ValidationError`).
- **Delete brand:** refused when a listing references it as part brand, machine make or fitment brand (`409 BRAND_IN_USE`).
- **Move or delete model:** refused when a listing's machine model or a fitment row references it (`409 MODEL_IN_USE`).
- **Lower a unit's decimals:** refused when any listing uses the unit (`409 UNIT_IN_USE`); deactivating stays allowed.
- **Catalogue seed `--reset`** (`clearCatalog` in `db/seed-catalog/load.ts`): refused when **any listing exists**, with a
  message naming the count, since a reset deletes categories, models, units and conditions that listings reference.
- Deactivating any of them stays allowed; existing listings keep working (§7.3 grandfathering; edits on a listing whose
  node was deactivated pass `allowInactive: true` to `validateSpecs`, A4 §5).

---

## 17. Constraints and testing
- Stack and patterns as CLAUDE.md: routes → services, `AppError` codes, Drizzle (raw SQL only for PostGIS and
  `pg_trgm`), migrations via `db:generate` plus `--custom` for CHECKs, the sequence restart and the `is_machine_unit`
  data update, money in paise, PostGIS for every distance, admin RBAC on the API and mirrored in `lib/nav.ts`, every
  admin mutation in `audit_log`.
- API tests against the real test database, cleaning up everything they insert (`deleteTestBusinesses` deletes
  listings and children first). Media tests: the `503` path, key checks, sniffing (including HEIC / AVIF refusal and the
  EXIF check) without R2; round trips `describe.skipIf(!isMediaStorageConfigured())` with "R2 keys not set: media
  round-trip tests skipped"; the CDN purge is a small module tested with a fake HTTP server. Listing fixtures insert
  `listing_media` rows with fake keys directly, so publish and lifecycle tests never need R2.
- The app works on Android first; all copy translated; light and dark. The build checks, on a device, that photos and
  compressed videos carry no location metadata (§6.4, §6.5).
- The build's final report names the variables, R2 and Cloudflare settings of §6.6.

---

## 18. Rulings (Claude's calls; the owner may change any)
Rulings marked *(rev 2)* changed in revision 2.

1. **R1** Kinds keep the built names `part`, `machine`, `machine_rental` (not `machine_sale` / `machine_rent`).
2. **R2** `LISTING_STATUSES` gains `hidden` (moderator take-down) and `expired` (freshness).
3. **R3** *(rev 2)* GST verification isn't required to list parts or machines for sale; **the unverified open-listing
   cap is kept** (`unverified_listing_cap`, 3; scope role table, and it bounds the review queue now that every
   unverified listing is reviewed); rentals need GST (decision 7).
4. **R4** *(rev 2)* One go-live gate (§5.5) on publish, resume, renew, relist and end of rental: rental GST rule; cap on
   publish and relist; `unverified_seller` review on publish, resubmit and relist; `first_listings` for verified
   businesses on first publish; any sanity flag a moderator hasn't accepted.
5. **R5** Selling needs finished onboarding; the business's activities aren't checked.
6. **R6** Enquire / Make offer / Ask price are shown and enabled and answer "Coming soon" (tracked) until F6; save,
   share and "request more photos" are hidden.
7. **R7** *(rev 2)* Public media: uploads into the private bucket under one key format
   (`incoming-listing/<businessId>/<listingId>/<uploadId>/<uuid>.<ext>`), sniffed, copied to a separate public bucket
   served from `MEDIA_PUBLIC_BASE_URL`; draft media are public by unguessable URL.
8. **R8** *(rev 2)* Images are always resized on the device (1600 px + 480 px thumbnail, JPEG); no server image
   processing and no raw fallback; "Make cover" instead of drag-reorder.
9. **R9** *(rev 2)* Videos: compressed on the device to H.264 720p MP4 with `react-native-compressor` 2.x
   (`preserveMetadata: false`), ≤ 50 MB, ≤ 60 s checked after capture and after compression, server-checked by the
   reported duration; poster from `expo-video-thumbnails`; playback with `expo-video` by progressive download.
10. **R10** Settings live in an `app_settings` key / value table with a code registry; no cache.
11. **R11** *(rev 2)* Expiry counts from `refreshed_at` against the current setting; `live` **and `rented`** expire;
    the "Still available?" banner is computed from settings; the reminder-stamping job and its column wait for F9.
12. **R12** No notifications or socket events in this build; My listings shows status, reasons and banners.
13. **R13** Ask for changes and Reject both lead to `rejected` (the seller can fix and resubmit, as M7); they differ in
    outcome and wording; Remove is the final action.
14. **R14** *(rev 2)* Hide is reversible; Unhide restores the stored `return_status` and refreshes the listing.
15. **R15** Reports: generic `reports` table, listing target only; never auto-hide; one open report per business and
    listing; 10 per user per 24 h; not on one's own listing.
16. **R16** *(rev 2)* Every non-draft edit recomputes flags; public listings go back to review on a new flag or on a
    side / fitment change while a report is open; non-public ones are caught by the gate; the seller is warned without
    being told about the report.
17. **R17** *(rev 2)* Sanity thresholds are shared-types constants; rentals are checked on a day-equivalent rate so
    week- or month-only rentals are covered.
18. **R18** Machine make and model: catalogue or "Other" text; fitment rows need a catalogue brand, the model may be
    catalogue, "Other" or "all models".
19. **R19** *(rev 2)* Listing point: the source's pin (business or godown), else the pincode's centroid;
    business-sourced listings follow the business's location changes (version + 1, `refreshed_at` unchanged); buyers
    see area, city and distance only.
20. **R20** Public statuses `live`, `reserved`, `rented`; listings of a restricted business (R49) are not public.
21. **R21** "Check my machine" is an on-device brand / model / year picker answered from seller-declared rows ("Seller
    says it fits" / "Not listed"); the last choice is remembered on the device.
22. **R22** *(rev 2)* Other side: tier 1 equal normalised or side-stripped part numbers; tier 2 same part group, name
    similarity ≥ 0.5 and real fitment overlap; tier 3 the same without fitment on one side, labelled "Possibly";
    pairs count as complements; best match and count per side computed separately; same seller included; distance from
    the viewer's business, else the listing; "Post a requirement" waits for F8.
23. **R23** "Similar parts nearby" waits for F4; "More from this seller" (6) and a seller listings screen instead.
24. **R24** Seller card shows no rating, deals or reply time until those modules exist (not zeros).
25. **R25** *(rev 2)* Rentals: rates per hour / day / week / month (≥ 1), M14 terms as fields **including overtime per
    hour and the month definition (26 days default)**, availability = available-from date + note (no calendar until
    bookings); condition isn't asked; GST-verified businesses only (decision 7).
26. **R26** *(rev 2)* **Cut by owner decision 8**: no duplicate listing in this build (P2).
27. **R27** Drafts are deleted for good (with media and CDN purge); at most 20 per business; no draft purge job.
28. **R28** Part name prefilled with the part group's name, machine title with type + make + model; recent categories
    on the device; title suggestions from other listings wait for F4.
29. **R29** *(rev 2)* My listings: four segments (Live, In review, Paused, Sold) plus Drafts and "Removed by our team"
    rows.
30. **R30** Moderation and listing actions: `moderator`; listings read: + `support`; settings: `super_admin` only.
31. **R31** `LISTING_MEDIA_OPTIONAL=true` (dev only, ignored in production) allows publishing without photos before R2 is set up.
32. **R32** *(rev 2, owner decision 6)* **No virus scanning in this build. Owner's amendment of F1 ruling 11:** scanning
    moves after F2 and must be in place before launch, as **one scanning step for both GST documents and listing media**.
33. **R33** An admin may change a listing's category only when its specs validate under the new node; admin-edited
    fitment rows are marked `admin`.
34. **R34** Bulk hide / remove: up to 50 listings, one reason, one audit row each, skipped ones reported.
35. **R35** Listing reference `#100001…` from a sequence.
36. **R36** "Open" listings for the cap: every status except `draft`, `sold`, `removed`.
37. **R37** *(rev 2)* Fitment years 1950 … next year, open ends allowed; a row with no model means all models of the
    brand; a fitment model may be of any machine type of that brand, in the server and the app picker alike.
38. **R38** Part names are normalised for matching by removing side words in English, Hindi and Gujarati.
    **R38b** The side diagram is drawn only for the default convention; a custom convention shows its text alone.
39. **R39** *(rev 2)* Rate limits as §14 (media presign and attach 300 per 10 minutes; presign just before each upload,
    again on retry).
40. **R40** Media of removed listings stay in storage until DPDP deletion work; admins can delete a single item at once.
41. **R41** Quantity can't be edited to 0; Mark sold instead.
42. **R42** *(new)* Grandfathering: a non-draft edit checks only the fields it changes; catalogue changes never block an
    edit; `needsAttention` nudges and routes instead; deactivated categories and sides switched off are defined (§7.3).
43. **R43** *(new)* Sellers can change the category only in `draft` and `rejected` (`409 CATEGORY_LOCKED`); admins can
    always change it.
44. **R44** *(new)* `return_status` stores where `unhide` and an approval after `back_to_review` go (replaces reading
    history); approval after a gate-triggered review returns to `live`.
45. **R45** *(new)* Caching: 1 day on devices, 1 year at the Cloudflare edge, and a purge by URL on every media
    deletion (`CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`, required in production).
46. **R46** *(new)* Photos and posters: JPEG only, always from the manipulator; the server refuses a JPEG with an EXIF
    segment (`400 MEDIA_METADATA`).
47. **R47** *(new)* Videos only through the compressor with `preserveMetadata: false`; if it can't be built, video
    upload doesn't ship and the owner decides.
48. **R48** *(new)* Machines and rentals use the unit flagged `is_machine_unit` in master data, set by the server.
49. **R49** *(new)* A business is restricted (no public listings) when its **owner** user is suspended or blocked; a
    suspended team member (P2) doesn't hide the business's listings; index on `users.business_id`.
50. **R50** *(new)* Listings removed by an admin stay visible to the seller for 30 days, read-only, with the reason.
51. **R51** *(new)* Admin hide and remove resolve the listing's open reports as `actioned`.
52. **R52** *(new)* An admin deleting a listing's last photo moves it to `rejected` (changes requested, the reason as the
    note).
53. **R53** *(new)* Admin version checks only on approve, ask for changes, reject and edit; hide, unhide, remove and
    media delete always apply.
54. **R54** *(new)* Tier-3 "Possibly the other side" matches are shown with a label rather than dropped.
55. **R55** *(new)* Public routes treat any missing, invalid or expired token, an admin token, or a suspended user as a
    guest (`fastify.optionalUser`), never 401.
56. **R56** *(new)* The settings page shows how many listings a lower expiry would expire at once.

---

## 19. Open items for the owner and the client (don't block building)
- **R2:** public bucket, the `incoming-listing/` lifecycle rule, token access to both buckets (§6.6).
- **Media domain:** production needs a **custom domain on Cloudflare** for `MEDIA_PUBLIC_BASE_URL` (plus the zone id and
  a cache-purge token); it waits for the **brand name (D1)**, so it stays an owner setting. `r2.dev` is for dev only.
- **`react-native-compressor` on SDK 54:** if it won't build, video upload doesn't ship until the owner decides (R47).
- **D3 side convention** and which part groups have sides (A4 seed): the side step and matching depend on them.
- **D4** first-listing review count and the unverified cap (now settings).
- **Virus scanning** for documents and media, after F2 and before launch (decision 6).
- **Data residency** for media (R2 has no India region), as the scope's open question.
- Whether "Reject" should be final (no resubmission) rather than R13.

## 20. Left to the builder
Exact component and file names (the plan, written after this spec is approved, sets the file map), query shapes, the step screens' layout within the v2 kit,
copy wording within the meanings above, the admin review screen's panel layout (following the verification page), and
test layout.

---

## Amendments after plan review (2026-11-18, approved by the owner 2026-11-18)
Found while planning (plan revision 2); they refine the rulings above where they differ, and the plan builds them.

1. **Lock order of the expiry job (§7.2, §7.4).** The rule "every write locks the business then the listing" has one
   exception: the system `expire` transition takes only the listing (`FOR UPDATE SKIP LOCKED` in the job) and relies on
   `UPDATE … WHERE id = $1 AND status = $from`. Taking the business lock after the listing lock would invert the order
   used by seller actions and `setMyLocation`, and two transactions could deadlock.
2. **No photo-less listing goes public (§7.2, §11.3, R52).** R52 covers the last photo deleted from a listing that is
   live, paused, expired, unavailable, sold or rented. For a `hidden` or `pending_review` listing, **approve and unhide
   refuse with `400 LISTING_INCOMPLETE`** (problem `{ field: 'photos', code: 'required' }`) while it has no photo
   (unless the dev switch, R31), so neither can put it on view without one.
3. **When video is off, the API refuses it too (§6.5, R47).** A shared constant `LISTING_VIDEO_UPLOAD_ENABLED` (in
   `packages/shared-types`) is read by the API and the app. When it is `false`, presign and attach with `type: 'video'`
   answer `400 MEDIA_TYPE` and the app offers photos only. It also stays off on iOS in the app until video has been
   verified there.
4. **`return_status` is cleared on reject and ask for changes (§7.2, R44).** Only approve and unhide read it; a
   rejected listing comes back through resubmission, so a stale `return_status` from an earlier back-to-review must not
   survive into a later approval.
