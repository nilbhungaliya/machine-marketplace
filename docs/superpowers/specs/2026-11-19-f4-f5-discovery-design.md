# F4 + F5 discovery: search, filters, browse, home, saved — design

Date: 2026-11-19. Status: **approved by the owner (2026-11-19) after three review rounds (§16, §16.1, §16.2); the
plan is `docs/superpowers/plans/2026-11-19-f4-f5-discovery.md`.**

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
- Kept from textile: Postgres only (no search engine), a stored normalised search text rebuilt by the API, twin TS / SQL
  normaliser, query reader that turns words into removable chips, admin-managed synonyms, disjunctive facets on the
  first page only, AES-GCM sealed keyset cursor with a frozen time, coordinates only in POST bodies and snapped to a
  grid, anonymous search log with trending and zero-results reports.
- **Changed from textile** (its known gaps): matching uses the indexable `pg_trgm` forms (`LIKE` on the column itself and
  the `<%` operator), checked by `EXPLAIN` tests, instead of an expression around the column and the `word_similarity()`
  call, which can't use the GIN index; part numbers match exactly on F2's `part_number_norm` / `part_number_base`;
  catalogue renames rebuild search text in a background job; the home feed is two fixed sections.

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
3. The side filter makes Left / Right / Pair work: Left finds left parts first and pairs that contain one after them.
4. Home opens on what's useful nearby: top items near you and machines for rent nearby; Browse walks the admin catalogue
   with live counts.
5. Guests browse, search and open listings without an account; sign-in is asked only at the moment of intent (Save
   now; Enquire, Offer, Post later).
