# Design mockups

| File | What |
|---|---|
| `user-app-mockup.html` | The app and admin design for client review: 11 flows, 51 phone screens and 4 admin screens, light and dark themes, ending with the decisions needed from the client. Open it in a browser (needs internet for Google Fonts). |
| `src/build.mjs` | Generates `user-app-mockup.html`. Edit this, then run `node docs/mockups/src/build.mjs` from the repo root. |
| `user-app-mockup-b.html` | **Direction B**, a second visual direction with the same 11 flows, 51 phone and 4 admin screens and the same content, so the client can compare like for like (decision D2). |
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
