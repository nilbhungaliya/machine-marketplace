# Fibre2Fashion Machinery Section: Competitor Research

Researched 2026-11-16 for a B2B machine parts and machinery marketplace for India.

## How this was gathered (read first)

- **Live site:** WebFetch returned HTTP 405 for every fibre2fashion.com URL. One direct `curl` of `https://www.fibre2fashion.com/machines/` returned the full live page (HTTP 200, about 757 KB). After that, every request (sub-category, detail and membership pages) hit an **AWS WAF JavaScript bot challenge** (HTTP 202 "verify that you're not a robot"). The site actively blocks automated fetching. The Claude-in-Chrome extension was not connected, so no real-browser session was possible.
- **Workaround:** Most deep pages were read as **raw Internet Archive (Wayback Machine) snapshots** taken between Sep 2025 and Jul 2026. The snapshot date is noted where it matters. These are real copies of F2F's own pages, but they may be a few months older than the live site.
- **Other sources:** the official B2B Dashboard User Manual PDF (static.fibre2fashion.com, fetched directly), App Store search snippets for the "B2B Trade" app, and a supplier microsite on companies.fibre2fashion.com (fetched directly; not blocked).
- **Not seen:** anything behind login (contact details, dashboard screens, the actual post-lead form), and the Knitting (s72) sub-category list page (only blocked snapshots exist).

---

## 1. Structure and URL patterns

The machinery section is one vertical ("Category = Machinery") inside F2F's generic multi-category B2B leads marketplace. Garment, Fabric, Yarn, Home Textiles, Dyes, Fibre, Leather, Accessories and Machinery all share the same templates.

| Page type | URL pattern (seen) | Example |
|---|---|---|
| Section landing | `/machines/` | https://www.fibre2fashion.com/machines/ |
| Sub-category, sellers | `/machines/{slug}-suppliers-s{ID}` | `/machines/pre-owned-machinery-suppliers-s101` |
| Sub-category, buyers | `/machines/{slug}-buyers-s{ID}` | `/machines/pre-owned-machinery-buyers-s101` |
| All product types (A-Z) | `/machines/Products` | 465 product-type links |
| Product type, sellers or buyers | `/machines/{slug}-suppliers-p{ID}` / `-buyers-p{ID}` | `/machines/autoconer-suppliers-p1006` |
| Product type within a sub-category | `/machines/{subcat}-{product}-suppliers-p{ID}-s{ID}` | `/machines/pre-owned-machinery-weaving-loom-suppliers-p1032-s101` |
| Country | `/machines/{country}-suppliers` / `-buyers` | `/machines/india-suppliers` |
| Country + product | `/machines/{country}-{product}-suppliers-p{ID}-c{ID}` | `/machines/india-air-permeability-tester-suppliers-p870-c71` (India = c71) |
| Listing detail (sell offer) | `/machines/{title-slug}-suppliers-{refNo}` | `/machines/used-weaving-looms-suppliers-21199919` |
| Listing detail (buy lead) | `/machines/{title-slug}-buyers-{refNo}` | `/machines/5-gauge-flat-knitting-machine-buyers-25226437` |
| Seller's other listings | `/machines/suppliers?q={encrypted id}` | from the "Other products from this Supplier" link |
| Pagination | `?Page=N` | about 20 listings per page |
| Express posting (requirement) | `/garments/PostRequirement` (shared across all categories) | |
| Post lead / dashboard | `dashboard.fibre2fashion.com/b2b/#/b2b/post-lead`, `.../lead-manager/lead-manager-list` | login required |
| Supplier microsite | `companies.fibre2fashion.com/{slug}/` (+ `products.asp`, `contact.asp`, `tradeleads.asp`) | `companies.fibre2fashion.com/rkenterprisesurat` |
| Membership | `/business-solutions/b2b-membership/` | |

Notes:
- Every listing page has a **Supplier / Buyer tab pair**: the same taxonomy is browsed as sell offers or as buy requirements.
- Slugs are **SEO-generated and sometimes inconsistent**. `/machines/air-jet-weaving-machines-suppliers-p1032` renders the H1 "Weaving Loom Suppliers", and the detail page breadcrumb uses yet another slug. The numeric ID is what counts.
- **Reference numbers look time-encoded.** Listing 20185867 stores images under `.../LeadResources/5/2020/10/Seller/20185867/`, which suggests the first two digits are the year posted (20 = 2020). This is an inference from one image path.
- Landing page top nav (live): Spinning, Weaving, Knitting, All Products, Dashboard. The footer lists all 12 sub-categories plus a "Supplier Desk" (Lead manager, How to Get Started videos, List your product, Express posting, Upgrade your membership, Supplier's Feedback) and a "Buyer Desk" (List your buying offer, Sourcing Assistance via mailto:b2b@fibre2fashion.com, Buyer's Feedback).
- Landing page content (live): 3 featured listings (2× Two-for-One Twisting Machine, 1× Cone Winding Machine), each with image, title, one-line tagline and "View Details". Below that: an "Express Posting" widget ("1800+ Products, 190+ Countries"), a "Premium Suppliers" carousel, a premium-membership teaser, "Our Clientele" logos and many trade-fair banner ads.
- Floating site-wide CTAs: WhatsApp link (wa.me), an email link, and a "Tell us your Requirement" modal.