6. Buyers save listings and see what they viewed recently.
7. The category manager keeps search good: synonyms, a report of searches that found nothing, a trending hide list.

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
| R2 | **Location comes from the phone's GPS** (owner's choice). Home asks for foreground permission the first time it opens. Refused, unavailable or outside India: a signed-in user falls back to the business location; a guest to a pincode they type, else All India. |
| R3 | Coordinates travel only in POST bodies, are snapped to a 0.01° grid by the server, are never stored or logged, and only whole km go back. |
| R4 | Default radius **50 km**; choices 10 / 25 / 50 / 100 / 200 km and All India; remembered on the phone. |
| R5 | Every published listing has a **search point**: its own `point`, else the centroid of its pincode's post offices. |
| R6 | **Side filter (owner's choice):** Left returns every Left listing first, then Pair listings tagged "Pair: contains a left", **in every sort** (the side tier sorts before the sort key). Right likewise. Pair returns only Pairs. Listings with no side or `not_applicable` never match a side filter. |
| R7 | **Statuses (owner's choice):** search, home, browse counts and suggestions count `live` and `reserved` listings (Reserved tagged, ranked down by relevance only). `rented` listings of kind `machine_rental` appear wherever rentals appear (listing type All or For rent; never under Parts or Machines for sale), tagged "On rent", and **after every available rental in every sort** (the rent tier sorts before the sort key). Everything else stays reachable only by link (F2). All on top of `publicListingWhere()`. |
| R8 | The query reader turns `#ref`, brand, model, category names, part numbers and side words into **removable chips**; the remaining words must all match (partial fallback, §5.6). Words never become spec filters. A removed side chip drops its side words entirely. |
| R9 | Side words (en / hi / gu) are **admin-managed synonyms** with target kind `side` (business rule 10), seeded. |
| R10 | Sort: **best match** is the default with words, **nearest** without words when a location is known, **newest** otherwise. |
| R11 | Keyset pages of 20 with a **sealed cursor** (AES-256-GCM, `DISCOVERY_CURSOR_SECRET`, bound to the sort and the request's hash, carrying a frozen `asOf` time); `total` and facets on the first page only. |
| R12 | **Guests browse** (business rule 2): the app opens on the tabs without an account; Save asks to sign in through a sheet and finishes the save after sign-in (pending action). Post, Chats and Deals ask to sign in when opened. |
| R13 | Recently viewed and recent searches live **on the phone only** (no server history of what a person viewed). |
| R14 | The search log is **anonymous**: normalised query, result count, day; no user, device, IP or location; queries that look like personal data are never logged. Deleted after 90 days. |
| R15 | Home's first three tiles are **kind shortcuts** (Spare parts → parts, Machinery → machines for sale, For rent → rentals), then the root categories in admin order (mockup). |
| R16 | The **has video** filter (§5.7) is hidden in the app while `LISTING_VIDEO_UPLOAD_ENABLED` is false; the API accepts it. |
| R17 | Rate limits are **per user** (signed in) or **per install id** (guests), with a high per-IP outer cap (carrier NAT puts many Jio / Airtel users behind one IP). The install id is client-chosen and can be faked on every request, so for guests the per-IP cap is the only real limit: **accepted for launch**, and the install-id limit is a fairness limit, not a security control. |
| R18 | **Origin is frozen per results list:** the app sends page 1's origin with every later page; a GPS refresh never changes a list being scrolled. Only a location change by the user (or a new search) starts a new list. |

---

## 4. Data model (one Drizzle migration + one custom migration)

### 4.1 `listings` (new columns)

| Column | Type | Notes |
|---|---|---|
| `search_title_text` | `text NOT NULL DEFAULT ''` | Normalised (§5.1): title + part number in two forms, `normalizeSearchText(part_number)` ("ab 123 x") **and** `lower(part_number_norm)` ("ab123x") + part brand name + category path names (machine category › machine type › part group). |
| `search_text` | `text NOT NULL DEFAULT ''` | `search_title_text` + fitment and machine brand / model names (and `*_other` text) + spec values (option label for select fields, raw text / numbers otherwise) + condition label. **No side words** (the side is a filter, R8). Starts with `search_title_text` (prefix, as textile). |
| `search_point` | `geography(Point,4326)` | R5. Null only when neither a point nor a pincode with points exists. |
| `search_refreshed_at` | `timestamptz` | When the three columns were last rebuilt. |

**`brands` (new column):** `chip_needs_context boolean NOT NULL DEFAULT false` — "read as a chip only with a model of the
brand or a machine type". For brands whose name is an ordinary word (Bull Machines → "bull", ACE, Action Construction Equipment →
"action"), so "bull gear" stays words. Set in the A4 brand dialog (checkbox, audit-logged as a brand edit); the catalogue
seed sets it for the plan's list (at least Bull and ACE).

Catalogue names and option labels are English only today; Hindi and Gujarati words reach search through synonyms
(seeded for common terms). If A4 later adds translated names, the refresh includes them.

Indexes: GIN `gin_trgm_ops` on `search_text` (`listings_search_text_trgm_idx`) and on `search_title_text`
(`listings_search_title_text_trgm_idx`); GiST on `search_point` (`listings_search_point_idx`); partial btree
`listings_public_refreshed_idx` on (`kind`, `refreshed_at` DESC) `WHERE status IN ('live','reserved','rented')`.

Phone numbers in seller text are already refused or masked by F2's sanity checks; `search_text` takes the stored
(masked) title and spec text, never the description (free text: too noisy for matching and a phone number channel).

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

CHECK `search_synonyms_target_shape`: exactly the field for its kind is set. Unique index on (`term_norm`,
`target_kind::text`, `coalesce(target_id::text, target_side::text, target_word)`) — every part cast to text. The same
term may point at two targets (ambiguity resolved in §5.3).

### 4.3 `search_queries` (anonymous log, R14) and `search_trending_hidden`

`search_queries`: `id` bigserial, `normalized` text (≤ 200), `words` smallint, `result_total` int, `kind`
`listing_kind` null, `day` date (IST), `created_at`. Index (`day`, `normalized`).

`search_trending_hidden`: `normalized` text PK, `created_by` → `admin_users`, `created_at`. Hidden queries never show in
trending.

### 4.4 `saved_listings`

`user_id` → `users` ON DELETE CASCADE, `listing_id` → `listings` ON DELETE CASCADE, `created_at`; PK (`user_id`,
`listing_id`); index (`user_id`, `created_at` DESC, `listing_id`). Cap: 500 per user (`409 SAVED_LIMIT`).

### 4.5 `search_refresh_jobs`

`id` uuid, `scope_kind` (`category`, `brand`, `model`, `field`, `condition`), `scope_id` uuid, `created_by` →
`admin_users`, `created_at`, `started_at`, `done_at`, `attempts` smallint, `last_error` text. Index on (`done_at`,
`created_at`) for pending rows. Written by catalogue admin transactions (§5.2).

### 4.6 Custom migration and backfill

`drizzle-kit generate --custom`: the two GIN trigram indexes if Drizzle can't express the opclass, and an SQL
`mpm_normalize_search(text)` function, the SQL twin of the TS normaliser (§5.1), used by the synonym admin's live
preview and by the twin test. The backfill of existing listings is a script: `pnpm --filter @mpm/api db:backfill:search`
(batches of 200, idempotent).

### 4.7 Shared types (`packages/shared-types`)

`DISCOVERY_RADII_KM = [10, 25, 50, 100, 200] as const`, `DEFAULT_RADIUS_KM = 50`, `SEARCH_SORTS = ['best_match',
'nearest', 'newest', 'price_asc', 'price_desc', 'year_desc', 'hours_asc']`, `MIN_QTY_STEPS = [2, 10, 50]`,
`SYNONYM_TARGETS`, `SEARCH_SCRIPTS`, `cleanFilters()`, interfaces `DiscoveryOrigin`, `SearchFilters`, `SearchRequest`,
`QueryReading`, `SearchFacets`, `SearchPage`, `HomeView`, `BrowseView`, `Suggestion`, `SavedListingItem`,
`SearchSynonym`; `ListingCard` gains `saved: boolean | null` (null for guests and where not computed) and
`tags: ListingCardTag[]` (`reserved`, `on_rent`, `pair_contains_left`, `pair_contains_right`).

### 4.8 Environment

`DISCOVERY_CURSOR_SECRET` (≥ 32 chars, required; in `.env.example`, a fresh value in dev `.env`; `env.ts` refuses to
start without it). Production Postgres must use a UTF-8 ctype (dev and test use `en_US.utf8`) so `pg_trgm` builds
trigrams from Devanagari and Gujarati; a test guards it (§12).

---

## 5. Search

### 5.1 Normalisation

`normalizeSearchText(s)` (`services/discovery/normalize.ts`) and its SQL twin:
1. NFKD, then remove **Latin combining marks only** (U+0300–U+036F), then NFC. Devanagari and Gujarati vowel signs,
   virama and nukta are kept (stripping every `\p{M}` would break Hindi and Gujarati words).
2. Delete ZWJ / ZWNJ (U+200D, U+200C) and soft hyphen (U+00AD) outright (some Indic keyboards insert them inside words;
   a space would split the word).
3. Lower-case; Devanagari and Gujarati digits → ASCII.
4. Every character outside `[a-z0-9]`, U+0900–U+097F and U+0A80–U+0AFF becomes a space; the dandas (U+0964, U+0965)
   become spaces too. Collapse spaces, trim.

A test feeds the same 40 strings (Latin accents, Hindi with nukta and virama, Gujarati, ZWJ / ZWNJ inside words, digits
in three scripts) to both twins and compares. Part numbers additionally use F2's part-number normaliser (the one that
fills `part_number_norm` / `part_number_base`).

### 5.2 Search text refresh

`refreshListingSearch(tx, listingIds)` (`services/discovery/search-text.ts`) rebuilds §4.1's columns from the listing,
its category path, part brand, fitments, machine details, spec option labels, condition and location, and sets
`search_point` = `point` or the pincode centroid (`ST_Centroid(ST_Collect(point::geometry))::geography` over
`pincode_offices` with that pincode).

- **Listing writes: synchronous**, in the same transaction, for every write that changes an input: create, patch (any
  field above), fitments, machine details, location, publish, relist, admin edits. A test walks every write path in
  `listing-write.service.ts` / `listing-lifecycle.service.ts` / `listing-admin.service.ts` and asserts
  `search_refreshed_at` moved.
- **Catalogue changes: background.** A category rename / move / delete, brand or model rename, option-label change or
  condition-label change writes one `search_refresh_jobs` row in the admin transaction (no listing locks there). Job
  `search-refresh` (every 30 s; claims a job row `FOR UPDATE SKIP LOCKED`) selects the affected listing ids (a category
  and its descendants by `path` prefix), then rebuilds them in batches of 200, each batch its own short transaction
  locking its listings `FOR UPDATE` in id order; marks the job done, or records `last_error` and retries (max 5
  attempts). Search shows old names for up to about a minute after a rename: accepted.

### 5.3 Query reader

`readQuery(raw, dict)` (`services/discovery/query-reader.ts`, pure, unit-tested). `dict` comes from
`loadReaderDictionary()`: active synonyms + active category, brand and model names, cached in-process and checked
against a Redis version key `discovery:reader:version` (incremented by every synonym or catalogue write) at most every
5 seconds, so every API instance sees a change within 5 s. Steps, in order:

1. **`#ref`**: only `#` followed by digits (`#100123`) that equals a public listing's `ref` → `reading.ref`; the route
   answers `{ data: { redirect: { listingId } } }` and the app opens the listing. A **bare** number is never a redirect
   (six-digit part numbers are common): when it equals a public listing's `ref`, the search runs normally and the
   response adds `refSuggestion: { listingId, ref }`, shown as a "Listing #123456" row above the results.
2. **Synonym phrases** (longest first, up to 4 words): `word` synonyms **add** an alternative: the phrase matches its own words **or** the target's words (an OR group, each side AND-ed, the group AND-ed with the other words), so "fender" finds both "Fender" and "Mudguard" listings; `category`
   / `brand` / `model` / `side` synonyms mark the phrase as that name.
3. **Names**: brand names (all words of the name as a phrase) → `reading.brand`, except a brand with
   `chip_needs_context` becomes a chip only when a model of that brand or a **machine type** (level `machine_type`, e.g.
   backhoe loader) is also read in the same query; a part group ("gears") or a machine category never unlocks it
   (else its words stay words); model names → `reading.model` (a model
   whose brand was also read wins; a model name shared by two brands with no brand read is left as words); category
   names, deepest level first, tie broken by most public listings, still tied → none (textile `readCategory`) →
   `reading.category`. Tokens consumed here are never part numbers, so `JS205`, `EX200`, `PC210` become a model chip.
4. **Part numbers**: among the tokens still free, one with at least one digit and one letter, or ≥ 5 digits, length ≥ 4
   after F2's part-number normalisation (dashes, dots, slashes, spaces between such tokens joined) →
   `reading.partNumbers` (max 3).
5. **Side words**: synonyms with target `side` (seed: left, lh, l h, left hand, left side, लेफ्ट, लेफ़्ट, बायाँ, बायां,
   बाएँ, बाएं; right, rh, r h, right hand, right side, राइट, दायाँ, दायां, दाएँ, दाएं; pair, जोड़ी, जोड़ा; લેફ્ટ, ડાબું,
   ડાબી, ડાબો, રાઇટ, જમણું, જમણી, જમણો, જોડી; no single letters and no "set", which would misfire; the plan lists the
   final seed) → `reading.side` (first wins).
6. **Remaining words**: stop words dropped (`search.stop_words` in `app_settings`, seeded with en / hi / gu fillers:
   for, of, the, and, with, ka, ki, ke, का, की, के, નું, ની, ના…), max 10.

The route applies chips as filters unless the request lists them in `removedChips: ('side'|'brand'|'model'|'category'|
'partNumber')[]`. A removed brand / model / category / part-number chip's words go back into the word list; a removed
**side** chip's words are dropped entirely (R8). Chips set explicitly as filters (from a suggestion or the filter
screen) override what the reader found.

