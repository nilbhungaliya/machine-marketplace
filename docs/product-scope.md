# Machine Parts & Machinery Marketplace: Product Scope

16 Nov 2026 · full feature specification, built on the client scope (`docs/Machine Parts Marketplace Product Scope.pdf`,
extract with module IDs in `docs/product-scope.txt`) and competitor research (`docs/research/`). Screens for every flow:
`docs/mockups/user-app-mockup.html`.

## Product summary

The Machine Parts & Machinery Marketplace ("MPM", working name) is a mobile-first B2B app where Indian businesses buy, sell
and source **spare parts, complete machines and machine rentals**, with a web admin panel that runs the marketplace. It takes
the category and lead tools of Fibre2Fashion Machinery, IndiaMART and TradeIndia, the used-machinery filters of Machineseeker,
Surplus Record and Mascus, and the fitment ideas of parts e-commerce (eBay, RockAuto, Cat, Amazon), and adds what none of them
has for industrial parts: **structured "fits these machines" data, Left / Right / Pair matching, buyer requirements that match
on part number, machine and side, structured offers, and a deal record** even when payment happens outside the app.

| Item | Scope |
|---|---|
| Problem | A broken machine waits for one part. Workshops, factories and contractors phone around dealers and WhatsApp groups to find it; surplus and used parts sit in godowns because nobody can find them by machine model or part number. Many hold only one side of a part (a left bracket, a right tie rod end) and cannot find the other. Generic B2B portals have no part numbers, no fitment and no side. |
| Who it's for | Indian SMEs: spare-part dealers and stockists, machine owners selling surplus or used parts, workshops and repair shops, manufacturers with excess stock, used-machinery dealers, contractors and rental fleet owners (sellers); maintenance teams, factories, workshops, contractors, farmers' service centres (buyers). One account can do both. |
| First markets | Saurashtra and Gujarat industrial clusters (Rajkot: Aji, Shapar-Veraval, Metoda; Ahmedabad: Vatva, Naroda; Morbi; Jamnagar), then Pune (Bhosari, Chakan), Ludhiana, Coimbatore. To be confirmed by the client (Decision D8). |
| Platforms | Mobile app (Android first, iOS) in React Native; admin panel on the web; public web pages for SEO and sharing later |
| Languages | English, Hindi, Gujarati at launch; Marathi, Tamil, Punjabi later |
| Core loop | Seller lists a part, machine or rental → buyers find it by machine, part number, side and distance, or are matched through a requirement → enquiry and offer / counteroffer → deal agreed → marked sold or rented → both sides review |

## Product principles

1. **Find the part for the machine.** Every part listing says what machines it fits (brand, model, years) as structured data,
   and part numbers are searchable. "Fits your machine" is a fact the app can check, not free text.
2. **Sides are first-class.** Left / Right / Pair is its own field and filter, and the app actively pairs a single side with its
   complement.
3. **Close the deal in the app.** Offers, counteroffers and "mark sold / rented" happen in the thread, so there is a record and
   a review even when the money moves by bank transfer or cash.
4. **Near me matters.** A machine down is urgent: distance, industrial area and "available now" lead the results.
5. **Trust is earned, not bought.** GST verification is free; badges come from verified data, deals and ratings, never from
   payment alone.
6. **Match, don't spam.** A requirement reaches a capped number of matching sellers; buyers are not flooded with calls.
7. **Phone-first.** OTP login at the moment of intent, a listing in about two minutes, WhatsApp-friendly sharing, regional
   languages.

## How to read this document

Modules are numbered **M1–M20** (app) and **AD1–AD7** (admin). Each lists its purpose, a workflow where the flow has several
steps, the requirements and fields, the release phase (**MVP**, **P2**, **P3**), the client scope IDs it covers (U1–U4, F1–F9,
A1–A6 from the PDF) and its inspiration. Inspiration codes:

| Code | Source | Code | Source |
|---|---|---|---|
| PDF | the client scope | MA | Mascus |
| F2F | Fibre2Fashion Machinery | MT | MachineryTrader (Sandhills) |
| IM | IndiaMART | EB | eBay Business & Industrial / Motors fitment |
| TI | TradeIndia | AL | Alibaba.com (RFQ, used machinery) |
| MS | Machineseeker India | RA | RockAuto |
| SR | Surplus Record | CAT | Caterpillar Parts.cat.com |
| EX | Exapro / Kitmondo | AZ | Amazon Automotive (Garage, Confirmed Fit) |
| MC | Machinio | BD | boodmo |
| DZ | DOZR | ES | EquipmentShare T3 |
| YC | Yard Club | TR | TransRentals, RNTL, AUEQI (India rental) |
| TSM | our textile project (patterns reused) | New | no competitor has it |

## Competitive inspiration

Research notes with sources: `docs/research/` (Fibre2Fashion, international used-machinery sites, Indian B2B and rental,
parts fitment). Several sites block automated fetching, so some facts came from archived copies, help centres or search
snippets; the notes say which.