## 2. Category taxonomy

**Level 1:** Machinery (one of 10 marketplace categories).

**Level 2:** 12 sub-categories. ID and approximate depth are taken from the pagination "Last" page on the sellers list, at about 20 listings per page:

| Sub-category | ID | Seller list pages (snapshot) |
|---|---|---|
| Spinning | s96 | 12 (Jun 2026) |
| Weaving | s71 | 11 (May 2026) |
| Knitting | s72 | not captured |
| Dyeing | s80 | 6 (Sep 2025) |
| Printing & Finishing | s81 | 18 (Apr 2026) |
| Testing & Inspection | s87 | 4 (Dec 2025) |
| Sewing, Embroidery & Garments | s95 | 16 (Apr 2026) |
| Laundry | s82 | 4 (Mar 2026) |
| Leather & Footwear Machinery | s98 | 6 (Apr 2026) |
| Pre-owned Machinery | s101 | 5 sellers (Mar 2026); **21 pages of buyers** (Apr 2026) |
| Equipments | s99 | 17 (Oct 2025) |
| Accessories & Equipments | s97 | 6 (May 2026) |

Other counts: India suppliers had 21 pages (Aug 2025). No item counts are shown next to categories anywhere in the machinery section.

**Level 3:** 465 product types in one flat A-Z list at `/machines/Products`. There is no published hierarchy under the sub-categories. The sub-category pages are plain listing feeds with no product-type facets.

A product type can belong to several sub-categories, which show up as tabs on the product-type page:
- "Weaving Loom" (p1032) has tabs All / Weaving / Pre-owned Machinery.
- "Sewing Machine parts and accessories" (p1684) has tabs All / Accessories & Equipments / Pre-owned Machinery.

A full product-to-sub-category mapping could not be extracted because the AJAX endpoint behind it is WAF-blocked.

The full product-type list, verbatim from `/machines/Products` (Apr 2026 snapshot), including its duplicates and typos:

> Accessories for Compact Spinning Machines; Accessories for Machine; Adhesive Machine; A-Frame; Air Conditioning Plants; Air Covering Machine; Air Humidifiers Machine; Air Jet Looms; Air Jet Spinning Frame; Air Jet Spinning Machine; Air Jet Weaving Looms; Air Texturing Machine; Autoclave; Autoconer; Automatic Conveying and Handling Equipment; Automatic doffing and piecing systems; Automatic Loom; Auxiliary Equipment; Auxiliary Machine; Auxiliary Machine for Dyeing; Auxiliary Machine for Leather and Shoe Machine; Auxiliary Machine for Transfer Printing; Backpart Moulding Machine; Bag Stitching Machine; Bale Breaker; Bale breaker / pluckers; Bale Cutter; Bale Opener; Bale Plucker; Bale Press; Bale Wrapping System; Baling Machine; Baling Press; Balling Winder; Balling Winders; Batcher; Beam Warping Machine; Beaming Machine; Beams and Flanges; Beams for Narrow Fabrics; Bearing; Beauty Equipment; Bleaching Line; Bleaching Machine; Blender; Blending Hoppers; Blending Line; Blending Machine; Blow Room Line; Blow room machinary; Blow Room Machinery; Blowing Line; Boarding Machine For Knitwear; Bobbins & Bobbins Case; Boiler; Bonding Line; Bonding Machine; Braiding Machine; Braiding Plant; Breaker; Brushing Machine; Buffing Machine; Bulking Machine; Button Attaching Machine; Button Covering Machine; Button Making Machine; Button Sewer Machine; Buttonhole Machine; Calendar Bowls and Rollers; Calender; Calender Machines; Card Clothings; Card Grinding & Polishing; Card Winding Machine; Carding Machine; Cards & Carding Equipment; Carpet Loom; Carpet Making Machine; Carpets and Rugs; Cementing Machine; Centrifugal Dyeing Machine; Centrifugal Hydro-Extractors Machine; Ceramic and Porcelain accessories; Cheese Winder; Chennile Machine; Chennile Plant; Circular Knitting Machine; Circular Looms; Cleaning Line; Cleaning Machine; Cloth Laying Machine; Cloth Spreading Machine; Cloth Unrolling Machine; Coating and Laminating Machines; Coating Line; Coating Machine; Colour Dispensing Systems; Colour Measuring Instruments Machine; Colour Mixing Machine; Comber; Combing Machine; Combining and Laminating Machine; Compacting Machine; Compacting Machinery; Complete Blanket manufacturing unit avaialble; Complete Plant; Compressor; Condenser; Conditioning Machine; Cone Winder; Cones, tubes and pirns for weaving; Continuous Dyeing Machine; Continuous Steamers And Dryers; Conveyers; Conveying Systems; Conveyor belts and cross lapper belts; Cotton Vending Machine; Cotton Wool Processing Line; Counter Moulding Machine; Covering Machine; Crabbing Machine; Crimping Machine; Crochet Knitting Machine; Crossfolder; Cutting devices for weaving Machines; Cutting Equipments; Cutting Machine; Cutting Machine for Garments; Decatising Machine; Denim Sewing Machine; Desizing Machine; Detector; Digital Printer; Dipping Machine; Direct Warping Machine; Direct, Sectional, Beam Warper and Slasher Sizing M/cs; Dosing Machine; Double Cylinder Knitting Machine; Doubling Machine; Drafting systems; Draw Frame; Draw Line; Drawing Machine; Drum Drying Machine; Dry Cleaning Line; Dry Cleaning Machine; Dry Spinning; Dryer; Drying Line; Drying Machine; Dye beams; Dyeing and Knitting machines for Immediate Sale; Dyeing Apparatus; Dyeing Line; Dyeing Machine; Dyeing Spindles & Dyeing Tubes & Cones; Effluent Treatment Plants & Equipmnets; Electro-Spinning; Embossing Machine; Embroidery Equipment; Embroidery Machine; Emerizing & Sueding Machine; Emerizing Machine; End-To-End Sewing Machine; Engraving Systems For Rotary Screens; Eva Foaming Injection Molding Machine; Extractor Machine; Extruder; Extrusion Line; Fabric Dyeing Machine; Fabric Folding Machine; Fabric Testing Machine; Fancy Yarn Spinning Machine; Fault Detection System; Feeder; Feeding Devices For Carding Machine; Felting Machine; Fibre Spinning Preparatory Machine; Fibre Testing Machine; Filters For Cleaning Of Polymer; Finish Breaking Machine; Finishing Machine; Finishing Plant; Finishing Presses; Flat and Circular; Flat Knitting Machine; Flat Printing Machine; Flat Screen Printing Machine; Fleshing Machine; Flexible card clothing; Flexible clothing for raising Machines; Flocking Machine; Flyer Frame; Flyer Machine; Folding Machine; Folding Machine For Ready Made Textiles And Garments; Footwear Sewing Machine; Forming Line; Forming Machine; Friction Spinning; Fringeing Machine; Fusing Machine; Generator; Gill Box; Grinding Machine; Hand Operated Cutting Machine; Handling Equipment; Hank Dyeing Machine; Heat Transfer Machine; Heavy Fabrics Sewing Machine; Heel Nailing Machine; Hemming Machine; High Frequency Dryers; Hopper Feeder; Hosiery Machine; Household Sewing Machine; Hydroentangling jets; Industrial Sewing Machine; Industrial Textile Equipment; Infrared Dryers; Ink-jet Printing Heads; Insole Moulding Machine; Inspection Frame; Inspection Line; Inspection Machine; Inspection Table; Interlocking Machine; Iron & Ironing equipments; Ironing Machine; Jacquard Looms; Jacquard Machine; Jacquard Plant; Jet Dyeing Machine; Jet Printing Machine; Jigger Dyeing and Padbatch; Jiggers; Jute Processing Machine; Knitting Equipment; Knitting Machine; Knitting Plant; Knitwear And Hosiery Dyeing Machine; Knives & Blades; Knotting Machine; Label Loom; Label Machine; Label Printing Machine; Labelling and Knotting M/cs; Lace Machine; Laminating Machine; Lap Former and Comber; Lapper; Laser Machine for Garment; Laundry Machine; Leather accessories; Leather Brushing Machine; Leather Cutting Machine; Leather Drying Machine; Leather Dyeing Machine; Leather Finishing Machine; Leather Marking Machine; Leather Plating & Ironing Machine; Leather Polishing Machine; Leather Pressing Machine; Leather Printing Machine; Leather Trimming Machine; Looms; Man made fibre spinning; Marking Machine; Measuring Equipment; Measuring Machine; Measuringand Rolling and Folding Machine For Knitted Fabrics; Measuringand Rolling and Folding Machine For Woven Fabrics; Melt Spinning; Mercerising Line; Mercerizing Machines; Milling Machine; Mixer; Mounting Equipment; Mounting Machine; Mounting Machines for flexible card clothing and metallic card wire; Multi Head Embroidery Machine; Multi Phase Weaving Machine; Multifunction Sewing Machine; Multifunction Shoe Machine; Napper; Needle; Needle Detector Machine; Needle Line; Needle Looms; Non Woven and Braiding Machines; Non woven Equipment; Non-Automatic Power Loom; Non-Woven Line; Non-Woven Machine; Online Monitoring System Machine; Open End/Rotor Spinning Machine; Opening & Cleaning and Blending Machine; Opening Line; Opening Machine; Opening rollers for rotor spinning Machines; Open-Width Washing Machine; Others; Oven; Overflow Dyeing Machine; Overlock Machine; Package Dryers; Packaging Equipment; Packing Line; Packing Machine; Padder; Padding And Impregnating Machine; Padding Mangles Machine; Paper Cones & Tubes; Perforating Machine; Pillow Filling Machine; Plastic Shoe Automatic Injection Molding Machine; Pleating Machine; Plucking Machine; Pocket Attaching Machine; Pocket Welting Equipments; Polishing Machine; Polymerisers; Precision Cone & Cheese Winders; Preparatory Machine; Pressing Machine; Pressure Rollers Cots Aprons and Condensors; Printing Equipment; Printing Line; Printing Machine; Printing rollers; Processing Equipment; Processing Machine; Projectile Looms; Punching Machine; Quilting And Mattress Machine; Raising Machine; Rapier Looms; Raschel Machine; Recycling Line; Reeling Machine; Ribbon Basing Machine; Ring Spinning Frame; Ring Spinning Line; Ring Twisting Machine; Rolling and folding Machine; Rotary Screen Printing Machine; Rotor Spinning Machine; Roving Frame; Roving Frame/ Flyer Frame; Rubber Tube; Running Blanket Manufacturing unit availble; Sample weaving Machines; Sanforizing Line; Sanforizing Machine; Scissor; Scouring Machine; Screens for printing; Seaming Machine; Sectional beams; Sectional Warping Machine; Semi Worsted Cards; Semi Worsted Ring Spinning Frames; Sequin Machine; Sewing Equipment; Sewing Machine; Sewing Machine parts and accessories; Sewing needles; Sewing Thread Winding Machine; Shearing Line; Shearing Machine; Shoes Making Machine; Shrinking Machine; Shuttle Embroidery Machine; Shuttle Less Loom; Singeing Machine; Single Cylinder Knitting Machine; Single Head Embroidery Machine; Sizing Machine; Slasher; Slitter; Slitting Machine; Socks Knitting Machine; Sole Jointing & Electing Molding Machine; Speed Frame; Spinning and Discharge and Lubrication Pumps; Spinning Equipment; Spinning Frame; Spinning machinary parts; Spinning Machine; Spinning Plant; Splitting Machine; Sports Equipment; Spraying Machine; Spreading Machine; Stapling Machine; Steaming Machine; Stenter Frame; Stenter Machine; Stenter Machine/ Tenter Machine; Stenter Range; Stitch Machine; Stretch Breaking Machine; Sueding Machine; Sulzer Looms; Tank; Taping Machine; Tearing Line; Tearing Machine; Tenter Frame; Tenter Machine; Terry woven plant; Tester; Testing Equipment; Textile Can; Textile Humidification Machine; Textile Machine parts; Textile Printer; Textile Scale; Texturing Machine; Texturizing Machines; Tricot Machine; Trimming Machine; Trolley; Tufting Machine; Tumbler; Tumbler Dryers; Turning Machine; Twisting Frame; Twisting Machine; Twisting Plant; Two For One Twister; Two for One Twisting machine (T.F.O); Tying Machine; Vulcanizing Machine; Wadding Machine; Warp Knitting Machine; Warping Equipment; Warping Machine; Washing Equipment; Washing Line; Washing Machine; Water Extraction Machine; Water Jet Loom; Water Pump Bearing; Weaving Equipment; Weaving Loom; Weaving Machinary Parts; Weaving Machine; Weaving Plant; Weft feelers; Weft Insertion Machine; Wet Spinning; Winder & Twisters; Winding Machine; Wool Processing Line; Wool Scouring Lines; Woolen Cards; Woolen Ring Spinning Frames; Worsted Cards; Wrap & Weft Winding Machine; Wrapping Machine; Yarn Break Detectors; Yarn Raising Machine; Yarn Singeing Machine; Yarn Testing Machine