### 5.4 Matching (R1, indexable)

For each remaining word `w` (normalised):
- `len(w) ≥ 3`: hit = `search_text LIKE '%' || w || '%'` (served by `listings_search_text_trgm_idx`); words ≥ 5 chars with
  no digit also hit by `w <% search_text` (typos) at `pg_trgm.word_similarity_threshold` 0.6. The database or role
  default is **not** relied on: every search (and count-only) runs its queries in one read-only transaction that first
  calls `set_config('pg_trgm.word_similarity_threshold', '0.6', true)`.
- `len(w) < 3`: hit = whole-word match `(' ' || search_text || ' ') LIKE '% ' || w || ' %'` (not indexed; such words are
  rare once side words are read, and the other conditions narrow the rows first).

Part number `pn`: hit = `part_number_norm = norm(pn) OR part_number_base = base(pn)` (existing btree indexes) OR
`search_text LIKE '%' || lower(norm(pn)) || '%'`, which matches the compact form stored in §4.1 (so "AB-123/X" typed as
"ab123x" or "AB 123 X" hits).

Suggestions use 0.5 the same way: `suggest` runs in one read-only transaction with
`set_config('pg_trgm.word_similarity_threshold', '0.5', true)`. Facet queries run inside the search's transaction
**sequentially** on its connection, so they see the same setting (a few more milliseconds on page 1, accepted for
simplicity).

### 5.5 Order keys (R6, R7)

Every sort orders by **(`tier` DESC, sort key, `id`)**:
- `tier` = `sideTier · 2 + rentTier`, where `sideTier` = 1 for the exact side and 0 for a Pair shown under Left / Right
  (1 for everything when no side filter), and `rentTier` = 1 for every listing except a `rented` rental (0). So under
  Left every Left listing comes before every Pair, and every available rental before every rented one, whatever the
  sort.
