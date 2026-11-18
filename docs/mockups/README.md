# Design mockups

| File | What |
|---|---|
| **`user-app-mockup-periwinkle-v2.html`** | **The approved design (D2, v2 chosen 2026-11-18)** and the UI brief for every screen: the 60 Periwinkle screens (56 phone, 4 admin) with parts rendered in real materials, a neutral board (lavender only in the hero), filled controls and segmented tabs, hairline cards, part numbers in JetBrains Mono, a side-convention diagram, and no tab bar under bottom action bars. Same `?only=<flow id>` and `&theme=dark` parameters as below. The app and admin were re-skinned to it on 2026-11-18; `apps/user-app/lib/palette.test.ts` and `apps/admin/lib/palette.test.ts` read its source and fail if the code's colours drift from it. |
| `onboarding-motion.html` | Onboarding motion mockup, "workshop precision" (2026-11-19, spec `docs/superpowers/specs/2026-11-19-onboarding-motion-mockup-design.md`): Welcome (exploded hub assembly, L | R token finds its right half), Mobile number (odometer digits, dial gauge), Code (one bolt tightened per digit, torque stripes, flange turns on Verify), Your business (laser-engraved nameplate, conveyor tiles), Where are you? (crane drops the pin, radar finds nearby units), GST (a caliper reads the GSTIN part by part). Light and dark, reduce motion, replay; the number and code screens take real typing. Deliberately unlike textile's onboarding motion. |
| `src/build-periwinkle-v2.mjs` | Generates v2 (`node docs/mockups/src/build-periwinkle-v2.mjs`). Made from `build-periwinkle.mjs`; screen content is shared by copy, so a content change goes in both. Its CSS variables (the `:root` / `[data-theme="dark"]` blocks) are the source of the app and admin palettes: change a colour here, regenerate, and the palette tests show what to update. |
| `user-app-mockup-periwinkle.html` | Periwinkle **v1** (D2, 2026-11-17), superseded by v2 and **kept for reference only**: 11 flows, 56 phone screens and 4 admin screens, light and dark. |
| `src/build-periwinkle.mjs` | Generates it: `node docs/mockups/src/build-periwinkle.mjs`. Screen content was copied from `build.mjs` and extended, so content changes now go here. |
| `user-app-mockup.html` | The app and admin design for client review: 11 flows, 51 phone screens and 4 admin screens, light and dark themes, ending with the decisions needed from the client. Open it in a browser (needs internet for Google Fonts). |
| `src/build.mjs` | Generates `user-app-mockup.html`. Edit this, then run `node docs/mockups/src/build.mjs` from the repo root. |
| `user-app-mockup-b.html` | **Direction B**, a second visual direction with the same 11 flows, 51 phone and 4 admin screens and the same content, so the client can compare like for like (decision D2). |
| `theme-options.html` | Step 1 of the new design pass, round 2: six colour and font themes taken from shop-floor materials (Red Oxide, Lathe Shop, Panel Board, Challan Book, Horn OK Please, Brass & Verdigris), each with a palette, fonts in English, Hindi and Gujarati, contrast checks, and a Home screen in light and dark. Waiting for the user's pick. |
| `theme-periwinkle.html` | A lavender and violet theme from the user's reference shot (white rounded cards, outlined price pills, yellow badges), with palette, type, components and four sample screens. Waiting for the user's verdict. |
| `theme-clean-bench.html` | **Clean Bench**: the user's two references combined (the Mealio food app and its motion video, and the Periwinkle shop UI). Warm neutral screens, charcoal buttons, light Mulish headings, peach / sage / lavender cards for parts / machines / rentals, violet for selection and side; an exploded wheel-hub welcome screen, word-reveal headlines, staggered cards and a bottom-sheet details screen. Five phones plus palette, type, components and motion. Waiting for the user's verdict. |
| `src/build-b.mjs` | Generates `user-app-mockup-b.html`: `node docs/mockups/src/build-b.mjs`. The screen content was copied from `build.mjs`, so a content change has to be made in both files. |

**Viewing one flow:** add `?only=<flow id>` (and optionally `&theme=dark`), e.g.
`user-app-mockup.html?only=requirements`. Flow ids: `onboarding`, `discover`, `listing`, `sell`, `negotiate`, `deals`,
`requirements`, `rental`, `seller`, `account`, `admin`.

**Visual direction** (deliberately unlike the textile project's pink Myntra style):

- Colours: steel `#E6EAEE` background, ink `#1F2B38`, safety yellow `#F4B400` for the one main action per screen, blueprint
  blue `#2D5B8C` for drawings and links, green `#1F8A5B` for in-stock and verified, red `#C93C3C` for errors. Dark theme
  included.
- Type: Barlow Condensed for headings, prices and numbers; Barlow for reading; Noto Sans Gujarati and Devanagari for Gujarati
  and Hindi.
- Parts and machines are drawn as line sketches on a blueprint grid (placeholders for real photos).
- The **side mark**, two L-shaped halves where a missing side is dashed, shows Left / Right / Pair / "needs right" everywhere
  a part appears. It doubles as the placeholder logo.

**Direction B, "workshop enamel"** (`user-app-mockup-b.html`):

- Colours: warm paper `#F3EFE7`, ink `#1C1E1B`, machine green `#1F5641` (the enamel paint of Indian machine tools) for
  headers, selections and the seller's own side, signal orange `#DD5119` for the one main action and for what is needed.
  Dark theme included.
- Type: Archivo (wide, heavy) for headings; IBM Plex Sans for reading; IBM Plex Mono for prices, part numbers, quantities
  and times, like a parts catalogue; Hind Vadodara and Hind for Gujarati and Hindi.
- Parts are lit like product photos on a studio sweep instead of blueprint sketches.
- Shapes: pill buttons and chips, large rounded cards, a floating dark tab bar with a round orange Sell button, a green home
  header, two-up photo tiles for "Near you" and seller listings, and a listing page whose details slide up over the photo.
- The **L | R token** replaces the L-shaped side mark. A filled side means the listing has that side. An orange dashed
  side is the one that is needed, and a grey side is the one the buyer already has. The token doubles as the placeholder logo.

Screens map to the modules in `docs/product-scope.md` (scope IDs U1–U4, F1–F9, A1–A6 are printed under each flow title).
