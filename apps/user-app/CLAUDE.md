# user-app — Design System & Build Rules

Scope: `apps/user-app/` (React Native 0.81 + Expo SDK 54, Manrope + JetBrains Mono, Periwinkle v2 light/dark theming, en/hi/gu).
Use this for any new UI in this app, including when porting Figma designs via the Figma MCP.

---

## 1. Tokens

### 1.1 Where tokens live
- `lib/palette.ts` — `lightColors` / `darkColors` (Periwinkle v2), `shadowValues`. **The only file with colour values**; `palette.test.ts` checks it against the mockup's CSS variables.
- `lib/ThemeContext.tsx` — `ThemeProvider`, `useTheme()` → `{ colors, isDark, mode, setMode, shadows }`.
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
Both palettes share token names. **Never put a colour literal in a component** (hex, `rgb()`, or a named colour such as
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
| `Skeleton.tsx` | Pulsing `field` placeholder for loading states (themed in dark). |
| `Steps.tsx` | Onboarding progress bar (`current`, `total`) over the step text (`label`). |
| `AppToast.tsx` | Themed toast renderer, mounted once in `App.tsx`. Show toasts with `Toast.show({ type: 'success' \| 'error' \| 'info', text1 })`. Inside a Modal, render `<AppToast inModal />`. |
| `ConfirmSheet.tsx` | `const confirm = useConfirm(); if (await confirm({ title, message, destructive: true })) …` — also `useChoice()` for a three-way choice. Provider is in `App.tsx`. Buttons are `Button`s (`Confirm-sheet-confirm` / `-cancel` / `-secondary` / `-dismiss` / `-pick`). |

**Chrome and art**

| File | Role |
|---|---|
| `ScreenWrapper.tsx` | Safe-area + themed background; keyboard-aware / scroll options. **Wrap every screen.** Tab screens pass `edges={['top']}`. |
| `Header.tsx` | 56 dp app bar: raised back `IconButton` (`Back-button`) + title + right slot. |
| `FooterBar.tsx` | Floating white pill at the screen's bottom for the screen's actions; children are `Button size="md"` (flex 1). Every screen with a bottom action uses it. |
| `PressableScale.tsx` | Pressable with a spring press-scale (respects reduced motion). |
| `SideToken.tsx` | The Left / Right / Pair mark (`kind`: `left` `right` `pair` `want-left` `want-right` `none`; `size` `md` / `lg` / `xl`); halves from `lib/side-token.ts`. Use it wherever a part's side is shown. |
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

---

## 6. Styling
- `StyleSheet.create` only — no NativeWind / styled-components; inline objects only for one-off layout.
- Base design width 375; layout with flex and percentages, absolute values for type and padding.
- **Test every screen in light and dark** (Profile → Appearance, or the OS toggle). Never hardcode black/white backgrounds.
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
- Visual work isn't done until it's run on a device/emulator in both themes.
- `CI=1 npx expo export --platform android` is a quick check that Metro can bundle the app.
