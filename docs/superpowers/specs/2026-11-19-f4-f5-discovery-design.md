# F4 + F5 discovery: search, filters, browse, home, saved — design

Date: 2026-11-19. Status: **approved in conversation by the owner (design summary); this document awaits the owner's
review before the plan.**

Scope IDs: **F4** (search and filters), **F5** (browse, nearby, machines for rent), the search half of **F3** (side
filter, side words, Pair), **U2** (buyer finds a part) in `docs/product-scope.txt`; modules **M2** (home and discovery),
**M3** (search and filters) and the search part of **M8** (Left / Right / Pair matching) in `docs/product-scope.md`.

Follows the textile project (`C:\Users\Dell\Desktop\textile stock marketplace`, also `E:\textile-marketplace`):
- Specs: `docs/superpowers/specs/2026-11-05-m2-m5-discovery-lot-page-design.md` (feed, ranking, distance, visibility,
  saved lots, guest navigation) and `docs/superpowers/specs/2026-11-08-part2-m3-m9-search-requirements-design.md`
  (query reader, synonyms, search text, facets, suggestions, search log).
- Code: `apps/api/src/services/search/*` (`normalize.ts`, `query-reader.ts`, `search-text.ts`, `filters.ts`,
  `facets.ts`, `suggest.service.ts`, `search-log.service.ts`, `synonyms.ts`), `services/discovery/*` (`feed.service.ts`
  sealed keyset cursor, `ranking.ts`, `distance.ts`, `visibility.ts`, `saved.service.ts`), `routes/search.ts`,
  `routes/discover.ts`; app `screens/search.tsx`, `components/search/{FilterSheet,SortSheet,QueryChips}.tsx`,
  `lib/search-filters.ts`, `lib/recent-searches.ts`, `hooks/use-discovery.ts`.
- Kept from textile: Postgres only (no search engine), a stored normalised search text rebuilt by the API in the same
  transaction as every write, twin TS / SQL normaliser, query reader that turns words into removable chips, admin-managed
  synonyms with a 60 s in-process cache, disjunctive facets on the first page only, AES-GCM sealed keyset cursor,
  coordinates only in POST bodies and snapped to a grid, anonymous search log with trending and zero-results reports.
- **Changed from textile** (its known gaps): matching uses the indexable `pg_trgm` forms (`LIKE` on the column itself and
  the `<%` operator with `pg_trgm.word_similarity_threshold`), checked by an `EXPLAIN` test, instead of an expression
  around the column and the `word_similarity()` function call, which can't use the GIN index; part numbers match exactly
  on F2's `part_number_norm` / `part_number_base`; the home feed is two fixed sections instead of an admin layout.

Built on F2 + F3 + A3 (`docs/superpowers/specs/2026-11-18-f2-f3-listings-design.md`): `publicListingWhere()`
(`services/listings/public-where.service.ts`), `loadCards()` / `ListingCard` (`services/listings/listing-view.service.ts`),
the other-side distance code (`other-side.service.ts`), the listing page and `ListingCard` component in the app. F2 §13.3
said F4 adds the text-search columns and indexes; F2 R23 left "similar parts nearby" to F4 (still deferred, §15).

---

## 1. Goals

1. A buyer finds the exact part fast by any identifier a mechanic has: part name, part number, machine brand, model,
   side, or a listing's `#ref`, with typos and local words understood.
2. Results are near the buyer by default (GPS), filterable by everything in M3's MVP table, and sorted nearest first or
   by best match.
3. The side filter makes Left / Right / Pair work: Left finds left parts first and pairs that contain one.
4. Home opens on what's useful nearby: top items near you and machines for rent nearby; Browse walks the admin catalogue
   with live counts.
5. Guests browse, search and open listings without an account; sign-in is asked only at the moment of intent (Save
   now; Enquire, Offer, Post later).
6. Buyers save listings and see what they viewed recently.
7. The category manager keeps search good: synonyms, and a report of searches that found nothing.

## 2. Non-goals (deferred, see §15)

