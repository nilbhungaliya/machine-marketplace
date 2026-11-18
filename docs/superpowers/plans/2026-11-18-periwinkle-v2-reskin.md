# Periwinkle v2 Re-skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. **Dispatch it batch by batch**: one implementer per batch does that batch's tasks in order, then the batch is reviewed before the next is dispatched. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user app and the admin panel look like the approved Periwinkle v2 mockup: v2 tokens (light and dark),
Manrope + JetBrains Mono, every existing component and screen restyled, the admin kit restyled, and guard tests that
keep colours in the palette files. No behaviour, copy, `testID` or analytics label changes.

**Architecture:** App: a pure `lib/palette.ts` (tokens + shadows, checked against the mockup's CSS variables by a test)
behind the existing `ThemeProvider` / `useTheme()`; a pure `lib/typography.ts` type scale with the Hindi / Gujarati
rules, read through `useType()`; v2 components in `components/`; a custom floating tab bar. Admin: `lib/palette.ts`
remaps Tailwind's `gray / brand / red / amber / green` to v2 values (so existing class names keep working), fonts
through `next/font`, class-only restyle of the kit. Both apps get a source audit test that fails on hard-coded colours.

**Tech Stack:** Expo SDK 54 / RN 0.81 (New Architecture, `boxShadow`), `react-native-svg` (installed),
`@expo-google-fonts/manrope`, `@expo-google-fonts/jetbrains-mono`, React Navigation 7 bottom tabs (custom `tabBar`),
Vitest, TypeScript compiler API (as `lib/i18n/audit.ts`); Next.js 14 + Tailwind 3 + cva, `next/font/google`.

**Spec:** `docs/superpowers/specs/2026-11-18-periwinkle-v2-reskin-design.md`. Read it before any task; § numbers refer
to it, R numbers to its rulings. **Keep the mockup open while building:**
`docs/mockups/user-app-mockup-periwinkle-v2.html` (`?only=onboarding`, `?only=account`, `?only=admin`, `&theme=dark`)
and its source `docs/mockups/src/build-periwinkle-v2.mjs` (CSS at lines 774–1375).

**Follows:** no textile plan: `E:\textile-marketplace` isn't on this machine, and textile has no matching re-skin
(spec, "Follows"). The task format follows `docs/superpowers/plans/2026-11-18-f1-a2-business-profile-verification.md`.

## Global Constraints

- **Work on `develop`** (no feature branch, no worktree). **Never commit or push**: the owner commits after review. Each
  task ends with "Stage" (list the files) instead of a commit.
- **Behaviour is frozen.** No change to navigation, validation, API calls, toasts' wording, analytics events, `testID`s,
  `phLabel`s or `ph-label`s (the one exception: ConfirmSheet's Pressables become `Button`s whose `phLabel` is the old
  `ph-label` value, spec §7.2). If a restyle seems to need a behaviour change, stop and note it in the batch report.
- **No copy changes.** No file under `apps/user-app/locales/` changes. The i18n parity and audit tests stay green.
- **Tokens only.** Colours come from `useTheme().colors` (app) or the palette classes (admin); type from `useType()` /
  `fonts.*`; radius from `radius.*`; shadows from `useTheme().shadows`. Never `fontWeight` in the app. The style audit
  (Task 3, Task 11) enforces it from Batch 1 on.
- **Component contract** (`apps/user-app/CLAUDE.md` §2.1): `useTheme()`, styles in `useMemo(() => StyleSheet.create(…),
  [colors, …])` (add the type function / language to the deps when using `useType()`), a `style` prop on the outer
  element, no copy.
- **Measurements:** take them from the spec's tables (§3, §5.4, §7, §10), which are already scaled (R1). Don't
  re-derive from the mockup's pixel values.
- **New app packages** only with `npx expo install <pkg>` run in `apps/user-app`, then `CI=1 npx expo install --check`.
  Removing: `pnpm --filter user-app remove <pkg>`.
- **Admin tests that assert class names** (`components/ui/form-dialog.test.tsx`, `components/businesses/business-detail.test.tsx`,
  `components/verification/review-detail.test.tsx`: `bg-brand-600`, `text-red-600`) must pass unchanged.
- **Every batch ends green:** `pnpm typecheck`, `pnpm lint`, `pnpm test`. Record the test counts in the batch report.
- Windows: Bash is Git Bash; paths in commands are relative to the repo root unless a step says `cd`.

## Review Focus

1. **Behaviour drift hidden in a restyle** (Batches 2–3): a screen's diff should touch styles, layout wrappers and
   component swaps only. Check that every `testID`, `phLabel`, `onPress`, `navigation.*` call and `t()` key is still
   there. ConfirmSheet's three layouts (two buttons, stacked with secondary, picks) still resolve the same values. (Tasks 5, 7–10.)
2. **OTP entry** (Task 4, Task 7): with OtpCells, SMS autofill (`sms-otp` / `oneTimeCode`), paste of a 6-digit code,
   Gujarati / Hindi digits and backspace all work as before, because the real `TextInput` is unchanged and only drawn
   differently.
3. **The floating tab bar covers nothing** (Tasks 6, 10): every tab screen pads by `useTabBarInset()`; the EmptyState
   CTA on Home is reachable; the bar hides with the keyboard.
4. **Dark mode and scripts** (all app tasks): no light-only colour (Skeleton, ConfirmSheet backdrop are fixed in Task
   3); Hindi / Gujarati titles use `typeStyle`'s line height and zero tracking.
5. **Admin pages untouched except classes** (Batch 4): no JSX structure, prop or handler change outside the kit; the
   class-name tests pass unchanged; no `blue` / `indigo` left.

---

## File map

```
apps/user-app/lib/palette.ts + palette.test.ts               tokens, TOKEN_SOURCE, shadows, mockup parity + contrast (Task 1)
apps/user-app/lib/ThemeContext.tsx, lib/theme.ts             theme provider on palette.ts; fonts, radius (Tasks 1, 2)
apps/user-app/lib/gst-flow.ts + gst-flow.test.ts             ChipTone ok/warn/danger/neutral (Task 1)
apps/user-app/lib/typography.ts + typography.test.ts         type scale + script rules (Task 2)
apps/user-app/hooks/use-type.ts                              useType() (Task 2)
apps/user-app/App.tsx, package.json                          Manrope + JetBrains Mono (Task 2); nav theme (Task 7)
apps/user-app/lib/style-audit.ts + style-audit.test.ts + style-audit-allowlist.json   (Task 3)
apps/user-app/components/{Skeleton,ConfirmSheet}.tsx, hooks/use-sheet-animation.ts, app.json   (Task 3)
apps/user-app/lib/otp-cells.ts + test, components/{Button,Input,Field,Chip,SegmentedControl,OtpCells}.tsx   (Task 4)
apps/user-app/components/{Card,ListRow,StatusChip,Notice,EmptyState,Skeleton,AppToast,ConfirmSheet,Steps}.tsx   (Task 5)
apps/user-app/lib/{tab-bar,side-token,split-value}.ts + tests, hooks/use-tab-bar-inset.ts   (Task 6)
apps/user-app/components/{IconButton,Header,FooterBar,SideToken,HeroGlow}.tsx, components/art/GearShot.tsx   (Task 6)
apps/user-app/navigation/{floating-tab-bar,tab-navigator}.tsx, lib/icons.ts, __mocks__/lucide-react-native.ts   (Task 6)
apps/user-app/screens/{welcome,auth/phone,auth/otp}.tsx                                    (Task 7)
apps/user-app/screens/onboarding/{your-business,where-are-you}.tsx                          (Task 8)
apps/user-app/screens/verification/*.tsx                                                    (Task 9)
apps/user-app/screens/{profile,tabs/*}.tsx                                                  (Task 10)
apps/admin/lib/palette.ts + palette.test.ts, tailwind.config.ts, app/globals.css, app/layout.tsx   (Task 11)
apps/admin/lib/style-audit.ts + style-audit.test.ts, the four `blue` sites                  (Task 11)
apps/admin/components/ui/*, components/{stat-card,status-badge,data-table,table-pagination,filter-kit,
  modal-backdrop,confirm-dialog,module-placeholder}.tsx, lib/status.ts, components/ui/field-classes.ts
  + the nine local inputCls files                                                            (Task 12)
apps/admin/app/(dashboard)/{layout,page}.tsx, components/layout/{sidebar,top-bar}.tsx,
  components/verification/{review-queue,review-detail}.tsx, components/catalog/{category-tree,node-details,
  fields-panel,side-settings-form,active-switch,brands-table,models-panel}.tsx               (Task 13)
apps/user-app/CLAUDE.md, apps/admin/CLAUDE.md, docs/mockups/README.md, docs/PROJECT_STATUS.md   (Task 15)
```

---

# Batch 1 — App foundation: tokens, fonts, type scale, colour guard

### Task 1: Palette, theme provider and token renames

**Files:**
- Create: `apps/user-app/lib/palette.ts`, `apps/user-app/lib/palette.test.ts`
- Modify: `apps/user-app/lib/ThemeContext.tsx`, `apps/user-app/lib/theme.ts` (re-exports + new `radius`),
  `apps/user-app/lib/gst-flow.ts`, `apps/user-app/lib/gst-flow.test.ts`, and every file that uses a removed token
  (found by typecheck: `components/*`, `screens/**`, `navigation/tab-navigator.tsx`, `App.tsx`)

**Interfaces:**
- Produces (`lib/palette.ts`, **no `react-native` import**, so Vitest can load it):
  - `export interface ThemeColors` with exactly: `background, surface, photo, field, text, textSecondary, textMuted,
    border, divider, hairline, primary, primaryInk, onPrimary, primarySoft, primaryWash, sun, onSun, ok, okSoft, warn,
    warnSoft, danger, dangerSoft, onDanger, star, heroGlow, scrim` (all `string`).
  - `export const lightColors: ThemeColors`, `export const darkColors: ThemeColors` — values from spec §4.1.
  - `export const TOKEN_SOURCE: Partial<Record<keyof ThemeColors, string>>` — token → mockup variable name without
    `--` (e.g. `background: 'canvas'`, `primaryWash: 'soft2'`, `heroGlow: 'tile-a'`); every token except `onDanger`.
  - `export const NOT_PORTED = ['page','tile-b','tile-c','tile-ink','bezel','frame','part-line','f','mono','shadow']`
    (`shadow` is consumed by `shadowValues`, not a colour token).
  - `export function shadowValues(isDark: boolean): { raised: string; float: string; segment: string }` — `boxShadow`
    strings from spec §4.3 (`0 2px 8px rgba(52,36,140,0.13)` etc.; dark uses `rgba(0,0,0,0.45)`, segment
    `rgba(0,0,0,0.5)`).
- Produces (`ThemeContext.tsx`): `useTheme()` returns `{ colors, isDark, mode, setMode, shadows }` where
  `shadows = { raised: { boxShadow }, float: { boxShadow }, segment: { boxShadow } }` (style objects, memoised on
  `isDark`). `getCardShadow`, `getPrimaryGlow`, `cardShadow`, `primaryGlow` are removed. `ThemeColors`, `lightColors`,
  `darkColors` are re-exported from `palette.ts` so existing imports keep working.
- Produces (`lib/theme.ts`): `radius = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, sheet: 28, full: 999 }` (spec §3).
- Produces (`lib/gst-flow.ts`): `ChipTone = 'ok' | 'warn' | 'danger' | 'neutral'` (`green→ok`, `orange→warn`,
  `red→danger`, `muted→neutral`).

- [ ] **Step 1: Record baselines.** Run `pnpm test` and note the counts per package (user app expected 162 tests / 19
  files on 2026-11-18) in the batch report.
- [ ] **Step 2: Write the failing test** `lib/palette.test.ts`:
  - A local `readMockupTokens()` reads `path.resolve(__dirname, '../../../docs/mockups/src/build-periwinkle-v2.mjs')`,
    finds every `:root{…}` and `[data-theme="dark"]{…}` block in file order (regex on the exact selectors with no space
    before `{`), splits each body on `;`, parses `--name:value`, and merges later blocks over earlier ones. Returns
    `{ light: Record<string,string>, dark: Record<string,string> }`.
  - For each `[token, varName]` of `TOKEN_SOURCE`: `norm(lightColors[token]) === norm(mockup.light[varName])` and the
    same for dark (`norm` = lower-case, spaces removed, `.45` and `0.45` treated alike by stripping a leading `0` before
    `.`).
  - Every mockup variable name is in `Object.values(TOKEN_SOURCE)` or `NOT_PORTED` (catches a new variable).
  - `Object.keys(lightColors).sort()` equals `Object.keys(darkColors).sort()`.
  - Contrast (a local `contrast(a, b)` with the WCAG relative-luminance formula, hex only): ≥ 4.5 for `text` and
    `textSecondary` on `background`, `surface`, `field`; `onPrimary`/`primary`; `onSun`/`sun`; `onDanger`/`danger`;
    `primaryInk` on `primaryWash` and `primarySoft` — in both themes. ≥ 3 for `textMuted` on `surface` and
    `background`, and `ok`/`okSoft`, `warn`/`warnSoft`, `danger`/`dangerSoft` (R15; add a comment pointing to it).
  - `shadowValues(false).float === '0 8px 22px rgba(52,36,140,0.13)'`.
- [ ] **Step 3:** Run `pnpm --filter user-app exec vitest run lib/palette.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `palette.ts`; rewrite `ThemeContext.tsx` on it (provider, storage key and `mode` logic
  unchanged); update `theme.ts` `radius`.
- [ ] **Step 5:** Run the palette test. Expected: PASS.
- [ ] **Step 6: Update `gst-flow.test.ts`** to the new `ChipTone` names (red), then `gst-flow.ts` (green). Run
  `pnpm --filter user-app exec vitest run lib/gst-flow.test.ts`. Expected: PASS.
- [ ] **Step 7: Rename call sites** with spec §4.2's table: `colors.card→surface`, `elevated→field`,
  `borderLight→divider`, `primaryLight→primarySoft`, `primaryMuted→primaryWash`, `primaryDark→primaryInk`,
  `focusFill→surface`, `white→onDanger`, `green→ok`, `greenMuted→okSoft`, `red→danger`, `redMuted→dangerSoft`,
  `orange→warn`, `orangeMuted→warnSoft`, `blue→primaryInk`, `blueMuted→primaryWash`; `cardShadow` →
  `shadows.raised` (destructure `shadows` instead, fix the `useMemo` deps); `primaryGlow` → delete its use in
  `Button.tsx`; `toneColor` in `screens/profile.tsx` keys follow `ChipTone`. Use the typecheck output as the to-do
  list: `pnpm --filter user-app typecheck`. Change only token names here; restyling is Batches 2–3.
- [ ] **Step 8:** `pnpm --filter user-app typecheck` and `pnpm --filter user-app test`. Expected: both green.
- [ ] **Step 9: Stage** `lib/palette.ts`, `lib/palette.test.ts`, `lib/ThemeContext.tsx`, `lib/theme.ts`,
  `lib/gst-flow.ts`, `lib/gst-flow.test.ts` and every renamed file.

---

### Task 2: Fonts and the type scale

**Files:**
- Create: `apps/user-app/lib/typography.ts`, `apps/user-app/lib/typography.test.ts`, `apps/user-app/hooks/use-type.ts`
- Modify: `apps/user-app/package.json` (via the commands below), `apps/user-app/App.tsx`, `apps/user-app/lib/theme.ts`
  (`fonts`), every file using `fonts.display*` (typecheck finds them)

**Interfaces:**
- Produces (`lib/theme.ts`): `fonts = { regular: 'Manrope_400Regular', medium: 'Manrope_500Medium', semiBold:
  'Manrope_600SemiBold', bold: 'Manrope_700Bold', extraBold: 'Manrope_800ExtraBold', mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium' }`. `display`, `displaySemi`, `displayHeavy` removed.
- Produces (`lib/typography.ts`, pure; imports only `fonts` values as string constants and `scriptLineHeight` /
  `scriptTracking` / `usesIndicScript` from `./i18n/script`, never `react-native`):
  - `export type TypeToken = 'display' | 'title' | 'sheetTitle' | 'appBar' | 'section' | 'cardTitle' | 'lead' | 'body'
    | 'bodyStrong' | 'fieldValue' | 'label' | 'caption' | 'button' | 'buttonSm' | 'chip' | 'badge' | 'price' | 'otp' |
    'phone' | 'mono'`.
  - `export const TYPE_SCALE: Record<TypeToken, { family: keyof typeof fonts; size: number; lineHeight: number;
    tracking: number; tabular?: boolean }>` — the table in spec §5.4.
  - `export function typeStyle(token: TypeToken, lang: Language): { fontFamily: string; fontSize: number; lineHeight:
    number; letterSpacing: number; fontVariant?: ['tabular-nums'] }` — applies `scriptLineHeight`, `scriptTracking`,
    and in hi/gu maps `extraBold` → `bold` (spec §5.3). Mono families are never changed by script.
- Produces (`hooks/use-type.ts`): `useType(): (token: TypeToken) => ReturnType<typeof typeStyle>`, bound to
  `useLanguage()`, memoised on the language.

- [ ] **Step 1: Packages.** `cd apps/user-app && npx expo install @expo-google-fonts/manrope @expo-google-fonts/jetbrains-mono`,
  then `pnpm --filter user-app remove @expo-google-fonts/montserrat @expo-google-fonts/inter`, then
  `cd apps/user-app && CI=1 npx expo install --check`. Expected: no mismatch.
- [ ] **Step 2: Write the failing test** `lib/typography.test.ts`: `typeStyle('title','en')` →
  `{ fontFamily: 'Manrope_700Bold', fontSize: 26, lineHeight: 30, letterSpacing: -0.8 }`; `typeStyle('title','hi')` →
  `lineHeight 38` (round(26 × 1.45)), `letterSpacing 0`; `typeStyle('display','gu').fontFamily === 'Manrope_700Bold'`
  (800 → 700) and `typeStyle('display','en').fontFamily === 'Manrope_800ExtraBold'`; `typeStyle('mono','hi').fontFamily
  === 'JetBrainsMono_500Medium'`; `typeStyle('price','en').fontVariant` is `['tabular-nums']`; `typeStyle('body','en')`
  is 15 / 22; every `TYPE_SCALE` entry's `family` is a key of `fonts`.
- [ ] **Step 3:** Run `pnpm --filter user-app exec vitest run lib/typography.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `typography.ts`, `use-type.ts`, the new `fonts`; in `App.tsx` load `Manrope_400Regular`,
  `Manrope_500Medium`, `Manrope_600SemiBold`, `Manrope_700Bold`, `Manrope_800ExtraBold`, `JetBrainsMono_400Regular`,
  `JetBrainsMono_500Medium` in `useFonts` (imports from the two new packages; the splash and boot logic unchanged).
- [ ] **Step 5: Rename** `fonts.display → fonts.bold`, `fonts.displaySemi → fonts.semiBold`, `fonts.displayHeavy →
  fonts.extraBold` wherever typecheck reports them.
- [ ] **Step 6:** Run the typography test (PASS), `pnpm --filter user-app typecheck`, `pnpm --filter user-app test`.
- [ ] **Step 7: Stage** `package.json`, the lockfile (`pnpm-lock.yaml`), `App.tsx`, `lib/theme.ts`,
  `lib/typography.ts`, `lib/typography.test.ts`, `hooks/use-type.ts` and the renamed files.

---

### Task 3: Style audit (no hard-coded colours) and the two existing offenders

**Files:**
- Create: `apps/user-app/lib/style-audit.ts`, `apps/user-app/lib/style-audit.test.ts`,
  `apps/user-app/lib/style-audit-allowlist.json`
- Modify: `apps/user-app/components/Skeleton.tsx`, `apps/user-app/components/ConfirmSheet.tsx` (backdrop only),
  `apps/user-app/hooks/use-sheet-animation.ts` (backdrop output range), `apps/user-app/app.json`

**Interfaces:**
- Produces: `export type StyleFinding = { file: string; line: number; rule: 'hex' | 'rgb' | 'named-colour' | 'font-weight'
  | 'font-family-literal'; text: string }`; `export function auditStyles(file: string, source: string): StyleFinding[]`
  using the TypeScript compiler API (`ts.createSourceFile`, walk string literals, no-substitution templates, template
  spans, property assignments and JSX attributes), as `lib/i18n/audit.ts` does.
- Rules (spec §11.2): `hex` — a string containing `#` + 3, 4, 6 or 8 hex digits on a word boundary; `rgb` — `rgb(`,
  `rgba(`, `hsl(`, `hsla(`; `named-colour` — a CSS named colour (list in the file; `transparent` and `currentColor`
  allowed) as the value of a property or JSX attribute whose name is `color` or ends in `Color`; `font-weight` — any
  property named `fontWeight`; `font-family-literal` — a `fontFamily` property whose value is a string literal.
- Allowlist JSON: `[{ "path": "lib/palette.ts", "reason": "The palette: the only place colour values live." },
  { "path": "components/art/", "reason": "Illustration materials (metal, shadow) in product-shot art, not theme colours." }]`
  (a `path` ending in `/` covers the folder).

- [ ] **Step 1: Write the failing test** `lib/style-audit.test.ts`. Fixture cases: `{ color: '#fff' }` → hex;
  `backgroundColor: 'rgba(0,0,0,.5)'` → rgb; `<Icon color="white" />` → named-colour; `{ borderColor: 'transparent' }`
  → none; `{ fontWeight: '700' }` → font-weight; `{ fontFamily: 'Inter_400Regular' }` → font-family-literal;
  `{ fontFamily: fonts.bold }` → none; `const id = 'abc#123'` → none (no word boundary hex colour: `#123` after a
  letter still counts? keep it simple: only flag when the whole string is a colour or the colour starts the string or
  follows a space/`(`/`,`); a comment `// #fff` → none. Repo case: scan every `.ts`/`.tsx` under `apps/user-app`
  except `node_modules`, `__mocks__`, `*.test.ts` and allowlisted paths; expect `[]` (print the findings on failure,
  as the i18n audit does).
- [ ] **Step 2:** Run `pnpm --filter user-app exec vitest run lib/style-audit.test.ts`. Expected: the fixture cases
  FAIL (module missing).
- [ ] **Step 3: Implement** `style-audit.ts`. Run again: fixtures PASS, the repo case FAILS on
  `components/Skeleton.tsx` (`#ebe9f0`) and `components/ConfirmSheet.tsx` (`#000`).
- [ ] **Step 4: Fix them:** Skeleton reads `useTheme()` and uses `colors.field`, `radius.md`. ConfirmSheet's backdrop
  uses `colors.scrim`, and `use-sheet-animation.ts` changes the backdrop interpolation `outputRange` from `[0, 0.5]` to
  `[0, 1]` (the scrim colour carries its own alpha). Nothing else in ConfirmSheet changes yet (Task 5).
- [ ] **Step 5: `app.json`** (config, not scanned): splash `backgroundColor` `#F5F4FA`, dark `#110F1F`; Android
  `adaptiveIcon.backgroundColor` `#5B41E6` (spec §8, R21).
- [ ] **Step 6:** `pnpm --filter user-app test` (all green, including the repo audit) and `pnpm --filter user-app typecheck`.
- [ ] **Step 7: Stage** the three new files, `Skeleton.tsx`, `ConfirmSheet.tsx`, `use-sheet-animation.ts`, `app.json`.

**Batch 1 exit:** `pnpm typecheck`, `pnpm lint`, `pnpm test` green; `cd apps/user-app && CI=1 npx expo export
--platform android` bundles. The app now runs in v2 colours and Manrope with old layouts; that's expected.

---

# Batch 2 — App components and the tab bar

Each component: follow spec §7's row exactly, use `useType()` for text, keep current props and add only the props the
spec names. Components with no logic have no unit test; the style audit and typecheck cover them, and Batch 3 puts them
on screens.

### Task 4: Controls — Button, Input, Field, Chip, SegmentedControl, OtpCells

**Files:**
- Create: `apps/user-app/components/Field.tsx`, `apps/user-app/components/SegmentedControl.tsx`,
  `apps/user-app/components/OtpCells.tsx`, `apps/user-app/lib/otp-cells.ts`, `apps/user-app/lib/otp-cells.test.ts`
- Modify: `apps/user-app/components/Button.tsx`, `apps/user-app/components/Input.tsx`, `apps/user-app/components/Chip.tsx`

**Interfaces:**
- `Button` props add `variant: 'primary' | 'outline' | 'ghost' | 'danger'` (default `primary`), `size?: 'lg' | 'md' |
  'sm'` (default `lg`), `icon?: LucideIcon`. Existing props unchanged.
- `Input` props add `prefix?: string`, `size?: 'md' | 'lg'`, `mono?: boolean`. Label and error rendering shared with
  `Field` (export a small `FieldLabel` / `FieldError` from `Field.tsx` or keep the styles in one module).
- `Field({ label?, hint?, error?, children, style })`.
- `SegmentedControl<T extends string>({ options: { value: T; label: string; testID: string }[]; value: T; onChange:
  (v: T) => void; accessibilityLabel?: string; style? })`.
- `lib/otp-cells.ts`: `otpCells(raw: string, length: number): { char: string; state: 'filled' | 'current' | 'empty' }[]`
  (digits from `otpFieldState(raw, length).digits`; the first empty cell is `current`; when all are filled the last is
  `current`).
- `OtpCells({ value, onChangeText, length, error?, onSubmitEditing?, autoFocus?, testID?, accessibilityLabel, style })`:
  one real `TextInput` (absolute over the row, `opacity` near 0, `caretHidden`, `keyboardType="number-pad"`,
  `autoComplete="sms-otp"`, `textContentType="oneTimeCode"`, `maxLength={length + 4}` so a pasted code with spaces
  isn't cut) plus `length` cells drawn from `otpCells`.

- [ ] **Step 1: Failing test** `lib/otp-cells.test.ts`: `otpCells('', 6)` → first `current`, five `empty`;
  `otpCells('48', 6)` → `filled, filled, current, empty, empty, empty` with chars `4`, `8`; `otpCells('४८१', 6)`
  (Devanagari digits) → chars `4`, `8`, `1`; `otpCells('481936', 6)` → all `filled` except the last `current`;
  `otpCells('48 19', 6)` → four filled (spaces ignored).
- [ ] **Step 2:** Run it. Expected: FAIL. **Step 3:** Implement `otp-cells.ts`. **Step 4:** PASS.
- [ ] **Step 5: Restyle / build** Button, Input, Field, Chip, SegmentedControl, OtpCells per spec §7.1.
- [ ] **Step 6:** `pnpm --filter user-app typecheck` and `pnpm --filter user-app test`.
- [ ] **Step 7: Stage** the files above.

---

### Task 5: Surfaces and feedback — Card, ListRow, StatusChip, Notice, EmptyState, Skeleton, AppToast, ConfirmSheet, Steps

**Files:**
- Create: `apps/user-app/components/{Card,ListRow,StatusChip,Steps}.tsx`
- Modify: `apps/user-app/components/{Notice,EmptyState,Skeleton,AppToast,ConfirmSheet}.tsx`

**Interfaces:**
- `Card({ children, padding?: number; flush?: boolean; style? })`.
- `ListRow({ label, hint?, icon?: LucideIcon, trailing?: ReactNode, chevron?: boolean, selected?: boolean, last?:
  boolean, onPress?, disabled?, testID?, accessibilityRole?, accessibilityState?, style? })`.
- `StatusChip({ label, tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'new' | 'sun', icon?: LucideIcon, style? })`.
- `Steps({ current, total, label, style? })` — `label` is the already-translated step text.
- ConfirmSheet: same exported API (`ConfirmSheetProvider`, `useConfirm`, `useChoice`); its Pressables become `Button`s
  with `phLabel` = the old `ph-label` (`Confirm-sheet-confirm`, `Confirm-sheet-secondary`, `Confirm-sheet-dismiss`;
  the two-button row's cancel and confirm, which had no label, get `Confirm-sheet-cancel` / `Confirm-sheet-confirm`).
  The picks keep `ph-label="Confirm-sheet-pick"`.

- [ ] **Step 1:** Build Card, ListRow, StatusChip, Steps; restyle Notice, EmptyState, Skeleton (default radius
  `md`), AppToast (remove the stale "yellow" comment), ConfirmSheet — all per spec §7.2.
- [ ] **Step 2:** `components/confirm-manager.test.ts` and `components/toast-handoff.test.ts` still pass unchanged
  (the sheet's logic didn't move): `pnpm --filter user-app test`.
- [ ] **Step 3:** `pnpm --filter user-app typecheck`.
- [ ] **Step 4: Stage** the files above.

---

### Task 6: Chrome and brand art — IconButton, Header, FooterBar, floating tab bar, SideToken, HeroGlow, GearShot

**Files:**
- Create: `apps/user-app/components/{IconButton,FooterBar,SideToken,HeroGlow}.tsx`,
  `apps/user-app/components/art/GearShot.tsx`, `apps/user-app/navigation/floating-tab-bar.tsx`,
  `apps/user-app/hooks/use-tab-bar-inset.ts`, `apps/user-app/lib/{tab-bar,side-token,split-value}.ts` and their
  `*.test.ts`
- Modify: `apps/user-app/components/Header.tsx`, `apps/user-app/navigation/tab-navigator.tsx`,
  `apps/user-app/lib/icons.ts` (add `Plus`; `TAB_ICONS.post = Plus`), `apps/user-app/__mocks__/lucide-react-native.ts`
  (add `Plus`)

**Interfaces:**
- `lib/tab-bar.ts`: `TAB_BAR_HEIGHT = 68`, `TAB_BAR_GAP = 12`, `tabBarInset(bottomInset: number): number` =
  `TAB_BAR_HEIGHT + TAB_BAR_GAP + bottomInset + 8`. `hooks/use-tab-bar-inset.ts`: `useTabBarInset()` =
  `tabBarInset(useSafeAreaInsets().bottom)`.
- `lib/side-token.ts`: `type SideKind = 'left' | 'right' | 'pair' | 'want-left' | 'want-right' | 'none'`;
  `type HalfState = 'on' | 'off' | 'have' | 'need'`; `sideHalves(kind): { left: HalfState; right: HalfState }` (spec §7.6).
- `lib/split-value.ts`: `splitOnValue(text: string, value: string): [string, string, string] | null`.
- `IconButton({ icon: LucideIcon; onPress; accessibilityLabel: string; testID: string; variant?: 'raised' | 'outline'
  | 'primary'; style? })`.
- `FooterBar({ children, style? })`.
- `SideToken({ kind: SideKind; size?: 'md' | 'lg' | 'xl'; style? })` (no label).
- `HeroGlow({ style? })` (absolute fill), `GearShot({ size?: number; style? })` (default 172).
- `navigation/floating-tab-bar.tsx`: `FloatingTabBar(props: BottomTabBarProps)`; the standard React Navigation custom
  bar loop (`tabPress` event with `canPreventDefault`, navigate when not focused and not prevented; `tabLongPress`),
  `accessibilityRole="tab"`, `accessibilityState={{ selected }}`, `accessibilityLabel` = the screen's
  `tabBarAccessibilityLabel`, `testID` = `options.tabBarButtonTestID`; hides on `keyboardDidShow`, shows on
  `keyboardDidHide`.
- `tab-navigator.tsx`: `tabBar={(p) => <FloatingTabBar {...p} />}`; each screen's options:
  `tabBarAccessibilityLabel: t('nav.tabs.<tab>')`, `tabBarButtonTestID: 'Tab-<tab>'` (`home`, `search`, `post`,
  `chats`, `deals`), `tabBarIcon` as now. `tabBarLabel` stays (unused by the custom bar, kept for R9's flag).

- [ ] **Step 1: Failing tests:** `tab-bar.test.ts` (`tabBarInset(0) === 88`, `tabBarInset(24) === 112`);
  `side-token.test.ts` (all six kinds, spec §7.6); `split-value.test.ts` (`splitOnValue('GSTIN: 24AAKFS4821M1Z6',
  '24AAKFS4821M1Z6')` → `['GSTIN: ', '24AAKFS4821M1Z6', '']`; a Gujarati sentence with the value in the middle; value
  absent → `null`; empty value → `null`).
- [ ] **Step 2:** Run them. Expected: FAIL. **Step 3:** Implement the three `lib/` files. **Step 4:** PASS.
- [ ] **Step 5: Build** IconButton, FooterBar, the restyled Header (back = IconButton; keep `ph-label="Back-button"` on
  the pressable), SideToken, HeroGlow (`react-native-svg` `Svg` + `Defs` + `RadialGradient` with `cx="0" cy="0"
  rx="120%" ry="70%"`, stops `heroGlow` → `background` at 0.7, colours from `useTheme()`), GearShot (port
  `PARTS.gear`, the `gearPath` generator and the `g-steel` / `g-sh` gradients from the mockup source lines 54–76 and
  149–163; sweep from `colors.surface` to `colors.photo`).
- [ ] **Step 6: Build** `FloatingTabBar`, wire it in `tab-navigator.tsx`, add `Plus` to icons and the mock.
- [ ] **Step 7:** `pnpm --filter user-app test` (the repo style audit must accept `components/art/GearShot.tsx` through
  the allowlist and nothing else), `pnpm --filter user-app typecheck`.
- [ ] **Step 8: Stage** the files above.

**Batch 2 exit:** `pnpm typecheck`, `pnpm lint`, `pnpm test` green; `CI=1 npx expo export --platform android`
bundles. Report any spec measurement that didn't work in practice.

---

# Batch 3 — App screens

For every screen: swap hand-rolled pieces for the kit (spec §8, first paragraph), apply the screen's row in spec §8,
content padding x `spacing.lg`, bottom actions in `FooterBar` with `Button size="md"`, text through `useType()`. The
screen diff must keep every `testID`, `phLabel`, handler, query and `t()` key (Review Focus 1).

### Task 7: Welcome, Phone, OTP and the app shell

**Files:** Modify `apps/user-app/screens/welcome.tsx`, `apps/user-app/screens/auth/phone.tsx`,
`apps/user-app/screens/auth/otp.tsx`, `apps/user-app/App.tsx` (navigation theme only).

- [ ] **Step 1: Welcome** per spec §8 (HeroGlow, GearShot, SideToken `xl` `want-right`, `display` + `lead`, primary
  Button with `phLabel="Get-started"` under the copy).
- [ ] **Step 2: Phone:** `Input size="lg" prefix="+91"` (same `value`, `onChangeText`, `maxLength`, `autoComplete`,
  `textContentType`); safe line; FooterBar.
- [ ] **Step 3: OTP:** `OtpCells` with `length={OTP_LENGTH}`, `value={code}`, `onChangeText={setCode}`,
  `error={error}` (message under the cells in `caption` `danger`), `onSubmitEditing={verify}`, `autoFocus`,
  `accessibilityLabel={t('auth.otp.label')}`; dev-code line; resend link; FooterBar.
- [ ] **Step 4: App shell** navigation theme per spec §8.
- [ ] **Step 5:** `pnpm --filter user-app test` and `pnpm --filter user-app typecheck`. **Step 6: Stage** the four files.

---

### Task 8: Onboarding — Your business, Where are you

**Files:** Modify `apps/user-app/screens/onboarding/your-business.tsx`,
`apps/user-app/screens/onboarding/where-are-you.tsx` (`location-map.tsx` only receives a radius through its `style`).

- [ ] **Step 1: Your business** per spec §8: Steps(1, 2, `t('onboarding.step', …)`), Field for the two chip groups
  (their existing hints and list errors), locked-name read-only field + StatusChip `ok`, FooterBar. Skeleton state uses
  the restyled Skeleton.
- [ ] **Step 2: Where are you** per spec §8: Steps(2, 2), map box, location `Button outline` with `LocateFixed` (title
  switches while locating; `disabled={locating}`), pin row, `Notice tone="warning"` for the unknown pincode, Inputs,
  area `Field` + `Card flush` + `ListRow`s (selected, "Other" last, the empty-search row as a non-pressable ListRow
  with a `Search` icon), address Input, FooterBar.
- [ ] **Step 3:** `pnpm --filter user-app exec vitest run lib/onboarding-step.test.ts` (logic untouched), full
  `pnpm --filter user-app test`, typecheck. **Step 4: Stage** both files.

---

### Task 9: Verification screens

**Files:** Modify `apps/user-app/screens/verification/{gst-intro,gst-start,gst-found,gst-details-card,gst-declare,gst-code,gst-review-form,document-picker,gst-status,gst-load-state}.tsx`.

- [ ] **Step 1:** Restyle each per spec §8. GSTIN inputs `mono`; `gst-details-card` uses `Card`, StatusChip `ok`, and
  `splitOnValue(t('verification.details.gstin', { gstin }), gstin)` to render the GSTIN as the mono tag (falls back to
  the plain sentence when `null`); `gst-declare` checkbox as a choice card; `gst-code` keeps one `Input size="lg"`;
  document tiles and the add tile as spec §8; `gst-status` uses `StatusChip` with `gstChip(state).tone`.
- [ ] **Step 2:** `pnpm --filter user-app exec vitest run lib/gst-flow.test.ts`, full test run, typecheck.
- [ ] **Step 3: Stage** the ten files.

---

### Task 10: Profile and the tab screens

**Files:** Modify `apps/user-app/screens/profile.tsx`, `apps/user-app/screens/tabs/{home,search,post,chats,deals}.tsx`.

- [ ] **Step 1: Profile** per spec §8 (R11): head, meter Card, rows `Card flush` + `ListRow` (testIDs
  `Profile-row-*`, `Complete-*`, `Retry-business` unchanged), language ListRows (`Language-*`, role `radio`,
  `selected`), Appearance `SegmentedControl` with options `{ value: m, label: t(THEME_KEY[m]), testID: 'Theme-' + m }`,
  log-out Button `outline` (`phLabel="Log-out"`).
- [ ] **Step 2: Home** per spec §8 (R12): avatar IconButton (`testID="Open-profile"`, `accessibilityLabel` from an
  existing key — `t('profile.title')`), search bar (`testID="Open-search"`), category Chips (`testID` `Category-*`),
  bottom padding `useTabBarInset()`.
- [ ] **Step 3: Post, Search, Chats, Deals** per spec §8; each pads its bottom with `useTabBarInset()`.
- [ ] **Step 4:** Full `pnpm --filter user-app test` (style audit, i18n parity and audit included), typecheck.
- [ ] **Step 5: Stage** the six files.

**Batch 3 exit:** `pnpm typecheck`, `pnpm lint`, `pnpm test` green; `cd apps/user-app && CI=1 npx expo export
--platform android` bundles; `git diff --stat -- apps/user-app/locales` is empty. Note in the report anything on a
screen that had no mockup counterpart and how it was styled.

---

# Batch 4 — Admin

### Task 11: Admin palette, fonts and guards

**Files:**
- Create: `apps/admin/lib/palette.ts`, `apps/admin/lib/palette.test.ts`, `apps/admin/lib/style-audit.ts`,
  `apps/admin/lib/style-audit.test.ts`
- Modify: `apps/admin/tailwind.config.ts`, `apps/admin/app/globals.css`, `apps/admin/app/layout.tsx`,
  `apps/admin/lib/status.ts` (`blue` tone classes), `apps/admin/components/catalog/active-switch.tsx`,
  `apps/admin/components/catalog/fields-panel.tsx`, `apps/admin/app/(dashboard)/listing-fields/page.tsx`

**Interfaces:**
- `lib/palette.ts`: `export const colors = { gray: {50…950}, brand: {50…950}, red: {…}, amber: {…}, green: {…},
  sun: { DEFAULT: '#FFD52E', ink: '#1C1A27' }, photo: '#ECEBF1', scrim: 'rgb(28 20 70 / 0.45)' }` (spec §4.4);
  `export const ANCHORS: Array<[path: string, mockupVar: string]>` (e.g. `['gray.50', 'canvas']`, `['brand.600',
  'primary']`, `['red.50', 'danger-soft']`, `['sun.DEFAULT', 'sun']`) — the first table of §4.4, light column.
- `tailwind.config.ts`: `import { colors } from './lib/palette'`; `theme.extend.colors = colors` (replaces `brand` and
  `side`); `fontFamily.sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif']`, `fontFamily.mono:
  ['var(--font-mono)', 'ui-monospace', 'Consolas', 'monospace']`.
- `app/layout.tsx`: `Manrope` and `JetBrains_Mono` from `next/font/google` (spec §10.1), both variables on `<html>`.
- `lib/style-audit.ts`: `auditClasses(file: string, source: string): { file; line; rule: 'hex' | 'rgb' |
  'arbitrary-colour' | 'off-palette'; text }[]` (regex over the source text is enough here: Tailwind classes are plain
  strings), rules in spec §11.2; exemptions: `lib/palette.ts`; `components/ui/tabs.tsx` for the one
  `shadow-[0_1px_3px_rgb(28_20_70/0.14)]`.

- [ ] **Step 1: Record** the admin test count (`pnpm --filter admin test`).
- [ ] **Step 2: Failing tests.** `lib/palette.test.ts`: the same mockup reader as the app's (copy it; ~20 lines);
  every `ANCHORS` entry resolves (dot path into `colors`) to the mockup's light value; `colors.gray[500]` on white ≥ 4.5
  : 1 (description text). `lib/style-audit.test.ts`: fixtures (`'bg-blue-50'` → off-palette, `'text-[#123456]'` →
  arbitrary-colour, `"style={{ color: '#fff' }}"` → hex, `'bg-brand-600 text-white'` → none, `'bg-black/80'` → none)
  and the repo case over `app/`, `components/`, `lib/` expecting `[]`.
- [ ] **Step 3:** `pnpm --filter admin exec vitest run lib/palette.test.ts lib/style-audit.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `palette.ts`, `style-audit.ts`, the Tailwind config, fonts, `globals.css` (body
  `bg-gray-50 text-gray-900`, focus ring `theme('colors.brand.600')`, form controls' focus ring and border
  `brand.600`).
- [ ] **Step 5:** Run them: palette PASS; style audit's repo case FAILS on the four `blue` sites. Move them to
  `bg-brand-50 text-brand-700`. PASS.
- [ ] **Step 6:** `pnpm --filter admin typecheck`, `pnpm --filter admin lint`, `pnpm --filter admin test` (all prior
  tests unchanged and green), `pnpm --filter admin build`.
- [ ] **Step 7: Stage** the files above.

---

### Task 12: Admin kit restyle

**Files:**
- Create: `apps/admin/components/ui/field-classes.ts`
- Modify: `apps/admin/components/ui/{button,states,panel,page-header,tabs,record-tabs,dialog,form-dialog,reason-dialog,stale-warning}.tsx`,
  `apps/admin/components/{stat-card,status-badge,data-table,table-pagination,filter-kit,modal-backdrop,confirm-dialog,module-placeholder}.tsx`,
  `apps/admin/lib/status.ts`, and the nine files with a local `inputCls` (`components/catalog/{brand-form-dialog,field-form-dialog,keyed-list-editor,model-form-dialog,node-form-dialog,options-editor}.tsx`,
  `components/industrial-areas/areas-list.tsx`, `components/verification/approve-dialog.tsx`; `fields-panel.tsx` if it
  has one)

**Interfaces:**
- `field-classes.ts`: `export const inputCls`, `labelCls`, `errorCls`, `checkCls` (spec §10.2). The local constants are
  deleted and these imported; where a local file adds `font-mono`, it keeps doing so (`${inputCls} font-mono`).

- [ ] **Step 1:** Restyle each kit piece per spec §10.2 — **class strings only**: no prop, JSX structure, handler or
  ARIA change. Keep the class names the tests check (`bg-brand-600` on primary, `text-red-600` on danger).
- [ ] **Step 2:** Replace the nine local field-class constants with imports.
- [ ] **Step 3:** `pnpm --filter admin test` (every existing test passes unchanged, including `dialog.test.tsx`,
  `form-dialog.test.tsx`, `tabs.test.tsx`, `data-table.test.tsx`), `pnpm --filter admin lint`, `pnpm --filter admin typecheck`.
- [ ] **Step 4: Stage** the files above.

---

### Task 13: Admin shell and the mockup-mapped pages

**Files:** Modify `apps/admin/app/(dashboard)/layout.tsx` (shell classes + Toaster options),
`apps/admin/app/(dashboard)/page.tsx`, `apps/admin/components/layout/{sidebar,top-bar}.tsx`,
`apps/admin/components/verification/{review-queue,review-detail}.tsx`,
`apps/admin/components/catalog/{category-tree,node-details,fields-panel,side-settings-form,active-switch,brands-table,models-panel}.tsx`.

- [ ] **Step 1: Shell, Sidebar, TopBar, Toaster** per spec §10.2 (R14: the sidebar lockup is a CSS L | R mark +
  "Machine Parts" + a `bg-sun text-sun-ink` "Admin" pill; `metadata.title` stays "MPM Admin"). Sidebar behaviour
  (collapse, group folding, badges, role filter, `aria-*`) unchanged.
- [ ] **Step 2: Pages** per spec §10.3: dashboard card; review queue and detail (selected row, specs table, actions);
  category tree selected row, node-details / fields-panel / brands / models local `Pill` / `Badge` / `Tag` tones,
  side switch. Class-only.
- [ ] **Step 3:** `pnpm --filter admin test`, `lint`, `typecheck`, `build`.
- [ ] **Step 4: Visual check** (spec §12.4): `pnpm infra:up`, `pnpm dev:api`, `pnpm dev:admin`; sign in with the seed
  admin; compare Dashboard, Business verification (a review open; create one with `GST_PROVIDER=off` if the queue is
  empty, or note that it was empty), and Categories & machine types (a part-group node selected) with
  `docs/mockups/user-app-mockup-periwinkle-v2.html?only=admin`. Also open Users & businesses, Industrial areas, Brands &
  models and one dialog. If a browser tool is available, take screenshots and attach their paths to the report;
  otherwise list the pages for the owner.
- [ ] **Step 5: Stage** the files above.

**Batch 4 exit:** `pnpm typecheck`, `pnpm lint`, `pnpm test` green; `pnpm --filter admin build` passes.

---

# Batch 5 — Verification and docs

### Task 14: Whole-build verification

- [ ] **Step 1:** `pnpm typecheck`, `pnpm lint`, `pnpm test` — all green; record counts against the Batch 1 baselines
  (new tests: app palette, typography, style audit, otp-cells, tab-bar, side-token, split-value; admin palette, style
  audit).
- [ ] **Step 2:** `cd apps/user-app && CI=1 npx expo install --check && CI=1 npx expo export --platform android`.
  Expected: clean, bundles (delete the generated `dist/` afterwards; it's gitignored anyway).
- [ ] **Step 3:** `pnpm --filter admin build`.
- [ ] **Step 4: Frozen-behaviour audit.** `git diff -- apps/user-app/locales` is empty. For each changed screen and
  component, list the `testID` / `phLabel` / `ph-label` values before and after
  (`git diff develop -- apps/user-app | grep -E '^[-+].*(testID|phLabel|ph-label)='`) and confirm the only changes are
  the ConfirmSheet ones in Global Constraints and the new `Tab-*` IDs. `git diff -- apps/api packages` is empty.
- [ ] **Step 5: Owner's checklist.** Copy spec §12.3 into the final report as the owner's device check (English light
  and dark full pass; Hindi light; Gujarati dark), with the §5.3 contingency trigger called out.

### Task 15: Docs

**Files:** Modify `apps/user-app/CLAUDE.md`, `apps/admin/CLAUDE.md`, `docs/mockups/README.md`, `docs/PROJECT_STATUS.md`.

- [ ] **Step 1: `apps/user-app/CLAUDE.md`:** scope line (Manrope + JetBrains Mono, Periwinkle v2); §1.1 (`lib/palette.ts`
  is where colour values live; `ThemeContext.tsx` provides them); §1.2 (`fonts` with Manrope / JetBrains Mono,
  `radius` new values, the type scale in `lib/typography.ts` via `useType()` replacing "round Figma sizes"); §1.3 (v2
  token list and the restraint rules of spec §6; replace the indigo sentence); §1.4 (`shadows.raised / float /
  segment`, cards use hairline borders; remove `cardShadow` / `primaryGlow`); §2 components table (add Card, ListRow,
  StatusChip, SegmentedControl, OtpCells, Steps, IconButton, FooterBar, Field, SideToken, HeroGlow, art/GearShot; new
  Button variants and sizes; Input `prefix` / `size` / `mono`; the floating tab bar and `useTabBarInset()`); §2.1
  example updated to `shadows` + `useType()`; §6 add "never `fontWeight`; the style audit fails on hard-coded colours";
  §8.1 replace the Montserrat note with the script rules (system fallback, R6, and where the contingency lives);
  §10 mention `lib/style-audit.test.ts` and `lib/palette.test.ts`.
- [ ] **Step 2: `apps/admin/CLAUDE.md`:** the Brand row (v2 palette remapped onto `gray / brand / red / amber / green`,
  `sun`, `photo`, `scrim`; Manrope + JetBrains Mono; no `blue` / `indigo`; `field-classes.ts` for form fields); a rule
  that the style audit test fails on off-palette colours.
- [ ] **Step 3: `docs/mockups/README.md`:** mark `user-app-mockup-periwinkle-v2.html` as **the approved design (D2,
  v2 chosen 2026-11-18)** and v1 as kept for reference (the README still says v1 is approved and v2 is waiting).
- [ ] **Step 4: `docs/PROJECT_STATUS.md`:** What's built: a "Design system" line (v2 tokens, fonts, components, guards,
  where they live) and update the Design row; a session-log line for this build (tests counts, what the owner still has
  to check on a device).
- [ ] **Step 5: Stage** the four docs. Hand back for the owner's review and commit, with the §12.3 checklist and the
  rulings worth a second look (R9, R15).
