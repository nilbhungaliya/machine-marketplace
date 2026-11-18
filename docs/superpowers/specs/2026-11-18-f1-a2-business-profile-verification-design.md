# F1 + A2 · Business profile, location and GST verification: design

Date: 2026-11-18 · Status: **approved 2026-11-18** (after two review rounds: R2-only storage, items 1–12, items 1–7, and release
refused while a review is open) · Scope IDs: **F1** (app), **A2** (admin), feeds F4/F5 (search by
city and industrial area), F2 (verified badge, later limits) · Spec modules: M1 (onboarding and profile), M19 (trust),
AD2 (users and business verification) in `docs/product-scope.md`.

**Follows textile:** `E:\textile-marketplace\docs\superpowers\specs\2026-11-07-part1-m1-m14-m15-design.md` §3 (M1
verification and business profile; revision 6), and the code it produced: `apps/api/src/services/verification/*`
(`gst-provider.ts`, `gst-stub.ts`, `gst.service.ts`, `gst-proof.service.ts`, `verification.service.ts`), `routes/gst.ts`,
`routes/admin/gst.ts`, `routes/admin/businesses.ts`, `routes/pincodes.ts`, `lib/storage.ts`,
`services/uploads/admin-documents.ts` (`sniffDocument`), `db/seed-locations*` with `infra/seed/pincode-directory.csv.gz`,
the schema tables `gst_checks`, `gst_representative_proofs`, `business_verifications`, `pincode_offices`, the app's
`screens/verification/*`, and `app.config.ts` (maps key handling). Copy their structure, naming, checks and tests; this
document lists what we keep, what we drop, and what is new.

**Labels:** **[Owner]** decided by the owner in this brainstorm (2026-11-18). **[Scope]** from `docs/product-scope.md` or
textile's approved spec. **[Claude]** the author's call, collected in §12 for the owner to check.

---

## 1. Intent

A business on this marketplace needs two things before buying and selling means anything: a **profile** that says who it
is, what it does, which machines it works with and **where it is** (city and industrial area are how textile-machine
buyers in Surat look for parts), and a **verified GST** so the other side can trust it. Today onboarding asks only for a
name and a business name, the Verification and "Users & businesses" admin pages are placeholders, and nothing can be
suspended from the admin panel.

This build makes the profile complete, verifies GST, and gives the team the tools to review exceptions and act on bad
accounts. It comes before listings (F2) because the listing wizard, search by area and the verified badge all read it.

**Success check:** a new user signs in, fills profile and location (industrial area from the Surat list), verifies GST
instantly with the dev stub (code `123456`) and sees the GST badge; an officer suspends the account and the app is
refused on its next request. **The review-path half needs R2 keys** (§6): with them, a user with the provider switched
off submits GSTIN and documents, an officer approves, and the badge appears. Until the owner adds the keys, that half is
**blocked on the keys**; the review form shows "Document upload isn't available yet" and the document endpoints answer
`503 STORAGE_UNAVAILABLE` (tested).

---

## 2. Goals, non-goals, anti-goals

### Goals
- **Business profile** with activities, machine categories (from A4), optional details and a completion meter. **[Owner]**
- **Location:** map pin with "use my location", pincode that fills city and state, **industrial area from an
  admin-managed list** per city, or "Other". **[Owner]**
- **GST verification, instant (path B)** through a GST provider: lookup, "this is my business", declaration, a code
  sent to the GSTIN's **registered** phone or email. **[Owner]**
- **Admin review (path A) as the fallback** whenever the provider can't be used: no API key / no provider, provider
  unreachable, or the business can't receive the registered-contact code. **[Owner]**
- **Documents now:** the review path takes uploaded documents into private storage. **[Owner]**
- **Admin:** Business verification queue; Users & businesses list and detail with suspend / block / reinstate and GST
  revoke; Industrial areas list. Every admin action audit-logged. **[Owner, Scope]**

### Not in this build

| Left out | Comes with |
|---|---|
| Claims on a GSTIN another business holds (textile §3.6, P2 transfers) | Later. Now: "already linked to an account, contact support"; nothing filed **[Owner]** |
| Monthly GST re-checks and auto-downgrade on cancellation (textile §3.7, §3.8 restore rules) | Later, with notifications (F9) **[Owner]** |
| No-GST route: PAN or Udyam (textile §3.5) | Later **[Owner]** |
| Business contact number and consent (textile §3.10) | F6/F7 deals **[Owner]** |
| Limits for unverified businesses (listings, offers) | F2 / F6, which own those limits **[Owner]** |
| Pending-lookup retry job and "we'll notify you" | F9 notifications. Now: "couldn't reach the GST service, try again or send for review" **[Claude]** |
| Choosing the GST provider and writing its adapter | The owner chooses; the adapter is a small task once chosen (§5.1) **[Scope]** |
| Guest browsing with login at the moment of intent (M1 workflow) | M2 discovery; onboarding stays login-first for now **[Claude]** |
| Team members, business photos, public seller page | Later M1 / F2 **[Scope]** |
| Virus scanning of uploads (textile runs ClamAV) | F2's media pipeline, before launch (§6) **[Claude]** |

