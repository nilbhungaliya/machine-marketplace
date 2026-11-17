# Competitor research: international used/industrial machinery marketplaces

Researched 2026-11-16 for a B2B machine parts and machinery marketplace for Indian businesses.

## Method and access notes (read first)

- **Blocked automated fetches (HTTP 403):** exapro.com (home, how-it-works, listing pages), machinio.com (home, /sell), kitmondo.com (home, blog), machinerytrader.com (home, /info/how-to, info.machinerytrader.com, parts pages), other Sandhills sites (cranetrader.com, specialtycropeq.com), equipmentworld.com, and ebay.com category and search pages. For these sites I used web-search snippets, app-store pages, the sites' own `llms.txt` files, help pages on other hosts, press releases and third-party scraper documentation. Each point names its source.
- **Fetched directly:** surplusrecord.com (home, category, listing, wanteds, sell, advertise, mobile app), mascus.co.uk (home, category, two listings), mascus.it webshop page, eBay help and program pages, Apple App Store pages, liquidityservices.com, exapro.com/llms.txt and exapro.es/llms.txt.
- **Alibaba:** product and search pages render with JavaScript and returned empty. Alibaba facts come from search snippets of product pages, seller-blog pages and help pages.
- **Scraper documentation (Apify) is unofficial.** I used it only to show which fields a listing exposes.

---

## 1. Exapro (exapro.com)

**Positioning:** A B2B marketplace for used industrial machinery, running since 2000. It reports about 58,000 machines and more than 600,000 monthly visitors (August 2026). It acts as an intermediary through agents. Source: https://www.exapro.com/llms.txt, https://www.exapro.es/llms.txt

**Listing fields:**
- A listing typically has manufacturer and model, year, technical specifications, condition, photos, location, price if public (otherwise you must request it), and seller information. Source: https://www.exapro.com/llms.txt
- Category pages show manufacturer and country, year, a CNC flag, and either a price or "Price on request". Auction items show a closing date. Source: search snippets of https://www.exapro.com/metal-machine-tools-rotary-transfers-c20/?page=4 and https://www.exapro.com/metal-machine-tools-grinding-machines-surface-grinders-c22/?page=26
- Exapro also has "Model pages": evergreen reference pages per manufacturer and model that exist whether or not that model is currently for sale. "Product Selection" pages combine buying guidance with related listings. Source: https://www.exapro.es/llms.txt
- Listings may contain automatically translated text. Source: same.

**Search and filters:** Category, subcategory, manufacturer, year, technical specifications, location, and a search bar. Source: https://www.exapro.es/llms.txt, https://www.exapro.com/how-to-buy-your-used-plant-machinery/ (via search snippet)

**Buyer tools:**
- Enquiries go to a dedicated Exapro agent. The agent answers questions, gets more technical or commercial detail from the seller, qualifies the enquiry and handles communication.
- Browsing and enquiring are free.
- Exapro recommends a physical or virtual inspection ("machine visits") before purchase.

Sources: https://www.exapro.es/llms.txt, https://www.exapro.com/llms.txt. I found no evidence of saved searches, alerts or a buyer-side wanted feature (both blocked pages and search results were checked).

**Seller tools and pricing:**
- The terms of service describe three ways to sell:
  - **Brokerage:** Exapro arranges the sale under a brokerage agreement confirmed by Exapro.
  - **ExaSaaS:** a classified-ads subscription with no commission. Listings are added manually or automatically depending on the usage plan.
  - **Direct sale:** Exapro buys and resells the machine.

  Source: https://www.exapro.com/terms-service/ (via search snippets)