| Platform | Best ideas to take | Weaknesses to avoid |
|---|---|---|
| **Fibre2Fashion Machinery** (textile machinery leads; web + "B2B Trade" app) | Sellers / buyers tab pair on every category; public buy leads with contact gated; Trade Match alerts (10 per user) with app push; Inquiry Basket (one enquiry to several sellers); Compare; listing statuses with reject reason, Paused and Expired; Express Posting of a requirement without login; used-machine fields (year, brand, model, condition, capacity) | Flat list of 465 product types with duplicates and typos; every photo "Image For Illustration Purpose Only"; ghost-written descriptions; stale stock (newest used offers from about 2020–2025); no condition, price, brand, year or distance filters; no part numbers, fitment, side or rental; no seller name, badge or rating on cards; USD plans, ad-heavy pages |
| **IndiaMART** (largest Indian B2B, used machinery section with counts) | Post Buy Requirement validated before going live; BuyLeads pushed to relevant suppliers with "not relevant" feedback; Lead Manager (saved replies, quotation, reminders, labels); masked calling (PNS rings up to 5 staff phones); TrustSEAL checks (GST OTP, bank name match, video KYC with stock proof) | Paid leads (TrustSEAL Pro ₹60,000/yr for ~15 leads/week) and lead-quality complaints; escrow discontinued March 2024; the 2026 protection covers non-delivery only, needs an FIR only above ₹1 lakh (a registered police complaint below) and caps the payout at ₹5 lakh |
| **TradeIndia** | TI Pay timers: 2 business days to report a wrong product, auto-release 3 business days after delivery; buy leads and quotation in app | Full upfront payment only (no advance + balance); lead-quality complaints |
| **Machineseeker India** | Condition New / Ex-display / Used / Defective; location radius 10 km to unlimited; "only verified dealers"; images-only and video-only filters; category technical filters; sort by distance, year, runtime; saved search alerts cancellable any time; "Request more images" | EUR prices and global distances on the India site |
| **Surplus Record** | Free Wanted posts emailed to dealers (budget band, best offer, private note); enquiry form with Make an Offer / shipping quote / financing ticks; category numeric ranges (swing, centers), motor search by HP / RPM / volts; "Dealer since 2006" and level badges; Create Alert | Wanted contacts visible only to paying advertisers; "buyer protection" while the terms disclaim all guarantees; no reviews |
| **Mascus** | Advert type Sale / Auction / **Rent** as a filter; hours, year, power, emission filters; Want Ad; follow a seller; "Report suspicious ad"; years on Mascus; WhatsApp contact; saved searches with push | Year and hours sometimes only in free text; weak app (8 ratings); fees not published |
| **MachineryTrader** | **Part-number search** with quantity available and price; Want-To-Buy ads and dealer "Auto-Search Matches"; watch list with price-drop email; "For Rent" section; well-rated app (4.7, ~5.7K iOS ratings) | Trustpilot 2.5/5; listing fees not published |
| **eBay B&I / Motors** | **Structured fitment**: match by brand + part number, or add up to 3,000 vehicles, bulk CSV, "My Garage" filter; Best Offer with timers (seller 24 h to respond; buyer 96 h to answer a counteroffer, US / UK since 2026) and seller auto-accept / auto-decline thresholds; Verified Condition inspection with per-component stars and video | Fitment only for vehicles; heavy equipment gets plain "compatible make" text; protection excludes off-platform payment |
| **Alibaba.com** | RFQ: buyer posts specs, quantity, price range; platform reviews it; up to 15 quotes; "Test report: provided" and "Video inspection: provided" attributes | Compatibility only as free text in titles ("Used for 320D 320B …") |
| **Exapro / Kitmondo / Machinio** | Evergreen model pages even with no stock; valuation help; inspection before purchase; dealer feeds and CRM | Agent in the middle and 5–10% commission slow quick parts deals; crawled stale listings; no apps |
| **RockAuto, Cat, Amazon, boodmo** (parts fitment) | RockAuto: side convention stated, "no side = fits either side", "need both sides, order 2", axle sets and packs with per-unit price; Cat: saved machines with a green "verified fit", serial ranges, alternative and remanufactured parts; Amazon: fit badge only from structured data, never free text; boodmo: genuine / OES / aftermarket tiers for one OEM number | RockAuto customers still confused about sides; Cat prefix-only fitment misses mid-production changes; boodmo charges points for part-number lookups |
| **DOZR, EquipmentShare, Yard Club, TransRentals, RNTL** (rental) | Day / week / month rates with a day = 8-hour shift; operator included and client-supplied diesel (India); transport by distance or mobilisation charge; owner confirms availability; one-click Extend; off-rent now or scheduled, partial quantity; contractor-to-contractor rental of idle machines with two-way ratings; daily logsheet | Inconsistent self-reported numbers; operator rules contradicting each other on one site; conflicting "optional / required" protection terms |

### What is new in this product (no competitor has it for industrial parts)

- **Left / Right / Pair** as a structured field, filter and matching rule, with the complementary side shown on every listing.
- **Structured fitment** (machine brand → model → years, optional serial range) for industrial, agricultural and construction
  machines, with "Check my machine" (P2: saved "My machines" and a verified "fits your machine" badge).
- **Requirements matched on part number, machine and side**, not a broad category; sellers reply with a live listing or a quote,
  and the buyer compares replies side by side.
- **Availability alerts** that re-check every new listing against open requirements, including the missing side.
- **Structured offers and counteroffers** inside the chat (bounded rounds, expiry) and a **deal record** for both sides, even
  with off-platform payment.
- **Parts, machines and rentals in one account**: a business can sell spare parts, sell a used machine and rent out an idle
  one from the same profile.
- **Industrial-area discovery**: search and browse by GIDC / MIDC / industrial estate, not only city.

### Feature-to-source map

| Module | Client scope | Main inspiration |
|---|---|---|
| M1 Onboarding and verification | U1, U2, F1 | IM (OTP at the first action, TrustSEAL checks), TSM M1, F2F (company KYC fields) |
| M2 Home and discovery | U2, F4, F5 | IM (city feed), F2F (sellers / buyers pair), MA (rent as a type) + New industrial areas |
| M3 Search and filters | F4, F3 | MS (radius, condition, verified, sort), MT (part number), SR / MA (category numeric ranges) + New side filter |
| M4 Machine catalogue and fitment | A4, F2, F4 | EB (fitment, My Garage), CAT (saved machines, serial ranges), AZ (fit badge from structured data), EX (model pages) |
| M5 Sell a part or machine | U1, F2, F3 | F2F (lead form sections), IM (category spec template), TSM M4 wizard + New side step |
| M6 Listing page | U2, F3, F4 | IM (trust block, sticky actions), SR (request price, alert), MS (request more images) + New fit and side blocks |
| M7 Listing lifecycle | F2, A3 | F2F (approve, reject with reason, paused, expired) + sold / rented / unavailable |
| M8 Left / Right / Pair matching | F3 | RA (side convention, order 2 for both) + New pairing and complement |
| M9 Enquiry, offers and negotiation | U1, U2, F6 | EB (Best Offer timers and thresholds), SR (enquiry intent ticks), F2F (Inquiry Basket) + TSM M7 |
| M10 Chat and calls | F6 | IM (masked calls, Lead Manager), MA (WhatsApp), TSM M8 |
| M11 Buyer requirements (RFQ) and matching | U3, F8 | TSM M9, IM (BuyLead), AL (RFQ, 15 quotes), SR (Wanted), MT (Auto-Search Matches), F2F (buy leads) |
| M12 Alerts, saved searches, follow seller | F8, F9 | F2F (Trade Match), MS (saved search, cancel any time), MT (price drop), MA (follow seller) |
| M13 Deals and history | F7 | TSM M12, TI (delivery timers) + New off-platform deal record |
| M14 Machinery rental | F5, F7, A1, A4 | DZ, ES, YC, TR, MA (rent type) |
| M15 Reviews | F7 | IM (rating facets), YC (two-way ratings), TSM M14 |
| M16 Notifications | F9 | IM (channel matrix), TSM M15 |
| M17 Seller dashboard | U1, F1 | F2F (lead manager), MC / MA (stats), TSM M16 |
| M18 Plans and monetization | A6 (later) | SR (published plans), F2F (gating, avoid), IM (avoid pay-per-lead), TSM M17 |
| M19 Trust and safety | A2, A3, A6 | IM (TrustSEAL), MA (report suspicious ad), SR (tenure badges), TSM M19 |
| M20 Payments | (P2) | TI (TI Pay), IM (protection rules, avoid), TSM M13 |
| AD1–AD7 Admin panel | U4, A1–A6 | TSM admin, F2F (moderation), MT (dealer matching) |

## Users, roles and permissions

One business account type can both buy and sell, plus team members inside a business and a small set of admin roles.

| Role | Who | Can do |
|---|---|---|
| Guest | Not logged in | Browse parts, machines, rentals and public requirements (contact details hidden); share links |
| Registered (unverified) | Phone verified, profile started | Everything a guest can, plus save, enquire, make up to 3 open offers, post requirements, at most 3 open listings (any status except draft, sold, removed), each reviewed before it goes live |
| Verified business | GST verified | Full free plan: listings within quota, offers within fair use, chat, requirement replies, rental listings |
| Paid plan (P2) | Pro / Business | More live listings, bulk upload, boosts, stats, team members (M18) |
| Team member (P2) | Added by the owner | Acts for the business: Listing manager, Sales (enquiries, offers, chats), Viewer |
| Business owner | First user of the business | Team, plan, verification |