**Spare-part and consumable product types inside that list** (my selection, useful for our parts tree): Accessories for Compact Spinning Machines; Accessories for Machine; Bearing; Water Pump Bearing; Bobbins & Bobbins Case; Card Clothings; Flexible card clothing; Card Grinding & Polishing; Cones, tubes and pirns; Paper Cones & Tubes; Cutting devices for weaving Machines; Drafting systems; Dye beams; Sectional beams; Beams and Flanges; Beams for Narrow Fabrics; Hydroentangling jets; Ink-jet Printing Heads; Knives & Blades; Needle; Sewing needles; Opening rollers for rotor spinning Machines; Pressure Rollers Cots Aprons and Condensors; Printing rollers; Screens for printing; Rubber Tube; Sewing Machine parts and accessories; Spinning machinary parts; Weaving Machinary Parts; Textile Machine parts; Weft feelers; Spinning and Discharge and Lubrication Pumps; Filters For Cleaning Of Polymer; Conveyor belts and cross lapper belts; Textile Can; Trolley.

**Taxonomy hygiene issues seen in the list:**
- Near-duplicates: Blow room machinary / Blow Room Machinery; Balling Winder / Balling Winders; Stenter Frame / Stenter Machine / Stenter Machine/ Tenter Machine / Tenter Frame / Tenter Machine; Two For One Twister / Two for One Twisting machine (T.F.O); Texturing / Texturizing Machines.
- Typos: "Chennile", "avaialble", "Equipmnets", "Measuringand", "machinary".
- Non-machinery entries: "Carpets and Rugs", "Beauty Equipment", "Sports Equipment".
- A catch-all "Others".

