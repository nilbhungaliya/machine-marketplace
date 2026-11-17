# user-app — Design System & Build Rules

Scope: `apps/user-app/` (React Native 0.81 + Expo SDK 54, Montserrat + Inter, light/dark theming, en/hi/gu).
Use this for any new UI in this app, including when porting Figma designs via the Figma MCP.

---

## 1. Tokens

### 1.1 Where tokens live
- `lib/theme.ts` — re-exports + static tokens (`fonts`, `spacing`, `radius`).
- `lib/ThemeContext.tsx` — `lightColors` / `darkColors`, `getCardShadow`, `getPrimaryGlow`, `ThemeProvider`, `useTheme()`.
- Plain TS constants — no Style Dictionary, no NativeWind, no tokens.json.

### 1.2 Static tokens (extend, don't fork)
```ts
fonts:   display 'Montserrat_700Bold' · displaySemi · displayHeavy · regular 'Inter_400Regular' · medium · semiBold · bold
spacing: xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32
radius:  sm 8 (chips) · md 12 (inputs) · lg 16 (cards) · xl 20 (hero) · full 999 (Button, avatars)
```
No central type scale: round Figma sizes to `12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32`; `lineHeight ≈ fontSize × 1.4`.

### 1.3 Colors
Both palettes share token names. **Never put a hex literal in a component** — read `useTheme().colors`.
Primary is indigo (`#4F46E5` light / `#818CF8` dark), the same brand as the admin's Tailwind `brand` scale. Text on primary is `colors.onPrimary`.
Status: `green / red / blue / orange` + `*Muted` backgrounds.

### 1.4 Shadows
`const { cardShadow, primaryGlow } = useTheme();` — cards/sheets use `cardShadow`, primary CTAs `primaryGlow`. Never hand-roll `shadowOffset`.

---

## 2. Components (`components/`, one per file, PascalCase)

| File | Role |
|---|---|
| `ScreenWrapper.tsx` | Safe-area + themed background; keyboard-aware / scroll options. **Wrap every screen.** Tab screens pass `edges={['top']}`. |
| `Header.tsx` | 56px header: back button + title + right slot. |
| `Button.tsx` | `primary` / `outline` / `ghost`; loading + disabled; spring press (respects reduced motion). |
| `Input.tsx` | Labeled text input with focus and error states. |
| `EmptyState.tsx` | Icon + title + subtitle + optional CTA. |
| `Skeleton.tsx` | Pulsing placeholder block for loading states. |
| `PressableScale.tsx` | Pressable with a spring press-scale (respects reduced motion). |
| `AppToast.tsx` | Themed toast renderer, mounted once in `App.tsx`. Show toasts with `Toast.show({ type: 'success' \| 'error' \| 'info', text1 })`. Inside a Modal, render `<AppToast inModal />`. |
| `ConfirmSheet.tsx` | `const confirm = useConfirm(); if (await confirm({ title, message, destructive: true })) …` — also `useChoice()` for a three-way choice. Provider is in `App.tsx`. |

Hooks: `useAuth` (session), `useSocket(onEvent)` (live `/user` events; filter by event-name prefix), `use-sheet-animation` (bottom-sheet enter/exit).

### 2.1 Component contract (mandatory)
1. Read theme via `const { colors, cardShadow } = useTheme();`.
2. Styles in `useMemo(() => StyleSheet.create({...}), [colors, cardShadow])`.
3. Accept a `style` override on the outermost element.
4. Semantic color tokens only; `fonts.*` for `fontFamily`, never raw `'Inter_…'` strings.
5. No hard-coded copy — every string through `t()` (§8).

```tsx
export function Foo({ title, style }: { title: string; style?: StyleProp<ViewStyle> }) {
  const { colors, cardShadow } = useTheme();
  const s = useMemo(() => StyleSheet.create({
    box: { backgroundColor: colors.card, padding: spacing.lg, borderRadius: radius.lg, ...cardShadow },
    title: { color: colors.text, fontFamily: fonts.semiBold, fontSize: 16 },
  }), [colors, cardShadow]);
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
| Forms | Formik + Yup (see `screens/auth/name.tsx`); build Yup schemas inside the component so messages follow the language |
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
- Large tap targets (≥44pt) — many users are traders with low digital comfort (scope NFRs).

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
- Montserrat has no Gujarati/Devanagari; use `scriptLineHeight` / `scriptTracking` from `lib/i18n/script.ts` for display text that may render in those scripts.

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
- Session safety: `lib/fresh-install.ts` wipes the keychain JWT on a reinstall (iOS keeps keychain items across uninstalls). Any new SecureStore key that must not outlive an install goes in its `SECURE_KEYS`.
- Visual work isn't done until it's run on a device/emulator in both themes.
- `CI=1 npx expo export --platform android` is a quick check that Metro can bundle the app.
