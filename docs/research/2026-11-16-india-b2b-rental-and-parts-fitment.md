# Competitor research: Indian B2B machinery and parts marketplaces, equipment rental, parts fitment

Researched 2026-11-16 with WebSearch and WebFetch. The report records facts as each source states them, with URLs. Where sources disagree or a claim is self-reported, the text says so.

**Access limits:**
- Google Play listings (IndiaMART, boodmo) returned only navigation, not description text. Install and rating figures come from AppGoblin, a third-party tracker, or from the Apple App Store.
- These sites refused or timed out on automated fetch: bigrentz.com (403), partstree.com (403), partsouq.com home page (403), olx.in (timeout), cat.com blog (timeout).
- boodmo.com is a JavaScript app and returned an empty page.
- For the sites above, the report relies on search snippets, help-centre pages, and press or dealer sources instead.

---

## A. Indian B2B marketplaces for machinery and spare parts

### A1. IndiaMART (indiamart.com)
**Positioning.** A horizontal B2B lead-generation directory. Used machinery is a top-level section: "Refurbished Products > Used Machinery & Equipments", with subcategories that show listing counts (e.g., Used Lathe Machine 401, Used Mini Offset Printing Machine 3,759). Source: https://dir.indiamart.com/indianexporters/used-machinery.html. Search snippets also cite about 494 used VMC listings and 275 used CNC turning listings.
- **App:** com.indiamart.m. AppGoblin reports about 45.2M installs, a 4.75 rating from 806K ratings, and an update on 2026-11-12. Its description covers searching products and suppliers, posting requirements, requesting and comparing quotes, chatting with suppliers, and reviewing supplier profiles. Source: https://appgoblin.info/apps/com.indiamart.m

**Key features**
- **Post Buy Requirement / "Get Quotes":** The buyer enters product details. IndiaMART validates the requirement before it goes live and connects the buyer to suppliers by email and phone. If a requirement is not live within 48 hours, the buyer should contact support. Sources: https://help.indiamart.com/knowledge-base/buying-requirement, https://help.indiamart.com/knowledge-base/details-for-posting-buy-lead
- **BuyLeads:** IndiaMART filters buyer requirements and pushes them to relevant suppliers. Consuming a BuyLead reveals the buyer's contact details.
  - Alerts go out by email, SMS and app push.
  - The seller panel has Recent Leads and Shortlisted (star-marked) Leads tabs, plus a history of used and lapsed leads.
  - Sellers can give feedback on an irrelevant lead.
  - Under the Advantage Program, 1 BuyLead equals 200 points.
  - Sources: https://help.indiamart.com/knowledge-base/how-to-consume-buyleads-in-indiamart, https://help.indiamart.com/knowledge-base/buylead-cost
- **Lead Manager:** One inbox that merges buyer conversations from desktop, mobile site, app and email. Its features are Manage Contacts, Instant Reply, Saved Replies, Create Quotation, Reminder, Notes, Labels, Enquiry, and Email Syncing. Source: https://help.indiamart.com/knowledge-base/lead-manager
  - The Android release 12.4.7 added offline reply, call, reminders and notes in Lead Manager and chat. Source: https://help.indiamart.com/knowledge-base/android-launch-app-version-12-4-7
- **PNS (Preferred Number Service):** A virtual number that masks the seller's real numbers.
  - A call to the PNS rings all of the seller's registered numbers at once.
  - The seller must register at least 3 numbers, and at most 5 can link to one PNS.
  - The PNS is shown on quotations and across all IndiaMART surfaces. Spam callers can be blocked.
  - Sources: https://help.indiamart.com/knowledge-base/preferred-number-service, https://help.indiamart.com/knowledge-base/add-update-view-pns-number, https://help.indiamart.com/knowledge-base/block-spam-call
- **Pay with IndiaMART (escrow):** Launched in 2017 with an ICICI Bank escrow account. It was **discontinued on 31 March 2024**. Sources: https://help.indiamart.com/knowledge-base/indiamart-payment-protection, https://corporate.indiamart.com/2017/04/10/indiamart-forays-into-payments-space-launches-buyer-seller-protection-program-escrow-service/
- **Buyer Payment Protection Plan (from 12 Feb 2026):** The terms state it is not escrow or insurance.
  - It covers only *complete non-delivery*, up to INR 5,00,000.
  - Conditions: the match must have been made on IndiaMART, the seller must be TrustSEAL at the time of matching and of the transaction, and the product must have been in the seller's catalogue.
  - Payment must go only to the seller's verified business bank account. Cash is excluded.
  - The buyer must be KYC-verified and claim within 60 days.
  - Required documents: an FIR above INR 1 lakh (a police complaint below that), a proforma invoice, proof of payment, and a notarised affidavit.
  - Quality disputes and partial delivery are excluded.
  - Source: https://help.indiamart.com/knowledge-base/payment-protection-plan