## 3. Listing card fields and detail page fields

### Listing card (sub-category, product-type and country lists)
- Image (links to the detail page)
- Title (seller-entered, e.g. "Used Air Jet Looms")
- Incoterm label when priced: EX-Works / FOB / CIF
- **Price**: "Price on request", or `{amount} {currency} / {unit}`. Seen: "60 EUR / Pieces", "52800 PLN / Pieces", "50000 INR / Pieces", "80000 USD / Pieces", "42000 USD / Sets".
- **Place of origin**: country (optional)
- **Min Order**: quantity + unit (Pieces, Sets, Boxes, Kgs., Meters)
- Description snippet, about 150 characters, often templated text such as "We are counted in the league of distinguished and renowned manufacturer and exporter of …"
- Links: "Other products from this Supplier"; "Similar product from this Supplier" (sometimes)
- **Location**: City, Country
- For guests: "Log in to view more information. Not a member? Register for free"
- Actions: **Add to Compare** (checkbox), **Add to Inquiry Basket**, **Contact** (goes to login)
- Buyer-lead cards add a bookmark/heart icon (login) and the same Compare, Inquiry Basket and Contact actions.
- No supplier name, verification badge, membership badge, rating or posting date is shown on cards.

### Sell-offer detail page
Examples: `/machines/used-weaving-looms-suppliers-21199919`, `/machines/air-permeability-tester-suppliers-21197391`, `/machines/spinning-machinery-parts-suppliers-20185867`, `/machines/128-hook-electronic-jacquard-machine-suppliers-19165655`, `/machines/6-color-6-station-screen-printing-machine-suppliers-20182005`.

- Breadcrumb: Home / Machinery / {Product type}
- Image gallery: 1 to several images (the spare-parts listing had 3) plus a video-player component in the page code. Every image carries the caption **"*Image For Illustration Purpose Only"**.
- H1 "{Title} Supplier"; **Reference No**; **Business Lead: Selling Offer**
- Free-text description, with seller-typed feature bullets in some listings
- Location (City, Country) plus **street address shown publicly** (e.g. "Plot No.5 Nangli Sakrawati Industrial Area New Delhi … 110043")
- CTAs: **Contact Now** (login), **Add To My Connections** (disabled; tooltip "Upgrade to Premium Membership or Login"), "Log in to view more information"
- Tabs: Product Info, and sometimes Company Info
- **Product Details** fields (seen across listings): Machinery Manufacturing Year (e.g. 2002); Brand name (e.g. "Vamatex Leonardo", "Superlab India"); Model number; **Condition** ("Running condition", "New"); Semi / Fully Automated; After sales service ("No Overseas service provided"); **Type** ("Used Machinery"); Production Capacity (e.g. "680 RPM"); End Use/Application
- **Trade Info**: Min Order; Production Capacity; Export Market (Worldwide / North America / South Asia…); **Sampling** (Free / Paid); Place of origin; Payment Terms (Money Gram, L/C, Wire Transfer, Payment in Advance); **Delivery Time** ("2 weeks", "30 days")
- **Price Info**: Incoterm + price/unit, or "Price on request"; **Negotiable: Yes**
- **Company block**: company name; Nature of Business (Partnership / Proprietorship); Year of Establishment; **IE Code**; **GST No.**; Business License / Registration No.; **Annual Turnover (In USD Million)** band ("0 - 25"); Export Market; **Certifications** ("ISO"); Profile / Brief Description (often empty)
- Related sections: "Other Selling Offer from this Supplier" (View All); "Similar products from different suppliers"; "Similar Products from {Country}"

