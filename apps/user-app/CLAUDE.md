# user-app — Design System & Build Rules

Scope: `apps/user-app/` (React Native 0.81 + Expo SDK 54, Manrope + JetBrains Mono, Periwinkle v2, **light only**, en/hi/gu).
Use this for any new UI in this app, including when porting Figma designs via the Figma MCP.

---

## 1. Tokens

### 1.1 Where tokens live
- `lib/palette.ts` — `lightColors` (Periwinkle v2), `shadowValues()`. **The only file with colour values**; `palette.test.ts` checks it against the mockup's light CSS variables. **The app is light only** (owner's call, 2026-11-19): no dark palette, no theme setting, `userInterfaceStyle: "light"`. Don't add `isDark` branches or a dark palette back.
- `lib/ThemeContext.tsx` — `ThemeProvider`, `useTheme()` → `{ colors, shadows }` (always the light palette).
- `lib/fonts.ts` — `fonts`; `lib/typography.ts` — the type scale (`TYPE_SCALE`, `typeStyle`), read through `useType()` (`hooks/use-type.ts`).
- `lib/theme.ts` — re-exports + static tokens (`fonts`, `spacing`, `radius`).
- Plain TS constants — no Style Dictionary, no NativeWind, no tokens.json.

### 1.2 Static tokens (extend, don't fork)
```ts
fonts:   regular 'Manrope_400Regular' · medium 500 · semiBold 600 · bold 700 · extraBold 800
         mono 'JetBrainsMono_400Regular' · monoMedium 500 (identifiers only: GSTIN, PAN, part numbers, codes)
spacing: xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32
radius:  xs 6 (mono tag) · sm 10 (segment) · md 14 (fields, wells) · lg 18 (callouts, toasts) · xl 24 (cards) · sheet 28 · full 999 (buttons, chips, pills)
```
**Type comes from the scale**, not hand-picked sizes: `const type = useType();` then `title: { ...type('title'), color: colors.text }`.
Tokens: `display title sheetTitle appBar section cardTitle lead body bodyStrong fieldValue label caption button buttonSm chip
badge price otp phone mono` (sizes in `lib/typography.ts`, spec §5.4). `typeStyle` applies the Hindi / Gujarati rules
(taller line height, no negative tracking, 800 → 700). **Never `fontWeight`**: the family name picks the weight.

### 1.3 Colors
**Never put a colour literal in a component** (hex, `rgb()`, or a named colour such as
`'white'`) — read `useTheme().colors`. `lib/style-audit.test.ts` fails on one (allowlist: `lib/style-audit-allowlist.json`).
Tokens: `background surface photo field text textSecondary textMuted border divider hairline primary primaryInk onPrimary
primarySoft primaryWash sun onSun ok okSoft warn warnSoft danger dangerSoft onDanger star heroGlow scrim` (uses in spec §4.1).
Violet (`primary`, `primaryInk`) only for actions and selection; `sun` only for badges; status colours on their `*Soft` fill.

### 1.4 Shadows
`const { shadows } = useTheme();` — `shadows.raised` / `.float` / `.segment` are `{ boxShadow }` style objects, only for
things that float (icon buttons, footer bar, tab bar, toast, selected segment). **Cards don't cast shadows**: `surface` +
1 dp `hairline` border. Never hand-roll `shadowOffset` or `boxShadow`.

---

## 2. Components (`components/`, one per file, PascalCase)

| File | Role |
|---|---|
The v2 kit (spec §7; mockup `docs/mockups/user-app-mockup-periwinkle-v2.html`). **Use these before writing a new one**;
a screen never hand-rolls a copy of a kit piece (a status pill, a callout, a selectable row, a footer).

**Controls**