- Best match key: `match · 1e5 + clamp(relevance · 1000, 0, 99 999)` DESC, where `match` = Σ per word of its best hit:
  substring hit in the title 4, elsewhere 2; **typo (`<%`) hit worth half**: title 2, elsewhere 1; + 20 per exact
  part-number hit (`part_number_norm`), + 12 per base hit. Chips filter, so they add nothing.
- `relevance` = §6.1, computed from the cursor's `asOf` (§5.10), not from now.

### 5.6 Full, partial, widen, empty

1. **Full**: every word and every part number hits, within the radius.
2. When full finds nothing within the radius, the route computes both, in one round trip:
   - **`widen`** from **full matches**: the smallest larger radius (from `DISCOVERY_RADII_KM`, then All India) that has
     full matches, with its count (`count(*) FILTER (WHERE km ≤ r)` per radius); null when there are none anywhere or no
     location is known.
   - **Partial** within the radius (only with ≥ 2 words): at least ceil(n/2) words hit, at least one of them in
     `search_title_text`, **every part number still hits** (a part number is exact; only words relax), every chip still
     applies. Response `partial: true`.
3. The app shows partial results under a banner: "No exact matches within 50 km. 3 exact matches within 100 km
   [Widen]" (the second sentence only when `widen` is set). No partial results either: the No results state with the
   widen button.

### 5.7 Filters (`SearchFilters`)

| Filter | Field | Rule |
|---|---|---|
| Listing type | `kinds: ListingKind[]` | Empty = all. |
| Category | `categoryId` | That node and its descendants (`categories.path LIKE node.path || '%'`). |
| Side | `side: 'left'\|'right'\|'pair'` | R6. |
| Fits machine | `fit: { brandId, modelId?, year? }` | A fitment row with that brand (and model; `year` between `year_from` / `year_to`, open ends match) **or** a machine listing with that brand / model (and `year`). |
| Condition | `conditionIds: uuid[]` | |
| Distance | `radiusKm: 10\|25\|50\|100\|200\|null` | §6.2; null = All India; ignored with no origin. |
| Place | `states[]`, `cities[]`, `industrialAreaIds[]` | Multi-select, OR within a group. |
| Price | `priceMinPaise`, `priceMaxPaise`, `hidePriceOnRequest` | Per unit for parts and machines; rentals compare the headline day rate. Price-on-request listings pass a range unless hidden. |
| Quantity | `minQty: 2\|10\|50` | `quantity ≥ n`. |
| Seller | `gstVerifiedOnly`, `delivers` | `businesses.verification_levels ? 'gst'`; `delivery && '{ship,local_delivery}'`. |
| Has video | `hasVideo` | A ready video in `listing_media` (R16). |
| Specs | `specs: Record<key, string[] \| { min?, max? }>` | Only `template_fields.filterable` select / number fields of the category in play and its ancestors, for the kind in play (`applies_to`); others → `400 FILTER_NOT_AVAILABLE`. A blank spec fails a hard filter. |

Zod schema strict; unknown keys → 400. `cleanFilters()` drops empty values so the cursor seal is stable.

### 5.8 Sort

`best_match` (§5.5), `nearest` (order **tier, km, relevance DESC, id**: km is whole, so many listings tie and relevance
breaks the tie; `400 LOCATION_REQUIRED` with no origin), `newest` (`refreshed_at` DESC), `price_asc` / `price_desc` (per-unit or day rate; price on request last), `year_desc` and `hours_asc` (machines;
`400 SORT_NEEDS_MACHINES` unless `kinds` ⊆ machine, machine_rental). All under §5.5's tier first and `id` last.

### 5.9 Facets (first page only)

Disjunctive, as textile `facets.ts`: each group counted with every filter except its own. Groups: `kinds`, `side`,
`conditions`, `gstVerified`, `delivers`, `states` (top 10), and for a category in play its filterable spec fields
(select: count per option; number: min / max). The **side** facet counts what each choice returns: Left = Left + Pair,
Right = Right + Pair, Pair = Pair (so the facet equals the result count). One scalar query with
`count(*) FILTER (WHERE …)` plus the grouped queries, run one after another inside the search transaction (§5.4).

### 5.10 Cursor

Sealed with AES-256-GCM under `sha256('mpm:discovery:cursor:v1:' + DISCOVERY_CURSOR_SECRET)`, base64url. Payload
`{ asOf, tier, key, key2, id }` (`key2` = relevance for `nearest`); AAD = sort + sha256 of the canonical request without the cursor. `asOf` is the first page's
time: relevance ages are computed from it, and later pages only include listings with `refreshed_at ≤ asOf`, so scores
and membership don't move between pages (a renewal after page 1 shows on the next fresh search). Tampered, foreign or
mismatched → `400 CURSOR_INVALID`. The request hash includes the origin, so the app freezes it per list (R18, §8.4).
Saved listings use the same seal for their own keyset.

### 5.11 Count-only

`POST /discover/search/count` takes the same `SearchRequest` (without `cursor`) and returns `{ total, partialTotal }`
without items, facets or log, for the Filters screen's live footer (debounced 300 ms in the app). It is its **own path**
so its rate-limit bucket is chosen by the route (the limiter runs before the body is parsed, §7). `partialTotal` is computed only when `total` is 0 (and there
are ≥ 2 words), else null. Footer: "Show 14 results"; when the full total is 0 and partials exist, "No exact matches ·
Show 6 close ones"; when both are 0, "No results" (button disabled).

### 5.12 Suggestions and trending

- `GET /discover/suggest?q=` (≥ 2 chars after normalisation, max 8): part groups and machine types (name prefix, `LIKE`,
  or `<%` at 0.5, or a category synonym), brands, models, and a `listing` entry when `q` is a public listing's ref (bare
  or with `#`); each with its All India public count, read from an in-process count map (one grouped query for every
  category, brand and model, refreshed at most every 90 s), zero-count entries dropped. Shape
  `Suggestion { type: 'category'|'brand'|'model'|'listing', id, name, path: string[], liveCount }`.
