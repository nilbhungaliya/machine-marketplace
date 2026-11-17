# Competitor research (2026-11-16)

Source notes for `docs/product-scope.md`. Every fact carries a source URL. Several sites block automated fetching
(Fibre2Fashion behind an AWS WAF challenge, the Sandhills sites, Exapro, Machinio, Kitmondo and eBay search pages with 403), so
some facts come from Wayback Machine snapshots, help centres, app-store pages or search snippets; each note says which. Nothing
behind a login was seen.

| File | Covers |
|---|---|
| `2026-11-16-fibre2fashion-machines.md` | Fibre2Fashion Machinery: structure and URLs, the 465 product types, listing and detail fields, buyer and seller tools, plans, trust, used / parts / rental gaps, weaknesses, ideas |
| `2026-11-16-used-machinery-marketplaces.md` | Exapro, Machinio, Kitmondo, Surplus Record, Mascus, MachineryTrader, eBay Business & Industrial, Alibaba; comparison table |
| `2026-11-16-india-b2b-rental-and-parts-fitment.md` | IndiaMART, TradeIndia, Moglix, IndustryBuying, OLX, Machineseeker India; DOZR, BigRentz, EquipmentShare, Yard Club, Indian rental platforms; RockAuto, boodmo, PartSouq, Amazon, Cat, John Deere; recommended fitment, side and rental data models |

**Headline findings**

- No researched industrial marketplace has structured "fits these machines" data; only eBay does, and only for vehicles.
- No platform models Left / Right / Pair for industrial parts; RockAuto's car-parts convention is the closest reference.
- Only MachineryTrader searches by part number; Fibre2Fashion has no part numbers, fitment, side or rental at all.
- Demand outruns supply for used machines on Fibre2Fashion (about 21 pages of buyer requests against 5 of seller offers), which
  supports a strong requirement (RFQ) module.
- No platform records a deal after first contact when payment is off-platform.
- IndiaMART's escrow ended in March 2024 and its 2026 protection is narrow; TradeIndia's TI Pay timers are worth copying.