| File | Role |
|---|---|
| `Button.tsx` | Pill button. `variant`: `primary` (violet fill) · `outline` (white, 1.5 `border`) · `ghost` (text link, `primaryInk`) · `danger` (red fill, destructive confirm). `size`: `lg` 52 (default, standalone) · `md` 48 (inside `FooterBar`) · `sm` 36 (auto width). Optional leading `icon`; `loading`, `disabled`; spring press (respects reduced motion). `phLabel` is its `testID`. |
| `Input.tsx` | Filled text input: `field` fill, turns `surface` with a `primary` border on focus, `danger` border + message on error; label above (sentence case). `prefix` (e.g. `+91`, with a hairline divider), `size="lg"` (60 high, `phone` type), `mono` (JetBrains Mono, for GSTIN / PAN / codes). `InputComponent` swaps in a bottom-sheet input. |
| `Field.tsx` | Label + children + hint + error for anything that isn't a text input (chip groups, lists). Also exports `FieldLabel` / `FieldHint` / `FieldError`. |
| `Chip.tsx` | Selectable chip (`role` checkbox / radio, optional icon): `field` fill, `primarySoft` + `primaryInk` when selected. |
| `SegmentedControl.tsx` | One choice among 2–4 short options (`options: { value, label, testID }[]`, `value`, `onChange`); radiogroup roles. |
| `OtpCells.tsx` | `length` digit cells drawn over one real `TextInput` (SMS autofill, paste, hi/gu digits unchanged); cells from `lib/otp-cells.ts`. Fixed-length codes only. |
| `IconButton.tsx` | 44 circle icon button: `raised` (default) · `outline` · `primary`. `accessibilityLabel` and `testID` required. |

**Surfaces and feedback**

| File | Role |
|---|---|
| `Card.tsx` | `surface` + 1 dp `hairline`, radius `xl`, no shadow. `flush` (no padding, clipped) for a list of `ListRow`s. |
| `ListRow.tsx` | Menu / settings / option row: leading icon (`primaryInk`), label, hint, `trailing` slot, `chevron`, `selected` (lavender + check), `last` (no divider). |
| `StatusChip.tsx` | Status pill. `tone`: `ok` · `warn` · `danger` · `info` · `neutral` · `new` · `sun` (the yellow badge); optional icon. |
| `Notice.tsx` | Callout (`tone` info / success / warning / danger, icon, optional title, children). |
| `EmptyState.tsx` | Icon well + title + subtitle + optional CTA (`Button size="md"`). |
| `Skeleton.tsx` | Pulsing `field` placeholder for loading states. |
| `Steps.tsx` | Onboarding progress bar (`current`, `total`) over the step text (`label`). |
| `AppToast.tsx` | Themed toast renderer, mounted once in `App.tsx`. Show toasts with `Toast.show({ type: 'success' \| 'error' \| 'info', text1 })`. Inside a Modal, render `<AppToast inModal />`. |
| `ActionSheet.tsx` | Bottom sheet with a list of rows (the manage sheet, report reasons): labels from the caller, backdrop and Back close it, radio rows for a single choice. |
| `ConfirmSheet.tsx` | `const confirm = useConfirm(); if (await confirm({ title, message, destructive: true })) …` — also `useChoice()` for a three-way choice. Provider is in `App.tsx`. Buttons are `Button`s (`Confirm-sheet-confirm` / `-cancel` / `-secondary` / `-dismiss` / `-pick`). |
| `BottomSheet.tsx` | The v2 `.sheet` frame for a sheet with its own content (sign-in, location): Modal, sheet animation, scrim, Back closes, handle, optional title, content above the keyboard. A list of rows stays `ActionSheet`. |
| `SignInSheet.tsx` | Why an account is needed (`reason`), Continue with mobile number, Not now. `SignInSheetProvider` is mounted once in `App.tsx`; open it through `useRequireSignIn()` (§5.1). |

**Chrome and art**