### Anti-goals: this fails even if it technically works when
- Two businesses hold the same GSTIN, or a GSTIN that isn't active is marked verified by the instant path. **[Scope]**
- A declaration alone grants verification: the instant path needs the registered-contact code, the review path needs an
  officer's approval of documents. **[Scope]**
- A lookup on someone else's GSTIN tells the person anything about the business that holds it. **[Scope]**
- The registered phone or email is shown in full; only a masked hint is ever shown. **[Scope]**
- A suspended or blocked account keeps working on an old token. **[Claude]**
- A document can be read by anyone other than an officer through a short-lived link, or a non-document file is accepted.
  **[Scope]**
- The app shows English text in Hindi or Gujarati mode. **[Scope: i18n parity tests]**

---

## 3. Decisions made with the owner (2026-11-18)

1. Build **B (instant via provider + registered-contact code)** now; **A (admin review) is the fallback** when the API
   key isn't there. A also catches anyone on B who can't receive the code.
2. **Documents now** in the review path (private uploads built in this feature; F2 reuses the storage).
3. Profile, location, industrial-area list, admin pages and the onboarding order as played back (§4, §7, §8). Claims,
   re-checks, PAN/Udyam, contact number and limits are later.
4. Work on `develop` only; spec and plan before code; textile first.

---

## 4. Business profile and location

### 4.1 Profile fields
| Field | Rule |
|---|---|
| Your name | Required, 2–80 (exists on `users.name`) |
| Business name (`trade_name`) | Required, 2–120. **Locked after GST verification**: the shown name becomes GST's trade name, or the legal name when GST has none **[Scope]** |
| What you'll do (`activities`) | Required, one or more of `buy`, `sell`, `rent_out` **[Scope M1]**. Replaces the `role` column (buy/sell/both) **[Claude]** |
| Machines you work with (`categories`) | Required, 1+ **machine categories** (level-1 A4 nodes). Validated on write: active, level 1. Ids of nodes later deactivated or deleted are dropped at read **[Claude]** |
| Email | Optional, valid email |
| Year established | Optional, 1900 – this year |
| Employees | Optional range: `1-10`, `11-50`, `51-200`, `200+` (`EMPLOYEE_RANGES` in shared-types) |
| From GST (read-only) | Legal name, principal address, constitution, registration date, PAN (from the GSTIN) |

**Completion meter, 4 segments [Claude]:** name and business name · activities and machines · location (pincode and
industrial area) · GST verified. Each missing segment shows a prompt that opens its screen.

### 4.2 Location
- **Pincode** (6 digits, `^[1-9]\d{5}$`) looks up the post-office directory and fills **city** (the office's district,
  title-cased) and **state**; both stay editable. Unknown pincode: "We don't know this pincode" and manual entry. **[Scope]**
- **Use my location** (expo-location, foreground permission) sets the **pin**, and the server returns the **nearest
  post office's pincode** (`ST_Distance` over `pincode_offices.point`), which then fills city and state as above. No
  reverse-geocoding service. **[Claude]**
- **Map:** shown only when `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` is set, as textile's `app.config.ts`; without it the
  screen works with the pincode and the location button. The pin can be dragged on the map. **[Scope]**
- **Industrial area:** a searchable list of the **active areas for the pincode's district and state**, plus **Other**
  (free text, 2–80). Stored as `industrial_area_id` or `industrial_area_other`, never both. **[Owner]** The list is keyed
  on the **pincode** (the server resolves its district and state from `pincode_offices`), not on the editable city
  text, so typing "Surat City" over "Surat" doesn't empty it. `PUT /businesses/me/location` rejects an
  `industrial_area_id` whose city and state don't match the pincode's district and state (`400 AREA_MISMATCH`); for an
  unknown pincode only Other is offered. **[Claude]**
- **Address line:** optional free text (plot, street). After GST verification the GST principal address is shown as well.
- Stored point: `businesses.location` (geography Point 4326, exists). Distance only in PostGIS. **[Scope]**

### 4.3 Industrial areas (admin-managed)
- Table `industrial_areas`: name, city, state, active, sort order; unique on (lower(name), lower(city), state).
- **Seed: Surat** (the launch city the owner named): Sachin GIDC, Hojiwala Industrial Estate, Pandesara GIDC,
  Udhna Udyog Nagar, Katargam GIDC, Bhestan, Varachha, Limbayat, Kadodara, Palsana, Kamrej, Kim, Ichchhapor GIDC,
  Olpad. City and state follow the pincode directory's spelling (`Surat`, `Gujarat`). **For the client to check** (§13).
  Seed is insert-only and refuses when the table isn't empty, as A4's loader. **[Claude]**