### Buy-lead detail page
Example: `/machines/5-gauge-flat-knitting-machine-buyers-25226437`.

- "Business Lead: Buying Offer", Reference No, full requirement text visible. Example: brand-new KMS 1415 flat knitting machine, 5-gauge, 10–20 garments/week, delivery to Lithuania.
- Notice: "You are viewing as a visitor kindly login to see complete details"
- CTA: **Quote Now** (login)
- Fields: Production capacity, Model number, **Quantity**, **Destination Place**, Price (on request), Payment Terms ("Mutual Discussion"), Import Country ("Worldwide"), buyer company name ("Margarita Knit")
- The buyer's email appears **masked** ("m******1…", "@g******l.com"), but only inside analytics data in the page source.

## 4. Buyer features

- **Global search box** (header): "Answer to all your Textile needs", with a scope selector: All Categories, Articles, News, Buyers, Suppliers, Trade Fairs, Interview, Market Intelligence.
- **Advanced Search** (header panel and "Advance Search" link on list pages). Filters:
  1. Lead Type (Buyers / Suppliers), required
  2. Category (10 categories incl. Machinery), required
  3. Sub Category (the 12 machinery sub-categories)
  4. Products (product type; options loaded by AJAX per sub-category)
  5. India / Other than India radio, then Country (about 190)
  6. City (free text)
  7. **Ref. Numbers** (search by listing reference number)
  8. **Certificates** (multi-select tags): WRAP, SA8000, OHSAS, Oeko-Tex, ISO, GOTS, Fairtrade, BSCI, BCI, D&B, REACH, Cradle to Cradle, Bluesign, Global recycle standard, Ecocert, Sedex

  The search validates with "Please select at least one Subcategory, Product, Country, City, Certificate or RefNo."
- **Not available:** no price, condition (new/used), brand, year, MOQ or "verified only" filters, and no sorting control. Lists appear newest-first by reference number.
- **Browse paths:** sub-category → Supplier/Buyer tab; product type → sub-category tabs; country pages ("Top Sourcing Destinations": China, India, Italy, Taiwan, Turkey, Germany, Korea, USA, Hong Kong); "Similar products from {country}" on detail pages.
- **Compare:** "Add to Compare" checkbox on each card fills a "Products to Compare" bar (Compare / Cancel).
- **Inquiry Basket:** a cart-style basket of multiple listings with a counter. "Send Inquiry" (login required) sends one inquiry to all selected sellers; "Remove Inquiry" clears it.
- **Requirement posting:**
  - (a) **Express Posting** (`/garments/PostRequirement`, also the modal "Tell us your Requirement"): Business (Make to order / Wholesale), Posting Type (Buyer / Seller), Product (autocomplete), Category, Company Name, requirement text (max 400 chars), Contact Name, Business Email, Contact Number, Country, City, Job Title, Job Function. **No login needed.** Confirmation: "Thank you our executive will contact you soon". Pitch: "Let us provide you with verified contacts", "Personalized Assistance".
  - (b) Logged-in "Post Your Requirement" in the dashboard (see section 5).
- **Trade Match alerts** (dashboard): choose Buying Lead or Selling Lead, then Name, Subcategory, Import Region and Alert Name. Per the manual, "Both the basic members and paid members can set up to 10 trade match alerts, with 20 products per alert." The B2B Trade app pushes a notification "every time related product is posted" (App Store listing).
- **Favourite Products** (heart icon), and **My Connections** (a contact book; Premium only).
- **Sourcing Assistance:** a mailto link to b2b@fibre2fashion.com; a WhatsApp button.

## 5. Seller features