**Trust and verification (TrustSEAL Pro).**
- **Verification steps:**
  1. Automated checks: GST validation via OTP, a bank-account name match, and no open buyer-supplier conflict tickets.
  2. A video KYC call. Identity proof can be a shop signboard, Udyam or a registration certificate. Product proof can be live stock or purchase invoices from the last 3 months. Location proof can be a live WhatsApp location or an address proof.
  3. The stamp is activated and a certificate is issued.
- **Benefits:** A catalogue logo, higher listing position, and eligibility for the payment protection above.
- Source: https://help.indiamart.com/knowledge-base/trustseal-pro/
- Search-result storefronts also show "GST", "TrustSEAL" and "Payment Protected" badges plus a star rating with a review count, e.g. "4.1 (87)". Source: https://m.indiamart.com/isha-texmach/introduction.html

**Monetisation.** Paid seller subscriptions.
- TrustSEAL Pro costs Rs 60,000 for 1 year, Rs 90,000 for 2 years or Rs 1,20,000 for 3 years (excluding taxes). It includes 14 BuyLeads per week plus 1 bonus per day, an effective cost of Rs 55, 41 or 37 per lead, and price-hike protection for the plan length. Source: https://help.indiamart.com/knowledge-base/trustseal-pro/
- Higher tiers (IM Star Pro, IM Leader Pro) add category-wise BuyLeads. Source: https://help.indiamart.com/knowledge-base/buy-lead-allocation
- The developer surface is a Lead Pull API only, according to a third-party integrator: https://ecosire.com/apps/erpnext/erpnext-indiamart-store-management

### A2. TradeIndia (tradeindia.com)
**Positioning.** One of India's oldest B2B directories. It also runs TI Shopping, a direct-buy storefront where TradeIndia pays on behalf of the buyer and gives 14 days interest-free credit. Source: https://www.freepressjournal.in/business/tradeindia-ventures-into-b2b-commerce-space-launches-ti-shopping-where-customers-can-buy-directly-from-platform