- Listing is free. The success fee is due only when a deal closes through the marketplace, and a commission invoice goes to the seller. An older seller FAQ gave the commission as 5–10% added on top of the price. Source: https://hub.exapro.com/faq-for-sellers (via snippet; the page is dated)
- A Starter Story interview says Exapro launched a yearly SaaS fee for dealers that replaces the commission. Source: https://www.starterstory.com/stories/exapro (via snippet)
- Exapro has a pricing algorithm to help set prices. Search results name "Exaval", described as a valuation system for its web portal. Sources: https://www.exapro.com/how-it-works/ (via snippet), https://hub.exapro.com/machinery-valuation-how-to-find-out-the-price-of-machines (via snippet)
- Other services: a "List a machine for sale" form (https://www.exapro.com/add-product-step-1-s/), a complete-plant and production-line sales service, auctions (https://www.exapro.com/auctions/), and industrial advertising. Source: llms.txt
- A hub article says every seller automatically gets a personal agent. Source: https://hub.exapro.com/sell-used-machinery-exapro (via snippet)

**Trust:**
- Exapro runs seller compliance checks and says it checks that buyer and seller are serious by verifying company IDs, history and reputation.
- Sellers must make a machine available for inspection within 7 working days of an Exapro request.
- Buyer and seller agree payment and logistics themselves. I found no escrow.

Sources: https://www.exapro.es/llms.txt, https://www.exapro.com/terms-service/ (via snippets)

**Parts compatibility, part numbers and rental:** None found. **App:** None found.

---

## 2. Machinio (machinio.com, owned by Liquidity Services)

**Positioning:** A search engine for used equipment. It aggregates listings from thousands of dealer and broker websites using its own crawler, and some listing cards link straight to the dealer's site. Liquidity Services acquired it in July 2018.
- It now presents itself as a "search-driven dealer platform" serving 190+ countries, with 12.5M+ annual users, more than 1M monthly visits and 4,000+ sellers.
- Sources: https://liquidityservices.com/services/machinio, https://www.equipmentworld.com/big-iron-dealer/article/14969728/google-of-heavy-equipment-acquired-by-liquidity-services (via snippet), https://apify.com/crawloop/machinio-scraper.md

**Listing fields (from scraper documentation):** title, make, model, year, price and currency, a `priceOnRequest` flag (many listings say "Contact Seller for Price"), hours, serial number, stock number, condition, category and subcategory, location (city, state, country), seller name, profile URL and seller rating, images, and a key/value spec table. Condition values are used, new, refurbished and salvage. Seller phone and email are gated behind a lead form. Source: https://apify.com/crawloop/machinio-scraper.md

**Search and filters:** Category, specifications, location (country), keyword and condition. Buyers can also search parts suppliers and service providers, not just machines. Sources: https://liquidityservices.com/services/machinio, https://apify.com/crawloop/machinio-scraper.md

**Buyer tools:**
- Email alerts when new listings match a buyer's needs. When a seller adds a listing, Machinio emails buyers who showed interest in similar items.
- Enquiries are tied to specific listings.
- Sources: search snippets of Liquidity Services and mcsmag.com coverage (https://mcsmag.com/machinio/); https://liquidityservices.com/services/machinio
- I found no make-offer or wanted-ad feature.

**Seller tools ("Machinio System"):**
- Manual upload or automated inventory feeds.
- Dealer websites that sync automatically with inventory.
- Inventory management, CRM, lead tracking, and data on pricing trends and buyer demand.
- Since October 2025, dealers can also advertise, manage and quote services such as repair and maintenance.
- Pricing is a subscription with no sales commission. Plan prices are not published.
- Sources: https://liquidityservices.com/services/machinio; https://www.equipmentworld.com/dealers/article/15770001/machinio-adds-service-features-to-equipment-dealer-platform (via snippet); https://g2.com/products/machinio-system/pricing (via snippet)

**Trust:** A seller rating field exists in the listing data. The marketing page shows dealer testimonials and logos. I found no inspection or escrow service. Sources: Apify documentation; Liquidity Services page.

**Parts compatibility, part numbers and rental:** Machinio lists parts suppliers, but I found no fitment or "fits these models" data. **App:** No Machinio app found in app-store searches.

---

## 3. Kitmondo (kitmondo.com)

**Positioning:** Has connected sellers and buyers of used industrial machinery online since 2006 (https://www.kitmondo.com/page/about-us/, via snippet). It is linked to Exapro:
- Its 2024 press release was issued by Exapro (Thomas Bordier).
- Valorexo, a valuation tool, is described as "established by" Exapro, Bidderlists and Kitmondo.
- Sources: https://www.einpresswire.com/article/742178164/..., https://business.ricentral.com/ricentral/news/read/42101191/ (via snippet)

**Model:**
- Kitmondo acts as an intermediary. It screens buyers and passes sellers only to buyers willing to pay the asking offer. The seller pays a commission.
- A 2019 post says listing is free with no limit on quantity.
- The 2018 intermediation announcement says Kitmondo began checking that every listing is still available.
- Sources: https://kitmondo.com/blog/announcing-kitmondo-intermediation-service/ and https://www.kitmondo.com/blog/sell-surplus-metalworking-machinery/ (via snippets)
- Paid "Star listings" exist for extra visibility (blog title: https://www.kitmondo.com/blog/Starlisting-Used-industrial-Machines-on-Kitmondo/; content blocked).

**Platform claims (2024 press release, company-issued):**
- Real-time deal tracking and in-platform messaging and negotiation.
- Automatically generated contracts, invoices and shipping paperwork.
- Logistics integration (shipping quotes, booking, tracking).
- A payment gateway with escrow ("funds held until deal terms are met").
- 20 languages, including Hindi.
- Source: https://www.einpresswire.com/article/742178164/kitmondo-enhances-platform-with-cutting-edge-web-technologies-and-multilingual-support-for-global-used-machinery-market

**Listing fields, filters, buyer tools:** The site blocked fetches and I found no detail. A selling-tips post asks sellers for detailed descriptions and good presentation (https://www.kitmondo.com/blog/advice-selling-used-machinery/, via snippet).

**Parts compatibility and rental:** None found. **App:** None found.

---

## 4. Surplus Record (surplusrecord.com)

**Positioning:** "The World's Leading Online Marketplace for Used, New, and Surplus Industrial Machinery & Equipment", "Trusted Since 1924", with 220,257 listings on 2026-11-16. It also publishes a monthly printed catalog. Source: https://www.surplusrecord.com/

**Listing fields** (example: https://surplusrecord.com/listing/11-x-18-hardinge-hlv-em-engine-lathe-1089194/):
- Manufacturer, Model, category-specific key specs (e.g., Swing and Centers for lathes), Stock #, Serial #, Asset #, Price, and a full "Specifications" table.
- Up to 10 photos, plus video on some listings.
- Location, dealer name, "Surplus Record Dealer Since 2006", and a "Platinum Level Dealer" badge.
- Phone number behind a "Show Phone Number" button.
- "Finance for as low as $456/mth", "Request Formal Quote", "Create Alert", Share, and "Buyers Who Viewed This Listing Also Viewed".
- Cards show the price or "Request Price", plus "Featured" and "JUST ADDED!" badges.

**Search and filters** (example: https://surplusrecord.com/machinery-equipment/engine-lathes/):
- Category-specific numeric ranges (Swing Low/High, Centers Low/High).
- Manufacturers (with counts), Top 200 Models, Location (state or province), and Condition (Used Only / New/Rebuilt Only).
- Keywords; sort by relevance, title, recently listed, year, or price.
- 50 or 100 results per page; 8 currencies including INR; English and Spanish.
- Dedicated tools: motor search by HP, RPM, Volts and Frame; transformer search by KVA and Volts (https://www.surplusrecord.com/).

**Buyer tools:**
- "Create Alert" and "New Listing Alert" on category and listing pages, plus auction alerts.
- Enquiry form with checkboxes for "Make an Offer", "Send me a shipping quote", "I am interested in financing" and "Send me info about buyer protection".
- Contact Seller, Request Price, and Make Offer buttons on cards.
- **Wanted / For Sale posts** (https://surplusrecord.com/wanteds/), free:
  - Purpose (Buy/Sell), title, industry, category, price or "best offer", budget band, description, a private note, one photo, a video link (YouTube/Vimeo), contact details, shipping and item location.
  - Can be scheduled to "Post & Send Immediately" or at set Central-time slots.
- **Browsing wanteds** (https://surplusrecord.com/browse-wanteds/): filter by Buy/Sell, posted by (Dealer/Manufacturer), industry, location and date. Contact details are visible only to paying advertisers, who receive new wanteds by email as soon as they are posted.
- Equipment comparison guides (https://surplusrecord.com/equipment-comparisons/), as articles rather than a side-by-side compare tool.

**Seller tools and pricing:**
- Commission-free; "Cancel any time after your first month".
- Free seller or dealer web page with backlinks; access to "Exclusive Wanteds".
- "My SurplusRecord" dashboard reporting popular listings and search enquiries.
- Listings are added or removed automatically from the dealer's own website (details not given). Source: https://surplusrecord.com/sell/sell-your-machinery/
- Advertiser plans "start at $90/month" for up to 10 commission-free listings. Source: https://surplusrecord.com/browse-wanteds/
- Paid extras (https://surplusrecord.com/sell/advertise-on-sr/):
  - Homepage featured slot: $250–350 per week.
  - Category banner ads: $55–75 per banner per month.
  - Printed catalog display ads: $155–550.
  - E-blasts, an appraiser directory, and a freight partner (Unishippers).

**Trust:**
- Dealer tenure ("Dealer Since …") and level badges ("Platinum Level Dealer"); a dealer directory searchable by name, location or specialty.
- Escrow option for wire payments (https://surplusrecord.com/buyer-protection/).
- The Terms of Use say Surplus Record makes no guarantees on purchases and offers no refunds or dispute handling (https://surplusrecord.com/terms-and-conditions/, via snippet).
- No reviews found.

**Parts compatibility, part numbers and rental:** No fitment data. Motor and transformer spec search is the closest equivalent.

**App:** iOS and Android. Features: browse listings, submit RFQs, call dealers, post free Wanted requests "sent to hundreds of dealers", free sell posts, and dealer search. Sources: https://surplusrecord.com/mobile-app/, https://apps.apple.com/app/id1566206869

---

## 5. Mascus (mascus.com and local domains, owned by Ritchie Bros. / RB Global)

**Positioning:** "Europe's trusted source for quality used machinery". Ritchie Bros. acquired it for about €24M plus earn-out; it was founded in 2001.
- It reports 3–3.5M monthly visits, "100 000 buyers a day", 37 languages and 400,000+ listings.
- Categories: Agriculture, Transportation, Construction, Forestry, Groundcare, Material Handling.
- Sources: https://www.mascus.co.uk/, https://apps.apple.com/us/app/-/id1387805230, https://www.equipmentworld.com/business/article/14964691/ritchie-bros-buys-online-equipment-listing-service-mascus (via snippet)

**Listing fields** (e.g., https://www.mascus.co.uk/construction/crawler-excavators/volvo-ecr235el/nfzgqm0l.html):
- Product group, Brand / model, Year of manufacture, Hours of use, Machine location, Country, Mascus ID, Power type, Delivery terms, and free-text "Other information".
- Price, or "POA" (price on application), with a currency chooser and the note "Does not include reclaimable VAT".
- Photo gallery; cards show photo and video counts.
- Seller block with "Years on Mascus", "Get email notification" (follow the seller), "Show all ads of …" and "Report suspicious ad".
- Some fields appear only as free text on some listings (e.g., year and hours inside "Other information" on https://www.mascus.co.uk/construction/crawler-excavators/komatsu-pc138us-11-digger-st28013/thromb0k.html).

**Search and filters** (https://www.mascus.co.uk/construction/crawler-excavators):
- Advert type (Sale, Auction, Rent), Category, Brand, Continent, Country, Price excl. VAT, Year of manufacture, Latest ads, Details, Hours of use, Condition, Gross Weight, Engine output, Meter read-out, Emission level, Power type, Accessories.
- Row or grid view.

**Buyer tools:**
- Save search; Favorite; Share; Print.
- "Place a Want Ad".
- "Make Offer / Buy Now" on some partner listings (Marketplace-E) and "Highest bid" on auction items.
- Contact by phone, email or WhatsApp (https://blog.ritchiebros.com/5-reasons-to-sell-your-equipment-on-a-listing-website-mascus/).
- No compare tool seen.

**Seller tools and pricing:**
- A monthly fee or a fixed fee per ad; prices not published.
- Photos and video can be uploaded from a phone; large stocks can be loaded automatically through data integration.
- Mobile-friendly Inventory Management System; statistics tool; dedicated account manager.
- Source: https://blog.ritchiebros.com/5-reasons-to-sell-your-equipment-on-a-listing-website-mascus/
- Dealer add-ons (https://www.mascus.it/Webshop.aspx):
  - Ritchie Bros. price results (market-price tracking by type, brand and age).
  - Branded webshop.
  - Banner advertising and sponsored listings.
  - Export tool to push stock to other listing sites.

**Trust:** Seller tenure ("Years on Mascus"), "Report suspicious ad", and a link to the Ritchie Bros. auction group. No inspection, escrow or reviews were seen on listing pages.

**Parts compatibility and rental:** "Rent" is a listing type and a filter. No parts fitment found.

**App:** Mascus iOS app by Ritchie Bros. Finland Oy, rated 4.1 from 8 ratings. Features:
- Search by category, brand and model; filter by price, year and location.
- Multiple photos per listing; contact by phone or email.
- Favourites, saved searches with push notifications for new ads, and sharing.

Source: https://apps.apple.com/us/app/-/id1387805230

---

## 6. MachineryTrader (machinerytrader.com, Sandhills Global)

**Positioning:** A Sandhills Global marketplace (Lincoln, Nebraska) for new and used construction equipment, heavy machinery, industrial tools, parts and attachments. It covers buyers, private sellers and dealers, and the homepage title is "Parts, Attachments, and Dismantled Machines". Sources: https://apps.apple.com/us/app/-/id380184450, search snippets of https://machinerytrader.com/

**Listing fields:**
- Year, manufacturer, model, category, price and currency, and New/Used condition.
- Hours meter, serial number, stock number, horsepower, machine location, spec sheet, photos and video, and seller contact.
- Seller type (dealer or private).
- Sources: https://apify.com/crawlerbros/machinerytrader-scraper.md (via snippet), App Store page
- When creating a listing, sellers enter manufacturer, model, category, condition and serial number (https://www.machinerytrader.com/info/how-to, via snippet).

**Search and filters:** Category, make, model, location, condition, and specs such as horsepower and hours (App Store page). Separate sections for private-party listings, auctions, dismantled machines, and "Equipment and Attachments For Rent".

**Parts:**
- A part-number search (URL pattern `/parts/search/{seller}/part-number/{number}`) with manufacturer pages for parts (e.g., `/parts/manufacturers/jcb`).
- Part results show availability quantity (e.g., "Available: 30") and price.
- Sources: search snippets of https://www.machinerytrader.com/parts/search/us/part-number/7k9380r and https://www.machinerytrader.com/parts/manufacturers/jcb
- An older Sandhills article describes part-number search (exact or partial) that returns the part with its attachments and components (https://sandhills.com/DigitalIssues/SandhillsMagazine/..., via snippet).
- I found no "fits these models" table.

**Buyer tools:**
- **Watch List**, with an email if the asking price drops.
- Text and email alerts for new matching listings, weekly updates, and push notifications.
- **Want-To-Buy ads** (managed under "My Want-To-Buys") so sellers can contact the buyer.
- In-app messages and "TradeSites chat".
- Financing (CurrencyFinance) and shipping (FR8Star) partners.
- Sources: https://apps.apple.com/us/app/-/id380184450; https://www.machinerytrader.com/info/how-to (via snippet)

**Seller tools:**
- Sandhills Inventory Management app ("My Inventory") to add, price and edit listings.
- Dealer tools (https://info.machinerytrader.com/, via snippet):
  - **Auto-Search Matches**, which flags buyer requests that match the dealer's inventory.
  - Dealer-to-dealer Want-To-Buy notifications.
  - "AI Assists" recommended-asset notifications.
  - Inventory export.
- A Dealer Portal and VIP Portal (site header).
- Print-ad cross-posting (e.g., LiftsToday listings also appear on MachineryTrader).
- Private-seller fees are not published; a Trustpilot reviewer mentions paying $375 for a listing (https://ca.trustpilot.com/review/www.machinerytrader.com, via snippet).

**Trust:** A scam-awareness page from Sandhills' security team (https://www.machinerytrader.com/info/scam). Trustpilot score is 2.5/5 (snippet). I found no inspection or escrow service.

**App:** iOS and Android, rated 4.7 from 6.4K ratings on iOS.

---

## 7. eBay Business & Industrial (heavy equipment and parts)

**Positioning:** A general marketplace with a Business & Industrial area and a "Heavy Equipment, Parts & Attachments" hub (https://www.ebay.com/b/-/257887). Category and search pages blocked automated fetches.

**Listing fields and filters:**
- Heavy Equipment Parts & Accessories (category 41489) has filters including "Compatible Equipment Make", "Compatible Equipment Type" and "Brand" (search snippet of https://www.ebay.com/SCH/97126/i.html).
- Listings use eBay item specifics, condition values, auction or Buy It Now formats, and Best Offer.

**Parts compatibility (strongest of the group, but for vehicles):**
- A structured fitment system exists in eBay Motors Parts & Accessories categories.
- Sellers match a catalog product by brand, MPN or GTIN, which pre-fills the list of compatible vehicles. Alternatively they add vehicles manually: up to 3,000 per listing, at minimum Make, Model and Year, plus trim and engine.
- Bulk upload goes through Seller Hub Reports (CSV with "Relationship" and "Relationship Details" columns).
- Buyers save their vehicle in "My Garage" and filter to parts that fit.
- A Master Vehicle List is the reference, and sellers can request missing vehicles.
- Sources: https://export.ebay.com/in/growth/pa/vehicle-compatibility-fitment-guide-for-ebay-sellers/, https://pages.ebay.com/motors/compatibility/FAQ/EligibilityFAQ.html (via snippet)
- Heavy-equipment parts use simpler "Compatible Equipment Make/Type" item specifics instead.

**Buyer tools:**
- Saved searches (https://www.ebay.com/help/buying/search-tips/saved-searches?id=4051) and Watchlist.
- **Best Offer:** the seller has 24 hours to respond; the counteroffer must sit between the offer and the Buy It Now price; auto-accept and auto-decline thresholds; sellers can send offers to watchers.
- Best Offer sources: https://www.ebay.ph/pages/help/sell/best-offer.html, https://www.ebay.co.uk/pages/help/sell/best-offer.html, https://sellercentre.ebay.co.uk/grow-your-sales/using-promotions-to-boost-your-sales/offer-to-buyers-best-offer (via snippets)

**Trust:**
- **Business Equipment Purchase Protection** (https://www.ebay.com/help/buying/paying-items/ebay-business-equipment-purchase-protection?id=4637):
  - Covers up to $200,000 in designated capital-equipment categories; price over $1,000; US only.
  - Both parties need net feedback of 0 or higher.
  - Covers intentional, material misrepresentation, including undisclosed damage over $1,500 on items under 20 years old and wrong make or model.
  - Claims within 45 days. Deposits are covered if the item never arrives.
  - Excludes off-platform payment and normal wear.
- The standard Money Back Guarantee excludes heavy machinery and any payment made outside eBay (https://www.ebay.com/help/policies/ebay-money-back-guarantee-policy/ebay-money-back-guarantee-policy?id=4210, via snippet).
- **Verified Condition** (launched 2023, https://pages.ebay.com/business-industrial/heavy-equipment/verified-condition):
  - A bidadoo inspector visits the machine.
  - The report gives five-star ratings for chassis, undercarriage, engine, hydraulic system, paint, sprockets and frame, plus photos and a video demonstration.
- Two-way feedback (ratings) underpins eligibility.

**Seller tools:** Seller Hub, bulk listing (Seller Hub Reports), promoted listings, offers to buyers.

**Rental:** None. **App:** The general eBay app; no dedicated equipment app.

---

## 8. Alibaba.com (used machinery area)

**Positioning:** A global B2B sourcing site. Used machinery (mostly Chinese-based suppliers of used Japanese and Chinese construction equipment) sits inside the machinery categories rather than in a separate marketplace. The old `/showroom/used-machinery.html` URL returns HTTP 410.

**Listing fields:**
- Product pages carry structured attributes, including "Machinery Test Report" (Provided / Not Available), "Video outgoing-inspection" (Provided), "Showroom Location" and a free-text "Condition".
- Pages also have price tiers, MOQ and supplier profile data.
- Sources: search snippets of https://www.alibaba.fr/product-detail/Second-hand-hydraulic-excavator-Volvo-EC140DL_10000010863777.html and similar listings
- Alibaba's seller blog advises listing hours, undercarriage wear %, a PDF inspection report and startup or hydraulic test videos (https://seller.alibaba.com/blogs/2026/southeast-asia/construction-machinery/used-equipment-quality-inspection-guide-alibaba-b2b).
- Used equipment is typically sold as-is with 30–90 days' warranty or none (https://seller.alibaba.com/blogs/2026/southeast-asia/industrial-products/new-used-refurbished-equipment-guide-alibaba-b2b, via snippet).

**Buyer tools:**
- **RFQ (Request for Quotation):** the buyer posts specs, quantity, delivery terms and price range. Alibaba reviews the request, then suppliers quote. Alibaba claims up to 15 quotes within about 6 hours. Free for buyers.
- Chat or enquiry with the supplier.
- Sources: https://seller.alibaba.com/rfq, https://seller.alibaba.com/businessblogs/how-to-use-rfq-a-detailed-guide-with-examples-px97m41v (via snippets)

**Trust:**
- **Trade Assurance:** a free order-protection service covering shipping and quality disputes (https://activity.alibaba.com/helpcenter/Trade_Assurance_Guide.html, via snippet). A third party reports that suppliers often add 2–3% to cover its cost.
- **Verified Supplier:** inspected by independent third-party auditors.
- Gold Supplier membership.
- Buyer reviews and transaction history on supplier profiles.
- Alibaba advises adding a third-party inspection to the Trade Assurance order.

**Seller tools:** Membership, P4P performance ads, product showcase including certificates and inspection reports, and responding to RFQs (seller blog).

**Parts compatibility:** Only as free text in titles (e.g., "Used for 320D 320B 320C 320GC", https://www.alibaba.fr/product-detail/Used-for-320D-320B-320C-320GC_10000035809830.html). **Rental:** None found.

---

## Comparison table

| Feature | Exapro | Machinio | Kitmondo | Surplus Record | Mascus | MachineryTrader | eBay B&I | Alibaba |
|---|---|---|---|---|---|---|---|---|
| Business model | Success fee / SaaS / direct buy | Dealer subscription, no commission | Commission (intermediary) | Dealer subscription from $90/mo, commission-free | Monthly or per-ad fee | Paid listings (dealer and private) | Listing and final-value fees | Supplier membership + ads |
| Price on request | Yes | Yes | n/f | Yes ("Request Price") | Yes ("POA") | n/f | No (fixed price or auction) | Price tiers / enquire |
| Hours / serial fields | Specs, year | Hours, serial, stock # | n/f | Serial, asset, stock # | Hours, year, ID | Hours, serial, stock # | Item specifics | Attributes (test report, video) |
| Category-specific spec filters | Yes | Yes | n/f | Yes (numeric ranges, motor HP/RPM) | Yes (weight, power, emissions) | Yes (HP, hours) | Item specifics | Yes |
| Saved search / alerts | n/f | Email alerts | n/f | Create Alert | Save search + push | Text/email/push + price-drop | Saved searches | n/f |
| Wanted / buyer request | No (agent) | n/f | n/f | Wanted posts, e-mailed to dealers | Want Ad | Want-To-Buy + dealer auto-match | No | RFQ with multiple quotes |
| Make offer / negotiate | Via agent | Enquiry only | In-platform negotiation (claimed) | "Make an Offer" checkbox | Make Offer (partner listings) | Contact / chat | Best Offer + counteroffers | Chat |
| Inspection | Physical or virtual visit recommended | No | n/f | No | No | No | Verified Condition (bidadoo) | Third-party; test report / video attributes |
| Escrow / protection | No | No | Escrow (claimed) | Escrow option, no guarantees | No | No | Purchase protection up to $200k | Trade Assurance |
| Reviews / ratings | No | Seller rating | n/f | Dealer tenure + level badge | Years on Mascus | No | Two-way feedback | Supplier reviews, Verified badge |
| Parts by part number | No | Parts suppliers | No | No | No | Yes (part # search, qty) | Yes (MPN) | Free text |
| "Fits these models" | No | No | No | No | No | No | Yes (vehicles: My Garage; equipment: make/type) | Title text only |
| Rental | No | No | No | No | Yes (Rent advert type) | "For Rent" section | No | No |
| Dealer tools | Agent, plans | CRM, synced website, feeds | Docs, logistics (claimed) | Dashboard, dealer page, wanted leads | IMS, stats, webshop, export | Inventory app, auto-match, AI assists | Seller Hub, bulk CSV | Membership, P4P, RFQ |
| Mobile app | No | No | No | Yes | Yes (4.1) | Yes (4.7, 6.4K ratings) | General eBay app | General app |

n/f = not found in accessible sources.

---

## Ideas worth borrowing

- **Wanted posts sent to sellers, with matching (Surplus Record, MachineryTrader).**
  - Surplus Record's Wanted form (budget band, "best offer", scheduled send, private note) is e-mailed to dealers, and only paying advertisers see contact details, which turns buyer demand into a paid seller benefit.
  - MachineryTrader's "Auto-Search Matches" flags wanted requests that match a dealer's stock.
  - Together these are a direct model for part requests with availability alerts.
- **Price-drop alerts on watched items (MachineryTrader)**, alongside new-listing alerts by text, email and push. Useful for "Excess" stock sellers who cut prices.
- **Fitment model (eBay).**
  - Catalog match by brand and part number pre-fills compatible models; manual model lists are capped (3,000).
  - Bulk CSV with "Relationship" columns.
  - Buyers save their machines ("My Garage") and filter to parts that fit.
  - A master list of models that sellers can ask to extend.
  - This maps directly onto an admin-managed brand → model → compatibility tree. Add Left/Right/Pair as a structured attribute.
- **Part-number search with quantity available (MachineryTrader)**, with manufacturer pages for parts.
- **Category-specific numeric filters (Surplus Record, Mascus).** Examples: swing and centers ranges for lathes; motor search by HP/RPM/Volts/Frame; emission level, weight and power for heavy equipment. Drive these from admin-defined attributes per machine type.
- **Model pages that exist even with no stock (Exapro).** Evergreen pages per make and model capture search traffic and can host "notify me when available".
- **Enquiry form with intent checkboxes (Surplus Record).** "Make an Offer", "shipping quote", "financing" and "buyer protection" flags in one form give structured leads, which suits enquiry → offer → deal flows.
- **Best Offer mechanics (eBay):** a response window, counteroffers bounded between the offer and the asking price, auto-accept and auto-decline thresholds, and offers to watchers.
- **Structured inspection report (eBay Verified Condition):** per-component star ratings (engine, hydraulics, undercarriage and so on) plus photos and video. Alibaba's lighter version is simple "Test report: provided" and "Video inspection: provided" attributes.
- **Seller tenure and level badges (Surplus Record "Dealer Since 2006", "Platinum Level Dealer"; Mascus "Years on Mascus")** as low-cost trust signals before reviews build up.
- **Follow a seller (Mascus "Get email notification")** and "Report suspicious ad".
- **Dealer tools (Machinio, Mascus):** automatic feed import, a synced dealer mini-website, a statistics dashboard, an export tool, and market-price data by type, brand and age.
- **"Price on request" as a first-class state (Machinio, Mascus "POA", Surplus Record "Request Price")**, shown clearly on cards rather than as ₹0.
- **WhatsApp contact (Mascus)**, which is very relevant for Indian B2B buyers.
- **Rent as a listing type and filter (Mascus "Advert type: Sale / Auction / Rent").**
- **Multilingual listings (Mascus 37 languages; Kitmondo includes Hindi)** and an INR currency option (Surplus Record).

## Weaknesses to avoid

- **No structured fitment anywhere except eBay vehicles.** Industrial sites rely on free-text titles (Alibaba "Used for 320D 320B …") or have nothing at all. This is the clearest gap for a parts-first platform.
- **Key specs as free text.** On some Mascus listings, year and hours appear only inside "Other information", which breaks filters. Enforce structured fields per machine type.
- **Contact details gated behind a paywall or lead form with no deal tracking.** Surplus Record, Machinio and MachineryTrader capture enquiries but record nothing after contact, so there is no deal or feedback loop. Deals recorded even when payment happens off-platform would set this platform apart.
- **Trust claims without substance.** Surplus Record offers "buyer protection" while its terms disclaim all guarantees. eBay's protection excludes off-platform payment, deposits the buyer walks away from, and machines 20+ years old. Be explicit about what is and isn't covered.
- **Opaque pricing for sellers.** Mascus, Machinio and MachineryTrader don't publish fees (a Trustpilot complaint about a $375 listing fee), and Exapro's terms have changed from commission to SaaS. Publish simple plans.
- **Middle-man friction.** Exapro and Kitmondo route enquiries through agents and charge 5–10% commission (older FAQ). That slows quick parts deals and pushes users off-platform.
- **Stale and aggregated listings.** Machinio's crawled cards can link out to dealer sites. Kitmondo had to start checking that listings were still available. Add listing expiry and "still available?" checks.
- **Weak or missing reviews.** Mascus, Surplus Record and MachineryTrader show no buyer reviews of sellers. MachineryTrader's Trustpilot score is 2.5/5.
- **Desktop-first with no app or a weak one.** Exapro, Kitmondo and Machinio have no app. Mascus's app has only 8 ratings. MachineryTrader shows a well-rated app (4.7, 6.4K ratings) with alerts and want-to-buy is possible.