| File | Role |
|---|---|
| `ScreenWrapper.tsx` | Safe-area + themed background; keyboard-aware / scroll options. **Wrap every screen.** Tab screens pass `edges={['top']}`. |
| `Header.tsx` | 56 dp app bar: raised back `IconButton` (`Back-button`) + title + right slot. |
| `FooterBar.tsx` | Floating white pill at the screen's bottom for the screen's actions; children are `Button size="md"` (flex 1). Every screen with a bottom action uses it. |
| `PressableScale.tsx` | Pressable with a spring press-scale (respects reduced motion). |
| `SideToken.tsx` | The Left / Right / Pair mark (`kind`: `left` `right` `pair` `want-left` `want-right` `none`; `size` `md` / `lg` / `xl`); halves from `lib/side-token.ts`. Use it wherever a part's side is shown. |
| `ListingCard.tsx` | A listing row (v2 `.listing`): thumbnail, title, side, condition, quantity, price, place, distance, tags (Reserved / On rent / "Pair: contains a left"), heart. Map an API card onto it (`screens/listing/listing-card-item.tsx`). |
| `GridCard.tsx` | Grid card (v2 `.gcard`): product shot, heart, side token, first tag as the yellow badge, title, price. Home's "Top items near you", rentals-only results. |
| `MiniCard.tsx` | Small card for a horizontal row (v2 `.mini`): photo, title, price or headline rate. Home's "Machines for rent nearby". |
| `SaveButton.tsx` | The heart (v2 `.hrt`). Optimistic through `useSaveToggle` (`hooks/use-saved.ts`); a guest gets the sign-in sheet and the save runs after sign-in. Never on the viewer's own listing (`canShowHeart`). |
| `FilterChipRow.tsx` | The results screen's filter row (v2 `.filterrow`): Filters n, the reader's removable chips (×), radius chip, quick chips. |
| `LocationChip.tsx` / `LocationSheet.tsx` | Home's origin chip (server's `origin.label` + "Within 50 km" / "All India") and the sheet behind it: Use my location, Use my business location, Enter pincode, radius chips. |
| `PriceText.tsx` | Rupees from paise with Indian grouping (₹1,23,456), a per-unit suffix and an optional model note. Never format money by hand. |
| `MediaTile.tsx` | Photo / video tile of the media step: picture, Cover badge, upload progress (`tileState()` maps the queue's states), error with retry, Make cover, delete. |
| `SideDiagram.tsx` | The side convention drawing (machine from above, operator behind, L and R). Only for the default convention. |
| `HeroGlow.tsx` | Welcome screen's radial lavender glow (`react-native-svg`), drawn behind the screen. |
| `art/GearShot.tsx` | Product-shot gear illustration (welcome). `components/art/` holds illustration colours and is on the style-audit allowlist. |

**Tab bar.** `navigation/floating-tab-bar.tsx` (set as `tabBar` in `tab-navigator.tsx`) is a floating, icon-only pill
(spec §7.5, R9): translated `accessibilityLabel`s (`nav.tabs.*`), `testID`s `Tab-home` / `Tab-search` / `Tab-post` /
`Tab-chats` / `Tab-deals`, Post always the violet circle, hidden while the keyboard is open. It is absolutely placed, so
screens draw under it: **every tab screen pads its scroll content (or body) bottom by `useTabBarInset()`**
(`hooks/use-tab-bar-inset.ts`; the arithmetic is `tabBarInset()` in `lib/tab-bar.ts`). A new tab screen that forgets it
puts its last row or CTA under the bar.

Hooks: `useAuth` (session), `useSocket(onEvent)` (live `/user` events; filter by event-name prefix), `use-sheet-animation`
(bottom-sheet enter/exit), `useType()` (type scale, §1.2), `useTabBarInset()`, `useGstState` (`hooks/use-business.ts`).

Pure helpers behind the kit (tested): `lib/otp-cells.ts`, `lib/side-token.ts`, `lib/split-value.ts` (`splitOnValue`:
split a translated sentence around an interpolated GSTIN so only the value is set in mono), `lib/tab-bar.ts`.

### 2.1 Component contract (mandatory)
1. Read theme via `const { colors, shadows } = useTheme();` and type via `const type = useType();`.
2. Styles in `useMemo(() => StyleSheet.create({...}), [colors, shadows, type])` (only the ones you use).
3. Accept a `style` override on the outermost element.
4. Semantic color tokens only; `type('…')` or `fonts.*` for `fontFamily`, never raw `'Manrope_…'` strings.
5. No hard-coded copy — every string through `t()` (§8).

```tsx
export function Foo({ title, style }: { title: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const type = useType();
  const s = useMemo(() => StyleSheet.create({
    box: { backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.hairline },
    title: { ...type('cardTitle'), color: colors.text },
  }), [colors, type]);
  return <View style={[s.box, style]}><Text style={s.title}>{title}</Text></View>;
}
```

---

## 3. Frameworks

| Concern | Choice |
|---|---|
| Runtime | RN 0.81, React 19.1, Expo SDK 54, New Architecture, expo-dev-client |
| Navigation | **React Navigation** (`navigation/`): root stack → auth stack / onboarding / 5 bottom tabs (Home, Search, Post, Chats, Deals) + Profile. **No Expo Router**; screens live in `screens/`. |
| State | Redux Toolkit (`store/authSlice.ts`) — client state only |
| Server data | TanStack React Query (`lib/queryClient.ts`) + axios (`lib/api.ts`, attaches JWT + `X-App-Language`) |
| Forms | Formik + Yup (see `screens/onboarding/your-business.tsx`, schemas in `lib/onboarding-step.ts`); build Yup schemas inside the component so messages follow the language |
| Icons | `lucide-react-native`, imported **only** via `lib/icons.ts` |
| Toasts | `react-native-toast-message` |
| Animation | Reanimated 4 + react-native-worklets (babel plugin must stay last) |
| Images | `expo-image`; photo capture via `expo-image-picker` |
| Listing media (F2) | `expo-image-manipulator` (every photo, thumb and video poster is re-encoded, which strips EXIF / GPS: `lib/media-device.ts`), `expo-video` + `expo-video-thumbnails` (playback, posters), `react-native-compressor` + `react-native-nitro-modules` (video, `preserveMetadata: false`). Native modules: a new dev build is needed after pulling them. **Video upload is off** (`LISTING_VIDEO_UPLOAD_ENABLED` in shared-types and the app's `VIDEO_SPIKE_PASSED`, Android only) until the device checks in `docs/superpowers/spikes/2026-11-18-f2-native-media.md` pass. |
| Secure storage | `expo-secure-store` for the JWT; AsyncStorage for preferences |

Add a library with `npx expo install <pkg>` (not `pnpm add`) so it matches SDK 54, then `CI=1 npx expo install --check`.

---

## 4. Monorepo gotchas (don't "simplify" these)
- `metro.config.js` pins every `react` / `react-native` import to this app's copy. Admin is React 18; without the pin Metro can bundle two React Natives and the app boots to `"main" has not been registered`.
- `tsconfig.check.json` (used by `pnpm typecheck`) maps `react` types to this app's `@types/react` 19. That mapping must **not** go in `tsconfig.json` — Metro turns `paths` into runtime aliases.
- `@mpm/shared-types` is consumed from its built `dist/`; rebuild it after changing it.

---

## 5. Project structure
```
apps/user-app/
├── App.tsx              # fonts, i18n boot, providers (Theme, Redux, React Query, Navigation, Toast)
├── components/          # shared UI (§2)
├── hooks/               # useAuth …
├── lib/                 # theme, api, queryClient, i18n/, validation/, jwt, icons
├── locales/{en,hi,gu}/  # one JSON per area + locales/index.ts
├── navigation/          # root-navigator, auth-stack, tab-navigator, types
├── screens/             # one folder per feature (auth/, tabs/, …)
└── store/               # Redux slices
```
A feature folder owns its sub-screens, helpers and local types; promote to `components/` or `lib/` when shared.

### 5.1 Guests and the discovery origin (F4 + F5)

- **Guest navigation** (business rule 2, F4 + F5 spec §8.1): Welcome's "Browse first" opens the `guest` group in
  `navigation/root-navigator.tsx` (tabs, listing pages, search results, and the auth screens pushed when needed); a cold
  start with no saved session reopens it, a refused session lands on Welcome (`lib/sign-in-gate.ts`). Post, Chats and
  Deals ask a guest to sign in (`screens/tabs/guest-gate.tsx`); Profile shows a Sign in card.
- **Asking for sign-in:** never navigate to the phone screen yourself. Call `requireSignIn({ reason, pending })` from
  `useRequireSignIn()` (`hooks/use-require-sign-in.ts`): it returns true when signed in, else opens the sign-in sheet.
  `pending` is a serialisable `PendingAction` (`lib/pending-action.ts`: `save`, since F6 the contact types
  `enquire` / `offer` / `buy` / `ask_price`, since F8 `post_request` with a prefill, which opens Post a requirement
  through `hooks/use-pending-request.ts` and never posts by itself, and since M14 `request_booking` with a listing id and
  an optional prefill, which opens Request booking through `openPendingBooking` (`hooks/use-pending-contact.ts`) and
  never sends by itself) kept in the auth slice; `usePendingActionRunner` (`hooks/use-saved.ts`)
  runs it once after OTP **and** onboarding (contact types reopen the listing with that sheet through
  `openPendingContact`, `hooks/use-pending-contact.ts`; nothing is sent until the user taps Send); cancel drops it.
- **Origin:** `useDiscoveryOrigin()` (`hooks/use-discovery-origin.ts`, pure store in `lib/discovery-origin.ts`) is the one
  origin for Home, Search, results and the location sheet. GPS fixes live in memory only: **never store coordinates**
  (AsyncStorage keeps the radius, a typed pincode and the source) and never put a coordinate or pincode in analytics or
  logs. A list **freezes** its origin when page 1 is requested (`origin.freeze()`) and sends that same origin with every
  later page and count-only call (spec R18: the cursor's seal includes it); a location change starts a new list.
- **Server data:** discovery calls live in `lib/discover-api.ts` / `lib/saved-api.ts` and the hooks in
  `hooks/use-discover.ts` / `hooks/use-saved.ts`; React Query keys sit under `['discover', …]` so a save toggle patches
  every cached card (`applySaved`). `lib/install-id.ts` sends `X-Install-Id` (rate-limit key for guests).

### 5.2 Chat, offers, deals and push (F6 + F7)

- **One socket:** `components/SocketProvider.tsx` (mounted in `root-navigator.tsx` when signed in) opens the `/user`
  socket once; screens use `useSocketEmit()` / `useOnReconnect()`, never their own socket. Events go by prefix
  (`lib/socket-route.ts`) to `lib/socket-chat.ts` (`message:` / `offer:` / `thread:`), `lib/socket-deals.ts` (`deal:`)
  and `lib/socket-notifications.ts` (`notification:`). Payloads carry ids (and the reader's own masked text): handlers
  patch or invalidate React Query entries, they don't trust a payload as the whole record.
- **Query keys** for these modules live in `lib/query-keys.ts` (`qk.threads`, `qk.thread`, `qk.messages`, `qk.deals`,
  `qk.deal`, `qk.reviewState`, `qk.notifications`, `qk.badges`…): use them from screens and socket handlers alike.
- **Server calls:** `lib/chat-api.ts`, `offers-api.ts`, `deals-api.ts`, `reviews-api.ts`, `notifications-api.ts`;
  hooks in `hooks/use-chat.ts`, `use-offers.ts`, `use-deals.ts`, `use-notifications.ts`, `use-badges.ts`. Offer and
  deal writes send an `Idempotency-Key` (one per user action, reused on retry). Pure logic (offer form bounds and
  totals, deal actions and deadlines, review form, chat formatting, push dedupe, notification links) is in `lib/` with
  co-located tests.
- **Phone numbers** come from the API already masked per reader; never unmask or format a number the API didn't send.
  Chat text, numbers and photos never go to analytics or crash reports.
- **Push** (`lib/push.ts`, `hooks/use-push.ts`): Android only, opt-in after the explainer; `expo-notifications` loads only
  when its native module is in the build, and without `google-services.json` the token call fails quietly. It is a
  native module: **a new dev-client build** is needed after F6 (and to pick up a `google-services.json`).

### 5.3 Part requests (F8)

- **Screens** live in `screens/requirements/`: buyer `post-requirement` (post, edit, copy), `requirement-posted`,
  `my-requirements`, `requirement-buyer`, `compare-responses`; seller `requirement-seller`, `reply-with-listing`,
  `buyers-looking`; `requirement.tsx` loads `GET /part-requests/:id` once and renders the buyer or the seller screen by
  the view's `role`. Pieces in `components/part-requests/` (the form in `form/`, Home strips, reply / match cards,
  sheets, `BuyerBlock`, which never shows a contact field). UI copy says "requirement", code says `part_request`.
- **Server calls** in `lib/part-requests-api.ts`; hooks `use-part-request.ts`, `use-my-part-requests.ts`,
  `use-seller-part-requests.ts`, `use-part-request-home.ts`. **Query keys** in `lib/query-keys.ts`: lists under
  `['part-requests', …]` (`qk.partRequestsMine`, `qk.partRequestsForSellers`, `qk.partRequestHome`,
  `qk.partRequestDemand`…), one request and its parts under `['part-request', id, …]` (`qk.partRequest`,
  `qk.partRequestReplies`, `qk.partRequestMatches`, `qk.partRequestCompare`, `qk.partRequestPhotos`).
  Writes (post, edit, renew, close, fulfil, replies) send an `Idempotency-Key`, one per user action, reused on retry.
- **Socket:** `part_request:updated { partRequestId, reason }` routes by the `part_request:` prefix
  (`lib/socket-route.ts`) to `lib/socket-part-requests.ts`, which invalidates the request's keys and the lists.
- **Seller actions:** show Reply / List a matching part only when the view's `canAct` is true (a `viewer` member gets
  false) and `canReply` allows it; `lib/reply-picker.ts` (`sellerActions`) decides, with tests.
- **Pure logic with tests:** the form and its Yup schema (`lib/part-request-form.ts`), compare rows
  (`lib/part-request-compare.ts`), display helpers (`lib/part-request-display.ts`), error copy (`lib/f8-errors.ts`), the
  sell wizard's category scope for a draft from a request (`lib/sell-category.ts`). Analytics: `REQUEST_EVENTS` in
  `lib/analytics-events.ts`, ids, counts and codes only (never a name, note or message).
- **Copy:** `locales/{en,hi,gu}/requirements.json` (buyer) and `buyers.json` (seller).

### 5.4 Rental bookings (M14)

- **Screens** live in `screens/rentals/`: `request-booking` (`RequestBooking { listingId, prefill? }`: date sheet with
  busy days, period, count, machines, options, site, live estimate; also the renter's changed request),
  `booking-record` (`BookingRecord { bookingId }`, both sides: proposal card with the reader's answers, money estimate →
  agreed → final, timeline, notes, contact, hour meters and photos, review, Report a problem, Cancel) and
  `rental-calendar` (`RentalCalendar { listingId }`, the owner's month grid and blocks). Pieces in
  `components/rentals/` (availability strip, estimate card, `BookingCard` for the thread, `BookingRow` for the Deals
  tab's Rentals list, owner / renter answer bars, the propose-change / decline / on site / return / notes / cancel /
  block / date-range sheets). The Deals tab has a Deals / Rentals switch; `ReviewDeal` and `ReportProblem` take
  `{ subject: 'deal' | 'rental', id }`; the listing page shows Request booking + Enquire on a rental (the owner gets
  Calendar and Bookings); search results get a "Dates" chip ("Free on") for rentals.
- **Server calls** in `lib/rentals-api.ts`; hooks `use-rental-booking.ts` (the Booking record, photos, availability,
  estimate and **every booking write**, with `invalidateAfterBooking` refreshing the lists, badges, thread, listing and
  My listings), `use-rental-bookings.ts` (the Rentals list) and `use-rental-calendar.ts` (calendar and blocks).
  **Query keys** under `qk.rentals.*` in `lib/query-keys.ts`: lists under `['rentals', …]` (`qk.rentals.all`,
  `qk.rentals.list`, `qk.rentals.estimate`), one booking under `['rental-booking', id]` (`qk.rentals.booking`,
  `bookingReview`, `bookingPhotos`), a listing's availability and calendar under `['rental-listing', listingId, …]`
  (`qk.rentals.listing`, `availability`, `calendar`). Writes send an `Idempotency-Key`, one per user action, reused on
  retry; proposal answers send the `versionSeq` shown.
- **Socket:** `rental:updated { bookingId, threadId, status, version }` routes by the `rental:` prefix
  (`lib/socket-route.ts`) to `lib/socket-rentals.ts`, which refetches the booking, the Rentals lists, the thread and the
  badges. Payloads are ids only.
- **Dates** are IST calendar dates `YYYY-MM-DD` compared as strings (`lib/rental-dates.ts`); today comes from
  `lib/ist-date.ts` at the call site, never the device time zone. Money is integer paise; local previews (the form's
  instant total, a change's "% vs estimate") use shared-types' `rentalEstimate` on the booking's or listing's terms, and
  the server's `POST /rentals/estimate` / version totals are what count.
- **Pure logic with tests:** `lib/rental-display.ts` (periods, estimate lines, status chips, actions, whose turn),
  `lib/rental-request-form.ts` (the request's Yup schema), `lib/rental-dates.ts`, `lib/rental-calendar.ts` (the owner's
  grid), `lib/rental-return.ts` (the owner's change and return forms), error copy `lib/m14-errors.ts`. Analytics:
  `RENTAL_EVENTS` in `lib/analytics-events.ts`, ids, statuses, periods, counts and codes only (never an address,
  pincode, note, message or typed amount).
- **Copy:** `locales/{en,hi,gu}/rentals.json` (renter, Booking record) and `rentals-owner.json` (owner sheets, calendar).

---

## 6. Styling
- `StyleSheet.create` only — no NativeWind / styled-components; inline objects only for one-off layout.
- Base design width 375; layout with flex and percentages, absolute values for type and padding.
- The app is light only: it ignores the phone's dark mode. Never hardcode black/white backgrounds; use the tokens.
- Large tap targets (≥44pt) — many users are traders with low digital comfort (scope NFRs). The mockup's sizes are
  scaled × 1.15 for the app (spec R1); take sizes from the type scale and the kit, not from the mockup's pixels.
- **Never `fontWeight`** (Android ignores it for a custom family; the family name picks the weight) and never a
  `fontFamily` string literal (`fonts.*` or `type('…')`).
- **The style audit enforces this**: `lib/style-audit.test.ts` fails on a hex / `rgb()` / `hsl()` colour, a named colour
  as a colour value, any `fontWeight`, or a literal `fontFamily` anywhere in the app's source. Fix the code; add to
  `lib/style-audit-allowlist.json` (`{ path, reason }`) only for a palette or illustration file.

---

## 7. Assets
- Local assets in `assets/`, referenced with `require()`.
- Remote media (part and machine photos) via `expo-image` with fixed dimensions; the API returns signed S3/R2 URLs.
- Listing photos must be real photos of the actual part or machine (scope F2) — never bundle stock imagery for listings.

---

## 8. Languages (English, Hindi, Gujarati) — required for anything new

Every string you add or change must exist in **all three** languages in the same change.

1. **No hard-coded copy.** English in `locales/en/<area>.json`, Hindi in `locales/hi/<area>.json`, Gujarati in `locales/gu/<area>.json`, same key. Render with `t('area.key')` (`useTranslation()`), or `i18n.t()` from `@/lib/i18n` outside components — at render/call time, never at module load. A new area is registered in `locales/index.ts`.
2. **Hindi is natural and polite (आप); Gujarati is natural and polite (તમે).** Short on buttons. Keep OTP, GST, UPI, ₹ and the brand as is. Trade terms stay familiar loanwords in script (पार्ट / પાર્ટ, मशीन / મશીન, डील / ડીલ, लेफ़्ट/राइट / લેફ્ટ/રાઇટ).
3. **Placeholders and plurals match.** `{{name}}` identical in en, hi, gu; counted strings need `_one` and `_other` in every file.
4. **Some text stays English:** values sent to the API (enums), testIDs, route names, server-provided text.
5. **The tests enforce it.** `lib/i18n/parity.test.ts` fails on a missing key or mismatched placeholder; `lib/i18n/audit.test.ts` fails on hard-coded English. Fix the code; add to `audit-allowlist.json` only for strings that truly must stay English, with a specific `reason`.

---

### 8.1 Dates, digits and scripts
- **Dates go through `lib/format-date.ts`** (IST wall clock, en/hi/gu month and day names) — never `toLocaleDateString` or hand-made month arrays. Today's Indian date: `istDateKey()` from `lib/ist-date.ts`.
- **Numeric input:** Gujarati and Hindi keyboards type their own digits. Keep the raw text in the field and derive digits with `lib/auth-input.ts` / `lib/digits.ts` (`toAsciiDigits`) before validating or sending.
- **Scripts (spec §5.3, R6):** Manrope has no Gujarati/Devanagari, so the OS fallback draws those glyphs (Noto Sans
  Devanagari / Gujarati on Android, Apple's Indic fonts on iOS) while Latin, digits and ₹ stay Manrope. No Noto is
  bundled. `useType()` / `typeStyle(token, lang)` applies the script rules for hi/gu: line height ≥ 1.45 × size
  (`scriptLineHeight`), no negative tracking (`scriptTracking`, `lib/i18n/script.ts`), and 800 drops to 700. Use the
  script helpers directly only for text outside the scale.
- **Contingency:** if, on an Android device, hi/gu titles don't look bolder than body text, bundle
  `@expo-google-fonts/noto-sans-devanagari` and `-gujarati` (400 / 600 / 700, `npx expo install`) and make `typeStyle`
  in `lib/typography.ts` return the Noto family for the script — that one function is the switch.

---

## 9. Analytics (PostHog) and crash reporting (Sentry) — required for anything new

Both are off until their env vars are set (`EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN`, `EXPO_PUBLIC_SENTRY_DSN`); every call is then a no-op.

1. **Screens are automatic** (reported from navigation state in `App.tsx`; only params in `SCREEN_PARAM_ALLOWLIST` are sent). Sheets, modals and in-screen state changes are not — fire an event.
2. **Declare events in `lib/analytics-events.ts`** in a named group (`AUTH_EVENTS`, add `LISTING_EVENTS`, `OFFER_EVENTS`…), then `track(GROUP.name, props)`. Names are `snake_case` `<area>_<thing>_<past tense>`. Never pass a raw string.
3. **Track the outcome, not just the tap:** start, success, failure (with a `reason` code), and drop-off.
4. **Every pressable gets a `testID`** (Button: `phLabel`) — English, hyphenated. It's the autocapture label and the e2e selector.
5. **No personal data** in event properties or crash reports: no phone, GSTIN, PAN, bank details, address, chat text or OTP. Ids, counts, statuses, amounts only. `lib/error-reporting.ts` redacts known keys; don't rely on it alone.

---

## 10. Testing
- Pure logic goes in `lib/` with a co-located `*.test.ts` (Vitest, Node env, forced UTC — see `vitest.global-setup.ts`).
- `lucide-react-native` is aliased to `__mocks__/lucide-react-native.ts` in tests; add any new icon there too.
- Design guards: `lib/palette.test.ts` reads the mockup's source (`docs/mockups/src/build-periwinkle-v2.mjs`) and fails if
  a token drifts from its CSS variable, a new mockup variable isn't mapped (or listed as not ported), or a contrast floor
  is broken; `lib/style-audit.test.ts` fails on hard-coded colours, `fontWeight` and literal font families (§6);
  `lib/typography.test.ts` covers the script rules.
- Session safety: `lib/fresh-install.ts` wipes the keychain JWT on a reinstall (iOS keeps keychain items across uninstalls). Any new SecureStore key that must not outlive an install goes in its `SECURE_KEYS`.
- Visual work isn't done until it's run on a device/emulator.
- `CI=1 npx expo export --platform android` is a quick check that Metro can bundle the app.