- **"Other" values:** the admin page lists the distinct `industrial_area_other` texts grouped by the **pincode's
  district and state** (as §4.2 matches areas, not the typed city), with how many businesses typed each, and **Add to
  list**, which creates the area for that district and state and links every business whose pincode resolves to it and
  whose text matches case-insensitively (in one transaction, audit-logged). **[Claude]**
- Deactivating an area hides it from the picker; businesses keep it. An area in use can't be deleted (`AREA_IN_USE`).

### 4.4 Pincode directory
Copy textile's `infra/seed/pincode-directory.csv.gz`, its README (source, licence attribution, the "interim copy,
replace before launch" warning), and the `seed-locations` parser and loader, minus market cities. Script
`db:seed:locations`, insert-only (refuses when `pincode_offices` isn't empty). Businesses store the pincode as text, so
`--reset` is always allowed and only replaces `pincode_offices`. **[Claude]**

---

## 5. GST verification

### 5.1 Provider and modes
A `GstProvider` interface exactly as textile's `gst-provider.ts`: `lookup(gstin)`, `sendContactOtp(gstin)` →
`{ ref, hint }`, `verifyContactOtp(ref, code)`. Only the fields the product uses come back (`GstDetails`: legal name,
trade name, principal address line / city / state / pincode, constitution, nature of business, registration date,
status `active | cancelled | suspended | inactive`). The full provider response is never stored. **[Scope]**

**Mode** (`getGstMode()`, the single switch every route and screen reads) **[Owner: B with A fallback; Claude: mechanics]**:

| Mode | When | Path |
|---|---|---|
| `live` | A provider adapter is registered (`setGstProvider`) **and** `GST_API_KEY` is set | B, with A as fallback |
| `stub` | `NODE_ENV` isn't `production`, and `GST_PROVIDER` is unset or `stub` | B against textile's stub (sample data from any valid GSTIN; fixed GSTINs for cancelled / not found / unavailable; code `123456`) |
| `review` | **Everything else**: production without a working provider, `GST_PROVIDER=off`, or a `GST_PROVIDER` naming a provider whose adapter or key is missing | A only |

**The stub never runs in production**, whatever `GST_PROVIDER` says; any configuration that isn't `live` or `stub` is
`review`. No provider adapter exists yet, so production runs in `review` until one is written. `GET /businesses/me/gst` returns
the mode so the app shows the right flow.

### 5.2 Path B: instant (modes `live`, `stub`)
**Who may start (checked first by lookup, declare and code-send, before any provider call) [Claude]:**
`409 GST_REVIEW_ONLY` when `instantAllowed` is false (§5.5: mode `review`, or the business has ever had an officer
revocation), so a revoked business never makes the provider send a code to the real registered contact;
`409 GST_ALREADY_VERIFIED` when the business has an active GST verification (it changes GSTIN only after an officer
revokes or releases the current one); `409 GST_REVIEW_OPEN` while it has a review `waiting` or `needs_more`.

1. **Enter.** 15-character GSTIN, upper-cased, spaces removed; format and **checksum** checked in the app and on the
   server (textile's `parseGstin`). PAN = characters 3–12, state code = first 2. Invalid: `400 GSTIN_INVALID`.
2. **Look up.** Allowed **5 lookups per business per calendar day in India time** (counted on `gst_checks`, so
   restarts don't reset; `429 GST_LOOKUP_LIMIT`, "Try again tomorrow"), plus the per-user and per-IP route rate limit.
   Every lookup is a `gst_checks` row with its result and its source (the business or an officer). **Only the
   business's own lookups count, and lookups that failed because the provider was unreachable don't**, so an officer's
   lookup at approval or a provider outage never uses up a business's day. **[Claude, from plan review]**
3. **Outcomes:**

| Result | The business sees | Next |
|---|---|---|
| Found, active, unheld | The details card and **Yes, this is my business** | Step 4 |
| Found, not active | "This GSTIN is [status]. Only an active GSTIN can be verified." | Stop |
| Not found | "We couldn't find this GSTIN. Check it and try again." | Stop |
| Held by another business | "This GSTIN is already linked to an account. If it's yours, contact support." Nothing about the other business. **No claim is filed** | Stop **[Owner: claims later]** |
| Provider unreachable | "We couldn't reach the GST service." **Try again** or **Send for review** (path A form, GSTIN prefilled) | Retry or A |

4. **Declare.** "I am the proprietor, partner, director or authorised signatory of this business" (wording versioned,
   recorded with user and time on `gst_representative_proofs`). Never enough on its own. **[Scope]**
5. **Code.** The provider sends a code to the GSTIN's registered contact; the business sees only the masked hint
   ("98•••••36" / "sh•••@gmail.com"). **3 sends per proof, 30 s between sends, 5 wrong tries**, then the proof is spent
   (`GST_OTP_LIMIT`) and a new lookup is needed. **[Scope; Claude: numbers as login OTP]**
6. **Confirm** (on a correct code), in one transaction: lock the business row and an advisory lock on the GSTIN; check
   the check belongs to this business, says `active` and resolved **within 30 minutes**; check no other business holds
   the GSTIN (if one does by now: `409 GSTIN_TAKEN`, nothing granted); check the business has **never had an officer
   revocation** (§5.4; `409 GST_REVIEW_ONLY`); write `gstin`, `legal_name`, trade name, GST address, constitution, registration date, `pan`; insert
   `business_verifications` (`level = gst`, `method = provider_otp`); add `gst` to `verification_levels`; set
   `verification_status = approved`. The business sees "GST verified".
7. **Can't get the code?** A link on the code screen opens the path A form with the lookup attached (§5.3); the officer
   then sees the provider's data beside what the business entered. **Submitting a review closes every open instant
   attempt** (declared or code sent) of that business, and **confirming a code is refused while a review is open**
   (`409 GST_REVIEW_OPEN`), so a code that arrives late can't verify the business while its review waits.
   **[Claude, from plan review]**

### 5.3 Path A: admin review (mode `review`, or the fallbacks above)
**The business submits [Owner: documents now]:**
- GSTIN (format + checksum checked; if held by another business: the same "already linked" message, nothing filed).
- **When no lookup is attached** (mode `review`, or "Send for review" after the provider was unreachable): **legal
  name, principal address, constitution** as the business types them (address prefilled from the profile). With a
  lookup attached ("Can't get the code?"): those come from the lookup and aren't typed. What decides is whether the
  submission carries a lookup, not the mode. **[Claude]**
- The declaration (§5.2 step 4).
- **Documents:** the **GST registration certificate (REG-06)** — required — **and** either an **ID of a person named on
  it** (proprietor, partner, director, authorised signatory) **or an authorisation letter** signed by one. 2–5 files,
  each JPEG, PNG, WebP or PDF, ≤ 10 MB (§6).

**What happens:**
- A business with an **active GST verification can't submit a review** (`409 GST_ALREADY_VERIFIED`), the same rule
  as §5.2's start rule. **[Claude]**
- One open review per business at a time (`409 GST_REVIEW_OPEN`). The business sees **Under review** ("usually within
  one working day; you can keep using the app"). **[Scope M1]**
- The officer (§8.1) **approves**, **rejects with a reason**, or **asks for more** with a message. Ask-for-more puts the
  review in `needs_more`; the business sees the message and adds files (same limits), which sends it back to `waiting`.
- **Approve** is its own transaction, sharing step 6's grant code but **not all its checks** **[Claude]**:

  | Step-6 check | Officer approval |
  |---|---|
  | Lock the business row and the GSTIN advisory lock | **Kept** |
  | No other business holds the GSTIN (`409 GSTIN_TAKEN`) | **Kept** |
  | Lookup resolved within 30 minutes | **Skipped.** Replaced by a **fresh lookup at approval** when a provider is available (mode `live`/`stub`), refused unless `active` (`GST_NOT_ACTIVE`); with no provider, or the provider down, the officer's portal check stands in |
  | Never had an officer revocation | **Skipped**: the officer is the decision; this is how a revoked business gets back |
  | The review is still `waiting` | **Added** (`409 STALE_REVIEW`) |

  Then it writes the GST fields (from the fresh lookup, or as the officer approved them when there is none), inserts
  `business_verifications` with `method = officer_review` and the officer, and sets `verification_status = approved`.
  In review-mode behaviour the officer checks the public GST portal (the page links to it) and can **correct** legal
  name, trade name, address and constitution before approving. **[Owner: A fallback; Claude: mechanics]**
- **Reject:** the business sees the reason and can start again (new submission, new documents). "Start again" opens
  the path §5.4's rule allows: the instant path if the business has never had an officer revocation, otherwise the
  review form.
- **A different GSTIN:** a business may submit a review for a GSTIN other than the one it holds. Because of the rule
  above this only happens when it holds a GSTIN **without** an active verification (after a revocation). Approving it
  **replaces** the held GSTIN; the old one is released in the same transaction and its GST fields overwritten.
  Recorded in `audit_log`. Approval also refuses (`409 GST_ALREADY_VERIFIED`) if the business somehow has an active
  GST verification by then, so there is never an active row to close and the one-active-row rule (§9) holds without a
  "replaced" status. **[Claude]**
- **Provider down at approval** (mode `live`/`stub`, lookup unreachable): the officer isn't blocked. The page says the
  provider couldn't be reached and switches to review-mode behaviour (portal check, editable details); the approval
  records `lookup: unavailable`. **[Claude]**
- **Names in review mode:** the form also has an optional **trade name** (prefilled from the business name), and the
  officer can correct it like the other fields. After approval the shown name follows §4.1's rule. **[Claude]**
- No notifications exist yet: the business sees the result when it next opens Profile or Verification. **[Claude]**

### 5.4 Revocation by an officer
An officer (§8.2) can **revoke** a GST verification with a reason: the `business_verifications` row becomes `revoked`
(who, when, reason), `gst` leaves `verification_levels`, `verification_status = rejected` with the reason, and the
business **keeps its GSTIN** (still unique, so nobody else can take it meanwhile). **Once a business has ever had an
officer revocation, the instant path is closed for it for good**: it can only verify again through path A, so an
officer always decides. The rule reads the history (any `business_verifications` row with `revocation_source =
officer`), never the current state, so no later reject, release or re-approval reopens it. **[Claude]**
Releasing the GSTIN (so another business can verify it) is a separate officer action, "Release GSTIN", with a reason.
Release is refused while the business has a review `waiting` or `needs_more` (`409 GST_REVIEW_OPEN`), so the stored
summary (§5.4a) never says `not_submitted` with a review in the queue.
**[Claude: replaces textile's restriction / lift / restore tools, which depend on re-checks]**

- **Revocation unlocks the business name** (the business can edit it again); the GST fields (legal name, address,
  constitution, registration date, PAN) stay as the record of what was verified. **Release GSTIN** also clears `gstin`,
  those GST fields and `pan`. **[Claude]**

### 5.4a The stored verification summary
`businesses.verification_status` stays the **stored summary** (so the admin list filters on one column), written by the
service in the same transaction as each step; `verification_note` holds the latest officer reason or message:

| Step | `verification_status` | `verification_note` |
|---|---|---|
| Nothing submitted, or a lookup / code in progress | `not_submitted` | unchanged |
| Review submitted, files added after ask-for-more | `pending` | cleared on submit |
| Officer asks for more | `pending` | the officer's message |
| Granted (instant or approved) | `approved` (and `verified_at` = now) | cleared |
| Officer rejects | `rejected` | the reason |
| Officer revokes | `rejected` (and `verified_at` cleared) | the revoke reason |
| Release GSTIN | `not_submitted` (and `verified_at` cleared) | the release reason |

`pending` covers both `under_review` and `needs_more` of §5.5; the admin filter offers those as one "Under review"
value plus the queue's own tabs for the split. **[Claude]**

### 5.5 Business GST state (what the app shows)
`GET /businesses/me/gst` → `{ mode, state, ... }` with `state` one of: `none` · `found` (lookup ready, needs Yes) ·
`code_sent` (hint, resend timer) · `under_review` · `needs_more` (officer message) · `rejected` (reason) · `verified`
(GST details) · `revoked` (reason). Built from the latest check, proof and verification rows, as textile's
`getGstState`, plus `instantAllowed` (false when mode is `review` or the business has ever had an officer revocation),
which decides whether any "start" button opens the instant path or the review form.
- **Stale lookups:** a `found` lookup older than 30 minutes, or a `code_sent` proof whose lookup is, reads as `none`
  with `expired: true` ("Your lookup expired. Look it up again."). Nothing is written; the next lookup counts toward
  the daily limit as usual. **[Claude]**

### 5.6 Audit trail
- Business and system actions live in their own tables (`audit_log` is admin-only): every lookup is a `gst_checks` row;
  declarations, codes, documents and reviews are `gst_representative_proofs` rows; grants and revocations are
  `business_verifications` rows. **[Scope]**
- Officer actions (approve, reject, ask for more, revoke, release GSTIN, suspend, block, reinstate, unblock, document views,
  industrial-area changes) go to `audit_log` with before / after. **[Scope; Claude: document views logged]**

---

## 6. Documents and private storage

- **Storage:** port textile's `lib/storage.ts` (S3 client for R2; every key built by the server; clients never send a
  key or URL) with the **private bucket only** for now (`AWS_S3_PRIVATE_BUCKET`); the public bucket comes with F2.
  `.env.example` gains the storage variables. Without them, uploads answer `503 STORAGE_UNAVAILABLE`. **[Scope]**
- **R2 only, no local storage [Owner]:** no MinIO, no local-folder fallback. Storage reads the R2 variables from `.env`
  (textile's names): `AWS_S3_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`), `AWS_REGION=auto`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_PRIVATE_BUCKET`. `.env.example` lists them with a note that the
  owner fills them in after the build. Storage counts as configured when those five are set (the public-bucket
  variables come with F2). **Without them, the document endpoints answer `503 STORAGE_UNAVAILABLE`** and the app's
  review form shows **"Document upload isn't available yet"** in place of the picker, with submit disabled.
- **Upload flow (as textile):** `POST .../documents/presign` with type and size → a signed PUT (5 minutes) to
  `incoming-verification/<businessId>/<proofId>/<uuid>.<ext>` → the app uploads → the submit call names the keys; the
  server checks each key belongs to this business and proof, **heads** the object (size ≤ 10 MB), **sniffs its first
  bytes** (textile's `sniffDocument`: JPEG, PNG, WebP, PDF only; `400 DOCUMENT_TYPE` otherwise). Then, in this order:
  **copy** each to `verification/<businessId>/<proofId>/<uuid>.<ext>` **before** the database transaction opens,
  **save** the `verification/` keys on the proof (database transaction), and only after that commits **delete** the
  incoming objects. If the save fails, the **copies are deleted** (the lifecycle rule doesn't cover `verification/`)
  and the incoming objects are left for the lifecycle rule; a failed delete is logged. Only `verification/` keys are
  ever stored. **[Claude]**
- **Leftover uploads:** files uploaded but never submitted stay under `incoming-verification/`; an **R2 lifecycle rule
  deletes objects under that prefix after 1 day**. The build's final report names the rule to set. **[Claude]**
- **Reading:** only officers, through a **5-minute presigned GET**, each view audit-logged. Never public.
- **Not now:** virus scanning (ClamAV in textile) arrives with F2's media pipeline and must be in place before launch;
  deleting documents of deleted accounts comes with DPDP deletion. **[Claude]**

---

## 7. App (Expo)

**Onboarding (login-first, as today):** Phone → OTP → **Your business** (name, business name, activities, machine
categories) → **Where are you?** (pincode, location button, map when keyed, industrial area, address line) → **Get
verified** (GST, with **Skip for now**) → tabs. **[Scope M1; Claude: order]** This **changes what was played back**
("→ back to what you were doing"): with login-first onboarding there is no earlier action to return to, so it ends at
the tabs; returning to the interrupted action comes with guest browsing in M2.

- **Required before tabs:** "Your business" (all required fields) and "Where are you?" with **pincode, city, state and
  an industrial area (from the list or Other)**; the pin and address line are optional. GST is skippable and shown once,
  right after location. **[Claude]**
- **Where a returning user lands:** sign-in (and `GET /businesses/me`) returns `onboarding: 'profile' | 'location' |
  'done'`, computed from what's saved; the app opens that step, so someone who quit after "Your business" resumes at
  "Where are you?". `isNewUser` stays for compatibility. **[Claude]**
- `PUT /businesses/me/location` takes pincode, city, state and the industrial area together (all required), plus
  optional pin and address line.

**Profile tab:** business card with the completion meter and GST badge; rows **Business profile**, **Location**, **GST
verification** (status chip from §5.5). Each opens the same screens as onboarding, in edit mode.

**GST screens (one stack, driven by `state` and `mode`):** Enter GSTIN → We found your business (details, Yes / Not
mine) → Declaration → Enter code (masked hint, resend timer, "Can't get the code?") → Verified. Review form (GSTIN,
details when no lookup, declaration, document picker: camera, gallery or PDF) → Under review. Needs more (officer
message, add files). Rejected (reason, Start again). Revoked (reason, review form only).

- Matches the Periwinkle v2 brief (`docs/mockups/user-app-mockup-periwinkle-v2.html`, screens "Business profile",
  "Location and industrial area", "GST verification"), except the mockup's example chips and places: machine chips come
  from A4, places from Surat. The GST screen's "Submit for review" applies to path A only. **[Scope]**
- All copy in en / hi / gu through i18n, parity tests pass. **[Scope]**
- **New native modules:** `expo-document-picker`, `react-native-maps` (and the maps-key config). This needs a **new dev
  build** (`pnpm android`); `expo-location` and `expo-image-picker` are already installed. **[Claude]**
- Forms: Formik + Yup; data: React Query; the GSTIN checksum check shared with the API (`isValidGstin` in shared-types).

---

## 8. Admin panel

### 8.1 Business verification (`/verification`, `verification_officer` + `super_admin`)
- Tabs **Waiting** (oldest first) · **Needs more** · **Decided** (last 90 days); nav badge with the Waiting count.
- Detail: what the business entered beside the provider lookup (when there is one), mismatches highlighted; the
  documents (image lightbox, PDF in a new tab via the presigned link); a link to the public GST portal search; the
  business's previous checks and decisions.
- Actions: **Approve** (with editable legal name, trade name, address and constitution **whenever no lookup is
  attached or the provider is down at approval**, as §5.3), **Reject** (reason
  required), **Ask for more** (message required). Stale double-clicks: the second decision gets `409 STALE_REVIEW`.

### 8.2 Users & businesses (`/businesses`, read: `support`, `verification_officer`, `moderator`; actions below)
- List: search by business name, phone, GSTIN, city, industrial area; filters verification state and account status;
  paged (as A4's tables).
- Detail: profile, location (with map link), activities and machine categories, users (name, phone, status), GST
  history (checks, reviews, verifications), audit entries for this business.
- **Suspend** and **reinstate a suspended user**, reason required: `verification_officer`, `moderator`, `super_admin`.
  **Block** and **unblock**: `super_admin` only. **Revoke GST** and **Release GSTIN**: `verification_officer`,
  `super_admin`. Buttons show only for roles that may use them; `lib/nav.ts` adds `moderator` to `/businesses`.
  **[Claude: roles]**
- **Suspension takes effect at once:** `requireUser` reads the user's status on every request (one primary-key lookup)
  and refuses non-active users with `403 ACCOUNT_SUSPENDED`; the app signs out on that code with the existing message.
  The `/user` socket handshake checks the status too, and suspending or blocking disconnects that user's open sockets.
  Both suspended and blocked refuse sign-in (exists). **[Claude]**

### 8.3 Industrial areas (`/industrial-areas`, `category_manager` + `super_admin`, nav group with Units & conditions)
Create, rename, activate / deactivate, reorder within a city, delete when unused; the "Other" list with Add to list
(§4.3). Same UI kit and patterns as A4's master-data page.

---

## 9. Data model (new migration; never edit 0000–0003)

- **`businesses`:** add `activities` (text[] of `BUSINESS_ACTIVITIES`, not empty), `email`, `year_established`,
  `employees` (enum of `EMPLOYEE_RANGES`), `industrial_area_id` (FK `industrial_areas`), `industrial_area_other`,
  `constitution`, `gst_registered_on` (date), `gst_address` (jsonb: line, city, state, pincode); drop `role` and the
  `industrial_area` text column (dev data only; values are mapped: buy → [buy], sell → [sell], both → [buy, sell]).
  CHECK: not both `industrial_area_id` and `industrial_area_other`. `gstin` stays unique. Index on
  (`city`, `industrial_area_id`). **[Claude]**
- **`businesses` columns that already exist** (checked against `apps/api/src/db/schema.ts` on 2026-11-18) and are
  written as they are, with no migration change: `legal_name`, `trade_name`, `gstin` (unique), `pan`, `address_line`,
  `city`, `state`, `pincode`, `location` (geography), `categories` (jsonb), `verification_levels` (jsonb, default
  `['phone']`), `verification_status` (enum `not_submitted | pending | approved | rejected`), `verification_note`,
  `verified_at`. The plan re-checks this list against `schema.ts` before generating the migration.
- **`industrial_areas`** (§4.3). **`pincode_offices`** as textile (one row per office, `point` geography, index on
  pincode, GiST on point).
- **`gst_checks`** as textile minus `attempts` / `next_attempt_at` / `counts_toward_limit` (no retry job).
- **`gst_representative_proofs`** as textile, with `status` `declared | code_sent | passed | waiting | needs_more |
  approved | rejected | spent`, `method` `provider_otp | documents`, `check_id` **nullable** (no lookup attached),
  plus `entered` jsonb (what the business typed when no lookup is attached), `gstin` (the GSTIN reviewed, so a review
  can be for a different GSTIN than the one held) and `officer_message`. Documents as
  `[{ key, type: 'gst_certificate' | 'id_proof' | 'authorisation_letter' }]`.
- **`business_verifications`** as textile: `level`, `method` (`provider_otp | officer_review`), `status`
  `active | revoked`, verified / revoked by and when, revoke reason, `revocation_source` (`officer` only for now),
  `verified_by_proof_id`; one active row per (business, level).
- Shared types: `BUSINESS_ACTIVITIES`, `EMPLOYEE_RANGES`, `GST_MODES`, `GST_STATES`, `GST_STATUSES`, `GstDetails`,
  `isValidGstin`, document types, error codes; `BUSINESS_ROLES` removed.

---

## 10. API

**App (user JWT, owner):** `GET/PATCH /businesses/me` (profile), `PUT /businesses/me/location`;
`GET /businesses/me/gst`, `POST /businesses/me/gst/lookup`, `/declare`, `/otp/send`, `/otp/verify`,
`/documents/presign`, `/review` (submit path A, with or without a check), `/review/files` (add files on `needs_more`).
**Public:** `GET /locations/pincodes/:pincode`, `GET /locations/nearest-pincode?lat=&lng=`,
`GET /locations/industrial-areas?pincode=` (areas for the pincode's district and state, §4.2).
**Admin:** `GET /admin/verification/reviews?status=`, `GET /admin/verification/reviews/:id`,
`POST .../:id/approve | reject | ask-for-more`, `GET /admin/verification/documents/:proofId/:index/url`;
`GET /admin/businesses`, `GET /admin/businesses/:id`, `POST /admin/users/:id/suspend | block | reinstate | unblock`
(**`reinstate` only lifts a suspension** and refuses a blocked user with `409 USER_BLOCKED`; **`unblock`** is
super-admin-only and lifts a block; each refuses a user not in the matching state),
`POST /admin/businesses/:id/gst/revoke | release`; `GET/POST/PATCH/DELETE /admin/industrial-areas`,
`GET /admin/industrial-areas/other`, `POST /admin/industrial-areas/other/adopt`.

Routes stay thin (Zod → service → `{ data }`); errors are `AppError` codes listed in §9's shared types; unique and
concurrency failures map to 409 as in A4 (`pg-errors.ts`).

---

## 11. Constraints
- Stack and patterns as `CLAUDE.md`: Fastify + Drizzle + Zod, migrations via `db:generate`, money not involved, PostGIS
  for every distance, admin RBAC on the API and mirrored in `lib/nav.ts`, every admin mutation in `audit_log`.
- Tests leave the database as they found it; GST tests run against the stub with `setStubGstin` overrides. **Storage
  tests run against R2 when the keys are set and are skipped with a clear message when they aren't**; the
  `503 STORAGE_UNAVAILABLE` path and everything up to the upload (key building, ownership checks, `sniffDocument`) are
  tested without R2.
- No secrets in the repo; `.env.example` documents `GST_PROVIDER`, `GST_API_KEY` and the R2 variables (§6), marked for
  the owner to fill in.
- **The build's final report names** the exact variables to set and the R2 bucket settings the app's direct uploads
  need (CORS, if any client needs it; the `incoming-verification/` 1-day lifecycle rule; private access only).
- The app works on Android first; all copy translated.

---

## 12. Calls made by Claude (check these)
1. `activities` (buy / sell / rent_out, multi) replaces the `role` column.
2. Machine categories stay a jsonb id list on `businesses`, validated on write, filtered at read (no join table).
3. Completion meter: 4 segments (§4.1).
4. "Use my location" finds the nearest post office's pincode in our own data; no Google geocoding. Map only with a key.
5. Surat industrial-area seed list (§4.3) and "Add to list" relinking businesses that typed the same "Other".
6. Mode switch `live / stub / review` with `GST_PROVIDER=off` to try path A locally; the stub never runs in production;
   anything not `live` or `stub` is `review`, so production stays in `review` until a provider adapter exists.
7. Provider unreachable → "Try again" or "Send for review", no background retry.
8. Lookup limit 5/day; code limits 3 sends, 30 s, 5 tries; confirm within 30 minutes of the lookup.
9. With no lookup attached the officer can correct GST details before approving; what's saved is what the officer
   approved. Officer approval skips step 6's 30-minute and revocation checks (§5.3 table).
10. Any officer revocation closes the instant path for that business for good (read from history, not state); GSTIN
    kept until an officer releases it or approves a different one (replaces textile's restriction / lift / restore).
11. **[Owner]** R2 only. No local storage. The owner adds the keys after the build. No virus scanning until F2 (must
    land before launch). Uploads land under `incoming-verification/` and are copied on submit; a 1-day lifecycle rule
    clears the rest.
12. Document views audit-logged.
13. Roles: suspend / reinstate by verification officer, moderator, super admin; **block / unblock by super admin
    only**; revoke and release GST by verification officer, super admin; industrial areas by category manager.
14. `requireUser` checks account status on every request, so suspension is immediate.
15. Onboarding stays login-first and ends at the tabs (a change from the played-back "back to what you were doing");
    guest browsing and returning to the action come with M2.
16. City from the pincode directory's district name.
17. Review-mode form and officer edit include an optional trade name.
18. Revocation unlocks the business name and keeps the GST fields; Release GSTIN clears them.
19. `verification_status` stays a stored summary with the table in §5.4a.
20. Location (pincode, city, state, industrial area) is required before tabs; sign-in returns the onboarding step.
21. Provider down at approval → officer approves with review-mode behaviour, recorded.
22. Block / unblock by super admin only; suspend / reinstate by officer, moderator, super admin.
23. Suspension also refuses socket handshakes and disconnects open sockets.
24. The industrial-area list is keyed on the pincode's district and state; a mismatched area is refused.
25. A `found` lookup older than 30 minutes reads as `none` with `expired: true`.
26. Separate `reinstate` (suspension) and `unblock` (super admin) endpoints.
27. A review may be for a different GSTIN; approving it replaces and releases the held one.
28. A verified business can't look up, declare, send codes or submit a review (`409 GST_ALREADY_VERIFIED`) until an
    officer revokes or releases its GSTIN; a business without the instant path is refused at lookup, declare and
    code-send (`409 GST_REVIEW_ONLY`), not only at confirm.
29. `verified_at` set on grant, cleared on revoke and release.
30. Documents: copy, save keys, then delete the uploads; failures leave uploads for the lifecycle rule.

---

## 13. Open items for the client (don't block building)
- **GST provider** (must support a code to the GSTIN's registered contact); until then production verifies by review.
- **Surat industrial-area list:** correct names, missing estates, and which belong to Surat city vs district.
- **Google Maps key** for the map on Android (optional; the screen works without it).
- **R2 account and private bucket** before the first real upload.
- Replace the interim pincode file with the official data.gov.in download before launch (textile's README).

## 14. Left to the builder
Exact component and file names, query shapes, test layout, the masked-hint format, copy wording within the meanings
above, and how the admin detail page lays out its panels (following A4's pages and the v2 brief).