**Verification levels** (badges), as `VERIFICATION_LEVELS` in `packages/shared-types` (`phone`, `gst`, `business`): Phone
verified → GST verified (instant provider check, or officer review with documents as the fallback, MVP) → Business verified
(documents or video KYC, P2). Deal count, rating and years on the platform show on the seller block; they are not a
verification level.

**Admin roles** (already in the codebase): super admin, moderator, verification officer, category manager, operations (deals,
rentals, KPIs), support. Every admin action writes the audit log (who, what, when, before / after).

## System overview

Three clients (mobile app, admin panel, later public web pages) share one API.

| Service | Responsibility | Key integrations |
|---|---|---|
| Accounts | OTP login, business profile, GST lookup, location and industrial area, team, verification levels | MSG91 (OTP), GST provider (to choose) |
| Catalogue | Category tree (machine category → machine type → part group), brands, models, fitment, spec templates, units, conditions, side options | — |
| Listings | Parts, machines, rentals; dynamic spec fields (JSONB), fitment rows, side, media, moderation states | Cloudflare R2 (S3-compatible client) |
| Search | Full text + `pg_trgm`, normalised part numbers, facets, PostGIS distance, industrial area | PostgreSQL (Meilisearch later if volume needs it) |
| Matching and alerts | Requirement-to-listing matching (part number, fitment, side, distance), complement finder, saved searches, follows, price drops | Background jobs |
| Offers and deals | Offer / counter state machine, deal record, sold / rented status, history | — |
| Rentals | Rates, availability calendar, booking state machine, off-rent; extensions (P2) | — |
| Chat and calls | Real-time threads with structured cards, masked calling, WhatsApp share links | Socket.IO, Exotel |
| Notifications | Push, SMS, WhatsApp, in-app centre, user preferences, quiet hours | FCM, WhatsApp Business API |

## App navigation map

Five bottom tabs: **Home**, **Browse**, **Sell** (centre, yellow), **Enquiries**, **Deals**; profile behind the avatar. Sell opens
four choices: a spare part, a machine for sale, a machine for rent, a requirement. Global elements: location and radius
selector (auto-detected, industrial area aware), search bar, notification bell, language in settings.

---

## M1 · Onboarding, login and business profile (MVP) — U1, U2, F1

**Purpose.** Let people browse at once and ask for the phone number only when they first act; collect what powers matching
(location, industrial area, machines they work with) in a short profile; verify the business by GST.

**Workflow.** Welcome (language) → browse as guest → first action (enquire, offer, save, sell, post requirement) → mobile + OTP
→ business profile → location and industrial area → GST (optional, can skip) → back to the action.

| Screen | Fields / behaviour |
|---|---|
| Language | English, Hindi, Gujarati (changeable later) |
| Mobile + OTP | +91 mobile; 6-digit OTP with SMS auto-read; resend after 30 s; "Buyers see your number only after you share it" |
| Business profile | Your name, business name, what you'll do (Buy parts / Sell parts / Rent out machines, multi), machines you work with (machine categories, multi; seeds the feed and requirement matching) |
| Location | Map pin with "use my location"; **industrial area** (searchable list of GIDC / MIDC / estates per city, or "Other"); city, state, pincode (pincode autofills city and state); stored as PostGIS point |
| GST verification | **Instant through a GST provider:** GSTIN → lookup shows legal name, constitution, status, principal place; "this is my business" declaration; a code sent to the GSTIN's registered phone or email → GST verified. **Fallback: admin review (AD2)** when the provider is down or off, the GSTIN isn't found, or the business can't receive the code: GSTIN + uploaded documents go to the verification officer. Listing and buying continue meanwhile |
| Suspended account | Sign-in refused with "This account is suspended. Contact support." (built: `ACCOUNT_SUSPENDED`) |