- `GET /discover/trending`: top 10 normalised queries of the last 7 days with `result_total > 0`, searched on **≥ 3
  distinct days** and ≥ 5 times, not in `search_trending_hidden`.

### 5.13 Search log

Written on the first page of a search with words or part numbers (not count-only, not suggest). **Not logged** when the
**raw** query, lower-cased but **not normalised** (the normaliser turns `@` and `+` into spaces), with spaces and dashes
between digits ignored, contains a personal-data shape:
- an Indian mobile number: a 10-digit run starting with 6–9, optionally prefixed by `0`, `91` or `+91`;
- a 12-digit run (Aadhaar);
- a "run" is a **maximal** run of digits (not touching another digit: `(?<!\d)…(?!\d)`), so a 13-digit part number
  that contains a 10-digit stretch starting with 6–9 is not a mobile number and is logged;
- `@` (email);
- a GSTIN (`\d{2}[a-z]{5}\d{4}[a-z][a-z\d]z[a-z\d]`) or PAN (`[a-z]{5}\d{4}[a-z]`), case-insensitive.

Only after these checks pass is the normalised text stored. Other long numbers (numeric part numbers) are logged, so
they reach the zero-result report. Job
`search-query-retention` (daily, `FOR UPDATE SKIP LOCKED` batches) deletes rows older than 90 days. Zero-result report:
top 50 of the last 30 days with `result_total = 0`.

---

## 6. Ranking, distance, origin (B0: shared by search and discovery)

### 6.1 Relevance

`services/discovery/ranking.ts`, constants with tests (admin tuning later):
`0.40·0.5^(ageDays/14) + 0.30·nearness + 0.10·photos + 0.10·gst + 0.10·completeness`, where `ageDays` is from
`refreshed_at` to `asOf`, `nearness` = `max(0, 1 − km / max(radiusKm ?? 200, 50))` (0 without an origin), `photos` = 1
with ≥ 3 photos, `gst` = 1 for a GST-verified seller, `completeness` = share of the template's required and recommended
fields filled. Then `× 0.6` for `reserved`. (Rented rentals are ordered by the tier, §5.5.)

### 6.2 Distance

`services/discovery/distance.ts`, shared with F2's other side (moved there). Both points are snapped with
`ST_SnapToGrid(p::geometry, 0.01)::geography`; `km` = whole km (`floor`) of the snapped distance, minimum 1; the app
shows "Under 2 km" for 1. The radius filter uses the **same** number: `ST_DWithin(search_point, origin, (r + 3) · 1000)`
(raw points, uses the GiST index, 3 km margin covers snapping: each snapped point can move about 0.78 km, so up to about 1.6 km together) **and** `km ≤ r`, so a listing never shows "51 km" under a
50 km filter. A listing with no `search_point` has `distanceKm: null` and sorts last under `nearest`.

### 6.3 Origin (`DiscoveryOrigin`, R2)

`{ point: { lat, lng }, fallback?: { business: true } | { pincode } } | { pincode } | { business: true } | null` in every
POST body:
- `point`: from the phone's GPS, snapped. Outside India's bounding box (testers abroad, travel, mock GPS) it is **not an
  error**: the server uses `fallback` if given, else no origin, and echoes `source: 'out_of_range'`; the app then
  behaves as after a refusal.
- `pincode`: a guest's typed pincode → centroid of its offices (`400 PINCODE_UNKNOWN`).
- `business`: signed-in only (`401` for guests); the business's `location`, else its pincode centroid; no business yet →
  no origin.
- The response echoes `origin: { label, source: 'gps'|'pincode'|'business'|'out_of_range'|null }`, the label from the
  nearest pincode office (industrial area and city when the business location is used) — never coordinates.

---

## 7. API

All public routes use `fastify.optionalUser`; replies `{ data }`. New files: `routes/discover.ts`,
`services/discovery/*`.

**Rate limits (R17)**, keyed by user id when signed in, else by `X-Install-Id` (a random UUID the app creates once and
keeps in AsyncStorage; not personal data; requests without it fall back to the IP key): search 120 / min, count
(`/discover/search/count`, own path and bucket) 240 / min, suggest 240 / min, other discovery routes 120 / min; an outer per-IP cap of 1 200 / min across all
discovery routes.