- **How to list** (B2B Dashboard User Manual PDF): Dashboard → Post Your Lead → choose Seller (or Buyer) → choose category → fill Basic Information, Trade Information, Product Specification, Price Information → "Details Description" → upload images ("+"). Trade info includes RFQ attachment (.pdf/.xls/.doc/.docx/.xlsx), Quantity, Destination Port/Place, **Valid Till (days or date)**, Preferred Place of Origin. Price info has a **Negotiable** checkbox or "Request For Best Price".
- **Manual moderation:** "After verifying the information filled by you, our team will notify you through an email once your posting goes live."
- **Lead Manager:** statuses Approved / Pending / **Rejected (with reason)** / Paused / **Expired** / Deleted. Actions: edit, pause, delete (a reason is required for delete).
- **Inquiry Management:** an inbox with reply, attachments, star, read/unread, and search by company/product/date. **Basic (free) members can respond to only five inquiries**, one-way, once each.
- **Company Profile:** Registration Details, Company Details, Additional Info, logo. The detail-page fields (GST, IE code, turnover band, establishment year, certifications) come from here.
- **Co-branded microsite:** `companies.fibre2fashion.com/{slug}` with About us / Products / Contact us (inquiry form with a verification code) / Trade leads. "Designed & developed by Fibre2fashion.com".
- **Membership plans** (`/business-solutions/b2b-membership/`, Apr 2026 snapshot):
  - **Premium: US$850/year.** Priority listing, access to registered clients, buyer/supplier finding assistance, arranged meetings, "Access and receive notifications for genuine buying leads", dedicated website, customer care.
  - **Corporate: US$1,950/year.** Everything in Premium plus corporate-supplier promotion, banners for 90 days, e-mailers to "10,000 Verified Contacts", newsletter banner, PR news folder, dedicated customer care incharge, activity reports.
  - **Customized:** "Let's Talk".
  - The page script passes the currency as "INR" while showing "$". The feature table rows include: post leads (Premium "10 Listings per month" vs Corporate "Unlimited"), matchmaking (every 6 months vs quarterly), face-to-face meetings, trade match alerts, RFQ create/respond, view detailed company profiles.
- **What is gated for free/guest users** (observed): seller/buyer contact details and "more information" (login); sending inquiries (login); Add to Connections (Premium); replying to more than 5 inquiries (paid); "View Detailed Company Profiles*" (the asterisk is on the plans table).
- **App:** "B2B Trade" by Fibre2fashion.com (iOS id1498724822). Inquiries on the home screen, lead management (approved/pending/rejected/paused/expired), Trade Match alerts, My Connection. Free download; v11 "Introduced trial membership for B2B services"; extended features need the paid subscription (App Store snippets).

## 6. Trust and verification signals

