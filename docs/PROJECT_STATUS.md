# Project status

Current state of the Machine Parts & Machinery Marketplace. Update the sections below and add a line to the session
log whenever a session changes the project's state.

## What's built

**Base setup + A4 machine catalogue + F1 business profile + A2 business verification (2026-11-18, on `develop`).** The
admin-managed catalogue is built and seeded; businesses complete a profile with a pincode location and an industrial area
and verify their GST (instant through a provider, or officer review with documents); admins run the verification queue,
users & businesses and industrial areas. The app and the admin wear the approved **Periwinkle v2** design (re-skin,
2026-11-18). **F2 + F3 + A3 listings (2026-11-19):** sellers list parts, machines for sale and machines for rent with
photos, preview and publish; buyers see the listing page and the Left / Right "other side"; sellers manage My listings;
admins moderate, browse all listings and set marketplace settings. **F4 + F5 discovery (2026-11-19):** guests and
users search (query reader with part numbers, side words in en / hi / gu, brand / model / category chips, synonyms,
typos), filter, sort, browse the catalogue with live counts, see Home near them and save listings; admins manage search
synonyms and read search insights. **F6 + F7 enquiries, chat, offers, deals and reviews (2026-11-19/20):** buyers
enquire and chat (text and photos), with phone numbers masked until there is a deal and both sides tick "Share my
number"; they offer, counter, buy at the asking price or answer a seller's quote; an accepted offer becomes a shared deal
that holds the stock and runs handed over → received (or auto-completes), with cancels, disputes for support and blind
reviews; in-app notifications and FCM push (opt-in). Admins see enquiries, deals, disputes, conversations and reports.
Part requests (F8), rental bookings (M14) and the other admin modules are still to come.