**Profile also holds** (shown publicly on the seller page, from F2F's company block): nature of business, year established,
GST verified badge, years on the platform, deal count, rating, usual reply time.

**Phase.** MVP (phone OTP, profile, location, instant GST verification through a provider, admin review with uploaded
documents as the fallback). P2: "Business verified" level by documents or video KYC, team members.

**Inspiration.** IM (OTP in the enquiry pop-up; TrustSEAL's GST OTP and bank name match), F2F (GST, IE code, year of
establishment on the listing), TSM M1 (built pattern). Avoid F2F's job title / job function questions.

## M2 · Home and discovery (MVP) — U2, F4, F5

**Purpose.** Open on what is useful near the buyer: matches for their requirements, stock near them, machines for rent.

**Home sections (in order).**
1. Location and radius chip (industrial area, "within 25 km"), notification bell.
2. Search bar: "Part, machine, brand or part no."
3. Root categories (admin-managed): Spare parts, Machinery, For rent, Electrical, Hydraulics, Bearings & transmission, Tools,
   Textile machinery (embroidery machines, water-jet looms: the seeded catalogue). Launch categories are the client's call (D9).
4. **Side-match strip** when the user has an open requirement with matches ("2 right-side matches for your left tie rod end").
5. Near you: live listings sorted by a blend of distance and freshness, filtered to the user's machine categories when set.
6. Machines for rent nearby.
7. Buyers looking for your parts (sellers only; from M11).
8. Recently viewed, saved searches with new results.

**Browse tab.** The admin tree: machine category → machine type → part group (with live counts) → listings; or brand → model →
parts that fit. P2 (with M11's public demand): each node gets **For sale / Wanted** tabs (F2F's sellers / buyers pair), so
requirements are browsable demand.

**Near me map.** Clustered pins by industrial area with counts; switch City / Industrial area / State; list of areas with part
and rental counts and distance.

**Phase.** MVP. P2: personalised ranking, trending parts per cluster, evergreen model pages (EX).

**Inspiration.** IM (city feed), F2F (dual sellers / buyers pages; but with counts and a clean tree), MA (rent as a listing
type), New (industrial area browsing, side-match strip).

## M3 · Search and filters (MVP) — F4, F3

**Purpose.** Find the exact part fast, by any identifier a mechanic has: part name, part number, machine, brand, model.

**Search.**
- One box; the query reader recognises part numbers (normalised: uppercase, spaces / dashes / dots stripped), machine
  brand and model names, and side words ("left", "LH", "RH", "right hand", Hindi and Gujarati forms) and turns them into filters.
- Typo tolerance (`pg_trgm`), admin-managed synonyms ("tie rod end" = "TRE"; "mudguard" = "fender"), suggestions while typing.
- Cross-references (P2): searching an OEM number also finds listings that declared it as an interchange or superseded number (M4).
- Search by listing or requirement reference number (F2F), for phone and WhatsApp follow-ups.

**Filters.**

| Filter | Values |
|---|---|
| Listing type | Parts, Machines for sale, Machines for rent |
| **Side** | Left, Right, Pair. Left shows Left first, then Pair (Right likewise); Pair shows only Pair; "not applicable" never matches a side filter. P2: "fits either side" counted for both |
| Fits machine | Brand → model → year (P2: or one of "My machines", M4) |
| Condition | New, Unused, Used, Excess (P2: Refurbished, Defective / for parts, from MS) |
| Part origin (P2) | Genuine OEM, OES, Aftermarket, Remanufactured (BD) |
| Distance | 10 / 25 / 50 / 100 / 200 km, state, all India (PostGIS) |
| Industrial area, city, state | Multi-select |
| Price per unit | Min–max; "hide price on request" toggle |
| Quantity available | Any, 2+, 10+, 50+ |
| Seller | GST verified only, has video, ships / delivers |
| Category specs | From the category template: e.g. bore and OD for bearings, HP / RPM / voltage for motors, swing and centres for lathes, hours and year for machines (SR, MA) |

**Sort.** Nearest first (default when location known), newest, price low–high, price high–low, year (machines), hours (machines).

**Results card.** Line drawing or photo, title, "Fits …" line, side mark, condition, quantity, price or "Price on request",
place and distance, verified badge, tags (Pair, Price dropped).

**Phase.** MVP. P2: spec-range facets for every template, image search, voice search.

**Inspiration.** MS (radius, condition, verified only, sort by distance / year / runtime), MT (part-number search with
quantity), SR and MA (category numeric filters), TSM M3 (query reader). Avoid F2F's "pick category first" and missing filters.

## M4 · Machine catalogue, fitment and "My machines" (MVP core, P2 depth) — A4, F2, F4

**Purpose.** A clean, admin-managed catalogue so listings, search, requirements and matching all speak the same language.

**Catalogue (managed in admin, AD4).**
- Category tree, three levels: machine category (Tractors, Earthmoving, CNC & machine tools, Textile machinery, Plastic
  moulding, Printing, Trucks, Pumps & compressors, …) → machine type (Backhoe loaders, Turning centres, Rapier looms,
  Embroidery machines, Water-jet looms, …) → part group (Hydraulics, Transmission, Body parts, Steering & linkages,
  Electrical, Filters, …). Live counts on every node. The seeded catalogue is textile machinery (embroidery and water-jet
  looms in full); the launch categories are the client's call (D9).
- Brands and models (JCB 3DX, Mahindra 575 DI, Tata LPT 1613, Jyoti DX 200, Fanuc 0i-TF …), with year ranges and optional
  variants.
- Spec templates per part group or machine type: field name, type (text, number + unit, choice, multi-choice), required,
  filterable, shown on cards. A new part type needs no app release.
- Master data: units (pcs, pairs, sets, kg, m, litres, hours), conditions, price models, side options per category
  ("parts in this category have sides" switch), rental periods.
- No duplicates and no "Others" dumping ground: merge tools and a "suggest a category" queue (F2F's flat 465-item list with
  typos is the counter-example).

**Fitment on a part listing.** Child rows, many per listing:

| Field | Notes |
|---|---|
| Machine brand, model | From the catalogue; "Request a missing model" goes to the category manager (EB master list) |
| Variant | Optional (e.g. 3DX Super, 4WD) |
| Year from / to | Open ranges allowed |
| Serial range or prefix | Optional, P2 (CAT: parts change mid-production) |
| Qualifier note | Free text, e.g. "with hydraulic tensioner" (RA limiting factors) |
| Source | MVP: seller declared only, shown as "Seller says it fits". P2: Admin verified / Catalogue rows; the green **"Fits your machine" badge** shows only for those (AZ, CAT) |

**Part identity.** MVP core: part number (stored raw and normalised, searchable) and part brand. P2 depth: OEM brand and OEM
number, origin (genuine, OES, aftermarket, remanufactured, used / pulled), cross-references (interchange, supersedes,
superseded by), **mirror part number** (links a left part to its right counterpart, powers M8), sold as (single, pair, set,
pack) with units per sale and per-unit price (RA packs), quantity per machine (informational).

**My machines (P2).** A business saves its machines (brand, model, year, optional serial, location). Search
can filter to "fits my machines"; requirement forms pre-fill from a saved machine; home shows parts that fit.

**Phase.** MVP: tree, brands, models, years, fitment rows (seller declared), part number and part brand, templates, master
data, side switch. P2: serial ranges, cross-references, mirror numbers, verified fitment and the "Fits your machine" badge,
My machines, bulk CSV fitment upload (EB), evergreen model pages (EX).

**Inspiration.** EB (fitment by brand + part number, 3,000-vehicle cap, CSV, My Garage, master list), CAT (saved equipment,
green check, serial prefix and range, alternatives and reman), AZ (fit badge only from structured data), BD (genuine / OES /
aftermarket tiers), EX (model pages). New: the same for industrial machines, plus side.

## M5 · Sell a part, a machine or a rental (listing wizard) (MVP) — U1, F2, F3

**Purpose.** Put real stock online in about two minutes, with the structure buyers filter on.

**Workflow (part).** Sell → What are you listing? → Category → Part and specifications → Quantity and condition → Brand and fit
→ **Which side?** (only when the category has sides) → Photos and video → Price → Location and delivery → Preview → Publish →
review (first listings) → live → matching requirements alerted (M11).

| Step | Fields |
|---|---|
| What are you listing? | Spare part · Machine for sale · Machine for rent (M14) · Requirement (M11) |
| Category | Search box ("tie rod, bearing, servo…") or tree; recent categories first |
| Part and specs | Part name (suggestions from the category), part number (optional, strongly encouraged), template fields |
| Quantity and condition | Quantity + unit; condition New / Unused / Used / Excess with one-line definitions; condition notes |
| Brand and fit | Part brand; fits these machines (brand → model → years, multiple rows) |
| Which side? | Left only · Right only · Pair (both sides) · No side; diagram with the convention "seen from behind the machine, facing forward (operator's view)"; tip "buyers with the other side will see yours as a match" |
| Photos and video | 1–10 photos (cover first), up to 2 videos (60 s); guidance: nameplate / part number, both faces, wear and rust, a running video for machines; at least one real photo, no stock images (F2F's "illustration only" is the counter-example) |
| Price | Fixed · Negotiable · Price on request; price per unit; minimum order; GST extra / included toggle |
| Location and delivery | Business address or another godown (pin on map); Buyer picks up / I can ship / Local delivery |
| Preview | Exactly the buyer view, with a checklist (photos, part number, fit, video) |

**Machine for sale adds.** Make, model, year, serial number (private, shown to admin), hours or running hours, controller /
power / capacity fields from the machine template, "under power, can be seen running", inspection by appointment, reason for
sale, optional test report and inspection video (AL), Chartered Engineer certificate for imported used machines (P2, India
import rule).

**Drafts and quality.** Autosave drafts; a listing score nudges missing part number, fit, video; sanity checks on unit and price
(F2F showed "EUR / Containers, MOQ 5 kg") before review.

**Phase.** MVP. P2: bulk upload (CSV + photo zip), duplicate listing, dealer inventory feed (MC), AI title and category
suggestions from a photo or nameplate.

**Inspiration.** F2F (basic / trade / spec / price sections, "Request for best price", valid-till), IM (category spec template,
product score), TSM M4 (wizard pattern, drafts). New: side step with convention diagram, fitment rows, sanity checks.

## M6 · Listing page (MVP) — U2, F3, F4

**Purpose.** Answer the buyer's questions in the order they ask them: is it the right part, does it fit my machine, which side,
what condition, how many, how much, how far, can I trust the seller.

**Order of blocks.**
1. Gallery (photos, video badge, count); share, save.
2. Side mark, condition, quantity in stock.
3. Title; price (per unit, negotiable / fixed / on request; GST note).
4. **Fits** block: machine chips; "Check my machine" (a brand / model picker; P2: also My machines). MVP answers "Seller says
   it fits" or "Not listed by the seller"; a verified green "fits" answer needs catalogue / admin-verified fitment rows (P2).
5. **Other side** block: "Right side also available, 8 pcs from Om Agro Spares, Gondal" (M8), or "Need the other side? Post a
   requirement".
6. Specifications table (template fields, part number, part brand).
7. Delivery and location (area, distance; exact address only after a deal).
8. Seller block: name, area, verified badge, rating, deals done, usual reply time, years on platform; "View all listings", follow.
9. Similar parts nearby; parts that fit the same machine.
10. Report listing.

**Sticky actions.** Enquire · Make offer (negotiable) · Ask price (on request) · Request booking (rental). Quick extras: Request
more photos / video (MS), Save, Share to WhatsApp (link opens the web page later, app if installed).

**Phase.** MVP. P2: compare tray (F2F), price history, "buyers who viewed this also viewed" (SR).

**Inspiration.** IM (product page order, trust block, sticky bar), SR (request price, alert, tenure badge), MS (request more
images), MA (report suspicious ad, follow seller). New: fits and other-side blocks.

## M7 · Listing lifecycle (MVP) — F2, A3

**Statuses** (built in `packages/shared-types` as `LISTING_STATUSES`):

| Status | Meaning | Who moves it |
|---|---|---|
| draft | Being written | Seller |
| pending_review | Waiting for moderation (every listing of an unverified seller, the first 3 of a verified seller, sanity flags, a side or fit change while a report is open) | System |
| rejected | Refused with a reason; seller can fix and resubmit | Moderator |
| live | Visible and searchable | Moderator / goes live at once for a verified seller after their first 3, unless flagged |
| paused | Hidden by the seller (e.g. stock being checked) | Seller |
| reserved | A deal is agreed on the full remaining quantity | System (M13) |
| sold | All quantity sold | Seller / system |
| rented | Rental listing currently on rent (M14) | System |
| unavailable | Seller marked it unavailable (sold elsewhere, damaged) | Seller |
| expired | Not refreshed for 60 days (admin-configurable); set by an hourly job; Renew brings it back | System / seller |
| hidden | Hidden by a moderator (reversible: unhide) | Admin |
| removed | Taken down by seller or admin | Seller / admin |

**Rules.**
- Quantity decreases with each deal; the listing stays live until quantity reaches zero.
- **Freshness:** listings expire after 60 days without an update (admin-configurable; an hourly job moves them to
  `expired`); 7 days before, the seller gets "Still available?" with one-tap Renew, which also brings an expired listing back.
  Cards show "Updated 3 days ago". This answers F2F's stale stock and Kitmondo's availability checks.
- **Review:** every listing from an unverified seller is reviewed; a verified seller's first 3 listings are reviewed; after
  that, listings go live unless flagged (price / unit sanity checks).
- **Edits:** price, quantity and photo edits go live at once. A side or fit change while a report is open, or an edit that
  raises a new sanity flag, goes back to review. The category can change only in draft or rejected.
- Every status change notifies the seller (M16) and writes history.

**Phase.** MVP. **Inspiration.** F2F (approved, pending, rejected with reason, paused, expired, deleted with reason), EX /
Kitmondo (availability checks), TSM M6.

## M8 · Left / Right / Pair matching (MVP) — F3

**Purpose.** The marketplace's signature: a business with only one side of a part finds the other side, and a seller with a
single side finds the buyer who needs it.

**Data.** `side` on every part listing and requirement: left, right, pair, not applicable (built as `PART_SIDES`); P2 adds
"either" (fits both sides, RA). The convention is fixed per category: "as seen from behind the machine, facing forward" by
default, with a diagram on the listing and in the wizard (RA needed a help page and still confuses customers). P2: mirror part
numbers in the catalogue link left and right numbers explicitly.

**Matching rules.**
- A **left** listing complements requirements or listings for **right** of the same part, and the reverse
  (`complementarySide()` in shared-types). A **pair** satisfies a need for either side or both. P2: "either" counts for both.
- "Same part" means: same normalised part number or mirror number (strongest); else same part group + same part name +
  overlapping fitment (same machine model and years); distance and condition rank the results.
- A buyer searching "right" sees right listings first, then pair; "pair" sees only pair listings (P2: then a suggested left +
  right combination from two sellers, "Buy both sides: ₹1,150 + ₹1,190 from 2 sellers 6 km apart"). "Not applicable" never
  matches a side filter. No "either" side at MVP.

**Where it shows.**
- Listing page: "Other side" block (M6).
- Home: side-match strip for open requirements.
- Complementary side screen: "You have the left side. These sellers have the right one."
- Seller side: after publishing a single side, "3 buyers are looking for this part"; "Buyers looking for your parts" lists
  requirements for the side they hold.
- Requirements (M11) and alerts (M12) match on side.

**Phase.** MVP (side field, filter, complement search, alerts). P2: mirror numbers, pair suggestions across two sellers, "either".

**Inspiration.** RA (side convention, "order quantity 2 for both sides", axle sets), New (everything else).

## M9 · Enquiry, offers and negotiation (MVP) — U1, U2, F6

**Purpose.** Turn interest into an agreed price and quantity with a record, not a lost phone call.

**Enquiry.** From the listing: quick options (Is it still available? · Send more photos · Send a video · Full specifications ·
Will it fit my machine? · Best price for N pcs) plus an optional message; the buyer's last "Check my machine" choice is attached. Opens a
thread tied to that listing (M10). P2: **enquiry basket**, one enquiry to several sellers of the same part (F2F), capped at 5.

**Offer.** Price per unit, quantity (≤ available, ≥ minimum order), validity (24 h / 48 h / 7 days), note. Shows the total and
"12% below asking". Only for negotiable listings; fixed-price listings get "Buy at this price" (an offer at the asking price
that the seller confirms).

**State machine** (built as `OFFER_STATUSES`): pending → countered → accepted / rejected / expired / withdrawn.
- Receiver can accept, reject (optional reason) or counter. Counters bounded between the last offer and the asking price; after the first counter, every counter lies between the two sides' latest prices (F6 + F7 spec §7.4).
- Maximum 5 counter rounds (`MAX_COUNTER_ROUNDS`); one open offer per buyer per listing.
- Accept → deal created (M13); quantity reserved as a stock hold (the listing stays live with the rest available, and is reserved only when all of it is held; F6 + F7 spec §8); other open offers on that quantity are told "quantity no longer available"
  and kept as backups if stock remains.
- Expiry job closes offers at validity end; both sides notified.
- Unverified buyers: up to 3 open offers at a time; they chat like anyone else, within 10 new enquiries a day (40 when GST-verified; F6 + F7 spec §7.8, §12.1).

**P2.** Seller auto-accept / auto-decline thresholds (EB); "send offer to people who saved this" (EB offers to watchers);
quotation PDF from the thread (IM Lead Manager).

**Inspiration.** EB Best Offer (seller 24 h / buyer 96 h response windows, auto-accept / auto-decline thresholds), SR (offer, shipping quote ticks), TSM M7 (built pattern).

## M10 · Chat, calls and sharing (MVP) — F6

**Purpose.** All talk about a listing in one thread, with structured cards for offers, deals and bookings.

- One thread per buyer × listing; inbox with All / Buying / Selling / **Your turn**; search; archive.
- Messages: text, photos, video, PDF (spec sheets, invoices), voice notes; structured cards for enquiry, offer, counter, deal,
  booking, requirement reply; system lines ("Kamal Earthmovers accepted ₹36,500 /pc").
- "Ask for more photos / video" quick replies for sellers; saved replies (IM Lead Manager).
- **Phone numbers hidden** until there is a deal and both sides tick "Share my number" (F6 + F7 spec §6.6, R6); masked calls (P2, Exotel) ring the seller's
  registered numbers (IM PNS); call outcome lines in the thread.
- Share a listing to WhatsApp; "Continue on WhatsApp" after a deal if both agree (MA WhatsApp contact).
- Report or block from the thread.

**Phase.** MVP: threads, cards, media, hidden numbers, share. P2: masked calls, saved replies, quotation builder, labels and
reminders. **Inspiration.** IM (PNS, Lead Manager), MA (WhatsApp), TSM M8 (built pattern).

## M11 · Buyer requirements (RFQ) and matching (MVP) — U3, F8 (as in TSM M9)

**Purpose.** When a buyer cannot find a part, a machine or a rental, they post a structured requirement. Matching sends it only
to sellers whose live listings, stock categories or fitment fit, and **sellers reply by attaching a live listing or sending a
quote**, so the buyer compares real stock, not promises. Every new listing is also checked against open requirements, and the
buyer is alerted on a match (availability alert).

Capping how many sellers are told protects buyers from the call floods that IndiaMART's fan-out causes and makes each reply
worth more to sellers. Fibre2Fashion's pre-owned machinery section shows the demand: about 21 pages of buyer requests against
5 pages of seller offers.

**Workflow.** Post a requirement → (optional) admin screen for spam (IM validates before going live) → **active** → matching
picks the top sellers → sellers see it in "Buyers looking for your parts" and reply → buyer compares replies and auto matches →
enquire / make offer (M9) → deal (M13) → requirement **fulfilled** (or closed by buyer, or expired).

**Requirement form ("Post a requirement").**

| Field | Notes |
|---|---|
| What do you need? | A part · A machine · A rental |
| Category | Same picker as listings |
| Part / machine name | Suggestions from the category |
| Part number | Optional; strongest matching signal |
| Side | Left / Right / Pair / not applicable (part categories with sides) |
| Fits | Machine brand → model → year (P2: or pick from My machines) |
| Required specs | Category template fields; each can be "any" |
| Quantity | Number + unit |
| Condition accepted | New / Unused / Used / Excess (multi) |
| Budget per unit | Optional; "show to sellers" or private |
| Needed by | Date; "urgent" flag (machine down) raises distance weight |
| Deliver to | Prefilled from profile; search radius 50 km / 200 km / state / all India |
| Who can reply | Verified sellers only (default) / any seller (the default is settled in the F8 spec) |
| Reference photo or drawing | Optional (photo of the broken part, nameplate) |
| Validity | 7 / 15 / 30 days; renewable |
| Quick mode | Three fields (what, quantity, city) for speed, completed later (TI short RFQ); no-login capture with OTP at submit (F2F Express Posting, but with machinery fields) |
| Rental requirement | Machine type, capacity, dates, site location, operator needed, hours per day |

**Matching rules.**
- Score = part number / mirror / cross-reference match + category and part name match + fitment overlap + **side
  complement** + spec match + condition accepted + quantity fit + distance + seller response rate + verification.
- Notify the **top 15 sellers** (admin-configurable); others can still reply from "Buyers looking for your parts" (and
  the Wanted tab, P2). Sellers on paid plans (P2) get early access, never more reach than the cap
  (details: F8 spec).
- Sellers see a requirement card: what, side, quantity, fit, condition accepted, budget (if shown), area and distance,
  needed by, buyer verification and history (requirements posted, deals done); **not the buyer's phone**.
- Seller actions: **Reply with my listing** (pick from live listings, or create one inline), **Send a quote** (price per unit,
  quantity, condition, origin, delivery days, note), Ask a question (P2), Not relevant (improves matching; IM).
- **Availability alert:** every listing that goes live is checked against active requirements; a match notifies the buyer
  ("Your right tie rod end is available, 6 km away") and appears under Auto matches.
- Buyer sees **Replies** and **Auto matches** tabs and a compare table: price, quantity, condition, side, fit, distance, seller
  rating, photos, delivery; then Enquire or Make offer.

**Status** (`PART_REQUEST_STATUSES`): active → matched (at least one reply or match) → fulfilled (deal made) / closed by buyer
/ expired. Buyers can edit, extend, pause or close; sellers stop seeing closed requirements.

**Public demand (P2).** Requirements can be shown in the Wanted tab of each category and on public web pages, contact hidden
(F2F buy leads, SR wanteds), which brings sellers to the app.

**Phase.** MVP: form, matching with cap, seller replies with listing or quote, auto matches, alerts, compare, statuses. P2:
quick mode without login, public wanted pages, ask a question, early access for paid plans.

**Inspiration.** TSM M9 (reply with a lot, compare table, capped notifications), IM (BuyLead card, "not relevant"), AL (RFQ
reviewed then up to 15 quotes), SR (Wanted with budget band and private note), MT (Want-To-Buy and Auto-Search Matches),
F2F (buy leads, Quote Now, Express Posting). New: matching on part number, fitment and side.

## M12 · Alerts, saved searches and follow seller (MVP saved searches; P2 rest) — F8, F9

- **Saved searches** with filters (including side and fit); new results by push or a daily digest; cancel any time (MS).
- **Requirement alerts** (M11), the strongest alert.
- **Price drop and back in stock** on saved listings (MT watch list).
- **Follow a seller**: new listings from them (MA).
- **Seller alert settings**: which categories, machines and radius they want requirements for (TI inquiry settings).
- Limits: up to 20 saved searches per user (F2F allows 10 Trade Match alerts); digests respect quiet hours (M16).

**Inspiration.** F2F (Trade Match), MS, MT, MA, TSM M10.

## M13 · Deals and history (MVP) — F7

**Purpose.** A shared record of what was agreed, even when payment happens outside the app. None of the researched machinery
platforms records anything after first contact.

- An accepted offer (or a confirmed rental booking) creates a **deal**: listing, buyer, seller, agreed price per unit, quantity,
  total, payment (outside the app: bank transfer, UPI, cash, credit; advance + balance allowed), pickup or delivery, expected
  date, notes.
- Statuses (built as `DEAL_STATUSES`): agreed → completed / cancelled / disputed. Steps inside agreed: payment recorded
  (optional), handed over / delivered, confirmed by buyer.
- Timers (TI, in calendar days): after "handed over", the buyer has 2 days to report a problem; with no report, the deal
  completes automatically after 3 days (F6 + F7 spec §9.3).
- Completing a deal reduces listing quantity; at zero the listing becomes sold (or rented for rentals).
- Cancel with a reason (either side before handover; both must agree after); stock returns to the listing.
- Problem report opens a support ticket (AD5); deal goes to disputed until resolved.
- Deal history for both parties; per-deal timeline; export (P2: GST invoice from the seller's details, IndustryBuying style).
- Contact details (phone, address) shared inside the deal by consent.

**Phase.** MVP. **Inspiration.** TSM M12 (built pattern), TI (report window, auto-release timers), New (off-platform record).

## M14 · Machinery rental (MVP basic; P2 operations) — F5, F7, A1, A4

**Purpose.** Let owners rent out idle machines (excavators, backhoes, cranes, forklifts, compressors, generators, tractors) and
let contractors and factories find one nearby with clear terms.

**Rental listing fields.**

| Group | Fields |
|---|---|
| Machine | Category, brand, model, year, capacity specs, photos, video, current hour meter |
| Rates | Per hour, per shift / day (shift hours, default 8), per week, per month (month definition: 26 days or N shifts), overtime per hour; P2 per acre for farm machines |
| Minimum | Minimum duration and unit (e.g. 4 hours, 1 day) |
| Operator | Included · Optional (rate) · Not available · Mandatory |
| Fuel | Client supplies (default in India) · Included · Charged per litre |
| Transport | Owner delivers (mobilisation charge and / or per km) · Renter picks up; works within N km of base |
| Money | Security deposit, advance required, damage terms, insurance required (P2) |
| Availability | Calendar with booked and maintenance blocks; "indicative until the owner confirms" |

**Booking workflow.** Request booking (dates, charged by hour / day / week, site location, operator, fuel, note) → owner
confirms, counters (reusing offers, M9) or declines → confirmed → advance recorded (off-app) → machine on site (hour meter +
photos at handover) → on rent → (P2) extension requested / extended (one tap, DZ) → off-rent requested (now or scheduled; P2
partial quantity, ES) → returned (closing hour meter, damage check) → closed → reviews both ways.
Exit branches: cancelled by renter, cancelled by owner, expired (no owner reply in 24 h), disputed.

Built enum today: `RENTAL_BOOKING_STATUSES` (to align with this list when M14 is designed in detail). How the listing's
`rented` status follows bookings is also left to the M14 spec.

**Search.** "For rent" listing type; filters for machine type, capacity, with operator, available on my dates, distance; rates
shown per chosen period plus transport.

**Phase.** MVP: rental listing, rates, operator / fuel / transport terms, availability calendar, booking request and
confirmation, on rent / returned, rented status, reviews. P2: daily logsheet (start / end hours, fuel, operator sign-off; RNTL,
AUEQI), extensions and off-rent scheduling, deposits through payments (M20), telematics links, owner re-sourcing (DZ).

**Inspiration.** DZ (rates incl. delivery, owner confirms, Extend), ES (off-rent now / scheduled, partial), YC (idle machines,
owner-set prices, two-way ratings), TR / RNTL (operator included, client diesel, mobilisation, logsheets), MA and MT (rent as a
type). Avoid inconsistent terms on one page (BigRentz, TransRentals): one set of terms per listing, shown once.

## M15 · Reviews (MVP) — F7

- Only the two parties of a **completed** deal or rental can review, within 14 days.
- Buyer reviews seller: part matched the listing, communication, handover on time (1–5 each) + text. Seller reviews buyer:
  communication, payment as agreed, pickup on time. Rental: machine condition, operator, timeliness; owner rates renter's care.
- Double-blind: published when both have reviewed or after 7 days (each review stays with its author until both are in, or until 7 days after it or 14 days after completion, whichever comes first; F6 + F7 spec §10.3). Scores show after 3 reviews; seller can reply once.
- Report a review; moderators can hide abusive text.

**Inspiration.** IM (rating facets), YC (two-way), TSM M14 (built pattern). Avoid MA / SR / MT, which show no buyer reviews.

## M16 · Notifications (MVP) — F9

| Event | Push | In-app | SMS / WhatsApp (P2) |
|---|---|---|---|
| New enquiry, new message | ✓ | ✓ | digest |
| New offer, counteroffer, accepted / rejected / expired | ✓ | ✓ | accepted only |
| **New matching part** (requirement or saved search) | ✓ | ✓ | ✓ (opt-in) |
| Booking request, confirmed, on site, returned (P2: extension) | ✓ | ✓ | confirmed |
| Listing approved / rejected / expiring / sold out | ✓ | ✓ | — |
| Deal agreed, handed over, completed, problem reported | ✓ | ✓ | completed |
| Verification approved / rejected | ✓ | ✓ | ✓ |
| Review received | ✓ | ✓ | — |

Notification centre grouped by what the user must do; per-category switches; quiet hours (default 22:00–07:00, urgent
requirement matches allowed); en / hi / gu text. **Inspiration.** IM (channel matrix), TSM M15 (built pattern).

## M17 · Seller dashboard (MVP basic; P2 analytics) — U1, F1

- **Needs you:** offers to answer, enquiries without a reply, requirements you can serve, bookings to confirm, listings expiring.
- **Numbers:** live listings, views this week, enquiries, deals and value this month, reply rate and time.
- **My listings** by status (Live, In review, Paused, Sold, Rented) with views, enquiries and offers per listing; quick actions
  (edit, update quantity, pause, mark sold, mark unavailable, remove).
- **Health nudges:** listings without video, part number or fit; stale listings.
- P2: per-listing stats over time, search terms that found you, demand in your categories (requirements per part), team
  performance.

**Inspiration.** F2F (lead manager), MC and MA (stats), TSM M16.

## M18 · Plans and monetization (P2; free at launch) — A6

Launch is free so supply builds up. Planned, published plans in rupees (SR publishes prices; Mascus, Machinio and
MachineryTrader don't, and get complaints):

| Plan | Who | Includes |
|---|---|---|
| Free | Every verified business | Up to 25 live listings, requirement replies, offers, chat, rental listings |
| Pro (monthly / yearly) | Dealers and stockists | More live listings, bulk upload and feeds, stats, early access to requirements (never beyond the cap), team members, verified-fit help |
| Boosts and Featured | Any seller | Featured on home or a category for a period; "Urgent clearance" tag for excess stock |
| Rental Pro | Fleet owners | Calendar sync, logsheets, multiple machines and operators |

Rules: no pay-per-lead (IM's ₹60,000 / year for ~15 leads a week and lead-quality complaints are the counter-example); payment
never buys badges, ranking in requirement matching, or reviews; boosts are labelled "Featured".

## M19 · Trust, safety and fraud prevention (MVP) — A2, A3, A6

- GST verification and badge (M1); business verification and video KYC with stock proof (P2, IM TrustSEAL); years on platform
  and deal count on the seller block (SR, MA).
- Real photos required; duplicate and stock-image detection (perceptual hash, P2); price and unit sanity checks.
- Report listing, user, review, message (reason + optional photo); "Report suspicious ad" on every listing (MA).
- Moderation queues (AD3), suspensions (built: `account_status` suspended / blocked; sign-in refused), reasons shown to the user.
- Rate limits on enquiries, offers and requirements; new-account limits (3 open offers; an unverified business may have at most 3 open
  listings, any status except draft, sold, removed).
- Scam warnings in chat when a message asks for advance payment to an unverified account or contains a payment link; "never
  pay before inspecting a used machine" tip on machine listings (EX recommends inspection).
- Hidden phone numbers until a deal or consent (M10).
- Be explicit about what the platform does not guarantee (SR offers "buyer protection" while disclaiming all guarantees; IM's
  protection covers non-delivery only, needs an FIR above ₹1 lakh (a registered police complaint below) and caps the payout
  at ₹5 lakh).

## M20 · Payments (P2) — later

MVP records payment outside the app (M13). P2 options, in order of value: advance for rentals and deposits; pay-in for parts
with a hold until "received" (TI timers: 2 business days to report, auto-release after 3 business days); support **advance + balance** for machines
(TI Pay's full-upfront rule doesn't fit machinery). Gateway: Razorpay (as in TSM). Decide with the client (Decision D7).

---

## Admin panel (U4, A1–A6)

Desktop-first web app (Next.js), same visual tokens as the app, role-based, every action audit-logged. Navigation is already
built in `apps/admin/lib/nav.ts`: Queues, Marketplace, Machine configuration, Insights & growth, System.

### AD1 · Dashboard (MVP) — A1
KPI tiles: businesses / users, active listings, parts available, machines for rent, new enquiries, offers, deals (count and
value), rental bookings, sold / closed listings, open requirements and match rate. Charts: enquiries to deals by week; top
industrial areas and categories; requirement fulfilment time; reply rate. Filters by date, city, category.

### AD2 · Users and business verification (MVP) — A2
Business list with search (name, phone, GSTIN, city); profile, listings, deals, reports, activity. GST is verified instantly
through the provider; the verification queue holds only the fallback reviews (provider down or off, GSTIN not found, code
not receivable): GSTIN lookup data (when there is any) side by side with what the business entered and its uploaded
documents; approve / reject with reason / ask for more documents; revoke GST. Suspend / block /
reinstate with reason (sign-in refused while suspended). Reported users.

### AD3 · Listing moderation and management (MVP) — A3
Queue: every listing of an unverified seller, the first 3 of a verified seller, reported listings, flagged price / unit / duplicate photos. Review screen: photos, specs,
fit, side, price, seller history; actions approve, ask for changes, reject with reason, edit (category, fit, side), hide,
remove. All-listings table with filters (status, type, category, city, side, seller), bulk actions, sold / unavailable monitor.
Requirements queue (M11) for spam screening.

### AD4 · Categories and machine configuration (MVP) — A4
Category tree editor (drag, merge, rename, counts), brands and models (years, variants), fitment verification queue and
"missing model" requests, spec templates per node (field, type, unit, required, filterable, shown on card), master data (units,
conditions, price models, rental periods), **side options per category** ("parts in this category have sides" switch and the
side convention text), rental fields, synonyms for search. "Preview seller form" before saving. Changes need no app release.

### AD5 · Enquiries, offers, deals and rentals (MVP) — A5
Read-only views of threads (on report or dispute), offers and counters, deals and their steps, rental bookings; disputes queue
with timeline and decisions; reported conversations.

### AD6 · Reports and controls (MVP basic) — A6
Reports and flags queue (users, listings, messages, reviews) with outcomes; fraud signals (many accounts per device, repeated
phone in chats, payment-link messages); activity reports (exports). Featured / promotional listings and plans when M18 is on.
Notifications broadcast (P2). Settings: requirement seller cap (15), listing expiry (60 days), offer validity options, quiet
hours, new-account limits.

### AD7 · Settings, roles and audit log (MVP)
Admin users and roles (super admin, moderator, verification officer, category manager, operations, support), audit log
(who, what, when, before / after).

---

## Release plan

| Phase | Contents |
|---|---|
| **MVP** | M1–M3, M4 core, M5–M11, M12 saved searches and requirement alerts, M13, M14 basic, M15, M16 push and in-app, M17 basic, M19; admin AD1–AD7 |
| **P2** | Fitment depth (serials, cross-references, mirror numbers, verified fit, My machines, CSV), enquiry basket, compare, masked calls, rental operations (logsheets, extensions, off-rent, deposits), plans and boosts (M18), payments (M20), public wanted and SEO pages, Pro analytics, team members, "Business verified" level (documents or video KYC; GST review documents are MVP) |
| **P3** | Dealer inventory feeds and synced dealer pages, auctions for used machines, inspection service with structured reports (EB Verified Condition), valuation help, financing partners, logistics quotes |

## Business model

Free at launch to build supply. Then: seller plans (Pro, Rental Pro), boosts and Featured slots, urgent clearance promotions,
later inspection and valuation services, financing and logistics referrals, and transaction fees once payments (M20) exist.
No pay-per-lead and no paid trust badges.

## Decisions needed from the client

(Also listed at the end of the design mockup.)

1. **D1 Name and logo.** "Machine Parts" is a working name; the side mark is a placeholder logo.
2. **D2 Visual direction.** Steel, ink and safety yellow (mockup). Approve or ask for a second direction.
3. **D3 Side convention.** Left = seen from behind the machine, facing forward (operator's view). Confirm with sellers; some
   trades may use a different reference per machine type.
4. **D4 First listing review.** Every listing from an unverified seller and the first 3 of a verified seller are reviewed by
   the team; after that, a verified seller's listings go live at once unless flagged (as built in F2).
5. **D5 Requirement reach.** Each requirement goes to up to 15 matching sellers. Raise or lower?
6. **D6 Phone numbers.** Settled in F6 + F7 (R6): hidden until there is a deal and both sides tick "Share my number".
7. **D7 Payments and rental money.** Off-app at launch (recorded only). When should advances, deposits and payments move in?
8. **D8 Launch region.** Screens use Rajkot and Saurashtra examples. Confirm first cities and industrial areas.
9. **D9 Categories at launch.** Which machine categories first (tractors, earthmoving, CNC, textile, trucks, pumps)? Who supplies
   the first brand / model lists?
10. **D10 Monetization timing.** Free for how long, and which plan first?

## Open questions (product and engineering)

- ~~Add "either side" to `PART_SIDES` now or in P2?~~ Settled (F2 + F4): P2. MVP sides are left, right, pair, not applicable;
  a Left search shows Left then Pair, Pair shows only Pair, "not applicable" never matches a side filter. (RA "no side = fits
  either side".)
- Add Refurbished and Defective / for parts to `CONDITIONS`? (MS has Defective.)
- Generalise `part_requests` to requirements of kind part / machine / rental (this document assumes yes).
- Align `RENTAL_BOOKING_STATUSES` with the M14 workflow when the rental spec is written.
- Fitment data source: sellers and admins only, or license a catalogue later?
- Data residency for media (R2 has no India region), as in TSM.