- Every listing goes through manual pre-moderation (approve/reject with a reason) per the manual.
- Company fields shown publicly on the detail page: **GST No.**, **IE Code**, Business License/Registration No., Year of Establishment, Nature of Business, Annual Turnover band, Certifications (ISO etc.). Many are blank or "N/A".
- Certifications are a search filter (16 standards, listed in section 4).
- The "Premium Suppliers" carousel and "priority listing" for paid members are the only visible tiering. **No "verified" badge, rating, review, response-rate or member-since indicator** was seen on cards or detail pages.
- Social proof: an "Our Clientele" logo wall (Rieter India, Saurer, Savio, Shima Seiki, TESTEX…), and testimonial pages for suppliers and buyers.
- A "Certification" ISO logo in the site footer (F2F's own).

## 7. Spare parts, compatibility, left/right parts, rental and used machinery

- **Used machinery** is its own sub-category, "**Pre-owned Machinery**" (s101), with Supplier and Buyer tabs. It also appears as a tab on product-type pages (e.g. pre-owned Weaving Loom, pre-owned Sewing Machine parts).
- Used-specific data is only the generic fields: Condition ("Running condition"), Type ("Used Machinery"), Machinery Manufacturing Year, Brand, Model, RPM/capacity, After-sales service. Titles carry "Used / Second Hand / Pre-owned".
- **The buyer side of pre-owned is much busier than the seller side:** 21 pages of buy leads vs 5 pages of sell offers. Examples: "Used Complete Open End Spinning Unit" (Mumbai), "Used Wool Scouring Lines… not older than five years", "Used Fancy Yarn Spinning Machine… Gigliotti & Gualchieri" (Chennai).
- **Spare parts** are product types (Spinning machinary parts, Weaving Machinary Parts, Sewing Machine parts and accessories, Textile Machine parts, card clothing, bearings, needles, cots/aprons, etc.). There is no part number, OEM or compatible-machine field. Compatibility exists only in free text, e.g. "spare parts are available in all facilities where Zinzer ring spinning machines … are located"; "Outer Grippers for spinning machines".
- **No left/right/pair concept, no part-number search, no compatibility matrix** was found.
- **No rental / hire / lease** listings, filters or categories were found. A web search for rental on the site also returned none.

## 8. Weaknesses and friction observed

1. **Hard bot wall:** AWS WAF JS challenge after one request; WebFetch blocked (405). This limits crawlers and aggregators, possibly including search-engine previews.
2. **Contacts and details paywalled:** "Log in to view more information" on every card; Contact, Quote Now and Send Inquiry all go to login; Add to Connections needs Premium; free members can reply to only 5 inquiries.
3. **Illustration-only photos:** every detail image is captioned "*Image For Illustration Purpose Only", so buyers cannot trust that the photo is the actual used machine.
4. **Templated, ghost-written descriptions** ("We are counted in the league of distinguished and renowned manufacturer…", "We have an immediate need for …") bury the real specs.
5. **Stale inventory:** reference numbers (year-encoded, per the 2020 image path) on page 1 of Pre-owned sellers run from 25… down to 20…, so the newest 20 used-machine offers span about 2020–2025. A microsite showed "This company is our Ex-Premium Member & has no active leads as of now".
6. **Data-quality problems:** a spinning-machine accessory listed under Sewing Machine parts; "Sewing Machine parts … Price 18.000 EUR / Containers, Min Order 5 Kgs" (units don't match); a "Braiding Machine" priced "5000 USD / Meters"; a supplier location of "Cologne, Italy"; "Model number: 2002" duplicating the year; seller address shown with a blank city (", China").
7. **Taxonomy:** a flat list of 465 types with duplicates, typos and non-machinery entries; no visible hierarchy below the 12 sub-categories; inconsistent slugs; no counts.
8. **Weak filtering:** no condition, price, brand, year, MOQ, location-radius or verified filters, no sort; Lead Type and Category must be picked before searching.
9. **No seller identity on cards** and no ratings, reviews, response time or verified badge. GST/IE code appear only on detail pages and are often blank.
10. **Microsite mismatch:** the R.K. Enterprise (used-machinery dealer) microsite's Products page shows fabric items, and its sidebar links point to old garment.fibre2fashion.com pages.
11. **Generic, textile-wide forms:** Express Posting asks for Job Title and Job Function; there are no machinery fields (brand, model, year, condition, part number).
12. **Ad-heavy pages:** many trade-fair and webinar banners between content blocks.
13. **USD-first international pricing:** membership is priced in $ on the page, while listings mix INR, EUR, PLN, USD and CNY with no conversion.

## 9. Ideas worth borrowing (each tied to an observation)

- **Supplier/Buyer twin tabs on every taxonomy node** (§1, §4). Show "Parts for sale" and "Parts wanted" side by side. For us, part requests become browsable demand that sellers can act on.
- **Public buy leads with the requirement visible but contact gated** (§3 buy-lead page). Good SEO and seller pull. Show machine/part, quantity and city; reveal contact after login or credit.
- **Trade Match alerts by sub-category + region, with app push** (§4, §5). This maps directly to our "availability alerts" for part requests. Improve on it with part number + machine model + Left/Right/Pair matching instead of a coarse sub-category.
- **Inquiry Basket for multi-seller RFQ** (§4). One requirement goes to N sellers. Useful for spare parts where buyers want several quotes.
- **Compare tray** (§3, §4). Cheap to build; for machines, compare year, hours, condition, price and location.
- **Express Posting without login, with human follow-up** (§4). A low-friction requirement capture. Keep it, but with machinery fields (machine type, brand, model, year, part no., L/R/Pair, qty, city, pincode) and phone/WhatsApp OTP instead of job title.
- **Structured trade fields** (§3): Min Order + unit, Sampling (free/paid), Delivery Time, Payment Terms, Incoterm, Negotiable flag, "Price on request". Reuse them, adapted to India (GST invoice yes/no, ex-works city, freight included).
- **Used-machine fields** (§3, §7): Manufacturing Year, Brand, Model, Condition, Automation level, Capacity/RPM, After-sales service. Make these **mandatory and filterable** for used listings. Add running-hours, "under power / can be seen running", inspection video and reason for sale.
- **Company KYC fields shown on the listing** (§3, §6): GST No., IE Code, establishment year, nature of business, turnover band. Verify GST via API and show a **verified badge on cards** too, since F2F has none (§8.9).
- **Listing lifecycle with "Valid Till", Paused and Expired states, and rejection reasons** (§5). Adopt it to avoid F2F's stale inventory (§8.5). Auto-expire and nudge sellers to renew; show "posted X days ago" on cards.
- **Moderation before going live** (§5). Combine it with automated unit/price sanity checks to avoid F2F-style errors ("EUR / Containers, MOQ 5 Kgs", §8.6).
- **Country/region landing pages and "Similar from {country}"** (§1, §3). For India, do this at **state/city/industrial-cluster level** (Surat, Ludhiana, Tiruppur, Coimbatore, Bhiwandi…) for SEO and local trust.
- **Search by reference number** (§4). Handy for phone/WhatsApp sales follow-ups; give every listing and part request a short ID.
- **Differentiate on F2F's gaps:** real photos (no "illustration only"), a clean deduplicated taxonomy with counts (§8.7), part-number and compatibility data with Left/Right/Pair (§7), rental listings (absent on F2F, §7), condition/price/year/location filters (§8.8), and INR-first pricing with simple plans (§8.13).