| Route | Body / params | Reply |
|---|---|---|
| `POST /discover/search/count` | `SearchRequest` without `cursor` | `{ total, partialTotal }` (§5.11). |
| `POST /discover/search` | `SearchRequest { q?, filters?, removedChips?, sort?, origin?, cursor? }` | `SearchPage { items: ListingCard[], nextCursor, total?, reading: QueryReading, partial, widen, refSuggestion, facets?, origin }`, or `{ redirect: { listingId } }` for a `#ref`. |
| `GET /discover/suggest?q=` | | `Suggestion[]` |
| `GET /discover/trending` | | `string[]` |
| `POST /discover/home` | `{ origin?, radiusKm? }` | `HomeView { origin, radiusKm, kindTiles, rootCategories: { id, name, icon }[], topNearYou: ListingCard[] (8), rentNearby: ListingCard[] (8) }` |
| `POST /discover/browse` | `{ parentId?, kinds?, origin?, radiusKm? }` | `BrowseView { node, crumbs, children: { id, name, level, icon, liveCount }[], popularBrands: { id, name, liveCount }[] (6) }` |
| `POST /discover/browse/brand` | `{ brandId, kinds?, origin?, radiusKm? }` | `{ brand, models: { id, name, liveCount }[], allCount }` (`allCount` = the search total for the `brandId` filter, which has the brand chip's meaning) |
| `POST /discover/cards` | `{ ids: uuid[] (≤ 20), origin? }` | `ListingCard[]` of the ids still public, in the given order (recently viewed). |
| `GET /users/me/saved-listings?cursor=` | JWT | `{ items: SavedListingItem[], nextCursor }`; an item is `{ listingId, savedAt, card: ListingCard } \| { listingId, savedAt, unavailable: true }`. |
| `PUT /users/me/saved-listings/:listingId` | JWT | `{ saved: true }`; `404 LISTING_NOT_FOUND` unless public (F2's code for a non-public listing); `409 CANNOT_SAVE_OWN_LISTING`; `409 SAVED_LIMIT`. Idempotent. |
| `DELETE /users/me/saved-listings/:listingId` | JWT | `{ saved: false }`, always. |
| `GET /categories?depth=1` | | Roots only (closes the "whole tree" open item for Home and onboarding chips). |

Home: `topNearYou` = kinds part + machine, relevance (§6.1) within the radius, restricted to the signed-in business's
machine categories when it has some and that gives ≥ 4 items (else unrestricted); `rentNearby` = rentals, available
first. "See all" opens search with the same kinds and radius and no words. `kindTiles` carry public counts within the
radius.

Browse counts: one grouped query per call (listings joined to their category, counted under each child by `path`
prefix), within the radius when an origin is given, else All India. Children with no listings are hidden; if every
child is empty the app shows the widen hint from a second count at All India.

`loadCards()` gains the viewer's user id (for `saved`), the origin (for `distanceKm`) and the side filter (for the Pair
tags), so every list of cards (F2's included) can show the heart.

### 7.1 Admin API (category_manager; super_admin passes)

| Route | |
|---|---|
| `GET /admin/search/synonyms?q=&targetKind=&cursor=` | List with target names. |
| `POST /admin/search/synonyms`, `PATCH /admin/search/synonyms/:id`, `DELETE /admin/search/synonyms/:id` | Validate the target exists and is active; `409 SYNONYM_EXISTS`, `400 SYNONYM_TARGET_INVALID`; audit-logged (`search_synonym.create / update / delete`, before / after); bumps the reader version key. |
| `POST /admin/search/synonyms/preview` | `{ q }` → the `QueryReading` the reader produces now. |
| `GET /admin/search/zero-results` | Top 50 of 30 days: `{ normalized, searches, lastDay }`. |
| `GET /admin/search/trending` | Top 20 of 7 days with counts and distinct days, hidden ones marked. |
| `PUT /admin/search/trending-hidden/:normalized`, `DELETE …` | Hide / unhide a trending query; audit-logged. |

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
- `lib/install-id.ts`: the `X-Install-Id` UUID (§7), created once, sent by `lib/api.ts` on every request.
- Analytics: `auth_sign_in_prompted { reason }`, `auth_pending_action_completed { type }`.

### 8.2 Location (R2–R4)

`lib/discovery-origin.ts` + `hooks/use-discovery-origin.ts`:
- First Home focus: `expo-location` foreground permission. Granted → `getCurrentPositionAsync` (balanced accuracy),
  cached 10 minutes, rounded to 3 decimals on the phone (the server snaps to 2), sent with the fallback (business when
  signed in, else the saved pincode). Denied, or the server answers `out_of_range` → signed-in `{ business: true }`;
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
- **Typing**: suggestions (category with its path, brand, model, "Listing #…") and "Search for '…'"; 250 ms debounce.
- **Results** (`screens/search/results.tsx`, stack screen `SearchResults` with params `{ q?, kinds?, categoryId?, fit?,
  side? }`): filter row (Filters with count, the reader's chips removable with ×, radius chip, quick chips Used / New /
  Price), count line ("14 results, nearest first"), "Listing #…" row when `refSuggestion` is set, `ListingCard` list
  (heart, side token, tags Reserved / On rent / "Pair: contains a left"), infinite scroll (`useInfiniteQuery`,
  `nextCursor`, `CURSOR_INVALID` resets); rentals-only results use the `GridCard` grid; partial banner with the widen
  sentence (§5.6); Sort sheet.
- **Filters** screen (full screen, per mockup): side picker (`SideToken`s), condition chips, fits machine (brand → model
  → year pickers), distance (radius chips), place (state / city / industrial area multi-pick), price per unit min / max +
  hide price on request, quantity chips, seller chips (GST verified only, delivers, has video when enabled), spec fields
  of the category in play; facet counts beside options; "Clear all"; footer "Show 14 results" from count-only.
- **No results**: mockup empty state with "Widen to 100 km · 2 results" when `widen` is set; the requirement prefill
  card waits for F8.
- State: screen `useState` for the request (as textile), route params seed it; React Query keys under `['discover', …]`
  so a save toggle patches every cached card.
- **Frozen origin (R18):** the results screen captures the origin when page 1 is requested and sends that same origin
  with every later page and with count-only calls; the 10-minute GPS refresh only affects the next new list. Changing
  location in the location sheet, editing the query or applying filters starts a new list. A `CURSOR_INVALID` still
  resets to page 1 as a safety net.

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
query text, pincode or coordinates.

## 9. Admin

Two pages under **Catalogue** in the nav (`roles: ['category_manager']`):
- **Search synonyms**: table (term, script, target, active, updated), filter by target kind, add / edit dialog (term,
  target kind, target picker: category tree / brand / model / side / words), delete with confirm, a "Try a search" box
  showing the reader's chips live (preview route).
- **Search insights**: zero-result searches (top 50 of 30 days, counts, last day, "Make a synonym" opens the add dialog
  with the term filled) and trending (7 days, distinct days, Hide / Unhide).

## 10. Errors (new codes)

`LOCATION_REQUIRED`, `SORT_NEEDS_MACHINES`, `FILTER_NOT_AVAILABLE`, `CURSOR_INVALID`, `PINCODE_UNKNOWN`,
`CANNOT_SAVE_OWN_LISTING`, `SAVED_LIMIT`, `SYNONYM_EXISTS`, `SYNONYM_TARGET_INVALID` (F2's `LISTING_NOT_FOUND` reused).
App error copy for each in en / hi / gu.

## 11. Privacy and security

- Coordinates: POST only, snapped, never stored or logged (R3); request bodies are not logged (Fastify's default; keep it
  so, and redact `origin` if body logging is ever turned on).
- Search log anonymous and filtered for personal data (R14, §5.13); app analytics never carry query text, pincode or
  coordinates. The install id is random and only keys rate limits; it can be faked, so it is not a security control
  (R17).
- Cursor sealed with its own secret (§5.10); a tampered or foreign cursor is `400 CURSOR_INVALID`.
- Public cards and suggestions never expose pincode, address, point or phone (F2 rule kept).
- Saved and recently-viewed data never leave the owner's account / phone; DPDP export and deletion include
  `saved_listings` when that work lands (note in status).

## 12. Testing

- **API (integration, real Postgres + Redis, fixtures cleaned in `afterAll`)**:
  - Normaliser twins (40 strings incl. nukta, virama, ZWJ / ZWNJ inside words, Latin accents, three digit scripts).
  - Query reader (pure, ≥ 40 cases): hi / gu side words, part numbers, `#ref` vs bare number (`refSuggestion`), model
    names that look like part numbers (`JS205`, `EX200`, `PC210` → model chip), brand + model, ambiguity, removed side
    chip drops its words.
  - Search text: refresh on every listing write path; catalogue change writes a job and the job rebuilds (retry on
    error); part number "AB-123/X" found by "ab123x", "AB 123 X" and "AB-123/X".
  - Matching: typo, partial (part numbers still required), widen from full matches shown with partial, empty.
  - Order: under Left every Left before every Pair in best match, nearest, newest and price sorts; every available rental
    before every rented one in every sort; rented never under Parts / Machines for sale.
  - Statuses (reserved tagged, suspended owner hidden); every filter; every sort incl. 400s; facets disjunctive, side
    facet equals the result count; radius filter never returns a displayed km above the radius.
  - Cursor: tamper, sort swap, request swap, `asOf` keeps page 2 stable after a renewal between pages.
  - Count-only; origin (gps snap, out of range → fallback + `out_of_range`, pincode, business, guest `business` 401).
  - Home (category restriction fallback), browse counts within radius, brand view, cards order; saved (own, limit,
    unavailable, idempotent, cascade); suggest (cached counts, listing entry); trending (distinct days, hidden list);
    log written once and anonymous; retention job.
  - Synonym admin (RBAC, audit, version key bumped, target checks); a second "instance" — a fresh dictionary loader —
    sees the change after its next version check, driven by a **fake clock** (advance 5 s), never a real wait.
  - Reader: "bull gear" stays words when Bull has `chip_needs_context`; "bull gear" with a "Gears" part group in the catalogue still stays words (a part group doesn't unlock the chip);
    "bull backhoe loader" (a machine type) and "bull <model>" read the chip.
  - Log filter (on the raw input): "rahul@gmail.com" is skipped; a 10-digit mobile (with 0 / 91 / +91), a 12-digit run, `@`, GSTIN, PAN are skipped; a 9- or 11-digit
    part number is logged.
  - Count-only returns `partialTotal` when the full total is 0; nearest ties broken by relevance; page 2 with page 1's
    origin is valid after the app's GPS cache refreshed.
  - The search transaction sets the trigram threshold itself (a test sets a different role default and still matches
    at 0.6).
  - Rate limits keyed by user / install id; count-only bucket separate.
  - Postgres: `show_trgm()` of normalised "बायाँ" and "ડાબું" is non-empty; database ctype is UTF-8.
  - `EXPLAIN`: with `enable_seqscan = off`, a three-word search, a Hindi-word search and a part-number search use
    `listings_search_text_trgm_idx` / `listings_part_number_norm_idx`; **and with default planner settings on ~3 000
    seeded listings (after `ANALYZE`)** a selective word and a part number still pick those indexes.
- **App (Vitest, pure logic in `lib/`)**: origin resolution and fallback (refusal, `out_of_range`), radius / pincode
  storage, install id, recent searches and recently viewed lists, `cleanFilters` / filter counts / chip summaries,
  pending action, side tag copy; i18n parity and audit; style audit.
- **Admin (Vitest + Testing Library)**: synonyms table and dialog, preview, search insights (make a synonym, hide).
- Close-out: typecheck, lint, all tests, `mpm_test` left empty, admin build, `expo export --platform android`, a scripted
  API walk-through on the dev DB (two sellers, parts at known distances, search by part number / side word / typo,
  widen, saved), data deleted afterwards.

## 13. Build shape

Sequential batches on `develop`, one at a time, each reviewed before the next (owner, 2026-11-19: no parallel lanes):
- **B0 contracts**: shared types, migrations, schema, env (`DISCOVERY_CURSOR_SECRET`), error codes, `loadCards()`
  signature, route stubs, and the shared core: **origin resolution, `distance.ts` (moved from other side), `ranking.ts`,
  the cursor seal, the rate-limit key function, and the reader version key (`discovery:reader:version`) with
  `bumpReaderVersion()` / `readReaderVersion()`**.
- **B1 API search**: normaliser, search text + refresh hooks + refresh job, reader + dictionary, matching, filters,
  facets, sort, search route, count-only, suggest, trending, log + retention job, backfill.
- **B2 API discovery**: home, browse, brand view, cards, saved, `?depth=1`, synonym and insights admin API, brand flag,
  seed.
- **B3 admin pages**.
- **B4 app foundation**: guest navigation, sign-in sheet + pending action, install id, origin + location sheet, API
  clients and hooks, kit additions.
- **B5 app search**: start, browse, suggestions, results, filters, sort, no results.
- **B6 app home + saved + recently viewed**.
- **B7 integration and close-out**.

## 14. Risks

- SQL search won't scale forever; the trigram indexes and facet queries need watching (log slow queries > 300 ms). The
  way out is a search engine fed from the same refresh hook.
- Ranking constants and synonyms need tuning on real data before launch (zero-result report).
- Category reading can pick the wrong node on short queries; the chip is removable and the test set covers the seed.
- GPS on first Home open may be refused often; the fallbacks keep Home useful, and the chip makes the choice visible.
- Search shows old catalogue names for up to a minute after a rename (background refresh): accepted.
- `nearest` with All India computes the distance for every matching listing and sorts them; the GiST index can't speed
  that sort up. Fine at launch volume; watch it with the slow-query log.
- Guest rate limits rest on the per-IP cap (the install id can be faked, R17): accepted for launch.
- Guest navigation touches the root navigator; regressions in sign-in / onboarding gating are covered by its tests and
  the device pass.

## 15. Deferred

Near-me map (M2); saved searches + alerts (M12, with F8 / F9); side-match strip, buyers looking for your parts, Wanted
tabs, requirement prefill on No results (F8); rental date availability (F7 bookings); interchange / superseded numbers
and "My machines" (M4); similar parts nearby (F2 R23); enquire-all basket (P2); featured listings (A6); notifications
bell (F9); image / voice search, personalised ranking, trending per cluster (P2); admin tuning of ranking constants;
translated catalogue names (A4).

## 16. Review changes (owner's review, 2026-11-19)

| Review point | Where fixed |
|---|---|
| Part-number fallback never matched (spaced vs compact form) | §4.1 stores both forms; §5.4 fallback uses the compact form |
| Model names read as part numbers | §5.3: names before part numbers; consumed tokens are never part numbers |
| Bare 6-digit `#ref` redirect collides with part numbers | §5.3 step 1: redirect only on `#`; bare number → `refSuggestion` row; §5.12 `listing` suggestion |
| Ranking contradicted R6 / R7 | §5.5: tier (side, rent) sorts first in every sort; R6, R7 reworded |
| Removed side chip still filtered by text | §4.1 no side words in `search_text`; §5.3 removed side chip drops its words |
| Load more could skip / repeat | §5.10 `asOf` in the cursor; ages from `asOf`; `refreshed_at ≤ asOf` on later pages |
| L1 depended on L2 | §13: origin, distance, ranking, cursor, rate-limit key in C0 |
| Catalogue renames locked listings in the admin transaction | §4.5, §5.2: refresh job, short batches |
| Per-IP rate limits throttle NAT users | R17, §7: per user / install id, count-only bucket, IP outer cap |
| Search log could hold personal data | §5.13 (narrowed in §16.1, raw input in §16.2) |
| Trending easy to game | §5.12 ≥ 3 distinct days and ≥ 5 searches; §4.3 hide list; §7.1, §9 |
| `ORIGIN_OUT_OF_RANGE` broke Home abroad | §6.3: fallback + `out_of_range` source, no error |
| Hindi / Gujarati trigrams unproven | §4.8, §12: `show_trgm`, UTF-8 ctype, Hindi `EXPLAIN` (checked on dev: non-empty) |
| Normaliser would strip Indic marks; ZWJ / ZWNJ split words | §5.1 |
| Partial ran before widen | §5.6: widen from full matches, shown with partial; part numbers required in partial |
| Reader cache per process | §5.3: Redis version key, ≤ 5 s staleness |
| `SET LOCAL` outside a transaction; `EXPLAIN` only with seqscan off | §5.4 default threshold 0.6, suggest in a transaction with `set_config`; §12 default-planner `EXPLAIN` on ~3 000 rows |
| Nits: video filter, rented under All, side facet, snapped vs raw distance, unique key casts, cursor secret, translated names, suggest counts | R16 + §5.7; R7; §5.9; §6.2; §4.2; §4.8, §5.10; §4.1; §5.12 |

### 16.1 Second review (owner, 2026-11-19)

| Review point | Where fixed |
|---|---|
| GPS refresh mid-scroll reset the list (`CURSOR_INVALID`) | R18; §5.10; §8.4 frozen origin |
| Log filter dropped long numeric part numbers | §5.13: only mobile, Aadhaar, `@`, GSTIN, PAN shapes |
| Typo threshold relied on the database default | §5.4: `set_config(…, true)` in every search transaction |
| Nearest tied on whole km, then uuid order | §5.8: tier, km, relevance, id; §14 All India note |
| Brand names that are ordinary words | §4.1 `brands.chip_needs_context`; §5.3 step 3; §12 test |
| Count-only said "Show 0" while partials exist | §5.11 `partialTotal` and footer copy |
| Count-only bucket couldn't be chosen from the body (limiter runs before parsing) | §5.11, §7: own path `POST /discover/search/count` |
| "Run" undefined in the personal-data check | §5.13: maximal digit runs |
| Word synonyms replaced the term, so "fender" lost "Fender" listings (B2 review) | §5.3 step 2: word synonyms add an OR alternative |
| Brand view "Other" count matched no query the app could open (B2 review) | §7 brand view: `allCount` = search total for the `brandId` filter |
| Typo hit weight unspecified | §5.5: half a substring hit |
| Install id can be faked | R17, §11, §14: accepted, not a security control |
| Reader version key between lanes | §13: key and `bumpReaderVersion()` in C0 |
| 5 s cache test would be flaky | §12: fake clock |

### 16.2 Third review (owner, 2026-11-19)

| Review point | Where fixed |
|---|---|
| Stale "8+ digit runs" test line | §12 |
| Facet queries parallel vs sequential | §5.4, §5.9: sequential inside the search transaction |
| "bull gear" unlocked by the Gears part group | §4.1, §5.3 step 3: only a model of the brand or a machine type unlocks; §12 test |
| Log filter ran after normalising | §5.13: checks on the raw lower-cased input, then store the normalised text; §12 test |
