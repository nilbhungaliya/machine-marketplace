# Project status

Current state of the Machine Parts & Machinery Marketplace. Update the sections below and add a line to the session
log whenever a session changes the project's state.

## What's built

**Base setup + A4 machine catalogue + F1 business profile + A2 business verification (2026-11-18, on `develop`).** The
admin-managed catalogue is built and seeded; businesses complete a profile with a pincode location and an industrial area
and verify their GST (instant through a provider, or officer review with documents); admins run the verification queue,
users & businesses and industrial areas. The app and the admin wear the approved **Periwinkle v2** design (re-skin,
2026-11-18). No listing, search or deal feature (F2–F9) exists yet, and the other admin modules are still placeholders.

| Area | State |
|---|---|
| Monorepo | pnpm 11 workspace: `apps/api`, `apps/admin`, `apps/user-app`, `packages/shared-types` |
| API | Fastify 4 + Drizzle + Zod; `{ data }` / `{ error, code }` shapes; Redis rate limits; Sentry (opt-in); Socket.IO `/user` + `/admin`; job runner with graceful shutdown |
| Auth | Admin email + password + JWT, 6 roles; user phone OTP (outside production the code is returned in the send response as `devCode`; MSG91 not wired) + JWT; onboarding creates the business; suspended/blocked accounts refused (`ACCOUNT_SUSPENDED`) at sign-in, on the very next API request (status read from the row on every request) and on socket connect |
| Database | `admin_users`, `businesses` (trade/legal name, activities, categories, email, year, employees, GST fields, address, `industrial_area_id` or `industrial_area_other` — exactly one, CHECK —, city, state, pincode, PostGIS `location`, `verification_levels`, verification status), `users` (status), `audit_log`; catalogue (migrations 0002, 0003): `categories` (machine category › machine type › part group, `has_sides` / `side_convention` inherited), `template_fields` (`applies_to` parts/machines/both) + `template_field_options`, `brands`, `machine_models` (unique per brand + type, case-insensitive), `units`, `conditions`; F1 + A2 (migrations 0004–0007): `pincode_offices` (India Post directory, 156 932 offices / 19 300 pincodes), `industrial_areas` (unique name + city + state, case-insensitive), `gst_checks` (every lookup: business or officer), `gst_representative_proofs` (declaration → code or documents; one open review per business), `business_verifications` (grants and revocations, one active per business + level) |
| Business profile (F1) + verification (A2) | Spec `docs/superpowers/specs/2026-11-18-f1-a2-business-profile-verification-design.md`, plan `docs/superpowers/plans/2026-11-18-f1-a2-business-profile-verification.md`. **API:** `GET/PATCH /businesses/me`, `PUT /businesses/me/location` (pincode + listed area or "Other", optional pin); public `GET /locations/pincodes/:pincode`, `/locations/nearest-pincode`, `/locations/industrial-areas?pincode=`; GST under `/businesses/me/gst` (state, lookup, declare, `otp/send`, `otp/verify`, `review`, `review/files`, `documents/presign`), one switch `getGstMode()` (`stub` in dev, `live` with a provider adapter + key, `review` otherwise or with `GST_PROVIDER=off`); R2-only private storage (`lib/storage.ts`, `503 STORAGE_UNAVAILABLE` when unset, uploads sniffed for JPEG/PNG/WebP/PDF); admin `/admin/verification/*` (queue, waiting count, detail, approve / reject / ask for more, 300 s document links), `/admin/businesses` (list, detail, revoke / release GST), `/admin/users/:id/suspend\|reinstate\|block\|unblock`, `/admin/industrial-areas` (CRUD, reorder, "Other" list and adopt); every mutation audit-logged. **Admin pages:** Business verification, Users & businesses (list + detail), Industrial areas. **App:** onboarding Your business (activities, machine categories) → Where are you? (pincode, area picker with Other, optional map pin), gating until done; GST intro → GSTIN → found → declaration → code (instant), or the review form with document picker; GST status and a completed Profile. Seeds: `db:seed:locations` (pincode directory), `db:seed:industrial-areas` (14 Surat areas); both refuse to run on a filled table |
| Catalogue (A4) | Spec `docs/superpowers/specs/2026-11-18-a4-machine-catalogue-design.md`, plan `docs/superpowers/plans/2026-11-18-a4-machine-catalogue.md`. Public API: `GET /categories`, `/categories/:id/template?kind=part\|machine`, `/brands`, `/models`, `/master-data`; admin APIs for nodes (create, edit, side settings, move with root locks and clash checks, reorder, delete), fields and options, brands and models, units and conditions, CSV export (`/admin/catalog/export/:sheet`); `validateSpecs` service for M5. Admin pages: Categories & machine types, Specifications & fields, Brands, models & fit, Units, conditions & sides. Seed (`pnpm --filter @mpm/api db:seed:catalog`, loaded into dev 2026-11-18): Fibre2Fashion Machinery's 465 product types cleaned into 10 categories, 248 machine types, 331 part groups; embroidery and water-jet looms in full (81 fields); 14 brands and 19 models marked "needs review"; 8 units, 4 conditions. **`--reset` deletes the whole catalogue including admin edits: use only before go-live.** |
| Shared types | Listing kinds/statuses, conditions, Left/Right/Pair + `complementarySide()`, units, price models, rental periods, enquiry/offer/deal/rental/part-request/report statuses, notification types, admin roles |
| Admin | Login, role-filtered sidebar, dashboard KPI tiles (A1), A4 catalogue pages, A2 pages (Business verification, Users & businesses, Industrial areas), placeholder pages for the other A1–A6 modules; UI kit (dialogs, data table, filters, segmented tabs, lightbox, URL state, keyboard nav, socket), in Periwinkle v2 (see Design system) |
| User app | Welcome → phone OTP → Your business (name, business, activities, categories) → Where are you? → 5 tabs (Home, Search, Post, Chats, Deals) + Profile (business details, location, GST verification, language, theme, logout); en/hi/gu with parity + audit tests; toasts, confirm sheet, skeletons. Native modules added for F1 (`expo-location`, `expo-document-picker`, `expo-image-picker`, `react-native-maps`): needs a new dev-client build. Re-skinned to Periwinkle v2 (see Design system); not yet checked on a device |
| Design system | Spec `docs/superpowers/specs/2026-11-18-periwinkle-v2-reskin-design.md` (rulings R1–R17), plan `docs/superpowers/plans/2026-11-18-periwinkle-v2-reskin.md`. **App:** tokens in `apps/user-app/lib/palette.ts` (light + dark, `shadows.raised / float / segment`) behind `useTheme()`; Manrope + JetBrains Mono (`@expo-google-fonts/*`); type scale `lib/typography.ts` via `useType()` with the Hindi / Gujarati rules (system Noto fallback, R6); the v2 kit in `components/` (Button variants / sizes, filled Input with `prefix` / `size` / `mono`, Field, Chip, SegmentedControl, OtpCells, Card, ListRow, StatusChip, Notice, Steps, IconButton, Header, FooterBar, SideToken, HeroGlow, `art/GearShot`) and the icon-only floating tab bar (`navigation/floating-tab-bar.tsx`, `useTabBarInset()`); every screen restyled with no copy, `testID` or behaviour change. **Admin:** `apps/admin/lib/palette.ts` remaps Tailwind's `gray / brand / red / amber / green` to v2 and adds `sun`, `photo`, `scrim` (no `blue` / `indigo` / `side`); Manrope + JetBrains Mono via `next/font`; `components/ui/field-classes.ts`; kit, shell and the four mockup-mapped pages restyled class-only. **Guards:** palette parity tests read the mockup's source in both apps (plus WCAG contrast floors in the app); style audits (`lib/style-audit.test.ts` in each app) fail on hard-coded or off-palette colours, and in the app on `fontWeight` or a literal font family. How-to: `apps/user-app/CLAUDE.md` §1–2, §6, §8.1, `apps/admin/CLAUDE.md` |
| Docs | `docs/product-scope.md`: full feature spec, modules M1–M20 + AD1–AD7 with phases and competitor inspiration (incl. M11 buyer requirements / RFQ, as in textile's M9); `docs/research/`: three sourced competitor notes; `docs/product-scope.txt`: PDF extract with U/F/A IDs; `docs/Machine Parts Marketplace Product Scope (full).pdf`: 46-page client-ready scope in the textile scope PDF's style (12 diagrams), exported from the Claude Doc https://claude.ai/artifact/VwZKCLT5xEzAwB5CgfnwyG |
| Design | **Approved: Periwinkle v2** (D2; v2 chosen 2026-11-18): `docs/mockups/user-app-mockup-periwinkle-v2.html` (from `src/build-periwinkle-v2.mjs`) is the UI brief, and since the re-skin the code's palettes are tested against it (see Design system). v1 (kept for reference only): `docs/mockups/user-app-mockup-periwinkle.html`, 56 phone + 4 admin screens in 11 flows, light/dark, generated by `docs/mockups/src/build-periwinkle.mjs` (content from `build.mjs`, plus No results, Report listing, Handed over, Compare replies and Machines for rent); theme page `theme-periwinkle.html`. Superseded: `docs/mockups/user-app-mockup.html` (51 phone + 4 admin screens, light/dark, generated by `docs/mockups/src/build.mjs`); not yet reviewed by the client. Direction B: `docs/mockups/user-app-mockup-b.html` (same screens, paper / machine green / signal orange, L \| R side token, generated by `docs/mockups/src/build-b.mjs`) for decision D2 |
| Infra | Local Docker compose (Postgres 18 + PostGIS on :5434, Redis on :6381), `infra/deploy` production kit (API + Redis + Caddy), API Dockerfile |

## How to run

1. Docker Desktop running → `pnpm infra:up`
2. `.env` at the repo root (copied from `.env.example`; dev secrets only)
3. `pnpm --filter @mpm/api db:migrate && pnpm --filter @mpm/api db:migrate:test && pnpm --filter @mpm/api db:seed`
4. Seed data (each fills an empty table once and refuses after): `pnpm --filter @mpm/api db:seed:catalog`,
   `pnpm --filter @mpm/api db:seed:locations` (pincode directory from `infra/seed/pincode-directory.csv.gz`; `--reset`
   replaces it), `pnpm --filter @mpm/api db:seed:industrial-areas` (then edit areas in the admin panel)
5. `pnpm dev:api` (:3000, Swagger `/docs`), `pnpm dev:admin` (:3001), `pnpm start:user` (Metro :8082, needs a dev-client build: `pnpm android`).
   F1 added native modules (location, document and image pickers, maps), so **rebuild the dev client** (`pnpm android`)
   before running the app; the map pin needs `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` (`apps/user-app/.env.example`).
6. GST in dev: the stub answers any valid GSTIN (code `123456`; `24AAACC0000C1ZY` cancelled, `24AAACN0000N1Z0` not
   found, `24AAACU0000U1ZF` provider down). Start the API with `GST_PROVIDER=off` to try the review path. Review
   uploads need the R2 variables (see Open items); without them they answer `503 STORAGE_UNAVAILABLE`.

## Open items

- **R2 keys not set**: `AWS_S3_ENDPOINT`, `AWS_REGION` (`auto`), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_S3_PRIVATE_BUCKET`. Bucket private; token scoped to it with Object Read & Write; lifecycle rule "delete objects
  with prefix `incoming-verification/` after 1 day"; no CORS needed (the app uploads with a native PUT, officers open
  presigned links, the admin never uploads from a browser). The storage round-trip tests (3) are skipped until then.
- **Periwinkle v2 device check (owner):** the app's re-skin is checked by tests and an Android bundle only; the visual
  pass is the owner's on a dev build (re-skin spec §12.3: English light and dark, Hindi light, Gujarati dark). The
  splash and adaptive-icon colours in `app.json` show only after the next native build.
- **Noto contingency (re-skin spec §5.3):** if hi/gu titles don't look bolder than body text on the Android device,
  bundle Noto Sans Devanagari / Gujarati and switch the family in `typeStyle` (`apps/user-app/lib/typography.ts`).
- **Owner question:** on the GST status screen the status chip repeats the title's wording; keep both or drop one?
- Home's category chips aren't tappable yet but are `Chip`s, so they announce a checkbox role; give them the right
  role (or make them filters) with F4.
- Rulings worth a second look: R9 (icon-only tab bar; labels are one flag away) and R15 (light-theme muted and status
  text under AA 4.5 : 1; darker values ready in the spec).
- Admin KPI subtitles are grey (`text-gray-500`), not the mockup's green: the current ones ("Hidden from the app",
  "N with left / right sides") aren't good news. Give `StatCard` a tone when a KPI with a positive delta lands (A1).
- Document upload and the map pin are untested on a real device.
- **Live GST adapter** (when a provider is chosen): give its calls a short timeout and return `unavailable` instead of
  throwing. Provider calls run inside the transaction that holds the business row lock (instant confirm, officer
  approval), so a slow provider holds that lock.
- **Socket.IO suspension disconnect** reaches only sockets on the same API process: add the Socket.IO Redis adapter
  before running more than one API instance.
- **Orphan `verification/` copies**: if the process crashes between staging the documents and the transaction, the
  copies stay in R2 with no proof row (the `incoming-verification/` lifecycle rule doesn't cover them). A periodic sweep
  of `verification/` keys with no proof would clean them.
- **DPDP note**: admin search strings (phone, GSTIN) end up in request logs, and the `gst.release` audit row's `before`
  keeps PAN and address. Decide retention / masking with the DPDP work.
- `GST_OTHER_GSTIN_HELD` (`grantGst`) is unreachable today (the instant path refuses earlier); kept defensively.
- Document submit checks the key shape (`400 DOCUMENT_KEY_INVALID`) before storage (`503`): documented in
  `stageDocuments`, intended.
- A location saved without a pin stores no point: nearby search (F4) should fall back to the pincode's
  `pincode_offices.point`.
- Admin `fetchCategoryNames` and the app's onboarding category chips download the whole `/categories` tree: add a
  roots-only read with F4.

## Open decisions (ask the client)

The ten client decisions D1–D10 are listed at the end of `docs/product-scope.md` and the mockup. Older notes:

- Brand / app name (working name "Machine Parts"; bundle id `com.machineparts.app` is a placeholder)
- Launch city / industrial areas, and whether Hindi and Gujarati are the right second languages
- Who owns the category / machine type / brand / model catalogue seed (A4)
- GST verification provider
- Rental: day/week/month pricing only, or bookings with dates and deposits?
- Monetisation of featured / promotional listings (A6 says "later")

## Suggested build order

1. ~~**A4 machine configuration**~~ — built 2026-11-18 (see What's built). Client still reviews the seed (CSV export).
2. ~~**F1 business profile + A2 verification**~~ — built 2026-11-18 (see What's built). R2 keys and a GST provider still to set.
3. **F2 + F3 listings** — sell flow with specs, side, media upload (R2), preview, publish; A3 moderation. Spec
   `docs/superpowers/specs/2026-11-18-f2-f3-listings-design.md` and plan `docs/superpowers/plans/2026-11-18-f2-f3-listings.md`
   (11 batches, 30 tasks) both approved by the owner 2026-11-18; building next.
4. **F4 + F5 discovery** — search, filters, side filter, complementary parts, nearby (PostGIS).
5. **F6 + F7 enquiries, chat, offers, deals**, then rentals.
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