**Key features.**
- The app offers Buy Leads, sending quotations, and enquiry alerts (App Store listing: https://apps.apple.com/in/app/tradeindia-app/id1049304422; the fetch returned 429, so these details come from the search snippet).
- **TI Pay (escrow-style):**
  1. Buyer and seller agree terms.
  2. The buyer deposits the full amount. Partial payments and EMI are not allowed, and milestones must be separate transactions.
  3. TI Pay tells the seller to ship.
  4. The buyer confirms delivery.
  5. Funds are released in 24–48 hours, or automatically 3 business days after delivery if the buyer has not complained.
- **TI Pay disputes:** A wrong product must be reported within 2 business days, followed by 15 business days for the parties to resolve it. After that, TI Pay may refund the buyer.
- **TI Pay rules and fees:** Nothing can be changed after payment except a delivery extension, which the buyer must confirm. The service itself is free. The buyer pays gateway charges: debit card 0.73–0.97%, credit card 1.80%, and net banking 1.60% for HDFC or a flat INR 16 for other banks.
- Source for TI Pay: https://www.tradeindia.com/ti-pay/faqs.html

**Trust.** Every seller must accept TI Pay (FAQ). Trustpilot reviews include complaints about lead quality: https://ch.trustpilot.com/review/tradeindia.com. A "TrustStamp" programme could not be confirmed.

**Monetisation.** Paid seller memberships for visibility and leads. No current price list was found.

### A3. Moglix (moglix.com)
**Positioning.** B2B and B2C e-commerce for MRO and industrial products. It promotes "AI-Powered Procurement for Your Business" through Moglix Business (business.moglix.com).

**Features.**
- An RFQ link (moglix.com/rfq) for bulk orders.
- "24 hrs Delivery" with a pincode-based delivery-location selector, and order tracking.
- Categories include Industrial Tools, Power Tools, Packaging & Material Handling, and Agriculture. Small-engine spares such as carburettors are listed.
- Source: https://www.moglix.com/

**Model.** Holds inventory for key SKUs and supports bulk and customised orders (https://inc42.com/features/away-from-the-buzz-how-moglix-built-a-700-mn-global-b2b-marketplace/). Credlix provides supplier-side invoice discounting (https://www.credlix.com/blogs/moglix-suppliers-get-credlix-scf-advantage).

**Monetisation.** Product margin on a catalogue model, not a lead marketplace.

### A4. IndustryBuying (industrybuying.com, IB MonotaRO)
**Positioning.** "India's most trusted B2B E-commerce Site". It claims 15 lakh+ business customers. Brand counts are inconsistent on the page: 8,000 in one place and 12,000+ in another.

**Features.**
- GST invoice issued on delivery and downloadable from the portal. Claims "up to 18% GST benefit".
- Bulk discounts and free delivery.
- **IB Credit:** 30 days interest-free.
- No-cost EMI, and COD for industrial equipment so the buyer can inspect before paying.
- 7-day returns.
- Payment by cards, net banking, UPI and wallets.

**Categories** relevant to parts: Bearings, Motors/Power Transmission, Tooling & Cutting, Industrial Automation, Abrasives. Source: https://www.industrybuying.com/

**Monetisation.** Retail margin plus credit.

### A5. OLX India (olx.in)
- Hosts some individual industrial-machine ads, e.g. a used industrial sewing machine in Aluva. The ad shows a rupee price, locality, ad ID and "Report this ad". Source: https://www.olx.in/item/c1417-stitching-machine-in-pulinchode-junction-aluva-iid-1825830074
- The category page timed out on fetch. Search found **no dedicated industrial-machinery taxonomy, GST verification or B2B tooling** on OLX India (Pakistan's OLX does have "Trade & Industrial"). OLX is a consumer classifieds model: ad, chat or call, then offline deal.

### A6. Machineseeker India (machineseeker-india.com), used-machinery classifieds and auctions
**Positioning.** "The leading marketplace for machinery". It claims 8,100+ sellers, 200,000+ listings and 11M monthly visitors (self-reported). Source: https://www.machineseeker-india.com/

**Filters**
- Category, manufacturer and price range, with an "only with price" option.
- Year of manufacture.
- **Condition:** New, Ex-display, Used, Defective.
- **Location radius** from 10 km to unlimited.
- Listing type: Classified or Auction.
- "Only verified dealers", plus images-only and video-only options.
- Category-specific technical filters such as kW, weight, load capacity and voltage.
- **Sort options:** price, date, distance, year, runtime.

**Listing card**
- Photos with a counter, location and distance, title, manufacturer and model.
- Price with a sales term (e.g., "EXW ONO plus VAT", "Fixed price plus VAT") or "Price info".
- Condition, year, and sometimes operating hours.
- Actions: Inquire, Call, "Request more images".

**Saved searches and requests**
- "Save search query" sends new offers by email immediately and for free, and can be cancelled at any time.
- There is also a Watch list and a "Submit request" option.
- Source: https://www.machineseeker-india.com/mss/textile+machinery

**Trust and monetisation.** A "Trust Seal" for dealers. Paid listing plans, auctions and banner ads (https://www.machineseeker-india.com/).

### A7. Other Indian used-machinery channels (vertical and dealer)
- **Textile:** Search found no single dedicated used-loom marketplace. The channels that exist are:
  - IndiaMART's "used textile machinery" category: https://dir.indiamart.com/impcat/used-textile-machinery.html
  - Fibre2Fashion buyer "wants" pages, e.g. a Mumbai buyer seeking Sulzer looms: https://www.fibre2fashion.com/machines/india-looms-buyers-p1022-c71
  - Textile Infomedia's broker directory: https://www.textileinfomedia.com/used-machine-broker.htm
  - Dealers such as Looms Store (Surat) and Isha Texmach.
- **CNC:** Machine City (Mohali) is a dealer-run online marketplace. It says it has traded 2,000+ CNC and conventional machines, sourced partly from Canada, the USA and Singapore. Source: https://istckonnect.com/business/machine-city
- **Imports:** Asset-Trade notes that importing used machinery into India requires a **Chartered Engineer Certificate issued before shipment**. Source: https://www.asset-trade.de/en/country/india

---

## B. Equipment rental platforms

### B1. DOZR (dozr.com), North America
**Positioning.** An online heavy-equipment rental marketplace that aggregates prices and availability from partner rental companies. It has no fleet of its own. Partner counts are inconsistent: the page says both 15,000+ and 1,000+, and another DOZR page says 900+. Sources: https://dozr.com/, https://help.dozr.com/faq/how-dozr-works

**Booking flow**
1. Enter the location and dates.
2. Choose equipment by category and specs.
3. Compare local suppliers, with rental **and delivery** rates shown.
4. Select a supplier and check out by credit card or an approved DOZR credit account.
5. The supplier confirms. Confirmation arrives by email and appears in the order tracker.
6. If the supplier cannot fulfil, DOZR's team re-sources from another nearby supplier.

The order tracker covers delivery updates, off-rents and invoices. To extend, the renter uses the "Extend Rental" button in the confirmation email or calls DOZR.

**Rates and terms**
- Suppliers post **daily, weekly and monthly** rates. A day means up to 8 hours of use, and overtime fees may apply.
- A weekend special charges one day for Friday-afternoon delivery and Monday-morning pickup.
- Delivery is priced by distance and set by the supplier. Self-pickup is allowed if the renter has a trailer.
- A Rental Protection Plan is auto-added to every rental, covering up to $500,000. The pages do not mention deposits.
- "Rent now, pay later" is offered.

**Supplier side.** Basic listings are free for verified rental companies (https://dozr.com/blog/how-dozr-marketplace-works-for-partners). Suppliers can also run a branded WebStore and use a Supplier Hub.

### B2. BigRentz (bigrentz.com), US
**Note.** The site returned 403, so these facts come from search snippets of its FAQ and terms.
- Rental periods are defined in **8-hour shifts**. One month equals 20 eight-hour shifts over 28 days. Source: https://www.bigrentz.com/faqs
- **Rental Protection Plan (RPP):**
  - The terms call it "optional" and "not insurance".
  - Another page says RPP is required unless the customer provides a Certificate of Insurance. This is a conflicting statement.
  - Sources: https://www.bigrentz.com/rental-protection-plan, https://www.bigrentz.com/rental-terms-and-conditions
- **Model:** A broker that fulfils through a network of local rental yards.

### B3. EquipmentShare (equipmentshare.com) and T3
**Positioning.** A rental company with its own telematics platform, T3.
- **App:** Reserve a machine, set start and end dates, "off-rent" immediately, and request service. Source: https://www.forconstructionpros.com/home/article/22907934/equipmentshare-t3-takes-a-transformational-approach-to-construction-equipment-and-operations
- **Telematics:** Renters see GPS location, machine health, the upcoming rental cycle and spend. Geofence alerts and trip history are available. Source: https://www.equipmentshare.com/t3/fleet
- **Off-rent (call-off) flow:**
  - Choose "Now" or "Schedule" for a later date.
  - Batch off-rent shows each item's previous and next billing cycle and allows a **partial-quantity off-rent**.
  - Items off-rented together are consolidated into one invoice.
  - Source: http://help.estrack.com/en/articles/3290008-off-rent-or-calling-off-an-equipmentshare-rental-in-t3

### B4. Yard Club, contractor-to-contractor rental (acquired by Caterpillar)
- Founded in 2013 as a P2P marketplace for **idle equipment**, on mobile and web.
- Owners set their own prices.
- The platform verifies the renter's insurance, provides a Master Rental Agreement, screens members, runs **two-way ratings** (renters and suppliers), and collects and deposits payments.
- Commission was about 20% (2015 figure).
- Cat integrated its dealer inventory, and the technology was later ported into Cat's rental apps.
- Sources: https://www.equipmentworld.com/dealers/article/14967266/caterpillar-acquires-yard-club-a-contractor-to-contractor-equipment-rental-service, https://rermag.com/news-analysis/headline-news/article/20950312/caterpillar-invests-in-peertopeer-rental-platform

### B5. Indian rental platforms
- **TransRentals (transrentals.in):** Pricing, terms and coverage are listed below. Source: https://transrentals.in/equipment-rental
  - **Booking form:** 4 steps (Equipment, Schedule, Contact, Review). The first step asks for equipment type, pickup city and address. An AI booking assistant is offered. "No advance payment" for quotes.
  - **Rates:** From Rs 1,499/day. The minimum is 1 day of 8 working hours. Weekly and monthly contracts are discounted.
  - **Operator:** Heavy equipment includes a certified operator, while small equipment (generators, compactors) can be self-operated. One note contradicts this by saying operators and fuel can be arranged separately.
  - **Fuel:** Usually not included; the client supplies diesel at site.
  - **Transport:** Transit charges apply by distance, and remote sites pay a mobilisation charge.
  - **Coverage:** The site claims both 500+ and 250+ cities, which is inconsistent.
  - **City pages:** JCB backhoe from about Rs 2,499/day with operator in Pune, and about Rs 3,999/day for a 3DX in Indore. The Jaipur page says the machine may not be run without their operator. Sources: https://transrentals.in/jcb-on-rent/pune, https://transrentals.in/jcb-on-rent/jaipur
- **RNTL (rntl.co):** Calls itself a "Connected Rental OS" for Indian construction, linking contractors, owners and OEMs.
  - Covers RFQs, inspections, **logsheets**, billing and analytics.
  - Every rental comes with an operator, and it advertises a 24-hour delivery SLA.
  - Operates in South India today.
  - Sources: https://rntl.co/about-us, https://rntl.co/rental/equipments/plant-and-machinery/earthmoving/backhoe-loaders
- **AUEQI:** Digital contracts, real-time availability, and **5,000+ verified equipment profiles** with 200+ owners. Vendors self-register.
  - IoT: GPS, fuel sensors, idle time and utilisation, theft-pattern insights, and maintenance reminders. Digital tracking replaces paper daily logs.
  - Algorithmic pricing is planned, not live.
  - Source: https://www.nbmcw.com/interviews/aueqi-formalizing-indias-equipment-rental-ecosystem-through-digitalization.html
- **Others (press only, unverified):**
  - iQuippo: own and rent listings.
  - Maquina (Ajashy): rental plus pre-owned sales. Source: https://b2bpurchase.com/ajashy-launches-maquina-first-of-its-kind-equipment-management
  - EquipShare India: P2P idle-equipment rental with 5,000+ listings, a 2018 figure. Source: https://yourstory.com/2018/03/unused-construction-equipment-lying-idle-rent-it-out-with-equipshare/
  - Urban Rentals: rent now, pay later. Source: https://urbanrentals.umso.co/faq
  - My Machinee Guru: claims 700+ rental locations. Source: https://m.indiamart.com/my-machine-guru
- **Agriculture:** These platforms rent by the **hour or per acre**. Sources: https://krishijagran.com/farm-mechanization/agriculture-machines-buy-sell-and-rent-tractor-tiller-rotavator-through-this-government-app, https://www.business-standard.com/article/companies/mahindra-group-s-uber-for-tractors-at-farm-gate-116082500959_1.html, https://www.autocarpro.in/news-national/tafe-launches-its-complimentary-tractor-rental-platform-40809
  - The government FARMS app finds nearby Custom Hiring Centres, checks availability and books. It also has used-machinery sale.
  - Mahindra Trringo and TAFE JFarm Services offer hourly tractor booking.

---

## C. Parts compatibility and side handling in parts e-commerce

### C1. RockAuto (rockauto.com)
Source for all points: https://www.rockauto.com/help/?page=2
- **Fitment:** The shopper picks year, make, model and engine, and "All parts listed fit the year/make/model/engine combination you chose."
- **Limiting factors:** Shown in the description, e.g. "RWD vs. 4WD", "2-door vs. 4-door". Build-date breaks appear as "To/Before [date]" and "From/After [date]". Flags mark the market where the vehicle was first sold.
- **Side:**
  - Determined "as if you are sitting in the vehicle".
  - No side listed means the part fits either side.
  - "Will fit the front left OR the front right. If you need both sides, order quantity = 2."
- **Sets and packs:**
  - Parts are priced individually unless stated otherwise.
  - "X per car" or "X required" shows how many are fitted on the vehicle, but the part is still sold individually.
  - Brake pads and shoes are sold as **axle sets**, so quantity 1 covers both wheels.
  - A multi-unit **pack icon** (x2, x4) shows the pack total and the per-unit price.
- **Availability:**
  - An "X Day Delay" label marks parts that are not in the warehouse but can be ordered from a supplier.
  - Closeouts are limited to the quantity on hand and carry no manufacturer warranty.
- **Search:** Accepts year, make, model, part type **or part number**.

### C2. boodmo (boodmo.com), Indian auto-parts marketplace
- **Positioning:** "Your Spare Parts Expert", run by Smart Parts Online Pvt Ltd. Shoppers find parts through **original (OEM) catalogues or by VIN**. The database includes genuine OEM and aftermarket parts, and catalogues are continuously updated.
  - iOS rating 4.4 from about 17k ratings. Complaints mention delivery delays, refunds and platform fees.
  - Source: https://apps.apple.com/in/app/boodmo/id1154010647
- **Catalogue tiers:** OEM original, OES aftermarket, and "analogue" (cross-reference) parts, and the user can pick a tier (third-party: https://mangalorean.com/use-vin-to-find-car-parts-quickly-and-precisely-at-boodmo-com).
- **Number-plate search and part-number access** cost **"Discovery Points"**, which users can earn or buy. The help centre also has a "How do I know if a part is compatible with my vehicle?" article. Source: https://help.boodmo.com/knowledge/article/7
  - This charges for fitment lookups.
- **Sellers:** A marketplace of verified sellers (400+ suppliers in an older profile).
- **Workshop integration:** A 2026 partnership with Autorox, a workshop-software company, links parts discovery to repair jobs. Source: https://www.autocarpro.in/news/autorox-and-boodmo-form-partnership-to-connect-indias-auto-parts-and-repair-markets-131555
- **Back-in-stock:** No "notify me" feature was confirmed.

### C3. PartSouq (partsouq.com), UAE genuine-parts exporter
- **Lookup:** Enter a **VIN or frame number**, which opens the exact OEM catalogue with exploded diagrams. Inside, the shopper searches by part name, **part number or part code**.
- **Manual fallback:** Pick region, year, model and code.
- **Limit:** A Russian-language help notice, undated, says VIN decode is temporarily supported for Toyota only.
- Sources: https://partsouq.com/en/how-to-place-an-order-on-the-partsouq-com-368.html, https://partsouq.com/catalog/toyota. The home page returned 403.

### C4. Amazon Automotive ("Your Garage", Part Finder, Amazon Confirmed Fit)
- **Garage:** The user saves vehicles. Year, make and model are required; trim, drive type, engine and transmission are optional refinements.
- **Fit banner:** Search results show "These products fit your vehicle". Source: https://www.slashgear.com/1604836/amazon-feature-find-compatible-car-truck-parts
- **Data standards:**
  - Fitment uses the industry standard **ACES** (which vehicles a part fits). It is separate from **PIES** (what the part is: numbers and attributes).
  - Fitment is matched to a listing by **brand ID plus part number**.
  - Free-text compatibility in a listing does **not** earn the Confirmed Fit badge, and syncing takes up to about 2 weeks.
  - Sources: https://pcfitment.com/blog/guide-to-submitting-accurate-fitment-data-to-amazon, https://autocare.org/about-us/frequently-asked-questions/details/what-is-aces-and-pies-data
- **Qualifiers:** ACES qualifiers come from a standard Qualifier Database (Qdb). Source: https://www.anglera.com/glossary/aces-aftermarket-catalog-exchange-standard
- **Back-in-stock:** Amazon's built-in "Notify me" is reported as unreliable and not universal (third-party: https://pagecrawl.io/blog/amazon-in-stock-alerts).

### C5. Caterpillar Parts.cat.com
- **Search** by **serial-number prefix, full serial number, or model**. Typing two characters suggests matches. Part-number or keyword search also works without a serial.
- **"Add Equipment":** Saves the customer's machines, after which parts verified to fit show a **green check mark**.
- **Results** include **alternative parts**, price and availability. Remanufactured numbers are flagged (an older SIS guide says they appear in green with an "R").
- Sources: https://www.miltoncat.com/online-tools/parts_parts-cat-com-customer-user-guide.aspx, https://www.cat.com/en_US/support/maintenance/parts-reference-guides.html, https://toromontcat.com/docs/default-source/toromont-solutions-toolbox/pcc/pcc_how-to-use-sis_en_guide.pdf
- **Serial format:** A 3-character prefix plus a 5-digit sequence. Cat changes parts mid-production without changing the prefix, so the **full serial matters** (third-party: https://www.brokentractor.com/blog/identification-guide-for-cat-serial-number-prefixes/).

### C6. John Deere (partscatalog.deere.com) and PartsTree
- **John Deere:** Lookup by model, serial number or **PIN**, or equipment type. The three identifiers for parts lookup are model, serial/PIN and part number (dealer sources: https://support.koenigequipment.com/how-do-i-find-the-correct-part-number-for-my-john-deere-equipment, https://www.greenspringtractor.com/knowledge/article/97).
- **PartsTree:** The site returned 403, and no PartsTree-specific facts were verified.
- **General OEM catalogue conventions (from comparable sites):**
  - Exploded diagrams with **reference numbers**, and a **serial-number column** where a tilde marks "and earlier/later". Source: https://info.anacorp.com/ana-knowledge-base/how-do-i-read-an-airman-parts-catalog
  - Superseded parts shown as "Replaced by #…". Source: https://www.searspartsdirect.com/model/366zi6d2fy-000247/craftsman-91799401-front-engine-lawn-tractor-parts?page=2
- **Superseded numbers in practice:** OEM numbers are frequently superseded, and interchange numbers map aftermarket numbers to OEM ones. Source: https://hedgescompany.com/blog/2025/09/automotive-part-number-interchanges/

---

## Fitment & side data model (recommendation)

Based on RockAuto (side, axle sets, packs), Amazon/ACES (structured fitment kept separate from product attributes, matched on brand plus part number), Cat (serial-prefix fit, saved equipment, alternatives) and boodmo (OEM, OES and aftermarket tiers).

**Part (PIES-like: what it is)**
- `part_number` (string, normalised: uppercase, separators stripped) and `part_number_raw`.
- `brand` (manufacturer of the part).
- `part_origin` enum: `oem_genuine` | `oes` (original-equipment supplier, own brand) | `aftermarket` | `reman` | `used_pulled` | `unknown`.
- `oem_brand` (the machine maker the number belongs to, e.g. "Toyota Industries", "Lakshmi Machine Works") and `oem_part_number`.
- `cross_references[]`: `{brand, part_number, relation: interchange | supersedes | superseded_by | equivalent, source: seller | admin | catalogue}`. Show "Replaced by" like Sears and the OEM catalogues do, and make the list searchable.
- `category`, `subcategory`, free-text `spec` with optional structured specs (dimensions, material).
- **Side:**
  - `side` enum: `left` | `right` | `pair` | `not_applicable` | `either` (fits both sides, as RockAuto's "no side listed").
  - Store `side_reference` (e.g. `operator_position`, `machine_front_facing`, `drawing`), because RockAuto has to explain "as if sitting in the vehicle" and customers are still confused.
  - `mirror_part_number` links a left part to its right counterpart. This is what powers Left/Right/Pair matching.
- **Position (ACES-qualifier style):** optional `position` enum (`front`, `rear`, `upper`, `lower`, `inner`, `outer`, `drive_end`, `non_drive_end`), kept separate from side.
- **Sale unit:**
  - `sold_as` enum: `single` | `pair` | `set` | `pack`, with `units_per_sale` (int) and `set_contents` (text). This mirrors RockAuto's x2/x4 packs and axle sets.
  - `qty_per_machine` (informational, like "X per car").
  - Always show the per-unit price when `units_per_sale > 1`.
- **Listing condition:** `new` | `used` | `unused` | `excess` (the product's own enum) | `refurbished` | `defective_for_parts` (Machineseeker has "Defective").

**Fitment (ACES-like: what it fits). Child table, many rows per part**
- `machine_brand`, `machine_model`, optional `model_variant`.
- `year_from` and `year_to` (nullable for open ranges).
- `serial_from` and `serial_to`, or `serial_prefix`. Cat and Deere fit by serial, not year, so store both.
- `qualifier_notes` (free text, e.g. "with hydraulic tensioner"), like RockAuto's limiting factors.
- `fitment_source` enum: `seller_declared` | `admin_verified` | `catalogue`. Show a "verified fit" badge only for `admin_verified` or `catalogue`. This mirrors Amazon withholding Confirmed Fit for free-text claims and Cat's green check.

**User side**
- "My Machines" (Cat "Add Equipment" / Amazon Garage): brand, model, year, serial, location.
- Listings that match a saved machine get a fit badge, and part requests can pre-fill from a saved machine.

**Part request and availability alert**
- `part_request`: part_number or description, machine brand/model/year, `side_needed` (left/right/pair), quantity, condition accepted, location radius, expiry.
- Matching runs on new listings by normalised part number, cross-references and the mirror part.
- The alert is an explicit, cancellable saved request (Machineseeker's "receive new offers immediately… terminate at any time"), not a silent "notify me".

## Rental model (recommendation)

**Rental listing fields**
- Machine identity: brand, model, year, serial, capacity specs, photos, current hour-meter.
- **Rates:**
  - `rate_hour`, `rate_shift` (define `shift_hours`, default 8), `rate_day`, `rate_week`, `rate_month`.
  - `month_definition` (e.g. 26 or 28 days, or N shifts). BigRentz uses 20 shifts over 28 days, and DOZR, TransRentals and BigRentz all use 8 hours a day.
  - `overtime_rate_per_hour`.
- **Minimums:** `min_rental_duration` and `min_unit` (hour, shift or day). TransRentals uses 1 day of 8 hours; agricultural rentals go per hour or per acre, so allow `rate_per_acre` or a custom unit.
- **Operator:** `operator_included` enum: `included` | `optional` (`operator_rate`) | `not_available` | `mandatory`. The TransRentals Jaipur page says the machine may not be run without their operator.
- **Fuel:** `fuel_policy` enum: `client_supplies` | `included` | `charged_per_litre`. Indian listings default to the client supplying diesel.
- **Transport:** `transport` (`owner_delivers` with `mobilisation_charge` and/or `per_km`, or `renter_pickup`) and `service_radius_km`, plus a city, industrial area and state base location. DOZR prices delivery by distance; TransRentals charges mobilisation.
- **Money:** `security_deposit` (amount or %), `advance_required` (% or amount), `damage_terms` (text), and `insurance_required` (bool, like Yard Club's insurance check and BigRentz's COI alternative).
- **Availability calendar:** blocked date ranges and maintenance blocks. Availability is "indicative" until the owner confirms (DOZR asks the supplier to confirm).
- **Logsheet:** an optional daily record of start and end hours, fuel and an operator sign-off, as on RNTL and AUEQI.

**Booking statuses**
1. `requested` (enquiry with dates, site location, operator and fuel choices)
2. `quoted` / `countered` (reuses the offer and counteroffer engine)
3. `confirmed_by_owner`
4. `advance_paid` or `advance_recorded_offline`
5. `scheduled`
6. `mobilising` / `delivered` (with an hour-meter reading and photos at handover)
7. `on_rent`
8. `extension_requested` → `extended`
9. `off_rent_requested` (now or scheduled; partial quantity allowed, like EquipmentShare)
10. `returned` (closing hour-meter, damage check)
11. `closed` / `invoiced`

Exit branches: `cancelled_by_renter`, `cancelled_by_owner`, `expired` (no owner response), `disputed`.

Record the deal even when payment happens off-platform, and ask both parties for reviews after `closed`.

---

## Ideas worth borrowing
- **IndiaMART, PNS masked calling:** Hide real numbers behind a virtual number that rings several staff phones, with spam blocking. This suits Indian businesses that live on phone calls.
- **IndiaMART, Lead Manager:** One inbox with saved replies, a quotation builder, reminders, notes, labels, and offline reply and call. Map these to the enquiry → offer → deal thread.
- **IndiaMART TrustSEAL verification stack:** GST OTP validation, a bank-account name match, a video KYC with stock or invoice proof, and live location. A good template for tiered GST and business verification.
- **IndiaMART, buy requirements:** Validated before they go live. Lets the admin panel screen part requests for spam.
- **TradeIndia TI Pay, rules worth copying even for off-platform deals:** Auto-release after 3 business days with no complaint, a 2-day window to report a wrong product, and no changes after payment except a delivery extension the buyer confirms. Use the same timers for a "deal recorded → delivered → confirmed" state machine.
- **Machineseeker:**
  - **Condition enum including "Defective"**, a location radius filter, and an "only verified dealers" toggle.
  - Saved-search email alerts ("receive new offers immediately… terminate at any time").
  - A "Request more images" button and price sales terms ("ONO", "Fixed price plus VAT"). Map these to negotiable or fixed, and plus GST.
- **IndustryBuying:** GST invoice downloadable after delivery, plus COD so the buyer can inspect before paying. Relevant for trust in used parts.
- **DOZR:**
  - Show rental **and delivery** price per supplier side by side.
  - Re-source if the owner cannot fulfil.
  - One-click "Extend Rental" from the confirmation.
- **EquipmentShare T3, off-rent:** Now or scheduled, partial quantity, and a batch off-rent that shows billing cycles.
- **Yard Club:** P2P idle-equipment rental with owner-set prices, two-way ratings for renter and owner, and a standard master rental agreement. Matches a "rent out my idle machine" feature.
- **RockAuto:** Explicit side convention, "order qty = 2 for both sides", axle-set and pack icons with per-unit price, build-date and limiting-factor notes.
- **Cat Parts.cat.com:**
  - Saved equipment with a green "verified fit" check.
  - Fitment by serial prefix and range.
  - Alternative and reman parts shown alongside.
- **Amazon:**
  - Keep structured fitment separate from free-text compatibility, and give a fit badge only for structured or verified data.
  - Optional refinements (trim, engine) after the base vehicle.
- **boodmo:** Lets the buyer pick OEM vs OES vs aftermarket (analogue) tiers for the same OEM number.
- **PartSouq:** A machine identifier opens the exact catalogue configuration, then search by part name or number inside it.
- **Asset-Trade note:** Used-machinery imports into India need a Chartered Engineer Certificate. Worth an optional document field on imported used machines.

## Weaknesses to avoid
- **IndiaMART, paid leads:** Sellers prepay Rs 60,000 or more a year for an allocation of about 15 leads a week. Lead-quality complaints are common across these directories (TradeIndia Trustpilot). Avoid charging per lead without relevance controls and refunds.
- **IndiaMART, payments:** The escrow was discontinued in 2024. The 2026 protection plan covers only complete non-delivery and needs an FIR and a notarised affidavit. Do not promise "protection" that is this hard to claim.
- **TradeIndia TI Pay:** Full upfront payment only, with no part payments or milestones. Machinery deals often need an advance plus a balance, so support part payments when recording deals.
- **OLX India:** A consumer classifieds model with no machinery taxonomy, GST verification or B2B tooling found. The gap is the opportunity.
- **boodmo:**
  - Charging "Discovery Points" for part-number or number-plate lookups adds friction at the discovery step.
  - App reviews cite delivery delays, refund problems and platform fees.
- **Amazon:** The built-in "Notify me" is reported as unreliable and not offered on every product. Make availability alerts explicit, manageable and dependable.
- **RockAuto:** The left/right convention needed a help-page explanation, and customers still report confusion. Show a diagram or reference in the listing UI.
- **Parts.cat.com:** Fitment by prefix alone fails because Cat changes parts mid-production without changing the prefix. Capture serial ranges, not just model and year.
- **PartSouq:** VIN decode was limited to Toyota per its notice. Do not make fitment depend on a single identifier; offer a manual brand, model and year path.
- **DOZR and TransRentals:** Inconsistent self-reported numbers (DOZR shows 15,000+, 1,000+ and 900+ partners; TransRentals shows 500+ and 250+ cities) and contradictory operator copy. Keep marketing claims consistent with the data.
- **BigRentz:** Conflicting statements on whether protection is optional or required. State deposit and damage terms once, clearly, per listing.
- **AUEQI:** Algorithmic pricing is announced but not live. Do not launch on features that do not exist yet.
- **Machineseeker:** EUR prices and global distances, e.g. "6,760 km", show on the India site. Default to INR and local distance.