Near-me map; saved searches and their alerts (M12, F8/F9); the side-match strip, "Buyers looking for your parts", Wanted
tabs and the "Post a requirement" button on No results (all need part requests, F8); rental date availability ("free on
your dates", needs bookings, F7); interchange / superseded part numbers (M4 depth); enquire-all basket (P2); featured
listings (A6); "My machines" (M4); similar parts nearby on the listing page; notifications bell (F9); image and voice
search (P2).

## 3. Rulings

| # | Ruling |
|---|---|
| R1 | **Postgres only.** Text match on stored, normalised `search_text` / `search_title_text` with `pg_trgm` GIN indexes; no Meilisearch until volume needs it (CLAUDE.md). |
| R2 | **Location comes from the phone's GPS** (owner's choice). Home asks for foreground permission the first time it opens. Refused or unavailable: a signed-in user falls back to the business location; a guest to a pincode they type, else All India. |
| R3 | Coordinates travel only in POST bodies, are snapped to a 0.01° grid by the server, are never stored or logged, and only whole km go back. |
| R4 | Default radius **50 km**; choices 10 / 25 / 50 / 100 / 200 km and All India; remembered on the phone. |
| R5 | Every published listing has a **search point**: its own `point`, else the centroid of its pincode's post offices. |
| R6 | **Side filter (owner's choice):** Left returns Left listings first, then Pair listings tagged "Pair: contains a left". Right likewise. Pair returns only Pairs. Listings with no side or `not_applicable` never match a side filter. |
| R7 | **Statuses (owner's choice):** search, home, browse counts and suggestions count `live` and `reserved` listings (Reserved tagged). `rented` shows only for `machine_rental`, tagged "On rent" and ranked after available ones. Everything else stays reachable only by link (F2). All on top of `publicListingWhere()`. |
| R8 | The query reader turns `#ref`, part numbers, side words, brand, model and category names into **removable chips**; the remaining words must all match (partial fallback, §5.6). Words never become spec filters. |
| R9 | Side words (en / hi / gu) are **admin-managed synonyms** with target kind `side` (business rule 10), seeded. |
| R10 | Sort: **best match** is the default with words, **nearest** without words when a location is known, **newest** otherwise. |
| R11 | Keyset pages of 20 with a **sealed cursor** (AES-256-GCM, bound to the sort and the request's hash); `total` and facets on the first page only. |
| R12 | **Guests browse** (business rule 2): the app opens on the tabs without an account; Save asks to sign in through a sheet and finishes the save after sign-in (pending action). Post, Chats and Deals ask to sign in when opened. |
| R13 | Recently viewed and recent searches live **on the phone only** (no server history of what a person viewed). |
| R14 | The search log is **anonymous**: normalised query, result count, day; no user, device, IP or location. Deleted after 90 days. |
| R15 | Home's first three tiles are **kind shortcuts** (Spare parts → parts, Machinery → machines for sale, For rent → rentals), then the root categories in admin order (mockup). |
| R16 | Video filter hidden while `LISTING_VIDEO_UPLOAD_ENABLED` is false. |

---

## 4. Data model (one Drizzle migration + one custom migration)

### 4.1 `listings` (new columns)

| Column | Type | Notes |
|---|---|---|
| `search_title_text` | `text NOT NULL DEFAULT ''` | Normalised title + part number (as typed) + part brand name + category path names (machine category › machine type › part group). |
| `search_text` | `text NOT NULL DEFAULT ''` | `search_title_text` + fitment and machine brand / model names (and `*_other` text) + spec values (option labels in en, hi and gu for select fields, raw text / numbers otherwise) + condition label + side words for the listing's side (en only: "left", "right", "pair"). Starts with `search_title_text` (prefix, as textile). |
| `search_point` | `geography(Point,4326)` | R5. Null only when neither a point nor a pincode with points exists. |
| `search_refreshed_at` | `timestamptz` | When the three columns were last rebuilt. |

Indexes: GIN `gin_trgm_ops` on `search_text` (`listings_search_text_trgm_idx`) and on `search_title_text`
(`listings_search_title_text_trgm_idx`); GiST on `search_point` (`listings_search_point_idx`); partial btree
`listings_public_refreshed_idx` on (`kind`, `refreshed_at` DESC) `WHERE status IN ('live','reserved','rented')`.

Phone numbers in seller text are already refused or masked by F2's sanity checks; `search_text` takes the stored
(masked) title and spec text, never the description (descriptions are free text: too noisy for matching and a phone
number channel).

### 4.2 `search_synonyms`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `term` | text | As the admin typed it ("TRE", "बायाँ"). |
| `term_norm` | text NOT NULL | Normalised (§5.1). |
| `script` | enum `search_script` (`latin`, `devanagari`, `gujarati`) | Derived from the term. |
| `target_kind` | enum `synonym_target` (`category`, `brand`, `model`, `side`, `word`) | |
| `target_id` | uuid null | Category / brand / model id (no FK across three tables; checked in the service, cleaned when the target is deleted). |
| `target_side` | `part_side` null | `left`, `right`, `pair` for `side`. |
| `target_word` | text null | Normalised replacement words for `word` ("tie rod end"). |
| `is_active` | bool default true | |
| `created_by`, `updated_by` | uuid → `admin_users` | |
| timestamps | | |

CHECK `search_synonyms_target_shape`: exactly the field for its kind is set. Unique (`term_norm`, `target_kind`,
coalesce of the target) — the same term can point at two targets (ambiguity resolved in §5.3).

### 4.3 `search_queries` (anonymous log, R14)

`id` bigserial, `normalized` text (≤ 200), `words` smallint, `result_total` int, `kind` `listing_kind` null (when the
search was scoped to one kind), `day` date (IST), `created_at`. Index (`day`, `normalized`).

### 4.4 `saved_listings`

`user_id` → `users` ON DELETE CASCADE, `listing_id` → `listings` ON DELETE CASCADE, `created_at`; PK (`user_id`,
`listing_id`); index (`user_id`, `created_at` DESC, `listing_id`). Cap: 500 per user (`409 SAVED_LIMIT`).

### 4.5 Custom migration

`drizzle-kit generate --custom`: the two GIN trigram indexes if Drizzle can't express the opclass, and an SQL
`mpm_normalize_search(text)` function, the SQL twin of the TS normaliser (§5.1), used by the synonym admin's live
preview and by tests that compare the twins. The backfill of existing listings is a script, not SQL:
`pnpm --filter @mpm/api db:backfill:search` (batches of 200, idempotent).

### 4.6 Shared types (`packages/shared-types`)

`DISCOVERY_RADII_KM = [10, 25, 50, 100, 200] as const`, `DEFAULT_RADIUS_KM = 50`, `SEARCH_SORTS = ['best_match',
'nearest', 'newest', 'price_asc', 'price_desc', 'year_desc', 'hours_asc']`, `MIN_QTY_STEPS = [2, 10, 50]`,
`SYNONYM_TARGETS`, `SEARCH_SCRIPTS`, interfaces `DiscoveryOrigin`, `SearchFilters`, `SearchRequest`, `QueryReading`,
`SearchFacets`, `SearchPage`, `HomeView`, `BrowseView`, `Suggestion`, `SavedListingItem`, `SearchSynonym`; and
`ListingCard` gains `saved: boolean | null` (null for guests and where not computed), `distanceKm` already exists,
`tags: ListingCardTag[]` (`reserved`, `on_rent`, `pair_contains_left`, `pair_contains_right`).

---

## 5. Search

### 5.1 Normalisation

`normalizeSearchText(s)` (`services/discovery/normalize.ts`) and its SQL twin: NFKD, drop combining accents, lower-case,
Devanagari and Gujarati digits → ASCII, every character outside `[a-z0-9]` and the Devanagari / Gujarati blocks becomes
a space, collapse spaces, trim. A test feeds the same 40 strings to both and compares. Part numbers use F2's existing
part-number normaliser (the one that fills `part_number_norm` / `part_number_base`), not this one.

### 5.2 Search text refresh

`refreshListingSearch(tx, listingIds)` (`services/discovery/search-text.ts`) rebuilds §4.1's columns from the listing,
its category path, part brand, fitments, machine details, specs (option labels from `template_field_options`, all three
languages), condition and side, and sets `search_point` = `point` or the pincode centroid
(`ST_Centroid(ST_Collect(point::geometry))::geography` over `pincode_offices` with that pincode).

Called **in the same transaction** by every listing write that changes any of those inputs: create, patch (any field
above), fitments, machine details, location, publish, relist, and admin edits. A test walks every write path in
`listing-write.service.ts` / `listing-lifecycle.service.ts` and asserts `search_refreshed_at` moved.

`refreshSearchForCatalog(tx, { categoryId } | { brandId } | { modelId } | { fieldId } | { conditionId })` runs inside
the catalogue admin's rename / move / option-label / delete transactions: it selects affected listing ids (a category
and its descendants by `path` prefix), locks them `FOR UPDATE` in id order, and rebuilds in batches of 200.

### 5.3 Query reader

`readQuery(raw, dict)` (`services/discovery/query-reader.ts`, pure, unit-tested) with `dict` from `loadReaderDictionary()`
(active synonyms + active category, brand and model names; cached in-process 60 s, cleared on any synonym or catalogue
write). Steps, in order:

1. **`#ref`**: `#100123` or a bare 6-digit number starting with 1 that equals a public listing's `ref` → `reading.ref`;
   the route answers `{ data: { redirect: { listingId } } }` and the app opens the listing (scope M3, F2 R35).
2. **Part numbers**: a token with at least one digit and one letter, or ≥ 5 digits, length ≥ 4 after F2's part-number
   normalisation (dashes, dots, slashes, spaces between such tokens joined) → `reading.partNumbers` (max 3).
3. **Side words**: synonyms with target `side` (seed: left, lh, l h, left hand, left side, लेफ्ट, लेफ़्ट, बायाँ, बायां,
   बाएँ, बाएं; right, rh, r h, right hand, right side, राइट, दायाँ, दायां, दाएँ, दाएं; pair, जोड़ी, जोड़ा; લેફ્ટ, ડાબું,
   ડાબી, ડાબો, રાઇટ, જમણું, જમણી, જમણો, જોડી; no single letters and no "set", which would misfire; the plan lists the
   final seed) → `reading.side` (first wins).
4. **Synonym phrases** (longest first, up to 4 words): `word` synonyms replace the phrase with their words; `category` /
   `brand` / `model` synonyms behave like the names in step 5.
5. **Names**: brand names (all words of the name present as a phrase) → `reading.brand`; model names → `reading.model`
   (a model whose brand was also read wins; a model name shared by two brands with no brand read is left as words);
   category names, deepest level first, tie broken by most public listings, still tied → none (textile `readCategory`)
   → `reading.category`.
6. **Remaining words**: stop words dropped (`search.stop_words` in `app_settings`, seeded with en / hi / gu fillers:
   for, of, the, and, with, ka, ki, ke, का, की, के, નું, ની, ના…), max 10.

The route applies chips as filters unless the request lists them in `removedChips: ('side'|'brand'|'model'|'category')[]`;
a removed chip's words go back into the word list. Chips set explicitly as filters (from a suggestion or the filter
screen) override what the reader found.

### 5.4 Matching (R1, indexable)

For each remaining word `w` (normalised):
- `len(w) ≥ 3`: hit = `search_text LIKE '%' || w || '%'` (served by `listings_search_text_trgm_idx`); words ≥ 5 chars with
  no digit also hit by `w <% search_text` with `SET LOCAL pg_trgm.word_similarity_threshold = 0.6` (typos).
- `len(w) < 3`: hit = whole-word match `(' ' || search_text || ' ') LIKE '% ' || w || ' %'` (not indexed; such words are
  rare once side words are read, and the other conditions narrow the rows first).

Part numbers: hit = `part_number_norm = pn OR part_number_base = base(pn)` (existing btree indexes) OR
`search_text LIKE '%' || lower(pn) || '%'`.

An `EXPLAIN` test (on `mpm_test`, `SET LOCAL enable_seqscan = off`) asserts a three-word search uses
`listings_search_text_trgm_idx` and a part-number search uses `listings_part_number_norm_idx`.

### 5.5 Score (best match)

Packed into one `float8`, compared descending (textile's tiering):
`match·1e7 + sideTier·1e6 + statusTier·1e5 + clamp(relevance, 0, 99 999)` where
- `match` = Σ per word: title hit 3, other text hit 1; + 10 per exact part-number hit (`part_number_norm`), + 6 per base
  hit; + 3 when the read category, brand or model matches through the chip (chips filter, so this only orders partials).
- `sideTier` = 1 for the exact side, 0 for a Pair shown under Left / Right (R6).
- `statusTier` = 1 for `live` (and available rentals), 0 for `reserved` / `rented`.
- `relevance` = §6.1 × 1000, rounded.

### 5.6 Full, partial, empty

1. **Full**: every word and every part number hits.
2. **Partial** (when full finds nothing and there are ≥ 2 words): at least ceil(n/2) words hit, at least one of them in
   `search_title_text`, and every chip still applies. Response `partial: true`; the app shows "No exact matches. Showing
   close ones."
3. **Empty**: the response carries `widen`: the smallest larger radius (from `DISCOVERY_RADII_KM`, then All India) that
   has results and its count, computed in one query with `count(*) FILTER (WHERE distance ≤ r)` per radius; null when
   All India has none too or no location is known.

### 5.7 Filters (`SearchFilters`)

| Filter | Field | Rule |
|---|---|---|
| Listing type | `kinds: ListingKind[]` | Empty = all. |
| Category | `categoryId` | That node and its descendants (`categories.path LIKE node.path || '%'`). |
| Side | `side: 'left'\|'right'\|'pair'` | R6. |
| Fits machine | `fit: { brandId, modelId?, year? }` | A fitment row with that brand (and model; `year` between `year_from` / `year_to`, open ends match) **or** a machine listing with that brand / model (and `year`). |
| Condition | `conditionIds: uuid[]` | |
| Distance | `radiusKm: 10\|25\|50\|100\|200\|null` | `ST_DWithin(search_point, origin, r·1000)`; null = All India; ignored with no origin. |
| Place | `states[]`, `cities[]`, `industrialAreaIds[]` | Multi-select, OR within a group. |
| Price | `priceMinPaise`, `priceMaxPaise`, `hidePriceOnRequest` | Per unit for parts and machines; rentals compare the headline day rate. Price-on-request listings pass a range unless hidden. |
| Quantity | `minQty: 2\|10\|50` | `quantity ≥ n`. |
| Seller | `gstVerifiedOnly`, `delivers` | `businesses.verification_levels ? 'gst'`; `delivery && '{ship,local_delivery}'`. |
| Specs | `specs: Record<key, string[] \| { min?, max? }>` | Only `template_fields.filterable` select / number fields of the category in play and its ancestors, for the kind in play (`applies_to`); others → `400 FILTER_NOT_AVAILABLE`. A blank spec fails a hard filter. |

Zod schema strict; unknown keys → 400. `cleanFilters()` in shared-types drops empty values so the cursor seal is stable.

### 5.8 Sort

`best_match` (§5.5), `nearest` (distance, then §5.5's tiers; `400 LOCATION_REQUIRED` with no origin), `newest`
(`refreshed_at` DESC), `price_asc` / `price_desc` (per-unit or day rate; price on request last), `year_desc` and
`hours_asc` (machines; `400 SORT_NEEDS_MACHINES` unless `kinds` ⊆ machine, machine_rental). Every sort ends with `id`
for a stable keyset.

### 5.9 Facets (first page only)

Disjunctive, as textile `facets.ts`: each group counted with every filter except its own. Groups: `kinds`, `side`
(left / right / pair exact counts), `conditions`, `gstVerified`, `delivers`, `states` (top 10), and for a category in
play its filterable spec fields (select: count per option; number: min / max). One scalar query with
`count(*) FILTER (WHERE …)` plus grouped queries in parallel.

### 5.10 Count-only

`countOnly: true` returns `{ total }` without items, facets or log, for the Filters screen's live "Show 14 results"
button (debounced 300 ms in the app).

### 5.11 Suggestions and trending

- `GET /discover/suggest?q=` (≥ 2 chars after normalisation, max 8): part groups and machine types (name prefix, `LIKE`,
  or `<%` at 0.5, or a category synonym), brands, models; each with its All India public count (a GET carries no
  coordinates); zero-count entries dropped. Shape `Suggestion { type: 'category'|'brand'|'model', id, name, path: string[],
  liveCount }`. Rate limit 120 / min per IP.
- `GET /discover/trending`: top 10 normalised queries of the last 7 days with `result_total > 0` searched ≥ 3 times.

### 5.12 Search log

Written on the first page of a search with words or part numbers (not count-only, not suggest). Job
`search-query-retention` (daily, `FOR UPDATE SKIP LOCKED` batches) deletes rows older than 90 days. Zero-result report:
top 50 of the last 30 days with `result_total = 0`.

---

## 6. Ranking, distance, origin

### 6.1 Relevance (no words)

`ranking.ts`, constants with tests (admin tuning later):
`0.40·0.5^(ageDays/14) + 0.30·nearness + 0.10·photos + 0.10·gst + 0.10·completeness`, where `ageDays` is from
`refreshed_at` (a renewal resets it), `nearness` = `max(0, 1 − km / max(radiusKm ?? 200, 50))` (0 without an origin),
`photos` = 1 with ≥ 3 photos, `gst` = 1 for a GST-verified seller, `completeness` = share of the template's required and
recommended fields filled. Then `× 0.6` for `reserved` and for `rented` rentals.

### 6.2 Distance

`services/discovery/distance.ts`, shared with F2's other side (moved there): both points snapped with
`ST_SnapToGrid(p::geometry, 0.01)::geography`; `distanceKm` = whole km (`floor`), minimum 1; the app shows "Under 2 km"
for 1. A listing with no `search_point` has `distanceKm: null` and sorts last under `nearest`.

### 6.3 Origin (`DiscoveryOrigin`, R2)

`{ point: { lat, lng } } | { pincode } | { business: true } | null` in every POST body:
- `point`: from the phone's GPS; validated to India's bounding box (`400 ORIGIN_OUT_OF_RANGE`), snapped.
- `pincode`: a guest's typed pincode → centroid of its offices (`400 PINCODE_UNKNOWN`).
- `business`: signed-in only (`401` for guests); the business's `location`, else its pincode centroid; no business yet →
  null.
- The response echoes `origin: { label, source: 'gps'|'pincode'|'business'|null }`, the label from the nearest pincode
  office (industrial area and city when the business location is used) — never coordinates.

---

## 7. API

All public routes use `fastify.optionalUser`; replies `{ data }`; rate limits per IP (search 60 / min, the others 120 /
min). New files: `routes/discover.ts`, `services/discovery/*`.

| Route | Body / params | Reply |
|---|---|---|
| `POST /discover/search` | `SearchRequest { q?, filters?, removedChips?, sort?, origin?, cursor?, countOnly? }` | `SearchPage { items: ListingCard[], nextCursor, total?, reading: QueryReading, partial, widen, facets?, origin }`, or `{ redirect: { listingId } }` for a `#ref`. |
| `GET /discover/suggest?q=` | | `Suggestion[]` |
| `GET /discover/trending` | | `string[]` |
| `POST /discover/home` | `{ origin?, radiusKm? }` | `HomeView { origin, radiusKm, kindTiles, rootCategories: { id, name, icon }[], topNearYou: ListingCard[] (8), rentNearby: ListingCard[] (8) }` |
| `POST /discover/browse` | `{ parentId?, kinds?, origin?, radiusKm? }` | `BrowseView { node, crumbs, children: { id, name, level, icon, liveCount }[], popularBrands: { id, name, liveCount }[] (6) }` |
| `POST /discover/browse/brand` | `{ brandId, kinds?, origin?, radiusKm? }` | `{ brand, models: { id, name, liveCount }[], otherCount }` |
| `POST /discover/cards` | `{ ids: uuid[] (≤ 20), origin? }` | `ListingCard[]` of the ids still public, in the given order (recently viewed). |
| `GET /users/me/saved-listings?cursor=` | JWT | `{ items: SavedListingItem[], nextCursor }`; an item is `{ listingId, savedAt, card: ListingCard } \| { listingId, savedAt, unavailable: true }`. |
| `PUT /users/me/saved-listings/:listingId` | JWT | `{ saved: true }`; `404 LISTING_NOT_FOUND` unless public (F2's code for a non-public listing); `409 CANNOT_SAVE_OWN_LISTING`; `409 SAVED_LIMIT`. Idempotent. |
| `DELETE /users/me/saved-listings/:listingId` | JWT | `{ saved: false }`, always. |
| `GET /categories?depth=1` | | Roots only (closes the "whole tree" open item for Home and onboarding chips). |

Home details: `topNearYou` = kinds part + machine, relevance (§6.1) within the radius, restricted to the signed-in
business's machine categories when it has some and that gives ≥ 4 items (else unrestricted); `rentNearby` = rentals,
available first. "See all" opens search with the same kinds and radius and no words. `kindTiles` carry public counts
within the radius.

Browse counts: one grouped query per call (listings joined to their category, counted under each child by `path`
prefix), within the radius when an origin is given, else All India. Children with no listings are hidden; if every
child is empty the app shows the widen hint from a second count at All India.

`loadCards()` gains the viewer's user id (for `saved`), the origin (for `distanceKm`) and the side filter (for the Pair
tags), so every list of cards (F2's included) can show the heart.

### 7.1 Admin API (category_manager; super_admin passes)

| Route | |
|---|---|
| `GET /admin/search/synonyms?q=&targetKind=&cursor=` | List with target names. |
| `POST /admin/search/synonyms`, `PATCH /admin/search/synonyms/:id`, `DELETE /admin/search/synonyms/:id` | Validate the target exists and is active; `409 SYNONYM_EXISTS`; audit-logged (`search_synonym.create / update / delete`, before / after); clears the reader cache. |
| `POST /admin/search/synonyms/preview` | `{ q }` → the `QueryReading` the reader produces now (try a synonym before saving). |
| `GET /admin/search/zero-results` | Top 50 of 30 days: `{ normalized, searches, lastDay }`. |
| `GET /admin/search/trending` | Top 20 of 7 days with counts. |

Seed: `pnpm --filter @mpm/api db:seed:search` loads the side words (§5.3), ~60 machine-parts synonyms (TRE → tie rod
end, fender → mudguard, bush → bushing, brg → bearing, cyl → cylinder, hyd → hydraulic, assy → assembly, गियर → gear,
બેરિંગ → bearing…; the plan lists them) and the stop words; refuses on a filled table.

---

## 8. App

### 8.1 Guest navigation (R12)

- Welcome gets a second button, **"Browse first"** (`Welcome-browse`), next to the phone sign-in. It opens the tabs as a
  guest. A guest's root stack holds the tabs, the listing page, search results, and the auth screens (pushed when
  needed). On a fresh install the Welcome screen still comes first.
- `useRequireSignIn()` (`hooks/use-require-sign-in.ts`): `requireSignIn({ reason, pending })` opens the sign-in sheet
  (`SignInSheet`, `reason` copy: save, post, chats, deals); after OTP and onboarding finish, the pending action runs once
  (`pending` is a serialisable `{ type: 'save', listingId }` kept in the auth slice, dropped on cancel). Onboarding still
  gates a signed-in user without a business.
- Post, Chats and Deals tabs show the sheet when a guest opens them; Profile shows a "Sign in" card instead of the
  business rows (language stays available).
- Analytics: `auth_sign_in_prompted { reason }`, `auth_pending_action_completed { type }`.

### 8.2 Location (R2–R4)

`lib/discovery-origin.ts` + `hooks/use-discovery-origin.ts`:
- First Home focus: `expo-location` foreground permission. Granted → `getCurrentPositionAsync` (balanced accuracy),
  cached 10 minutes, rounded to 3 decimals on the phone (the server snaps to 2). Denied → signed-in `{ business: true }`;
  guest the saved pincode, else null (All India, newest).
- Never asks again by itself after a refusal; the location sheet's "Use my location" asks again, or opens the system
  settings when the permission is blocked.
- `LocationSheet`: Use my location · Use my business location (signed-in) · Enter pincode (6 digits, hi/gu digits
  accepted) · radius chips (10 / 25 / 50 / 100 / 200 km, All India). Radius and pincode in AsyncStorage
  (`discover.radius.v1`, `discover.pincode.v1`); coordinates are not stored.
- The chip on Home shows the server's `origin.label` and "Within 50 km" / "All India".

### 8.3 Home (mockup "Home")

`screens/tabs/home.tsx` rebuilt: location chip (opens `LocationSheet`) · search bar (opens Search focused) · tiles row
(kind tiles then root categories, `thumb` art per mockup; a kind tile opens results with that kind, a category tile
opens Browse at that node) · **Top items near you** (2-column `GridCard`s, "See all") · **Machines for rent nearby**
(horizontal `MiniCard`s) · **Recently viewed** (list rows, hidden when empty). Pull to refresh; skeletons; empty state
"Nothing within 50 km yet" with the widen button. No bell and no side-match strip until F9 / F8.

### 8.4 Search tab (mockups "Browse by machine", "Search results", "Filters", "No results", "Machines for rent")

- **Start**: search bar; **Browse** (crumbs, tree rows with counts, "Popular brands here" chips → brand view with models
  and counts → results with the fit filter); recent searches (`search.recent.v1`, 10, clear) and trending.
- **Typing**: suggestions (category with its path, brand, model) and "Search for '…'"; 250 ms debounce.
- **Results** (`screens/search/results.tsx`, stack screen `SearchResults` with params `{ q?, kinds?, categoryId?, fit?,
  side? }`): filter row (Filters with count, the reader's chips removable with ×, radius chip, quick chips Used / New /
  Price), count line ("14 results, nearest first"), `ListingCard` list (heart, side token, tags Reserved / On rent /
  "Pair: contains a left"), infinite scroll (`useInfiniteQuery`, `nextCursor`, `CURSOR_INVALID` resets); rentals-only
  results use the `GridCard` grid; partial banner; Sort sheet.
- **Filters** screen (full screen, per mockup): side picker (`SideToken`s), condition chips, fits machine (brand → model
  → year pickers), distance (radius chips), place (state / city / industrial area multi-pick), price per unit min / max +
  hide price on request, quantity chips, seller chips (GST verified only, delivers), spec fields of the category in play;
  facet counts beside options; "Clear all"; footer "Show 14 results" from count-only.
- **No results**: mockup empty state with "Widen to 100 km · 2 results" when `widen` is set; the requirement prefill
  card waits for F8.
- State: screen `useState` for the request (as textile), route params seed it; React Query keys under `['discover', …]`
  so a save toggle patches every cached card.

### 8.5 Saved and recently viewed

- Heart (`SaveButton`) on `ListingCard`, `GridCard` and the listing page header; optimistic, rolls back on error; guest →
  `requireSignIn({ reason: 'save', pending: { type: 'save', listingId } })`.
- **Saved** screen (`screens/saved.tsx`, mockup "Saved" without the enquire-all bar): from a new Profile row "Saved
  (n)"; unavailable items show "No longer available" and Remove.
- Recently viewed: the listing page records its id (`discover.recent.v1`, 20, newest first, own listings skipped);
  Home loads cards through `POST /discover/cards`.

### 8.6 Kit additions

`GridCard` (v2 `.gcard`: product shot, badge, heart, title, price), `MiniCard` (v2 `.mini`), `SaveButton`, `FilterChipRow`,
`LocationChip`, `SignInSheet`; `ListingCard` gains `saved`, `tags`, `distance`. All through `useTheme()` (light only),
`useType()`, `t()` in en / hi / gu, `testID` on every pressable. Analytics: `SEARCH_EVENTS` (`search_submitted { words,
chips, kinds }`, `search_result_opened { position }`, `search_filters_applied { count }`, `search_widened`,
`search_zero_results`), `DISCOVERY_EVENTS` (`home_tile_opened`, `browse_node_opened`, `location_permission_answered
{ granted }`, `location_changed { source, radiusKm }`), `SAVED_EVENTS` (`listing_saved`, `listing_unsaved`); never the
query text or coordinates.

## 9. Admin

Two pages under **Catalogue** in the nav (`roles: ['category_manager']`):
- **Search synonyms**: table (term, script, target, active, updated), filter by target kind, add / edit dialog (term,
  target kind, target picker: category tree / brand / model / side / words), delete with confirm, a "Try a search" box
  showing the reader's chips live (preview route).
- **Zero-result searches**: top 50 of 30 days with counts and last day, and a "Make a synonym" action that opens the add
  dialog with the term filled; trending (7 days) beside it.

## 10. Errors (new codes)

`LOCATION_REQUIRED`, `SORT_NEEDS_MACHINES`, `FILTER_NOT_AVAILABLE`, `CURSOR_INVALID`, `ORIGIN_OUT_OF_RANGE`,
`PINCODE_UNKNOWN`, `CANNOT_SAVE_OWN_LISTING`, `SAVED_LIMIT`,
`SYNONYM_EXISTS`, `SYNONYM_TARGET_INVALID`. App error copy for each in en / hi / gu.

## 11. Privacy and security

- Coordinates: POST only, snapped, never stored or logged (R3); request bodies are not logged (Fastify's default; keep it so, and redact `origin` if body logging is ever turned on).

- Search log anonymous (R14); app analytics never carry query text, pincode or coordinates.
- Cursor sealed: key `sha256('mpm:discovery:cursor:v1:' + JWT_SECRET)`, AAD = sort + sha256 of the canonical request
  without the cursor; a tampered or foreign cursor is `400 CURSOR_INVALID`.
- Public cards and suggestions never expose pincode, address, point or phone (F2 rule kept).
- Saved and recently-viewed data never leave the owner's account / phone; DPDP export and deletion include
  `saved_listings` when that work lands (note in status).

## 12. Testing

- **API (integration, real Postgres + Redis, fixtures cleaned in `afterAll`)**: normaliser twins; query reader (pure,
  ≥ 40 cases incl. hi / gu side words, part numbers, refs, brand + model, ambiguity); search text refresh on every write
  path and catalogue rename; matching (typo, partial, empty + widen); side ranking (Left → left then pairs); statuses
  (reserved tagged, rented only in rentals, suspended owner hidden); every filter; every sort incl. 400s; facets
  disjunctive; sealed cursor (tamper, sort swap, request swap); count-only; origin (gps snap, pincode, business, guest
  `business` 401, out of India); home (category restriction fallback), browse counts within radius, brand view, cards
  order; saved (own, limit, unavailable, idempotent, cascade); suggest; trending; log written once and anonymous;
  retention job; synonym admin (RBAC, audit, cache cleared, target checks); `EXPLAIN` uses the trigram and part-number
  indexes.
- **App (Vitest, pure logic in `lib/`)**: origin resolution, radius / pincode storage, recent searches and recently
  viewed lists, `cleanFilters` / filter counts / chip summaries, pending action, side tag copy; i18n parity and audit;
  style audit.
- **Admin (Vitest + Testing Library)**: synonyms table and dialog, preview, zero-results "Make a synonym".
- Close-out: typecheck, lint, all tests, `mpm_test` left empty, admin build, `expo export --platform android`, a scripted
  API walk-through on the dev DB (two sellers, parts at known distances, search by part number / side word / typo,
  widen, saved), data deleted afterwards.

## 13. Build shape

C0 contracts (shared types, migrations, schema, error codes, `loadCards` signature, route stubs), then parallel lanes as
in F2 (worktrees on lane branches merged into `develop`, owner's lane rule):
L1 API search (normaliser, search text + refresh hooks, reader, synonyms, matching, filters, facets, sort, cursor,
search route, suggest, trending, log + job, backfill script); L2 API discovery (origin, distance move, ranking, home,
browse, brand view, cards, saved, `?depth=1`, synonym admin API, seed); L3 admin pages; L4 app foundation (guest
navigation, sign-in sheet + pending action, origin + location sheet, API clients and hooks, kit additions); L5 app
search (start, browse, suggestions, results, filters, sort, no results); L6 app home + saved + recently viewed. L5 and
L6 start after L4.

## 14. Risks

- SQL search won't scale forever; the trigram indexes and facet queries need watching (log slow queries > 300 ms). The
  way out is a search engine fed from the same refresh hook.
- Ranking constants and synonyms need tuning on real data before launch (zero-result report).
- Category reading can pick the wrong node on short queries; the chip is removable and the test set covers the seed.
- GPS on first Home open may be refused often; the fallbacks keep Home useful, and the chip makes the choice visible.
- Guest navigation touches the root navigator; regressions in sign-in / onboarding gating are covered by its tests and
  the device pass.

## 15. Deferred

Near-me map (M2); saved searches + alerts (M12, with F8 / F9); side-match strip, buyers looking for your parts, Wanted
tabs, requirement prefill on No results (F8); rental date availability (F7 bookings); interchange / superseded numbers
and "My machines" (M4); similar parts nearby (F2 R23); enquire-all basket (P2); featured listings (A6); notifications
bell (F9); image / voice search, personalised ranking, trending per cluster (P2); admin tuning of ranking constants.