| Area | State |
|---|---|
| Monorepo | pnpm 11 workspace: `apps/api`, `apps/admin`, `apps/user-app`, `packages/shared-types` |
| API | Fastify 4 + Drizzle + Zod; `{ data }` / `{ error, code }` shapes; Redis rate limits; Sentry (opt-in); Socket.IO `/user` + `/admin`; job runner with graceful shutdown |
| Auth | Admin email + password + JWT, 6 roles; user phone OTP (outside production the code is returned in the send response as `devCode`; MSG91 not wired) + JWT; onboarding creates the business; suspended/blocked accounts refused (`ACCOUNT_SUSPENDED`) at sign-in, on the very next API request (status read from the row on every request) and on socket connect |
| Database | `admin_users`, `businesses` (trade/legal name, activities, categories, email, year, employees, GST fields, address, `industrial_area_id` or `industrial_area_other` — exactly one, CHECK —, city, state, pincode, PostGIS `location`, `verification_levels`, verification status), `users` (status), `audit_log`; catalogue (migrations 0002, 0003): `categories` (machine category › machine type › part group, `has_sides` / `side_convention` inherited), `template_fields` (`applies_to` parts/machines/both) + `template_field_options`, `brands`, `machine_models` (unique per brand + type, case-insensitive), `units`, `conditions`; F1 + A2 (migrations 0004–0007): `pincode_offices` (India Post directory, 156 932 offices / 19 300 pincodes), `industrial_areas` (unique name + city + state, case-insensitive), `gst_checks` (every lookup: business or officer), `gst_representative_proofs` (declaration → code or documents; one open review per business), `business_verifications` (grants and revocations, one active per business + level); F2 (migrations 0008, 0009 custom
checks): `listings` (kind part / machine / machine_rental, status, side, price, quantity, location point, review reasons,
version), `listing_machines`, `listing_rentals`, `listing_fitments`, `listing_media`, `listing_status_history`,
`reports`, `app_settings` (marketplace settings registry); `units.is_machine_unit`; F4 + F5 (migrations 0010, 0011
custom: synonym checks and unique key, SQL normaliser twin `mpm_normalize_search`): `listings` search columns (`search_text`, `search_title_text`,
`search_point`, `search_refreshed_at`), `search_synonyms`, `search_queries` (anonymous log, 90 days),
`search_trending_hidden`, `saved_listings`, `search_refresh_jobs`; `brands.chip_needs_context`; F6 + F7 (migrations
0012, 0013 custom: CHECKs, F2's quantity CHECK relaxed to allow 0, deal reference sequence from #500001, append-only
consent trigger): `chat_threads`, `chat_messages`, `chat_thread_user_state`, `business_blocks`, `contact_share_consents`,
`offers`, `stock_holds`, `deals`, `deal_events`, `deal_disputes`, `deal_reviews`, `notifications`,
`notification_deliveries`, `user_devices`, `idempotency_keys`; `listings.held_quantity`, `businesses.contact_phone*`,
`users.push_enabled`; `report_target` gains `review` |
| Discovery (F4 + F5) | Spec `docs/superpowers/specs/2026-11-19-f4-f5-discovery-design.md` (three owner reviews + amendments: radius margin 3 km, count at its own path, additive word synonyms `wordGroups`, brand view `allCount` + `brandId` filter), plan `docs/superpowers/plans/2026-11-19-f4-f5-discovery.md` (batches B0–B7). **API:** `POST /discover/search` (query reader: `#ref` redirect, bare-ref suggestion, synonym phrases, brand / model / category chips, part numbers, side words, stop words; full → partial → widen; filters incl. fit, place, price, quantity, seller, specs; sorts best match / nearest / newest / price / year / hours with Left-before-Pair and available-before-rented tiers; disjunctive facets on page 1; sealed AES-GCM cursor), `POST /discover/search/count`, `GET /discover/suggest`, `GET /discover/trending`, `POST /discover/home`, `/discover/browse`, `/discover/browse/brand`, `/discover/cards`; `GET/PUT/DELETE /users/me/saved-listings`; `GET /categories?depth=1`; origin (GPS point with fallback, pincode, business; snapped, never echoed as coordinates); PostGIS distance shared with F2's other side; rate limits per user / `X-Install-Id` plus a per-IP cap; search text refreshed in every listing write's transaction and by the `search-refresh` job after catalogue renames; `search-query-retention` job; search log skips phone / Aadhaar / email / GSTIN / PAN shapes. **Admin API + pages** (Catalogue, `category_manager`): Search synonyms (list, add / edit / delete, "Try a search" preview), Search insights (zero-result searches with "Make a synonym", trending with Hide / Unhide), brand "ordinary word" flag (`chip_needs_context`); every mutation audit-logged, reader cache sees changes within 5 s. **App:** guest browsing ("Browse first", sign-in sheet at the moment of intent, pending Save after sign-in), location (GPS / business / pincode, radius 10–200 km or All India), Home (location chip, kind and category tiles, Top items near you, Machines for rent nearby, Recently viewed), Search tab (Browse with counts, popular brands → brand view, recent and trending searches, suggestions), Results (chips, filter row, partial banner with widen, sort sheet, infinite scroll), Filters (live count footer), No results, Saved (Profile row), hearts on every card. Seeds: `db:seed:search` (102 synonyms incl. side words in en / hi / gu, 44 stop words), `db:backfill:search` |
| Enquiries, chat, offers, deals, reviews (F6 + F7, A5, part of A6 and F9) | Spec `docs/superpowers/specs/2026-11-19-f6-f7-enquiries-chat-offers-deals-design.md` (rulings R1–R26, review changes §27, build changes §28), plan `docs/superpowers/plans/2026-11-19-f6-f7-enquiries-chat-offers-deals.md` (C0, C1 contracts, then wave A API lanes L1–L4 and wave B lanes L5–L8 in worktrees, then Batch I). **API:** `POST /listings/:id/enquiry`; threads (`GET /threads` inbox with All / Buying / Selling / Your turn and archive, `GET /threads/:id`, messages with photos: presign → private `incoming-chat/` → re-encoded with `sharp`, no EXIF / GPS; read, archive, `share-contact`, report, block; `GET/DELETE /users/me/blocks`); masking of phones and emails (Latin, Devanagari and Gujarati digits) per reader until the reveal, never for a `viewer`; scam warning; business contact number with OTP (`/businesses/me/contact-phone`); offers (`POST /listings/:id/offers` offer or buy now, `POST /threads/:id/quote`, accept / counter / reject / withdraw / reconfirm, `GET /offers/options`): counter bounds, 5 rounds, open-negotiation limit 3 unverified / 20 verified, backups and revive with reconfirm; stock holds (`listings.held_quantity`, `syncReservation`: reserved when fully held, available quantity in discovery and the listing page); deals (`GET /deals` tabs, `GET /deals/:id` Deal record with the number after both ticks, notes with a version, hand over with photo, confirm received, cancel and cancel requests, report a problem → dispute); reviews (`POST /deals/:id/review` blind, reply, report, `GET /businesses/:id/reviews`, `GET /users/me/reviews`, scores after 3); notifications (`GET /notifications`, unread count, read, read all, push preference, `PUT /users/me/language`, `PUT/DELETE /users/me/devices`, `GET /users/me/badges`); `Idempotency-Key` on every money and deal write; after-commit socket emits (`runTx`), per-reader `message:` / `offer:` / `thread:` / `deal:` / `notification:` events; jobs `offer-expiry`, `offer-expiring-soon`, `deal-auto-complete`, `deal-agreed-reminder`, `review-publish`, `notification-push`, `notification-retention`, `idempotency-cleanup`; owner suspension and blocks close chains, deals continue; 15 settings in the registry (§17). **Admin API + pages:** Enquiries & offers (`support`, `operations`), Deals (list + detail), Disputes (queue with nav badge, resolve completed / cancelled with stock returned or not / resumed; `support`), Conversations (read only with a reason, from an open or recent report or dispute, audit-logged), Reports & flags (conversations and reviews; hide / unhide a review or reply), business detail with deal history and seller score, F6 settings section; every mutation audit-logged. **App:** Enquire sheet (quick options, Will it fit my machine?), Chats tab (inbox, filters, Your turn), Thread (messages, photos, offer cards, system lines, scam warning, menu: share my number, report, block, archive), offer sheets (offer, counter, quote, buy at this price), listing page buttons with guest pending Enquire / Offer, Deals tab and Deal record (timeline, notes, hand over, received, cancel, report a problem, contact block), reviews (rate a deal, seller reviews, My reviews), bell + Notifications list and settings, push explainer and registration (`expo-notifications`, Android), blocked businesses, contact number, My listings with holds. **Push is opt-in:** without `FIREBASE_SERVICE_ACCOUNT_B64` pushes are recorded `sent_dev` outside production and `skipped` in production; in-app rows work either way |
| Business profile (F1) + verification (A2) | Spec `docs/superpowers/specs/2026-11-18-f1-a2-business-profile-verification-design.md`, plan `docs/superpowers/plans/2026-11-18-f1-a2-business-profile-verification.md`. **API:** `GET/PATCH /businesses/me`, `PUT /businesses/me/location` (pincode + listed area or "Other", optional pin); public `GET /locations/pincodes/:pincode`, `/locations/nearest-pincode`, `/locations/industrial-areas?pincode=`; GST under `/businesses/me/gst` (state, lookup, declare, `otp/send`, `otp/verify`, `review`, `review/files`, `documents/presign`), one switch `getGstMode()` (`stub` in dev, `live` with a provider adapter + key, `review` otherwise or with `GST_PROVIDER=off`); R2-only private storage (`lib/storage.ts`, `503 STORAGE_UNAVAILABLE` when unset, uploads sniffed for JPEG/PNG/WebP/PDF); admin `/admin/verification/*` (queue, waiting count, detail, approve / reject / ask for more, 300 s document links), `/admin/businesses` (list, detail, revoke / release GST), `/admin/users/:id/suspend\|reinstate\|block\|unblock`, `/admin/industrial-areas` (CRUD, reorder, "Other" list and adopt); every mutation audit-logged. **Admin pages:** Business verification, Users & businesses (list + detail), Industrial areas. **App:** onboarding Your business (activities, machine categories) → Where are you? (pincode, area picker with Other, optional map pin), gating until done; GST intro → GSTIN → found → declaration → code (instant), or the review form with document picker; GST status and a completed Profile. Seeds: `db:seed:locations` (pincode directory), `db:seed:industrial-areas` (14 Surat areas); both refuse to run on a filled table |
| Catalogue (A4) | Spec `docs/superpowers/specs/2026-11-18-a4-machine-catalogue-design.md`, plan `docs/superpowers/plans/2026-11-18-a4-machine-catalogue.md`. Public API: `GET /categories`, `/categories/:id/template?kind=part\|machine`, `/brands`, `/models`, `/master-data`; admin APIs for nodes (create, edit, side settings, move with root locks and clash checks, reorder, delete), fields and options, brands and models, units and conditions, CSV export (`/admin/catalog/export/:sheet`); `validateSpecs` service for M5. Admin pages: Categories & machine types, Specifications & fields, Brands, models & fit, Units, conditions & sides. Seed (`pnpm --filter @mpm/api db:seed:catalog`, loaded into dev 2026-11-18): Fibre2Fashion Machinery's 465 product types cleaned into 10 categories, 248 machine types, 331 part groups; embroidery and water-jet looms in full (81 fields); 14 brands and 19 models marked "needs review"; 8 units, 4 conditions. **`--reset` deletes the whole catalogue including admin edits: use only before go-live.** |
| Listings (F2 + F3 + A3) | Spec `docs/superpowers/specs/2026-11-18-f2-f3-listings-design.md` (amendments 1–5), plan `docs/superpowers/plans/2026-11-18-f2-f3-listings.md`; built as C0 contracts + six parallel lanes (worktrees, merged into `develop`). **API:** seller `POST/PATCH/DELETE /listings`, publish with the go-live gate (photos, specs, side, GST for rentals, unverified-seller cap; review reasons `first_listings`, `unverified_seller`, sanity flags, `edited_after_report`), seller actions (pause, resume, renew, sold, unavailable, rented, end rental, relist, remove), `GET /listings/:id` (guest or owner view; private fields never public), seller listings, My listings, reports, `GET /listings/:id/other-side` (tiers: part number, fit overlap, similar name; PostGIS distance); media: presign → PUT to a private `incoming-listing/` key → attach (JPEG sniffed, EXIF / XMP / other APPn refused, size and duration rechecked, copied to the public bucket only if unchanged since the check), delete with CDN purge; `GET /categories/:id/template?includeRetired=1`; hourly expiry job (`FOR UPDATE SKIP LOCKED`, per-row savepoint). **Admin API + pages:** Listing moderation (queue, counts, review screen with stale-version guard, approve / ask for changes / reject / hide / unhide / remove, media delete with reason, resolve reports), All listings (filters, bulk hide / remove), listing detail, Settings (expiry, reminders, caps, expiry impact), Machine unit switch, "Listings (n)" on a business; every mutation audit-logged. **App:** Post tab → sell wizard per kind (category, details, machine, quantity, fit, side with diagram, photos, price, rates, location, preview, publish, Published), drafts, listing page (media viewer, Check my machine, report, seller's listings, other side), My listings (groups, manage sheet, edit menu, quantity sheet, removed by team), Profile "My listings". **Video upload is off** (`LISTING_VIDEO_UPLOAD_ENABLED = false`) until the device checks in `docs/superpowers/spikes/2026-11-18-f2-native-media.md` pass |
| Shared types | Listing kinds/statuses, conditions, Left/Right/Pair + `complementarySide()`, units, price models, rental periods, enquiry/offer/deal/rental/part-request/report statuses, notification types, admin roles; discovery (`SearchRequest` / `SearchFilters` / `SearchPage` / `QueryReading`, `DiscoveryOrigin`, radii, `ListingCard.saved` / `tags`, home / browse / brand views, saved items, synonyms, limits); F6 + F7 (threads, messages, system lines, offers with `counterBounds()` and `totalPaise()`, holds, deals with `dealActions`, disputes, reviews and facets, notifications, consent, limits, settings, error codes) |
| Admin | Login, role-filtered sidebar, dashboard KPI tiles (A1), A4 catalogue pages, A2 pages (Business verification, Users & businesses, Industrial areas), A3 listing pages, F4 Search synonyms and Search insights, F6 + F7 Enquiries & offers, Deals, Disputes, Conversations and Reports & flags, placeholder pages for the other A1–A6 modules; UI kit (dialogs, data table, filters, segmented tabs, lightbox, URL state, keyboard nav, socket), in Periwinkle v2 (see Design system) |
| User app | Welcome (phone sign-in or "Browse first" as a guest) → phone OTP → Your business (name, business, activities, categories) → Where are you? → 5 tabs (Home, Search, Post, Chats, Deals; see Discovery for Home and Search, F6 + F7 for Chats and Deals) + Profile (business details, location, GST verification, My listings, Saved, reviews, notifications, contact number, blocked businesses, language, logout); en/hi/gu with parity + audit tests; toasts, confirm sheet, skeletons. Native modules added for F1 (`expo-location`, `expo-document-picker`, `expo-image-picker`, `react-native-maps`): needs a new dev-client build. Re-skinned to Periwinkle v2 (see Design system); not yet checked on a device |
| Design system | Spec `docs/superpowers/specs/2026-11-18-periwinkle-v2-reskin-design.md` (rulings R1–R17), plan `docs/superpowers/plans/2026-11-18-periwinkle-v2-reskin.md`. **App:** tokens in `apps/user-app/lib/palette.ts` (**light only** since 2026-11-19, `shadows.raised / float / segment`) behind `useTheme()`; Manrope + JetBrains Mono (`@expo-google-fonts/*`); type scale `lib/typography.ts` via `useType()` with the Hindi / Gujarati rules (system Noto fallback, R6); the v2 kit in `components/` (Button variants / sizes, filled Input with `prefix` / `size` / `mono`, Field, Chip, SegmentedControl, OtpCells, Card, ListRow, StatusChip, Notice, Steps, IconButton, Header, FooterBar, SideToken, HeroGlow, `art/GearShot`) and the icon-only floating tab bar (`navigation/floating-tab-bar.tsx`, `useTabBarInset()`); every screen restyled with no copy, `testID` or behaviour change. **Admin:** `apps/admin/lib/palette.ts` remaps Tailwind's `gray / brand / red / amber / green` to v2 and adds `sun`, `photo`, `scrim` (no `blue` / `indigo` / `side`); Manrope + JetBrains Mono via `next/font`; `components/ui/field-classes.ts`; kit, shell and the four mockup-mapped pages restyled class-only. **Guards:** palette parity tests read the mockup's source in both apps (plus WCAG contrast floors in the app); style audits (`lib/style-audit.test.ts` in each app) fail on hard-coded or off-palette colours, and in the app on `fontWeight` or a literal font family. How-to: `apps/user-app/CLAUDE.md` §1–2, §6, §8.1, `apps/admin/CLAUDE.md` |
| Docs | `docs/product-scope.md`: full feature spec, modules M1–M20 + AD1–AD7 with phases and competitor inspiration (incl. M11 buyer requirements / RFQ, as in textile's M9); `docs/research/`: three sourced competitor notes; `docs/product-scope.txt`: PDF extract with U/F/A IDs; `docs/Machine Parts Marketplace Product Scope (full).pdf`: 46-page client-ready scope in the textile scope PDF's style (12 diagrams), exported from the Claude Doc https://claude.ai/artifact/VwZKCLT5xEzAwB5CgfnwyG |
| Design | **Approved: Periwinkle v2** (D2; v2 chosen 2026-11-18): `docs/mockups/user-app-mockup-periwinkle-v2.html` (from `src/build-periwinkle-v2.mjs`) is the UI brief, and since the re-skin the code's palettes are tested against it (see Design system). v1 (kept for reference only): `docs/mockups/user-app-mockup-periwinkle.html`, 56 phone + 4 admin screens in 11 flows, light/dark, generated by `docs/mockups/src/build-periwinkle.mjs` (content from `build.mjs`, plus No results, Report listing, Handed over, Compare replies and Machines for rent); theme page `theme-periwinkle.html`. Superseded: `docs/mockups/user-app-mockup.html` (51 phone + 4 admin screens, light/dark, generated by `docs/mockups/src/build.mjs`); not yet reviewed by the client. Direction B: `docs/mockups/user-app-mockup-b.html` (same screens, paper / machine green / signal orange, L \| R side token, generated by `docs/mockups/src/build-b.mjs`) for decision D2 |
| Infra | Local Docker compose (Postgres 18 + PostGIS on :5434, Redis on :6381), `infra/deploy` production kit (API + Redis + Caddy), API Dockerfile |

## How to run

1. Docker Desktop running → `pnpm infra:up`
2. `.env` at the repo root (copied from `.env.example`; dev secrets only). `DISCOVERY_CURSOR_SECRET` (at least 32
   characters, a fresh value per environment) is required: the API refuses to start without it.
3. `pnpm --filter @mpm/api db:migrate && pnpm --filter @mpm/api db:migrate:test && pnpm --filter @mpm/api db:seed`
4. Seed data (each fills an empty table once and refuses after): `pnpm --filter @mpm/api db:seed:catalog`,
   `pnpm --filter @mpm/api db:seed:locations` (pincode directory from `infra/seed/pincode-directory.csv.gz`; `--reset`
   replaces it), `pnpm --filter @mpm/api db:seed:industrial-areas` (then edit areas in the admin panel),
   `pnpm --filter @mpm/api db:seed:search` (side words, starter synonyms and stop words; then edit them in Search
   synonyms). After migration 0010 on a database that already has listings, run `pnpm --filter @mpm/api
   db:backfill:search` once to fill their search columns (safe to re-run).
5. `pnpm dev:api` (:3000, Swagger `/docs`), `pnpm dev:admin` (:3001), `pnpm start:user` (Metro :8082, needs a dev-client build: `pnpm android`).
   F1 added native modules (location, document and image pickers, maps), so **rebuild the dev client** (`pnpm android`)
   before running the app; the map pin needs `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` (`apps/user-app/.env.example`).
   F2 added more native modules (image manipulator, video, compressor): **rebuild the dev client again**.
6. GST in dev: the stub answers any valid GSTIN (code `123456`; `24AAACC0000C1ZY` cancelled, `24AAACN0000N1Z0` not
   found, `24AAACU0000U1ZF` provider down). Start the API with `GST_PROVIDER=off` to try the review path. Review
   uploads need the R2 variables (see Open items); without them they answer `503 STORAGE_UNAVAILABLE`.
7. Listing photos need the public bucket (`AWS_S3_PUBLIC_BUCKET`, `MEDIA_PUBLIC_BASE_URL`: the same values as the
   textile-style `AWS_S3_BUCKET` / `AWS_S3_PUBLIC_URL`); until then media answers
   `503 STORAGE_UNAVAILABLE`. In dev, `LISTING_MEDIA_OPTIONAL=true` lets a listing publish without photos (ignored in
   production). R2 round trips for listing media: `R2_TESTS=1 pnpm --filter @mpm/api exec vitest run
   __tests__/media-r2-spike.test.ts __tests__/listing-media-r2.test.ts`.
8. F6 + F7: `db:migrate` (and `db:migrate:test`) apply 0012–0013. Chat, hand-over and problem photos use the private
   bucket (`incoming-chat/` uploads, then `chat/` and `deal/` keys): add a lifecycle rule deleting `incoming-chat/` after
   1 day. **Push is optional:** set `FIREBASE_SERVICE_ACCOUNT_B64` (base64 of the Firebase service-account JSON) in
   `.env`; without it pushes are logged as `sent_dev` outside production and recorded `skipped` in production, and the
   in-app list works either way. On the phone, put the Firebase `google-services.json` in `apps/user-app/` (or point
   `GOOGLE_SERVICES_JSON` at it; never committed) and **rebuild the dev client** (`pnpm android`): F6 added
   `expo-notifications`. `EXPO_PUBLIC_SHARE_BASE_URL` (`apps/user-app/.env.example`) is the WhatsApp share link base,
   empty until the domain (D1).

## Open items

- **F6 + F7 device check (owner, plan I-5):** Firebase project, Android app `com.machineparts.app`,
  `FIREBASE_SERVICE_ACCOUNT_B64` in `.env` and `google-services.json` in `apps/user-app/`, then a new dev-client build.
  On two devices (buyer and seller businesses): enquiry with "Will it fit my machine?" → chat with a photo (no location
  data when opened) → offer → counter → accept → share my number on both sides (number shows, call button works) →
  handed over with a photo → received → review on both sides → published. Push on a device: new enquiry, message (none
  while the thread is open), offer, accepted, handed over, completed; a tap opens the right screen; a repeat doesn't
  show twice. Masking: a number typed in Hindi / Gujarati digits stays hidden before the deal and for a viewer member
  after it.
- **F6 + F7 copy:** Hindi and Gujarati (scam warning, consent wording, system lines, notification texts) not yet checked
  by a native speaker.
- **F6 + F7 admin pages in a browser:** Enquiries & offers, Deals, Disputes (resolve each outcome), Conversations
  (reason dialog before a read), Reports & flags (hide / unhide a review), business detail's deal history and score,
  Settings' F6 section: checked by API calls only; click through them.
- **F6 + F7 for the owner (spec §25):** R2 lifecycle rule for `incoming-chat/` (1 day) on the bucket still shared with
  textile; the WhatsApp share base URL (`EXPO_PUBLIC_SHARE_BASE_URL`) waits for the domain (D1); iOS push needs an APNs
  key later (iOS doesn't register a token yet). Confirm with the client: buyer reviews visible to sellers only, dispute
  outcomes not public, auto-complete 3 days after handover (favours the seller; the 2-day report window is the buyer's
  protection).
- **Consent withdraw on an owner or owner-phone change (plan P6):** `withdrawContactConsents` is called by the contact
  number remove / replace routes; no route changes a business owner or the owner's phone yet (team management is P2):
  call it there when those routes land.
- **Chat retention:** no job deletes old chat messages or photos yet (spec §24); decide retention with the DPDP work.
- **Lane test databases to drop:** the empty `mpm_l1_test` … `mpm_l4_test` (wave A lanes) and Redis test DBs 3–6 can go
  (`docker exec mpm-postgres-1 dropdb -U mpm mpm_l1_test` …, `redis-cli -p 6381 -n 3 flushdb` …).
- **F6 + F7 checks not yet run (Batch I-2):** `CI=1 npx expo export --platform android` in `apps/user-app` (stopped by
  the machine running low on memory on 2026-11-20, not a bundle error), `npx expo install --check`, and `sharp` on the
  Alpine API image (`docker build -f apps/api/Dockerfile .`, spec §23). Run them before the device build and the first
  deploy.
- Scores and the seller-score block are computed on read (a grouped query per seller); store aggregates when volume
  grows (spec §23).

- **R2 private bucket: set** (2026-11-18); the three GST document round trips run and pass against it. Lifecycle rules
  wanted on the private bucket: delete `incoming-verification/` and `incoming-listing/` after 1 day.
- **R2 public bucket for listing media: set** (2026-11-19). The owner's `.env` has the textile project's names and
  buckets (`AWS_S3_BUCKET`, `AWS_S3_PUBLIC_URL`, an `r2.dev` URL); `AWS_S3_PUBLIC_BUCKET` and `MEDIA_PUBLIC_BASE_URL`
  were added to `.env` with the same values. Both listing-media R2 suites pass (copy with `REPLACE` metadata,
  `If-Match` / `CopySourceIfMatch`, range reads). Still to do for production: a custom domain on Cloudflare once D1 is
  settled (`r2.dev` is for dev only) and `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_API_TOKEN` (Zone · Cache Purge) for purge.
- **Buckets shared with textile:** both projects use the same private and public buckets and keys. Both write
  `verification/` keys in the private bucket (IDs keep them apart), so any lifecycle rule or orphan sweep must not
  touch the other project's objects; give each project its own buckets (or a key prefix) before production.
- **Video off** (F2 amendment 3): the native media spike couldn't run (no device). The owner runs the checklist in
  `docs/superpowers/spikes/2026-11-18-f2-native-media.md`, then sets `LISTING_VIDEO_UPLOAD_ENABLED = true` and flips
  the API test "the shipped video switch". Video on iOS is unverified (`videoUploadEnabled()` is Android only).
- **F2 device check (owner):** new dev build; sell a part end to end with real photos; listing page, My listings and
  Other side, en / hi / gu; a photo taken with location tagging on has no EXIF once public; keyboard
  over the sheets (report details, quantity, year); a confirm sheet opening right after the action sheet closes.
  Hindi and Gujarati listing copy is not yet checked by a native speaker.
- **F2 admin pages in a browser:** checked by API calls and page loads only (the browser extension wasn't connected);
  click through moderation → review → approve / ask for changes, All listings from a business's "Listings (n)", and
  Settings with the expiry-impact count.
- **Orphan public listing copies:** if the process dies between copying to the public bucket and the attach
  transaction, the `listings/<id>/<mediaId>/…` copies stay with no `listing_media` row (same class as the F1
  `verification/` note). A periodic sweep would clean them.
- Video presign / attach answers `503 STORAGE_UNAVAILABLE` before `400 MEDIA_TYPE` while the public bucket is unset
  (storage is checked first, as for every media route): intended.
- Spec note: §5.2 shows four side tokens, but on a node with sides the side is required (§4.3), so the wizard offers
  Left / Right / Pair only.
- The admin `listings-table` test can time out when the machine is busy; it passes on its own.
- **F4 + F5 device check (owner, plan B7-3):** GPS permission prompt on first Home open (grant, deny, blocked →
  settings); location sheet; radius changes. Browse first as a guest → search → listing → heart → sign in → saved after
  onboarding. Search on a device in en / hi / gu: side words, typo, part number, filters footer, partial banner, widen.
  Home, Search, Filters, Results, Saved against the Periwinkle v2 mockup (light). Review the starter synonyms and the
  `chip_needs_context` brand list with the client.
- **F4 + F5 admin pages in a browser:** Search synonyms and Search insights were checked by page loads and API calls
  only (no browser); click through add / edit / delete a synonym with "Try a search", "Make a synonym" from a
  zero-result row, Hide / Unhide trending, and the brand "ordinary word" flag.
- Hindi and Gujarati discovery copy is not yet checked by a native speaker.
- **Typo threshold:** search's `word_similarity` 0.6 misses "hydralic" for "hydraulic" (suggest's 0.5 would match it,
  but suggest only offers category / brand / model names, so a listing word gets nothing there); about 0.55 would
  catch it. "hydraulik" is found. Tune with real queries.
- **Relevance cost:** photos-ok and completeness are per-row subqueries at query time; store them in
  `refreshListingSearch` when volume grows.
- **Ordinary-word brands:** only "Happy" is flagged `chipNeedsContext` in the catalogue seed; flag Bull, ACE and the like
  when a machinery-brand seed lands. The dev DB's catalogue was seeded before the flag existed, so its "Happy" is not
  flagged (set it in Brands, models & fit, or reseed before go-live).
- Review the starter synonyms and the flagged brands with the client (with the B7-3 list above).
- Filters "place" offers states only: no cities / industrial areas endpoint yet.
- The No results "post a requirement" card waits for F8.
- Saved count on Profile shows "n+" (the saved list has no total from the API).
- Listing detail's `saved` is null (the heart there reads `POST /discover/cards`).
- F2's listing-page distance (rounded, from the business) and discovery cards (snapped, floored, from the origin) can
  differ by about 1 km.
- A returning user who signs in from guest mode skips the one-time GST intro until the next cold start.
- **Part-number joining across a space** joins only when one piece is one or two letters or both are digits ("AB 123 X",
  "6205 zz", "12 345 678"); two full codes ("AA11 BB22", "6205 2RS") stay apart, and units never join ("10 hp").
  Revisit with real queries.
- **Periwinkle v2 device check (owner):** the app's re-skin is checked by tests and an Android bundle only; the visual
  pass is the owner's on a dev build (re-skin spec §12.3, now light only: English, Hindi, Gujarati). The
  splash and adaptive-icon colours in `app.json` show only after the next native build.
- **Noto contingency (re-skin spec §5.3):** if hi/gu titles don't look bolder than body text on the Android device,
  bundle Noto Sans Devanagari / Gujarati and switch the family in `typeStyle` (`apps/user-app/lib/typography.ts`).
- **Owner question:** on the GST status screen the status chip repeats the title's wording; keep both or drop one?
- Rulings worth a second look: R9 (icon-only tab bar; labels are one flag away) and R15 (light-theme muted and status
  text under AA 4.5 : 1; darker values ready in the spec).
- Admin KPI subtitles are grey (`text-gray-500`), not the mockup's green: the current ones ("Hidden from the app",
  "N with left / right sides") aren't good news. Give `StatCard` a tone when a KPI with a positive delta lands (A1).
- Document upload and the map pin are untested on a real device.
- **Live GST adapter** (when a provider is chosen): give its calls a short timeout and return `unavailable` instead of
  throwing. Provider calls run inside the transaction that holds the business row lock (instant confirm, officer
  approval), so a slow provider holds that lock.
- **Socket.IO suspension disconnect** reaches only sockets on the same API process, and so do F6 + F7's per-member chat,
  offer and deal emits: add the Socket.IO Redis adapter before running more than one API instance.
- **Orphan `verification/` copies**: if the process crashes between staging the documents and the transaction, the
  copies stay in R2 with no proof row (the `incoming-verification/` lifecycle rule doesn't cover them). A periodic sweep
  of `verification/` keys with no proof would clean them.
- **DPDP note**: admin search strings (phone, GSTIN) end up in request logs, and the `gst.release` audit row's `before`
  keeps PAN and address. Decide retention / masking with the DPDP work.
- `GST_OTHER_GSTIN_HELD` (`grantGst`) is unreachable today (the instant path refuses earlier); kept defensively.
- Document submit checks the key shape (`400 DOCUMENT_KEY_INVALID`) before storage (`503`): documented in
  `stageDocuments`, intended.
- Admin `fetchCategoryNames` and the app's onboarding category chips (`fetchMachineCategories`) still download the
  whole `/categories` tree; `GET /categories?depth=1` (roots only) exists since F4: switch the callers that only need
  the roots.

## Open decisions (ask the client)

The ten client decisions D1–D10 are listed at the end of `docs/product-scope.md` and the mockup. **D6 (phone numbers)
is settled** by F6 + F7 ruling R6: hidden until there is a deal and both sides tick "Share my number". Older notes:

- Brand / app name (working name "Machine Parts"; bundle id `com.machineparts.app` is a placeholder)
- Launch city / industrial areas, and whether Hindi and Gujarati are the right second languages
- Who owns the category / machine type / brand / model catalogue seed (A4)
- GST verification provider
- Rental: day/week/month pricing only, or bookings with dates and deposits?
- Monetisation of featured / promotional listings (A6 says "later")

## Suggested build order

1. ~~**A4 machine configuration**~~ — built 2026-11-18 (see What's built). Client still reviews the seed (CSV export).
2. ~~**F1 business profile + A2 verification**~~ — built 2026-11-18 (see What's built). R2 keys and a GST provider still to set.
3. ~~**F2 + F3 listings** + A3 moderation~~ — built 2026-11-19 (see What's built). Public bucket, video device check and
   the owner's device pass still to do (Open items).
4. ~~**F4 + F5 discovery**~~ — built 2026-11-19 (see What's built). The owner's device pass, the admin pages in a
   browser and the client's synonym review still to do (Open items).
5. ~~**F6 + F7 enquiries, chat, offers, deals**~~ — built 2026-11-19/20 (see What's built). The owner's Firebase keys
   and device pass, the admin pages in a browser and the hi / gu copy check still to do (Open items). Then rentals (M14).
6. **F8 part requests + matching job**, **F9 notifications** (FCM).
7. A1 dashboard KPIs, A5 monitoring, A6 reports and flags.

## Session log

- 2026-11-16 — Base setup: ported the textile marketplace's base (scaffold + ORA base, textile commit `57c6676`),
  upgraded to its later base choices (Node 22 / pnpm 11, Postgres 18, test-DB guard, job runner, `RATE_LIMIT_MAX`),
  rebranded to `@mpm`, mapped admin nav, shared types, app tabs and copy to the machine-parts scope; fresh migration history.
  Verified: typecheck, lint, tests (app 106, admin 128, API 25), admin production build, live smoke test.
- 2026-11-16 — Research and design: competitor research (Fibre2Fashion Machinery, 8 used-machinery sites, Indian B2B,
  rental and parts-fitment sites) in `docs/research/`; full feature spec `docs/product-scope.md` with the buyer
  requirement (RFQ) module M11; design mockup `docs/mockups/user-app-mockup.html` (steel / ink / safety-yellow, side
  mark), checked in headless Chrome in light and dark. Nothing committed yet.
- 2026-11-16 — Moved the project from `D:\marketplace\machine-parts` to `C:\Users\Dell\Desktop\machine marketplace`
  (fresh `pnpm install`, typecheck clean, Docker data kept). Wrote the product scope as a Claude Doc in the textile
  scope's style (tables plus system, navigation, workflow, data model and roadmap diagrams) and exported it to
  `docs/Machine Parts Marketplace Product Scope (full).pdf`. Nothing committed yet.
- 2026-11-16 — Design direction B: `docs/mockups/user-app-mockup-b.html` from `src/build-b.mjs`. It has the same 55 screens
  and content as direction A, with a new visual language (warm paper, machine green, signal orange, Archivo + IBM Plex,
  product-photo parts, L | R side token, floating tab bar, photo tiles). Checked in headless Chrome, light and dark.
  Nothing committed yet.
- 2026-11-17 — First commit (`9b6b8c4`) pushed to `main` at https://github.com/nilbhungaliya/machine-marketplace;
  `develop` branched from it and pushed. Work continues on `develop`.
- 2026-11-17 — Theme pass, step 1: `docs/mockups/theme-options.html` (also published as an artifact) with six colour and
  font themes for the user to pick from. Next: 4–5 sample screens in the chosen theme, then every app screen in the style
  of the textile project's `user-app-mockup.html`. Nothing committed yet.
  Round 2 replaced the six themes with ones taken from shop-floor materials, after the user found the first set generic.
  Also `docs/mockups/theme-periwinkle.html`: a lavender and violet theme built from the user's reference image.
  Then `docs/mockups/theme-clean-bench.html` ("Clean Bench"), combining the Mealio Dribbble shot and its video with the
  Periwinkle reference; the user's current candidate.
- 2026-11-17 — The user chose **Periwinkle** for this app (D2). Built `docs/mockups/src/build-periwinkle.mjs` →
  `user-app-mockup-periwinkle.html`: all 11 flows (56 phone + 4 admin screens) restyled, the listing page, home grid and
  saved list laid out like the reference, five new screens. Published as https://claude.ai/artifact/TjqEWKeq31dj73f7zXGukW.
  CLAUDE.md now points at it as the UI brief. (Clean Bench was applied to the textile project instead:
  `textile-marketplace/docs/mockups/clean-bench-textile.html`.) Nothing committed yet.
- 2026-11-17 — Periwinkle v2 (`user-app-mockup-periwinkle-v2.html` from `src/build-periwinkle-v2.mjs`), after the user said v1
  still looked AI-made: rendered parts in real materials, neutral board, filled controls, hairline cards, mono part numbers,
  side-convention diagram. v1 kept. Published as https://claude.ai/artifact/JZozpnavD4cDPzXhKBERpc. Nothing committed yet.
- 2026-11-18 — Set up on this machine (repo at `E:/machine-marketplace`): `pnpm install`, `.env` from the example with
  fresh dev secrets, Docker infra, migrations (dev + test), seed admin. Verified: typecheck, lint, tests (app 106, admin 128,
  API 25). Periwinkle v2 chosen as the UI brief. Owner's standing rules added to CLAUDE.md: spec + plan before every
  feature, always the Superpowers skills, always start from the textile project's matching spec and code.
- 2026-11-18 — Built A4 (machine catalogue) on `feat/a4-catalogue` with subagent-driven development, all subagents on
  Opus, in 6 batches, each reviewed; whole-branch review + one fix wave. Seed loaded into the dev DB. Verified:
  typecheck, lint, tests (app 106, admin 199, API 212), live API checks and CSV exports. Committed as one commit and
  merged into `develop` (not pushed). Owner rule from now on: all feature work directly on `develop`, no feature branches.
  Open for the client: seed review via the CSV exports, embroidery split decision before launch (spec §15).
- 2026-11-18 — F1 + A2 (business profile, GST verification, admin verification / users & businesses / industrial
  areas), plan `2026-11-18-f1-a2-business-profile-verification.md`, built on `develop`. Tasks 1–16 committed and pushed
  (last `9b3fa0b`); Batches 7–8 (app screens, end-to-end check and docs) ran on this machine
  (`C:\Users\Dell\Desktop\machine marketplace`), where the earlier batches' build log and the textile repo weren't
  available. Verified: typecheck, lint, tests (app 155, admin 227, API 458 + 3 skipped: R2 round-trips). Dev DB:
  `db:seed:locations` (156 932 offices, 19 300 pincodes) and `db:seed:industrial-areas` (14) loaded; second runs refuse.
  Live API walk-through (stub instant path → verified; `GST_PROVIDER=off` review submit → 503 without R2; SQL-inserted
  review approved by the admin API → verified; suspension → next request 403) and admin pages in Chrome (queue → detail →
  approve, suspend, add area, adopt an "Other" area); the walk-through's data was deleted afterwards.
- 2026-11-18 — F1 + A2 final review fix wave (two whole-feature reviewers, `git diff a50fb0a HEAD`), on `develop`.
  API: no needs-more dead end (1–5 new files, ≤ 10 per review, limits in shared-types; reject also closes a
  `needs_more` review; spec §5.3 amendment); `PATCH /users/me` and `completeProfile` removed (the first
  `PATCH /businesses/me` is the only way to create a business; test helper migrated); user row lock `FOR NO KEY UPDATE`;
  per-user presign limit (30 / 10 min); one officer-reason helper (`lib/admin-text.ts`, limits in shared-types);
  `GET /admin/verification/reviews/count` for the nav badge; stub `sent` record capped. App: constitution keys
  translated on the GST card; GST screens replace one another so Back lands on Profile / Main; Sentry redacts GST /
  profile keys and strips URL query strings; error state with Retry on GST status, found and code; location pin follows
  its pincode and can be removed (edit keeps it); profile form initialised once; dead code removed. Admin: danger submit
  on Suspend / Block / Revoke / Release / Reject; shared `Panel`; nav badge from the count endpoint, refetched on focus,
  every minute and after a decision (not on every page change); Reject offered on a `needs_more` review; "Needs more"
  amber in admin, as the app's orange chip. Verified: typecheck and lint clean; tests app 162, admin 233, API 466 + 3 skipped (R2 round-trips); `mpm_test` left empty; `CI=1 npx expo export --platform android` bundles.
- 2026-11-18 — **Periwinkle v2 re-skin** (app + admin), plan `2026-11-18-periwinkle-v2-reskin.md`, on `develop` in five
  batches (Batches 1–4 committed as `2deb9b0`, `849d52f`, `b5fc78d`, `c8947da`; Batch 5 verification + docs, with three
  admin review fixes: grey KPI subtitles, the inline filled-input classes built from `inputCls`, and a tighter admin
  style audit). No copy, locale, `testID` or behaviour change (only the planned `Confirm-sheet-cancel` and `Tab-*`
  IDs added); no API or shared-types change. Verified: typecheck and lint clean; tests app 213 (was 162), admin 268
  (was 233), API 466 + 3 skipped; `expo install --check` clean, `expo export --platform android` bundles; admin
  production build. Admin checked in Chrome against the mockup's admin screens (computed styles; screenshots time out):
  Dashboard, Categories with a part group selected, Business verification with a review open (a throwaway business,
  deleted afterwards), Users & businesses with its filter dialog, Industrial areas, Brands & models: every colour on
  those pages is a palette value. Dev DB: `db:seed:catalog` loaded (it was empty on this machine; a second run
  refuses). Still the owner's: the device check on a dev build (Open items).
- 2026-11-19 — **F2 + F3 + A3 listings** built on `develop` from the approved spec (amendments 1–5) and plan:
  Batches 1, 2a, 2b and the C0 contracts in sequence, then on the owner's request six parallel lanes like the textile
  project (L1 API media, L2 other side / expiry / admin API, L3 admin pages, L4 app foundation, then L5 sell wizard and
  L6 listing screens), each in its own worktree on a local lane branch, independently reviewed, fixed and merged
  (worktrees deleted). Integration: video off (no device for the spike), template `includeRetired=1`, other-side
  prefilter, expiry per-row savepoint, `Unit.isMachineUnit` required, GST tests made to run with the R2 private keys
  the owner set (3 R2 round trips pass). Verified: typecheck and lint clean; tests app 384, admin 316, API 835 + 2
  skipped (public-bucket R2 suites); `mpm_test` left empty; admin production build; `expo export --platform android`
  bundles. Scripted API walk-through on the dev DB passed (two sellers, publish → review → approve, other side at 7 km,
  rental refused without GST, pause / resume / sold, admin hide, expiry job), data deleted afterwards; admin pages
  checked by page loads and API calls only (browser extension not connected). Still the owner's: public bucket, video
  device check, the device pass, the browser click-through (Open items).
- 2026-11-19 — Onboarding motion ("workshop precision", `docs/mockups/onboarding-motion.html`) built into the app,
  animations only (owner's call: no copy, flow or control changes; no spec or plan at the owner's request). Foundation:
  `lib/motion-track.ts` (glide / seat / rail / ratchet easings, keyframe `track()`), `hooks/use-loop.ts` (focus-aware
  loop, holds the finished frame under reduce motion), `components/art/stage.tsx` (layered Svg parts, transform-only)
  and `materials.tsx`, `components/motion/Entrance.tsx` (heading wipe, rail slide-in, footer rise). Drawings:
  Welcome `HubAssembly` + `MatchToken` (replaces GearShot there), Mobile number `DialGauge`, Code `BoltFlange` (the
  flange turns and the seal goes green for 0.9 s before login), Your business `Nameplate` (engraves the typed name) +
  `Conveyor`, Where are you? `EstateMap` (onboarding only, hidden when the real map shows), GSTIN entry
  `GstinCaliper` (reads the typed GSTIN part by part); `Steps` racks its current segment. Verified: typecheck, tests
  (app 426 after rebasing onto the F2 listings work), `CI=1 npx expo export --platform android` bundles. **Not yet run on a device**: motion, both themes and
  performance unchecked. Committed and pushed on `develop`.
- 2026-11-19 — Public bucket: no new bucket needed. The owner's `.env` already had the textile buckets under textile's
  names (`AWS_S3_BUCKET`, `AWS_S3_PUBLIC_URL`); added `AWS_S3_PUBLIC_BUCKET` and `MEDIA_PUBLIC_BASE_URL` with the same
  values (local `.env` only). Both listing-media R2 suites pass. Noted that the buckets are shared with textile.
- 2026-11-19 — **User app is light only** (owner's call): no dark palette (`darkColors` removed), no Appearance setting on
  Profile (its locale keys and the `settings_theme_changed` event removed), `useTheme()` returns `{ colors, shadows }`,
  `userInterfaceStyle: "light"` and no dark splash in `app.json` (shows after the next native build); the onboarding
  motion drawings lost their dark branches. Admin unchanged. Verified: app typecheck clean, app tests 421 (the five
  dark-palette checks removed). F4 + F5 discovery brainstorming started.
- 2026-11-19 — F4 + F5 discovery spec written from the owner's answers (core now: search with query reader, filters,
  sort, browse with counts, home, saved, recently viewed, guest browsing; GPS location; Pair shown under Left / Right;
  live + reserved, rented only in rentals) after reading textile's M2/M5 and Part 2 specs and code. Awaiting review.
- 2026-11-19 — **F4 + F5 discovery** built on `develop` from the approved spec (three owner reviews) and plan
  `2026-11-19-f4-f5-discovery.md`: B0 contracts, B1 API search, B2 API discovery / saved / admin API / search seed, B3
  admin pages and B4 app foundation in sequence, then B5 (app search) and B6 (app home, saved, recently viewed) as two
  parallel lanes merged into `develop`; each batch independently reviewed with a fix wave, plus a merge fix and a joint
  B5 + B6 review fix (`e5f3e74`). Spec amendments during the build: radius margin 3 km, count-only at
  `POST /discover/search/count`, additive word synonyms (`wordGroups`), brand view `allCount` + `brandId` filter.
  B7 integration: typecheck and lint clean; tests API 1123 + 2 skipped (public-bucket R2 suites), admin 380, app 527;
  `mpm_test` left empty; admin production build; `expo export --platform android` bundles. Dev DB: migrations 0010–0011
  applied, `db:backfill:search` run (no listings), `db:seed:search` already loaded (102 synonyms, 44 stop words).
  Scripted API walk-through on the dev DB passed (three users, two sellers ~3 km and ~127 km from the origin, four
  listings approved through moderation): "AB-123/X" found as "ab123x" and "AB 123 X"; "lh" and "बायाँ" read as Left,
  with the Pair below the Left and tagged; typo "hydraulik"; Toyota + LWT710 chips; `#ref` redirect and bare-ref
  suggestion; widen 50 → 200 km; count-only incl. `partialTotal`; save, own-listing 409, saved list, hearts for buyer
  vs guest; home tiles; browse counts; brand view; cards order; admin word synonym seen by the public search after
  5.2 s and gone after delete; zero-result query in insights; trending 200 (empty). Data deleted afterwards (catalogue,
  seeds and settings unchanged; audit rows kept). Admin pages checked by page loads (`/search-synonyms/`,
  `/search-insights/` 200) and API calls only. Still the owner's: the device pass and a browser click-through (Open
  items).
- 2026-11-20 — **F6 + F7 Batch I (integration + close-out)** on `develop` after C0, C1, wave A (API lanes L1–L4) and
  wave B (L5 admin, L6 app chat, L7 app offers + deals, L8 app reviews / notifications / push / My listings holds), each
  lane reviewed and merged. I-1: `apps/api/__tests__/f6-core-loop.test.ts` (5 cases: the core loop through the API —
  enquiry → message with a number → offer → counter ×2 → accept → backup → cancel → revive → reconfirm → accept → hand
  over → confirm → quantity down → both reviews published, notification types, no number in any rendered text; accept
  revealing the numbers in its own transaction; a block closing the pair's offers while their deal finishes; the seller
  owner's suspension with the buyer cancelling the deal; confirm-received racing `autoCompleteDeals` → one completion,
  one conversion); the Deal record's number after both ticks / after a withdraw and admin removal were already covered
  by lane suites. Stub sweep: the unused `notImplemented()` helper removed; only `OTP_NOT_IMPLEMENTED` (MSG91 not
  wired) remains. Verified: typecheck and lint clean; tests API 1540 + 3 skipped (R2 suites), admin 402, app 704;
  `mpm_test` and test Redis left empty; admin production build (28 pages). `expo export --platform android` was stopped
  by the machine running low on memory (not a bundle error) and `expo install --check` / the Docker `sharp` build were
  not run: run them before the owner's device build. Dev DB: migrations up to date (0012–0013). Scripted API
  walk-through on the dev DB passed (two sellers + a buyer by phone OTP, three listings approved by the admin API):
  enquiry, a photo message through R2 (re-encoded, signed URL for the seller), a number masked before the deal; offer →
  counter ×2, a second buyer's chain → backup; accept (#500001, available 2, still live); buyer cancels → backup
  revives, 409 `OFFER_NEEDS_RECONFIRM` until the seller reconfirms → accept; share my number on both sides → number on
  the Deal record; hand over → received → quantity 5 → 1; both reviews published and on the seller's public list; a
  quote on a price-on-request listing → accepted → reserved → handed over → problem → support resolved cancelled with
  stock returned (listing live with 2; admin conversation read from the dispute 200); "Buy at this price" → reserved;
  notifications listed for all three; push to a registered device recorded `sent_dev` ("push sent (dev stub)", no
  Firebase keys); admin reads 200. Data deleted afterwards (users, businesses, listings, threads, offers, deals, reviews,
  notifications, consents; the R2 chat photo); row counts match the earlier snapshot except 5 audit rows (kept). Docs:
  PROJECT_STATUS, the three CLAUDE.md files, `product-scope.md` (§22: M9 / M15 pointers answered, M13 calendar days,
  M10 sharing after a deal, D6 settled), F4 spec (bell and Enquire / Offer sign-in reasons exist), spec and plan
  marked built. Still the owner's: Firebase keys and the device pass (Open items).
